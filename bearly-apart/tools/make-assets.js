// Draws the placeholder bears (animated SVG) and tray icons into assets/.
// Replace any of them with your own GIF/WebM by dropping a file with the same name into the
// custom GIF folder (tray menu → "Open custom GIF folder"), or point scenes.json at new files.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');
fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });

const PALETTES = {
  brown: { fur: '#b07a52', light: '#ecd2b4', line: '#4a2e1f', inner: '#e8a3a3' },
  cream: { fur: '#fff3e2', light: '#ffffff', line: '#6b5040', inner: '#ffc3d1' },
};
const PINK = '#ff9fb5';

const STYLE = `
.leg,.arm{transform-box:fill-box}
.leg{transform-origin:50% 8%}
.arm{transform-origin:50% 12%}
.run .leg-a{animation:legA .32s ease-in-out infinite}
.run .leg-b{animation:legA .32s ease-in-out infinite reverse}
.run .arm-f{animation:armS .32s ease-in-out infinite}
.walk .leg-a{animation:legW .7s ease-in-out infinite}
.walk .leg-b{animation:legW .7s ease-in-out infinite reverse}
.wave .arm-f{animation:wave .55s ease-in-out infinite}
.rub .arm-f{animation:rub .6s linear infinite}
.blink .eye{transform-box:fill-box;transform-origin:50% 50%;animation:blink 4s infinite}
.float{animation:float 1.8s ease-out infinite;transform-box:fill-box;transform-origin:50% 50%}
.float.d1{animation-delay:.6s}.float.d2{animation-delay:1.2s}
.drip{transform-box:fill-box;transform-origin:50% 0;animation:drip 1.4s ease-in infinite}
.spark{animation:spark .25s steps(2) infinite}
.bounce{animation:bounce 1s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}
@keyframes legA{0%,100%{transform:rotate(30deg)}50%{transform:rotate(-30deg)}}
@keyframes legW{0%,100%{transform:rotate(14deg)}50%{transform:rotate(-14deg)}}
@keyframes armS{0%,100%{transform:rotate(-28deg)}50%{transform:rotate(26deg)}}
@keyframes wave{0%,100%{transform:rotate(-150deg)}50%{transform:rotate(-115deg)}}
@keyframes rub{0%{transform:translate(0,0) rotate(60deg)}25%{transform:translate(5px,-4px) rotate(60deg)}50%{transform:translate(0,-8px) rotate(60deg)}75%{transform:translate(-5px,-4px) rotate(60deg)}100%{transform:translate(0,0) rotate(60deg)}}
@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}
@keyframes float{0%{transform:translate(0,0) scale(.6);opacity:0}20%{opacity:1}100%{transform:translate(8px,-46px) scale(1.1);opacity:0}}
@keyframes drip{0%{transform:scaleY(.3)}70%{transform:scaleY(1.2)}100%{transform:scaleY(.3)}}
@keyframes spark{0%{opacity:1}100%{opacity:.2}}
@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
`;

const heartPath = (cx, cy, s) =>
  `M${cx},${cy + 0.42 * s} C${cx - 0.55 * s},${cy + 0.05 * s} ${cx - 0.55 * s},${cy - 0.42 * s} ${cx - 0.22 * s},${cy - 0.42 * s} C${cx - 0.08 * s},${cy - 0.42 * s} ${cx},${cy - 0.3 * s} ${cx},${cy - 0.2 * s} C${cx},${cy - 0.3 * s} ${cx + 0.08 * s},${cy - 0.42 * s} ${cx + 0.22 * s},${cy - 0.42 * s} C${cx + 0.55 * s},${cy - 0.42 * s} ${cx + 0.55 * s},${cy + 0.05 * s} ${cx},${cy + 0.42 * s} Z`;

