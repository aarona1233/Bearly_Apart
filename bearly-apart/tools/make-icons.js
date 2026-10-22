// Renders the app icon (bear face on a pink rounded square) to .icns (Mac), .ico (Windows), .png (Linux).
// Run with Electron: npx electron tools/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'assets', 'icons');
// Crop the bear art to its face by narrowing the viewBox.
const face = fs.readFileSync(path.join(__dirname, '..', 'assets', 'bear-love-brown.svg'), 'utf8').replace(/viewBox="[^"]*"/, 'viewBox="40 14 136 136"');

const html = (size) => `<style>html,body{margin:0;background:transparent;overflow:hidden}
  .bg{width:${size}px;height:${size}px;border-radius:${size * 0.22}px;background:linear-gradient(160deg,#ffd6e2,#ff9fbd);
  display:flex;align-items:center;justify-content:center;overflow:hidden}
  img{width:${size * 0.84}px;height:${size * 0.84}px}</style>
  <div class="bg"><img src="data:image/svg+xml;base64,${Buffer.from(face).toString('base64')}"></div>`;

// Render once big, then scale down (tiny offscreen windows fail to load).
async function renderMaster(size) {
  const win = new BrowserWindow({ width: size, height: size, show: false, transparent: true, frame: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
  win.setContentSize(size, size);
  await win.loadURL(`data:text/html;base64,${Buffer.from(html(size)).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  return img;
}

function icns(entries) {
  const chunks = entries.map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(([size, png]) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...pngs.map(([, p]) => p)]);
}

app.whenReady().then(async () => {
  const master = await renderMaster(1024);
  const sizes = {};
  for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) sizes[s] = master.resize({ width: s, height: s, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(OUT, 'icon.icns'), icns([['icp4', sizes[16]], ['icp5', sizes[32]], ['icp6', sizes[64]], ['ic07', sizes[128]], ['ic08', sizes[256]], ['ic09', sizes[512]], ['ic10', sizes[1024]]]));
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico([16, 32, 48, 256].map((s) => [s, sizes[s]])));
  fs.writeFileSync(path.join(OUT, 'icon.png'), sizes[512]);
  console.log('wrote icon.icns, icon.ico, icon.png');
  app.quit();
});
