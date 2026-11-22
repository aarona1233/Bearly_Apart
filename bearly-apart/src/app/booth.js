// The Booth tab: a photo booth for two computers. The visit itself (invites, settings, timing, swapping photos)
// runs in the main process (main/booth-session.js); this draws it, runs the camera and the countdown, and draws the
// strip (booth-strip.js).
let boothView = null;
const bz = {
  sid: '', // the visit on screen ('' = the booth's front)
  round: 'me', // test visits: whose half is being shot now
  stream: null,
  video: null,
  shooting: false,
  shots: [],
  timers: [],
  assets: null,
  photos: new Map(), // sid -> { key, data }
  developed: new Set(), // visits whose "developing" animation already played
  flipped: false,
  big: false,
  saved: '',
  pending: {}, // settings typed but not sent yet
  pendingTimer: 0,
  renderToken: 0,
  cameraError: '',
  lastKey: '',
};
const SHOT_LEAD = 4000; // in your own time: from pressing the button to the first shot
const SHOT_GAP = 6500;
const PLACEHOLDER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const session = () => boothView?.sessions.find((s) => s.sid === bz.sid) || null;
const nameOfId = (id) => boothView?.names[id] || (id === data.config.me.id ? data.config.me.name : partner());
const isTest = (s) => s?.mode === 'test';

function bbtn(text, className, fn, disabled = false) {
  return el('button', { className, textContent: text, disabled, onclick: fn });
}

async function boothDo(action) {
  const r = await window.ba.booth(action);
  if (r && r.ok === false && r.error) toast(r.error);
  return r;
}

// Who sits where: Dudu's person on the left, Bubu's on the right (the bears in the corners match).
function sides(s) {
  const me = data.config.me;
  const theirBear = data.config.partner.character || (me.character === 'brown' ? 'cream' : 'brown');
  const bearOfId = (id) => (id === me.id ? me.character : theirBear);
  let [left, right] = [s.host, s.guest];
  if (bearOfId(left) !== 'brown' && bearOfId(right) === 'brown') [left, right] = [right, left];
  return { left, right, bears: { left: bearOfId(left), right: bearOfId(right) } };
}

// "left" or "right": where this person sits in every shot.
function sideOf(s, id) {
  return sides(s).left === id ? 'left' : 'right';
}

function sideNote(s, who) {
  const me = data.config.me.id;
  const id = isTest(s) && who === 'them' ? s.guest : me;
  const side = sideOf(s, id);
  const bear = sides(s).bears[side] === 'brown' ? 'Dudu' : 'Bubu';
  const other = nameOfId(side === 'left' ? sides(s).right : sides(s).left);
  const text = isTest(s) && who === 'them' ? `Now you’re ${nameOfId(id)}: the ${side} side of every shot (${bear}’s side).` : `You’re on the ${side} of every shot (${bear}’s side). ${other} is on the ${side === 'left' ? 'right' : 'left'}.`;
  return el('p', { className: `bt-side-note ${side}`, textContent: `${side === 'left' ? '◀ ' : ''}${text}${side === 'right' ? ' ▶' : ''}` });
}

function stripOptions(s, photos) {
  const sd = sides(s);
  const zoneOf = (id) => boothView.zones[id] || (id === data.config.me.id ? PLACEHOLDER_ZONE : data.config.partner.timezone || PLACEHOLDER_ZONE);
  const placeOf = (id) => s.settings.places?.[id] || cityName(zoneOf(id));
  return {
    photos: { left: photos?.[sd.left] || [], right: photos?.[sd.right] || [], then: photos?.then || null },
    settings: { ...s.settings, ...bz.pending },
    names: { left: nameOfId(sd.left), right: nameOfId(sd.right) },
    bears: sd.bears,
    zones: { left: zoneOf(sd.left), right: zoneOf(sd.right) },
    places: { left: placeOf(sd.left), right: placeOf(sd.right) },
    when: s.shotsAt?.[0] || s.createdAt,
    seed: s.sid,
    assets: bz.assets,
  };
}

const cityName = (tz) => {
  const last = String(tz || '').split('/').pop();
  return last && last !== 'UTC' ? last.replace(/_/g, ' ') : '';
};

async function photosFor(s) {
  const key = `${s.rev}:${s.mine}:${s.theirs}:${s.testThem}:${s.hasThen}`;
  const have = bz.photos.get(s.sid);
  if (have?.key === key) return have.data;
  const data = (await window.ba.boothPhotos(s.sid)) || {};
  bz.photos.set(s.sid, { key, data });
  return data;
}

// ---------- settings: shown here at once, sent shortly after you stop typing ----------

function setSetting(patch, { now = false } = {}) {
  Object.assign(bz.pending, patch);
  clearTimeout(bz.pendingTimer);
  const send = () => {
    const p = bz.pending;
    bz.pending = {};
    const s = session();
    if (s && Object.keys(p).length) {
      Object.assign(s.settings, p);
      boothDo({ type: 'set', sid: s.sid, patch: p });
    }
  };
  if (now) send();
  else bz.pendingTimer = setTimeout(send, 700);
  drawPreviewSoon();
}

