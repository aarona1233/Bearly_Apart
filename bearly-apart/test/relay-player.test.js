const test = require('node:test');
const assert = require('node:assert');
const { Relay, toTags, fromNtfy } = require('../src/main/relay');
const { Player, summarize } = require('../src/main/player');
const { createServer } = require('../tools/mock-relay');
const { encodePairing, decodePairing, DEFAULT_CONFIG, merge } = require('../src/main/store');

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
