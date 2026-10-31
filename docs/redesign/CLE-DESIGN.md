# C.le. — design system for 超級碧琪 v3

Status: working document for the 2026-10 redesign (branch `redesign/cle`). Target runtime: OpenClaw 2026.10.4, auto-update off.

## Latest user direction · 2026-10-18 (overrides older descriptions below)

- The guardian is a **male**, jet-black Maine Coon with ice-blue eyes: handsome, strong and natural. Fine semi-realistic oil-painted fur with restrained gold/silver leaf. No flower on his head; one separate white camellia. References specify fur technique only; backgrounds and compositions are original.
- The character's new name is not reliably confirmed. Older feminine 碧琪 naming and different flower species per mode below are historical design notes, not approved current requirements.
- Preserve the original app's mature features and their usable entry points. Reuse its C.le. particle renderer, native browser, learning tools, workbench, rich content, companion actions, memory, research, connectors, automation and voice. Styling is not a reason to reduce functionality; area/radar fills, independent spaces and workflows remain available.
- Native upstream replacements require behavior verification. The installed baseline and the open acceptance checklist are in `installed-feature-baseline.json` and `FEATURE-PARITY.md`; takeover progress is in `TAKEOVER.md`.
- The opening remains a full-frame cinematic close-up with changes in framing. The simple composer and guardian companion both stay. This redesign is in staging and has not passed final delivery acceptance.

## 1. Idea

**The guardian.** A black Maine Coon guards one small white flower. The interface is a quiet sheet of paper (day) or a dark ink room (night). The cat is ink. The flower is the work the user is protecting: a thought, a project, a lesson. Ice blue is the cat's gaze, and it has one job:

> **Blue means the cat is looking.** Focus, the active choice, live progress, the caret, the cat's eyes. Nothing decorative is blue.

Name chain, kept as brand lore: LCK → "K k" → **C.le.**  The assistant is still called 碧琪 (碧 = jade blue, her eyes). She is an original black cat, not a pony.

## 2. Tokens

| Token | Day · Papier | Night · Encre | Use |
|---|---|---|---|
| `--cle-bg` | `#F3F0EA` | `#0B0C0F` | page |
| `--cle-surface` | `#FBFAF7` | `#131418` | cards, composer |
| `--cle-raised` | `#FFFFFF` | `#1A1B20` | popovers |
| `--cle-line` | `rgba(20,18,15,.10)` | `rgba(255,255,255,.08)` | hairlines |
| `--cle-ink` | `#15130F` | `#ECE8E1` | primary text |
| `--cle-ink-2` | `#5F5A52` | `#9A958C` | secondary text |
| `--cle-ink-3` | `#9C968C` | `#5E5A54` | hints, disabled |
| `--cle-gaze` | `#1C7FE0` | `#38AEFF` | the one accent |
| `--cle-gaze-glow` | `rgba(46,168,255,.28)` | `rgba(56,174,255,.35)` | focus halo |
| `--cle-fleur` | `#FFFFFF` | `#F6F4EF` | the flower, sign-off |
| `--cle-ok` | `#4F7D5C` | `#7FB08B` | sage |
| `--cle-warn` | `#A8772A` | `#D9A54E` | ochre |
| `--cle-err` | `#B23A33` | `#E0645B` | rouge, rare |

Radius: 6 (chips), 10 (controls), 14 (cards), 22 (composer). Shadows are soft and low: `0 1px 0 var(--cle-line), 0 8px 24px -12px rgba(0,0,0,.18)`. No glass blur on large areas (it is expensive in WKWebView); allowed only on small popovers.

## 3. Type

All system fonts, nothing to download:
- Display: `ui-serif` (New York) + `"Songti SC"`. Titles, empty-state lines, mode names. Italic New York for Latin accents.
- Text: `-apple-system, "PingFang SC"`.
- Labels: `ui-monospace` (SF Mono), 10.5–11px, uppercase, letter-spacing .14em, `--cle-ink-3`. Example: `ATELIER · 项目`.

## 4. Motion

Principle: **a cat moves slowly, then exactly.** Long calm holds, short decisive moves, no bouncing UI.

| Name | Value | Use |
|---|---|---|
| `--cle-t-press` | 80ms | press |
| `--cle-t-quick` | 160ms | hover, colour |
| `--cle-t-base` | 260ms | popovers, rows |
| `--cle-t-scene` | 620ms | mode/scene changes |
| `--cle-ease` | `cubic-bezier(.2,.7,0,1)` | entering (fast then settles) |
| `--cle-ease-exit` | `cubic-bezier(.5,0,.75,0)` | leaving |
| `--cle-ease-soft` | `cubic-bezier(.45,0,.2,1)` | colour/opacity |