function eyes(kind, c) {
  const dot = (x, y, r = 5.5) =>
    `<g class="eye"><circle cx="${x}" cy="${y}" r="${r}" fill="${c.line}"/><circle cx="${x + 1.6}" cy="${y - 1.9}" r="${r * 0.33}" fill="#fff"/></g>`;
  const arc = (x, y, up) => `<path d="M${x - 7},${y} q7,${up ? -9 : 7} 14,0" fill="none" stroke="${c.line}" stroke-width="3.6" stroke-linecap="round"/>`;
  switch (kind) {
    case 'happy':
      return arc(96, 82, true) + arc(134, 80, true);
    case 'closed':
      return arc(96, 80, false) + arc(134, 78, false);
    case 'sad':
      return (
        dot(96, 81, 6.5) +
        dot(134, 79, 6.5) +
        `<path d="M87,70 L103,65 M127,64 L142,69" stroke="${c.line}" stroke-width="3.2" stroke-linecap="round"/>` +
        `<path d="M92,92 q-3,7 0,10 q3,-3 0,-10z" fill="#8fd3ff" class="drip"/>`
      );
    case 'angry':
      return dot(96, 81) + dot(134, 79) + `<path d="M87,64 L104,72 M126,71 L143,62" stroke="${c.line}" stroke-width="4" stroke-linecap="round"/>`;
    case 'big':
      return (
        `<g class="eye"><circle cx="96" cy="80" r="7.5" fill="${c.line}"/><circle cx="98.5" cy="77" r="2.8" fill="#fff"/><circle cx="94" cy="83" r="1.4" fill="#fff"/></g>` +
        `<g class="eye"><circle cx="134" cy="78" r="7.5" fill="${c.line}"/><circle cx="136.5" cy="75" r="2.8" fill="#fff"/><circle cx="132" cy="81" r="1.4" fill="#fff"/></g>`
      );
    default:
      return dot(96, 81) + dot(134, 79);
  }
}

