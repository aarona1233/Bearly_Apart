// The photo booth's rules: which day it's open, when the shots fire, the settings both apps share, and the
// encryption that keeps the photos to the two of you. No Electron here.
const crypto = require('crypto');

// When the booth (and the Draft tab) unlock: this local time on whichever of your two clocks gets there first, so
// both apps unlock at the same moment. The booth then stays open until both of you are past its last day.
const UNLOCK_AT = '2026-11-24 23:59';
const BOOTH_LAST_DAY = '2026-11-25';
const SHOTS = 4;
// From the "go" message: time for it to reach the other app and for you both to get ready, then one shot every
// SHOT_GAP_MS. The window counts down the last 3 seconds before each shot.
const LEAD_MS = 6000;
const SHOT_GAP_MS = 6500;

const DESIGNS = ['classic', 'picnic', 'film', 'letter', 'moon', 'snow'];
const FILTERS = ['bw', 'warm', 'blush', 'cocoa', 'fuji', 'dreamy', 'natural'];
// 'auto' is the design's own colour.
const COLORS = ['auto', 'cream', 'blush', 'peach', 'butter', 'mint', 'sky', 'lavender', 'kraft', 'red', 'green', 'navy', 'black'];
const DECOS = ['none', 'thanksgiving', 'christmas', 'valentine', 'newyear', 'halloween', 'birthday', 'anniversary'];
// Emoji stickers (the window's booth-strip.js has the same names), then the bear pictures in assets/booth.
const EMOJI_STICKERS = {
  cute: ['heart', 'hearts', 'bow', 'boba', 'paw', 'honey', 'star', 'sparkle', 'flower', 'kiss', 'snow', 'cherry'],
  thanksgiving: ['turkey', 'leaf', 'maple', 'pie', 'corn', 'drumstick'],
  christmas: ['tree', 'gift', 'snowman', 'bell', 'reindeer', 'cookie', 'sock', 'santa'],
  valentine: ['cupid', 'heartbox', 'rose', 'letterheart', 'chocolate', 'sparkleheart'],
  newyear: ['fireworks', 'cheers', 'party', 'confetti', 'clock'],
  halloween: ['pumpkin', 'ghost', 'bat', 'candy', 'web'],
  birthday: ['cake', 'balloon', 'present', 'cupcake'],
  anniversary: ['ring', 'bouquet', 'champagne', 'lovebirds'],
};
const STICKERS = Object.values(EMOJI_STICKERS).flat().concat(
  ['wiggle', 'happy', 'letter', 'dance', 'boba'].flatMap((p) => [`${p}-brown`, `${p}-cream`]),
  ['pair-cuddle', 'pair-hug', 'pair-together'],
);
const DEFAULT_PROMPTS = ['Wave at each other 👋', 'Make half a heart with your hands 🫶', 'Kiss your side of the line 💋', 'Silly face! 🤪'];

const DEFAULT_SETTINGS = {
  design: 'classic',
  filter: 'bw',
  prompts: DEFAULT_PROMPTS,
  occasion: '',
  places: {}, // person id -> what the strip calls where they are ("New York"); empty = from their time zone
  bears: true,
  times: true,
  stamp: true,
  tags: true, // little name tags on the first shot: whose side is whose
  color: 'auto',
  deco: 'none', // holiday decorations around the photos
  note: '', // written on the back of the strip
  noteBy: '',
  thenNow: false, // the strip has a fifth frame with an old photo of you two (then.jpg)
  stickers: [], // [{ k: sticker name, x, y (0..1 of the strip), s: size (0..1 of its width), r: degrees }]
};

const clampNum = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);

