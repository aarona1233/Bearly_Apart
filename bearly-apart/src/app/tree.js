// The Tree tab: choose one tree or two, then decorate by dragging ornaments from your box onto the tree's spots.
// Drag one of yours off the tree to put it back in the box. With two trees you can look at theirs and hang one of
// your ornaments there as a gift. The tree itself is drawn by tree-art.js; the rules live in src/main/tree.js.
let tv = null; // the view from the app
let trShown = false;
let trWhich = ''; // which tree is on screen (own trees: mine or theirs)
let trDrag = null; // { item, kind, c, from: slot|-1, ghost, hot }
let trPending = null; // an ornament just dropped, drawn in place until the relay confirms it
let trRaf = 0;
let trLastFrame = 0;
let trCanvas = null;
let trStarClickAt = 0;
let trView = ''; // 'calendar' or 'tree'
let trFx = null; // { d, t0, type, end }: a door opening right now, and that day's event on the calendar
let trFxTimers = [];
let trReward = 0; // the door whose reward card shows
let trHover = 0;
let trCal = null; // the calendar canvas
let trBackdrop = null; // the village behind it

TreeArt.load();
CalendarArt.load();

function trCall(action) {
  return window.ba.tree(action).then((r) => {
    if (r && r.ok === false && r.error) toast(r.error);
    return r;
  });
}

function trSpec() {
  if (!tv?.trees?.length) return null;
  const s = tv.trees.find((t) => t.tree === trWhich) || tv.trees[0];
  trWhich = s.tree;
  let orns = s.orns;
  if (trPending && trPending.tree === s.tree) orns = [...orns.filter((o) => o.id !== trPending.id && o.slot !== trPending.slot), trPending];
  if (trPending?.taken) orns = orns.filter((o) => o.id !== trPending.id);
  // While styling: the ornament (or the whole tree) shows the new look right away, before it's saved.
  if (trStyle) orns = orns.map((o) => (o.id === trStyle.item ? { ...o, style: trStyle.style } : o));
  const style = trTreeDraft?.tree === s.tree ? { ...s.style, ...trTreeDraft.style } : s.style;
  return { ...s, orns, style };
}

// ---------- the ornament styler ----------

let trStyle = null; // { item, kind, c, name, style }: the ornament being styled, and its look so far
let trTreeDraft = null; // { tree, style }: the tree being styled

