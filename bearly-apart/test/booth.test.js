const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../src/main/booth');
const { BoothSession } = require('../src/main/booth-session');
const { fromNtfy, toTags } = require('../src/main/relay');

// A tiny valid JPEG-looking data URL is enough: the session only stores and sends the bytes.
const shot = (n) => `data:image/jpeg;base64,${Buffer.from(`photo ${n}`).toString('base64')}`;
const four = (who) => [1, 2, 3, 4].map((i) => shot(`${who}${i}`));
const BOOTH_DAY = Date.parse('2026-11-25T18:00:00Z');

// ---------- rules ----------

test('the booth unlocks at 11:59 pm on the 24th on the earlier clock, and closes once both are past the 25th', () => {
  const ny = 'America/New_York';
  const la = 'America/Los_Angeles';
  assert.strictEqual(B.isBoothDay(Date.parse('2026-11-25T04:58:00Z'), [ny, la]), false); // 11:58 pm in New York
  assert.strictEqual(B.isBoothDay(Date.parse('2026-11-25T04:59:00Z'), [ny, la]), true); // 11:59 pm in New York, 8:59 pm in LA
  assert.strictEqual(B.unlocked(Date.parse('2026-11-25T04:59:00Z'), [la, ny]), true, 'the same moment for both apps');
  assert.strictEqual(B.unlocked(Date.parse('2026-11-25T04:59:00Z'), [la]), false);
  assert.strictEqual(B.unlocked(Date.parse('2027-03-01T12:00:00Z'), [ny, la]), true, 'the Draft tab stays unlocked');
  assert.strictEqual(B.localStamp(Date.parse('2026-11-25T04:59:00Z'), ny), '2026-11-24 23:59');
  assert.strictEqual(B.isBoothDay(Date.parse('2026-11-25T05:30:00Z'), [ny, la]), true); // 00:30 in New York, still the 24th in LA
  assert.strictEqual(B.isBoothDay(Date.parse('2026-11-26T07:00:00Z'), [ny, la]), true); // 23:00 on the 25th in LA
  assert.strictEqual(B.isBoothDay(Date.parse('2026-11-26T08:30:00Z'), [ny, la]), false);
  assert.strictEqual(B.isBoothDay(Date.parse('2026-11-24T12:00:00Z'), [ny, la]), false);
  assert.strictEqual(B.boothOver(Date.parse('2026-11-26T07:00:00Z'), [ny, la]), false);
  assert.strictEqual(B.boothOver(Date.parse('2026-11-26T09:00:00Z'), [ny, la]), true);
  assert.strictEqual(B.cityOf(la), 'Los Angeles');
  assert.strictEqual(B.cityOf('UTC'), '');
});

test('settings only take known values', () => {
  const s = B.cleanSettings({ design: 'nope', filter: 'cocoa', occasion: 'x'.repeat(200), stickers: [{ k: 'heart', x: 3, y: -1, s: 9, r: 999 }, { k: 'evil' }], prompts: ['a'] });
  assert.strictEqual(s.design, 'classic');
  assert.strictEqual(s.filter, 'cocoa');
  assert.strictEqual(s.occasion.length, 60);
  assert.deepStrictEqual(s.stickers, [{ k: 'heart', x: 1, y: 0, s: 0.6, r: 180 }]);
  assert.strictEqual(s.prompts.length, 4);
  assert.strictEqual(s.prompts[0], 'a');
  assert.strictEqual(s.prompts[1], B.DEFAULT_PROMPTS[1]);
  assert.ok(B.STICKERS.includes('wiggle-brown') && B.STICKERS.includes('pair-cuddle'));
  assert.ok(B.STICKERS.includes('turkey') && B.STICKERS.includes('tree') && B.STICKERS.includes('cupid'));
  const c = B.cleanSettings({ color: 'mint', deco: 'thanksgiving', tags: false });
  assert.deepStrictEqual([c.color, c.deco, c.tags], ['mint', 'thanksgiving', false]);
  const bad = B.cleanSettings({ color: '#123456', deco: 'arson' });
  assert.deepStrictEqual([bad.color, bad.deco, bad.tags], ['auto', 'none', true]);
});

test('photos sealed for one visit open only with that visit’s key', () => {
  const a = B.newKeys();
  const b = B.newKeys();
  const k1 = B.sessionKey(a.priv, b.pub, 'abcdef0123');
  const k2 = B.sessionKey(b.priv, a.pub, 'abcdef0123');
  assert.deepStrictEqual(k1, k2);
  const files = [
    { name: '1.jpg', data: Buffer.from('one') },
    { name: '2.jpg', data: Buffer.from('two two') },
  ];
  const sealed = B.seal(k1, B.pack(files));
  assert.ok(!sealed.includes(Buffer.from('two two')));
  assert.deepStrictEqual(
    B.unpack(B.open(k2, sealed)).map((f) => [f.name, f.data.toString()]),
    [
      ['1.jpg', 'one'],
      ['2.jpg', 'two two'],
    ],
  );
  assert.throws(() => B.open(B.sessionKey(a.priv, b.pub, 'other00000'), sealed));
  const bad = Buffer.from(sealed);
  bad[bad.length - 1] ^= 1;
  assert.throws(() => B.open(k1, bad));
});

