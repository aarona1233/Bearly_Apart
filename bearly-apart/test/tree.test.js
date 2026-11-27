const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/main/tree');
const A = require('../src/main/advent');
const { TreeSession } = require('../src/main/tree-session');

// Test doors: one ornament per door pinned to season days 1..25 (so door 6 has the bell, door 17 the heart halves),
// two snow days and a note, and the star on 28 (Christmas Eve). No lights door, so the lights come by date.
const TEST_ORDER = ['bauble-zigzag', 'bauble-stripe', 'bauble-dots', 'star', 'snowflake', 'bell', 'candy-cane', 'gingerbread', 'bauble-snow', 'teardrop', 'pinecone', 'mitten', 'present', 'boba', 'plane', 'heart', 'heart-half', 'dudu', 'bubu', 'first-xmas', 'stocking', 'snowman', 'reindeer', 'cocoa', 'locket'];
const TEST_DOORS = [...TEST_ORDER.map((item, i) => ({ kind: 'ornament', item, pin: i + 1 })), { kind: 'snow' }, { kind: 'snow' }, { kind: 'note', title: 'A note' }, { kind: 'star', title: 'Christmas Eve ⭐', pin: 28 }];
const { fromNtfy, toTags } = require('../src/main/relay');

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const PEOPLE = ['aaron', 'yimei'];
const at = (iso) => Date.parse(iso);

// ---------- dates ----------

test('the season runs from November 27 to January 1, on the earlier of the two clocks', () => {
  assert.strictEqual(T.seasonDay(at('2026-11-26T12:00:00Z'), NY), 0);
  assert.strictEqual(T.seasonDay(at('2026-11-27T04:58:59Z'), NY), 0, '11:58:59 pm on the 26th: not yet');
  assert.strictEqual(T.seasonDay(at('2026-11-27T04:59:00Z'), NY), 1, 'it opens at 11:59 pm on the 26th');
  assert.strictEqual(T.seasonDay(at('2026-11-27T05:00:00Z'), NY), 1); // midnight in New York: the 27th
  assert.strictEqual(T.seasonDay(at('2026-11-27T05:00:00Z'), LA), 0); // still Nov 26, 9 pm in LA
  assert.strictEqual(T.dayFor(at('2026-11-27T05:00:00Z'), [LA, NY]), 1, 'both apps open it together');
  assert.strictEqual(T.seasonDay(at('2026-11-30T17:00:00Z'), NY), 4);
  assert.strictEqual(T.seasonDay(at('2026-12-01T17:00:00Z'), NY), 5);
  assert.strictEqual(T.seasonDay(at('2026-12-25T17:00:00Z'), NY), 29);
  assert.strictEqual(T.seasonDay(at('2027-01-01T17:00:00Z'), NY), 36);
  assert.strictEqual(T.seasonDay(at('2027-01-02T17:00:00Z'), NY), 0);
  assert.strictEqual(T.seasonYear(at('2027-01-01T17:00:00Z'), NY), 2026, 'Jan 1 is still last December’s tree');
  assert.strictEqual(T.isUp(0), false);
  assert.strictEqual(T.isUp(36), true);
  assert.strictEqual(T.isUp(37), false);
  assert.deepStrictEqual([1, 4, 5, 28, 29, 36].map(T.dateName), ['November 27', 'November 30', 'December 1', 'December 24', 'December 25', 'January 1']);
  assert.deepStrictEqual([1, 4, 5, 29].map(T.doorLabel), [27, 30, 1, 25], 'doors carry the date');
  assert.strictEqual(T.dayFor(at('2026-11-02T12:00:00Z'), [NY], 24), 24, 'a tester’s pretend day wins');
});

test('it grows through December: bare, then the garland, and the star from Christmas Eve (the lights are a door)', () => {
  assert.strictEqual(T.stageFor(0), null);
  assert.strictEqual(T.stageFor(1), 'bare');
  assert.strictEqual(T.stageFor(10), 'bare'); // Dec 6
  assert.strictEqual(T.stageFor(11), 'garland'); // Dec 7
  assert.strictEqual(T.stageFor(36), 'garland');
  assert.strictEqual(T.stageFor(37), null);
  assert.strictEqual(T.LIGHTS_DAY, 18, 'without a lights door, Dec 14 as before');
  assert.strictEqual(T.starDay(27), false);
  assert.strictEqual(T.starDay(28), true); // Christmas Eve
});

