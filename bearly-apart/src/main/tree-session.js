// Keeps this computer's Christmas tree in step with the other computers over the relay (rules in tree.js).
//
// A change (choose, hang, take, tap) goes out as an "op" and counts once it comes back from the relay, so every
// computer applies the same ops in the same order. ntfy keeps messages for about 12 hours, so when the relay comes
// back up an app sends its whole tree ("sync"); an app that then has something the sender lacks answers with its
// merged copy ("state"). Copies merge the same way whichever order they arrive in. No Electron here.
const T = require('./tree');
const A = require('./advent');

const PENDING_TIMEOUT_MS = 8000;
const SYNC_GAP_MS = 10 * 60_000;
const MAX_MESSAGE = 3800;

class TreeSession {
  constructor({ config, publish, load, save, doors = () => A.DEFAULT_CONTENTS, onChange = () => {}, onHang = () => {}, onStar = () => {}, onTapAsk = () => {}, onInvite = () => {}, onOpen = () => {}, testDay = () => 0, tester = () => false, demo = false, bothHere = () => false, device = '', rand = Math.random, now = () => Date.now(), timers = { set: setTimeout, clear: clearTimeout }, log = () => {} }) {
    Object.assign(this, { config, publish, save, doors, onChange, onHang, onStar, onTapAsk, onInvite, onOpen, testDay, tester, demo, bothHere, device, rand, now, timers, log });
    const saved = load() || {};
    this.state = saved.state || null;
    this.saved = { look: saved.look || {} };
    this.pending = false;
    this.pendingTimer = null;
    this.lastSyncAt = 0;
    this.answerTimer = null;
  }

  me() {
    return this.config().me.id;
  }

  them() {
    return this.config().partner.id;
  }

  people() {
    return [this.me(), this.them()].filter(Boolean);
  }

  zones() {
    return [Intl.DateTimeFormat().resolvedOptions().timeZone, this.config().partner.timezone].filter(Boolean);
  }

  day() {
    return T.dayFor(this.now(), this.zones(), this.tester() ? this.testDay() : 0);
  }

  // Before the real season starts (November 27), a tester decorates a practice tree: its messages are marked as tests, only another
  // tester's app takes them, and the real tree starts empty on November 27 (the practice one is thrown away).
  testing() {
    return !!this.tester() && !T.isUp(T.dayFor(this.now(), this.zones()));
  }

  year() {
    return this.testing() ? 0 : T.seasonYear(this.now(), this.zones()[0]);
  }

  // The tree tab shows from Nov 27 to Jan 1, or any time on a tester's computer.
  isUp() {
    return T.isUp(this.day());
  }

  visible() {
    return this.isUp() || !!this.tester();
  }

  // This season's state (a new December starts a new tree).
  cur() {
    const year = this.year();
    if (!this.state || this.state.year !== year) this.state = T.emptyState(year);
    return this.state;
  }

  mode() {
    return T.modeOf(this.cur(), this.people());
  }

  // ---- the advent calendar ----

  // The doors' contents and which one is behind which day (the same on both apps, never shown).
  calendar() {
    const contents = A.cleanContents(this.doors(), Object.keys(T.KINDS).concat('heart-half'));
    const key = `${this.people().join()}|${this.year()}|${JSON.stringify(contents)}`;
    if (this.calKey !== key) {
      this.calKey = key;
      this.cal = { contents, byDay: A.order(contents, A.seedFor(this.people(), this.year())) };
    }
    return this.cal;
  }

  // Doors open at each person's own midnight: the newest door that's ready on this computer's clock (1..29, Nov 27 to
  // Dec 25; after Christmas Day it stays 29, so nothing new knocks).
  doorDay() {
    const d = this.tester() && this.testDay() ? this.testDay() : T.seasonDay(this.now(), this.zones()[0]);
    return Math.min(A.DOORS, d);
  }

  openedDays(person = this.me()) {
    return Object.keys(this.cur().opened?.[person] || {}).map(Number);
  }

  // One ornament or animal as this person gets it (their half of the heart, their colour).
  gift(item) {
    const kind = item === 'heart-half' ? T.halfFor(this.config().me.character) : item;
    const k = T.KINDS[kind];
    return { item: kind, c: T.colorOf(T.itemId(this.me(), kind), this.people()), name: k?.name, emoji: k?.emoji, skirt: !!k?.skirt };
  }

