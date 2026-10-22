# 🐻 Bearly Apart: install guide

Everyone installs the same download, then a short setup inside the app connects the two of you. No Terminal.

| Part | Who |
|---|---|
| 0. Remove the old version (one time) | both computers |
| 1. Build the downloads | you |
| 2. Install on your computer | you |
| 3. Install on her Mac | her, or you over Zoom |
| 4. Check it works | both |

---

## 0. Remove the old version (one time only)

Versions before 0.2.0 were installed differently. Remove them first so you start clean.

### Your Windows PC

1. **Quit the old app:** right-click the 💗 tray icon (bottom right, click **^** if hidden) → **Quit Bearly Apart**.
   Also close any terminal that's running `npm start`.
2. **Stop it starting with Windows:** **Settings → Apps → Startup** → switch **Bearly Apart** off. (Or Task Manager →
   Startup apps → Bearly Apart → Disable.)
3. **Delete the old builds:** delete the folder `E:\Bearly-Apart-2026-10-22\Bearly Appart\bearly-apart\dist`.
   (`npm run release` makes a fresh one.)
4. **Delete the old settings** (this unpairs you; the new setup pairs you again): delete the folder
   `%APPDATA%\Bearly Apart` (paste that into the File Explorer address bar).

### Her Mac

1. **Quit it:** 💗 in the menu bar → **Quit Bearly Apart**.
2. **Delete the app:** Finder → **Applications** → drag **Bearly Apart** to the Trash.
3. **Delete its settings:** Finder → **Go → Go to Folder…** (⇧⌘G), paste `~/Library/Application Support/`, and drag the
   **Bearly Apart** folder to the Trash.
4. **Remove the old permission:** System Settings → **Privacy & Security → Full Disk Access** → select **Bearly Apart**
   → click **−**.
5. **Remove it from login items:** System Settings → **General → Login Items** → select **Bearly Apart** → **−**.
6. Delete **Downloads → Bearly Apart Installer** and any old Bearly Apart zip.

### Your Debian PC (if you used it)

Quit it, then delete `~/.config/Bearly Apart`, `~/.local/share/applications/bearly-apart.desktop` and
`~/.config/autostart/bearly-apart.desktop`.

---

## 1. Build the downloads (you, on your PC)

**Tools, one time.** All of these are already set up on your Windows PC; the checks are for a new machine.

| Tool | Check | If it's missing |
|---|---|---|
| Node.js 22+ | `node -v` | LTS from nodejs.org |
| Git | `git --version` | git-scm.com |
| Python 3 | `python --version` | python.org |
| Developer Mode (Windows) | Settings → System → For developers | Turn it **on** (the Mac app needs it) |
| rcodesign 0.29.0 | `& "$HOME\.local\bin\rcodesign.exe" --version` | See "rcodesign" at the bottom |

**Build.** In PowerShell (it uses `;` between commands, not `&&`):

```powershell
cd "E:\Bearly-Apart-2026-10-22\Bearly Appart\bearly-apart"; git pull; npm ci; npm run release
```

If PowerShell says scripts are disabled, use `npm.cmd` instead of `npm`.