function mouth(kind, c) {
  const s = `stroke="${c.line}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  switch (kind) {
    case 'pucker':
      return `<path d="M127,99 q7,2 1,5 q7,2 1,6" fill="none" ${s}/><ellipse cx="129" cy="104.5" rx="4" ry="5" fill="#ff7b9c" opacity=".55"/>`;
    case 'open':
      return `<path d="M111,102 q11,15 22,0 z" fill="#b5455d" ${s}/><path d="M116,108 q6,5 12,0" fill="#ff8fa8"/>`;
    case 'sad':
      return `<path d="M113,108 q9,-7 18,0" fill="none" ${s}/>`;
    case 'drool':
      return `<path d="M114,102 q8,11 16,0 z" fill="#b5455d" ${s}/><path class="drip" d="M128,106 q-3,9 0,12 q3,-3 0,-12z" fill="#8fd3ff"/>`;
    case 'o':
      return `<ellipse cx="122" cy="105" rx="3.5" ry="4.5" fill="${c.line}"/>`;
    default:
      return `<path d="M111,101 q5,6 10,0 q5,6 10,0" fill="none" ${s}/>`;
  }
}

function head(c, p) {
  const st = `stroke="${c.line}" stroke-width="4"`;
  return `
  <circle cx="70" cy="46" r="17" fill="${c.fur}" ${st}/><circle cx="70" cy="46" r="8" fill="${c.inner}"/>
  <circle cx="142" cy="44" r="17" fill="${c.fur}" ${st}/><circle cx="142" cy="44" r="8" fill="${c.inner}"/>
  <circle cx="106" cy="84" r="48" fill="${c.fur}" ${st}/>
  <ellipse cx="121" cy="100" rx="19" ry="13" fill="${c.light}"/>
  <ellipse cx="122" cy="93" rx="6.5" ry="4.5" fill="${c.line}"/>
  <ellipse cx="84" cy="98" rx="8.5" ry="5" fill="${PINK}" opacity=".75"/><ellipse cx="148" cy="96" rx="6.5" ry="5" fill="${PINK}" opacity=".75"/>
  <g class="${p.eyes === 'dot' || !p.eyes ? 'blink' : ''}">${eyes(p.eyes, c)}</g>
  ${mouth(p.mouth, c)}`;
}

function item(kind, c) {
  switch (kind) {
    case 'burger':
      return `<g transform="translate(160,128)">
        <path d="M-20,-2 q20,-26 40,0 z" fill="#f0a64a" stroke="${c.line}" stroke-width="3"/>
        <circle cx="-7" cy="-10" r="1.5" fill="#fff6d8"/><circle cx="4" cy="-13" r="1.5" fill="#fff6d8"/><circle cx="11" cy="-8" r="1.5" fill="#fff6d8"/>
        <path d="M-22,0 q5,5 11,0 q5,5 11,0 q5,5 11,0 q5,5 11,0" fill="none" stroke="#5cbf4a" stroke-width="5" stroke-linecap="round"/>
        <rect x="-20" y="3" width="40" height="8" rx="4" fill="#7a4a2a"/>
        <rect x="-21" y="8" width="42" height="4" rx="2" fill="#ffd03b"/>
        <path d="M-20,13 h40 q0,9 -8,9 h-24 q-8,0 -8,-9z" fill="#f0a64a" stroke="${c.line}" stroke-width="3"/></g>`;
    case 'heart':
      return `<path d="${heartPath(163, 128, 46)}" fill="#ff5c8a" stroke="${c.line}" stroke-width="3.5"/><ellipse cx="152" cy="118" rx="5" ry="3" fill="#fff" opacity=".7"/>`;
    case 'letter':
      return `<g transform="translate(160,128) rotate(-8)"><rect x="-22" y="-15" width="44" height="30" rx="4" fill="#fff" stroke="${c.line}" stroke-width="3"/>
        <path d="M-22,-13 L0,4 L22,-13" fill="none" stroke="${c.line}" stroke-width="3"/><path d="${heartPath(0, 4, 13)}" fill="#ff5c8a"/></g>`;
    case 'sign':
      return `<g class="bounce"><rect x="118" y="112" width="72" height="50" rx="9" fill="#fff" stroke="#ff8fb1" stroke-width="4"/>
        <path d="${heartPath(154, 137, 26)}" fill="#ff8fb1"/></g>`;
    default:
      return '';
  }
}

function sword() {
  // Long blade dragging on the ground behind the bear (pose uses a wider viewBox).
  return `<g><path d="M56,150 L-44,188 L-40,197 L62,160 Z" fill="#e3ebf3" stroke="#5e6b7a" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M54,155 L-36,189" stroke="#fff" stroke-width="2.5" opacity=".85"/>
    <path d="M50,140 L64,170" stroke="#e0a526" stroke-width="9" stroke-linecap="round"/>
    <path d="M60,154 L76,146" stroke="#7a4a2a" stroke-width="8" stroke-linecap="round"/><circle cx="78" cy="145" r="5" fill="#e0a526"/>
    <g class="spark"><path d="M-46,186 l-9,-5 M-45,194 l-11,1 M-40,199 l-6,6" stroke="#ffb020" stroke-width="3" stroke-linecap="round"/></g></g>`;
}

function nightcap() {
  return `<path d="M62,58 Q86,6 150,36 Q178,48 182,82 L170,84 Q160,56 146,52 Q110,40 70,64 Z" fill="#8aa8ff" stroke="#4a5a99" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M60,60 Q100,30 152,50" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
    <circle cx="178" cy="88" r="9" fill="#fff" stroke="#4a5a99" stroke-width="3"/>
    <g font-family="ui-rounded, system-ui, sans-serif" font-weight="800" fill="#7a8cff">
      <text x="150" y="30" font-size="18" class="float">z</text><text x="160" y="22" font-size="24" class="float d1">Z</text><text x="140" y="18" font-size="14" class="float d2">z</text></g>`;
}

function floatHearts() {
  return [0, 1, 2]
    .map((i) => `<path class="float d${i}" d="${heartPath(146 + i * 10, 70 - i * 6, 14 + i * 3)}" fill="#ff5c8a"/>`)
    .join('');
}

// p: { legs: run|walk|stand, arm: swing|wave|rub|hold|point|drag|hug|down, eyes, mouth, item, extra[] }
function bear(c, p) {
  const st = `stroke="${c.line}" stroke-width="4"`;
  const legs = `<g class="leg leg-a"><rect x="72" y="150" width="26" height="44" rx="13" fill="${c.fur}" ${st}/></g>
    <g class="leg leg-b"><rect x="106" y="150" width="26" height="44" rx="13" fill="${c.fur}" ${st}/></g>`;
  let backArm = `<ellipse cx="70" cy="134" rx="11" ry="20" transform="rotate(25 70 134)" fill="${c.fur}" ${st}/>`;
  if (p.arm === 'drag') backArm = `<ellipse cx="64" cy="146" rx="11" ry="21" transform="rotate(50 64 146)" fill="${c.fur}" ${st}/>`;
  const front = {
    swing: `<g class="arm arm-f"><ellipse cx="140" cy="136" rx="11" ry="21" fill="${c.fur}" ${st}/></g>`,
    down: `<ellipse cx="140" cy="136" rx="11" ry="20" transform="rotate(-18 140 136)" fill="${c.fur}" ${st}/>`,
    wave: `<g class="arm arm-f"><ellipse cx="140" cy="136" rx="11" ry="21" fill="${c.fur}" ${st}/></g>`,
    rub: `<g class="arm arm-f"><ellipse cx="122" cy="140" rx="11" ry="20" fill="${c.fur}" ${st}/></g>`,
    hold: `<ellipse cx="148" cy="130" rx="21" ry="11" fill="${c.fur}" ${st}/>`,
    point: `<ellipse cx="152" cy="126" rx="25" ry="10" fill="${c.fur}" ${st}/><circle cx="178" cy="124" r="5" fill="${c.fur}" ${st}/>`,
    hug: `<ellipse cx="156" cy="128" rx="26" ry="11" transform="rotate(-8 156 128)" fill="${c.fur}" ${st}/>`,
  }[p.arm || 'down'];
  const holdsInFront = ['hold', 'sign'].includes(p.arm) || ['burger', 'heart', 'letter'].includes(p.item);
  const extra = p.extra || [];
  return `<g class="${p.legs || 'stand'} ${p.arm || ''}">
    ${extra.includes('sword') ? sword() : ''}
    ${backArm}
    <circle cx="52" cy="138" r="9" fill="${c.fur}" ${st}/>
    ${legs}
    <ellipse cx="102" cy="138" rx="50" ry="42" fill="${c.fur}" ${st}/>
    <ellipse cx="108" cy="146" rx="28" ry="24" fill="${c.light}"/>
    ${head(c, p)}
    ${extra.includes('nightcap') ? nightcap() : ''}
    ${extra.includes('hearts') ? floatHearts() : ''}
    ${front}
    ${item(p.item, c)}
    ${holdsInFront ? `<circle cx="${p.item === 'sign' ? 122 : 146}" cy="${p.item === 'sign' ? 140 : 134}" r="8.5" fill="${c.fur}" ${st}/>` : ''}
  </g>`;
}

function svg(viewBox, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><style>${STYLE}</style>${body}</svg>\n`;
}