// ---------- the camera ----------

async function startCamera() {
  if (bz.stream) return true;
  const allowed = await boothDo({ type: 'camera' });
  if (allowed?.ok === false) {
    bz.cameraError = allowed.error;
    return false;
  }
  try {
    bz.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' }, audio: false });
    bz.cameraError = '';
    return true;
  } catch (err) {
    bz.cameraError = err.name === 'NotAllowedError' ? 'The camera was blocked. Allow it for Bearly Apart and try again.' : err.name === 'NotFoundError' ? 'No camera found on this computer.' : `The camera didn’t start (${err.message}).`;
    return false;
  }
}

function stopCamera() {
  for (const t of bz.stream?.getTracks() || []) t.stop();
  bz.stream = null;
  bz.video = null;
}

// Called by app.js when you switch to another tab.
function boothLeft() {
  if (!bz.shooting) stopCamera();
}

function cameraBox(filter) {
  const wrap = el('div', { className: 'bt-cam' });
  if (bz.cameraError) {
    wrap.append(el('p', { className: 'bt-cam-err', textContent: `📷 ${bz.cameraError}` }));
    const row = el('div', { className: 'bt-row' }, bbtn('Try again', 'small', () => renderBooth(true)));
    if (data.platform === 'darwin') row.append(bbtn('Open camera settings', 'small ghost', () => boothDo({ type: 'camera-settings' })));
    wrap.append(row);
    return wrap;
  }
  const video = el('video', { autoplay: true, muted: true, playsInline: true });
  video.style.filter = FILTER_INFO[filter]?.css || 'none';
  if (bz.stream) video.srcObject = bz.stream;
  bz.video = video;
  // The part of the picture that ends up in your half of each shot.
  wrap.append(video, el('div', { className: 'bt-guide' }), el('div', { className: 'bt-count', id: 'bt-count' }), el('div', { className: 'bt-flash', id: 'bt-flash' }));
  return wrap;
}

// One photo from the camera: the middle 3:4 of the picture, mirrored like the preview, as a JPEG.
function grab() {
  const v = bz.video;
  if (!v || !v.videoWidth) return null;
  const sh = v.videoHeight;
  const sw = Math.min(v.videoWidth, Math.round(sh * 0.75));
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 960;
  const g = c.getContext('2d');
  g.translate(720, 0);
  g.scale(-1, 1);
  g.drawImage(v, (v.videoWidth - sw) / 2, 0, sw, sh, 0, 0, 720, 960);
  return c.toDataURL('image/jpeg', 0.9);
}

// ---------- sounds (made here, no files) ----------

let audioCtx = null;
function beep(freq, ms, gain = 0.08) {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator();
    const gn = audioCtx.createGain();
    o.frequency.value = freq;
    gn.gain.setValueAtTime(gain, audioCtx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    o.connect(gn).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000);
  } catch {
    /* no sound is fine */
  }
}
function shutter() {
  try {
    audioCtx ||= new AudioContext();
    const len = Math.round(audioCtx.sampleRate * 0.12);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const gn = audioCtx.createGain();
    gn.gain.value = 0.35;
    src.connect(gn).connect(audioCtx.destination);
    src.start();
  } catch {
    /* no sound is fine */
  }
}

// ---------- shooting ----------

// times: when each of the four shots fires (this computer's clock). Shows the prompt, counts down, flashes.
function runShots(s, times, who) {
  clearShotTimers();
  bz.shooting = true;
  bz.shots = [];
  const prompts = s.settings.prompts || [];
  const at = (t, fn) => bz.timers.push(setTimeout(fn, Math.max(0, t - Date.now())));
  times.forEach((t, i) => {
    at(t - SHOT_GAP + 1500, () => showPrompt(i, prompts[i]));
    for (const n of [3, 2, 1])
      at(t - n * 1000, () => {
        const c = $('bt-count');
        if (c) {
          c.textContent = n;
          c.classList.remove('pop');
          void c.offsetWidth;
          c.classList.add('pop');
        }
        beep(n === 1 ? 880 : 660, 120);
      });
    at(t, () => {
      const shot = grab();
      shutter();
      const f = $('bt-flash');
      if (f) {
        f.classList.remove('go');
        void f.offsetWidth;
        f.classList.add('go');
      }
      const c = $('bt-count');
      if (c) c.textContent = '';
      bz.shots[i] = shot;
      const thumbs = $('bt-thumbs');
      if (thumbs && shot) thumbs.children[i]?.replaceChildren(el('img', { src: shot, alt: '' }));
      if (i === times.length - 1) finishShots(s, who);
    });
  });
}

