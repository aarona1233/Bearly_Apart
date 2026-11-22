// The photo strip, drawn on a canvas: the design (paper, borders, decorations), the photos with their filter, the
// bears, the words and the stickers. Both apps draw it from the same photos and settings, and every random touch
// (grain, stars, snow) comes from the visit's id, so the strip comes out the same on both computers.
const STRIP_W = 1200;
const STRIP_H = 3600; // 2 x 6 inches at 600 dpi, the size of a real booth strip
const FONT = {
  script: '"Segoe Script","Snell Roundhand","Apple Chancery","Brush Script MT",cursive',
  hand: '"Segoe Print","Bradley Hand","Chalkboard SE","Comic Sans MS",cursive',
  sans: '"Segoe UI","SF Pro Rounded","Helvetica Neue",system-ui,sans-serif',
  mono: '"Consolas","Menlo","Courier New",monospace',
  emoji: '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif',
};
// The same names as EMOJI_STICKERS in main/booth.js, which lets only these through.
const STICKER_PACKS = {
  cute: { label: 'Cute', items: { heart: '❤️', hearts: '💕', bow: '🎀', boba: '🧋', paw: '🐾', honey: '🍯', star: '⭐', sparkle: '✨', flower: '🌸', kiss: '💋', snow: '❄️', cherry: '🍒' } },
  thanksgiving: { label: 'Thanksgiving', items: { turkey: '🦃', leaf: '🍂', maple: '🍁', pie: '🥧', corn: '🌽', drumstick: '🍗' } },
  christmas: { label: 'Christmas', items: { tree: '🎄', gift: '🎁', snowman: '⛄', bell: '🔔', reindeer: '🦌', cookie: '🍪', sock: '🧦', santa: '🎅' } },
  valentine: { label: 'Valentine’s', items: { cupid: '💘', heartbox: '💝', rose: '🌹', letterheart: '💌', chocolate: '🍫', sparkleheart: '💖' } },
  newyear: { label: 'New Year', items: { fireworks: '🎆', cheers: '🥂', party: '🎉', confetti: '🎊', clock: '🕛' } },
  halloween: { label: 'Halloween', items: { pumpkin: '🎃', ghost: '👻', bat: '🦇', candy: '🍬', web: '🕸️' } },
  birthday: { label: 'Birthday', items: { cake: '🎂', balloon: '🎈', present: '🎁', cupcake: '🧁' } },
  anniversary: { label: 'Anniversary', items: { ring: '💍', bouquet: '💐', champagne: '🍾', lovebirds: '🕊️' } },
};
const EMOJI_STICKERS = Object.assign({}, ...Object.values(STICKER_PACKS).map((p) => p.items));

// Strip colours. paper: the background; pop: a stronger shade for stripes, lines and night skies; ink/sub: the words.
const COLOR_INFO = {
  auto: { label: 'Design’s own' },
  cream: { label: 'Cream', paper: '#fbf7ee', pop: '#c9a27c', ink: '#3b2f2a', sub: '#7a675d' },
  blush: { label: 'Blush', paper: '#f9d9df', pop: '#e57f96', ink: '#7a2c3a', sub: '#a5566a' },
  peach: { label: 'Peach', paper: '#fde2cc', pop: '#ee9a66', ink: '#7a3e22', sub: '#a0613f' },
  butter: { label: 'Butter', paper: '#fbf0c4', pop: '#e0b93a', ink: '#5e4a12', sub: '#8a7232' },
  mint: { label: 'Mint', paper: '#d9f0e3', pop: '#5fae86', ink: '#24503b', sub: '#4a7a62' },
  sky: { label: 'Sky', paper: '#d8e8f8', pop: '#6c9ad2', ink: '#2a3c5e', sub: '#4f6a8f' },
  lavender: { label: 'Lavender', paper: '#e8dff6', pop: '#9c83d1', ink: '#46336c', sub: '#6c5a91' },
  kraft: { label: 'Kraft', paper: '#cfab82', pop: '#8a5a3b', ink: '#3b2a1c', sub: '#5e4630' },
  red: { label: 'Red', paper: '#b8323f', pop: '#e05a66', ink: '#fff4e0', sub: '#ffd9c2', dark: true },
  green: { label: 'Pine', paper: '#2c5a42', pop: '#4f9a72', ink: '#fff4e0', sub: '#cfe8d8', dark: true },
  navy: { label: 'Navy', paper: '#1f2a48', pop: '#4a5f94', ink: '#fff4e0', sub: '#c9cfe6', dark: true },
  black: { label: 'Black', paper: '#1b1517', pop: '#4a3a3e', ink: '#f3e1c4', sub: '#e8a24a', dark: true },
};

const DECO_INFO = {
  none: { label: 'None' },
  thanksgiving: { label: '🦃 Thanksgiving' },
  christmas: { label: '🎄 Christmas' },
  valentine: { label: '💘 Valentine’s' },
  newyear: { label: '🎆 New Year' },
  halloween: { label: '🎃 Halloween' },
  birthday: { label: '🎂 Birthday' },
  anniversary: { label: '💍 Anniversary' },
};
const FRAME_BEARS = ['wiggle', 'happy', 'letter']; // corner bears for shots 1-3; shot 4 gets both bears on the seam

