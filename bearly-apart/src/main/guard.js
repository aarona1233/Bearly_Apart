// Decides whether it's OK to throw a bear on screen right now, and finds the front window
// so scenes like the sword drag can walk along it.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(cmd, args, timeout = 3000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

// JXA: bounds come from CGWindowList, which needs no Screen Recording permission
// (only window *titles* do). The list is ordered front-to-back.
const FRONT_WINDOW_JXA = `
ObjC.import('CoreGraphics'); ObjC.import('AppKit');
const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
const pid = app.processIdentifier;
const name = ObjC.unwrap(app.localizedName);
const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
const w = list.find(w => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 &&
                         w.kCGWindowBounds && w.kCGWindowBounds.Width > 120 && w.kCGWindowBounds.Height > 80);
JSON.stringify({ app: name, bounds: w ? { x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y,
  width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height } : null });
`;

async function frontWindow() {
  if (process.platform !== 'darwin') return null;
  const out = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FRONT_WINDOW_JXA]);
  try {
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

// Manually enabled Focus modes (Do Not Disturb, Work, ...) are listed here. Readable thanks
// to the Full Disk Access the iMessage watcher already needs; scheduled Focus isn't covered.
function focusActive() {
  if (process.platform !== 'darwin') return false;
  try {
    const file = path.join(os.homedir(), 'Library', 'DoNotDisturb', 'DB', 'Assertions.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (data.data || []).some((d) => (d.storeAssertionRecords || []).length > 0);
  } catch {
    return false;
  }
}

async function screenSharing() {
  if (process.platform !== 'darwin') return false;
  // Zoom's share helper only runs while a share is active.
  const out = await run('/usr/bin/pgrep', ['-x', 'CptHost']);
  return !!out;
}

function minutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function inRange(range, date = new Date()) {
  const start = minutes(range?.start);
  const end = minutes(range?.end);
  if (start === null || end === null || start === end) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

// Local wall-clock time in another zone, as a Date whose getHours() reads that zone's hour.
function timeInZone(zone, date = new Date()) {
  if (!zone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date);
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    const d = new Date(date);
    d.setHours(get('hour'), get('minute'));
    return d;
  } catch {
    return null;
  }
}

class Guard {
  constructor({ getConfig, getState, powerMonitor, screen }) {
    this.getConfig = getConfig;
    this.getState = getState;
    this.powerMonitor = powerMonitor;
    this.screen = screen;
    this.locked = false;
  }

  // Returns { ok, reason, front } — front is the front window info when known.
  async check() {
    const cfg = this.getConfig();
    const st = this.getState();
    if (st.snoozedUntil > Date.now()) return { ok: false, reason: 'snoozed' };
    if (this.locked) return { ok: false, reason: 'locked' };
    if (inRange(cfg.quietHours)) return { ok: false, reason: 'quiet-hours' };
    const idle = this.powerMonitor?.getSystemIdleTime?.() ?? 0;
    if (idle > cfg.awayAfterSec) return { ok: false, reason: 'away' };
    if (cfg.respectFocus && focusActive()) return { ok: false, reason: 'focus' };
    if (await screenSharing()) return { ok: false, reason: 'screen-share' };
    const front = await frontWindow();
    if (front?.app && cfg.pauseApps.some((a) => a.toLowerCase() === front.app.toLowerCase())) {
      return { ok: false, reason: `app:${front.app}` };
    }
    if (cfg.pauseWhenFullscreen && front?.bounds && this.screen) {
      const d = this.screen.getDisplayMatching(front.bounds).bounds;
      const b = front.bounds;
      if (b.x <= d.x && b.y <= d.y && b.width >= d.width && b.height >= d.height) return { ok: false, reason: 'fullscreen' };
    }
    return { ok: true, front };
  }
}

module.exports = { Guard, frontWindow, focusActive, inRange, minutes, timeInZone };
