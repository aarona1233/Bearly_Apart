// The transparent, click-through window the bears play in, covering one display at a time.
const fs = require('fs');
const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');

const SRC = path.join(__dirname, '..');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

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
    this.clickable = false;
    this.pageClickable = false;
    this.overHotspot = false;
    this.hotspots = [];
    this.win.setIgnoreMouseEvents(true, { forward: true });
    this.win.loadFile(path.join(SRC, 'overlay', 'index.html'));
    ipcMain.on('overlay-clickable', (_, on) => {
      this.pageClickable = !!on;
      this.applyClickable();
    });
    // The candy game finished: given or not, for the scene that's playing.
    ipcMain.on('candy-result', (_, r) => this.onCandy?.(r, this.current));
    // Places the page wants grabbable (the candy), in window coordinates: watched with the real cursor position below.
    ipcMain.on('overlay-hotspots', (_, rects) => this.setHotspots(rects));
    // A test candy game (tester section) reports every step; it goes in the log with the window's own view.
    ipcMain.on('overlay-debug', (_, msg) => this.log(`[candy-test] ${String(msg).slice(0, 400)}`));
  }

  // The window takes the mouse when the page asks (something hovered or held) or the cursor is on a hotspot;
  // otherwise clicks go through to whatever is underneath.
  setClickable(on) {
    this.pageClickable = on;
    this.overHotspot = false;
    this.applyClickable(true);
  }
  applyClickable(force = false) {
    const on = this.pageClickable || this.overHotspot;
    if (!force && on === this.clickable) return;
    this.clickable = on;
    if (this.current?.vars?.debug) this.log(`[candy-test] window ${on ? 'takes the mouse' : 'lets clicks through'} (page asks: ${this.pageClickable}, cursor on candy: ${this.overHotspot})`);
    this.win.setIgnoreMouseEvents(!on, { forward: true });
  }

  // Hover events can't be counted on (see render), so for things that must be grabbable the cursor itself is watched:
  // every 50 ms while there are hotspots, is it over one?
  setHotspots(rects) {
    this.hotspots = Array.isArray(rects) ? rects : [];
    clearInterval(this.hotTimer);
    if (!this.hotspots.length) {
      this.overHotspot = false;
      return this.applyClickable();
    }
    const check = () => {
      if (this.win.isDestroyed() || !this.win.isVisible()) return;
      const p = screen.getCursorScreenPoint();
      const b = this.win.getBounds();
      const x = p.x - b.x;
      const y = p.y - b.y;
      this.overHotspot = this.hotspots.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      this.applyClickable();
    };
    check();
    this.hotTimer = setInterval(check, 50);
  }

  hide() {
    this.win.hide();
  }

  // Plays one scene; resolves when the page says it's done (or after 90s, or the scene's maxMs, whatever happens).
  render(req, front) {
    this.current = req;
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
        this.setHotspots([]);
        this.setClickable(false);
        // On Windows a click-through window that's been hidden and shown again stops getting clicks (the candy
        // couldn't be grabbed after any earlier scene), so there it stays shown, empty and see-through.
        if (!IS_WIN) this.win.hide();
        resolve();
      };
      const timeout = setTimeout(done, scene.maxMs || 90_000);
      ipcMain.once('scene-done', done);
      this.win.webContents.send('play', { scene, vars: req.vars, ctx: { width: b.width, height: b.height, win, scale } });
      this.win.showInactive();
      this.win.setAlwaysOnTop(true, 'screen-saver');
      // On Windows, hiding the window stops the mouse-move forwarding that tells the page what's under the pointer
      // (so after the first scene nothing could be hovered, clicked or dragged). Turn it on again for every scene.
      this.setClickable(false);
      const capture = this.startCapture(req.scene);
      this.checkSize(b, () => finished);
    });
  }

  // Moving the window to a screen with different scaling (Windows: a 100% and a 125% monitor) can leave it, or its
  // page, at the old size rescaled, so the bears at the bottom of the scene fall outside it. Once things settle, check
  // both against the screen and put the window right if they're off (and say so in the log).
  checkSize(b, over) {
    setTimeout(async () => {
      if (over() || this.win.isDestroyed()) return;
      const g = this.win.getBounds();
      const page = await this.win.webContents.executeJavaScript('[innerWidth, innerHeight]').catch(() => null);
      const off = (w, h) => Math.abs(w - b.width) > 2 || Math.abs(h - b.height) > 2;
      if (!off(g.width, g.height) && g.x === b.x && g.y === b.y && (!page || !off(page[0], page[1]))) return;
      this.log(`[render] the bear window was ${g.width}x${g.height} at ${g.x},${g.y} (page ${page?.join('x')}), not the screen's ${b.width}x${b.height} at ${b.x},${b.y}: fixing it`);
      // Nudge the size so the window really re-lays out, then set it exactly.
      this.win.setBounds({ ...b, width: b.width - 1 });
      this.win.setBounds(b);
    }, 400);
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
