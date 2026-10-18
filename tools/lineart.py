#!/usr/bin/env python3
"""lineart.py — turn a clean ink line drawing (black on white PNG) into pen strokes for animation.

  lineart.py in.png out.json [--size 96] [--svg preview.svg]

Pipeline: threshold -> drop specks -> find the small closed loops (the eye almonds) -> skeletonize the ink ->
walk the skeleton graph into edges -> chain edges through junctions by direction continuity -> prune spurs ->
simplify (RDP) -> Catmull-Rom to cubic Beziers -> order strokes the way a hand would (longest first, then nearest
pen-down) -> JSON {viewBox, width, strokes:[{d,len}], eyes:[d]} in a size x size coordinate space.
"""
import json, math, sys, argparse
import numpy as np, cv2
from skimage.morphology import skeletonize

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--size', type=float, default=96)
ap.add_argument('--svg')
ap.add_argument('--eps', type=float, default=1.4)
ap.add_argument('--image', help='also write the original ink as an alpha PNG in the same frame')
ap.add_argument('--image-px', type=int, default=384)
a = ap.parse_args()

img = cv2.imread(a.src, cv2.IMREAD_GRAYSCALE)
H0, W0 = img.shape
ink = (img < 140).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(ink, 8)
keep = np.zeros(n, bool); keep[1:] = st[1:, 4] >= max(30, ink.sum() * .0015)
ink = keep[lab].astype(np.uint8)
ys, xs = np.nonzero(ink)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
side = max(x1 - x0, y1 - y0) * 1.12
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
S = a.size / side
tx = lambda x: (x - (cx - side / 2)) * S
ty = lambda y: (y - (cy - side / 2)) * S

# stroke width from the distance transform along the skeleton
dist = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
sk = skeletonize(ink.astype(bool)).astype(np.uint8)
width = float(np.median(dist[sk > 0]) * 2) if sk.any() else 2.0