function showPrompt(i, text) {
  const p = $('bt-prompt');
  if (p) p.textContent = `Shot ${i + 1} of 4${text ? ` · ${text}` : ''}`;
}

function clearShotTimers() {
  for (const t of bz.timers) clearTimeout(t);
  bz.timers = [];
}

async function finishShots(s, who) {
  bz.shooting = false;
  const images = bz.shots;
  if (images.filter(Boolean).length !== 4) {
    toast('The camera missed a shot. Try that round again.');
    renderBooth(true);
    return;
  }
  const r = await boothDo({ type: 'shots', sid: s.sid, images, who });
  if (r?.ok === false) return renderBooth(true);
  if (isTest(s) && who === 'me') bz.round = 'them';
  else stopCamera();
  bz.shots = [];
  renderBooth(true);
}

// ---------- screens ----------

function boothHeader(title, sub, back = true) {
  const h = el('div', { className: 'bt-head' });
  if (back) h.append(bbtn('‹ Booth', 'small ghost bt-back', () => openVisit('')));
  h.append(el('div', {}, el('h2', { textContent: title }), sub ? el('p', { className: 'hint', textContent: sub }) : ''));
  return h;
}

function openVisit(sid) {
  if (bz.shooting) return;
  clearShotTimers();
  bz.sid = sid;
  bz.round = 'me';
  bz.flipped = false;
  bz.saved = '';
  bz.pending = {};
  renderBooth(true);
}

function homeScreen() {
  const v = boothView;
  const root = el('div', { className: 'bt-home' });
  root.append(
    el(
      'div',
      { className: 'bt-sign' },
      el('div', { className: 'bt-bulbs' }),
      el('b', { textContent: 'BEARLY BOOTH' }),
      el('small', { textContent: v.open ? 'open today only 📸' : v.canShoot ? 'tester mode: open for testing' : 'closed: your strips are below' }),
    ),
  );
  if (v.canShoot) {
    const them = partner();
    const card = el('div', { className: 'card bt-start' });
    card.append(
      bbtn(`📸 Invite ${them} into the booth`, 'bt-big', () => start('together'), !data.config.partner.id),
      el('p', { className: 'hint', textContent: `You both get ready, then the countdown runs on both computers at the same moment. Each shot is you on one side and ${them} on the other.` }),
      bbtn('🕰️ Take my half now', 'ghost', () => start('own'), !data.config.partner.id),
      el('p', { className: 'hint', textContent: `No need to be there at the same time: you take your four, ${them} takes theirs later, and the strip develops when both halves are in.` }),
      bbtn('🧪 Test mode (just me)', 'ghost', () => start('test')),
      el('p', { className: 'hint', textContent: 'Take both halves yourself to try the designs and filters. Nothing is sent.' }),
    );
    root.append(card);
  }
  const waiting = v.sessions.filter((s) => s.status !== 'done' && !['declined', 'cancelled'].includes(s.status));
  if (waiting.length) {
    const card = el('div', { className: 'card' }, el('h2', { textContent: 'In progress' }));
    for (const s of waiting) card.append(visitRow(s));
    root.append(card);
  }
  const done = v.sessions.filter((s) => s.status === 'done');
  const album = el('div', { className: 'card' }, el('h2', { textContent: `Your strips${done.length ? ` (${done.length})` : ''}` }));
  if (!done.length) album.append(el('p', { className: 'hint', textContent: 'Finished strips stay here, even after the booth closes.' }));
  const grid = el('div', { className: 'bt-album' });
  for (const s of done) grid.append(albumTile(s));
  album.append(grid);
  root.append(album);
  return root;
}

function visitRow(s) {
  const them = partner();
  const text =
    s.status === 'invited' && !s.iHost
      ? s.mode === 'own'
        ? `${them} started a strip. Take your half!`
        : `${them} invited you into the booth`
      : s.status === 'invited'
        ? s.mode === 'own'
          ? s.mine === 4
            ? `Your half is in. Waiting for ${them}…`
            : 'Your half is waiting to be taken'
          : `Waiting for ${them} to come in…`
        : s.mode === 'test'
          ? 'Test strip, not finished'
          : s.mine === 4
            ? `Developing… waiting for ${them}’s half`
            : 'Your turn in the booth';
  return el('div', { className: 'bt-visit' }, el('span', { textContent: `${s.mode === 'test' ? '🧪' : '📸'} ${text}` }), bbtn('Open', 'small', () => openVisit(s.sid)));
}

function albumTile(s) {
  const c = el('canvas', { className: 'bt-thumb' });
  const tile = el('button', { className: 'bt-tile', onclick: () => openVisit(s.sid) }, c, el('small', { textContent: `${s.mode === 'test' ? '🧪 ' : ''}${new Date(s.doneAt || s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` }));
  photosFor(s).then((p) => drawStrip(c, { ...stripOptions(s, p) }));
  return tile;
}