const DESIGN_INFO = {
  classic: { label: 'Classic Booth' },
  picnic: { label: 'Bear Picnic' },
  film: { label: 'Film Negative' },
  letter: { label: 'Love Letter' },
  moon: { label: 'Same Moon' },
  snow: { label: 'First Snow' },
};
// css: a quick look-alike for the live camera; the strip itself uses the real filter below.
const FILTER_INFO = {
  bw: { label: 'Classic B&W', css: 'grayscale(1) contrast(1.15) brightness(1.03)' },
  warm: { label: 'Warm Film', css: 'sepia(.22) saturate(1.05) contrast(1.04) brightness(1.04)' },
  blush: { label: 'Bubu Blush', css: 'sepia(.15) hue-rotate(-18deg) saturate(.95) brightness(1.08) contrast(.95)' },
  cocoa: { label: 'Cocoa', css: 'grayscale(1) sepia(.75) contrast(1.08) brightness(1.02)' },
  fuji: { label: 'Cool Fuji', css: 'hue-rotate(-6deg) saturate(1.05) contrast(1.12)' },
  dreamy: { label: 'Dreamy', css: 'brightness(1.1) contrast(.88) saturate(.85) blur(.6px)' },
  natural: { label: 'Natural', css: 'none' },
};

// ---------- small helpers ----------

function seededRandom(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const imageCache = new Map();
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (!imageCache.has(src)) {
    imageCache.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      }),
    );
    if (imageCache.size > 120) imageCache.delete(imageCache.keys().next().value);
  }
  return imageCache.get(src);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

// Fills the box with the picture, cutting off whatever sticks out (like CSS object-fit: cover).
function drawCover(g, img, x, y, w, h) {
  const iw = img.width || img.naturalWidth;
  const ih = img.height || img.naturalHeight;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;
const toward = (h, to, t) => `rgb(${hexRgb(h).map((v) => Math.round(v + (to - v) * t)).join(',')})`;
const shade = (h, t) => toward(h, 0, t); // darker
const tint = (h, t) => toward(h, 255, t); // lighter

// ---------- making two webcams look like one booth ----------
// Her MacBook camera and your webcam see colour and light differently. Each photo is nudged toward neutral grey and a
// middle brightness first, part of the way, so the two halves of a shot sit together.
const balancedCache = new Map();
function balanced(img, key) {
  if (balancedCache.has(key)) return balancedCache.get(key);
  const c = makeCanvas(img.naturalWidth, img.naturalHeight);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  let r = 0, gr = 0, b = 0, n = 0;
  for (let i = 0; i < p.length; i += 64) (r += p[i]), (gr += p[i + 1]), (b += p[i + 2]), n++;
  r /= n;
  gr /= n;
  b /= n;
  const grey = (r + gr + b) / 3 || 1;
  const lum = 0.3 * r + 0.59 * gr + 0.11 * b || 1;
  const bright = Math.max(0.8, Math.min(1.45, 1 + (118 / lum - 1) * 0.6));
  const k = [1 + (grey / (r || 1) - 1) * 0.5, 1 + (grey / (gr || 1) - 1) * 0.5, 1 + (grey / (b || 1) - 1) * 0.5].map((v) => v * bright);
  for (let i = 0; i < p.length; i += 4) {
    p[i] = p[i] * k[0];
    p[i + 1] = p[i + 1] * k[1];
    p[i + 2] = p[i + 2] * k[2];
  }
  g.putImageData(d, 0, 0);
  balancedCache.set(key, c);
  if (balancedCache.size > 40) balancedCache.delete(balancedCache.keys().next().value);
  return c;
}

// ---------- filters (on one whole frame, so grain and vignette run across the seam) ----------

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const mix = (a, b, t) => a + (b - a) * t;

function applyFilter(c, name, rand) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = c;
  const d = g.getImageData(0, 0, w, h);
  const p = d.data;
  const f = FILTERS[name] || FILTERS.natural;
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const v = f.vignette ? 1 - f.vignette * Math.pow(Math.hypot(x - cx, y - cy) / maxR, 2.2) : 1;
      const grain = f.grain ? (rand() - 0.5) * f.grain : 0;
      const out = f.px(p[i], p[i + 1], p[i + 2]);
      p[i] = clamp255(out[0] * v + grain);
      p[i + 1] = clamp255(out[1] * v + grain);
      p[i + 2] = clamp255(out[2] * v + grain);
    }
  }
  g.putImageData(d, 0, 0);
  // A soft glow: a blurred copy laid on top with "screen", like light blooming on old film.
  if (f.glow) {
    const blur = makeCanvas(w, h);
    const bg = blur.getContext('2d');
    bg.filter = `blur(${f.glow.px}px)`;
    bg.drawImage(c, 0, 0);
    g.save();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = f.glow.alpha;
    g.drawImage(blur, 0, 0);
    g.restore();
  }
}

