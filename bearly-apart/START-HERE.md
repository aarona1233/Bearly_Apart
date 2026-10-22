# 🐻 Bearly Apart: full install guide

Two computers: **yours** (Windows, or Debian Linux) and **hers** (MacBook Air, Apple Silicon).
You build everything on yours. Her Mac only gets the finished app, already paired with you.

| Part | Who | Time |
|---|---|---|
| 1. Set up your computer | you | 10 min, once |
| 2. Build her installer | you | 5 min |
| 3. Install on her Mac | her, or you over Zoom | 2 min |
| 4. Check it works | both | 5 min |

---

## 1. Your computer

### 1A. Windows (your current PC)

**One-time tools.** These are already installed on your PC; the checks are here in case you set up another one.

| Tool | Check | If it's missing |
|---|---|---|
| Node.js 22 or newer | `node -v` | Install the LTS from nodejs.org |
| Git | `git --version` | Install from git-scm.com |
| Python 3 | `python --version` | Install from python.org (used to zip the apps) |
| Developer Mode | Settings → System → For developers | Turn it **on** (needed to build the Mac app) |
| rcodesign 0.29.0 | `& "$HOME\.local\bin\rcodesign.exe" --version` | See "rcodesign on Windows" below |

**Get the code** (skip if you already have the folder):

```powershell
git clone https://github.com/aarona1233/Bearly_Apart.git "E:\Bearly-Apart-2026-10-22\Bearly Appart"
```

**Install the app's packages.** In PowerShell (note: PowerShell uses `;` between commands, not `&&`):

```powershell
cd "E:\Bearly-Apart-2026-10-22\Bearly Appart\bearly-apart"; npm ci; node node_modules/electron/install.js
```

If PowerShell says scripts are disabled, use `npm.cmd` instead of `npm` everywhere in this guide.

**Run it:**

```powershell
cd "E:\Bearly-Apart-2026-10-22\Bearly Appart\bearly-apart"; npm start
```

The window opens on **Settings** the first time:
1. Type your name and pick your bear (**Dudu** = brown, **Bubu** = white).
2. Under **Them**, pick her time zone.
3. Click **Save settings**.

