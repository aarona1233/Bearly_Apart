const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDiagnostics, formatReport, summary, channelId } = require('../src/main/diagnostics');
const { createLogger, packLog } = require('../src/main/logger');
const { toTags, fromNtfy } = require('../src/main/relay');

function ctx(overrides = {}) {
  return {
    version: '0.7.0',
    os: 'macOS 15.1',
    deviceName: 'Yimeis-MacBook-Air',
    config: { me: { name: 'Yimei' }, partner: { id: 'aaron', name: 'Aaron', imessageHandles: ['+1 555'] }, relay: { server: 'https://ntfy.sh' }, launchAtLogin: true },
    isMac: true,
    packaged: true,
    imessage: 'ok',
    update: { status: 'up-to-date', latest: '0.7.0' },
    relayConnected: () => true,
    relayReachable: async () => 120,
    roundTrip: async () => 340,
    askPartner: async () => ({ version: '0.7.0', os: 'Windows 11', connected: true, imessage: 'off', paused: '', errors: 0 }),
    artCheck: () => ({ scenes: 90, missing: [] }),
    overlayOk: () => true,
    pausedReason: async () => '',
    statusesWithoutScene: () => [],
    recentErrors: () => [],
    ...overrides,
  };
}

test('all good: every check ok (texts read on a Mac), summary says so', async () => {
  const r = await runDiagnostics(ctx());
  assert.deepStrictEqual(r.filter((x) => x.status !== 'ok').map((x) => x.id), []);
  assert.strictEqual(summary(r), 'everything works');
  assert.match(r.find((x) => x.id === 'partner').detail, /Aaron answered: version 0\.7\.0, Windows 11, connected/);
});

test('a check that throws is a failure with its message; the rest still run', async () => {
  const r = await runDiagnostics(ctx({ roundTrip: async () => { throw new Error('the test message went out but never came back'); } }));
  const rt = r.find((x) => x.id === 'roundtrip');
  assert.strictEqual(rt.status, 'fail');
  assert.match(rt.detail, /never came back/);
  assert.ok(r.find((x) => x.id === 'errors'), 'later checks ran');
  assert.strictEqual(summary(r), '1 problem found');
});

test('her Mac without Full Disk Access, bears paused, partner silent: the right fail/warns', async () => {
  const r = await runDiagnostics(ctx({ imessage: 'no-access', pausedReason: async () => 'the screen is being shared', askPartner: async () => null }));
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.strictEqual(by.texts.status, 'fail');
  assert.match(by.texts.detail, /Full Disk Access/);
  assert.strictEqual(by.now.status, 'warn');
  assert.strictEqual(by.partner.status, 'warn');
  assert.match(by.partner.detail, /didn’t answer/);
});

