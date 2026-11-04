# Verification

Nothing goes to the person before these pass.

## check.py

`uv run $SK/check.py <final.mp4> comp takes/<name>`:

- window: every frame has the app window until it leaves for the end card. A missing frame is a flicker. Scene
  windows written by `C.timing` prevent it; a hand-edited `data-start` causes it.
- webcam: every sampled point shows the source frame the edit list says, `{0: N}`. An offset of +-1 frame means the
  webcam cut does not match the audio cut (build.py picks each piece's source frame from its edited position; don't
  change that).
- audio: the median offset against the source narration is 0 ms. Points taken in a pause are re-measured with a
  longer window; only a voiced point that stays off is real.
- loudness: about -16 LUFS integrated. The master's true peak is -1.5 dBFS; the AAC encode lifts it to about -1.

## The words

`edit.py` prints the edited narration and the fillers kept; `cues.py` prints the final narration clip by clip. Read
both: no clipped first or last syllable at a cut, no doubled word at a restart. Whisper drops some fillers even on
short clips, so the cue sheet is not a filler check: the fillers-kept list from `edit.py` (from the take's filler pass)
is the one to trust.

## The frames

- `filmstrip.py` (a frame every 4 s, labelled with its own time) for the whole shape: pacing, labels, the end card.
- Snapshots or a finer filmstrip (`filmstrip.py <video> out.png --start 84 --duration 16 --step 1`) across each scene with clicks and typing:
  the pointer on its target when the word is said, the zoom landing, the label clear of the data.
- The first frame is a clean poster; the end card holds after the last word.

## Delivering

Give the path, the length, the cuts (and anything kept on purpose), the checks, and anything to
listen for. Add the video's section to NOTES.md with the rebuild commands.
