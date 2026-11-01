// Holiday modes: a few hours when the app dresses up (Halloween: candy game, ghost bears, spooky window). Each has
// a window of local time that comes back every year. The tray menu can switch a mode on or off by hand; that choice
// counts for the rest of that year, then it's back to the dates. No Electron here.

// Months are 0-based (9 = October). Halloween: Oct 30 at 23:59 until Oct 31 at 15:59, on each computer's own clock.
const HOLIDAYS = {
  halloween: { start: [9, 30, 23, 59], end: [9, 31, 15, 59] },
};

function window(name, year) {
  const h = HOLIDAYS[name];
  const at = ([m, d, hh, mm]) => new Date(year, m, d, hh, mm).getTime();
  return { start: at(h.start), end: at(h.end) };
}

function inWindow(name, now = Date.now()) {
  const w = window(name, new Date(now).getFullYear());
  return now >= w.start && now < w.end;
}

// Has it begun this year? Before that, nothing of it shows (not even the menu switch), so nobody finds it early.
function started(name, now = Date.now()) {
  return now >= window(name, new Date(now).getFullYear()).start;
}

// Is this year's window over? From then until New Year it's off and hidden: back to normal use.
function ended(name, now = Date.now()) {
  return now >= window(name, new Date(now).getFullYear()).end;
}

// setting: undefined (follow the dates) or { mode: 'on' | 'off', year } from the tray menu. Switching it on by hand
// works until this year's window ends (before it, to try it out); after that it stays off until next year.
function isOn(name, setting, now = Date.now()) {
  if (ended(name, now)) return false;
  if (setting?.mode && setting.year === new Date(now).getFullYear()) return setting.mode === 'on';
  return inWindow(name, now);
}

// What the tray toggle stores: the opposite of now, for this year. Turning it off outside the dates just goes back
// to following them (which is off).
function toggled(name, setting, now = Date.now()) {
  const year = new Date(now).getFullYear();
  if (ended(name, now)) return null;
  if (!isOn(name, setting, now)) return { mode: 'on', year };
  return inWindow(name, now) ? { mode: 'off', year } : null;
}

// When the next random "trick or treat" bear comes by: 10 to 20 minutes from now.
const nextAskIn = (rand = Math.random) => Math.round((10 + rand() * 10) * 60_000);

// ---- the candy recap, for the two weeks after Halloween ----

const RECAP_DAYS = 14;

// Halloween is over and it's still within two weeks of it: time for the candy recap.
function recapTime(name, now = Date.now()) {
  const w = window(name, new Date(now).getFullYear());
  // Calendar days, not 24-hour blocks: the clocks change in early November.
  const until = new Date(w.end);
  until.setDate(until.getDate() + RECAP_DAYS);
  return now >= w.end && now < until.getTime();
}

// How many candies were given on this computer this year: the log's "[candy] given" lines (not the tester's
// "[candy-test]" games, not "not given").
function countCandyGiven(lines, year) {
  return lines.filter((l) => l.startsWith(`${year}-`) && / \[candy\] given\b/.test(l)).length;
}

function candies(n) {
  return `${n} cand${n === 1 ? 'y' : 'ies'}`;
}

function candyRecapText(me, them, mine, theirs) {
  return `${me} gave ${them} ${candies(mine)} · ${them} gave ${me} ${candies(theirs)}`;
}

module.exports = { HOLIDAYS, inWindow, started, ended, isOn, toggled, nextAskIn, recapTime, countCandyGiven, candyRecapText, holidayWindow: window };
