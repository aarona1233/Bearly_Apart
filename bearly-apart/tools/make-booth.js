// Makes the photo booth's bear stickers: one still frame from each chosen animation, cropped to the bear, into
// assets/booth/. The strip draws them in its corners, so they have to be still pictures, not animations.
// Usage: npx electron tools/make-booth.js            (writes assets/booth/*.png)
//        npx electron tools/make-booth.js --sheet out.png   (every 4th frame of each candidate, to pick from)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const OUT = path.join(ASSETS, 'booth');

// sticker name -> [animation, frame]. Frames were picked from the --sheet output.
// Two-bear pictures are ones with Dudu on the left, the side the strip gives Dudu's person.
const PICKS = {
  'wiggle-brown': ['wiggle-brown.png', 0],
  'wiggle-cream': ['wiggle-cream.png', 0],
  'happy-brown': ['happy-brown.png', 0],
  'happy-cream': ['happy-cream.png', 0],
  'letter-brown': ['letter-brown.png', 4],
  'letter-cream': ['letter-cream.png', 4],
  'dance-brown': ['dance-brown.png', 8],
  'dance-cream': ['dance-cream.png', 8],
  'boba-brown': ['boba-brown.png', 0],
  'boba-cream': ['boba-cream.png', 0],
  'pair-cuddle': ['pair-cuddle.png', 4],
  'pair-hug': ['pair-hug.png', 0],
  'pair-together': ['pair-together.png', 0],
};
const CANDIDATES = ['wave-brown', 'happy-brown', 'letter-brown', 'dance-brown', 'boba-brown', 'wiggle-brown', 'dream-brown', 'pair-hug', 'pair-kiss', 'pair-cute-kiss', 'pair-i-love-you', 'pair-together', 'pair-snuggle', 'pair-cuddle'];

// Runs in the hidden page: decodes an animated PNG into frames and returns the ones asked for as PNG data URLs.
const PAGE = `({
  async frames(b64, want, crop) {
    const dec = new ImageDecoder({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type: 'image/png' });
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack.frameCount;
    const pick = want === 'all' ? [...Array(count).keys()].filter((i) => i % (count > 24 ? 4 : 2) === 0).slice(0, 12) : [Math.min(want, count - 1)];
    const out = [];
    for (const i of pick) {
      const { image } = await dec.decode({ frameIndex: i });
      const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
      const g = c.getContext('2d');
      g.drawImage(image, 0, 0);
      image.close();
      let x0 = 0, y0 = 0, x1 = c.width, y1 = c.height;
      if (crop) {
        const d = g.getImageData(0, 0, c.width, c.height).data;
        x0 = c.width; y0 = c.height; x1 = 0; y1 = 0;
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++)
            if (d[(y * c.width + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
      }
      const cut = new OffscreenCanvas(x1 - x0, y1 - y0);
      cut.getContext('2d').drawImage(c, -x0, -y0);
      const blob = await cut.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
      out.push({ i, count, w: cut.width, h: cut.height, png: btoa(s) });
    }
    return out;
  },
})`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'overlay', 'index.html')); // ImageDecoder needs a secure context
  await win.webContents.executeJavaScript(`window.BT = ${PAGE}; true`);
  const run = (...args) => win.webContents.executeJavaScript(`BT.frames(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const b64 = (file) => fs.readFileSync(path.join(ASSETS, file)).toString('base64');

  const sheetAt = process.argv.indexOf('--sheet');
  if (sheetAt > 0) {
    // One row per candidate: frame number over each picture, on a grey background so white Bubu shows.
    const rows = [];
    const names = process.argv[sheetAt + 2]?.split(',') || CANDIDATES;
    for (const name of names) rows.push({ name, frames: await run(b64(`${name}.png`), 'all', false) });
    const cell = 150;
    const cols = Math.max(...rows.map((r) => r.frames.length));
    const html = `<body style="margin:0;background:#9aa;font:12px sans-serif">${rows
      .map((r) => `<div style="display:flex;align-items:center;height:${cell + 16}px"><b style="width:110px">${r.name}<br>${r.frames[0].count} frames</b>${r.frames.map((f) => `<div style="width:${cell}px;text-align:center">${f.i}<br><img style="max-width:${cell - 6}px;max-height:${cell - 6}px" src="data:image/png;base64,${f.png}"></div>`).join('')}</div>`)
      .join('')}</body>`;
    const sheet = new BrowserWindow({ show: false, width: 110 + cols * cell, height: rows.length * (cell + 16), webPreferences: { offscreen: true } });
    const tmp = path.join(app.getPath('temp'), 'booth-sheet.html'); // too big for a data: URL
    fs.writeFileSync(tmp, html);
    await sheet.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 500));
    fs.writeFileSync(process.argv[sheetAt + 1], (await sheet.webContents.capturePage()).toPNG());
    console.log(`wrote ${process.argv[sheetAt + 1]}`);
    return app.quit();
  }

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, [file, frame]] of Object.entries(PICKS)) {
    const [f] = await run(b64(file), frame, true);
    fs.writeFileSync(path.join(OUT, `${name}.png`), nativeImage.createFromDataURL(`data:image/png;base64,${f.png}`).toPNG());
    console.log(`${name}.png  frame ${f.i} of ${f.count}, ${f.w}x${f.h}`);
  }
  app.quit();
});
