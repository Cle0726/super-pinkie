# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Every audio cut is also a cut in the webcam bubble. Score how visible each candidate's jump is (mean difference of
# the frames either side, 0 = identical; under ~6 is hard to see) and, with --slide, look for a better spot: the same
# cut length moved up to that many seconds while both ends stay in silence.
#   uv run jump.py <take-dir> 16.25:16.96 [114.09:114.50 ...] [--slide 0.3]
# A cut on a scene change needs no scoring: the picture cuts there too, and hides the jump.
import os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FPS, energy, need, read_wav, take

d = sys.argv[1]; T = take(d); x, sr = read_wav(os.path.join(d, 'take.wav')); db = energy(x, sr)
slide = float(sys.argv[sys.argv.index('--slide') + 1]) if '--slide' in sys.argv else 0.0
need('ffmpeg'); N = 112
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(d, 'cam.mp4'), '-vf', f'format=gray,scale={N}:{N}', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, N, N).astype(np.float32)
def score(a, b):   # last kept frame before the cut against the first kept frame after it
    i, j = int(round((a + T['offset']) * FPS)) - 1, int(round((b + T['offset']) * FPS))
    return float(np.abs(fr[i] - fr[j]).mean())
quiet = lambda t: (db[max(0, int(t * 100) - 2):int(t * 100) + 3] < T['voiced_db']).all()
for arg in (s for s in sys.argv[2:] if ':' in s and not s.startswith('--')):
    a, b = map(float, arg.split(':'))
    line = f'{a:7.2f}:{b:7.2f}  jump {score(a, b):5.1f}'
    if slide:
        best = min(((score(a + k / FPS, b + k / FPS), k / FPS) for k in range(-int(slide * FPS), int(slide * FPS) + 1)
                    if quiet(a + k / FPS) and quiet(b + k / FPS)), default=None)
        if best: line += f'   best {best[0]:5.1f} at {a + best[1]:.2f}:{b + best[1]:.2f} (moved {best[1]:+.2f} s)'
    print(line)
