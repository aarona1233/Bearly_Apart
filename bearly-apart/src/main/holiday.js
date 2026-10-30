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

// setting: undefined (follow the dates) or { mode: 'on' | 'off', year } from the tray menu.
function isOn(name, setting, now = Date.now()) {
  if (setting?.mode && setting.year === new Date(now).getFullYear()) return setting.mode === 'on';
  return inWindow(name, now);
}

// What the tray toggle stores: the opposite of now, for this year. Turning it off outside the dates just goes back
// to following them (which is off).
function toggled(name, setting, now = Date.now()) {
  const year = new Date(now).getFullYear();
  if (!isOn(name, setting, now)) return { mode: 'on', year };
  return inWindow(name, now) ? { mode: 'off', year } : null;
}

// When the next random "trick or treat" bear comes by: 10 to 20 minutes from now.
const nextAskIn = (rand = Math.random) => Math.round((10 + rand() * 10) * 60_000);

module.exports = { HOLIDAYS, inWindow, started, isOn, toggled, nextAskIn, holidayWindow: window };
