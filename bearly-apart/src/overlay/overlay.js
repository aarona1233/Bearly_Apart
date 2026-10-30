// Scene player. A scene is { caption?, sub?, actors: [{ asset, size, at: [x, y], steps: [...] }] }.
// Positions are an actor's feet: x = horizontal center, y = bottom edge. See docs/SCENES.md.
const stage = document.getElementById('stage');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIDEO = /\.(webm|mp4|mov)$/i;

let W = window.innerWidth;
let H = window.innerHeight;
let WIN = null; // front window rect (overlay coords)
let SCALE = 1;
let VARS = {};
let pending = []; // background work (stamps, rain, captions) the scene must outlive
let hoverCount = 0;

function fill(str) {
  return String(str ?? '').replace(/\{(\w+)\}/g, (_, k) => VARS[k] ?? '');
}

function assetUrl(src) {
  const name = fill(src);
  if (/^(data|ba):/.test(name)) return name;
  return `ba://asset/${encodeURIComponent(name)}`;
}

function media(src) {
  const url = assetUrl(src);
  let el;
  if (VIDEO.test(fill(src))) {
    el = document.createElement('video');
    Object.assign(el, { src: url, autoplay: true, loop: true, muted: true, playsInline: true });
  } else {
    el = document.createElement('img');
    el.src = url;
  }
  el.draggable = false;
  return el;
}

function rel(v, base, size) {
  // "center+40", "win.left-20", "30%", 120
  if (typeof v === 'number') return v * SCALE;
  // Lazy base so names containing "-" ("left-off") still parse; a trailing ±number is an offset.
  const m = String(v).trim().match(/^(.*?)([+-]\d+(?:\.\d+)?)?$/);
  const off = m[2] ? parseFloat(m[2]) * SCALE : 0;
  return base(m[1], size) + off;
}

function baseX(k, size) {
  const w = WIN;
  if (k.endsWith('%')) return (W * parseFloat(k)) / 100;
  return (
    {
      'left-off': -size * 0.6,
      'right-off': W + size * 0.6,
      left: size * 0.6 + 16,
      right: W - size * 0.6 - 16,
      center: W / 2,
      'win.left': w.x + size * 0.5,
      'win.right': w.x + w.width - size * 0.5,
      'win.center': w.x + w.width / 2,
    }[k] ?? 0
  );
}

function baseY(k, size) {
  const w = WIN;
  if (k.endsWith('%')) return (H * parseFloat(k)) / 100;
  return (
    {
      'off-bottom': H + size * 1.05,
      bottom: H - 8,
      top: size + 12,
      'off-top': -12,
      center: H / 2 + size / 2,
      'win.top': w.y + size * 0.1,
      'win.bottom': w.y + w.height,
      'win.center': w.y + w.height / 2 + size / 2,
    }[k] ?? 0
  );
}

class Actor {
  constructor(def) {
    this.def = def;
    this.size = (def.size || 160) * SCALE;
    this.facing = def.face || 'right';
    this.el = document.createElement('div');
    this.el.className = 'actor';
    this.el.style.width = this.el.style.height = `${this.size}px`;
    this.zoom = document.createElement('div');
    this.zoom.className = 'zoom';
    this.face = document.createElement('div');
    this.face.className = 'face';
    this.bob = document.createElement('div');
    this.bob.className = 'bob';
    this.zoom.style.width = this.face.style.width = this.bob.style.width = '100%';
    this.zoom.style.height = this.face.style.height = this.bob.style.height = '100%';
    this.media = media(def.asset);
    this.bob.append(this.media);
    this.face.append(this.bob);
    this.zoom.append(this.face);
    this.el.append(this.zoom);
    this.scale = 1;
    const [x, y] = def.at || ['left-off', 'bottom'];
    this.x = rel(x, baseX, this.size);
    this.y = rel(y, baseY, this.size);
    this.place();
    if (def.hidden) this.el.style.opacity = '0';
    if (def.frame) this.el.classList.add('framed');
    if (def.pokeable) {
      this.el.classList.add('pokeable');
      this.el.addEventListener('mouseenter', () => window.ba.setClickable(++hoverCount > 0));
      this.el.addEventListener('mouseleave', () => window.ba.setClickable(--hoverCount > 0));
      this.el.addEventListener('click', () => this.poked());
    }
    this.setFacing(this.facing);
    stage.append(this.el);
  }

