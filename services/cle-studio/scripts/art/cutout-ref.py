"""Cut 碧琪 out of the user's reference paintings (black cat, palette knife, white impasto ground).

usage: cutout-ref.py IN.png OUT.png
- the cat is the largest connected body of dark paint; the flower, loose ground strokes and the
  blue-grey ground shadow are dropped; every enclosed patch of white ground (between the legs,
  under the tail) is background too
- the edge is soft: alpha follows how dark the paint is in a thin ring, colour un-mixed from white
"""
import sys
import cv2, numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
h, w, _ = img.shape
lum = img @ np.array([.2126, .7152, .0722], np.float32)
dark = (cv2.GaussianBlur(lum, (0, 0), 1.2) < 118).astype(np.uint8)
dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(dark, 8)
k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
body = (lab == k).astype(np.uint8)
# fill small holes inside the coat (light strokes), but not real gaps of white ground
inv = (1 - body).astype(np.uint8)
n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
mn = img.min(2)
for i in range(1, n2):
    region = lab2 == i
    if st2[i, cv2.CC_STAT_AREA] < 900 and mn[region].mean() < 205: body[region] = 1
# the ground shadow: light, bluish strokes in the bottom band, outside the paws' dark mass
b, r = img[..., 2], img[..., 0]
shadow = (lum > 95) & (b > r + 8)
body[shadow & (np.arange(h)[:, None] > h * .6)] = 0
body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(body, 8)
k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); body = (lab == k).astype(np.uint8)
dist_in = cv2.distanceTransform(body, cv2.DIST_L2, 5)
ring = np.clip((255 - lum) / (255 - 30), 0, 1)
alpha = np.where(dist_in > 3, 1.0, np.maximum(ring, np.clip(dist_in / 3, 0, 1)) * body)
alpha = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), .7) * cv2.dilate(body, np.ones((3, 3), np.uint8))
a3 = np.maximum(alpha, 1e-3)[..., None]
fg = np.where((dist_in > 3)[..., None], img, np.clip((img - (1 - alpha[..., None]) * 255) / a3, 0, 255))
ys, xs = np.where(alpha > .02)
y0, y1, x0, x1 = max(0, ys.min() - 6), min(h, ys.max() + 7), max(0, xs.min() - 6), min(w, xs.max() + 7)
Image.fromarray(np.dstack([fg, alpha * 255]).astype(np.uint8)[y0:y1, x0:x1], 'RGBA').save(dst)
print(dst, x1 - x0, y1 - y0)