test('ornaments arrive through December, and each of you gets your own half of the heart', () => {
  const day1 = T.unlockedItems('aaron', 'brown', 5); // Dec 1
  assert.deepStrictEqual(day1.sort(), ['aaron~bauble-dots', 'aaron~bauble-stripe', 'aaron~bauble-zigzag', 'aaron~star']);
  const aaron = T.unlockedItems('aaron', 'brown', 35);
  const yimei = T.unlockedItems('yimei', 'cream', 35);
  assert.ok(aaron.includes('aaron~heart-left') && !aaron.includes('aaron~heart-right'));
  assert.ok(yimei.includes('yimei~heart-right') && !yimei.includes('yimei~heart-left'));
  assert.strictEqual(aaron.length, Object.keys(T.KINDS).length - 1);
  assert.deepStrictEqual(T.unlockedItems('aaron', 'brown', 0), []);
  // Same ornament, different colours for the two of you (where it has more than one).
  assert.notStrictEqual(T.colorOf('aaron~bauble-zigzag', PEOPLE), T.colorOf('yimei~bauble-zigzag', PEOPLE));
  assert.strictEqual(T.colorOf('aaron~pinecone', PEOPLE), 0);
  assert.strictEqual(T.parseItem('aaron~not-a-thing'), null);
  assert.strictEqual(T.parseItem('../x~star'), null);
});

// ---------- ops and merging ----------

let seq = 0;
const ev = (from, ms = 1000) => ({ from, at: ms, id: `m${++seq}` });
const run = (state, ops) => ops.reduce((s, [from, op, ms]) => T.apply(s, op, ev(from, ms), PEOPLE), state);

test('one tree only when you both choose it; if either picks your own, you each get one; then it’s fixed', () => {
  let s = T.emptyState(2026);
  s = run(s, [['aaron', { k: 'choose', m: 'shared' }]]);
  assert.strictEqual(T.modeOf(s, PEOPLE), null, 'waiting for her');
  s = run(s, [['aaron', { k: 'choose', m: 'own' }]]);
  assert.strictEqual(T.modeOf(s, PEOPLE), 'own', 'either one picking their own decides it');
  s = run(s, [['yimei', { k: 'choose', m: 'shared' }]]);
  assert.strictEqual(T.modeOf(s, PEOPLE), 'own', 'decided: later choices change nothing');
  let t = run(T.emptyState(2026), [['aaron', { k: 'choose', m: 'shared' }], ['yimei', { k: 'choose', m: 'shared' }]]);
  assert.strictEqual(T.modeOf(t, PEOPLE), 'shared');
  assert.deepStrictEqual(T.treesFor('shared', PEOPLE), ['us']);
  t = run(t, [['stranger', { k: 'choose', m: 'own' }]]);
  assert.strictEqual(T.modeOf(t, PEOPLE), 'shared', 'only the two of you count');
});

test('hanging: only your own ornaments, only on a tree that exists, and the first one on a spot keeps it', () => {
  let s = run(T.emptyState(2026), [['aaron', { k: 'choose', m: 'shared' }], ['yimei', { k: 'choose', m: 'shared' }]]);
  s = run(s, [
    ['aaron', { k: 'hang', item: 'aaron~star', tree: 'us', slot: 3 }, 2000],
    ['yimei', { k: 'hang', item: 'yimei~bell', tree: 'us', slot: 3 }, 2000],
    ['yimei', { k: 'hang', item: 'aaron~bell', tree: 'us', slot: 4 }, 2100],
    ['aaron', { k: 'hang', item: 'aaron~bell', tree: 'aaron', slot: 5 }, 2200],
    ['aaron', { k: 'hang', item: 'aaron~bauble-dots', tree: 'us', slot: 99 }, 2300],
  ]);
  const p = T.placements(s, 'us');
  assert.deepStrictEqual(p, { 3: 'aaron~star' }, 'her bell lost the race for spot 3 and went back to her box; the rest were refused');
  assert.strictEqual(T.whereIs(s, 'shared', PEOPLE, 'yimei~bell'), null);
  // Moving an ornament, then taking it down.
  s = run(s, [['aaron', { k: 'hang', item: 'aaron~star', tree: 'us', slot: 10 }, 3000]]);
  assert.deepStrictEqual(T.placements(s, 'us'), { 10: 'aaron~star' });
  s = run(s, [['yimei', { k: 'take', item: 'aaron~star' }, 3100]]);
  assert.deepStrictEqual(T.placements(s, 'us'), { 10: 'aaron~star' }, 'only whoever owns it can take it down');
  s = run(s, [['aaron', { k: 'take', item: 'aaron~star' }, 3200]]);
  assert.deepStrictEqual(T.placements(s, 'us'), {});
});

