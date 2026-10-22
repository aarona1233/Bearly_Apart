# Bearly Apart — what's been built so far

*Summary as of October 22, 2026.*

Bearly Apart is a small app for a long-distance couple. Cute Bubu & Dudu bears pop up on each other's
computer screens whenever you text, send a kiss, set a status, or go quiet for too long.

- **Her:** MacBook Air (M2, 8 GB). **You:** Debian 13 Linux (also has a Windows build). **Both:** iPhone + iMessage.
- **To get going, open [`bearly-apart/START-HERE.md`](bearly-apart/START-HERE.md).**

---

## What's in this zip

```
Bearly Appart/
├── WHAT-WE-BUILT.md        ← this file
├── animations/             ← the 16 original Bubu & Dudu GIFs from your friend
└── bearly-apart/           ← the app
    ├── START-HERE.md       ← step-by-step: your setup, building her installer, her 1-minute install
    ├── README.md           ← full feature list, iPhone Shortcut guide, custom GIFs, advanced settings
    ├── requirements.txt    ← what each computer needs (spoiler: her Mac needs nothing)
    ├── setup-linux.sh      ← installs everything on your Linux PC, adds the app launcher
    ├── src/                ← the app's code (main process, overlay, settings windows)
    ├── assets/             ← animations, drawn bears, icons, scenes.json (the choreography)
    ├── docs/SCENES.md      ← how to choreograph new animations
    ├── test/               ← 21 automated tests
    └── tools/              ← builders: installer kit, GIF importer, packager, test helpers
```

**Not included (too big, and each one rebuilds with a single command):**
- `node_modules/`: run `./setup-linux.sh` to reinstall it.
- `dist/`: the built Mac, Linux and Windows apps. `npm run kit -- …` builds her installer; `npm run package` builds all three apps.

---

## How it works

```
 Your iPhone (Shortcut) ─┐                      ┌─► Her Mac app  ◄── reads her local iMessage database
 Your PC app ────────────┼─► ntfy relay ◄───────┤
 Her Mac app ────────────┘   (ntfy.sh, free)    └─► Your PC app
```

- **iMessage → her screen.** macOS doesn't let apps read other apps' notifications, but her Mac keeps a local copy of
  her messages (`~/Library/Messages/chat.db`). The app reads it **read-only**, looking only at messages to and from your
  number. It never sends iMessages. Requires Full Disk Access, a single switch she turns on during install.
- **Her texts → your screen.** Her Mac sends a tiny "she texted" signal (plus keyword names like `love-you`) to your
  computer through the relay. **Her message text never leaves her Mac.**
