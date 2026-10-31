"""Close 碧琪's eyes on a cut-out painting (for the blink and sleep frames).

usage: close-eyes.py IN.png OUT.png [--half]
The glowing eyes are found by colour, painted over with the fur around them (inpaint), and a lid
is drawn along each eye's own axis: a dark seam with a faint cool sheen on the upper lid, curved
like a contented, closed cat eye. --half leaves a thin slit of the blue showing (drowsy).
"""
import sys, math
import cv2, numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
half = '--half' in sys.argv
rgba = np.asarray(Image.open(src).convert('RGBA')).copy()
rgb = rgba[..., :3].astype(np.float32)
b, g, r = rgb[..., 2], rgb[..., 1], rgb[..., 0]
core = ((b > 170) & (g > 90) & (b - r > 70)).astype(np.uint8)   # the lit iris: bright cyan, not the coat's blue sheen
n, lab, st, _ = cv2.connectedComponentsWithStats(core, 8)
pick = sorted([i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 40], key=lambda i: -(st[i, cv2.CC_STAT_AREA] * (b[lab == i].mean() + g[lab == i].mean())))[:2]
mask0 = np.isin(lab, pick).astype(np.uint8)
# the whole lit eye: the bright core grown into the darker blue around it
grown = (cv2.dilate(mask0, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))) > 0) & (b > 105) & (b - r > 45)
grown = (grown | (mask0 > 0)).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(grown, 8)
eyes = sorted(range(1, n), key=lambda i: -st[i, cv2.CC_STAT_AREA])[:2]
blue = grown
mask = grown.copy()
hole = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
bgr = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2BGR)
filled = cv2.cvtColor(cv2.inpaint(bgr, hole, 7, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB)
out = rgba.copy(); out[..., :3] = filled
over = out[..., :3].astype(np.float32)
for i in eyes:
    ys, xs = np.where(lab == i)
    cx, cy = xs.mean(), ys.mean()
    cov = np.cov(np.stack([xs - cx, ys - cy]))
    ev, evec = np.linalg.eigh(cov)
    ax = evec[:, 1]; ang = math.atan2(ax[1], ax[0])
    if abs(ang) > math.pi / 2: ang += math.pi
    half_len = math.sqrt(ev[1]) * 2.1
    pts = []
    for t in np.linspace(-1, 1, 24):
        dx = t * half_len; dy = -(1 - t * t) * half_len * .16       # the lid arches up a little
        pts.append((cx + dx * math.cos(ang) - dy * math.sin(ang), cy + dx * math.sin(ang) + dy * math.cos(ang)))
    pts = np.array(pts, np.float32)
    layer = np.zeros(blue.shape, np.float32); sheen = np.zeros(blue.shape, np.float32)
    cv2.polylines(layer, [np.round(pts * 4).astype(np.int32)], False, 1.0, thickness=int(max(5, half_len * .32)), lineType=cv2.LINE_AA, shift=2)
    cv2.polylines(sheen, [np.round((pts + [0, -max(1.5, half_len * .1)]) * 4).astype(np.int32)], False, 1.0, thickness=int(max(3, half_len * .16)), lineType=cv2.LINE_AA, shift=2)
    layer = cv2.GaussianBlur(layer, (0, 0), .8)[..., None]; sheen = cv2.GaussianBlur(sheen, (0, 0), 1.2)[..., None]
    over = over * (1 - .85 * layer) + np.array([10, 11, 16]) * .85 * layer
    over = over + np.array([70, 92, 130]) * .28 * sheen * (1 - layer)
    if half:
        slit = np.zeros(blue.shape, np.float32)
        cv2.polylines(slit, [np.round((pts + [0, max(1.0, half_len * .05)]) * 4).astype(np.int32)], False, 1.0, thickness=int(max(2, half_len * .1)), lineType=cv2.LINE_AA, shift=2)
        slit = cv2.GaussianBlur(slit, (0, 0), .7)[..., None]
        over = over * (1 - .8 * slit) + np.array([60, 150, 255]) * .8 * slit
out[..., :3] = np.clip(over, 0, 255).astype(np.uint8)
Image.fromarray(out, 'RGBA').save(dst)
print(dst, 'eyes', len(eyes))
