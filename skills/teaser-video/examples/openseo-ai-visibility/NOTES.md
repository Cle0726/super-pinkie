# Notes: OpenSEO AI visibility teaser

Seven rounds from first cut to delivery. Each entry is what the review asked for and what changed.

## v1: narrated-video's look, no narration (18.6 s)

The app in a floating browser window over a warm backdrop, the window tilting in. Beats: type the URL; the research
spinner (its real status messages, captured frame by frame with paused animations) as captions; the competitor rows
landing; a pan down the generated topics; a click on the tracking button; an end card. Labels in dark pills.

## v2: full-bleed, no spinner, a more engaging prompts beat (16.4 s)

- "Not in an app window": the app fills the frame.
- "Skip the spinner": the click cuts straight to the competitors.
- "The table animation is really good": kept.
- "Something more unique for the prompts": the page tips back in 3D and the list builds row by row with a counter in
  the caption ("15 prompts", one tick per landing row), then pulls back with all three topic headers lit ("3 topics").
  A first attempt that landed headers first and filled the gaps afterwards was too steep to read and mostly empty.
- Recaptured the tracker after the branch was found 4 commits behind its remote (the page had been redesigned).

## v3: under 10 s, dark mode, no numbers (10 s)

- "The numbers are not relevant": captions without counts; one pan over all the prompts.
- "Transition in like the first one": the page tips in from 3D instead of opening on the whole dashboard.
- "The app's dark mode palette, no orange": recaptured everything in dark mode; palette from the app's theme tokens.
- "Our real brand asset from the website": the end card uses openseo.so's own app icon.

## v4: slow and smooth (10 s)

- "Speeding up made the animations way too fast; no small quick camera movements, especially the cursor": every scene
  got its own single slow camera move and the scenes dissolve; the pointer kept one glide; the Continue and tracking
  clicks were cut instead of hurried.
- Closer on the prompts' text column, with the row step slowed so rows land inside the frame.
- End card: icon, name, URL, no slogan.

## v5: zoomed out a little, centred

- Form and competitor cards centred at zoom 1.6-1.75 (the least that centres them on a 1440 capture). The competitor
  card sits 42 CSS px high so the caption clears its buttons.
- Captions: "Enter your URL", "Monitor your AI visibility". The prompts pan unchanged ("keep that how it is").

## v6: music

- `bgm2.mp3` from 51.91 s to its end: a breakdown, a pickup at 1.25, the drop at 2.45 (on the click), hits at 4.35,
  6.24, 8.16, 8.86, and a final hit at 9.46. The last 10 s of the file would have ended in three seconds of silence.
- Scenes retimed onto the hits (see the README's table); rows land on half-beats; the logo blooms on the strongest hit
  and pulses on the final one. `verify-sync.py` measured every hit within 12 ms in the render.
- Caption: "Find competitors".

## v7: the first scene from a newer branch

- The setup screen had been redesigned on another branch ("Set up AI visibility", "Start research"). Captured only the
  form there (`capture-form.mjs`, no research run); its boxes matched, so nothing else changed.
- A 4K still for sharing: no frame of the video shows a lit topic with its prompts landed, so the still rendered the
  scene with every row in place and one header holding its highlight.

## Port to HyperFrames

The first seven rounds were built in Remotion. The teaser was then rebuilt as a HyperFrames composition
(`video/index.html` and `video/timeline.js`) with the same timing table, camera keys, row reveals, captions, and end
card. Differences:

- Eases are GSAP's named eases (`sine.inOut`, `expo.out`, `power2.inOut`) in place of the hand-tuned cubic-beziers;
  they are the same curves or very close to them.
- Zoom interpolates linearly rather than in log space; over the small pushes used here (1.6 to 1.75) the difference
  is under a pixel.
- The 4K still is now a 2x snapshot of a moment in the video. The custom state (every prompt landed, one header held
  lit) needs a copy of the project with its timing changed.
