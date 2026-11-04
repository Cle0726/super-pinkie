# /// script
# dependencies = ["librosa", "numpy", "soundfile"]
# ///
"""Find where a music track's hits are, to cut a video on them.

  uv run beats.py song.mp3                      # tempo, beat period, loudness per second, and every strong hit
  uv run beats.py song.mp3 50 65                # one range in detail: beats, hits, loudness every 0.25 s
  uv run beats.py song.mp3 --window 51.91 10    # the hits of a candidate clip, in video time (0 = clip start)

A hit is an onset at least --strength times the track's median onset strength (default 15): a drum hit, a stab, a
drop. Section hits in electronic or pop music are usually 2-8 beats apart; cut scenes on them and put small motion on
the beats between.
"""
import argparse

import librosa
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("song")
ap.add_argument("range", nargs="*", type=float, help="from to (seconds)")
ap.add_argument("--window", nargs=2, type=float, metavar=("START", "LENGTH"))
ap.add_argument("--strength", type=float, default=15.0)
a = ap.parse_args()

y, sr = librosa.load(a.song, sr=22050, mono=True)
dur = len(y) / sr
hop = 256
env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
times = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=hop)
onsets = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=hop, units="time")
med = float(np.median(env))
strength = {float(o): float(env[np.argmin(abs(times - o))] / med) for o in onsets}
hits = [o for o, s in strength.items() if s >= a.strength]
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop)[0]


def bar(t0, t1):
    m = rms[(times >= t0) & (times < t1)]
    return "#" * int((m.mean() if len(m) else 0) * 200)


if a.window:
    start, length = a.window
    print(f"clip {start:.2f}-{start + length:.2f} s of {dur:.2f} s; hits in video time (strength = x median onset):")
    for o in hits:
        if start <= o < start + length:
            print(f"  {o - start:6.2f}  ({o:.2f} in the song)  strength {strength[o]:.0f}")
    tail = rms[times >= start + length - 1].mean() if start + length <= dur else 0
    print(f"loudness over the clip's last second: {tail:.3f} (near 0 means the clip ends in silence)")
elif len(a.range) == 2:
    t0, t1 = a.range
    print("beats:", " ".join(f"{b:.3f}" for b in beats if t0 <= b <= t1))
    print("hits (onset, strength x median):")
    for o, s in strength.items():
        if t0 <= o <= t1 and s >= a.strength / 2:
            print(f"  {o:7.3f}  {s:5.1f}{'  <- hit' if s >= a.strength else ''}")
    for t in np.arange(t0, t1, 0.25):
        print(f"{t:7.2f} {bar(t, t + 0.25)}")
else:
    print(f"duration {dur:.2f} s, tempo {float(np.atleast_1d(tempo)[0]):.1f} BPM, "
          f"beat every {float(np.median(np.diff(beats))):.3f} s")
    for s in range(int(dur) + 1):
        print(f"{s:4d}s {bar(s, s + 1)}")
    print(f"hits ({len(hits)}):", " ".join(f"{o:.2f}" for o in hits))
