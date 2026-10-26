// Updating itself. Every hour (and from Settings → Updates) the app asks GitHub for the newest release of the repo in
// package.json → updates.github, and reads its latest-mac.json:
//   { version, url, sha256, size, notes, sig }
// sig is an Ed25519 signature over the fields (see payload()), made by tools/release.js with the private key that
// only lives on the computers releases are built on. The public key ships inside the app, so nobody else can publish
// an update it accepts, not even someone who gets into the GitHub account: the manifest must verify, and the
// download must match its size and hash.
// The repo can be private: then each copy needs a read-only GitHub key (Settings → Updates), sent only to
// api.github.com and never along to the download links GitHub redirects to.
// No Electron here: fetching and installing are passed in, which keeps it testable.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { compareVersions } = require('./mac-install');

const HOUR_MS = 3600_000;
const FIRST_CHECK_MS = 2 * 60_000; // after startup, once the relay and the rest have settled
const API = 'https://api.github.com';
const MAX_MANIFEST = 64 * 1024;
const MAX_ZIP = 600 * 1024 * 1024;
const MANIFEST_NAME = 'latest-mac.json';

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
  if (!Number.isSafeInteger(m.size) || m.size <= 0 || m.size > MAX_ZIP) throw new Error('the update info has no sensible size');
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
  // fetch(url, opts) → Response; it must support redirect: 'manual' (Node's fetch does).
  // install(zipPath, manifest) → Promise; on the Mac it swaps the app and quits.
  // canInstall: false where installing isn't supported (Windows/Linux, or running from source): it only reports.
  constructor({ version, repo, publicKey, getToken = () => '', fetch, downloadDir, install, canInstall = true, enabled = () => true, onChange = () => {}, log = () => {}, now = () => Date.now() }) {
    Object.assign(this, { version, repo, publicKey, getToken, fetch, downloadDir, install, canInstall, enabled, onChange, log, now });
    const on = /^[\w.-]+\/[\w.-]+$/.test(repo || '') && !!publicKey;
    this.state = { status: on ? 'idle' : 'off', version, latest: null, lastCheckedAt: 0, error: '', received: 0, total: 0 };
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

  // One GitHub request. The key goes only to api.github.com; a redirect (asset downloads go to a pre-signed
  // storage link) is followed by hand, without it.
  async github(url, accept) {
    if (!url.startsWith(`${API}/`)) throw new Error('unexpected update address');
    const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Bearly-Apart' };
    const token = String(this.getToken() || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    let res = await this.fetch(url, { headers, redirect: 'manual', cache: 'no-store' });
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get('location') || '';
      if (!to.startsWith('https://')) throw new Error('GitHub sent the download somewhere odd');
      res = await this.fetch(to, { cache: 'no-store' });
    }
    if (res.status === 401) throw new Error('GitHub turned down the update key (expired or mistyped): add a new one in Settings → Updates');
    if (res.status === 403 || res.status === 429) throw new Error('GitHub says to slow down; trying again next hour');
    if (res.status === 404) throw new Error(token ? 'no update is published yet (or the update key can’t see the repo)' : 'no update is published yet (if the repo is private, add an update key)');
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
    return res;
  }

  async check() {
    if (this.state.status === 'off') return this.state;
    if (this.busy) return this.state;
    this.busy = true;
    this.set({ status: 'checking', error: '' });
    try {
      const release = await (await this.github(`${API}/repos/${this.repo}/releases/latest`, 'application/vnd.github+json')).json();
      const assets = Array.isArray(release?.assets) ? release.assets : [];
      const info = assets.find((a) => a.name === MANIFEST_NAME);
      if (!info) throw new Error(`the newest release has no ${MANIFEST_NAME}`);
      if (info.size > MAX_MANIFEST) throw new Error('the update info is too big');
      const text = await (await this.github(info.url, 'application/octet-stream')).text();
      if (text.length > MAX_MANIFEST) throw new Error('the update info is too big');
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* verifyManifest says so */
      }
      const m = verifyManifest(parsed, this.publicKey);
      this.set({ lastCheckedAt: this.now(), latest: m.version });
      if (compareVersions(m.version, this.version) <= 0) {
        this.set({ status: 'up-to-date' });
        return this.state;
      }
      if (!this.canInstall) {
        this.set({ status: 'available' });
        return this.state;
      }
      // The signed link names the file; fetch that same file through the API (so a private repo works too).
      const zip = assets.find((a) => a.browser_download_url === m.url);
      if (!zip || zip.size !== m.size) throw new Error('the release doesn’t have the file its update info names');
      this.log(`[update] ${this.version} → ${m.version}: downloading`);
      const file = await this.download(m, zip.url);
      this.set({ status: 'installing' });
      this.log(`[update] installing ${m.version}`);
      await this.install(file, m);
    } catch (err) {
      this.log(`[update] ${err.message}`);
      this.set({ status: 'error', error: err.message, lastCheckedAt: this.now() });
    } finally {
      this.busy = false;
    }
    return this.state;
  }

  // Streams the zip to disk, checking size and SHA-256 on the way. A finished, matching download is reused.
  async download(m, apiUrl) {
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const file = path.join(this.downloadDir, `Bearly-Apart-${m.version}.zip`);
    if (fs.existsSync(file) && (await sha256File(file)) === m.sha256) return file;
    this.set({ status: 'downloading', received: 0, total: m.size });
    const res = await this.github(apiUrl, 'application/octet-stream');
    if (!res.body) throw new Error('the download came back empty');
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
        fs.createWriteStream(part, { mode: 0o600 }),
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

module.exports = { Updater, signManifest, verifyManifest, sha256File, HOUR_MS, MANIFEST_NAME };