test('two trees: you can hang a gift on theirs', () => {
  let s = run(T.emptyState(2026), [['yimei', { k: 'choose', m: 'own' }]]);
  s = run(s, [
    ['aaron', { k: 'hang', item: 'aaron~heart-left', tree: 'yimei', slot: 20 }],
    ['yimei', { k: 'hang', item: 'yimei~heart-right', tree: 'yimei', slot: 21 }],
    ['aaron', { k: 'hang', item: 'aaron~star', tree: 'us', slot: 1 }],
  ]);
  assert.deepStrictEqual(T.placements(s, 'yimei'), { 20: 'aaron~heart-left', 21: 'yimei~heart-right' });
  assert.deepStrictEqual(T.placements(s, 'us'), {}, 'no shared tree in this mode');
});

test('styles: only the owner restyles an ornament, a shared tree takes styles from either of you, junk is dropped', () => {
  let s = run(T.emptyState(2026), [['aaron', { k: 'choose', m: 'shared' }], ['yimei', { k: 'choose', m: 'shared' }]]);
  s = run(s, [
    ['aaron', { k: 'style', item: 'aaron~star', style: { p: 'navy', a: 'gold', fin: 'glitter', size: 'l', evil: 1 } }, 2000],
    ['yimei', { k: 'style', item: 'aaron~star', style: { p: 'pink' } }, 2100],
    ['aaron', { k: 'style', item: 'aaron~bell', style: { p: 'not-a-colour' } }, 2200],
    ['yimei', { k: 'treestyle', tree: 'us', style: { color: 'pink', lights: 'warm', topper: 'heart', garland: 'glitter-cannon' } }, 2300],
  ]);
  assert.deepStrictEqual(s.styles['aaron~star'].s, { p: 'navy', a: 'gold', fin: 'glitter', size: 'l' }, 'his style, her change refused, unknown keys gone');
  assert.deepStrictEqual(s.styles['aaron~bell'].s, {}, 'an unknown colour is simply left out');
  assert.deepStrictEqual(s.treeStyles.us.s, { color: 'pink', lights: 'warm', topper: 'heart' });
  // Two trees: only your own.
  let o = run(T.emptyState(2026), [['aaron', { k: 'choose', m: 'own' }]]);
  o = run(o, [['aaron', { k: 'treestyle', tree: 'yimei', style: { color: 'gold' } }], ['aaron', { k: 'treestyle', tree: 'aaron', style: { color: 'gold' } }]]);
  assert.deepStrictEqual(Object.keys(o.treeStyles), ['aaron']);
  // Merging keeps the newest style.
  const later = run(s, [['aaron', { k: 'style', item: 'aaron~star', style: { p: 'mint' } }, 9000]]);
  assert.deepStrictEqual(T.merge(s, later, PEOPLE).styles['aaron~star'].s, { p: 'mint' });
  assert.deepStrictEqual(T.merge(later, s, PEOPLE).styles['aaron~star'].s, { p: 'mint' });
  const dirty = JSON.parse(JSON.stringify(later));
  dirty.styles['../x~star'] = { s: { p: 'red' }, t: [1, 'x'] };
  dirty.treeStyles.nowhere = { s: { color: 'pink' }, t: [1, 'x'] };
  const c = T.clean(dirty, PEOPLE);
  assert.deepStrictEqual(Object.keys(c.styles).sort(), ['aaron~bell', 'aaron~star']);
  assert.deepStrictEqual(Object.keys(c.treeStyles), ['us']);
});

test('the star goes on only when you both click within 20 seconds, and stays on', () => {
  let s = T.emptyState(2026);
  s = run(s, [['aaron', { k: 'tap' }, 100_000], ['yimei', { k: 'tap' }, 125_000]]);
  assert.strictEqual(s.star, null, '25 seconds apart: missed each other');
  s = run(s, [['aaron', { k: 'tap' }, 140_000]]);
  assert.strictEqual(s.star, 140_000);
  s = run(s, [['yimei', { k: 'tap' }, 900_000]]);
  assert.strictEqual(s.star, 140_000, 'stays on');
});

