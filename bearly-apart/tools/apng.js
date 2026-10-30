// Animated PNG (APNG) writer, shared by import-gifs.js and make-halloween.js. No Electron here.
const zlib = require('zlib');

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function apng(w, h, frames) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0); // num_plays 0 = loop forever
  const out = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(w, 4);
    fctl.writeUInt32BE(h, 8);
    fctl.writeUInt16BE(f.delay, 20);
    fctl.writeUInt16BE(1000, 22);
    fctl[24] = 1; // dispose to transparent
    fctl[25] = 0;
    out.push(chunk('fcTL', fctl));
    const idat = zlib.deflateSync(f.raw, { level: 9 });
    if (i === 0) out.push(chunk('IDAT', idat));
    else {
      const sn = Buffer.alloc(4);
      sn.writeUInt32BE(seq++);
      out.push(chunk('fdAT', Buffer.concat([sn, idat])));
    }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}

// Unfiltered PNG scanlines from a BGRA bitmap. (Row filters made these dithered GIF frames
// compress worse, so plain rows it is.)
function scanlines(bgra, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const t = row + 1 + x * 4;
      raw[t] = bgra[s + 2];
      raw[t + 1] = bgra[s + 1];
      raw[t + 2] = bgra[s];
      raw[t + 3] = bgra[s + 3];
    }
  }
  return raw;
}

// Adds a Send button and its scene for a new gift GIF, unless they exist already (so edits are kept).

module.exports = { apng, scanlines };
