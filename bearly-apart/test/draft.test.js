const test = require('node:test');
const assert = require('node:assert');
const draft = require('../src/main/draft');
const topics = require('../assets/draft/topics.json');

const catalog = new draft.Catalog(topics);
const NAMES = { aaron: 'Aaron', yimei: 'Yimei' };

// A seeded random, so a failure can be replayed.
function seeded(n = 7) {
  return () => (n = (n * 16807) % 2147483647) / 2147483647;
}

function move(s, action) {
  const next = draft.apply(s, action, catalog, seeded());
  assert.ok(!next.error, next.error);
  return next;
}

// A take-turns game on its first item, with Aaron to move.
function turnsGame(topicId = 'burger') {
  let s = draft.newGame({ id: 'g1', at: 1, mode: 'turns', judge: 'each', me: 'aaron', partner: 'yimei' }, catalog, seeded());
  s.topic = topicId;
  s = move(s, { type: 'topic', by: 'aaron' });
  return move(s, { type: 'context', by: 'aaron', label: null });
}

function liveGame(opts = {}) {
  let s = draft.newGame({ id: 'g2', at: 1, mode: 'live', judge: 'each', me: 'aaron', partner: 'yimei', ...opts }, catalog, seeded());
  s = move(s, { type: 'accept', by: 'yimei' });
  s = move(s, { type: 'topic', by: 'yimei' });
  return move(s, { type: 'context', by: 'aaron', label: null });
}

test('every topic can fill a round, and every context of every topic too', () => {
  for (const t of topics) {
    assert.strictEqual(draft.pickRoundItems(t, null, seeded()).length, draft.ITEMS_PER_ROUND, t.id);
    for (const c of t.contexts || []) {
      const items = draft.pickRoundItems(t, c.label, seeded());
      assert.strictEqual(new Set(items.map((i) => i.id)).size, draft.ITEMS_PER_ROUND, `${t.id}/${c.id}`);
      // Most of the round belongs to the chosen setting, none to another one (unless it's a thin pack).
      assert.ok(items.filter((i) => i.contexts?.includes(c.id)).length >= 6, `${t.id}/${c.id} has too few of its own`);
    }
  }
});

test('a take-turns game is set up locally, then starts with the starter to move', () => {
  const s = draft.newGame({ id: 'g1', at: 1, mode: 'turns', judge: 'each', me: 'aaron', partner: 'yimei' }, catalog, seeded());
  assert.strictEqual(s.local, true);
  assert.strictEqual(s.phase, 'pick');
  const started = turnsGame();
  assert.strictEqual(started.local, undefined);
  assert.strictEqual(started.phase, 'auction');
  assert.strictEqual(started.cur.turn, 'aaron');
  assert.strictEqual(started.total, draft.ITEMS_PER_ROUND);
});

test('skipping a topic never shows the same one again', () => {
  let s = draft.newGame({ id: 'g1', at: 1, mode: 'turns', judge: 'each', me: 'aaron', partner: 'yimei' }, catalog, seeded());
  for (let i = 0; i < 40; i++) {
    const before = s.topic;
    s = move(s, { type: 'skip', by: 'aaron' });
    assert.notStrictEqual(s.topic, before);
  }
});

test('turns: a bid hands the move over, and only the player to move can act', () => {
  let s = turnsGame();
  assert.ok(draft.apply(s, { type: 'bid', by: 'yimei', cents: 100 }, catalog).error, 'not her turn');
  assert.ok(draft.apply(s, { type: 'bid', by: 'aaron', cents: 25 }, catalog).error, 'under the opening minimum');
  assert.ok(draft.apply(s, { type: 'bid', by: 'aaron', cents: 2001 }, catalog).error, 'over budget');
  s = move(s, { type: 'bid', by: 'aaron', cents: 100 });
  assert.strictEqual(s.cur.turn, 'yimei');
  assert.strictEqual(s.cur.lead, 'aaron');
  assert.ok(draft.apply(s, { type: 'bid', by: 'yimei', cents: 100 }, catalog).error, 'has to be higher');
  s = move(s, { type: 'bid', by: 'yimei', cents: 150 });
  assert.strictEqual(s.cur.turn, 'aaron');
  assert.ok(draft.apply(s, { type: 'bid', by: 'yimei', cents: 200 }, catalog).error, 'already leading');
});

test('turns: passing on a leader gives them the item, charges them, and the other player opens the next item', () => {
  let s = turnsGame();
  const first = s.cur.item;
  s = move(s, { type: 'bid', by: 'aaron', cents: 300 });
  s = move(s, { type: 'pass', by: 'yimei' });
  assert.deepStrictEqual(s.won.aaron, [[first, 300]]);
  assert.strictEqual(s.bud.aaron, 1700);
  assert.strictEqual(s.bud.yimei, 2000);
  assert.deepStrictEqual(s.last.won, { who: 'aaron', item: first, cents: 300 });
  assert.notStrictEqual(s.cur.item, first);
  assert.strictEqual(s.cur.turn, 'yimei');
  assert.strictEqual(s.cur.bid, 0);
});

