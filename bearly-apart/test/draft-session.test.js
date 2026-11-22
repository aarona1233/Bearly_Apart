const test = require('node:test');
const assert = require('node:assert');
const draft = require('../src/main/draft');
const { DraftSession } = require('../src/main/draft-session');
const { fromNtfy, toTags } = require('../src/main/relay');
const topics = require('../assets/draft/topics.json');

const catalog = new draft.Catalog(topics);

// A fake relay: keeps messages in one order and delivers them to everyone (the sender too), like ntfy. deliver() lets a
// test hold messages back to create races, and offline computers miss what's sent while they're away.
function world() {
  let t = 1_800_000_000_000;
  const w = {
    now: () => t,
    advance(ms) {
      t += ms;
      const due = w.scheduled.filter((x) => x.at <= t);
      w.scheduled = w.scheduled.filter((x) => x.at > t);
      due.sort((a, b) => a.at - b.at).forEach((x) => x.fn());
    },
    scheduled: [],
    timers: {
      set: (fn, ms) => {
        const job = { fn, at: t + ms };
        w.scheduled.push(job);
        return job;
      },
      clear: (job) => {
        w.scheduled = w.scheduled.filter((x) => x !== job);
      },
    },
    queue: [],
    computers: [],
    messages: 0,
    deliver() {
      while (w.queue.length) {
        const ev = w.queue.shift();
        for (const c of w.computers) if (c.online) c.session.onEvent(ev);
      }
    },
    computer(id, device, partner) {
      const names = { aaron: 'Aaron', yimei: 'Yimei' };
      const c = { online: true, notes: [], file: {}, published: [] };
      c.session = new DraftSession({
        catalog,
        config: () => ({ me: { id, name: names[id] }, partner: { id: partner, name: names[partner] } }),
        publish: async (status, text) => {
          if (!c.online) throw new Error('offline');
          w.messages++;
          c.published.push(status);
          // Through the real tag format, so a type the relay doesn't know would fail here.
          const msg = { event: 'message', id: String(w.messages), time: 1, message: text, tags: toTags({ type: 'draft', from: id, device, status }) };
          w.queue.push(fromNtfy(msg));
        },
        load: () => c.file,
        save: (d) => (c.file = structuredClone(d)),
        notify: (text) => c.notes.push(text),
        device,
        now: w.now,
        timers: w.timers,
        rand: seededRand(),
      });
      w.computers.push(c);
      return c;
    },
  };
  return w;
}

function seededRand(n = 11) {
  return () => (n = (n * 16807) % 2147483647) / 2147483647;
}

async function startTurns(w, a) {
  await a.session.start({ settings: { mode: 'turns', judge: 'each' } });
  a.session.state.topic = 'burger';
  await a.session.act({ type: 'topic' });
  await a.session.act({ type: 'context', label: null });
  w.deliver();
}

test('setting up a take-turns game sends nothing until the topic and setting are picked', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await a.session.start({ settings: { mode: 'turns' } });
  await a.session.act({ type: 'skip' });
  await a.session.act({ type: 'topic' });
  assert.strictEqual(w.messages, 0);
  assert.strictEqual(a.session.state.phase, 'context');
  await a.session.act({ type: 'context', label: null });
  assert.strictEqual(w.messages, 1);
  w.deliver();
  assert.strictEqual(y.session.state.seq, 1);
  assert.strictEqual(y.session.state.phase, 'auction');
  assert.match(y.notes[0], /Aaron started a draft/);
  assert.deepStrictEqual(a.notes, []);
});

test('a move changes nothing here until it comes back from the relay, then both sides match and get told', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, a);
  await a.session.act({ type: 'bid', cents: 300 });
  assert.strictEqual(a.session.state.cur.bid, 0);
  assert.strictEqual(a.session.pending, true);
  w.deliver();
  assert.strictEqual(a.session.state.cur.bid, 300);
  assert.strictEqual(a.session.pending, false);
  assert.deepStrictEqual(y.session.state, a.session.state);
  assert.match(y.notes.at(-1), /Aaron bid \$3\.00 on .*Your move/);
  assert.strictEqual(y.session.isMyMove(), true);
  assert.strictEqual(a.session.isMyMove(), false);
});

