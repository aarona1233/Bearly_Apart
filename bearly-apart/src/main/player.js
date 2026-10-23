// Plays scenes one at a time. If now isn't a good moment (asleep, away, in a meeting, ...),
// scenes wait in a queue; a long backlog collapses into one "while you were away" scene.
const SUMMARY_EMOJI = {
  message: '💬', tapback: '💞', kiss: '💋', heart: '💗', hug: '🫂', poke: '👉', 'miss-you': '🥺', note: '💌', jar: '🫙', hello: '👋',
};

function summarize(items) {
  const counts = new Map();
  const statuses = [];
  for (const it of items) {
    const t = it.ev?.type;
    if (t === 'status') statuses.push(it.vars.emoji || '💬');
    else if (t === 'gift') counts.set(it.vars.emoji || '✨', (counts.get(it.vars.emoji || '✨') || 0) + 1);
    else if (t) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const parts = [];
  for (const [t, n] of counts) parts.push(`${SUMMARY_EMOJI[t] || t}${n > 1 ? `×${n}` : ''}`);
  // Only the latest status matters ("hungry" from 4 hours ago is old news).
  if (statuses.length) parts.push(statuses[statuses.length - 1]);
  return parts.join('  ');
}

// More than this many scenes arriving together become one summary scene.
const MAX_IN_A_ROW = 4;

// Five pokes in a row play once, captioned "×5", instead of five times.
function mergeRepeats(items) {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.scene === it.scene && it.scene !== 'note' && !it.preview) {
      last.count = (last.count || 1) + 1;
      last.vars = { ...last.vars, caption: `${last.label || it.label || ''} ×${last.count}`.trim() };
    } else out.push({ ...it });
  }
  return out;
}

class Player {
  // render(req, front) -> Promise that resolves when the scene finishes
  // check() -> Promise<{ ok, reason, front }>
  constructor({ render, check, log = () => {}, debounceMs = 1500, retryMs = 15_000 }) {
    this.render = render;
    this.check = check;
    this.log = log;
    this.debounceMs = debounceMs;
    this.retryMs = retryMs;
    this.queue = [];
    this.playing = false;
    this.timer = null;
    this.blockedReason = null; // why scenes are waiting right now (shown in the app), or null
    this.held = false; // scenes waited at least once since the last play
    this.onBlocked = null;
  }

  // Returns a promise of whether it played; queued scenes resolve true when they eventually play.
  play(req) {
    if (req.live) return this.playLive(req);
    this.queue.push(req);
    this.schedule(this.debounceMs);
    return Promise.resolve(true);
  }

  async playLive(req) {
    if (this.playing || this.queue.length) return false;
    const g = await this.check();
    if (!g.ok) return false;
    await this.run([req], g.front);
    return true;
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pump(), ms);
  }

  async pump() {
    if (this.playing || !this.queue.length) return;
    // Previews are asked for on purpose, so they skip quiet hours, snooze, etc.
    const g = this.queue.every((i) => i.preview) ? { ok: true } : await this.check();
    if (!g.ok) {
      if (g.reason !== this.blockedReason) {
        this.log(`[player] holding ${this.queue.length} scene(s): ${g.reason}`);
        this.blockedReason = g.reason;
        this.onBlocked?.(g.reason);
      }
      this.held = true;
      this.schedule(this.retryMs);
      return;
    }
    if (this.blockedReason) this.onBlocked?.(null);
    this.blockedReason = null;
    const items = this.queue.splice(0);
    const plan = this.held || items.length > MAX_IN_A_ROW ? this.summaryPlan(items, this.held) : mergeRepeats(items);
    this.held = false;
    await this.run(plan, g.front);
    if (this.queue.length) this.schedule(this.debounceMs);
  }

  // After a pause, or a flood, show one scene with a summary caption (plus any notes, which are never dropped).
  summaryPlan(items, held) {
    const real = items.filter((i) => !i.preview);
    if (real.length <= 1) return items;
    const best = real.reduce((a, b) => (b.priority >= a.priority ? b : a)); // latest one wins ties
    const caption = `${held ? 'While you were away' : 'Lots of love incoming'}: ${summarize(real)}`;
    const notes = real.filter((i) => i.scene === 'note' && i !== best);
    return [{ ...best, vars: { ...best.vars, caption } }, ...notes];
  }

  async run(plan, front) {
    this.playing = true;
    try {
      for (const req of plan) {
        this.log(`[player] ▶ ${req.scene}${req.vars?.caption ? ` (${req.vars.caption})` : ''}`);
        await this.render(req, front);
      }
    } catch (err) {
      this.log(`[player] render failed: ${err.message}`);
    } finally {
      this.playing = false;
    }
  }
}

module.exports = { Player, summarize, mergeRepeats };