  // What's behind a door, as this person sees it (their own extra line, if Aaron wrote one for them), with what
  // Santa brings on top ("more").
  reward(day) {
    const { contents, byDay } = this.calendar();
    const c = contents[byDay[day]];
    if (!c) return null;
    const mine = c[`for${(this.config().me.name || '').replace(/^\w/, (x) => x.toUpperCase())}`];
    const out = { kind: c.kind, title: c.title, text: [c.text, mine].filter(Boolean).join('\n\n') };
    if (c.kind === 'ornament') {
      Object.assign(out, this.gift(c.item));
      if (!out.title) out.title = out.skirt ? `A little ${out.name} for under the tree ${out.emoji}` : `A ${out.name} for the tree ${out.emoji}`;
      if (c.more?.length) out.more = c.more.map((m) => this.gift(m));
    }
    if (c.kind === 'snow' && !out.title) out.title = 'A snow day ❄️';
    if (c.kind === 'lights' && !out.title) out.title = 'The tree lights ✨';
    return out;
  }

  // Whether a tree has its lights: once its owner has opened the lights door (a shared tree: either of you). With
  // no lights door behind the calendar, from LIGHTS_DAY.
  lightsUp(tree, state = this.cur()) {
    const { contents, byDay } = this.calendar();
    const d = A.lightsDay(contents, byDay);
    if (!d) return this.day() >= T.LIGHTS_DAY;
    const who = tree === 'us' ? this.people() : [tree];
    return who.some((p) => !!state.opened?.[p]?.[d]);
  }

  // The trees there are: ['us'], or [me, them], or none while still choosing.
  trees() {
    const t = T.treesFor(this.mode(), this.people());
    // My own tree first.
    return t.length === 2 ? [this.me(), this.them()] : t;
  }

  persist() {
    this.save({ state: this.state, look: this.look() });
  }

  // ---- what this person does ------------------------------------------------------

  // The calendar's look (house colour, door colours) is this person's own: kept here, never sent.
  look() {
    return this.saved?.look || {};
  }

  async act(a) {
    if (a?.type === 'look') {
      const look = {};
      if (['gingerbread', 'strawberry', 'mint', 'chocolate', 'snowy'].includes(a.look?.house)) look.house = a.look.house;
      if (['candy', 'pastel', 'classic', 'icy', 'berry'].includes(a.look?.doors)) look.doors = a.look.doors;
      this.saved = { ...this.saved, look: { ...this.look(), ...look } };
      this.persist();
      this.onChange();
      return { ok: true };
    }
    const people = this.people();
    if (people.length < 2) return { ok: false, error: 'Connect to your person first.' };
    if (!this.isUp() && !this.tester()) return { ok: false, error: 'The tree goes up on November 27.' };
    if (this.pending) return { ok: false, error: 'Still sending…' };
    const s = this.cur();
    const mode = this.mode();
    let op;
    if (a?.type === 'choose') {
      if (mode) return { ok: false, error: 'You’ve both chosen already.' };
      if (!['shared', 'own'].includes(a.mode)) return { ok: false, error: 'Pick one tree or two.' };
      op = { k: 'choose', m: a.mode };
    } else if (a?.type === 'hang') {
      if (!mode) return { ok: false, error: 'Choose your tree first.' };
      const it = T.parseItem(a.item);
      if (!it || it.owner !== this.me()) return { ok: false, error: 'That one isn’t yours to hang.' };
      if (!this.box().includes(a.item) && !T.whereIs(s, mode, people, a.item)) return { ok: false, error: 'That ornament isn’t in your box yet.' };
      if (!T.treesFor(mode, people).includes(a.tree)) return { ok: false, error: 'That tree isn’t here.' };
      if (!T.slotFits(it.kind, Number(a.slot))) return { ok: false, error: T.isSkirt(it.kind) ? 'The little animals sit round the tree skirt.' : 'That goes on a branch.' };
      const taken = T.placements(s, a.tree)[a.slot];
      if (taken && taken !== a.item) return { ok: false, error: 'Something’s already hanging there.' };
      op = { k: 'hang', item: a.item, tree: a.tree, slot: Number(a.slot) };
    } else if (a?.type === 'take') {
      const it = T.parseItem(a.item);
      if (!it || it.owner !== this.me()) return { ok: false, error: 'Only whoever hung it can take it down.' };
      op = { k: 'take', item: a.item };
    } else if (a?.type === 'style') {
      const it = T.parseItem(a.item);
      if (!it || it.owner !== this.me()) return { ok: false, error: 'Only whoever owns it can restyle it.' };
      const style = T.cleanStyle(a.style);
      if (!style) return { ok: false, error: 'That style isn’t one we have.' };
      op = { k: 'style', item: a.item, style };
    } else if (a?.type === 'treestyle') {
      if (!mode) return { ok: false, error: 'Choose your tree first.' };
      if (a.tree !== 'us' && a.tree !== this.me()) return { ok: false, error: 'Only they can restyle their own tree.' };
      const style = T.cleanTreeStyle(a.style);
      if (!style) return { ok: false, error: 'That style isn’t one we have.' };
      op = { k: 'treestyle', tree: a.tree, style };
    } else if (a?.type === 'open') {
      const day = Number(a.day);
      if (!Number.isInteger(day) || day < 1 || day > A.DOORS) return { ok: false, error: 'That isn’t a door.' };
      if (day > this.doorDay()) return { ok: false, error: `Door ${T.doorLabel(day)} opens on ${T.dateName(day)}.` };
      if (this.openedDays().includes(day)) return { ok: false, error: 'You’ve opened that one.' };
      op = { k: 'open', day };
    } else if (a?.type === 'tap') {
      if (!T.starDay(this.day())) return { ok: false, error: 'The star goes on on Christmas Eve.' };
      if (s.star) return { ok: false, error: 'The star’s already on.' };
      op = { k: 'tap' };
    } else {
      return { ok: false, error: 'unknown action' };
    }
    if (this.testing()) op.test = true;
    return this.send('op', op);
  }

