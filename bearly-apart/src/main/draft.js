// The draft game's rules: two bears bid on items and build the best "X" out of what they win. A game is one small
// JSON state; a move turns it into the next state. Both apps hold the same state and swap new ones over the relay
// (see draft-session.js). No Electron here.

const BUDGET_CENTS = 2000;
const MIN_OPEN_BID_CENTS = 50;
const ITEMS_PER_ROUND = 12;
const CONTEXT_ITEM_SHARE = 0.65;
const ANTI_SNIPE_MS = 8000;
const DEFAULT_TIMER_SEC = 20;
const MIN_TIMER_SEC = 5;
const MAX_TIMER_SEC = 60;
// A live game where two items in a row get no bid and no pass: nobody's there, so it becomes a take-turns game.
const IDLE_ITEMS_LIMIT = 2;

const RUBRIC = [
  { id: 'topicFit', label: 'Topic Fit' },
  { id: 'cohesion', label: 'Cohesion' },
  { id: 'creativity', label: 'Creativity' },
  { id: 'valueForMoney', label: 'Value for Money' },
];

// For topics with no settings of their own. These don't change which items come up.
const FALLBACK_CONTEXTS = ['Money is no object', 'A tight, scrappy budget', 'For a big celebration', 'A rainy, do-nothing Tuesday'];

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

class Catalog {
  constructor(topics) {
    this.topics = topics;
    this.byId = new Map(topics.map((t) => [t.id, t]));
    this.items = new Map(topics.flatMap((t) => t.items.map((i) => [i.id, i])));
  }
  topic(id) {
    return this.byId.get(id);
  }
  item(id) {
    return this.items.get(id);
  }
  // One random topic, not the one just showing.
  pick(rand, excludeId) {
    const pool = this.topics.filter((t) => t.id !== excludeId);
    return pool[Math.floor(rand() * pool.length)];
  }
}

// The items a round auctions, in random order. For a setting the topic has its own items for, most of the round comes
// from those ("Backyard BBQ" gets smash burgers) and the rest from the pack's fits-anywhere items.
function pickRoundItems(topic, label, rand, count = ITEMS_PER_ROUND) {
  const ctx = label ? topic.contexts?.find((c) => c.label === label) : null;
  if (!ctx) return shuffle(topic.items, rand).slice(0, count);
  const own = shuffle(topic.items.filter((i) => i.contexts?.includes(ctx.id)), rand);
  const anywhere = shuffle(topic.items.filter((i) => !i.contexts?.length), rand);
  const ownTarget = Math.min(own.length, Math.ceil(count * CONTEXT_ITEM_SHARE));
  const picked = [...own.slice(0, ownTarget), ...anywhere.slice(0, count - ownTarget)];
  // A thin setting still has to fill a round: first its other items, then whatever else the pack has.
  if (picked.length < count) picked.push(...own.slice(ownTarget, ownTarget + count - picked.length));
  if (picked.length < count) {
    const have = new Set(picked.map((i) => i.id));
    picked.push(...shuffle(topic.items.filter((i) => !have.has(i.id)), rand).slice(0, count - picked.length));
  }
  return shuffle(picked, rand);
}

function bidProblem(cents, currentCents, budgetCents) {
  if (!Number.isInteger(cents) || cents <= 0) return 'That isn’t a bid.';
  if (cents <= currentCents) return 'A bid has to be higher than the current one.';
  if (currentCents === 0 && cents < MIN_OPEN_BID_CENTS) return `The first bid has to be at least ${money(MIN_OPEN_BID_CENTS)}.`;
  if (cents > budgetCents) return 'You can’t afford that bid.';
  return null;
}

const other = (s, id) => s.players.find((p) => p !== id);
const canBid = (s, id) => !bidProblem(Math.max(s.cur.bid + 1, MIN_OPEN_BID_CENTS), s.cur.bid, s.bud[id]);

// A new game. players[0] is whoever started it. Take-turns games are set up on the starter's computer (`local`: nothing
// is sent until the topic and setting are picked); a live game starts as an invite, with both bears in the room.
function newGame({ id, at, mode, timerSec = DEFAULT_TIMER_SEC, allowPass = false, judge = 'each', me, partner, rematch = false }, catalog, rand = Math.random) {
  const live = mode === 'live';
  const s = {
    v: 1,
    id,
    at,
    seq: 0,
    mode: live ? 'live' : 'turns',
    timer: Math.round(Math.min(MAX_TIMER_SEC, Math.max(MIN_TIMER_SEC, Number(timerSec) || DEFAULT_TIMER_SEC))),
    allowPass: !!allowPass,
    judge,
    players: [me, partner],
    starter: me,
    phase: live && !rematch ? 'invite' : 'pick',
    topic: null,
    ctx: null,
    queue: [],
    total: 0,
    cur: null,
    idle: 0,
    bud: { [me]: BUDGET_CENTS, [partner]: BUDGET_CENTS },
    won: { [me]: [], [partner]: [] },
    gone: [],
    scores: {},
    last: { by: me, act: live ? (rematch ? 'rematch' : 'invite') : 'setup' },
  };
  if (!live) s.local = true;
  if (s.phase === 'pick') s.topic = catalog.pick(rand).id;
  return s;
}

