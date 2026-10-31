"""Split the macro eye painting into depth layers for the opening (static/splash/regard.js).

usage: splash-layers.py ART_DIR OUT_PREVIEW.png
writes ART_DIR/splash-l-open.webp, splash-l-closed.webp  (the cat plate: flowers painted out)
       ART_DIR/splash-l-fg.webp                          (flowers + petals, RGBA, near the lens)
       ART_DIR/splash-l-mask.webp                        (R = far mosaic behind his head)
"""
import sys
import cv2, numpy as np
from PIL import Image

art, prev = sys.argv[1], sys.argv[2]
load = lambda n: np.asarray(Image.open(f'{art}/{n}').convert('RGB'))
op, cl = load('splash-macro-open.webp'), load('splash-macro-closed.webp')
H, W, _ = op.shape
f = op.astype(np.float32)
lum = f @ np.array([.2126, .7152, .0722], np.float32)
mn, mx = f.min(2), f.max(2)
flower = ((mn > 150) & ((mx - mn) < 70)).astype(np.uint8)
bright = (cv2.GaussianBlur(lum, (0, 0), 18) > 55).astype(np.uint8)

yy, xx = np.mgrid[0:H, 0:W]
# his eye is never a layer of its own: keep a generous ellipse around it on the cat plate
ex, ey = 1791, 586
eye = (((xx - ex) / 420.) ** 2 + ((yy - ey) / 300.) ** 2) < 1
n, lab, st, ce = cv2.connectedComponentsWithStats(bright, 8)
fl_frac = np.bincount(lab.ravel(), weights=flower.ravel(), minlength=n) / np.maximum(st[:, cv2.CC_STAT_AREA], 1)
petal = np.zeros((H, W), np.uint8)
for i in range(1, n):
    a = st[i, cv2.CC_STAT_AREA]; cx, cy = ce[i]
    # loose petals in the air in front of his whiskers
    if 400 < a < 60000 and fl_frac[i] > .22 and cy > H * .45 and cx > W * .3 and cx < W * .6: petal[lab == i] = 1
# the flowering branch near the lens: petals and gold in the lower left, gated softly (no seams)
sm = lambda x, e0, e1: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
gate = sm(yy, H * .46, H * .60) * sm(-xx, -W * .50, -W * .40)
r_, g_, b_ = f[..., 0], f[..., 1], f[..., 2]
gold = (r_ > 110) & (r_ >= g_) & (g_ > b_) & ((r_ - b_) > 45)
core = ((flower == 1) | gold | (lum > 120)) & ~eye
core = cv2.morphologyEx(core.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
fa = np.clip(cv2.GaussianBlur(core.astype(np.float32), (0, 0), 1.6) * 1.25, 0, 1) * gate
fa = np.maximum(fa, cv2.GaussianBlur(petal.astype(np.float32), (0, 0), 2.5))
fgm = (fa > .08).astype(np.uint8)
bg = ((bright == 1) & ~eye).astype(np.float32) * (1 - gate) * (yy < H * .7)
ba = cv2.GaussianBlur(bg.astype(np.float32), (0, 0), 14)

# the plate under the flowers: paint them out (at half size, Telea), so a parallax shift never doubles them
hole = cv2.dilate((fa > .3).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (23, 23)))
def plate(img):
    sm = cv2.resize(img, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    hs = cv2.resize(hole, (W // 2, H // 2), interpolation=cv2.INTER_NEAREST)
    bgr = cv2.cvtColor(sm, cv2.COLOR_RGB2BGR)
    fill = cv2.cvtColor(cv2.inpaint(bgr, hs, 6, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB)
    fill = cv2.resize(fill, (W, H), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    # keep the painting's grain in the fill: add back high frequencies from a darkened copy of the fur
    k = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 2.5)[..., None]
    return (img * (1 - k) + fill * .7 * k).astype(np.uint8)
po, pc = plate(op), plate(cl)
Image.fromarray(po).save(f'{art}/splash-l-open.webp', quality=90, method=6)
Image.fromarray(pc).save(f'{art}/splash-l-closed.webp', quality=90, method=6)
Image.fromarray(np.dstack([op, (fa * 255).clip(0, 255).astype(np.uint8)])).save(f'{art}/splash-l-fg.webp', quality=90, method=6)
m = np.zeros((H, W, 3), np.uint8); m[..., 0] = (ba * 255).clip(0, 255)
Image.fromarray(m).save(f'{art}/splash-l-mask.webp', lossless=True)

v = np.zeros((H, W, 3), np.float32)
v += po * .35; v[..., 0] += ba * 160; v[..., 1] += fa * 200
Image.fromarray(v.clip(0, 255).astype(np.uint8)).resize((1280, 720)).save(prev)
print('fg', round(float(fa.mean()), 3), 'bg', round(float(ba.mean()), 3))
