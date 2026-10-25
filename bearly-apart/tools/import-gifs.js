// Imports GIFs into assets/ as transparent animated PNGs (APNG):
//   - removes solid backgrounds (flood-fills from the edges, so white fur inside an outline is kept)
//   - shrinks big ones to at most MAX px to keep memory low on an 8 GB Mac
// Usage: npx electron tools/import-gifs.js <folder-with-gifs> [--force]
// Files already in assets/ are skipped unless --force is given.
// The name map below says which GIF becomes which asset; scenes.json refers to the new names.
// Any other GIF whose name starts with "_" or contains "%" is made for the Send tab: it's imported as
// gift-<name>.png and gets a ✨ button in assets/sendables.json and a scene in scenes.json (edit both to taste).
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX = 320;
// --out=<dir> writes somewhere else (for trying things out without touching assets/).
const OUT = path.resolve(process.argv.find((a) => a.startsWith('--out='))?.slice(6) || path.join(__dirname, '..', 'assets'));

// Two kinds of entries:
//   - one bear: { pose, bear } → "<pose>-brown.png" and "<pose>-cream.png". "brown" = Dudu, "cream" = Bubu (matches
//     the character setting). If only one bear's GIF exists, the other is made by recolouring it (see recolor()).
//   - both bears in one picture: "pair-….png" (or { name, ...options }), used as is.
// Options: max: size limit in px · keep: leave the background (a painted scene; shown framed) · gradient: the
// background fades between colours, so grow the cut-out pixel by pixel · halve: drop every other frame.
const MAP = {
  // ---- one bear ----
  'dudu-happy.gif': { pose: 'happy', bear: 'brown' },
  'Bubu-happy.gif': { pose: 'happy', bear: 'cream' },
  'Dudu-hello-cute.gif': { pose: 'wave', bear: 'brown' },
  'bubu-helloooo.gif': { pose: 'wave', bear: 'cream' },
  'dudu-dudu-cry.gif': { pose: 'cry', bear: 'brown' },
  '_bubu sad.gif': { pose: 'cry', bear: 'cream', max: 260 },
  'bubusad.gif': { pose: 'sad', bear: 'cream' },
  'Dudu-working.gif': { pose: 'working', bear: 'brown' },
  'Bubu-attack.gif': { pose: 'sword', bear: 'cream' },
  '373612468cbaf228eaced7d7a6013668.gif': { pose: 'sword', bear: 'brown' },
  'bubu-dudu-sseeyall.gif': { pose: 'bath', bear: 'brown' },
  'bubu-dudu-bubu-dance.gif': { pose: 'dance', bear: 'cream', max: 240, gradient: true, halve: true },
  'bubududu-sleep.gif': { pose: 'dream', bear: 'brown', keep: true },
  'i-miss-you.gif': { pose: 'miss-card', bear: 'brown', keep: true, max: 300 },
  'bubu-dudu-love lettergif.gif': { pose: 'letter', bear: 'cream' },
  '_Bubu eatingl.gif': { pose: 'eating', bear: 'cream', max: 220 },
  '_Dudu angry.gif': { pose: 'angry', bear: 'brown' },
  '_bubu-angry.gif': { pose: 'angry', bear: 'cream' },
  '_Thinking of you.gif': { pose: 'thinking', bear: 'brown' },
  '0b8567569e3c0b74bf7324876d4cc0a6.gif': { pose: 'desk-flip', bear: 'cream' },
  '2112e01c92a7ca45cdb4fbfd391058a5.gif': { pose: 'scream', bear: 'cream' },
  '3760ae4df1a0980ae3831362f4a65026.gif': { pose: 'bedtime', bear: 'brown' },
  '381bd83431fcf2ad388b254f72ac1c51.gif': { pose: 'wiggle', bear: 'brown' },
  '513948826a1736fe63d31c417769ad71.gif': { pose: 'boba', bear: 'brown', max: 260 },
  '864036cb8e8cb0ba909e0a5b2c7ebcc8.gif': { pose: 'gloom', bear: 'cream', max: 260 },
  'a0e8b7ee969a38580c0d22e830422e44.gif': { pose: 'lonely', bear: 'brown', max: 240, gradient: true, halve: true },
  'a997ccff1401aa0ecf4d7e40c1d4e67e.gif': { pose: 'teach', bear: 'brown' },
  'b872e330c4c2bac00cc739a79e59546e.gif': { pose: 'tantrum', bear: 'brown' },
  'bf75c6e556294f5a54f528de2d0d1dae.gif': { pose: 'cry-phone', bear: 'cream' },
  'e07734846e176698c0597912804c95aa.gif': { pose: 'pinched', bear: 'brown' },
  'fe1cf8ad79748c4c26045817b17b5c76.gif': { pose: 'finger-gun', bear: 'cream' },
  // ---- both bears ----
  'bubu-cute-attack.gif': 'pair-tackle-hug.png',
  'Bubu -Love-Kiss.gif': 'pair-love-kiss.png',
  'bubu-dudu-cute-kiss.gif': 'pair-cute-kiss.png',
  'bubu-dudu-kiss.gif': 'pair-kiss.png',
  'bubu-dudu-hug.gif': 'pair-hug.png',
  'bubu-dudu-relax.gif': 'pair-relax.png',
  'bubu-rub-bubu-love-dudu.gif': 'pair-cuddle.png',
  'bubu-dudu-i want you.gif': 'pair-cling.png',
  'bubu-dudu-ilove you.gif': 'pair-i-love-you.png',
  'bubu-dudu-poke.gif': 'pair-poke.png',
  'bubu-dudu.gif': 'pair-tuck-in.png',
  'emrananhret.gif': 'pair-together.png',
  'bubu-dudu cuddle.gif': { name: 'pair-goodnight.png', max: 260 },
  'bubu-make dudu happygif.gif': 'pair-cheer-up.png',
  'dudu-hug.gif': 'pair-squeeze.png',
  '_Bubu dudu hug.gif': { name: 'pair-snuggle.png', keep: true }, // white fur touches the edge: shown framed
  '7b54a282072efa630d8323344b9edac5.gif': { name: 'pair-lazy.png', max: 260 },
  '7ee3a3dbbc787c6203154e788d764dbf.gif': { name: 'pair-nap.png', max: 260 },
  'a9cc9c42f6672117dbcdc5e02ac6912f.gif': { name: 'pair-squish.png', max: 260 },
  'da454e232dc0cd6bdd0c669081a9d808.gif': { name: 'pair-gaming.png', max: 260 },
  'da8292bb2ff81fa061b0030fd87daf56.gif': { name: 'pair-spin-hug.png', max: 260 },
};
// Same file as one already imported, so not a new Send button by itself.
// (The two .jpg stills aren't imported: one is the sword pose with a watermark, the other a still of angry Dudu.)
const DUPLICATES = new Set(['_Bubu kiss.gif', 'dudu-kiss.gif', 'c46daea1e2058e91672722ac39cd64a7.gif']); // the last: a closer copy of the cheek squish

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
  // Dudu and Bubu are the same drawing in different colours: Dudu is tan with orange cheeks, Bubu is white with
  // pink cheeks; outlines (and Bubu's ears and bow) are the same dark brown. A pixel is recoloured by where it sits
  // on the line between two known colours (outline → fur, fur → cheek), so soft edges and shading carry over.
  // Anything else (props, hearts, text) is left alone. Only visible pixels change; the background is already gone.
  const DARK = [60, 36, 24], WHITE = [252, 252, 252], TAN = [216, 164, 124], PINK = [252, 192, 180], ORANGE = [240, 192, 120];
  const onLine = (r, g, b, a, z) => {
    const ab0 = z[0] - a[0], ab1 = z[1] - a[1], ab2 = z[2] - a[2];
    let t = ((r - a[0]) * ab0 + (g - a[1]) * ab1 + (b - a[2]) * ab2) / (ab0 * ab0 + ab1 * ab1 + ab2 * ab2);
    t = Math.max(0, Math.min(1, t));
    return [t, Math.hypot(a[0] + t * ab0 - r, a[1] + t * ab1 - g, a[2] + t * ab2 - b)];
  };
  const mix = (a, z, t) => [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t, a[2] + (z[2] - a[2]) * t];
  function recolor(d, to, W) {
    // to = 'brown': Bubu → Dudu; to = 'cream': Dudu → Bubu
    const [furFrom, furTo, cheekFrom, cheekTo] = to === 'brown' ? [WHITE, TAN, PINK, ORANGE] : [TAN, WHITE, ORANGE, PINK];
    const changed = new Uint8Array(d.length / 4);
    for (let p = 0; p < d.length; p += 4) {
      if (!d[p + 3]) continue;
      const r = d[p], g = d[p + 1], b = d[p + 2];
      let out = null;
      const [t, dist] = onLine(r, g, b, DARK, furFrom);
      // Tan → white stretches every shade apart, so dithered Dudu GIFs turned speckly: all light tans become plain white.
      if (dist < 30) out = mix(DARK, furTo, to === 'cream' ? Math.min(1, t / 0.8) : t);
      else {
        const [s, dist2] = onLine(r, g, b, furFrom, cheekFrom);
        if (dist2 < 30 && s > 0.1) out = mix(furTo, cheekTo, s);
      }
      if (out) {
        d[p] = out[0];
        d[p + 1] = out[1];
        d[p + 2] = out[2];
        changed[p / 4] = 1;
      }
    }
    // Dithered GIFs leave single specks that fit neither line. A visible pixel left alone but mostly surrounded by
    // recoloured fur takes their average; props are solid areas, so they keep their colour.
    for (let q = 0; q < changed.length; q++) {
      if (changed[q] || !d[q * 4 + 3]) continue;
      const near = [q - 1, q + 1, q - W, q + W, q - W - 1, q - W + 1, q + W - 1, q + W + 1].filter((n) => n >= 0 && n < changed.length && changed[n] === 1);
      if (near.length < 5) continue;
      for (let c = 0; c < 3; c++) d[q * 4 + c] = near.reduce((sum, n) => sum + d[n * 4 + c], 0) / near.length;
      changed[q] = 2; // filled in, but not used as a neighbour for others
    }
  }
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
    if (opts.recolor) {
      recolor(d, opts.recolor, W);
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

// Adds a Send button and its scene for a new gift GIF, unless they exist already (so edits are kept).
function addGift(gift, asset) {
  const readJson = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  const writeJson = (f, data) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(data, null, 2) + '\n');
  const gifts = readJson('sendables.json');
  if (!gifts[gift]) {
    const label = gift.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    gifts[gift] = { emoji: '✨', label, says: 'sent you something' };
    writeJson('sendables.json', gifts);
    console.log(`  + Send button "✨ ${label}": change its emoji, label and caption in assets/sendables.json`);
  }
  const scenes = readJson('scenes.json');
  if (!scenes[`send-${gift}`]) {
    scenes[`send-${gift}`] = {
      caption: '{emoji} {partner} {says}',
      actors: [
        {
          asset,
          size: 220,
          pokeable: true,
          at: ['center', 'off-bottom'],
          steps: [
            { do: 'move', y: 'bottom', ms: 650, hop: false, ease: 'ease-out' },
            { do: 'wait', ms: 3200 },
            { do: 'move', y: 'off-bottom', ms: 600, hop: false, ease: 'ease-in' },
          ],
        },
      ],
    };
    writeJson('scenes.json', scenes);
    console.log(`  + scene "send-${gift}" in assets/scenes.json`);
  }
}