const sCurve = (v, amount) => {
  const x = v / 255;
  const s = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
  return 255 * mix(x, s, amount);
};
const lift = (v, by) => by + v * (1 - by / 255);
const lumOf = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
function saturate(r, g, b, s) {
  const l = lumOf(r, g, b);
  return [l + (r - l) * s, l + (g - l) * s, l + (b - l) * s];
}
function ramp(stops, t) {
  // stops: [[t, [r,g,b]], …] sorted by t
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [t0, c0] = stops[k - 1];
      const [t1, c1] = stops[k];
      const u = (t - t0) / (t1 - t0);
      return [mix(c0[0], c1[0], u), mix(c0[1], c1[1], u), mix(c0[2], c1[2], u)];
    }
  }
  return stops[stops.length - 1][1];
}
const COCOA = [
  [0, [52, 34, 26]],
  [0.45, [150, 98, 66]],
  [0.8, [226, 190, 150]],
  [1, [255, 244, 224]],
];

const FILTERS = {
  natural: { px: (r, g, b) => [sCurve(r, 0.1), sCurve(g, 0.1), sCurve(b, 0.1)], grain: 4 },
  bw: {
    px: (r, g, b) => {
      const l = lift(sCurve(lumOf(r, g, b), 0.35), 6);
      return [l, l, l];
    },
    grain: 18,
    vignette: 0.22,
  },
  warm: {
    px: (r, g, b) => {
      [r, g, b] = saturate(r * 1.06 + 6, g * 1.0 + 3, b * 0.86, 0.92);
      return [lift(sCurve(r, 0.15), 14), lift(sCurve(g, 0.15), 10), lift(sCurve(b, 0.15), 8)];
    },
    grain: 10,
    vignette: 0.28,
  },
  blush: {
    px: (r, g, b) => {
      [r, g, b] = saturate(r, g, b, 0.88);
      const t = 0.1 + 0.14 * (lumOf(r, g, b) / 255);
      return [lift(mix(r, 246, t), 20), lift(mix(g, 181, t), 16), lift(mix(b, 193, t), 18)];
    },
    grain: 6,
    vignette: 0.12,
    glow: { px: 14, alpha: 0.22 },
  },
  cocoa: {
    px: (r, g, b) => ramp(COCOA, sCurve(lumOf(r, g, b), 0.25) / 255),
    grain: 12,
    vignette: 0.25,
  },
  fuji: {
    px: (r, g, b) => {
      const l = lumOf(r, g, b) / 255;
      [r, g, b] = saturate(r, g, b, 1.06);
      return [sCurve(r - (1 - l) * 14 + l * 4, 0.3), sCurve(g + (1 - l) * 5, 0.3), sCurve(b + (1 - l) * 12 - l * 4, 0.3)];
    },
    grain: 8,
    vignette: 0.15,
  },
  dreamy: {
    px: (r, g, b) => {
      [r, g, b] = saturate(r, g, b, 0.82);
      return [lift(mix(r, 128, 0.08), 26) + 4, lift(mix(g, 128, 0.08), 24), lift(mix(b, 128, 0.08), 30) + 6];
    },
    grain: 5,
    glow: { px: 20, alpha: 0.32 },
  },
};

// One shot: your half and theirs side by side, meeting in the middle with a soft edge, then filtered together.
function shotCanvas(w, h, left, right, filter, rand) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  const half = w / 2;
  const feather = Math.round(w * 0.014);
  g.fillStyle = '#ccc';
  g.fillRect(0, 0, w, h);
  if (left) drawCover(g, left, 0, 0, half + feather, h);
  if (right) {
    const t = makeCanvas(half + feather, h);
    const tg = t.getContext('2d');
    drawCover(tg, right, 0, 0, half + feather, h);
    tg.globalCompositeOperation = 'destination-in';
    const grad = tg.createLinearGradient(0, 0, feather * 2, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    tg.fillStyle = grad;
    tg.fillRect(0, 0, t.width, h);
    g.drawImage(t, half - feather, 0);
  }
  applyFilter(c, filter, rand);
  return c;
}

function singleCanvas(w, h, img, filter, rand) {
  const c = makeCanvas(w, h);
  drawCover(c.getContext('2d'), img, 0, 0, w, h);
  applyFilter(c, filter, rand);
  return c;
}

