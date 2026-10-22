# Writing scenes

A scene is a short performance. `assets/scenes.json` holds the built-in ones. A `scenes.json` in your profile
folder overrides them by name, and is reloaded as soon as you save it.

```json
"message": {
  "caption": "optional pill at the top",  "sub": "optional second line",  "captionMs": 5000,
  "rain": { "src": "heart.svg", "count": 20, "ms": 3500 },
  "actors": [
    { "asset": "bear-run-{pc}.svg", "size": 150, "at": ["left-off", "bottom"], "pokeable": true,
      "steps": [ { "do": "move", "x": "center", "ms": 1700 }, ... ] }
  ]
}
```

## Which scene plays when
| Trigger | Scene |
|---|---|
| Text (cooldown applies) | `message` |
| 5 texts in 90s | `combo` |
| Keyword in a text (miss you, kiss, hug) | `kw-<keyword>` if it exists (for example `kw-miss-you`), otherwise the button's scene (`kiss`, `hug`) |
| ❤️ tapback | `tapback-love` (also `tapback-laugh` and others if you add them) |
| Sent from the menu or phone | `kiss`, `heart`, `hug`, `poke`, `miss-you` |
| Status | `status-<name>` if it exists, otherwise `status` |
| Love note / note jar | `note` / `jar` |
| Silence | `missing-peek`, `missing-sword`, `missing-poster` (set in config `missing`) |
| First time at the computer each morning | `good-morning`, or `countdown` on visit milestones |

## Variables
Use these in `asset`, `text`, and `caption`: `{pc}` their bear (`brown`/`cream`), `{mc}` your bear, `{partner}`, `{me}`,
`{hours}` (silence), `{note}`, `{countdown}`, `{emoji}`, `{statusLabel}`, `{caption}`.

## Positions
An actor's position is **its feet**: `x` is the horizontal center and `y` is the bottom edge.
- x: `left-off`, `left`, `center`, `right`, `right-off`, `win.left`, `win.center`, `win.right`, `"40%"`, or a number
- y: `off-top`, `top`, `center`, `bottom`, `off-bottom`, `win.top`, `win.center`, `win.bottom`, `"60%"`, or a number
- Add an offset: `"center+80"`, `"bottom+70"` (pushes the bear partly off screen, so it peeks)
- `win.*` is the window in front (on the Mac). Elsewhere it falls back to a box in the middle of the screen.

## Actor options
`asset`, `size` (px at a ~900pt-tall screen), `at`, `face` (`left`/`right`), `faces: "left"` if your GIF's character
faces left, `hidden: true` (appears on a `show` step), `pokeable: true` (clicking it sends a poke back), `frame: true` (for a GIF
that keeps its painted background: shown as a little picture with a white border).

## Steps
| `do` | Options | |
|---|---|---|
| `move` | `x`, `y`, `ms`, `ease`, `hop:false`, `noflip`, `scratch:true` | walks/runs there (flips to face the way it's going) |
| `asset` | `src` | swap the image, for example to the burger pose |
| `zoom` | `scale`, `ms` | grow toward the screen (the "kiss the screen" effect) |
| `stamp` | `src`, `size`, `life`, `atY`, `at:"center"` | leaves an image (lips) that fades out |
| `say` | `text`, `ms`, `block` | speech bubble |
| `card` | `text`, `ms`, `if` | big note card. Click to close |
| `rain` | `src`, `count`, `ms`, `size`, `block` | things fall from the sky |
| `shake`, `jump` | `ms`, `times`, `height` | wiggle / hop |
| `show`, `fade` | `ms` | pop in / fade out |
| `face` | `dir` | turn around |
| `wait` | `ms` | |

Any step can have `"if": "note"`, which skips the step when that variable is empty.
