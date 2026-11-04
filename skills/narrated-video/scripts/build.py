# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Cut the narration and the webcam from edl.json: narration-edit.wav, cam-edit.mp4 and av.json.
#   uv run build.py <take-dir>
# Audio: sample-exact slices of take.wav joined with a 20 ms equal-power crossfade at every splice (each side runs on
# 10 ms past its edge into the removed room tone; 3 ms where an edge is inside voiced sound, to keep it crisp), a 30 ms
# fade in and an 80 ms fade out.
# Webcam: every output frame maps to one source frame of cam.mp4, piece by piece, and the real webcam keeps running for
# 2 s after the last word. Each piece starts on the source frame that matches where its first frame lands in the edit:
# rounding the source start and the edited start separately can leave the bubble up to a frame off the voice. Every
# cut gets a 4-frame dissolve centred on it, blending each side's own continuation frames, so a jump in the bubble
# reads as a soft cut. Frame count and sync are unchanged.
import os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FPS, energy, load, need, read_wav, save, seg_starts, take, write_wav

DISSOLVE, TAIL, SIZE = 4, 2 * FPS, 560   # probe.py writes cam.mp4 at 560x560

d = sys.argv[1]; T = take(d); E = load(os.path.join(d, 'edl.json'))
SEGS, OFF = E['segs'], T['offset']
x, sr = read_wav(os.path.join(d, 'take.wav'))
db = energy(x, sr)
loud = lambda t: db[min(len(db) - 1, max(0, int(round(t * 100))))] > T['loud_db']

# Audio
pieces = [x[int(round(a * sr)):int(round(b * sr))].copy() for _, a, b in SEGS]
out = np.concatenate(pieces); pos = np.cumsum([0] + [len(p) for p in pieces])
for k in range(1, len(SEGS)):
    edge_a, edge_b = SEGS[k - 1][2], SEGS[k][1]
    h = int((0.0015 if loud(edge_a) or loud(edge_b) else 0.010) * sr)
    ga, gb = np.cos(np.linspace(0, np.pi / 2, 2 * h)), np.sin(np.linspace(0, np.pi / 2, 2 * h))
    ia, ib, p = int(round(edge_a * sr)), int(round(edge_b * sr)), pos[k]
    out[p - h:p + h] = x[ia - h:ia + h] * ga + x[ib - h:ib + h] * gb
ramp = lambda n: 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))
fi, fo = int(0.03 * sr), int(0.08 * sr)
out[:fi] *= ramp(fi); out[-fo:] *= ramp(fo)[::-1]
write_wav(os.path.join(d, 'narration-edit.wav'), out, sr)
starts, total = seg_starts(SEGS)
print(f'narration-edit.wav {total:.3f} s, {len(SEGS) - 1} crossfades')

# Webcam: plan[f] = (source frame, the other side's source frame or None, its weight)
F0 = [round(e0 * FPS) for e0 in starts]
delta = [round((a + OFF + F0[k] / FPS - starts[k]) * FPS) - F0[k] for k, (_, a, _) in enumerate(SEGS)]
NF = round(total * FPS) + TAIL
plan, k = [], 0
for f in range(NF):
    while k + 1 < len(SEGS) and f >= F0[k + 1]: k += 1
    plan.append((f + delta[k], None, 0.0))
for k in range(1, len(SEGS)):
    for i in range(DISSOLVE):
        f = F0[k] - DISSOLVE // 2 + i
        plan[f] = (f + delta[k - 1], f + delta[k], (i + 0.5) / DISSOLVE)

need('ffmpeg', 'ffprobe')
FS = SIZE * SIZE * 3 // 2
wanted = {n for a, b, _ in plan for n in (a, b) if n is not None}
dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', os.path.join(d, 'cam.mp4'), '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'], stdout=subprocess.PIPE)
cam = os.path.join(d, 'cam-edit.mp4')
enc = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', f'{SIZE}x{SIZE}', '-r', str(FPS), '-i', '-',
                        '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', str(FPS), cam], stdin=subprocess.PIPE)
cache, nread, last = {}, 0, None
def frame(n):
    """Source frame n, reading cam.mp4 forward; past the end of the recording, its last frame."""
    global nread, last
    while nread <= n:
        buf = dec.stdout.read(FS)
        if len(buf) < FS: break
        last = np.frombuffer(buf, np.uint8)
        if nread in wanted: cache[nread] = last
        nread += 1
    return cache.get(n, last)
for f, (a, b, w) in enumerate(plan):
    img = frame(a) if b is None else np.rint(frame(a) * (1 - w) + frame(b) * w).astype(np.uint8)
    enc.stdin.write(img.tobytes())
    if f % 30 == 0:   # drop frames no later output frame needs (a dissolve looks back at most a few frames)
        lo = min(p[0] for p in plan[f + 1:]) if f + 1 < NF else nread
        for n in [n for n in cache if n < lo]: del cache[n]
enc.stdin.close(); enc.wait(); dec.kill(); dec.wait()
assert enc.returncode == 0, 'webcam encode failed'
got = int(subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', cam], capture_output=True, text=True).stdout.strip())
assert got == NF, f'webcam has {got} frames, expected {NF}'
save(os.path.join(d, 'av.json'), dict(total=round(total, 4), frames=got, starts=[round(v, 4) for v in starts]))
print(f'cam-edit.mp4 {got} frames = {got / FPS:.3f} s (narration {total:.3f} s + {TAIL / FPS:.0f} s of webcam after it), {len(SEGS) - 1} dissolves')
