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
2. **Open it:** double-click **Bearly Apart** in Downloads. macOS says it **"Not Opened"** because the app isn't from
   the App Store. Click **Done**. (Never pick **Move to Trash**.)
3. **Allow it (once):** open **System Settings → Privacy & Security**, scroll to the bottom, and next to *"Bearly Apart
   was blocked…"* click **Open Anyway**. Enter her password, then click **Open Anyway** again.
4. **Install:** it asks **Install Bearly Apart?** → **Install**. It puts itself in **Applications** and clears away
   any other copies in Downloads and old installers, so there's only one. If your Mac asks to let Bearly Apart
   **control Finder** or **access Downloads**, click **OK** / **Allow**: that's how it removes the old copies.
5. **Setup** opens:
   1. **Let's go.**
   2. Her name and bear → **Next**. (She can skip the iPhone number.)
   3. **I got an invite** → paste the invite you copied on your PC in section 2 (paste the whole message, it finds the code) →
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
| Text her "I want to hug you" / "love you" | Hug / love-you bear | |
| Text her anything else ("lol") | Nothing | |
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

## Using it on more than one computer (laptop + desktop)

Everything they send shows up on **all** your computers, and what you send or set on one (a status, a love note)
shows on the others too. Their app sees you as **here** if any of your computers is in use.

1. Install Bearly Apart on the new computer (step 2, Windows or Linux; a Mac works too).
2. On the computer that's already set up: **Settings → Your computers → Copy link code**, and send it to yourself
   (email, a note, anything).
3. On the new computer, on the first setup screen, click **Link this one to it** (under *Let's go*), paste the code,
   click **Link**.

That's it: same name, same bear, same connection. **Don't** use *Send an invite* for your own second computer: that
starts a new connection, and she'd have to paste the new invite (your other computer would be left out).
Already set up a computer the wrong way? In its **Settings → Your computers**, paste the link code from the computer
that works under *Make this computer match another one of yours*.

---

## Updating later

From 0.6.0 on, **her Mac updates itself**. Every hour it checks for a new version, downloads it, checks that
it was signed with *your* release key, swaps it into Applications (the old one goes to the Trash), and reopens.
Her pairing and settings stay. If macOS wants Full Disk Access switched on again afterwards, the app opens
straight onto that one step. She clicks **Open System Settings**, switches Bearly Apart off and on, and types her
password. Settings → **Updates** shows the version and has **Check for updates now**.

### One-time setup (you)

1. **Release keys.** On the computer you build releases on: `npm run signing`. It makes
   `%USERPROFILE%\.bearly-apart-signing\` (the update key, plus a code-signing certificate if rcodesign is installed)
   and `assets\update-public.pem`. **Commit `update-public.pem`; never commit or share the folder.** If you build
   on another computer too, copy the folder there (USB stick). Making a new one would mean installed copies
   refuse your updates.
   - The certificate gives every version the same signature, so macOS normally keeps Full Disk Access across
     updates. If the folder was made without rcodesign, run `npm run signing` again on the desktop: it adds the
     certificate and keeps the update key.
2. **Where updates live.** The Releases of the repo in `package.json` → `"updates": { "github": "aarona1233/Bearly_Apart" }`.
   It can be **public or private**:
   - **Public:** nothing more to do.
   - **Private (recommended):** make a read-only key that her Mac uses to download releases. GitHub → your picture →
     **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
     Repository access: **Only select repositories → Bearly_Apart**. Permissions → Repository → **Contents:
     Read-only** (nothing else). Pick the longest expiry, and note the date. Paste it once into her Bearly Apart:
     **Settings → Updates → Update key → Save key** (do it over Zoom when you install 0.6.0). It's sent only to
     api.github.com and the window can't read it back. If it expires or you revoke it, her Settings says so; paste a new one.
   - Don't add her as a collaborator: that gives her account write access to the repo, and the app can't use
     her GitHub login anyway. Only you can publish releases either way.
   - Even someone who got into the repo or your GitHub account couldn't push an update she'd install: every update
     must be signed with the release key in `.bearly-apart-signing`, which never goes on GitHub.
3. **(Optional) GitHub CLI.** Install it and run `gh auth login` once; then publishing uploads by itself.
4. **Her first self-updating copy goes in by hand**, the old way (the steps below). Every one after that is
   automatic.

### Each new version

1. Bump `"version"` in `package.json` (for example 0.6.0 → 0.6.1).
2. `npm run publish:mac`. It builds and signs the Mac app, writes `dist\update\latest-mac.json`, and creates the
   GitHub release (or tells you the two files to drag onto a new release).
3. Her Mac picks it up within the hour. For your Windows computers, run the new `Bearly Apart Setup.exe` as before;
   their Settings → Updates says when a newer version is out.

### By hand (before 0.6.0, or if the automatic update fails)

1. Run the build command from step 1 again (it pulls the latest code).
2. **You:** run the new `Bearly Apart Setup.exe`. It replaces the old version; settings and pairing stay.
3. **Her:** download the new Mac zip and open **Bearly Apart** from Downloads (click **Open Anyway** if asked). It
   checks versions first: if it's newer, it asks **Update Bearly Apart to 0.x?** → **Update**. It quits the old one,
   has Finder move it to the Trash (your Mac may ask to let it **control Finder**: click **OK**), installs itself in
   Applications, clears away other copies in Downloads, and reopens. If it's the same or older, it just opens the
   installed one, so opening an old copy by mistake can't downgrade anything. Her pairing and settings stay.
   **macOS treats each new version as a different app**, so the window then asks her to switch **Full Disk Access**
   off and back on for Bearly Apart (**Open that setting** takes her there).

---

## If something isn't working: the Check tab

Every copy has a **🩺 Check** tab (also in the 💗 menu: *Check that everything works…*). It tests the connection, a
real send-and-receive, every animation for both bears, whether bears can play right now (and why not), statuses,
text reading on a Mac, starting with the computer and updates, and, if ticked, **asks the other person's app how it's
doing** (its version, connection, text access, and why its bears might be waiting). It also runs by itself after
every install or update; if something fails you get a notification and the tab opens.

- **Copy report** puts the results and the app's recent log on the clipboard: paste it into a message.
- **Show log file** opens the folder with `bearly-apart.log` (and `diagnostics.txt`, the last report).
- From your own computer, the "Their app answers" line already tells you a lot about hers without touching her Mac.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `The token '&&' is not a valid statement separator` | PowerShell: use `;` instead of `&&` |
| `npm` "running scripts is disabled" | Use `npm.cmd` |
| Build: "Windows won't create symlinks" | Turn on Developer Mode, open a new terminal |
| Build fails with `EBUSY` | Something is running from `dist\build`: quit it |
| "That invite code is cut off" | Copy the whole invite again; it's long |
| It keeps ending up in the Trash | Older 0.2.0 build: force quit it (Activity Monitor), drag it from the Trash into Applications, open it from there |
| "Install" fails | It falls back to opening Downloads and Applications: drag Bearly Apart across (replace the old one) and open it from Applications |
| Her 💗 menu says "grant Full Disk Access" | System Settings → Privacy & Security → Full Disk Access → Bearly Apart off and on, then 💗 → Quit and reopen |
| Her texts don't reach you | Her Mac must be awake with Bearly Apart running, and Messages on the Mac must show the texts |
| Bears never play | The yellow banner says why: quiet hours (11:30 p.m.–8 a.m.), snoozed, screen sharing, away, Focus |
| Can't open the window on her Mac (no 💗 visible) | Double-click **Bearly Apart** in Applications. On versions before Oct 22 evening, run `open -n -a "Bearly Apart"` in Terminal instead |
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