  transform(x = this.x, y = this.y) {
    return `translate(${x - this.size / 2}px, ${y - this.size}px)`;
  }
  place() {
    this.el.style.transform = this.transform();
  }
  setFacing(dir) {
    this.facing = dir;
    // Art faces right by default; "faces": "left" in the scene flips that assumption.
    const flip = (dir === 'left') !== (this.def.faces === 'left');
    this.face.classList.toggle('left', flip);
  }

  async poked() {
    if (this.wasPoked) return;
    this.wasPoked = true;
    window.ba.poke();
    this.say({ text: 'hehe 💕', ms: 1200 });
    const r = this.el.getBoundingClientRect();
    stampAt('heart.svg', r.left + r.width / 2, r.top + r.height * 0.2, 70, 1200);
    await this.bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-30%)' }, { transform: 'translateY(0)' }], { duration: 380, easing: 'ease-out' }).finished;
  }

  say({ text, ms = 2500 }) {
    const t = fill(text);
    if (!t.trim()) return;
    this.el.querySelector('.bubble')?.remove();
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = t;
    b.style.fontSize = `${Math.max(14, 19 * SCALE)}px`;
    this.el.append(b);
    pending.push(
      sleep(ms).then(async () => {
        b.classList.add('out');
        await sleep(400);
        b.remove();
      }),
    );
  }

  async step(s) {
    switch (s.do) {
      case 'move': {
        const nx = s.x !== undefined ? rel(s.x, baseX, this.size) : this.x;
        const ny = s.y !== undefined ? rel(s.y, baseY, this.size) : this.y;
        if (!s.noflip && Math.abs(nx - this.x) > 2) this.setFacing(nx < this.x ? 'left' : 'right');
        if (s.hop !== false) this.bob.classList.add('hopping');
        const from = this.transform();
        const to = this.transform(nx, ny);
        const sx = this.x;
        const sy = this.y;
        this.x = nx;
        this.y = ny;
        this.place();
        if (s.scratch) scratch(sx, sy, nx, ny, s.ms, this.size);
        await this.el.animate([{ transform: from }, { transform: to }], { duration: s.ms || 1000, easing: s.ease || 'linear' }).finished;
        this.bob.classList.remove('hopping');
        return;
      }
      case 'asset': {
        const m = media(s.src);
        this.media.replaceWith(m);
        this.media = m;
        return;
      }
      case 'face':
        return this.setFacing(s.dir);
      case 'zoom': {
        const from = this.scale;
        this.scale = s.scale;
        this.zoom.style.transform = `scale(${s.scale})`;
        await this.zoom.animate([{ transform: `scale(${from})` }, { transform: `scale(${s.scale})` }], { duration: s.ms || 400, easing: s.ease || 'ease-in-out' }).finished;
        return;
      }
      case 'wait':
        return sleep(s.ms || 500);
      case 'say':
        this.say(s);
        if (s.block) await sleep(s.ms || 2500);
        return;
      case 'stamp': {
        const r = this.media.getBoundingClientRect();
        const cx = s.at === 'center' ? W / 2 : r.left + r.width / 2;
        const cy = s.at === 'center' ? H / 2 : r.top + r.height * (s.atY ?? 0.45);
        stampAt(s.src, cx, cy, (s.size || 200) * SCALE, s.life || 3000, s.rotate);
        return;
      }
      case 'shake':
        await this.bob.animate(
          [{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(0)' }],
          { duration: 300, iterations: Math.max(1, Math.round((s.ms || 1200) / 300)) },
        ).finished;
        return;
      case 'jump': {
        const h = (s.height || 0.4) * 100;
        await this.bob.animate([{ transform: 'translateY(0)' }, { transform: `translateY(-${h}%)` }, { transform: 'translateY(0)' }], {
          duration: s.ms || 450,
          iterations: s.times || 1,
          easing: 'ease-in-out',
        }).finished;
        return;
      }
      case 'show':
        await this.el.animate([{ opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1 }], { duration: s.ms || 350, easing: 'cubic-bezier(.3,1.5,.5,1)' }).finished;
        this.el.style.opacity = '1';
        return;
      case 'fade':
        await this.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: s.ms || 500, fill: 'forwards' }).finished;
        this.el.style.opacity = '0';
        return;
      case 'rain':
        return rain(s);
      case 'card':
        return card(s);
      case 'haunt':
        return this.haunt(s);
      case 'candy-game':
        return candyGame(this, s);
      default:
        console.warn('unknown step', s);
    }
  }

  // Floats to s.to on a wavy path, tilting and flickering like a ghost. s.boo: something it says on the way.
  async haunt(s) {
    const tx = rel(s.to, baseX, this.size);
    const amp = (s.amp ?? 50) * SCALE;
    const waves = s.waves ?? 2;
    const ms = s.ms || 7000;
    this.setFacing(tx < this.x ? 'left' : 'right');
    const path = [];
    const flicker = [];
    for (let i = 0, n = 60; i <= n; i++) {
      const t = i / n;
      const y = this.y + Math.sin(t * waves * Math.PI * 2) * amp;
      path.push({ transform: this.transform(this.x + (tx - this.x) * t, y) });
      // Tilt and flicker on the picture only, so a speech bubble stays upright and readable.
      flicker.push({ transform: `rotate(${(Math.sin(t * waves * Math.PI * 4) * 7).toFixed(1)}deg)`, opacity: 0.6 + 0.35 * Math.abs(Math.sin(i * 1.7)) });
    }
    if (s.boo) pending.push(sleep(ms * 0.35).then(() => this.say({ text: s.boo, ms: 1600 })));
    this.bob.animate(flicker, { duration: ms, easing: 'linear', fill: 'forwards' });
    await this.el.animate(path, { duration: ms, easing: 'linear', fill: 'forwards' }).finished;
    this.x = tx;
    this.place();
  }

  async runSteps() {
    for (const s of this.def.steps || []) {
      if (s.if && !fill(`{${s.if}}`).trim()) continue; // e.g. only show the note card if there is a note
      await this.step(s);
    }
  }
}