test('turns: one pass with no bid hands the move over; two discard the item', () => {
  let s = turnsGame();
  const first = s.cur.item;
  s = move(s, { type: 'pass', by: 'aaron' });
  assert.strictEqual(s.cur.item, first);
  assert.strictEqual(s.cur.turn, 'yimei');
  s = move(s, { type: 'pass', by: 'yimei' });
  assert.deepStrictEqual(s.gone, [first]);
  assert.notStrictEqual(s.cur.item, first);
});

test('turns: after passing with no leader, the other bid wins straight away', () => {
  let s = turnsGame();
  const first = s.cur.item;
  s = move(s, { type: 'pass', by: 'aaron' });
  s = move(s, { type: 'bid', by: 'yimei', cents: 50 });
  assert.deepStrictEqual(s.won.yimei, [[first, 50]]);
});

test('turns: a bear who can’t afford a bid passes automatically', () => {
  let s = turnsGame();
  // Yimei can't beat a bid of her whole budget, so it wins on the spot.
  s = move(s, { type: 'bid', by: 'aaron', cents: 2000 });
  assert.strictEqual(s.bud.aaron, 0);
  assert.strictEqual(s.won.aaron.length, 1);
  assert.strictEqual(s.last.broke, 'yimei');
  // Aaron has no money left, so his turns skip themselves and Yimei's bid on the next item wins at once.
  assert.strictEqual(s.cur.turn, 'yimei');
  const item = s.cur.item;
  s = move(s, { type: 'bid', by: 'yimei', cents: 50 });
  assert.deepStrictEqual(s.won.yimei, [[item, 50]]);
  assert.strictEqual(s.last.broke, 'aaron');
});

test('when both bears are broke the rest of the round is discarded and the builds come out', () => {
  let s = turnsGame();
  s.bud = { aaron: 10, yimei: 10 };
  s = move(s, { type: 'pass', by: 'aaron' });
  assert.strictEqual(s.phase, 'reveal');
  assert.strictEqual(s.gone.length, draft.ITEMS_PER_ROUND);
  assert.strictEqual(s.cur, null);
});

test('a full 12-item game runs to the reveal with the money adding up', () => {
  let s = turnsGame();
  for (let i = 0; i < draft.ITEMS_PER_ROUND; i++) {
    const a = s.cur.turn;
    s = move(s, { type: 'bid', by: a, cents: 100 });
    s = move(s, { type: 'pass', by: draft.other(s, a) });
  }
  assert.strictEqual(s.phase, 'reveal');
  assert.strictEqual(s.won.aaron.length + s.won.yimei.length, draft.ITEMS_PER_ROUND);
  assert.strictEqual(s.bud.aaron + s.bud.yimei, 4000 - draft.ITEMS_PER_ROUND * 100);
});

test('live: starts as an invite, either bear can answer it, the timer runs on each item', () => {
  const inv = draft.newGame({ id: 'g2', at: 1, mode: 'live', judge: 'each', me: 'aaron', partner: 'yimei' }, catalog, seeded());
  assert.strictEqual(inv.phase, 'invite');
  assert.strictEqual(inv.local, undefined);
  const s = liveGame({ timerSec: 15 });
  assert.strictEqual(s.cur.ms, 15_000);
  assert.strictEqual(s.cur.turn, null);
});

test('live: bids can come from anyone in any order, and a late bid buys time back', () => {
  let s = liveGame();
  s = move(s, { type: 'bid', by: 'yimei', cents: 100, leftMs: 15_000 });
  assert.strictEqual(s.cur.ms, 15_000);
  s = move(s, { type: 'bid', by: 'aaron', cents: 150, leftMs: 900 });
  assert.strictEqual(s.cur.ms, 8000);
});

test('live: passing is off unless the game allows it', () => {
  assert.ok(draft.apply(liveGame(), { type: 'pass', by: 'aaron' }, catalog).error);
  const s = liveGame({ allowPass: true });
  const first = s.cur.item;
  const next = move(move(s, { type: 'pass', by: 'aaron' }), { type: 'pass', by: 'yimei' });
  assert.deepStrictEqual(next.gone, [first]);
});

test('live: time’s up gives the item to the leader; a stale call does nothing', () => {
  let s = liveGame();
  const first = s.cur.item;
  s = move(s, { type: 'bid', by: 'aaron', cents: 100 });
  const next = move(s, { type: 'time', item: first });
  assert.deepStrictEqual(next.won.aaron, [[first, 100]]);
  assert.ok(draft.apply(next, { type: 'time', item: first }, catalog).error);
});