async function start(mode) {
  const r = await boothDo({ type: 'start', mode });
  if (r?.ok) {
    bz.sid = r.sid;
    bz.round = 'me';
    boothView = await window.ba.boothGet();
    renderBooth(true);
  }
}

// The look and the words, shared by the setup screen and the finished strip.
function optionsPanel(s, { compact = false } = {}) {
  const st = { ...s.settings, ...bz.pending };
  const box = el('div', { className: 'bt-options' });
  const chips = (list, info, key) => {
    const row = el('div', { className: 'bt-chips' });
    for (const k of list) {
      const b = el('button', { className: `bt-chip${(st[key] ?? list[0]) === k ? ' on' : ''}`, textContent: info[k].label, onclick: () => setSetting({ [key]: k }, { now: true }) || renderBooth(true) });
      row.append(b);
    }
    return row;
  };
  box.append(el('label', { textContent: 'Strip design' }), chips(Object.keys(DESIGN_INFO), DESIGN_INFO, 'design'));
  box.append(el('label', { textContent: 'Filter' }), chips(Object.keys(FILTER_INFO), FILTER_INFO, 'filter'));
  const swatches = el('div', { className: 'bt-swatches' });
  for (const [k, c] of Object.entries(COLOR_INFO)) {
    const b = el('button', { className: `bt-swatch${(st.color || 'auto') === k ? ' on' : ''}${k === 'auto' ? ' auto' : ''}`, title: c.label, onclick: () => setSetting({ color: k }, { now: true }) || renderBooth(true) });
    if (c.paper) b.style.background = `linear-gradient(135deg, ${c.paper} 55%, ${c.pop} 55%)`;
    swatches.append(b);
  }
  box.append(el('label', { textContent: `Strip colour: ${COLOR_INFO[st.color || 'auto'].label}` }), swatches);
  box.append(el('label', { textContent: 'Holiday decorations' }), chips(Object.keys(DECO_INFO), DECO_INFO, 'deco'));
  const occasion = el('input', { value: st.occasion || '', placeholder: 'e.g. Happy anniversary ♡', maxLength: 60, oninput: () => setSetting({ occasion: occasion.value }) });
  box.append(el('label', { textContent: 'Words at the bottom' }), occasion);
  const sd = sides(s);
  const placeInput = (id) => {
    const zone = boothView.zones[id] || '';
    const i = el('input', { value: st.places?.[id] ?? '', placeholder: cityName(zone) || 'where you are', maxLength: 30, oninput: () => setSetting({ places: { ...st.places, [id]: i.value } }) });
    return el('div', {}, el('label', { textContent: `Where ${nameOfId(id)} is` }), i);
  };
  box.append(el('div', { className: 'row' }, placeInput(sd.left), placeInput(sd.right)));
  const toggle = (key, text) => el('label', { className: 'check' }, el('input', { type: 'checkbox', checked: st[key] !== false, onchange: (e) => setSetting({ [key]: e.target.checked }, { now: true }) }), text);
  box.append(el('div', { className: 'bt-toggles' }, toggle('tags', 'Name tags (whose side)'), toggle('bears', 'Tiny Bubu & Dudu'), toggle('times', 'Both local times'), toggle('stamp', 'Date stamp')));
  if (!compact) {
    const det = el('details', { className: 'bt-more' }, el('summary', { textContent: 'Pose prompts' }));
    (st.prompts || []).forEach((p, i) => {
      const inp = el('input', { value: p, maxLength: 80, oninput: () => setSetting({ prompts: (st.prompts || []).map((q, k) => (k === i ? inp.value : q)) }) });
      det.append(el('label', { textContent: `Shot ${i + 1}` }), inp);
    });
    box.append(det);
  }
  box.append(extrasPanel(s, st));
  return box;
}

function extrasPanel(s, st) {
  const det = el('details', { className: 'bt-more' }, el('summary', { textContent: '💝 Then & now, and a note on the back' }));
  const file = el('input', { type: 'file', accept: 'image/*', hidden: true });
  file.onchange = async () => {
    const f = file.files[0];
    if (!f) return;
    const image = await shrinkPhoto(f);
    if (image) await boothDo({ type: 'then', sid: s.sid, image });
  };
  det.append(
    el('p', { className: 'hint', textContent: 'Then & now: an old photo of you two together becomes a fifth frame at the bottom of the strip.' }),
    el('div', { className: 'bt-row' }, bbtn(s.hasThen ? 'Change the photo' : 'Pick a photo…', 'small', () => file.click()), s.hasThen ? bbtn('Remove it', 'small ghost', () => boothDo({ type: 'then', sid: s.sid, image: null })) : '', file),
  );
  const note = el('textarea', { rows: 3, maxLength: 500, value: st.note || '', placeholder: 'Written on the back of the strip…' });
  note.oninput = () => setSetting({ note: note.value, noteBy: data.config.me.id });
  det.append(el('label', { textContent: 'Note on the back' }), note);
  return det;
}