test('two copies merge to the same tree whichever way round, and junk from the relay is dropped', () => {
  const base = run(T.emptyState(2026), [['aaron', { k: 'choose', m: 'shared' }, 10], ['yimei', { k: 'choose', m: 'shared' }, 20]]);
  const a = run(base, [['aaron', { k: 'hang', item: 'aaron~star', tree: 'us', slot: 2 }, 100], ['aaron', { k: 'tap' }, 500_000]]);
  const b = run(base, [['yimei', { k: 'hang', item: 'yimei~bell', tree: 'us', slot: 7 }, 150], ['yimei', { k: 'tap' }, 505_000]]);
  const ab = T.merge(a, b, PEOPLE);
  const ba = T.merge(b, a, PEOPLE);
  assert.deepStrictEqual(ab, ba);
  assert.deepStrictEqual(T.placements(ab, 'us'), { 2: 'aaron~star', 7: 'yimei~bell' });
  assert.strictEqual(ab.star, 505_000, 'their two taps met in the merge');
  assert.deepStrictEqual(T.merge(ab, ab, PEOPLE), ab);
  const dirty = JSON.parse(JSON.stringify(ab));
  dirty.items['../../evil~star'] = { tr: 'us', s: 1, t: [1, 'x'] };
  dirty.items['yimei~star'] = { tr: 'us', s: 400, t: [1, 'x'] };
  dirty.items['yimei~bell'].tr = 'somewhere';
  dirty.choice.stranger = { m: 'own', t: [1, 'x'] };
  const c = T.clean(dirty, PEOPLE);
  assert.deepStrictEqual(Object.keys(c.items), ['aaron~star']);
  assert.deepStrictEqual(Object.keys(c.choice).sort(), PEOPLE);
  assert.strictEqual(T.clean({ v: 2 }, PEOPLE), null);
});

// ---------- two apps over a fake relay ----------

function world() {
  let t = at('2026-12-15T17:00:00Z');
  const w = {
    now: () => t,
    advance(ms) {
      t += ms;
      const due = w.scheduled.filter((x) => x.at <= t);
      w.scheduled = w.scheduled.filter((x) => x.at > t);
      due.sort((a, b) => a.at - b.at).forEach((x) => x.fn());
    },
    scheduled: [],
    timers: {
      set: (fn, ms) => {
        const job = { fn, at: t + ms };
        w.scheduled.push(job);
        return job;
      },
      clear: (job) => {
        w.scheduled = w.scheduled.filter((x) => x !== job);
      },
    },
    queue: [],
    computers: [],
    messages: 0,
    deliver() {
      while (w.queue.length) {
        const e = w.queue.shift();
        for (const c of w.computers) if (c.online) c.session.onEvent(e);
      }
    },
    computer(id, device, partner, character, { tester = false, testDay = 0 } = {}) {
      const names = { aaron: 'Aaron', yimei: 'Yimei' };
      const c = { online: true, file: {}, hangs: [], stars: 0, asks: 0, invites: 0, published: [] };
      c.session = new TreeSession({
        config: () => ({ me: { id, name: names[id], character }, partner: { id: partner, name: names[partner], timezone: NY } }),
        publish: async (status, text) => {
          if (!c.online) throw new Error('offline');
          w.messages++;
          c.published.push(status);
          // Through the real tag format, so a type the relay doesn't know would fail here.
          const msg = { event: 'message', id: `n${w.messages}`, time: Math.floor(t / 1000), message: text, tags: toTags({ type: 'tree', from: id, device, status }) };
          const e = fromNtfy(msg);
          assert.ok(e, 'the relay knows the tree type');
          w.queue.push(e);
        },
        load: () => c.file,
        save: (d) => (c.file = structuredClone(d)),
        doors: () => TEST_DOORS,
        onOpen: (r) => (c.opens = [...(c.opens || []), r]),
        onHang: (h) => c.hangs.push(h),
        onStar: () => c.stars++,
        onTapAsk: () => c.asks++,
        onInvite: () => c.invites++,
        tester: () => tester,
        testDay: () => testDay,
        device,
        now: w.now,
        timers: w.timers,
        rand: () => 0.5,
      });
      w.computers.push(c);
      return c;
    },
  };
  return w;
}

