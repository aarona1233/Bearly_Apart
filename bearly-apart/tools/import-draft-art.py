# Smaller copies of the draft game's item art: the 512 px originals would add 53 MB to every update.
# Used by tools/import-draft.js.
import pathlib
import sys

from PIL import Image

SIZE = 256
QUALITY = 72

src, out = map(pathlib.Path, sys.argv[1:3])
files = sorted(src.glob("*.webp"))
for f in files:
    Image.open(f).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS).save(out / f.name, "WEBP", quality=QUALITY, method=6)
print(f"{len(files)} pictures, {sum(p.stat().st_size for p in out.glob('*.webp')) / 1e6:.1f} MB")
