// Tiny JSON-file store for config (user-editable) and state (app-managed).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG = {
  me: { id: '', name: '', character: 'brown' },
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
  // Never play while one of these apps is in front (screen shares, calls, slideshows).
  pauseApps: ['zoom.us', 'Microsoft Teams', 'Webex', 'FaceTime', 'Keynote', 'Microsoft PowerPoint', 'Google Meet', 'Slack Huddle'],
  keywords: {
    'miss you': 'miss-you',
    'missing you': 'miss-you',
    'love you': 'love-you',
    'goodnight': 'goodnight',
    'good night': 'goodnight',
    'gn': 'goodnight',
    'good morning': 'good-morning',
    'gm': 'good-morning',
    'hungry': 'hungry',
    '❤️': 'love-you',
    '🥺': 'miss-you',
  },
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
  partnerAsleep: false,
  noteJar: [],
  lastMorningDate: '',
  relaySince: '',
  imessageLastRowId: 0,
  sentHeartAt: 0,
  gotHeartAt: 0,
  snoozedUntil: 0,
  helloSent: false,
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
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = merge(structuredClone(defaults), this.read());
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
    this.save();
  }
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

function encodePairing(config) {
  const payload = {
    s: config.relay.server,
    t: config.relay.topic,
    k: config.relay.token || undefined,
    id: config.me.id,
    n: config.me.name,
    c: config.me.character,
  };
  return 'BA1-' + Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePairing(code) {
  const m = String(code).trim().match(/^BA1-([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('That does not look like a Bearly Apart pairing code.');
  const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  if (!p.s || !p.t) throw new Error('Pairing code is missing the relay details.');
  return {
    relay: { server: p.s, topic: p.t, token: p.k || '' },
    partner: { id: p.id || '', name: p.n || '', character: p.c || 'brown' },
  };
}

function openStores(dir) {
  const config = new JsonFile(path.join(dir, 'config.json'), DEFAULT_CONFIG);
  const state = new JsonFile(path.join(dir, 'state.json'), DEFAULT_STATE);
  if (!config.data.relay.topic) config.set({ relay: { topic: newTopic() } });
  else config.save(); // write out any newly added default keys so they are easy to edit
  return { config, state };
}

module.exports = { openStores, JsonFile, DEFAULT_CONFIG, DEFAULT_STATE, merge, slug, newTopic, encodePairing, decodePairing };
