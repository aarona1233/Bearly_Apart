# 🐻 Bearly Apart

> **New here? Follow [START-HERE.md](START-HERE.md)**: setup for you, a one-line install for her.

Little bears run across your partner's screen when you text, poke, or go quiet for too long.

- **You text her on iMessage** → a bear runs onto her Mac's screen and kisses it 💋
- **She texts you** → her Mac notices and sends a bear to *your* computer
- **"miss you", "kiss" or "hug"** in a text (also 🥺, 😘, 💋, "mwah", 🫂) → that animation. Only these three for now.
- **Nobody's texted for 3 / 6 / 12 hours** → a sad bear peeks in → a bear drags a sword across her window ⚔️ → a MISSING poster
- **Status from your phone** (🍔 hungry, 😴 sleepy, 🏋️ gym…) → a bear acts it out
- **Love notes**: delivered right away, or saved in the "note jar" for her next morning
- **Hearts sent within 20s of each other** → the two bears hug 🫂
- **Visit countdown**, good-morning bear, "while you were away" summary, click a bear to poke back

## How it works

```
 Your iPhone (Shortcut) ─┐                    ┌─► Her Mac app  ◄── reads her local iMessage database
 Your PC app ────────────┼─► ntfy relay ◄─────┤
 Her Mac app ────────────┘   (ntfy.sh)        └─► Your PC app
```

- **iMessage**: Apple doesn't let other apps read notifications, but her Mac keeps a local copy of her messages
  (`~/Library/Messages/chat.db`). The Mac app reads it **read-only**, looking only at messages to and from you.
  It never sends iMessages, and the text of her messages never leaves her Mac. Only "she texted" and any matched
  keyword names (for example `miss-you`) are forwarded to you.
- **Relay**: [ntfy](https://ntfy.sh), a free push-message service. You don't need an account. The "topic" in your invite
  works like a shared password, so keep it between the two of you. What travels over it: event types (kiss, status:hungry, …),
  your names, and love-note text. If you'd rather not use a public server, ntfy can be self-hosted; change the server in `config.json`.

## Setup

Everyone gets the same download; pairing happens inside the app. Step by step, with pictures of what to click:
**[START-HERE.md](START-HERE.md)**.

- **Windows:** run `Bearly Apart Setup.exe`. (SmartScreen: **More info → Run anyway**, once.)
- **Mac:** open `Bearly Apart for Mac.zip`, drag **Bearly Apart** into **Applications**, and open it from there. The
  first time, macOS blocks it: **System Settings → Privacy & Security → Open Anyway**.
- **Linux:** unpack `Bearly Apart for Linux.tar.gz` and run `bearly-apart` inside.

A short setup runs on first launch: your name and bear, then one of you sends an **invite** and the other pastes it
(the invite carries your name, bear, time zone and iPhone number, so nothing else needs typing). On a Mac it then walks
through **Full Disk Access**, which lets the bears notice texts.

> After installing a **new version** on the Mac, macOS treats it as a different app: turn Full Disk Access off and on again for it.

### Your iPhone shortcut (optional, recommended)
This lets you send kisses and statuses from your phone, or by saying "Hey Siri, Bearly".

1. Open **Shortcuts → +**, name it **Bearly**.
2. Add **Dictionary**. For each button you want, add a *Text* item: the key is the button label (`🍔 Hungry`) and the value is
   the **Tags** line from *Settings → 📱 iPhone shortcut* (for example `ba,e.status,s.hungry,f.aaron`).
3. Add **Choose from List** → input: *Dictionary* (it lists the keys).
4. Add **Get Dictionary Value** → *Value* for *Chosen Item* in *Dictionary*.
5. Add **Get Contents of URL**:
   - URL: the URL from Settings (`https://ntfy.sh/ba-…`)
   - Method: **POST**
   - Headers: `Tags` = *Dictionary Value*, `Title` = `Bearly Apart`
   - Request Body: **File** → *Chosen Item* (this text is what shows in push notifications)
6. Tap ⓘ → **Add to Home Screen**. She can build the same shortcut using her own Tags lines.

Want a push on your phone when she sends something? Install the **ntfy** app and subscribe to the same topic.

## Daily use
- **The Bearly Apart window** (click the tray icon on Windows/Linux, or 💗 → Open Bearly Apart… on the Mac):
  - **Send**: big buttons for 💋 kiss, 💗 heart, 🫂 hug, 👉 poke and 🥺 miss you, each showing ✓ once it reached the relay
    (or ✗ with the reason). A **love note** box (send now, or save it for their next morning). **My status**: pick what you're
    up to; their bear acts it out once and it stays next to your name in their 💗 menu until you change or clear it.
    **Recent** lists what you sent and what came in.
  - **Animations**: every animation with a plain name, when it plays, and a ▶ button to preview it on your own screen.
  - **Settings**: names, bears, time zone, quiet hours, what makes the bears wait, pairing, iPhone shortcut.
  - A yellow banner says when bears are waiting and why (snoozed, quiet hours, screen sharing, away…).
- Menu bar / tray 💗: the same sends and statuses, snooze, and open the window. If a send from the menu fails, you get a notification.
- **Panic button**: ⌘/Ctrl + Alt + Shift + B hides the bears and snoozes for an hour.
- Bears never play during quiet hours, while the screen is locked or she's away (they wait and replay as a
  "while you were away" summary), while a Focus is on, while Zoom is sharing, or while a full-screen app,
  Zoom, Teams, FaceTime, Keynote, or PowerPoint is in front.

