// App startup: wires the relay, iMessage watcher, brain, player and windows together, and holds the
// actions the window and tray menu call (send, preview, snooze, settings).
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, dialog, shell, powerMonitor, powerSaveBlocker, protocol, net, globalShortcut, Notification, session, systemPreferences } = require('electron');
const os = require('os');
const { openStores, JsonFile, slug, newTopic, encodePairing, encodeLink, decodePairing } = require('./store');
const { inRange } = require('./guard');
const { Catalog, parseFriendScores } = require('./draft');
const { DraftSession } = require('./draft-session');
const { askOllama, judgeFileHtml } = require('./draft-judge');
const { BoothSession } = require('./booth-session');
const { localDate } = require('./booth');
const { TreeSession } = require('./tree-session');
const advent = require('./advent');
const { KINDS: ORNAMENT_KINDS, doorLabel, dateName, LAST_DAY } = require('./tree');
const { Relay } = require('./relay');
const { IMessageWatcher } = require('./imessage');
const { Guard } = require('./guard');
const { Player } = require('./player');
const { Brain } = require('./brain');
const { Activity } = require('./activity');
const { OverlayWindow } = require('./overlay-window');
const { UI, pauseText } = require('./ui');
const { createLogger, packLog } = require('./logger');
const { runDiagnostics, formatReport, summary } = require('./diagnostics');
const { MAC_TARGET, INSTALL_SH, UPDATE_SH, compareVersions, plistVersion, needsInstall } = require('./mac-install');
const { Updater } = require('./updater');
const { STATUSES, SENDABLES, GIFTS, describe } = require('./catalog');
const { isOn, inWindow, started, ended, toggled, nextAskIn, recapTime, countCandyGiven, candyRecapText } = require('./holiday');

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
let stores, relay, imessage, guard, player, brain, overlay, ui, updater, draftGame, booth, tree;
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
  // The booth's, the tree's (and its picture ornaments in tree/items) and the draft game's pictures keep to folders
  // of their own.
  const [, folder, file] = name.match(/^(booth|tree)\/((?:items\/)?[\w.-]+)$/) || [];
  if (file) {
    const p = path.join(BUNDLED_ASSETS, folder, file);
    return fs.existsSync(p) ? p : null;
  }
  const draftFile = name.match(/^draft\/((?:art\/)?[\w.-]+)$/)?.[1];
  if (draftFile) {
    const p = path.join(BUNDLED_ASSETS, 'draft', draftFile);
    return fs.existsSync(p) ? p : null;
  }
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
  // The candy game needs to know where the bucket is and which candies there are (made by tools/make-halloween.js).
  const game = read(path.join(BUNDLED_ASSETS, 'halloween.json'));
  for (const scene of Object.values(scenes))
    for (const actor of scene.actors || []) for (const s of actor.steps || []) if (s.do === 'candy-game') Object.assign(s, { bucket: game.bucket, candies: game.candies }, s);
}

// ---------- actions (used by the window, the tray menu and the overlay) ----

