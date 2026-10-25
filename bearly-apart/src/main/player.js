// Plays scenes one at a time. If now isn't a good moment (away, asleep, in a meeting, ...), scenes wait in a
// queue that survives restarts; when the person is back, welcome.js turns the pile into a welcome-back sequence.
const { backlogPlan, mergeRepeats, summarize } = require('./welcome');

// More than this many scenes arriving together are treated like a backlog (summary + highlights).
const MAX_IN_A_ROW = 4;
// Scenes whose event is older than this when they're about to play were sent while this computer was off or
// asleep (the relay replays them on reconnect), so they count as "while you were away" too.
const STALE_MS = 10 * 60_000;

class Player {
  // render(req, front) -> Promise that resolves when the scene finishes
  // check() -> Promise<{ ok, reason, front }>
  // onChange(queue): the queue changed (save it); onPlayed(items): these real scenes were shown
  constructor({ render, check, hasScene = () => true, log = () => {}, now = () => Date.now(), debounceMs = 1500, retryMs = 15_000 }) {
    this.render = render;
    this.check = check;
    this.hasScene = hasScene;
    this.log = log;
    this.now = now;
    this.debounceMs = debounceMs;
    this.retryMs = retryMs;
    this.queue = [];
    this.playing = false;
    this.timer = null;
    this.blockedReason = null; // why scenes are waiting right now (shown in the app), or null
    this.heldSince = 0; // when the current backlog first had to wait
    this.onBlocked = null;
    this.onChange = null;
    this.onPlayed = null;
  }

  // Scenes saved by an earlier run (the app was quit while they waited).
  restore(queue, heldSince) {
    if (!queue?.length) return;
    this.queue.push(...queue);
    this.heldSince = heldSince || this.now();
    this.schedule(this.debounceMs);
  }

  changed() {
    this.onChange?.(
      this.queue.filter((i) => !i.preview),
      this.heldSince,
    );
  }

  // Returns a promise of whether it played; queued scenes resolve true when they eventually play.
  play(req) {
    if (req.live) return this.playLive(req);
    this.queue.push(req);
    this.changed();
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
      if (!this.heldSince) {
        this.heldSince = this.now();
        this.changed();
      }
      this.schedule(this.retryMs);
      return;
    }
    if (this.blockedReason) this.onBlocked?.(null);
    this.blockedReason = null;
    const items = this.queue.splice(0);
    const plan = this.planFor(items);
    this.heldSince = 0;
    this.changed();
    await this.run(plan, g.front);
    const shown = items.filter((i) => !i.preview);
    if (shown.length) this.onPlayed?.(shown);
    if (this.queue.length) this.schedule(this.debounceMs);
  }

  // How long these scenes were kept from being seen: waiting here, or sent while this computer was off.
  awayMs(items) {
    const waited = this.heldSince ? this.now() - this.heldSince : 0;
    const oldest = Math.min(...items.filter((i) => i.ev?.at).map((i) => i.ev.at), this.now());
    const offline = this.now() - oldest >= STALE_MS ? this.now() - oldest : 0;
    return Math.max(waited, offline);
  }

  planFor(items) {
    const awayMs = this.awayMs(items);
    const real = items.filter((i) => !i.preview);
    // A single thing after a short wait just plays; a pile, a long absence or a flood gets the welcome sequence.
    if (awayMs && (real.length > 1 || awayMs >= 20 * 60_000)) return backlogPlan(items, { awayMs, hasScene: this.hasScene });
    if (real.length > MAX_IN_A_ROW) return backlogPlan(items, { awayMs: 0, hasScene: this.hasScene });
    return mergeRepeats(items);
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
