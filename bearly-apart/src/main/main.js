const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, powerMonitor, protocol, net, nativeImage, globalShortcut, shell } = require('electron');
const { openStores, slug, encodePairing, decodePairing } = require('./store');
const { Relay } = require('./relay');
const { IMessageWatcher } = require('./imessage');
const { Guard } = require('./guard');
const { Player } = require('./player');
const { Brain } = require('./brain');
const { STATUSES, SENDABLES } = require('./catalog');

const ROOT = path.join(__dirname, '..', '..');
const BUNDLED_ASSETS = path.join(ROOT, 'assets');
const IS_MAC = process.platform === 'darwin';

if (process.platform === 'linux') {
  // Wayland doesn't let apps keep a window on top or position it; XWayland does. The choice must be
  // made on the command line: by the time this file runs Electron has already picked Wayland, and
  // switching here leaves windows half-created and invisible. So restart once with the flag.
  if (!process.argv.includes('--ozone-platform=x11')) {
    app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=x11'] });
    app.exit(0);
  }
  // The GPU process crashes under XWayland on some drivers (seen on AMD/Mesa), and Chromium's
  // fallback can lose window transparency. The overlay is light, so draw it in software.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('enable-transparent-visuals');
}
// BA_PROFILE lets two copies run side by side on one computer for testing ("him" and "her").
if (process.env.BA_PROFILE) app.setPath('userData', path.join(app.getPath('appData'), `Bearly Apart (${process.env.BA_PROFILE})`));
if (!app.requestSingleInstanceLock()) app.quit();
// Opening the app again brings up Settings — the way in when there's no tray icon (stock GNOME).
app.on('second-instance', () => app.isReady() && stores && openSettings());

