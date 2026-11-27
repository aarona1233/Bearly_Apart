# Makes assets/tree/tree-snowy.png from tree-bare.png: the tree's shadow bands (under each tier's scallops) become
# shaded snow and its highlights bright snow, so the snow follows the drawing. python tools/make-snowy-tree.py
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent / 'assets' / 'tree'
im = Image.open(root / 'tree-bare.png').convert('RGBA')
px = im.load()
W, H = im.size
out = im.copy()
op = out.load()
SNOW = (244, 248, 253)
SNOW_SHADE = (212, 225, 240)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


for y in range(min(H, 932)):  # the trunk and bucket stay as they are
    for x in range(W):
        r, g, b, a = px[x, y]
        if a < 10 or g <= r + 10:  # not foliage (outline, background)
            continue
        c = (int(r * 0.9 + 4), int(g * 0.95), int(min(255, b * 1.05 + 10)))  # a little cooler
        ts = max(0.0, min(1.0, (118 - g) / 14))  # shadow (g ~ 96)
        th = max(0.0, min(1.0, (g - 142) / 14))  # highlight (g ~ 162); main green (g ~ 135) stays
        if ts > 0:
            c = lerp(c, SNOW_SHADE, ts)
        if th > 0:
            c = lerp(c, SNOW, th)
        op[x, y] = (*c, a)
out.save(root / 'tree-snowy.png', optimize=True)