function trOpenStyler(d) {
  const box = tv.box.find((o) => o.id === d.item);
  const name = d.name || box?.name || d.kind.replace(/-/g, ' ');
  trStyle = { item: d.item, kind: d.kind, c: d.c, name, style: { ...(d.style || {}) } };
  trTreeDraft = null;
  renderTree();
  $('tr-styler')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

const COLOR_NAMES = { p: 'Colour', a: 'Accent' };
const FINISH_NAMES = { shiny: '✨ Shiny', matte: '🫧 Matte', glitter: '💎 Glitter' };
const SIZE_NAMES = { s: 'Small', m: 'Medium', l: 'Big' };
const PATTERN_NAMES = { plain: 'Plain', zigzag: 'Zigzag', stripes: 'Stripes', dots: 'Dots', snow: 'Snowflakes', hearts: 'Hearts', stars: 'Stars', plaid: 'Plaid', swirl: 'Swirl' };

function trChip(label, on, onclick, extra = {}) {
  return el('button', { className: `tr-chip ${on ? 'on' : ''}`, textContent: label, onclick, ...extra });
}

function trStylerCard() {
  const st = trStyle;
  const card = el('div', { className: 'card tr-styler', id: 'tr-styler' });
  const preview = el('canvas', { width: 220, height: 220, className: 'tr-preview' });
  const drawPreview = () => {
    const g = preview.getContext('2d');
    g.clearRect(0, 0, 220, 220);
    TreeArt.drawOrnament(g, st.kind, st.c, 110, 8, 190 / (st.style.size === 'l' ? 1.2 : 1), 0, st.style);
  };
  const body = el('div', { className: 'tr-styler-body' });
  const rebuild = () => {
    body.replaceChildren(...trStylerRows());
    drawPreview();
    trDraw();
  };
  const set = (k, v) => {
    if (v === undefined) delete st.style[k];
    else st.style[k] = v;
    rebuild();
  };
  function trStylerRows() {
    const rows = [];
    for (const role of TreeArt.ROLES[st.kind] || []) {
      const sw = el('div', { className: 'tr-swatches' });
      sw.append(trChip('Original', !st.style[role], () => set(role, undefined), { className: `tr-chip small-chip ${!st.style[role] ? 'on' : ''}` }));
      for (const [name, hex] of Object.entries(TreeArt.PALETTE)) {
        const b = el('button', { className: `tr-swatch ${st.style[role] === name ? 'on' : ''}`, title: name, onclick: () => set(role, name) });
        b.style.background = hex;
        sw.append(b);
      }
      rows.push(el('div', { className: 'tr-row-label' }, el('b', { textContent: COLOR_NAMES[role] }), sw));
    }
    if (TreeArt.PATTERNED.has(st.kind)) {
      const pats = el('div', { className: 'tr-patterns' });
      for (const pat of TreeArt.PATTERNS) {
        const cv = el('canvas', { width: 72, height: 72 });
        TreeArt.drawOrnament(cv.getContext('2d'), st.kind, st.c, 36, 2, 68, 0, { ...st.style, pat, size: undefined });
        const cur = st.style.pat || { 'bauble-zigzag': 'zigzag', 'bauble-stripe': 'stripes', 'bauble-dots': 'dots' }[st.kind];
        pats.append(el('button', { className: `tr-pattern ${cur === pat ? 'on' : ''}`, title: PATTERN_NAMES[pat], onclick: () => set('pat', pat) }, cv, el('small', { textContent: PATTERN_NAMES[pat] })));
      }
      rows.push(el('div', { className: 'tr-row-label' }, el('b', { textContent: 'Pattern' }), pats));
    }
    const fin = el('div', { className: 'tr-swatches' }, ...Object.entries(FINISH_NAMES).map(([k, label]) => trChip(label, (st.style.fin || 'shiny') === k, () => set('fin', k === 'shiny' ? undefined : k))));
    const size = el('div', { className: 'tr-swatches' }, ...Object.entries(SIZE_NAMES).map(([k, label]) => trChip(label, (st.style.size || 'm') === k, () => set('size', k === 'm' ? undefined : k))));
    rows.push(el('div', { className: 'tr-row-label' }, el('b', { textContent: 'Finish' }), fin), el('div', { className: 'tr-row-label' }, el('b', { textContent: 'Size' }), size));
    return rows;
  }
  const actions = el(
    'div',
    { className: 'tr-row' },
    el('button', {
      textContent: '💾 Save this look',
      onclick: async () => {
        const r = await trCall({ type: 'style', item: st.item, style: st.style });
        if (r?.ok) {
          toast(`Your ${st.name} has its new look ✨`);
          trStyle = null;
        }
      },
    }),
    el('button', { className: 'ghost', textContent: 'Back to original', onclick: () => ((st.style = {}), rebuild()) }),
    el('button', {
      className: 'ghost',
      textContent: 'Close',
      onclick: () => {
        trStyle = null;
        renderTree();
      },
    }),
  );
  card.append(el('div', { className: 'tr-styler-head' }, preview, el('div', {}, el('h2', { textContent: `🎨 Style your ${st.name}` }), el('p', { className: 'hint', textContent: `Pick its colours${TreeArt.PATTERNED.has(st.kind) ? ', a pattern' : ''}, a finish and a size. ${tv.names.them} sees it the way you style it.` }))), body, actions);
  rebuild();
  return card;
}

// ---------- the tree styler ----------

const TREE_STYLE_OPTIONS = {
  color: ['Tree', { classic: '🌲 Classic', frosted: '🧊 Frosted', snowy: '❄️ Snowy', pink: '🌸 Pink', gold: '✨ Gold', midnight: '🌙 Midnight' }],
  garland: ['Garland', { gold: 'Gold tinsel', silver: 'Silver tinsel', red: 'Red tinsel', beads: 'Candy beads', none: 'None' }],
  lights: ['Lights', { rainbow: '🌈 Rainbow', warm: '🕯️ Warm white', cool: '🧊 Icy blue', pink: '🌸 Pink', candy: '🍬 Candy cane' }],
  topper: ['Topper', { star: '⭐ Star', heart: '❤️ Heart', bow: '🎀 Bow', snowflake: '❄️ Snowflake' }],
  skirt: ['Skirt', { red: 'Red', green: 'Green', plaid: 'Plaid', white: 'Snowy white', none: 'None' }],
};
const TREE_DEFAULTS = { color: 'classic', garland: 'gold', lights: 'rainbow', topper: 'star', skirt: 'none' };

function trTreeStylerCard() {
  const d = trTreeDraft;
  const cur = { ...TREE_DEFAULTS, ...(tv.trees.find((t) => t.tree === d.tree)?.style || {}), ...d.style };
  const card = el('div', { className: 'card tr-styler', id: 'tr-styler' });
  card.append(el('h2', { textContent: '🎨 Style the tree' }), el('p', { className: 'hint', textContent: `The tree changes as you pick. The garland shows from Dec 7, the lights from Dec 14 and the topper on Christmas Eve.${d.tree === 'us' ? ` ${tv.names.them} sees the same tree.` : ''}` }));
  for (const [k, [label, opts]] of Object.entries(TREE_STYLE_OPTIONS)) {
    const row = el('div', { className: 'tr-swatches' });
    for (const [v, text] of Object.entries(opts))
      row.append(
        trChip(text, cur[k] === v, () => {
          d.style[k] = v;
          renderTree();
        }),
      );
    card.append(el('div', { className: 'tr-row-label' }, el('b', { textContent: label }), row));
  }
  card.append(
    el(
      'div',
      { className: 'tr-row' },
      el('button', {
        textContent: '💾 Save the tree’s look',
        onclick: async () => {
          const r = await trCall({ type: 'treestyle', tree: d.tree, style: { ...cur } });
          if (r?.ok) {
            toast('The tree has its new look 🎄');
            trTreeDraft = null;
          }
        },
      }),
      el('button', {
        className: 'ghost',
        textContent: 'Close',
        onclick: () => {
          trTreeDraft = null;
          renderTree();
        },
      }),
    ),
  );
  return card;
}

// ---------- the calendar's look (yours only) ----------

function calLookCard() {
  const look = tv.look || {};
  const card = el('details', { className: 'card cal-look' });
  card.open = !!trLookOpen;
  card.addEventListener('toggle', () => (trLookOpen = card.open));
  card.append(el('summary', { textContent: '🎨 Calendar style' }));
  const house = el('div', { className: 'tr-swatches' });
  const HOUSE_NAMES = { gingerbread: 'Gingerbread', strawberry: 'Strawberry', mint: 'Mint', chocolate: 'Chocolate', snowy: 'Snowy' };
  for (const [k, label] of Object.entries(HOUSE_NAMES)) {
    const b = trChip(label, (look.house || 'gingerbread') === k, () => trCall({ type: 'look', look: { house: k } }));
    b.prepend(Object.assign(el('span', { className: 'tr-dot' }), { style: `background:${CalendarArt.HOUSES[k][0]}` }));
    house.append(b);
  }
  const doors = el('div', { className: 'tr-swatches' });
  const DOOR_NAMES = { candy: 'Candy', pastel: 'Pastel', classic: 'Classic', icy: 'Icy', berry: 'Berry' };
  for (const [k, label] of Object.entries(DOOR_NAMES)) {
    const b = trChip(label, (look.doors || 'candy') === k, () => trCall({ type: 'look', look: { doors: k } }));
    const strip = el('span', { className: 'tr-strip' });
    for (const c of CalendarArt.DOOR_SETS[k].slice(0, 4)) strip.append(Object.assign(el('i'), { style: `background:${c}` }));
    b.prepend(strip);
    doors.append(b);
  }
  card.append(el('p', { className: 'hint', textContent: 'Just on your screen: the house and its doors in your colours.' }), el('div', { className: 'tr-row-label' }, el('b', { textContent: 'House' }), house), el('div', { className: 'tr-row-label' }, el('b', { textContent: 'Doors' }), doors));
  return card;
}
let trLookOpen = false;

// ---------- drawing ----------

function trDraw(now = performance.now()) {
  if (trView === 'calendar') return calDraw(now);
  if (!trCanvas || !trCanvas.isConnected) return;
  const spec = trSpec();
  if (!spec) return;
  const ctx = trCanvas.getContext('2d');
  ctx.clearRect(0, 0, trCanvas.width, trCanvas.height);
  const hide = new Set(trDrag && trDrag.from >= 0 ? [trDrag.from] : []);
  TreeArt.drawTree(ctx, spec, { t: now, hide, guides: !!trDrag, hot: trDrag?.hot ?? -1 });
}

function trLoop(now) {
  trRaf = 0;
  if (!trShown) return;
  // 15 frames a second is plenty for twinkling lights and swaying ornaments.
  if (now - trLastFrame > 66) {
    trLastFrame = now;
    trDraw(now);
  }
  trRaf = requestAnimationFrame(trLoop);
}

// ---------- the tab ----------

function treeShown(on) {
  trShown = on;
  if (on) {
    window.ba.treeGet().then((v) => {
      tv = v;
      renderTree();
    });
    if (!trRaf) trRaf = requestAnimationFrame(trLoop);
  }
}

// Called on every live update: presence may have switched the lights.
let trLiveAt = 0;
function treeLive() {
  if (!trShown || Date.now() - trLiveAt < 1500) return;
  trLiveAt = Date.now();
  window.ba.treeGet().then((v) => {
    const relayout = !tv || v.mode !== tv.mode || v.box.length !== tv.box.length || v.star !== tv.star || v.starDay !== tv.starDay || v.stage !== tv.stage;
    tv = v;
    if (relayout) renderTree();
  });
}

window.ba.onTree((v) => {
  tv = v;
  trPending = null;
  // While a door's moment plays, the canvas picks up the new state by itself; the page is redrawn after.
  if (trFx && performance.now() < trFx.end) return;
  if (trShown && !trDrag) renderTree();
});

// Season days (src/main/tree.js): 1-4 are Nov 27-30, 5-35 are December 1-31, 36 is Jan 1. Door n opens on day n and
// carries the date's number (27..30, 1..25).
const TR_DEC = 4;
const TR_LAST = 36;
const trDate = (d) => (d < 1 ? '' : d <= TR_DEC ? `November ${d + 26}` : d < TR_LAST ? `December ${d - TR_DEC}` : 'January 1');
const trDoor = (d) => (d <= TR_DEC ? d + 26 : d - TR_DEC);
const DAY_NAMES = { [7 + TR_DEC]: 'the garland', [14 + TR_DEC]: 'the lights', [24 + TR_DEC]: 'the star' };
const TR_HOLIDAYS = { 1: 'November 27 💝', [24 + TR_DEC]: 'Christmas Eve', [25 + TR_DEC]: 'Christmas Day', [31 + TR_DEC]: 'New Year’s Eve' };

function trDateLine() {
  const d = tv.day;
  if (!d) return 'The tree goes up on November 27.';
  if (d === TR_LAST) return 'New Year’s Day: the tree comes down tonight.';
  const next = Object.keys(DAY_NAMES)
    .map(Number)
    .find((n) => n > d);
  const today = TR_HOLIDAYS[d] || trDate(d);
  if (!next) return today;
  return `${today} · ${DAY_NAMES[next]} ${next - d === 1 ? 'goes up tomorrow' : `goes up on ${trDate(next)}`}`;
}

function renderTree() {
  const root = $('tree-root');
  if (!root || !tv) return;
  root.replaceChildren();
  const them = tv.names.them;
  if (!trView) trView = tv.calendar.doors.some((d) => d.ready && !d.opened) ? 'calendar' : 'tree';
  root.append(trHead());
  if (tv.demo) root.append(trDemoBar());
  if (!tv.them) {
    root.append(el('div', { className: 'card' }, el('p', { textContent: 'Connect to your person first (Settings), then the tree goes up for both of you.' })));
    return;
  }
  if (trView === 'calendar') return renderCalendar(root, them);
  if (!tv.mode) return root.append(trChoose(them));

  const stage = el('div', { className: 'tr-stage' });
  if (tv.mode === 'own') {
    const sw = el('div', { className: 'tr-switch' });
    for (const t of tv.trees) {
      const mine = t.tree === tv.me;
      sw.append(
        el('button', {
          className: `small ${t.tree === trWhich ? '' : 'ghost'}`,
          textContent: mine ? '🎄 My tree' : `🎄 ${them}’s tree`,
          onclick: () => {
            trWhich = t.tree;
            renderTree();
          },
        }),
      );
    }
    stage.append(sw);
  }
  trCanvas = el('canvas', { className: 'tr-canvas', width: TreeArt.W, height: TreeArt.H });
  trCanvas.addEventListener('pointerdown', trPickFromTree);
  stage.append(trCanvas);
  root.append(stage);

  const spec = trSpec();
  const onTheirs = tv.mode === 'own' && spec.tree !== tv.me;
  const lines = el('div', { className: 'tr-lines' });
  if (tv.practice) lines.append(el('p', { className: 'hint', textContent: '🧪 Practice tree: only tester computers see it, and it’s cleared when the real tree goes up on November 27.' }));
  lines.append(el('p', { className: 'hint', textContent: trDateLine() }));
  if (tv.stage === 'lights') lines.append(el('p', { className: 'hint', textContent: spec.lights ? `✨ The lights are on: you’re both here.` : `💡 The lights come on while you and ${them} are both at your computers.` }));
  if (onTheirs) lines.append(el('p', { className: 'hint', textContent: `Hang one of your ornaments on ${them}’s tree as a gift. Your bear carries it over to their screen.` }));
  root.append(lines);

  if (trStyle) root.append(trStylerCard());
  else if (trTreeDraft) root.append(trTreeStylerCard());
  if (tv.starDay && !tv.star) root.append(trStarCard(them));

  const box = el('div', { className: 'card tr-box' });
  box.append(el('h2', { textContent: 'Your ornament box' }));
  if (!tv.box.length) {
    box.append(el('p', { className: 'hint', textContent: 'All hung up! More ornaments are hiding behind the calendar doors.' }));
  } else {
    box.append(el('p', { className: 'hint', textContent: `Drag one onto ${onTheirs ? `${them}’s` : 'the'} tree. Drag a hung one off to put it back. More are hiding behind the calendar doors.` }));
    const grid = el('div', { className: 'tr-grid' });
    for (const o of tv.box) {
      const cv = el('canvas', { width: 128, height: 128, className: 'tr-orn', title: `${o.emoji} ${o.name}: drag it onto the tree, or click to style it` });
      TreeArt.drawOrnament(cv.getContext('2d'), o.kind, o.c, 64, 2, 124 / (o.style?.size === 'l' ? 1.2 : 1), 0, o.style);
      cv.addEventListener('pointerdown', (e) => trStartDrag(e, { item: o.id, kind: o.kind, c: o.c, style: o.style, name: o.name, from: -1 }));
      grid.append(el('div', { className: 'tr-cell' }, cv, el('small', { textContent: o.name })));
    }
    box.append(grid);
  }
  root.append(box);
  if (tv.tester && !tv.demo) root.append(trTester());
  trDraw();
}

function trHead() {
  const h = el('div', { className: 'tr-head' });
  const views = el('div', { className: 'tr-views' });
  const waiting = tv.calendar.doors.filter((d) => d.ready && !d.opened).length;
  for (const [id, label] of [['calendar', `🗓️ Calendar${waiting ? ` (${waiting})` : ''}`], ['tree', '🎄 Tree']])
    views.append(
      el('button', {
        className: `small ${trView === id ? '' : 'ghost'}`,
        textContent: label,
        onclick: () => {
          trView = id;
          renderTree();
        },
      }),
    );
  h.append(views);
  if (!tv.demo)
    h.append(el('button', { className: 'ghost small', textContent: '🎬 Demo', title: 'Try all of Christmas on this computer only', onclick: () => ((trView = 'calendar'), trCall({ type: 'demo', on: true })) }));
  if (trView === 'tree' && tv.mode) {
    const tools = el('div', { className: 'tr-views' });
    // The shared tree, or your own: you can restyle it.
    const mine = trWhich === 'us' || trWhich === tv.me || (!trWhich && tv.mode === 'shared');
    if (mine)
      tools.append(
        el('button', {
          className: 'ghost small',
          textContent: '🎨 Style tree',
          onclick: () => {
            trStyle = null;
            trTreeDraft = { tree: trSpec()?.tree, style: {} };
            renderTree();
          },
        }),
      );
    tools.append(el('button', { className: 'ghost small', textContent: '▶ Show me', title: 'Play the bear bringing an ornament, on this screen', onclick: () => trCall({ type: 'preview', tree: trWhich }) }));
    h.append(tools);
  }
  return h;
}

// ---------- the advent calendar ----------

function renderCalendar(root, them) {
  const cal = tv.calendar;
  const stage = el('div', { className: 'tr-stage tr-cal' });
  trCal = el('canvas', { className: 'cal-canvas', width: CalendarArt.W, height: CalendarArt.H });
  trCal.addEventListener('pointermove', (e) => {
    const d = calDoorAt(e);
    trCal.style.cursor = d && (cal.doors[d - 1].ready || cal.doors[d - 1].opened) ? 'pointer' : 'default';
    trHover = d;
  });
  trCal.addEventListener('pointerleave', () => (trHover = 0));
  trCal.addEventListener('click', (e) => calClick(calDoorAt(e)));
  // The bears (live animations) and the event line sit on a layer over the canvas.
  const wrap = el('div', { className: 'cal-wrap' }, trCal, el('div', { className: 'cal-layer', id: 'cal-layer' }));
  // The village behind the house fills the whole panel, behind the calendar.
  trBackdrop = el('canvas', { className: 'cal-backdrop' });
  stage.append(trBackdrop, wrap);
  root.append(stage);
  calLayer();

  const lines = el('div', { className: 'tr-lines' });
  if (tv.practice) lines.append(el('p', { className: 'hint', textContent: '🧪 Practice calendar: only tester computers see it. The real one starts on November 27.' }));
  const ready = cal.doors.filter((d) => d.ready && !d.opened);
  let line;
  if (!cal.today) line = 'The first door opens on November 27.';
  else if (ready.length === 1) line = `🎁 Door ${trDoor(ready[0].d)} is ready. Click it to open it!`;
  else if (ready.length > 1) line = `🎁 ${ready.length} doors are ready (${ready.map((d) => trDoor(d.d)).join(', ')}). Click one to open it!`;
  else line = cal.today >= cal.doors.length ? 'Every door is open. Merry Christmas 💕' : `All caught up. Door ${trDoor(cal.today + 1)} opens tomorrow at midnight.`;
  lines.append(el('p', { className: 'hint', textContent: line }));
  const theirs = cal.doors.filter((d) => d.d === cal.today && d.theyOpened).length;
  if (theirs) lines.append(el('p', { className: 'hint', textContent: `${them} has opened today’s door too.` }));
  root.append(lines);

  root.append(el('div', { id: 'cal-reward-slot' }));
  calShowReward();
  root.append(calLookCard());
  if (tv.tester && !tv.demo) root.append(trTester(), calEditor());
  calDraw();
}

function calShowReward() {
  const slot = $('cal-reward-slot');
  if (!slot) return;
  const door = trReward && tv.calendar.doors[trReward - 1];
  slot.replaceChildren(...(door?.opened && door.reward ? [calRewardCard(door)] : []));
}

// ---------- the layer over the calendar: live bears and the event of the day ----------

// A bear picture placed in calendar coordinates (centre x, feet y, width), as a live animation.
function calBear(b, cls = '') {
  const img = el('img', { src: `ba://asset/${b.src}`, className: `cal-bear ${cls}`, alt: '' });
  img.style.left = `${((b.x - b.w / 2) / CalendarArt.W) * 100}%`;
  img.style.top = `${((b.y - b.w) / CalendarArt.H) * 100}%`;
  img.style.width = `${(b.w / CalendarArt.W) * 100}%`;
  return img;
}

// Builds the layer for now: the two bears at home (unless the event has borrowed one), plus the event's bears and
// its line while an event is playing.
function calLayer() {
  const layer = $('cal-layer');
  if (!layer) return;
  layer.replaceChildren();
  const now = performance.now();
  const ev = trFx ? now - trFx.t0 - CalendarArt.EVENT_AT : -1;
  const playing = trFx && ev >= 0 && now < trFx.end;
  const doors = tv.calendar.doors.map((d) => (trFx && d.d === trFx.d ? { ...d, opened: true } : d));
  const prog = CalendarArt.progress({ doors });
  // An event's bears can come and go at set moments (from/to, ms into the event) and walk across (x → x2).
  const all = playing ? CalendarArt.eventBears(trFx.type, prog) : [];
  const away = new Set(all.map((b) => b.hide).filter(Boolean));
  for (const who of ['dudu', 'bubu']) if (!away.has(who)) layer.append(calBear(CalendarArt.HOME[who], `home ${who}`));
  for (const b of all) {
    if (ev < (b.from || 0) || ev >= (b.to ?? Infinity)) continue;
    const since = ev - (b.from || 0);
    const img = calBear(b, since < 250 ? 'visit' : '');
    if (b.x2 !== undefined) {
      const left = (x) => `${((x - b.w / 2) / CalendarArt.W) * 100}%`;
      img.animate([{ left: left(b.x) }, { left: left(b.x2) }], { duration: b.to - (b.from || 0), delay: -since, fill: 'forwards' });
    }
    layer.append(img);
  }
  if (playing) {
    const banner = el('div', { className: 'cal-banner', textContent: CalendarArt.eventText(trFx.type, prog) });
    layer.append(banner);
  }
}

function calDoorAt(e) {
  const r = trCal.getBoundingClientRect();
  return CalendarArt.doorAt(((e.clientX - r.left) * CalendarArt.W) / r.width, ((e.clientY - r.top) * CalendarArt.H) / r.height);
}

// Opening a door is a moment: the door shakes and bursts open, the reward rises out, then the day's event plays on
// the calendar (bears come out, the house changes). The reward card comes up as the burst settles.
function calClick(d) {
  if (!d || (trFx && performance.now() < trFx.end)) return;
  const door = tv.calendar.doors[d - 1];
  if (door.opened) {
    trReward = d;
    return calShowReward();
  }
  if (!door.ready) return toast(`Door ${trDoor(d)} opens on ${trDate(d)} 🤫`);
  trFxTimers.forEach(clearTimeout);
  const t0 = performance.now();
  trFx = { d, t0, type: CalendarArt.eventFor(d), end: t0 + CalendarArt.momentMs(d) };
  trReward = 0;
  calShowReward();
  trCall({ type: 'open', day: d }).then((r) => {
    if (!r?.ok) {
      trFx = null;
      calLayer();
    }
  });
  const at = (ms, fn) => trFxTimers.push(setTimeout(fn, ms));
  at(CalendarArt.EVENT_AT, calLayer);
  // Redraw the bear layer whenever one of the event's bears comes or goes.
  const doors = tv.calendar.doors.map((x) => (x.d === d ? { ...x, opened: true } : x));
  const times = new Set();
  for (const b of CalendarArt.eventBears(trFx.type, CalendarArt.progress({ doors }))) for (const ms of [b.from, b.to]) if (ms) times.add(ms);
  for (const ms of times) at(CalendarArt.EVENT_AT + ms + 10, calLayer);
  at(2300, () => {
    trReward = d;
    calShowReward();
  });
  at(CalendarArt.momentMs(d) + 50, () => {
    trFx = null;
    if (trShown && trView === 'calendar') renderTree();
  });
}

function calDraw(now = performance.now()) {
  if (!trCal || !trCal.isConnected || !tv) return;
  const ctx = trCal.getContext('2d');
  ctx.clearRect(0, 0, trCal.width, trCal.height);
  const fx = trFx && now < trFx.end ? trFx : null;
  CalendarArt.drawCalendar(ctx, tv.calendar, { t: now, fx, hover: trHover, look: tv.look });
  calBackdrop(now, fx);
}

// The village, drawn in the calendar's own coordinates (so it lines up with the house) across the whole panel.
function calBackdrop(now, fx) {
  if (!trBackdrop?.isConnected) return;
  const sr = trBackdrop.getBoundingClientRect();
  const cr = trCal.getBoundingClientRect();
  if (!sr.width || !cr.width) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(sr.width * dpr);
  const h = Math.round(sr.height * dpr);
  if (trBackdrop.width !== w || trBackdrop.height !== h) [trBackdrop.width, trBackdrop.height] = [w, h];
  const k = cr.width / CalendarArt.W;
  const ox = cr.left - sr.left;
  const oy = cr.top - sr.top;
  const b = trBackdrop.getContext('2d');
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, w, h);
  b.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
  CalendarArt.drawBackdrop(b, { x0: -ox / k, y0: -oy / k, x1: (sr.width - ox) / k, y1: (sr.height - oy) / k }, { t: now, dark: CalendarArt.darkness(fx, now) });
}

