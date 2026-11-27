// The Christmas tree's rules: when it's up, how it grows through December, which ornaments each of you has, and
// how the two apps' copies of the tree merge. No Electron here.
//
// Every change is an "op" sent over the relay and applied when it comes back (so both apps apply the same ops in the
// same order). Each part of the state carries the stamp of the op that last set it ([relay ms, message id]), so two
// whole copies can also be merged in any order and still agree. That's how an app that was offline catches up.

const DAY_MS = 86_400_000;
const SLOTS = 36;
const STAR_WINDOW_MS = 20_000; // the star goes on when you both click within this of each other
const JOIN_DISTANCE = 130; // heart halves on spots this close (tree canvas px) meet as one heart

// The season starts on November 27 (the special day) and the tree is up until the end of Jan 1 (the farewell day), on
// whichever of your clocks gets there first. Season days: Nov 27-30 are 1-4, December 1-31 are 5-35, Jan 1 is 36.
// The advent calendar's door for each day is that day's number too (door 1 = Nov 27 ... door 29 = Dec 25).
const DEC = 4; // season day = date in December + DEC
const LAST_DAY = 31 + DEC + 1; // Jan 1
const STAGES = [
  // [season day, stage]
  [1, 'bare'],
  [7 + DEC, 'garland'], // Dec 7
  [14 + DEC, 'lights'], // Dec 14
];
const STAR_DAY = 24 + DEC; // Christmas Eve

// Each ornament: its name, how many colourways it has, and the December day it arrives in your box (a stand-in for
// the advent calendar, which will hand them out instead once it exists).
const KINDS = {
  'bauble-zigzag': { name: 'zigzag bauble', emoji: '🔴', colors: 4, day: 1 },
  'bauble-stripe': { name: 'striped bauble', emoji: '🔴', colors: 3, day: 1 },
  'bauble-dots': { name: 'polka-dot bauble', emoji: '🔴', colors: 3, day: 1 },
  star: { name: 'star', emoji: '⭐', colors: 3, day: 1 },
  snowflake: { name: 'snowflake', emoji: '❄️', colors: 2, day: 2 },
  bell: { name: 'bell', emoji: '🔔', colors: 2, day: 3 },
  'candy-cane': { name: 'candy cane', emoji: '🍬', colors: 2, day: 4 },
  gingerbread: { name: 'gingerbread bear', emoji: '🍪', colors: 1, day: 5 },
  'bauble-snow': { name: 'snow globe bauble', emoji: '🔮', colors: 1, day: 6 },
  teardrop: { name: 'teardrop', emoji: '💧', colors: 2, day: 7 },
  pinecone: { name: 'pinecone', emoji: '🌰', colors: 1, day: 8 },
  mitten: { name: 'mitten', emoji: '🧤', colors: 2, day: 9 },
  present: { name: 'little present', emoji: '🎁', colors: 3, day: 10 },
  boba: { name: 'boba tea', emoji: '🧋', colors: 2, day: 11 },
  plane: { name: 'little plane', emoji: '✈️', colors: 2, day: 12 },
  heart: { name: 'felt heart', emoji: '❤️', colors: 2, day: 13 },
  // Each of you gets one half (Dudu's person the left, Bubu's the right). Hung side by side, they make one heart.
  'heart-left': { name: 'heart half', emoji: '💔', colors: 2, day: 14, half: true },
  'heart-right': { name: 'heart half', emoji: '💔', colors: 2, day: 14, half: true },
  dudu: { name: 'Dudu ornament', emoji: '🐻', colors: 1, day: 15 },
  bubu: { name: 'Bubu ornament', emoji: '🐻‍❄️', colors: 1, day: 15 },
  'first-xmas': { name: '2026 ornament', emoji: '🎄', colors: 1, day: 16 },
  // Added with the November doors (0.12.0).
  locket: { name: '27 locket', emoji: '💝', colors: 2, day: 17 },
  stocking: { name: 'stocking', emoji: '🧦', colors: 2, day: 18 },
  snowman: { name: 'snowman', emoji: '⛄', colors: 1, day: 19 },
  reindeer: { name: 'reindeer', emoji: '🦌', colors: 2, day: 20 },
  cocoa: { name: 'hot cocoa', emoji: '☕', colors: 2, day: 21 },
};

