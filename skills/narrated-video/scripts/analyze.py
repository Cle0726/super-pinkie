# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Find the edit candidates in a transcribed take: long pauses (with a ready-to-paste cut that keeps a natural pause),
# fillers, restarts (a phrase said again within a few seconds), sounds no transcript covers, and stretched words that
# may hide a filler. Also writes energy.npy (10 ms levels) for the other tools.
#   uv run analyze.py <take-dir> [--pause 1.0] [--keep 0.7]
# Candidates are leads, not decisions: check each on trace.py and splicetest.py before it goes into edit.json.
import argparse, os, re, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import close_gaps, energy, read_wav, runs, take, words

ap = argparse.ArgumentParser()
ap.add_argument('take_dir'); ap.add_argument('--pause', type=float, default=1.0, help='report pauses at least this long (s)')
ap.add_argument('--keep', type=float, default=0.7, help='pause the first suggested cut leaves (s)')
a = ap.parse_args()
d = a.take_dir; T = take(d)
x, sr = read_wav(os.path.join(d, 'take.wav'))
db = energy(x, sr); np.save(os.path.join(d, 'energy.npy'), db)
main, dis = words(os.path.join(d, 'transcript.json')), words(os.path.join(d, 'transcript-disfl.json'))
FILLER = re.compile(r"^(u+m+|u+h+|e+r+m+|h+m+|a+h+|m+)$")
norm = lambda w: re.sub(r"[^\w']", '', w.lower())
print(f"levels: floor {T['floor_db']} dB, p50 {np.percentile(db, 50):.1f}, p90 {np.percentile(db, 90):.1f}; speech above {T['voiced_db']} dB")

# A pause runs from the last sound of one word to the first sound of the next: speech is 20-35 dB above the room, so
# count only sound 15 dB above the floor (a breath, a lip click, or a word's fading tail counts as part of the pause).
speech = [(i / 100, j / 100) for i, j in runs(close_gaps(db > T['floor_db'] + 15, 25), 5)]
def before(t):   # the last word that starts before t (Whisper may stretch it over the pause)
    c = [w for w in main if w['start'] < t - 0.05]; return c[-1]['word'].strip() if c else '(start)'
def after(t):    # the first word that ends after t (Whisper may start it early, inside the pause)
    c = [w for w in main if w['end'] > t]; return c[0]['word'].strip() if c else '(end)'

print(f'\nPAUSES over {a.pause:.1f} s, last sound to next sound; the cut that keeps {a.keep:.1f} s, and 0.9 s for a scene change:')
for (s0, e0), (s1, e1) in zip(speech, speech[1:]):
    gap = s1 - e0
    if gap < a.pause: continue
    cut = lambda k: f'{e0 + k * 0.55:.2f}:{s1 - k * 0.45:.2f}'
    inside = [f'{e0 + i / 100:.2f}-{e0 + j / 100:.2f}' for i, j in runs(db[int(e0 * 100):int(s1 * 100)] > T['voiced_db'], 4)]
    print(f'  {e0:7.2f}-{s1:7.2f} {gap:4.2f}s  "{before(e0)}" | "{after(s1)}"   cut {cut(a.keep)}  or {cut(0.9)}'
          + (f'   (breath or click at {", ".join(inside)}: keep the cut edges out of it)' if inside else ''))

print('\nFILLERS (D = only the filler-prompted pass heard it):')
for w in dis:
    if not FILLER.match(norm(w['word'])): continue
    plain = any(FILLER.match(norm(m['word'])) and abs(m['start'] - w['start']) < 0.3 for m in main)
    ctx = ' '.join(m['word'].strip() for m in dis if w['start'] - 1.6 <= m['start'] <= w['end'] + 1.2)
    print(f"  {w['start']:7.2f}-{w['end']:7.2f} {'  ' if plain else 'D '} {w['word'].strip():6s}  ...{ctx}...")

print('\nRESTARTS (a phrase said again within a few seconds):')
toks = [(norm(w['word']), w['start']) for w in main if norm(w['word'])]
seen = set()
for n, span in ((4, 14.0), (3, 12.0), (2, 3.0)):
    for i in range(len(toks) - n + 1):
        g = tuple(t for t, _ in toks[i:i + n])
        hits = [toks[k][1] for k in range(i, len(toks) - n + 1) if tuple(t for t, _ in toks[k:k + n]) == g and toks[k][1] - toks[i][1] <= span]
        if len(hits) < 2 or any(h in seen for h in hits): continue
        seen.update(hits)
        print(f"  '{' '.join(g)}' at " + ', '.join(f'{h:.2f}' for h in hits))

print('\nSOUNDS NO TRANSCRIPT COVERS (>= 120 ms: hidden fillers, breaths, clicks):')
for i, j in runs(db > T['voiced_db'], 12):
    s, e = i / 100, j / 100
    if not any(min(e, w['end']) - max(s, w['start']) > 0.04 for w in main + dis):
        print(f'  {s:7.2f}-{e:7.2f} ({e - s:.2f}s) peak {db[i:j].max():.1f} dB   after "{before(s)}"')

print('\nSTRETCHED WORDS (>= 0.7 s; several voiced runs inside can be a hidden filler):')
for w in main:
    s, e = w['start'], w['end']
    if e - s < 0.7: continue
    i0 = int(s * 100); rr = runs(db[i0:int(e * 100)] > T['voiced_db'], 5)
    if len(rr) > 1:
        print(f"  {w['word'].strip():14s} {s:7.2f}-{e:7.2f}  runs " + '  '.join(f'{(i0 + i) / 100:.2f}-{(i0 + j) / 100:.2f}' for i, j in rr))
print(f'\nwrote energy.npy; take {T["duration"]} s')