- **Relay.** [ntfy.sh](https://ntfy.sh): free, no account needed. Your private "topic" (in the pairing code) works like a
  shared password. Can be self-hosted later.

---

## Features

**Triggers**
- 💬 You text her → Dudu runs onto the screen, turns into the Love-Kiss, zooms into the screen, and leaves a lipstick mark
- 🔑 Keywords: "miss you", "love you", "goodnight", "good morning", "hungry", ❤️, 🥺 → special animations
- 🔥 5 texts in 90 seconds → cuddle combo with heart rain (otherwise text animations have a 90-second cooldown)
- 💞 ❤️ tapback on a message → cute kiss + hearts
- ⚔️ **Silence:** 3h a sad bear peeks in, 6h **Bubu drags a sword across her front window leaving scratch marks**, 12h a MISSING poster drops in
  - Doesn't nag while the other person sleeps (their time zone, or after a "goodnight" status)
- 📣 Statuses from your phone or the app: hungry (bear runs off with a burger), sleepy, goodnight, work/class (Dudu at the laptop),
  bath, free/home (boba relax), thinking of you, sad, gym, driving, gaming, eating, sick, busy
- 💋 Send a kiss / heart / hug / poke / miss-you
- 🫂 Both send a heart within 20 seconds → both screens get a hug
- 💌 Love notes, delivered now or saved in the "note jar" for her next morning
- ☀️ Good-morning bear the first time she's at the computer each day, with a visit countdown and a note from the jar
- 👆 Click a bear to poke back

**Being considerate**
- Quiet hours (11:30 p.m.–8 a.m. by default)
- Pauses while the screen is locked, she's away, a Focus/Do Not Disturb is on, Zoom is screen-sharing, or a full-screen app,
  Zoom, Teams, FaceTime, Keynote or PowerPoint is in front
- Anything missed replays as one "while you were away" summary
- Panic button: ⌘/Ctrl + Alt + Shift + B hides the bears and snoozes for an hour
- Snooze from the menu

**App**
- Menu-bar 💗 (Mac) / tray (Linux) with send, status, notes, snooze, preview-any-animation
- Settings window with pairing, her phone number, time zones, timings, bear size, and a **✨ Try it** section (works without a tray icon)
- Starts at login. Mac: menu-bar only, no Dock icon. Uses little memory, fine on her 8 GB Mac.

---

## The animations

Your friend's 16 GIFs (`animations/`) were imported with `tools/import-gifs.js`:
- **Backgrounds:** five had a solid background (Dudu-hello, Dudu-idle, Dudu-working, bubu-cute-attack, bubu-dudu-kiss).
  The importer removes it by flood-filling from the edges, so Bubu's white fur is kept.
- **Format:** all were saved as transparent animated PNGs (smoother edges than GIF), and big ones were shrunk.
- **Characters:** **brown bear = Dudu, white bear = Bubu**, picked per person in Settings.
- **Fallback:** where only one character has a pose, hand-drawn placeholder bears fill in. The drawn bears also handle the
  burger, sleepy, love-note, sign and MISSING-poster scenes.

These are licensed to the two of you through your friend, so keep the app private and don't publish it.

---

## Making it plug-and-play

- **Your PC:** `./setup-linux.sh` installs Node.js (into your home folder, no admin password), the app's packages, and
  Electron. It also adds **Bearly Apart** to your app list and starts it at login. It offers to install GNOME's tray-icon
  extension (optional, needs your password).
- **Her Mac:** `npm run kit -- --her-name "…" --my-phone "…"` builds `dist/Bearly-Apart-for-<her>.zip`, containing:
  - the Mac app, ad-hoc signed so Apple Silicon will run it
  - `install.command`: installs to Applications, clears the "downloaded from the internet" block, opens the Full Disk
    Access page, and restarts the app afterwards
  - **settings already paired with you and already containing your phone number**
  - `READ ME FIRST.txt` with her steps

  Her whole install is **one pasted Terminal line + one switch**. On first launch her app announces itself and your
  screen gets a "Paired!" bear.

---

## How it was tested

- **Automated tests (21, all passing):** the trigger logic (cooldowns, combos, keywords, hug timing, silence levels,
  morning notes, countdown), iMessage reading against a fake message database (including the hidden-text format newer
  macOS uses), the relay (including catching up on messages sent while offline), the queue and summary, and the pairing codes.
- **Two copies on your PC** ("you" and "her") through a local stand-in relay: kisses, statuses, iMessages in both
  directions, and kit-based pre-pairing all worked.
- **On your actual screen:** you confirmed Settings shows and the bears play over the desktop with no box behind them.
- **Frame captures** of every scene were checked visually.

## Problems found and fixed along the way
- **iMessage timestamps:** real ones are too big for JavaScript numbers. This would have crashed on her Mac; they're now
  converted inside the database query.
- **Invisible windows on your Wayland desktop:** the switch to X11 has to be made at launch, not inside the app. The app now
  launches with it and relaunches itself when needed.
- **GPU crash on your AMD graphics under XWayland:** the GPU is turned off on Linux (the overlay doesn't need it).
- **No tray icon on stock GNOME:** opening the app again now brings up Settings, which has **✨ Try it** with everything from the menu.
- **Quiet hours blocked previews:** previews now always play.
- **App-menu launcher couldn't find Node / Electron hadn't downloaded:** the launcher now runs Electron directly, and setup downloads it.
- **Kit could ship an outdated Mac app:** it now rebuilds every time.
- **GTK warning every minute:** came from the menu's Ctrl+Q shortcut, which is now removed.

---

## Not tested yet: needs her MacBook
These can only be checked on a real Mac:
- [ ] First launch from the installer (the "Open Anyway" / quarantine step)
- [ ] The Full Disk Access switch and the app seeing her texts ("✓ Watching iMessage" in the 💗 menu)
- [ ] The 💗 menu-bar icon
- [ ] The sword bear walking along her **actual** front window
- [ ] Focus / Do Not Disturb detection
- [ ] Bears appearing over full-screen apps

If anything misbehaves, note what you see. Most of it is quick to fix.

## Next steps
1. Open Bearly Apart → Settings: enter your name, pick Dudu or Bubu, Save, then quit.
2. `npm run kit -- --her-name "HER NAME" --my-phone "+1 …"` → send her the zip (Google Drive / WeTransfer).
3. She pastes one line and flips one switch (see `START-HERE.md`, section 4).
4. Optional: build the iPhone Shortcut (README) so you can send kisses and statuses from your phone.

## Tools installed on your PC (in your home folder, no admin needed)
- Node.js 24 LTS → `~/.local/opt/node`, with `node`/`npm`/`npx` in `~/.local/bin`
- rcodesign 0.29.0 (signs the Mac app from Linux) → `~/.local/bin`
- App launcher → `~/.local/share/applications/bearly-apart.desktop`, plus autostart in `~/.config/autostart/`