function calRewardCard(door) {
  const r = door.reward;
  const card = el('div', { className: 'card cal-reward' });
  const pic = el('canvas', { width: 160, height: 160, className: 'cal-pic' });
  CalendarArt.icon(pic.getContext('2d'), r, 80, 80, 130);
  const body = el('div', {}, el('small', { className: 'hint', textContent: trDate(door.d) }), el('h2', { textContent: r.title || 'A surprise' }));
  if (r.kind === 'ornament') body.append(el('p', { textContent: `A ${r.name} for the tree. It’s in your ornament box.` }));
  if (r.kind === 'snow') body.append(el('p', { textContent: 'Snow is falling on your screen ❄️' }));
  if (r.text) body.append(el('p', { className: 'cal-note', textContent: r.text }));
  const row = el('div', { className: 'tr-row' });
  if (r.kind === 'ornament' || r.kind === 'star')
    row.append(
      el('button', {
        className: 'small',
        textContent: r.kind === 'star' ? '⭐ Go to the tree' : '🎄 Hang it on the tree',
        onclick: () => {
          trView = 'tree';
          trReward = 0;
          renderTree();
        },
      }),
    );
  row.append(
    el('button', {
      className: 'ghost small',
      textContent: 'Close',
      onclick: () => {
        trReward = 0;
        renderTree();
      },
    }),
  );
  body.append(row);
  card.append(pic, body);
  return card;
}

