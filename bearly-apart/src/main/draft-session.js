// Keeps this computer's copy of the draft game in step with the other computers, over the relay.
//
// A move makes the next state (seq + 1) and publishes it; nothing changes here until it comes back from the relay.
// Every computer sees the relay's messages in the same order, so whichever state for a seq arrives first is the one
// everybody keeps, and a move that lost the race is simply dropped. A person's other computers follow along the same way.
//
// ntfy only keeps messages for about 12 hours, and a take-turns game can sit for days. So a state carries the whole
// game, and a computer that comes back online asks ("ask"); anyone further along answers with their state ("resend").
// No Electron here.
const draft = require('./draft');

const PENDING_TIMEOUT_MS = 8000;
const ASK_EVERY_ACTIVE_MS = 10 * 60_000;
const ASK_EVERY_IDLE_MS = 60 * 60_000;
const LIVE_NOTE_GAP_MS = 5000;
const FEED_LENGTH = 30;
const MAX_MESSAGE = 3800; // ntfy.sh turns anything over 4 KB into an attachment
const AI_RETRY_MS = 60_000;

const ACTIVE = new Set(['invite', 'pick', 'context', 'auction', 'reveal', 'judging']);

class DraftSession {
  constructor({ catalog, config, publish, load, save, notify = () => {}, onChange = () => {}, askAi = null, device = '', rand = Math.random, now = () => Date.now(), timers = { set: setTimeout, clear: clearTimeout }, log = () => {} }) {
    Object.assign(this, { catalog, config, publish, save, notify, onChange, askAi, device, rand, now, timers, log });
    const saved = load() || {};
    this.state = saved.state || null;
    this.feed = saved.feed || [];
    this.settings = saved.settings || { mode: 'turns', timerSec: 20, allowPass: false, judge: 'each' };
    this.deadlineAt = saved.deadlineAt || 0;
    this.pending = false;
    this.pendingTimer = null;
    this.clock = null;
    this.lastAskAt = 0;
    this.lastLiveNoteAt = 0;
    this.answerTimer = null;
    this.aiStatus = ''; // '', 'thinking', or 'none' (no Ollama on this computer, or it gave no usable answer)
    this.aiTimer = null;
    this.armClock();
    this.runAiJudge();
  }

  me() {
    return this.config().me.id;
  }

  names() {
    const c = this.config();
    return { [c.me.id]: c.me.name || 'You', [c.partner.id]: c.partner.name || 'Your love' };
  }

  persist() {
    this.save({ state: this.state, feed: this.feed, settings: this.settings, deadlineAt: this.deadlineAt });
  }

  active() {
    return !!this.state && ACTIVE.has(this.state.phase);
  }

  isMyMove() {
    return draft.myMove(this.state, this.me());
  }

  // ---- starting a game ------------------------------------------------------

  async start(options = {}) {
    const c = this.config();
    if (!c.partner.id || !c.me.id) return { ok: false, error: 'Connect to your person first.' };
    if (this.active() && !this.state.local && !options.replace) return { ok: false, error: 'There’s already a game going.' };
    if (!options.rematch) this.settings = { ...this.settings, ...options.settings };
    const game = draft.newGame(
      { ...this.settings, id: `${this.now().toString(36)}${Math.floor(this.rand() * 1296).toString(36)}`, at: this.now(), me: c.me.id, partner: c.partner.id, rematch: !!options.rematch },
      this.catalog,
      this.rand,
    );
    if (game.local) return this.accept(game);
    game.seq = 1;
    return this.send(game);
  }

  // ---- moves ------------------------------------------------------------------