function nextItem(s) {
  const item = s.queue.shift();
  if (!item) {
    s.cur = null;
    s.phase = 'reveal';
    return;
  }
  const live = s.mode === 'live';
  s.cur = { item, bid: 0, lead: null, passed: [], turn: live ? null : s.starter, ms: live ? s.timer * 1000 : null };
  if (!live) s.starter = other(s, s.starter);
  autoPass(s);
}

// A bear with no bid they can afford just passes: no point sending a turn across the world to press one button.
function autoPass(s) {
  while (s.cur && s.mode === 'turns' && !canBid(s, s.cur.turn)) {
    const who = s.cur.turn;
    s.cur.passed = [...s.cur.passed, who];
    s.cur.turn = other(s, who);
    s.last.broke = who;
    if (settleItem(s)) return;
  }
}

// The item is decided once the other bear has passed on a leader, or both have passed. Returns true if it was.
function settleItem(s) {
  const { cur } = s;
  const decided = cur.lead ? cur.passed.length >= 1 : cur.passed.length >= 2;
  if (decided) closeItem(s);
  return decided;
}

function closeItem(s) {
  const { cur } = s;
  if (cur.lead) {
    s.bud[cur.lead] -= cur.bid;
    s.won[cur.lead] = [...s.won[cur.lead], [cur.item, cur.bid]];
    s.last.won = { who: cur.lead, item: cur.item, cents: cur.bid };
  } else {
    s.gone = [...s.gone, cur.item];
    s.last.gone = cur.item;
  }
  nextItem(s);
}

// Turns a live game into a take-turns one, from the current item on.
function goToTurns(s) {
  s.mode = 'turns';
  s.idle = 0;
  if (s.cur) {
    s.cur.ms = null;
    const waiting = s.cur.lead ? other(s, s.cur.lead) : s.starter;
    s.cur.turn = s.cur.passed.includes(waiting) ? other(s, waiting) : waiting;
    autoPass(s);
  }
}

// Totals over the four categories (out of 20) once every build is scored; null until then.
function results(s) {
  if (s.phase !== 'results') return null;
  const rows = s.players.map((id) => {
    const sheets = Object.values(s.scores[id] || {});
    const categories = RUBRIC.map((_, i) => (sheets.length ? sheets.reduce((sum, sheet) => sum + (sheet[i] || 0), 0) / sheets.length : 0));
    return { id, categories, total: categories.reduce((a, b) => a + b, 0), spent: s.won[id].reduce((sum, [, cents]) => sum + cents, 0) };
  });
  const [a, b] = rows;
  return { rows, winner: a.total === b.total ? null : a.total > b.total ? a.id : b.id };
}

function allScored(s) {
  if (s.judge === 'each') return s.players.every((id) => s.scores[id]?.[other(s, id)]);
  return s.players.every((id) => s.scores[id]?.[s.judge]);
}

const validSheet = (sheet) => Array.isArray(sheet) && sheet.length === RUBRIC.length && sheet.every((n) => Number.isInteger(n) && n >= 1 && n <= 5);

