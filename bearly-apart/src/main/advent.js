// The advent calendar's rules: what's behind the 29 doors (November 27, the special day, to Christmas Day), and which
// door comes on which day. No Electron here.
//
// Aaron fills the doors (the door editor, tester only); they ship inside the app in assets/advent/doors.dat, encoded
// so a look inside the app folder doesn't spoil anything. Each content is shuffled onto a day with a seed made from
// the two of you and the year, so both apps put the same thing behind the same door without talking, and the order
// is never shown or logged. A content can be pinned to a door instead (the locket on Nov 27, the tree lights on Nov 28,
// the star on Dec 24). Door n is season day n (src/main/tree.js): 1-4 are Nov 27-30, 5-29 are Dec 1-25.
//
// There are more things than doors, so doors can hold more than one: the door's own one, then "more" that Santa
// brings when it opens (the window plays his sleigh for those).
const crypto = require('crypto');

const DOORS = 29;
const KINDS = ['ornament', 'note', 'snow', 'star', 'lights'];
const MORE = 3; // at most this many extras behind one door

// What the doors hold until Aaron fills them in: the "27" locket on Nov 27, the tree lights on Nov 28, the star on
// Christmas Eve, two snow days and a note; every other door has one of the first ornaments, and Santa brings the rest
// (the picture ornaments and the little animals) on top, one or two per door, never two animals on one door.
const FIRST = ['bauble-zigzag', 'bauble-stripe', 'bauble-dots', 'star', 'snowflake', 'bell', 'candy-cane', 'gingerbread', 'bauble-snow', 'teardrop', 'pinecone', 'mitten', 'present', 'boba', 'plane', 'heart', 'heart-half', 'dudu', 'bubu', 'first-xmas', 'stocking', 'snowman', 'reindeer'];
const ANIMALS = ['reindeer-tree', 'penguin', 'teddy-gift', 'rudolph', 'polar-bear', 'teddy-antlers', 'goose', 'penguin-hug', 'teddy-tree', 'reindeer-kiss', 'teddy-sleepy'];
const DECOR = ['santa-star', 'holly', 'gold-bell', 'sock-flake', 'wreath', 'bauble-tree', 'snow-buddy', 'poinsettia', 'gift-stripe', 'bauble-mint', 'cocoa-mug', 'ginger-house', 'bow-cane', 'candle', 'santa', 'sock-tree', 'mini-tree', 'bauble-goldflake', 'sweets', 'santa-hat', 'gift-dots', 'jingle-bells', 'bauble-wave', 'sock-dots', 'ginger-santa', 'santa-sack', 'cocoa'];
function dealDoors() {
  const doors = FIRST.map((item) => ({ kind: 'ornament', item, more: [] }));
  // first round: an animal or a decoration on every door, the animals spread out; second round: the rest
  const first = [];
  const decor = [...DECOR];
  for (let i = 0; i < doors.length; i++) first.push(i % 2 === 0 && ANIMALS[i / 2] ? ANIMALS[i / 2] : decor.shift());
  const rest = [...ANIMALS.slice(Math.ceil(doors.length / 2)), ...decor];
  first.forEach((m, i) => doors[i].more.push(m));
  rest.forEach((m, i) => doors[(i * 3) % doors.length].more.push(m));
  return doors;
}
const DEFAULT_CONTENTS = [
  { kind: 'ornament', item: 'locket', title: 'It’s the 27th 💝', text: 'Our day. The calendar starts here, and every door after this is one day closer to Christmas.', pin: 1 },
  { kind: 'lights', title: 'The tree lights ✨', text: 'Your tree has its lights now. They glow whenever you’re both at your computers.', pin: 2 },
  ...dealDoors(),
  { kind: 'snow', title: 'A snow day ❄️' },
  { kind: 'snow', title: 'Snow again! ⛄' },
  { kind: 'note', title: 'A note for you 💌', text: 'Thinking of you today. Every door is one day closer.' },
  { kind: 'star', title: 'Christmas Eve ⭐', text: 'Tonight the star goes on the tree. Click it together!', pin: 28 },
];

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);