// ---------- the door editor (tester only) ----------

const CAL_KINDS = { ornament: '🎄 Ornament', note: '💌 Note', snow: '❄️ Snow day', star: '⭐ Star (Christmas Eve)' };

function calEditor() {
  const card = el('details', { className: 'card cal-editor' });
  card.append(el('summary', { textContent: '🧪 Door editor: what’s behind the doors' }));
  card.addEventListener('toggle', async () => {
    if (!card.open || card.dataset.loaded) return;
    card.dataset.loaded = '1';
    const r = await window.ba.tree({ type: 'doors-get' });
    if (!r?.ok) return card.append(el('p', { className: 'hint', textContent: 'Unlock the tester section first.' }));
    card.append(
      el('p', {
        className: 'hint',
        textContent: `${tv.calendar.doors.length} surprises, one for each day from November 27 to Christmas Day. They go behind the doors in a shuffled order nobody sees, except the ones pinned to a day. ${r.source ? 'Saving writes them into the app, so build and publish to send them to her Mac.' : 'This is an installed app, so saving keeps them on this computer only. Save from the source copy (npm start) and publish to send them to her Mac.'}`,
      }),
    );
    const rows = el('div', { className: 'cal-rows' });
    const items = r.doors.map((d, i) => {
      const kind = el('select');
      for (const [k, label] of Object.entries(CAL_KINDS)) kind.append(el('option', { value: k, textContent: label }));
      kind.value = d.kind;
      const item = el('select');
      for (const o of r.ornaments) item.append(el('option', { value: o, textContent: o === 'heart-half' ? 'heart halves (one each)' : o.replace(/-/g, ' ') }));
      item.value = d.item || r.ornaments[0];
      const title = el('input', { value: d.title || '', placeholder: 'Title (optional)' });
      const text = el('textarea', { value: d.text || '', placeholder: 'Note for both of you' });
      const forHer = el('textarea', { value: d.forYimei || '', placeholder: 'Extra line only Yimei sees' });
      const pin = el('select');
      pin.append(el('option', { value: '', textContent: 'any day' }));
      for (let n = 1; n <= tv.calendar.doors.length; n++) pin.append(el('option', { value: String(n), textContent: trDate(n).replace(/^(\w{3})\w*/, '$1') }));
      pin.value = d.pin ? String(d.pin) : '';
      const sync = () => {
        item.hidden = kind.value !== 'ornament';
      };
      kind.onchange = sync;
      sync();
      rows.append(el('div', { className: 'cal-row' }, el('b', { textContent: `${i + 1}` }), kind, item, pin, title, text, forHer));
      return () => ({ kind: kind.value, item: item.value, title: title.value, text: text.value, forYimei: forHer.value, pin: pin.value ? Number(pin.value) : undefined });
    });
    card.append(
      rows,
      el('button', {
        textContent: '💾 Save the doors',
        onclick: async () => {
          const s = await window.ba.tree({ type: 'doors-save', doors: items.map((f) => f()) });
          toast(s?.ok ? `Saved to ${s.where}` : s?.error || 'Couldn’t save');
        },
      }),
    );
  });
  return card;
}