// Stand-in photos for the preview before anyone has shot anything.
function placeholder(label, tone) {
  const c = makeCanvas(360, 480);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 480);
  grad.addColorStop(0, tone[0]);
  grad.addColorStop(1, tone[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 360, 480);
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.beginPath();
  g.arc(180, 200, 70, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(180, 430, 130, 120, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = 'rgba(60,40,30,.6)';
  g.font = `600 40px ${FONT.sans}`;
  g.textAlign = 'center';
  g.fillText(label, 180, 60);
  return c;
}

// ---------- designs ----------

const DESIGNS = {
  classic: {
    side: 70,
    top: 90,
    foot: 600,
    gap: 30,
    ink: '#3b2f2a',
    sub: '#7a675d',
    bg(g, rand, c) {
      g.fillStyle = c ? c.paper : '#fbf7ee';
      g.fillRect(0, 0, STRIP_W, STRIP_H);
    },
    texture: 'paper',
    colorInk: true,
    frame(g, r) {
      g.strokeStyle = 'rgba(59,47,42,.25)';
      g.lineWidth = 3;
      g.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
    },
  },
  picnic: {
    side: 80,
    top: 120,
    foot: 600,
    gap: 40,
    ink: '#5a2320',
    sub: '#8a4a3f',
    bg(g, rand, c) {
      g.fillStyle = c?.dark ? tint(c.paper, 0.85) : '#fff4e0';
      g.fillRect(0, 0, STRIP_W, STRIP_H);
      const step = 72;
      g.fillStyle = c ? rgba(c.dark ? c.paper : c.pop, 0.4) : 'rgba(217,83,79,.32)';
      for (let x = 0; x < STRIP_W; x += step * 2) g.fillRect(x, 0, step, STRIP_H);
      for (let y = 0; y < STRIP_H; y += step * 2) g.fillRect(0, y, STRIP_W, step);
    },
    frame(g, r) {
      g.save();
      g.shadowColor = 'rgba(80,30,20,.35)';
      g.shadowBlur = 18;
      g.shadowOffsetY = 6;
      g.fillStyle = '#fff';
      g.fillRect(r.x - 16, r.y - 16, r.w + 32, r.h + 32);
      g.restore();
    },
    behind: true,
    card: '#fffaf2',
    crown(g) {
      g.fillStyle = '#000';
      g.font = `64px ${FONT.emoji}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('🍯  🧺  🍯', STRIP_W / 2, 62);
    },
  },
  film: {
    side: 150,
    top: 110,
    foot: 600,
    gap: 44,
    ink: '#f3e1c4',
    sub: '#e8a24a',
    bg(g, rand, c) {
      g.fillStyle = c ? (c.dark ? c.paper : shade(c.pop, 0.62)) : '#2a1d16';
      g.fillRect(0, 0, STRIP_W, STRIP_H);
      g.fillStyle = '#f1e4cc';
      for (let y = 30; y < STRIP_H - 40; y += 96) {
        roundRect(g, 38, y, 62, 46, 10);
        g.fill();
        roundRect(g, STRIP_W - 100, y, 62, 46, 10);
        g.fill();
      }
      g.save();
      g.fillStyle = '#e8a24a';
      g.font = `bold 30px ${FONT.mono}`;
      for (let y = 220; y < STRIP_H - 200; y += 700) {
        g.save();
        g.translate(128, y);
        g.rotate(Math.PI / 2);
        g.fillText('BEARLY APART 400', 0, 0);
        g.restore();
        g.save();
        g.translate(STRIP_W - 116, y + 350);
        g.rotate(Math.PI / 2);
        g.fillText('▸ DUDU & BUBU', 0, 0);
        g.restore();
      }
      g.restore();
    },
    after(g, r, i) {
      g.fillStyle = '#e8a24a';
      g.font = `bold 28px ${FONT.mono}`;
      g.textAlign = 'left';
      g.fillText(`${i + 1}`, r.x, r.y - 12);
      g.textAlign = 'right';
      g.fillText(`${i + 1}A ▸`, r.x + r.w, r.y - 12);
    },
  },
  letter: {
    side: 80,
    top: 110,
    foot: 640,
    gap: 40,
    ink: '#7a2c3a',
    sub: '#a5566a',
    colorInk: true,
    bg(g, rand, c) {
      g.fillStyle = c ? c.paper : '#f9dbe1';
      g.fillRect(0, 0, STRIP_W, STRIP_H);
      g.strokeStyle = c ? rgba(c.dark ? '#ffffff' : c.pop, 0.22) : 'rgba(165,86,106,.18)';
      g.lineWidth = 3;
      for (let y = 60; y < STRIP_H; y += 54) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(STRIP_W, y);
        g.stroke();
      }
    },
    frame(g, r) {
      g.save();
      g.shadowColor = 'rgba(122,44,58,.3)';
      g.shadowBlur = 14;
      g.shadowOffsetY = 5;
      g.fillStyle = '#fffdfb';
      g.fillRect(r.x - 14, r.y - 14, r.w + 28, r.h + 28);
      g.restore();
    },
    behind: true,
    foot2(g, f) {
      // A wax seal with a heart in it.
      const x = STRIP_W / 2;
      const y = f.y + f.h - 70;
      g.fillStyle = '#b8323f';
      g.beginPath();
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        const rad = 62 + (k % 2 ? 5 : -2);
        g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
      }
      g.fill();
      g.fillStyle = '#8f2430';
      g.beginPath();
      g.arc(x, y, 44, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#e66a78';
      g.font = `bold 52px ${FONT.sans}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('♥', x, y + 2);
    },
  },
  moon: {
    side: 80,
    top: 260,
    foot: 600,
    gap: 40,
    ink: '#fff4e0',
    sub: '#c9cfe6',
    bg(g, rand, c) {
      const grad = g.createLinearGradient(0, 0, 0, STRIP_H);
      grad.addColorStop(0, c ? shade(c.pop, 0.82) : '#141a30');
      grad.addColorStop(1, c ? shade(c.pop, 0.55) : '#2f3b5c');
      g.fillStyle = grad;
      g.fillRect(0, 0, STRIP_W, STRIP_H);
      for (let k = 0; k < 260; k++) {
        g.fillStyle = `rgba(255,244,224,${0.35 + rand() * 0.6})`;
        g.beginPath();
        g.arc(rand() * STRIP_W, rand() * STRIP_H, 1 + rand() * 3.2, 0, Math.PI * 2);
        g.fill();
      }
      // One moon over both of you.
      g.save();
      g.shadowColor = 'rgba(255,230,170,.7)';
      g.shadowBlur = 50;
      g.fillStyle = '#ffe9b0';
      g.beginPath();
      g.arc(STRIP_W / 2, 125, 78, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.fillStyle = 'rgba(214,190,140,.55)';
      for (const [dx, dy, rr] of [[-22, -18, 14], [20, 12, 10], [-6, 30, 8]]) {
        g.beginPath();
        g.arc(STRIP_W / 2 + dx, 125 + dy, rr, 0, Math.PI * 2);
        g.fill();
      }
    },
    frame(g, r) {
      g.fillStyle = '#fff4e0';
      g.fillRect(r.x - 8, r.y - 8, r.w + 16, r.h + 16);
    },
    behind: true,
  },
  snow: {
    side: 80,
    top: 120,
    foot: 640,
    gap: 40,
    ink: '#2f3b5c',
    sub: '#4f6a8f',
    colorInk: true,
    bg(g, rand, c) {
      const grad = g.createLinearGradient(0, 0, 0, STRIP_H);
      grad.addColorStop(0, c ? tint(c.paper, c.dark ? 0.12 : 0.6) : '#f2f7fd');
      grad.addColorStop(1, c ? c.paper : '#d6e4f4');
      g.fillStyle = grad;
      g.fillRect(0, 0, STRIP_W, STRIP_H);
      g.strokeStyle = 'rgba(255,255,255,.95)';
      g.lineCap = 'round';
      for (let k = 0; k < 70; k++) {
        const x = rand() * STRIP_W;
        const y = rand() * STRIP_H;
        const s = 8 + rand() * 22;
        g.lineWidth = Math.max(2, s / 7);
        for (let a = 0; a < 6; a++) {
          const ang = (a / 6) * Math.PI * 2 + rand() * 0.2;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(ang) * s, y + Math.sin(ang) * s);
          g.stroke();
        }
      }
      // A row of little pines along the bottom.
      for (let x = -20; x < STRIP_W + 40; x += 90) {
        const hh = 120 + ((x * 7) % 60);
        g.fillStyle = (x / 90) % 2 ? '#3f7d5c' : '#2c5a42';
        g.beginPath();
        g.moveTo(x, STRIP_H);
        g.lineTo(x + 50, STRIP_H - hh);
        g.lineTo(x + 100, STRIP_H);
        g.fill();
      }
    },
    frame(g, r) {
      g.save();
      g.shadowColor = 'rgba(47,59,92,.25)';
      g.shadowBlur = 14;
      g.fillStyle = '#fff';
      g.fillRect(r.x - 14, r.y - 14, r.w + 28, r.h + 28);
      g.restore();
    },
    behind: true,
  },
};

function layout(design, n) {
  const d = DESIGNS[design] || DESIGNS.classic;
  const h = Math.floor((STRIP_H - d.top - d.foot - d.gap * (n - 1)) / n);
  return {
    frames: [...Array(n)].map((_, i) => ({ x: d.side, y: d.top + i * (h + d.gap), w: STRIP_W - d.side * 2, h })),
    foot: { x: d.side, y: STRIP_H - d.foot + 20, w: STRIP_W - d.side * 2, h: d.foot - 40 },
  };
}

function paperTexture(g, rand) {
  for (let k = 0; k < 2600; k++) {
    g.fillStyle = `rgba(120,100,80,${rand() * 0.06})`;
    g.fillRect(rand() * STRIP_W, rand() * STRIP_H, 2 + rand() * 3, 2 + rand() * 3);
  }
}

// ---------- words ----------

function fitText(g, text, maxW, size, font, weight = '') {
  let s = size;
  do g.font = `${weight} ${s}px ${font}`.trim();
  while (g.measureText(text).width > maxW && (s -= 2) > 18);
  return s;
}

function timeIn(tz, when) {
  try {
    return new Date(when).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }).toLowerCase();
  } catch {
    return new Date(when).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  }
}