// Only well-formed contents, exactly 29 of them (missing ones become notes), pins on real days and used once.
function cleanContents(list, ornaments = null) {
  const out = [];
  const pinned = new Set();
  for (const c of Array.isArray(list) ? list.slice(0, DOORS) : []) {
    if (!c || !KINDS.includes(c.kind)) continue;
    const d = { kind: c.kind, title: clean(c.title, 60) };
    if (c.kind === 'ornament') {
      if (typeof c.item !== 'string' || (ornaments && !ornaments.includes(c.item))) continue;
      d.item = c.item;
      // Santa's extras: known ones, each once, not the door's own.
      const more = [...new Set(Array.isArray(c.more) ? c.more : [])].filter((m) => typeof m === 'string' && m !== c.item && (!ornaments || ornaments.includes(m))).slice(0, MORE);
      if (more.length) d.more = more;
    }
    if (c.text) d.text = clean(c.text, 600);
    if (c.forYimei) d.forYimei = clean(c.forYimei, 600);
    if (c.forAaron) d.forAaron = clean(c.forAaron, 600);
    const pin = Number(c.pin);
    if (Number.isInteger(pin) && pin >= 1 && pin <= DOORS && !pinned.has(pin)) {
      d.pin = pin;
      pinned.add(pin);
    }
    out.push(d);
  }
  while (out.length < DOORS) out.push({ kind: 'note', title: 'A note for you 💌', text: 'Thinking of you. 💕' });
  return out;
}

// The doors file: JSON, XOR'd with a fixed key and base64'd. Not a secret from anyone who tries, just from a peek.
const KEY = Buffer.from('bearly-apart:advent:no-peeking', 'utf8');
function xor(buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ KEY[i % KEY.length] ^ (i * 7) % 251;
  return out;
}
function encode(contents) {
  return xor(Buffer.from(JSON.stringify({ v: 1, doors: contents }), 'utf8')).toString('base64');
}
function decode(text) {
  try {
    const d = JSON.parse(xor(Buffer.from(String(text).trim(), 'base64')).toString('utf8'));
    return d?.v === 1 ? d.doors : null;
  } catch {
    return null;
  }
}

// day (1..24) → index into the contents. Pinned ones go to their day; the rest are shuffled onto the other days.
function order(contents, seed) {
  const byDay = new Array(DOORS + 1).fill(-1);
  const free = [];
  contents.forEach((c, i) => {
    if (c.pin && byDay[c.pin] === -1) byDay[c.pin] = i;
    else free.push(i);
  });
  // A seeded Fisher-Yates over the unpinned contents.
  let s = crypto.createHash('sha256').update(String(seed)).digest();
  let k = 0;
  const rand = () => {
    if (k + 4 > s.length) {
      s = crypto.createHash('sha256').update(s).digest();
      k = 0;
    }
    const v = s.readUInt32BE(k) / 2 ** 32;
    k += 4;
    return v;
  };
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  for (let d = 1; d <= DOORS; d++) if (byDay[d] === -1) byDay[d] = free.shift();
  return byDay;
}

// The same seed on both apps: the two of you and the year.
function seedFor(people, year) {
  return `${[...people].sort().join('+')}:${year}`;
}

// The ornament kinds a set of opened doors has given this person, Santa's extras too (the heart door gives their own
// half).
function ornamentsFrom(contents, byDay, openedDays, half) {
  const out = new Set();
  for (const d of openedDays) {
    const c = contents[byDay[d]];
    if (c?.kind !== 'ornament') continue;
    for (const item of [c.item, ...(c.more || [])]) out.add(item === 'heart-half' ? half : item);
  }
  return out;
}

// The day the tree lights are behind (0 if no door has them).
function lightsDay(contents, byDay) {
  for (let d = 1; d <= DOORS; d++) if (contents[byDay[d]]?.kind === 'lights') return d;
  return 0;
}

module.exports = { DOORS, KINDS, MORE, DEFAULT_CONTENTS, cleanContents, encode, decode, order, seedFor, ornamentsFrom, lightsDay };