protocol.registerSchemesAsPrivileged([{ scheme: 'ba', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let stores, relay, imessage, guard, player, brain, tray, overlay;
let settingsWin = null;
let noteWin = null;
let scenes = {};
let aliases = {}; // "_aliases" in scenes.json: short names like "happy-brown" → real files

// ---------- assets & scenes -------------------------------------------------

function userAssetsDir() {
  return path.join(app.getPath('userData'), 'assets');
}

function resolveAsset(name) {
  const base = path.basename(name);
  const safe = path.basename(aliases[base.replace(/\.[a-z0-9]+$/i, '')] || aliases[base] || base);
  for (const dir of [userAssetsDir(), BUNDLED_ASSETS]) {
    const p = path.join(dir, safe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadScenes() {
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') log(`[scenes] ${f}: ${err.message}`);
      return {};
    }
  };
  // Your own scenes.json in the profile folder overrides the built-in ones by name.
  const bundled = read(path.join(BUNDLED_ASSETS, 'scenes.json'));
  const mine = read(path.join(app.getPath('userData'), 'scenes.json'));
  aliases = { ...bundled._aliases, ...mine._aliases };
  scenes = { ...bundled, ...mine };
  delete scenes._comment;
  delete scenes._aliases;
}

// ---------- overlay window --------------------------------------------------

function createOverlay() {
  overlay = new BrowserWindow({
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
    webPreferences: { preload: path.join(ROOT, 'src', 'overlay', 'preload.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(ROOT, 'src', 'overlay', 'index.html'));
}

function pickDisplay(front) {
  if (front?.bounds) return screen.getDisplayMatching(front.bounds);
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function render(req, front) {
  return new Promise((resolve) => {
    const scene = scenes[req.scene];
    if (!scene) {
      log(`[render] no scene named "${req.scene}"`);
      return resolve();
    }
    const display = pickDisplay(front);
    const b = display.bounds;
    overlay.setBounds(b);
    const win = front?.bounds ? { x: front.bounds.x - b.x, y: front.bounds.y - b.y, width: front.bounds.width, height: front.bounds.height } : null;
    const cfg = stores.config.data;
    // Scenes are authored for a ~900pt-tall screen; her 13" Air is ~956pt.
    const scale = cfg.scale * Math.min(1.4, Math.max(0.7, b.height / 900));
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearInterval(capture);
      ipcMain.removeListener('scene-done', done);
      overlay.setIgnoreMouseEvents(true, { forward: true });
      overlay.hide();
      resolve();
    };
    const timeout = setTimeout(done, 90_000);
    ipcMain.once('scene-done', done);
    overlay.webContents.send('play', { scene, vars: req.vars, ctx: { width: b.width, height: b.height, win, scale } });
    overlay.showInactive();
    overlay.setAlwaysOnTop(true, 'screen-saver');
    const capture = startCapture(req.scene);
  });
}

// BA_CAPTURE=dir saves a frame every 400ms while a scene plays (for testing without eyes).
function startCapture(name) {
  const dir = process.env.BA_CAPTURE;
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  let i = 0;
  return setInterval(async () => {
    const img = await overlay.webContents.capturePage().catch(() => null);
    if (img && !img.isEmpty()) fs.writeFileSync(path.join(dir, `${name}-${String(i++).padStart(3, '0')}.png`), img.toPNG());
  }, 400);
}

// ---------- tray -----------------------------------------------------------

function trayIcon() {
  const file = IS_MAC ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(BUNDLED_ASSETS, 'icons', file));
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function send(type, extra) {
  brain.send(type, extra).catch((err) => log(`[send] ${err.message}`));
}

function buildMenu() {
  const cfg = stores.config.data;
  const st = stores.state.data;
  const partner = cfg.partner.name || 'your love';
  const paired = !!cfg.partner.id;
  const status = st.partnerStatus && STATUSES[st.partnerStatus.name];
  const items = [];
  items.push({ label: paired ? `💞 ${partner}${status ? ` ${status.emoji} ${status.label} · ${ago(st.partnerStatus.at)}` : ''}` : '💞 Not paired yet — open Settings', enabled: false });
  if (paired && st.lastHeardAt) items.push({ label: `Last heard from: ${ago(st.lastHeardAt)}`, enabled: false });
  items.push({ label: relay.connected ? '● Connected' : '○ Connecting…', enabled: false });
  if (IS_MAC && cfg.imessage.enabled) {
    const s = imessage?.status;
    if (s === 'no-access')
      items.push({ label: '⚠️ iMessage: grant Full Disk Access…', click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles') });
    else if (s === 'ok' && !cfg.partner.imessageHandles.length) items.push({ label: '⚠️ iMessage: add their number in Settings', click: openSettings });
    else if (s === 'ok') items.push({ label: '✓ Watching iMessage', enabled: false });
  }
  if (st.noteJar.length) items.push({ label: `🫙 ${st.noteJar.length} note(s) waiting for the morning`, enabled: false });
  items.push({ type: 'separator' });
  items.push(
    ...Object.entries(SENDABLES).map(([type, s]) => ({ label: `${s.emoji}  Send ${type.replace('-', ' ')}`, enabled: paired, click: () => send(type) })),
  );
  items.push({
    label: '📣  Set my status',
    enabled: paired,
    submenu: Object.entries(STATUSES).map(([name, s]) => ({ label: `${s.emoji}  ${s.label.replace(/^is /, '')}`, click: () => send('status', { status: name }) })),
  });
  items.push({ label: '💌  Write a love note…', enabled: paired, click: openNote });
  items.push({ type: 'separator' });
  const snoozed = st.snoozedUntil > Date.now();
  items.push(
    snoozed
      ? { label: `🔕 Snoozed until ${new Date(st.snoozedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — resume`, click: () => snooze(0) }
      : {
          label: '🔕  Snooze animations',
          submenu: [
            { label: '30 minutes', click: () => snooze(30) },
            { label: '1 hour', click: () => snooze(60) },
            { label: '3 hours', click: () => snooze(180) },
            { label: 'Until tomorrow morning', click: () => snoozeUntilMorning() },
          ],
        },
  );
  items.push({
    label: '🎬  Preview animations',
    submenu: Object.keys(scenes)
      .sort()
      .map((name) => ({ label: name, click: () => preview(name) })),
  });
  items.push({ label: '⚙️  Settings…', click: openSettings });
  items.push({ label: '📂  Open custom GIF folder', click: () => (fs.mkdirSync(userAssetsDir(), { recursive: true }), shell.openPath(userAssetsDir())) });
  items.push({ type: 'separator' });
  items.push({ label: 'Quit Bearly Apart', click: () => app.quit() }); // no role: its Ctrl+Q accelerator makes GTK complain without a tray
  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  const st = stores.state.data;
  const status = st.partnerStatus && STATUSES[st.partnerStatus.name];
  if (IS_MAC) tray.setTitle(status ? status.emoji : '');
  tray.setToolTip(`Bearly Apart${status ? ` — ${stores.config.data.partner.name} ${status.label}` : ''}`);
  tray.setContextMenu(buildMenu());
}

function snooze(mins) {
  stores.state.set({ snoozedUntil: mins ? Date.now() + mins * 60_000 : 0 });
  refreshTray();
}

function snoozeUntilMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  stores.state.set({ snoozedUntil: d.getTime() });
  refreshTray();
}

function preview(name) {
  // Status scenes preview with their own label; everything else pretends to be "hungry".
  const status = name.startsWith('status-') && STATUSES[name.slice(7)] ? name.slice(7) : 'hungry';
  const vars = brain.vars({
    text: 'test',
    note: 'This is what a love note looks like 💌\nYou are my favorite person.',
    hours: 6,
    emoji: STATUSES[status].emoji,
    status,
    statusLabel: STATUSES[status].label,
    countdown: '12 days until you see each other',
  });
  player.play({ scene: name, vars, priority: 9, label: 'preview', preview: true });
}

// ---------- small windows --------------------------------------------------

function smallWindow(file, opts) {
  const win = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: true,
    minimizable: false,
    fullscreenable: false,
    title: 'Bearly Apart',
    backgroundColor: '#fff6f8',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(ROOT, 'src', 'settings', 'preload.js'), sandbox: true, contextIsolation: true },
    ...opts,
  });
  win.loadFile(path.join(ROOT, 'src', 'settings', file));
  if (IS_MAC) app.dock?.show();
  win.on('closed', () => {
    if (IS_MAC && !BrowserWindow.getAllWindows().some((w) => w !== overlay && !w.isDestroyed() && w.isVisible())) app.dock?.hide();
  });
  return win;
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = smallWindow('settings.html', { height: 760 });
}

function openNote() {
  if (noteWin && !noteWin.isDestroyed()) return noteWin.focus();
  noteWin = smallWindow('note.html', { width: 460, height: 420 });
}

function applyLoginItem() {
  const on = !!stores.config.data.launchAtLogin && app.isPackaged;
  if (process.platform === 'linux') {
    const file = path.join(app.getPath('home'), '.config', 'autostart', 'bearly-apart.desktop');
    if (on) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Bearly Apart\nExec="${process.execPath}"\nX-GNOME-Autostart-enabled=true\n`);
    } else fs.rmSync(file, { force: true });
  } else {
    app.setLoginItemSettings({ openAtLogin: on });
  }
}

function setupIpc() {
  ipcMain.on('overlay-clickable', (_, on) => overlay.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('poke-back', () => send('poke'));

  ipcMain.handle('settings:get', () => ({
    config: stores.config.data,
    pairing: encodePairing(stores.config.data),
    platform: process.platform,
    imessage: imessage?.status || 'off',
    profileDir: app.getPath('userData'),
    statuses: STATUSES,
    sendables: SENDABLES,
  }));
  ipcMain.handle('settings:save', (_, patch) => {
    const cur = stores.config.data;
    if (patch.me?.name !== undefined && !cur.me.id) patch.me.id = slug(patch.me.name);
    const relayChanged = patch.relay && (patch.relay.server !== cur.relay.server || patch.relay.topic !== cur.relay.topic || patch.relay.token !== cur.relay.token);
    stores.config.set(patch);
    if (relayChanged) {
      stores.state.set({ relaySince: '' });
      relay.restart();
    }
    if (IS_MAC) imessage?.start();
    applyLoginItem();
    refreshTray();
    return stores.config.data;
  });
  ipcMain.handle('settings:pair', (_, code) => {
    const p = decodePairing(code);
    stores.config.set({ relay: p.relay, partner: { ...stores.config.data.partner, ...p.partner } });
    stores.state.set({ relaySince: '', lastHeardAt: Date.now(), helloSent: true });
    relay.restart();
    // Tell the other side who we are so they don't have to type anything.
    setTimeout(() => send('hello'), 1500);
    refreshTray();
    return stores.config.data;
  });
  ipcMain.handle('settings:reset-pairing', () => {
    const { newTopic } = require('./store');
    stores.config.set({ relay: { topic: newTopic() }, partner: { id: '', name: '' } });
    stores.state.set({ relaySince: '' });
    relay.restart();
    refreshTray();
    return stores.config.data;
  });
  ipcMain.handle('try:list', () => ({ scenes: Object.keys(scenes).sort(), sendables: SENDABLES, statuses: STATUSES, paired: !!stores.config.data.partner.id }));
  ipcMain.handle('try:preview', (_, name) => preview(String(name)));
  ipcMain.handle('try:send', (_, { type, status }) => brain.send(String(type), status ? { status: String(status) } : {}));
  ipcMain.handle('try:snooze', (_, mins) => snooze(Number(mins) || 0));
  ipcMain.handle('note:send', async (_, { text, later }) => {
    await brain.send(later ? 'jar' : 'note', { text: String(text).slice(0, 2000) });
    return true;
  });
  ipcMain.handle('open-external', (_, url) => {
    if (/^(https:\/\/|x-apple\.systempreferences:)/.test(url)) shell.openExternal(url);
  });
}

// ---------- startup --------------------------------------------------------

app.whenReady().then(() => {
  if (IS_MAC) app.dock?.hide();
  stores = openStores(app.getPath('userData'));
  const cfg = () => stores.config.data;
  const st = () => stores.state.data;
  const setState = (p) => stores.state.set(p);
  loadScenes();
  fs.watch(app.getPath('userData'), (_, f) => f === 'scenes.json' && loadScenes());

  protocol.handle('ba', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''));
    const file = resolveAsset(name);
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  createOverlay();
  guard = new Guard({ getConfig: cfg, getState: st, powerMonitor, screen });
  player = new Player({ render, check: () => guard.check(), log });

  relay = new Relay({ getConfig: cfg, getSince: () => st().relaySince, setSince: (id) => setState({ relaySince: id }), log });
  brain = new Brain({
    config: cfg,
    state: st,
    setState: (p) => {
      setState(p);
      refreshTray();
    },
    play: (req) => player.play(req),
    publish: (ev, text) => relay.publish(ev, text),
    hasScene: (name) => !!scenes[name],
    log,
  });
  brain.onHello = (p) => {
    if (!p.id) return;
    stores.config.set({ partner: { id: p.id, name: p.name || cfg().partner.name, character: p.character || cfg().partner.character } });
    log(`[pair] paired with ${p.name} (${p.id})`);
    refreshTray();
  };
  relay.on('event', (ev) => {
    if (ev.from !== cfg().me.id) log(`[relay] ← ${ev.type}${ev.status ? `:${ev.status}` : ''} from ${ev.from}`);
    brain.onRelayEvent(ev);
  });
  relay.on('connection', (up) => {
    refreshTray();
    // Installed from a pre-paired kit: say hi once so the other side gets a "Paired!" bear.
    if (up && cfg().partner.id && cfg().me.id && !st().helloSent) {
      setState({ helloSent: true });
      send('hello');
    }
  });

  // BA_CHATDB points the watcher at a fake chat.db so the iMessage path can be tested off a Mac.
  if ((IS_MAC || process.env.BA_CHATDB) && cfg().imessage.enabled) {
    imessage = new IMessageWatcher({
      getConfig: cfg,
      getLastRowId: () => st().imessageLastRowId,
      setLastRowId: (id) => setState({ imessageLastRowId: id }),
      ...(process.env.BA_CHATDB ? { dbPath: process.env.BA_CHATDB } : {}),
      log,
    });
    imessage.on('message', (m) => {
      log(`[imessage] ${m.direction} ${m.type}${m.keywords.length ? ` [${m.keywords}]` : ''}`);
      if (m.direction === 'out') setState({ lastHeardAt: Date.now(), missingLevel: 0 });
      brain.onIMessage(m);
    });
    imessage.on('status', () => refreshTray());
    imessage.start();
  }

  setupIpc();
  tray = new Tray(trayIcon());
  tray.on('click', () => tray.popUpContextMenu());
  refreshTray();
  setInterval(refreshTray, 60_000);
  relay.start();
  applyLoginItem();

  powerMonitor.on('lock-screen', () => (guard.locked = true));
  powerMonitor.on('unlock-screen', () => {
    guard.locked = false;
    player.schedule(2000);
  });
  powerMonitor.on('resume', () => relay.restart());

  // Panic button: hide whatever is playing and snooze for an hour.
  globalShortcut.register('CommandOrControl+Alt+Shift+B', () => {
    overlay.hide();
    snooze(60);
  });

  setInterval(() => brain.tick({ idleSec: powerMonitor.getSystemIdleTime() }), 30_000);

  if (!cfg().me.name) openSettings();
  if (process.env.BA_DEMO) setTimeout(() => process.env.BA_DEMO.split(',').forEach(preview), 1500);
  log(`Bearly Apart ready (profile: ${app.getPath('userData')})`);
});

app.on('window-all-closed', () => {
  /* stay in the tray */
});
app.on('will-quit', () => globalShortcut.unregisterAll());