// A picked photo, made small enough to send: the long side at most 1400 px.
function shrinkPhoto(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = el('canvas', { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('That picture couldn’t be opened.');
      resolve(null);
    };
    img.src = url;
  });
}

// Getting ready: the camera, the look, and the button that starts things.
function lobbyScreen(s) {
  const them = partner();
  const test = isTest(s);
  const st = { ...s.settings, ...bz.pending };
  const title = test ? (bz.round === 'me' ? 'Test: your half' : `Test: now be ${them}`) : s.mode === 'own' ? 'Take your half' : 'Get ready';
  const sub = test
    ? bz.round === 'me'
      ? 'Four shots of you first. Then you take four more as the other half.'
      : 'Same again, as the other side of the strip. Your first four are shown next to you.'
    : s.mode === 'own'
      ? `Four shots of you. ${them} takes theirs whenever they like.`
      : `Pick the look together. When you’re both ready, the countdown starts on both screens.`;
  const root = el('div', { className: 'bt-lobby' }, boothHeader(title, sub));
  root.append(cameraBox(st.filter), sideNote(s, test ? bz.round : 'me'));
  const actions = el('div', { className: 'bt-actions' });
  if (s.mode === 'together') {
    const iReady = !!s.ready[data.config.me.id];
    const theyReady = !!s.ready[test ? '' : s.iHost ? s.guest : s.host];
    actions.append(
      bbtn(iReady ? '✓ Ready! (tap to wait)' : 'I’m ready', iReady ? 'bt-big ghost' : 'bt-big', () => boothDo({ type: 'ready', sid: s.sid, on: !iReady })),
      el('p', { className: 'hint', textContent: theyReady ? `${them} is ready ✓` : `${them} isn’t ready yet` }),
      bbtn('Leave the booth', 'small ghost', async () => (await boothDo({ type: 'cancel', sid: s.sid })) && openVisit('')),
    );
  } else {
    actions.append(
      bbtn(test ? (bz.round === 'me' ? 'Start: 4 shots of me' : `Start: 4 shots as ${them}`) : 'Start: 4 shots', 'bt-big', () => {
        if (!bz.stream) return toast('The camera isn’t on yet.');
        renderShootScreen(s, [0, 1, 2, 3].map((i) => Date.now() + SHOT_LEAD + i * SHOT_GAP), test ? bz.round : 'me');
      }),
    );
  }
  root.append(actions, optionsPanel(s));
  return root;
}

function renderShootScreen(s, times, who) {
  const root = $('booth-root');
  const st = { ...s.settings, ...bz.pending };
  const screen = el('div', { className: 'bt-shoot' }, el('div', { className: 'bt-prompt', id: 'bt-prompt', textContent: 'Get ready…' }));
  const cam = cameraBox(st.filter);
  const side = sideOf(s, isTest(s) && who === 'them' ? s.guest : data.config.me.id);
  cam.append(el('div', { className: `bt-you ${side}`, textContent: side === 'left' ? '◀ your side: left' : 'your side: right ▶' }));
  // In the test's second round, your first four sit next to the camera so you can pose against them.
  if (isTest(s) && who === 'them') {
    const first = el('img', { className: 'bt-ghost', id: 'bt-ghost', alt: '' });
    first.style.filter = FILTER_INFO[st.filter]?.css || 'none';
    cam.classList.add('with-ghost');
    cam.prepend(first);
    photosFor(s).then((p) => {
      const mine = p[data.config.me.id] || [];
      first.src = mine[0] || '';
      times.forEach((t, i) => bz.timers.push(setTimeout(() => (first.src = mine[i] || first.src), Math.max(0, t - SHOT_GAP + 1500 - Date.now()))));
    });
    if (sides(s).left !== data.config.me.id) cam.classList.add('ghost-right');
  }
  screen.append(cam, el('div', { className: 'bt-thumbs', id: 'bt-thumbs' }, ...[0, 1, 2, 3].map(() => el('div', { className: 'bt-slot' }))));
  root.replaceChildren(screen);
  runShots(s, times, who);
}

function waitingScreen(s, text) {
  const root = el('div', { className: 'bt-wait' }, boothHeader('Developing…', text));
  root.append(slotArt());
  if (s.status === 'invited' && s.iHost && s.mode === 'together') root.append(bbtn('Cancel the invite', 'small ghost', async () => (await boothDo({ type: 'cancel', sid: s.sid })) && openVisit('')));
  return root;
}

function slotArt(strip) {
  const bear = data.config.me.character;
  const other = bear === 'brown' ? 'cream' : 'brown';
  const box = el('div', { className: 'bt-slotbox' }, el('div', { className: 'bt-slotbar' }));
  if (strip) box.append(strip);
  else box.append(el('div', { className: 'bt-dots', textContent: '• • •' }));
  if (bz.assets) box.append(el('img', { className: 'bt-push left', src: bz.assets[`wiggle-${bear}`] }), el('img', { className: 'bt-push right', src: bz.assets[`wiggle-${other}`] }));
  return box;
}