// Opens doors 1..n on one computer, one at a time through the relay.
async function openDoors(w, c, n) {
  for (let d = 1; d <= n; d++) {
    const r = await c.session.act({ type: 'open', day: d });
    assert.ok(r.ok, `door ${d}: ${r.error}`);
    w.deliver();
  }
}

test('the advent doors: the same shuffled order on both apps, pins kept, and the doors file round-trips', () => {
  const contents = A.cleanContents(A.DEFAULT_CONTENTS);
  assert.strictEqual(contents.length, 29, 'November 27 to December 25');
  const a = A.order(contents, A.seedFor(['aaron', 'yimei'], 2026));
  const b = A.order(contents, A.seedFor(['yimei', 'aaron'], 2026));
  assert.deepStrictEqual(a, b, 'both apps agree');
  assert.deepStrictEqual([...a.slice(1)].sort((x, y) => x - y), [...Array(29).keys()], 'every content used once');
  assert.strictEqual(contents[a[28]].kind, 'star', 'the star on Christmas Eve');
  assert.strictEqual(contents[a[1]].item, 'locket', 'the 27 locket on November 27');
  assert.strictEqual(a[30], undefined, 'no door after Christmas Day');
  assert.notDeepStrictEqual(A.order(contents, A.seedFor(['aaron', 'yimei'], 2027)), a, 'a new order next year');
  assert.deepStrictEqual(A.decode(A.encode(contents)), contents);
  assert.ok(!A.encode(contents).includes('note'), 'not readable at a glance');
  assert.strictEqual(A.decode('nonsense'), null);
  const messy = A.cleanContents([{ kind: 'ornament', item: 'nope' }, { kind: 'note', text: 'x', pin: 40 }, { kind: 'snow', pin: 3 }, { kind: 'snow', pin: 3 }, null], ['bell']);
  assert.strictEqual(messy.length, 29);
  assert.deepStrictEqual(messy.slice(0, 3).map((c) => [c.kind, c.pin]), [['note', undefined], ['snow', 3], ['snow', undefined]], 'bad items dropped, a day pinned only once');
  const kinds = A.ornamentsFrom([{ kind: 'ornament', item: 'heart-half' }, { kind: 'ornament', item: 'bell', more: ['goose', 'heart-half'] }, { kind: 'note' }], [0, 0, 1, 2], [1, 2, 3], 'heart-right');
  assert.deepStrictEqual([...kinds].sort(), ['bell', 'goose', 'heart-right'], 'Santa’s extras count too');
});

test('the default doors: 29, the locket on Nov 27, the lights on Nov 28, every ornament and animal, extras from Santa', () => {
  const contents = A.cleanContents(A.DEFAULT_CONTENTS, Object.keys(T.KINDS).concat('heart-half'));
  assert.strictEqual(contents.length, 29);
  const byDay = A.order(contents, A.seedFor(['aaron', 'yimei'], 2026));
  assert.strictEqual(contents[byDay[1]].item, 'locket', 'Nov 27 stays the locket (already opened)');
  assert.strictEqual(contents[byDay[2]].kind, 'lights', 'Nov 28 is the lights');
  assert.strictEqual(A.lightsDay(contents, byDay), 2);
  assert.strictEqual(contents[byDay[28]].kind, 'star');
  const given = contents.flatMap((c) => (c.kind === 'ornament' ? [c.item, ...(c.more || [])] : []));
  assert.strictEqual(new Set(given).size, given.length, 'nothing twice');
  const all = Object.keys(T.KINDS).filter((k) => !k.startsWith('heart-')).concat('heart-half');
  assert.deepStrictEqual([...given].sort(), all.sort(), 'every ornament and animal is behind some door');
  assert.ok(contents.filter((c) => c.more?.length).length >= 10, 'plenty of doors with a second surprise');
  // extras: known, each once, never the door's own, at most 3
  const [m] = A.cleanContents([{ kind: 'ornament', item: 'bell', more: ['bell', 'goose', 'goose', 'nope', 'penguin', 'rudolph', 'holly'] }], Object.keys(T.KINDS));
  assert.deepStrictEqual(m.more, ['goose', 'penguin', 'rudolph']);
  assert.strictEqual(A.cleanContents([{ kind: 'ornament', item: 'bell', more: [] }])[0].more, undefined);
});