// ---------- two computers on a fake relay ----------

function world() {
  let t = BOOTH_DAY;
  const w = {
    now: () => t,
    advance: (ms) => (t += ms),
    queue: [],
    files: new Map(),
    computers: [],
    messages: 0,
    async settle() {
      // Messages go out in order to everyone (the sender too); downloads and uploads are promises, so let them run.
      for (let round = 0; round < 20; round++) {
        await new Promise((r) => setImmediate(r));
        if (!w.queue.length) continue;
        while (w.queue.length) {
          const ev = w.queue.shift();
          for (const c of w.computers) if (c.online) c.booth.onEvent(ev);
        }
      }
    },
    computer(id, device, partner, { tz = 'America/New_York', theirTz = 'America/Los_Angeles' } = {}) {
      const names = { aaron: 'Aaron', yimei: 'Yimei' };
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `booth-${id}-`));
      const c = { online: true, notes: [], strips: 0, sent: [], dir };
      c.booth = new BoothSession({
        config: () => ({ me: { id, name: names[id], character: id === 'aaron' ? 'brown' : 'cream' }, partner: { id: partner, name: names[partner], timezone: theirTz } }),
        dir,
        publish: async (status, text) => {
          if (!c.online) throw new Error('offline');
          c.sent.push(status);
          w.messages++;
          const msg = { event: 'message', id: String(w.messages), time: Math.floor(w.now() / 1000), message: text, tags: toTags({ type: 'booth', from: id, device, status }) };
          w.queue.push(fromNtfy(msg));
          return { id: msg.id, time: msg.time };
        },
        upload: async (data) => {
          const url = `https://ntfy.test/file/${w.files.size + 1}`;
          w.files.set(url, Buffer.from(data));
          return { url };
        },
        download: async (url) => {
          if (!w.files.has(url)) throw new Error('404');
          return w.files.get(url);
        },
        notify: (text) => c.notes.push(text),
        onStrip: () => c.strips++,
        device,
        now: w.now,
        log: () => {},
      });
      w.computers.push(c);
      return c;
    },
  };
  return w;
}

test('together: invite, both ready, one shared countdown, photos swapped sealed, same strip on both', async () => {
  const w = world();
  const A = w.computer('aaron', 'desk', 'yimei');
  const Y = w.computer('yimei', 'mac', 'aaron', { tz: 'America/Los_Angeles', theirTz: 'America/New_York' });
  const L = w.computer('aaron', 'laptop', 'yimei'); // Aaron's other computer hears everything too

  const { sid } = await A.booth.start({ mode: 'together' });
  await w.settle();
  assert.strictEqual(A.booth.view().sessions[0].status, 'invited');
  assert.match(Y.notes.at(-1), /Aaron invited you/);
  assert.strictEqual(L.booth.view().sessions.length, 0, 'the laptop stays out of the desktop’s visit');
  assert.strictEqual(Y.booth.needsMe(), true);

  await Y.booth.act({ type: 'accept', sid });
  await w.settle();
  assert.strictEqual(A.booth.view().sessions[0].status, 'lobby');
  assert.strictEqual(Y.booth.view().sessions[0].status, 'lobby');

  // Settings from either side end up the same on both.
  await Y.booth.act({ type: 'set', sid, patch: { filter: 'blush', occasion: 'Our day ♡' } });
  await A.booth.act({ type: 'set', sid, patch: { design: 'film' } });
  await w.settle();
  for (const c of [A, Y]) assert.deepStrictEqual([c.booth.view().sessions[0].settings.design, c.booth.view().sessions[0].settings.filter, c.booth.view().sessions[0].settings.occasion], ['film', 'blush', 'Our day ♡']);

  await A.booth.act({ type: 'ready', sid, on: true });
  await w.settle();
  assert.strictEqual(A.booth.view().sessions[0].status, 'lobby', 'not until both are ready');
  await Y.booth.act({ type: 'ready', sid, on: true });
  await w.settle();
  const va = A.booth.view().sessions[0];
  const vy = Y.booth.view().sessions[0];
  assert.strictEqual(va.status, 'shooting');
  assert.strictEqual(vy.status, 'shooting');
  assert.strictEqual(va.shotsAt.length, 4);
  assert.ok(Math.abs(va.shotsAt[0] - vy.shotsAt[0]) < 1000, 'both computers fire at the same moment');
  assert.ok(va.shotsAt[0] > w.now(), 'the first shot is still ahead');
  assert.strictEqual(A.sent.filter((k) => k === 'go').length, 1);

  await A.booth.act({ type: 'shots', sid, images: four('a') });
  await w.settle();
  assert.strictEqual(A.booth.view().sessions[0].status, 'developing');
  for (const f of w.files.values()) assert.ok(!f.includes(Buffer.from('photo a1')), 'the relay only ever holds sealed photos');
  await Y.booth.act({ type: 'shots', sid, images: four('y') });
  await w.settle();
  for (const c of [A, Y]) {
    const v = c.booth.view().sessions[0];
    assert.strictEqual(v.status, 'done');
    assert.deepStrictEqual([v.mine, v.theirs], [4, 4]);
    assert.strictEqual(c.strips, 1);
    const p = c.booth.photos(sid);
    assert.strictEqual(Buffer.from(p.aaron[0].split(',')[1], 'base64').toString(), 'photo a1');
    assert.strictEqual(Buffer.from(p.yimei[3].split(',')[1], 'base64').toString(), 'photo y4');
  }
  assert.match(Y.notes.at(-1), /photo strip is ready/);
});