function drawFooter(g, d, f, info) {
  const { settings } = info;
  const c = COLOR_INFO[settings.color]?.paper && d.colorInk ? COLOR_INFO[settings.color] : null;
  d = c ? { ...d, ink: c.ink, sub: c.sub } : d;
  g.save();
  if (d.card) {
    g.fillStyle = d.card;
    g.shadowColor = 'rgba(80,30,20,.25)';
    g.shadowBlur = 16;
    roundRect(g, f.x, f.y, f.w, f.h - (d.foot2 ? 150 : 0), 28);
    g.fill();
    g.shadowColor = 'transparent';
  }
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const cx = STRIP_W / 2;
  let y = f.y + 120;
  if (settings.occasion) {
    g.fillStyle = d.ink;
    fitText(g, settings.occasion, f.w - 40, 92, FONT.script);
    g.fillText(settings.occasion, cx, y);
    y += 110;
  } else y += 10;
  g.fillStyle = d.ink;
  const names = `${info.names.left} & ${info.names.right}`;
  fitText(g, names, f.w - 40, settings.occasion ? 64 : 84, FONT.hand, 'bold');
  g.fillText(names, cx, y);
  y += 80;
  g.fillStyle = d.sub;
  g.font = `600 44px ${FONT.sans}`;
  g.fillText(new Date(info.when).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), cx, y);
  y += 70;
  if (settings.times) {
    const place = (side) => info.places[side] || '';
    const line = [
      `${timeIn(info.zones.left, info.when)}${place('left') ? ` in ${place('left')}` : ''}`,
      `${timeIn(info.zones.right, info.when)}${place('right') ? ` in ${place('right')}` : ''}`,
    ].join('  ·  ');
    fitText(g, line, f.w - 40, 38, FONT.sans, '500');
    g.fillText(line, cx, y);
  }
  g.restore();
  d.foot2?.(g, f);
}

