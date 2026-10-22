// The app window (Send / Animations / Settings) and the tray/menu-bar menu, plus the IPC between them.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const { STATUSES, SENDABLES, SCENES: SCENE_ORDER, sceneInfo } = require('./catalog');

const SRC = path.join(__dirname, '..');
const ICONS = path.join(__dirname, '..', '..', 'assets', 'icons');
const IS_MAC = process.platform === 'darwin';
const FDA_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';

// Why bears are waiting, in words (keys come from Guard.check()).
const PAUSE_REASONS = {
  snoozed: 'snoozed',
  locked: 'the screen is locked',
  'quiet-hours': 'quiet hours',
  away: 'nobody is at the computer',
  focus: 'a Focus / Do Not Disturb is on',
  'screen-share': 'the screen is being shared',
  fullscreen: 'a full-screen app is in front',
};
function pauseText(reason) {
  if (!reason) return '';
  return PAUSE_REASONS[reason] || (reason.startsWith('app:') ? `${reason.slice(4)} is in front` : reason);
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

class UI {
  constructor({ stores, log, sceneNames, getScene, liveState, pairingCode, actions }) {
    this.stores = stores;
    this.log = log;
    this.sceneNames = sceneNames;
    this.getScene = getScene;
    this.liveState = liveState;
    this.pairingCode = pairingCode;
    this.actions = actions;
    this.tray = null;
    this.win = null;
    this.refreshTimer = null;
  }

  start() {
    this.setupIpc();
    const icon = nativeImage.createFromPath(path.join(ICONS, IS_MAC ? 'trayTemplate.png' : 'tray.png'));
    if (IS_MAC) icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    // Left click opens the app (Windows/Linux); the menu is a right click away. The Mac shows the menu.
    if (!IS_MAC) this.tray.on('click', () => this.openWindow());
    this.refreshNow();
    setInterval(() => this.refreshNow(), 60_000); // keeps "5m ago" fresh
  }

  // Coalesces bursts of changes (a relay message updates state several times) into one redraw.
  refresh() {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => this.refreshNow(), 80);
  }

  refreshNow() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    if (this.tray) {
      const st = this.stores.state.data;
      const status = st.partnerStatus && STATUSES[st.partnerStatus.name];
      if (IS_MAC) this.tray.setTitle(status ? status.emoji : '');
      this.tray.setToolTip(`Bearly Apart${status ? ` — ${this.stores.config.data.partner.name} ${status.label}` : ''}`);
      this.tray.setContextMenu(this.buildMenu());
    }
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('live', this.liveState());
  }

  // ---------- window -------------------------------------------------------

  openWindow(tab) {
    if (this.win && !this.win.isDestroyed()) {
      if (tab) this.win.webContents.send('show-tab', tab);
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      return this.win.focus();
    }
    this.win = new BrowserWindow({
      width: 560,
      height: 780,
      minWidth: 420,
      minHeight: 500,
      fullscreenable: false,
      title: 'Bearly Apart',
      backgroundColor: '#fff6f8',
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(SRC, 'app', 'preload.js'), sandbox: true, contextIsolation: true },
    });
    this.win.loadFile(path.join(SRC, 'app', 'index.html'), tab ? { hash: tab } : undefined);
    if (IS_MAC) app.dock?.show();
    this.win.on('closed', () => {
      this.win = null;
      if (IS_MAC) app.dock?.hide();
    });
  }

  // ---------- tray / menu-bar menu -----------------------------------------

  buildMenu() {
    const cfg = this.stores.config.data;
    const st = this.stores.state.data;
    const live = this.liveState();
    const partner = cfg.partner.name || 'your love';
    const paired = live.paired;
    const status = st.partnerStatus && STATUSES[st.partnerStatus.name];
    const items = [];
    items.push({
      label: paired ? `💞 ${partner}${status ? `  ${status.emoji} ${status.short} · ${ago(st.partnerStatus.at)}` : ''}` : '💞 Not paired yet — open Bearly Apart',
      enabled: false,
    });
    items.push({ label: live.connected ? '● Connected' : '○ Connecting…', enabled: false });
    if (live.paused) items.push({ label: `⏸ Bears are waiting: ${pauseText(live.paused)}`, enabled: false });
    if (IS_MAC && cfg.imessage.enabled) {
      if (live.imessage === 'no-access') items.push({ label: '⚠️ iMessage: grant Full Disk Access…', click: () => shell.openExternal(FDA_URL) });
      else if (live.imessage === 'ok' && !cfg.partner.imessageHandles.length) items.push({ label: '⚠️ iMessage: add their number in Settings', click: () => this.openWindow('settings') });
      else if (live.imessage === 'ok') items.push({ label: '✓ Watching iMessage', enabled: false });
    }
    items.push({ type: 'separator' });
    for (const [type, s] of Object.entries(SENDABLES)) {
      items.push({ label: `${s.emoji}  Send ${s.short.toLowerCase()}`, enabled: paired, click: () => this.actions.sendEvent(type, {}, { notify: true }) });
    }
    const mine = st.myStatus?.name;
    items.push({
      label: `📣  My status${mine && STATUSES[mine] ? `: ${STATUSES[mine].emoji} ${STATUSES[mine].short}` : ''}`,
      enabled: paired,
      submenu: [
        ...Object.entries(STATUSES).map(([name, s]) => ({
          label: `${s.emoji}  ${s.short}`,
          type: 'checkbox',
          checked: name === mine,
          click: () => this.actions.sendEvent('status', { status: name }, { notify: true }),
        })),
        { type: 'separator' },
        { label: 'Clear my status', enabled: !!mine, click: () => this.actions.sendEvent('status', { status: 'clear' }, { notify: true }) },
      ],
    });
    items.push({ label: '💌  Write a love note…', enabled: paired, click: () => this.openWindow('send') });
    items.push({ type: 'separator' });
    items.push(
      live.snoozedUntil
        ? { label: `🔕 Snoozed until ${new Date(live.snoozedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — resume`, click: () => this.actions.snooze(0) }
        : {
            label: '🔕  Snooze bears',
            submenu: [
              { label: '30 minutes', click: () => this.actions.snooze(30) },
              { label: '1 hour', click: () => this.actions.snooze(60) },
              { label: '3 hours', click: () => this.actions.snooze(180) },
              { label: 'Until tomorrow morning', click: () => this.actions.snoozeUntilMorning() },
            ],
          },
    );
    items.push({ label: '🐻  Open Bearly Apart…', click: () => this.openWindow() });
    items.push({ type: 'separator' });
    items.push({ label: 'Quit Bearly Apart', click: () => app.quit() }); // no role: its Ctrl+Q accelerator makes GTK complain without a tray
    return Menu.buildFromTemplate(items);
  }

  // Animations tab: friendly name, when it plays, and the first bear as a thumbnail.
  sceneList() {
    const c = this.stores.config.data;
    const order = Object.keys(SCENE_ORDER);
    const rank = (n) => (order.includes(n) ? order.indexOf(n) : n.startsWith('status-') ? order.length : order.length + 1);
    return this.sceneNames()
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((name) => {
        const asset = this.getScene(name)?.actors?.[0]?.asset || '';
        const file = asset.replace(/\{pc\}/g, c.partner.character).replace(/\{mc\}/g, c.me.character);
        return { ...sceneInfo(name), thumb: file ? `ba://asset/${encodeURIComponent(file)}` : '' };
      });
  }

  // ---------- IPC for the window -------------------------------------------

  setupIpc() {
    const { actions } = this;
    ipcMain.handle('app:get', () => ({
      config: this.stores.config.data,
      pairing: this.pairingCode(),
      platform: process.platform,
      profileDir: app.getPath('userData'),
      statuses: STATUSES,
      sendables: SENDABLES,
      scenes: this.sceneList(),
      pauseReasons: PAUSE_REASONS,
      live: this.liveState(),
    }));
    ipcMain.handle('app:send', (_, { type, status }) => {
      if (!SENDABLES[type] && type !== 'status') return { ok: false, error: 'unknown type' };
      return actions.sendEvent(type, status ? { status: String(status) } : {});
    });
    ipcMain.handle('app:note', (_, { text, later }) => {
      const t = String(text || '').trim().slice(0, 2000);
      if (!t) return { ok: false, error: 'write something first' };
      return actions.sendEvent(later ? 'jar' : 'note', { text: t });
    });
    ipcMain.handle('app:preview', (_, name) => actions.preview(String(name)));
    ipcMain.handle('app:snooze', (_, mins) => actions.snooze(Number(mins) || 0));
    ipcMain.handle('app:save', (_, patch) => actions.saveSettings(patch));
    ipcMain.handle('app:pair', (_, code) => {
      try {
        actions.pair(code);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    ipcMain.handle('app:reset-pairing', () => actions.resetPairing());
    ipcMain.handle('app:open', (_, what) => {
      if (what === 'fda') shell.openExternal(FDA_URL);
      if (what === 'gifs') {
        fs.mkdirSync(actions.userAssetsDir(), { recursive: true });
        shell.openPath(actions.userAssetsDir());
      }
      if (what === 'profile') shell.openPath(app.getPath('userData'));
    });
    // From the overlay: someone clicked a bear.
    ipcMain.on('poke-back', () => actions.sendEvent('poke'));
  }
}

module.exports = { UI, pauseText, ago };