// ---------- styles ----------
// Each ornament can be restyled by its owner: main and accent colour, pattern (glass baubles), finish and size.
// A tree can be restyled too (by its owner, or by either of you on a shared tree). The window and the overlay draw
// them (src/app/tree-art.js has the same names).
const ORN_COLORS = ['red', 'berry', 'pink', 'peach', 'gold', 'cream', 'white', 'silver', 'mint', 'green', 'teal', 'sky', 'navy', 'lavender', 'plum', 'cocoa', 'black'];
const PATTERNS = ['plain', 'zigzag', 'stripes', 'dots', 'snow', 'hearts', 'stars', 'plaid', 'swirl'];
const FINISHES = ['shiny', 'matte', 'glitter'];
const SIZES = ['s', 'm', 'l'];
const TREE_STYLE = {
  color: ['classic', 'frosted', 'snowy', 'pink', 'gold', 'midnight'],
  garland: ['gold', 'silver', 'red', 'beads', 'none'],
  lights: ['rainbow', 'warm', 'cool', 'pink', 'candy'],
  topper: ['star', 'heart', 'bow', 'snowflake'],
  skirt: ['red', 'green', 'plaid', 'white', 'none'],
};

// Only known keys with known values get through.
function cleanStyle(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  if (ORN_COLORS.includes(s.p)) out.p = s.p;
  if (ORN_COLORS.includes(s.a)) out.a = s.a;
  if (PATTERNS.includes(s.pat)) out.pat = s.pat;
  if (FINISHES.includes(s.fin)) out.fin = s.fin;
  if (SIZES.includes(s.size)) out.size = s.size;
  return out;
}

function cleanTreeStyle(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  for (const [k, list] of Object.entries(TREE_STYLE)) if (list.includes(s[k])) out[k] = s[k];
  return out;
}

// ---------- dates ----------

function partsIn(now, tz) {
  const opts = { year: 'numeric', month: 'numeric', day: 'numeric' };
  let f;
  try {
    f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined });
  } catch {
    f = new Intl.DateTimeFormat('en-US', opts);
  }
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day };
}

// Which day of the Christmas season it is on one clock: 1..4 on Nov 27-30, 5..35 in December, 36 on Jan 1, 0 at any
// other time.
function seasonDay(now, tz) {
  const { m, d } = partsIn(now, tz);
  if (m === 11 && d >= 27) return d - 26;
  // The season opens a minute early, at 11:59 pm on November 26 (0.12.0).
  if (m === 11 && d === 26 && partsIn(now + 60_000, tz).d === 27) return 1;
  if (m === 12) return d + DEC;
  if (m === 1 && d === 1) return LAST_DAY;
  return 0;
}

// A season day as a date ("November 27", "December 3", "January 1"), and the number on its advent door (27..30, 1..25).
function dateName(day) {
  if (day < 1) return '';
  if (day <= DEC) return `November ${day + 26}`;
  if (day < LAST_DAY) return `December ${day - DEC}`;
  return 'January 1';
}
const doorLabel = (day) => (day <= DEC ? day + 26 : day - DEC);

// The season's year (Jan 1 still belongs to last December's tree).
function seasonYear(now, tz) {
  const { y, m } = partsIn(now, tz);
  return m === 1 ? y - 1 : y;
}

// The later of the two clocks' season days, so both apps open the tree together. A tester's pretend day wins.
function dayFor(now, zones, testDay = 0) {
  if (testDay) return testDay;
  return Math.max(0, ...zones.map((tz) => seasonDay(now, tz)));
}

const isUp = (day) => day >= 1 && day <= LAST_DAY;

function stageFor(day) {
  let s = null;
  for (const [from, name] of STAGES) if (day >= from) s = name;
  return s;
}

const starDay = (day) => day >= STAR_DAY;

// ---------- who has what ----------

// Dudu's person gets the left half of the heart, Bubu's the right. The other half is never in your box.
function halfFor(character) {
  return character === 'cream' ? 'heart-right' : 'heart-left';
}

function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}

// An item is one ornament in one person's box: "<person>~<kind>". Its colour is fixed by who owns it, and the two of
// you get different colours of the same ornament where it has more than one.
function itemId(owner, kind) {
  return `${owner}~${kind}`;
}

function parseItem(id) {
  const m = String(id || '').match(/^([\w.-]{1,40})~([a-z-]{1,24})$/);
  return m && KINDS[m[2]] ? { owner: m[1], kind: m[2] } : null;
}

function colorOf(id, people = []) {
  const it = parseItem(id);
  if (!it) return 0;
  const n = KINDS[it.kind].colors;
  const rank = Math.max(0, [...people].sort().indexOf(it.owner));
  return (hash(it.kind) + rank) % n;
}

// Everything in this person's box: the ornaments their opened advent doors gave them (kinds: a Set). Without a
// calendar (kinds null), by date, as before the calendar existed.
function unlockedItems(owner, character, day, kinds = null) {
  if (!owner || !isUp(day)) return [];
  const mine = halfFor(character);
  return Object.entries(KINDS)
    .filter(([kind, k]) => (kinds ? kinds.has(kind) : k.day + DEC <= day) && (!k.half || kind === mine))
    .map(([kind]) => itemId(owner, kind));
}

// ---------- the shared state ----------

