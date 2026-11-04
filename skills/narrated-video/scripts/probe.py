# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Prepare a recorded take: its narration audio, a square webcam track for the bubble, and the take's settings.
#   uv run probe.py <recording.mov> <take-dir> [--crop W:H:X:Y] [--at SECONDS]
# Writes take.wav (mono 48 kHz, the audio stream as recorded), cam.mp4 (constant 30 fps, the square crop scaled to 560),
# take.json (offset of the audio against the video, noise floor, speech thresholds, crop) and still.jpg (a frame with
# the crop drawn on six frames across the take: look at it and re-run with --crop if the face is not centred in all six).
import argparse, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FPS, SR, energy, ff, ffprobe_json, read_wav, save

ap = argparse.ArgumentParser()
ap.add_argument('recording'); ap.add_argument('take_dir')
ap.add_argument('--crop', help='square crop W:H:X:Y in source pixels (default: centred, full height)')
ap.add_argument('--language', default='en')
a = ap.parse_args()
os.makedirs(a.take_dir, exist_ok=True)
P = ffprobe_json(a.recording)
v = next(s for s in P['streams'] if s['codec_type'] == 'video')
au = next((s for s in P['streams'] if s['codec_type'] == 'audio'), None)
if not au: sys.exit('the recording has no audio stream')
W, H = int(v['width']), int(v['height'])
offset = round(float(au.get('start_time', 0)) - float(v.get('start_time', 0)), 6)   # audio starts this long after the video
crop = a.crop or f'{min(W, H)}:{min(W, H)}:{(W - min(W, H)) // 2}:{(H - min(W, H)) // 2}'
cw, ch, cx, cy = map(int, crop.split(':'))
assert cw == ch, 'the bubble is round: the crop must be square'
wav, cam, still = (os.path.join(a.take_dir, f) for f in ('take.wav', 'cam.mp4', 'still.jpg'))
ff('-i', a.recording, '-vn', '-ac', 1, '-ar', SR, '-c:a', 'pcm_s16le', wav)
ff('-i', a.recording, '-an', '-vf', f'fps={FPS},crop={crop},scale=560:560:flags=lanczos', '-c:v', 'libx264', '-crf', 14, '-preset', 'fast', '-pix_fmt', 'yuv420p', cam)
dur = float(P['format']['duration'])
tmp = os.path.join(a.take_dir, 'stills'); os.makedirs(tmp, exist_ok=True)
for k in range(6):   # six frames spread across the take: people shift in their seat
    ff('-ss', round(dur * (0.05 + 0.18 * k), 2), '-i', a.recording, '-frames:v', 1, '-vf', f'drawbox=x={cx}:y={cy}:w={cw}:h={ch}:color=red@0.9:t=4,scale=480:-2', os.path.join(tmp, f'{k}.jpg'))
ff('-i', os.path.join(tmp, '%d.jpg'), '-vf', 'tile=3x2', '-frames:v', 1, '-q:v', 3, still)
x, sr = read_wav(wav)
db = energy(x, sr)
floor = float(np.percentile(db, 10))
T = dict(source=os.path.abspath(a.recording), duration=round(len(x) / sr, 3), width=W, height=H, fps=FPS, offset=offset,
         crop=crop, language=a.language, floor_db=round(floor, 1),
         # speech thresholds relative to this take's noise floor (a hotter recording moves them all up)
         voiced_db=round(floor + 6.5, 1), peak_db=round(floor + 9.5, 1), loud_db=round(floor + 10.5, 1))
save(os.path.join(a.take_dir, 'take.json'), T)
print(f"{W}x{H}, {T['duration']} s, audio offset {offset * 1000:.1f} ms, noise floor {floor:.1f} dB, crop {crop}")
print(f'wrote take.wav, cam.mp4, take.json, still.jpg (check the crop) in {a.take_dir}')
