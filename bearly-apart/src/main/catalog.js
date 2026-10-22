// Everything a person can send, with the text shown in the ntfy push / captions / the app.
// label: finishes "<name> …" in captions; short: the button text in the app.
const STATUSES = {
  thinking: { emoji: '💭', short: 'Thinking of you', label: 'is thinking about you' },
  free: { emoji: '✨', short: 'Free to talk', label: 'is free to talk' },
  busy: { emoji: '⛔', short: 'Busy', label: 'is busy' },
  work: { emoji: '💼', short: 'At work', label: 'is at work' },
  class: { emoji: '📚', short: 'In class', label: 'is in class' },
  gym: { emoji: '🏋️', short: 'At the gym', label: 'is at the gym' },
  driving: { emoji: '🚗', short: 'Driving', label: 'is driving' },
  eating: { emoji: '🍜', short: 'Eating', label: 'is eating' },
  hungry: { emoji: '🍔', short: 'Hungry', label: 'is hungry' },
  gaming: { emoji: '🎮', short: 'Gaming', label: 'is gaming' },
  home: { emoji: '🏠', short: 'Home', label: 'is home' },
  bath: { emoji: '🛁', short: 'Bath time', label: 'is taking a bath' },
  sad: { emoji: '🥺', short: 'Need a hug', label: 'needs a hug' },
  sick: { emoji: '🤒', short: 'Sick', label: 'is feeling sick' },
  sleepy: { emoji: '😴', short: 'Sleepy', label: 'is sleepy', asleep: true },
  goodnight: { emoji: '🌙', short: 'Going to bed', label: 'went to bed', asleep: true },
};

const SENDABLES = {
  kiss: { emoji: '💋', short: 'Kiss', label: 'sent you a kiss' },
  heart: { emoji: '💗', short: 'Heart', label: 'sent you a heart' },
  hug: { emoji: '🫂', short: 'Hug', label: 'is hugging you' },
  poke: { emoji: '👉', short: 'Poke', label: 'poked you' },
  'miss-you': { emoji: '🥺', short: 'Miss you', label: 'misses you' },
};

// Friendly names for the Animations tab: what it's called and when it plays.
const SCENES = {
  kiss: ['Kiss', 'The 💋 button, or a text with "kiss", "mwah" or 😘'],
  hug: ['Hug', 'The 🫂 button, a text with "hug", or both sending 💗 within 20 seconds'],
  heart: ['Heart', 'The 💗 button'],
  poke: ['Poke', 'The 👉 button, or clicking one of their bears'],
  'miss-you': ['Miss you', 'The 🥺 button'],
  'kw-miss-you': ['"Miss you" text', 'A text that says "miss you" or 🥺'],
  message: ['Text', 'Any other text (at most once every 90 seconds)'],
  combo: ['Text flurry', '5 texts in 90 seconds'],
  'tapback-love': ['Heart reaction', 'A ❤️ reaction on a message'],
  note: ['Love note', 'A love note arrives'],
  jar: ['Note for the morning', 'A note saved for the next morning'],
  'good-morning': ['Good morning', 'First time at the computer each day (brings a saved note)'],
  countdown: ['Visit countdown', 'Mornings 30, 14, 7, 3 and 1 days before a visit, and the day itself'],
  hello: ['Paired!', 'When the two apps first connect'],
  'missing-peek': ['Missing you: peek', 'No texts for 3 hours'],
  'missing-sword': ['Missing you: sword', 'No texts for 6 hours'],
  'missing-poster': ['Missing you: poster', 'No texts for 12 hours'],
  status: ['Status', 'A status without its own animation'],
};

function sceneInfo(name) {
  if (SCENES[name]) return { name, title: SCENES[name][0], when: SCENES[name][1] };
  const st = name.startsWith('status-') && STATUSES[name.slice(7)];
  if (st) return { name, title: `Status: ${st.short}`, when: `They set ${st.emoji} ${st.short}` };
  return { name, title: name, when: 'Your own scene' };
}

function describe(ev, name) {
  if (ev.type === 'status') {
    if (ev.status === 'clear') return `${name} cleared their status`;
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

module.exports = { STATUSES, SENDABLES, SCENES, sceneInfo, describe };
