# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "mlx-whisper; sys_platform == 'darwin' and platform_machine == 'arm64'",
#                 "faster-whisper; sys_platform != 'darwin' or platform_machine != 'arm64'"]
# ///
# Two word-timestamped transcripts of a take:
#   transcript.json        the whole take in one pass: clean sentences and punctuation, for reading the take
#   transcript-disfl.json  the take in 10-20 s clips cut at pauses, prompted to write fillers and restarts out as words
#                          (on the whole file Whisper folds nearly every "um" into the next word)
#   uv run transcribe.py <take-dir>
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FILLER_PROMPT, clip_bounds, energy, read_wav, save, take, transcribe, transcribe_clips

d = sys.argv[1]; T = take(d); wav = os.path.join(d, 'take.wav'); lang = T.get('language', 'en')
t = time.time()
r = transcribe(wav, None, language=lang)
save(os.path.join(d, 'transcript.json'), r)
print(f"transcript.json: {sum(len(s['words']) for s in r['segments'])} words in {time.time() - t:.0f} s")
for s in r['segments']: print(f"{s['start']:7.2f}  {s['text'].strip()}")
x, sr = read_wav(wav)
t = time.time()
dr = transcribe_clips(wav, clip_bounds(energy(x, sr) < T['voiced_db'], len(x) / sr), os.path.join(d, 'clips'), FILLER_PROMPT, lang, show=False)
save(os.path.join(d, 'transcript-disfl.json'), dr)
print(f"transcript-disfl.json: {sum(len(s['words']) for s in dr['segments'])} words in {len(dr['segments'])} clips, {time.time() - t:.0f} s")
