# Cuts the Christmas tree's picture ornaments and little animals out of the art in ../Sort (stickers on white) into
# assets/tree/items/<kind>.png: the white background flood-filled away from the edges, stray bits (hearts, sparkles)
# dropped, trimmed and made at most MAX px. The kinds are listed in src/main/tree.js (KINDS) and src/app/tree-art.js
# (PICS). python tools/import-tree-items.py
import sys
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SORT = ROOT.parent.parent / 'Sort'
OUT = ROOT / 'assets' / 'tree' / 'items'
MAX = 420

STICKERS = 'download.png'  # a sheet of stickers (the white top half; the grey photo below is too faint to cut)
STICKERS_CROP = (50, 24, 1102, 1212)
TREATS = '65bddcbc1488eb5766abab8183c6dd59.jpg'
BAUBLES = 'e8827cb5e148dc4c33239c7a339964ea.jpg'
SOCKS = '2a4cbfc743c5edd32080afdaf38e5b36.jpg'
TEDDIES = 'a11455ac0ad501901723f987f83ac274.jpg'

# kind: (file, point on the sticker (None: the whole picture), crop of the file first, background tolerance)
ITEMS = {
    # little animals for round the tree skirt
    'reindeer-tree': ('6d760c7c8605a058716c2e079249b460.jpg', None, None, 38),
    'rudolph': ('4e1f51c37f5634746435640faad0f7b6.jpg', None, None, 38),
    'penguin': ('0db30d0c4f3e68f98e5e7344681d6050.jpg', None, None, 38),
    'polar-bear': ('9ef1eb8a63c9881ce1091beb5e9a4e0e.jpg', None, None, 38),
    'goose': ('0cd280159c96d1052e179586bf1f4e2d.jpg', None, None, 38),
    'reindeer-kiss': ('b478daf3b004e06cf9b494a18b54f844.jpg', None, None, 38),
    'penguin-hug': ('805539a853a8e92fd4e3d8a7d5cf9987.jpg', None, None, 38),
    'teddy-gift': (TEDDIES, (127, 151), None, 38),
    'teddy-antlers': (TEDDIES, (135, 426), None, 38),
    'teddy-tree': (TEDDIES, (135, 696), None, 38),
    'teddy-sleepy': (TEDDIES, (145, 955), None, 38),
    # decorations for the branches
    'snow-buddy': (TREATS, (216, 336), None, 38),
    'gold-bell': (TREATS, (609, 328), None, 38),
    'santa-star': (TREATS, (1008, 336), None, 38),
    'bow-cane': (TREATS, (168, 912), None, 38),
    'ginger-santa': (TREATS, (598, 913), None, 38),
    'mini-tree': (TREATS, (1003, 904), None, 38),
    'sweets': (TREATS, (213, 1459), None, 38),
    'gift-stripe': (TREATS, (606, 1441), None, 38),
    'gift-dots': (TREATS, (1003, 1438), None, 38),
    'holly': (STICKERS, (957, 115), STICKERS_CROP, 38),
    'bauble-tree': (BAUBLES, (216, 298), None, 38),
    'bauble-goldflake': (BAUBLES, (997, 303), None, 38),
    'bauble-wave': (BAUBLES, (216, 837), None, 38),
    'bauble-mint': (BAUBLES, (216, 1336), None, 38),
    'sock-flake': (SOCKS, (867, 273), None, 38),
    'sock-tree': (SOCKS, (196, 727), None, 38),
    'sock-dots': (SOCKS, (870, 1180), None, 38),
    'santa': (STICKERS, (109, 109), STICKERS_CROP, 38),
    'wreath': (STICKERS, (438, 306), STICKERS_CROP, 38),
    'poinsettia': (STICKERS, (954, 475), STICKERS_CROP, 38),
    'santa-hat': (STICKERS, (100, 499), STICKERS_CROP, 38),
    'cocoa-mug': (STICKERS, (97, 658), STICKERS_CROP, 38),
    'ginger-house': (STICKERS, (429, 978), STICKERS_CROP, 38),
    'candle': (STICKERS, (610, 976), STICKERS_CROP, 38),
    'santa-sack': (STICKERS, (943, 985), STICKERS_CROP, 38),
    'jingle-bells': (STICKERS, (766, 1114), STICKERS_CROP, 38),
}


def background(im, tol):
    """1 for every near-white pixel joined to the picture's edge."""
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)
    lo = 255 - tol

    def light(x, y):
        r, g, b = px[x, y]
        return r > lo and g > lo and b > lo

    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if light(x, y):
                bg[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if light(x, y) and not bg[y * w + x]:
                bg[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and light(nx, ny):
                bg[ny * w + nx] = 1
                q.append((nx, ny))
    return bg


def blobs(fg, w, h, reach=2):
    """The foreground's blobs (pixels within `reach` of each other join up): list of (pixel count, pixel list)."""
    seen = bytearray(w * h)
    out = []
    for i in range(w * h):
        if not fg[i] or seen[i]:
            continue
        seen[i] = 1
        q = deque([i])
        pix = []
        while q:
            j = q.popleft()
            pix.append(j)
            x, y = j % w, j // w
            for dx in range(-reach, reach + 1):
                for dy in range(-reach, reach + 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        k = ny * w + nx
                        if fg[k] and not seen[k]:
                            seen[k] = 1
                            q.append(k)
        out.append(pix)
    return out


def cut(kind, file, point, crop, tol):
    im = Image.open(SORT / file).convert('RGB')
    if crop:
        im = im.crop(crop)
    bg = background(im, tol)
    w, h = im.size
    # Find the sticker under the point on a coarse grid (fast), then cut it out at full size.
    step = 3
    gw, gh = w // step, h // step
    fg = bytearray(gw * gh)
    for gy in range(gh):
        for gx in range(gw):
            fg[gy * gw + gx] = 0 if bg[(gy * step) * w + gx * step] else 1
    parts = blobs(fg, gw, gh)
    if point:
        px, py = point[0] // step, point[1] // step
        best = min(parts, key=lambda p: min(abs(j % gw - px) + abs(j // gw - py) for j in p[:: max(1, len(p) // 400)]))
    else:
        best = max(parts, key=len)
    xs = [j % gw for j in best]
    ys = [j // gw for j in best]
    pad = 8
    box = (max(0, min(xs) * step - pad), max(0, min(ys) * step - pad), min(w, (max(xs) + 1) * step + pad), min(h, (max(ys) + 1) * step + pad))
    sub = im.crop(box)
    sw, sh = sub.size
    mask = bytearray(1 if not bg[(box[1] + y) * w + box[0] + x] else 0 for y in range(sh) for x in range(sw))
    # Keep the sticker itself; drop small loose bits (hearts, sparkles) in its corners.
    pieces = blobs(mask, sw, sh, reach=1)
    big = max(len(p) for p in pieces)
    keep = bytearray(sw * sh)
    for p in pieces:
        if len(p) >= 0.12 * big:
            for j in p:
                keep[j] = 255
    alpha = Image.frombytes('L', (sw, sh), bytes(keep))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    out = sub.convert('RGBA')
    out.putalpha(alpha)
    out = out.crop(alpha.getbbox())
    k = min(1, MAX / max(out.size))
    if k < 1:
        out = out.resize((round(out.width * k), round(out.height * k)), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / f'{kind}.png', optimize=True)
    return out.size


if __name__ == '__main__':
    only = set(sys.argv[1:])
    for kind, args in ITEMS.items():
        if only and kind not in only:
            continue
        print(kind, cut(kind, *args), flush=True)