function outText(type, extra) {
  if (type === 'status') return extra.status === 'clear' ? 'You cleared your status' : `You set your status: ${STATUSES[extra.status]?.emoji || ''} ${STATUSES[extra.status]?.short || extra.status}`;
  if (type === 'note') return 'You sent a love note 💌';
  if (type === 'jar') return `You saved a note for ${partnerName()}'s morning 🫙`;
  if (type === 'hello') return 'You said hi 👋';
  if (type === 'gift') return `You sent ${GIFTS[extra.gift]?.emoji || '✨'} ${GIFTS[extra.gift]?.label || extra.gift}`;
  if (type === 'candy') return 'You asked for candy 🍬';
  if (type === 'treat') return `You gave ${partnerName()} candy 🍬`;
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
    halloween,
    halloweenOpen: halloweenOpen(),
    // The Christmas look (app.css body.christmas): while the real tree is up, or the demo is on.
    christmas: cfg().christmasLook !== false && !!(realTree?.isUp() || tree?.demo),
    xmas: xmasLive(),
    candyRecap: (() => {
      const c = candyRecap();
      return c && !c.dismissed ? c.text : null;
    })(),
    tester: !!st().testerUnlocked,
    draftTurn: !!draftGame?.isMyMove(),
    // Hidden until the booth unlocks too, unless a game is already going (a tester can start one early).
    draftOpen: !!booth?.draftUnlocked() || !!draftGame?.state,
    booth: booth ? { tab: booth.canShoot() || booth.view().sessions.some((s) => s.status === 'done'), open: booth.isOpen(), needsMe: booth.needsMe() } : null,
    tree: tree ? { tab: tree.visible(), needsMe: treeNeedsMe() } : null,
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

// Their app asked for this one's log: the newest lines, in up to 4 relay messages (see packLog). The log has what the
// app did (connections, updates, which bears played), never what a text said.
async function sendLogTo(nonce) {
  log(`[check] ${partnerName()}’s app asked for this app’s log; sending it`);
  const head = `Bearly Apart ${app.getVersion()} on ${OS_NAME} (${DEVICE_NAME}), log sent ${new Date().toISOString()}`;
  const parts = packLog(log.tail(300), { maxBytes: 3300 });
  if (!parts.length) parts.push('(the log is empty)');
  parts[0] = `${head}\n${parts[0]}`;
  for (let i = 0; i < parts.length; i++) await sendQuiet('logpart', { nonce, part: `${i + 1}-${parts.length}`, text: parts[i] });
}

// Check → "Get their log": asks their app (0.9 or newer) for its recent log and puts the pieces back together.
async function fetchPartnerLog() {
  if (!cfg().partner.id) return { ok: false, error: 'Not paired yet.' };
  if (!relay.connected) return { ok: false, error: 'This app isn’t connected to the relay right now; try again in a minute.' };
  const nonce = newNonce();
  const parts = new Map();
  let total = 0;
  const done = new Promise((resolve) => {
    const onEvent = (ev) => {
      if (ev.type !== 'logpart' || ev.nonce !== nonce || ev.from !== cfg().partner.id) return;
      const [i, n] = String(ev.part || '1-1').split('-').map(Number);
      total = n || 1;
      parts.set(i || 1, ev.text);
      if (parts.size >= total) finish();
    };
    const timer = setTimeout(finish, 25_000);
    function finish() {
      clearTimeout(timer);
      relay.off('event', onEvent);
      resolve();
    }
    relay.on('event', onEvent);
  });
  try {
    await brain.send('logreq', { nonce });
  } catch (err) {
    return { ok: false, error: `Couldn’t ask: ${err.message}` };
  }
  await done;
  if (!parts.size) return { ok: false, error: `${partnerName()}’s app didn’t answer within 25 seconds: it may be closed or asleep, or older than 0.9 (it can’t send its log).` };
  const missing = total - parts.size;
  log(`[check] got ${partnerName()}’s log (${parts.size} of ${total} pieces)`);
  return {
    ok: true,
    at: Date.now(),
    text: [...parts.keys()].sort((a, b) => a - b).map((k) => parts.get(k)).join('\n'),
    note: missing ? `${missing} of ${total} pieces didn’t arrive; this is what came through.` : '',
  };
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

// ---------- holidays (holiday.js) ------------------------------------------------

let halloween = false;
let nextCandyAt = 0;

// Every 30 seconds: is it Halloween (by the dates, or switched on/off in the menu), and is a bear due to come
// trick-or-treating?
function holidayTick() {
  const on = isOn('halloween', cfg().holidays?.halloween);
  if (on !== halloween) {
    halloween = on;
    log(`[holiday] Halloween mode ${on ? 'on' : 'off'}`);
    ui?.refresh();
    if (on) {
      nextCandyAt = Date.now() + nextAskIn();
      // Ghost bears fly across when the mode comes on: every time it's switched on by hand, and once a year when the
      // dates bring it (so trying it out early doesn't use up the real one).
      const year = new Date().getFullYear();
      const byDates = inWindow('halloween');
      if (cfg().setupDone && (!byDates || st().ghostsShownYear !== year)) {
        if (byDates) stores.state.set({ ghostsShownYear: year });
        player.play({ scene: 'halloween-ghosts', priority: 3, label: '👻 Happy Halloween', vars: brain.vars() });
      }
    }
  }
  // After Halloween: share this computer's candy count once per run (the relay has to be up to hear the answer).
  if (!candySent && relay?.connected && recapTime('halloween')) {
    candySent = true;
    shareCandyCount();
  }
  // Their bear comes by for candy now and then: only while someone's at the computer and nothing else is showing,
  // otherwise it tries again in a couple of minutes (no backlog of candy bears).
  if (!halloween || !cfg().partner.id || Date.now() < nextCandyAt) return;
  const free = presence === 'here' && !(st().snoozedUntil > Date.now()) && !player.blockedReason && !player.playing && !player.queue.length;
  if (!free) {
    nextCandyAt = Date.now() + 2 * 60_000;
    return;
  }
  nextCandyAt = Date.now() + nextAskIn();
  player.play({ scene: 'trick-or-treat', priority: 2, label: `🎃 ${partnerName()} came trick-or-treating`, vars: brain.vars({ requested: '' }) });
}

// Whether anything of Halloween shows: while it's on, or from when it starts this year (Oct 30 23:59, earlier on a
// computer unlocked for testing) until it ends (Oct 31 15:59). After that it's all hidden again until next year.
function halloweenOpen() {
  return halloween || (!ended('halloween') && (started('halloween') || !!st().testerUnlocked));
}

// ---------- Halloween candy recap ----------------------------------------------
// For two weeks after Halloween: each app counts the candies given on its computer (the log's "[candy] given"
// lines) and tells the other app. With their number in, a note (and a card on the Send tab) says who gave whom
// how many, all computers added up. Each app sends its count when it starts and answers the other's.

let candySent = false;

function candyRecapState() {
  const year = new Date().getFullYear();
  const r = st().candyRecap;
  return r?.year === year ? r : { year, mine: {}, theirs: {}, shown: false, dismissed: false };
}

function shareCandyCount(reply = false) {
  if (!recapTime('halloween') || !cfg().partner.id) return;
  const n = countCandyGiven(log.tail(1_000_000), new Date().getFullYear());
  const r = candyRecapState();
  stores.state.set({ candyRecap: { ...r, mine: { ...r.mine, [st().deviceId]: n } } });
  log(`[candy] this computer gave ${n} this Halloween; telling ${partnerName()}’s app`);
  sendQuiet('candyscore', { text: String(n), ...(reply ? { status: 'reply' } : {}) });
  showCandyRecap();
}

function onCandyScore(ev, mine) {
  if (!recapTime('halloween')) return;
  const n = Math.max(0, parseInt(ev.text, 10) || 0);
  const r = candyRecapState();
  const side = mine ? 'mine' : 'theirs';
  stores.state.set({ candyRecap: { ...r, [side]: { ...r[side], [ev.device || 'main']: n } } });
  log(`[candy] ${mine ? 'my other computer' : partnerName()} gave ${n} this Halloween`);
  // Their app just started and told us: tell it ours back (an answer isn't answered again).
  if (!mine && ev.status !== 'reply') shareCandyCount(true);
  else showCandyRecap();
}

// The totals, once their number is in (null before that, after two weeks, or when the card was closed).
function candyRecap() {
  const r = candyRecapState();
  if (!recapTime('halloween') || !Object.keys(r.theirs).length) return null;
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return { text: candyRecapText(cfg().me.name || 'You', partnerName(), sum(r.mine), sum(r.theirs)), shown: r.shown, dismissed: r.dismissed };
}

// The little note, once a year: a notification and a line in Recent. The Send tab's card stays until closed.
function showCandyRecap() {
  const c = candyRecap();
  ui?.refresh();
  if (!c || c.shown) return;
  stores.state.set({ candyRecap: { ...candyRecapState(), shown: true } });
  log(`[candy] recap: ${c.text}`);
  activity.add({ dir: 'in', text: `🍬 ${c.text}` });
  if (Notification.isSupported()) new Notification({ title: '🍬 Halloween candy', body: c.text }).show();
}

function dismissCandyRecap() {
  stores.state.set({ candyRecap: { ...candyRecapState(), dismissed: true } });
  ui?.refresh();
  return { ok: true };
}

// ---------- tester section (Check tab) ----------------------------------------------
// A code only Aaron knows unlocks it on a computer. Only its SHA-256 is here (this source is on GitHub).
const TESTER_CODE_SHA256 = '2bebe0807d5cf7499cc44188f44b23ff8bc3e146818f8041f241a2bcbe2f7175';

function unlockTester(code) {
  const ok = crypto.createHash('sha256').update(String(code || '').trim().toLowerCase()).digest('hex') === TESTER_CODE_SHA256;
  log(`[tester] code ${ok ? 'accepted: tester section unlocked' : 'wrong'}`);
  if (ok) {
    stores.state.set({ testerUnlocked: true });
    ui?.refresh();
  }
  return { ok };
}

// Locks it again on this computer (Halloween then hides again until it starts, if it hasn't).
function lockTester() {
  stores.state.set({ testerUnlocked: false });
  log('[tester] locked');
  ui?.refresh();
  return { ok: true };
}

// A test candy game, every step written to the log: here, or on their screen (then "Get their log" brings
// their log back). where: 'here' | 'there'.
async function testCandy(where) {
  if (!st().testerUnlocked) return { ok: false, error: 'locked' };
  if (where === 'there') {
    log(`[tester] asking ${partnerName()}’s app to play a test candy game`);
    try {
      await brain.send('testplay', { status: 'candy' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  playTestCandy('started from the tester section');
  return { ok: true };
}

function playTestCandy(why) {
  const d = require('electron').screen.getDisplayNearestPoint(require('electron').screen.getCursorScreenPoint());
  log(`[candy-test] ${why}: ${OS_NAME}, version ${app.getVersion()}, display ${JSON.stringify(d.bounds)} scale ${d.scaleFactor}, presence ${presence}, paused: ${player.blockedReason || 'no'}`);
  player.play({ scene: 'trick-or-treat', priority: 9, label: '🧪 test candy game', vars: brain.vars({ requested: '', debug: '1' }) });
}

// The tray menu's 🎃 Halloween mode switch.
function toggleHoliday(name) {
  stores.config.set({ holidays: { [name]: toggled(name, cfg().holidays?.[name]) } });
  holidayTick();
}

// ---------- the photo booth --------------------------------------------------------

function startBooth() {
  booth = new BoothSession({
    config: cfg,
    dir: path.join(app.getPath('userData'), 'booth'),
    publish: (status, text) => brain.send('booth', { status, text }),
    upload: (data, name) => relay.upload(data, name),
    download: downloadAttachment,
    notify: notifyBooth,
    onChange: () => {
      ui?.sendBooth();
      ui?.refresh();
    },
    // Their half just came in: their bear comes over holding the strip (unless you're looking at it already).
    onStrip: () => {
      if (ui?.win && !ui.win.isDestroyed() && ui.win.isFocused()) return;
      player.play({ scene: 'booth-strip', priority: 5, label: '📸 photo strip', vars: brain.vars() });
    },
    device: st().deviceId,
    tester: () => !!st().testerUnlocked,
    log,
  });
}

// Only files on the relay's own server: the link comes in a message, so it isn't trusted further than that.
async function downloadAttachment(url) {
  const relayOrigin = new URL(cfg().relay.server).origin;
  if (new URL(url).origin !== relayOrigin) throw new Error('that link isn’t on our relay');
  const res = await net.fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(res.status === 404 ? 'the relay doesn’t have it any more' : `relay answered HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 20_000_000) throw new Error('too big');
  return buf;
}

let boothNotification = null;
function notifyBooth(body) {
  ui?.sendBoothNote(body);
  if (ui?.win && !ui.win.isDestroyed() && ui.win.isFocused()) return;
  if (!Notification.isSupported()) return;
  boothNotification = new Notification({ title: '📸 Bearly Booth', body, silent: inRange(cfg().quietHours) || st().snoozedUntil > Date.now() });
  boothNotification.on('click', () => ui.openWindow('booth'));
  boothNotification.show();
}

// The booth's day: once, when you're at the computer and it isn't quiet hours, their bear brings a ticket.
function boothTick() {
  if (!booth?.isOpen() || !cfg().setupDone || !cfg().partner.id) return;
  const today = localDate(Date.now());
  if (st().boothTicketDay === today || inRange(cfg().quietHours) || powerMonitor.getSystemIdleTime() > 120 || guard?.locked) return;
  stores.state.set({ boothTicketDay: today });
  player.play({ scene: 'booth-open', priority: 4, label: '📸 the photo booth is open', vars: brain.vars() });
  ui?.refresh();
}

async function boothCamera() {
  if (!IS_MAC) return { ok: true };
  const status = systemPreferences.getMediaAccessStatus('camera');
  if (status === 'granted') return { ok: true };
  if (status === 'not-determined' && (await systemPreferences.askForMediaAccess('camera'))) return { ok: true };
  return { ok: false, error: 'The camera is switched off for Bearly Apart. Open System Settings → Privacy & Security → Camera and switch it on.', settings: true };
}

// A finished strip (or its back, or the 4x6 print sheet) as a PNG in Pictures/Bearly Apart.
function boothSave({ png, name }) {
  const m = String(png || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { ok: false, error: 'nothing to save' };
  const dir = path.join(app.getPath('pictures'), 'Bearly Apart');
  fs.mkdirSync(dir, { recursive: true });
  const base = String(name || '').replace(/[^\w ,.&'-]+/g, '').trim().slice(0, 80) || 'Photo strip';
  let file = path.join(dir, `${base}.png`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n}).png`);
  fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
  log(`[booth] saved ${path.basename(file)}`);
  return { ok: true, file };
}

function boothAction(a) {
  if (a?.type === 'start') return booth.start({ mode: a.mode });
  if (a?.type === 'save') return boothSave(a);
  if (a?.type === 'show' && a.file) return shell.showItemInFolder(String(a.file));
  if (a?.type === 'camera') return boothCamera();
  if (a?.type === 'camera-settings') return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
  return booth.act(a);
}

// The bear stickers as data URLs: a canvas that drew ba:// pictures couldn't be saved.
function boothAssets() {
  const dir = path.join(BUNDLED_ASSETS, 'booth');
  return Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => [f.slice(0, -4), `data:image/png;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`]));
}

// ---------- the Christmas tree (tree.js, tree-session.js) ---------------------------------

// What's behind the advent doors: assets/advent/doors.dat, shipped encoded inside the app. A copy saved by the door
// editor on an installed app (not the source) lives in the profile and wins on that computer only.
const DOORS_FILE = path.join(BUNDLED_ASSETS, 'advent', 'doors.dat');
const localDoorsFile = () => path.join(app.getPath('userData'), 'advent-doors.dat');
let doorCache = null;
function loadDoors() {
  if (doorCache) return doorCache;
  for (const f of [localDoorsFile(), DOORS_FILE]) {
    try {
      const d = advent.decode(fs.readFileSync(f, 'utf8'));
      if (d) return (doorCache = d);
    } catch {
      /* not there */
    }
  }
  return (doorCache = advent.DEFAULT_CONTENTS);
}

// The tree the window shows (`tree`) is the real one, or the Christmas demo's while that is on. The relay only ever
// talks to the real one (`realTree`).
let realTree = null;
let demoTree = null;
let demoSeq = 0;

function makeTree({ file, demo = false }) {
  const store = new JsonFile(file, {});
  // In the demo, scenes play right away on this screen (previews), whatever else is going on.
  const play = (item) => player.play(demo ? { ...item, priority: 9, preview: true } : item);
  return new TreeSession({
    config: cfg,
    publish: demo ? demoPublish : (status, text) => brain.send('tree', { status, text }),
    load: () => store.data,
    save: (d) => store.set(d),
    doors: loadDoors,
    onOpen: (r) => {
      const santa = r.more?.length ? ` (and Santa brought ${r.more.map((m) => `${m.emoji} ${m.name}`).join(', ')})` : '';
      if (!demo) activity.add({ dir: 'out', text: `🎁 You opened door ${doorLabel(r.day)}${r.title ? `: ${r.title}` : ''}${santa}` });
      if (r.kind === 'snow') play({ scene: 'snow-day', priority: 5, label: '❄️ a snow day', vars: brain.vars() });
    },
    onChange: () => {
      ui?.sendTree();
      ui?.refresh();
    },
    onHang: (h) => {
      const whose = h.tree === 'us' ? 'our tree' : h.onMine ? 'your tree' : 'their tree';
      if (!demo) activity.add({ dir: 'in', text: `🎄 ${partnerName()} ${hangVars(h.kind).ornHung} ${whose}` });
      // Their bear brings it over (at most one at a time: a run of hangs shows the last one only).
      player.queue = player.queue.filter((q) => q.scene !== 'tree-hang');
      play({ scene: 'tree-hang', priority: 2, label: `🎄 ${partnerName()} decorated`, vars: brain.vars({ ...hangVars(h.kind), treeWhose: whose, treeBefore: h.before, treeAfter: h.after }) });
    },
    onStar: () => {
      if (!demo) activity.add({ dir: 'in', text: '⭐ You put the star on the tree together' });
      const t = demo ? demoTree : realTree;
      const spec = t.spec(t.trees()[0] || 'us');
      play({ scene: 'tree-star', priority: 4, label: '⭐ the star is on', vars: brain.vars({ treeAfter: spec }) });
    },
    onTapAsk: () => {
      if (demo) return;
      activity.add({ dir: 'in', text: `⭐ ${partnerName()} is holding up the star` });
      notifyTree(`${partnerName()} is holding up the star! Open the Tree tab and click ⭐ within 20 seconds.`);
    },
    onInvite: () => {
      if (demo) return;
      activity.add({ dir: 'in', text: `🎄 ${partnerName()} wants one tree together` });
      notifyTree(`${partnerName()} wants one tree together this year. Open the Tree tab to answer.`);
    },
    testDay: demo ? () => st().treeDemoDay || 1 : () => st().treeTestDay || 0,
    tester: demo ? () => true : () => !!st().testerUnlocked,
    demo,
    bothHere: demo ? () => true : () => presence === 'here' && st().partnerPresence?.state === 'here',
    device: st().deviceId,
    log,
  });
}

function startTree() {
  realTree = makeTree({ file: path.join(app.getPath('userData'), 'tree.json') });
  tree = realTree;
  if (st().treeDemo) setTreeDemo(true);
}

// ---------- the Christmas demo -------------------------------------------------------------------
// A whole pretend December on this computer only: its own tree (tree-demo.json), any day you pick, and a pretend
// partner who answers (chooses the same trees, opens the same doors, clicks the star with you). Nothing goes to the
// relay, so the other app never hears of it.
const demoFile = () => path.join(app.getPath('userData'), 'tree-demo.json');

function setTreeDemo(on) {
  stores.state.set({ treeDemo: !!on });
  demoTree = on ? makeTree({ file: demoFile(), demo: true }) : null;
  tree = demoTree || realTree;
  log(`[tree] demo ${on ? 'on' : 'off'}`);
  ui?.sendTree();
  ui?.refresh();
}

// What the demo "sends" comes straight back as if from the relay, and the pretend partner answers some of it.
function demoEcho(from, device, status, body) {
  if (!demoTree) return;
  demoTree.onEvent({ type: 'tree', from, device, status, text: JSON.stringify(body), at: Date.now(), id: `demo${++demoSeq}` });
}
async function demoPublish(status, text) {
  const body = JSON.parse(text);
  setTimeout(() => demoEcho(cfg().me.id, st().deviceId, status, body), 120);
  if (status !== 'op') return;
  const them = (op, ms) => setTimeout(() => demoEcho(cfg().partner.id, 'demo', 'op', body.test ? { ...op, test: true } : op), ms);
  if (body.k === 'choose') them({ k: 'choose', m: body.m }, 1200);
  if (body.k === 'open') them({ k: 'open', day: body.day }, 2500);
  if (body.k === 'tap') them({ k: 'tap' }, 1800);
}

function demoAction(a) {
  if (a.type === 'demo') {
    if (!!a.on !== !!demoTree) setTreeDemo(!!a.on);
    return { ok: true };
  }
  if (!demoTree) return { ok: false, error: 'The demo isn’t on.' };
  if (a.type === 'demo-day') {
    stores.state.set({ treeDemoDay: Math.max(1, Math.min(LAST_DAY, Math.round(Number(a.day) || 1))) });
    ui?.sendTree();
    ui?.refresh();
    return { ok: true };
  }
  if (a.type === 'demo-reset') {
    fs.rmSync(demoFile(), { force: true });
    stores.state.set({ treeDemoDay: 1 });
    setTreeDemo(true);
    return { ok: true };
  }
  if (a.type === 'demo-hang') {
    const op = demoTree.partnerHangOp();
    if (!op) return { ok: false, error: demoTree.mode() ? `${partnerName()} has nothing left to hang.` : 'Pick your trees first.' };
    demoEcho(cfg().partner.id, 'demo', 'op', op);
    return { ok: true };
  }
  if (a.type === 'demo-scene') {
    const spec = demoTree.spec(demoTree.trees()[0] || cfg().me.id);
    const day = demoTree.doorDay() || 1;
    const scenes = {
      'tree-open': { label: '🎄 the tree is up', vars: { treeAfter: spec } },
      'advent-ready': { label: `🎁 door ${doorLabel(day)} is ready`, vars: { door: String(doorLabel(day)) } },
      'snow-day': { label: '❄️ a snow day', vars: {} },
      'tree-hang': { label: `🎄 ${partnerName()} decorated`, vars: { ...hangVars('bell'), treeWhose: 'your tree', treeBefore: spec, treeAfter: spec } },
      'tree-star': { label: '⭐ the star is on', vars: { treeAfter: { ...spec, star: true } } },
    };
    const sc = scenes[a.scene];
    if (!sc) return { ok: false, error: 'unknown scene' };
    player.play({ scene: a.scene, priority: 9, preview: true, label: sc.label, vars: brain.vars(sc.vars) });
    return { ok: true };
  }
  return null;
}

// What the delivery scene says about one ornament ("hung a 🔔 bell on") or little animal ("put a 🐧 penguin by").
function hangVars(kind) {
  const k = ORNAMENT_KINDS[kind] || { name: kind, emoji: '🎄' };
  return { ornName: k.name, ornEmoji: k.emoji, ornHung: `${k.skirt ? 'put' : 'hung'} a ${k.emoji} ${k.name} ${k.skirt ? 'by' : 'on'}`, ornSaid: `${k.skirt ? 'brought you' : 'hung'} a ${k.name}` };
}

// The Send tab's Christmas card: how far it is to Christmas, and what's waiting in the Christmas room (today's door,
// things to hang, the tree to choose). Only in the season (or the demo), once paired.
function xmasLive() {
  if (!tree?.visible() || !cfg().partner.id) return null;
  const v = tree.view();
  if (!v.up && !v.demo) return null;
  const today = v.calendar.today;
  const door = v.calendar.doors[today - 1];
  return {
    day: v.day,
    door: today,
    label: today ? doorLabel(today) : 0,
    next: today && today < v.calendar.doors.length ? doorLabel(today + 1) : 0,
    date: dateName(today),
    theyOpened: !!door?.theyOpened,
    waiting: v.calendar.doors.filter((d) => d.ready && !d.opened).map((d) => doorLabel(d.d)),
    box: v.mode ? v.box.length : 0,
    choose: !v.mode && !v.myChoice,
    demo: !!v.demo,
  };
}

// The Tree tab's dot: an answer is waiting, or there are ornaments in the box to hang.
function treeNeedsMe() {
  if (!tree?.visible() || !cfg().partner.id) return false;
  const v = tree.view();
  const doorWaiting = v.calendar.doors.some((d) => d.ready && !d.opened);
  return doorWaiting || (!v.mode && !v.myChoice) || (!!v.mode && v.box.length > 0 && v.up);
}

let treeNotification = null;
function notifyTree(body) {
  if (ui?.win && !ui.win.isDestroyed() && ui.win.isFocused()) return;
  if (!Notification.isSupported()) return;
  treeNotification = new Notification({ title: '🎄 Bearly Apart', body, silent: inRange(cfg().quietHours) || st().snoozedUntil > Date.now() });
  treeNotification.on('click', () => ui.openWindow('tree'));
  treeNotification.show();
}

// Checked every 30 seconds, so a new day is noticed within half a minute of midnight (and after sleep or a locked
// screen). Only while you're at the computer and outside quiet hours; otherwise it waits.
// Once a season, the first time after the tree goes up, their bear says so. Then once a day: today's door is ready.
function treeTick() {
  if (!realTree?.isUp() || realTree.testing() || !cfg().setupDone || !cfg().partner.id) return;
  if (inRange(cfg().quietHours) || powerMonitor.getSystemIdleTime() > 120 || guard?.locked) return;
  const year = realTree.year();
  if (st().treeOpenShown !== year) {
    stores.state.set({ treeOpenShown: year });
    player.play({ scene: 'tree-open', priority: 4, label: '🎄 the tree is up', vars: brain.vars({ treeAfter: realTree.spec(realTree.trees()[0] || cfg().me.id) }) });
    return ui?.refresh();
  }
  const day = realTree.doorDay();
  const key = `${year}-${day}`;
  if (day >= 1 && !realTree.openedDays().includes(day) && st().doorKnock !== key) {
    stores.state.set({ doorKnock: key });
    player.play({ scene: 'advent-ready', priority: 3, label: `🎁 door ${doorLabel(day)} is ready`, vars: brain.vars({ door: String(doorLabel(day)) }) });
    notifyTree(`🎁 Door ${doorLabel(day)} is ready. Open Bearly Apart → Rooms → Christmas to open it.`);
    ui?.refresh();
  }
}

function treeAction(a) {
  if (typeof a?.type === 'string' && a.type.startsWith('demo')) return demoAction(a) || { ok: false, error: 'unknown action' };
  if (a?.type === 'test-day') {
    if (!st().testerUnlocked) return { ok: false, error: 'locked' };
    const day = Math.max(0, Math.min(LAST_DAY, Math.round(Number(a.day) || 0)));
    stores.state.set({ treeTestDay: day });
    ui?.sendTree();
    ui?.refresh();
    return { ok: true };
  }
  // The door editor (tester only): what's behind every door, and saving it.
  if (a?.type === 'doors-get') {
    if (!st().testerUnlocked) return { ok: false, error: 'locked' };
    return { ok: true, doors: advent.cleanContents(loadDoors()), ornaments: Object.keys(ORNAMENT_KINDS).filter((k) => !k.startsWith('heart-')).concat('heart-half'), source: !app.isPackaged };
  }
  if (a?.type === 'doors-save') {
    if (!st().testerUnlocked) return { ok: false, error: 'locked' };
    const doors = advent.cleanContents(a.doors);
    // From the source (npm start) it goes into the app itself, ready to build and publish; an installed app keeps it
    // for this computer only.
    const target = app.isPackaged ? localDoorsFile() : DOORS_FILE;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, advent.encode(doors));
    doorCache = null;
    log(`[advent] doors saved to ${app.isPackaged ? 'this computer' : 'the app source'}`);
    ui?.sendTree();
    return { ok: true, where: app.isPackaged ? 'this computer only' : 'the app (build and publish to send it)' };
  }
  if (a?.type === 'preview') {
    // The window's "show me" button: the hang scene with this tree, here.
    const spec = tree.spec(a.tree || tree.trees()[0]);
    return player.play({ scene: 'tree-hang', priority: 9, label: '🎄 preview', preview: true, vars: brain.vars({ ...hangVars('bell'), treeWhose: 'our tree', treeBefore: spec, treeAfter: spec }) });
  }
  return tree.act(a);
}

// ---------- the draft game ------------------------------------------------------

function startDraftGame() {
  const file = new JsonFile(path.join(app.getPath('userData'), 'draft.json'), {});
  const catalog = new Catalog(JSON.parse(fs.readFileSync(path.join(BUNDLED_ASSETS, 'draft', 'topics.json'), 'utf8')));
  draftGame = new DraftSession({
    catalog,
    config: cfg,
    publish: (status, text) => brain.send('draft', { status, text }),
    load: () => file.data,
    save: (data) => {
      file.data = data;
      file.save();
    },
    notify: notifyDraft,
    onChange: () => {
      ui?.sendDraft();
      ui?.refresh();
    },
    askAi: (s) => askOllama(s, catalog, draftGame.names(), { log }),
    device: st().deviceId,
    log,
  });
}

// Kept in a variable: a notification that gets garbage-collected can no longer tell us it was clicked.
let draftNotification = null;
function notifyDraft(body) {
  ui?.sendDraftNote(body);
  if (ui?.win && !ui.win.isDestroyed() && ui.win.isFocused()) return; // they're looking at it
  if (draftGame.settings.notify === false || !Notification.isSupported()) return;
  // During quiet hours or a snooze it still shows up, just without a sound.
  draftNotification = new Notification({ title: '🎲 Bearly Draft', body, silent: inRange(cfg().quietHours) || st().snoozedUntil > Date.now() });
  draftNotification.on('click', () => ui.openWindow('draft'));
  draftNotification.show();
}

// The moves the window can ask for. Anything else it sends is refused.
const DRAFT_MOVES = new Set(['accept', 'skip', 'topic', 'context', 'bid', 'pass', 'to-turns', 'judging', 'score', 'judge-each', 'abandon']);

function draftAction(a) {
  if (a?.type === 'start') return draftGame.start({ settings: a.settings });
  if (a?.type === 'rematch') return draftGame.start({ rematch: true, replace: true });
  if (a?.type === 'clear') return draftGame.clear();
  if (a?.type === 'settings') return draftGame.saveSettings(a.settings);
  if (a?.type === 'friend-reply') {
    const s = draftGame.state;
    const sheets = s && parseFriendScores(a.text, s.players, draftGame.names());
    if (!sheets) return { ok: false, error: 'That needs eight numbers from 1 to 5: four for each build.' };
    return draftGame.act({ type: 'friend', sheets });
  }
  if (a?.type === 'judge-file') return saveDraftJudgeFile();
  if (!DRAFT_MOVES.has(a?.type)) return { ok: false, error: 'unknown move' };
  return draftGame.act(a);
}

async function saveDraftJudgeFile() {
  const s = draftGame.state;
  if (!s?.topic || !s.players) return { ok: false, error: 'There’s no build to judge yet.' };
  const title = draftGame.catalog.topic(s.topic).title.replace(/[^\w ]+/g, '');
  const { canceled, filePath } = await dialog.showSaveDialog(ui.win, {
    title: 'Save the judge file',
    defaultPath: path.join(app.getPath('downloads'), `Judge this draft - ${title}.html`),
    filters: [{ name: 'Web page', extensions: ['html'] }],
  });
  if (canceled || !filePath) return { ok: false };
  const artData = (id) => {
    const p = path.join(BUNDLED_ASSETS, 'draft', 'art', `${id}.webp`);
    return fs.existsSync(p) ? `data:image/webp;base64,${fs.readFileSync(p).toString('base64')}` : '';
  };
  fs.writeFileSync(filePath, judgeFileHtml(s, draftGame.catalog, draftGame.names(), artData));
  shell.showItemInFolder(filePath);
  return { ok: true };
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

  // The camera is only for the app window's photo booth, and only the picture (never the microphone). Everything
  // else keeps Electron's usual answer.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (permission !== 'media') return cb(true);
    cb(!!ui?.win && !ui.win.isDestroyed() && wc.id === ui.win.webContents.id && (details.mediaTypes || []).every((t) => t === 'video'));
  });

  protocol.handle('ba', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''));
    const file = resolveAsset(name);
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  overlay = new OverlayWindow({ getScene: (name) => scenes[name], getScale: () => cfg().scale, getChristmas: () => cfg().christmasLook !== false && !halloween && !!(realTree?.isUp() || tree?.demo), log });
  // If the see-through window's page dies, log it and bring it back rather than leaving bears invisible.
  // The candy game ended. If they asked for the candy (🍬 I want candy), tell them it arrived.
  overlay.onCandy = (r, req) => {
    if (req?.vars?.debug) return log(`[candy-test] finished: ${r.given ? 'candy given' : 'not given'} after ${r.misses} miss(es)`);
    const asked = !!req?.vars?.requested;
    log(`[candy] ${r.given ? 'given' : 'not given'} after ${r.misses} miss(es)${asked ? ', they asked' : ''}`);
    if (!r.given) return;
    if (asked) sendEvent('treat');
    else activity.add({ dir: 'out', text: `🍬 You gave ${partnerName()}’s bear a candy` });
  };
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
  // Their Check tab asked for this app's recent log ("Get their log").
  brain.onLogRequest = (ev) => sendLogTo(ev.nonce);
  // Their tester section asked for a test candy game here (logged step by step for them to read back).
  brain.onTestPlay = () => playTestCandy(`${partnerName()} started a test from their app`);
  brain.halloweenOpen = halloweenOpen;
  brain.onCandyScore = onCandyScore;
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
  startDraftGame();
  startBooth();
  startTree();
  relay.on('event', (ev) => {
    if (ev.type === 'booth') {
      if (ev.from !== cfg().me.id && ev.from !== cfg().partner.id) return;
      return booth.onEvent(ev);
    }
    if (ev.type === 'tree') {
      if (ev.from !== cfg().me.id && ev.from !== cfg().partner.id) return;
      if (ev.from === cfg().partner.id && ev.status === 'op') brain.heard(ev);
      return realTree.onEvent(ev);
    }
    // The draft game keeps its own books. Its echo matters too: a move only counts once it's back from the relay.
    if (ev.type === 'draft') {
      if (ev.from !== cfg().me.id && ev.from !== cfg().partner.id) return;
      if (ev.from === cfg().partner.id && ev.status === 'state') brain.heard(ev);
      return draftGame.onEvent(ev);
    }
    if (ev.from !== cfg().me.id) {
      log(`[relay] ← ${ev.type}${ev.status ? `:${ev.status}` : ''} from ${ev.from}`);
      const bookkeeping = ['presence', 'seen', 'diag', 'ping', 'pong', 'logreq', 'logpart', 'testplay', 'candyscore'].includes(ev.type);
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
    if (up) draftGame.onConnected(); // moves the relay no longer has
    if (up) booth.onConnected(); // photos the relay no longer has
    if (up) realTree.onConnected(); // ornaments hung while this computer was off
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
    actions: { sendEvent, preview, snooze, snoozeUntilMorning, saveSettings, pair, resetPairing, userAssetsDir, checkTextAccess, relaunch, checkForUpdates, setUpdateKey, runChecks, checkReport, fetchPartnerLog, toggleHoliday, unlockTester, lockTester, testCandy, dismissCandyRecap, draftAction, draftView: () => draftGame.view(), boothAction, boothView: () => booth.view(), boothPhotos: (sid) => booth.photos(sid), boothAssets, treeAction, treeView: () => tree.view(), logFile: () => log.file() },
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
  setInterval(holidayTick, 30_000);
  setInterval(boothTick, 30_000);
  setInterval(treeTick, 30_000);
  setTimeout(holidayTick, 5_000);

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
