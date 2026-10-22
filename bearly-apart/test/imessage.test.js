const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IMessageWatcher, decodeAttributedBody, normalizeHandle, matchKeywords, appleDateToMs } = require('../src/main/imessage');
const { insert, attributedBody, open } = require('../tools/fake-chatdb');
const { DEFAULT_CONFIG, merge } = require('../src/main/store');

test('decodes text hidden in attributedBody (short and long)', () => {
  assert.strictEqual(decodeAttributedBody(attributedBody('miss you 🥺')), 'miss you 🥺');
  const long = 'x'.repeat(300) + ' love you';
  assert.strictEqual(decodeAttributedBody(attributedBody(long)), long);
  assert.strictEqual(decodeAttributedBody(null), '');
});

test('normalizes phone numbers and emails', () => {
  assert.strictEqual(normalizeHandle('+1 (555) 123-4567'), normalizeHandle('5551234567'));
  assert.strictEqual(normalizeHandle('Her@iCloud.com'), 'her@icloud.com');
});

test('keywords match whole words and emoji only', () => {
  const kw = DEFAULT_CONFIG.keywords;
  assert.deepStrictEqual(matchKeywords('I MISS YOU', kw), ['miss-you']);
  assert.deepStrictEqual(matchKeywords('I want to hug you', kw), ['hug']);
  assert.deepStrictEqual(matchKeywords('sending kisses 😘', kw), ['kiss']);
  assert.deepStrictEqual(matchKeywords('thug life, kissimmee', kw), []); // "hug"/"kiss" inside a word
  assert.deepStrictEqual(matchKeywords('love you, goodnight', kw), []); // only miss you / kiss / hug for now
});

test('apple dates convert', () => {
  const ms = Date.UTC(2026, 0, 1);
  assert.strictEqual(appleDateToMs(ms - 978307200000), ms);
});

test('watcher reports only the partner, both directions, skips history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-'));
  const db = path.join(dir, 'chat.db');
  open(db).close();
  insert(db, { handle: '+15551234567', text: 'old message before install' });
  let lastRow = 0;
  const cfg = merge(structuredClone(DEFAULT_CONFIG), { partner: { imessageHandles: ['555-123-4567'] } });
  const w = new IMessageWatcher({ getConfig: () => cfg, getLastRowId: () => lastRow, setLastRowId: (v) => (lastRow = v), dbPath: db, log: () => {} });
  const got = [];
  w.on('message', (m) => got.push(m));
  w.start();
  assert.strictEqual(w.status, 'ok');
  insert(db, { handle: '+15551234567', text: 'I miss you' });
  insert(db, { handle: '+19998887777', text: 'someone else' });
  insert(db, { handle: '+15551234567', body: attributedBody('big hug for you') });
  insert(db, { handle: '+15551234567', text: 'hehe', fromMe: 1 });
  insert(db, { handle: '+15551234567', assoc: 2000 });
  insert(db, { handle: '+15551234567', assoc: 3000 });
  w.poll();
  w.stop();
  assert.deepStrictEqual(
    got.map((m) => [m.direction, m.type, m.tapback || m.keywords.join()]),
    [
      ['in', 'message', 'miss-you'],
      ['in', 'message', 'hug'],
      ['out', 'message', ''],
      ['in', 'tapback', 'love'],
    ],
  );
});
