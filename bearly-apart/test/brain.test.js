const test = require('node:test');
const assert = require('node:assert');
const { Brain, daysUntil } = require('../src/main/brain');
const { DEFAULT_CONFIG, DEFAULT_STATE, KEYWORDS, merge } = require('../src/main/store');
const { matchKeywords } = require('../src/main/imessage');
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
  for (const s of ['kw-hug', 'kw-miss-you', 'kw-love-you', 'kiss', 'heart', 'hug', 'poke', 'miss-you', 'status', 'note', 'jar', 'hello', 'good-morning', 'countdown', 'missing-peek', 'missing-sword', 'missing-poster'])
    assert.ok(scenes[s], s);
});

test('plain texts and reactions play nothing, however many arrive', () => {
  const { brain, played, advance, state } = setup();
  for (let i = 0; i < 8; i++) {
    advance(5_000);
    brain.onRelayEvent({ type: 'message', from: 'him', keywords: [] });
    brain.onIMessage({ direction: 'in', type: 'message', keywords: [], text: 'what are you doing' });
    brain.onIMessage({ direction: 'in', type: 'tapback', tapback: 'love', keywords: [] });
  }
  assert.deepStrictEqual(played, []);
  assert.ok(state().lastHeardAt > 0, 'still counts as hearing from them');
});

test('"hug", "miss you" and "love you" texts play their scenes, at most every 30 seconds each', () => {
  const { brain, played, advance } = setup();
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['miss-you'], text: 'miss you' });
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['love-you'], text: 'love you' });
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['hug'], text: 'I want to hug you' });
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['hug'], text: 'hug!!' }); // too soon
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['kiss'], text: 'kisses' }); // from an older version: not a trigger now
  advance(31_000);
  brain.onIMessage({ direction: 'in', type: 'message', keywords: ['hug'], text: 'hug again' });
  assert.deepStrictEqual(names(played), ['kw-miss-you', 'kw-love-you', 'kw-hug', 'kw-hug']);
});

test('"love you" names the sender: "Yimei loves you" on his PC, "Aaron loves you" on her Mac', () => {
  const caption = (p) => scenes[p.scene].caption.replace(/\{(\w+)\}/g, (_, k) => p.vars[k]);
  const hisPc = setup({ me: { id: 'aaron', name: 'Aaron', character: 'brown' }, partner: { id: 'yimei', name: 'Yimei', character: 'cream' } });
  const herMac = setup({ me: { id: 'yimei', name: 'Yimei', character: 'cream' }, partner: { id: 'aaron', name: 'Aaron', character: 'brown' } });
  // He texts her: her Mac reads it as incoming.
  herMac.brain.onIMessage({ direction: 'in', type: 'message', keywords: ['love-you'], text: 'love you' });
  assert.strictEqual(caption(herMac.played[0]), 'Aaron loves you 💕');
  // She texts him: her Mac plays nothing for her and forwards it; his PC plays it.
  herMac.brain.onIMessage({ direction: 'out', type: 'message', keywords: ['love-you'], text: 'love you' });
  assert.strictEqual(herMac.played.length, 1);
  hisPc.brain.onRelayEvent(herMac.published[0].ev);
  assert.strictEqual(caption(hisPc.played[0]), 'Yimei loves you 💕');
});

test('only hug, miss you and love you match as text triggers', () => {
  const m = (t) => matchKeywords(t, KEYWORDS);
  assert.deepStrictEqual(m('I want to hug you'), ['hug']);
  assert.deepStrictEqual(m('I miss you sm'), ['miss-you']);
  assert.deepStrictEqual(m('I LOVE YOU'), ['love-you']);
  assert.deepStrictEqual(m('love u 😘'), ['love-you']);
  for (const t of ['kisses 😘', 'mwah', 'lol', '🥺', '🫂', 'I love your shoes', 'thug life', 'glove you lost']) assert.deepStrictEqual(m(t), [], t);
});

test('gifts play their send- scene with the caption bits, and unknown ones still show something', () => {
  const { brain, played } = setup();
  brain.onRelayEvent({ type: 'gift', gift: 'cuddle', from: 'him' });
  brain.onRelayEvent({ type: 'gift', gift: 'from-a-newer-version', from: 'him' });
  assert.deepStrictEqual(names(played), ['send-cuddle', 'heart']);
  assert.strictEqual(played[0].vars.says, 'wants cuddles');
  assert.strictEqual(played[0].label, '🥰 Him wants cuddles');
});

test('every gift button has its scene and its art', () => {
  const { GIFTS } = require('../src/main/catalog');
  assert.ok(Object.keys(GIFTS).length >= 15);
  for (const name of Object.keys(GIFTS)) assert.ok(scenes[`send-${name}`], `missing scene send-${name}`);
});

