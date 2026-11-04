# Composition

The video is a HyperFrames composition: one HTML page with one paused GSAP timeline, rendered frame by frame. A
per-video script (`video.py`) builds it with `scripts/compose.py`; start from [the worked example](../examples/openseo-launch/video.py).

## The script

1. Cue times. `Cues(take)` reads the cue sheet (`cues.py` output) and the edit list:
   - `word(text, after)`: start of the first matching word at or after a time. Mid-phrase, Whisper is good to about
     0.1 s; a word right after a pause it starts up to 0.6 s early, so when that start falls in silence `word` moves it
     to the voice onset (`snap=False` keeps Whisper's time). Late starts happen too (a name 0.4 s late once). The cue
     sheet writes numbers as spoken ("2" ",000"), and names as Whisper heard them ("GrokBot").
   - `onset(t0)`: the exact first voiced 50 ms at or after `t0`, which must sit in the pause before the word; it raises
     an error when `t0` is inside speech. Use it for scene starts and anything that must hit a word's first sound.
   - `cuts`: edited times where the narration was cut.
   - `show(A)`: prints every cue with the words around it. Read it after every change to the edit: a cue on the wrong
     word shows up there, and nowhere else until the render.
2. Scene starts. A scene starts 0.3 s before its first word (`onset(...) - 0.3`). Where a cut sits in the pause before
   the scene, start exactly on the cut, so the webcam jump lands on the picture cut. `C.timing(starts, total)` turns
   the starts into frame-exact windows. Set `total` to the last word plus about 1.8 s, and hold the end card at least
   1.5 s after the last word.
3. Scenes. `C.scene(k, T, C.canvas(k, layers...), labels, url)`. Each layer is a `C.camera(outer, inner, images)` over
   1440-wide captures: one image, a stack of states or typing frames, or a tall capture (`tall=2400`). Layers after
   the first start hidden (`hidden=True`) and are revealed by the timeline. Add `C.backdrop(T, image)` first,
   `C.end_card(T, image)` and `C.cam_slot(T)` last.
4. The choreography: JavaScript using the template's helpers, with `A` (cues), `S`/`E(k)` (scene start and end), and
   any constants passed in `consts`.
5. `C.write('comp', T, secs, consts=..., choreo=..., assets=..., title=...)` writes `comp/`.

Run it from the work folder as `NV_SCRIPTS=$SK ASSETS=assets uv run --with numpy python video.py`: `NV_SCRIPTS` points
it at this skill's scripts, `ASSETS` at the captures, and `TAKE` (default `takes/final`) at the take folder.

## Helpers (times in seconds, boxes in capture CSS px [x, y, w, h])

- Camera: `setFrame(outer, inner, box, maxScale, imgH)` frames a box at time 0 of the layer; `moveTo(outer, inner, box,
  at, dur, ease, maxScale, imgH)` animates to it. The camera clamps so no blank edge shows and never zooms below 1.
  Pass `imgH` for tall captures.
- `drift(inner, px, at, dur, axis)`: a slow 10-25 px pan after a move. It is not clamped: use it only when the camera
  is zoomed in by more than the drift, or a blank edge shows. At full frame, let the pointer carry the motion.
- Pointer: `cAt(inner, x, y, at)` places it; `cShow`/`cOn`/`cHide`; `cMove(inner, x, y, at, dur)` moves it on a slightly
  bowed path; `cClick(inner, x, y, at)` presses it and drops the click pulse. Pulses are drawn in the scene's overlay,
  above every layer, so a page that fades in right after the click cannot cover them.
- States and typing: `showFrame('#inner-3', at)` shows image 3 of a stack; `typeFrames(inner, from, to, at, per)` steps
  through typing frames every `per` seconds (0.05-0.06 reads as brisk typing).
- Layers and scenes: `show(sel, at, dur)`, `hide(...)`, `fadeIn(sel, at)`; `out(k)` fades the window to white at the
  scene's end.
- `label(sel, at, until)`: the caption card for a beat.

## Timing the choreography to the words

- Every action lands on the word that names it: the click at the word's start (`cClick(..., A.setup_copy)`), the
  pointer arriving 0.3-0.5 s before, the typing starting as the query is spoken, the zoom onto a number as it is said.
- Cut into the next scene through its own trigger: the click on "Explore competitor" at the end of one scene, the
  results page as the next.
- Things listed aloud get visited in the order they are said (agents named, skills recommended).
- Labels enter 0.3 s after their scene starts and leave before the next beat's label.

## Timing rules the tools handle (don't hand-write these)

- HyperFrames shows an element while start <= t < start + duration, and a video's frame is floor((t - start) * fps).
  `C.timing` writes every window half a frame before the scene's first frame: boundaries written on frame instants
  leave frames in no scene (the backdrop flashes through) or in two.
- A relative tween (`'-=16'`) must not start while another tween writes the same property. `drift` starts 0.05 s late
  and ends 0.1 s early for this (lint: gsap_relative_value_second_writer).
- Lint must report 0 errors. Expected: `video_nested_in_timed_element` (errors, for scenes with screen recordings),
  `nested_structure_needs_subcomposition` (a warning per scene), and `duplicate_media_discovery_risk` (a warning when
  two scenes use the same capture).

## Look before rendering

`render.py comp snapshot <times>` renders chosen frames and contact sheets in seconds (each call replaces
`snapshots/`; HyperFrames adds one frame of its own near the end). Snapshot every scene start,
every click, and every label entry, and open them: the pointer on its target, the zoom landing on the data, no label
covering the number being said, no cropped text at the frame edge.
