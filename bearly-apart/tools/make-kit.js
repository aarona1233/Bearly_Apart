// Builds the one-file installer for her Mac, already paired with you:
//   npm run kit -- --her-name "Bubu" --my-phone "+1 555 123 4567" [--my-name "Aaron"]
//                  [--her-bear cream|brown] [--my-timezone America/Chicago] [--profile <dir>] [--no-rebuild]
// Output: dist/Bearly-Apart-for-<her name>.zip — send it to her (AirDrop works great).
// Also fills her in as your partner in your own settings, so both sides are paired already.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { JsonFile, DEFAULT_CONFIG, DEFAULT_STATE, merge, slug, newTopic } = require('../src/main/store');
const pkg = require('./package');

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    out[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
  return out;
}

function appRunning() {
  try {
    if (pkg.IS_WIN) {
      const ps =
        "Get-CimInstance Win32_Process -Filter \"Name='electron.exe' OR Name='Bearly Apart.exe'\" | " +
        "Where-Object { $_.Name -eq 'Bearly Apart.exe' -or $_.CommandLine -match 'bearly-apart' } | Select-Object -First 1 -ExpandProperty ProcessId";
      return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim().length > 0;
    }
    return execFileSync('pgrep', ['-f', 'bearly-apart.*electron|Bearly Apart-linux'], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
}

// Same folder Electron uses for app.getPath('userData').
function defaultProfile() {
  if (pkg.IS_WIN) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), pkg.NAME);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', pkg.NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), pkg.NAME);
}

(async () => {
  const o = args();
  if (!o['her-name'] || !o['my-phone']) {
    console.error('usage: npm run kit -- --her-name "Bubu" --my-phone "+1 555 123 4567" [--my-name "Aaron"]');
    process.exit(1);
  }
  if (appRunning() && !o.force) {
    console.error('Bearly Apart is running on this computer — quit it first (it would overwrite the new pairing), or pass --force.');
    process.exit(1);
  }

  // ---- your side ----
  const profile = o.profile || defaultProfile();
  const mine = new JsonFile(path.join(profile, 'config.json'), DEFAULT_CONFIG);
  const myName = o['my-name'] || mine.data.me.name;
  if (!myName) {
    console.error('Your name is not set yet: add --my-name "YourName".');
    process.exit(1);
  }
  const myId = mine.data.me.id || slug(myName);
  const myBear = mine.data.me.character || 'brown';
  const herBear = o['her-bear'] || (myBear === 'brown' ? 'cream' : 'brown');
  let herId = slug(o['her-name']);
  if (herId === myId) herId += '2';
  const myZone = o['my-timezone'] || Intl.DateTimeFormat().resolvedOptions().timeZone;
  mine.set({
    me: { id: myId, name: myName, character: myBear },
    partner: { id: herId, name: o['her-name'], character: herBear },
    relay: { topic: mine.data.relay.topic || newTopic() },
  });
  const myState = new JsonFile(path.join(profile, 'state.json'), DEFAULT_STATE);
  myState.set({ lastHeardAt: Date.now() });

  // ---- her side (preset copied into place by install.command on first install) ----
  const hers = merge(structuredClone(DEFAULT_CONFIG), {
    me: { id: herId, name: o['her-name'], character: herBear },
    partner: {
      id: myId,
      name: myName,
      character: myBear,
      imessageHandles: String(o['my-phone']).split(',').map((s) => s.trim()).filter(Boolean),
      timezone: myZone,
    },
    relay: mine.data.relay,
  });

  // ---- assemble ----
  const appSrc = path.join(pkg.DIST, `${pkg.NAME}-darwin-arm64`, `${pkg.NAME}.app`);
  // Always rebuild so she never gets an app older than this folder (skip with --no-rebuild).
  if (!fs.existsSync(appSrc) || !o['no-rebuild']) {
    console.log('Building the Mac app…');
    await pkg.mac();
  }
  const kitRoot = path.join(pkg.DIST, 'kit');
  const kit = path.join(kitRoot, 'Bearly Apart Installer');
  fs.rmSync(kitRoot, { recursive: true, force: true });
  fs.mkdirSync(kit, { recursive: true });
  // verbatimSymlinks keeps the framework symlinks as they are
  fs.cpSync(appSrc, path.join(kit, path.basename(appSrc)), { recursive: true, verbatimSymlinks: true });
  fs.copyFileSync(path.join(__dirname, 'kit', 'install.command'), path.join(kit, 'install.command'));
  fs.chmodSync(path.join(kit, 'install.command'), 0o755);
  fs.writeFileSync(path.join(kit, 'preset-config.json'), JSON.stringify(hers, null, 2));
  fs.writeFileSync(
    path.join(kit, 'READ ME FIRST.txt'),
    `Hi ${o['her-name']}! 🐻💕

To install, open Terminal (⌘ + Space, type "Terminal", press Return),
paste this line and press Return:

    bash ~/Downloads/"Bearly Apart Installer"/install.command

It takes about 10 seconds. When a window asks, turn ON "Bearly Apart"
under Full Disk Access (that's how the bears know when ${myName} texts you),
then click Done. That's it — look for the 💗 at the top of your screen.

(If this folder isn't in Downloads, type "bash " and drag install.command
into the Terminal window instead, then press Return.)
`,
  );
  const zip = path.join(pkg.DIST, `Bearly-Apart-for-${slug(o['her-name']) || 'her'}.zip`);
  pkg.zipDir(kitRoot, 'Bearly Apart Installer', zip);
  console.log(`\n✓ Paired: you (${myName}, ${myBear === 'brown' ? 'Dudu' : 'Bubu'}) ⇄ ${o['her-name']} (${herBear === 'brown' ? 'Dudu' : 'Bubu'})`);
  console.log(`✓ Her bears will react to texts from: ${hers.partner.imessageHandles.join(', ')}`);
  console.log(`→ ${path.relative(process.cwd(), zip)}  (${(fs.statSync(zip).size / 1e6).toFixed(0)} MB) — send this to her`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