// Drawn placeholder bears, only for scenes that don't have a real animation yet (hungry).
// The rest were replaced by the Bubu & Dudu GIFs; drop a pose here once its scene gets one.
const POSES = {
  run: { legs: 'run', arm: 'swing' },
  hungry: { arm: 'rub', eyes: 'big', mouth: 'drool' },
  burger: { legs: 'run', arm: 'hold', eyes: 'happy', mouth: 'open', item: 'burger' },
};

let count = 0;
const write = (name, content) => {
  fs.writeFileSync(path.join(OUT, name), content);
  count++;
};

for (const [cname, c] of Object.entries(PALETTES)) {
  for (const [pose, p] of Object.entries(POSES)) write(`bear-${pose}-${cname}.svg`, svg(pose === 'sword' ? '-60 -60 260 260' : '0 0 200 200', bear(c, p)));

  // "Missing" poster with this bear's sad face.
  write(
    `poster-${cname}.svg`,
    svg(
      '0 0 220 270',
      `<g transform="rotate(-3 110 135)">
      <rect x="14" y="12" width="192" height="246" rx="6" fill="#fdf3dc" stroke="#c9a46a" stroke-width="3"/>
      <text x="110" y="56" text-anchor="middle" font-family="ui-rounded, system-ui, sans-serif" font-size="34" font-weight="900" fill="#b0373f" letter-spacing="2">MISSING</text>
      <g transform="translate(20,52) scale(.86)">${head(c, { eyes: 'sad', mouth: 'sad' })}</g>
      <text x="110" y="200" text-anchor="middle" font-family="ui-rounded, system-ui, sans-serif" font-size="15" font-weight="800" fill="#5b3a2a">one cute text message</text>
      <text x="110" y="222" text-anchor="middle" font-family="ui-rounded, system-ui, sans-serif" font-size="12" font-weight="700" fill="#8a6a50">reward: endless kisses</text>
      <rect x="74" y="2" width="72" height="18" fill="#fff" opacity=".7" transform="rotate(4 110 11)"/>
      </g>`,
    ),
  );
}

