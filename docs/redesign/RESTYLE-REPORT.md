# Colour sweep — Pinkie pink → C.le. tokens

Branch `oc/restyle`, worktree `~/release-superpinkie/wt/restyle`.
Scope: every `services/cle-studio/static/legacy/*.js|*.css` except vendor files
(`laolao-vendor-*`, `laolao-katex/`) and the four Claude owns (`laolao-companion.js/.css`,
`laolao-cle-space.js`, `laolao-cle-signature.js`) — 34 files, 13 CSS + 21 JS.

## How the audit works

`scripts/color-sweep.mjs` lists every colour literal (hex, rgb/rgba, hsl/hsla) per file
with hue / saturation / lightness and flags the ones that are off-brand: hue 280–360 or
0–15 with saturation > 25 % (pink, rose, magenta, purple, plum inks such as `#57364a`).
The amber band (15–25°) is never flagged. Modes: summary, `--all`, `--json`, `--counts`.

```
node scripts/color-sweep.mjs            # off-brand literals left, with hue/sat/lightness
node scripts/color-sweep.mjs --counts   # "file <literals> <off-brand>" per line
```

## The mapping

Pink is almost always the *role* of a colour, not the colour. Each literal was re-resolved
by the role it plays in its declaration, then replaced:

| role it played in 2026.7 | C.le. value |
| --- | --- |
| accent, selected, focus, active, glyph / dot / spinner | `var(--cle-gaze)` |
| soft accent tint (a few % alpha), hover wash | `var(--cle-gaze-soft)` |
| stronger accent wash (≥ ~25 % alpha), aura | `var(--cle-gaze-glow)` |
| panel / popover / card / glass-pane background | `var(--cle-surface)` |
| page-level or nested panel background | `var(--cle-paper)` (light), `var(--cle-surface)` (dark blocks) |
| borders, outlines, inset rings (α < .3 / ≥ .3) | `var(--cle-line)` / `var(--cle-line-strong)` |
| shadows | `var(--cle-shadow)` |
| pink / plum text inks (α ≥ .8 / ≥ .5 / < .5) | `var(--cle-ink)` / `--cle-ink-2` / `--cle-ink-3` |

Kept on purpose while sweeping:

* `backdrop-filter` / `-webkit-backdrop-filter` declarations are untouched (not colours);
  the glass *tint* that went with them became `var(--cle-surface)`.
* Error / destructive / failed states keep a real red: `#ef4444`, `#e03131`, `#d6336c`,
  `#d14d61`, `#b43e57`, `#d65b70` → `#B23A33`; `#bb4465` (memory danger) and the git
  `D`/`C` reds keep their destructive hue. Success greens are untouched.
* Canvas radar colours and the Monaco / terminal theme objects keep channel values
  (they are consumed as hex by JS), swapped to the gaze: `rgba(42, 99, 232, α)` / `#2A63E8`.
  Terminal ANSI **red/brightRed/magenta/brightMagenta** became the gaze `#2A63E8`;
  `black`/`blue`/`green`/`yellow`/`cyan` stayed as the syntax palette.
* Light-on-dark literals inside `html[data-pinkie-night]` / `[data-theme-mode="dark"]`
  blocks that no longer paint their own panel take the theme-aware ink tokens.
* JS colour strings (template-string CSS, inline-style objects) got the same treatment.
  Only the literal changed; quotes, commas, selectors and code structure are byte-identical.

Verification: `node --check` on every touched JS file, `node build.mjs` in
`services/cle-studio` (bundle rebuilt cleanly), and the colour script re-run.

## Per-file counts — off-brand literals before → after

| file | literals before → after | off-brand before → after | kept on purpose |
| --- | --- | --- | --- |
| browser.css | 25 → 9 | 17 → 0 | — |
| capabilities.css | 69 → 34 | 35 → 0 | — |
| image-viewer.css | 7 → 3 | 5 → 0 | — |
| laolao-ask-user.css | 36 → 14 | 22 → 0 | — |
| laolao-learning-library.css | 22 → 6 | 16 → 0 | — |
| laolao-learning-stage.css | 333 → 194 | 140 → 0 | — |
| laolao-material-preview.css | 84 → 11 | 73 → 0 | — |
| laolao-memory.css | 42 → 12 | 32 → **1** | `#bb4465` — danger button ink |
| laolao-rich.css | 38 → 36 | 2 → 0 | — |
| laolao-settings-user.css | 57 → 18 | 39 → 0 | — |
| laolao-usage-stats.css | 44 → 18 | 26 → 0 | — |
| laolao-workbench-notebook.css | 51 → 32 | 20 → **1** | `#b4453c` — stderr / error red |
| laolao-workbench.css | 89 → 60 | 31 → **2** | git `D` / `C` status reds (destructive) |
| laolao-context-compact.js | 54 → 21 | 33 → 0 | — |
| laolao-deep-think.js | 82 → 42 | 40 → 0 | — |
| laolao-desensitize.js | 66 → 30 | 36 → 0 | — |
| laolao-learning-stage.js | 8 → 7 | 4 → 0 | — |
| laolao-link-viewer.js | 7 → 5 | 2 → 0 | — |
| laolao-model-picker.js | 3 → 2 | 1 → 0 | — |
| laolao-usage-stats.js | 3 → 1 | 2 → 0 | — |
| laolao-web-gpt-collab.js | 82 → 41 | 46 → **5** | `failed` state restyled to `#B23A33` (error red) |
| laolao-workbench.js | 33 → 33 | 5 → 0 | — |

"literals" counts every colour literal in the file (neutral greys, blacks, whites and the
gaze tokens included), which is why it only drops where a gradient collapsed into one
flat surface.

**Total off-brand: 627 → 9.** All nine remaining are deliberate semantic reds (error,
destructive, git-deleted / conflicting), which the brief keeps.

## Left untouched

* Syntax-highlight palettes inside the Monaco editor / terminal (only their pink entries
  were mapped to the gaze).
* Chart palettes: `laolao-rich.js` `PALETTE.day|night` and the usage wheel contain no
  off-brand series colours, so the prescribed `#2A63E8, #C9A24A, #15161A, #6A8CA8, #8C6A3F`
  series was not needed there.
* `laolao-ask-user.js`, `laolao-capabilities.js`, `laolao-image-viewer.js`,
  `laolao-learning-library.js`, `laolao-live-voice.js`, `laolao-material-preview.js`,
  `laolao-memory.js`, `laolao-plan.js`, `laolao-rich.js`, `laolao-selection-actions.js`,
  `laolao-workbench-code.js`, `laolao-workbench-notebook.js` — no off-brand literals in
  these files (all their colour comes from tokens or CSS).
