#!/usr/bin/env python3
"""petline.py — make the companion's line-drawn figure from a Codex line drawing (black on white).
Ink keeps the artist's weight (alpha from darkness); the body is filled with paper so the room does
not show through him; the eye almonds are filled with the gaze. One PNG per theme.
  petline.py in.png out-prefix   -> out-prefix-day.png, out-prefix-night.png"""
import sys, numpy as np, cv2
src, out = sys.argv[1], sys.argv[2]
g = cv2.imread(src, cv2.IMREAD_GRAYSCALE).astype(np.float32)
ink = g < 150
n, lab, st, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), 8)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 30: ink[lab == i] = False; g[lab == i] = 255
# exterior: everything reachable from the border without crossing ink (close tiny gaps first)
closed = cv2.dilate(ink.astype(np.uint8), np.ones((5, 5), np.uint8))
free = (1 - closed).astype(np.uint8)
m = np.zeros((free.shape[0] + 2, free.shape[1] + 2), np.uint8)
ext = free.copy()
for seed in [(0, 0), (free.shape[1] - 1, 0), (0, free.shape[0] - 1), (free.shape[1] - 1, free.shape[0] - 1)]:
    if ext[seed[1], seed[0]] == 1: cv2.floodFill(ext, m, seed, 2)
exterior = cv2.dilate((ext == 2).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~ink
body = ~exterior
# eyes: interior holes, matched pair (similar size, same height), else none
holes = ((ext == 1)).astype(np.uint8)
n, lab, st, cen = cv2.connectedComponentsWithStats(holes, 8)
H, W = g.shape
cand = [i for i in range(1, n) if 40 < st[i, cv2.CC_STAT_AREA] < W * H * .004 and st[i, cv2.CC_STAT_WIDTH] > st[i, cv2.CC_STAT_HEIGHT] * 1.1]
best = None
for a in cand:
    for b in cand:
        if b <= a: continue
        sa, sb = st[a, cv2.CC_STAT_AREA], st[b, cv2.CC_STAT_AREA]
        if min(sa, sb) / max(sa, sb) < .45: continue
        dy, dx = abs(cen[a][1] - cen[b][1]), abs(cen[a][0] - cen[b][0])
        if dy > 40 or dx < 30 or dx > W * .3: continue
        score = dy + abs(sa - sb) / 10 - min(cen[a][1], cen[b][1]) * -0 
        if best is None or score < best[0]: best = (score, a, b)
eyes = np.zeros_like(ink)
if best:
    for i in best[1:]: eyes |= lab == i
    eyes = cv2.dilate(eyes.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
print(src, 'eyes', bool(best))
alpha_ink = np.clip((255 - g - 22) * 255 / 233, 0, 255) / 255
ys, xs = np.where(body | ink)
y0, y1, x0, x1 = max(ys.min() - 6, 0), min(ys.max() + 7, H), max(xs.min() - 6, 0), min(xs.max() + 7, W)
for name, inkc, paper, gaze in [('day', (244, 239, 228), (21, 22, 26), (90, 168, 255)), ('night', (239, 232, 218), (10, 13, 22), (90, 168, 255))]:
    rgb = np.zeros((H, W, 3), np.float32); a = np.zeros((H, W), np.float32)
    rgb[body] = paper; a[body] = 1
    rgb[eyes] = gaze
    k = alpha_ink[..., None]
    ic = np.broadcast_to(np.array(inkc, np.float32), (H, W, 3)).copy()
    if name == 'day':
        # on paper the contour is the body's own edge: draw it in the body colour, so no pale halo
        edge = cv2.dilate(exterior.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool) & ink
        edge = cv2.dilate(edge.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & (alpha_ink > 0)
        ic[edge] = paper
    rgb = rgb * (1 - k) + ic * k
    a = np.maximum(a, alpha_ink)
    img = np.dstack([rgb[..., ::-1], a * 255]).astype(np.uint8)[y0:y1, x0:x1]
    # 3x display density for a ~170px wide figure
    s = 540 / img.shape[1]
    img = cv2.resize(img, (540, int(img.shape[0] * s)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(f'{out}-{name}.png', img)
    print(' ', f'{out}-{name}.png', img.shape)