test('little animals sit round the tree skirt, ornaments hang on the branches', () => {
  assert.strictEqual(T.isSkirt('goose'), true);
  assert.strictEqual(T.isSkirt('bell'), false);
  assert.ok(T.slotFits('goose', 36) && T.slotFits('goose', 36 + T.SKIRT - 1));
  assert.ok(!T.slotFits('goose', 5) && !T.slotFits('goose', 36 + T.SKIRT));
  assert.ok(T.slotFits('bell', 35) && !T.slotFits('bell', 36));
  let s = run(T.emptyState(2026), [['aaron', { k: 'choose', m: 'shared' }], ['yimei', { k: 'choose', m: 'shared' }]]);
  s = run(s, [
    ['aaron', { k: 'hang', item: 'aaron~goose', tree: 'us', slot: 37 }, 2000],
    ['yimei', { k: 'hang', item: 'yimei~penguin', tree: 'us', slot: 4 }, 2100],
    ['yimei', { k: 'hang', item: 'yimei~bell', tree: 'us', slot: 38 }, 2200],
  ]);
  assert.deepStrictEqual(T.placements(s, 'us'), { 37: 'aaron~goose' }, 'an animal on a branch and a bell on the skirt are refused');
  const back = T.clean(JSON.parse(JSON.stringify(s)), PEOPLE);
  assert.deepStrictEqual(T.placements(back, 'us'), { 37: 'aaron~goose' }, 'skirt spots survive the relay');
  const junk = T.clean({ ...s, items: { ...s.items, 'yimei~rudolph': { tr: 'us', s: 3, t: [3000, 'x'] } } }, PEOPLE);
  assert.strictEqual(junk.items['yimei~rudolph'], undefined);
});

test('two apps: the lights door lights your tree, and Santa brings more surprises', async () => {
  const w = world(); // Dec 15
  const doors = () => A.DEFAULT_CONTENTS;
  const a = w.computer('aaron', 'pc', 'yimei', 'brown');
  const y = w.computer('yimei', 'mac', 'aaron', 'cream');
  a.session.doors = doors;
  y.session.doors = doors;
  await y.session.act({ type: 'choose', mode: 'own' });
  w.deliver();
  assert.strictEqual(a.session.lightsUp('aaron'), false, 'no lights until the door is open, even on Dec 15');
  assert.strictEqual(a.session.view().trees[0].lightsUp, false);
  await a.session.act({ type: 'open', day: 2 });
  w.deliver();
  assert.strictEqual(a.opens[0].kind, 'lights');
  assert.strictEqual(a.opens[0].title, 'The tree lights ✨');
  assert.strictEqual(a.session.lightsUp('aaron'), true, 'his tree has its lights');
  assert.strictEqual(a.session.lightsUp('yimei'), false, 'hers waits for her door');
  assert.strictEqual(y.session.lightsUp('aaron'), true, 'the same on her computer');
  assert.strictEqual(a.session.lightsUp('us'), true, 'a shared tree: either of you');
  // A door with two things behind it.
  const { contents, byDay } = a.session.calendar();
  const d = [...Array(19).keys()].map((i) => i + 1).find((n) => contents[byDay[n]].more?.some(T.isSkirt));
  assert.ok(d, 'some door before Dec 15 has a little animal from Santa');
  await a.session.act({ type: 'open', day: d });
  w.deliver();
  const r = a.opens.at(-1);
  assert.ok(r.more.length >= 1 && r.more.length <= A.MORE);
  assert.ok(r.more[0].name && r.more[0].emoji);
  const box = a.session.view().box.map((o) => o.kind);
  assert.ok(box.includes(r.item) && r.more.every((m) => box.includes(m.item)), 'all of them are in the box');
  const animal = a.session.view().box.find((o) => T.isSkirt(o.kind));
  assert.strictEqual((await a.session.act({ type: 'hang', item: animal.id, tree: 'aaron', slot: 3 })).error, 'The little animals sit round the tree skirt.');
  assert.ok((await a.session.act({ type: 'hang', item: animal.id, tree: 'aaron', slot: 40 })).ok);
  w.deliver();
  assert.ok(a.session.view().trees[0].orns.some((o) => o.slot === 40 && o.kind === animal.kind));
});

