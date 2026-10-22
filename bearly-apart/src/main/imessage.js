// Watches the Mac's local iMessage database (~/Library/Messages/chat.db) for texts to/from
// the partner. Read-only; needs Full Disk Access for the app. Nothing here sends iMessages.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULT_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

// Tapback codes in message.associated_message_type (3000+ = tapback removed).
const TAPBACKS = { 2000: 'love', 2001: 'like', 2002: 'dislike', 2003: 'laugh', 2004: 'emphasize', 2005: 'question', 2006: 'emoji' };

function normalizeHandle(h) {
  const s = String(h || '').trim().toLowerCase();
  if (s.includes('@')) return s;
  const digits = s.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Newer macOS stores message text only inside `attributedBody`, an NSAttributedString in
// Apple's "typedstream" format. The plain string follows the NSString class marker as
// '+' <length> <utf8 bytes>, where length is 1 byte, or 0x81 + uint16 LE, or 0x82 + uint32 LE.
function decodeAttributedBody(buf) {
  if (!buf || !buf.length) return '';
  buf = Buffer.from(buf);
  const marker = buf.indexOf('NSString');
  if (marker < 0) return '';
  let i = buf.indexOf(0x2b, marker + 8); // '+'
  if (i < 0 || i > marker + 20) return '';
  i += 1;
  let len = buf[i];
  i += 1;
  if (len === 0x81) {
    len = buf.readUInt16LE(i);
    i += 2;
  } else if (len === 0x82) {
    len = buf.readUInt32LE(i);
    i += 4;
  }
  return buf.subarray(i, i + len).toString('utf8');
}

// Apple timestamps count from 2001-01-01. The query below converts them to milliseconds in SQL,
// because modern nanosecond values (~8e17) are too big for a JS number.
const APPLE_EPOCH_MS = 978307200000;
function appleDateToMs(msSince2001) {
  return Math.round(Number(msSince2001) || 0) + APPLE_EPOCH_MS;
}

function matchKeywords(text, keywords) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = new Set();
  for (const [phrase, name] of Object.entries(keywords || {})) {
    const p = phrase.toLowerCase();
    if (/^[\p{L}\p{N} '’]+$/u.test(p)) {
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(lower)) found.add(name);
    } else if (lower.includes(p)) {
      found.add(name); // emoji / symbols
    }
  }
  return [...found];
}

const QUERY = `
  SELECT m.ROWID AS rowid, m.text AS text, m.attributedBody AS body, m.is_from_me AS fromMe,
         CASE WHEN m.date > 100000000000 THEN m.date / 1000000 ELSE m.date * 1000 END AS date,
         m.associated_message_type AS assocType, m.item_type AS itemType,
         m.cache_has_attachments AS hasAttachments, h.id AS handle, c.chat_identifier AS chatId,
         c.style AS chatStyle
  FROM message m
  LEFT JOIN handle h ON h.ROWID = m.handle_id
  LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  LEFT JOIN chat c ON c.ROWID = cmj.chat_id
  WHERE m.ROWID > ?
  ORDER BY m.ROWID
  LIMIT 500`;

class IMessageWatcher extends EventEmitter {
  constructor({ getConfig, getLastRowId, setLastRowId, dbPath = DEFAULT_DB, log = console.log }) {
    super();
    this.getConfig = getConfig;
    this.getLastRowId = getLastRowId;
    this.setLastRowId = setLastRowId;
    this.dbPath = dbPath;
    this.log = log;
    this.timer = null;
    this.fsWatcher = null;
    this.db = null; // one read-only connection, kept open between polls
    this.query = null;
    this.status = 'stopped'; // stopped | ok | no-access | missing
  }

  open() {
    const { DatabaseSync } = require('node:sqlite');
    // Opening read-only still lets SQLite read the -wal file that Messages writes to.
    return new DatabaseSync(this.dbPath, { readOnly: true });
  }

  setStatus(s) {
    if (s !== this.status) {
      this.status = s;
      this.emit('status', s);
    }
  }

  start() {
    this.stop();
    if (!fs.existsSync(this.dbPath)) {
      this.setStatus('missing');
      return;
    }
    try {
      const db = this.open();
      if (!this.getLastRowId()) {
        // Don't replay years of history on first launch.
        const row = db.prepare('SELECT MAX(ROWID) AS max FROM message').get();
        this.setLastRowId(row?.max || 0);
      }
      db.close();
      this.setStatus('ok');
    } catch (err) {
      // "authorization denied" / "unable to open" = Full Disk Access not granted yet.
      this.log(`[imessage] cannot open chat.db: ${err.message}`);
      this.setStatus('no-access');
      this.timer = setTimeout(() => this.start(), 30_000);
      return;
    }
    const pollMs = Math.max(1, this.getConfig().imessage.pollSec) * 1000;
    this.timer = setInterval(() => this.poll(), pollMs);
    try {
      // The WAL file changes the moment a message lands, so react faster than the poll.
      this.fsWatcher = fs.watch(path.dirname(this.dbPath), (_, file) => {
        if (file && !String(file).startsWith('chat.db')) return;
        clearTimeout(this.pending);
        this.pending = setTimeout(() => this.poll(), 250);
      });
    } catch {
      /* polling alone is fine */
    }
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.timer);
    clearTimeout(this.pending);
    this.fsWatcher?.close();
    this.fsWatcher = null;
    this.closeDb();
    this.setStatus('stopped');
  }

  closeDb() {
    try {
      this.db?.close();
    } catch {
      /* already closed */
    }
    this.db = null;
    this.query = null;
  }

  poll() {
    let rows;
    try {
      if (!this.db) {
        this.db = this.open();
        this.query = this.db.prepare(QUERY);
      }
      rows = this.query.all(this.getLastRowId());
    } catch (err) {
      // Reopen next time (Messages may have replaced the file, or access was revoked).
      this.closeDb();
      this.log(`[imessage] poll failed: ${err.message}`);
      return;
    }
    if (!rows.length) return;
    const cfg = this.getConfig();
    const partner = new Set((cfg.partner.imessageHandles || []).map(normalizeHandle).filter(Boolean));
    const seen = new Set();
    for (const r of rows) {
      this.setLastRowId(Math.max(this.getLastRowId(), r.rowid));
      if (seen.has(r.rowid)) continue; // a message joined to two chats appears twice
      seen.add(r.rowid);
      const ev = this.toEvent(r, partner, cfg);
      if (ev) this.emit('message', ev);
    }
  }

  toEvent(r, partner, cfg) {
    if (r.itemType !== 0) return null; // group renames, member changes, etc.
    if (r.chatStyle === 43) return null; // group chats
    const who = normalizeHandle(r.fromMe ? r.chatId || r.handle : r.handle);
    if (!partner.has(who)) return null;
    const assoc = Number(r.assocType) || 0;
    if (assoc >= 3000) return null;
    const text = r.text || decodeAttributedBody(r.body);
    const ev = {
      direction: r.fromMe ? 'out' : 'in',
      at: appleDateToMs(r.date),
      text,
      hasAttachments: !!r.hasAttachments,
      keywords: [],
    };
    if (assoc >= 2000) {
      ev.type = 'tapback';
      ev.tapback = TAPBACKS[assoc] || 'other';
      ev.text = '';
    } else {
      ev.type = 'message';
      ev.keywords = matchKeywords(text, cfg.keywords);
    }
    return ev;
  }
}

module.exports = { IMessageWatcher, decodeAttributedBody, normalizeHandle, appleDateToMs, matchKeywords, TAPBACKS, DEFAULT_DB };