test('the channel ID: same server and topic give the same short ID, any difference changes it, the topic never shows', async () => {
  const a = channelId({ server: 'https://ntfy.sh', topic: 'ba-secret123' });
  assert.match(a, /^[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.strictEqual(channelId({ server: 'https://NTFY.sh/', topic: 'ba-secret123' }), a);
  assert.notStrictEqual(channelId({ server: 'https://ntfy.sh', topic: 'ba-secret124' }), a);
  const r = await runDiagnostics(ctx({ config: { ...ctx().config, relay: { server: 'https://ntfy.sh', topic: 'ba-secret123' } } }));
  const setup = r.find((x) => x.id === 'setup').detail;
  assert.ok(setup.includes(`channel ${a}`));
  assert.ok(!setup.includes('secret'));
});

test('their app silent while this one works: the check says to compare channels and re-link', async () => {
  const r = await runDiagnostics(ctx({ askPartner: async () => null }));
  assert.match(r.find((x) => x.id === 'partner').detail, /different channels.*paste their invite in Settings → Connection/);
  const r2 = await runDiagnostics(ctx({ askPartner: async () => null, roundTrip: async () => { throw new Error('never came back'); } }));
  assert.match(r2.find((x) => x.id === 'partner').detail, /closed or asleep/);
});

test('a partner answer that shows trouble is a warning, and partner: false skips asking', async () => {
  const r = await runDiagnostics(ctx({ askPartner: async () => ({ version: '0.6.0', connected: true, imessage: 'no-access' }) }));
  assert.strictEqual(r.find((x) => x.id === 'partner').status, 'warn');
  const r2 = await runDiagnostics(ctx(), { partner: false });
  assert.ok(!r2.find((x) => x.id === 'partner'));
});

test('not paired: setup fails, sending and asking are skipped; Windows skips texts', async () => {
  const r = await runDiagnostics(ctx({ isMac: false, config: { me: { name: 'Aaron' }, partner: {}, relay: { server: 'x' }, launchAtLogin: true } }));
  const by = Object.fromEntries(r.map((x) => [x.id, x.status]));
  assert.deepStrictEqual([by.setup, by.roundtrip, by.partner, by.texts], ['fail', 'skip', 'skip', 'skip']);
});

test('the report lists every result and the end of the log', async () => {
  const r = await runDiagnostics(ctx({ artCheck: () => ({ scenes: 90, missing: ['eating-brown.png'] }) }));
  const text = formatReport(r, { when: new Date('2026-10-27T12:00:00Z'), logTail: ['line one', 'line two'] });
  assert.match(text, /^Bearly Apart check, 2026-10-27T12:00:00\.000Z: 1 problem found/);
  assert.match(text, /✗ Animations: 1 picture\(s\) missing: eating-brown\.png/);
  assert.match(text, /--- last log lines ---\nline one\nline two$/);
});

test('log file: lines before the file is known are kept, tail reads back, big files roll over', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-log-'));
  const printed = [];
  const log = createLogger({ print: (...a) => printed.push(a.join(' ')) });
  log('early line');
  log.setFile(path.join(dir, 'bearly-apart.log'));
  log('[relay] failed:', new Error('boom'));
  const tail = log.tail(5);
  assert.match(tail[0], /early line$/);
  assert.match(tail[1], /\[relay\] failed: Error: boom/);
  fs.writeFileSync(path.join(dir, 'bearly-apart.log'), 'x'.repeat(1024 * 1024 + 10));
  log('after roll');
  assert.ok(fs.existsSync(path.join(dir, 'bearly-apart.log.old')));
  assert.match(log.tail(1)[0], /after roll$/);
  assert.strictEqual(printed.length, 3);
});

test('log pieces: newest lines kept, oldest first, each under the relay limit, at most 4', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `2026-10-29T12:00:00.000Z line ${i} 🐻 ${'x'.repeat(60)}`);
  const parts = packLog(lines);
  assert.ok(parts.length === 4, `4 pieces, got ${parts.length}`);
  for (const p of parts) assert.ok(Buffer.byteLength(p) <= 3500, `piece is ${Buffer.byteLength(p)} bytes`);
  const back = parts.join('\n').split('\n');
  assert.strictEqual(back.at(-1), lines.at(-1), 'the newest line is there');
  assert.deepStrictEqual(back, lines.slice(-back.length), 'a run of the newest lines, in order');
  // a short log is one piece; a giant line is cut to fit; nothing in, nothing out
  assert.deepStrictEqual(packLog(['a', 'b']), ['a\nb']);
  const [big] = packLog(['é'.repeat(5000)]);
  assert.ok(Buffer.byteLength(big) <= 3500 && big.endsWith('…'));
  assert.deepStrictEqual(packLog([]), []);
});

test('log messages round-trip through the relay format with their piece number', () => {
  const back = fromNtfy({ event: 'message', id: '2', time: 1, message: 'l1\nl2', tags: toTags({ type: 'logpart', from: 'yimei', nonce: 'cd', part: '2-3' }) });
  assert.deepStrictEqual([back.type, back.nonce, back.part, back.text], ['logpart', 'cd', '2-3', 'l1\nl2']);
  assert.strictEqual(fromNtfy({ event: 'message', id: '3', time: 1, message: 'x', tags: toTags({ type: 'logreq', from: 'aaron', nonce: 'cd' }) }).type, 'logreq');
});

test('check messages carry their nonce', () => {
  const back = fromNtfy({ event: 'message', id: '1', time: 1, message: '{"version":"0.7.0"}', tags: toTags({ type: 'pong', from: 'yimei', nonce: 'ab12cd34' }) });
  assert.strictEqual(back.type, 'pong');
  assert.strictEqual(back.nonce, 'ab12cd34');
  assert.strictEqual(JSON.parse(back.text).version, '0.7.0');
});
