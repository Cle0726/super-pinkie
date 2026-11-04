# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "mlx-whisper; sys_platform == 'darwin' and platform_machine == 'arm64'",
#                 "faster-whisper; sys_platform != 'darwin' or platform_machine != 'arm64'"]
# ///
# The cue sheet: word times of the finished narration, for timing every scene, click and keystroke to what is said.
#   uv run cues.py <take-dir>        -> words.json (the final narration transcribed in 10-20 s clips cut at pauses)
# In a composition script:
#   from cues import Cues
#   cu = Cues(TAKE)
#   cu.word('copy', after=40.0)   start of the first "copy" at or after 40 s (edited time). Mid-phrase, Whisper is good to
#                                 about 0.1 s; a word right after a pause it starts up to 0.6 s early, so when the word's
#                                 start falls in silence it is moved to the voice onset (snap=False keeps Whisper's time)
#   cu.onset(t0)                  the first sustained voice at or after t0, which must be inside the pause before the word
#   cu.cuts                       edited time of each cut (where a scene can start so the webcam jump hides in it)
#   cu.show(A)                    every cue with the words around it: read it after any change to the edit
import os, re, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FILLER_PROMPT, clip_bounds, energy, load, read_wav, save, seg_starts, take, transcribe_clips


class Cues:
    def __init__(self, take_dir):
        self.T = take(take_dir)
        self.words = load(os.path.join(take_dir, 'words.json'))['words']
        x, sr = read_wav(os.path.join(take_dir, 'narration-edit.wav'))   # before mastering: levels match take.json
        self.db = energy(x, sr)
        edl = load(os.path.join(take_dir, 'edl.json'))
        starts, self.total = seg_starts(edl['segs'])
        self.cuts = [round(s, 3) for s in starts[1:]]

    def level_at(self, a, b):
        return self.db[max(0, int(round(a * 100))):int(round(b * 100))]

    def near(self, t, n=3):
        k = min(range(len(self.words)), key=lambda j: abs(self.words[j]['start'] - t))
        return ' '.join(f"{w['word'].strip()}[{w['start']:.2f}]" for w in self.words[max(0, k - n):k + n + 1])

    def word(self, text, after=0.0, snap=True):
        norm = lambda w: re.sub(r"[^\w']", '', w.lower())
        hits = [w['start'] for w in self.words if norm(w['word']) == norm(text) and w['start'] >= after]
        assert hits, f'no "{text}" at or after {after}'
        t = min(hits)
        return self.onset(t) if snap and (self.level_at(t, t + 0.05) < self.T['peak_db']).all() else t

    def onset(self, t0, level=None, hold=0.05):
        level = self.T['peak_db'] if level is None else level
        if (self.level_at(t0 - 0.05, t0 + 0.05) >= level).all():   # the voice is already on: t0 is inside a word
            raise ValueError(f'onset({t0}) starts inside speech ({self.near(t0)}): pass a time in the pause before the word')
        i, n = int(round(t0 * 100)), int(round(hold * 100))
        while not (self.db[i:i + n] >= level).all():
            i += 1
            assert i < len(self.db), f'no voice after {t0}'
        return i / 100

    def show(self, A):
        for k, v in A.items(): print(f'  {k:16s} {v:8.2f}   {self.near(v)}')


if __name__ == '__main__':
    d = sys.argv[1]; T = take(d); wav = os.path.join(d, 'narration.wav')
    x, sr = read_wav(wav); db = energy(x, sr)
    r = transcribe_clips(wav, clip_bounds(db < np.percentile(db, 10) + 8, len(x) / sr), os.path.join(d, 'cueclips'), FILLER_PROMPT, T.get('language', 'en'))
    save(os.path.join(d, 'words.json'), dict(clips=[[s['start'], s['end']] for s in r['segments']], words=[w for s in r['segments'] for w in s['words']]))