app.whenReady().then(async () => {
  const dir = path.resolve(process.argv.slice(1).find((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isDirectory() && !a.endsWith('bearly-apart')) || '../animations');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  // WebCodecs (ImageDecoder) only exists in secure contexts; a local file page counts.
  await win.loadFile(path.join(__dirname, '..', 'src', 'overlay', 'index.html'));
  const force = process.argv.includes('--force');
  const importOne = async (src, name, { max = MAX, ...opts } = {}) => {
    const b64 = fs.readFileSync(path.join(dir, src)).toString('base64');
    const r = await win.webContents.executeJavaScript(`(${DECODE})(${JSON.stringify(b64)}, ${max}, ${JSON.stringify(opts)})`);
    const frames = r.frames.map((f) => {
      const img = nativeImage.createFromBuffer(Buffer.from(f.png, 'base64'));
      return { delay: f.delay, raw: scanlines(img.toBitmap(), r.w, r.h) };
    });
    const out = apng(r.w, r.h, frames);
    fs.writeFileSync(path.join(OUT, name), out);
    const how = [opts.recolor && `recoloured to ${opts.recolor === 'brown' ? 'Dudu' : 'Bubu'}`, r.keyed && 'background removed'].filter(Boolean).join(', ');
    console.log(`✓ ${src.slice(0, 30).padEnd(30)} → ${name.padEnd(24)} ${r.original.join('x')} → ${r.w}x${r.h}, ${frames.length} frames${how ? `, ${how}` : ''}, ${(out.length / 1024).toFixed(0)} KB`);
  };
  const missing = (src) => !fs.existsSync(path.join(dir, src)) && console.log(`- skip ${src} (not found)`);
  const poses = {}; // pose → { brown: [src, options], cream: [src, options] }
  for (const [src, entry] of Object.entries(MAP)) {
    if (missing(src)) continue;
    if (entry.pose) {
      const { pose, bear, ...opts } = entry;
      (poses[pose] ||= {})[bear] = [src, opts];
      continue;
    }
    const { name, ...opts } = typeof entry === 'string' ? { name: entry } : entry;
    if (force || !fs.existsSync(path.join(OUT, name))) await importOne(src, name, opts);
  }
  // Both bears for every pose: the original where there is one, otherwise the other bear's GIF recoloured.
  for (const [pose, by] of Object.entries(poses)) {
    for (const bear of ['brown', 'cream']) {
      const name = `${pose}-${bear}.png`;
      if (!force && fs.existsSync(path.join(OUT, name))) continue;
      if (by[bear]) await importOne(by[bear][0], name, by[bear][1]);
      else {
        const [src, opts] = by.brown || by.cream;
        await importOne(src, name, { ...opts, recolor: bear });
      }
    }
  }
  // New Send-tab GIFs: "_name.gif" or "name%.gif".
  for (const src of fs.readdirSync(dir)) {
    if (!/\.gif$/i.test(src) || MAP[src] || DUPLICATES.has(src) || !/^_|%/.test(src)) continue;
    const gift = src.replace(/\.gif$/i, '').replace(/[_%]/g, ' ').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = `gift-${gift}.png`;
    if (force || !fs.existsSync(path.join(OUT, name))) await importOne(src, name);
    addGift(gift, name);
  }
  app.quit();
});
