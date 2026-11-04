# Gotchas

What still trips people up, after the scripts took care of the rest. Fixes the scripts already make (audio offset,
mastering latency, frame rounding, scene windows, click pulses, contact-sheet timing) are explained in comments in the
scripts themselves; don't undo them.

## Recording

- A 16:9 webcam frame scaled into a round bubble squashes the face. `probe.py` crops a square; check `still.jpg` (six
  frames across the take) and re-run with `--crop` if the face drifts off centre.

## Transcripts

- On a whole take, Whisper folds nearly every "um" into the next word, even with a filler prompt. That is why
  `transcribe.py` also transcribes 10-20 s clips (`transcript-disfl.json`), and `analyze.py` reads the energy trace
  for the rest. Trust the fillers-kept list from `edit.py`, not the cue sheet.
- Whisper's start for a word right after a pause can be up to 0.6 s early, and sometimes 0.4 s late. `Cues.word`
  snaps early starts to the voice onset; `Cues.show` prints every cue in context to catch the rest.
- Whisper can decode the same audio differently on another run. Keep the transcripts a decision was made from.

## Editing

- Removing a filler can take the end of the word before it ("whether it be, uh, people" lost "be" once). Splice-test
  every filler cut.
- `Cues.onset(t0)` raises when `t0` is inside a word. After any change to the edit, re-anchor the cues: positions from
  another edit are off by the time that edit removed.

## Captures

- Hide banners before measuring click targets, or every box is off by the banner's height.
- An app that scrolls inside a container captures only 900 px with a full-page screenshot; `tall` grows the viewport
  instead.
- Local instances show local details (a localhost MCP URL in a footer, a demo API key in a terminal). Frame around
  them, recapture, and have any exposed key revoked.

## HyperFrames

- Every `<video>` needs an id, or it renders frozen. Re-encode embedded screen recordings with `-g 15`: sparse
  keyframes stall seeks.
- Each snapshot call replaces `snapshots/`, and HyperFrames adds one frame of its own near the end.
