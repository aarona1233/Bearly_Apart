# 🐻 Bearly Apart — start here

About 10 minutes for you, about 1 minute for her. She doesn't install anything except the app.

---

## 1. Set up your computer (once)

Open a terminal and run:

```bash
cd "$HOME/Bearly Appart/bearly-apart" && ./setup-linux.sh --build-tools
```

This installs everything listed in [requirements.txt](requirements.txt) (Node.js, the app's packages, and the tool
that builds her Mac app), adds **Bearly Apart** to your app list, and starts it when you log in. It may ask
whether to install the GNOME tray icon. Say **y** if you want the 💗 in your top bar (then log out and back in).

Then open **Bearly Apart** from your apps (or run `./run.sh` in that folder). In the window that opens:
1. Type your name and pick your bear (**Dudu** or **Bubu**).
2. Click **Save**, then quit the app (💗 → Quit, or close the terminal running it).

---

## 2. Make her installer (already paired with you)

With Bearly Apart **quit**, run:

```bash
cd "$HOME/Bearly Appart/bearly-apart" && npm run kit -- --her-name "HER NAME" --my-phone "+1 555 123 4567"
```

- `--my-phone` is **your** number, the way it shows in her Messages app. If you sometimes iMessage her from an
  email address too, add it after a comma: `"+1 555 123 4567,you@icloud.com"`.
- Optional: `--her-bear brown` if she should be Dudu (by default she gets whichever bear you didn't pick).

This builds **`dist/Bearly-Apart-for-<her name>.zip`** (about 136 MB). Open Bearly Apart again afterwards.

---

## 3. Send it to her

Upload the zip to Google Drive, Dropbox or WeTransfer and text her the link. It's too big for an iMessage attachment.
When she downloads it in Safari, it unzips by itself into **Downloads → Bearly Apart Installer**.
(In Chrome, she double-clicks the zip once.)

---

## 4. What she does (about 1 minute)

1. Open **Terminal** (⌘ + Space, type `Terminal`, press Return).
2. Paste this and press Return:
   ```bash
   bash ~/Downloads/"Bearly Apart Installer"/install.command
   ```
3. A window pops up: in **Full Disk Access**, switch **Bearly Apart** on, then click **Done**.

That's all. A 💗 appears in her menu bar, and your computer gets a "Paired!" bear.
The same steps are in the zip as **READ ME FIRST.txt**.

> Bears need **Messages on her Mac** signed in with *Messages in iCloud* turned on (Messages → Settings → iMessage).
> Most Macs already are. That's what puts her phone's texts on the Mac.

---

## 5. Try it together

| Do this | What happens |
|---|---|
| Text her anything | A bear runs across her screen and kisses it 💋 |
| Text "I miss you", "kiss" or "I want to hug you" | That animation plays |
| She texts you back | A bear shows up on **your** screen |
| Bearly Apart window → Send → 💋 Kiss | Kiss on her screen (✓ when it went out) |
| Both send 💗 heart within 20 seconds | Both screens get a hug |
| Nobody texts for 6 hours | Bubu drags the sword across her window ⚔️ |

**Nothing happening?** Bears wait during **quiet hours (11:30 p.m.–8 a.m.)**, while the screen is locked, while a
full-screen app or video call is in front, or while she's away from the computer. They play when the coast is clear,
as a "while you were away" summary. The yellow banner in the app says which one. Change the hours in Settings. **Animations → ▶ Play** always works, any time.

---

## 6. Optional: send from your iPhone
Settings → **📱 iPhone shortcut** shows the values. The step-by-step is in [README.md](README.md#3-your-iphone-shortcut-optional-recommended).

---

## Updating later
After changing animations or code: quit the app, run the same `npm run kit -- …` command again,
and send her the new zip. She runs the same Terminal line again. Her settings are kept; she just flips the
Full Disk Access switch off and on again when the window pops up.

## If something's off
| Problem | Fix |
|---|---|
| `npm: command not found` | Open a new terminal (or run `source ~/.bashrc`) |
| No 💗 icon on your computer | Open Bearly Apart again; its window comes up. Or rerun the setup and answer **y** for the tray icon |
| Her menu says "grant Full Disk Access" | System Settings → Privacy & Security → Full Disk Access → turn on Bearly Apart, then quit and reopen it |
| Her texts don't reach you | Her Mac must be awake with Bearly Apart running. Check Messages on her Mac shows the texts too |
| `npm run kit` says the app is running | Quit Bearly Apart first (it would overwrite the new pairing) |