write(
  'heart.svg',
  svg('0 0 120 110', `<path d="${heartPath(60, 58, 112)}" fill="#ff5c8a" stroke="#d63a68" stroke-width="3"/><ellipse cx="36" cy="34" rx="10" ry="6" fill="#fff" opacity=".6" transform="rotate(-30 36 34)"/>`),
);
write(
  'lips.svg',
  svg(
    '0 0 120 100',
    `<g fill="#e8335f" opacity=".92"><path d="M14,50 C26,24 48,22 60,40 C72,22 94,24 106,50 C88,56 72,58 60,58 C48,58 32,56 14,50 Z"/>
     <path d="M14,53 C32,88 88,88 106,53 C84,62 36,62 14,53 Z"/></g>
     <path d="M30,48 C44,44 52,48 60,50 C68,48 76,44 90,48" stroke="#b3123f" stroke-width="2" fill="none" opacity=".6"/>
     <path d="M40,70 q20,6 40,0" stroke="#fff" stroke-width="2" fill="none" opacity=".35"/>`,
  ),
);
write('sparkle.svg', svg('0 0 100 100', `<path d="M50,4 C55,38 62,45 96,50 C62,55 55,62 50,96 C45,62 38,55 4,50 C38,45 45,38 50,4Z" fill="#ffd34d" stroke="#f0a400" stroke-width="2"/>`));

// ---- PNG icons (no image libraries needed) -----------------------------------

function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function heartIcon(size, [r, g, b]) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size - 0.5) * 2.6;
          const v = -((y + (sy + 0.5) / ss) / size - 0.47) * 2.6;
          const q = u * u + v * v - 1;
          if (q * q * q - u * u * v * v * v <= 0) hit++;
        }
      }
      const i = (y * size + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = Math.round((hit / (ss * ss)) * 255);
    }
  }
  return png(size, size, px);
}

fs.writeFileSync(path.join(OUT, 'icons', 'trayTemplate.png'), heartIcon(18, [0, 0, 0]));
fs.writeFileSync(path.join(OUT, 'icons', 'trayTemplate@2x.png'), heartIcon(36, [0, 0, 0]));
fs.writeFileSync(path.join(OUT, 'icons', 'tray.png'), heartIcon(24, [255, 92, 138]));
fs.writeFileSync(path.join(OUT, 'icons', 'tray@2x.png'), heartIcon(48, [255, 92, 138]));
console.log(`wrote ${count} SVGs and 4 tray icons to ${OUT}`);
