// The Draft tab. The game itself runs in the main process (main/draft-session.js); this draws whatever view it sends
// and passes moves back. It redraws only when the game changes, so a half-typed bid survives other updates.
let draftView = null;
let draftKey = '';
const dl = {
  bid: null, // the bid being set up in a take-turns game
  bidFor: '',
  sheet: [3, 3, 3, 3], // the scores being set up
  sheetFor: '',
  friendText: '',
  feedOpen: false,
  customOpen: false,
  prev: null, // the last game drawn, to spot what just changed
  seatBears: {}, // each seat's picture, kept between redraws so an animation carries on instead of restarting
  wheelDone: {},
  deadlineAt: 0,
};

const RUBRIC_LABELS = ['Topic Fit', 'Cohesion', 'Creativity', 'Value for Money'];
const BEAR_NAMES = { brown: 'Dudu', cream: 'Bubu' };
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const nameOf = (id) => (id === data.config.me.id ? 'You' : partner());
const bearOf = (id) => (id === data.config.me.id ? data.config.me.character : data.config.partner.character);
const bearImg = (id, pose, className = '') => el('img', { className: `d-bear ${className}`, src: `ba://asset/${pose}-${bearOf(id)}.png`, alt: BEAR_NAMES[bearOf(id)] || '' });

function dbtn(text, className, fn, { sfx = 'click', disabled = false } = {}) {
  const b = el('button', { className, textContent: text, disabled, onclick: fn });
  b.dataset.sfx = sfx;
  return b;
}

async function draftDo(action) {
  const r = await window.ba.draft(action);
  if (r && r.ok === false && r.error) toast(r.error);
  return r;
}

function playDraftSound(name) {
  if (draftView?.settings.sound === false) return;
  const a = new Audio(`ba://asset/draft/sfx-${name}.mp3`);
  a.volume = 0.5;
  a.play().catch(() => {});
}

// ---------- pieces -------------------------------------------------------------

function itemArt(item, className = '') {
  const box = el('div', { className: `d-art tier-${item.tier} ${className}` });
  const img = el('img', { src: `ba://asset/draft/art/${item.id}.webp`, alt: item.name, draggable: false });
  img.onerror = () => img.replaceWith(el('span', { className: 'd-art-none', textContent: item.tier }));
  box.append(img);
  return box;
}

function itemCard(item) {
  return el(
    'div',
    { className: 'd-item' },
    item.modifier ? el('span', { className: 'd-modifier', textContent: 'Modifier' }) : '',
    itemArt(item, 'big'),
    el('span', { className: 'd-slot', textContent: item.slot }),
    el('b', { className: 'd-item-name', textContent: item.name }),
    el('small', { className: 'd-flavor', textContent: item.flavor }),
  );
}

function seatPose(g, id) {
  const { cur, last } = g;
  if (last?.won?.who === id) return 'dance';
  if (!cur) return 'happy';
  if (cur.passed.includes(id)) return 'sad';
  if (cur.lead === id) return 'happy';
  if (cur.lead && dl.prev?.cur?.lead === id && dl.prev.cur.item.id === cur.item.id) return 'angry';
  if (g.mode === 'turns') return cur.turn === id ? 'wiggle' : 'scrolling';
  return 'wiggle';
}

function seatBear(g, id) {
  const pose = seatPose(g, id);
  const kept = dl.seatBears[id];
  if (kept?.pose === pose) return kept.img;
  const img = bearImg(id, pose);
  dl.seatBears[id] = { pose, img };
  return img;
}

