// Everything a person can send, with the text shown in the ntfy push / captions.
const STATUSES = {
  hungry: { emoji: '🍔', label: 'is hungry' },
  sleepy: { emoji: '😴', label: 'is sleepy', asleep: true },
  goodnight: { emoji: '🌙', label: 'went to bed', asleep: true },
  thinking: { emoji: '💭', label: 'is thinking about you' },
  sad: { emoji: '🥺', label: 'needs a hug' },
  work: { emoji: '💼', label: 'is at work' },
  class: { emoji: '📚', label: 'is in class' },
  gym: { emoji: '🏋️', label: 'is at the gym' },
  driving: { emoji: '🚗', label: 'is driving' },
  gaming: { emoji: '🎮', label: 'is gaming' },
  eating: { emoji: '🍜', label: 'is eating' },
  sick: { emoji: '🤒', label: 'is feeling sick' },
  busy: { emoji: '⛔', label: 'is busy' },
  free: { emoji: '✨', label: 'is free to talk' },
  home: { emoji: '🏠', label: 'is home' },
  bath: { emoji: '🛁', label: 'is taking a bath' },
};

const SENDABLES = {
  kiss: { emoji: '💋', label: 'sent you a kiss' },
  heart: { emoji: '💗', label: 'sent you a heart' },
  hug: { emoji: '🫂', label: 'is hugging you' },
  poke: { emoji: '👉', label: 'poked you' },
  'miss-you': { emoji: '🥺', label: 'misses you' },
};

function describe(ev, name) {
  if (ev.type === 'status') {
    const s = STATUSES[ev.status] || { emoji: '💬', label: `is ${ev.status}` };
    return `${s.emoji} ${name} ${s.label}`;
  }
  if (ev.type === 'note' || ev.type === 'jar') return ev.text;
  if (ev.type === 'message') return `💬 ${name} texted you`;
  if (ev.type === 'tapback') return `💞 ${name} reacted to your message`;
  if (ev.type === 'hello') return `👋 ${name} paired with you`;
  const s = SENDABLES[ev.type];
  return s ? `${s.emoji} ${name} ${s.label}` : `${name}: ${ev.type}`;
}

module.exports = { STATUSES, SENDABLES, describe };
