// App startup: wires the relay, iMessage watcher, brain, player and windows together, and holds the
// actions the window and tray menu call (send, preview, snooze, settings).
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, dialog, shell, powerMonitor, powerSaveBlocker, protocol, net, globalShortcut, Notification } = require('electron');
const os = require('os');
const { openStores, slug, newTopic, encodePairing, encodeLink, decodePairing } = require('./store');
const { Relay } = require('./relay');
const { IMessageWatcher } = require('./imessage');
const { Guard } = require('./guard');
const { Player } = require('./player');
const { Brain } = require('./brain');
const { Activity } = require('./activity');
const { OverlayWindow } = require('./overlay-window');
const { UI, pauseText } = require('./ui');
const { createLogger } = require('./logger');
const { runDiagnostics, formatReport, summary } = require('./diagnostics');
const { MAC_TARGET, INSTALL_SH, UPDATE_SH, compareVersions, plistVersion, needsInstall } = require('./mac-install');
const { Updater } = require('./updater');
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
    app.setLoginItemSettings({ openAtLogin: false, path: SQUIRREL_UPDATE, args: ['--processStart', exe] });
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
// A Mac copy opened from Downloads installs itself (replacing an older copy, which it quits first), so it mustn't
// hand over to, or be blocked by, that older copy.
// (A plain path check: it runs before the app is ready, where Electron's own check isn't promised to work.)
const NEEDS_MOVE = IS_MAC && app.isPackaged && needsInstall(process.execPath);
if (!INSTALLER_RUN && !NEEDS_MOVE && !app.requestSingleInstanceLock()) app.quit();
// Opening the app again brings up its window: the way in when there's no tray icon (stock GNOME), or the 💗 is
// hidden behind a MacBook's notch. Windows/Linux start a second copy ('second-instance'); a Mac doesn't, it sends
// 'activate' to the running one. 'activate' also fires once at launch, so the first few seconds are ignored.
let readyAt = Infinity;
app.on('second-instance', () => ui?.openWindow());
app.on('activate', () => Date.now() - readyAt > 3000 && ui?.openWindow());