function trChoose(them) {
  const card = el('div', { className: 'card tr-choose' });
  const pick = (mode) => trCall({ type: 'choose', mode });
  if (tv.myChoice === 'shared' && !tv.theirChoice) {
    card.append(
      el('h2', { textContent: `Waiting for ${them} to choose…` }),
      el('p', { className: 'hint', textContent: `You asked for one tree together. ${them} gets asked too.` }),
      el('div', { className: 'tr-row' }, el('button', { className: 'ghost small', textContent: 'Make it our own trees instead', onclick: () => pick('own') })),
    );
    return card;
  }
  if (tv.theirChoice === 'shared' && !tv.myChoice) {
    card.append(
      el('h2', { textContent: `${them} wants one tree together 🎄` }),
      el('p', { className: 'hint', textContent: 'You decorate the same tree, and it looks the same on both computers.' }),
      el('div', { className: 'tr-row' }, el('button', { textContent: '🎄 Yes, one tree together', onclick: () => pick('shared') }), el('button', { className: 'ghost', textContent: 'Our own trees', onclick: () => pick('own') })),
    );
    return card;
  }
  card.append(
    el('h2', { textContent: 'How do you want to decorate this year?' }),
    el('div', { className: 'tr-options' }, trOption('🎄', 'One tree together', `You both decorate the same tree. ${them} gets asked too.`, () => pick('shared')), trOption('🎄🎄', 'Our own trees', `You each get a tree, and you can hang gifts on ${them}’s.`, () => pick('own'))),
    el('p', { className: 'hint', textContent: 'If either of you picks your own trees, you both get your own. It stays that way until the tree comes down after New Year’s.' }),
  );
  return card;
}

