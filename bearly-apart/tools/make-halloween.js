// Makes the Halloween art the candy game needs, from ../animations (run after import-gifs.js has made
// trick-or-treat-<bear>.png and cry-<bear>.png):
//   - candy-1.png … candy-N.png: each sticker cut out of the candy clip-art sheet
//   - hat-pumpkin.png: the pumpkin hat with its white background removed
//   - cry-hat-<bear>.png / happy-hat-<bear>.png: the crying bear and the happy dance with the hat on, placed on the
//     head frame by frame
//   - halloween.json: where the bucket is in trick-or-treat-<bear>.png (fractions of the picture), and the candy list
// Usage: npx electron tools/make-halloween.js [animations folder]
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { apng, scanlines } = require('./apng');

const ASSETS = path.join(__dirname, '..', 'assets');
const CANDY_SHEET = 'pngtree-candy-color-cute-cartoon-illustration-png-image_9278315.png';
const HAT = 'halloween hat.jpg';

// Runs in the hidden page. Every job gets base64 images and returns base64 PNG frames plus numbers.
const PAGE = `(() => {
  const toB64 = async (canvas) => {
    const buf = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const decode = async (b64, type) => {
    const dec = new ImageDecoder({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type });
    await dec.tracks.ready;
    const frames = [];
    for (let i = 0; i < dec.tracks.selectedTrack.frameCount; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
      c.getContext('2d').drawImage(image, 0, 0);
      frames.push({ canvas: c, delay: Math.max(20, Math.round((image.duration || 100000) / 1000)) });
      image.close();
    }
    return frames;
  };
  const fitTo = (src, sx, sy, sw, sh, max) => {
    const k = Math.min(1, max / Math.max(sw, sh));
    const c = new OffscreenCanvas(Math.round(sw * k), Math.round(sh * k));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  };

  // The candy sheet: each sticker is a separate island of opaque pixels.
  async function candies(b64, max) {
    const [{ canvas }] = await decode(b64, 'image/png');
    const W = canvas.width, H = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const label = new Int32Array(W * H).fill(-1);
    const parts = [];
    for (let p = 0; p < W * H; p++) {
      if (label[p] >= 0 || d[p * 4 + 3] < 40) continue;
      const id = parts.length, stack = [p], box = { x0: W, y0: H, x1: 0, y1: 0, n: 0 };
      label[p] = id;
      while (stack.length) {
        const q = stack.pop(), x = q % W, y = (q / W) | 0;
        box.n++;
        if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x; if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const r = ny * W + nx;
          if (label[r] < 0 && d[r * 4 + 3] >= 40) { label[r] = id; stack.push(r); }
        }
      }
      parts.push(box);
    }
    const keep = parts.map((b, id) => ({ ...b, id })).filter((b) => b.n > W * H * 0.004);
    keep.sort((a, b) => Math.round(a.y0 / 150) - Math.round(b.y0 / 150) || a.x0 - b.x0);
    const out = [];
    for (const b of keep) {
      // Only this sticker's pixels (a neighbour's corner can sit inside its box), with its own soft edge.
      const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
      const c = new OffscreenCanvas(w, h), cx = c.getContext('2d');
      const img = cx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = (b.y0 + y) * W + b.x0 + x;
        const near = (q) => q >= 0 && q < W * H && label[q] === b.id;
        if (label[p] !== b.id && ![p - 1, p + 1, p - W, p + W].some(near)) continue;
        for (let k = 0; k < 4; k++) img.data[(y * w + x) * 4 + k] = d[p * 4 + k];
      }
      cx.putImageData(img, 0, 0);
      const f = fitTo(c, 0, 0, w, h, max);
      out.push({ png: await toB64(f), w: f.width, h: f.height });
    }
    return out;
  }

  // The hat: a JPG on white. Remove the white that touches the border, crop, scale.
  async function hat(b64, max) {
    const [{ canvas }] = await decode(b64, 'image/jpeg');
    const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const whiteness = (p) => Math.min(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);
    const seen = new Uint8Array(W * H), stack = [];
    for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
    while (stack.length) {
      const p = stack.pop();
      if (seen[p] || whiteness(p) < 200) continue;
      seen[p] = 1;
      const x = p % W, y = (p / W) | 0;
      if (x > 0) stack.push(p - 1); if (x < W - 1) stack.push(p + 1); if (y > 0) stack.push(p - W); if (y < H - 1) stack.push(p + W);
    }
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let p = 0; p < W * H; p++) {
      if (seen[p]) { d[p * 4 + 3] = 0; continue; }
      // JPEG fringe next to the removed white: fade it by how light it is.
      const x = p % W, y = (p / W) | 0;
      const edge = (x > 0 && seen[p - 1]) || (x < W - 1 && seen[p + 1]) || (y > 0 && seen[p - W]) || (y < H - 1 && seen[p + W]);
      if (edge && whiteness(p) > 120) d[p * 4 + 3] = Math.round(255 * (255 - whiteness(p)) / 135);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    ctx.putImageData(img, 0, 0);
    const f = fitTo(canvas, x0, y0, x1 - x0 + 1, y1 - y0 + 1, max);
    return { png: await toB64(f), w: f.width, h: f.height };
  }

  // The crying bear with the hat on its head, frame by frame. The head is found in each frame: the widest run of
  // opaque pixels in the band just below the top of the bear (the ears are above that band), so the hat follows
  // the head as it bobs, and flying tears beside it don't count.
  async function hatOn(bearB64, hatB64) {
    const frames = await decode(bearB64, 'image/png');
    const [{ canvas: hatC }] = await decode(hatB64, 'image/png');
    const W = frames[0].canvas.width, H = frames[0].canvas.height;
    const heads = frames.map(({ canvas }) => {
      const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
      const solid = (x, y) => d[(y * W + x) * 4 + 3] > 128;
      let top = 0;
      while (top < H && ![...Array(W).keys()].some((x) => solid(x, top))) top++;
      // Widest run on each row of the band 18–30% of the frame below the top: the skull, past the ears.
      const runs = [];
      for (let y = top + Math.round(H * 0.18); y <= top + Math.round(H * 0.3); y++) {
        let best = [0, 0], start = -1;
        for (let x = 0; x <= W; x++) {
          if (x < W && solid(x, y)) { if (start < 0) start = x; }
          else if (start >= 0) { if (x - start > best[1] - best[0]) best = [start, x]; start = -1; }
        }
        runs.push(best);
      }
      runs.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
      const [l, r] = runs[Math.floor(runs.length / 4)]; // a wide row, but not a stray one
      return { top, cx: (l + r) / 2, width: r - l };
    });
    // Same hat size on every frame (from the median head width), so it doesn't pulse.
    const widths = heads.map((h) => h.width).sort((a, b) => a - b);
    const hatW = Math.round(widths[Math.floor(widths.length / 2)] * 0.8);
    const hatH = Math.round(hatW * hatC.height / hatC.width);
    const sink = Math.round(hatH * 0.42); // how far the hat comes down over the top of the head
    const lift = Math.max(0, hatH - sink - Math.min(...heads.map((h) => h.top)));
    // The pumpkin leans to one side in its picture: centre it on the head by its weight, not its box.
    const hd = hatC.getContext('2d').getImageData(0, 0, hatC.width, hatC.height).data;
    let mass = 0, mx = 0;
    for (let p = 0; p < hatC.width * hatC.height; p++) { mass += hd[p * 4 + 3]; mx += (p % hatC.width) * hd[p * 4 + 3]; }
    const shift = Math.round((hatC.width / 2 - mx / mass) * hatW / hatC.width);
    const out = [];
    for (let i = 0; i < frames.length; i++) {
      const c = new OffscreenCanvas(W, H + lift), x = c.getContext('2d');
      x.drawImage(frames[i].canvas, 0, lift);
      const h = heads[i];
      x.imageSmoothingQuality = 'high';
      x.drawImage(hatC, Math.round(h.cx - hatW / 2) + shift, lift + h.top + sink - hatH, hatW, hatH);
      out.push({ png: await toB64(c), delay: frames[i].delay });
    }
    return { w: W, h: H + lift, frames: out, heads, hat: [hatW, hatH], lift, shift };
  }

  // Where the jack-o'-lantern bucket is: the orange pixels in the lower right (the bow and hat band are orange too,
  // but they're further left / higher up). Returned as fractions of the picture.
  async function bucket(b64) {
    const [{ canvas }] = await decode(b64, 'image/png');
    const W = canvas.width, H = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0;
    for (let y = Math.round(H * 0.7); y < H; y++) for (let x = Math.round(W * 0.66); x < W; x++) {
      const p = (y * W + x) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      if (r > 200 && g > 90 && g < 200 && b < 100) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H, pixels: n };
  }

  return { candies, hat, hatOn, bucket };
})()`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const dir = path.resolve(process.argv.slice(1).find((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isDirectory() && !a.endsWith('bearly-apart')) || path.join(__dirname, '..', '..', 'animations'));
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'overlay', 'index.html')); // ImageDecoder needs a secure context
  await win.webContents.executeJavaScript(`window.HW = ${PAGE}; true`);
  const run = (fn, ...args) => win.webContents.executeJavaScript(`HW.${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const b64 = (f) => fs.readFileSync(f).toString('base64');
  const writePng = (name, png) => fs.writeFileSync(path.join(ASSETS, name), nativeImage.createFromBuffer(Buffer.from(png, 'base64')).toPNG());

  const pieces = await run('candies', b64(path.join(dir, CANDY_SHEET)), 120);
  const candyNames = pieces.map((p, i) => {
    const name = `candy-${i + 1}.png`;
    writePng(name, p.png);
    return name;
  });
  console.log(`✓ ${candyNames.length} candies: ${pieces.map((p) => `${p.w}x${p.h}`).join(', ')}`);

  const h = await run('hat', b64(path.join(dir, HAT)), 220);
  writePng('hat-pumpkin.png', h.png);
  console.log(`✓ hat-pumpkin.png ${h.w}x${h.h}`);

  // The crying bear (missed) and the happy dance (candy!), each with the hat on.
  for (const [pose, bear] of ['cry', 'happy'].flatMap((p) => [[p, 'brown'], [p, 'cream']])) {
    const r = await run('hatOn', b64(path.join(ASSETS, `${pose}-${bear}.png`)), h.png);
    const frames = r.frames.map((f) => ({ delay: f.delay, raw: scanlines(nativeImage.createFromBuffer(Buffer.from(f.png, 'base64')).toBitmap(), r.w, r.h) }));
    fs.writeFileSync(path.join(ASSETS, `${pose}-hat-${bear}.png`), apng(r.w, r.h, frames));
    console.log(`✓ ${pose}-hat-${bear}.png ${r.w}x${r.h}, ${frames.length} frames, hat ${r.hat.join("x")} (shifted ${r.shift} px), head x ${Math.min(...r.heads.map((q) => q.cx))}–${Math.max(...r.heads.map((q) => q.cx))}, top ${Math.min(...r.heads.map((q) => q.top))}–${Math.max(...r.heads.map((q) => q.top))}`);
  }

  const bucket = await run('bucket', b64(path.join(ASSETS, 'trick-or-treat-cream.png')));
  const round = (v) => Math.round(v * 1000) / 1000;
  const data = { bucket: { x: round(bucket.x), y: round(bucket.y), w: round(bucket.w), h: round(bucket.h) }, candies: candyNames };
  fs.writeFileSync(path.join(ASSETS, 'halloween.json'), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`✓ halloween.json: bucket at ${JSON.stringify(data.bucket)} (${bucket.pixels} orange pixels)`);
  app.quit();
});