test('two apps: doors open at your own midnight, fill your box, and sync to your other computer', async () => {
  const w = world(); // Dec 15, noon in New York
  const a = w.computer('aaron', 'pc', 'yimei', 'brown');
  const a2 = w.computer('aaron', 'laptop', 'yimei', 'brown');
  const y = w.computer('yimei', 'mac', 'aaron', 'cream');
  assert.strictEqual(a.session.view().calendar.today, 19, 'Dec 15 is season day 19');
  assert.strictEqual(a.session.view().box.length, 0, 'nothing until a door is opened');
  assert.strictEqual((await a.session.act({ type: 'open', day: 20 })).error, 'Door 16 opens on December 16.');
  await a.session.act({ type: 'open', day: 6 });
  w.deliver();
  assert.strictEqual(a.opens.length, 1);
  assert.strictEqual(a.opens[0].item, 'bell');
  assert.strictEqual(a2.opens, undefined, 'the reward shows on the computer that opened it');
  assert.ok(a2.session.view().calendar.doors[5].opened, 'my other computer knows it’s open');
  assert.deepStrictEqual(a.session.view().box.map((o) => o.id), ['aaron~bell']);
  assert.ok(y.session.view().calendar.doors[5].theyOpened && !y.session.view().calendar.doors[5].opened, 'hers is still closed');
  assert.strictEqual((await a.session.act({ type: 'open', day: 6 })).error, 'You’ve opened that one.');
  // The heart door gives each of you your own half.
  await openDoors(w, y, 15);
  const yv = y.session.view();
  assert.strictEqual(yv.box.length, 15);
  const heartDoor = yv.calendar.doors.find((d) => d.reward?.item?.startsWith('heart-'));
  assert.strictEqual(heartDoor, undefined, 'the heart door is day 17, not open yet');
});

test('the calendar ends on Christmas Day: 29 doors, nothing new after the 25th', async () => {
  const w = world();
  const a = w.computer('aaron', 'pc', 'yimei', 'brown', { tester: true, testDay: 32 }); // Dec 28
  const cal = a.session.view().calendar;
  assert.strictEqual(cal.doors.length, 29);
  assert.strictEqual(cal.today, 29, 'Dec 28 still counts as the last door');
  assert.strictEqual((await a.session.act({ type: 'open', day: 30 })).error, 'That isn’t a door.');
  assert.ok((await a.session.act({ type: 'open', day: 29 })).ok);
});

test('the Christmas demo: the pretend partner hangs one of their own ornaments on a free spot of my tree', async () => {
  const w = world();
  const a = w.computer('aaron', 'pc', 'yimei', 'brown', { tester: true, testDay: 12 });
  const y = w.computer('yimei', 'mac', 'aaron', 'cream', { tester: true, testDay: 12 });
  assert.strictEqual(a.session.view().demo, false);
  assert.strictEqual(a.session.partnerHangOp(), null, 'no trees chosen yet');
  await openDoors(w, a, 10);
  await openDoors(w, y, 10);
  await a.session.act({ type: 'choose', mode: 'own' });
  w.deliver();
  const op = a.session.partnerHangOp();
  assert.ok(op, 'she has ornaments to hang');
  assert.strictEqual(op.tree, 'aaron', 'own trees: it goes on mine, as a gift');
  assert.ok(op.item.startsWith('yimei~'));
  assert.ok(T.slotFits(T.parseItem(op.item).kind, op.slot), 'a spot of the right sort');
  a.session.onEvent({ type: 'tree', from: 'yimei', device: 'demo', status: 'op', text: JSON.stringify(op), at: w.now(), id: 'demo1' });
  assert.strictEqual(a.hangs.length, 1, 'her bear brings it over');
  assert.ok(a.session.view().trees[0].orns.some((o) => o.id === op.item));
});

