// A visit to the photo booth, kept in step between the two apps. Every change is a quiet `booth` relay message and
// only counts when it comes back from the relay, so both apps see the same order. Photos never travel as messages:
// each app seals its shots (booth.js) and uploads them as one ntfy attachment, then sends the link.
//
// Modes: 'together' (invite, both get ready, the shots fire at the same moment on both computers), 'own' (each of
// you takes your half whenever you like; the strip develops once both halves are in) and 'test' (just this
// computer: you take both halves yourself, nothing is sent).
const fs = require('fs');
const path = require('path');
const B = require('./booth');

const NEED_EVERY_MS = 10 * 60_000; // asking again for a half that never arrived
const CLOCK_SAMPLES = 9;

class BoothSession {
  constructor({ config, dir, publish, upload, download, notify = () => {}, onChange = () => {}, onStrip = () => {}, device, log = console.log, now = Date.now, tester = () => false }) {
    Object.assign(this, { config, dir, publish, upload, download, notify, onChange, onStrip, device, log, now, tester });
    this.file = path.join(dir, 'booth.json');
    this.data = { sessions: {}, keys: {} };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      /* first visit */
    }
    this.offsets = []; // relay clock minus this clock, from the relay's answers
    this.busy = new Set(); // uploads and downloads under way, by sid:kind
  }

  // ---------- small helpers ----------

  me() {
    return this.config().me.id;
  }
  them() {
    return this.config().partner.id;
  }
  names() {
    const c = this.config();
    return { [c.me.id]: c.me.name || 'Me', [c.partner.id || 'partner']: c.partner.name || 'Them' };
  }
  zones() {
    return [Intl.DateTimeFormat().resolvedOptions().timeZone, this.config().partner.timezone].filter(Boolean);
  }
  isOpen() {
    return B.isBoothDay(this.now(), this.zones());
  }
  // The Draft tab unlocks at the same moment as the booth.
  draftUnlocked() {
    return B.unlocked(this.now(), this.zones()) || this.tester();
  }
  canShoot() {
    return this.isOpen() || this.tester();
  }
  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1));
  }
  changed() {
    this.save();
    this.onChange();
  }
  folder(sid) {
    return path.join(this.dir, sid.replace(/[^a-f0-9-]/g, ''));
  }
  other(s, id = this.me()) {
    return id === s.host ? s.guest : s.host;
  }
  myDevice(s) {
    return this.me() === s.host ? s.hostDevice : s.guestDevice;
  }
  key(s) {
    const priv = this.data.keys[s.sid];
    const theirs = s.pub[this.other(s)];
    return priv && theirs ? B.sessionKey(priv, theirs, s.sid) : null;
  }
  photoFiles(s, who) {
    const dir = this.folder(s.sid);
    return [...Array(B.SHOTS)].map((_, i) => path.join(dir, `${who}-${i + 1}.jpg`)).filter((f) => fs.existsSync(f));
  }
  hasHalf(s, who) {
    return this.photoFiles(s, who).length === B.SHOTS;
  }

  // The relay stamps each message with its own clock (whole seconds). Comparing that with the moment the answer
  // came back gives this clock's offset; the middle of several guesses lands within about half a second.
  serverNow() {
    if (!this.offsets.length) return this.now();
    const sorted = [...this.offsets].sort((a, b) => a - b);
    return this.now() + sorted[Math.floor(sorted.length / 2)];
  }
  toLocal(serverMs) {
    return serverMs - (this.serverNow() - this.now());
  }
  async send(kind, body) {
    const t0 = this.now();
    const res = await this.publish(kind, JSON.stringify({ ...body, d: this.device }));
    const t1 = this.now();
    if (res?.time) {
      this.offsets.push(res.time * 1000 + 500 - (t0 + t1) / 2);
      if (this.offsets.length > CLOCK_SAMPLES) this.offsets.shift();
    }
    return res;
  }
  async trySend(kind, body) {
    try {
      await this.send(kind, body);
      return { ok: true };
    } catch (err) {
      this.log(`[booth] sending ${kind} failed: ${err.message}`);
      return { ok: false, error: `Couldn’t reach the relay: ${err.message}` };
    }
  }

  // ---------- what the window asks for ----------

  async start({ mode }) {
    if (!['together', 'own', 'test'].includes(mode)) return { ok: false, error: 'unknown mode' };
    if (mode !== 'test' && !this.them()) return { ok: false, error: 'Connect with your person first.' };
    if (!this.canShoot()) return { ok: false, error: 'The booth is closed today.' };
    const sid = B.newSid();
    if (mode === 'test') {
      this.data.sessions[sid] = this.newSession({ sid, mode, host: this.me(), hostDevice: this.device, guest: this.them() || 'partner', guestDevice: this.device, status: 'lobby' });
      this.changed();
      return { ok: true, sid };
    }
    const keys = B.newKeys();
    this.data.keys[sid] = keys.priv;
    this.save();
    const r = await this.trySend('invite', { sid, mode, pub: keys.pub, settings: this.lastSettings() });
    return r.ok ? { ok: true, sid } : r;
  }

  newSession(fields) {
    return { createdAt: this.now(), settings: this.lastSettings(), ready: {}, pub: {}, go: 0, uploaded: {}, needAt: 0, ...fields };
  }

  // A new visit starts with the look you used last time.
  lastSettings() {
    const last = Object.values(this.data.sessions).sort((a, b) => b.createdAt - a.createdAt)[0];
    return B.cleanSettings(last ? { design: last.settings.design, filter: last.settings.filter, occasion: last.settings.occasion, places: last.settings.places, color: last.settings.color, deco: last.settings.deco, tags: last.settings.tags, bears: last.settings.bears, times: last.settings.times, stamp: last.settings.stamp, prompts: last.settings.prompts } : {});
  }

  async act(a) {
    const s = this.data.sessions[a?.sid];
    if (!s) return { ok: false, error: 'That booth visit is gone.' };
    const test = s.mode === 'test';
    switch (a.type) {
      case 'accept': {
        if (s.status !== 'invited' || s.host === this.me()) return { ok: false, error: 'Nothing to accept.' };
        if (!this.canShoot()) return { ok: false, error: 'The booth is closed today.' };
        const keys = B.newKeys();
        this.data.keys[s.sid] = keys.priv;
        this.save();
        return this.trySend('accept', { sid: s.sid, pub: keys.pub });
      }
      case 'decline':
        return this.trySend('decline', { sid: s.sid });
      case 'set': {
        const next = B.cleanSettings(a.patch, s.settings);
        if (test) {
          s.settings = next;
          this.changed();
          return { ok: true };
        }
        // Shown straight away here; the relay's copy settles it if you both changed something at once.
        s.settings = next;
        this.onChange();
        return this.trySend('set', { sid: s.sid, patch: a.patch });
      }
      case 'ready':
        if (s.mode !== 'together' || s.status !== 'lobby') return { ok: false, error: 'Not now.' };
        return this.trySend('ready', { sid: s.sid, on: !!a.on });
      case 'shots':
        return this.takeShots(s, a);
      case 'then':
        return this.setThen(s, a.image);
      case 'cancel':
        if (test || ['done', 'declined', 'cancelled'].includes(s.status)) return { ok: false, error: 'Not now.' };
        return this.trySend('cancel', { sid: s.sid });
      case 'forget': {
        // Off this computer only: their copy stays.
        delete this.data.sessions[s.sid];
        delete this.data.keys[s.sid];
        fs.rmSync(this.folder(s.sid), { recursive: true, force: true });
        this.changed();
        return { ok: true };
      }
      case 'seen':
        s.seenStrip = true;
        this.changed();
        return { ok: true };
      default:
        return { ok: false, error: 'unknown booth action' };
    }
  }

  // images: JPEG data URLs from the window. In a test visit, who = 'me' or 'them' (you're playing both).
  async takeShots(s, { images, who }) {
    if (!Array.isArray(images) || images.length !== B.SHOTS) return { ok: false, error: 'Four photos, please.' };
    const person = s.mode === 'test' && who === 'them' ? s.guest : this.me();
    const dir = this.folder(s.sid);
    fs.mkdirSync(dir, { recursive: true });
    images.forEach((img, i) => fs.writeFileSync(path.join(dir, `${person}-${i + 1}.jpg`), dataUrlBytes(img)));
    s.rev = (s.rev || 0) + 1;
    if (s.mode === 'test') {
      if (this.hasHalf(s, s.host) && this.hasHalf(s, s.guest)) s.status = 'done';
      this.changed();
      return { ok: true };
    }
    if (s.mode === 'together' && (s.status === 'lobby' || s.status === 'shooting')) s.status = 'developing';
    this.checkDone(s);
    this.changed();
    return this.uploadMine(s, 'half');
  }

  async setThen(s, image) {
    const bytes = image ? dataUrlBytes(image) : null;
    const file = path.join(this.folder(s.sid), 'then.jpg');
    fs.mkdirSync(this.folder(s.sid), { recursive: true });
    if (bytes) fs.writeFileSync(file, bytes);
    else fs.rmSync(file, { force: true });
    s.thenBy = bytes ? this.me() : '';
    s.rev = (s.rev || 0) + 1;
    s.settings.thenNow = !!bytes;
    if (s.mode === 'test') {
      this.changed();
      return { ok: true };
    }
    this.changed();
    if (!bytes) return this.trySend('set', { sid: s.sid, patch: { thenNow: false } });
    const up = await this.uploadMine(s, 'then');
    if (!up.ok) return up;
    return this.trySend('set', { sid: s.sid, patch: { thenNow: true } });
  }

  // Seals this app's files of one kind and uploads them. Waits (quietly) if the other key isn't here yet: it goes
  // out when their accept arrives.
  async uploadMine(s, kind) {
    const key = this.key(s);
    if (!key) return { ok: true, waiting: true };
    const files =
      kind === 'then'
        ? [{ name: 'then.jpg', data: fs.readFileSync(path.join(this.folder(s.sid), 'then.jpg')) }]
        : this.photoFiles(s, this.me()).map((f, i) => ({ name: `${i + 1}.jpg`, data: fs.readFileSync(f) }));
    if (!files.length) return { ok: true, waiting: true };
    const tag = `${s.sid}:up:${kind}`;
    if (this.busy.has(tag)) return { ok: true };
    this.busy.add(tag);
    try {
      const { url } = await this.upload(B.seal(key, B.pack(files)), `booth-${s.sid}.bin`);
      s.uploaded[kind] = this.now();
      this.save();
      await this.send('files', { sid: s.sid, kind, url });
      this.log(`[booth] sent my ${kind} for ${s.sid}`);
      return { ok: true };
    } catch (err) {
      this.log(`[booth] uploading my ${kind} failed: ${err.message}`);
      return { ok: false, error: `Couldn’t send the photos: ${err.message}` };
    } finally {
      this.busy.delete(tag);
    }
  }

  async fetchTheirs(s, kind, url, from) {
    const tag = `${s.sid}:down:${kind}`;
    if (this.busy.has(tag)) return;
    this.busy.add(tag);
    try {
      const key = this.key(s);
      if (!key) throw new Error('no key yet');
      const files = B.unpack(B.open(key, await this.download(url)));
      const dir = this.folder(s.sid);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of files) {
        if (kind === 'then' && f.name === 'then.jpg') fs.writeFileSync(path.join(dir, 'then.jpg'), f.data);
        const n = f.name.match(/^([1-4])\.jpg$/)?.[1];
        if (kind === 'half' && n) fs.writeFileSync(path.join(dir, `${from}-${n}.jpg`), f.data);
      }
      if (kind === 'then') s.thenBy = from;
      s.rev = (s.rev || 0) + 1;
      this.log(`[booth] got their ${kind} for ${s.sid}`);
      this.checkDone(s);
      this.changed();
    } catch (err) {
      this.log(`[booth] fetching their ${kind} failed: ${err.message}`);
      // Probably expired on the relay (attachments only last a few hours): ask for it again.
      this.askAgain(s, kind);
    } finally {
      this.busy.delete(tag);
    }
  }

  askAgain(s, kind) {
    if (this.now() - (s.needAt || 0) < NEED_EVERY_MS) return;
    s.needAt = this.now();
    this.save();
    this.trySend('need', { sid: s.sid, kind });
  }

  checkDone(s) {
    if (s.status === 'done' || !this.hasHalf(s, s.host) || !this.hasHalf(s, s.guest)) return;
    s.status = 'done';
    s.doneAt = this.now();
    if (s.mode !== 'test') {
      this.notify('Your photo strip is ready 📸');
      this.onStrip(s);
    }
  }

  // ---------- from the relay ----------

  onEvent(ev) {
    let body;
    try {
      body = JSON.parse(ev.text);
    } catch {
      return;
    }
    const sid = String(body.sid || '');
    if (!/^[a-f0-9]{10}$/.test(sid)) return;
    const kind = ev.status;
    const mine = ev.from === this.me();
    const fromHere = mine && body.d === this.device;
    let s = this.data.sessions[sid];

    if (kind === 'invite') {
      if (s) return;
      if (!['together', 'own'].includes(body.mode)) return;
      if (mine && !fromHere) return; // my other computer's visit
      s = this.data.sessions[sid] = this.newSession({
        sid,
        mode: body.mode,
        host: ev.from,
        hostDevice: body.d,
        guest: mine ? this.them() : this.me(),
        guestDevice: '',
        status: 'invited',
        settings: B.cleanSettings(body.settings),
        invitedAt: ev.at || this.now(),
      });
      s.pub[ev.from] = String(body.pub || '');
      if (!mine) {
        const name = this.config().partner.name || 'Your love';
        this.notify(body.mode === 'own' ? `${name} started a photo strip. Take your half! 📸` : `${name} invited you to the photo booth 📸`, { invite: true });
      }
      return this.changed();
    }
    if (!s || s.mode === 'test') return;
    // Only the two computers in this visit count (my other computer may hear it too).
    if (mine && this.myDevice(s) && body.d !== this.myDevice(s)) {
      if (kind === 'accept' && s.guest === this.me() && s.status === 'invited') {
        s.guestDevice = body.d;
        s.status = 'elsewhere';
        this.changed();
      }
      return;
    }
    if (!mine && ev.from !== this.other(s)) return;

    switch (kind) {
      case 'accept':
        if (s.status !== 'invited' || ev.from !== s.guest) return;
        s.guestDevice = body.d;
        s.pub[s.guest] = String(body.pub || '');
        s.status = 'lobby';
        if (!mine) this.notify(`${this.config().partner.name || 'They'} joined the booth 📸`);
        this.changed();
        // In "own time" the host may have shot already: now there's a key to send it with.
        if (s.host === this.me()) {
          if (this.hasHalf(s, this.me())) this.uploadMine(s, 'half');
          if (s.thenBy === this.me()) this.uploadMine(s, 'then');
        }
        return;
      case 'decline':
        if (s.status === 'invited') {
          s.status = 'declined';
          if (!mine) this.notify(`${this.config().partner.name || 'They'} can’t do the booth right now`);
          this.changed();
        }
        return;
      case 'cancel':
        if (s.status !== 'done') {
          s.status = 'cancelled';
          this.changed();
        }
        return;
      case 'set':
        s.settings = B.cleanSettings(body.patch, s.settings);
        return this.changed();
      case 'ready': {
        s.ready[ev.from] = !!body.on;
        this.changed();
        // The host's app calls "go" once both are ready, a few seconds ahead so the message gets there in time.
        if (s.host === this.me() && s.status === 'lobby' && s.ready[s.host] && s.ready[s.guest] && !s.goSent) {
          s.goSent = true;
          this.trySend('go', { sid, at: this.serverNow() + 2500 });
        }
        return;
      }
      case 'go':
        if (s.status !== 'lobby') return;
        s.status = 'shooting';
        s.go = Number(body.at) || 0;
        s.ready = {};
        s.goSent = false;
        return this.changed();
      case 'files':
        if (mine) return;
        if (body.kind !== 'half' && body.kind !== 'then') return;
        s.gotLink = { ...s.gotLink, [body.kind]: true };
        this.fetchTheirs(s, body.kind, String(body.url || ''), ev.from);
        return;
      case 'need':
        if (mine) return;
        if (body.kind === 'half' && this.hasHalf(s, this.me())) this.uploadMine(s, 'half');
        if (body.kind === 'then' && s.thenBy === this.me()) this.uploadMine(s, 'then');
        return;
    }
  }

  // Back online: ask again for anything they sent that never made it here (the relay forgets after a while).
  onConnected() {
    for (const s of Object.values(this.data.sessions)) {
      if (s.mode === 'test' || !this.key(s) || ['declined', 'cancelled'].includes(s.status)) continue;
      const late = s.status === 'developing' && this.now() - (s.uploaded.half || 0) > 2 * 60_000;
      if (!this.hasHalf(s, this.other(s)) && (s.gotLink?.half || late)) this.askAgain(s, 'half');
      else if (s.gotLink?.then && s.thenBy !== this.me() && !fs.existsSync(path.join(this.folder(s.sid), 'then.jpg'))) this.askAgain(s, 'then');
    }
  }

  // ---------- for the window ----------

  view() {
    const names = this.names();
    const sessions = Object.values(this.data.sessions)
      .filter((s) => s.status !== 'elsewhere')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        sid: s.sid,
        mode: s.mode,
        status: s.status,
        host: s.host,
        guest: s.guest,
        iHost: s.host === this.me(),
        createdAt: s.createdAt,
        doneAt: s.doneAt || 0,
        settings: s.settings,
        ready: s.ready,
        shotsAt: s.go ? B.shotTimes(s.go).map((t) => this.toLocal(t)) : [],
        mine: this.photoFiles(s, this.me()).length,
        theirs: this.photoFiles(s, this.other(s)).length,
        testThem: s.mode === 'test' ? this.photoFiles(s, s.guest).length : 0,
        hasThen: fs.existsSync(path.join(this.folder(s.sid), 'then.jpg')),
        rev: s.rev || 0,
        seenStrip: !!s.seenStrip,
      }));
    return { open: this.isOpen(), canShoot: this.canShoot(), over: B.boothOver(this.now(), this.zones()), names, me: this.me(), them: this.them(), zones: { [this.me()]: this.zones()[0], [this.them() || 'partner']: this.config().partner.timezone || '' }, sessions };
  }

  // The photos as data URLs: { [person id]: [four], then }.
  photos(sid) {
    const s = this.data.sessions[sid];
    if (!s) return null;
    const read = (f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString('base64')}`;
    const out = {};
    for (const who of [s.host, s.guest]) out[who] = this.photoFiles(s, who).map(read);
    const then = path.join(this.folder(sid), 'then.jpg');
    out.then = fs.existsSync(then) ? read(then) : null;
    return out;
  }

  // Your move: an invite waiting for an answer, or your half still to take.
  needsMe() {
    return Object.values(this.data.sessions).some(
      (s) => s.mode !== 'test' && ((s.status === 'invited' && s.host !== this.me()) || (s.status === 'lobby' && s.mode === 'own' && !this.hasHalf(s, this.me())) || (s.status === 'done' && !s.seenStrip)),
    );
  }
}

function dataUrlBytes(url) {
  const m = String(url).match(/^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('not a picture');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 4_000_000) throw new Error('that picture is too big');
  return buf;
}

module.exports = { BoothSession };
