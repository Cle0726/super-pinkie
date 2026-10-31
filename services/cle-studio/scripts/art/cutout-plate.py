"""Cut the black cat off a flat grey plate (Codex mascot sheets, #808080), all poses on one frame.

usage: cutout-plate.py OUT_DIR WIDTH name=IN.png [name=IN.png ...]

- Plate colour = median of the border; background = pixels close to it, flood-connected to the edge.
- Core (alpha 1) sits farther than RING px from the background; in the ring alpha comes from how far
  a pixel is from the plate colour, and the colour is un-mixed from the plate, so fur tips and the
  pale whiskers keep their own colour instead of a grey fringe.
- Every pose is cropped to the UNION box of all poses, so the cat keeps one size across states and
  only the pose changes; the frame is bottom-aligned (the rig pins the bottom edge to the composer).
- Writes OUT_DIR/<name>.webp at WIDTH px plus OUT_DIR/frame.json (box, size, eye centres).
"""
import json, os, sys
import cv2
import numpy as np
from PIL import Image

out, width, pairs = sys.argv[1], int(sys.argv[2]), [a.split('=', 1) for a in sys.argv[3:]]
RING, PAD = 10, 18
cuts = {}
for name, src in pairs:
    img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    h, w, _ = img.shape
    border = np.concatenate([img[0], img[-1], img[:, 0], img[:, -1]])
    G = np.median(border, axis=0)
    d = np.abs(img - G).max(axis=2)
    near = (d < 14).astype(np.uint8) * 255
    flood = np.zeros((h + 2, w + 2), np.uint8)
    for x in range(0, w, 5):
        for y in (0, h - 1):
            if near[y, x] == 255: cv2.floodFill(near, flood, (x, y), 128)
    for y in range(0, h, 5):
        for x in (0, w - 1):
            if near[y, x] == 255: cv2.floodFill(near, flood, (x, y), 128)
    bg = (near == 128).astype(np.uint8)
    # pockets of plate trapped under the tail or between the legs are background too
    n, lab, st, _ = cv2.connectedComponentsWithStats((near == 255).astype(np.uint8), 8)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] > 120: bg[lab == i] = 1
    dist = cv2.distanceTransform(1 - bg, cv2.DIST_L2, 5)
    core = dist > RING
    # distance from the plate colour, normalised by how far this pixel could be (to black or white)
    lum = img @ np.array([.2126, .7152, .0722], np.float32); gl = float(G @ np.array([.2126, .7152, .0722]))
    span = np.where(lum < gl, gl - 16.0, 250.0 - gl)
    a_ring = np.clip(np.maximum(np.abs(lum - gl), d * .8) / span, 0, 1) ** .9
    alpha = np.where(core, 1.0, np.where(bg == 0, a_ring, 0.0)).astype(np.float32)
    alpha = np.maximum(alpha, np.clip((dist - RING + 3) / 3, 0, 1) * (bg == 0))
    a3 = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((img - (1 - alpha[..., None]) * G) / a3, 0, 255)
    fg = np.where(core[..., None], img, fg)
    cuts[name] = (np.dstack([fg, alpha * 255]).astype(np.uint8), img)

boxes = []
for rgba, _ in cuts.values():
    ys, xs = np.where(rgba[..., 3] > 6)
    boxes.append((xs.min(), ys.min(), xs.max(), ys.max()))
x0 = max(0, min(b[0] for b in boxes) - PAD); y0 = max(0, min(b[1] for b in boxes) - PAD)
x1 = max(b[2] for b in boxes) + PAD; y1 = max(b[3] for b in boxes) + 3
os.makedirs(out, exist_ok=True)
H = round((y1 - y0) * width / (x1 - x0))
info = {'box': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)], 'size': [width, H], 'eyes': {}}
for name, (rgba, img) in cuts.items():
    c = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA').resize((width, H), Image.LANCZOS)
    c.save(os.path.join(out, name + '.webp'), quality=92, method=6)
    b, r = img[..., 2], img[..., 0]
    blue = ((b > 150) & (b - r > 80)).astype(np.uint8)
    n, lab, st, ce = cv2.connectedComponentsWithStats(blue, 8)
    comps = sorted([(st[i, cv2.CC_STAT_AREA], i) for i in range(1, n) if ce[i][1] < y0 + (y1 - y0) * .6], reverse=True)[:2]
    k = width / (x1 - x0)
    info['eyes'][name] = sorted([[round((ce[i][0] - x0) * k, 1), round((ce[i][1] - y0) * k, 1)] for _, i in comps])
json.dump(info, open(os.path.join(out, 'frame.json'), 'w'), indent=1)
print(json.dumps(info))