## Your own GIFs 🎬
**Bundled:** the Bubu & Dudu animations in `../animations` are already imported (brown bear = Dudu, white bear = Bubu).
To add more, put the GIF in `../animations` and run `npx electron tools/import-gifs.js ../animations`. It removes solid
backgrounds and saves a transparent animated PNG into `assets/`.
- **A new Send button:** start the file name with `_` or put a `%` in it (`_Bubu wave.gif`). The importer adds a
  **✨ Bubu wave** button to `assets/sendables.json` and its scene `send-bubu-wave` to `assets/scenes.json`. Change
  the emoji, label and caption (`says`) in `sendables.json`; button order follows that file.
- **Anything else:** add a line to the name map at the top of `tools/import-gifs.js`, then use the name in
  `assets/scenes.json`.

Then rebuild with `npm run release`.

**Without rebuilding:** you can also add GIFs straight on the computer they'll play on:
Menu → **Open custom GIF folder**, then drop files in there:
- **Quick swap**: a file with *exactly* the same name as a built-in one replaces it (for example a new `heart.svg`).
- **Your GIFs**: copy `assets/scenes.json` into the profile folder (next to `config.json`), then change a scene's
  `"asset"` to your file name, for example `"asset": "dudu-run.gif"`. It reloads as soon as you save.

GIF, PNG, WebP, SVG, and **WebM with transparency** all work. WebM looks much smoother than GIF. To convert a GIF:
`ffmpeg -i dudu.gif -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 dudu.webm`.
See [docs/SCENES.md](docs/SCENES.md) for the choreography format.

## Advanced settings
`config.json` lives in the profile folder (shown at the bottom of Settings):
- `keywords`: phrase → keyword name. `kw-<name>` plays when it appears in a text, or the button scene of the same name (`kiss`, `hug`).
- `missing`: hours and scene for each "missing you" level.
- `cooldownSec`, `combo`: how often plain texts animate, and when a burst becomes a combo.
- `pauseApps`: apps that pause the bears while they're in front.
- `partner.timezone`, `partnerSleepHours`: no nagging while they sleep.
- `relay.server`, `relay.token`: self-hosted ntfy.

## Development
```
npm install
npm test                 # unit tests (brain, iMessage parsing, relay, queue)
npm run mock-relay       # local ntfy stand-in on :8787
BA_PROFILE=her npm start # run a second copy with its own settings
npm run send -- --server http://127.0.0.1:8787 --topic ba-… --from her kiss
npm run assets           # regenerate placeholder bear art
npm run release          # dist/: Bearly Apart Setup.exe, Bearly Apart for Mac.zip (ad-hoc signed), … for Linux.tar.gz
```
Test hooks: `BA_DEMO=kiss,hug` plays scenes at startup, `BA_OPEN=setup|send|animations|settings` opens the window on that tab, `BA_CAPTURE=dir` saves overlay frames as PNGs, and
`BA_CHATDB=path` points the iMessage watcher at a fake database (`node tools/fake-chatdb.js`).
