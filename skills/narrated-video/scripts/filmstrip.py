# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow>=10.1"]
# ///
# A contact sheet of a video: one frame every STEP seconds, each labelled with its own time.
#   uv run filmstrip.py <video> <out.png> [--start 0] [--duration all] [--step 4] [--cols 6] [--width 400]
# Frames are picked with select (the first frame at or after each step), not the fps filter, which takes the last frame
# of each bucket: its frames would be up to a whole step later than their labels.
import argparse, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ff, ffprobe_json

ap = argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('out')
for k, v in (('start', 0.0), ('duration', None), ('step', 4.0)): ap.add_argument(f'--{k}', type=float, default=v)
for k, v in (('cols', 6), ('width', 400)): ap.add_argument(f'--{k}', type=int, default=v)
a = ap.parse_args()
dur = a.duration or float(ffprobe_json(a.video)['format']['duration']) - a.start
with tempfile.TemporaryDirectory() as tmp:
    ff('-ss', a.start, '-t', dur, '-copyts', '-i', a.video, '-vf', f"select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,{a.step}-0.001)',scale={a.width}:-2",
       '-fps_mode', 'vfr', os.path.join(tmp, '%04d.png'))
    files = sorted(os.listdir(tmp))
    tiles = [Image.open(os.path.join(tmp, f)).convert('RGB') for f in files]
font = ImageFont.load_default(size=22)
w, h = tiles[0].size; rows = (len(tiles) + a.cols - 1) // a.cols
sheet = Image.new('RGB', (w * min(a.cols, len(tiles)), h * rows))
for i, im in enumerate(tiles):
    t = a.start + i * a.step
    label = f'{int(t // 60)}:{t % 60:05.2f}'
    d = ImageDraw.Draw(im); box = d.textbbox((8, 8), label, font=font)
    d.rectangle((box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4), fill=(0, 0, 0)); d.text((8, 8), label, font=font, fill=(255, 255, 255))
    sheet.paste(im, ((i % a.cols) * w, (i // a.cols) * h))
sheet.save(a.out)
print(f'{a.out} ({len(tiles)} frames)')