test('my other computer follows along without telling me about my own move', async () => {
  const w = world();
  const desk = w.computer('aaron', 'desk', 'yimei');
  const laptop = w.computer('aaron', 'laptop', 'yimei');
  w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, desk);
  await desk.session.act({ type: 'bid', cents: 300 });
  w.deliver();
  assert.deepStrictEqual(laptop.session.state, desk.session.state);
  assert.deepStrictEqual(laptop.notes, []);
  // And the game can carry on from the laptop.
  await w.computers[2].session.act({ type: 'pass' });
  w.deliver();
  await laptop.session.act({ type: 'pass' });
  w.deliver();
  assert.strictEqual(desk.session.state.seq, laptop.session.state.seq);
});

test('a live race: two bids for the same seq, the first through the relay wins everywhere', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await a.session.start({ settings: { mode: 'live', timerSec: 20 } });
  w.deliver();
  await y.session.act({ type: 'accept' });
  w.deliver();
  await y.session.act({ type: 'topic' });
  w.deliver();
  await a.session.act({ type: 'context', label: null });
  w.deliver();
  await a.session.act({ type: 'bid', cents: 100 });
  await y.session.act({ type: 'bid', cents: 200 });
  w.deliver();
  assert.strictEqual(a.session.state.cur.bid, 100);
  assert.strictEqual(y.session.state.cur.bid, 100);
  assert.deepStrictEqual(a.session.state, y.session.state);
});

test('live: when time runs out the item closes, and it only counts once though both computers call it', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await a.session.start({ settings: { mode: 'live', timerSec: 10 } });
  w.deliver();
  await y.session.act({ type: 'accept' });
  w.deliver();
  await y.session.act({ type: 'topic' });
  w.deliver();
  await a.session.act({ type: 'context', label: null });
  w.deliver();
  const first = a.session.state.cur.item;
  await y.session.act({ type: 'bid', cents: 100 });
  w.deliver();
  const seq = a.session.state.seq;
  // Both timers fire in the same instant, before either's message has come back.
  w.advance(12_000);
  await Promise.resolve();
  w.deliver();
  assert.deepStrictEqual(a.session.state.won.yimei, [[first, 100]]);
  assert.strictEqual(a.session.state.seq, seq + 1);
  assert.deepStrictEqual(a.session.state, y.session.state);
  assert.notStrictEqual(a.session.state.cur.item, first);
});

test('a failed send says so and leaves the game as it was', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, a);
  a.online = false;
  const r = await a.session.act({ type: 'bid', cents: 100 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(a.session.pending, false);
  assert.strictEqual(a.session.state.cur.bid, 0);
});

test('a move I can’t make is refused without sending anything', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, a);
  const before = w.messages;
  const r = await y.session.act({ type: 'bid', cents: 100 });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /isn’t your turn/);
  assert.strictEqual(w.messages, before);
});

test('days offline: the relay forgot the moves, and asking brings the game back, with one note about the latest', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, a);
  y.online = false;
  await a.session.act({ type: 'bid', cents: 300 });
  w.deliver();
  const notesBefore = y.notes.length;
  // She comes back after the relay's cache has expired, so the stream brings nothing. Her app asks.
  y.online = true;
  y.session.onConnected();
  w.deliver();
  w.advance(2000);
  w.deliver();
  assert.deepStrictEqual(y.session.state, a.session.state);
  assert.strictEqual(y.notes.length, notesBefore + 1);
  assert.match(y.notes.at(-1), /Aaron bid \$3\.00/);
  assert.deepStrictEqual(a.published.filter((p) => p === 'resend').length, 1);
});

test('a computer that was off when the game started catches up too', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  y.online = false;
  await startTurns(w, a);
  y.online = true;
  assert.strictEqual(y.session.state, null);
  y.session.onConnected();
  w.deliver();
  w.advance(2000);
  w.deliver();
  assert.strictEqual(y.session.state.id, a.session.state.id);
});