function stampAt(src, cx, cy, size, life, rotate) {
  const el = media(src);
  el.className = 'stamp';
  el.style.width = el.style.height = `${size}px`;
  const rot = rotate ?? Math.round(Math.random() * 30 - 15);
  el.style.transform = `translate(${cx - size / 2}px, ${cy - size / 2}px) rotate(${rot}deg)`;
  stage.append(el);
  el.animate([{ opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1 }], { duration: 220, easing: 'ease-out' });
  pending.push(
    sleep(life).then(async () => {
      await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: 'forwards' }).finished;
      el.remove();
    }),
  );
}

function scratch(x1, y1, x2, y2, ms, size) {
  // A claw-mark line that follows the sword tip (a bit behind and below the bear's feet).
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  const back = (x2 >= x1 ? -1 : 1) * size * 0.42;
  const dy = -size * 0.05;
  for (const [i, off] of [-6, 0, 6].entries()) {
    const p = document.createElementNS(ns, 'path');
    const jag = (t) => (Math.sin(t * 0.09 + i) * 3).toFixed(1);
    const n = 24;
    let d = '';
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = x1 + back + (x2 - x1) * t;
      const y = y1 + dy + off + (y2 - y1) * t + Number(jag(x));
      d += `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', i === 1 ? '#7a1f2b' : '#c0394b');
    p.setAttribute('stroke-width', i === 1 ? 4 : 2.5);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('opacity', '0.85');
    svg.append(p);
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: ms, easing: 'linear', fill: 'forwards' });
  }
  stage.prepend(svg);
  pending.push(
    sleep(ms + 2500).then(async () => {
      await svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1200, fill: 'forwards' }).finished;
      svg.remove();
    }),
  );
}

function rain({ src = 'heart.svg', count = 20, ms = 3500, size = 54, block = false }) {
  const jobs = [];
  for (let i = 0; i < count; i++) {
    const el = media(src);
    el.className = 'drop';
    const s = size * SCALE * (0.6 + Math.random() * 0.8);
    el.style.width = el.style.height = `${s}px`;
    const x = Math.random() * (W - s);
    const r0 = Math.random() * 60 - 30;
    const r1 = r0 + Math.random() * 120 - 60;
    stage.append(el);
    const delay = Math.random() * ms * 0.6;
    const dur = ms * (0.5 + Math.random() * 0.4);
    const a = el.animate(
      [
        { transform: `translate(${x}px, ${-s}px) rotate(${r0}deg)`, opacity: 1 },
        { transform: `translate(${x + Math.random() * 120 - 60}px, ${H + s}px) rotate(${r1}deg)`, opacity: 0.9 },
      ],
      { duration: dur, delay, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'both' },
    );
    jobs.push(a.finished.then(() => el.remove()));
  }
  const all = Promise.all(jobs);
  if (block) return all;
  pending.push(all);
}

function card({ text, ms = 9000 }) {
  const t = fill(text);
  if (!t.trim()) return;
  const el = document.createElement('div');
  el.className = 'card';
  el.textContent = t;
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'click to close';
  el.append(hint);
  stage.append(el);
  let close;
  const closed = new Promise((r) => (close = r));
  el.addEventListener('mouseenter', () => window.ba.setClickable(++hoverCount > 0));
  el.addEventListener('mouseleave', () => window.ba.setClickable(--hoverCount > 0));
  el.addEventListener('click', close);
  pending.push(
    Promise.race([sleep(ms), closed]).then(async () => {
      el.classList.add('out');
      await sleep(400);
      if (el.matches(':hover')) window.ba.setClickable(--hoverCount > 0);
      el.remove();
    }),
  );
}

// ---- Halloween: the candy game ------------------------------------------------------------------
// The bear holds out its jack-o'-lantern bucket and a candy floats beside it. Drag the candy close enough to the
// bucket and let go: it drops in and disappears under the rim, and the bear jumps for joy. Miss, and the candy
// falls away and the bear cries under its pumpkin hat, then holds the bucket out again with a different candy.
// Step: { do: 'candy-game', bucket: { x, y, w, h } (fractions of the picture), candies: [...], happy, sad,
//         idleMs (give up after no try for this long), maxMs }. bucket and candies come from halloween.json.
let lastCandy = -1;
let grabbing = false;
// A test game (tester section) logs every step to the app's log.
const dbg = (...parts) => VARS.debug && window.ba.debug(parts.map((p) => (typeof p === 'object' ? JSON.stringify(p) : p)).join(' '));
const box = (r) => r && { x: Math.round(r.x ?? r.left), y: Math.round(r.y ?? r.top), w: Math.round(r.w ?? r.width), h: Math.round(r.h ?? r.height) };
const clickable = () => window.ba.setClickable(grabbing || hoverCount > 0);

async function candyGame(actor, s) {
  const ask = actor.def.asset;
  const started = Date.now();
  let misses = 0;
  for (;;) {
    const result = await oneCandy(actor, s, misses);
    dbg('round result:', result, 'misses so far:', misses);
    if (result === 'in') {
      window.ba.candy({ given: true, misses });
      return celebrate(actor, s);
    }
    if (result === 'gave-up' || Date.now() - started > (s.maxMs || 150_000)) {
      window.ba.candy({ given: false, misses });
      actor.say({ text: 'maybe later… 🎃', ms: 2200 });
      return sleep(2000);
    }
    misses++;
    await sulk(actor, s);
    swapArt(actor, ask, true);
    actor.say({ text: 'one more try? 🥺', ms: 2200 });
  }
}

function swapArt(actor, src, framed) {
  const m = media(src);
  actor.media.replaceWith(m);
  actor.media = m;
  actor.el.classList.toggle('framed', framed);
}

// The bucket on screen, from its place in the picture (inside the white frame).
function bucketRect(actor, b) {
  const r = actor.media.getBoundingClientRect();
  const edge = parseFloat(getComputedStyle(actor.media).borderTopWidth) || 0;
  const x = r.left + edge;
  const y = r.top + edge;
  const w = r.width - 2 * edge;
  const h = r.height - 2 * edge;
  return { x: x + b.x * w, y: y + b.y * h, w: b.w * w, h: b.h * h };
}

async function oneCandy(actor, s, misses) {
  await actor.media.decode?.().catch(() => {});
  // A different candy from last time.
  const list = s.candies || [];
  let pick = Math.floor(Math.random() * list.length);
  if (list.length > 1 && pick === lastCandy) pick = (pick + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
  lastCandy = pick;

  const size = (s.candySize || 96) * SCALE;
  const card = actor.media.getBoundingClientRect();
  // Beside the bear, on the side with more room, about level with its middle.
  const leftSide = card.left > W - card.right;
  let x = Math.max(size, Math.min(W - size, leftSide ? card.left - size * 1.7 : card.right + size * 1.7));
  let y = Math.max(size, card.top + card.height * 0.45);

  const candy = media(list[pick]);
  candy.className = 'candy idle';
  candy.style.width = candy.style.height = `${size}px`;
  dbg('candy', list[pick], 'at', box({ x: x - size / 2, y: y - size / 2, w: size, h: size }), 'picture', box(card), 'bucket', box(bucketRect(actor, s.bucket)), 'screen', { W, H, scale: SCALE });
  const put = (k = 1, tilt = 0) => {
    candy.style.left = `${x - size / 2}px`;
    candy.style.top = `${y - size / 2}px`;
    candy.style.transform = `rotate(${tilt}deg) scale(${k})`;
  };
  put();
  stage.append(candy);
  candy.animate([{ opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1 }], { duration: 320, easing: 'cubic-bezier(.3,1.5,.5,1)' });

  let hint = null;
  if (!misses) {
    hint = document.createElement('div');
    hint.className = 'candy-hint';
    hint.textContent = 'drag me into the 🎃';
    hint.style.left = `${x}px`;
    hint.style.top = `${y + size * 0.62}px`;
    stage.append(hint);
  }
  // Glows round the bucket while a candy is held; brighter once letting go would drop it in.
  const ring = document.createElement('div');
  ring.className = 'bucket-ring';
  ring.hidden = true;
  stage.append(ring);

  const inRange = () => {
    const b = bucketRect(actor, s.bucket);
    const reach = Math.max(b.w * 0.95, 75 * SCALE);
    return Math.hypot(x - (b.x + b.w / 2), (y - b.y) * 1.2) < reach;
  };

  // The app watches the cursor over this spot and makes the window grabbable there (hover events alone aren't
  // reliable on Windows). Padded for the candy's float.
  window.ba.hotspots([{ x: x - size / 2 - 16, y: y - size / 2 - 28, w: size + 32, h: size + 44 }]);

  return new Promise((resolve) => {
    let hovered = false;
    let grab = null;
    const idle = setTimeout(() => finish('gave-up'), s.idleMs || 45_000);
    candy.addEventListener('mouseenter', (e) => {
      dbg('pointer over the candy at', e.clientX, e.clientY);
      hovered = true;
      hoverCount++;
      clickable();
    });
    candy.addEventListener('mouseleave', (e) => {
      dbg('pointer left the candy at', e.clientX, e.clientY, grabbing ? '(holding it)' : '');
      hovered = false;
      hoverCount = Math.max(0, hoverCount - 1);
      clickable();
    });
    const offCandy = (e) => e.target !== candy && dbg('click landed off the candy at', e.clientX, e.clientY, 'on', e.target.className || e.target.tagName);
    if (VARS.debug) window.addEventListener('mousedown', offCandy);
    candy.addEventListener('mousedown', (e) => {
      dbg('grabbed the candy at', e.clientX, e.clientY);
      e.preventDefault();
      clearTimeout(idle);
      grabbing = true;
      clickable();
      window.ba.hotspots([]); // held: the window keeps the mouse until it's let go
      grab = { dx: e.clientX - x, dy: e.clientY - y, lastX: e.clientX };
      candy.classList.replace('idle', 'held');
      hint?.remove();
      const b = bucketRect(actor, s.bucket);
      const d = Math.max(b.w * 1.5, 110 * SCALE);
      Object.assign(ring.style, { left: `${b.x + b.w / 2 - d / 2}px`, top: `${b.y - d / 2}px`, width: `${d}px`, height: `${d}px` });
      ring.hidden = false;
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', drop, { once: true });
    });

    function move(e) {
      x = e.clientX - grab.dx;
      y = e.clientY - grab.dy;
      const tilt = Math.max(-25, Math.min(25, (e.clientX - grab.lastX) * 1.5)); // swings a little as it's dragged
      grab.lastX = e.clientX;
      put(1.08, tilt);
      ring.classList.toggle('hot', inRange());
    }

    async function drop() {
      window.removeEventListener('mousemove', move);
      grabbing = false;
      ring.remove();
      candy.classList.remove('held');
      const hit = inRange();
      const b = bucketRect(actor, s.bucket);
      dbg('let go at', Math.round(x), Math.round(y), 'bucket rim', Math.round(b.x + b.w / 2), Math.round(b.y), 'distance', Math.round(Math.hypot(x - (b.x + b.w / 2), (y - b.y) * 1.2)), 'reach', Math.round(Math.max(b.w * 0.95, 75 * SCALE)), hit ? '→ in the bucket' : '→ missed');
      await (hit ? fallIn() : fallAway());
      finish(hit ? 'in' : 'miss');
    }

    // Into the bucket: over the rim, shrinking a little, then down behind the rim (cut off at the rim line).
    function fallIn() {
      const b = bucketRect(actor, s.bucket);
      const rimX = b.x + b.w / 2;
      const rimY = b.y + b.h * 0.12;
      const k = 0.55;
      const [x0, y0] = [x, y];
      const aboveY = rimY - (size * k) / 2;
      return new Promise((done) => {
        const t0 = performance.now();
        const frame = (now) => {
          const t = Math.min(1, (now - t0) / 650);
          let kk;
          if (t < 0.55) {
            const u = t / 0.55;
            const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
            x = x0 + (rimX - x0) * e;
            y = y0 + (aboveY - y0) * e - Math.sin(u * Math.PI) * 30 * SCALE; // a little arc
            kk = 1 + (k - 1) * e;
          } else {
            const u = (t - 0.55) / 0.45;
            x = rimX;
            y = aboveY + u * u * size * k * 1.2;
            kk = k;
          }
          put(kk);
          const below = y + (size * kk) / 2 - rimY;
          candy.style.clipPath = below > 0 ? `inset(0 0 ${Math.min(size, below / kk)}px 0)` : '';
          if (t < 1) requestAnimationFrame(frame);
          else done();
        };
        requestAnimationFrame(frame);
      }).then(() => {
        stampAt('sparkle.svg', rimX, rimY - 12 * SCALE, 70 * SCALE, 700);
        return actor.bob.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(3%)' }, { transform: 'translateY(0)' }], { duration: 260 }).finished;
      });
    }

    // Missed: it drops off the bottom of the screen, tumbling.
    function fallAway() {
      const dx = (Math.random() * 2 - 1) * 90 * SCALE;
      return candy.animate(
        [
          { left: `${x - size / 2}px`, top: `${y - size / 2}px`, transform: 'rotate(0deg)' },
          { left: `${x - size / 2 + dx}px`, top: `${H + size}px`, transform: `rotate(${dx > 0 ? 240 : -240}deg)` },
        ],
        { duration: 850, easing: 'cubic-bezier(.5,0,1,.6)', fill: 'forwards' },
      ).finished;
    }

    function finish(result) {
      if (result === 'gave-up') dbg('nobody grabbed the candy in time (', (s.idleMs || 45_000) / 1000, 's)');
      window.removeEventListener('mousedown', offCandy);
      clearTimeout(idle);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', drop);
      if (hovered) hoverCount = Math.max(0, hoverCount - 1);
      grabbing = false;
      clickable();
      window.ba.hotspots([]);
      candy.remove();
      hint?.remove();
      ring.remove();
      resolve(result);
    }
  });
}

// No candy: the bear cries under its pumpkin hat for a moment.
async function sulk(actor, s) {
  swapArt(actor, s.sad || 'cry-hat-{pc}.png', false);
  actor.say({ text: 'no candy?… 😭', ms: 2200 });
  await actor.step({ do: 'shake', ms: 900 });
  await sleep(1500);
}

// Candy! It jumps for joy in its pumpkin hat while candies rain down.
async function celebrate(actor, s) {
  swapArt(actor, s.happy || 'happy-hat-{pc}.png', false);
  actor.say({ text: 'yay, candy! thank you 🍬💕', ms: 2600 });
  const mix = [...(s.candies || [])].sort(() => Math.random() - 0.5).slice(0, 4);
  for (const src of mix) rain({ src, count: 3, ms: 3200, size: 64 });
  await actor.step({ do: 'jump', times: 3, height: 0.22, ms: 420 });
  await sleep(900);
}

function caption(main, sub, ms) {
  const m = fill(main);
  const s = fill(sub);
  if (!m.trim() && !s.trim()) return;
  const el = document.createElement('div');
  el.className = 'caption';
  el.textContent = m || s;
  if (m && s) {
    const small = document.createElement('small');
    small.textContent = s;
    el.append(small);
  }
  stage.append(el);
  pending.push(
    sleep(ms).then(async () => {
      el.classList.add('out');
      await sleep(400);
      el.remove();
    }),
  );
}

async function playScene(scene, vars, ctx) {
  W = ctx.width;
  H = ctx.height;
  SCALE = ctx.scale || 1;
  VARS = vars || {};
  // Without a known front window, pretend there's one in the middle of the screen.
  WIN = ctx.win || { x: W * 0.15, y: H * 0.3, width: W * 0.7, height: H * 0.5 };
  pending = [];
  hoverCount = 0;
  grabbing = false;
  stage.replaceChildren();
  const capText = vars.caption || scene.caption;
  caption(capText, scene.sub, scene.captionMs || 5000);
  const actors = (scene.actors || []).map((d) => new Actor(d));
  if (scene.rain) rain(scene.rain);
  await Promise.all(actors.map((a) => a.runSteps()));
  // Wait for stamps/captions/cards started along the way; new ones can be added while waiting.
  let n;
  do {
    n = pending.length;
    await Promise.all(pending);
  } while (pending.length !== n);
  stage.replaceChildren();
  window.ba.setClickable(false);
}

window.ba.onPlay(async ({ scene, vars, ctx }) => {
  try {
    await playScene(scene, vars, ctx);
  } catch (err) {
    console.error(err);
  }
  window.ba.done();
});
