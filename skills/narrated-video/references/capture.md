# Capture

Real screenshots of the running product, taken by a Playwright script built on `scripts/capture.mjs`. Never draw UI,
and never edit a capture's pixels: when a page has thin data, change the input or the account, not the image.

## Why a script, not the harness's browser

An agent's built-in browser is for looking at pages. Video frames need more: an exact 1440x900 viewport at 2x, one
frame per keystroke, measured boxes for the pointer, and a script that re-captures every frame the same way when the
UI changes. Use the harness's browser to explore the app and find the selectors; write the capture as a Playwright
script.

## Setup

- 1440x900 CSS px at 2x (the helper's defaults). The composition's camera works in those CSS px.
- A demo account or project with data that reads well. For a local app, a no-auth or dev mode avoids sign-in.
  Otherwise pass `login: { url, done }` to `open()`: the first run opens a visible browser for the person to sign in
  and saves the session next to the captures; later runs reuse it. Keep that file between capture rounds (deleting
  it means signing in again), out of git, and never print it.
- Write the capture script so it can be re-run: when the UI changes, a re-run replaces the captures and the
  composition stays the same.

## What to capture for each beat

- The page at rest (`shot`), and each state the viewer sees change: before and after a click ("Copy" then "Copied"),
  a menu open, a tab switched. These become an image stack the timeline steps through.
- Anything typed on screen, one frame per keystroke (`typeFrames`): typing in the video is real frames, timed to the
  narration, never animated text.
- Click targets (`box`): the CSS-px box of every button, field, and tab the pointer will visit, saved to `boxes.json`.
  Measure after hiding banners (a banner shifts the layout and every box with it).
- Pages the camera scrolls or pans: a tall capture (`tall`, e.g. 2400 px) by growing the viewport. A full-page
  screenshot does not work for apps that scroll inside a container.
- Screen recordings only for what screenshots cannot show (an agent working in a terminal, a live progress bar). Trim
  them, re-encode with a keyframe every 15 frames (`-g 15`), and play them in a recording pane.

## Look at every capture

Open each image before using it and judge it as a video frame: does the key number read at a glance, what region is
worth zooming into, is anything half-loaded (skeletons, spinners), is a hover style or a tooltip left on.

## Privacy pass

Before anything is rendered: API keys, tokens, emails, customer names, internal or localhost URLs, notification
counts. Hide them with `hide` (a selector or a text pattern), frame the camera around them (a footer showing a local
MCP URL: keep the camera above it), or recapture with clean data. If a key was ever on screen in a recording, tell the
person to revoke it.

## Cost

Captures that run searches, crawls, or other paid API calls spend real credits. Reuse captures across cuts; re-run
only the pages that changed.
