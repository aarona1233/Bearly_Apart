#!/bin/bash
# Bearly Apart installer for Mac. Run it with:
#   bash ~/Downloads/"Bearly Apart Installer"/install.command
# (or double-click it). Safe to run again to update — your settings are kept.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/Bearly Apart.app"
SUPPORT="$HOME/Library/Application Support/Bearly Apart"

say() { printf '\n\033[1;35m🐻 %s\033[0m\n' "$*"; }

if [ "$(uname -m)" != "arm64" ]; then
  echo "This copy is for Apple Silicon Macs (M1/M2/M3…). Ask for the Intel version." >&2
  exit 1
fi

say "Installing Bearly Apart…"
osascript -e 'quit app "Bearly Apart"' >/dev/null 2>&1 || true
sleep 1
rm -rf "$APP"
ditto "$HERE/Bearly Apart.app" "$APP"
# Downloaded apps are marked "quarantined"; this app is ours, so clear the mark.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

FIRST_TIME=0
if [ -f "$HERE/preset-config.json" ] && [ ! -f "$SUPPORT/config.json" ]; then
  mkdir -p "$SUPPORT"
  cp "$HERE/preset-config.json" "$SUPPORT/config.json"
  FIRST_TIME=1
  say "Already paired — no codes to type 💞"
fi

open "$APP"
sleep 3

say "One switch to flip so the bears can see your texts…"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
osascript <<'OSA' >/dev/null
display dialog "Almost done! 💕

In the window that just opened (Full Disk Access), turn ON “Bearly Apart”.

Don't see it? Click + at the bottom, choose Applications → Bearly Apart.

Then click Done here." buttons {"Done"} default button "Done" with title "Bearly Apart" with icon note
OSA

# The permission only applies after a restart.
osascript -e 'quit app "Bearly Apart"' >/dev/null 2>&1 || true
sleep 2
open "$APP"

say "All done! Look for 💗 at the top of your screen."
if [ "$FIRST_TIME" = 1 ]; then
  osascript -e 'display notification "Bears are on their way 🐻💕" with title "Bearly Apart is ready"' || true
fi