function inviteScreen(s) {
  const them = partner();
  const own = s.mode === 'own';
  const root = el('div', { className: 'bt-invite' }, boothHeader(own ? `${them} started a strip` : `${them} is in the booth`, own ? 'They took (or will take) their four shots. Take yours whenever you like, and the strip develops once both halves are in.' : 'Come in: you pick the look together, then the countdown runs on both screens at once.'));
  root.append(
    el('div', { className: 'bt-row bt-center' }, bbtn(own ? '📸 Take my half' : '📸 Come in', 'bt-big', () => boothDo({ type: 'accept', sid: s.sid })), bbtn('Not now', 'ghost', async () => (await boothDo({ type: 'decline', sid: s.sid })) && openVisit(''))),
  );
  return root;
}

// The finished strip: change the look, add stickers, flip it over, save it.
function studioScreen(s) {
  const root = el('div', { className: 'bt-studio' }, boothHeader(isTest(s) ? 'Your test strip' : 'Your photo strip', isTest(s) ? 'Try every design and filter. Stickers, the then & now photo and the note all show here.' : `${partner()} sees the same strip and the same changes.`));
  const stage = el('div', { className: 'bt-stage', id: 'bt-stage' });
  const canvas = el('canvas', { className: 'bt-strip', id: 'bt-strip' });
  const layer = el('div', { className: 'bt-layer', id: 'bt-layer' });
  stage.append(canvas, layer);
  stage.onclick = (e) => {
    if (e.target === layer || e.target === canvas) selectSticker(-1);
  };
  const side = el('div', { className: 'bt-side' });
  side.append(
    el(
      'div',
      { className: 'bt-row' },
      bbtn(bz.flipped ? '↺ Front' : '↻ Flip it over', 'small ghost', () => {
        bz.flipped = !bz.flipped;
        renderBooth(true);
      }),
      bbtn('⤢ Big', 'small ghost', () => {
        bz.big = true;
        renderBooth(true);
      }),
    ),
    stickerPalette(s),
    el('div', { className: 'bt-saves' }, bbtn('💾 Save strip', '', () => saveStrip(s, 'strip')), bbtn('🖨️ Save print sheet (4x6)', 'ghost', () => saveStrip(s, 'print')), bbtn('💌 Save the back', 'ghost', () => saveStrip(s, 'back'))),
  );
  if (bz.saved) side.append(el('p', { className: 'hint' }, 'Saved to Pictures › Bearly Apart. ', el('button', { className: 'link', textContent: 'Show it', onclick: () => boothDo({ type: 'show', file: bz.saved }) })));
  side.append(optionsPanel(s, { compact: true }));
  if (isTest(s)) side.append(el('div', { className: 'bt-row' }, bbtn('Shoot another test', 'small ghost', () => start('test')), bbtn('Delete this test', 'small ghost', async () => (await boothDo({ type: 'forget', sid: s.sid })) && openVisit(''))));
  const sd = sides(s);
  stage.append(el('div', { className: 'bt-whose' }, el('span', { textContent: `◀ ${nameOfId(sd.left)}` }), el('span', { textContent: `${nameOfId(sd.right)} ▶` })));
  root.append(el('div', { className: 'bt-studio-grid' }, stage, side));
  if (!s.seenStrip && !isTest(s)) boothDo({ type: 'seen', sid: s.sid });
  return root;
}

function stickerPalette(s) {
  const box = el('div', { className: 'bt-stickers' }, el('label', { textContent: 'Stickers ' }, el('small', { textContent: 'click to add · drag to move · scroll to resize · shift+scroll to turn · double-click to remove' })));
  const st = { ...s.settings, ...bz.pending };
  const pack = bz.pack || (STICKER_PACKS[st.deco] ? st.deco : 'cute');
  const tabs = el('div', { className: 'bt-chips bt-packs' });
  for (const [k, pk] of Object.entries(STICKER_PACKS))
    tabs.append(
      el('button', {
        className: `bt-chip${k === pack ? ' on' : ''}`,
        textContent: `${Object.values(pk.items)[0]} ${pk.label}`,
        onclick: () => {
          bz.pack = k;
          renderBooth(true);
        },
      }),
    );
  box.append(tabs);
  const row = el('div', { className: 'bt-palette' });
  for (const [k, e] of Object.entries(STICKER_PACKS[pack].items)) row.append(el('button', { className: 'bt-st', textContent: e, onclick: () => addSticker(s, k) }));
  const me = data.config.me.character;
  const other = me === 'brown' ? 'cream' : 'brown';
  for (const k of ['wiggle', 'happy', 'letter', 'dance', 'boba'].flatMap((p) => [`${p}-${me}`, `${p}-${other}`]).concat(['pair-cuddle', 'pair-hug', 'pair-together']))
    if (bz.assets?.[k]) row.append(el('button', { className: 'bt-st img', onclick: () => addSticker(s, k) }, el('img', { src: bz.assets[k], alt: '' })));
  box.append(row);
  return box;
}