test('someone further along hearing an ask from behind answers; someone behind asks back', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, a);
  y.online = false;
  await a.session.act({ type: 'bid', cents: 300 });
  w.deliver();
  a.online = false; // now she's back while he's gone: nobody answers her ask
  y.online = true;
  y.session.onConnected();
  w.deliver();
  w.advance(90_000);
  assert.strictEqual(y.session.state.cur.bid, 0);
  // He comes online later and asks: she sees he's ahead, and asks back; he answers.
  a.online = true;
  a.session.lastAskAt = 0;
  a.session.onConnected();
  w.deliver();
  w.advance(2000);
  w.deliver();
  w.advance(2000);
  w.deliver();
  assert.strictEqual(y.session.state.cur.bid, 300);
});

test('asking is rate-limited, so a flaky connection doesn’t spam the relay', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, a);
  w.deliver();
  a.session.onConnected();
  const count = w.messages;
  for (let i = 0; i < 20; i++) a.session.onConnected();
  assert.strictEqual(w.messages, count);
  w.advance(11 * 60_000);
  a.session.onConnected();
  assert.strictEqual(w.messages, count + 1);
});

test('a newer game replaces an older one, and an older one never comes back', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, a);
  const oldGame = structuredClone(a.session.state);
  await a.session.act({ type: 'abandon' });
  w.deliver();
  w.advance(5000);
  await y.session.start({ settings: { mode: 'live' } });
  w.deliver();
  assert.notStrictEqual(a.session.state.id, oldGame.id);
  const newId = a.session.state.id;
  a.session.onEvent({ type: 'draft', from: 'yimei', status: 'resend', text: JSON.stringify(oldGame) });
  assert.strictEqual(a.session.state.id, newId);
});

test('a game for other people, or a message that isn’t JSON, is ignored', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  a.session.onEvent({ type: 'draft', from: 'yimei', status: 'state', text: 'nope' });
  a.session.onEvent({ type: 'draft', from: 'yimei', status: 'state', text: JSON.stringify({ v: 1, id: 'x', seq: 1, players: ['a', 'b'] }) });
  assert.strictEqual(a.session.state, null);
});

test('the game survives a restart, with the same state and its timer still running', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await a.session.start({ settings: { mode: 'live', timerSec: 30 } });
  w.deliver();
  await y.session.act({ type: 'accept' });
  w.deliver();
  await y.session.act({ type: 'topic' });
  w.deliver();
  await y.session.act({ type: 'context', label: null });
  w.deliver();
  w.advance(5000);
  const reopened = new DraftSession({
    catalog,
    config: () => ({ me: { id: 'aaron', name: 'Aaron' }, partner: { id: 'yimei', name: 'Yimei' } }),
    publish: async () => {},
    load: () => a.file,
    save: () => {},
    now: w.now,
    timers: w.timers,
  });
  assert.deepStrictEqual(reopened.state, a.session.state);
  const left = reopened.view().game.cur.leftMs;
  assert.ok(left > 24_000 && left <= 25_000, `left ${left}`);
});

test('the window’s view keeps my own side and their side straight', async () => {
  const w = world();
  const a = w.computer('aaron', 'desk', 'yimei');
  const y = w.computer('yimei', 'mac', 'aaron');
  await startTurns(w, a);
  await a.session.act({ type: 'bid', cents: 300 });
  w.deliver();
  await y.session.act({ type: 'pass' });
  w.deliver();
  const mine = a.session.view();
  const hers = y.session.view();
  assert.strictEqual(mine.game.me.budget, 1700);
  assert.strictEqual(mine.game.me.won[0].cents, 300);
  assert.ok(mine.game.me.won[0].name);
  assert.strictEqual(hers.game.them.budget, 1700);
  assert.ok(mine.feed.some((f) => /You bid \$3\.00/.test(f.text)));
  assert.ok(hers.feed.some((f) => /Aaron bid \$3\.00/.test(f.text)));
  assert.ok(hers.feed.some((f) => /You passed/.test(f.text) && /Aaron got/.test(f.text)));
});
