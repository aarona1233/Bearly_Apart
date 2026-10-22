// Builds a stand-in for ~/Library/Messages/chat.db with the same tables/columns the watcher
// reads, so the iMessage path can be tested on Linux.
//   node tools/fake-chatdb.js init  <db>
//   node tools/fake-chatdb.js in    <db> <handle> "text"        (partner → me)
//   node tools/fake-chatdb.js out   <db> <handle> "text"        (me → partner)
//   node tools/fake-chatdb.js in-ab <db> <handle> "text"        (text only in attributedBody, like newer macOS)
//   node tools/fake-chatdb.js tapback <db> <handle> 2000
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, service TEXT);
CREATE TABLE IF NOT EXISTS chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, chat_identifier TEXT, style INTEGER, service_name TEXT);
CREATE TABLE IF NOT EXISTS message (
  ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT, text TEXT, attributedBody BLOB, handle_id INTEGER DEFAULT 0,
  is_from_me INTEGER DEFAULT 0, date INTEGER, associated_message_type INTEGER DEFAULT 0, item_type INTEGER DEFAULT 0,
  cache_has_attachments INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER);
`;

// Minimal typedstream-shaped blob: just enough structure for the decoder (NSString, '+', length, utf8).
function attributedBody(text) {
  const utf8 = Buffer.from(text, 'utf8');
  let len;
  if (utf8.length < 0x80) len = Buffer.from([utf8.length]);
  else {
    len = Buffer.alloc(3);
    len[0] = 0x81;
    len.writeUInt16LE(utf8.length, 1);
  }
  return Buffer.concat([
    Buffer.from([0x04, 0x0b]),
    Buffer.from('streamtyped'),
    Buffer.from([0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84]),
    Buffer.from('NSMutableAttributedString'),
    Buffer.from([0x00, 0x84, 0x84]),
    Buffer.from('NSAttributedString'),
    Buffer.from([0x00, 0x84, 0x84]),
    Buffer.from('NSObject'),
    Buffer.from([0x00, 0x85, 0x92, 0x84, 0x84, 0x84]),
    Buffer.from('NSString'),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
    len,
    utf8,
    Buffer.from([0x86, 0x84, 0x02, 0x69, 0x49, 0x01]),
  ]);
}

function appleNow() {
  return BigInt(Date.now() - 978307200000) * 1_000_000n;
}

function open(file) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

function chatFor(db, handle) {
  let h = db.prepare('SELECT ROWID FROM handle WHERE id = ?').get(handle);
  if (!h) h = { ROWID: db.prepare('INSERT INTO handle (id, service) VALUES (?, ?)').run(handle, 'iMessage').lastInsertRowid };
  let c = db.prepare('SELECT ROWID FROM chat WHERE chat_identifier = ?').get(handle);
  if (!c) c = { ROWID: db.prepare('INSERT INTO chat (chat_identifier, style, service_name) VALUES (?, 45, ?)').run(handle, 'iMessage').lastInsertRowid };
  return { handleId: Number(h.ROWID), chatId: Number(c.ROWID) };
}

function insert(file, { handle, text = null, body = null, fromMe = 0, assoc = 0 }) {
  const db = open(file);
  const { handleId, chatId } = chatFor(db, handle);
  const r = db
    .prepare('INSERT INTO message (guid, text, attributedBody, handle_id, is_from_me, date, associated_message_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(`fake-${Date.now()}-${Math.random()}`, text, body, handleId, fromMe, appleNow(), assoc);
  db.prepare('INSERT INTO chat_message_join (chat_id, message_id, message_date) VALUES (?, ?, ?)').run(chatId, r.lastInsertRowid, appleNow());
  db.close();
  return Number(r.lastInsertRowid);
}

if (require.main === module) {
  const [cmd, file, handle, arg] = process.argv.slice(2);
  if (cmd === 'init') open(file).close();
  else if (cmd === 'in') insert(file, { handle, text: arg });
  else if (cmd === 'out') insert(file, { handle, text: arg, fromMe: 1 });
  else if (cmd === 'in-ab') insert(file, { handle, body: attributedBody(arg) });
  else if (cmd === 'tapback') insert(file, { handle, assoc: Number(arg || 2000) });
  else {
    console.error('usage: see top of file');
    process.exit(1);
  }
  console.log(`${cmd} ok`);
}

module.exports = { insert, attributedBody, open };