// A move. Returns the next state, or { error } if it can't be done. `by` is a player's id. rand only matters for moves
// that draw something new.
function apply(state, action, catalog, rand = Math.random) {
  const s = structuredClone(state);
  const { type, by } = action;
  const fail = (error) => ({ error });
  if (type !== 'time' && type !== 'ai' && !s.players.includes(by)) return fail('You aren’t in this game.');
  s.last = { by, act: type };

  switch (type) {
    case 'accept':
      if (s.phase !== 'invite') return fail('This game has already started.');
      s.phase = 'pick';
      s.topic = catalog.pick(rand).id;
      break;
    case 'skip':
      if (s.phase !== 'pick') return fail('The topic is already picked.');
      s.topic = catalog.pick(rand, s.topic).id;
      break;
    case 'topic':
      if (s.phase !== 'pick') return fail('The topic is already picked.');
      s.phase = 'context';
      break;
    case 'context': {
      if (s.phase !== 'context') return fail('The setting is already picked.');
      const topic = catalog.topic(s.topic);
      if (topic.contexts?.length) {
        // A topic with settings of its own always has one: not picking means "surprise us".
        const known = topic.contexts.find((c) => c.label === action.label);
        s.ctx = (known || topic.contexts[Math.floor(rand() * topic.contexts.length)]).label;
      } else {
        s.ctx = action.label ? String(action.label).slice(0, 80) : null;
      }
      s.queue = pickRoundItems(topic, s.ctx, rand).map((i) => i.id);
      s.total = s.queue.length;
      s.phase = 'auction';
      s.starter = s.players[0];
      nextItem(s);
      break;
    }
    case 'bid': {
      if (s.phase !== 'auction' || !s.cur) return fail('Nothing’s up for bids right now.');
      const { cur } = s;
      if (action.item && action.item !== cur.item) return fail('That item is gone.');
      if (cur.passed.includes(by)) return fail('You passed on this one.');
      if (cur.lead === by) return fail('You’re already in the lead.');
      if (s.mode === 'turns' && cur.turn !== by) return fail('It isn’t your turn.');
      const problem = bidProblem(action.cents, cur.bid, s.bud[by]);
      if (problem) return fail(problem);
      s.last.item = cur.item;
      s.last.cents = action.cents;
      cur.bid = action.cents;
      cur.lead = by;
      s.idle = 0;
      if (s.mode === 'turns') cur.turn = other(s, by);
      // A late bid buys a little more time, so nobody wins by sniping.
      else cur.ms = Math.max(Number(action.leftMs) || 0, Math.min(ANTI_SNIPE_MS, s.timer * 1000));
      // If the other bear already passed, nobody's left to outbid.
      if (!settleItem(s) && s.mode === 'turns') autoPass(s);
      break;
    }
    case 'pass': {
      if (s.phase !== 'auction' || !s.cur) return fail('Nothing’s up for bids right now.');
      const { cur } = s;
      if (action.item && action.item !== cur.item) return fail('That item is gone.');
      if (cur.passed.includes(by)) return fail('You already passed.');
      if (cur.lead === by) return fail('You’re in the lead.');
      if (s.mode === 'live' && !s.allowPass) return fail('Passing is off in this game.');
      if (s.mode === 'turns' && cur.turn !== by) return fail('It isn’t your turn.');
      s.last.item = cur.item;
      cur.passed = [...cur.passed, by];
      s.idle = 0;
      if (s.mode === 'turns') cur.turn = other(s, by);
      if (!settleItem(s) && s.mode === 'turns') autoPass(s);
      break;
    }
    case 'time': {
      // Either app can call time; whichever reaches the relay first counts, and the other's no longer matches.
      if (s.phase !== 'auction' || s.mode !== 'live' || s.cur?.item !== action.item) return fail('Too late.');
      s.last = { act: 'time', item: s.cur.item };
      s.idle = s.cur.lead ? 0 : s.idle + 1;
      closeItem(s);
      if (s.idle >= IDLE_ITEMS_LIMIT && s.phase === 'auction') {
        s.last.toTurns = true;
        goToTurns(s);
      }
      break;
    }
    case 'to-turns':
      if (s.mode !== 'live') return fail('This game already takes turns.');
      goToTurns(s);
      break;
    case 'judging':
      if (s.phase !== 'reveal') return fail('The builds aren’t ready.');
      s.phase = 'judging';
      break;
    case 'score': {
      if (s.phase !== 'judging' || s.judge !== 'each') return fail('It isn’t time to score.');
      const target = other(s, by);
      if (s.scores[target]?.[by]) return fail('You already scored this build.');
      if (!validSheet(action.sheet)) return fail('Score every category from 1 to 5.');
      s.scores[target] = { ...s.scores[target], [by]: action.sheet };
      break;
    }
    case 'ai':
    case 'friend': {
      // sheets: { <player id>: [four scores] }, from the AI judge or a friend's reply.
      if (s.phase !== 'judging' || s.judge !== type) return fail('It isn’t time for that.');
      if (!s.players.every((id) => validSheet(action.sheets?.[id]))) return fail('That needs four scores from 1 to 5 for each build.');
      for (const id of s.players) s.scores[id] = { [type]: action.sheets[id] };
      break;
    }
    case 'judge-each':
      if (s.phase !== 'judging') return fail('It isn’t time to score.');
      s.judge = 'each';
      s.scores = {};
      break;
    case 'abandon':
      s.phase = 'over';
      s.cur = null;
      break;
    default:
      return fail(`Unknown move ${type}.`);
  }
  if (s.phase === 'judging' && allScored(s)) s.phase = 'results';
  delete s.local;
  return s;
}