test('two apps: an invite, one shared tree, and their bear brings over what they hang', async () => {
  const w = world();
  const a = w.computer('aaron', 'pc', 'yimei', 'brown');
  const y = w.computer('yimei', 'mac', 'aaron', 'cream');
  await openDoors(w, a, 15);
  await openDoors(w, y, 15);
  assert.strictEqual(a.session.view().stage, 'garland');
  assert.strictEqual(a.session.lightsUp('us'), true, 'no lights door: the lights are up by Dec 14');
  await a.session.act({ type: 'choose', mode: 'shared' });
  w.deliver();
  assert.strictEqual(y.invites, 1, 'she gets asked');
  assert.strictEqual(a.session.view().mode, null);
  await y.session.act({ type: 'choose', mode: 'shared' });
  w.deliver();
  assert.strictEqual(a.session.view().mode, 'shared');
  assert.strictEqual(y.session.view().trees[0].name, 'Aaron & Yimei’s Tree');
  assert.strictEqual(a.session.view().trees[0].name, 'Aaron & Yimei’s Tree', 'the same name on both computers');

  // Not hers to hang, and not a free spot.
  assert.strictEqual((await y.session.act({ type: 'hang', item: 'aaron~star', tree: 'us', slot: 1 })).ok, false);
  const r = await y.session.act({ type: 'hang', item: 'yimei~bell', tree: 'us', slot: 9 });
  assert.ok(r.ok);
  assert.strictEqual(y.session.view().pending, true, 'counts once it’s back from the relay');
  w.deliver();
  assert.strictEqual(y.session.view().pending, false);
  assert.strictEqual(a.hangs.length, 1);
  assert.strictEqual(a.hangs[0].kind, 'bell');
  assert.strictEqual(a.hangs[0].onMine, true);
  assert.deepStrictEqual(a.hangs[0].before.orns, []);
  assert.strictEqual(a.hangs[0].after.orns[0].slot, 9);
  assert.strictEqual(y.hangs.length, 0, 'your own hang doesn’t bring your own bear');
  assert.strictEqual((await a.session.act({ type: 'hang', item: 'aaron~star', tree: 'us', slot: 9 })).error, 'Something’s already hanging there.');
  assert.ok(!a.session.view().box.some((o) => o.id === 'yimei~bell'));
  assert.ok(a.session.view().box.some((o) => o.id === 'aaron~star'));
});

test('before December 1 a tester decorates a practice tree that only other testers see, and it’s gone on December 1', async () => {
  const w = world();
  w.advance(at('2026-11-26T19:00:00Z') - w.now());
  const a = w.computer('aaron', 'pc', 'yimei', 'brown', { tester: true, testDay: 15 });
  const y = w.computer('yimei', 'mac', 'aaron', 'cream');
  const t = w.computer('aaron', 'laptop', 'yimei', 'brown', { tester: true, testDay: 15 });
  assert.strictEqual(a.session.view().practice, true);
  assert.strictEqual(y.session.visible(), false, 'her tab is still hidden');
  assert.ok((await a.session.act({ type: 'choose', mode: 'own' })).ok);
  w.deliver();
  assert.strictEqual(y.session.cur().choice.aaron, undefined, 'her app ignores the practice tree');
  assert.strictEqual(y.invites, 0);
  assert.strictEqual(t.session.cur().choice.aaron?.m, 'own', 'another tester computer follows it');
  w.advance(at('2026-12-01T06:00:00Z') - w.now());
  assert.strictEqual(a.session.view().practice, false);
  assert.strictEqual(a.session.view().mode, null, 'the real tree starts with nothing chosen');
});

test('two apps: the star on Christmas Eve, and catching up after being offline', async () => {
  const w = world();
  const a = w.computer('aaron', 'pc', 'yimei', 'brown');
  const y = w.computer('yimei', 'mac', 'aaron', 'cream');
  await openDoors(w, a, 15);
  await a.session.act({ type: 'choose', mode: 'own' });
  w.deliver();
  assert.strictEqual(y.session.view().mode, 'own');
  assert.deepStrictEqual(a.session.view().trees.map((t) => t.tree), ['aaron', 'yimei'], 'my tree first');
  assert.strictEqual((await a.session.act({ type: 'tap' })).ok, false, 'not before Christmas Eve');

  // She's offline while he hangs a gift on her tree; the relay forgets it; she catches up when she's back.
  y.online = false;
  await a.session.act({ type: 'hang', item: 'aaron~plane', tree: 'yimei', slot: 30 });
  w.deliver();
  y.online = true;
  y.session.onConnected();
  w.deliver();
  w.advance(2000);
  w.deliver();
  assert.deepStrictEqual(Object.values(T.placements(y.session.cur(), 'yimei')), ['aaron~plane']);
  assert.strictEqual(T.fingerprint(y.session.cur()), T.fingerprint(a.session.cur()));

  w.advance(9 * 86_400_000); // Dec 24
  assert.strictEqual(a.session.view().starDay, true);
  await a.session.act({ type: 'tap' });
  w.deliver();
  assert.strictEqual(y.asks, 1, 'she is asked to click too');
  w.advance(12_000);
  await y.session.act({ type: 'tap' });
  w.deliver();
  assert.strictEqual(a.stars, 1);
  assert.strictEqual(y.stars, 1);
  assert.ok(a.session.view().trees.every((t) => t.star));
});
