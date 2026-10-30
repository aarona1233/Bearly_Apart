const test = require('node:test');
const assert = require('node:assert');
const { inWindow, started, isOn, toggled, nextAskIn } = require('../src/main/holiday');
const { toTags, fromNtfy } = require('../src/main/relay');

const at = (m, d, h, min) => new Date(2026, m, d, h, min).getTime();

test('Halloween runs from Oct 30 23:59 to Oct 31 15:59, local time, every year', () => {
  assert.strictEqual(inWindow('halloween', at(9, 30, 23, 58)), false);
  assert.strictEqual(inWindow('halloween', at(9, 30, 23, 59)), true);
  assert.strictEqual(inWindow('halloween', at(9, 31, 12, 0)), true);
  assert.strictEqual(inWindow('halloween', at(9, 31, 15, 58)), true);
  assert.strictEqual(inWindow('halloween', at(9, 31, 15, 59)), false);
  assert.strictEqual(inWindow('halloween', new Date(2027, 9, 31, 9, 0).getTime()), true, 'next year too');
  assert.strictEqual(inWindow('halloween', at(6, 4, 12, 0)), false);
});

test('the menu switch: on outside the dates sticks, off during them sticks, both only for that year', () => {
  const july = at(6, 4, 12, 0);
  const halloweenDay = at(9, 31, 10, 0);
  // Switched on in July: on, and stays on after the dates.
  const on = toggled('halloween', undefined, july);
  assert.deepStrictEqual(on, { mode: 'on', year: 2026 });
  assert.strictEqual(isOn('halloween', on, july), true);
  assert.strictEqual(isOn('halloween', on, at(10, 2, 9, 0)), true);
  // Next year it follows the dates again.
  assert.strictEqual(isOn('halloween', on, new Date(2027, 6, 4).getTime()), false);
  // Switched off on Halloween: off for the rest of it.
  const off = toggled('halloween', undefined, halloweenDay);
  assert.deepStrictEqual(off, { mode: 'off', year: 2026 });
  assert.strictEqual(isOn('halloween', off, halloweenDay), false);
  // Switched off again outside the dates: back to following them.
  assert.strictEqual(toggled('halloween', on, july), null);
});

test('Halloween has "started" from Oct 30 23:59 to the end of the year (when the menu switch shows)', () => {
  assert.strictEqual(started('halloween', at(9, 30, 23, 58)), false);
  assert.strictEqual(started('halloween', at(9, 30, 23, 59)), true);
  assert.strictEqual(started('halloween', at(11, 25, 9, 0)), true);
  assert.strictEqual(started('halloween', new Date(2027, 0, 2).getTime()), false, 'not in January');
});

test('random trick-or-treaters come every 10 to 20 minutes', () => {
  assert.strictEqual(nextAskIn(() => 0), 10 * 60_000);
  assert.strictEqual(nextAskIn(() => 1), 20 * 60_000);
  for (let i = 0; i < 50; i++) {
    const ms = nextAskIn();
    assert.ok(ms >= 10 * 60_000 && ms <= 20 * 60_000);
  }
});

test('candy and treat travel over the relay', () => {
  for (const type of ['candy', 'treat']) assert.strictEqual(fromNtfy({ event: 'message', id: '1', time: 1, message: 'x', tags: toTags({ type, from: 'aaron' }) }).type, type);
});