function seat(g, side) {
  const s = g[side];
  const { cur } = g;
  const tags = [];
  if (cur?.lead === s.id) tags.push(el('span', { className: 'd-tag lead', textContent: 'Leading' }));
  if (cur?.passed.includes(s.id)) tags.push(el('span', { className: 'd-tag passed', textContent: 'Passed' }));
  if (g.mode === 'turns' && cur?.turn === s.id) tags.push(el('span', { className: 'd-tag turn', textContent: side === 'me' ? 'Your move' : 'Their move' }));
  return el(
    'div',
    { className: `d-seat ${cur?.lead === s.id ? 'leading' : ''}` },
    seatBear(g, s.id),
    el('div', { className: 'd-seat-who' }, el('b', { textContent: side === 'me' ? 'You' : partner() }), el('span', { className: 'd-budget', textContent: `🍯 ${dollars(s.budget)}` }), el('div', { className: 'd-tags' }, ...tags)),
    el(
      'div',
      { className: 'd-pile' },
      ...s.won.map((w) => {
        const chip = itemArt(w, 'd-chip');
        chip.title = `${w.name} · ${dollars(w.cents)}`;
        return chip;
      }),
    ),
  );
}

function feedList() {
  const feed = draftView.feed;
  if (!feed.length) return '';
  const d = el('details', { className: 'd-feed', open: dl.feedOpen });
  d.addEventListener('toggle', () => (dl.feedOpen = d.open));
  d.append(el('summary', { textContent: `Moves so far · ${feed.length}` }), el('ol', {}, ...[...feed].reverse().map((f) => el('li', {}, el('span', { textContent: f.text }), el('small', { textContent: ago(f.at) })))));
  return d;
}

function endGameLink(label = 'End this game') {
  return el('button', {
    className: 'link d-end',
    textContent: label,
    onclick: () => confirm('End this draft for both of you?') && draftDo({ type: 'abandon' }),
  });
}

function header(title, sub) {
  return el('div', { className: 'd-head' }, el('h2', { textContent: title }), sub ? el('p', { className: 'hint', textContent: sub }) : '');
}

// ---------- the start screen ----------------------------------------------------

function renderHome() {
  const st = draftView.settings;
  const set = (patch) => draftDo({ type: 'settings', settings: patch });
  const mode = (id, title, sub) =>
    el(
      'button',
      { className: `d-choice ${st.mode === id ? 'on' : ''}`, onclick: () => set({ mode: id }) },
      el('b', { textContent: title }),
      el('small', { textContent: sub }),
    );
  const judge = (id, title, sub) =>
    el(
      'button',
      { className: `d-choice ${st.judge === id ? 'on' : ''}`, onclick: () => set({ judge: id }) },
      el('b', { textContent: title }),
      el('small', { textContent: sub }),
    );
  const timer = el('input', { type: 'range', min: 5, max: 60, step: 5, value: st.timerSec, onchange: () => set({ timerSec: Number(timer.value) }) });
  const timerLabel = el('span', { className: 'd-num', textContent: `${st.timerSec}s` });
  timer.addEventListener('input', () => (timerLabel.textContent = `${timer.value}s`));
  const check = (text, on, fn) => el('label', { className: 'row d-check' }, el('input', { type: 'checkbox', checked: on, onchange: (e) => fn(e.target.checked) }), el('span', { textContent: text }));
  return [
    el(
      'div',
      { className: 'card d-hero' },
      el('img', { className: 'd-hero-bears', src: 'ba://asset/pair-gaming.png', alt: 'Bubu and Dudu' }),
      el('h2', { textContent: 'Bearly Draft' }),
      el('p', { textContent: 'You each get $20 and twelve items go up for bids. Whoever builds the best one wins.' }),
    ),
    el(
      'div',
      { className: 'card' },
      el('h2', { textContent: 'How do you want to play?' }),
      el(
        'div',
        { className: 'd-choices' },
        mode('turns', '🐾 Take turns', `Make your bid and send it. ${partner()} answers whenever they’re free.`),
        mode('live', '⚡ Play live', 'Both here at once, with a countdown on every item.'),
      ),
      st.mode === 'live'
        ? el(
            'div',
            { className: 'd-live-opts' },
            el('label', { className: 'd-timer' }, el('span', { textContent: 'Time per item ' }), timerLabel, timer),
            check('Allow passing (one tap can end an item early)', st.allowPass, (v) => set({ allowPass: v })),
          )
        : '',
    ),
    el(
      'div',
      { className: 'card' },
      el('h2', { textContent: 'Who judges?' }),
      el(
        'div',
        { className: 'd-choices one' },
        judge('each', '🐻 Each other', 'You score their build, they score yours.'),
        judge('ai', '🤖 The AI judge', 'Runs on a computer with Ollama, so that computer has to be on.'),
        judge('friend', '💌 A friend', 'Send them a file. They score both builds and text the numbers back.'),
      ),
    ),
    el(
      'div',
      { className: 'd-startbar' },
      dbtn(`Start a draft with ${partner()}`, 'd-go', () => draftDo({ type: 'start', settings: {} }), { disabled: !live?.paired }),
      el(
        'div',
        { className: 'd-prefs' },
        check('Notifications', st.notify !== false, (v) => set({ notify: v })),
        check('Sounds', st.sound !== false, (v) => set({ sound: v })),
      ),
    ),
  ];
}