let selected = -1;
function currentStickers(s) {
  return [...(bz.pending.stickers || s.settings.stickers || [])];
}
function addSticker(s, k) {
  const list = currentStickers(s);
  if (list.length >= 30) return toast('That’s a lot of stickers already!');
  list.push({ k, x: 0.5, y: 0.35 + Math.random() * 0.3, s: EMOJI_STICKERS[k] ? 0.12 : 0.2, r: Math.round(Math.random() * 30 - 15) });
  selected = list.length - 1;
  setSetting({ stickers: list });
  drawStickerLayer(s);
}
function selectSticker(i) {
  selected = i;
  for (const [k, n] of [...($('bt-layer')?.children || [])].entries()) n.classList.toggle('sel', k === i);
}

// Stickers sit on top of the strip as page elements while you place them, and are drawn into the picture on save.
function drawStickerLayer(s) {
  const layer = $('bt-layer');
  const canvas = $('bt-strip');
  if (!layer || !canvas) return;
  layer.hidden = bz.flipped;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  layer.replaceChildren();
  currentStickers(s).forEach((st, i) => {
    const size = st.s * W;
    const node = EMOJI_STICKERS[st.k] ? el('span', { className: 'bt-sticker', textContent: EMOJI_STICKERS[st.k] }) : el('img', { className: 'bt-sticker', src: bz.assets?.[st.k] || '', alt: '', draggable: false });
    node.style.left = `${st.x * W}px`;
    node.style.top = `${st.y * H}px`;
    node.style.width = `${size}px`;
    node.style.fontSize = `${size * 0.82}px`;
    node.style.transform = `translate(-50%, -50%) rotate(${st.r}deg)`;
    if (i === selected) node.classList.add('sel');
    node.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectSticker(i);
      node.setPointerCapture(e.pointerId);
      const box = layer.getBoundingClientRect();
      node.onpointermove = (m) => {
        const list = currentStickers(s);
        list[i] = { ...list[i], x: Math.max(0, Math.min(1, (m.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (m.clientY - box.top) / box.height)) };
        node.style.left = `${list[i].x * W}px`;
        node.style.top = `${list[i].y * H}px`;
        bz.pending.stickers = list;
      };
      node.onpointerup = () => {
        node.onpointermove = null;
        setSetting({ stickers: currentStickers(s) });
      };
    };
    node.onwheel = (e) => {
      e.preventDefault();
      const list = currentStickers(s);
      if (e.shiftKey) list[i] = { ...list[i], r: Math.max(-180, Math.min(180, list[i].r + Math.sign(e.deltaY) * 8)) };
      else list[i] = { ...list[i], s: Math.max(0.04, Math.min(0.6, list[i].s * (e.deltaY < 0 ? 1.08 : 0.93))) };
      setSetting({ stickers: list });
      drawStickerLayer(s);
    };
    node.ondblclick = () => {
      const list = currentStickers(s);
      list.splice(i, 1);
      selected = -1;
      setSetting({ stickers: list });
      drawStickerLayer(s);
    };
    layer.append(node);
  });
}

let previewTimer = 0;
function drawPreviewSoon() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(drawPreview, 120);
}

async function drawPreview() {
  const s = session();
  const canvas = $('bt-strip');
  if (!s || !canvas) return;
  const token = ++bz.renderToken;
  const photos = await photosFor(s);
  if (token !== bz.renderToken) return;
  const opts = stripOptions(s, photos);
  if (bz.flipped) drawBack(canvas, { settings: opts.settings, names: opts.names, when: opts.when, noteByName: nameOfId(opts.settings.noteBy) });
  else await drawStrip(canvas, { ...opts, stickers: false });
  if (token === bz.renderToken) drawStickerLayer(s);
}

async function saveStrip(s, kind) {
  const photos = await photosFor(s);
  const opts = stripOptions(s, photos);
  const day = new Date(opts.when).toISOString().slice(0, 10);
  const who = `${opts.names.left} & ${opts.names.right}`;
  let canvas = document.createElement('canvas');
  if (kind === 'back') drawBack(canvas, { settings: opts.settings, names: opts.names, when: opts.when, noteByName: nameOfId(opts.settings.noteBy) });
  else {
    await drawStrip(canvas, opts);
    if (kind === 'print') canvas = drawPrintSheet(canvas);
  }
  const name = `${kind === 'print' ? 'Print sheet' : kind === 'back' ? 'Strip back' : 'Photo strip'} - ${who} - ${day}${isTest(s) ? ' (test)' : ''}`;
  const r = await boothDo({ type: 'save', png: canvas.toDataURL('image/png'), name });
  if (r?.ok) {
    bz.saved = r.file;
    toast('Saved to Pictures › Bearly Apart 📸');
    renderBooth(true);
  }
}

