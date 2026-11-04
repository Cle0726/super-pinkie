# OpenSEO launch video

The worked example for the narrated-video skill: a 1:54 launch video for OpenSEO, cut from Ben's take "Launch take".
Six scenes over real screenshots of the app: the dashboard, competitor research, keyword ideas, "and much more" (the
site audit), agent setup with its Skills tab, and the OpenSEO card with the launch offer. The demo business is Veeza, an AI
visa assistant, chosen because its keywords read at a glance in English: "ai visa assistant"
gets 10 searches a month, "visa services" gets 2,400.

| File | What it is |
| --- | --- |
| `storyboard.json` | The cards Ben recorded against |
| `capture/agent-setup.mjs` | One of the capture scripts: the Agent setup page, its copied state and Skills tab, and the click targets |
| `edit.json` | The light edit: 4 cuts |
| `video.py` | The composition: scene starts and every cue from the cue sheet, and the choreography |
| `NOTES.md` | The edit notes: every cut and why, what was kept on purpose, the checks |

The recordings and the captures are not in this repo. With them in a work folder (`assets/` with the captures,
`Launch take.mov`), the whole video rebuilds with:

```sh
SK=<this skill>/scripts
uv run $SK/probe.py "Launch take.mov" takes/final --crop 720:720:240:0   # Ben sat about 40 px left of centre
uv run $SK/transcribe.py takes/final
cp $SK/../examples/openseo-launch/edit.json takes/final/
uv run $SK/edit.py takes/final && uv run $SK/build.py takes/final && uv run $SK/master.py takes/final
uv run $SK/cues.py takes/final
uv run --with numpy python $SK/../examples/openseo-launch/video.py
uv run $SK/render.py comp render
uv run $SK/composite.py comp takes/final comp/renders/openseo-launch-1080p.mp4
uv run $SK/check.py comp/renders/openseo-launch-1080p.mp4 comp takes/final
```