// ---------- invite, topic, setting -----------------------------------------------

function renderInvite(g) {
  if (g.startedByMe) {
    return [
      el(
        'div',
        { className: 'card d-center' },
        bearImg(g.me.id, 'wave', 'large'),
        el('h2', { textContent: `Waiting for ${partner()} to join…` }),
        el('p', { className: 'hint', textContent: `${partner()} got a notification. If nothing happens, their app may need updating to get the Draft tab.` }),
        dbtn('Call it off', 'ghost', () => draftDo({ type: 'abandon' })),
      ),
    ];
  }
  return [
    el(
      'div',
      { className: 'card d-center' },
      bearImg(g.them.id, 'wave', 'large'),
      el('h2', { textContent: `${partner()} wants to draft live!` }),
      el('p', { className: 'hint', textContent: 'A countdown runs on every item, so you both need a few minutes.' }),
      el('div', { className: 'actions' }, dbtn('I’m in', '', () => draftDo({ type: 'accept' })), dbtn('Not now', 'ghost', () => draftDo({ type: 'abandon' }))),
    ),
  ];
}

function renderPick(g) {
  return [
    el(
      'div',
      { className: 'card d-center d-topic' },
      el('span', { className: 'd-slot', textContent: g.topic.category }),
      el('h2', { className: 'd-topic-title', textContent: g.topic.title }),
      el('p', { className: 'hint', textContent: 'Build the best one of these.' }),
      el('div', { className: 'actions' }, dbtn('Draft this', '', () => draftDo({ type: 'topic' })), dbtn('Skip', 'ghost', () => draftDo({ type: 'skip' }))),
    ),
    g.local ? endGameLink('Never mind') : endGameLink(),
  ];
}

function renderContext(g) {
  const { contexts, authored } = g.topic;
  return [
    el(
      'div',
      { className: 'card' },
      header(g.topic.title, authored ? 'Where is this happening? The items up for bids change to fit.' : 'What’s the occasion?'),
      el(
        'div',
        { className: 'd-choices one' },
        ...contexts.map((label) => el('button', { className: 'd-choice', onclick: () => draftDo({ type: 'context', label }) }, el('b', { textContent: label }))),
        el('button', { className: 'd-choice ghosty', onclick: () => draftDo({ type: 'context', label: null }) }, el('b', { textContent: authored ? 'Surprise us' : 'No occasion' })),
      ),
    ),
    g.local ? endGameLink('Never mind') : endGameLink(),
  ];
}

// ---------- the auction ----------------------------------------------------------

function clockEl(g) {
  const secs = el('span', { className: 'd-secs', id: 'd-secs' });
  const box = el('div', { className: 'd-clock', id: 'd-clock' }, secs);
  dl.deadlineAt = Date.now() + (g.cur.leftMs || 0);
  dl.timerMs = g.timer * 1000;
  tickClock(box, secs);
  return box;
}

