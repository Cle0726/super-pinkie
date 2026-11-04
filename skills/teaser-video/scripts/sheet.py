# /// script
# dependencies = ["pillow"]
# ///
"""A contact sheet: one frame per time, each labelled with its time, tiled 4 across.

  uv run sheet.py video.mp4 sheet.png 0 1.2 2.4 2.6 3.4 4.4 6.0 8.2 9.5

Frames come from ffmpeg (on PATH); labels use Pillow's built-in font, so no system font is needed.
"""
import io
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

if not shutil.which("ffmpeg"):
    sys.exit("ffmpeg is not on PATH")
if len(sys.argv) < 4:
    sys.exit(__doc__)
video, out, times = sys.argv[1], sys.argv[2], sys.argv[3:]
W, COLS, PAD = 640, 4, 4
font = ImageFont.load_default(size=28)
tiles = []
for t in times:
    png = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", t, "-i", video, "-frames:v", "1", "-vf", f"scale={W}:-2",
         "-f", "image2pipe", "-c:v", "png", "-"],
        check=True, capture_output=True,
    ).stdout
    if not png:
        sys.exit(f"no frame at {t} s")
    im = Image.open(io.BytesIO(png)).convert("RGB")
    d = ImageDraw.Draw(im)
    box = d.textbbox((10, 8), t, font=font)
    d.rectangle((box[0] - 6, box[1] - 4, box[2] + 6, box[3] + 4), fill="white")
    d.text((10, 8), t, font=font, fill="red")
    tiles.append(im)
h = tiles[0].height
rows = (len(tiles) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * W + (COLS - 1) * PAD, rows * h + (rows - 1) * PAD), "black")
for i, im in enumerate(tiles):
    sheet.paste(im, ((i % COLS) * (W + PAD), (i // COLS) * (h + PAD)))
sheet.save(out)
print(f"{out}: {len(tiles)} frames")