  // A move by this person (or, for 'time' and 'ai', by nobody in particular).
  saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this.persist();
    this.onChange();
  }

  // Back to the start screen on this computer (a finished or ended game only).
  clear() {
    if (this.active() && !this.state.local) return { ok: false, error: 'There’s still a game going.' };
    this.state = null;
    this.feed = [];
    this.persist();
    this.onChange();
    return { ok: true };
  }

  async act(action) {
    const cur = this.state;
    if (!cur) return { ok: false, error: 'There’s no game going.' };
    if (this.pending) return { ok: false, error: 'Still sending your last move…' };
    const by = this.me();
    const leftMs = action.type === 'bid' ? Math.max(0, this.deadlineAt - this.now()) : undefined;
    const next = draft.apply(cur, { ...action, by, leftMs }, this.catalog, this.rand);
    if (next.error) return { ok: false, error: next.error };
    if (cur.local && next.phase !== 'auction') {
      // Still setting up: this stays on this computer (next.local was cleared by apply).
      return this.accept({ ...next, local: true, seq: 0 });
    }
    next.seq = cur.seq + 1;
    return this.send(next);
  }

  async send(next, status = 'state') {
    const text = JSON.stringify(next);
    if (text.length > MAX_MESSAGE) {
      this.log(`[draft] state too big to send (${text.length} bytes)`);
      return { ok: false, error: 'That game got too big to send.' };
    }
    this.setPending(true);
    try {
      await this.publish(status, text);
      return { ok: true };
    } catch (err) {
      this.setPending(false);
      this.log(`[draft] send failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // Waiting for my move to come back. If it never does the connection is down; the relay catches up when it reconnects.
  setPending(on) {
    this.pending = on;
    this.timers.clear(this.pendingTimer);
    if (on) this.pendingTimer = this.timers.set(() => this.setPending(false), PENDING_TIMEOUT_MS);
    this.onChange();
  }

  // ---- what arrives from the relay --------------------------------------------

  onEvent(ev) {
    const mine = ev.from === this.me();
    let body;
    try {
      body = JSON.parse(ev.text);
    } catch {
      return this.log('[draft] unreadable message');
    }
    if (ev.status === 'ask') return mine && ev.device === this.device ? undefined : this.onAsk(body);
    return this.adopt(body, ev);
  }

  adopt(s, ev) {
    if (!s || s.v !== 1 || !s.id || !Array.isArray(s.players) || !s.players.includes(this.me())) return;
    const cur = this.state;
    if (cur && cur.id === s.id && !cur.local) {
      if (s.seq < cur.seq) return;
      if (s.seq === cur.seq) {
        // Two copies of the same move disagree (only after a very unlucky reconnect): everyone settles on the same one.
        if (ev.status === 'resend' && JSON.stringify(s) < JSON.stringify(cur)) this.accept(s);
        return;
      }
    } else if (cur && cur.id !== s.id && !cur.local && s.at < cur.at) {
      return; // an older game than the one here
    }
    const fromMe = ev.from === this.me();
    this.setPendingQuietly(false);
    this.accept(s);
    if (ev.status === 'resend' && fromMe) return;
    this.tellAboutMove(s);
  }

  setPendingQuietly(on) {
    this.pending = on;
    this.timers.clear(this.pendingTimer);
  }

  accept(s) {
    const before = this.state;
    this.state = s;
    this.addToFeed(s, before);
    if (s.mode === 'live' && s.phase === 'auction' && s.cur) {
      // Each computer counts down on its own clock, so a wrong clock can't end an item early.
      if (!before || before.seq !== s.seq) this.deadlineAt = this.now() + s.cur.ms;
    } else {
      this.deadlineAt = 0;
    }
    this.armClock();
    this.persist();
    this.onChange();
    this.runAiJudge();
    return { ok: true };
  }

  // The AI judge lives on whichever computer runs Ollama, so a computer without it keeps trying in case that changes,
  // and any computer with it can answer for the game.
  async runAiJudge() {
    const s = this.state;
    if (!this.askAi || s?.phase !== 'judging' || s.judge !== 'ai' || this.aiStatus === 'thinking') return;
    this.timers.clear(this.aiTimer);
    this.aiStatus = 'thinking';
    this.onChange();
    const sheets = await this.askAi(s);
    this.aiStatus = '';
    const stillWaiting = this.state?.id === s.id && this.state.phase === 'judging' && this.state.judge === 'ai';
    if (!stillWaiting) return this.onChange();
    const sent = sheets ? await this.act({ type: 'ai', sheets }) : { ok: false };
    if (!sent.ok) {
      this.aiStatus = 'none';
      this.aiTimer = this.timers.set(() => this.runAiJudge(), AI_RETRY_MS);
    }
    this.onChange();
  }

  addToFeed(s, before) {
    if (s.local || (before?.id === s.id && before.seq === s.seq)) return;
    if (before?.id !== s.id) this.feed = [];
    const line = feedLine(s, this.me(), this.names(), this.catalog);
    if (line) this.feed = [...this.feed, { text: line, at: this.now() }].slice(-FEED_LENGTH);
  }

  tellAboutMove(s) {
    const body = draft.describeMove(s, this.me(), this.names(), this.catalog);
    if (!body) return;
    // A live game can move faster than anyone wants pop-ups: at most one every few seconds, unless the game is over.
    if (s.mode === 'live' && s.phase === 'auction') {
      if (this.now() - this.lastLiveNoteAt < LIVE_NOTE_GAP_MS) return;
      this.lastLiveNoteAt = this.now();
    }
    this.notify(body);
  }

  // ---- catching up ------------------------------------------------------------

  // The relay is (back) up: tell everyone where this computer is, so anyone further along can answer.
  onConnected() {
    const gap = this.active() ? ASK_EVERY_ACTIVE_MS : ASK_EVERY_IDLE_MS;
    if (!this.config().partner.id || this.now() - this.lastAskAt < gap) return;
    this.sendAsk();
  }

  sendAsk() {
    this.lastAskAt = this.now();
    const shown = this.state && !this.state.local ? this.state : null;
    return this.publish('ask', JSON.stringify({ id: shown?.id || null, at: shown?.at || 0, seq: shown?.seq || 0 })).catch((err) => this.log(`[draft] ask failed: ${err.message}`));
  }

  onAsk(them) {
    const s = this.state;
    if (!s || s.local) return;
    const sameGame = them.id === s.id;
    const iAmAhead = sameGame ? s.seq > them.seq : s.at > them.at && ACTIVE.has(s.phase);
    if (iAmAhead) {
      // Answer after a moment: another computer may answer first, and only one copy is needed.
      this.timers.clear(this.answerTimer);
      this.answerTimer = this.timers.set(() => this.publish('resend', JSON.stringify(this.state)).catch((err) => this.log(`[draft] resend failed: ${err.message}`)), 300 + this.rand() * 1200);
      return;
    }
    // They're further along than this computer: ask them (they only just came online, so they missed nothing).
    const theyAreAhead = sameGame ? them.seq > s.seq : them.at > s.at;
    if (theyAreAhead && this.now() - this.lastAskAt > 60_000) this.sendAsk();
  }

  // ---- the live timer ---------------------------------------------------------

  armClock() {
    this.timers.clear(this.clock);
    this.clock = null;
    const s = this.state;
    if (!s || s.mode !== 'live' || s.phase !== 'auction' || !s.cur || !this.deadlineAt) return;
    // Both computers call time, a moment apart, so usually only one has to send it.
    const wait = Math.max(0, this.deadlineAt - this.now()) + this.rand() * 1000;
    this.clock = this.timers.set(() => this.callTime(s.cur.item), wait);
  }

  async callTime(item) {
    if (this.state?.cur?.item !== item) return;
    const r = await this.act({ type: 'time', item });
    // Not sent (no connection, or my own move is on its way): try again shortly.
    if (!r.ok && this.state?.cur?.item === item) this.clock = this.timers.set(() => this.callTime(item), 3000);
  }

  // ---- what the window shows ----------------------------------------------------

  view() {
    const s = this.state;
    const me = this.me();
    const out = { settings: this.settings, pending: this.pending, feed: this.feed, me, myMove: this.isMyMove(), aiStatus: this.aiStatus, game: null };
    if (!s) return out;
    const partner = draft.other(s, me);
    const item = (id) => {
      const i = this.catalog.item(id);
      return i ? { id, name: i.name, flavor: i.flavorText, tier: i.tier, slot: i.slotId, modifier: !!i.isModifier } : { id, name: 'Unknown item', flavor: '', tier: 'mid', slot: '' };
    };
    const topic = s.topic ? this.catalog.topic(s.topic) : null;
    const seat = (id) => ({
      id,
      budget: s.bud[id],
      won: s.won[id].map(([itemId, cents]) => ({ ...item(itemId), cents })),
      scoredByMe: !!s.scores[id]?.[me],
    });
    out.game = {
      id: s.id,
      seq: s.seq,
      local: !!s.local,
      phase: s.phase,
      mode: s.mode,
      timer: s.timer,
      allowPass: s.allowPass,
      judge: s.judge,
      startedByMe: s.players[0] === me,
      players: s.players,
      topic: topic && { id: topic.id, title: topic.title, category: topic.category, reveal: topic.reveal, slots: topic.slots, contexts: topic.contexts?.map((c) => c.label) || draft.FALLBACK_CONTEXTS, authored: !!topic.contexts?.length },
      ctx: s.ctx,
      total: s.total,
      left: s.queue.length,
      cur: s.cur && { item: item(s.cur.item), bid: s.cur.bid, lead: s.cur.lead, passed: s.cur.passed, turn: s.cur.turn, leftMs: this.deadlineAt ? Math.max(0, this.deadlineAt - this.now()) : null },
      me: seat(me),
      them: seat(partner),
      gone: s.gone.map(item),
      last: s.last,
      iScored: !!s.scores[partner]?.[me],
      theyScored: !!s.scores[me]?.[partner],
      results: draft.results(s),
    };
    return out;
  }
}

// The line in the game's "moves so far" list: what just happened, from this person's side.
function feedLine(s, me, names, catalog) {
  const { last } = s;
  if (!last) return '';
  const who = last.by === me ? 'You' : names[last.by] || 'They';
  const itemName = (id) => catalog.item(id)?.name || 'an item';
  const person = (id) => (id === me ? 'You' : names[id] || 'They');
  const parts = [];
  if (last.act === 'bid') parts.push(`${who} bid ${draft.money(last.cents)} on ${itemName(last.item)}`);
  else if (last.act === 'pass') parts.push(`${who} passed on ${itemName(last.item)}`);
  else if (last.act === 'context') parts.push(`${who} started: ${catalog.topic(s.topic)?.title}${s.ctx ? ` (${s.ctx})` : ''}`);
  else if (last.act === 'to-turns') parts.push(`${who} switched to taking turns`);
  if (last.won) parts.push(`${person(last.won.who)} got ${itemName(last.won.item)} for ${draft.money(last.won.cents)}`);
  if (last.gone) parts.push(`Nobody wanted ${itemName(last.gone)}`);
  if (last.toTurns) parts.push('Nobody was bidding, so it’s taking turns now');
  return parts.join(' · ');
}

module.exports = { DraftSession, feedLine };