function tickClock(box = document.getElementById('d-clock'), secs = document.getElementById('d-secs')) {
  if (!box) return;
  const left = Math.max(0, dl.deadlineAt - Date.now());
  secs.textContent = Math.ceil(left / 1000);
  box.style.setProperty('--left', Math.min(1, left / dl.timerMs));
  box.classList.toggle('urgent', left <= 3000);
}
setInterval(tickClock, 200);

function turnControls(g) {
  const { cur, me } = g;
  const them = partner();
  if (cur.turn !== me.id) {
    return el(
      'div',
      { className: 'd-wait' },
      el('b', { textContent: `Waiting for ${them}…` }),
      el('small', { textContent: 'You’ll get a notification when they move. You can close this and carry on with your day.' }),
    );
  }
  const min = cur.bid > 0 ? cur.bid + 50 : 50;
  const canBid = me.budget >= Math.max(cur.bid + 1, 50);
  if (dl.bidFor !== `${g.id}:${g.seq}`) {
    dl.bidFor = `${g.id}:${g.seq}`;
    dl.bid = Math.min(min, me.budget);
  }
  const amount = el('input', { className: 'd-amount', type: 'number', min: 0.5, step: 0.5, max: me.budget / 100, value: (dl.bid / 100).toFixed(2) });
  const send = dbtn('', 'd-go', () => draftDo({ type: 'bid', cents: dl.bid, item: cur.item.id }), { sfx: 'bid', disabled: draftView.pending || !canBid });
  const showBid = () => (send.textContent = draftView.pending ? 'Sending…' : `Send ${dollars(dl.bid)} to ${them} 💌`);
  const setBid = (cents) => {
    dl.bid = Math.max(Math.min(cur.bid + 1 > 50 ? cur.bid + 1 : 50, me.budget), Math.min(cents, me.budget));
    amount.value = (dl.bid / 100).toFixed(2);
    showBid();
  };
  amount.addEventListener('change', () => setBid(Math.round(Number(amount.value) * 100) || min));
  showBid();
  return el(
    'div',
    { className: 'd-controls' },
    el(
      'div',
      { className: 'd-stepper' },
      dbtn('−', 'd-step', () => setBid(dl.bid - 50), { disabled: !canBid }),
      el('span', { className: 'd-money' }, '$', amount),
      dbtn('+', 'd-step', () => setBid(dl.bid + 50), { disabled: !canBid }),
    ),
    send,
    dbtn(cur.lead ? `Pass: ${them} gets it for ${dollars(cur.bid)}` : 'Pass', 'd-pass', () => draftDo({ type: 'pass', item: cur.item.id }), { disabled: draftView.pending }),
  );
}

function liveControls(g) {
  const { cur, me } = g;
  const passed = cur.passed.includes(me.id);
  const leading = cur.lead === me.id;
  const canAct = !passed && !leading;
  const bid = (cents) => draftDo({ type: 'bid', cents, item: cur.item.id });
  const quick = [50, 100].map((inc) => {
    const next = cur.bid > 0 ? cur.bid + inc : Math.max(inc, 50);
    return dbtn(`+${dollars(inc)}`, 'd-go', () => bid(next), { sfx: 'bid', disabled: !canAct || next > me.budget });
  });
  const custom = el('input', { className: 'd-custom', type: 'number', min: 0.5, step: 0.5, placeholder: `Over ${dollars(cur.bid)}` });
  const customRow = el('div', { className: 'd-custom-row' }, custom, dbtn('Bid', 'd-go', () => bid(Math.round(Number(custom.value) * 100)), { sfx: 'bid', disabled: !canAct }));
  return el(
    'div',
    { className: 'd-controls' },
    el('div', { className: 'd-quick' }, ...quick),
    customRow,
    g.allowPass ? dbtn(passed ? 'Passed' : leading ? 'You’re leading' : 'Pass', 'd-pass', () => draftDo({ type: 'pass', item: cur.item.id }), { disabled: !canAct }) : el('small', { className: 'hint d-center-text', textContent: leading ? 'You’re leading!' : 'Highest bid when the time runs out takes it.' }),
  );
}