// Only known settings, in their known shapes, get through: a bad patch from anywhere can't break the strip.
function cleanSettings(patch, base = DEFAULT_SETTINGS) {
  const out = { ...base };
  if (!patch || typeof patch !== 'object') return out;
  if (DESIGNS.includes(patch.design)) out.design = patch.design;
  if (FILTERS.includes(patch.filter)) out.filter = patch.filter;
  if (COLORS.includes(patch.color)) out.color = patch.color;
  if (DECOS.includes(patch.deco)) out.deco = patch.deco;
  if (Array.isArray(patch.prompts)) out.prompts = [...Array(SHOTS)].map((_, i) => text(patch.prompts[i] ?? base.prompts[i] ?? '', 80));
  if ('occasion' in patch) out.occasion = text(patch.occasion, 60);
  if (patch.places && typeof patch.places === 'object')
    out.places = Object.fromEntries(Object.entries({ ...base.places, ...patch.places }).slice(0, 4).map(([k, v]) => [text(k, 40), text(v, 30)]));
  for (const k of ['bears', 'times', 'stamp', 'tags', 'thenNow']) if (k in patch) out[k] = !!patch[k];
  if ('note' in patch) out.note = text(patch.note, 500);
  if ('noteBy' in patch) out.noteBy = text(patch.noteBy, 40);
  if (Array.isArray(patch.stickers))
    out.stickers = patch.stickers
      .filter((s) => s && STICKERS.includes(s.k))
      .slice(0, 30)
      .map((s) => ({ k: s.k, x: clampNum(s.x, 0, 1, 0.5), y: clampNum(s.y, 0, 1, 0.5), s: clampNum(s.s, 0.04, 0.6, 0.12), r: clampNum(s.r, -180, 180, 0) }));
  return out;
}

// 'YYYY-MM-DD' in a time zone (a bad zone counts as this computer's).
function localDate(now, tz) {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: tz || undefined }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', opts).format(now);
  }
}

// 'YYYY-MM-DD HH:MM' in a time zone.
function localStamp(now, tz) {
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  let f;
  try {
    f = new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: tz || undefined });
  } catch {
    f = new Intl.DateTimeFormat('en-CA', opts);
  }
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Past the unlock time on either clock (from then on for good: the Draft tab stays).
function unlocked(now, zones, at = UNLOCK_AT) {
  return zones.some((tz) => localStamp(now, tz) >= at);
}

function isBoothDay(now, zones, at = UNLOCK_AT, last = BOOTH_LAST_DAY) {
  return unlocked(now, zones, at) && !boothOver(now, zones, last);
}

// The booth's last day is over for both of you (the album stays; new strips don't).
function boothOver(now, zones, last = BOOTH_LAST_DAY) {
  return zones.every((tz) => localDate(now, tz) > last);
}

const shotTimes = (go) => [...Array(SHOTS)].map((_, i) => go + LEAD_MS + i * SHOT_GAP_MS);

// "America/Los_Angeles" -> "Los Angeles"
function cityOf(tz) {
  const last = String(tz || '').split('/').pop();
  return last && last !== 'UTC' ? last.replace(/_/g, ' ') : '';
}

// ---------- encryption ----------
// Each booth session makes fresh X25519 keys and swaps the public halves over the relay. The photos are sealed with
// AES-256-GCM under a key from both halves, so the relay (and anyone with the channel name) only ever holds noise.

function newKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return { pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function sessionKey(priv, theirPub, sid) {
  const secret = crypto.diffieHellman({
    privateKey: crypto.createPrivateKey(priv),
    publicKey: crypto.createPublicKey({ key: Buffer.from(theirPub, 'base64'), format: 'der', type: 'spki' }),
  });
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from('bearly-apart-booth'), Buffer.from(`booth:${sid}`), 32));
}

function seal(key, data) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

// Throws if the data was changed or sealed with another key.
function open(key, data) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  d.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([d.update(data.subarray(28)), d.final()]);
}

// Several files in one upload: a 4-byte header length, a JSON list of names and sizes, then the bytes.
function pack(files) {
  const head = Buffer.from(JSON.stringify(files.map((f) => [f.name, f.data.length])));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length);
  return Buffer.concat([len, head, ...files.map((f) => f.data)]);
}

function unpack(buf) {
  const n = buf.readUInt32BE(0);
  const list = JSON.parse(buf.subarray(4, 4 + n).toString());
  let at = 4 + n;
  return list.map(([name, size]) => {
    const data = buf.subarray(at, at + size);
    at += size;
    if (data.length !== size) throw new Error('the photos came through cut short');
    return { name: String(name), data };
  });
}

const newSid = () => crypto.randomBytes(5).toString('hex');

module.exports = {
  UNLOCK_AT,
  BOOTH_LAST_DAY,
  SHOTS,
  LEAD_MS,
  SHOT_GAP_MS,
  DESIGNS,
  FILTERS,
  COLORS,
  DECOS,
  EMOJI_STICKERS,
  STICKERS,
  DEFAULT_PROMPTS,
  DEFAULT_SETTINGS,
  cleanSettings,
  localDate,
  localStamp,
  unlocked,
  isBoothDay,
  boothOver,
  shotTimes,
  cityOf,
  newKeys,
  sessionKey,
  seal,
  open,
  pack,
  unpack,
  newSid,
};
