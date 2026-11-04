# Capture

Everything in narrated-video's [capture reference](../../narrated-video/references/capture.md) applies: real
screenshots at 1440x900, 2x, typing frames, measured boxes, a look at every capture, a privacy pass. What a teaser
adds:

## Theme

`cap.page({ colorScheme: 'dark' })` captures an app that follows the system theme in dark mode. An app with a theme
switch stored in localStorage needs it set before the first navigation (`page.addInitScript`). Capture every screen in
the same theme, and take the video's palette from the app's theme tokens (its CSS custom properties for that theme).

## Boxes for cutting rows

A row reveal cuts each row from the capture by its box, so measure the rows themselves (`tbody tr`, or the element
around each list item), not only click targets. When a row's box is awkward to get (mixed text nodes, a header with a
count inside it), measure an element inside it and derive the row from the layout: the worked example takes each
prompt's link and each header's "5 prompts" label, then computes the row's top and height from the fixed row
height. Check the derived rows against the capture before relying on them.

## Mask colour

Sample the table's background from the capture (a pixel between rows) for the reveal mask; dark themes are not pure
black and the rows of a card are not the page background (`#1d1d1d` rows on a `#121212` page in the example).

## Frames of an animation

A spinner or a fade is real UI too. To capture it frame by frame at exact times, pause and seek the page's animations
between screenshots:

```js
await p.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), ms);
```

Capture one cycle (a spinner turn at 60 frames) and loop it. If the page also changes state on a timer (rotating
status messages), replace that timer before the page loads so you can step it by hand:

```js
await p.addInitScript(() => {
  const orig = window.setInterval; window.__ticks = [];
  window.setInterval = (fn, ms, ...a) => (ms === 6000 ? (window.__ticks.push(fn), 0) : orig(fn, ms, ...a));
});
// later: await p.evaluate(() => window.__ticks.forEach((f) => f()));
```

## A loading state without paying for it

A request that spends credits (a crawl, a research run) can be held so its loading state is captured without it
being sent: route it and never answer.

```js
await p.route('**/_serverFn/**', (r) => (r.request().method() === 'POST' ? undefined : r.continue()));
```

Run the real request once for the screens that come after it, and reuse those captures.

## One screen from another branch

When one screen changed on a newer branch, capture only that screen there (a fresh worktree, its own build and port)
and keep the rest. If its boxes match the old ones, the camera and pointer keys carry over unchanged; compare the
`boxes.json` of both passes before swapping the frames in.
