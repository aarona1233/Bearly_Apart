// Relay over ntfy (https://ntfy.sh or self-hosted). Events travel as ntfy messages:
//   body  = human-readable text (so the ntfy iPhone app shows a nice push)
//   tags  = "ba,e.<type>,f.<senderId>[,s.<status>][,k.<keyword>]"
// That format is simple enough to send from an iPhone Shortcut.
const { EventEmitter } = require('events');

const TYPES = new Set(['message', 'tapback', 'kiss', 'heart', 'hug', 'poke', 'miss-you', 'status', 'note', 'jar', 'hello', 'test']);

function toTags(ev) {
  const tags = ['ba', `e.${ev.type}`, `f.${ev.from}`];
  if (ev.status) tags.push(`s.${ev.status}`);
  for (const k of ev.keywords || []) tags.push(`k.${k}`);
  if (ev.tapback) tags.push(`t.${ev.tapback}`);
  if (ev.character) tags.push(`c.${ev.character}`);
  return tags;
}

// ntfy message JSON -> our event, or null if it isn't one of ours.
function fromNtfy(msg) {
  if (!msg || msg.event !== 'message' || !Array.isArray(msg.tags) || !msg.tags.includes('ba')) return null;
  const ev = { id: msg.id, at: (msg.time || 0) * 1000, text: msg.message || '', title: msg.title || '', keywords: [] };
  for (const tag of msg.tags) {
    const i = tag.indexOf('.');
    if (i < 0) continue;
    const key = tag.slice(0, i);
    const val = tag.slice(i + 1);
    if (key === 'e') ev.type = val;
    else if (key === 'f') ev.from = val;
    else if (key === 's') ev.status = val;
    else if (key === 'k') ev.keywords.push(val);
    else if (key === 't') ev.tapback = val;
    else if (key === 'c') ev.character = val;
  }
  if (!ev.type || !ev.from || !TYPES.has(ev.type)) return null;
  return ev;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Relay extends EventEmitter {
  // fetch / publishFetch can be swapped: the app publishes through Electron's net.fetch (Chromium's
  // network stack), which copes better with sleep, Wi-Fi changes and proxies than Node's.
  constructor({ getConfig, getSince, setSince, log = console.log, fetch = globalThis.fetch, publishFetch = fetch, publishTimeoutMs = 8000, retryDelaysMs = [1000, 3000] }) {
    super();
    this.getConfig = getConfig;
    this.getSince = getSince;
    this.setSince = setSince;
    this.log = log;
    this.fetch = fetch;
    this.publishFetch = publishFetch;
    this.publishTimeoutMs = publishTimeoutMs;
    this.retryDelaysMs = retryDelaysMs;
    this.abort = null;
    this.stopped = true;
    this.backoff = 1000;
    this.watchdog = null;
    this.connected = false;
    this.seen = new Set(); // recent message ids, so a reconnect overlap never plays one twice
  }

  base() {
    const { server, topic } = this.getConfig().relay;
    return `${server.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`;
  }

  headers() {
    const { token } = this.getConfig().relay;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.watchdog);
    this.abort?.abort();
  }

  restart() {
    this.abort?.abort();
    this.backoff = 1000;
    if (!this.stopped) setTimeout(() => this.connect(), 50);
  }

  setConnected(v) {
    if (this.connected !== v) {
      this.connected = v;
      this.emit('connection', v);
    }
  }

  kick() {
    // ntfy sends a keepalive every ~45s; if we hear nothing for 2 minutes the socket is dead.
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      this.log('[relay] no keepalive, reconnecting');
      this.abort?.abort();
    }, 120_000);
  }

  async connect() {
    if (this.stopped || !this.getConfig().relay.topic) return;
    this.abort?.abort();
    const ctrl = new AbortController();
    this.abort = ctrl;
    // First ever connection starts from "now" instead of replaying the server cache;
    // after that we resume from the last message id so nothing sent while offline is lost.
    if (!this.getSince()) this.setSince(String(Math.floor(Date.now() / 1000)));
    const url = `${this.base()}/json?since=${encodeURIComponent(this.getSince())}`;
    try {
      const res = await this.fetch(url, { headers: this.headers(), signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.setConnected(true);
      this.backoff = 1000;
      this.kick();
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        this.kick();
        buf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) this.handleLine(line);
        }
      }
      throw new Error('stream ended');
    } catch (err) {
      if (ctrl !== this.abort) return; // superseded by a newer connection
      this.setConnected(false);
      clearTimeout(this.watchdog);
      if (this.stopped) return;
      if (err.name !== 'AbortError') this.log(`[relay] ${err.message}; retrying in ${this.backoff / 1000}s`);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    }
  }

  handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.event !== 'message') return;
    if (msg.id) {
      if (this.seen.has(msg.id)) return;
      this.seen.add(msg.id);
      if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value);
      this.setSince(msg.id);
    }
    const ev = fromNtfy(msg);
    if (ev) this.emit('event', ev);
  }

  // Each attempt gets a hard time limit: a request on a dead connection used to hang for minutes,
  // which looked like "sending is random". Network errors, 429 and 5xx are retried; 4xx are not.
  async publish(ev, text) {
    const body = text || ev.text || ev.type;
    const tags = toTags(ev).join(',');
    let lastErr;
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      if (attempt) await sleep(this.retryDelaysMs[attempt - 1]);
      try {
        const res = await this.publishFetch(this.base(), {
          method: 'POST',
          headers: {
            ...this.headers(),
            Tags: tags,
            Title: 'Bearly Apart',
            // ntfy headers must be ASCII-safe; the body carries emoji fine.
            'Content-Type': 'text/plain; charset=utf-8',
          },
          body,
          signal: AbortSignal.timeout(this.publishTimeoutMs),
        });
        if (res.ok) return res.json().catch(() => ({}));
        lastErr = new Error(res.status === 429 ? 'the relay says too many messages, try again in a bit' : `relay answered HTTP ${res.status}`);
        if (res.status < 500 && res.status !== 429) break;
      } catch (err) {
        lastErr = err.name === 'TimeoutError' ? new Error('the relay did not answer in time') : err;
      }
      this.log(`[relay] send ${ev.type} failed (${lastErr.message})${attempt < this.retryDelaysMs.length ? ', retrying' : ''}`);
    }
    throw lastErr;
  }
}

module.exports = { Relay, toTags, fromNtfy, TYPES };
