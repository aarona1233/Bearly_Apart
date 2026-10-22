// Imports GIFs into assets/ as transparent animated PNGs (APNG):
//   - removes solid backgrounds (flood-fills from the edges, so white fur inside an outline is kept)
//   - shrinks big ones to at most MAX px to keep memory low on an 8 GB Mac
// Usage: npx electron tools/import-gifs.js <folder-with-gifs> [--force]
// Files already in assets/ are skipped unless --force is given.
// The name map below says which GIF becomes which asset; scenes.json refers to the new names.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX = 320;
const OUT = path.join(__dirname, '..', 'assets');

// source file → asset name, or { name, ...options }. "brown" = Dudu, "cream" = Bubu (matches the character setting).
//   max: size limit in px   keep: leave the background (a painted scene; shown framed)
//   gradient: the background fades between colours, so grow the cut-out pixel by pixel
//   halve: drop every other frame (long GIFs; the timing is kept)
const MAP = {
  'Dudu-hello-cute.gif': 'dudu-wave.png',
  'dudu-happy.gif': 'dudu-happy.png',
  'dudu-dudu-cry.gif': 'dudu-cry.png',
  'Dudu-working.gif': 'dudu-working.png',
  'Bubu-happy.gif': 'bubu-happy.png',
  'Bubu-attack.gif': 'bubu-sword.png',
  'bubu-cute-attack.gif': 'pair-tackle-hug.png',
  'Bubu -Love-Kiss.gif': 'pair-love-kiss.png',
  'bubu-dudu-cute-kiss.gif': 'pair-cute-kiss.png',
  'bubu-dudu-kiss.gif': 'pair-kiss.png', // dudu-kiss.gif is the same file
  'bubu-dudu-hug.gif': 'pair-hug.png',
  'bubu-dudu-relax.gif': 'pair-relax.png',
  'bubu-dudu-sseeyall.gif': 'dudu-bath.png',
  'bubu-rub-bubu-love-dudu.gif': 'pair-cuddle.png',
  'bubu-dudu-bubu-dance.gif': { name: 'bubu-dance.png', max: 240, gradient: true, halve: true },
  'bubu-dudu-i want you.gif': 'pair-cling.png',
  'bubu-dudu-ilove you.gif': 'pair-i-love-you.png',
  'bubu-dudu-poke.gif': 'pair-poke.png',
  'bubu-dudu.gif': 'pair-tuck-in.png',
  'bubududu-sleep.gif': { name: 'dudu-dream.png', keep: true },
  'emrananhret.gif': 'pair-together.png',
  'i-miss-you.gif': { name: 'card-miss-you.png', keep: true, max: 300 },
};

