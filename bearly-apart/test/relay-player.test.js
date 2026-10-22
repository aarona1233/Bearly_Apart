const test = require('node:test');
const assert = require('node:assert');
const { Relay, toTags, fromNtfy } = require('../src/main/relay');
const { Player, summarize, mergeRepeats } = require('../src/main/player');
const { createServer } = require('../tools/mock-relay');
const { encodePairing, decodePairing, DEFAULT_CONFIG, KEYWORDS, JsonFile, merge, migrate } = require('../src/main/store');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('tags round-trip', () => {
  const ev = { type: 'status', from: 'him', status: 'hungry', keywords: ['x'] };
  const back = fromNtfy({ event: 'message', id: '1', time: 1, message: 'hi', tags: toTags(ev) });
  assert.strictEqual(back.type, 'status');
  assert.strictEqual(back.status, 'hungry');
  assert.deepStrictEqual(back.keywords, ['x']);
  assert.strictEqual(fromNtfy({ event: 'message', tags: ['e.kiss'] }), null); // not ours
});

test('pairing codes round-trip', () => {
  const c = merge(structuredClone(DEFAULT_CONFIG), { me: { id: 'him', name: 'Him', character: 'brown' }, relay: { topic: 'ba-abc' } });
  const p = decodePairing(encodePairing(c));
  assert.strictEqual(p.relay.topic, 'ba-abc');
  assert.strictEqual(p.partner.name, 'Him');
  assert.throws(() => decodePairing('nope'));
});

test('relay delivers live and resumes after reconnect without losing messages', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  let since = '';
  const cfg = { relay: { server: url, topic: 'ba-test', token: '' } };
  const relay = new Relay({ getConfig: () => cfg, getSince: () => since, setSince: (v) => (since = v), log: () => {} });
  const got = [];
  relay.on('event', (e) => got.push(e.type));
  relay.start();
  await new Promise((r) => relay.once('connection', r));
  await relay.publish({ type: 'kiss', from: 'him' }, '💋');
  await new Promise((r) => setTimeout(r, 100));
  relay.stop();
  await relay.publish({ type: 'poke', from: 'him' }, '👉'); // sent while offline
  relay.start();
  await new Promise((r) => setTimeout(r, 300));
  relay.stop();
  server.closeAllConnections();
  server.close();
  assert.deepStrictEqual(got, ['kiss', 'poke']);
});

test('player queues while blocked and summarizes a backlog', async () => {
  let ok = false;
  const rendered = [];
  const p = new Player({ render: async (req) => rendered.push(req), check: async () => ({ ok, reason: 'away' }), debounceMs: 5, retryMs: 20 });
  const req = (scene, type, priority, extra = {}) => ({ scene, priority, ev: { type }, vars: { ...extra } });
  p.play(req('message', 'message', 2));
  p.play(req('kiss', 'kiss', 5));
  p.play(req('message', 'message', 2));
  p.play(req('status-hungry', 'status', 4, { emoji: '🍔' }));
  p.play(req('note', 'note', 7, { note: 'hi' }));
  assert.strictEqual(await p.play({ scene: 'missing-peek', live: true }), false);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(rendered.length, 0);
  ok = true;
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(rendered.length, 1);
  assert.strictEqual(rendered[0].scene, 'note');
  assert.match(rendered[0].vars.caption, /While you were away: 💬×2  💋  💌  🍔/);
});

test('summarize keeps only the latest status', () => {
  const s = summarize([
    { ev: { type: 'status' }, vars: { emoji: '🍔' } },
    { ev: { type: 'status' }, vars: { emoji: '😴' } },
  ]);
  assert.strictEqual(s, '😴');
});

test('publish gives up on a hung request, retries, and reports the error', async () => {
  let calls = 0;
  const relay = new Relay({
    getConfig: () => ({ relay: { server: 'http://x', topic: 't', token: '' } }),
    getSince: () => '',
    setSince: () => {},
    log: () => {},
    publishTimeoutMs: 50,
    retryDelaysMs: [10, 10],
    // First two attempts hang until aborted, the third works.
    publishFetch: (url, opts) =>
      ++calls < 3 ? new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason))) : Promise.resolve(new Response('{"id":"1"}')),
  });
  assert.deepStrictEqual(await relay.publish({ type: 'kiss', from: 'him' }), { id: '1' });
  assert.strictEqual(calls, 3);

  const failing = new Relay({ getConfig: relay.getConfig, getSince: () => '', setSince: () => {}, log: () => {}, publishFetch: async () => new Response('', { status: 400 }) });
  await assert.rejects(failing.publish({ type: 'kiss', from: 'him' }), /HTTP 400/);
});

test('a quick burst plays in order with repeats merged; only a real wait becomes a summary', async () => {
  const rendered = [];
  const p = new Player({ render: async (req) => rendered.push(req), check: async () => ({ ok: true }), debounceMs: 5 });
  const req = (scene, label) => ({ scene, priority: 4, label, ev: { type: scene }, vars: {} });
  p.play(req('kiss', '💋 Him sent you a kiss'));
  p.play(req('poke', '👉 Him poked you'));
  p.play(req('poke', '👉 Him poked you'));
  p.play(req('heart', '💗'));
  await new Promise((r) => setTimeout(r, 40));
  assert.deepStrictEqual(rendered.map((r) => r.scene), ['kiss', 'poke', 'heart']);
  assert.strictEqual(rendered[1].vars.caption, '👉 Him poked you ×2');
  assert.strictEqual(mergeRepeats([req('note', 'a'), req('note', 'b')]).length, 2); // notes are never merged
});

test('old configs get the new text triggers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ me: { name: 'Her' }, keywords: { 'love you': 'love-you', gn: 'goodnight', 'miss you': 'miss-you' } }));
  const c = new JsonFile(file, DEFAULT_CONFIG);
  migrate(c);
  assert.deepStrictEqual(c.data.keywords, KEYWORDS);
  assert.strictEqual(c.data.me.name, 'Her');
  c.save();
  const again = new JsonFile(file, DEFAULT_CONFIG);
  again.data.keywords.custom = 'x'; // edits made after the upgrade are left alone
  migrate(again);
  assert.strictEqual(again.data.keywords.custom, 'x');
});
