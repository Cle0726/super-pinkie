# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Verify a finished video before anyone watches it.
#   uv run check.py <final.mp4> <project> <take-dir>
# 1 Window: the app window's red traffic light is on screen in every frame until the window leaves (a frame without it
#   is a flicker: a scene boundary that left a frame in no scene).
# 2 Sync: every 2.5 s, the webcam bubble is matched against the source webcam frames and the audio is cross-correlated
#   with the source narration; both should land on the source instant the edit list says (0 frames, 0 ms). A 0.4 s
#   audio window that falls in a pause can read tens of ms off; those are re-measured with 1.2 s before counting.
# 3 Loudness of the final mix (the master is -16 LUFS; AAC encoding raises the true peak a little).
import os, re, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FPS, load, need, read_wav, seg_len, seg_starts, take

V, P, D = sys.argv[1:4]
L, SC, T, E = load(os.path.join(P, 'layout.json')), load(os.path.join(P, 'scenes.json')), take(D), load(os.path.join(D, 'edl.json'))
need('ffmpeg')
def raw(src, vf, shape, fmt='gray'):
    b = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', fmt, '-'], capture_output=True, check=True).stdout
    return np.frombuffer(b, np.uint8).reshape(-1, *shape)

s = L['WIN_S']; x, y = int(round(L['WIN_X'] + 20 * s)) - 2, int(round(L['WIN_Y'] + 21 * s)) - 2
px = raw(V, f'crop=4:4:{x}:{y}', (16, 3), 'rgb24').astype(float).mean(axis=1)
red = (px[:, 0] > 200) & (px[:, 1] < 150) & (px[:, 2] < 150)
until = int(SC['window_until'] * FPS)
miss = [n for n in range(min(until, len(red))) if not red[n]]
print(f'window: {until} frames checked, {len(miss)} without the window' + (': ' + ', '.join(f'{n} ({n / FPS:.3f}s)' for n in miss[:12]) if miss else ''))

DIAM = L['CAM_D']; IN = int(round(DIAM * 0.48 / 2) * 2); O = (DIAM - IN) // 2
fin = raw(V, f"format=gray,crop={IN}:{IN}:{L['CAM_X'] + O}:{L['CAM_Y'] + O}", (IN, IN)).astype(np.float32)   # gray first: odd crops stay exact
src = raw(os.path.join(D, 'cam.mp4'), f'format=gray,scale={DIAM}:{DIAM}:flags=lanczos,crop={IN}:{IN}:{O}:{O}', (IN, IN)).astype(np.float32)
fa = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', V, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], capture_output=True, check=True).stdout, np.int16).astype(np.float32) / 32768
sa, SR = read_wav(os.path.join(D, 'take.wav'))
starts, _ = seg_starts(E['segs'])
def source_of(te):   # narration time at edited time te, away from segment edges
    for g, e0 in zip(E['segs'], starts):
        if e0 + 0.25 <= te < e0 + seg_len(g) - 0.6: return g[1] + te - e0
def audio_offset(te, s, win):
    seg = fa[int(te * SR):int(te * SR) + int(win * SR)]; seg = seg - seg.mean()
    if np.sqrt((seg ** 2).mean()) < 0.01: return None
    j0 = int((s - 0.1) * SR); ref = sa[j0:j0 + int((win + 0.2) * SR)]
    cc = np.correlate(ref - ref.mean(), seg, mode='valid')
    return (int(np.argmax(np.abs(cc))) - int(0.1 * SR)) / SR * 1000
vo, ao, notes = [], [], []
for te in np.arange(1.0, len(fin) / FPS - 2, 2.5):
    s_ = source_of(te)
    if s_ is None: continue
    f, exp = int(round(te * FPS)), int(round((s_ + T['offset']) * FPS))
    cands = range(max(0, exp - 10), min(len(src), exp + 11))
    best = cands[int(np.argmin([np.mean((fin[f] - src[c]) ** 2) for c in cands]))]
    if 0 < exp < len(src) - 1 and np.mean(np.abs(src[exp + 1] - src[exp - 1])) > 1.2: vo.append(best - exp)   # skip near-still moments
    a = audio_offset(te, s_, 0.4)
    if a is not None and abs(a) > 1:
        a2 = audio_offset(te, s_, 1.2); notes.append(f'{te:.1f}s: {a:+.1f} ms on 0.4 s, {a2:+.2f} ms on 1.2 s'); a = a2
    if a is not None: ao.append(a)
vo, ao = np.array(vo), np.array(ao)
counts = {int(k): int(v) for k, v in zip(*np.unique(vo, return_counts=True))}
print(f'webcam: {len(vo)} points, frame offsets {counts}' + ('' if set(counts) <= {0} else '   <- CHECK: the bubble is off its voice'))
print(f'audio: {len(ao)} points, median {np.median(ao):+.2f} ms, max |{np.abs(ao).max():.2f}| ms' + ('' if np.abs(ao).max() < 5 else '   <- CHECK'))
for n in notes: print('  re-measured', n)
lu = subprocess.run(['ffmpeg', '-v', 'info', '-i', V, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
summary = lu[lu.rfind('Summary'):]
I = re.search(r'I:\s+(-?[\d.]+) LUFS', summary); pk = re.search(r'Peak:\s+(-?[\d.]+) dBFS', summary)
print(f'loudness: {I.group(1) if I else "?"} LUFS, true peak {pk.group(1) if pk else "?"} dBFS')