function trOption(icon, title, text, onclick) {
  return el('button', { className: 'tr-option ghost', onclick }, el('span', { className: 'tr-icon', textContent: icon }), el('b', { textContent: title }), el('small', { textContent: text }));
}

function trStarCard(them) {
  const card = el('div', { className: 'card tr-star' });
  const theirTap = tv.taps[tv.them] || 0;
  const mineTap = Math.max(tv.taps[tv.me] || 0, trStarClickAt);
  const fresh = (t) => t && Date.now() - t < 20_000;
  let text = `It’s ${tv.day === 24 + TR_DEC ? 'Christmas Eve' : 'Christmas'}. The star goes on when you both click within 20 seconds of each other.`;
  if (fresh(theirTap) && !fresh(mineTap)) text = `${them} is holding up the star! Click now ⭐`;
  else if (fresh(mineTap)) text = `You’re holding up the star. Waiting for ${them} to click too…`;
  card.append(
    el('p', { textContent: text }),
    el('button', {
      textContent: '⭐ Put the star on together',
      onclick: () => {
        trStarClickAt = Date.now();
        trCall({ type: 'tap' }).then(() => renderTree());
        setTimeout(() => trShown && renderTree(), 20_500);
      },
    }),
  );
  return card;
}

function trTester() {
  const card = el('details', { className: 'card tr-tester' });
  card.append(el('summary', { textContent: '🧪 Tester: pretend it’s another day' }));
  const sel = el('select');
  sel.append(el('option', { value: '0', textContent: 'The real date' }));
  for (let d = 1; d <= TR_LAST; d++) sel.append(el('option', { value: String(d), textContent: trDate(d) }));
  sel.value = String(tv.testDay || 0);
  sel.onchange = () => trCall({ type: 'test-day', day: Number(sel.value) });
  card.append(el('p', { className: 'hint', textContent: 'Only on this computer. Changes the tree’s stage, the star day and which calendar doors are ready. Doors you open and ornaments you hang still go to the other app.' }), sel);
  return card;
}

