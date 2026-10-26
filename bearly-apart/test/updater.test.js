const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Updater, signManifest, verifyManifest } = require('../src/main/updater');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const ZIP = Buffer.from('pretend this is Bearly Apart for Mac.zip '.repeat(5000));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const REPO = 'me/bears';
const ZIP_URL = 'https://github.com/me/bears/releases/download/v0.7.0/Bearly-Apart-mac-0.7.0.zip';

function release(version, extra = {}) {
  return signManifest({ version, url: ZIP_URL, sha256: sha(ZIP), size: ZIP.length, ...extra }, PRIV);
}

// A pretend GitHub: the releases API lists two assets; asset downloads redirect to a "storage" host, like the real one.
// opts.token: the key a private repo wants (wrong or missing → 404, as GitHub answers for private repos).
function github(manifest, { body = ZIP, token = '', zipSize = ZIP.length, status } = {}) {
  const calls = [];
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  const fetch = async (url, opts = {}) => {
    const auth = opts.headers?.Authorization || '';
    calls.push({ url, auth });
    if (status) return new Response('', { status });
    if (url.startsWith('https://storage.example/')) {
      if (auth) throw new Error('key leaked to the storage server');
      return new Response(url.endsWith('/manifest') ? JSON.stringify(manifest) : body);
    }
    if (token && auth !== `Bearer ${token}`) return json({ message: 'Not Found' }, 404);
    if (url === `https://api.github.com/repos/${REPO}/releases/latest`) {
      return json({
        assets: [
          { name: 'latest-mac.json', size: 600, url: 'https://api.github.com/repos/me/bears/releases/assets/1', browser_download_url: 'x' },
          { name: 'Bearly-Apart-mac-0.7.0.zip', size: zipSize, url: 'https://api.github.com/repos/me/bears/releases/assets/2', browser_download_url: ZIP_URL },
        ],
      });
    }
    if (opts.redirect !== 'manual') throw new Error('asset fetched without redirect: manual');
    if (url.endsWith('/assets/1')) return new Response(null, { status: 302, headers: { location: 'https://storage.example/manifest' } });
    if (url.endsWith('/assets/2')) return new Response(null, { status: 302, headers: { location: 'https://storage.example/zip' } });
    return json({}, 404);
  };
  return { fetch, calls };
}

function updater(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-update-'));
  const installed = [];
  const u = new Updater({
    version: '0.6.0',
    repo: REPO,
    publicKey: PUB,
    downloadDir: dir,
    install: async (zip, m) => installed.push({ zip, m, bytes: fs.readFileSync(zip) }),
    ...opts,
  });
  return { u, installed, dir };
}

test('manifests verify only with our key and untouched fields', () => {
  const m = release('0.7.0');
  assert.strictEqual(verifyManifest(m, PUB).version, '0.7.0');
  for (const tampered of [{ ...m, version: '9.9.9' }, { ...m, url: 'https://evil.example/x.zip' }, { ...m, sha256: sha(Buffer.from('other')) }, { ...m, size: 1 }]) {
    assert.throws(() => verifyManifest(tampered, PUB), /not signed/);
  }
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => verifyManifest(m, other), /not signed/);
  assert.throws(() => verifyManifest({ ...m, url: 'http://example.com/x.zip' }, PUB), /https/);
  assert.throws(() => verifyManifest({ ...m, size: 2e9 }, PUB), /size/);
  assert.throws(() => verifyManifest(null, PUB), /could not be read/);
});

test('a newer version is downloaded, checked and installed', async () => {
  const { fetch } = github(release('0.7.0'));
  const { u, installed } = updater({ fetch });
  await u.check();
  assert.strictEqual(installed.length, 1, u.state.error);
  assert.strictEqual(installed[0].m.version, '0.7.0');
  assert.ok(installed[0].bytes.equals(ZIP));
  assert.strictEqual(u.state.status, 'installing');
});

