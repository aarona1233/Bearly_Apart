// What plays when scenes have piled up: after being away (screen locked, asleep, app closed, quiet hours…) or
// when a flood arrives at once. No Electron in here, so it can be unit-tested.
const SUMMARY_EMOJI = {
  message: '💬', tapback: '💞', kiss: '💋', heart: '💗', hug: '🫂', poke: '👉', 'miss-you': '🥺', note: '💌', jar: '🫙', hello: '👋',
};

const MIN = 60_000;
const HOUR = 60 * MIN;
// Away at least this long (and they sent something) → their bear shows how they felt, before anything else.
const REUNION_AFTER_MS = 20 * MIN;
// At most this many highlights after the summary (love notes are always shown on top of these).
const MAX_HIGHLIGHTS = 4;

// "💋×2  🥰  💌  🍔": counts per kind; only the latest status counts ("hungry" from 4 hours ago is old news).
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
  if (statuses.length) parts.push(statuses[statuses.length - 1]);
  return parts.join('  ');
}

// Five pokes in a row play once, captioned "×5", instead of five times. Love notes are never merged.
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

function reunionScene(awayMs) {
  if (awayMs >= 8 * HOUR) return 'welcome-back-day';
  if (awayMs >= 2 * HOUR) return 'welcome-back-long';
  return 'welcome-back-short';
}

// items: queued scene requests in arrival order. awayMs: how long they waited (0 for a flood while present).
// Returns the scenes to play, in order:
//   1. if away 20+ minutes and they sent something: their bear shows how they felt, then a hug
//   2. one line saying what came in ("While you were away: 💋×2  🥰  💌")
//   3. the highlights: each kind once (latest wins, "×n" when repeated), newest status only, most important first,
//      at most 4, plus every love note
function backlogPlan(items, { awayMs = 0, hasScene = () => true } = {}) {
  const real = items.filter((i) => !i.preview);
  const previews = items.filter((i) => i.preview);
  if (!real.length) return previews;
  const base = real[real.length - 1].vars || {};
  const plan = [];
  const fromThem = real.filter((i) => i.fromPartner);
  if (fromThem.length && awayMs >= REUNION_AFTER_MS && hasScene(reunionScene(awayMs))) {
    plan.push({ scene: reunionScene(awayMs), priority: 9, label: 'welcome back', vars: { ...base, caption: '', hours: Math.max(1, Math.round(awayMs / HOUR)) } });
  }
  if (real.length > 1 && hasScene('away-summary')) {
    const lead = awayMs ? 'While you were away' : 'Lots of love incoming';
    plan.push({ scene: 'away-summary', priority: 9, label: 'summary', vars: { ...base, caption: `${lead}: ${summarize(real)}` } });
  }
  // One per kind, keeping the latest one and counting repeats.
  const byScene = new Map();
  for (const it of real) {
    if (it.scene === 'note') continue;
    const key = it.ev?.type === 'status' ? 'status' : it.scene; // only the newest status
    const prev = byScene.get(key);
    byScene.set(key, { ...it, count: (prev?.count || 0) + 1, firstAt: prev?.firstAt ?? byScene.size });
  }
  const highlights = [...byScene.values()]
    .sort((a, b) => b.priority - a.priority || a.firstAt - b.firstAt)
    .slice(0, MAX_HIGHLIGHTS)
    .sort((a, b) => a.firstAt - b.firstAt)
    .map(({ count, firstAt, ...it }) => (count > 1 ? { ...it, vars: { ...it.vars, caption: `${it.label || ''} ×${count}`.trim() } } : it));
  const notes = real.filter((i) => i.scene === 'note');
  return [...plan, ...highlights, ...notes, ...previews];
}

module.exports = { backlogPlan, summarize, mergeRepeats, reunionScene, REUNION_AFTER_MS };