test('live: a bid meant for an item that just closed doesn’t land on the next one', () => {
  let s = liveGame();
  const first = s.cur.item;
  s = move(s, { type: 'time', item: first });
  assert.ok(draft.apply(s, { type: 'bid', by: 'aaron', cents: 100, item: first }, catalog).error);
});

test('live: two items with nobody bidding turns it into a take-turns game', () => {
  let s = liveGame();
  s = move(s, { type: 'time', item: s.cur.item });
  assert.strictEqual(s.mode, 'live');
  s = move(s, { type: 'time', item: s.cur.item });
  assert.strictEqual(s.mode, 'turns');
  assert.strictEqual(s.last.toTurns, true);
  assert.strictEqual(s.cur.ms, null);
  assert.ok(s.players.includes(s.cur.turn));
});

test('live: can be switched to take-turns by hand, keeping the bid, with the other bear to move', () => {
  let s = liveGame();
  s = move(s, { type: 'bid', by: 'aaron', cents: 100 });
  s = move(s, { type: 'to-turns', by: 'yimei' });
  assert.strictEqual(s.mode, 'turns');
  assert.strictEqual(s.cur.bid, 100);
  assert.strictEqual(s.cur.turn, 'yimei');
});

function atReveal(judge) {
  let s = turnsGame();
  s.judge = judge;
  while (s.phase === 'auction') {
    const a = s.cur.turn;
    s = move(s, { type: 'bid', by: a, cents: 50 });
    s = move(s, { type: 'pass', by: draft.other(s, a) });
  }
  return s;
}

test('judging each other: results come after both have scored, and the totals are out of 20', () => {
  let s = move(atReveal('each'), { type: 'judging', by: 'yimei' });
  assert.ok(draft.apply(s, { type: 'score', by: 'aaron', sheet: [9, 1, 1, 1] }, catalog).error);
  s = move(s, { type: 'score', by: 'aaron', sheet: [5, 5, 5, 5] });
  assert.strictEqual(s.phase, 'judging');
  assert.ok(draft.apply(s, { type: 'score', by: 'aaron', sheet: [1, 1, 1, 1] }, catalog).error, 'only once');
  s = move(s, { type: 'score', by: 'yimei', sheet: [3, 3, 3, 3] });
  assert.strictEqual(s.phase, 'results');
  const r = draft.results(s);
  assert.strictEqual(r.winner, 'yimei'); // Aaron gave Yimei the fives
  assert.strictEqual(r.rows.find((x) => x.id === 'yimei').total, 20);
  assert.strictEqual(r.rows.find((x) => x.id === 'aaron').total, 12);
});

test('a tie has no winner', () => {
  let s = move(atReveal('each'), { type: 'judging', by: 'aaron' });
  s = move(move(s, { type: 'score', by: 'aaron', sheet: [3, 3, 3, 3] }), { type: 'score', by: 'yimei', sheet: [3, 3, 3, 3] });
  assert.strictEqual(draft.results(s).winner, null);
});

test('the AI judge and a friend score both builds at once; bad scores are refused', () => {
  for (const judge of ['ai', 'friend']) {
    let s = move(atReveal(judge), { type: 'judging', by: 'aaron' });
    assert.ok(draft.apply(s, { type: 'score', by: 'aaron', sheet: [3, 3, 3, 3] }, catalog).error, 'no scoring by hand');
    assert.ok(draft.apply(s, { type: judge, by: 'aaron', sheets: { aaron: [3, 3, 3, 3] } }, catalog).error, 'needs both');
    s = move(s, { type: judge, by: 'aaron', sheets: { aaron: [5, 4, 3, 2], yimei: [1, 2, 3, 4] } });
    assert.strictEqual(s.phase, 'results');
    assert.strictEqual(draft.results(s).winner, 'aaron');
  }
});

test('an unreachable AI judge can fall back to judging each other', () => {
  let s = move(atReveal('ai'), { type: 'judging', by: 'aaron' });
  s = move(s, { type: 'judge-each', by: 'yimei' });
  assert.strictEqual(s.judge, 'each');
  s = move(move(s, { type: 'score', by: 'aaron', sheet: [3, 3, 3, 3] }), { type: 'score', by: 'yimei', sheet: [4, 4, 4, 4] });
  assert.strictEqual(s.phase, 'results');
});

