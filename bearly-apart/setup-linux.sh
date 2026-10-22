#!/usr/bin/env bash
# One-step setup for running Bearly Apart from source on Linux (Debian/Ubuntu). Safe to re-run.
#   ./setup-linux.sh                 install Node + packages, add app launcher, start at login
#   ./setup-linux.sh --build-tools   also install rcodesign (needed to build her Mac app)
#   ./setup-linux.sh --no-autostart  don't start Bearly Apart when you log in
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HOME/.local/bin"
OPT="$HOME/.local/opt"
BUILD_TOOLS=0
AUTOSTART=1
for a in "$@"; do
  case "$a" in
    --build-tools) BUILD_TOOLS=1 ;;
    --no-autostart) AUTOSTART=0 ;;
    *) echo "unknown option: $a" >&2; exit 1 ;;
  esac
done

say() { printf '\n\033[1;35m🐻 %s\033[0m\n' "$*"; }
mkdir -p "$BIN" "$OPT"
export PATH="$BIN:$PATH"

# --- Node.js (into ~/.local, no sudo) ------------------------------------------
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0; }
if [ "$(node_major)" -lt 22 ] 2>/dev/null; then
  say "Installing Node.js (LTS) into ~/.local"
  ARCH=$(uname -m); case "$ARCH" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; esac
  VER=$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c "import json,sys; print(next(x['version'] for x in json.load(sys.stdin) if x['lts']))")
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/node.tar.xz" "https://nodejs.org/dist/$VER/node-$VER-linux-$ARCH.tar.xz"
  SUM=$(curl -fsSL "https://nodejs.org/dist/$VER/SHASUMS256.txt" | grep " node-$VER-linux-$ARCH.tar.xz\$" | cut -d' ' -f1)
  echo "$SUM  $TMP/node.tar.xz" | sha256sum -c - >/dev/null
  tar -xf "$TMP/node.tar.xz" -C "$OPT"
  ln -sfn "$OPT/node-$VER-linux-$ARCH" "$OPT/node"
  for b in node npm npx; do ln -sf "$OPT/node/bin/$b" "$BIN/$b"; done
  rm -rf "$TMP"
else
  say "Node.js $(node -v) already installed"
fi
grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"

# --- npm packages ---------------------------------------------------------------
say "Installing app packages (Electron etc.)"
cd "$HERE"
npm ci --no-audit --no-fund --loglevel=error
# Electron fetches its program on first use; do it now so the app launcher works right away.
node node_modules/electron/install.js

# --- rcodesign (only to build the Mac app) ---------------------------------------
if [ "$BUILD_TOOLS" = 1 ] && ! command -v rcodesign >/dev/null; then
  say "Installing rcodesign (signs the Mac app)"
  U=https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz
  TMP=$(mktemp -d)
  curl -fsSL -o "$TMP/r.tgz" "$U"
  echo "$(curl -fsSL "$U.sha256" | cut -d' ' -f1)  $TMP/r.tgz" | sha256sum -c - >/dev/null
  tar -xzf "$TMP/r.tgz" -C "$TMP" && cp "$TMP"/*/rcodesign "$BIN/" && rm -rf "$TMP"
fi

# --- App launcher (+ start at login) ---------------------------------------------
say "Adding Bearly Apart to your apps"
cat > "$HERE/run.sh" <<EOF
#!/usr/bin/env bash
# Starts Bearly Apart from this folder (used by the app launcher).
cd "\$(dirname "\${BASH_SOURCE[0]}")"
exec ./node_modules/electron/dist/electron . --ozone-platform=x11 "\$@"
EOF
chmod +x "$HERE/run.sh"
DESKTOP="[Desktop Entry]
Type=Application
Name=Bearly Apart
Comment=Cute bears for your long-distance love
Exec=\"$HERE/run.sh\"
Icon=$HERE/assets/icons/icon.png
Categories=Utility;
X-GNOME-Autostart-enabled=true"
mkdir -p "$HOME/.local/share/applications"
echo "$DESKTOP" > "$HOME/.local/share/applications/bearly-apart.desktop"
if [ "$AUTOSTART" = 1 ]; then
  mkdir -p "$HOME/.config/autostart"
  echo "$DESKTOP" > "$HOME/.config/autostart/bearly-apart.desktop"
else
  rm -f "$HOME/.config/autostart/bearly-apart.desktop"
fi

# --- Tray icon on GNOME ----------------------------------------------------------
if [ "${XDG_CURRENT_DESKTOP:-}" != "${XDG_CURRENT_DESKTOP/GNOME/}" ] && ! gnome-extensions list 2>/dev/null | grep -q appindicator; then
  say "GNOME can't show the 💗 tray icon without an extension."
  read -r -p "   Install it now? (asks for your password) [y/N] " yn || yn=n
  if [[ "$yn" =~ ^[Yy] ]]; then
    sudo apt-get install -y gnome-shell-extension-appindicator
    gnome-extensions enable ubuntu-appindicators@ubuntu.com 2>/dev/null || true
    echo "   Log out and back in for the tray icon to appear."
  else
    echo "   Skipped. Opening Bearly Apart again always brings up its window instead."
  fi
fi

say "All set! Open “Bearly Apart” from your apps, or run: $HERE/run.sh"