// The strip slides out of the slot and the picture comes up, like a real booth.
function developScreen(s) {
  const root = el('div', { className: 'bt-wait' }, boothHeader('Developing…', 'Here it comes!'));
  const c = el('canvas', { className: 'bt-dev' });
  root.append(slotArt(c));
  photosFor(s).then(async (p) => {
    await drawStrip(c, stripOptions(s, p));
    c.classList.add('go');
    setTimeout(() => {
      bz.developed.add(s.sid);
      if (bz.sid === s.sid) renderBooth(true);
    }, 4600);
  });
  return root;
}

function bigScreen(s) {
  const root = el('div', { className: 'bt-bigview', onclick: () => ((bz.big = false), renderBooth(true)) });
  const c = el('canvas');
  root.append(c, el('small', { textContent: 'click anywhere to close' }));
  photosFor(s).then((p) => {
    const opts = stripOptions(s, p);
    if (bz.flipped) drawBack(c, { settings: opts.settings, names: opts.names, when: opts.when, noteByName: nameOfId(opts.settings.noteBy) });
    else drawStrip(c, opts);
  });
  return root;
}

// ---------- drawing the tab ----------

async function renderBooth(force) {
  const root = $('booth-root');
  if (!root || !document.querySelector('[data-page="booth"].on')) return;
  if (bz.shooting) return; // the countdown owns the screen
  if (!boothView) boothView = await window.ba.boothGet();
  if (!bz.assets) bz.assets = await window.ba.boothAssets();
  const s = session();
  if (bz.sid && !s) bz.sid = '';
  const key = JSON.stringify([bz.sid, bz.round, bz.flipped, bz.big, bz.saved, bz.cameraError, s && { ...s, settings: undefined }, s?.settings, boothView.open, boothView.canShoot, !s && boothView.sessions.map((x) => [x.sid, x.status, x.mine, x.theirs])]);
  if (!force && key === bz.lastKey) return;
  // On the finished strip only the picture needs redrawing when the settings change (keeps typing and stickers smooth).
  if (!force && s?.status === 'done' && bz.lastKey && JSON.parse(bz.lastKey)[0] === s.sid && $('bt-strip') && !bz.big) {
    bz.lastKey = key;
    return drawPreviewSoon();
  }
  bz.lastKey = key;

  let screen;
  let camera = false;
  if (!s) screen = homeScreen();
  else if (bz.big) screen = bigScreen(s);
  else if (s.status === 'done') screen = bz.developed.has(s.sid) || s.seenStrip ? studioScreen(s) : developScreen(s);
  else if (s.status === 'declined' || s.status === 'cancelled') screen = el('div', {}, boothHeader(s.status === 'declined' ? `${partner()} can’t right now` : 'This visit ended', 'Try again later 💕'));
  else if (s.status === 'invited' && !s.iHost) screen = inviteScreen(s);
  else if (s.mode === 'together' && s.status === 'invited') screen = waitingScreen(s, `Waiting for ${partner()} to come in…`);
  else if (s.mode === 'together' && s.status === 'shooting') {
    if (s.mine === 4) screen = waitingScreen(s, `Waiting for ${partner()}’s photos…`);
    else {
      await startCamera();
      // Opened too late for the shared countdown: shoot on this computer's own countdown instead.
      const late = !s.shotsAt.length || s.shotsAt[0] < Date.now() + 500;
      const times = late ? [0, 1, 2, 3].map((i) => Date.now() + SHOT_LEAD + i * SHOT_GAP) : s.shotsAt;
      if (late) toast('You missed the shared countdown, so this one is just for you.');
      return renderShootScreen(s, times, 'me');
    }
  } else if (s.status === 'developing' || (s.mode === 'own' && s.mine === 4)) screen = waitingScreen(s, `Waiting for ${partner()}’s half…`);
  else if (isTest(s) && s.mine === 4 && s.testThem === 4) screen = studioScreen(s);
  else {
    if (isTest(s) && s.mine === 4) bz.round = 'them';
    await startCamera();
    camera = true;
    screen = lobbyScreen(s);
  }
  if (!camera && !bz.shooting) stopCamera();
  root.replaceChildren(screen);
  if ($('bt-strip')) drawPreview();
}

window.ba.onBooth((view) => {
  boothView = view;
  // The shared countdown is starting: be on the Booth tab for it.
  const go = view.sessions.find((s) => s.status === 'shooting' && s.mine < 4 && s.sid === bz.sid);
  if (go && !document.querySelector('[data-page="booth"].on')) showTab('booth');
  renderBooth(false);
});
window.ba.onBoothNote((text) => toast(text));
window.addEventListener('resize', () => {
  const s = session();
  if (s && $('bt-layer')) drawStickerLayer(s);
});
// Opened straight onto this tab (see showTab in app.js).
if (document.querySelector('[data-page="booth"].on')) renderBooth(true);