# eyes: small enclosed holes of reasonable shape
eyes = []
cnts, hier = cv2.findContours(ink, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
area_all = (x1 - x0) * (y1 - y0)
eye_mask = np.zeros_like(ink)
cand = []
if hier is not None:
    for i, c in enumerate(cnts):
        if hier[0][i][3] < 0: continue                       # not a hole
        ar = cv2.contourArea(c)
        if not (area_all * .0004 < ar < area_all * .02): continue
        x, y, w, h = cv2.boundingRect(c)
        if max(w, h) / max(1, min(w, h)) > 4.5: continue
        cand.append((ar, y + h / 2, c))
# eyes: the best matched pair — similar size, same height, set apart; failing that, the highest large hole
def cxy(c):
    m = cv2.moments(c); return (m['m10'] / (m['m00'] or 1), m['m01'] / (m['m00'] or 1))
best, bs = None, 0
for i in range(len(cand)):
    for j in range(i + 1, len(cand)):
        (a1, _, c1), (a2, _, c2) = cand[i], cand[j]
        (xa, ya), (xb, yb) = cxy(c1), cxy(c2)
        sim = min(a1, a2) / max(a1, a2)
        if sim < .5 or abs(ya - yb) > (y1 - y0) * .08 or abs(xa - xb) < (x1 - x0) * .12: continue
        score = sim * (a1 + a2) * (1.6 - (ya + yb) / 2 / H0)          # prefer bigger, matched, higher
        if score > bs: best, bs = [cand[i], cand[j]], score
if best: cand = best
elif cand:
    # a lone eye must look like one: an almond, clearly wider than tall (a moon or a mouth loop is not)
    def almond(c): x_, y_, w_, h_ = cv2.boundingRect(c); return w_ / max(1, h_) >= 1.35
    lone = [t for t in sorted(cand, key=lambda t: -t[0])[:3] if almond(t[2])]
    cand = [min(lone, key=lambda t: t[1])] if lone else []
for ar, _, c in cand:
    eyes.append(cv2.approxPolyDP(c, 1.0, True)[:, 0, :])
    cv2.drawContours(eye_mask, [c], -1, 1, thickness=int(width * 2.5) + 2)

# skeleton graph
H, W = sk.shape
OFF = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
pts = set(zip(*np.nonzero(sk)))
def nb(p): return [(p[0] + dy, p[1] + dx) for dy, dx in OFF if (p[0] + dy, p[1] + dx) in pts]
deg = {p: len(nb(p)) for p in pts}
nodes = {p for p, d in deg.items() if d != 2}
seen_edges = set(); edges = []
def walk(start, nxt):
    path = [start, nxt]; prev, cur = start, nxt
    while cur not in nodes:
        cand = [q for q in nb(cur) if q != prev and q not in path[-3:]]
        if not cand: break
        prev, cur = cur, cand[0]; path.append(cur)
    return path
for p in nodes:
    for q in nb(p):
        key = frozenset((p, q))
        if key in seen_edges: continue
        path = walk(p, q)
        for i in range(len(path) - 1): seen_edges.add(frozenset((path[i], path[i + 1])))
        edges.append(path)
# pure loops (no nodes)
left = pts - {p for e in edges for p in e}
while left:
    s = next(iter(left)); loop = [s]; cur = s; prev = None
    while True:
        cand = [q for q in nb(cur) if q != prev and q in left and q not in loop]
        if not cand: break
        prev, cur = cur, cand[0]; loop.append(cur)
    left -= set(loop); loop.append(loop[0]); edges.append(loop)

L = lambda e: sum(math.dist(e[i], e[i + 1]) for i in range(len(e) - 1))
spur = width * 3.5
# drop short spurs that end in a free endpoint, and edges inside the eye rings (eyes are drawn separately)
def is_spur(e): return L(e) < spur and (deg[e[0]] == 1 or deg[e[-1]] == 1)
edges = [e for e in edges if not is_spur(e)]
edges = [e for e in edges if np.mean([eye_mask[p] for p in e]) < .6]

# chain edges through junctions by direction continuity
def tangent(e, at_end, k=8):
    # direction of travel leaving this end of the stroke
    seg = e[-k:] if at_end else e[:k][::-1]
    (y0_, x0_), (y1_, x1_) = seg[0], seg[-1]
    v = np.array([x1_ - x0_, y1_ - y0_], float); n_ = np.linalg.norm(v)
    return v / n_ if n_ else v
used = [False] * len(edges); strokes = []
order = sorted(range(len(edges)), key=lambda i: -L(edges[i]))
for i in order:
    if used[i]: continue
    used[i] = True; s = list(edges[i])
    for forward in (True, False):
        while True:
            end = s[-1] if forward else s[0]
            t = tangent(s, forward)
            best, bscore, bflip = None, .35, False
            for j, e in enumerate(edges):
                if used[j]: continue
                for flip in (False, True):
                    ee = e[::-1] if flip else e
                    if math.dist(ee[0], end) > 2.5: continue
                    k = min(8, len(ee) - 1)
                    v = np.array([ee[k][1] - ee[0][1], ee[k][0] - ee[0][0]], float)
                    sc = float(np.dot(t, v / (np.linalg.norm(v) or 1)))    # keep going the same way
                    if sc > bscore: best, bscore, bflip = j, sc, flip
            if best is None: break
            used[best] = True; ee = edges[best][::-1] if bflip else edges[best]
            s = s + ee[1:] if forward else ee[::-1][:-1] + s
    strokes.append(s)

# simplify + smooth
def to_d(points):
    arr = np.array([[tx(x), ty(y)] for y, x in points], np.float32)
    closed = math.dist(points[0], points[-1]) < 2.5 and len(points) > 10
    simp = cv2.approxPolyDP(arr.reshape(-1, 1, 2), a.eps * S, closed)[:, 0, :]
    P = [tuple(p) for p in simp]
    if closed and P[0] != P[-1]: P.append(P[0])
    if len(P) < 2: return None, 0
    d = [f'M{P[0][0]:.2f} {P[0][1]:.2f}']
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i > 0 else P[i]; p1 = P[i]; p2 = P[i + 1]; p3 = P[i + 2] if i + 2 < len(P) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f'C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}')
    length = sum(math.dist(P[i], P[i + 1]) for i in range(len(P) - 1))
    return ''.join(d), length

