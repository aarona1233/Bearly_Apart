// Renders every asset into one PNG so you can eyeball the art: npx electron tools/contact-sheet.js out.png
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv.find((a) => a.endsWith('.png')) || 'contact-sheet.png');
const dir = path.join(__dirname, '..', 'assets');

app.whenReady().then(async () => {
  const files = fs.readdirSync(dir).filter((f) => /\.(svg|gif|png|webp)$/.test(f));
  const cells = files
    .map((f) => `<figure><img src="data:image/svg+xml;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}"><figcaption>${f}</figcaption></figure>`)
    .join('');
  const html = `<style>body{margin:0;background:#f4eef0;font:11px system-ui;display:flex;flex-wrap:wrap;width:1400px}
    figure{margin:6px;width:160px;text-align:center}img{width:150px;height:150px;object-fit:contain;background:#fff;border-radius:10px}</style>${cells}`;
  const rows = Math.ceil(files.length / 8);
  const win = new BrowserWindow({ width: 1400, height: rows * 190 + 20, show: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log(`wrote ${out}`);
  app.quit();
});