function emptyState(year) {
  return { v: 1, year, choice: {}, items: {}, taps: {}, star: null, opened: {}, styles: {}, treeStyles: {} };
}

// The advent doors each of you has opened: { person: { day: relay ms } }.
const ADVENT_DAYS = 29; // the advent calendar runs November 27 to December 25 (advent.js DOORS)

// Stamps order everything: [relay ms, relay message id].
function later(a, b) {
  if (!b) return true;
  if (!a) return false;
  return a[0] !== b[0] ? a[0] > b[0] : String(a[1]) > String(b[1]);
}

// One tree for both if you both chose it, two trees if either of you chose your own, null while still deciding.
function modeOf(state, people) {
  const picks = people.map((p) => state.choice[p]?.m);
  if (picks.includes('own')) return 'own';
  if (people.length === 2 && picks.every((m) => m === 'shared')) return 'shared';
  return null;
}

function treesFor(mode, people) {
  if (mode === 'shared') return ['us'];
  if (mode === 'own') return [...people];
  return [];
}

// Applies one op (from a relay event) to a copy of the state. Unknown or not-allowed ops change nothing.
function apply(state, op, ev, people) {
  if (!op || typeof op !== 'object' || !people.includes(ev.from)) return state;
  const t = [ev.at || 0, String(ev.id || '')];
  const s = { ...state, choice: { ...state.choice }, items: { ...state.items }, taps: { ...state.taps }, opened: { ...(state.opened || {}) }, styles: { ...(state.styles || {}) }, treeStyles: { ...(state.treeStyles || {}) } };
  const mode = modeOf(state, people);
  if (op.k === 'style') {
    // Only an ornament's owner restyles it.
    const it = parseItem(op.item);
    const style = cleanStyle(op.style);
    if (!it || it.owner !== ev.from || !style) return state;
    if (later(t, s.styles[op.item]?.t)) s.styles[op.item] = { s: style, t };
    return s;
  }
  if (op.k === 'treestyle') {
    // A tree's owner restyles it; a shared tree, either of you.
    const style = cleanTreeStyle(op.style);
    if (!style || !treesFor(mode, people).includes(op.tree) || (op.tree !== 'us' && op.tree !== ev.from)) return state;
    if (later(t, s.treeStyles[op.tree]?.t)) s.treeStyles[op.tree] = { s: style, t };
    return s;
  }
  if (op.k === 'open') {
    const day = Number(op.day);
    if (!Number.isInteger(day) || day < 1 || day > ADVENT_DAYS || s.opened[ev.from]?.[day]) return state;
    s.opened[ev.from] = { ...s.opened[ev.from], [day]: t[0] };
    return s;
  }
  if (op.k === 'choose') {
    if (mode || !['shared', 'own'].includes(op.m)) return state; // decided: stays until the tree comes down
    if (later(t, s.choice[ev.from]?.t)) s.choice[ev.from] = { m: op.m, t };
    return s;
  }
  if (op.k === 'hang' || op.k === 'take') {
    const it = parseItem(op.item);
    if (!it || it.owner !== ev.from || !mode) return state;
    let place = { tr: '', s: -1, t };
    if (op.k === 'hang') {
      const slot = Number(op.slot);
      if (!treesFor(mode, people).includes(op.tree) || !Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return state;
      // Someone got to this spot first (in relay order, the same on every computer): this one stays in its box.
      const there = placements(state, op.tree)[slot];
      if (there && there !== op.item) return state;
      place = { tr: op.tree, s: slot, t };
    }
    if (later(t, s.items[op.item]?.t)) s.items[op.item] = place;
    return s;
  }
  if (op.k === 'tap') {
    s.taps[ev.from] = Math.max(s.taps[ev.from] || 0, t[0]);
    return withStar(s, people);
  }
  return state;
}

// The star turns on (for good) the moment both of you have clicked within STAR_WINDOW_MS of each other.
function withStar(s, people) {
  if (s.star) return s;
  const [a, b] = people.map((p) => s.taps[p] || 0);
  if (a && b && Math.abs(a - b) <= STAR_WINDOW_MS) return { ...s, star: Math.max(a, b) };
  return s;
}

// Two whole copies of the state → one, the same whichever way round.
function merge(a, b, people) {
  if (!b || b.v !== 1) return a;
  if (!a || b.year > a.year) return b;
  if (b.year < a.year) return a;
  const out = emptyState(a.year);
  for (const key of ['choice', 'items', 'styles', 'treeStyles']) {
    const keys = new Set([...Object.keys(a[key] || {}), ...Object.keys(b[key] || {})]);
    for (const k of keys) {
      const x = a[key]?.[k];
      const y = b[key]?.[k];
      out[key][k] = later(y?.t, x?.t) ? y : x;
    }
  }
  for (const p of new Set([...Object.keys(a.taps || {}), ...Object.keys(b.taps || {})])) out.taps[p] = Math.max(a.taps?.[p] || 0, b.taps?.[p] || 0);
  // Opened doors only ever get added: the union, keeping when each was first opened.
  for (const p of new Set([...Object.keys(a.opened || {}), ...Object.keys(b.opened || {})])) {
    const x = a.opened?.[p] || {};
    const y = b.opened?.[p] || {};
    out.opened[p] = {};
    for (const d of new Set([...Object.keys(x), ...Object.keys(y)])) out.opened[p][d] = Math.min(x[d] ?? Infinity, y[d] ?? Infinity);
  }
  out.star = a.star && b.star ? Math.min(a.star, b.star) : a.star || b.star || null;
  return withStar(out, people);
}

// Only well-formed parts of a state from the relay get through.
function clean(s, people) {
  if (!s || typeof s !== 'object' || s.v !== 1 || !Number.isInteger(s.year)) return null;
  const stamp = (t) => Array.isArray(t) && Number.isFinite(t[0]) && typeof t[1] === 'string' && [t[0], t[1].slice(0, 40)];
  const out = emptyState(s.year);
  for (const p of people) {
    const c = s.choice?.[p];
    if (c && ['shared', 'own'].includes(c.m) && stamp(c.t)) out.choice[p] = { m: c.m, t: stamp(c.t) };
    if (Number.isFinite(s.taps?.[p])) out.taps[p] = s.taps[p];
    const o = s.opened?.[p];
    if (o && typeof o === 'object') {
      out.opened[p] = {};
      for (const [d, at] of Object.entries(o)) {
        const day = Number(d);
        if (Number.isInteger(day) && day >= 1 && day <= ADVENT_DAYS && Number.isFinite(at)) out.opened[p][day] = at;
      }
    }
  }
  for (const [id, v] of Object.entries(s.items || {}).slice(0, 200)) {
    const it = parseItem(id);
    if (!it || !people.includes(it.owner) || !v || !stamp(v.t)) continue;
    const slot = Number(v.s);
    const tr = typeof v.tr === 'string' && (v.tr === '' || v.tr === 'us' || people.includes(v.tr)) ? v.tr : null;
    if (tr === null || (tr && (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS))) continue;
    out.items[id] = { tr, s: tr ? slot : -1, t: stamp(v.t) };
  }
  out.star = Number.isFinite(s.star) ? s.star : null;
  for (const [id, v] of Object.entries(s.styles || {}).slice(0, 200)) {
    const it = parseItem(id);
    const style = cleanStyle(v?.s);
    if (it && people.includes(it.owner) && style && stamp(v.t)) out.styles[id] = { s: style, t: stamp(v.t) };
  }
  for (const [tree, v] of Object.entries(s.treeStyles || {})) {
    const style = cleanTreeStyle(v?.s);
    if ((tree === 'us' || people.includes(tree)) && style && stamp(v.t)) out.treeStyles[tree] = { s: style, t: stamp(v.t) };
  }
  return withStar(out, people);
}

// What hangs on one tree: slot → item id. Two ornaments on one spot: the one hung first keeps it, the other goes
// back to its box (both apps settle it the same way).
function placements(state, tree) {
  const out = {};
  const entries = Object.entries(state.items)
    .filter(([, v]) => v.tr === tree)
    .sort(([, a], [, b]) => (later(b.t, a.t) ? -1 : later(a.t, b.t) ? 1 : 0));
  for (const [id, v] of entries) if (!(v.s in out)) out[v.s] = id;
  return out;
}

// Where an item is right now: { tree, slot } or null (in its box).
function whereIs(state, mode, people, id) {
  for (const tree of treesFor(mode, people)) {
    const p = placements(state, tree);
    for (const [slot, other] of Object.entries(p)) if (other === id) return { tree, slot: Number(slot) };
  }
  return null;
}

// A short fingerprint, so two apps can tell cheaply whether their copies already agree.
function fingerprint(state) {
  return hash(JSON.stringify(state)).toString(36);
}

module.exports = {
  DAY_MS,
  SLOTS,
  DEC,
  LAST_DAY,
  dateName,
  doorLabel,
  STAR_WINDOW_MS,
  JOIN_DISTANCE,
  STAR_DAY,
  KINDS,
  seasonDay,
  seasonYear,
  dayFor,
  isUp,
  stageFor,
  starDay,
  halfFor,
  itemId,
  parseItem,
  colorOf,
  unlockedItems,
  emptyState,
  later,
  modeOf,
  treesFor,
  apply,
  merge,
  clean,
  placements,
  whereIs,
  fingerprint,
  ADVENT_DAYS,
  ORN_COLORS,
  PATTERNS,
  FINISHES,
  SIZES,
  TREE_STYLE,
  cleanStyle,
  cleanTreeStyle,
};
