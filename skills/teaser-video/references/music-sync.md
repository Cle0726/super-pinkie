# Music sync

## Choose the clip

```sh
uv run $SK/beats.py song.mp3                     # tempo, loudness per second, every hit
uv run $SK/beats.py song.mp3 48 65               # a range in detail
uv run $SK/beats.py song.mp3 --window 51.91 10   # a candidate clip's hits in video time, and whether it ends silent
```

A good clip for a 10 s teaser:

- starts quiet (a breakdown or an intro) while the opening settles, then has a drop 2-3 s in, where the main click is;
- has section hits about every 1.5-2.5 s after that, for the scene changes;
- has its strongest hit about 1.8 s before the end for the logo, and ends on the song's own final hit ringing out.

"The last 10 s" is often wrong: the example song stops at 62 s of 64.9, so the literal last 10 s would have put three
seconds of silence under the end card. The clip used (51.91-61.91 s) is the song's ending section, starting in its
breakdown.

## Map the hits

Write the clip start into the `<audio>` element's `data-media-start` in `index.html` and the hit times (video time) into
`HIT` in `timeline.js`, and derive the timing table from them, so moving the clip moves everything:

| Hit | Use |
| --- | --- |
| A pickup before the drop | the pointer appears and starts its glide |
| The drop | the main click (pointer arrives 0.15 s before) and the cut to the next scene right after it |
| Half-beats after it | rows landing |
| A section hit | a scene dissolve starts on it |
| A later hit | a highlight lands on it (set the row step so that header's landing hits it) |
| The strongest hit | the logo blooms in (the card starts 0.1 s before) |
| The next hit | the URL lands |
| The final hit | one soft pulse on the logo |

A visual change reads as on the hit when it starts on it or within a frame or two; a dissolve or an ease-out lands its
most visible change in its first 0.1-0.2 s. Captions enter on beats.

## Audio

One `<audio>` element with `data-start="0"`, `data-duration` the video's length, and `data-media-start` the clip start
in the song (seconds). `data-fade-in="0.1"` (a clip that starts mid-sound clicks) and `data-fade-out="0.45"`.

## Verify

```sh
uv run $SK/verify-sync.py renders/video.mp4 1.25 2.45 4.35 6.24 8.16 9.46
```

It finds each planned hit in the render's own audio and reports its offset; every one should be within a frame. Check
the render, not the song: a wrong `data-media-start` or a rounding slip only shows up there. The check takes the
strongest onset within 80 ms of each planned time, so a hit reported about 50 ms off may be a smaller beat just before
it; listen there before moving anything.