protocol.registerSchemesAsPrivileged([{ scheme: 'ba', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// Printed as before, and kept in bearly-apart.log in the settings folder (see logger.js).
const log = createLogger();
log.setFile(path.join(app.getPath('userData'), 'bearly-apart.log'));
// An unexpected error in the background part goes into the log instead of a crash dialog: the app keeps going.
process.on('uncaughtException', (err) => log('[crash] uncaught error:', err));
process.on('unhandledRejection', (err) => log('[crash] unhandled promise:', err));
let stores, relay, imessage, guard, player, brain, overlay, ui, updater;
const activity = new Activity();
let scenes = {};
let justUpdated = false; // a newer version than last time, on an already set-up install
let aliases = {}; // "_aliases" in scenes.json: short names like "happy-brown" → real files

const cfg = () => stores.config.data;
// This computer's name as the other computers show it ("DESKTOP-4F2K", "Aarons-MacBook-Air").
const DEVICE_NAME = os.hostname().replace(/\.local$/i, '').replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 32) || 'computer';
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
    const sent = await brain.send(type, extra);
    activity.update(id, { state: 'sent', relayAt: (sent?.time || 0) * 1000 || Date.now() });
    return { ok: true, away: st().partnerPresence?.state === 'away' };
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

// An invite from them, or a link code from my other computer (then this computer simply becomes me as well:
// same name, bear, partner and relay, and no "paired" hello, since nothing changes for them).
function pair(code) {
  const p = decodePairing(code);
  if (p.link) {
    if (!p.me.id || !p.partner.id) throw new Error('That link code is from a computer that isn’t set up yet.');
    stores.config.set({ me: p.me, partner: p.partner, relay: p.relay });
    stores.state.set({ relaySince: '', lastHeardAt: Date.now(), helloSent: true });
    relay.restart();
    ui.refresh();
    return { ...cfg(), linked: true };
  }
  if (!p.partner.id) throw new Error('That invite is from an app with no name set yet.');
  if (cfg().me.id && p.partner.id === cfg().me.id && p.partner.name === cfg().me.name) {
    throw new Error('That’s your own invite. To use Bearly Apart on another computer of yours, use a link code (Settings → Your computers).');
  }
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

// ---------- presence ("here" / "away") -----------------------------------------
// Their app learns when this computer is in use, so they know whether a kiss will be seen now or later.
// Sent only when it changes (idle past awayAfterSec, screen locked, asleep, quitting), as a silent message.
let presence = 'here';
let announced = null;

// Bookkeeping messages (presence, seen): no Recent entry, no error popups.
function sendQuiet(type, extra) {
  if (!cfg().partner.id || !cfg().me.id) return Promise.resolve();
  return brain.send(type, extra).catch((err) => log(`[${type}] ${err.message}`));
}

function announcePresence() {
  // Not until there's someone to tell (a new computer announces once it's paired or linked).
  if (!relay?.connected || !cfg().partner.id || !cfg().me.id || announced === presence) return Promise.resolve();
  announced = presence;
  return sendQuiet('presence', { presence });
}

function setPresence(next) {
  presence = next;
  return announcePresence();
}

function checkPresence() {
  const idle = powerMonitor.getSystemIdleTime();
  setPresence(guard?.locked || idle > cfg().awayAfterSec ? 'away' : 'here');
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
    partnerPresence: s.partnerPresence,
    myStatus: s.myStatus,
    myDevices: s.myDevices,
    lastHeardAt: s.lastHeardAt,
    noteJar: s.noteJar.length,
    imessage: imessage?.status || 'off',
    justUpdated,
    update: updater?.state || null,
    check: lastCheck,
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
    app.setLoginItemSettings({ openAtLogin: on, path: SQUIRREL_UPDATE, args: ['--processStart', path.basename(process.execPath)] });
  } else {
    // macOS 13+ registers this through the system's login items, which can refuse an app that isn't signed by
    // Apple. Starting at login is nice to have, so never let it break anything else.
    try {
      app.setLoginItemSettings({ openAtLogin: on });
    } catch (err) {
      log(`[login item] ${err.message}`);
    }
  }
}

// ---------- installing on the Mac --------------------------------------------


function installedMacVersion() {
  try {
    return plistVersion(fs.readFileSync(path.join(MAC_TARGET, 'Contents', 'Info.plist'), 'utf8'));
  } catch {
    return null;
  }
}

function runInstallScript(mode) {
  // The bundle this copy runs from (macOS may run a downloaded app from a hidden read-only copy; that's fine).
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  const r = require('child_process').spawnSync('/bin/sh', ['-c', INSTALL_SH, 'sh', bundle, MAC_TARGET, app.getPath('home'), mode], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (r.status !== 0) log(`[install] ${mode} failed (${r.status}): ${r.stderr || r.error?.message || ''}`);
  return r.status === 0;
}

function openInstalledAndQuit() {
  require('child_process').spawn('/bin/sh', ['-c', 'sleep 1; open "$1"', 'sh', MAC_TARGET], { detached: true, stdio: 'ignore' }).unref();
  app.exit(0);
}

function installToApplications() {
  app.focus({ steal: true }); // a menu-bar app isn't brought to the front by itself; the message could hide
  const installed = installedMacVersion();
  const mine = app.getVersion();
  // An older download opened by mistake (Safari names a second download "Bearly Apart 2"): never downgrade.
  if (installed && compareVersions(installed, mine) >= 0) {
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Bearly Apart',
      message: installed === mine ? 'Bearly Apart is already installed.' : `You already have a newer Bearly Apart (${installed}).`,
      detail: 'Opening the one in Applications, and tidying away this extra copy.',
      buttons: ['OK'],
    });
    runInstallScript('tidy');
    return openInstalledAndQuit();
  }
  const choice = dialog.showMessageBoxSync({
    type: 'info',
    title: 'Bearly Apart',
    message: installed ? `Update Bearly Apart to ${mine}?` : 'Install Bearly Apart?',
    detail:
      (installed
        ? `This replaces Bearly Apart ${installed} in your Applications folder. Your settings and pairing are kept.`
        : 'Bearly Apart goes into your Applications folder and opens from there.') +
      '\n\nAny other copies in Downloads and old installers are cleared away, so there is only one.' +
      (installed ? '\n\nYour Mac may ask whether Bearly Apart can control Finder (that is how it swaps out the old version): click OK.' : ''),
    buttons: [installed ? 'Update' : 'Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice === 1) return app.quit();
  if (!runInstallScript('install')) return askToMoveToApplications();
  openInstalledAndQuit();
}

// Fallback if installing didn't work (for example an account that can't write to Applications).
function askToMoveToApplications() {
  app.focus({ steal: true }); // a menu-bar app isn't brought to the front by itself; the message could hide
  dialog.showMessageBoxSync({
    type: 'info',
    title: 'Bearly Apart',
    message: 'Almost there! Move Bearly Apart into Applications first.',
    detail:
      'Two Finder windows will open. Drag Bearly Apart from Downloads into Applications ' +
      '(replace the old one if asked), then open it from Applications.\n\n' +
      'If Finder says Bearly Apart is open, quit the old one first: 💗 in the menu bar → Quit Bearly Apart.',
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

// ---------- updating itself (see updater.js) ----------------------------------
// Which GitHub repo's releases to update from ("updates.github" in package.json) and the key they must be signed with.
const PKG = require('../../package.json');
const UPDATE_KEY = path.join(BUNDLED_ASSETS, 'update-public.pem');

// The Mac: unpack the verified zip, check it's the version promised, then quit and let UPDATE_SH swap it in and
// reopen it. Settings and pairing live in Application Support, so they carry over.
async function installMacUpdate(zip, m) {
  const { execFile, spawn } = require('child_process');
  const work = path.dirname(zip);
  const unpacked = path.join(work, `unpacked-${m.version}`);
  fs.rmSync(unpacked, { recursive: true, force: true });
  await new Promise((resolve, reject) =>
    execFile('/usr/bin/ditto', ['-x', '-k', zip, unpacked], (err) => (err ? reject(new Error(`could not unpack the update (${err.message})`)) : resolve())),
  );
  const bundle = path.join(unpacked, 'Bearly Apart.app');
  const plist = fs.readFileSync(path.join(bundle, 'Contents', 'Info.plist'), 'utf8');
  const version = plistVersion(plist);
  if (version !== m.version) throw new Error(`the download is version ${version}, not ${m.version}`);
  // The same app, not some other one that happens to be signed: its bundle id has to match this copy's.
  const id = (xml) => String(xml).match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  const mine = id(fs.readFileSync(path.join(MAC_TARGET, 'Contents', 'Info.plist'), 'utf8'));
  if (!mine || id(plist) !== mine) throw new Error('the download is not Bearly Apart');
  stores.state.set({ updatedFrom: app.getVersion() });
  stores.state.flush();
  await Promise.race([setPresence('away'), new Promise((r) => setTimeout(r, 1500))]);
  const logFile = path.join(app.getPath('logs'), 'update.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  spawn('/bin/sh', ['-c', UPDATE_SH, 'sh', bundle, MAC_TARGET, app.getPath('home'), work, logFile], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BA_INSTALL_SH: INSTALL_SH },
  }).unref();
  quitting = true; // skip the "away" round trip in before-quit, it was just sent
  app.exit(0);
}

function startUpdater() {
  let publicKey = '';
  try {
    publicKey = fs.readFileSync(UPDATE_KEY, 'utf8');
  } catch {
    /* no release key in this build: updates stay off */
  }
  updater = new Updater({
    version: app.getVersion(),
    repo: PKG.updates?.github || '',
    publicKey,
    getToken: () => cfg().updateToken,
    // Node's fetch rather than net.fetch: the updater follows GitHub's redirects itself (redirect: 'manual'), so the
    // update key is never sent along to the storage server.
    fetch: (url, opts) => globalThis.fetch(url, opts),
    downloadDir: path.join(app.getPath('temp'), 'bearly-apart-update'),
    install: installMacUpdate,
    // Only an installed Mac copy swaps itself; Windows and Linux (and running from source) just say a newer one exists.
    canInstall: IS_MAC && app.isPackaged && !NEEDS_MOVE,
    enabled: () => cfg().autoUpdate !== false,
    onChange: () => ui?.refresh(),
    log,
  });
  updater.start();
}

function checkForUpdates() {
  return updater ? updater.check() : null;
}

// Settings → Updates: the read-only GitHub key for a private repo ('' removes it). Saved in config.json only.
function setUpdateKey(key) {
  const token = String(key || '').trim();
  if (token && !/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) return { ok: false, error: 'That doesn’t look like a GitHub key (it starts with github_pat_).' };
  stores.config.set({ updateToken: token });
  ui.refresh();
  return { ok: true };
}

// ---------- checks (the Check tab; see diagnostics.js) ----------------------------

let lastCheck = { running: false, at: 0, results: [], summary: '' };
const newNonce = () => crypto.randomBytes(4).toString('hex');
const OS_NAME = `${IS_MAC ? 'macOS' : IS_WIN ? 'Windows' : 'Linux'} ${process.getSystemVersion?.() || ''}`.trim();

// Resolves with the first relay event that matches, or null after ms.
function waitForEvent(match, ms) {
  return new Promise((resolve) => {
    const onEvent = (ev) => match(ev) && done(ev);
    const timer = setTimeout(() => done(null), ms);
    function done(value) {
      clearTimeout(timer);
      relay.off('event', onEvent);
      resolve(value);
    }
    relay.on('event', onEvent);
  });
}

// Log lines from the last day that look like something went wrong.
function recentErrors() {
  const since = Date.now() - 24 * 3600_000;
  return log
    .tail(600)
    .filter((line) => Date.parse(line.slice(0, 24)) >= since && /\b(error|failed|cannot|crash|refused|denied|no keepalive)\b/i.test(line));
}

// The few facts their app's check wants to know about this one (sent back in a pong).
async function healthSnapshot() {
  const g = await guard.check().catch(() => ({ ok: true }));
  return { version: app.getVersion(), os: OS_NAME, connected: relay.connected, imessage: imessage?.status || 'off', paused: g.ok ? '' : pauseText(g.reason), errors: recentErrors().length };
}

function diagnosticsContext() {
  return {
    version: app.getVersion(),
    os: OS_NAME,
    deviceName: DEVICE_NAME,
    config: cfg(),
    isMac: IS_MAC,
    packaged: app.isPackaged,
    imessage: imessage?.status || 'off',
    update: updater?.state || null,
    relayConnected: () => relay.connected,
    relayReachable: async () => {
      const started = Date.now();
      const { server, topic } = cfg().relay;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        // Only the answer's status matters; the body is dropped (some relays keep the line open).
        const res = await net.fetch(`${server.replace(/\/+$/, '')}/${encodeURIComponent(topic)}/json?poll=1&since=1s`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`the relay answered HTTP ${res.status}`);
        res.body?.cancel().catch(() => {});
        return Date.now() - started;
      } catch (err) {
        if (err.name === 'AbortError') throw new Error(`${server} didn’t answer within 8 seconds (no internet, or the relay is down)`);
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    // A quiet message to ourselves: it has to go out and come back through the live connection.
    roundTrip: async () => {
      const nonce = newNonce();
      const started = Date.now();
      const back = waitForEvent((ev) => ev.type === 'diag' && ev.nonce === nonce, 10_000);
      await brain.send('diag', { nonce });
      if (!(await back)) throw new Error('the test message went out but never came back: the live connection may be stuck (it reconnects by itself; try again in a minute)');
      return Date.now() - started;
    },
    // Their app answers a ping with a pong carrying its health (if it's running and 0.7 or newer).
    askPartner: async () => {
      const nonce = newNonce();
      const back = waitForEvent((ev) => ev.type === 'pong' && ev.nonce === nonce && ev.from === cfg().partner.id, 20_000);
      await brain.send('ping', { nonce });
      const ev = await back;
      if (!ev) return null;
      try {
        return JSON.parse(ev.text);
      } catch {
        return { version: '?' };
      }
    },
    artCheck: () => {
      const used = new Set();
      const walk = (o) => {
        if (Array.isArray(o)) o.forEach(walk);
        else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) (k === 'asset' || k === 'src') && typeof v === 'string' ? used.add(v) : walk(v);
      };
      walk(scenes);
      const missing = new Set();
      for (const a of used) for (const bear of ['brown', 'cream']) {
        const name = a.replace(/\{pc\}|\{mc\}/g, bear);
        if (!resolveAsset(name)) missing.add(name);
      }
      return { scenes: Object.keys(scenes).length, missing: [...missing] };
    },
    overlayOk: () => !!overlay?.win && !overlay.win.isDestroyed() && !overlay.win.webContents.isCrashed(),
    pausedReason: async () => {
      const g = await guard.check();
      return g.ok ? '' : pauseText(g.reason);
    },
    statusesWithoutScene: () => (scenes.status ? [] : Object.keys(STATUSES).filter((s) => !scenes[`status-${s}`])),
    recentErrors,
  };
}

// Runs every check, keeps the result for the Check tab, and writes diagnostics.txt next to the log.
async function runChecks({ partner = true } = {}) {
  if (lastCheck.running) return lastCheck;
  lastCheck = { running: true, at: Date.now(), results: [], summary: '' };
  ui?.refresh();
  const results = await runDiagnostics(diagnosticsContext(), {
    partner: partner && !!cfg().partner.id,
    onProgress: (r) => {
      lastCheck = { ...lastCheck, results: [...r] };
      ui?.refresh();
    },
  });
  lastCheck = { running: false, at: Date.now(), results, summary: summary(results) };
  log(`[check] ${lastCheck.summary}: ${results.filter((r) => r.status !== 'ok' && r.status !== 'skip').map((r) => `${r.label}: ${r.detail}`).join(' | ') || 'all ok'}`);
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'diagnostics.txt'), checkReport());
  } catch {
    /* the report is still in the window */
  }
  ui?.refresh();
  return lastCheck;
}

function checkReport() {
  return formatReport(lastCheck.results, { when: new Date(lastCheck.at || Date.now()), logTail: log.tail(60) });
}

// Once per new version: run the checks and, if something is broken, say so (notification + the Check tab).
async function autoCheck() {
  if (!cfg().setupDone || st().lastCheckedVersion === app.getVersion()) return;
  const r = await runChecks({ partner: true });
  stores.state.set({ lastCheckedVersion: app.getVersion() });
  const broken = r.results.filter((x) => x.status === 'fail');
  if (!broken.length) return;
  if (Notification.isSupported()) new Notification({ title: 'Bearly Apart: something isn’t working', body: `${broken[0].label}: ${broken[0].detail}` }).show();
  // Full Disk Access after an update has its own step that opens by itself; don't pull her away from it.
  if (broken.some((x) => x.id !== 'texts')) ui.openWindow('check');
}

// ---------- startup --------------------------------------------------------

app.whenReady().then(() => {
  if (INSTALLER_RUN) return;
  // Opened from Downloads (or the Trash)? It needs to be in Applications first.
  if (NEEDS_MOVE) return installToApplications();
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
  // If the see-through window's page dies, log it and bring it back rather than leaving bears invisible.
  overlay.win.webContents.on('render-process-gone', (_, d) => {
    log(`[crash] animation window: ${d.reason}`);
    if (!overlay.win.isDestroyed()) overlay.win.reload();
  });
  guard = new Guard({ getConfig: cfg, getState: st, powerMonitor, screen: require('electron').screen });
  player = new Player({ render: (req, front) => overlay.render(req, front), check: () => guard.check(), hasScene: (name) => !!scenes[name], log });
  player.onBlocked = () => ui?.refresh();
  // Waiting scenes are saved, so quitting or a restart doesn't lose them.
  player.onChange = (queue, since) => stores.state.set({ pendingScenes: queue, pendingSince: queue.length ? since : 0 });
  player.restore(st().pendingScenes, st().pendingSince);
  // Tell their app what was actually seen, so their Recent list can show 👀.
  player.onPlayed = (items) => {
    const at = Math.max(0, ...items.filter((i) => i.fromPartner && i.ev?.at).map((i) => i.ev.at));
    if (at) sendQuiet('seen', { until: Math.floor(at / 1000) });
  };

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
    device: st().deviceId,
    deviceName: DEVICE_NAME,
    log,
  });
  brain.onSeen = (until) => activity.markSeen(until * 1000);
  // Their app's check asked how this one is doing: answer with a short health summary.
  brain.onPing = async (ev) => sendQuiet('pong', { nonce: ev.nonce, text: JSON.stringify(await healthSnapshot()) });
  brain.onMyOtherComputer = (ev, name) =>
    activity.add({ dir: 'out', text: `${outText(ev.type, ev)} (on ${name})`, state: 'sent', relayAt: ev.at });
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
      const bookkeeping = ['presence', 'seen', 'diag', 'ping', 'pong'].includes(ev.type);
      if (!bookkeeping && (ev.from === cfg().partner.id || ev.type === 'hello')) activity.add({ dir: 'in', text: incomingText(ev) });
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
    if (up) announcePresence(); // whatever changed while offline
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
    linkCode: () => encodeLink(cfg()),
    deviceName: DEVICE_NAME,
    actions: { sendEvent, preview, snooze, snoozeUntilMorning, saveSettings, pair, resetPairing, userAssetsDir, checkTextAccess, relaunch, checkForUpdates, setUpdateKey, runChecks, checkReport, logFile: () => log.file() },
  });
  activity.on('change', () => ui.refresh());
  ui.start();
  relay.start();
  applyLoginItem();
  startUpdater();
  // After every install or update: check everything once, and say so if something's wrong.
  setTimeout(autoCheck, 30_000);

  powerMonitor.on('lock-screen', () => {
    guard.locked = true;
    checkPresence();
  });
  powerMonitor.on('unlock-screen', () => {
    guard.locked = false;
    checkPresence();
    player.schedule(2000);
  });
  powerMonitor.on('suspend', () => setPresence('away'));
  powerMonitor.on('resume', () => {
    relay.restart();
    checkPresence();
  });
  setInterval(checkPresence, 20_000);

  // Panic button: hide whatever is playing and snooze for an hour.
  globalShortcut.register('CommandOrControl+Alt+Shift+B', () => {
    overlay.hide();
    snooze(60);
  });

  setInterval(() => brain.tick({ idleSec: powerMonitor.getSystemIdleTime() }), 30_000);

  justUpdated = cfg().setupDone && st().lastVersion !== app.getVersion();
  const selfUpdated = justUpdated && !!st().updatedFrom;
  stores.state.set({ lastVersion: app.getVersion(), updatedFrom: '' });
  if (!cfg().setupDone) ui.openWindow('setup');
  // A new Mac version can count as a different app to macOS, so Full Disk Access may need switching off and on
  // again. Open straight onto that one step (it ticks itself off), instead of the bears quietly missing her texts.
  else if (IS_MAC && justUpdated && imessage?.status === 'no-access') ui.openWindow('access');
  else if (selfUpdated && Notification.isSupported()) new Notification({ title: 'Bearly Apart', body: `Updated to ${app.getVersion()} 🐻`, silent: true }).show();
  if (process.env.BA_DEMO) setTimeout(() => process.env.BA_DEMO.split(',').forEach(preview), 1500);
  if (process.env.BA_OPEN) ui.openWindow(process.env.BA_OPEN);
  readyAt = Date.now();
  log(`Bearly Apart ready (profile: ${app.getPath('userData')})`);
});

app.on('window-all-closed', () => {
  /* stay in the tray */
});
// Quitting: tell their app we're away first (waiting at most a moment for the relay).
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !relay?.connected || !cfg().partner.id) return;
  quitting = true;
  e.preventDefault();
  Promise.race([setPresence('away'), new Promise((r) => setTimeout(r, 1500))]).finally(() => app.quit());
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stores?.state.flush();
});