// Runs in the hidden page: decode every frame with WebCodecs, knock out the background, scale down.
const DECODE = `async (b64, max, opts) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
  await dec.tracks.ready;
  const count = dec.tracks.selectedTrack.frameCount;
  const first = (await dec.decode({ frameIndex: 0 })).image;
  const W = first.displayWidth, H = first.displayHeight;
  const scale = Math.min(1, max / Math.max(W, H));
  const w = Math.round(W * scale), h = Math.round(H * scale);
  const src = new OffscreenCanvas(W, H), sctx = src.getContext('2d', { willReadFrequently: true });
  const dst = new OffscreenCanvas(w, h), dctx = dst.getContext('2d');
  const frames = [];
  let keyed = false;
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    if (opts.halve && i % 2) {
      if (frames.length) frames[frames.length - 1].delay += Math.max(20, Math.round((image.duration || 100000) / 1000));
      image.close();
      continue;
    }
    sctx.clearRect(0, 0, W, H);
    sctx.drawImage(image, 0, 0);
    const delay = Math.max(20, Math.round((image.duration || 100000) / 1000));
    image.close();
    const img = sctx.getImageData(0, 0, W, H);
    const d = img.data;
    // Background colour = most common opaque colour on the border.
    const counts = new Map();
    const border = [];
    for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
    for (const p of border) {
      if (d[p * 4 + 3] < 200) continue;
      const k = (d[p * 4] >> 3) << 10 | (d[p * 4 + 1] >> 3) << 5 | (d[p * 4 + 2] >> 3);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = null, n = 0;
    for (const [k, c] of counts) if (c > n) { best = k; n = c; }
    if (!opts.keep && best !== null && n > border.length * 0.25) {
      keyed = true;
      const br = (best >> 10) << 3, bg = ((best >> 5) & 31) << 3, bb = (best & 31) << 3;
      const dist = (p) => Math.hypot(d[p * 4] - br, d[p * 4 + 1] - bg, d[p * 4 + 2] - bb);
      const seen = new Uint8Array(W * H);
      const step = (a, b) => Math.hypot(d[a * 4] - d[b * 4], d[a * 4 + 1] - d[b * 4 + 1], d[a * 4 + 2] - d[b * 4 + 2]);
      const ok = opts.gradient ? (p, from) => dist(p) < 120 && (from < 0 || step(p, from) < 14) : (p) => dist(p) < 48;
      const stack = border.filter(p => ok(p, -1)).map(p => [p, -1]);
      while (stack.length) {
        const [p, from] = stack.pop();
        if (seen[p]) continue;
        if (!ok(p, from)) continue;
        seen[p] = 1;
        const x = p % W, y = (p / W) | 0;
        if (x > 0) stack.push([p - 1, p]);
        if (x < W - 1) stack.push([p + 1, p]);
        if (y > 0) stack.push([p - W, p]);
        if (y < H - 1) stack.push([p + W, p]);
      }
      for (let p = 0; p < W * H; p++) if (seen[p]) d[p * 4 + 3] = 0;
      // Soften the cut edge: background-ish pixels touching removed ones become half transparent.
      for (let p = 0; p < W * H; p++) {
        if (!d[p * 4 + 3]) continue;
        const x = p % W, y = (p / W) | 0;
        const near = (x > 0 && !d[(p - 1) * 4 + 3]) || (x < W - 1 && !d[(p + 1) * 4 + 3]) || (y > 0 && !d[(p - W) * 4 + 3]) || (y < H - 1 && !d[(p + W) * 4 + 3]);
        if (near && !opts.gradient && dist(p) < 90) d[p * 4 + 3] = Math.round(255 * Math.min(1, (dist(p) - 48) / 42 + 0.25));
      }
      sctx.putImageData(img, 0, 0);
    }
    dctx.clearRect(0, 0, w, h);
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(src, 0, 0, w, h);
    const blob = await dst.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(j, j + 0x8000));
    frames.push({ png: btoa(s), delay });
  }
  return { w, h, frames, keyed, original: [W, H] };
}`;

// ---- APNG writer ---------------------------------------------------------------
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

app.whenReady().then(async () => {
  const dir = path.resolve(process.argv.slice(1).find((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isDirectory() && !a.endsWith('bearly-apart')) || '../animations');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  // WebCodecs (ImageDecoder) only exists in secure contexts; a local file page counts.
  await win.loadFile(path.join(__dirname, '..', 'src', 'overlay', 'index.html'));
  const force = process.argv.includes('--force');
  for (const [src, entry] of Object.entries(MAP)) {
    const { name, max = MAX, ...opts } = typeof entry === 'string' ? { name: entry } : entry;
    const file = path.join(dir, src);
    if (!fs.existsSync(file)) {
      console.log(`- skip ${src} (not found)`);
      continue;
    }
    if (!force && fs.existsSync(path.join(OUT, name))) continue;
    const b64 = fs.readFileSync(file).toString('base64');
    const r = await win.webContents.executeJavaScript(`(${DECODE})(${JSON.stringify(b64)}, ${max}, ${JSON.stringify(opts)})`);
    const frames = r.frames.map((f) => {
      const img = nativeImage.createFromBuffer(Buffer.from(f.png, 'base64'));
      return { delay: f.delay, raw: scanlines(img.toBitmap(), r.w, r.h) };
    });
    const out = apng(r.w, r.h, frames);
    fs.writeFileSync(path.join(OUT, name), out);
    console.log(`✓ ${src.padEnd(30)} → ${name.padEnd(22)} ${r.original.join('x')} → ${r.w}x${r.h}, ${frames.length} frames${r.keyed ? ', background removed' : ''}, ${(out.length / 1024).toFixed(0)} KB`);
  }
  app.quit();
});
