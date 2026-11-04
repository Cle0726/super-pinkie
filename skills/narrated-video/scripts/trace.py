# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
# Look closely at a stretch before placing a cut. The default view has two rows of digits per half second under a row
# of times (one per 10 ms group): level (E, 0-9 from the noise floor up 30 dB) and brightness (C, spectral centroid
# 0-9 over 0-4 kHz; '.' is silence), with the transcripts' word boundaries underneath. Room tone is E 0-1 with dots,
# vowels are dark (C 1-3), "s" and "sh" bright (C 6-9). --fine prints 5 ms rows of dB and centroid, to split two
# sounds that run together. --edited traces the cut narration (edited time) against the cue sheet instead.
#   uv run trace.py <take-dir> 41.0:42.5 [58.5:60.0 ...] [--fine] [--edited]
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import energy, load, read_wav, take, words

d = sys.argv[1]; fine, edited = '--fine' in sys.argv, '--edited' in sys.argv; T = take(d)
x, sr = read_wav(os.path.join(d, 'narration-edit.wav' if edited else 'take.wav'))
passes = [('W', load(os.path.join(d, 'words.json'))['words'])] if edited else \
         [('D', words(os.path.join(d, 'transcript-disfl.json'))), ('M', words(os.path.join(d, 'transcript.json')))]
def centroid(seg):
    mag = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 512)); f = np.fft.rfftfreq(512, 1 / sr)
    return (mag * f).sum() / (mag.sum() + 1e-9)
for arg in (s for s in sys.argv[2:] if ':' in s):
    a, b = map(float, arg.split(':'))
    print(f'=== {a:.2f}-{b:.2f}' + (' (edited time)' if edited else ''))
    if fine:
        hop = sr // 200
        for i in range(int(a * 200), int(b * 200)):
            seg = x[i * hop:(i + 1) * hop]; lv = 20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9)
            print(f'{i / 200:8.3f} {lv:6.1f} {centroid(seg):6.0f} ' + '#' * int(max(0, lv - T['floor_db'] + 3) / 2))
    else:
        hop = sr // 100; db = energy(x, sr); i0, i1 = int(round(a * 100)), int(round(b * 100))
        E = ''.join(str(int(np.clip((db[i] - T['floor_db']) / 3.4, 0, 9))) for i in range(i0, i1))
        C = ''.join(str(int(np.clip(centroid(x[i * hop:(i + 1) * hop]) / 444, 0, 9))) if db[i] > T['voiced_db'] else '.' for i in range(i0, i1))
        for k in range(0, i1 - i0, 50):
            print('          ' + ' '.join(f'{(i0 + k + j) / 100:<10.2f}' for j in range(0, min(50, i1 - i0 - k), 10)))
            print('       E  ' + ' '.join(E[k:k + 50][j:j + 10] for j in range(0, 50, 10)))
            print('       C  ' + ' '.join(C[k:k + 50][j:j + 10] for j in range(0, 50, 10)))
    for tag, ws in passes:
        print(f'  {tag}:', '  '.join(f"{w['word'].strip()}[{w['start']:.2f}-{w['end']:.2f}]" for w in ws if w['end'] > a and w['start'] < b))
