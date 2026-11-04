# Editing the take

## Time

Every time in a take folder (transcripts, energy.npy, edit.json, edl.json) is narration time, the audio stream's own
clock. Recorders often start the audio a little after the video (QuickTime: 0.13-0.22 s); `probe.py` measures that offset once and only the
webcam cut and the sync check apply it. Edited time (after cuts) is what the composition uses; `edit.py` prints it.

## Light by default

Most people sound best edited lightly, and every audio cut is also a jump in the webcam bubble, so over-editing is
visible as well as audible. The default:

- Keep ums, uhs, and short hesitations inside flowing speech. Keep every pause up to about 1.1 s.
- Cut false starts and restarts: the first attempt of a sentence said twice, an abandoned sentence.
- Trim dead air: a pause over ~1.1 s keeps 0.7 s, or 0.9 s at a scene change.
- A mid-scene trim is also a jump in the bubble (`build.py` softens it with a 4-frame dissolve): place it where
  `jump.py --slide` scores lowest, and if nothing scores under about 6, leave the pause.
- A filler inside a long silence can go with the silence ("So, uh" before "Thanks"), when keeping it would read as a
  false start.
- Nothing else, unless the video is over its length cap: then trim the longest remaining pauses first, then the most
  distracting fillers.

## Fewer fillers (when asked)

For "take out some of my ums, without making it choppy". On top of the light edit:

- Remove an um or uh that stands alone between phrases, with room tone on both sides, and a filler that sits next to
  a pause ("Um. And then" -> "And then").
- Leave a filler glued to the next or previous word ("Um, so you can see", "volume, uh, because"): cutting it clips
  that word. Leave mid-sentence self-corrections too ("example to, uh... for you to"). Expect to remove 60-80% of the
  ums, not all; when in doubt, leave it.
- Trim pauses over ~0.8 s to about 0.55 s. Don't shorten comma pauses below about 0.3 s: the pace starts to rush.
- Splice-test every cut: a removed filler can take the end of the word before it with it.
- With many more cuts, most won't land on a picture change. `build.py` dissolves the bubble over 4 frames at every
  cut; where the person moved a lot during the removed filler, the dissolve can still show, so mention it.

## Finding the cuts

`analyze.py` lists the leads:

- PAUSES over 1 s, measured from the last sound of one word to the first sound of the next (a breath or a lip click
  in between counts as pause, and is listed so the cut's edges stay out of it), with the cuts that keep 0.7 s and
  0.9 s ready to paste.
- FILLERS from the clip-level, filler-prompted transcript, in context. D marks one only that pass heard.
- RESTARTS: a phrase said again within a few seconds. A cluster of them plus a long pause is a restart: find where the
  kept attempt begins and cut from the end of the last clean sentence before it.
- SOUNDS NO TRANSCRIPT COVERS: breaths, clicks, and fillers the transcripts dropped.
- STRETCHED WORDS: a word Whisper stretched over 0.7 s with separate voiced runs inside often hides an "um".

## Placing a cut

`trace.py <take> a:b` shows level (E) and brightness (C) every 10 ms with both transcripts' words. Room tone is E at
0-1 with C as dots; vowels are dark (C 1-3), "s" and "sh" bright (C 6-9). `--fine` gives 5 ms rows in dB and Hz to split
two sounds that run together.

- Put both ends of a cut in room tone, so it is a plain crossfade of silence and needs no pad.
- A restart cut starts in the silence after the last clean sentence and ends in the silence before the kept attempt,
  so the pause that remains follows the pause rule (0.7 s; 0.9 s when a new scene starts there). Put it on the scene
  change when the kept attempt opens a scene.
- Lip clicks and breaths at a cut edge: keep them outside the kept audio.
- `splicetest.py` joins the kept ranges and transcribes the result with and without the filler prompt. Both must read
  as the intended sentence, with nothing clipped. It widens the first and last range to the nearest phrase boundary,
  because Whisper drops words from a clip that starts or ends mid-phrase.
- `jump.py` scores the webcam jump at a cut (the mean frame difference either side; under ~6 is hard to see). With
  `--slide 0.3` it finds where in the pause the same cut jumps least. Cuts on scene changes need no score: the picture
  cut hides them.

## edit.json

```json
{"start": 1.90, "end": 118.40,
 "cuts": [[14.32, 14.86, "dead air after the opening sentence (1.24 s -> 0.70 s)"],
          [52.10, 61.35, "restart of the pricing section: the first attempt stops mid-sentence; the second is kept"]]}
```

Start just before the first real word (after any false start of the opening); end after the last word's decay. Write
why for each cut: it goes into NOTES.md and makes the next round easy.

## After edit.py

Read the whole edited narration it prints, sentence by sentence: it is what the viewer hears. It comes from the
clip-level transcript; a word marked `*` crosses a cut edge there (Whisper often stretches a word over the pause next
to it), so check that cut on the trace or with a splice test. The last line lists the fillers kept, in edited time:
the things to mention when handing the video over. Then `build.py`
(narration and webcam, sample- and frame-exact) and `master.py` (-16 LUFS). Record every cut and its reason in NOTES.md.