// ---------- the Christmas demo ----------
// A pretend December on this computer only (main.js keeps it apart from the real tree, and nothing is sent): pick any
// day, open doors, decorate, put the star on. The pretend partner picks the same trees, opens the same doors and
// clicks the star with you; their ornament deliveries and the desktop scenes play on buttons.

let trTour = null; // { stop }: the tour opening every door in turn
const trSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function trDayName(d) {
  const extra = { 1: ' · our day 💝', [7 + TR_DEC]: ' · garland', [14 + TR_DEC]: ' · lights', [24 + TR_DEC]: ' · Christmas Eve ⭐', [25 + TR_DEC]: ' · Christmas Day', [31 + TR_DEC]: ' · New Year’s Eve' }[d] || '';
  return `${trDate(d)}${extra}`;
}

function trDemoBar() {
  const them = tv.names.them;
  const card = el('div', { className: 'card tr-demo' });
  const sel = el('select', { title: 'Pretend it’s this day' });
  for (let d = 1; d <= TR_LAST; d++) sel.append(el('option', { value: String(d), textContent: trDayName(d) }));
  sel.value = String(tv.day || 1);
  sel.disabled = !!trTour;
  sel.onchange = () => trCall({ type: 'demo-day', day: Number(sel.value) });
  const step = (by) =>
    el('button', {
      className: 'ghost small',
      textContent: by < 0 ? '◀' : '▶',
      title: by < 0 ? 'The day before' : 'The next day',
      disabled: !!trTour || (tv.day || 1) + by < 1 || (tv.day || 1) + by > TR_LAST,
      onclick: () => trCall({ type: 'demo-day', day: (tv.day || 1) + by }),
    });
  const scene = (label, name) => el('button', { className: 'ghost small', textContent: label, onclick: () => trCall({ type: 'demo-scene', scene: name }) });
  card.append(
    el(
      'div',
      { className: 'tr-demo-head' },
      el('b', { textContent: '🎬 Christmas demo' }),
      el('button', {
        className: 'ghost small',
        textContent: 'Exit demo',
        onclick: () => {
          if (trTour) trTour.stop = true;
          trView = '';
          trCall({ type: 'demo', on: false });
        },
      }),
    ),
    el('p', { className: 'hint', textContent: `Only on this computer: nothing reaches ${them}. Here ${them} is pretend: they pick the same trees as you, open the same doors and click the star with you.` }),
    el('div', { className: 'tr-demo-day' }, step(-1), sel, step(1)),
    el(
      'div',
      { className: 'tr-row' },
      el('button', { className: 'small', textContent: trTour ? '■ Stop' : '▶ Open every door', title: 'Opens the doors one after another, each with its moment', onclick: trDemoTour }),
      tv.mode ? el('button', { className: 'ghost small', textContent: `🐻 ${them} hangs one`, title: `${them}’s bear brings an ornament to your screen`, onclick: () => trCall({ type: 'demo-hang' }) }) : '',
      el('button', {
        className: 'ghost small',
        textContent: '↺ Start over',
        onclick: () => {
          if (!confirm('Start the demo over? Doors close and the tree is cleared (only the demo’s).')) return;
          if (trTour) trTour.stop = true;
          trView = 'calendar';
          trReward = 0;
          trCall({ type: 'demo-reset' });
        },
      }),
    ),
    el('p', { className: 'hint tr-demo-sub', textContent: 'On your desktop:' }),
    el(
      'div',
      { className: 'tr-row' },
      scene('🎄 Tree is up', 'tree-open'),
      scene('🎁 Door is ready', 'advent-ready'),
      scene('❄️ Snow day', 'snow-day'),
      scene('🔔 Ornament delivery', 'tree-hang'),
      scene('⭐ Star goes on', 'tree-star'),
    ),
  );
  return card;
}