function soldStamp(g) {
  const w = g.last?.won;
  if (!w) return '';
  const whoWon = w.who === data.config.me.id ? 'You got it!' : `${partner()} got it!`;
  return el('div', { className: 'd-stamp' }, el('b', { textContent: whoWon }), el('span', { textContent: dollars(w.cents) }));
}

function renderAuction(g) {
  const { cur } = g;
  const leader = cur.lead && (cur.lead === g.me.id ? 'You’re leading' : `${partner()} is leading`);
  const number = g.total - g.left;
  return [
    el(
      'div',
      { className: 'd-topbar' },
      el('span', {}, el('b', { textContent: g.topic.title }), g.ctx ? el('i', { textContent: ` · ${g.ctx}` }) : ''),
      el('span', { className: 'd-count', textContent: `Item ${number} of ${g.total}` }),
    ),
    el(
      'div',
      { className: 'd-table' },
      soldStamp(g),
      itemCard(cur.item),
      el(
        'div',
        { className: 'd-bidline' },
        g.mode === 'live' ? clockEl(g) : '',
        el('div', {}, el('div', { className: 'd-bid', textContent: dollars(cur.bid) }), el('small', { className: 'd-leader', textContent: leader || 'No bids yet' })),
      ),
      el('div', { className: 'd-seats' }, seat(g, 'me'), seat(g, 'them')),
    ),
    g.mode === 'turns' ? turnControls(g) : liveControls(g),
    feedList(),
    el('div', { className: 'd-links' }, g.mode === 'live' ? el('button', { className: 'link', textContent: 'Switch to taking turns', onclick: () => draftDo({ type: 'to-turns' }) }) : '', endGameLink()),
  ];
}

// ---------- the builds -------------------------------------------------------------

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Date topics show the build as black-and-white photo-booth strips, a keepsake of the night.
function photoStrips(s, who) {
  const date = new Date().toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' });
  return el(
    'div',
    { className: 'd-strips' },
    ...chunks(s.won, 4).map((wins) =>
      el(
        'div',
        { className: 'd-strip' },
        ...wins.map((w) => {
          const frame = itemArt(w, 'frame');
          frame.title = `${w.name} · ${dollars(w.cents)}`;
          return frame;
        }),
        el('small', { textContent: `${who} ${date}` }),
      ),
    ),
  );
}

function buildCard(g, side) {
  const s = g[side];
  const who = side === 'me' ? 'You' : partner();
  const spent = s.won.reduce((sum, w) => sum + w.cents, 0);
  const title = side === 'me' ? 'Your build' : `${partner()}’s build`;
  let body;
  if (!s.won.length) body = el('p', { className: 'hint', textContent: 'Nothing! Not one item.' });
  else if (g.topic.reveal === 'photo-strip') body = photoStrips(s, who);
  else
    body = el(
      'div',
      { className: 'd-tiles' },
      ...s.won.map((w) => el('div', { className: 'd-tile' }, itemArt(w), el('b', { textContent: w.name }), el('small', { textContent: dollars(w.cents) }))),
    );
  return el(
    'div',
    { className: 'card d-build' },
    el('div', { className: 'd-build-head' }, bearImg(s.id, 'happy'), el('div', {}, el('h2', { textContent: title }), el('small', { className: 'hint', textContent: `${s.won.length} item${s.won.length === 1 ? '' : 's'} · spent ${dollars(spent)} · ${dollars(s.budget)} left` }))),
    body,
  );
}

function renderReveal(g) {
  const nobody = g.gone.length ? el('p', { className: 'hint d-center-text', textContent: `Nobody wanted: ${g.gone.map((i) => i.name).join(', ')}` }) : '';
  return [
    header(`${g.topic.title}: the builds`, g.ctx || ''),
    buildCard(g, 'me'),
    buildCard(g, 'them'),
    nobody,
    el('div', { className: 'd-startbar' }, dbtn('On to judging', 'd-go', () => draftDo({ type: 'judging' }), { disabled: draftView.pending })),
    endGameLink(),
  ];
}