  async send(status, body) {
    const text = JSON.stringify(body);
    if (text.length > MAX_MESSAGE) return { ok: false, error: 'The tree got too big to send.' };
    if (status === 'op') this.setPending(true);
    try {
      await this.publish(status, text);
      return { ok: true };
    } catch (err) {
      if (status === 'op') this.setPending(false);
      this.log(`[tree] send failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  setPending(on) {
    this.pending = on;
    this.timers.clear(this.pendingTimer);
    if (on) this.pendingTimer = this.timers.set(() => this.setPending(false), PENDING_TIMEOUT_MS);
    this.onChange();
  }

  // ---- what arrives from the relay ---------------------------------------------------

  onEvent(ev) {
    const people = this.people();
    if (!people.includes(ev.from)) return;
    let body;
    try {
      body = JSON.parse(ev.text);
    } catch {
      return this.log('[tree] unreadable message');
    }
    // A practice tree's messages and the real tree's never mix.
    const isTest = ev.status === 'op' ? body?.test === true : body?.year === 0;
    if (isTest !== this.testing()) return;
    if (ev.status === 'op') return this.onOp(body, ev);
    if (ev.status === 'sync' || ev.status === 'state') {
      if (ev.from === this.me() && ev.device === this.device) return; // my own, back from the relay
      const theirs = T.clean(body, people);
      if (!theirs) return;
      const before = this.cur();
      const merged = T.merge(before, theirs, people);
      this.accept(merged, before, null);
      // They're missing something this copy has: send them the merged tree (one answer is enough).
      if (ev.status === 'sync' && T.fingerprint(merged) !== T.fingerprint(theirs)) {
        this.timers.clear(this.answerTimer);
        this.answerTimer = this.timers.set(() => this.send('state', this.cur()), 300 + this.rand() * 1200);
      }
    }
  }

  onOp(op, ev) {
    const people = this.people();
    const before = this.cur();
    const after = T.apply(before, op, ev, people);
    if (ev.from === this.me()) {
      this.pending = false;
      this.timers.clear(this.pendingTimer);
    }
    this.accept(after, before, { op, ev });
  }

  accept(after, before, cause) {
    const changed = after !== before && T.fingerprint(after) !== T.fingerprint(before);
    this.state = after;
    if (changed) this.persist();
    this.onChange();
    if (!changed) return;
    const people = this.people();
    // Their tree choice arrived and this person hasn't chosen yet.
    const them = this.them();
    if (!T.modeOf(after, people) && after.choice[them]?.m === 'shared' && !before.choice[them] && !after.choice[this.me()]) this.onInvite();
    // A door opened here (not on another of my computers): show what was behind it.
    if (cause?.op?.k === 'open' && cause.ev.from === this.me() && cause.ev.device === this.device) this.onOpen({ day: cause.op.day, ...this.reward(cause.op.day) });
    if (after.star && !before.star) this.onStar();
    // They clicked the star and it isn't on yet: this person has 20 seconds to click too.
    else if (cause?.op?.k === 'tap' && cause.ev.from === them && !after.star && this.now() - cause.ev.at < T.STAR_WINDOW_MS) this.onTapAsk();
    // They hung something (not on another of my own computers): their bear brings it over.
    if (cause?.op?.k === 'hang' && cause.ev.from === them) {
      const mode = T.modeOf(after, people);
      const at = T.whereIs(after, mode, people, cause.op.item);
      if (at) {
        const it = T.parseItem(cause.op.item);
        this.onHang({ item: cause.op.item, kind: it.kind, name: T.KINDS[it.kind].name, emoji: T.KINDS[it.kind].emoji, tree: at.tree, slot: at.slot, onMine: at.tree === 'us' || at.tree === this.me(), before: this.spec(at.tree, before), after: this.spec(at.tree, after) });
      }
    }
  }

  // The relay is (back) up: send this copy so anyone with more can answer.
  onConnected() {
    if (this.people().length < 2 || !this.visible() || this.now() - this.lastSyncAt < SYNC_GAP_MS) return;
    this.lastSyncAt = this.now();
    this.send('sync', this.cur());
  }

  // The Christmas demo's pretend partner hangs one of their ornaments (from the doors they've opened, or by date if
  // they've opened none) on a free spot of my tree, or of ours. Null when there's nothing left to hang.
  partnerHangOp() {
    const people = this.people();
    const them = this.them();
    const s = this.cur();
    const mode = this.mode();
    if (!mode || !them) return null;
    const { contents, byDay } = this.calendar();
    const pc = this.config().partner.character;
    const kinds = A.ornamentsFrom(contents, byDay, this.openedDays(them), T.halfFor(pc));
    const items = T.unlockedItems(them, pc, this.day(), kinds.size ? kinds : null).filter((id) => !T.whereIs(s, mode, people, id));
    const tree = mode === 'shared' ? 'us' : this.me();
    const taken = T.placements(s, tree);
    const pick = (a) => a[Math.floor(this.rand() * a.length)];
    // Only ones that still have a free spot of their sort (branch or skirt).
    const freeFor = (id) => [...Array(T.SLOTS + T.SKIRT).keys()].filter((i) => !taken[i] && T.slotFits(T.parseItem(id).kind, i));
    const fits = items.filter((id) => freeFor(id).length);
    if (!fits.length) return null;
    const item = pick(fits);
    const op = { k: 'hang', item, tree, slot: pick(freeFor(item)) };
    if (this.testing()) op.test = true;
    return op;
  }

  // ---- what the window and the overlay draw ---------------------------------------------

  box() {
    const s = this.cur();
    const mode = this.mode();
    const people = this.people();
    const { contents, byDay } = this.calendar();
    const kinds = A.ornamentsFrom(contents, byDay, this.openedDays(), T.halfFor(this.config().me.character));
    return T.unlockedItems(this.me(), this.config().me.character, this.day(), kinds).filter((id) => !T.whereIs(s, mode, people, id));
  }

  // Everything needed to draw one tree: stage, star, lights, the name on its plaque, and its ornaments.
  spec(tree, state = this.cur()) {
    const people = this.people();
    const c = this.config();
    const names = { [c.me.id]: c.me.name || 'You', [c.partner.id]: c.partner.name || 'Your love' };
    const day = this.day();
    const stage = T.stageFor(day) || 'bare';
    const lightsUp = this.lightsUp(tree, state);
    const p = T.placements(state, tree);
    return {
      tree,
      stage,
      garland: stage === 'garland',
      lightsUp,
      star: !!state.star,
      lights: lightsUp && this.bothHere(),
      // The same name on both computers: the two of you in a fixed order.
      name: tree === 'us' ? `${[...people].sort().map((p) => names[p]).join(' & ')}’s Tree` : `${names[tree] || 'Our'}’s Tree`,
      style: state.treeStyles?.[tree]?.s || {},
      orns: Object.entries(p).map(([slot, id]) => {
        const it = T.parseItem(id);
        return { slot: Number(slot), kind: it.kind, c: T.colorOf(id, people), id, by: it.owner, style: state.styles?.[id]?.s || null };
      }),
    };
  }

  view() {
    const s = this.cur();
    const people = this.people();
    const mode = this.mode();
    const day = this.day();
    const c = this.config();
    return {
      up: this.isUp(),
      visible: this.visible(),
      tester: !!this.tester(),
      demo: !!this.demo,
      practice: this.testing() && !this.demo,
      testDay: this.tester() ? this.testDay() : 0,
      day,
      date: T.dateName(day),
      stage: T.stageFor(day),
      starDay: T.starDay(day),
      star: !!s.star,
      taps: s.taps,
      pending: this.pending,
      me: this.me(),
      them: this.them(),
      names: { me: c.me.name || 'You', them: c.partner.name || 'Your love' },
      mode,
      myChoice: s.choice[this.me()]?.m || null,
      theirChoice: s.choice[this.them()]?.m || null,
      trees: this.trees().map((t) => ({ ...this.spec(t), starGhost: T.starDay(day) && !s.star })),
      box: this.box().map((id) => {
        const it = T.parseItem(id);
        return { id, kind: it.kind, c: T.colorOf(id, people), name: T.KINDS[it.kind].name, emoji: T.KINDS[it.kind].emoji, style: s.styles?.[id]?.s || null };
      }),
      look: this.look(),
      calendar: (() => {
        const today = this.doorDay();
        const mine = this.openedDays();
        const theirs = this.openedDays(this.them());
        return {
          today,
          doors: [...Array(A.DOORS)].map((_, i) => {
            const d = i + 1;
            const opened = mine.includes(d);
            return { d, ready: d <= today, opened, theyOpened: theirs.includes(d), reward: opened ? this.reward(d) : null };
          }),
        };
      })(),
    };
  }
}

module.exports = { TreeSession };