test('own time: your half waits for their accept, then both halves arrive whenever', async () => {
  const w = world();
  const A = w.computer('aaron', 'desk', 'yimei');
  const Y = w.computer('yimei', 'mac', 'aaron');
  const { sid } = await A.booth.start({ mode: 'own' });
  await w.settle();
  assert.match(Y.notes.at(-1), /Take your half/);
  await A.booth.act({ type: 'shots', sid, images: four('a') });
  await w.settle();
  assert.strictEqual(w.files.size, 0, 'nothing goes out before there is a key for it');
  await A.booth.act({ type: 'then', sid, image: shot('old') });
  await A.booth.act({ type: 'set', sid, patch: { note: 'love you', noteBy: 'aaron' } });
  await w.settle();

  w.advance(3 * 3600_000);
  await Y.booth.act({ type: 'accept', sid });
  await w.settle();
  const vy = Y.booth.view().sessions[0];
  assert.strictEqual(vy.theirs, 4, 'Aaron’s half came once Yimei said yes');
  assert.strictEqual(vy.hasThen, true);
  assert.strictEqual(vy.settings.note, 'love you');
  assert.strictEqual(Y.booth.needsMe(), true);
  await Y.booth.act({ type: 'shots', sid, images: four('y') });
  await w.settle();
  assert.strictEqual(A.booth.view().sessions[0].status, 'done');
  assert.strictEqual(Y.booth.view().sessions[0].status, 'done');
});

test('a half the relay forgot is asked for again and sent again', async () => {
  const w = world();
  const A = w.computer('aaron', 'desk', 'yimei');
  const Y = w.computer('yimei', 'mac', 'aaron');
  const { sid } = await A.booth.start({ mode: 'own' });
  await w.settle();
  await Y.booth.act({ type: 'accept', sid });
  await w.settle();
  Y.online = false;
  await A.booth.act({ type: 'shots', sid, images: four('a') });
  await w.settle();
  w.files.clear(); // expired on the relay before Yimei's app came back
  Y.online = true;
  // Her app replays the message it missed, finds the file gone, and asks for it.
  Y.booth.onEvent(fromNtfy({ event: 'message', id: 'replay', time: 1, message: JSON.stringify({ sid, kind: 'half', url: 'https://ntfy.test/file/1', d: 'desk' }), tags: toTags({ type: 'booth', from: 'aaron', status: 'files' }) }));
  await w.settle();
  assert.ok(Y.sent.includes('need'));
  assert.strictEqual(Y.booth.view().sessions[0].theirs, 4);
});

test('a test visit stays on this computer: you take both halves', async () => {
  const w = world();
  const A = w.computer('aaron', 'desk', 'yimei');
  const { sid } = await A.booth.start({ mode: 'test' });
  await A.booth.act({ type: 'shots', sid, images: four('a'), who: 'me' });
  assert.strictEqual(A.booth.view().sessions[0].status, 'lobby');
  await A.booth.act({ type: 'shots', sid, images: four('b'), who: 'them' });
  await A.booth.act({ type: 'set', sid, patch: { design: 'moon' } });
  const v = A.booth.view().sessions[0];
  assert.strictEqual(v.status, 'done');
  assert.strictEqual(v.settings.design, 'moon');
  assert.strictEqual(A.sent.length, 0);
  assert.strictEqual(A.booth.photos(sid).yimei.length, 4);
  await A.booth.act({ type: 'forget', sid });
  assert.strictEqual(A.booth.view().sessions.length, 0);
});

test('closed days: no new visits unless the tester section is unlocked', async () => {
  const w = world();
  w.advance(-5 * 24 * 3600_000);
  const A = w.computer('aaron', 'desk', 'yimei');
  assert.strictEqual(A.booth.isOpen(), false);
  assert.strictEqual((await A.booth.start({ mode: 'test' })).ok, false);
  A.booth.tester = () => true;
  assert.strictEqual((await A.booth.start({ mode: 'test' })).ok, true);
});
