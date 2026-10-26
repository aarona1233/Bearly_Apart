// Builds the downloads into dist/:  node tools/package.js mac|linux|win|all
//   mac   → "Bearly Apart for Mac.zip": Apple Silicon .app, ad-hoc signed with rcodesign (works from Linux, and from
//           Windows with Developer Mode on), zipped with symlinks intact. Safari unzips it; she double-clicks the app.
//   win   → "Bearly Apart Setup.exe" (built on Windows; installs per user with Start menu + desktop shortcuts, and an
//           uninstall entry in Settings → Apps). Built elsewhere it falls back to a .zip of the app folder.
//   linux → "Bearly Apart for Linux.tar.gz"
// The unpacked apps are in dist/build/. Every copy is the same: pairing happens in the app's first-run setup.
const { packager } = require('@electron/packager');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, 'build');
const NAME = pkg.productName;

const common = {
  dir: ROOT,
  out: BUILD,
  name: NAME,
  appVersion: pkg.version,
  overwrite: true,
  asar: true,
  // The app has no runtime dependencies, so node_modules (all dev tooling) stays out entirely.
  prune: false,
  ignore: [/^\/(dist|tools|test|docs|signing|node_modules)(\/|$)/, /^\/\.git/, /\.md$/, /^\/(run\.sh|setup-linux\.sh|requirements\.txt)$/],
};

const IS_WIN = process.platform === 'win32';