// What just happened, for a notification: a sentence or two from this player's point of view. Null for their own
// move, except the end of the game: the last move may be theirs, but who won is news (and the AI judge might have
// answered from their other computer).
function describeMove(s, me, names, catalog) {
  const { last } = s;
  if (!last || (last.by === me && s.phase !== 'results')) return null;
  const them = names[other(s, me)] || 'They';
  const itemName = (id) => catalog.item(id)?.name || 'an item';
  const { won } = last;
  const parts = [];
  if (last.by !== me) {
    if (last.act === 'invite') parts.push(`${them} wants to draft live. Open the Draft tab to join!`);
    else if (last.act === 'rematch') parts.push(`${them} wants a rematch!`);
    else if (last.act === 'accept') parts.push(`${them} is in! Pick a topic together.`);
    else if (last.act === 'abandon') return `${them} ended the draft.`;
    else if (last.act === 'context' && s.seq === 1) parts.push(`${them} started a draft: ${catalog.topic(s.topic)?.title}${s.ctx ? ` (${s.ctx})` : ''}.`);
    else if (last.act === 'to-turns') parts.push(`${them} switched the game to taking turns.`);
    else if (last.act === 'bid' && won?.item === last.item) parts.push(`${them} bid ${money(last.cents)} on ${itemName(last.item)} and got it.`);
    else if (last.act === 'bid') parts.push(`${them} bid ${money(last.cents)} on ${itemName(last.item)}.`);
    else if (last.act === 'pass' && won?.who === me && won.item === last.item) parts.push(`${them} passed, so you got ${itemName(won.item)} for ${money(won.cents)}! 🎉`);
    else if (last.act === 'pass') parts.push(`${them} passed on ${itemName(last.item)}.`);
  }
  const told = won && won.item === last.item && ['bid', 'pass'].includes(last.act);
  if (won && !told) parts.push(won.who === me ? `You got ${itemName(won.item)} for ${money(won.cents)}! 🎉` : `${them} got ${itemName(won.item)} for ${money(won.cents)}.`);
  if (last.gone) parts.push(`Nobody wanted ${itemName(last.gone)}.`);
  if (last.toTurns) parts.push('Nobody was bidding, so the game now takes turns.');
  if (s.phase === 'reveal' && parts.length) parts.push('That was the last item. Time to see the builds!');
  if (s.phase === 'judging' && last.act === 'judging') parts.push(s.judge === 'each' ? `${them} opened judging. Score their build!` : `${them} opened judging.`);
  if (s.phase === 'judging' && last.act === 'score') parts.push(`${them} scored your build. Your turn to score theirs!`);
  if (s.phase === 'results') {
    const r = results(s);
    parts.push(!r.winner ? 'The draft is a tie!' : r.winner === me ? 'You won the draft! 🏆' : `${them} won the draft! 🏆`);
  }
  if (s.phase === 'auction' && s.mode === 'turns' && s.cur.turn === me) parts.push(s.cur.item === last.item ? 'Your move.' : `Your move on ${itemName(s.cur.item)}.`);
  return parts.join(' ') || null;
}

// Is this player being waited on?
function myMove(s, me) {
  if (!s || s.local) return false;
  if (s.phase === 'invite') return s.players[0] !== me;
  if (s.phase === 'auction') return s.mode === 'turns' && s.cur?.turn === me;
  if (s.phase === 'reveal') return true;
  if (s.phase === 'judging' && s.judge === 'each') return !s.scores[other(s, me)]?.[me];
  return false;
}

// A friend's reply: eight numbers from 1 to 5, four for each build in the order the judge file showed them. If they
// retyped it with the names the other way round, the names win.
function parseFriendScores(text, players, names = {}) {
  const words = String(text || '');
  const numbers = words.match(/\b[1-5]\b/g)?.map(Number) || [];
  if (numbers.length !== 2 * RUBRIC.length) return null;
  const at = players.map((id) => (names[id] ? words.toLowerCase().indexOf(String(names[id]).toLowerCase()) : -1));
  const [first, second] = at[0] >= 0 && at[1] >= 0 && at[1] < at[0] ? [players[1], players[0]] : players;
  return { [first]: numbers.slice(0, RUBRIC.length), [second]: numbers.slice(RUBRIC.length) };
}

module.exports = {
  BUDGET_CENTS,
  MIN_OPEN_BID_CENTS,
  ITEMS_PER_ROUND,
  RUBRIC,
  FALLBACK_CONTEXTS,
  Catalog,
  money,
  newGame,
  apply,
  results,
  other,
  describeMove,
  myMove,
  pickRoundItems,
  parseFriendScores,
};
