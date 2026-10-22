const test = require('node:test');
const assert = require('node:assert');
const { Brain, daysUntil } = require('../src/main/brain');
const { DEFAULT_CONFIG, DEFAULT_STATE, merge } = require('../src/main/store');
const scenes = require('../assets/scenes.json');

function setup(cfgPatch = {}, statePatch = {}) {
  let now = new Date(2026, 9, 21, 14, 0, 0).getTime();
  let state = merge(structuredClone(DEFAULT_STATE), statePatch);
  const config = merge(structuredClone(DEFAULT_CONFIG), {
    me: { id: 'her', name: 'Her', character: 'cream' },
    partner: { id: 'him', name: 'Him', character: 'brown' },
    ...cfgPatch,
  });
  const played = [];
  const published = [];
  const brain = new Brain({
    config: () => config,
    state: () => state,
    setState: (p) => (state = merge(state, p)),
    play: async (req) => (played.push(req), true),
    publish: async (ev, text) => published.push({ ev, text }),
    hasScene: (n) => !!scenes[n],
    now: () => now,
  });
  return { brain, played, published, advance: (ms) => (now += ms), state: () => state, config };
}

const names = (played) => played.map((p) => p.scene);

test('every scene the brain can ask for exists', () => {
  for (const s of ['message', 'combo', 'kiss', 'heart', 'hug', 'poke', 'miss-you', 'status', 'note', 'jar', 'hello', 'good-morning', 'countdown', 'missing-peek', 'missing-sword', 'missing-poster'])
    assert.ok(scenes[s], s);
});

test('messages respect cooldown, then a burst becomes a combo', () => {
  const { brain, played, advance } = setup();
  brain.onRelayEvent({ type: 'message', from: 'him', keywords: [] });
  advance(5_000);
  brain.onRelayEvent({ type: 'message', from: 'him', keywords: [] });
  assert.deepStrictEqual(names(played), ['message']);
  for (let i = 0; i < 3; i++) {
    advance(5_000);
    brain.onRelayEvent({ type: 'message', from: 'him', keywords: [] });
  }
  assert.deepStrictEqual(names(played), ['message', 'combo']);
});

test('keyword scenes win over the plain message', () => {
  const { brain, played } = setup();
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['miss-you'], text: 'miss you' });
  assert.deepStrictEqual(names(played), ['kw-miss-you']);
});

test('"kiss" and "hug" texts play the kiss and hug scenes, at most every 30 seconds each', () => {
  const { brain, played, advance } = setup();
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['kiss'], text: 'kisses' });
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['hug'], text: 'I want to hug you' });
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['hug'], text: 'hug!!' }); // too soon
  advance(31_000);
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['hug'], text: 'hug again' });
  assert.deepStrictEqual(names(played).filter((n) => n !== 'message'), ['kiss', 'hug', 'hug']);
});

test('statuses I send are remembered, and clearing works both ways', async () => {
  const { brain, played, state } = setup();
  await brain.send('status', { status: 'work' });
  assert.strictEqual(state().myStatus.name, 'work');
  await brain.send('status', { status: 'clear' });
  assert.strictEqual(state().myStatus, null);
  brain.onRelayEvent({ type: 'status', status: 'gym', from: 'him' });
  brain.onRelayEvent({ type: 'status', status: 'clear', from: 'him' });
  assert.strictEqual(state().partnerStatus, null);
  assert.deepStrictEqual(names(played), ['status']); // clearing plays nothing
});

test('her outgoing iMessage is forwarded without the text', () => {
  const { brain, published, played } = setup();
  brain.onIMessage({ direction: 'out', type: 'message', keywords: ['love-you'], text: 'secret words love you' });
  assert.strictEqual(played.length, 0);
  assert.strictEqual(published.length, 1);
  assert.deepStrictEqual(published[0].ev, { type: 'message', from: 'her', keywords: ['love-you'], tapback: undefined });
  assert.ok(!published[0].text.includes('secret'));
});

test('own echoes and strangers are ignored', () => {
  const { brain, played } = setup();
  brain.onRelayEvent({ type: 'kiss', from: 'her' });
  brain.onRelayEvent({ type: 'kiss', from: 'mallory' });
  assert.strictEqual(played.length, 0);
});

test('hearts sent close together become a hug', async () => {
  const { brain, played, advance } = setup();
  await brain.send('heart');
  advance(4_000);
  brain.onRelayEvent({ type: 'heart', from: 'him' });
  assert.deepStrictEqual(names(played), ['hug']);
});

test('status updates state and picks a specific scene when one exists', () => {
  const { brain, played, state } = setup();
  brain.onRelayEvent({ type: 'status', status: 'hungry', from: 'him' });
  brain.onRelayEvent({ type: 'status', status: 'gym', from: 'him' });
  assert.deepStrictEqual(names(played), ['status-hungry', 'status']);
  assert.strictEqual(state().partnerStatus.name, 'gym');
  assert.strictEqual(played[1].vars.statusLabel, 'is at the gym');
});

test('missing-you escalates once per level and resets when they text', async () => {
  const { brain, played, advance } = setup({ morning: { enabled: false } }, { lastHeardAt: new Date(2026, 9, 21, 9, 0).getTime() });
  advance(-1 * 3600_000); // 13:00 → 4h of silence
  await brain.tick();
  assert.deepStrictEqual(names(played), ['missing-peek']);
  await brain.tick();
  assert.strictEqual(played.length, 1);
  advance(3 * 3600_000); // 16:00 → 7h
  await brain.tick();
  assert.deepStrictEqual(names(played), ['missing-peek', 'missing-sword']);
  brain.onRelayEvent({ type: 'message', from: 'him', keywords: [] });
  advance(3600_000);
  await brain.tick();
  assert.deepStrictEqual(names(played), ['missing-peek', 'missing-sword', 'message']);
});

test('no missing-you nagging while the partner said goodnight', async () => {
  const { brain, played, advance } = setup({ morning: { enabled: false } });
  brain.onRelayEvent({ type: 'status', status: 'goodnight', from: 'him' });
  advance(9 * 3600_000);
  await brain.tick();
  assert.deepStrictEqual(names(played), ['status-goodnight']);
});

test('good morning pulls a note from the jar and shows the countdown', async () => {
  const { brain, played, state } = setup({ visitDate: '2026-11-02' }, { lastHeardAt: Date.now() });
  brain.onRelayEvent({ type: 'jar', from: 'him', text: 'you are my sunshine' });
  await brain.tick({ idleSec: 2 });
  const m = played.find((p) => p.scene === 'good-morning');
  assert.ok(m);
  assert.strictEqual(m.vars.note, 'you are my sunshine');
  assert.strictEqual(m.vars.countdown, '12 days until you see each other');
  assert.strictEqual(state().noteJar.length, 0);
  await brain.tick({ idleSec: 2 });
  assert.strictEqual(played.filter((p) => p.scene === 'good-morning').length, 1);
});

test('daysUntil', () => {
  assert.strictEqual(daysUntil('2026-10-22', new Date(2026, 9, 21, 23, 0)), 1);
  assert.strictEqual(daysUntil('', new Date()), null);
});
