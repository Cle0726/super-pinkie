# Composition

The video is a HyperFrames composition at 1920x1080, 60 fps: one HTML page driven by one paused GSAP timeline, which
HyperFrames seeks frame by frame and records. It is built from the worked example
([examples/openseo-ai-visibility/video](../examples/openseo-ai-visibility/video)), two files with no build step:

- `timeline.js`: everything timed or tuned. The hit times, the timing table `T`, captions, palette `C`, capture paths
  and heights, the measured boxes `B`, the rows that land, each scene's camera keys, the pointer, the end card. Change
  the video here.
- `index.html`: the stage. It builds the DOM from `timeline.js` (a glow, one `<section>` per screen with its capture
  and rows, the pointer, captions, the end card) and adds every tween to the timeline. The music is the `<audio>`
  element in it: HyperFrames reads media from the HTML (`data-media-start` is the clip start in the song,
  `data-fade-in`/`data-fade-out` the edges), not from script.

HyperFrames' own rules apply: motion only on the registered timeline (no CSS transitions or animations, no timers, no
`Date.now()` or random numbers, no fetches), `data-start` and `data-duration` on every timed layer, and lint at 0
errors. The boxes are pasted into `timeline.js` rather than read from `boxes.json`, because a composition may not
fetch. The numbers below are what worked; start from them.

## Scenes and cameras

Each screen is a `<section class="clip scene">` shown from its start until the next scene has fully dissolved in, with
`perspective: 2600px`. Inside it, `.cam` is the camera: GSAP's `x, y` put it at the frame centre and `rotation`,
`rotationX`, `scale` are the roll, tilt back, and zoom (GSAP writes them in that order, so the transform is
`translate(centre) rotateZ(roll) rotateX(tilt) scale(z)`); the `.page` inside it is shifted by minus the focus point.
The page tilts about the point the camera looks at. Camera keys are `{ t, x, y, z, tilt, roll, ease }`: the capture
point (CSS px) at the frame centre, the zoom, the angles in degrees, and the GSAP ease into the key.

A scene starts with a dissolve over the previous one (0.55 s, opacity plus a blur that clears), so two scenes move with
their own cameras during the hand-over and nothing travels between them.

- One move per scene, the length of the scene: e.g. zoom 1.6 to 1.72 over 2.3 s. Ease with `sine.inOut`; `expo.out`
  only for the opening settle.
- While the page is flat, each key is clamped so no edge of the capture shows; the clamp blends out as the tilt grows
  (fully off by 4 degrees) so a tipped-back page can float over the background. On a 1440-wide capture shown at 1920,
  the zoom must be at least 1.6 to centre x = 840 (a card in the content area); below that the clamp pushes the focus
  off centre.
- Captions sit 84 px from the bottom, so frame a tall card about 40 CSS px high to keep its buttons clear.

## Typing

The typing frames are a stack of images; keystroke frame i is shown at `typeStart + i * typePer` (0.07 s). The URL
types out in 0.7 s while the camera settles.

## Rows that land

The scene's page holds its capture, then (until the last row lands) a mask in the table's own colour over the rows'
area, then each row as a crop of the same capture at its own box: a `div` with `overflow: hidden` holding the full
image offset by the box. Each crop goes from opacity 0 and 16-30 px low to its place over 0.7 s with `expo.out`,
staggered (0.186 s, half a beat, in the example). Once all have landed the mask comes off and the frame is the
capture. Topic headers in a list can flash the primary colour as they land (a gradient and a 4 px inset bar, fading
over 1 s).

## A list tipped back in 3D

The longest scene: the tall capture tipped back (tilt 13-16, roll -2 to -3), close on the text column (zoom
1.75-1.85, x on the text rather than the page centre), panning slowly down (about 600 CSS px over 5.6 s) while rows
land in reading order. Match the row step to the pan so rows keep landing inside the frame: rows run ahead of a
camera that moves slower than they do, and anything landing below the frame is wasted. With an 85-93 px row and that
pan, a step of about 0.26 s keeps the landing row in view for the first half of the list; past that the camera shows
a finished list, which is fine. Cut off the rest of the list rather than speeding up.

## Pointer

It lives on the form scene's page, in capture px, so it follows the camera, and it is counter-scaled by the zoom
(read from the timeline at its start and end) so it keeps its size on screen. One glide per scene: `power2.inOut` on x
and `sine.inOut` on y bow the path slightly. A click presses it (scale 0.8 for 0.07 s) and drops a ring in the primary
colour on the clicked point. Use it only on a flat page.

## Captions

A glass pill (the app's card colour at 86 %, a 1 px light border, backdrop blur, a deep shadow), 60 px bold text.
It rises 20 px into place over 0.7 s and each word lifts out of its own mask, 0.08 s apart; it fades and blurs out over
0.4 s. One caption per beat, entering on a beat after the scene starts and leaving before the next one enters.

## End card

The stage fades, blurs, and shrinks slightly away; the card starts just before the strongest hit so the icon blooms
on it (opacity in 0.25 s, scale 0.8 to 1 over 0.9 s, blur clearing). The name's letters rise in 0.04 s apart, the URL
lands on the next hit, and the final hit gives the icon and its glow one soft pulse.

## Stills

`snapshot --at <t> --no-end --zoom 0,0,1920,1080 --zoom-scale 2 -o stills` renders one moment at 3840x2160. Pick the
moment from a sheet. A frame of the video is not always the best still: in the example no frame shows a highlighted
topic with all its prompts landed. For a state like that, copy `video/` to a `still/` folder, change its timing table
so every row has landed early and hold the header's highlight on in its `index.html` (drop the fade-out tween), and
snapshot that copy.