test('private repo: the key goes to api.github.com only, never to the storage links', async () => {
  const { fetch, calls } = github(release('0.7.0'), { token: 'github_pat_secret' });
  const { u, installed } = updater({ fetch, getToken: () => 'github_pat_secret' });
  await u.check();
  assert.strictEqual(installed.length, 1, u.state.error);
  for (const c of calls) assert.strictEqual(!!c.auth, c.url.startsWith('https://api.github.com/'), c.url);
});

test('private repo without the right key: says so, installs nothing', async () => {
  for (const key of ['', 'github_pat_wrong']) {
    const { fetch } = github(release('0.7.0'), { token: 'github_pat_secret' });
    const { u, installed } = updater({ fetch, getToken: () => key });
    await u.check();
    assert.strictEqual(installed.length, 0);
    assert.match(u.state.error, key ? /key can’t see/ : /add an update key/);
  }
  const { fetch } = github(release('0.7.0'), { status: 401 });
  const { u } = updater({ fetch, getToken: () => 'github_pat_old' });
  await u.check();
  assert.match(u.state.error, /turned down the update key/);
});

test('same or older version: nothing is downloaded', async () => {
  for (const v of ['0.6.0', '0.5.9']) {
    const { fetch, calls } = github(release(v));
    const { u, installed } = updater({ fetch });
    await u.check();
    assert.strictEqual(u.state.status, 'up-to-date');
    assert.strictEqual(u.state.latest, v);
    assert.strictEqual(installed.length, 0);
    assert.ok(!calls.some((c) => c.url.endsWith('/zip') || c.url.endsWith('/assets/2')));
  }
});

test('a download that does not match its checksum is thrown away, never installed', async () => {
  const bad = Buffer.from(ZIP);
  bad[10] ^= 1;
  const { fetch } = github(release('0.7.0'), { body: bad });
  const { u, installed, dir } = updater({ fetch });
  await u.check();
  assert.strictEqual(installed.length, 0);
  assert.match(u.state.error, /checksum/);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('a download bigger than promised is cut off', async () => {
  const { fetch } = github(release('0.7.0'), { body: Buffer.concat([ZIP, Buffer.alloc(10)]) });
  const { u, installed } = updater({ fetch });
  await u.check();
  assert.strictEqual(installed.length, 0);
  assert.match(u.state.error, /bigger/);
});

test('a forged manifest, or a release whose file differs from the signed one, is ignored', async () => {
  const forged = { ...release('0.7.0'), url: 'https://evil.example/x.zip' };
  let { fetch } = github(forged);
  let { u, installed } = updater({ fetch });
  await u.check();
  assert.strictEqual(installed.length, 0);
  assert.match(u.state.error, /not signed/);

  ({ fetch } = github(release('0.7.0'), { zipSize: ZIP.length + 1 }));
  ({ u, installed } = updater({ fetch }));
  await u.check();
  assert.strictEqual(installed.length, 0);
  assert.match(u.state.error, /doesn’t have the file/);
});

test('where it cannot install (Windows, Linux) it only says a new version is out', async () => {
  const { fetch, calls } = github(release('0.7.0'));
  const { u, installed } = updater({ fetch, canInstall: false });
  await u.check();
  assert.strictEqual(u.state.status, 'available');
  assert.strictEqual(installed.length, 0);
  assert.ok(!calls.some((c) => c.url.endsWith('/assets/2')));
});

test('no repo or no key: updates are off and nothing is fetched', async () => {
  const { fetch, calls } = github(release('0.7.0'));
  for (const opts of [{ repo: '' }, { repo: 'not a repo' }, { publicKey: '' }]) {
    const { u } = updater({ fetch, ...opts });
    await u.check();
    assert.strictEqual(u.state.status, 'off');
  }
  assert.strictEqual(calls.length, 0);
});

test('a finished download is reused, and a failed install shows as an error', async () => {
  const { fetch, calls } = github(release('0.7.0'));
  let attempts = 0;
  const { u } = updater({
    fetch,
    install: async () => {
      attempts++;
      throw new Error('could not unpack the update');
    },
  });
  await u.check();
  await u.check();
  assert.strictEqual(attempts, 2);
  assert.strictEqual(calls.filter((c) => c.url.endsWith('/zip')).length, 1);
  assert.strictEqual(u.state.status, 'error');
});
