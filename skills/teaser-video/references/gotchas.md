# Gotchas

What cost time on the first teaser.

## HyperFrames and CSS

- Lint reads the HTML, not the page after its scripts run: media (`<audio>`, `<video>`) must be written in the HTML
  with its `src` and timing attributes, or lint reports it missing and the render is silent. Scenes, images, and
  their timing can be built by script, as long as it runs synchronously before the timeline is registered.
- No fetches in a composition, so `boxes.json` cannot be loaded at render time; paste the boxes into `timeline.js`.
- ffmpeg must be on PATH for `snapshot` and `render`, not only for the Python tools.
- Render UI with PNG frames (`--video-frame-format png`) and `--experimental-fast-capture=false`; JPEG frames smear
  small text.
- `filter` other than `none` and `opacity` below 1 flatten `preserve-3d`. Keep 3D inside one element (the camera),
  and set a blur back to `none` once it has cleared rather than leaving `blur(0px)`.
- GSAP writes `x, y, rotation, rotationX, scale` into one transform in that order; a different order (scale before the
  tilt) tips the page about the wrong point. A camera made of nested elements keeps each layer to one job.

## Captures

- Check that the product's branch or worktree is not behind its remote before capturing; the page you capture may
  already have been redesigned.
- A production build or preview server of the product can regenerate tracked files (TanStack Router's
  `routeTree.gen.ts` reorders itself); restore them afterwards so the person's working tree stays clean.
- A dev server that fails to start (a dependency optimizer error) is not worth fixing for a capture: build and use the
  preview server.
- A capture script that waits for a URL change must compare against the URL before the action; a redirect to an
  existing project matches a loose pattern immediately.
- Text that renders capitalised by CSS (`text-transform`) or split across nodes does not match `getByText` with the
  displayed text; measure a nearby element instead.

## Editing

- An edit interrupted mid-tool-call may have been applied anyway. Grep for the change before running it again, and
  write scripted edits so a second run is a no-op (replace exact text, assert counts); a blind re-run duplicated an
  import, a constant, and the audio element.
- Re-snapshot after every change and look at the contact sheet; a camera key that is off by one scene shows up there
  in seconds.
