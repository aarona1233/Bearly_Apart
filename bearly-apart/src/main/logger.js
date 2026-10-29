// The app's log: printed as before, and also kept in bearly-apart.log in the settings folder, so a problem on a
// computer nobody here can look at (her Mac) can be read later, or sent along with a diagnostics report.
// One file of up to 1 MB plus the previous one (.old). No Electron here.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;

// One log line per entry (so "the last 60 lines" are 60 entries): an error's message plus where it came from.
function oneLine(err) {
  const frames = String(err.stack || '')
    .split('\n')
    .slice(1, 4)
    .map((f) => f.trim().replace(/^at /, ''));
  return `${err.name || 'Error'}: ${err.message}${frames.length ? ` (at ${frames.join(' ← ')})` : ''}`;
}

// Splits the newest log lines into at most maxParts pieces of up to maxBytes (UTF-8) each, oldest first, so they
// fit in relay messages (ntfy.sh turns anything over 4 KB into an attachment the app can't read). Older lines that
// don't fit are left out; a single line that's too long is cut short.
function packLog(lines, { maxBytes = 3500, maxParts = 4 } = {}) {
  const limit = maxBytes - 1; // room for the newline
  const fit = (s) => {
    if (Buffer.byteLength(s) <= limit) return s;
    let t = s.slice(0, limit);
    while (Buffer.byteLength(t) > limit - 3) t = t.slice(0, -1);
    return `${t}…`;
  };
  const pieces = [];
  let cur = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = fit(lines[i]);
    const n = Buffer.byteLength(line) + 1;
    if (size + n > maxBytes) {
      if (pieces.length + 1 >= maxParts) break;
      pieces.push(cur);
      cur = [];
      size = 0;
    }
    cur.unshift(line);
    size += n;
  }
  if (cur.length) pieces.push(cur);
  return pieces.reverse().map((p) => p.join('\n'));
}

function createLogger({ print = console.log, now = () => new Date() } = {}) {
  let file = null;
  let early = []; // lines logged before the file was known

  function write(line) {
    if (!file) {
      early.push(line);
      if (early.length > 500) early.shift();
      return;
    }
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
      fs.appendFileSync(file, `${line}\n`);
    } catch {
      /* a log that can't be written must never break the app */
    }
  }

  function log(...parts) {
    const t = now();
    print(t.toISOString().slice(11, 19), ...parts);
    const text = parts.map((p) => (p instanceof Error ? oneLine(p) : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    write(`${t.toISOString()} ${text}`);
  }

  log.setFile = (f) => {
    file = f;
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
    } catch {
      /* write() copes */
    }
    const pending = early;
    early = [];
    for (const line of pending) write(line);
  };

  log.file = () => file;

  // The last n lines (from the current file, topped up from .old if it's short).
  log.tail = (n = 60) => {
    const read = (f) => {
      try {
        return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
      } catch {
        return [];
      }
    };
    if (!file) return early.slice(-n);
    let lines = read(file);
    if (lines.length < n) lines = [...read(`${file}.old`), ...lines];
    return lines.slice(-n);
  };

  return log;
}

module.exports = { createLogger, packLog, MAX_BYTES };