// ---------- judging ----------------------------------------------------------------

function scoreForm(g) {
  if (dl.sheetFor !== g.id) {
    dl.sheetFor = g.id;
    dl.sheet = [3, 3, 3, 3];
  }
  return el(
    'div',
    { className: 'card' },
    el('h2', { textContent: `Score ${partner()}’s build` }),
    el('p', { className: 'hint', textContent: 'From 1 (rough) to 5 (perfect).' }),
    ...RUBRIC_LABELS.map((label, i) => {
      const value = el('span', { className: 'd-num', textContent: dl.sheet[i] });
      const range = el('input', { type: 'range', min: 1, max: 5, step: 1, value: dl.sheet[i] });
      range.addEventListener('input', () => {
        dl.sheet[i] = Number(range.value);
        value.textContent = range.value;
      });
      return el('label', { className: 'd-score' }, el('span', { textContent: label }), value, range);
    }),
    dbtn('Send my scores', 'd-go', () => draftDo({ type: 'score', sheet: dl.sheet }), { disabled: draftView.pending }),
  );
}

function renderJudging(g) {
  const rows = [];
  if (g.judge === 'each') {
    if (g.iScored) {
      rows.push(el('div', { className: 'card d-center' }, bearImg(g.them.id, 'scrolling', 'large'), el('h2', { textContent: 'Scores in!' }), el('p', { className: 'hint', textContent: `Waiting on ${partner()}’s scores. You’ll get a notification.` })));
    } else {
      rows.push(buildCard(g, 'them'), scoreForm(g));
    }
  } else if (g.judge === 'ai') {
    const thinking = draftView.aiStatus === 'thinking';
    rows.push(
      el(
        'div',
        { className: 'card d-center' },
        bearImg(g.me.id, 'wiggle', 'large'),
        el('h2', { textContent: thinking ? 'The AI judge is reading both builds…' : 'Waiting for the AI judge' }),
        el('p', { className: 'hint', textContent: thinking ? 'This can take a minute if the model has to load.' : 'It runs on a computer with Ollama and the app open, and there isn’t one answering right now. It’ll keep trying.' }),
        dbtn('Judge each other instead', 'ghost', () => draftDo({ type: 'judge-each' }), { disabled: draftView.pending }),
      ),
    );
  } else {
    const reply = el('textarea', { rows: 2, value: dl.friendText, placeholder: g.players.map((id, i) => `${id === data.config.me.id ? data.config.me.name : partner()} ${i ? '3 4 5 2' : '4 5 3 2'}`).join(' · ') });
    reply.addEventListener('input', () => (dl.friendText = reply.value));
    rows.push(
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'Get a friend to judge' }),
        el('p', { textContent: 'Save the judge file and send it to a friend. It has both builds in it and nothing else about you two. They open it, score both, and text you back a line of numbers.' }),
        dbtn('Save the judge file', 'd-go', () => draftDo({ type: 'judge-file' })),
      ),
      el(
        'div',
        { className: 'card' },
        el('h2', { textContent: 'Paste what they sent back' }),
        reply,
        el('div', { className: 'actions' }, dbtn('Use these scores', '', () => draftDo({ type: 'friend-reply', text: dl.friendText }), { disabled: draftView.pending }), dbtn('Judge each other instead', 'ghost', () => draftDo({ type: 'judge-each' }), { disabled: draftView.pending })),
      ),
      buildCard(g, 'me'),
      buildCard(g, 'them'),
    );
  }
  return [header('Judging', g.judge === 'each' ? '' : `${g.topic.title}${g.ctx ? ` · ${g.ctx}` : ''}`), ...rows, endGameLink()];
}

// ---------- results ------------------------------------------------------------------