strokes = [s for s in strokes if L(s) >= spur * 1.2]
# order like a hand: the longest first, then whichever pen-down is nearest the last pen-up
out, cur = [], None
pool = sorted(strokes, key=lambda s: -L(s))
while pool:
    if cur is None: s = pool.pop(0)
    else:
        k = min(range(len(pool)), key=lambda i: min(math.dist(cur, pool[i][0]), math.dist(cur, pool[i][-1])))
        s = pool.pop(k)
        if math.dist(cur, s[-1]) < math.dist(cur, s[0]): s = s[::-1]
    cur = s[-1]; out.append(s)
res = []
for s in out:
    d, ln = to_d(s)
    if d: res.append({'d': d, 'len': round(ln, 1)})
eyes_d = []
for poly in eyes:
    P = [(tx(x), ty(y)) for x, y in poly]
    eyes_d.append('M' + ' L'.join(f'{x:.2f} {y:.2f}' for x, y in P) + 'Z')
data = {'viewBox': f'0 0 {a.size:g} {a.size:g}', 'width': round(width * S, 2), 'strokes': res, 'eyes': eyes_d}
if a.image:
    # the drawing itself, faithful: ink -> alpha, framed exactly like the strokes (viewBox 0..size)
    from PIL import Image as _I
    left, top = cx - side / 2, cy - side / 2
    # paper is never pure white: cut the background tone first, so only ink becomes mask
    alpha = ((255 - img.astype(np.float32) - 22) * 255 / 233).clip(0, 255).astype(np.uint8)
    canvas = np.zeros((int(math.ceil(side)), int(math.ceil(side))), np.uint8)
    sx0, sy0 = int(round(left)), int(round(top))
    ys_, xs_ = slice(max(0, sy0), min(H0, sy0 + canvas.shape[0])), slice(max(0, sx0), min(W0, sx0 + canvas.shape[1]))
    canvas[ys_.start - sy0:ys_.stop - sy0, xs_.start - sx0:xs_.stop - sx0] = alpha[ys_, xs_]
    im = _I.fromarray(canvas).resize((a.image_px, a.image_px), _I.LANCZOS)
    # small icons: keep the artist's relative weights but give hairlines enough ink to survive downscaling
    from PIL import ImageFilter as _F
    arr = np.asarray(im.filter(_F.MaxFilter(3))).astype(np.float32) / 255 * .55 + np.asarray(im).astype(np.float32) / 255 * .45
    im = _I.fromarray((np.power(arr.clip(0, 1), .6) * 255).astype(np.uint8))
    rgba = im.convert('L')   # opaque: white ink on black — a pure luminance mask (WebKit ignores alpha in luminance masks)
    rgba.save(a.image, 'WEBP', lossless=True) if a.image.endswith('.webp') else rgba.save(a.image)
    data['image'] = a.image.split('/')[-1]
    data['reveal'] = round(width * S * 3.4, 2)
json.dump(data, open(a.out, 'w'))
if a.svg:
    body = ''.join(f'<path d="{s["d"]}"/>' for s in res)
    eb = ''.join(f'<path d="{d}" fill="#2A63E8" stroke="none"/>' for d in eyes_d)
    open(a.svg, 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{data["viewBox"]}" width="512" height="512" style="background:#F4EFE4"><g fill="none" stroke="#15161A" stroke-width="{data["width"]}" stroke-linecap="round" stroke-linejoin="round">{body}</g>{eb}</svg>')
print(f'{a.src}: {len(res)} strokes, {len(eyes_d)} eyes, width {data["width"]}, total len {sum(s["len"] for s in res):.0f}')
