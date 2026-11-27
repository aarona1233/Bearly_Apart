// Draws the advent calendar: a gingerbread house with 29 doors in icing frames (November 27 to Christmas Day), Dudu
// peeking out of the chimney and Bubu waving by the corner, snow falling in front and behind. Canvas 1200 x 1500 (2x
// what's shown). Door n is season day n (src/main/tree.js): 1-4 are Nov 27-30 (labelled 27-30, with NOV over them),
// 5-29 are December 1-25 (labelled 1-25). Christmas Eve and Christmas Day are the two tall front doors, with bows.
// Behind an opened door is its reward (ornaments drawn by tree-art.js). Used by the window's Christmas tab.
/* exported CalendarArt */
/* global TreeArt */
const CalendarArt = (() => {
  const W = 1200;
  const H = 1500;
  const OL = '#4a251f';
  // The house's colours and the doors' palette follow the person's chosen look (set at the start of each draw).
  const HOUSES = {
    gingerbread: ['#c98450', '#a96a3c', 'rgba(120,70,40,0.25)'],
    strawberry: ['#EFA3B4', '#D8859A', 'rgba(160,60,90,0.22)'],
    mint: ['#9DD8C2', '#7DBCA6', 'rgba(40,110,90,0.22)'],
    chocolate: ['#7A4A2C', '#5E3820', 'rgba(30,15,5,0.3)'],
    snowy: ['#EEF3FA', '#D3DDEB', 'rgba(120,140,180,0.22)'],
  };
  const DOOR_SETS = {
    candy: ['#D9534F', '#3F7D5C', '#8FD3B6', '#F6B5C1', '#F2C14E', '#7FB2E5', '#FFF4E0'],
    pastel: ['#F6C1CC', '#BFE3D3', '#C9D8F2', '#F8E0A8', '#DCC9F0', '#FFE4D2', '#CDEBF0'],
    classic: ['#C0392B', '#2E6B4F', '#F2C14E', '#FFF4E0', '#8A2B2B', '#3F7D5C', '#D9B15C'],
    icy: ['#BFE3F7', '#E6F2FB', '#7FB2E5', '#FFFFFF', '#A9C8E8', '#D8E6F3', '#5E8FC9'],
    berry: ['#B23A6B', '#E86F9A', '#7A4D9C', '#F6B5C1', '#C15A8E', '#9C6FD0', '#FFD1E0'],
  };
  let GINGER = HOUSES.gingerbread[0];
  let GINGER_SHADE = HOUSES.gingerbread[1];
  let SPECK = HOUSES.gingerbread[2];
  const ICING = '#fffaf2';
  const ICING_SHADE = '#e6dccf';
  const RECESS = '#5e3a26';
  let DOOR_COLORS = DOOR_SETS.candy;

  const DEC = 4; // door n is December (n - DEC); doors 1-4 are November 27-30
  const LAST = 29; // Christmas Day, the big front door
  const label = (n) => (n <= DEC ? n + 26 : n - DEC);

  // Shapes by door number (art guide section 5.1): a mix of square, arched and round doors.
  const SHAPE = {};
  for (let n = 1; n < LAST; n++) SHAPE[n] = ['square', 'arch', 'round', 'square', 'arch'][n % 5];
  SHAPE[1] = 'round'; // Nov 27, our day: round, with a bow

  // Where the doors are. The wall is a 6 x 5 grid with the middle of the bottom two rows taken by the two tall front
  // doors (Christmas Eve and Christmas Day, side by side, with bows), and Nov 27 is the round door in the gable, with a
  // bow. Numbers are scattered like a real advent calendar (a fixed order, the same on every computer).
  const cols = [192, 355, 518, 682, 845, 1008];
  const rows = [722, 870, 1018, 1166, 1314];
  const cells = [];
  rows.forEach((y, j) =>
    cols.forEach((x, i) => {
      const inFront = (i === 2 || i === 3) && j >= 3;
      if (!inFront) cells.push([x, y, 116]);
    }),
  );
  const smallSpots = cells;
  const SMALL_NUMBERS = [11, 23, 6, 17, 14, 25, 9, 2, 26, 18, 7, 22, 10, 27, 19, 13, 24, 12, 21, 16, 8, 20, 15, 3, 5, 4];
  const DOORS = {};
  SMALL_NUMBERS.forEach((n, k) => {
    const [x, y, w] = smallSpots[k];
    const shape = SHAPE[n];
    const h = shape === 'arch' ? Math.round(w * 1.18) : w;
    DOORS[n] = { n, x, y, w, h, shape };
  });
  DOORS[1] = { n: 1, x: 600, y: 470, w: 160, h: 160, shape: 'round', bow: true };
  DOORS[LAST - 1] = { n: LAST - 1, x: 530, y: 1290, w: 124, h: 260, shape: 'arch', bow: true, tall: true };
  DOORS[LAST] = { n: LAST, x: 670, y: 1290, w: 124, h: 260, shape: 'arch', bow: true, tall: true };

  // Which side each door is hinged on (open doors swing that way).
  const hingeLeft = (n) => n % 2 === 1;

  let bears = null;
  function load(prefix = 'ba://asset/') {
    if (bears) return bears.ready;
    const img = (src) => {
      const i = new Image();
      i.src = src;
      return i;
    };
    bears = { dudu: img(`${prefix}happy-brown.png`), bubu: img(`${prefix}wave-cream.png`) };
    bears.ready = Promise.all([bears.dudu, bears.bubu].map((i) => i.decode().catch(() => {})));
    return bears.ready;
  }

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

  function fillStroke(ctx, p, fill, lw = 7) {
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OL;
    ctx.stroke(p);
  }

  // A door's outline path (also the hole in the wall behind it).
  function doorPath(d, inset = 0) {
    const p = new Path2D();
    const w = d.w - inset * 2;
    const h = d.h - inset * 2;
    const x = d.x - w / 2;
    const y = d.y - h / 2;
    if (d.shape === 'round') p.ellipse(d.x, d.y, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (d.shape === 'arch' || d.shape === 'double') {
      const r = w / 2;
      p.moveTo(x, y + h);
      p.lineTo(x, y + r);
      p.arc(d.x, y + r, r, Math.PI, 0);
      p.lineTo(x + w, y + h);
      p.closePath();
    } else p.roundRect(x, y, w, h, 14);
    return p;
  }

  // ---------- the house ----------

  function snow(ctx, t, front) {
    const r = rng(front ? 5 : 9);
    const n = front ? 26 : 50;
    ctx.fillStyle = front ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
    for (let i = 0; i < n; i++) {
      const size = front ? 5 + r() * 8 : 3 + r() * 5;
      const speed = front ? 0.05 + r() * 0.04 : 0.025 + r() * 0.02;
      const x0 = r() * W;
      const y = (r() * H + t * speed) % (H + 40) - 20;
      const x = x0 + Math.sin(t / 1500 + i) * 14;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function house(ctx) {
    // ground snow
    const ground = new Path2D();
    ground.moveTo(0, 1440);
    ground.bezierCurveTo(300, 1400, 900, 1400, W, 1440);
    ground.lineTo(W, H);
    ground.lineTo(0, H);
    ground.closePath();
    ctx.fillStyle = ICING;
    ctx.fill(ground);
    ctx.fillStyle = '#DDE8F5';
    ctx.beginPath();
    ctx.ellipse(600, 1478, 560, 26, 0, 0, Math.PI * 2);
    ctx.fill();

    // chimney (behind the roof)
    const ch = new Path2D();
    ch.roundRect(830, 260, 130, 300, 8);
    fillStroke(ctx, ch, GINGER);
    ctx.fillStyle = ICING;
    ctx.strokeStyle = OL;
    ctx.lineWidth = 7;
    const cap = new Path2D();
    cap.roundRect(812, 236, 166, 42, 20);
    ctx.fill(cap);
    ctx.stroke(cap);

    // the wall
    const wall = new Path2D();
    wall.roundRect(60, 640, 1080, 800, 18);
    fillStroke(ctx, wall, GINGER, 9);
    ctx.save();
    ctx.clip(wall);
    ctx.fillStyle = GINGER_SHADE;
    ctx.fillRect(60, 1380, 1080, 60);
    // gingerbread speckles
    const r = rng(3);
    ctx.fillStyle = SPECK;
    for (let i = 0; i < 140; i++) {
      ctx.beginPath();
      ctx.arc(60 + r() * 1080, 640 + r() * 800, 2 + r() * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // the gable and the iced roof
    const gable = new Path2D();
    gable.moveTo(90, 650);
    gable.lineTo(600, 200);
    gable.lineTo(1110, 650);
    gable.closePath();
    fillStroke(ctx, gable, GINGER, 9);
    const roof = new Path2D();
    roof.moveTo(20, 680);
    roof.lineTo(600, 150);
    roof.lineTo(1180, 680);
    roof.lineTo(1120, 700);
    roof.lineTo(600, 250);
    roof.lineTo(80, 700);
    roof.closePath();
    fillStroke(ctx, roof, ICING, 9);
    // icing drips along the eaves
    ctx.fillStyle = ICING;
    ctx.strokeStyle = OL;
    ctx.lineWidth = 6;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        const u = (k + 0.5) / 9;
        const x = 600 + side * (40 + u * 500);
        const y = 250 + u * 450 * (500 / 520);
        const len = 26 + ((k * 37) % 30);
        const drip = new Path2D();
        drip.moveTo(x - 16, y - 4);
        drip.quadraticCurveTo(x - 14, y + len, x, y + len + 8);
        drip.quadraticCurveTo(x + 14, y + len, x + 16, y - 4);
        ctx.fill(drip);
        ctx.stroke(drip);
      }
    }
    // gumdrops along the roof
    const gum = ['#D9534F', '#3F7D5C', '#F2C14E', '#F6B5C1', '#7FB2E5'];
    for (const side of [-1, 1])
      for (let k = 0; k < 7; k++) {
        const u = (k + 0.7) / 8;
        const x = 600 + side * u * 560;
        const y = 165 + u * 520 - 16;
        ctx.fillStyle = gum[(k + (side > 0 ? 2 : 0)) % gum.length];
        ctx.beginPath();
        ctx.ellipse(x, y, 16, 14, 0, Math.PI, 0);
        ctx.lineTo(x + 16, y + 6);
        ctx.lineTo(x - 16, y + 6);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.stroke();
      }
    // candy canes on the corners
    for (const x of [78, 1122]) {
      const cane = new Path2D();
      cane.moveTo(x, 1440);
      cane.lineTo(x, 760);
      cane.arc(x + (x < 600 ? 34 : -34), 760, 34, Math.PI * (x < 600 ? 1 : 0), Math.PI * (x < 600 ? 2 : 1), x >= 600);
      ctx.lineCap = 'round';
      ctx.strokeStyle = OL;
      ctx.lineWidth = 40;
      ctx.stroke(cane);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 28;
      ctx.stroke(cane);
      ctx.save();
      ctx.setLineDash([22, 24]);
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#D9534F';
      ctx.stroke(cane);
      ctx.restore();
    }
  }

  function bearsOver(ctx) {
    if (!bears) return;
    // Dudu peeking out of the chimney (only his head shows above the cap).
    if (bears.dudu.complete && bears.dudu.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(780, 0, 230, 250);
      ctx.clip();
      ctx.drawImage(bears.dudu, 815, 105, 160, 160);
      ctx.restore();
    }
    // Bubu waving by the left corner.
    if (bears.bubu.complete && bears.bubu.naturalWidth) ctx.drawImage(bears.bubu, -28, 1330, 140, 140);
  }

  // ---------- the doors ----------

  function doorColor(n) {
    return DOOR_COLORS[(n * 3) % DOOR_COLORS.length];
  }

  function isDark(hex) {
    const v = parseInt(hex.slice(1), 16);
    return ((v >> 16) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11) < 150;
  }

  function number(ctx, d, color) {
    const big = d.w > 150 || !!d.tall;
    ctx.font = `bold ${big ? 78 : 50}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = d.y + (d.shape === 'arch' ? 10 : d.shape === 'double' ? 20 : 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = isDark(color) ? OL : '#fff';
    ctx.strokeText(String(label(d.n)), d.x, y);
    ctx.fillStyle = isDark(color) ? '#FFF4E0' : OL;
    ctx.fillText(String(label(d.n)), d.x, y);
    // November's doors say so over the number.
    if (d.n <= DEC) {
      ctx.font = `bold ${big ? 30 : 22}px "Trebuchet MS", "Segoe UI", sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeText('NOV', d.x, y - (big ? 44 : 34));
      ctx.fillText('NOV', d.x, y - (big ? 44 : 34));
    }
  }

  // The closed door: candy colour, an icing frame, its number, and the big doors' extras.
  function closedDoor(ctx, d, wiggle = 0) {
    const color = doorColor(d.n);
    ctx.save();
    if (wiggle) {
      ctx.translate(d.x, d.y);
      ctx.rotate(wiggle);
      ctx.translate(-d.x, -d.y);
    }
    // icing frame
    const frame = doorPath({ ...d, w: d.w + 22, h: d.h + 22 });
    fillStroke(ctx, frame, ICING, 6);
    const p = doorPath(d);
    fillStroke(ctx, p, color, 6);
    // one soft shade on the lower right
    ctx.save();
    ctx.clip(p);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(d.x + d.w * 0.45, d.y + d.h * 0.5, d.w * 0.5, d.h * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (d.shape === 'double') {
      ctx.strokeStyle = OL;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - d.h / 2 + 30);
      ctx.lineTo(d.x, d.y + d.h / 2);
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#F2C14E';
        ctx.beginPath();
        ctx.arc(d.x + s * 22, d.y + 40, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // knob
    if (d.shape !== 'double') {
      const kx = d.x + (hingeLeft(d.n) ? 1 : -1) * d.w * 0.32;
      ctx.fillStyle = '#F2C14E';
      ctx.strokeStyle = OL;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(kx, d.y + d.h * 0.18, d.w > 150 ? 10 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    number(ctx, d, color);
    ctx.restore();
    if (d.bow) bow(ctx, d.x, d.y - d.h / 2 - 6);
  }

  function bow(ctx, x, y) {
    for (const s of [-1, 1]) {
      const p = new Path2D();
      p.ellipse(x + s * 44, y - 6, 46, 26, s * 0.4, 0, Math.PI * 2);
      fillStroke(ctx, p, '#D9534F', 6);
    }
    const k = new Path2D();
    k.arc(x, y - 2, 18, 0, Math.PI * 2);
    fillStroke(ctx, k, '#D9534F', 6);
  }

  // The recess behind a door and what's in it.
  function inside(ctx, d, reward) {
    const p = doorPath(d);
    ctx.save();
    ctx.fillStyle = RECESS;
    ctx.fill(p);
    ctx.clip(p);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(d.x - d.w / 2, d.y - d.h / 2, d.w, 16);
    ctx.fillStyle = 'rgba(255,217,138,0.18)';
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + d.h * 0.1, d.w * 0.45, d.h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (reward) icon(ctx, reward, d.x, d.y, Math.min(d.w, d.h) * 0.9);
  }

  // The little picture of a reward, centred on (x, y), about size px.
  function icon(ctx, r, x, y, size) {
    if (r.kind === 'ornament' && r.item) return TreeArt.drawOrnament(ctx, r.item, r.c || 0, x, y - size * 0.5, size * 1.05);
    if (r.kind === 'star') return TreeArt.drawOrnament(ctx, 'star', 0, x, y - size * 0.5, size);
    if (r.kind === 'snow') return TreeArt.drawOrnament(ctx, 'snowflake', 0, x, y - size * 0.46, size * 0.95);
    // a note: a cream envelope with a heart seal
    const w = size * 0.8;
    const h = size * 0.56;
    const env = new Path2D();
    env.roundRect(x - w / 2, y - h / 2, w, h, 6);
    fillStroke(ctx, env, '#FFF4E0', Math.max(3, size / 28));
    ctx.beginPath();
    ctx.moveTo(x - w / 2 + 4, y - h / 2 + 4);
    ctx.lineTo(x, y + 4);
    ctx.lineTo(x + w / 2 - 4, y - h / 2 + 4);
    ctx.stroke();
    ctx.fillStyle = '#D9534F';
    const s = size * 0.12;
    ctx.beginPath();
    ctx.moveTo(x, y + 4 + s);
    ctx.bezierCurveTo(x - s * 1.6, y + 4 - s * 0.2, x - s * 0.6, y + 4 - s * 1.4, x, y + 4 - s * 0.5);
    ctx.bezierCurveTo(x + s * 0.6, y + 4 - s * 1.4, x + s * 1.6, y + 4 - s * 0.2, x, y + 4 + s);
    ctx.fill();
  }

  // The door swung open on its hinge: a narrow panel showing its plain back. open: 0 (shut) .. 1 (open).
  function openDoor(ctx, d, open) {
    const left = hingeLeft(d.n);
    const k = Math.cos(open * Math.PI * 0.62); // 1 → about -0.35 (swung past 90 degrees, seen from the side)
    const color = doorColor(d.n);
    ctx.save();
    const hx = left ? d.x - d.w / 2 : d.x + d.w / 2;
    ctx.translate(hx, d.y);
    ctx.scale(k, 1);
    ctx.translate(-hx, -d.y);
    if (k < 0) {
      // the back of the door: same shape, plainer and a little darker
      const p = doorPath(d);
      fillStroke(ctx, p, shade(color), 6 / Math.max(0.35, Math.abs(k)));
    } else {
      closedDoor(ctx, d);
    }
    ctx.restore();
  }

  function shade(hex) {
    const v = parseInt(hex.slice(1), 16);
    const f = (c) => Math.round(c * 0.72);
    return `rgb(${f(v >> 16)},${f((v >> 8) & 255)},${f(v & 255)})`;
  }

  // ---------- events: what happens on the calendar after each door opens ----------
  // Each door has an event. Some leave something behind for the rest of December (a bite out of the house, a bigger
  // snowman, lights on the roof, deeper snow, presents), so the house changes as the month goes on.
  // Day by day (Nov 27..Dec 23 in order, then the star on Christmas Eve and a mistletoe kiss on Christmas Day). Snowman
  // days build it in 4 steps; 4 nibble days, 4 bites. Nov 27, our day, starts with a love letter.
  const CYCLE = ['letter', 'chimney', 'boba', 'dance', 'snowman', 'chimney', 'nibble', 'lights', 'santa', 'snowball', 'snowman', 'nibble', 'dance', 'gingerbread', 'snowstorm', 'mistletoe', 'shooting-star', 'snowman', 'nibble', 'plop', 'boba', 'goodnight', 'snowball', 'nibble', 'snowman', 'letter', 'snowstorm'];
  const SPECIAL = { [24 + DEC]: 'star', [LAST]: 'mistletoe' };
  const eventFor = (day) => SPECIAL[day] || CYCLE[(day - 1) % CYCLE.length];
  const EVENT_MS = { snowman: 4200, chimney: 4500, nibble: 5600, lights: 4200, 'shooting-star': 3600, dance: 5200, snowstorm: 5200, boba: 4800, star: 6500, santa: 5000, snowball: 6200, gingerbread: 5200, mistletoe: 5400, goodnight: 6000, plop: 4600, letter: 5000 };

  // What the opened doors have left on the house so far.
  function progress(spec) {
    const p = { snowman: 0, nibble: 0, lights: false, snowstorm: 0, star: false };
    for (const door of spec.doors || []) {
      if (!door.opened) continue;
      const e = eventFor(door.d);
      if (e === 'snowman' || e === 'nibble' || e === 'snowstorm') p[e]++;
      if (e === 'lights' || e === 'star') p[e] = true;
    }
    return p;
  }

  // The line shown on the calendar while an event plays.
  function eventText(type, prog) {
    const snowman = ['Someone started a snowman ⛄', 'The snowman is getting bigger ⛄', 'The snowman has a head now ⛄', 'The snowman is finished! ⛄🧣'];
    return {
      snowman: snowman[Math.max(0, Math.min(3, prog.snowman - 1))],
      chimney: 'Dudu says hi from the chimney 👋',
      nibble: 'Bubu took a bite out of the house! 🍪',
      lights: 'The roof lights are on ✨',
      'shooting-star': 'A shooting star, make a wish 🌠',
      dance: 'Dance party in front of the house 💃',
      snowstorm: 'A snowstorm! Snow is piling up on the roof ❄️',
      boba: 'Boba break 🧋',
      star: 'Christmas Eve ⭐ Presents are here!',
      santa: 'Wait… is that Santa?! 🦌',
      snowball: 'Snowball fight! ❄️',
      gingerbread: 'The gingerbread man got away! 🍪',
      mistletoe: 'Caught under the mistletoe 💋',
      goodnight: 'A cozy night in 🌙',
      plop: 'Plop! Snow slid off the roof 😳',
      letter: 'A love letter flew in 💌',
    }[type];
  }

  // Where the bears go for an event (calendar coordinates: centre x, feet y, width). The window shows them as live
  // animations over the canvas.
  const HOME = { dudu: { src: 'happy-brown.png', x: 895, y: 262, w: 160 }, bubu: { src: 'wave-cream.png', x: 42, y: 1470, w: 140 } };
  // Where Bubu bites: points on the roof's two slopes (side -1 left, 1 right), alternating sides.
  const BITES = [[293, 431, -1], [994, 510, 1], [148, 563, -1], [716, 256, 1], [438, 298, -1], [1099, 608, 1]];
  // Where her bite is in bubu-bite-*.png (made by cutting Dudu out of her biting-his-head GIF), as fractions.
  const BITE_MOUTH = { right: [0.801, 0.453], left: [0.199, 0.453] };
  // A picture placed so that point (fx, fy) of it lands on (px, py): returns centre x and feet y.
  const at = (px, py, w, [fx, fy]) => ({ x: px - fx * w + w / 2, y: py - fy * w + w });
  const B = (src, x, y, w, more = {}) => ({ src, x, y, w, ...more });
  function eventBears(type, prog) {
    const [bx, by, side] = BITES[Math.max(0, prog.nibble - 1) % BITES.length];
    const bw = 270;
    const mouth = side < 0 ? BITE_MOUTH.right : BITE_MOUTH.left;
    const bite = at(bx, by, bw, mouth);
    const D = HOME.dudu;
    const U = HOME.bubu;
    return (
      {
        // Bubu outside the roof, her face pressed into its edge, chomping (the bite appears under her mouth).
        nibble: [B(side < 0 ? 'bubu-bite-right.png' : 'bubu-bite-left.png', bite.x, bite.y, bw, { hide: 'bubu' })],
        chimney: [{ src: 'wave-brown.png', x: HOME.dudu.x, y: HOME.dudu.y, w: 170, hide: 'dudu' }],
        // Dudu throws from the chimney and gets Bubu; she fumes, throws one back and gets him.
        snowball: [
          B('happy-brown.png', D.x, D.y, D.w, { hide: 'dudu', to: 3900 }),
          B('cry-brown.png', D.x, D.y, D.w, { hide: 'dudu', from: 3900 }),
          B('wave-cream.png', U.x, U.y, U.w, { hide: 'bubu', to: 1300 }),
          B('angry-cream.png', U.x, U.y, U.w, { hide: 'bubu', from: 1300, to: 3200 }),
          B('happy-cream.png', U.x, U.y, U.w, { hide: 'bubu', from: 3200 }),
        ],
        // The gingerbread man runs off across the snow, Bubu right behind him.
        gingerbread: [B('happy-cream.png', 1330, 1495, 170, { hide: 'bubu', x2: -160, from: 700, to: 4900 })],
        mistletoe: [B('pair-kiss.png', 600, 1495, 250, { from: 400 })],
        goodnight: [B('pair-goodnight.png', 600, 1495, 280, { from: 600 })],
        // Snow slides off the roof onto Bubu: she's buried and sad, then shakes it off.
        plop: [
          B('happy-cream.png', U.x, U.y, U.w, { hide: 'bubu', to: 1300 }),
          B('cry-cream.png', U.x + 10, U.y, U.w, { hide: 'bubu', from: 1300 }),
        ],
        letter: [B('letter-cream.png', 600, 1495, 230, { from: 1700 })],
        dance: [
          { src: 'dance-cream.png', x: 330, y: 1495, w: 190 },
          { src: 'dance-brown.png', x: 870, y: 1495, w: 190 },
        ],
        boba: [
          { src: 'boba-cream.png', x: 300, y: 1495, w: 180 },
          { src: 'boba-brown.png', x: 900, y: 1495, w: 180 },
        ],
        star: [{ src: 'pair-hug.png', x: 600, y: 1495, w: 230 }],
      }[type] || []
    );
  }

  // The wall and roof as one shape (bites are taken out of its edges).
  function houseShape() {
    const p = new Path2D();
    p.roundRect(60, 640, 1080, 800, 18);
    p.moveTo(20, 680);
    p.lineTo(600, 150);
    p.lineTo(1180, 680);
    p.closePath();
    return p;
  }

  // Bites out of the roof's edges: scalloped holes with a brown edge, and crumbs falling while she chomps.
  function bites(ctx, n, fresh) {
    for (let i = 0; i < Math.min(n, BITES.length); i++) {
      const [x, y, side] = BITES[i];
      const k = i === n - 1 && fresh !== null ? Math.min(1, fresh) : 1;
      if (k <= 0) continue;
      // along the slope, and into the roof
      const [ax, ay] = side < 0 ? [0.738, -0.675] : [0.738, 0.675];
      const [nx, ny] = side < 0 ? [0.675, 0.738] : [-0.675, 0.738];
      const circles = [
        [x + nx * 6 * k, y + ny * 6 * k, 30 * k],
        [x + (ax * 26 + nx * 10) * k, y + (ay * 26 + ny * 10) * k, 22 * k],
        [x + (-ax * 26 + nx * 10) * k, y + (-ay * 26 + ny * 10) * k, 22 * k],
      ];
      if (i === n - 1 && fresh !== null && fresh > 0 && fresh < 6) {
        // crumbs while she chomps
        const r = rng(i + 9);
        ctx.fillStyle = GINGER;
        for (let c = 0; c < 14; c++) {
          const u = ((fresh * 1.6 + r()) % 1);
          ctx.beginPath();
          ctx.arc(x + nx * 20 + (r() - 0.5) * 60, y + ny * 20 + u * 220, 3 + r() * 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (const [cx, cy, r] of circles) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.clip(houseShape());
      ctx.strokeStyle = OL;
      ctx.lineWidth = 6;
      for (const [cx, cy, r] of circles) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // The snowman in the yard, built over the snowman days: 1 base, 2 body, 3 head, 4 hat, scarf and arms.
  function snowman(ctx, stage, grow) {
    if (!stage) return;
    const x = 1128;
    const parts = [[1446, 44], [1374, 34], [1318, 26]];
    for (let i = 0; i < Math.min(3, stage); i++) {
      const [y, r] = parts[i];
      const k = i === stage - 1 && grow !== null ? Math.min(1, grow) : 1;
      if (k <= 0) continue;
      const p = new Path2D();
      p.arc(x, y + r * (1 - k), r * k, 0, Math.PI * 2);
      fillStroke(ctx, p, '#ffffff', 6);
      ctx.save();
      ctx.clip(p);
      ctx.fillStyle = '#DDE8F5';
      ctx.beginPath();
      ctx.arc(x + r * 0.35, y + r * 0.4, r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = OL;
      ctx.lineWidth = 6;
      ctx.stroke(p);
    }
    if (stage >= 3) {
      ctx.fillStyle = OL;
      for (const dx of [-9, 9]) {
        ctx.beginPath();
        ctx.arc(x + dx, 1312, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#F29A3A';
      ctx.beginPath();
      ctx.moveTo(x, 1318);
      ctx.lineTo(x - 22, 1324);
      ctx.lineTo(x, 1326);
      ctx.fill();
      for (const dy of [1364, 1384]) {
        ctx.beginPath();
        ctx.arc(x, dy, 4, 0, Math.PI * 2);
        ctx.fillStyle = OL;
        ctx.fill();
      }
    }
    if (stage >= 4) {
      const k = grow !== null ? Math.min(1, grow) : 1;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#7a4a2c';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x - 30, 1372);
      ctx.lineTo(x - 66, 1348);
      ctx.moveTo(x + 30, 1372);
      ctx.lineTo(x + 62, 1350);
      ctx.stroke();
      const scarf = new Path2D();
      scarf.roundRect(x - 30, 1336, 60, 16, 8);
      scarf.roundRect(x + 8, 1340, 14, 34, 6);
      fillStroke(ctx, scarf, '#D9534F', 4);
      const hat = new Path2D();
      hat.roundRect(x - 26, 1288, 52, 10, 4);
      hat.roundRect(x - 17, 1258, 34, 34, 5);
      fillStroke(ctx, hat, '#3a2a2a', 4);
      ctx.restore();
    }
  }

  // Fairy lights along both roof slopes. on: 0..1 (how far along the string they've come on).
  function roofLights(ctx, on, t) {
    const colors = ['#FF6B6B', '#F2C14E', '#7FC8F8', '#8FE3A1', '#F6B5C1'];
    for (const side of [-1, 1])
      for (let i = 0; i < 12; i++) {
        const u = (i + 0.5) / 12;
        const x = 600 + side * (30 + u * 520);
        const y = 214 + u * 478 + 8 * Math.sin(u * Math.PI * 6);
        const lit = (side < 0 ? (11 - i) / 12 : (12 + i) / 24) <= on || on >= 1;
        const c = colors[(i + (side > 0 ? 2 : 0)) % colors.length];
        const tw = 0.6 + 0.4 * Math.sin(t / 400 + i * 1.3 + side);
        if (lit) {
          const g = ctx.createRadialGradient(x, y + 10, 1, x, y + 10, 24);
          g.addColorStop(0, `rgba(255,240,200,${0.6 * tw})`);
          g.addColorStop(1, 'rgba(255,240,200,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y + 10, 24, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.ellipse(x, y + 10, 6, 8, 0, 0, Math.PI * 2);
        ctx.fillStyle = lit ? c : '#6b6f7a';
        ctx.fill();
        ctx.strokeStyle = OL;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
  }

  // Extra snow on the roof after each snowstorm (n), growing in during the storm (grow).
  function roofSnow(ctx, n, grow) {
    if (!n) return;
    // 9 px more per storm (up to 4), the newest one growing in.
    const depth = 9 * Math.min(4, n - 1 + (grow !== null ? Math.min(1, grow) : 1));
    if (depth <= 0) return;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = OL;
    ctx.lineWidth = 6;
    for (const side of [-1, 1]) {
      const p = new Path2D();
      p.moveTo(600, 150 - depth);
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        p.lineTo(600 + side * u * 560, 150 + u * 520 - depth - Math.sin(u * Math.PI * 4) * 6);
      }
      p.lineTo(600 + side * 560, 150 + 520);
      p.lineTo(600, 150);
      p.closePath();
      ctx.fill(p);
      ctx.stroke(p);
    }
  }

  // Smoke puffs out of the chimney, always; bigger ones (and hearts) when Dudu waves.
  function smoke(ctx, t, big) {
    for (let i = 0; i < (big ? 6 : 3); i++) {
      const u = ((t / (big ? 1300 : 2600) + i / (big ? 6 : 3)) % 1 + 1) % 1;
      const x = 895 + Math.sin(u * 5 + i) * 18 + u * 40;
      const y = 236 - u * (big ? 220 : 160);
      ctx.fillStyle = `rgba(235,235,245,${0.75 * (1 - u)})`;
      ctx.beginPath();
      ctx.arc(x, y, (big ? 18 : 12) + u * (big ? 30 : 18), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Presents by the front door (Christmas Day and after), dropping in when they first appear.
  function presents(ctx, drop) {
    const k = drop !== null ? Math.min(1, drop) : 1;
    const fall = (1 - k) * (1 - k) * 260;
    const boxes = [[440, 1428, 66, 58, '#D9534F', '#F2C14E'], [760, 1428, 70, 52, '#3F7D5C', '#D9534F'], [452, 1376, 46, 40, '#F2C14E', '#D9534F']];
    for (const [x, y, w, h, paper, ribbon] of boxes) {
      const p = new Path2D();
      p.roundRect(x - w / 2, y - h - fall, w, h, 6);
      fillStroke(ctx, p, paper, 5);
      ctx.fillStyle = ribbon;
      ctx.fillRect(x - 6, y - h - fall + 3, 12, h - 6);
      const bowP = new Path2D();
      bowP.ellipse(x - 12, y - h - fall - 6, 12, 8, 0.4, 0, Math.PI * 2);
      bowP.ellipse(x + 12, y - h - fall - 6, 12, 8, -0.4, 0, Math.PI * 2);
      fillStroke(ctx, bowP, ribbon, 4);
    }
  }

  // ---------- the moment a door opens ----------
  // The timeline (ms after the click): 0-450 the door shakes, 450-1150 it swings open with a burst of sparkles and
  // confetti and a beam of light; the reward rises out big (500-2200) and settles back in; snow flurries. The day's
  // event starts at 1300.
  const SHAKE = 450;
  const SWING = 700;
  const EVENT_AT = 1300;

  const particles = (() => {
    const r = rng(42);
    return [...Array(46)].map((_, i) => ({ a: r() * Math.PI * 2, v: 0.35 + r() * 0.55, s: 6 + r() * 10, kind: i % 3, c: ['#F2C14E', '#FF6B6B', '#8FE3A1', '#7FC8F8', '#F6B5C1', '#ffffff'][i % 6], spin: r() * 6 }));
  })();

  function burst(ctx, d, e) {
    // e: ms since the door started swinging
    if (e < 0 || e > 1800) return;
    // a beam of warm light out of the doorway
    const beam = Math.max(0, 1 - Math.abs(e - 400) / 900);
    if (beam > 0) {
      ctx.save();
      ctx.globalAlpha = beam * 0.7;
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i - 4.5) * 0.28 + Math.sin(e / 300 + i) * 0.05;
        const g = ctx.createLinearGradient(d.x, d.y, d.x + Math.cos(a) * 320, d.y + Math.sin(a) * 320);
        g.addColorStop(0, 'rgba(255,230,160,0.9)');
        g.addColorStop(1, 'rgba(255,230,160,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + Math.cos(a - 0.08) * 320, d.y + Math.sin(a - 0.08) * 320);
        ctx.lineTo(d.x + Math.cos(a + 0.08) * 320, d.y + Math.sin(a + 0.08) * 320);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    // sparkles and confetti flying out, falling with gravity
    const tt = e / 1000;
    for (const p of particles) {
      const x = d.x + Math.cos(p.a) * p.v * 700 * tt;
      const y = d.y + Math.sin(p.a) * p.v * 700 * tt + 900 * tt * tt;
      const alpha = Math.max(0, 1 - e / 1800);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.kind === 0) TreeArt.sparkle(ctx, x, y, p.s * 1.4, '#FFE9A3');
      else {
        ctx.translate(x, y);
        ctx.rotate(p.spin + tt * 8);
        ctx.fillStyle = p.c;
        if (p.kind === 1) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        else {
          ctx.beginPath();
          ctx.arc(0, 0, p.s / 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // The reward rising out of the door, big, then settling back in.
  function rewardPop(ctx, d, reward, e) {
    if (!reward || e < 50 || e > 1750) return;
    const u = e / 1750;
    const up = u < 0.35 ? u / 0.35 : u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
    const ease = 1 - (1 - up) * (1 - up);
    const tx = 600;
    const ty = 760;
    const x = d.x + (tx - d.x) * ease;
    const y = d.y + (ty - d.y) * ease;
    const size = Math.min(d.w, d.h) * 0.9 + 300 * ease;
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 10, x, y, size * 0.9);
    g.addColorStop(0, `rgba(255,236,170,${0.85 * ease})`);
    g.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.9, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + e / 600;
      TreeArt.sparkle(ctx, x + Math.cos(a) * size * 0.62, y + Math.sin(a) * size * 0.62, 10 + 6 * Math.sin(e / 120 + i), '#fff');
    }
    icon(ctx, reward, x, y, size);
    ctx.restore();
  }

  // ---------- the events' own effects on the canvas ----------

  function shootingStar(ctx, u) {
    if (u < 0 || u > 1) return;
    const x = 120 + u * 1000;
    const y = 120 + u * 180;
    const g = ctx.createLinearGradient(x - 260, y - 50, x, y);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,245,200,0.95)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 260, y - 50);
    ctx.lineTo(x, y);
    ctx.stroke();
    TreeArt.sparkle(ctx, x, y, 22, '#FFF2B0');
  }

  function heavySnow(ctx, e, ms) {
    const r = rng(77);
    const fade = Math.min(1, e / 500, (ms - e) / 700);
    if (fade <= 0) return;
    ctx.fillStyle = `rgba(255,255,255,${0.9 * fade})`;
    for (let i = 0; i < 160; i++) {
      const x0 = r() * W;
      const speed = 0.35 + r() * 0.35;
      const size = 3 + r() * 7;
      const y = (r() * H + e * speed) % (H + 40) - 20;
      const x = x0 + e * 0.12 + Math.sin(e / 500 + i) * 20;
      ctx.beginPath();
      ctx.arc(x % W, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function confetti(ctx, e, ms) {
    const r = rng(5);
    const fade = Math.min(1, (ms - e) / 800);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    for (let i = 0; i < 90; i++) {
      const x = r() * W + Math.sin(e / 300 + i) * 30;
      const y = -40 + ((r() * 600 + e * (0.3 + r() * 0.3)) % (H + 80));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(e / 200 + i);
      ctx.fillStyle = ['#D9534F', '#F2C14E', '#3F7D5C', '#7FC8F8', '#F6B5C1', '#ffffff'][i % 6];
      ctx.fillRect(-8, -4, 16, 8);
      ctx.restore();
    }
    ctx.restore();
  }

  function bigStarGlow(ctx, e) {
    const k = Math.min(1, e / 800);
    const x = 600;
    const y = 120;
    const g = ctx.createRadialGradient(x, y, 10, x, y, 360 * k);
    g.addColorStop(0, 'rgba(255,225,140,0.85)');
    g.addColorStop(1, 'rgba(255,225,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 360 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,190,0.7)';
    ctx.lineWidth = 6;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + e / 2000;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 90, y + Math.sin(a) * 90);
      ctx.lineTo(x + Math.cos(a) * (150 + 120 * k), y + Math.sin(a) * (150 + 120 * k));
      ctx.stroke();
    }
    TreeArt.drawOrnament(ctx, 'star', 0, x, y - 90 * k, 170 * k + 1);
  }

  // ---------- the little scenes ----------

  // The moon, always up in the top-left of the sky.
  function moon(ctx, bright = 0) {
    const g = ctx.createRadialGradient(150, 120, 30, 150, 120, 150 + bright * 80);
    g.addColorStop(0, `rgba(255,248,220,${0.35 + bright * 0.3})`);
    g.addColorStop(1, 'rgba(255,248,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(150, 120, 150 + bright * 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFF6D8';
    ctx.beginPath();
    ctx.arc(150, 120, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(220,210,170,0.6)';
    for (const [x, y, r] of [[132, 104, 10], [170, 138, 7], [160, 100, 5]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Santa's sleigh and two reindeer, in silhouette, crossing the sky (u: 0..1) with a sparkle trail.
  function sleigh(ctx, u, t) {
    if (u < 0 || u > 1) return;
    const x = -260 + u * 1720;
    const y = 150 - Math.sin(u * Math.PI) * 70;
    const r = rng(3);
    for (let i = 0; i < 16; i++) TreeArt.sparkle(ctx, x - 40 - i * 26 + r() * 10, y + 10 + Math.sin(i + t / 200) * 8, 9 - i * 0.4, `rgba(255,233,163,${1 - i / 16})`);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#1b2440';
    ctx.strokeStyle = '#1b2440';
    ctx.lineWidth = 4;
    // sleigh with Santa
    ctx.beginPath();
    ctx.moveTo(-60, 0);
    ctx.quadraticCurveTo(-70, 30, -30, 34);
    ctx.lineTo(30, 34);
    ctx.quadraticCurveTo(44, 30, 40, 4);
    ctx.lineTo(-60, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-74, 44);
    ctx.quadraticCurveTo(10, 50, 52, 40);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-14, -14, 20, 0, Math.PI * 2);
    ctx.arc(-14, -40, 12, 0, Math.PI * 2);
    ctx.fill();
    // reins and two reindeer, legs galloping
    ctx.beginPath();
    ctx.moveTo(30, 6);
    ctx.lineTo(150, -6);
    ctx.stroke();
    const gallop = Math.sin(t / 90);
    for (const dx of [110, 200]) {
      ctx.beginPath();
      ctx.ellipse(dx, -4, 32, 14, -0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(dx + 34, -22, 11, 9, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(dx + 30, -30);
      ctx.lineTo(dx + 24, -50);
      ctx.moveTo(dx + 27, -42);
      ctx.lineTo(dx + 16, -48);
      ctx.moveTo(dx + 38, -30);
      ctx.lineTo(dx + 44, -50);
      ctx.moveTo(dx + 41, -42);
      ctx.lineTo(dx + 52, -46);
      for (const [lx, s] of [[-18, 1], [-8, -1], [14, 1], [24, -1]]) {
        ctx.moveTo(dx + lx, 6);
        ctx.lineTo(dx + lx + 10 * gallop * s, 24);
      }
      ctx.stroke();
    }
    // Rudolph's nose
    ctx.fillStyle = '#FF5A5A';
    ctx.beginPath();
    ctx.arc(254, -20, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function snowballAt(ctx, from, to, u, lift = 260) {
    if (u < 0 || u > 1) return;
    const x = from[0] + (to[0] - from[0]) * u;
    const y = from[1] + (to[1] - from[1]) * u - Math.sin(u * Math.PI) * lift;
    const p = new Path2D();
    p.arc(x, y, 18, 0, Math.PI * 2);
    fillStroke(ctx, p, '#ffffff', 5);
  }

  function splat(ctx, x, y, k) {
    if (k < 0 || k > 1) return;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (20 + k * 70), y + Math.sin(a) * (20 + k * 70) + k * 30, 12 - k * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // A little gingerbread man running (legs and arms swinging, a hop in his step).
  function gingerMan(ctx, x, y, t) {
    const s = Math.sin(t / 70);
    const hop = Math.abs(Math.sin(t / 140)) * 14;
    ctx.save();
    ctx.translate(x, y - hop);
    ctx.scale(1.5, 1.5);
    ctx.lineCap = 'round';
    for (const [sx, sy, l, a] of [[-12, -30, 28, 0.9 + s * 0.5], [12, -30, 28, -0.9 + s * 0.5], [-8, 0, 30, 0.25 + s * 0.6], [8, 0, 30, -0.25 - s * 0.6]]) {
      ctx.strokeStyle = OL;
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.sin(a) * l, sy + Math.cos(a) * l);
      ctx.stroke();
      ctx.strokeStyle = '#c98450';
      ctx.lineWidth = 13;
      ctx.stroke();
    }
    const body = new Path2D();
    body.ellipse(0, -18, 22, 28, 0, 0, Math.PI * 2);
    fillStroke(ctx, body, '#c98450', 5);
    const head = new Path2D();
    head.arc(0, -62, 22, 0, Math.PI * 2);
    fillStroke(ctx, head, '#c98450', 5);
    ctx.fillStyle = OL;
    for (const dx of [-7, 7]) {
      ctx.beginPath();
      ctx.arc(dx - 4, -64, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-4, -58, 8, 0.3, Math.PI - 0.3);
    ctx.stroke();
    ctx.fillStyle = '#D9534F';
    for (const dy of [-24, -10]) {
      ctx.beginPath();
      ctx.arc(0, dy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Mistletoe over the front door (drops in: k 0..1) and hearts rising.
  function mistletoe(ctx, k, e) {
    const y = 1135 - (1 - Math.min(1, k)) * 160;
    ctx.strokeStyle = '#D9534F';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(600, 1080);
    ctx.lineTo(600, y - 16);
    ctx.stroke();
    for (const [dx, dy, a] of [[-18, 4, -0.6], [18, 4, 0.6], [-8, 14, -0.2], [8, 14, 0.2]]) {
      const leaf = new Path2D();
      leaf.ellipse(600 + dx, y + dy, 9, 20, a, 0, Math.PI * 2);
      fillStroke(ctx, leaf, '#7DB86A', 4);
    }
    for (const dx of [-6, 4, 0]) {
      const b = new Path2D();
      b.arc(600 + dx, y - 6 + Math.abs(dx), 6, 0, Math.PI * 2);
      fillStroke(ctx, b, '#ffffff', 3);
    }
    const bow = new Path2D();
    bow.ellipse(590, y - 18, 10, 6, 0.4, 0, Math.PI * 2);
    bow.ellipse(610, y - 18, 10, 6, -0.4, 0, Math.PI * 2);
    fillStroke(ctx, bow, '#D9534F', 3);
    if (e > 900) {
      const r = rng(8);
      for (let i = 0; i < 10; i++) {
        const u = ((e - 900) / 2600 + i / 10) % 1;
        const x = 600 + (r() - 0.5) * 220 + Math.sin(u * 8 + i) * 16;
        const yy = 1380 - u * 420;
        ctx.save();
        ctx.globalAlpha = 1 - u;
        ctx.fillStyle = i % 2 ? '#FF7A8A' : '#FFB3C0';
        const s = 12 + r() * 10;
        ctx.beginPath();
        ctx.moveTo(x, yy + s * 0.9);
        ctx.bezierCurveTo(x - s * 1.2, yy, x - s * 0.5, yy - s, x, yy - s * 0.35);
        ctx.bezierCurveTo(x + s * 0.5, yy - s, x + s * 1.2, yy, x, yy + s * 0.9);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // Night falls: the sky darkens, the opened doors glow warm like windows, and z's drift up.
  function night(ctx, k, spec, e) {
    ctx.save();
    // Only the house and its ground: the sky around it is the village backdrop's to darken.
    const shape = houseShape();
    shape.rect(0, 1400, W, 100);
    ctx.save();
    ctx.clip(shape);
    ctx.fillStyle = `rgba(8,12,34,${0.5 * k})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    for (const door of spec.doors || []) {
      if (!door.opened) continue;
      const d = DOORS[door.d];
      const g = ctx.createRadialGradient(d.x, d.y, 4, d.x, d.y, d.w * 0.8);
      g.addColorStop(0, `rgba(255,200,110,${0.55 * k})`);
      g.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.w * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (e > 1500) {
      ctx.fillStyle = `rgba(255,255,255,${k})`;
      ctx.font = 'bold 40px "Trebuchet MS", sans-serif';
      for (let i = 0; i < 3; i++) {
        const u = ((e - 1500) / 2200 + i / 3) % 1;
        ctx.globalAlpha = 1 - u;
        ctx.fillText('z', 690 + u * 60 + i * 10, 1240 - u * 180);
      }
      ctx.globalAlpha = 1;
    }
  }

  // A clump of snow slides off the left eave and drops onto Bubu (u: 0..1), then sits on her head.
  function snowClump(ctx, e, ms) {
    let x;
    let y;
    if (e < 300) [x, y] = [70, 690];
    else if (e < 800) [x, y] = [70 - ((e - 300) / 500) * 10, 690 + ((e - 300) / 500) * 20];
    else if (e < 1300) {
      const u = (e - 800) / 500;
      [x, y] = [60, 710 + u * u * 580];
    } else [x, y] = [50, 1318];
    const pile = new Path2D();
    const s = e < 1300 ? 1 : 1.25;
    pile.ellipse(x, y, 46 * s, 26 * s, 0, Math.PI, 0);
    pile.lineTo(x + 46 * s, y + 6);
    pile.lineTo(x - 46 * s, y + 6);
    pile.closePath();
    ctx.save();
    ctx.globalAlpha = e > ms - 600 ? Math.max(0, (ms - e) / 600) : 1;
    fillStroke(ctx, pile, '#ffffff', 5);
    ctx.restore();
    if (e > 1300) splat(ctx, 50, 1330, (e - 1300) / 700);
  }

  // A love letter fluttering in from the sky down to the front door.
  function flyingLetter(ctx, e) {
    const u = Math.min(1, e / 1700);
    if (u >= 1) return;
    const x = 1250 - u * 650 + Math.sin(u * 9) * 90 * (1 - u);
    const y = 60 + u * 1190;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(u * 12) * 0.5);
    icon(ctx, { kind: 'note' }, 0, 0, 110);
    ctx.restore();
  }

  // ---------- the village behind the house ----------
  // Drawn on its own canvas behind the calendar, in the calendar's coordinates but much wider (x -600..1800), so it
  // fills the whole panel: little houses peek out around the roof and beyond the sides. The caller sets the
  // transform; view: { x0, y0, x1, y1 } is the part of calendar space the panel shows.
  const VILLAGE = (() => {
    const r = rng(2024);
    const houses = [
      // [x, ground y, width, height, wall, roof]: left hill, then right hill
      [-470, 600, 120, 90, '#E8C9A1', '#B5544D'],
      [-330, 540, 150, 110, '#F3E3C3', '#6E8DB5'],
      [-170, 500, 120, 100, '#D98E73', '#5F7D5B'],
      [-20, 545, 110, 85, '#F0D9B5', '#B5544D'],
      [150, 470, 100, 80, '#E5B98F', '#7A6A9A'],
      [1050, 470, 100, 80, '#E8C9A1', '#5F7D5B'],
      [1210, 545, 120, 90, '#F3E3C3', '#B5544D'],
      [1360, 500, 140, 110, '#D98E73', '#6E8DB5'],
      [1520, 540, 120, 95, '#F0D9B5', '#7A6A9A'],
      [1680, 600, 130, 90, '#E5B98F', '#B5544D'],
    ];
    const trees = [[-560, 640, 1.1], [-250, 560, 0.8], [-90, 530, 0.7], [60, 560, 0.75], [270, 470, 0.6], [930, 470, 0.6], [1130, 540, 0.8], [1300, 520, 0.7], [1460, 545, 0.8], [1760, 640, 1.1], [-260, 1430, 1.8], [-430, 1440, 2.2], [1460, 1430, 1.8], [1630, 1440, 2.2]];
    const stars = [...Array(90)].map(() => [-600 + r() * 2400, -300 + r() * 700, 1 + r() * 2.5, r() * 6]);
    return { houses, trees, stars };
  })();

  function pine(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    for (const [w, top, bot] of [[70, -150, -70], [56, -190, -110], [40, -225, -150]]) {
      const p = new Path2D();
      p.moveTo(0, top);
      p.lineTo(w, bot);
      p.lineTo(-w, bot);
      p.closePath();
      ctx.fillStyle = '#2f5a48';
      ctx.fill(p);
      ctx.strokeStyle = 'rgba(74,37,31,0.6)';
      ctx.lineWidth = 4;
      ctx.stroke(p);
      ctx.fillStyle = '#f4f8ff';
      ctx.beginPath();
      ctx.moveTo(0, top + 4);
      ctx.lineTo(w * 0.45, top + (bot - top) * 0.45);
      ctx.quadraticCurveTo(0, top + (bot - top) * 0.6, -w * 0.45, top + (bot - top) * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#5a3a28';
    ctx.fillRect(-8, -72, 16, 72);
    ctx.restore();
  }

  function cottage(ctx, [x, gy, w, h, wall, roof], t, i) {
    const top = gy - h;
    // chimney and its smoke
    ctx.fillStyle = '#8a5a3b';
    ctx.fillRect(x + w * 0.22, top - h * 0.55, 18, h * 0.4);
    for (let k = 0; k < 3; k++) {
      const u = ((t / 3200 + k / 3 + i * 0.13) % 1 + 1) % 1;
      ctx.fillStyle = `rgba(230,234,245,${0.5 * (1 - u)})`;
      ctx.beginPath();
      ctx.arc(x + w * 0.22 + 9 + u * 30 + Math.sin(u * 6 + i) * 8, top - h * 0.6 - u * 110, 9 + u * 14, 0, Math.PI * 2);
      ctx.fill();
    }
    const body = new Path2D();
    body.rect(x - w / 2, top, w, h);
    ctx.fillStyle = wall;
    ctx.fill(body);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(x + w * 0.15, top, w * 0.35, h);
    ctx.strokeStyle = 'rgba(74,37,31,0.75)';
    ctx.lineWidth = 4;
    ctx.stroke(body);
    const rf = new Path2D();
    rf.moveTo(x - w / 2 - 14, top + 4);
    rf.lineTo(x, top - h * 0.62);
    rf.lineTo(x + w / 2 + 14, top + 4);
    rf.closePath();
    ctx.fillStyle = roof;
    ctx.fill(rf);
    ctx.stroke(rf);
    // snow on the roof
    ctx.fillStyle = '#f7faff';
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 16, top + 6);
    ctx.lineTo(x, top - h * 0.66);
    ctx.lineTo(x + w / 2 + 16, top + 6);
    ctx.quadraticCurveTo(x + w / 4, top - h * 0.12, x, top - h * 0.36);
    ctx.quadraticCurveTo(x - w / 4, top - h * 0.12, x - w / 2 - 16, top + 6);
    ctx.fill();
    // warm windows (a few flicker slowly) and a door
    const flicker = 0.8 + 0.2 * Math.sin(t / 900 + i * 2.1);
    for (const fx of [-0.28, 0.28]) {
      const wx = x + fx * w;
      const wy = top + h * 0.3;
      const g = ctx.createRadialGradient(wx, wy, 2, wx, wy, 40);
      g.addColorStop(0, `rgba(255,210,120,${0.45 * flicker})`);
      g.addColorStop(1, 'rgba(255,210,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(wx, wy, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,214,128,${flicker})`;
      ctx.fillRect(wx - 11, wy - 11, 22, 22);
      ctx.strokeStyle = 'rgba(74,37,31,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(wx - 11, wy - 11, 22, 22);
      ctx.beginPath();
      ctx.moveTo(wx, wy - 11);
      ctx.lineTo(wx, wy + 11);
      ctx.moveTo(wx - 11, wy);
      ctx.lineTo(wx + 11, wy);
      ctx.stroke();
    }
    ctx.fillStyle = '#7a4a2c';
    ctx.fillRect(x - 10, gy - h * 0.42, 20, h * 0.42);
  }

  function church(ctx, x, gy, t) {
    const body = new Path2D();
    body.rect(x - 60, gy - 120, 120, 120);
    ctx.fillStyle = '#EDE3D2';
    ctx.fill(body);
    ctx.strokeStyle = 'rgba(74,37,31,0.75)';
    ctx.lineWidth = 4;
    ctx.stroke(body);
    const tower = new Path2D();
    tower.rect(x - 24, gy - 230, 48, 120);
    ctx.fill(tower);
    ctx.stroke(tower);
    const spire = new Path2D();
    spire.moveTo(x - 32, gy - 228);
    spire.lineTo(x, gy - 330);
    spire.lineTo(x + 32, gy - 228);
    spire.closePath();
    ctx.fillStyle = '#6E8DB5';
    ctx.fill(spire);
    ctx.stroke(spire);
    ctx.strokeStyle = '#F2C14E';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, gy - 330);
    ctx.lineTo(x, gy - 360);
    ctx.moveTo(x - 10, gy - 348);
    ctx.lineTo(x + 10, gy - 348);
    ctx.stroke();
    const g = ctx.createRadialGradient(x, gy - 180, 2, x, gy - 180, 50);
    g.addColorStop(0, `rgba(255,214,128,${0.6 + 0.2 * Math.sin(t / 700)})`);
    g.addColorStop(1, 'rgba(255,214,128,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, gy - 180, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFD680';
    ctx.beginPath();
    ctx.arc(x, gy - 180, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f7faff';
    ctx.beginPath();
    ctx.moveTo(x - 66, gy - 118);
    ctx.lineTo(x + 66, gy - 118);
    ctx.lineTo(x + 60, gy - 128);
    ctx.lineTo(x - 60, gy - 128);
    ctx.fill();
  }

  function lamp(ctx, x, gy) {
    ctx.strokeStyle = '#2b2b3a';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x, gy - 230);
    ctx.stroke();
    const g = ctx.createRadialGradient(x, gy - 245, 4, x, gy - 245, 120);
    g.addColorStop(0, 'rgba(255,220,140,0.55)');
    g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, gy - 245, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFE3A0';
    ctx.beginPath();
    ctx.arc(x, gy - 245, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2b3a';
    ctx.fillRect(x - 22, gy - 270, 44, 10);
  }

  function drawBackdrop(ctx, view, opts = {}) {
    const t = opts.t ?? performance.now();
    const { x0, y0, x1, y1 } = view;
    // sky
    const sky = ctx.createLinearGradient(0, y0, 0, 900);
    sky.addColorStop(0, '#141b36');
    sky.addColorStop(1, '#3b4a78');
    ctx.fillStyle = sky;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // stars
    for (const [x, y, s, ph] of VILLAGE.stars) {
      ctx.fillStyle = `rgba(255,255,255,${0.45 + 0.45 * Math.sin(t / 700 + ph)})`;
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
    }
    moon(ctx, opts.dark || 0);
    // far mountains with snowy caps
    ctx.fillStyle = '#56679a';
    ctx.beginPath();
    ctx.moveTo(x0, 700);
    for (const [x, y] of [[-600, 520], [-420, 360], [-250, 470], [-60, 330], [140, 450], [360, 300], [600, 420], [820, 310], [1050, 440], [1260, 330], [1450, 470], [1650, 350], [1800, 500]]) ctx.lineTo(x, y);
    ctx.lineTo(x1, 700);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(240,246,255,0.85)';
    for (const [x, y] of [[-420, 360], [-60, 330], [360, 300], [820, 310], [1260, 330], [1650, 350]]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 46, y + 40);
      ctx.lineTo(x + 18, y + 34);
      ctx.lineTo(x, y + 48);
      ctx.lineTo(x - 20, y + 32);
      ctx.lineTo(x - 46, y + 40);
      ctx.closePath();
      ctx.fill();
    }
    // the two snowy hills the village sits on
    for (const [cx, peak, half] of [[-260, 470, 620], [1460, 470, 620]]) {
      const hill = ctx.createLinearGradient(0, peak, 0, 900);
      hill.addColorStop(0, '#eef3fb');
      hill.addColorStop(1, '#c9d6ea');
      ctx.fillStyle = hill;
      ctx.beginPath();
      ctx.moveTo(cx - half * 1.6, 900);
      ctx.bezierCurveTo(cx - half * 0.7, peak, cx + half * 0.7, peak, cx + half * 1.6, 900);
      ctx.closePath();
      ctx.fill();
    }
    // the snowy field between the hills and the house's ground
    const field = ctx.createLinearGradient(0, 820, 0, 1440);
    field.addColorStop(0, '#d3deef');
    field.addColorStop(1, '#eaf0f8');
    ctx.fillStyle = field;
    ctx.fillRect(x0, 840, x1 - x0, 620);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const [cx, cy, rx] of [[-300, 900, 420], [1500, 920, 420], [600, 880, 700]]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, 50, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    VILLAGE.trees.filter((tr) => tr[1] < 1000).forEach(([x, y, s]) => pine(ctx, x, y, s));
    church(ctx, -330, 445, t);
    VILLAGE.houses.forEach((h, i) => cottage(ctx, h, t, i));
    // a string of lights between two houses on the right hill
    const bulbs = ['#FF6B6B', '#F2C14E', '#7FC8F8', '#8FE3A1'];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const x = 1270 + u * 150;
      const y = 470 + Math.sin(u * Math.PI) * 22;
      ctx.fillStyle = bulbs[i % 4];
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 300 + i);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // the snowy ground the gingerbread house stands on, lamps and big trees in front
    const ground = ctx.createLinearGradient(0, 1380, 0, y1);
    ground.addColorStop(0, '#f4f7fc');
    ground.addColorStop(1, '#dfe7f3');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(x0, 1430);
    ctx.bezierCurveTo(x0 + (x1 - x0) * 0.3, 1395, x0 + (x1 - x0) * 0.7, 1395, x1, 1430);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
    ctx.closePath();
    ctx.fill();
    lamp(ctx, -120, 1440);
    lamp(ctx, 1320, 1440);
    VILLAGE.trees.filter((tr) => tr[1] >= 1000).forEach(([x, y, s]) => pine(ctx, x, y, s));
    if (opts.dark) {
      ctx.fillStyle = `rgba(8,12,34,${0.5 * opts.dark})`;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  // spec: { doors: [{ d, ready, opened, reward }], today }
  // opts: { t, fx: { d, t0, type } (a door opening now and its event), hover, drawBears (paint the bears on the
  //         canvas, for still pictures; the window shows them as live animations instead) }
  function drawCalendar(ctx, spec, opts = {}) {
    const t = opts.t ?? performance.now();
    [GINGER, GINGER_SHADE, SPECK] = HOUSES[opts.look?.house] || HOUSES.gingerbread;
    DOOR_COLORS = DOOR_SETS[opts.look?.doors] || DOOR_SETS.candy;
    const fx = opts.fx || null;
    const e = fx ? t - fx.t0 : -1; // ms since the click
    const ev = fx ? e - EVENT_AT : -1; // ms into the day's event
    const evOn = fx && ev >= 0 && ev <= (EVENT_MS[fx.type] || 4000);
    const grow = (type) => (fx && fx.type === type ? Math.max(0, Math.min(1, ev / 900)) : null);
    const prog = progress(spec);
    ctx.save();
    if (opts.scale) ctx.scale(opts.scale, opts.scale);
    const ms = fx ? EVENT_MS[fx.type] || 4000 : 0;
    const fade = evOn ? Math.max(0, Math.min(1, ev / 800, (ms - ev) / 800)) : 0;
    // The moon lives on the village backdrop (its glow would be cut off at this canvas's edge); still pictures
    // without a backdrop draw it here.
    if (opts.moon) moon(ctx, evOn && fx.type === 'goodnight' ? fade : 0);
    snow(ctx, t, false);
    // Now and then a shooting star crosses the sky by itself; on its day, a big one.
    shootingStar(ctx, ((t % 23000) - 3000) / 1400);
    if (evOn && fx.type === 'shooting-star') shootingStar(ctx, ev / 1600);
    if (evOn && fx.type === 'santa') sleigh(ctx, ev / 4200, t);
    smoke(ctx, t, evOn && fx.type === 'chimney');
    house(ctx);
    bites(ctx, prog.nibble, fx?.type === 'nibble' ? (ev - 1400) / 500 : null);
    roofSnow(ctx, prog.snowstorm, grow('snowstorm') !== null ? Math.max(0, Math.min(1, (ev - 1200) / 2500)) : null);
    if (prog.lights) roofLights(ctx, fx?.type === 'lights' ? Math.max(0, ev / 2200) : 1, t);
    if (prog.star || (fx?.type === 'star' && ev >= 0)) TreeArt.drawOrnament(ctx, 'star', 0, 600, 40, 150);
    for (const door of spec.doors || []) {
      const d = DOORS[door.d];
      if (!d) continue;
      // The door being opened: shakes, then swings open.
      if (fx?.d === door.d && e < SHAKE + SWING) {
        if (e < SHAKE) {
          closedDoor(ctx, d, Math.sin(e / 28) * 0.12 * (e / SHAKE));
          continue;
        }
        inside(ctx, d, door.reward);
        openDoor(ctx, d, (e - SHAKE) / SWING);
        continue;
      }
      if (door.opened || fx?.d === door.d) {
        inside(ctx, d, door.reward);
        openDoor(ctx, d, 1);
        continue;
      }
      // Today's door (and any missed ones) glow and wiggle a little.
      if (door.ready) {
        const pulse = 0.6 + 0.4 * Math.sin(t / 350 + door.d);
        const g = ctx.createRadialGradient(d.x, d.y, d.w * 0.3, d.x, d.y, d.w * 0.9);
        g.addColorStop(0, `rgba(255,217,138,${0.55 * pulse})`);
        g.addColorStop(1, 'rgba(255,217,138,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.w * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      const wiggle = door.ready ? Math.sin(t / 160) * 0.05 * (Math.sin(t / 1100) > 0.3 ? 1 : 0) : 0;
      closedDoor(ctx, d, wiggle);
      if (door.ready) for (const [dx, dy, s] of [[-0.55, -0.5, 10], [0.6, -0.4, 8], [0.5, 0.55, 7]]) TreeArt.sparkle(ctx, d.x + dx * d.w, d.y + dy * d.h, s * (0.7 + 0.3 * Math.sin(t / 300 + dx * 9)));
      if (opts.hover === door.d && door.ready) {
        ctx.strokeStyle = '#F2C14E';
        ctx.lineWidth = 6;
        ctx.stroke(doorPath({ ...d, w: d.w + 30, h: d.h + 30 }));
      }
    }
    snowman(ctx, prog.snowman, grow('snowman'));
    if (evOn && fx.type === 'goodnight') night(ctx, fade, spec, ev);
    if (evOn && fx.type === 'mistletoe') mistletoe(ctx, ev / 500, ev);
    if (evOn && fx.type === 'gingerbread') gingerMan(ctx, 1250 - (ev / 4300) * 1400, 1492, t);
    if (evOn && fx.type === 'snowball') {
      const dudu = [880, 170];
      const bubu = [60, 1370];
      snowballAt(ctx, dudu, bubu, (ev - 400) / 900, 300);
      splat(ctx, bubu[0], bubu[1], (ev - 1300) / 700);
      snowballAt(ctx, bubu, dudu, (ev - 3000) / 900, 300);
      splat(ctx, dudu[0], dudu[1], (ev - 3900) / 700);
    }
    if (evOn && fx.type === 'plop') snowClump(ctx, ev, ms);
    if (evOn && fx.type === 'letter') flyingLetter(ctx, ev);
    // Christmas Eve leaves the star on the roof and presents by the front door.
    if (prog.star || (fx?.type === 'star' && ev >= 1500)) presents(ctx, fx?.type === 'star' ? Math.max(0, (ev - 1500) / 700) : null);
    if (opts.drawBears) bearsOver(ctx);
    if (fx) {
      const d = DOORS[fx.d];
      burst(ctx, d, e - SHAKE);
      const door = (spec.doors || []).find((x) => x.d === fx.d);
      rewardPop(ctx, d, door?.reward, e - SHAKE);
    }
    if (evOn && fx.type === 'star') bigStarGlow(ctx, ev);
    if (evOn && fx.type === 'star') confetti(ctx, ev, EVENT_MS.star);
    if (evOn && fx.type === 'snowstorm') heavySnow(ctx, ev, EVENT_MS.snowstorm);
    // A flurry right after any door opens.
    if (fx && e > SHAKE && e < SHAKE + 2600) heavySnow(ctx, e - SHAKE, 2600);
    snow(ctx, t, true);
    ctx.restore();
  }

  // How long the whole moment lasts for a door (opening + its event), ms.
  const momentMs = (day) => EVENT_AT + (EVENT_MS[eventFor(day)] || 4000);

  // The door under (x, y) in calendar coordinates, or 0.
  function doorAt(x, y) {
    for (const d of Object.values(DOORS)) if (Math.abs(x - d.x) <= d.w / 2 + 8 && Math.abs(y - d.y) <= d.h / 2 + 8) return d.n;
    return 0;
  }

  // How dark the night event makes the village right now (0..1), for the backdrop.
  function darkness(fx, t) {
    if (!fx || fx.type !== 'goodnight') return 0;
    const ev = t - fx.t0 - EVENT_AT;
    const ms = EVENT_MS.goodnight;
    return ev < 0 || ev > ms ? 0 : Math.max(0, Math.min(1, ev / 800, (ms - ev) / 800));
  }

  return { W, H, DOORS, HOME, EVENT_AT, EVENT_MS, HOUSES, DOOR_SETS, load, drawCalendar, drawBackdrop, darkness, doorAt, icon, eventFor, eventText, eventBears, progress, momentMs };
})();

if (typeof module !== 'undefined') module.exports = CalendarArt;
