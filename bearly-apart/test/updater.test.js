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

function release(version, extra = {}) {
  return signManifest({ version, url: 'https://example.com/Bearly-Apart-mac.zip', sha256: sha(ZIP), size: ZIP.length, ...extra }, PRIV);
}

// A pretend server: the feed answers with `manifest`, the zip link with `body`.
function server(manifest, body = ZIP) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('latest-mac.json')) return new Response(JSON.stringify(manifest));
    return new Response(body);
  };
  return { fetch, calls };
}

function updater(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-update-'));
  const installed = [];
  const u = new Updater({
    version: '0.6.0',
    feedUrl: 'https://example.com/latest-mac.json',
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
  assert.throws(() => verifyManifest(null, PUB), /could not be read/);
});

test('a newer version is downloaded, checked and installed', async () => {
  const { fetch, calls } = server(release('0.7.0'));
  const { u, installed } = updater({ fetch });
  await u.check();
  assert.strictEqual(installed.length, 1);
  assert.strictEqual(installed[0].m.version, '0.7.0');
  assert.ok(installed[0].bytes.equals(ZIP));
  assert.strictEqual(u.state.status, 'installing');
  assert.match(calls[0], /latest-mac\.json\?t=\d+/); // never a cached answer
});

test('same or older version: nothing is downloaded', async () => {
  for (const v of ['0.6.0', '0.5.9']) {
    const { fetch, calls } = server(release(v));
    const { u, installed } = updater({ fetch });
    await u.check();
    assert.strictEqual(u.state.status, 'up-to-date');
    assert.strictEqual(u.state.latest, v);
    assert.strictEqual(installed.length, 0);
    assert.strictEqual(calls.length, 1);
  }
});

test('a download that does not match its checksum is thrown away, never installed', async () => {
  const bad = Buffer.from(ZIP);
  bad[10] ^= 1;
  const { fetch } = server(release('0.7.0'), bad);
  const { u, installed, dir } = updater({ fetch });
  await u.check();
  assert.strictEqual(installed.length, 0);
  assert.strictEqual(u.state.status, 'error');
  assert.match(u.state.error, /checksum/);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('a download bigger than promised is cut off', async () => {
  const { fetch } = server(release('0.7.0'), Buffer.concat([ZIP, Buffer.alloc(10)]));
  const { u, installed } = updater({ fetch });
  await u.check();
  assert.strictEqual(installed.length, 0);
  assert.match(u.state.error, /bigger/);
});

test('an unsigned or forged feed is ignored', async () => {
  const forged = { ...release('0.7.0'), url: 'https://evil.example/x.zip' };
  const { fetch, calls } = server(forged);
  const { u, installed } = updater({ fetch });
  await u.check();
  assert.strictEqual(installed.length, 0);
  assert.strictEqual(calls.length, 1);
  assert.match(u.state.error, /not signed/);
});

test('where it cannot install (Windows, Linux) it only says a new version is out', async () => {
  const { fetch, calls } = server(release('0.7.0'));
  const { u, installed } = updater({ fetch, canInstall: false });
  await u.check();
  assert.strictEqual(u.state.status, 'available');
  assert.strictEqual(installed.length, 0);
  assert.strictEqual(calls.length, 1);
});

test('no feed or no key: updates are off and nothing is fetched', async () => {
  const { fetch, calls } = server(release('0.7.0'));
  for (const opts of [{ feedUrl: '' }, { publicKey: '' }]) {
    const { u } = updater({ fetch, ...opts });
    await u.check();
    assert.strictEqual(u.state.status, 'off');
  }
  assert.strictEqual(calls.length, 0);
});

test('a finished download is reused, and a failed install shows as an error', async () => {
  const { fetch, calls } = server(release('0.7.0'));
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
  assert.strictEqual(calls.filter((c) => c.endsWith('.zip')).length, 1);
  assert.strictEqual(u.state.status, 'error');
});
