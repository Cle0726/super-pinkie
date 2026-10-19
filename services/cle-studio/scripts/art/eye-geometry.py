"""Measure the blink geometry of the macro eye for static/splash/regard.js.

usage: eye-geometry.py ART_DIR [preview.png]   → prints a JSON block for regard.json ("lids")
Per column across the eye: U = top of the open eye (outer edge of the dark rim), L = bottom, and
C = the painted crease of the closed lid. The open-eye almond is taken as the convex hull of the lit
iris (the slit pupil would otherwise bite into it), grown by the rim.
"""
import json, sys
import cv2, numpy as np
from PIL import Image
art = sys.argv[1]
o = np.asarray(Image.open(f'{art}/splash-macro-open.webp').convert('RGB')).astype(float) / 255
c = np.asarray(Image.open(f'{art}/splash-macro-closed.webp').convert('RGB')).astype(float) / 255
x0, x1, y0, y1 = 1450, 2150, 350, 820
iris = (((o[..., 2] - o[..., 0]) > .18) & (o[..., 2] > .35)).astype(np.uint8)
win = np.zeros_like(iris); win[y0:y1, x0:x1] = iris[y0:y1, x0:x1]
n, lab, st, _ = cv2.connectedComponentsWithStats(win, 8)
k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
pts = cv2.findNonZero((lab == k).astype(np.uint8))
hull = np.zeros_like(iris); cv2.fillConvexPoly(hull, cv2.convexHull(pts), 1)
hull = cv2.dilate(hull, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
cr = (((c[..., 2] - c[..., 0]) > .08) & (c[..., 2] > .25)).astype(np.uint8)
cw = np.zeros_like(cr); cw[y0:y1, x0:x1] = cr[y0:y1, x0:x1]
cw = cv2.morphologyEx(cw, cv2.MORPH_CLOSE, np.ones((5, 15), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(cw, 8)
k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); crease = lab == k
xs = np.where(hull.any(0))[0]; xa, xb = int(xs.min()), int(xs.max())
N = 32
X = np.linspace(xa, xb, N)
U, L, C = [], [], []
cx = np.where(crease.any(0))[0]
cmid = [(x, float(np.mean(np.where(crease[:, x])[0]))) for x in cx]
for x in X:
    col = np.where(hull[:, int(round(x))])[0]
    U.append(float(col.min()) if len(col) else np.nan); L.append(float(col.max()) if len(col) else np.nan)
cxs = np.array([a for a, _ in cmid], float); cys = np.array([b for _, b in cmid], float)
# the crease, extended linearly past its painted ends to the eye's corners
fit = np.polyfit(cxs, cys, 2)
for i, x in enumerate(X):
    cy = float(np.interp(x, cxs, cys)) if cxs.min() <= x <= cxs.max() else float(np.polyval(fit, x))
    C.append(min(max(cy, U[i]), L[i]))
out = {'x': [xa, xb], 'U': [round(v, 1) for v in U], 'L': [round(v, 1) for v in L], 'C': [round(v, 1) for v in C]}
print(json.dumps(out))
if len(sys.argv) > 2:
    vis = (o * 255).astype(np.uint8).copy()
    for x, u, l, cc in zip(X, U, L, C):
        cv2.circle(vis, (int(x), int(u)), 3, (255, 0, 0), -1); cv2.circle(vis, (int(x), int(l)), 3, (0, 255, 0), -1); cv2.circle(vis, (int(x), int(cc)), 3, (255, 255, 0), -1)
    Image.fromarray(vis[y0:y1, x0:x1]).save(sys.argv[2])
