// Updating itself. Every hour (and from Settings → Updates) the app fetches a small signed manifest:
//   { version, url, sha256, size, notes, sig }
// sig is an Ed25519 signature over the fields (see payload()), made by tools/release.js with the private key that
// only lives on the computers releases are built on. The public key ships inside the app, so a changed link or a
// hijacked download page can't install anything: the manifest must verify, and the download must match its hash.
// No Electron here: fetching and installing are passed in, which keeps it testable.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { compareVersions } = require('./mac-install');

const HOUR_MS = 3600_000;
const FIRST_CHECK_MS = 2 * 60_000; // after startup, once the relay and the rest have settled

const payload = (m) => ['bearly-apart-mac', m.version, m.sha256, m.size, m.url].join('\n');

function signManifest(m, privateKeyPem) {
  const signed = { version: m.version, url: m.url, sha256: m.sha256, size: m.size, notes: m.notes || '' };
  return { ...signed, sig: crypto.sign(null, Buffer.from(payload(signed)), privateKeyPem).toString('base64') };
}

// Throws (with a reason a person can read) unless the manifest is well-formed and signed with our key.
function verifyManifest(m, publicKeyPem) {
  if (!m || typeof m !== 'object') throw new Error('the update info could not be read');
  if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) throw new Error('the update info has no version');
  if (!/^[0-9a-f]{64}$/.test(m.sha256 || '')) throw new Error('the update info has no checksum');
  if (!Number.isSafeInteger(m.size) || m.size <= 0) throw new Error('the update info has no size');
  if (!/^https:\/\//.test(m.url || '')) throw new Error('the update link is not https');
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(payload(m)), publicKeyPem, Buffer.from(String(m.sig || ''), 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('the update is not signed with your release key, so it was ignored');
  return m;
}

class Updater {
  // fetch(url, opts) → Response. install(zipPath, manifest) → Promise; on the Mac it swaps the app and quits.
  // canInstall: false where installing isn't supported (Windows/Linux, or running from source): it only reports.
  constructor({ version, feedUrl, publicKey, fetch, downloadDir, install, canInstall = true, enabled = () => true, onChange = () => {}, log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { version, feedUrl, publicKey, fetch, downloadDir, install, canInstall, enabled, onChange, log, now });
    this.state = { status: feedUrl && publicKey ? 'idle' : 'off', version, latest: null, lastCheckedAt: 0, error: '', received: 0, total: 0 };
    this.busy = false;
    this.timers = [];
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  start() {
    if (this.state.status === 'off') return;
    const auto = () => this.enabled() && this.check();
    this.timers.push(setTimeout(auto, FIRST_CHECK_MS), setInterval(auto, HOUR_MS));
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  async check() {
    if (this.state.status === 'off') return this.state;
    if (this.busy) return this.state;
    this.busy = true;
    this.set({ status: 'checking', error: '' });
    try {
      const res = await this.fetch(`${this.feedUrl}${this.feedUrl.includes('?') ? '&' : '?'}t=${this.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 404 ? 'no update has been published yet' : `the update page answered HTTP ${res.status}`);
      const m = verifyManifest(await res.json(), this.publicKey);
      this.set({ lastCheckedAt: this.now(), latest: m.version });
      if (compareVersions(m.version, this.version) <= 0) {
        this.set({ status: 'up-to-date' });
        return this.state;
      }
      if (!this.canInstall) {
        this.set({ status: 'available' });
        return this.state;
      }
      this.log(`[update] ${this.version} → ${m.version}: downloading`);
      const zip = await this.download(m);
      this.set({ status: 'installing' });
      this.log(`[update] installing ${m.version}`);
      await this.install(zip, m);
    } catch (err) {
      this.log(`[update] ${err.message}`);
      this.set({ status: 'error', error: err.message, lastCheckedAt: this.now() });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  // Streams the zip to disk, checking size and SHA-256 on the way. A finished, matching download is reused.
  async download(m) {
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const file = path.join(this.downloadDir, `Bearly-Apart-${m.version}.zip`);
    if (fs.existsSync(file) && (await sha256File(file)) === m.sha256) return file;
    this.set({ status: 'downloading', received: 0, total: m.size });
    const res = await this.fetch(m.url, {});
    if (!res.ok || !res.body) throw new Error(`the download answered HTTP ${res.status}`);
    const hash = crypto.createHash('sha256');
    const part = `${file}.part`;
    let received = 0;
    let shown = 0;
    const self = this;
    try {
      await pipeline(
        Readable.fromWeb(res.body),
        async function* (src) {
          for await (const chunk of src) {
            received += chunk.length;
            if (received > m.size) throw new Error('the download is bigger than it should be');
            hash.update(chunk);
            if (received - shown > m.size / 50) {
              shown = received;
              self.set({ received });
            }
            yield chunk;
          }
        },
        fs.createWriteStream(part),
      );
      if (received !== m.size || hash.digest('hex') !== m.sha256) throw new Error('the download did not match its checksum');
    } catch (err) {
      fs.rmSync(part, { force: true });
      throw err;
    }
    fs.renameSync(part, file);
    this.set({ received });
    return file;
  }
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

module.exports = { Updater, signManifest, verifyManifest, sha256File, HOUR_MS };
