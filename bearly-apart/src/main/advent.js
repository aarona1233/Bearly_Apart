// The advent calendar's rules: what's behind the 29 doors (November 27, the special day, to Christmas Day), and which
// door comes on which day. No Electron here.
//
// Aaron fills the doors (the door editor, tester only); they ship inside the app in assets/advent/doors.dat, encoded
// so a look inside the app folder doesn't spoil anything. Each content is shuffled onto a day with a seed made from
// the two of you and the year, so both apps put the same thing behind the same door without talking, and the order
// is never shown or logged. A content can be pinned to a door instead (the locket on Nov 27, the star on Dec 24).
// Door n is season day n (src/main/tree.js): 1-4 are Nov 27-30, 5-29 are Dec 1-25.
const crypto = require('crypto');

const DOORS = 29;
const KINDS = ['ornament', 'note', 'snow', 'star'];

// What the doors hold until Aaron fills them in: every ornament (one door gives each of you your half of the heart),
// two snow days, a note, the "27" locket on Nov 27 and the star on Christmas Eve.
const DEFAULT_CONTENTS = [
  ...['bauble-zigzag', 'bauble-stripe', 'bauble-dots', 'star', 'snowflake', 'bell', 'candy-cane', 'gingerbread', 'bauble-snow', 'teardrop', 'pinecone', 'mitten', 'present', 'boba', 'plane', 'heart', 'heart-half', 'dudu', 'bubu', 'first-xmas', 'stocking', 'snowman', 'reindeer', 'cocoa'].map((item) => ({ kind: 'ornament', item })),
  { kind: 'ornament', item: 'locket', title: 'It’s the 27th 💝', text: 'Our day. The calendar starts here, and every door after this is one day closer to Christmas.', pin: 1 },
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

// The ornament kinds a set of opened doors has given this person (the heart door gives their own half).
function ornamentsFrom(contents, byDay, openedDays, half) {
  const out = new Set();
  for (const d of openedDays) {
    const c = contents[byDay[d]];
    if (c?.kind !== 'ornament') continue;
    out.add(c.item === 'heart-half' ? half : c.item);
  }
  return out;
}

module.exports = { DOORS, KINDS, DEFAULT_CONTENTS, cleanContents, encode, decode, order, seedFor, ornamentsFrom };
