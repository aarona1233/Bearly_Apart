// The transparent, click-through window the bears play in, covering one display at a time.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');

const SRC = path.join(__dirname, '..');
const IS_MAC = process.platform === 'darwin';

class OverlayWindow {
  // getScene(name) -> scene definition or undefined; getScale() -> the bear size setting
  constructor({ getScene, getScale, log }) {
    this.getScene = getScene;
    this.getScale = getScale;
    this.log = log;
    this.win = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      ...(IS_MAC ? { type: 'panel' } : {}),
      webPreferences: { preload: path.join(SRC, 'overlay', 'preload.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadFile(path.join(SRC, 'overlay', 'index.html'));
    ipcMain.on('overlay-clickable', (_, on) => this.win.setIgnoreMouseEvents(!on, { forward: true }));
  }

  hide() {
    this.win.hide();
  }

  // Plays one scene; resolves when the page says it's done (or after 90s, whatever happens).
  render(req, front) {
    return new Promise((resolve) => {
      const scene = this.getScene(req.scene);
      if (!scene) {
        this.log(`[render] no scene named "${req.scene}"`);
        return resolve();
      }
      const display = front?.bounds ? screen.getDisplayMatching(front.bounds) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const b = display.bounds;
      this.win.setBounds(b);
      const win = front?.bounds ? { x: front.bounds.x - b.x, y: front.bounds.y - b.y, width: front.bounds.width, height: front.bounds.height } : null;
      // Scenes are authored for a ~900pt-tall screen; her 13" Air is ~956pt.
      const scale = this.getScale() * Math.min(1.4, Math.max(0.7, b.height / 900));
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        clearInterval(capture);
        ipcMain.removeListener('scene-done', done);
        this.win.setIgnoreMouseEvents(true, { forward: true });
        this.win.hide();
        resolve();
      };
      const timeout = setTimeout(done, 90_000);
      ipcMain.once('scene-done', done);
      this.win.webContents.send('play', { scene, vars: req.vars, ctx: { width: b.width, height: b.height, win, scale } });
      this.win.showInactive();
      this.win.setAlwaysOnTop(true, 'screen-saver');
      const capture = this.startCapture(req.scene);
    });
  }

  // BA_CAPTURE=dir saves a frame every 400ms while a scene plays (for testing without eyes).
  startCapture(name) {
    const dir = process.env.BA_CAPTURE;
    if (!dir) return null;
    fs.mkdirSync(dir, { recursive: true });
    let i = 0;
    return setInterval(async () => {
      const img = await this.win.webContents.capturePage().catch(() => null);
      if (img && !img.isEmpty()) fs.writeFileSync(path.join(dir, `${name}-${String(i++).padStart(3, '0')}.png`), img.toPNG());
    }, 400);
  }
}

module.exports = { OverlayWindow };