// Opens every door still closed, one after another (moving the day along as it goes), each with its moment.
async function trDemoTour() {
  if (trTour) {
    trTour.stop = true;
    return;
  }
  const tour = (trTour = { stop: false });
  trView = 'calendar';
  renderTree();
  for (let d = 1; d <= tv.calendar.doors.length && !tour.stop; d++) {
    if (tv.calendar.doors[d - 1].opened) continue;
    if (tv.calendar.today < d) {
      await trCall({ type: 'demo-day', day: d });
      for (let i = 0; i < 40 && tv.calendar.today < d; i++) await trSleep(100);
    }
    if (tour.stop || !trShown || !tv.demo) break;
    if (trView !== 'calendar' || !trCal?.isConnected) {
      trView = 'calendar';
      renderTree();
    }
    trCal.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    calClick(d);
    await trSleep(CalendarArt.momentMs(d) + 1200);
  }
  trTour = null;
  if (trShown) renderTree();
}

// ---------- dragging ----------

function trToTree(e) {
  const r = trCanvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * TreeArt.W) / r.width, y: ((e.clientY - r.top) * TreeArt.H) / r.height, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
}

function trPickFromTree(e) {
  const spec = trSpec();
  if (!spec || trDrag) return;
  const { x, y } = trToTree(e);
  const o = TreeArt.ornamentAt(spec, x, y);
  if (!o) return;
  if (o.by !== tv.me) return toast(`${tv.names.them} hung that one 💕`);
  trStartDrag(e, { item: o.id, kind: o.kind, c: o.c, style: o.style, from: o.slot });
}

// Press on an ornament: a click opens its styler, a drag (6 px or more) picks it up.
function trStartDrag(e, d) {
  e.preventDefault();
  trDrag = { ...d, x0: e.clientX, y0: e.clientY, ghost: null, hot: -1, size: 0 };
  window.addEventListener('pointermove', trMove);
  window.addEventListener('pointerup', trDrop, { once: true });
}

function trLift() {
  const size = Math.max(48, (trCanvas.getBoundingClientRect().width / TreeArt.W) * TreeArt.ORN * 1.25);
  const ghost = el('canvas', { width: 160, height: 160, className: 'tr-ghost' });
  ghost.style.width = ghost.style.height = `${size}px`;
  TreeArt.drawOrnament(ghost.getContext('2d'), trDrag.kind, trDrag.c, 80, 2, 156, 0, trDrag.style);
  document.body.append(ghost);
  Object.assign(trDrag, { ghost, size });
}

function trMove(e) {
  if (!trDrag) return;
  if (!trDrag.ghost) {
    if (Math.hypot(e.clientX - trDrag.x0, e.clientY - trDrag.y0) < 6) return;
    trLift();
  }
  const s = trDrag.size;
  trDrag.ghost.style.transform = `translate(${e.clientX - s / 2}px, ${e.clientY - s * 0.25}px)`;
  const p = trToTree(e);
  trDrag.hot = p.inside ? TreeArt.nearestSlot(trSpec(), p.x, p.y, 95, trDrag.from) : -1;
  trDraw();
}

// The window can open straight onto the Tree tab before this file has loaded: draw it now.
if (document.querySelector('section[data-page="tree"]')?.classList.contains('on')) treeShown(true);

function trDrop(e) {
  window.removeEventListener('pointermove', trMove);
  const d = trDrag;
  trDrag = null;
  if (!d.ghost) return trOpenStyler(d); // a click, not a drag
  d.ghost.remove();
  const p = trToTree(e);
  const tree = trWhich;
  if (d.hot >= 0) {
    if (d.hot !== d.from) {
      trPending = { tree, slot: d.hot, kind: d.kind, c: d.c, id: d.item, by: tv.me, style: d.style };
      trCall({ type: 'hang', item: d.item, tree, slot: d.hot }).then((r) => {
        if (!r?.ok) trPending = null;
        trDraw();
      });
      TreeArt.load().then(() => trDraw());
    }
  } else if (d.from >= 0 && !p.inside) {
    // Dragged off the tree: back into the box.
    trPending = { id: d.item, taken: true };
    trCall({ type: 'take', item: d.item }).then((r) => {
      if (!r?.ok) trPending = null;
      trDraw();
    });
  }
  trDraw();
}
