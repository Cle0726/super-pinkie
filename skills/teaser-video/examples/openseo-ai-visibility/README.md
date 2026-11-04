# OpenSEO AI visibility teaser

The worked example for the teaser-video skill: a 10 s, no-narration teaser for OpenSEO's AI visibility setup, in the
app's dark mode, cut to the end of a music track. The demo site is linear.app, chosen because its competitors (Jira,
Shortcut, Asana, Plane) are recognisable from their favicons.

| Time | Scene | Caption | Music |
| --- | --- | --- | --- |
| 0-2.6 s | The setup page tips in from 3D onto the form; `linear.app` types out; the pointer glides to Start research | Enter your URL | breakdown, pickup at 1.25, drop on the click at 2.45 |
| 2.55-4.9 s | The competitor table, its rows landing on half-beats | Find competitors | |
| 4.35-7.9 s | The generated tracker tipped back in 3D, close on the prompts, panning as rows land; a topic header lights up | Monitor your AI visibility | dissolve on the hit at 4.35, second header on 6.24 |
| 7.9-10 s | End card: the OpenSEO icon, name, URL | | logo on 8.16, URL on 8.86, pulse on the final hit at 9.46 |

| File | What it is |
| --- | --- |
| `capture/capture-setup.mjs` | A fresh project's setup form with typing frames, a real research run, the competitor review, and the boxes for each row |
| `capture/capture-topics.mjs` | The generated tracker as a 2400 px tall capture, with each topic header, prompt, and the tracking button |
| `capture/capture-form.mjs` | The form alone, to re-capture the first scene from a branch with a newer setup screen |
| `video/index.html` | The HyperFrames composition: builds every scene from the timing table and holds the music `<audio>` element |
| `video/timeline.js` | The timing table: every time, caption, colour, capture, measured box, and camera key |
| `NOTES.md` | The seven review rounds: what changed in each and why |

The captures, the brand icon, and the music are not in this repo. With them in `video/assets/` (`dark/form-01..11.png`,
`dark/review.png`, `dark/topics-tall.png`, `brand-icon.png` from openseo.so, `bgm2.mp3`), the video rebuilds with:

```sh
SK=<this skill>/scripts
# captures: a local OpenSEO in no-auth mode on :4891 (the research run spends a little usage credit)
cd <open-seo checkout>
COLOR=dark OUT=<work>/assets/dark node $SK/../examples/openseo-ai-visibility/capture/capture-setup.mjs
COLOR=dark OUT=<work>/assets/dark PROJECT_ID=<printed above> node $SK/../examples/openseo-ai-visibility/capture/capture-topics.mjs
# video (copy the boxes you use from assets/dark/boxes.json into timeline.js)
cd <work>/video
npx --yes hyperframes@0.8.62 lint
npx --yes hyperframes@0.8.62 render -o renders/teaser.mp4 --fps 60 --crf 14 --video-frame-format png --experimental-fast-capture=false
uv run $SK/verify-sync.py renders/teaser.mp4 1.25 2.45 4.35 6.24 8.16 9.46
npx --yes hyperframes@0.8.62 snapshot --at 7.3 --no-end --zoom 0,0,1920,1080 --zoom-scale 2 -o stills   # a 4K still
```