function emoji(g, ch, x, y, size, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `${size}px ${FONT.emoji}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#000'; // colour emoji still take the paint's transparency
  g.fillText(ch, 0, 0);
  g.restore();
}

// A string sagging across the top of the strip, with something hung along it.
function garland(g, top, color, every, hang) {
  const sag = Math.min(70, top * 0.55);
  const at = (x) => 18 + sag * Math.sin((x / STRIP_W) * Math.PI);
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.beginPath();
  for (let x = 0; x <= STRIP_W; x += 20) g.lineTo(x, at(x));
  g.stroke();
  let k = 0;
  for (let x = every / 2; x < STRIP_W; x += every) hang(x, at(x), k++);
  g.restore();
}

function heartPath(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.45, y - s * 1.05, x, y - s * 0.45);
  g.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s, y - s * 0.4, x, y + s * 0.35);
}

// Holiday decorations around the photos: along the top, in the side margins, and in the bottom corners.
const DECOS = {
  thanksgiving: { top: ['🍂', '🦃', '🍁'], sides: ['🍂', '🍁', '🌾', '🍁'], corners: ['🥧', '🌽'] },
  christmas: {
    top(g, d) {
      const colors = ['#e0473f', '#3aa35c', '#f2c14e', '#4a8fe0'];
      garland(g, d.top, '#2c5a42', 70, (x, y, k) => {
        g.save();
        g.shadowColor = colors[k % 4];
        g.shadowBlur = 22;
        g.fillStyle = colors[k % 4];
        g.beginPath();
        g.ellipse(x, y + 16, 11, 16, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.fillStyle = '#5b5b5b';
        g.fillRect(x - 6, y, 12, 6);
      });
    },
    sides: ['❄️', '⭐', '❄️', '🔔'],
    corners: ['🎄', '🎁'],
  },
  valentine: {
    top(g, d) {
      garland(g, d.top, '#c25a6e', 64, (x, y, k) => {
        g.fillStyle = k % 2 ? '#f6b5c1' : '#d9534f';
        heartPath(g, x, y + 22, 20);
        g.fill();
      });
    },
    sides: ['💕', '💗', '💕', '💘'],
    corners: ['🌹', '💌'],
  },
  newyear: { top: ['✨', '🎉', '✨'], sides: ['🎊', '✨', '🥳', '✨'], corners: ['🥂', '🎆'], confetti: ['#f2c14e', '#d9534f', '#c9cfe6', '#ffffff'] },
  halloween: { top: ['🦇', '🎃', '🦇'], sides: ['👻', '🕸️', '🦇', '🍬'], corners: ['🎃', '🍬'] },
  birthday: {
    top(g, d) {
      const colors = ['#d9534f', '#f2c14e', '#5fae86', '#6c9ad2', '#e57f96'];
      garland(g, d.top, '#8a5a3b', 80, (x, y, k) => {
        g.fillStyle = colors[k % colors.length];
        g.beginPath();
        g.moveTo(x - 30, y);
        g.lineTo(x + 30, y);
        g.lineTo(x, y + Math.min(54, d.top * 0.5));
        g.fill();
      });
    },
    sides: ['🎈', '🎉', '🎈', '🎊'],
    corners: ['🎂', '🎁'],
    confetti: ['#d9534f', '#f2c14e', '#5fae86', '#6c9ad2'],
  },
  anniversary: { top: ['💐', '💍', '💐'], sides: ['💗', '✨', '🕊️', '✨'], corners: ['🥂', '💐'] },
};

function drawDeco(g, name, d, L, rand) {
  const deco = DECOS[name];
  if (!deco) return;
  if (deco.confetti) {
    // Paper bits in the margins only, never over the photos.
    for (let k = 0; k < 160; k++) {
      const x = rand() * STRIP_W;
      const y = rand() * STRIP_H;
      const inPhoto = L.frames.some((r) => x > r.x - 20 && x < r.x + r.w + 20 && y > r.y - 20 && y < r.y + r.h + 20);
      if (inPhoto || (y > L.foot.y + 40 && x > 220 && x < STRIP_W - 220)) continue;
      g.save();
      g.translate(x, y);
      g.rotate(rand() * Math.PI);
      g.fillStyle = deco.confetti[k % deco.confetti.length];
      g.fillRect(-7, -4, 14, 8);
      g.restore();
    }
  }
  if (typeof deco.top === 'function') deco.top(g, d);
  else {
    const size = Math.min(76, d.top - 18);
    // The moon design keeps its moon in the middle.
    const xs = d === DESIGNS.moon ? [0.18, 0.82] : [0.2, 0.5, 0.8];
    xs.forEach((fx, i) => emoji(g, deco.top[i === 1 && xs.length === 2 ? 2 : i], STRIP_W * fx, d.top / 2, size, (rand() - 0.5) * 0.4));
  }
  const side = Math.min(64, d.side - 6);
  L.frames.forEach((r, i) => {
    const ch = deco.sides[i % deco.sides.length];
    const x = i % 2 ? STRIP_W - d.side / 2 : d.side / 2;
    emoji(g, ch, x, r.y + r.h * 0.38, side, (rand() - 0.5) * 0.8);
  });
  emoji(g, deco.corners[0], 120, STRIP_H - 110, 120, -0.12);
  emoji(g, deco.corners[1], STRIP_W - 120, STRIP_H - 110, 120, 0.12);
}

// Little paper tags on the first shot: whose side is whose.
function drawNameTags(g, r, names) {
  const tag = (text, x, rot, align) => {
    g.save();
    g.font = `bold 46px ${FONT.hand}`;
    const w = g.measureText(text).width + 44;
    g.translate(align === 'left' ? x : x - w, r.y + 26);
    g.rotate(rot);
    g.shadowColor = 'rgba(0,0,0,.28)';
    g.shadowBlur = 10;
    g.shadowOffsetY = 3;
    g.fillStyle = '#fff4e0';
    roundRect(g, 0, 0, w, 70, 14);
    g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = '#7a2c3a';
    g.textAlign = 'left'; // a design may have left it on center or right
    g.textBaseline = 'middle';
    g.fillText(text, 22, 37);
    g.restore();
  };
  tag(names.left, r.x + 24, -0.05, 'left');
  tag(names.right, r.x + r.w - 24, 0.05, 'right');
}

function drawDateStamp(g, r, when) {
  const dt = new Date(when);
  const text = `'${String(dt.getFullYear()).slice(2)} ${String(dt.getMonth() + 1).padStart(2, ' ')} ${String(dt.getDate()).padStart(2, '0')}`;
  g.save();
  g.font = `bold 46px ${FONT.mono}`;
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.shadowColor = 'rgba(255,120,30,.9)';
  g.shadowBlur = 14;
  g.fillStyle = '#ff9a3c';
  g.fillText(text, r.x + r.w - 28, r.y + r.h - 22);
  g.restore();
}

