// Draws the Christmas tree and its ornaments on a canvas. Shared by the app window (Tree tab) and the see-through
// overlay (the bear bringing an ornament over), so both draw exactly the same tree.
//
// The tree canvas is 800 x 1100 (2x what's shown). The bare tree is a picture (assets/tree/tree-bare.png); the
// garland, lights, star, plaque and every ornament are drawn here in the art guide's palette: brown outline, one flat
// colour plus one shade, highlights top left. Ornaments are drawn in a 512 x 512 box with the hook at (256, 40), as
// the guide specifies, then scaled. The outline and the bears' colours are the ones measured from the real bear GIFs
// (Vault: Christmas/Bear-Animation-Sheet.md), which differ a little from the art guide's palette.
/* exported TreeArt */
const TreeArt = (() => {
  const W = 800;
  const H = 1100;
  const OL = '#4a251f';
  const BEAR = { duduFur: '#dca68b', duduShade: '#c48d72', duduCheek: '#f9c286', bubuFur: '#ffffff', bubuShade: '#efe8e4', bubuCheek: '#ffc2bb', tongue: '#ff8484' };
  const C = {
    red: '#D9534F',
    dred: '#A8322D',
    green: '#3F7D5C',
    dgreen: '#2C5A42',
    gold: '#F2C14E',
    dgold: '#C9962E',
    cream: '#FFF4E0',
    pink: '#F6B5C1',
    dpink: '#E58FA0',
    tan: '#C98B5A',
    dtan: '#A86E44',
    wood: '#8A5A3B',
    white: '#FFFFFF',
    snowShade: '#DDE8F5',
    night: '#2F3B5C',
    glow: '#FFD98A',
    silver: '#D9DEE6',
    dsilver: '#A9B1BD',
    blue: '#7FB2E5',
    dblue: '#4F7FB8',
    milk: '#D9B48C',
  };
  // Measured from tree-bare.png (assets/tree/tree.json): 36 hook points, numbered top to bottom.
  const SLOTS = [[334,337],[391,313],[448,337],[295,441],[365,417],[435,445],[505,425],[274,545],[332,519],[390,563],[449,521],[507,545],[281,647],[331,625],[381,649],[432,625],[482,649],[532,625],[209,753],[258,729],[307,753],[356,729],[405,753],[454,729],[503,753],[552,729],[175,857],[226,833],[278,857],[329,833],[380,857],[432,827],[483,857],[534,837],[586,857],[637,833]]; // prettier-ignore
  const TIP = [400, 157];
  const ORN = 100; // an ornament's 512 box drawn this big on the tree
  const JOIN = 130;
  // The spots round the skirt for the little animals (slots 36..43): where their feet go (x, y), drawn back to front.
  // Two each side of the name ribbon, and four behind it (back: drawn before the ribbon, so they peek over it).
  const SKIRT_SPOTS = [[64, 1046], [150, 1096], [252, 1018, 1], [340, 1012, 1], [460, 1012, 1], [548, 1018, 1], [650, 1096], [736, 1046]]; // prettier-ignore
  const ANIMAL = 118; // an animal's 512 box drawn this big
  const spotOf = (slot) => (slot >= SLOTS.length ? SKIRT_SPOTS[slot - SLOTS.length] : null);

  // ---------- styles (names as in src/main/tree.js) ----------
  const PALETTE = {
    red: '#D9534F',
    berry: '#A8324F',
    pink: '#F6B5C1',
    peach: '#F7B58A',
    gold: '#F2C14E',
    cream: '#FFF4E0',
    white: '#FFFFFF',
    silver: '#CBD3DD',
    mint: '#8FD3B6',
    green: '#3F7D5C',
    teal: '#3BA7A0',
    sky: '#7FB2E5',
    navy: '#2F3B5C',
    lavender: '#B9A7E8',
    plum: '#7A4D9C',
    cocoa: '#8A5A3B',
    black: '#3a3036',
  };
  const PATTERNS = ['plain', 'zigzag', 'stripes', 'dots', 'snow', 'hearts', 'stars', 'plaid', 'swirl'];
  // Which colours each ornament lets you change: p (main), a (accent). Glass baubles also take a pattern.
  const ROLES = {
    'bauble-zigzag': ['p', 'a'],
    'bauble-stripe': ['p', 'a'],
    'bauble-dots': ['p', 'a'],
    'bauble-snow': ['p'],
    teardrop: ['p', 'a'],
    star: ['p'],
    snowflake: ['p'],
    bell: ['p', 'a'],
    'candy-cane': ['p'],
    pinecone: [],
    gingerbread: ['a'],
    present: ['p', 'a'],
    mitten: ['p', 'a'],
    heart: ['p', 'a'],
    'heart-left': ['p', 'a'],
    'heart-right': ['p', 'a'],
    boba: ['p'],
    plane: ['p', 'a'],
    dudu: ['p'],
    bubu: ['p'],
    'first-xmas': ['p'],
    locket: ['p'],
    stocking: ['p', 'a'],
    snowman: ['p'],
    reindeer: ['p', 'a'],
    cocoa: ['p'],
    // (the picture ornaments keep their own colours: only finish and size)
  };
  const PATTERNED = new Set(['bauble-zigzag', 'bauble-stripe', 'bauble-dots']);
  const SIZE_K = { s: 0.82, m: 1, l: 1.2 };

  function darken(hex, f = 0.75) {
    const v = parseInt(hex.slice(1), 16);
    const c = (x) => Math.round(x * f);
    return `#${[c(v >> 16), c((v >> 8) & 255), c(v & 255)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  }

  // While one ornament is being drawn: its colour overrides, and whether it's matte.
  let OV = null;
  let MATTE = false;
  const P = (role, fallback) => (OV?.[role] ? PALETTE[OV[role]] : fallback);
  const PS = (role, fallbackShade) => (OV?.[role] ? darken(PALETTE[OV[role]]) : fallbackShade);

  let base = null;
  let snowyBase = null; // tree-snowy.png: the same tree with snow on it (tools/make-snowy-tree.py)
  let baseReady = null;
  function load(src = 'ba://asset/tree%2Ftree-bare.png') {
    if (baseReady) return baseReady;
    const img = (s) => {
      const i = new Image();
      const ready = new Promise((res) => {
        i.onload = () => res(true);
        i.onerror = () => res(false);
      });
      i.src = s;
      return [i, ready];
    };
    let ready;
    [base, ready] = img(src);
    const [snowy, snowyReady] = img(src.replace('tree-bare', 'tree-snowy'));
    snowyBase = snowy;
    // the picture ornaments, next to the tree in tree/items (an encoded slash for ba://, a plain one for files)
    const sep = src.includes('%2F') ? '%2F' : '/';
    const pics = PIC_KINDS.map((kind) => {
      const [i, r] = img(src.replace('tree-bare.png', `items${sep}${kind}.png`));
      PICS[kind] = i;
      return r;
    });
    baseReady = Promise.all([ready, snowyReady, ...pics]).then(([ok]) => ok);
    return baseReady;
  }

  // ---------- small helpers ----------

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fill a shape, add one shade on its lower right and two soft highlights top left, then outline it.
  function shape(ctx, path, fill, { shade, lw = 12, shine = true, bounds } = {}) {
    ctx.fillStyle = fill;
    ctx.fill(path);
    if (MATTE) shine = false;
    if (shade || shine) {
      const [x, y, w, h] = bounds || [0, 0, 512, 512];
      ctx.save();
      ctx.clip(path);
      if (shade) {
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.ellipse(x + w * 0.78, y + h * 0.8, w * 0.62, h * 0.55, -0.5, 0, Math.PI * 2);
        ctx.ellipse(x + w * 0.3, y + h * 0.3, w * 0.75, h * 0.72, -0.5, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
      }
      if (shine) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(x + w * 0.3, y + h * 0.26, w * 0.1, h * 0.06, -0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + w * 0.2, y + h * 0.4, w * 0.035, h * 0.035, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = OL;
    ctx.stroke(path);
  }

  const circle = (x, y, r) => {
    const p = new Path2D();
    p.arc(x, y, r, 0, Math.PI * 2);
    return p;
  };

  function ellipse(x, y, rx, ry, rot = 0) {
    const p = new Path2D();
    p.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    return p;
  }

  function roundRect(x, y, w, h, r) {
    const p = new Path2D();
    p.roundRect(x, y, w, h, r);
    return p;
  }

  function sparkle(ctx, x, y, r, color = '#fff') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
  }

  function heartPath(cx, cy, s) {
    const p = new Path2D();
    p.moveTo(cx, cy + s * 0.95);
    p.bezierCurveTo(cx - s * 0.2, cy + s * 0.75, cx - s * 1.05, cy + s * 0.3, cx - s * 0.98, cy - s * 0.3);
    p.bezierCurveTo(cx - s * 0.92, cy - s * 0.85, cx - s * 0.2, cy - s * 0.95, cx, cy - s * 0.45);
    p.bezierCurveTo(cx + s * 0.2, cy - s * 0.95, cx + s * 0.92, cy - s * 0.85, cx + s * 0.98, cy - s * 0.3);
    p.bezierCurveTo(cx + s * 1.05, cy + s * 0.3, cx + s * 0.2, cy + s * 0.75, cx, cy + s * 0.95);
    p.closePath();
    return p;
  }

  function starPath(cx, cy, R, r, points = 5, rot = -Math.PI / 2) {
    const p = new Path2D();
    for (let i = 0; i < points * 2; i++) {
      const a = rot + (i * Math.PI) / points;
      const rr = i % 2 ? r : R;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i) p.lineTo(x, y);
      else p.moveTo(x, y);
    }
    p.closePath();
    return p;
  }

  // The little gold cap and loop every glass ornament hangs from (top of the loop at y = 40).
  function cap(ctx, y = 100, w = 76, color = C.gold, shade = C.dgold) {
    ctx.lineWidth = 10;
    ctx.strokeStyle = OL;
    ctx.beginPath();
    ctx.ellipse(256, 58, 16, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();
    const p = roundRect(256 - w / 2, 72, w, y - 72 + 8, 8);
    shape(ctx, p, color, { shade, lw: 10, shine: false, bounds: [256 - w / 2, 72, w, y - 64] });
    ctx.strokeStyle = shade;
    ctx.lineWidth = 5;
    for (const dx of [-18, 0, 18]) {
      ctx.beginPath();
      ctx.moveTo(256 + dx, 80);
      ctx.lineTo(256 + dx, y - 2);
      ctx.stroke();
    }
  }

  // A simple loop of yarn or ribbon from the hook point down to y.
  function loop(ctx, y, color = C.red, w = 30) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = OL;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(256 - w / 2, y);
    ctx.bezierCurveTo(256 - w, 20, 256 + w, 20, 256 + w / 2, y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.stroke();
  }

  // ---------- the ornaments ----------

  const BAUBLE = {
    'bauble-zigzag': [
      [C.red, C.dred, '#fff'],
      [C.green, C.dgreen, C.gold],
      [C.pink, C.dpink, '#fff'],
      [C.night, '#222b45', C.silver],
    ],
    'bauble-stripe': [
      [C.red, C.dred, C.cream],
      [C.green, C.dgreen, C.gold],
      [C.gold, C.dgold, C.red],
    ],
    'bauble-dots': [
      [C.red, C.dred, C.cream],
      [C.cream, '#EAD9BC', C.red],
      [C.green, C.dgreen, C.gold],
    ],
  };

  const DEFAULT_PATTERN = { 'bauble-zigzag': 'zigzag', 'bauble-stripe': 'stripes', 'bauble-dots': 'dots' };

  // A pattern painted on a ball (centre 256,270, radius 170); it curves with the ball and shrinks toward the edge.
  function ballPattern(ctx, pat, accent) {
    const cx = 256;
    const cy = 270;
    const R = 170;
    const scatter = (fn, step = 52) => {
      for (let gy = -3; gy <= 3; gy++)
        for (let gx = -3; gx <= 3; gx++) {
          const x = cx + gx * step + (gy % 2 ? step / 2 : 0);
          const y = cy + gy * (step * 0.96);
          const d = Math.hypot(x - cx, y - cy) / R;
          if (d > 0.93) continue;
          fn(x, y, 1 - d * d * 0.55, gx, gy);
        }
    };
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    if (pat === 'zigzag') {
      ctx.lineWidth = 30;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        const x = 80 + i * 35.2;
        const bow = Math.sin(((x - 86) / 340) * Math.PI) * 26;
        ctx.lineTo(x, 272 + bow + (i % 2 ? -26 : 26));
      }
      ctx.stroke();
    } else if (pat === 'stripes') {
      for (const [y, h] of [[150, 26], [252, 46], [356, 20]]) {
        ctx.beginPath();
        ctx.moveTo(60, y);
        ctx.quadraticCurveTo(256, y + 40, 452, y);
        ctx.lineTo(452, y + h);
        ctx.quadraticCurveTo(256, y + h + 40, 60, y + h);
        ctx.fill();
      }
    } else if (pat === 'dots') {
      scatter((x, y, k) => {
        ctx.beginPath();
        ctx.ellipse(x, y, 17 * k, 15 * k, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (pat === 'snow') {
      scatter((x, y, k, gx, gy) => {
        if ((gx + gy) % 2) return;
        ctx.lineWidth = 6 * k;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const a = (i * Math.PI) / 3;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(a) * 20 * k, y - Math.sin(a) * 20 * k);
          ctx.lineTo(x + Math.cos(a) * 20 * k, y + Math.sin(a) * 20 * k);
          ctx.stroke();
        }
      }, 64);
    } else if (pat === 'hearts') {
      scatter((x, y, k, gx, gy) => {
        if ((gx + gy) % 2) return;
        ctx.fill(heartPath(x, y, 18 * k));
      }, 60);
    } else if (pat === 'stars') {
      scatter((x, y, k, gx, gy) => {
        if ((gx + gy) % 2) return;
        ctx.fill(starPath(x, y, 22 * k, 9 * k));
      }, 62);
    } else if (pat === 'plaid') {
      ctx.globalAlpha = 0.55;
      for (let i = -4; i <= 4; i++) {
        ctx.fillRect(cx + i * 56 - 10, 80, 20, 400);
        ctx.fillRect(60, cy + i * 56 - 10, 400, 20);
      }
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 4;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 56 + 22, 80);
        ctx.lineTo(cx + i * 56 + 22, 480);
        ctx.moveTo(60, cy + i * 56 + 22);
        ctx.lineTo(460, cy + i * 56 + 22);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (pat === 'swirl') {
      ctx.lineWidth = 22;
      ctx.lineCap = 'round';
      for (let s = 0; s < 3; s++) {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const a = (i / 60) * Math.PI * 3 + s * ((Math.PI * 2) / 3);
          const r = (i / 60) * 150;
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9);
        }
        ctx.stroke();
      }
    }
  }

  function bauble(ctx, kind, c) {
    const [f0, s0, a0] = BAUBLE[kind][c % BAUBLE[kind].length];
    const fill = P('p', f0);
    const shade = PS('p', s0);
    const accent = P('a', a0);
    const pat = OV?.pat || DEFAULT_PATTERN[kind];
    const ball = circle(256, 270, 170);
    ctx.fillStyle = fill;
    ctx.fill(ball);
    ctx.save();
    ctx.clip(ball);
    ballPattern(ctx, pat, accent);
    ctx.restore();
    shape(ctx, ball, 'rgba(0,0,0,0)', { shade: hexA(shade, 0.85), bounds: [86, 100, 340, 340] });
    if (pat === 'zigzag' && !MATTE) for (const [x, y, r] of [[170, 190, 16], [330, 360, 12], [360, 190, 9]]) sparkle(ctx, x, y, r, '#fff');
    cap(ctx);
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function snowGlobe(ctx) {
    const ball = circle(256, 270, 170);
    ctx.fillStyle = OV?.p ? hexA(P('p', '#CFE6F7'), 0.55) : '#CFE6F7';
    ctx.fill(ball);
    ctx.save();
    ctx.clip(ball);
    // a snow pile and two little trees inside
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.ellipse(256, 420, 210, 90, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const [x, s] of [[200, 1], [300, 0.8]]) {
      const t = new Path2D();
      t.moveTo(x, 330 - 130 * s);
      t.lineTo(x + 55 * s, 345);
      t.lineTo(x - 55 * s, 345);
      t.closePath();
      shape(ctx, t, C.green, { shade: C.dgreen, lw: 8, shine: false, bounds: [x - 55 * s, 200, 110 * s, 145] });
    }
    ctx.fillStyle = C.white;
    const r = rng(7);
    for (let i = 0; i < 22; i++) {
      ctx.beginPath();
      ctx.arc(110 + r() * 300, 130 + r() * 200, 4 + r() * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    shape(ctx, ball, 'rgba(0,0,0,0)', { shade: 'rgba(80,120,170,0.18)', bounds: [86, 100, 340, 340] });
    cap(ctx);
  }

  function teardrop(ctx, c) {
    const [f0, s0, w0] = [[C.gold, C.dgold, C.red], [C.cream, '#EAD9BC', C.green]][c % 2];
    const [fill, shade, swirl] = [P('p', f0), PS('p', s0), P('a', w0)];
    const p = new Path2D();
    p.moveTo(256, 96);
    p.bezierCurveTo(300, 150, 350, 230, 345, 310);
    p.bezierCurveTo(342, 380, 300, 420, 256, 476);
    p.bezierCurveTo(212, 420, 170, 380, 167, 310);
    p.bezierCurveTo(162, 230, 212, 150, 256, 96);
    p.closePath();
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.save();
    ctx.clip(p);
    ctx.strokeStyle = swirl;
    ctx.lineWidth = 24;
    for (let y = 60; y < 520; y += 70) {
      ctx.beginPath();
      ctx.moveTo(140, y + 60);
      ctx.bezierCurveTo(220, y + 40, 290, y - 10, 380, y - 40);
      ctx.stroke();
    }
    ctx.restore();
    shape(ctx, p, 'rgba(0,0,0,0)', { shade: hexA(shade, 0.8), bounds: [167, 96, 178, 380] });
    cap(ctx, 108, 52);
  }

  function star(ctx, c) {
    const [f0, s0] = [[C.gold, C.dgold], [C.white, C.dsilver], [C.red, C.dred]][c % 3];
    const [fill, shade] = [P('p', f0), PS('p', s0)];
    loop(ctx, 96, C.gold, 22);
    const p = starPath(256, 250, 150, 70);
    // A thick round-joined stroke rounds the points: outline colour first, then the star's own colour inside it.
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OL;
    ctx.lineWidth = 44;
    ctx.stroke(p);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 26;
    ctx.stroke(p);
    ctx.restore();
    shape(ctx, p, fill, { shade, bounds: [98, 92, 316, 316], lw: 0.001 });
  }

  function snowflake(ctx, c) {
    const [f0, e0] = [[C.white, '#9DB4CF'], ['#BFE3F7', C.dblue]][c % 2];
    const [fill, edge] = [P('p', f0), PS('p', e0)];
    const cx = 256;
    const cy = 260;
    const arms = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 - Math.PI / 2;
      const ex = cx + Math.cos(a) * 165;
      const ey = cy + Math.sin(a) * 165;
      arms.push([cx, cy, ex, ey]);
      for (const [f, len] of [[0.5, 55], [0.75, 38]]) {
        const bx = cx + Math.cos(a) * 165 * f;
        const by = cy + Math.sin(a) * 165 * f;
        for (const s of [-1, 1]) arms.push([bx, by, bx + Math.cos(a + s * 0.85) * len, by + Math.sin(a + s * 0.85) * len]);
      }
    }
    ctx.lineCap = 'round';
    for (const [w, col] of [[44, OL], [26, edge], [16, fill]])
      for (const [x1, y1, x2, y2] of arms) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    shape(ctx, circle(cx, cy, 34), fill, { shine: false, lw: 10 });
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(256, 95);
    ctx.lineTo(256, 40);
    ctx.stroke();
  }

  function bell(ctx, c) {
    const [f0, s0, b0, db0] = [[C.gold, C.dgold, C.red, C.dred], [C.silver, C.dsilver, C.green, C.dgreen]][c % 2];
    const [fill, shade, bow, dbow] = [P('p', f0), PS('p', s0), P('a', b0), PS('a', db0)];
    loop(ctx, 100, bow, 24);
    shape(ctx, circle(256, 410, 34), shade, { shine: false, lw: 10 });
    const p = new Path2D();
    p.moveTo(256, 104);
    p.bezierCurveTo(330, 104, 350, 170, 352, 250);
    p.bezierCurveTo(354, 320, 380, 360, 410, 384);
    p.quadraticCurveTo(420, 404, 390, 404);
    p.lineTo(122, 404);
    p.quadraticCurveTo(92, 404, 102, 384);
    p.bezierCurveTo(132, 360, 158, 320, 160, 250);
    p.bezierCurveTo(162, 170, 182, 104, 256, 104);
    p.closePath();
    shape(ctx, p, fill, { shade, bounds: [102, 104, 308, 300] });
    ctx.strokeStyle = shade;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(130, 370);
    ctx.quadraticCurveTo(256, 392, 382, 370);
    ctx.stroke();
    // a small bow where it meets the loop
    for (const s of [-1, 1]) {
      const b = ellipse(256 + s * 42, 108, 40, 24, s * 0.35);
      shape(ctx, b, bow, { shade: dbow, shine: false, lw: 9, bounds: [256 + s * 42 - 40, 84, 80, 48] });
    }
    shape(ctx, circle(256, 108, 16), bow, { shine: false, lw: 9 });
  }

  function candyCane(ctx, c) {
    const stripe = P('p', [C.red, C.green][c % 2]);
    const path = new Path2D();
    path.moveTo(300, 470);
    path.lineTo(300, 140);
    path.arc(240, 140, 60, 0, Math.PI, true);
    path.lineTo(180, 190);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OL;
    ctx.lineWidth = 74;
    ctx.stroke(path);
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 52;
    ctx.stroke(path);
    ctx.save();
    ctx.setLineDash([30, 34]);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = stripe;
    ctx.lineWidth = 52;
    ctx.stroke(path);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(288, 440);
    ctx.lineTo(288, 160);
    ctx.stroke();
  }

  function pinecone(ctx) {
    const body = ellipse(256, 290, 112, 168);
    shape(ctx, body, '#8A5A3B', { shade: '#6B4329', shine: false, bounds: [144, 122, 224, 336] });
    ctx.save();
    ctx.clip(body);
    ctx.strokeStyle = OL;
    ctx.lineWidth = 8;
    for (let row = 0; row < 8; row++) {
      const y = 150 + row * 40;
      const n = 4 + (row % 2);
      for (let i = 0; i < n; i++) {
        const x = 150 + ((i + (row % 2 ? 0 : 0.5)) * 212) / (n - 0.5);
        ctx.fillStyle = row < 2 ? '#A06C47' : '#94603E';
        ctx.beginPath();
        ctx.moveTo(x - 30, y);
        ctx.quadraticCurveTo(x, y + 52, x + 30, y);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.lineWidth = 12;
    ctx.strokeStyle = OL;
    ctx.stroke(body);
    // snow on the top scales
    const snow = new Path2D();
    snow.moveTo(170, 160);
    snow.bezierCurveTo(190, 112, 322, 112, 342, 160);
    snow.bezierCurveTo(320, 178, 300, 160, 282, 176);
    snow.bezierCurveTo(262, 160, 240, 182, 220, 168);
    snow.bezierCurveTo(200, 182, 180, 176, 170, 160);
    shape(ctx, snow, C.white, { shade: C.snowShade, shine: false, lw: 9, bounds: [170, 112, 172, 70] });
    loop(ctx, 124, C.red, 22);
  }

  function gingerbread(ctx) {
    const body = new Path2D();
    body.addPath(circle(256, 172, 92));
    body.addPath(circle(186, 102, 34));
    body.addPath(circle(326, 102, 34));
    body.addPath(ellipse(256, 340, 112, 106));
    body.addPath(ellipse(150, 300, 52, 34, -0.5));
    body.addPath(ellipse(362, 300, 52, 34, 0.5));
    body.addPath(ellipse(196, 430, 46, 40));
    body.addPath(ellipse(316, 430, 46, 40));
    ctx.fillStyle = OL;
    ctx.save();
    ctx.lineWidth = 24;
    ctx.strokeStyle = OL;
    ctx.stroke(body);
    ctx.restore();
    ctx.fillStyle = C.tan;
    ctx.fill(body);
    // icing squiggle just inside the edge
    ctx.save();
    ctx.clip(body);
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 9;
    ctx.setLineDash([16, 10]);
    ctx.globalAlpha = 0.95;
    for (const [x, y, rx, ry] of [[256, 172, 70, 70], [256, 340, 90, 84]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = OL;
    for (const x of [222, 290]) {
      ctx.beginPath();
      ctx.arc(x, 168, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = OL;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(256, 196, 24, 0.2, Math.PI - 0.2);
    ctx.stroke();
    for (const y of [318, 372]) shape(ctx, circle(256, y, 16), P('a', C.red), { shine: false, lw: 7 });
    // ribbon through a hole in the head
    ctx.fillStyle = '#7A4A2C';
    ctx.beginPath();
    ctx.arc(256, 104, 10, 0, Math.PI * 2);
    ctx.fill();
    loop(ctx, 106, C.red, 26);
  }

  function present(ctx, c) {
    const [p0, dp0, r0, dr0] = [[C.red, C.dred, C.gold, C.dgold], [C.green, C.dgreen, C.red, C.dred], [C.gold, C.dgold, C.red, C.dred]][c % 3];
    const [paper, dpaper, ribbon, dribbon] = [P('p', p0), PS('p', dp0), P('a', r0), PS('a', dr0)];
    const box = roundRect(130, 190, 252, 220, 10);
    shape(ctx, box, paper, { shade: dpaper, bounds: [130, 190, 252, 220] });
    ctx.fillStyle = ribbon;
    ctx.fillRect(236, 196, 40, 208);
    const lid = roundRect(116, 166, 280, 58, 10);
    shape(ctx, lid, paper, { shade: dpaper, shine: false, bounds: [116, 166, 280, 58] });
    ctx.fillStyle = ribbon;
    ctx.fillRect(236, 172, 40, 46);
    ctx.strokeStyle = OL;
    ctx.lineWidth = 8;
    ctx.strokeRect(236, 224, 40, 182);
    for (const s of [-1, 1]) shape(ctx, ellipse(256 + s * 50, 140, 52, 32, s * 0.4), ribbon, { shade: dribbon, shine: false, lw: 10, bounds: [256 + s * 50 - 52, 108, 104, 64] });
    shape(ctx, circle(256, 148, 20), ribbon, { shine: false, lw: 10 });
    loop(ctx, 134, ribbon, 20);
  }

  function mitten(ctx, c) {
    const [k0, dk0, c0] = [[C.red, C.dred, C.white], [C.green, C.dgreen, C.cream]][c % 2];
    const [knit, dknit, cuff] = [P('p', k0), PS('p', dk0), P('a', c0)];
    const m = new Path2D();
    m.moveTo(190, 190);
    m.bezierCurveTo(180, 300, 170, 400, 250, 440);
    m.bezierCurveTo(330, 470, 380, 410, 372, 320);
    m.bezierCurveTo(400, 300, 420, 260, 398, 236);
    m.bezierCurveTo(380, 218, 352, 236, 346, 262);
    m.lineTo(340, 190);
    m.closePath();
    shape(ctx, m, knit, { shade: dknit, bounds: [170, 190, 250, 270] });
    ctx.strokeStyle = dknit;
    ctx.lineWidth = 6;
    for (let y = 250; y < 430; y += 36) {
      ctx.beginPath();
      for (let x = 200; x < 360; x += 24) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + 12, y + 12);
        ctx.lineTo(x + 24, y);
      }
      ctx.stroke();
    }
    const cuffP = roundRect(170, 140, 190, 74, 26);
    shape(ctx, cuffP, cuff, { shade: C.snowShade, shine: false, bounds: [170, 140, 190, 74] });
    for (const x of [210, 265, 320]) sparkle(ctx, x, 177, 16, knit);
    loop(ctx, 142, cuff === C.white ? C.cream : C.white, 26);
  }

  function heart(ctx, c) {
    const [f0, s0, t0] = [[C.red, C.dred, C.cream], [C.pink, C.dpink, C.red]][c % 2];
    const [fill, shade, stitch] = [P('p', f0), PS('p', s0), P('a', t0)];
    const h = heartPath(256, 280, 170);
    shape(ctx, h, fill, { shade, bounds: [86, 110, 340, 340] });
    ctx.save();
    ctx.translate(256, 280);
    ctx.scale(0.84, 0.84);
    ctx.translate(-256, -280);
    ctx.setLineDash([18, 14]);
    ctx.strokeStyle = stitch;
    ctx.lineWidth = 9;
    ctx.stroke(h);
    ctx.restore();
    loop(ctx, 150, stitch === C.cream ? C.red : C.cream, 22);
  }

  // Half a heart, split down the middle with a jagged edge. left: the left half.
  function halfHeart(ctx, c, left) {
    const [f0, s0, t0] = [[C.red, C.dred, C.cream], [C.pink, C.dpink, C.red]][c % 2];
    const [fill, shade, stitch] = [P('p', f0), PS('p', s0), P('a', t0)];
    const h = heartPath(256, 280, 170);
    const cut = new Path2D();
    const zig = [[256, 90], [276, 150], [240, 210], [276, 270], [240, 330], [272, 390], [256, 470]];
    if (left) {
      cut.moveTo(0, 0);
      for (const [x, y] of zig) cut.lineTo(x, y);
      cut.lineTo(0, 512);
    } else {
      cut.moveTo(512, 0);
      for (const [x, y] of zig) cut.lineTo(x, y);
      cut.lineTo(512, 512);
    }
    cut.closePath();
    ctx.save();
    ctx.clip(cut);
    shape(ctx, h, fill, { shade, bounds: [86, 110, 340, 340] });
    ctx.save();
    ctx.translate(256, 280);
    ctx.scale(0.84, 0.84);
    ctx.translate(-256, -280);
    ctx.setLineDash([18, 14]);
    ctx.strokeStyle = stitch;
    ctx.lineWidth = 9;
    ctx.stroke(h);
    ctx.restore();
    ctx.restore();
    ctx.save();
    ctx.clip(h);
    ctx.strokeStyle = OL;
    ctx.lineWidth = 12;
    ctx.beginPath();
    zig.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
    // its loop sits over the middle of its own half
    ctx.save();
    ctx.translate(left ? -70 : 70, 30);
    loop(ctx, 142, stitch === C.cream ? C.red : C.cream, 20);
    ctx.restore();
  }

  // A felt bear head and shoulders with a tiny scarf, stitched round the edge.
  function feltBear(ctx, who) {
    const bubu = who === 'bubu';
    // Bubu: dark ears (outline colour). Dudu: fur ears with a dark inner patch.
    const fur = bubu ? BEAR.bubuFur : BEAR.duduFur;
    const dfur = bubu ? BEAR.bubuShade : BEAR.duduShade;
    const ear = bubu ? OL : BEAR.duduFur;
    const cheek = bubu ? BEAR.bubuCheek : BEAR.duduCheek;
    const scarf = [P('p', bubu ? C.red : C.green), PS('p', bubu ? C.dred : C.dgreen)];
    // shoulders
    const sh = new Path2D();
    sh.moveTo(130, 450);
    sh.bezierCurveTo(130, 360, 180, 330, 256, 330);
    sh.bezierCurveTo(332, 330, 382, 360, 382, 450);
    sh.closePath();
    shape(ctx, sh, fur, { shade: dfur, shine: false, bounds: [130, 330, 252, 120] });
    for (const s of [-1, 1]) shape(ctx, circle(256 + s * 118, 140, 42), ear, { shine: false, lw: 11 });
    if (!bubu) for (const s of [-1, 1]) shape(ctx, circle(256 + s * 118, 142, 18), OL, { shine: false, lw: 0.001 });
    // the wide mochi head
    const head = new Path2D();
    head.moveTo(256, 128);
    head.bezierCurveTo(372, 128, 412, 200, 410, 262);
    head.bezierCurveTo(408, 330, 350, 360, 256, 360);
    head.bezierCurveTo(162, 360, 104, 330, 102, 262);
    head.bezierCurveTo(100, 200, 140, 128, 256, 128);
    head.closePath();
    shape(ctx, head, fur, { shade: dfur, bounds: [102, 128, 308, 232] });
    ctx.fillStyle = OL;
    for (const x of [204, 308]) {
      ctx.beginPath();
      ctx.ellipse(x, 252, 13, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = hexA(cheek, 0.85);
    for (const x of [168, 344]) {
      ctx.beginPath();
      ctx.ellipse(x, 290, 30, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // a small open "u" mouth
    const mouth = new Path2D();
    mouth.moveTo(240, 278);
    mouth.quadraticCurveTo(256, 316, 272, 278);
    mouth.closePath();
    shape(ctx, mouth, BEAR.tongue, { shine: false, lw: 7 });
    // scarf
    const sc = roundRect(150, 342, 212, 44, 20);
    shape(ctx, sc, scarf[0], { shade: scarf[1], shine: false, bounds: [150, 342, 212, 44] });
    shape(ctx, roundRect(300, 370, 40, 82, 12), scarf[0], { shade: scarf[1], shine: false, bounds: [300, 370, 40, 82] });
    // stitches round the head
    ctx.save();
    ctx.translate(256, 244);
    ctx.scale(0.9, 0.88);
    ctx.translate(-256, -244);
    ctx.setLineDash([14, 12]);
    ctx.strokeStyle = bubu ? '#C9B8A6' : '#F1D2B2';
    ctx.lineWidth = 6;
    ctx.stroke(head);
    ctx.restore();
    loop(ctx, 132, C.red, 22);
  }

  function boba(ctx, c) {
    const [t0, dt0] = [[C.milk, '#B88E66'], ['#F7C6CF', '#E59BAA']][c % 2];
    const [tea, dtea] = [P('p', t0), PS('p', dt0)];
    const cup = new Path2D();
    cup.moveTo(160, 170);
    cup.lineTo(352, 170);
    cup.lineTo(328, 450);
    cup.quadraticCurveTo(256, 470, 184, 450);
    cup.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fill(cup);
    ctx.save();
    ctx.clip(cup);
    ctx.fillStyle = tea;
    ctx.fillRect(100, 220, 320, 260);
    ctx.fillStyle = dtea;
    ctx.fillRect(300, 220, 80, 260);
    ctx.fillStyle = '#3B2A22';
    const r = rng(3);
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      ctx.arc(190 + r() * 130, 400 + r() * 45, 15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = OL;
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.stroke(cup);
    // fat straw and the domed lid
    shape(ctx, roundRect(268, 60, 30, 150, 10), C.pink, { shine: false, lw: 9, bounds: [268, 60, 30, 150] });
    const lid = new Path2D();
    lid.moveTo(148, 176);
    lid.quadraticCurveTo(256, 92, 364, 176);
    lid.closePath();
    shape(ctx, lid, 'rgba(255,255,255,0.85)', { shine: true, lw: 11, bounds: [148, 120, 216, 56] });
    shape(ctx, roundRect(140, 164, 232, 24, 10), C.white, { shine: false, lw: 10 });
    loop(ctx, 120, C.gold, 20);
  }

  function plane(ctx, c) {
    const [b0, db0, t0] = [[C.cream, '#EAD9BC', C.red], ['#BFE0F7', '#8FC0E4', C.gold]][c % 2];
    const [body, dbody, tail] = [P('p', b0), PS('p', db0), P('a', t0)];
    ctx.save();
    ctx.translate(256, 290);
    ctx.rotate(-0.12);
    ctx.translate(-256, -290);
    // far wing, tail fin, body, near wing
    shape(ctx, roundRect(230, 200, 60, 70, 20), dbody, { shine: false, lw: 10 });
    const fin = new Path2D();
    fin.moveTo(380, 270);
    fin.lineTo(420, 168);
    fin.quadraticCurveTo(450, 160, 446, 196);
    fin.lineTo(430, 290);
    fin.closePath();
    shape(ctx, fin, tail, { shine: false, lw: 10, bounds: [380, 160, 70, 130] });
    const hp = heartPath(424, 214, 16);
    ctx.fillStyle = C.white;
    ctx.fill(hp);
    const fus = new Path2D();
    fus.moveTo(110, 300);
    fus.bezierCurveTo(110, 240, 200, 236, 300, 244);
    fus.bezierCurveTo(400, 252, 450, 270, 448, 300);
    fus.bezierCurveTo(446, 334, 380, 344, 280, 344);
    fus.bezierCurveTo(170, 344, 110, 350, 110, 300);
    fus.closePath();
    shape(ctx, fus, body, { shade: dbody, bounds: [110, 236, 338, 110] });
    for (const x of [200, 250, 300, 350]) shape(ctx, circle(x, 286, 14), '#7FB2E5', { shine: false, lw: 7 });
    shape(ctx, roundRect(222, 304, 74, 92, 24), body, { shade: dbody, shine: false, lw: 10, bounds: [222, 304, 74, 92] });
    ctx.restore();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(256, 40);
    ctx.lineTo(262, 250);
    ctx.stroke();
  }

  function firstXmas(ctx) {
    shape(ctx, circle(256, 280, 166), P('p', C.gold), { shade: PS('p', C.dgold), shine: false, bounds: [90, 114, 332, 332] });
    shape(ctx, circle(256, 280, 140), '#D9AE7E', { shade: '#C49465', bounds: [116, 140, 280, 280] });
    ctx.strokeStyle = 'rgba(138,90,59,0.35)';
    ctx.lineWidth = 5;
    for (const r of [40, 75, 108]) {
      ctx.beginPath();
      ctx.arc(256, 280, r, 0.3, 2.6);
      ctx.stroke();
    }
    ctx.fillStyle = OL;
    ctx.font = 'bold 108px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('2026', 256, 300);
    shape(ctx, heartPath(256, 352, 34), C.red, { shine: false, lw: 9 });
    loop(ctx, 116, C.red, 22);
  }

  // A gold heart locket with "27" on it: the 27th is the special day (the calendar starts on November 27).
  function locket(ctx, c) {
    const [g0, dg0] = [[C.gold, C.dgold], [C.silver, C.dsilver]][c % 2];
    const [gold, dgold] = [P('p', g0), PS('p', dg0)];
    const h = heartPath(256, 286, 160);
    shape(ctx, h, gold, { shade: dgold, bounds: [96, 126, 320, 320] });
    ctx.save();
    ctx.translate(256, 286);
    ctx.scale(0.8, 0.8);
    ctx.translate(-256, -286);
    ctx.strokeStyle = dgold;
    ctx.lineWidth = 8;
    ctx.stroke(h);
    ctx.restore();
    ctx.fillStyle = OL;
    ctx.font = 'bold 116px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('27', 256, 282);
    sparkle(ctx, 176, 216, 18);
    shape(ctx, circle(256, 132, 18), gold, { shine: false, lw: 9 });
    loop(ctx, 116, C.red, 22);
  }

  function stocking(ctx, c) {
    const [s0, ds0, c0] = [[C.red, C.dred, C.white], [C.green, C.dgreen, C.cream]][c % 2];
    const [sock, dsock, cuff] = [P('p', s0), PS('p', ds0), P('a', c0)];
    const s = new Path2D();
    s.moveTo(196, 200);
    s.lineTo(318, 200);
    s.lineTo(318, 340);
    s.bezierCurveTo(318, 360, 330, 372, 360, 380);
    s.bezierCurveTo(420, 396, 420, 470, 350, 470);
    s.lineTo(250, 470);
    s.bezierCurveTo(200, 470, 190, 430, 196, 390);
    s.closePath();
    shape(ctx, s, sock, { shade: dsock, bounds: [190, 200, 230, 270] });
    // heel and toe patches
    ctx.save();
    ctx.clip(s);
    ctx.fillStyle = cuff;
    ctx.beginPath();
    ctx.arc(372, 432, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(196, 452, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = OL;
    ctx.lineWidth = 12;
    ctx.lineJoin = 'round';
    ctx.stroke(s);
    shape(ctx, heartPath(258, 300, 30), cuff, { shine: false, lw: 8 });
    shape(ctx, roundRect(176, 140, 162, 78, 26), cuff, { shade: C.snowShade, shine: false, bounds: [176, 140, 162, 78] });
    loop(ctx, 142, cuff === C.white ? C.red : C.white, 24);
  }

  function snowmanOrn(ctx) {
    const scarf = P('p', C.red);
    const dscarf = PS('p', C.dred);
    shape(ctx, circle(256, 372, 98), C.white, { shade: C.snowShade, bounds: [158, 274, 196, 196] });
    shape(ctx, circle(256, 228, 74), C.white, { shade: C.snowShade, bounds: [182, 154, 148, 148] });
    // the hat
    shape(ctx, roundRect(196, 150, 120, 22, 8), '#3a3036', { shine: false, lw: 10 });
    shape(ctx, roundRect(214, 84, 84, 76, 10), '#3a3036', { shine: false, lw: 10 });
    ctx.fillStyle = scarf;
    ctx.fillRect(218, 132, 76, 16);
    // face
    ctx.fillStyle = OL;
    for (const x of [230, 282]) {
      ctx.beginPath();
      ctx.arc(x, 218, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    const nose = new Path2D();
    nose.moveTo(252, 236);
    nose.lineTo(300, 246);
    nose.lineTo(252, 252);
    nose.closePath();
    shape(ctx, nose, '#F0913A', { shine: false, lw: 6 });
    ctx.fillStyle = '#F6B5C1';
    for (const x of [214, 298]) {
      ctx.beginPath();
      ctx.ellipse(x, 248, 14, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // the scarf
    shape(ctx, roundRect(186, 286, 140, 34, 16), scarf, { shade: dscarf, shine: false, bounds: [186, 286, 140, 34] });
    shape(ctx, roundRect(282, 300, 34, 92, 12), scarf, { shade: dscarf, shine: false, bounds: [282, 300, 34, 92] });
    ctx.fillStyle = OL;
    for (const y of [360, 400, 440]) {
      ctx.beginPath();
      ctx.arc(256, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    loop(ctx, 86, C.gold, 22);
  }

  function reindeer(ctx, c) {
    const fur = P('p', [C.tan, '#B98A66'][c % 2]);
    const dfur = PS('p', [C.dtan, '#9C6F4E'][c % 2]);
    // antlers
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      const a = new Path2D();
      a.moveTo(256 + s * 60, 200);
      a.quadraticCurveTo(256 + s * 120, 150, 256 + s * 120, 80);
      a.moveTo(256 + s * 106, 140);
      a.lineTo(256 + s * 160, 120);
      a.moveTo(256 + s * 116, 104);
      a.lineTo(256 + s * 84, 74);
      ctx.strokeStyle = OL;
      ctx.lineWidth = 30;
      ctx.stroke(a);
      ctx.strokeStyle = '#E9D3B0';
      ctx.lineWidth = 16;
      ctx.stroke(a);
    }
    for (const s of [-1, 1]) shape(ctx, ellipse(256 + s * 132, 236, 46, 24, s * -0.5), fur, { shine: false, lw: 10 });
    shape(ctx, ellipse(256, 300, 122, 128), fur, { shade: dfur, bounds: [134, 172, 244, 256] });
    shape(ctx, ellipse(256, 360, 72, 56), '#F2DEC4', { shine: false, lw: 9 });
    ctx.fillStyle = OL;
    for (const x of [212, 300]) {
      ctx.beginPath();
      ctx.arc(x, 280, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#F6B5C1';
    for (const x of [184, 328]) {
      ctx.beginPath();
      ctx.ellipse(x, 318, 16, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    shape(ctx, circle(256, 336, 30), P('a', C.red), { lw: 9 });
    ctx.strokeStyle = OL;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(236, 384);
    ctx.quadraticCurveTo(256, 400, 276, 384);
    ctx.stroke();
    loop(ctx, 176, C.gold, 22);
  }

  function cocoa(ctx, c) {
    const [m0, dm0] = [[C.red, C.dred], ['#7FB2E5', '#4F7FB8']][c % 2];
    const [mug, dmug] = [P('p', m0), PS('p', dm0)];
    // handle, mug, cocoa, marshmallows, a heart
    const h = new Path2D();
    h.arc(370, 330, 58, -Math.PI / 2, Math.PI / 2);
    ctx.strokeStyle = OL;
    ctx.lineWidth = 42;
    ctx.stroke(h);
    ctx.strokeStyle = mug;
    ctx.lineWidth = 22;
    ctx.stroke(h);
    shape(ctx, roundRect(142, 210, 232, 250, 30), mug, { shade: dmug, bounds: [142, 210, 232, 250] });
    shape(ctx, ellipse(258, 214, 116, 30), '#6B4028', { shine: false, lw: 10 });
    for (const [x, y] of [[214, 200], [262, 192], [300, 208], [240, 218]]) shape(ctx, roundRect(x - 18, y - 14, 36, 28, 8), C.white, { shine: false, lw: 7 });
    shape(ctx, heartPath(258, 330, 44), C.white, { shine: false, lw: 8 });
    // steam
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    for (const x of [214, 290]) {
      ctx.beginPath();
      ctx.moveTo(x, 170);
      ctx.bezierCurveTo(x - 20, 140, x + 20, 120, x, 90);
      ctx.stroke();
    }
    loop(ctx, 206, C.gold, 22);
  }

  // ---------- picture ornaments and little animals (0.12.1) ----------
  // Cut from the Sort art into assets/tree/items/<kind>.png (tools/import-tree-items.py). Ornaments hang from a
  // ribbon loop; the little animals (SKIRT_KINDS) stand with their feet at y = FEET and sit round the tree skirt.
  const FEET = 496;
  const SKIRT_KINDS = ['reindeer-tree', 'rudolph', 'penguin', 'polar-bear', 'goose', 'reindeer-kiss', 'penguin-hug', 'teddy-gift', 'teddy-antlers', 'teddy-tree', 'teddy-sleepy'];
  const PIC_KINDS = ['snow-buddy', 'gold-bell', 'santa-star', 'bow-cane', 'ginger-santa', 'mini-tree', 'sweets', 'gift-stripe', 'gift-dots', 'holly', 'bauble-tree', 'bauble-goldflake', 'bauble-wave', 'bauble-mint', 'sock-flake', 'sock-tree', 'sock-dots', 'santa', 'wreath', 'poinsettia', 'santa-hat', 'cocoa-mug', 'ginger-house', 'candle', 'santa-sack', 'jingle-bells', ...SKIRT_KINDS];
  const isSkirt = (kind) => SKIRT_KINDS.includes(kind);
  const PICS = {};
  const picReady = (kind) => !!PICS[kind]?.complete && PICS[kind].naturalWidth > 0;

  function picture(ctx, kind) {
    const img = PICS[kind];
    if (!picReady(kind)) return;
    if (isSkirt(kind)) {
      // standing on the floor: as big as fits in 470 x 440, feet at FEET
      const k = Math.min(470 / img.naturalWidth, 440 / img.naturalHeight);
      const [w, h] = [img.naturalWidth * k, img.naturalHeight * k];
      ctx.drawImage(img, 256 - w / 2, FEET - h, w, h);
      return;
    }
    // hanging: as big as fits in 400 x 390 under a ribbon loop from the hook
    const k = Math.min(400 / img.naturalWidth, 390 / img.naturalHeight);
    const [w, h] = [img.naturalWidth * k, img.naturalHeight * k];
    const top = 100;
    loop(ctx, top + 22, C.red, 22);
    ctx.drawImage(img, 256 - w / 2, top, w, h);
  }

  const DRAW = {
    'bauble-zigzag': (ctx, c) => bauble(ctx, 'bauble-zigzag', c),
    'bauble-stripe': (ctx, c) => bauble(ctx, 'bauble-stripe', c),
    'bauble-dots': (ctx, c) => bauble(ctx, 'bauble-dots', c),
    'bauble-snow': snowGlobe,
    teardrop,
    star,
    snowflake,
    bell,
    'candy-cane': candyCane,
    pinecone,
    gingerbread,
    present,
    mitten,
    heart,
    'heart-left': (ctx, c) => halfHeart(ctx, c, true),
    'heart-right': (ctx, c) => halfHeart(ctx, c, false),
    boba,
    plane,
    dudu: (ctx) => feltBear(ctx, 'dudu'),
    bubu: (ctx) => feltBear(ctx, 'bubu'),
    'first-xmas': firstXmas,
    locket,
    stocking,
    snowman: snowmanOrn,
    reindeer,
    cocoa,
  };
  for (const kind of PIC_KINDS) DRAW[kind] = (ctx) => picture(ctx, kind);

  // Draw one ornament with its hook at (x, y), its 512 box scaled to size px. sway: radians it swings by.
  // Each ornament (kind, colourway, style, pixel size) is drawn once into a little canvas and reused: a full tree
  // twinkles at 15 frames a second without redrawing 30 ornaments' paths every frame.
  const bitmaps = new Map();
  function bitmap(kind, c, style, px) {
    const key = `${kind}|${c}|${JSON.stringify(style || {})}|${px}`;
    let cv = bitmaps.get(key);
    if (cv) return cv;
    if (bitmaps.size > 400) bitmaps.clear();
    cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const g = cv.getContext('2d');
    g.scale(px / 512, px / 512);
    OV = style || null;
    MATTE = style?.fin === 'matte';
    try {
      DRAW[kind](g, c || 0);
    } finally {
      OV = null;
      MATTE = false;
    }
    if (style?.fin === 'glitter') {
      // Glitter only lands on the ornament itself.
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      const r = rng(kind.length * 31 + (c || 0));
      for (let i = 0; i < 140; i++) {
        g.fillStyle = ['rgba(255,255,255,0.9)', 'rgba(255,236,170,0.9)', 'rgba(255,255,255,0.55)'][i % 3];
        g.beginPath();
        g.arc(r() * px, r() * px, Math.max(0.6, (px / 512) * (2 + r() * 5)), 0, Math.PI * 2);
        g.fill();
      }
      for (let i = 0; i < 6; i++) {
        g.save();
        sparkle(g, r() * px, r() * px * 0.9 + px * 0.1, (px / 512) * 22, '#fff');
        g.restore();
      }
      g.globalCompositeOperation = 'source-over';
    }
    // A picture still loading is drawn again next time instead of being kept blank.
    if (!PICS[kind] || picReady(kind)) bitmaps.set(key, cv);
    return cv;
  }

  // Draw one ornament with its hook at (x, y), its 512 box scaled to size px (style can make it smaller or bigger).
  // sway: radians it swings by. style: { p, a, pat, fin, size } (see src/main/tree.js).
  function drawOrnament(ctx, kind, c, x, y, size, sway = 0, style = null) {
    if (!DRAW[kind]) return;
    const s = size * (SIZE_K[style?.size] || 1);
    // Rendered at the canvas's real resolution, so it stays sharp when the canvas is scaled up.
    const m = ctx.getTransform();
    const px = Math.max(8, Math.min(1024, Math.round(s * Math.hypot(m.a, m.b))));
    const bmp = bitmap(kind, c, style, px);
    ctx.save();
    ctx.translate(x, y);
    if (sway) ctx.rotate(sway);
    ctx.drawImage(bmp, (-256 / 512) * s, (-40 / 512) * s, s, s);
    ctx.restore();
  }

  // ---------- the tree ----------

  // Gold tinsel garland in 3 swags, hugging the tree's outline.
  const SWAGS = [
    [[282, 398], [548, 462], 34],
    [[200, 585], [605, 680], 44],
    [[165, 800], [655, 872], 46],
  ];
  const TINSEL = { gold: [C.gold, '#FFE7A3', C.dgold], silver: ['#E6EBF2', '#FFFFFF', '#AEB6C2'], red: ['#E05A5A', '#FF9A9A', '#A8322D'] };
  function garland(ctx, kind = 'gold') {
    if (kind === 'none') return;
    const r = rng(11);
    for (const [[x1, y1], [x2, y2], sag] of SWAGS) {
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * sag]);
      }
      if (kind === 'beads') {
        // a string of red and white beads
        pts.forEach(([x, y], i) => {
          if (i % 2) return;
          const b = new Path2D();
          b.arc(x, y, 8, 0, Math.PI * 2);
          shape(ctx, b, i % 4 ? '#ffffff' : C.red, { shine: false, lw: 3 });
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.arc(x - 3, y - 3, 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
        continue;
      }
      const cols = TINSEL[kind] || TINSEL.gold;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(75,51,38,0.55)';
      ctx.lineWidth = 24;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.strokeStyle = cols[2];
      ctx.lineWidth = 18;
      ctx.stroke();
      // fluffy tinsel: little strands in three shades
      for (const [x, y] of pts)
        for (let k = 0; k < 4; k++) {
          const a = r() * Math.PI * 2;
          const l = 6 + r() * 9;
          ctx.strokeStyle = cols[Math.floor(r() * 3)];
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
          ctx.stroke();
        }
    }
  }

  // The light string: 4 loops round the tree carrying 48 bulbs. Lit bulbs twinkle in two alternating sets.
  const BULB_COLORS = ['#FF6B6B', C.gold, '#7FC8F8', '#8FE3A1', C.pink];
  const LOOPS = [
    [[300, 340], [500, 372], 18],
    [[250, 520], [575, 548], 30],
    [[180, 690], [630, 712], 30],
    [[140, 835], [665, 858], 26],
  ];
  function bulbs() {
    const out = [];
    for (const [[x1, y1], [x2, y2], sag] of LOOPS)
      for (let i = 0; i < 12; i++) {
        const t = (i + 0.5) / 12;
        out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * sag]);
      }
    return out;
  }
  const BULBS = bulbs();

  const LIGHT_SETS = {
    rainbow: BULB_COLORS,
    warm: ['#FFE08A', '#FFD27A', '#FFF0C2'],
    cool: ['#9AD8FF', '#D6F2FF', '#7FB2E5'],
    pink: ['#FF9EC2', '#FFC6DA', '#F6B5C1'],
    candy: ['#FF6B6B', '#FFFFFF'],
  };
  function lights(ctx, on, t, set = 'rainbow') {
    const BULB_COLORS = LIGHT_SETS[set] || LIGHT_SETS.rainbow;
    ctx.strokeStyle = C.dgreen;
    ctx.lineWidth = 4;
    for (const [[x1, y1], [x2, y2], sag] of LOOPS) {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const x = x1 + (x2 - x1) * u;
        const y = y1 + (y2 - y1) * u + Math.sin(u * Math.PI) * sag;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    BULBS.forEach(([x, y], i) => {
      const col = BULB_COLORS[i % BULB_COLORS.length];
      // Two sets (odd/even) take turns brightening, each bulb a little out of step.
      const phase = (t / 900 + (i % 2) * Math.PI + i * 0.37) % (Math.PI * 2);
      const level = on ? 0.55 + 0.45 * Math.max(0, Math.sin(phase)) : 0;
      if (on) {
        const g = ctx.createRadialGradient(x, y + 8, 2, x, y + 8, 30);
        g.addColorStop(0, hexA(col, 0.55 * level + 0.15));
        g.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y + 8, 30, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = C.dgreen;
      ctx.fillRect(x - 4, y - 3, 8, 7);
      ctx.beginPath();
      ctx.ellipse(x, y + 10, 7, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = on ? col : mix(col, '#555a66', 0.55);
      ctx.fill();
      ctx.strokeStyle = OL;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (on && level > 0.8) sparkle(ctx, x - 2, y + 6, 4, 'rgba(255,255,255,0.9)');
    });
  }

  function mix(a, b, f) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const [x, y] = [p(a), p(b)];
    return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(',')})`;
  }

  // The star on top: lit (with its glow and rays) or, before you've put it on together, a dashed outline.
  function topStar(ctx, on, ghost, t, topper = 'star') {
    const [x, y] = [TIP[0], TIP[1] - 20];
    const p = topper === 'heart' ? heartPath(x, y - 6, 62) : topper === 'snowflake' ? circle(x, y, 64) : topper === 'bow' ? ellipse(x, y + 10, 80, 46) : starPath(x, y, 70, 32);
    if (on && topper !== 'star') {
      // the glow, then the chosen topper
      const g = ctx.createRadialGradient(x, y, 10, x, y, 130 * (1 + 0.06 * Math.sin(t / 700)));
      g.addColorStop(0, topper === 'heart' ? 'rgba(255,170,190,0.85)' : topper === 'snowflake' ? 'rgba(200,235,255,0.85)' : 'rgba(255,200,200,0.7)');
      g.addColorStop(1, 'rgba(255,217,138,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 140, 0, Math.PI * 2);
      ctx.fill();
      if (topper === 'heart') shape(ctx, p, '#FF7A8A', { shade: '#D9506A', lw: 7, bounds: [x - 62, y - 62, 124, 124] });
      else if (topper === 'snowflake') drawOrnament(ctx, 'snowflake', 1, x, y - 82, 170);
      else {
        for (const s of [-1, 1]) shape(ctx, ellipse(x + s * 46, y, 44, 28, s * 0.35), C.red, { shade: C.dred, lw: 6, shine: false, bounds: [x + s * 46 - 44, y - 28, 88, 56] });
        shape(ctx, circle(x, y + 2, 20), C.red, { lw: 6, shine: false });
        for (const s of [-1, 1]) shape(ctx, roundRect(x + s * 22 - 10, y + 14, 20, 54, 6), C.red, { shade: C.dred, lw: 5, shine: false, bounds: [x + s * 22 - 10, y + 14, 20, 54] });
      }
      sparkle(ctx, x - 30, y - 30, 9);
      sparkle(ctx, x + 34, y + 8, 6);
      return;
    }
    if (on) {
      const pulse = 1 + 0.06 * Math.sin(t / 700);
      const g = ctx.createRadialGradient(x, y, 10, x, y, 130 * pulse);
      g.addColorStop(0, 'rgba(255,217,138,0.85)');
      g.addColorStop(1, 'rgba(255,217,138,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 130 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,231,163,0.55)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + t / 5000;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 82, y + Math.sin(a) * 82);
        ctx.lineTo(x + Math.cos(a) * 120, y + Math.sin(a) * 120);
        ctx.stroke();
      }
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = OL;
      ctx.lineWidth = 18;
      ctx.stroke(p);
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 10;
      ctx.stroke(p);
      ctx.fillStyle = C.gold;
      ctx.fill(p);
      ctx.restore();
      sparkle(ctx, x - 18, y - 16, 10);
      sparkle(ctx, x + 22, y + 4, 6);
    } else if (ghost) {
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,244,224,0.8)';
      ctx.lineWidth = 5;
      ctx.stroke(p);
      ctx.restore();
    }
  }

  // The name ribbon across the bucket.
  function plaque(ctx, name) {
    const [x, y, w, h] = [210, 1000, 380, 58];
    const p = new Path2D();
    p.moveTo(x, y);
    p.quadraticCurveTo(x + w / 2, y - 14, x + w, y);
    p.lineTo(x + w - 14, y + h / 2);
    p.lineTo(x + w, y + h);
    p.quadraticCurveTo(x + w / 2, y + h - 14, x, y + h);
    p.lineTo(x + 14, y + h / 2);
    p.closePath();
    shape(ctx, p, C.red, { shade: C.dred, shine: false, lw: 7, bounds: [x, y, w, h] });
    ctx.fillStyle = C.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 30;
    ctx.font = `bold ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
    while (ctx.measureText(name).width > w - 60 && size > 16) ctx.font = `bold ${--size}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.fillText(name, x + w / 2, y + h / 2 - 3);
  }

  // Heart halves on nearby spots of the same tree meet in the middle as one heart.
  function joinedHearts(orns) {
    const L = orns.find((o) => o.kind === 'heart-left');
    const R = orns.find((o) => o.kind === 'heart-right');
    if (!L || !R) return null;
    const [a, b] = [SLOTS[L.slot], SLOTS[R.slot]];
    if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) > JOIN) return null;
    return { L, R, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
  }

  // ---------- tree styles ----------
  // The tree's colour: the bare tree picture recoloured (the trunk and bucket stay as they are), made once per colour.
  const TREE_FILTERS = {
    frosted: 'saturate(0.25) brightness(1.35)',
    pink: 'hue-rotate(185deg) saturate(0.85) brightness(1.25)',
    gold: 'hue-rotate(-100deg) saturate(1.3) brightness(1.15)',
    midnight: 'hue-rotate(55deg) saturate(0.9) brightness(0.8)',
  };
  const tinted = {};
  function treeBase(color) {
    if (!base?.complete || !base.naturalWidth) return null;
    // Snowy is its own picture: snow along each tier, drawn from the tree's own shading.
    if (color === 'snowy') return snowyBase?.complete && snowyBase.naturalWidth ? snowyBase : base;
    if (!TREE_FILTERS[color]) return base;
    if (tinted[color]) return tinted[color];
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.filter = TREE_FILTERS[color];
    g.drawImage(base, 0, 0, W, H);
    g.filter = 'none';
    // the trunk and bucket, untinted
    g.save();
    g.beginPath();
    g.rect(0, 932, W, H - 932);
    g.clip();
    g.clearRect(0, 932, W, H - 932);
    g.drawImage(base, 0, 0, W, H);
    g.restore();
    tinted[color] = cv;
    return cv;
  }

  // A tree skirt round the bucket, seen from slightly above.
  function skirt(ctx, kind) {
    if (!kind || kind === 'none') return;
    const fill = { red: C.red, green: C.green, plaid: C.red, white: '#F4F7FC' }[kind] || C.red;
    const p = ellipse(400, 1066, 250, 40);
    shape(ctx, p, fill, { shade: kind === 'white' ? C.snowShade : darken(fill), lw: 6, shine: false, bounds: [150, 1026, 500, 80] });
    if (kind === 'plaid') {
      ctx.save();
      ctx.clip(p);
      ctx.fillStyle = 'rgba(44,90,66,0.55)';
      for (let x = 150; x < 650; x += 50) ctx.fillRect(x, 1020, 16, 90);
      ctx.fillStyle = 'rgba(242,193,78,0.6)';
      for (let y = 1030; y < 1110; y += 24) ctx.fillRect(150, y, 500, 5);
      ctx.restore();
    }
    // fluffy white trim
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * (i / 25);
      ctx.beginPath();
      ctx.arc(400 - Math.cos(a) * 248, 1066 + Math.sin(a) * 40, 11, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // spec: { stage, star, starGhost, lights, name, style: { color, garland, lights, topper, skirt },
  //         orns: [{ slot, kind, c, style }] }. opts: { t, hide: Set of slots, guides, hot, scale }
  function drawTree(ctx, spec, opts = {}) {
    const t = opts.t ?? performance.now();
    const look = spec.style || {};
    ctx.save();
    if (opts.scale) ctx.scale(opts.scale, opts.scale);
    ctx.fillStyle = 'rgba(75,51,38,0.25)';
    ctx.beginPath();
    ctx.ellipse(400, 1078, 170, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    skirt(ctx, look.skirt);
    const pic = treeBase(look.color);
    if (pic) ctx.drawImage(pic, 0, 0, W, H);
    // The garland goes up by date; the lights once their advent door is open (older specs only had a stage name).
    const stage = spec.stage || 'bare';
    const garlandOn = spec.garland ?? (stage === 'garland' || stage === 'lights');
    const lightsUp = spec.lightsUp ?? stage === 'lights';
    if (garlandOn) garland(ctx, look.garland);
    if (lightsUp) lights(ctx, !!spec.lights, t, look.lights);
    topStar(ctx, !!spec.star, !!spec.starGhost, t, look.topper);
    const orns = (spec.orns || []).filter((o) => !opts.hide?.has(o.slot));
    // The little animals round the skirt, back ones first, each with a soft shadow under its feet. The ones behind the
    // name ribbon go before it.
    const animals = orns.filter((o) => spotOf(o.slot)).sort((a, b) => spotOf(a.slot)[1] - spotOf(b.slot)[1]);
    const animal = (o) => {
      const [x, fy] = spotOf(o.slot);
      const s = ANIMAL * (SIZE_K[o.style?.size] || 1);
      ctx.fillStyle = 'rgba(75,51,38,0.22)';
      ctx.beginPath();
      ctx.ellipse(x, fy - 2, s * 0.36, s * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      drawOrnament(ctx, o.kind, o.c, x, fy - ((FEET - 40) / 512) * s, ANIMAL, 0, o.style);
    };
    animals.filter((o) => spotOf(o.slot)[2]).forEach(animal);
    if (spec.name) plaque(ctx, spec.name);
    const join = joinedHearts(orns);
    for (const o of orns) {
      if (join && (o === join.L || o === join.R)) continue;
      const [x, y] = SLOTS[o.slot] || [];
      if (x === undefined) continue;
      const sway = Math.sin(t / 1300 + o.slot) * 0.04;
      drawOrnament(ctx, o.kind, o.c, x, y, ORN, sway, o.style);
    }
    animals.filter((o) => !spotOf(o.slot)[2]).forEach(animal);
    if (join) {
      // two halves, touching, hung from the middle of their two spots, with a little burst of hearts
      drawOrnament(ctx, 'heart-left', join.L.c, join.x - 0.5, join.y, ORN * 1.15, 0, join.L.style);
      drawOrnament(ctx, 'heart-right', join.R.c, join.x + 0.5, join.y, ORN * 1.15, 0, join.R.style);
      for (const [dx, dy, s] of [[-46, 18, 9], [48, 10, 8], [-30, 78, 6], [40, 80, 7]]) {
        ctx.fillStyle = 'rgba(246,181,193,0.9)';
        ctx.fill(heartPath(join.x + dx, join.y + dy, s));
      }
    }
    if (opts.guides && opts.skirt) {
      // dragging a little animal: the free spots round the skirt
      const taken = new Set((spec.orns || []).map((o) => o.slot));
      SKIRT_SPOTS.forEach(([x, fy], k) => {
        const i = SLOTS.length + k;
        if (taken.has(i) && !opts.hide?.has(i)) return;
        const hot = opts.hot === i;
        ctx.beginPath();
        ctx.ellipse(x, fy - 4, hot ? 44 : 34, hot ? 12 : 9, 0, 0, Math.PI * 2);
        ctx.fillStyle = hot ? 'rgba(255,244,224,0.95)' : 'rgba(255,244,224,0.5)';
        ctx.fill();
        if (hot) {
          ctx.strokeStyle = C.gold;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      });
    } else if (opts.guides) {
      const taken = new Set((spec.orns || []).map((o) => o.slot));
      SLOTS.forEach(([x, y], i) => {
        if (taken.has(i) && !opts.hide?.has(i)) return;
        const hot = opts.hot === i;
        ctx.beginPath();
        ctx.arc(x, y, hot ? 16 : 9, 0, Math.PI * 2);
        ctx.fillStyle = hot ? 'rgba(255,244,224,0.95)' : 'rgba(255,244,224,0.45)';
        ctx.fill();
        if (hot) {
          ctx.strokeStyle = C.gold;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }

  // The free spot nearest (x, y) in tree coordinates, within reach (px), or -1. A little animal (kind) only goes on
  // the skirt spots, anything else only on the branch hooks.
  function nearestSlot(spec, x, y, reach = 70, allow = -1, kind = '') {
    const taken = new Set((spec.orns || []).map((o) => o.slot));
    let best = -1;
    let bd = reach;
    if (isSkirt(kind)) {
      SKIRT_SPOTS.forEach(([sx, fy], k) => {
        const i = SLOTS.length + k;
        if (taken.has(i) && i !== allow) return;
        const d = Math.hypot(sx - x, fy - ANIMAL * 0.45 - y);
        if (d < bd) [best, bd] = [i, d];
      });
      return best;
    }
    SLOTS.forEach(([sx, sy], i) => {
      if (taken.has(i) && i !== allow) return;
      // the ornament hangs below its hook: aim with the ornament's middle
      const d = Math.hypot(sx - x, sy + ORN * 0.45 - y);
      if (d < bd) [best, bd] = [i, d];
    });
    return best;
  }

  // The hung ornament (or sitting animal) under (x, y), or null.
  function ornamentAt(spec, x, y) {
    let hit = null;
    for (const o of spec.orns || []) {
      const spot = spotOf(o.slot);
      if (spot) {
        if (Math.abs(x - spot[0]) < ANIMAL * 0.4 && y > spot[1] - ANIMAL * 0.85 && y < spot[1] + 4) hit = o;
        continue;
      }
      const [sx, sy] = SLOTS[o.slot] || [];
      if (sx !== undefined && Math.abs(x - sx) < ORN * 0.42 && y > sy - 6 && y < sy + ORN * 0.9) hit = o;
    }
    return hit;
  }

  return { W, H, SLOTS, SKIRT_SPOTS, SKIRT_KINDS, PIC_KINDS, ORN, ANIMAL, KINDS: Object.keys(DRAW), PALETTE, PATTERNS, ROLES, PATTERNED, isSkirt, load, drawTree, drawOrnament, nearestSlot, ornamentAt, sparkle };
})();

if (typeof module !== 'undefined') module.exports = TreeArt;