Rules: animate only transform/opacity/colour. One main motion per region. Idle loops ≤ 1 per screen (the cat). Respect `prefers-reduced-motion`. Brand IP motion (splash, cat, mode blink, status glyph, signature) gets full quality; everything else stays plain.

**Budget cuts** (low visual payoff, real cost): floating bokeh/snow layers, full-screen blur backdrops, wallpaper filters animated per frame, confetti, extra WebGL canvases that are not the brand glyph.

## 5. The character — 碧琪, the guardian

Silhouette first (must read at 16px): tall tufted ears, lion ruff, plume tail, two blue eyes.
- Rendering: vector paths (from Codex reference art → potrace) + hand-built rig: body, head, ears ×2, tail spine (procedural), eyes (procedural lids, iris, slit pupil, glint).
- States: `rest` (breath 4.2s, blink every 6–14s), `listen` (user typing: ears forward, eyes follow caret), `work` (agent running: eyes narrowed, slow tail sweep), `write` (streaming: gaze tracks text), `done` (slow blink = "I trust you", tail curls), `ask` (head tilt, one ear turns), `oops` (ears back, tail flick), `sleep` (idle 90s: eyes close, head lowers).
- Interaction: hover → ears turn to cursor; click → looks at you, slow blink, then looks away (aloof). Never jumps around the screen.

## 6. Rooms — the five modes

Each mode is a room with its own label, flower, pose, light and greeting. Rooms never share session, model or tier state.

| Mode | Room | Flower | Pose | Light |
|---|---|---|---|---|
| 唠嗑 chat | SALON | marguerite | loaf, relaxed | warm paper |
| 项目 project | ATELIER | iris | sitting, upright | cool graphite, faint grid |
| 想法 thinking | NOCTURNE | moonflower | gazing up | deep ink, sparse stars (static) |
| 学习 learning | ÉTUDE | forget-me-not (blue: memory) | sitting on books | parchment |
| 无限 unrestricted | INFINI | white flower, glowing | standing | black, eyes lit |

**Mode change = a blink.** Two lids close over the old room (top and bottom, 260ms, `--cle-ease-exit`), meet at a blue hairline. The room's name and flower appear in that dark moment while the route changes underneath. Then the lids open on the new room (380ms, `--cle-ease`). Cheap (two layers + clip-path), unmistakably ours.

## 7. Splash — "Le regard" (the gaze)

Black. A hair-thin blue line appears where an eye will be (0.35s). The lids part (0.7s): the irises bloom, pupils are round; light finds them, the pupils narrow to slits, one glint slides across. The silhouette of the head is revealed only by rim light. The camera pulls back; the face becomes the mark; C.le. signs itself beneath; the flower opens. The eyes' blue becomes the composer's focus ring as the app appears. WebGL2 for the eyes, SVG for everything else; static fallback without WebGL.

## 8. Gears

- **思考等级** (off → ultra, adaptive): an eye glyph that opens with the level. off = closed line, minimal = slit, low/medium/high/xhigh = opening, max = fully open, ultra = open + gaze ring, adaptive = half-lid with a moving ring. One parametric SVG, drawn in code, animated between stops.
- **思考强度** (process rigor): 基础 glance / 加强 watch / 全开 hunt / 长跑 night watch. Small animated SVG emblems, no video files.
- **强制思考流程 (deep think)**: a notebook column of steps with hairlines; each step shows the eye glyph state (closed = pending, open = active, blink = verified).

## 9. Components (keep the good ones)

Keep and re-skin: the minimal composer (one pill, quiet toolbar), the Claude-Code-style process transcript, the C.le. status line (glyph + shimmer verb + command chip + timer), the quill for writing, the signature sign-off, the plan card, rich replies, the workbench cards.

White-label: every visible "OpenClaw" becomes **C.le.**; community/promo cards are removed; update banners are hidden (the runtime is pinned).

## 10. Work split

- Claude: this system, the character and rig, splash, blink transition, gears, composer + pet, shell layout, learning-mode design, all reviews and real-model acceptance.
- Codex (`codex exec`): raster art (reference sheets, icon hero, textures).
- OpenCode (`workbuddy/deepseek-v4.1-flash`, text only): mechanical code — compatibility, patch ports, string/branding sweeps, tests.
- Verification: WebKit snapshots (`wkshot`) at 1440×900 day and night for every mode; real Gemini 3.8 runs on the staging gateway (`~/.openclaw-cle`, port 19789).