function drawSticker(g, s, assets) {
  const size = s.s * STRIP_W;
  g.save();
  g.translate(s.x * STRIP_W, s.y * STRIP_H);
  g.rotate((s.r * Math.PI) / 180);
  if (EMOJI_STICKERS[s.k]) {
    g.fillStyle = '#000';
    g.font = `${size}px ${FONT.emoji}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(EMOJI_STICKERS[s.k], 0, 0);
  } else if (assets[s.k]) {
    const img = assets[s.k];
    const h = size * (img.height / img.width);
    g.drawImage(img, -size / 2, -h / 2, size, h);
  }
  g.restore();
}

// ---------- the whole strip ----------
// opts: { photos: { left: [4 srcs], right: [4 srcs], then }, settings, names: { left, right }, bears: { left, right },
//         zones: { left, right }, places: { left, right }, when, seed, assets: { name: src }, stickers: true|false }
async function drawStrip(canvas, opts) {
  canvas.width = STRIP_W;
  canvas.height = STRIP_H;
  const g = canvas.getContext('2d');
  const { settings } = opts;
  const d = DESIGNS[settings.design] || DESIGNS.classic;
  const rand = seededRandom(`${opts.seed}:${settings.design}`);
  const [assets, left, right, then] = await Promise.all([
    loadAssets(opts.assets),
    Promise.all([0, 1, 2, 3].map((i) => loadImage(opts.photos.left?.[i]))),
    Promise.all([0, 1, 2, 3].map((i) => loadImage(opts.photos.right?.[i]))),
    settings.thenNow ? loadImage(opts.photos.then) : null,
  ]);
  const n = then ? 5 : 4;
  const L = layout(settings.design, n);
  const color = COLOR_INFO[settings.color]?.paper ? COLOR_INFO[settings.color] : null;
  d.bg(g, rand, color);
  if (d.texture === 'paper') paperTexture(g, rand);
  d.crown?.(g); // a decoration above the first shot
  const ph = [placeholder(opts.names.left, ['#e9d5c4', '#c9a98f']), placeholder(opts.names.right, ['#f3e4ea', '#d9b8c4'])];
  for (let i = 0; i < 4; i++) {
    const r = L.frames[i];
    if (d.behind) d.frame?.(g, r, i);
    const a = left[i] ? balanced(left[i], `${opts.photos.left[i].length}:${opts.photos.left[i].slice(-48)}`) : ph[0];
    const b = right[i] ? balanced(right[i], `${opts.photos.right[i].length}:${opts.photos.right[i].slice(-48)}`) : ph[1];
    g.drawImage(shotCanvas(r.w, r.h, a, b, settings.filter, seededRandom(`${opts.seed}:grain:${i}`)), r.x, r.y);
    if (!d.behind) d.frame?.(g, r, i);
    d.after?.(g, r, i);
  }
  if (then) {
    const r = L.frames[4];
    if (d.behind) d.frame?.(g, r, 4);
    g.drawImage(singleCanvas(r.w, r.h, then, settings.filter, seededRandom(`${opts.seed}:grain:then`)), r.x, r.y);
    if (!d.behind) d.frame?.(g, r, 4);
    d.after?.(g, r, 4);
    // A little paper tag: this one is from before.
    g.save();
    g.translate(r.x + 40, r.y + 40);
    g.rotate(-0.08);
    g.fillStyle = '#fff4e0';
    g.shadowColor = 'rgba(0,0,0,.25)';
    g.shadowBlur = 8;
    roundRect(g, 0, 0, 190, 70, 12);
    g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = '#7a2c3a';
    g.font = `bold 40px ${FONT.hand}`;
    g.textBaseline = 'middle';
    g.fillText('then ♡', 22, 37);
    g.restore();
  }
  if (settings.stamp) drawDateStamp(g, L.frames[3], opts.when);
  drawDeco(g, settings.deco, d, L, seededRandom(`${opts.seed}:deco`));
  if (settings.bears) drawFrameBears(g, L.frames, opts.bears, assets);
  if (settings.tags !== false) drawNameTags(g, L.frames[0], opts.names);
  drawFooter(g, d, L.foot, opts);
  if (opts.stickers !== false) for (const s of settings.stickers || []) drawSticker(g, s, assets);
  return canvas;
}

// Peeking from the bottom corners: Dudu on Dudu's person's side, Bubu on the other. On shot 4 they meet on the seam.
function drawFrameBears(g, frames, bears, assets) {
  const put = (img, x, y, h, flip) => {
    if (!img) return;
    const w = h * (img.width / img.height);
    g.save();
    g.translate(x, y);
    if (flip) g.scale(-1, 1);
    g.drawImage(img, 0, -h, w, h); // mirrored, this still lands to the left of x
    g.restore();
  };
  frames.slice(0, 3).forEach((r, i) => {
    const h = Math.min(200, r.h * 0.34);
    put(assets[`${FRAME_BEARS[i]}-${bears.left}`], r.x - 34, r.y + r.h + 26, h, false);
    put(assets[`${FRAME_BEARS[i]}-${bears.right}`], r.x + r.w + 34, r.y + r.h + 26, h, true);
  });
  const r = frames[3];
  const pair = assets['pair-cuddle'];
  if (pair) {
    const h = Math.min(220, r.h * 0.38);
    const w = h * (pair.width / pair.height);
    // The picture has Dudu on the left; flip it if Dudu's person is on the right.
    put(pair, bears.left === 'cream' ? r.x + r.w / 2 + w / 2 : r.x + r.w / 2 - w / 2, r.y + r.h + 30, h, bears.left === 'cream');
  }
}

const assetCache = { src: null, imgs: null };
async function loadAssets(srcs = {}) {
  if (assetCache.src === srcs && assetCache.imgs) return assetCache.imgs;
  const entries = await Promise.all(Object.entries(srcs).map(async ([k, v]) => [k, await loadImage(v)]));
  assetCache.src = srcs;
  assetCache.imgs = Object.fromEntries(entries.filter(([, v]) => v));
  return assetCache.imgs;
}

// The back of the strip: the note, handwritten, on the design's paper colour.
function drawBack(canvas, { settings, names, when, noteByName }) {
  canvas.width = STRIP_W;
  canvas.height = STRIP_H;
  const g = canvas.getContext('2d');
  const d = DESIGNS[settings.design] || DESIGNS.classic;
  const c = COLOR_INFO[settings.color]?.paper ? COLOR_INFO[settings.color] : null;
  const dark = c ? true : settings.design === 'film' || settings.design === 'moon';
  g.fillStyle = c ? (c.dark ? tint(c.paper, 0.85) : tint(c.paper, 0.4)) : dark ? '#f3ead9' : '#fbf7ee';
  g.fillRect(0, 0, STRIP_W, STRIP_H);
  paperTexture(g, seededRandom('back'));
  const ink = dark ? '#3b2f2a' : d.ink;
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.font = `120px ${FONT.emoji}`;
  g.fillText('💌', STRIP_W / 2, 420);
  const text = settings.note || `${names.left} & ${names.right}`;
  g.font = `56px ${FONT.hand}`;
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (g.measureText(tryLine).width > STRIP_W - 220 && line) {
        lines.push(line);
        line = word;
      } else line = tryLine;
    }
    lines.push(line);
  }
  const lh = 84;
  let y = Math.max(620, STRIP_H / 2 - (lines.length * lh) / 2);
  for (const l of lines.slice(0, 26)) {
    g.fillText(l, STRIP_W / 2, y);
    y += lh;
  }
  if (settings.note && noteByName) {
    g.font = `bold 60px ${FONT.hand}`;
    g.fillText(`— ${noteByName}`, STRIP_W / 2, y + 60);
  }
  g.fillStyle = dark ? '#7a675d' : d.sub;
  g.font = `500 40px ${FONT.sans}`;
  g.fillText(new Date(when).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), STRIP_W / 2, STRIP_H - 220);
  return canvas;
}

// Two strips side by side on a 4x6 photo (600 dpi), like the two copies a real booth prints: one each.
function drawPrintSheet(strip) {
  const c = makeCanvas(STRIP_W * 2, STRIP_H);
  const g = c.getContext('2d');
  g.drawImage(strip, 0, 0);
  g.drawImage(strip, STRIP_W, 0);
  g.strokeStyle = 'rgba(0,0,0,.25)';
  g.setLineDash([18, 14]);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(STRIP_W, 0);
  g.lineTo(STRIP_W, STRIP_H);
  g.stroke();
  return c;
}