function wheel(g, onDone) {
  const r = g.results;
  const me = g.me.id;
  // My half is on the right of the wheel. It stops with the winner's half under the pointer, or on the line for a tie.
  const stop = !r.winner ? 0 : r.winner === me ? 270 : 90;
  const dial = el('div', { className: `d-wheel-dial bear-${bearOf(me)}` }, bearImg(me, 'happy', 'on-right'), bearImg(g.them.id, 'happy', 'on-left'));
  dial.style.setProperty('--stop', `${360 * 5 + stop}deg`);
  dial.addEventListener('animationend', onDone);
  return el('div', { className: 'd-wheel' }, el('div', { className: 'd-needle' }), dial);
}

function renderResults(g) {
  const r = g.results;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!dl.wheelDone[g.id] && !reduced) {
    return [
      header('And the winner is…', g.topic.title),
      wheel(g, () => {
        dl.wheelDone[g.id] = true;
        renderDraft(true);
      }),
    ];
  }
  const me = g.me.id;
  const banner = !r.winner ? 'It’s a tie! 🤝' : r.winner === me ? 'You won! 🏆' : `${partner()} won! 🏆`;
  const judgedBy = { ai: 'Judged by the AI', friend: 'Judged by your friend', each: 'You judged each other' }[g.judge];
  const row = (id) => {
    const x = r.rows.find((y) => y.id === id);
    const won = r.winner === id;
    return el(
      'div',
      { className: `card d-result ${won ? 'winner' : ''}` },
      el(
        'div',
        { className: 'd-build-head' },
        bearImg(id, !r.winner ? 'happy' : won ? 'dance' : 'cry', 'large'),
        el('div', {}, el('h2', { textContent: id === me ? 'You' : partner() }), el('div', { className: 'd-total', textContent: `${Number(x.total.toFixed(1))} / 20` }), el('small', { className: 'hint', textContent: `Spent ${dollars(x.spent)}` })),
      ),
      el(
        'div',
        { className: 'd-cats' },
        ...RUBRIC_LABELS.map((label, i) => {
          const bar = el('i');
          bar.style.width = `${(x.categories[i] / 5) * 100}%`;
          return el('div', { className: 'd-cat' }, el('span', { textContent: label }), el('div', { className: 'd-bar' }, bar), el('b', { textContent: Number(x.categories[i].toFixed(1)) }));
        }),
      ),
    );
  };
  return [
    header(banner, judgedBy),
    row(r.winner && r.winner !== me ? g.them.id : me),
    row(r.winner && r.winner !== me ? me : g.them.id),
    buildCard(g, 'me'),
    buildCard(g, 'them'),
    el('div', { className: 'd-startbar' }, dbtn('Rematch', 'd-go', () => draftDo({ type: 'rematch' })), dbtn('Back to the start', 'ghost', () => draftDo({ type: 'clear' }))),
  ];
}

// ---------- drawing ------------------------------------------------------------------

function renderDraft(force) {
  if (!data || !draftView) return;
  const g = draftView.game;
  const key = JSON.stringify([g?.id, g?.seq, g?.phase, g?.topic?.id, draftView.pending, draftView.aiStatus, draftView.settings, g?.local]);
  if (!force && key === draftKey) return;
  draftKey = key;
  const root = $('draft-root');
  const page = !g || g.phase === 'over' ? renderHome : { invite: renderInvite, pick: renderPick, context: renderContext, auction: renderAuction, reveal: renderReveal, judging: renderJudging, results: renderResults }[g.phase];
  // Redrawing keeps the page where it was, unless a new item just came up.
  const scroller = document.scrollingElement;
  const top = scroller.scrollTop;
  root.replaceChildren(...page(g).filter(Boolean));
  scroller.scrollTop = top;
  dl.prev = g;
}

$('draft-root').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !b.disabled) playDraftSound(b.dataset.sfx === 'bid' ? 'bid' : 'click');
});

window.ba.onDraft((view) => {
  draftView = view;
  renderDraft();
});
window.ba.onDraftNote((text) => toast(text));
window.ba.draftGet().then((view) => {
  draftView = view;
  renderDraft();
});
