// Tiny JSON-file store for config (user-editable) and state (app-managed).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYWORDS = {
  'miss you': 'miss-you',
  'missing you': 'miss-you',
  'miss u': 'miss-you',
  '🥺': 'miss-you',
  kiss: 'kiss',
  kisses: 'kiss',
  kissy: 'kiss',
  mwah: 'kiss',
  '😘': 'kiss',
  '💋': 'kiss',
  hug: 'hug',
  hugs: 'hug',
  hugging: 'hug',
  '🫂': 'hug',
};

// Bump when a default has to replace what's saved in existing config.json files (see migrate()).
const CONFIG_VERSION = 3;

const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  // false until the first-run setup in the app window is finished
  setupDone: false,
  // handles: my own iMessage phone numbers / emails, passed along when pairing so a Mac partner can see my texts.
  me: { id: '', name: '', character: 'brown', handles: [] },
  partner: {
    id: '',
    name: '',
    character: 'cream',
    // iMessage phone numbers / emails the partner texts from (Mac only).
    imessageHandles: [],
    // IANA zone like "America/New_York"; used to avoid "missing you" while they sleep.
    timezone: '',
  },
  relay: { server: 'https://ntfy.sh', topic: '', token: '' },
  imessage: { enabled: true, pollSec: 3 },
  // Plain-message animations play at most this often; extra texts count toward a combo.
  cooldownSec: 90,
  combo: { count: 5, windowSec: 90 },
  // Escalating "you haven't heard from them" scenes.
  missing: [
    { hours: 3, scene: 'missing-peek' },
    { hours: 6, scene: 'missing-sword' },
    { hours: 12, scene: 'missing-poster' },
  ],
  // No animations during these local hours; anything that arrives is saved for later.
  quietHours: { start: '23:30', end: '08:00' },
  partnerSleepHours: { start: '00:00', end: '08:00' },
  awayAfterSec: 300,
  pauseWhenFullscreen: true,
  respectFocus: true,
  // Wait while screen sharing, or while one of pauseApps is in front.
  pauseDuringCalls: true,
  // Never play while one of these apps is in front (screen shares, calls, slideshows).
  pauseApps: ['zoom.us', 'Microsoft Teams', 'Webex', 'FaceTime', 'Keynote', 'Microsoft PowerPoint', 'Google Meet', 'Slack Huddle'],
  // Phrase in a text → animation. Kept to three on purpose; more can come later.
  keywords: KEYWORDS,
  visitDate: '',
  morning: { enabled: true, afterHour: 5 },
  hugWindowSec: 20,
  scale: 1,
  launchAtLogin: true,
};

const DEFAULT_STATE = {
  lastHeardAt: 0,
  missingLevel: 0,
  partnerStatus: null, // { name, at }
  partnerPresence: null, // { state: 'here' | 'away', at }, from their app
  pendingScenes: [], // scenes waiting to play (saved so quitting doesn't lose them)
  pendingSince: 0,
  myStatus: null, // { name, at }, the last status I sent
  partnerAsleep: false,
  noteJar: [],
  lastMorningDate: '',
  relaySince: '',
  imessageLastRowId: 0,
  sentHeartAt: 0,
  gotHeartAt: 0,
  snoozedUntil: 0,
  helloSent: false,
  lastVersion: '', // the app version that last ran here, to notice updates
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(defaults, value) {
  if (!isObj(defaults) || !isObj(value)) return value === undefined ? defaults : value;
  const out = { ...defaults };
  for (const k of Object.keys(value)) out[k] = merge(defaults[k], value[k]);
  return out;
}

class JsonFile {
  // debounceMs > 0 batches writes (state changes on every relay message); call flush() before quitting.
  constructor(file, defaults, { debounceMs = 0 } = {}) {
    this.file = file;
    this.defaults = defaults;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.raw = this.read();
    this.data = merge(structuredClone(defaults), this.raw);
  }
  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  set(patch) {
    this.data = merge(this.data, patch);
    if (!this.debounceMs) return this.save();
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    this.save();
  }
}

// Brings an older config.json up to date.
//   2: only the three text triggers (miss you, kiss, hug)
//   3: first-run setup; anyone already named and paired skips it
function migrate(config) {
  const from = config.raw.version || 1;
  if (from >= CONFIG_VERSION) return;
  if (from < 2) config.data.keywords = { ...KEYWORDS };
  if (from < 3) config.data.setupDone = !!(config.data.me.name && config.data.partner.id);
  config.data.version = CONFIG_VERSION;
}

function slug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'me';
}

function newTopic() {
  // 20 base32 chars ≈ 100 bits; the topic is the only secret on a public ntfy server.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const bytes = crypto.randomBytes(20);
  return 'ba-' + Array.from(bytes, (b) => alphabet[b & 31]).join('');
}

// The invite code: the relay to meet on, plus who I am (name, bear, time zone, iMessage handles).
function encodePairing(config, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const payload = {
    s: config.relay.server,
    t: config.relay.topic,
    k: config.relay.token || undefined,
    id: config.me.id,
    n: config.me.name,
    c: config.me.character,
    z: timezone || undefined,
    h: config.me.handles?.length ? config.me.handles : undefined,
  };
  return 'BA1-' + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

// Finds a code anywhere in what was pasted (a whole text message is fine).
function findPairingCode(text) {
  return String(text || '').match(/BA1-[A-Za-z0-9_-]{20,}/)?.[0] || null;
}

function decodePairing(text) {
  const code = findPairingCode(text);
  if (!code) throw new Error('That does not look like a Bearly Apart invite code.');
  let p;
  try {
    p = JSON.parse(Buffer.from(code.slice(4), 'base64url').toString('utf8'));
  } catch {
    throw new Error('That invite code is cut off. Copy the whole thing and try again.');
  }
  if (!p.s || !p.t) throw new Error('That invite code is missing the relay details.');
  const partner = { id: p.id || '', name: p.n || '', character: p.c || 'brown' };
  if (p.z) partner.timezone = p.z;
  if (Array.isArray(p.h) && p.h.length) partner.imessageHandles = p.h.map(String);
  return { relay: { server: p.s, topic: p.t, token: p.k || '' }, partner };
}

function openStores(dir) {
  const config = new JsonFile(path.join(dir, 'config.json'), DEFAULT_CONFIG);
  const state = new JsonFile(path.join(dir, 'state.json'), DEFAULT_STATE, { debounceMs: 500 });
  migrate(config);
  if (!config.data.relay.topic) config.data.relay.topic = newTopic();
  config.save(); // also writes out newly added default keys so they are easy to edit
  return { config, state };
}

module.exports = { openStores, JsonFile, DEFAULT_CONFIG, DEFAULT_STATE, KEYWORDS, merge, migrate, slug, newTopic, encodePairing, decodePairing, findPairingCode };
