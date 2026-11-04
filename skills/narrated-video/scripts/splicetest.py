# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "mlx-whisper; sys_platform == 'darwin' and platform_machine == 'arm64'",
#                 "faster-whisper; sys_platform != 'darwin' or platform_machine != 'arm64'"]
# ///
# Hear a cut before it goes in: splice ranges of the take (5 ms fades) and transcribe the result with and without the
# filler prompt. A clean cut reads as the intended sentence in both; a clipped word or a leftover "uh" shows up.
#   uv run splicetest.py <take-dir> name=a:b,c:d [name2=...]      (keep a..b, then c..d)
# Whisper drops words from a clip that starts or ends mid-phrase, so the first range is moved back to start in the pause
# before its phrase, and the last range forward to end in the pause after it.
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FILLER_PROMPT, energy, read_wav, take, transcribe, write_wav

d = sys.argv[1]; T = take(d)
x, sr = read_wav(os.path.join(d, 'take.wav'))
quiet = energy(x, sr) < T['voiced_db']
def to_pause(t, step):
    """The middle of the nearest pause, walking back (step -1) or forward (+1) up to 10 s: the first quiet stretch of
    0.15 s or more (a phrase boundary), or else the longest quiet stretch found."""
    i = int(round(t * 100))
    if quiet[max(0, i - 7):i + 8].all(): return t
    best, run, k = None, 0, i
    for _ in range(1000):
        k += step
        if not 0 <= k < len(quiet): break
        run = run + 1 if quiet[k] else 0
        if run and (best is None or run > best[1]): best = (k - step * (run // 2), run)
        if run >= 15: break
    return best[0] / 100 if best else t
out = os.path.join(d, 'splicetests'); os.makedirs(out, exist_ok=True)
ramp = lambda n: 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))
for arg in sys.argv[2:]:
    name, spec = arg.split('=')
    rs = [list(map(float, r.split(':'))) for r in spec.split(',')]
    a0, b1 = to_pause(rs[0][0], -1), to_pause(rs[-1][1], +1)
    if (a0, b1) != (rs[0][0], rs[-1][1]): print(f'{name}: ranges widened to whole phrases, {a0:.2f} ... {b1:.2f}')
    rs[0][0], rs[-1][1] = a0, b1
    parts = []
    for a, b in rs:
        s = x[int(a * sr):int(b * sr)].copy(); f = int(0.005 * sr)
        s[:f] *= ramp(f); s[-f:] *= ramp(f)[::-1]; parts.append(s)
    p = os.path.join(out, f'{name}.wav'); write_wav(p, np.concatenate(parts), sr)
    t = [transcribe(p, pr, word_timestamps=False, language=T.get('language', 'en'))['text'].strip() for pr in (None, FILLER_PROMPT)]
    print(f'{name:12s} plain: {t[0]}\n{"":12s} disfl: {t[1]}')