test('a friend’s reply is read in any wording, as long as it has eight scores', () => {
  const players = ['aaron', 'yimei'];
  const want = { aaron: [4, 5, 3, 2], yimei: [3, 4, 5, 2] };
  assert.deepStrictEqual(draft.parseFriendScores('Aaron 4 5 3 2 · Yimei 3 4 5 2', players), want);
  assert.deepStrictEqual(draft.parseFriendScores('4,5,3,2\n3,4,5,2', players), want);
  assert.deepStrictEqual(draft.parseFriendScores('Yimei 3 4 5 2, Aaron 4 5 3 2', players, NAMES), want);
  assert.strictEqual(draft.parseFriendScores('4 5 3 2', players), null);
  assert.strictEqual(draft.parseFriendScores('', players), null);
  assert.strictEqual(draft.parseFriendScores('4 5 3 2 3 4 5 9', players), null);
});

test('moves don’t change the state they were given', () => {
  const s = turnsGame();
  const copy = structuredClone(s);
  move(s, { type: 'bid', by: 'aaron', cents: 100 });
  assert.deepStrictEqual(s, copy);
});

test('notifications say what happened, from each side, without repeating the item', () => {
  let s = turnsGame();
  s.seq = 1;
  const item = catalog.item(s.cur.item).name;
  assert.match(draft.describeMove(s, 'yimei', NAMES, catalog), /Aaron started a draft/);
  assert.strictEqual(draft.describeMove(s, 'aaron', NAMES, catalog), null, 'not for my own move');
  s = move(s, { type: 'bid', by: 'aaron', cents: 350 });
  assert.strictEqual(draft.describeMove(s, 'yimei', NAMES, catalog), `Aaron bid $3.50 on ${item}. Your move.`);
  s = move(s, { type: 'pass', by: 'yimei' });
  // Item two now, opened by Yimei, so Aaron isn't asked to move.
  assert.strictEqual(draft.describeMove(s, 'aaron', NAMES, catalog), `Yimei passed, so you got ${item} for $3.50! 🎉`);
  const second = catalog.item(s.cur.item).name;
  s = move(s, { type: 'pass', by: 'yimei' });
  assert.strictEqual(draft.describeMove(s, 'aaron', NAMES, catalog), `Yimei passed on ${second}. Your move.`);
  s = move(s, { type: 'pass', by: 'aaron' });
  assert.ok(draft.describeMove(s, 'yimei', NAMES, catalog).startsWith(`Aaron passed on ${second}. Nobody wanted ${second}.`));
});

test('a bid nobody can beat says it won, and the result is news even after my own last move', () => {
  let s = turnsGame();
  const item = catalog.item(s.cur.item).name;
  s = move(s, { type: 'bid', by: 'aaron', cents: 2000 });
  assert.ok(draft.describeMove(s, 'yimei', NAMES, catalog).startsWith(`Aaron bid $20.00 on ${item} and got it.`));
  let done = move(atReveal('each'), { type: 'judging', by: 'aaron' });
  done = move(done, { type: 'score', by: 'yimei', sheet: [5, 5, 5, 5] });
  done = move(done, { type: 'score', by: 'aaron', sheet: [3, 3, 3, 3] });
  assert.strictEqual(done.last.by, 'aaron');
  assert.strictEqual(draft.describeMove(done, 'aaron', NAMES, catalog), 'You won the draft! 🏆');
  assert.strictEqual(draft.describeMove(done, 'yimei', NAMES, catalog), 'Aaron won the draft! 🏆');
});

test('myMove knows who is being waited on', () => {
  const s = turnsGame();
  assert.strictEqual(draft.myMove(s, 'aaron'), true);
  assert.strictEqual(draft.myMove(s, 'yimei'), false);
  const inv = draft.newGame({ id: 'g2', at: 1, mode: 'live', judge: 'each', me: 'aaron', partner: 'yimei' }, catalog, seeded());
  assert.strictEqual(draft.myMove(inv, 'yimei'), true);
  assert.strictEqual(draft.myMove(inv, 'aaron'), false);
});

test('a state always fits in one relay message, even at the end of a long-named game', () => {
  const big = [...topics].sort((a, b) => JSON.stringify(b.items.map((i) => i.id)).length - JSON.stringify(a.items.map((i) => i.id)).length)[0];
  let s = turnsGame(big.id);
  assert.ok(JSON.stringify(s).length < 3500, `start: ${JSON.stringify(s).length}`);
  while (s.phase === 'auction') {
    const a = s.cur.turn;
    s = move(s, { type: 'bid', by: a, cents: 50 });
    s = move(s, { type: 'pass', by: draft.other(s, a) });
  }
  s = move(s, { type: 'judging', by: 'aaron' });
  s = move(s, { type: 'score', by: 'aaron', sheet: [3, 3, 3, 3] });
  s = move(s, { type: 'score', by: 'yimei', sheet: [3, 3, 3, 3] });
  assert.ok(JSON.stringify(s).length < 3500, `end: ${JSON.stringify(s).length}`);
});