This makes three files in `dist\`:

| File | For |
|---|---|
| `Bearly Apart Setup.exe` | Windows |
| `Bearly Apart for Mac.zip` | Her MacBook (Apple Silicon) |
| `Bearly Apart for Linux.tar.gz` | Linux |

Upload `Bearly Apart for Mac.zip` to Google Drive, Dropbox or WeTransfer and keep the link for step 3. (It's too big
for an iMessage attachment.) The same files work for anyone; nothing in them is specific to her or you.

---

## 2. Install on your computer

### Windows

1. Double-click **`Bearly Apart Setup.exe`**.
2. Windows SmartScreen says it "protected your PC" (the app isn't from a known publisher). Click **More info → Run
   anyway**. This happens once.
3. It installs by itself and opens. Shortcuts go on the Start menu and the desktop.
4. **Setup** opens:
   1. **Let's go.**
   2. Your name, your bear (Dudu or Bubu), and your iPhone number (so her Mac can tell when you text her) → **Next**.
   3. **Send an invite** → **Copy invite.** Keep this window open; it moves on by itself when she connects.

To uninstall later: **Settings → Apps → Installed apps → Bearly Apart → Uninstall**.

### Debian Linux

Unpack `Bearly Apart for Linux.tar.gz` and run `Bearly Apart-linux-x64/bearly-apart`. Same setup as above.
(To run from the source code instead: `./setup-linux.sh`.)

---

## 3. Install on her Mac

**Check first:** Messages on her Mac is signed in with **Messages → Settings → iMessage → Enable Messages in iCloud**
on. That's what puts her phone's texts on the Mac, where the bears read them.

### If you're doing it over Zoom (keeps the surprise)

She shares her **entire screen**; you click **View Options → Request Remote Control** and she approves. The first time,
macOS asks her to give Zoom **Accessibility** permission and restart Zoom. **Whenever her Mac asks for its password or
Touch ID, let her type it.** Then follow the steps below for her.

### The steps

1. **Download:** open your link in **Safari** and download. Safari unzips it: **Bearly Apart** appears in **Downloads**.
   (In Chrome, double-click the zip in Downloads first.)
2. **Open it:** double-click **Bearly Apart**. macOS says it **"Not Opened"** because the app isn't from the App Store.
   Click **Done**.
3. **Allow it (once):** open **System Settings → Privacy & Security**, scroll to the bottom, and next to *"Bearly Apart
   was blocked…"* click **Open Anyway**. Enter her password, then click **Open Anyway** again.
4. The app moves itself into **Applications** and reopens there (if macOS asks again, click **Open**). **Setup** opens:
   1. **Let's go.**
   2. Her name and bear → **Next**. (She can skip the iPhone number.)
   3. **I got an invite** → paste the invite you copied in step 2 (paste the whole message, it finds the code) →
      **Connect**. The screen says **Connected with Aaron! 💞**, and your computer gets a "Paired!" bear.
   4. Check her name/bear and that **your number** is filled in → **Next**.
   5. **Let the bears see your texts:** click **Open System Settings**, switch **Bearly Apart** on under **Full Disk
      Access** (her password), and if macOS offers **Quit & Reopen**, click it. The step ticks itself off.
   6. **All set!** Leave **Start when the computer starts** ticked → **Start sending love 💕**.

A 💗 appears in her menu bar. (If it doesn't: her menu bar is full. On MacBooks the notch hides icons; quit an app's
icon or hold ⌘ and drag icons to make room.)

To uninstall later: quit it from the 💗, drag **Applications → Bearly Apart** to the Trash.

---

## 4. Check it works

**Screen sharing pauses the bears** (so they never pop up during calls). For these tests, have her **stop sharing**
and stay on the call.

| You do | Her screen | Your screen |
|---|---|---|
| Send tab → 💋 Kiss | Kiss bear | ✓ under Recent |
| Text her "I miss you" | Miss-you bear | |
| Text her "kiss" / "I want to hug you" | Kiss / hug bear | |
| Send a love note | Bubu brings the letter and the note pops up | ✓ |
| My status → 💼 At work | Status bear once; her 💗 menu shows it | |
| Both press 💗 Heart within 20 seconds | Hug | Hug |
| She texts you | | A bear on yours |
| She turns on Do Not Disturb, you send a kiss | Nothing yet | ✓ |
| She turns Do Not Disturb off | The kiss plays | |

If something stays quiet, look at the yellow banner and the **Recent** list on both sides: ✗ means it never left that
computer (the reason is shown); ✓ with nothing on the other side means it's waiting there (her banner says why).

Still worth watching on her real Mac: the sword bear walking along her front window, bears over full-screen apps,
and Focus detection.

---

## Updating later

1. Run the build command from step 1 again (it pulls the latest code).
2. **You:** run the new `Bearly Apart Setup.exe`. It replaces the old version; settings and pairing stay.
3. **Her:** download the new Mac zip, quit Bearly Apart (💗 → Quit), open the new one from Downloads, and click
   **Open Anyway** again if asked. It replaces the old copy in Applications by itself. **macOS treats each new version as a different app**, so switch
   **Full Disk Access** off and on again for Bearly Apart, then quit and reopen it. Her pairing stays.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `The token '&&' is not a valid statement separator` | PowerShell: use `;` instead of `&&` |
| `npm` "running scripts is disabled" | Use `npm.cmd` |
| Build: "Windows won't create symlinks" | Turn on Developer Mode, open a new terminal |
| Build fails with `EBUSY` | Something is running from `dist\build`: quit it |
| "That invite code is cut off" | Copy the whole invite again; it's long |
| Her Mac doesn't move the app to Applications | Drag **Bearly Apart** from Downloads into Applications yourself, then open it from there |
| Her 💗 menu says "grant Full Disk Access" | System Settings → Privacy & Security → Full Disk Access → Bearly Apart off and on, then 💗 → Quit and reopen |
| Her texts don't reach you | Her Mac must be awake with Bearly Apart running, and Messages on the Mac must show the texts |
| Bears never play | The yellow banner says why: quiet hours (11:30 p.m.–8 a.m.), snoozed, screen sharing, away, Focus |
| Quit on her Mac without the 💗 | Activity Monitor → Bearly Apart → ✕ → Quit |
| Windows leftover after uninstalling | Delete `%LOCALAPPDATA%\BearlyApart` (and `%APPDATA%\Bearly Apart` to forget the pairing) |

---

## rcodesign (signs her Mac app so Apple Silicon will run it)

Only needed on a new build machine. Windows, in PowerShell:

```powershell
$u = "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F0.29.0/apple-codesign-0.29.0-x86_64-pc-windows-msvc.zip"
$d = New-Item -ItemType Directory -Force "$env:TEMP\rcodesign"; Invoke-WebRequest $u -OutFile "$d\r.zip" -UseBasicParsing; Invoke-WebRequest "$u.sha256" -OutFile "$d\r.sha256" -UseBasicParsing
if ((Get-FileHash "$d\r.zip").Hash -ne (Get-Content "$d\r.sha256" -Raw).Split(' ')[0].Trim()) { throw "checksum mismatch" }
Expand-Archive "$d\r.zip" $d -Force; New-Item -ItemType Directory -Force "$HOME\.local\bin" | Out-Null; Copy-Item "$d\*\rcodesign.exe" "$HOME\.local\bin\"
```

Linux: `./setup-linux.sh --build-tools` installs it.