The 💗 tray icon sits at the bottom right of the taskbar (click **^** if it's hidden). Click it to open the window.
Closing the terminal quits the app.

**Optional: a standalone app that starts with Windows.** Instead of `npm start`:

```powershell
cd "E:\Bearly-Apart-2026-10-22\Bearly Appart\bearly-apart"; npm run package:win
```

Then copy the folder `dist\Bearly Apart-win32-x64` somewhere permanent (for example `C:\Users\aaron\Apps\`), open
`Bearly Apart.exe`, and tick **Settings → Start when the computer starts**. It uses the same settings as `npm start`.
Copying it out of `dist` matters: a running copy locks that folder, and the next rebuild fails until you quit it.

**rcodesign on Windows** (signs her Mac app so Apple Silicon will run it). Only if the check above failed:

```powershell
$u = "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F0.29.0/apple-codesign-0.29.0-x86_64-pc-windows-msvc.zip"
$d = New-Item -ItemType Directory -Force "$env:TEMP\rcodesign"; Invoke-WebRequest $u -OutFile "$d\r.zip" -UseBasicParsing; Invoke-WebRequest "$u.sha256" -OutFile "$d\r.sha256" -UseBasicParsing
if ((Get-FileHash "$d\r.zip").Hash -ne (Get-Content "$d\r.sha256" -Raw).Split(' ')[0].Trim()) { throw "checksum mismatch" }
Expand-Archive "$d\r.zip" $d -Force; New-Item -ItemType Directory -Force "$HOME\.local\bin" | Out-Null; Copy-Item "$d\*\rcodesign.exe" "$HOME\.local\bin\"
```

### 1B. Debian Linux (your other machine)

```bash
cd "$HOME/Bearly Appart/bearly-apart" && ./setup-linux.sh --build-tools
```

This installs Node.js into your home folder, the app's packages and rcodesign, adds **Bearly Apart** to your app list,
and starts it at login. Say **y** to the GNOME tray icon if you want the 💗 in your top bar (then log out and back in).
Open **Bearly Apart** from your apps (or `./run.sh`), then do the same three Settings steps as on Windows.

---

## 2. Build her installer

You need your **iPhone number exactly as it shows in her Messages app** (and any email you iMessage her from).

1. **Quit Bearly Apart** (tray 💗 → Quit Bearly Apart). The kit refuses to build while it's running, because the
   running app would overwrite the new pairing.
2. Build it:

   **Windows (PowerShell):**
   ```powershell
   cd "E:\Bearly-Apart-2026-10-22\Bearly Appart\bearly-apart"; npm run kit -- --her-name "HER NAME" --my-phone "+1 555 123 4567"
   ```
   **Linux:**
   ```bash
   cd "$HOME/Bearly Appart/bearly-apart" && npm run kit -- --her-name "HER NAME" --my-phone "+1 555 123 4567"
   ```
   - Several numbers/emails: separate them with commas, `--my-phone "+1 555 123 4567,you@icloud.com"`.
   - Her bear is whichever one you didn't pick. Override with `--her-bear brown` or `--her-bear cream`.
3. It ends with `✓ Paired: you (…) ⇄ HER NAME (…)` and creates **`dist\Bearly-Apart-for-<her name>.zip`** (about 140 MB).
4. Start Bearly Apart again on your computer.

**Upload the zip** to Google Drive, Dropbox or WeTransfer and get a share link. It's too big for an iMessage attachment.

---

## 3. Install on her Mac

What the installer does: copies the app into Applications, clears macOS's "downloaded from the internet" block, puts in
the settings that are already paired with you, opens the Full Disk Access page, and restarts the app once she's flipped
the switch. Nothing else is installed.

**Before you start, check on her Mac:** Messages is signed in, with **Messages → Settings → iMessage → Enable Messages
in iCloud** on. That's what puts her phone's texts on the Mac, and the bears read them from there.

### Option A: she does it (about 1 minute)

1. Open your link in **Safari** and download the zip. Safari unzips it into **Downloads → Bearly Apart Installer**.
   (In Chrome: double-click the zip in Downloads.)
2. Open **Terminal** (⌘ + Space, type `Terminal`, Return), paste this and press Return:
   ```bash
   bash ~/Downloads/"Bearly Apart Installer"/install.command
   ```
3. A window opens on **Full Disk Access**. Switch **Bearly Apart** on. macOS asks for her Mac password or Touch ID.
   If it isn't in the list, click **+**, choose **Applications → Bearly Apart**.
4. Click **Done** in the Bearly Apart message. The app restarts and a 💗 appears at the top of her screen.

The same steps are in the zip as **READ ME FIRST.txt**.

### Option B: you do it over Zoom (keeps it a surprise)

1. Start Bearly Apart **on your computer** first, so you see her "Paired!" bear arrive.
2. On the call, she shares her **entire screen** (not a window). You click **View Options → Request Remote Control**,
   and she approves. The first time, macOS asks her to give Zoom **Accessibility** permission and restart Zoom.
3. Do steps 1 to 4 of Option A for her. **When macOS asks for her password or Touch ID, let her type it.** Never ask
   for her password.
4. Give control back.

---

## 4. Check it works

**Straight away:**
- [ ] Your computer shows the **"Paired!"** bear (her Mac reached yours through the relay).
- [ ] Her 💗 menu says **● Connected** and **✓ Watching iMessage**.
- [ ] Her 💗 menu → **Open Bearly Apart… → Animations → ▶ Play** shows a bear on her screen, with no box around it.

**Screen sharing pauses the bears** (on purpose: they never pop up during calls). While she shares her screen in Zoom,
anything you send waits, then plays as one "while you were away" bear. The yellow banner in her window says so.
So for these tests, have her **stop sharing** and stay on the call:

| You do | Her screen | Your screen |
|---|---|---|
| Send → 💋 Kiss | Kiss bear | Kiss shows ✓ under Recent |
| Text her "I miss you" | Miss-you bear | |
| Text her "kiss" / "I want to hug you" | Kiss / hug bear | |
| Send a love note | Bubu brings the letter, note card pops up | ✓ "You sent a love note" |
| My status → 💼 At work | Status bear once; 💗 menu shows it | |
| Both press 💗 Heart within 20 seconds | Hug | Hug |
| She texts you | | A bear on yours |
| She turns on Do Not Disturb, you send a kiss | Nothing (it waits) | ✓ |
| She turns Do Not Disturb off | The kiss plays | |

If something stays quiet, look at the window's banner and **Recent** list on both sides: ✗ means it never left that
computer (the reason is shown); ✓ with nothing on the other side means it's waiting there (the banner says why).

**Still untested on a real Mac, worth watching:** the sword bear walking along her front window, bears over full-screen
apps, and Focus detection. Note anything odd.

---

## 5. Updating later

After changing animations or code:

1. **Your computer:** quit Bearly Apart, `git pull` (if the change came from elsewhere), then `npm ci` if packages changed,
   and start it again (or rebuild the standalone app with `npm run package:win` and copy it out of `dist` again).
2. **Her Mac:** rebuild the kit (step 2), send her the new zip, run the same Terminal line (step 3). Her settings and
   pairing are kept. **macOS treats each new version as a different app**, so she switches Full Disk Access **off and on
   again** for Bearly Apart when the window opens.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `The token '&&' is not a valid statement separator` | That's PowerShell: use `;` instead of `&&` |
| `npm` "running scripts is disabled" | Use `npm.cmd` instead of `npm` |
| Kit: "Windows won't create symlinks" | Turn on Developer Mode (Settings → System → For developers), open a new terminal |
| Kit: "Bearly Apart is running" | Quit it from the tray first |
| `package:win` fails with `EBUSY` | A copy running from `dist` locks it: quit that copy |
| No 💗 on her Mac | Her menu bar is full (MacBook notch hides icons): remove an icon, or hold ⌘ and drag icons to make room |
| Her menu says "grant Full Disk Access" | System Settings → Privacy & Security → Full Disk Access → Bearly Apart off and on, then 💗 → Quit and reopen |
| Her texts don't reach you | Her Mac must be awake with Bearly Apart running, and Messages on the Mac must show the texts |
| "This app can't be opened" on her Mac | System Settings → Privacy & Security → scroll down → **Open Anyway** |
| Bears never play | Check the yellow banner: quiet hours (11:30 p.m.–8 a.m. by default), snoozed, screen sharing, away, Focus |
| Quit on her Mac without the 💗 | Terminal: `osascript -e 'quit app "Bearly Apart"'` |
| See why something didn't play (Mac) | Quit it, then run `"/Applications/Bearly Apart.app/Contents/MacOS/Bearly Apart"` in Terminal and watch the log |
