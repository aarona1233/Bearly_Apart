// Installing on the Mac: where the app goes, the script that puts it there, and version checks. No Electron here.
const MAC_TARGET = '/Applications/Bearly Apart.app';

// Quits any running copy from Applications, replaces it with this one, and clears away every other copy.
//   $1 this copy  $2 /Applications/Bearly Apart.app  $3 home folder  $4 "install" or "tidy" (leftovers only)
// Afterwards exactly one Bearly Apart is left, in Applications: other copies (Downloads, ~/Applications), the old
// "Bearly Apart Installer" folder and old zips go, and Spotlight forgets them. Settings and pairing live in
// ~/Library/Application Support and aren't touched.
// - App bundles are moved to the Trash by Finder: since macOS 13 ("App Management") an app may not change or delete
//   another app unless both are signed by the same developer, and ours is self-signed, but Finder is always allowed.
//   macOS asks once whether Bearly Apart may control Finder; if not, plain rm is tried (it may be refused).
// - Copies already in the Trash are left alone (touching them can trip the same protection); opening one later
//   is harmless: it sees the installed version is the same or newer and just opens that.
// - Plain shell tools, not Electron's file functions: those treat app.asar as a folder and can't delete it. And not
//   macOS's own "move to Applications": that trashed the original and, on her Mac, the restart afterwards failed.
const INSTALL_SH = `
src="$1"; dst="$2"; home="\${3:-$HOME}"; mode="$4"
lsreg=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
to_trash() {
  /usr/bin/osascript -e 'on run argv' -e 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)' -e 'end run' "$1" >/dev/null 2>&1
  [ -e "$1" ] && rm -rf "$1" 2>/dev/null
  [ ! -e "$1" ]
}
if [ "$mode" = install ]; then
  pkill -f "$dst/Contents/" 2>/dev/null
  for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$dst/Contents/" >/dev/null || break; sleep 0.5; done
  pkill -9 -f "$dst/Contents/" 2>/dev/null
  if [ -e "$dst" ]; then to_trash "$dst" || exit 1; fi
  /usr/bin/ditto "$src" "$dst" || exit 1
  /usr/bin/xattr -dr com.apple.quarantine "$dst" 2>/dev/null
fi
for old in "$home/Applications/Bearly Apart.app" "$home/Downloads/Bearly Apart"*.app "$home/Downloads/Bearly Apart Installer" \\
           "$home/Downloads/Bearly Apart for Mac"*.zip "$home/Downloads/Bearly-Apart-for-"*.zip "$home/Downloads/BearlyApart-"*-mac-arm64.zip; do
  [ -e "$old" ] || continue
  [ "$old" = "$dst" ] && continue
  [ -x "$lsreg" ] && "$lsreg" -u "$old" 2>/dev/null
  case "$old" in
    *.zip) rm -f "$old" ;;
    *) to_trash "$old" ;;
  esac
done
[ -x "$lsreg" ] && "$lsreg" -f "$dst" 2>/dev/null
exit 0`;

// "0.4.0" vs "0.3.12": 1 if a is newer, -1 if older, 0 if the same.
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

// The version in an app's Info.plist (the XML kind @electron/packager writes).
function plistVersion(xml) {
  return String(xml).match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || null;
}

// Is this copy anywhere but /Applications? (Downloads, the Trash, ~/Applications, or macOS's hidden read-only
// copy of a just-downloaded app all count; so does an older copy someone dragged elsewhere.)
function needsInstall(execPath) {
  return !String(execPath).startsWith(`${MAC_TARGET}/`);
}

module.exports = { MAC_TARGET, INSTALL_SH, compareVersions, plistVersion, needsInstall };
