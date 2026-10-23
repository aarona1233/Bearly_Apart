// App startup: wires the relay, iMessage watcher, brain, player and windows together, and holds the
// actions the window and tray menu call (send, preview, snooze, settings).
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, dialog, shell, powerMonitor, powerSaveBlocker, protocol, net, globalShortcut, Notification } = require('electron');
const { openStores, slug, newTopic, encodePairing, decodePairing } = require('./store');
const { Relay } = require('./relay');
const { IMessageWatcher } = require('./imessage');
const { Guard } = require('./guard');
const { Player } = require('./player');
const { Brain } = require('./brain');
const { Activity } = require('./activity');
const { OverlayWindow } = require('./overlay-window');
const { UI } = require('./ui');
const { STATUSES, SENDABLES, GIFTS, describe } = require('./catalog');

const BUNDLED_ASSETS = path.join(__dirname, '..', '..', 'assets');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

// Windows Setup.exe (Squirrel) runs the app with --squirrel-* while installing and uninstalling: make or
// remove the Start menu / desktop shortcuts, then quit. Update.exe sits one folder up from the app.
const SQUIRREL_UPDATE = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
function handleSquirrel() {
  const cmd = IS_WIN ? process.argv[1] : '';
  if (!cmd?.startsWith('--squirrel-') || cmd === '--squirrel-firstrun') return false;
  const exe = path.basename(process.execPath);
  const update = (args) => require('child_process').spawn(SQUIRREL_UPDATE, args, { detached: true }).on('error', () => {});
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') update([`--createShortcut=${exe}`, '--shortcut-locations=StartMenu,Desktop']);
  if (cmd === '--squirrel-uninstall') {
    update([`--removeShortcut=${exe}`, '--shortcut-locations=StartMenu,Desktop']);
    app.setLoginItemSettings({ openAtLogin: false, path: SQUIRREL_UPDATE, args: ['--processStart', `"${exe}"`] });
  }
  setTimeout(() => {
    // Squirrel removes the Start menu shortcut but leaves its empty folder behind.
    if (cmd === '--squirrel-uninstall') fs.rmSync(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Bearly Apart'), { recursive: true, force: true });
    app.quit();
  }, 1000);
  return true;
}
const INSTALLER_RUN = handleSquirrel();

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
if (!INSTALLER_RUN && !app.requestSingleInstanceLock()) app.quit();
// Opening the app again brings up its window: the way in when there's no tray icon (stock GNOME), or the 💗 is
// hidden behind a MacBook's notch. Windows/Linux start a second copy ('second-instance'); a Mac doesn't, it sends
// 'activate' to the running one. 'activate' also fires once at launch, so the first few seconds are ignored.
let readyAt = Infinity;
app.on('second-instance', () => ui?.openWindow());
app.on('activate', () => Date.now() - readyAt > 3000 && ui?.openWindow());

protocol.registerSchemesAsPrivileged([{ scheme: 'ba', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let stores, relay, imessage, guard, player, brain, overlay, ui;
const activity = new Activity();
let scenes = {};
let aliases = {}; // "_aliases" in scenes.json: short names like "happy-brown" → real files

const cfg = () => stores.config.data;
const st = () => stores.state.data;
const partnerName = () => cfg().partner.name || 'your love';

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

// ---------- actions (used by the window, the tray menu and the overlay) ----

function outText(type, extra) {
  if (type === 'status') return extra.status === 'clear' ? 'You cleared your status' : `You set your status: ${STATUSES[extra.status]?.emoji || ''} ${STATUSES[extra.status]?.short || extra.status}`;
  if (type === 'note') return 'You sent a love note 💌';
  if (type === 'jar') return `You saved a note for ${partnerName()}'s morning 🫙`;
  if (type === 'hello') return 'You said hi 👋';
  if (type === 'gift') return `You sent ${GIFTS[extra.gift]?.emoji || '✨'} ${GIFTS[extra.gift]?.label || extra.gift}`;
  const s = SENDABLES[type];
  return s ? `You sent a ${s.short.toLowerCase()} ${s.emoji}` : `You sent ${type}`;
}

function incomingText(ev) {
  // Notes stay private to the overlay card (and jar notes are a surprise for the morning).
  if (ev.type === 'note') return `💌 ${partnerName()} sent you a love note`;
  if (ev.type === 'jar') return `🫙 ${partnerName()} saved a note for your morning`;
  return describe(ev, partnerName());
}

// Sends one event and records it in Recent. Never throws: returns { ok, error }.
async function sendEvent(type, extra = {}, { notify = false } = {}) {
  const id = activity.add({ dir: 'out', text: outText(type, extra), state: 'sending' });
  try {
    await brain.send(type, extra);
    activity.update(id, { state: 'sent' });
    return { ok: true };
  } catch (err) {
    log(`[send] ${type}: ${err.message}`);
    activity.update(id, { state: 'failed', error: err.message });
    // From the tray there's no window to show the error in, so say it out loud.
    if (notify && Notification.isSupported()) new Notification({ title: 'Bearly Apart', body: `Couldn't send that: ${err.message}. Check your internet and try again.` }).show();
    return { ok: false, error: err.message };
  }
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

function snooze(mins) {
  stores.state.set({ snoozedUntil: mins ? Date.now() + mins * 60_000 : 0 });
  ui.refresh();
}

function snoozeUntilMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  stores.state.set({ snoozedUntil: d.getTime() });
  ui.refresh();
}

function saveSettings(patch) {
  const cur = cfg();
  if (patch.me?.name !== undefined && !cur.me.id) patch.me.id = slug(patch.me.name);
  stores.config.set(patch);
  if (IS_MAC) imessage?.start();
  applyLoginItem();
  ui.refresh();
  return cfg();
}

function pair(code) {
  const p = decodePairing(code);
  if (!p.partner.id) throw new Error('That invite is from an app with no name set yet.');
  // Two people called the same thing would look like one person's echo.
  if (p.partner.id === cfg().me.id) stores.config.set({ me: { id: `${cfg().me.id}2` } });
  stores.config.set({ relay: p.relay, partner: { ...cfg().partner, ...p.partner } });
  stores.state.set({ relaySince: '', lastHeardAt: Date.now(), helloSent: true });
  relay.restart();
  // Tell the other side who we are so they don't have to type anything.
  setTimeout(() => sendEvent('hello'), 1500);
  ui.refresh();
  return cfg();
}

function resetPairing() {
  stores.config.set({ relay: { topic: newTopic() }, partner: { id: '', name: '' } });
  stores.state.set({ relaySince: '' });
  relay.restart();
  ui.refresh();
  return cfg();
}

// What the window shows live (pushed whenever something changes).
function liveState() {
  const s = st();
  return {
    paired: !!cfg().partner.id,
    connected: relay.connected,
    paused: player.blockedReason,
    snoozedUntil: s.snoozedUntil > Date.now() ? s.snoozedUntil : 0,
    partnerStatus: s.partnerStatus,
    myStatus: s.myStatus,
    lastHeardAt: s.lastHeardAt,
    noteJar: s.noteJar.length,
    imessage: imessage?.status || 'off',
    activity: activity.items,
  };
}

function applyLoginItem() {
  const on = !!cfg().launchAtLogin && app.isPackaged;
  if (process.platform === 'linux') {
    const file = path.join(app.getPath('home'), '.config', 'autostart', 'bearly-apart.desktop');
    if (on) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Bearly Apart\nExec="${process.execPath}"\nX-GNOME-Autostart-enabled=true\n`);
    } else fs.rmSync(file, { force: true });
  } else if (IS_WIN && fs.existsSync(SQUIRREL_UPDATE)) {
    // Installed with Setup.exe: start through Update.exe, which always points at the current version.
    app.setLoginItemSettings({ openAtLogin: on, path: SQUIRREL_UPDATE, args: ['--processStart', `"${path.basename(process.execPath)}"`] });
  } else {
    app.setLoginItemSettings({ openAtLogin: on });
  }
}

// ---------- first-run setup helpers (Mac) ------------------------------------

// The app has to live in Applications: Full Disk Access belongs to the app at its path. We don't move it
// ourselves: macOS's move puts the original in the Trash and, on her Mac, the restart afterwards failed,
// so she kept opening the copy in the Trash. Instead: say so, open Downloads and Applications, and quit.
function askToMoveToApplications() {
  dialog.showMessageBoxSync({
    type: 'info',
    title: 'Bearly Apart',
    message: 'Almost there! Move Bearly Apart into Applications first.',
    detail:
      'Two Finder windows will open. Drag Bearly Apart from Downloads into Applications ' +
      '(replace the old one if asked), then open it from Applications.',
    buttons: ['Show me'],
  });
  shell.openPath(app.getPath('downloads'));
  shell.openPath('/Applications');
  app.quit();
}

// Asks the iMessage watcher to try chat.db again right now; returns 'ok', 'no-access', 'missing' or 'off'.
function checkTextAccess() {
  if (!imessage) return 'off';
  imessage.start();
  ui.refresh();
  return imessage.status;
}

function relaunch() {
  app.relaunch();
  app.exit(0);
}

// ---------- startup --------------------------------------------------------

app.whenReady().then(() => {
  if (INSTALLER_RUN) return;
  // Opened from Downloads (or the Trash)? It needs to be in Applications first.
  if (IS_MAC && app.isPackaged && !app.isInApplicationsFolder()) return askToMoveToApplications();
  if (IS_MAC) app.dock?.hide();
  // A menu-bar app with no visible window gets "App Napped" by macOS: timers and network slow to a
  // crawl, so bears showed up late or in clumps. This keeps it awake (it doesn't stop the Mac sleeping).
  if (IS_MAC) powerSaveBlocker.start('prevent-app-suspension');
  stores = openStores(app.getPath('userData'));
  loadScenes();
  fs.watch(app.getPath('userData'), (_, f) => f === 'scenes.json' && loadScenes());

  protocol.handle('ba', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''));
    const file = resolveAsset(name);
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  overlay = new OverlayWindow({ getScene: (name) => scenes[name], getScale: () => cfg().scale, log });
  guard = new Guard({ getConfig: cfg, getState: st, powerMonitor, screen: require('electron').screen });
  player = new Player({ render: (req, front) => overlay.render(req, front), check: () => guard.check(), log });
  player.onBlocked = () => ui?.refresh();

  relay = new Relay({
    getConfig: cfg,
    getSince: () => st().relaySince,
    setSince: (id) => stores.state.set({ relaySince: id }),
    publishFetch: (url, opts) => net.fetch(url, opts),
    log,
  });
  brain = new Brain({
    config: cfg,
    state: st,
    setState: (p) => {
      stores.state.set(p);
      ui?.refresh();
    },
    play: (req) => player.play(req),
    publish: (ev, text) => relay.publish(ev, text),
    hasScene: (name) => !!scenes[name],
    log,
  });
  brain.onHello = (p) => {
    if (!p.id) return;
    const partner = { id: p.id, name: p.name || cfg().partner.name, character: p.character || cfg().partner.character };
    if (p.timezone) partner.timezone = p.timezone;
    if (p.handles?.length) partner.imessageHandles = p.handles;
    stores.config.set({ partner });
    log(`[pair] paired with ${p.name} (${p.id})`);
    ui?.refresh();
  };
  relay.on('event', (ev) => {
    if (ev.from !== cfg().me.id) {
      log(`[relay] ← ${ev.type}${ev.status ? `:${ev.status}` : ''} from ${ev.from}`);
      if (ev.from === cfg().partner.id || ev.type === 'hello') activity.add({ dir: 'in', text: incomingText(ev) });
    }
    brain.onRelayEvent(ev);
  });
  relay.on('connection', (up) => {
    ui?.refresh();
    // Installed from a pre-paired kit: say hi once so the other side gets a "Paired!" bear.
    if (up && cfg().partner.id && cfg().me.id && !st().helloSent) {
      stores.state.set({ helloSent: true });
      sendEvent('hello');
    }
  });

  // BA_CHATDB points the watcher at a fake chat.db so the iMessage path can be tested off a Mac.
  if ((IS_MAC || process.env.BA_CHATDB) && cfg().imessage.enabled) {
    imessage = new IMessageWatcher({
      getConfig: cfg,
      getLastRowId: () => st().imessageLastRowId,
      setLastRowId: (id) => stores.state.set({ imessageLastRowId: id }),
      ...(process.env.BA_CHATDB ? { dbPath: process.env.BA_CHATDB } : {}),
      log,
    });
    imessage.on('message', (m) => {
      log(`[imessage] ${m.direction} ${m.type}${m.keywords.length ? ` [${m.keywords}]` : ''}`);
      if (m.direction === 'out') stores.state.set({ lastHeardAt: Date.now(), missingLevel: 0 });
      else activity.add({ dir: 'in', text: `💬 ${partnerName()} texted you${m.keywords.length ? ` (${m.keywords.join(', ')})` : ''}` });
      brain.onIMessage(m);
    });
    imessage.on('status', () => ui?.refresh());
    imessage.start();
  }

  ui = new UI({
    stores,
    log,
    sceneNames: () => Object.keys(scenes),
    getScene: (name) => scenes[name],
    liveState,
    pairingCode: () => encodePairing(cfg()),
    actions: { sendEvent, preview, snooze, snoozeUntilMorning, saveSettings, pair, resetPairing, userAssetsDir, checkTextAccess, relaunch },
  });
  activity.on('change', () => ui.refresh());
  ui.start();
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

  if (!cfg().setupDone) ui.openWindow('setup');
  if (process.env.BA_DEMO) setTimeout(() => process.env.BA_DEMO.split(',').forEach(preview), 1500);
  if (process.env.BA_OPEN) ui.openWindow(process.env.BA_OPEN);
  readyAt = Date.now();
  log(`Bearly Apart ready (profile: ${app.getPath('userData')})`);
});

app.on('window-all-closed', () => {
  /* stay in the tray */
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stores?.state.flush();
});
