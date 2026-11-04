# Shared helpers for the narrated-video scripts: the take folder, wav I/O, the 10 ms energy trace, Whisper, edit lists.
#
# Times: every time in a take folder (transcripts, energy, edit.json, edl.json) is narration time, the audio stream's own
# clock. Recorders often start the audio a little after the video (QuickTime: 0.13-0.22 s); probe.py measures that
# offset once and only the webcam cut (build.py) and the sync check (check.py) apply it.
#
# Whisper: mlx-whisper on Apple Silicon, faster-whisper everywhere else (NV_WHISPER=faster forces it). Both run
# large-v3-turbo. The timing corrections in the scripts (clip-level transcripts, onset snapping) were measured on mlx.
import json, os, platform, shutil, subprocess, sys, wave
import numpy as np

SR, FPS = 48000, 30
# A prompt full of fillers makes Whisper write ums and restarts out as words instead of folding them into neighbours.
FILLER_PROMPT = "Umm, let me think like, hmm... Okay, here's what I'm, like, thinking. Uh, so, um."


def need(*tools):
    """Fail loudly when a command-line tool is missing (a script whose ffmpeg is missing can otherwise exit silently)."""
    missing = [t for t in tools if not shutil.which(t)]
    if missing:
        sys.exit(f'missing on PATH: {", ".join(missing)}. Install ffmpeg (https://ffmpeg.org/download.html, or your package manager).')


def ff(*args):
    need('ffmpeg')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *map(str, args)], check=True)


def ffprobe_json(path):
    need('ffprobe')
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def read_wav(path):
    w = wave.open(str(path))
    assert w.getnchannels() == 1 and w.getsampwidth() == 2, f'{path}: expected 16-bit mono'
    return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768.0, w.getframerate()


def write_wav(path, x, sr=SR):
    o = wave.open(str(path), 'wb'); o.setnchannels(1); o.setsampwidth(2); o.setframerate(sr)
    o.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()); o.close()


def energy(x, sr, hop_s=0.01):
    """RMS level in dB per hop (10 ms by default): the trace every cut is placed on."""
    hop = int(round(sr * hop_s)); fr = x[: len(x) // hop * hop].reshape(-1, hop)
    return 20 * np.log10(np.sqrt((fr ** 2).mean(axis=1)) + 1e-9)


def load(path): return json.load(open(path))
def save(path, obj): json.dump(obj, open(path, 'w'), indent=1)


def take(d):
    """The take folder's settings written by probe.py."""
    p = os.path.join(d, 'take.json')
    if not os.path.exists(p): sys.exit(f'{p} not found: run probe.py first')
    return load(p)


def words(path):
    """Flat word list [{word, start, end}] from a Whisper transcript json."""
    return [dict(word=w['word'], start=w['start'], end=w['end']) for s in load(path)['segments'] for w in s['words']]


MLX = sys.platform == 'darwin' and platform.machine() == 'arm64' and os.environ.get('NV_WHISPER') != 'faster'
_model = None


def transcribe(path, prompt=None, word_timestamps=True, language='en'):
    """Whisper on a wav, as {text, segments: [{start, end, text, words: [{word, start, end}]}]}."""
    global _model
    if MLX:
        import mlx_whisper
        return mlx_whisper.transcribe(str(path), path_or_hf_repo='mlx-community/whisper-large-v3-turbo', word_timestamps=word_timestamps,
                                      initial_prompt=prompt, condition_on_previous_text=False, language=language)
    from faster_whisper import WhisperModel
    if _model is None: _model = WhisperModel('large-v3-turbo', device='auto', compute_type='auto')   # loaded once: it runs per clip
    need('ffmpeg')   # decode with ffmpeg: faster-whisper's own decoder (PyAV) breaks across versions
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    segs, _ = _model.transcribe(np.frombuffer(pcm, np.float32), word_timestamps=word_timestamps, initial_prompt=prompt, condition_on_previous_text=False, language=language)
    out = [dict(start=s.start, end=s.end, text=s.text, words=[dict(word=w.word, start=w.start, end=w.end) for w in s.words or []]) for s in segs]
    return dict(text=''.join(s['text'] for s in out), segments=out)


def runs(mask, min_len=1):
    """(start, end) index pairs of the True runs in a boolean array."""
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]: j += 1
            if j - i >= min_len: out.append((i, j))
            i = j
        else: i += 1
    return out


def close_gaps(mask, max_gap):
    """Fill False gaps of at most max_gap frames between True runs (joins a word's syllables into one run)."""
    m = mask.copy()
    for a, b in runs(~m):
        if a > 0 and b < len(m) and b - a <= max_gap: m[a:b] = True
    return m


# An edit list (edl.json "segs") is the kept stretches of the take in order: ['a', start, end] in narration time.
def seg_len(seg): return seg[2] - seg[1]


def seg_starts(segs):
    """Edited-time start of each edit-list segment."""
    out, t = [], 0.0
    for s in segs: out.append(t); t += seg_len(s)
    return out, t


def to_edited(segs, t):
    """Narration time -> edited time; a time inside a removed stretch maps to the next kept audio."""
    starts, total = seg_starts(segs)
    for s, e0 in zip(segs, starts):
        if s[1] - 0.001 <= t <= s[2] + 0.001: return round(e0 + (t - s[1]), 3)
    nxt = [e0 for s, e0 in zip(segs, starts) if s[1] > t]
    return round(nxt[0], 3) if nxt else round(total, 3)


def clip_bounds(quiet, total, short=10.0, long=20.0):
    """Split points for transcribing in clips: the longest pause (a run of `quiet` 10 ms frames of at least 0.25 s)
    10-20 s into each clip. Whisper writes fillers out, and keeps word times within ~0.1 s, on clips this short; on a
    whole file it folds ums into the next word and its times drift by 0.3-0.6 s after the first minute."""
    pauses = [((i + j) / 200, (j - i) / 100) for i, j in runs(quiet, 25)]
    bounds, t = [0.0], 0.0
    while total - t > long:
        c = [p for p in pauses if t + short <= p[0] <= t + long] or [p for p in pauses if t + 6 <= p[0] <= t + 26]
        t = max(c, key=lambda p: p[1])[0] if c else t + long
        bounds.append(round(t, 2))
    return bounds + [round(total, 3)]


def transcribe_clips(wav, bounds, tmp, prompt=None, language='en', show=True):
    """Transcribe a wav clip by clip; word times come back on the whole file's clock, as one Whisper-style result."""
    os.makedirs(tmp, exist_ok=True)
    out = []
    for a, b in zip(bounds, bounds[1:]):
        f = os.path.join(tmp, f'{a:.2f}.wav')
        ff('-ss', a, '-to', b, '-i', wav, f)
        r = transcribe(f, prompt, language=language)
        ws = [dict(word=w['word'], start=round(w['start'] + a, 3), end=round(w['end'] + a, 3)) for s in r['segments'] for w in s['words']]
        out.append(dict(start=a, end=b, text=' '.join(w['word'].strip() for w in ws), words=ws))
        if show: print(f'{a:7.2f}-{b:7.2f}: ' + ' '.join(f"{w['word'].strip()}[{w['start']:.2f}]" for w in ws))
    return dict(segments=out)