function findRcodesign() {
  const local = path.join(os.homedir(), '.local', 'bin', 'rcodesign');
  for (const p of [process.env.RCODESIGN, IS_WIN && `${local}.exe`, local, 'rcodesign']) {
    if (!p) continue;
    try {
      execFileSync(p, ['--version'], { stdio: 'ignore' });
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

// On Windows `python3` is usually just the Microsoft Store placeholder, so try the other names too.
function findPython() {
  for (const cmd of [['python3'], ['python'], ['py', '-3']]) {
    try {
      execFileSync(cmd[0], [...cmd.slice(1), '--version'], { stdio: 'ignore' });
      return cmd;
    } catch {
      /* try next */
    }
  }
  throw new Error('Python 3 not found (needed to build the archives)');
}

// All files under dir, without following symlinks.
function walk(dir, maxDepth = Infinity, depth = 1) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < maxDepth) out.push(...walk(full, maxDepth, depth + 1));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

// Zip (or .tar.gz) that keeps symlinks as symlinks (Electron.framework is full of them; following them
// would bloat and break the bundle). Windows has no Unix permissions, so there the executable bit is
// set from the file's contents instead (Mac/Linux binaries and scripts), or the apps wouldn't start.
function zipDir(srcDir, entryName, outFile) {
  const script = `
import os, sys, zipfile, tarfile, stat, io
src, name, out = sys.argv[1], sys.argv[2], sys.argv[3]
base = os.path.join(src, name)
EXEC_MAGIC = (b'\\xcf\\xfa\\xed\\xfe', b'\\xce\\xfa\\xed\\xfe', b'\\xca\\xfe\\xba\\xbe', b'\\x7fELF', b'MZ')

def mode(st, data):
    if os.name != 'nt':
        return st.st_mode & 0o7777
    return 0o755 if data[:4].startswith(EXEC_MAGIC) or data[:2] == b'#!' else 0o644

def entries():
    yield base, os.lstat(base), True
    for root, dirs, files in os.walk(base, followlinks=False):
        for n in dirs + files:
            full = os.path.join(root, n)
            yield full, os.lstat(full), n in dirs

def link_target(full):
    return os.readlink(full).replace('\\\\', '/')

if out.endswith('.tar.gz'):
    with tarfile.open(out, 'w:gz') as t:
        for full, st, is_dir in entries():
            info = tarfile.TarInfo(os.path.relpath(full, src).replace(os.sep, '/'))
            info.mtime = st.st_mtime
            if stat.S_ISLNK(st.st_mode):
                info.type, info.linkname, info.mode = tarfile.SYMTYPE, link_target(full), 0o777
                t.addfile(info)
            elif stat.S_ISDIR(st.st_mode):
                info.type, info.mode = tarfile.DIRTYPE, 0o755
                t.addfile(info)
            else:
                with open(full, 'rb') as f:
                    data = f.read()
                info.size, info.mode = len(data), mode(st, data)
                t.addfile(info, io.BytesIO(data))
    sys.exit()

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for full, st, is_dir in entries():
        if full == base:
            continue
        rel = os.path.relpath(full, src).replace(os.sep, '/')
        if stat.S_ISLNK(st.st_mode):
            info = zipfile.ZipInfo(rel)
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o755) << 16
            z.writestr(info, link_target(full))
        elif stat.S_ISDIR(st.st_mode):
            if is_dir and not any(True for _ in os.scandir(full)):
                info = zipfile.ZipInfo(rel + '/')
                info.external_attr = (stat.S_IFDIR | 0o755) << 16
                z.writestr(info, '')
        else:
            with open(full, 'rb') as f:
                data = f.read()
            info = zipfile.ZipInfo.from_file(full, rel)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | mode(st, data)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
`;
  fs.rmSync(outFile, { force: true });
  const [py, ...pyArgs] = findPython();
  execFileSync(py, [...pyArgs, '-c', script, srcDir, entryName, outFile], { stdio: 'inherit' });
}

// The Mac app is full of symlinks, which Windows only lets you create with Developer Mode on.
function checkSymlinks() {
  if (!IS_WIN) return;
  const probe = path.join(os.tmpdir(), `ba-symlink-${process.pid}`);
  try {
    fs.symlinkSync('target', probe);
    fs.unlinkSync(probe);
  } catch {
    throw new Error(
      'Windows won\'t create symlinks, and the Mac app needs them.\n' +
        '  Turn on Developer Mode (Settings → System → For developers), then open a new terminal and try again.',
    );
  }
}

// 'certificate' when signed with the release certificate, else 'ad-hoc'.
function signMac(rcodesign, app) {
  const id = require('./signing').codesignIdentity();
  if (id) {
    const base = ['sign', '--p12-file', id.p12, '--p12-password-file', id.passwordFile];
    // No timestamp server: Apple's only stamps Apple-issued certificates. (Older rcodesign lacks "none".)
    for (const args of [[...base, '--timestamp-url', 'none', app], [...base, app]]) {
      try {
        execFileSync(rcodesign, args, { stdio: ['ignore', 'ignore', 'inherit'] });
        return 'certificate';
      } catch {
        /* try the next way */
      }
    }
    console.warn('! signing with the release certificate failed: falling back to ad-hoc (Full Disk Access will need re-enabling after this update)');
  } else {
    console.warn('! no release certificate (node tools/signing.js makes one): ad-hoc signing');
  }
  execFileSync(rcodesign, ['sign', app], { stdio: ['ignore', 'ignore', 'inherit'] });
  return 'ad-hoc';
}

async function mac() {
  checkSymlinks();
  const [appDir] = await packager({
    ...common,
    platform: 'darwin',
    arch: 'arm64',
    icon: path.join(ROOT, 'assets', 'icons', 'icon.icns'),
    appBundleId: 'app.bearlyapart.overlay',
    appCategoryType: 'public.app-category.lifestyle',
    darwinDarkModeSupport: true,
    // Menu-bar app: no Dock icon, no app switcher entry.
    extendInfo: { LSUIElement: true, NSHumanReadableCopyright: 'Made with love' },
    osxSign: false,
  });
  const app = path.join(appDir, `${NAME}.app`);
  const rcodesign = findRcodesign();
  if (rcodesign) {
    // Apple Silicon refuses to run unsigned code. With the release certificate (tools/signing.js) every version
    // carries the same signature, so macOS keeps Full Disk Access across updates; without it, ad-hoc.
    const kind = signMac(rcodesign, app);
    // (`rcodesign verify` can't check these signatures, so just confirm each binary carries one.)
    const bins = walk(app).filter((f) => /[\/]MacOS[\/]/.test(f));
    const frameworks = walk(path.join(app, 'Contents', 'Frameworks'), 4).filter((f) => /\.framework[\/]Versions[\/]A[\/][^\/.]+$/.test(f));
    for (const bin of [...bins, ...frameworks]) {
      const info = execFileSync(rcodesign, ['print-signature-info', bin], { encoding: 'utf8' });
      if (!(kind === 'ad-hoc' ? /ADHOC/.test(info) : /certificat|cms|signer/i.test(info))) throw new Error(`not signed: ${bin}`);
    }
    console.log(`✓ ${kind} signed (${bins.length} executables, ${frameworks.length} frameworks checked)`);
  } else {
    console.warn('! rcodesign not found — run `codesign --force --deep -s - "Bearly Apart.app"` on the Mac before opening it');
  }
  const zip = path.join(DIST, `${NAME} for Mac.zip`);
  zipDir(appDir, `${NAME}.app`, zip);
  console.log(`→ ${path.relative(ROOT, zip)}`);
}

async function linux() {
  const [appDir] = await packager({ ...common, platform: 'linux', arch: 'x64', executableName: 'bearly-apart' });
  fs.copyFileSync(path.join(ROOT, 'assets', 'icons', 'icon.png'), path.join(appDir, 'icon.png'));
  const tgz = path.join(DIST, `${NAME} for Linux.tar.gz`);
  zipDir(path.dirname(appDir), path.basename(appDir), tgz);
  console.log(`→ ${path.relative(ROOT, tgz)}`);
}

async function win() {
  const [appDir] = await packager({
    ...common,
    platform: 'win32',
    arch: 'x64',
    icon: path.join(ROOT, 'assets', 'icons', 'icon.ico'),
    // No spaces in the .exe (the installer's tools are picky); shortcuts still say "Bearly Apart".
    executableName: 'BearlyApart',
    win32metadata: { ProductName: NAME, FileDescription: NAME, CompanyName: 'Bearly Apart' },
  });
  if (!IS_WIN) {
    const zip = path.join(DIST, `${NAME} for Windows.zip`);
    zipDir(path.dirname(appDir), path.basename(appDir), zip);
    return console.log(`→ ${path.relative(ROOT, zip)} (Setup.exe can only be built on Windows)`);
  }
  const { createWindowsInstaller } = require('electron-winstaller');
  const out = path.join(BUILD, 'installer');
  await createWindowsInstaller({
    appDirectory: appDir,
    outputDirectory: out,
    exe: 'BearlyApart.exe',
    name: 'BearlyApart',
    title: NAME,
    description: NAME,
    authors: 'Bearly Apart',
    version: pkg.version,
    setupExe: `${NAME} Setup.exe`,
    setupIcon: path.join(ROOT, 'assets', 'icons', 'icon.ico'),
    noMsi: true,
  });
  const setup = path.join(DIST, `${NAME} Setup.exe`);
  fs.copyFileSync(path.join(out, `${NAME} Setup.exe`), setup);
  console.log(`→ ${path.relative(ROOT, setup)}`);
}

const targets = { mac, linux, win };

if (require.main === module) {
  const which = process.argv[2] || 'all';
  (async () => {
    for (const [name, fn] of Object.entries(targets)) {
      if (which !== 'all' && which !== name) continue;
      console.log(`\n== ${name}`);
      await fn();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { mac, linux, win, zipDir, findRcodesign, DIST, BUILD, NAME, IS_WIN };