test('presence: stored, "back" after a while pops up their bear, missing-you waits while they are away', async () => {
  const { brain, played, advance, state } = setup({ morning: { enabled: false } }, { lastHeardAt: new Date(2026, 9, 21, 9, 0).getTime() });
  brain.onRelayEvent({ type: 'presence', presence: 'away', from: 'him' });
  assert.strictEqual(state().partnerPresence.state, 'away');
  await brain.tick(); // 5 hours of silence, but he's away: no nagging
  assert.deepStrictEqual(names(played), []);
  advance(30 * 60_000);
  brain.onRelayEvent({ type: 'presence', presence: 'here', from: 'him' });
  assert.deepStrictEqual(names(played), ['partner-back']);
  assert.strictEqual(state().lastHeardAt, new Date(2026, 9, 21, 9, 0).getTime(), 'presence is not a message');
  let seen = 0;
  brain.onSeen = (until) => (seen = until);
  brain.onRelayEvent({ type: 'seen', until: 123, from: 'him' });
  assert.strictEqual(seen, 123);
});

test('the welcome-back art exists for both bears', () => {
  for (const s of ['welcome-back-short', 'welcome-back-long', 'welcome-back-day', 'away-summary', 'partner-back']) assert.ok(scenes[s], `missing scene ${s}`);
  const fs = require('fs');
  const path = require('path');
  const used = new Set();
  const walk = (o) => (Array.isArray(o) ? o.forEach(walk) : o && typeof o === 'object' && Object.entries(o).forEach(([k, v]) => ((k === 'asset' || k === 'src') && typeof v === 'string' ? used.add(v) : walk(v))));
  walk(scenes);
  for (const u of used) for (const bear of ['brown', 'cream']) {
    const file = u.replace(/\{pc\}|\{mc\}/g, bear);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', file)), `missing art ${file}`);
  }
});

test("two computers of mine: status and hearts from the other one carry over, and this computer's own echo is ignored", () => {
  const { brain, state, played } = setup();
  brain.device = 'laptop1';
  const others = [];
  brain.onMyOtherComputer = (ev, name) => others.push([ev.type, name]);
  brain.onRelayEvent({ type: 'presence', presence: 'here', from: 'her', device: 'desk1', deviceName: 'DESKTOP' });
  brain.onRelayEvent({ type: 'status', status: 'studying', from: 'her', device: 'desk1' });
  brain.onRelayEvent({ type: 'heart', from: 'her', device: 'desk1' });
  brain.onRelayEvent({ type: 'kiss', from: 'her', device: 'laptop1' }); // this computer's own echo
  assert.strictEqual(state().myStatus.name, 'studying');
  assert.ok(state().sentHeartAt > 0);
  assert.deepStrictEqual(state().myDevices.desk1.name, 'DESKTOP');
  assert.deepStrictEqual(others, [['status', 'DESKTOP'], ['heart', 'DESKTOP']]);
  assert.strictEqual(played.length, 0, 'nothing I sent plays on my own screen');
});

test('their presence across two computers: here if either is in use', () => {
  const { brain, state } = setup();
  brain.onRelayEvent({ type: 'presence', presence: 'here', from: 'him', device: 'mac' });
  brain.onRelayEvent({ type: 'presence', presence: 'away', from: 'him', device: 'pc' });
  assert.strictEqual(state().partnerPresence.state, 'here');
  brain.onRelayEvent({ type: 'presence', presence: 'away', from: 'him', device: 'mac' });
  assert.strictEqual(state().partnerPresence.state, 'away');
});

test('checks: their ping and the answer to ours reach the hooks; our own check message is ignored', () => {
  const { brain, played, state } = setup();
  const seen = [];
  brain.onPing = (ev) => seen.push(['ping', ev.nonce]);
  brain.onPong = (ev) => seen.push(['pong', ev.nonce]);
  const heardBefore = state().lastHeardAt;
  brain.onRelayEvent({ type: 'ping', nonce: 'n1', from: 'him' });
  brain.onRelayEvent({ type: 'pong', nonce: 'n2', from: 'him' });
  brain.onRelayEvent({ type: 'diag', nonce: 'n3', from: 'him' });
  assert.deepStrictEqual(seen, [['ping', 'n1'], ['pong', 'n2']]);
  assert.strictEqual(played.length, 0, 'no animation for a check');
  assert.strictEqual(state().lastHeardAt, heardBefore, 'a check is not hearing from them');
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
  assert.deepStrictEqual(names(played), ['missing-peek', 'missing-sword']); // a plain text resets it but plays nothing
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
