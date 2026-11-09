#!/usr/bin/env python3
"""贴纸切图：把「白底上的一张贴纸表」（2×2、2×3 等网格）切成一张张带白色描边的透明 PNG。
通用版：不绑定项目目录，输出位置可以指定。

用法:
  python sticker.py 贴纸表.png 前缀 [--out 输出目录] [--border 18] [--min 0.004] [--group 28] [--tol 26]

输出: 输出目录/<前缀>-1.png、-2.png …（从上到下、从左到右编号），并打印每张的中心位置和尺寸。
"""
import argparse, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def main():
    ap = argparse.ArgumentParser(description="把贴纸表切成透明贴纸")
    ap.add_argument("src", help="贴纸表图片（白底多格）")
    ap.add_argument("prefix", help="输出文件前缀")
    ap.add_argument("--out", default="", help="输出目录，默认 ./stickers")
    ap.add_argument("--border", type=int, default=18, help="白描边宽度（像素）")
    ap.add_argument("--min", type=float, default=0.004, help="小于整图面积这个比例的块丢掉")
    ap.add_argument("--group", type=int, default=28, help="相距小于这么多像素的块并成一张")
    ap.add_argument("--tol", type=float, default=26, help="背景色容差")
    a = ap.parse_args()

    out = a.out or os.path.join(os.getcwd(), "stickers")
    os.makedirs(out, exist_ok=True)

    im0 = Image.open(a.src)
    rgb = np.asarray(im0.convert("RGB")).astype(np.float32)
    H, W, _ = rgb.shape
    HAS_ALPHA = im0.mode == "RGBA" and np.asarray(im0)[..., 3].min() < 250
    b = min(12, max(2, min(H, W) // 40))
    border = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3), rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    bg = np.median(border, 0)
    dist = np.linalg.norm(rgb - bg, axis=-1)
    near = dist < a.tol
    lbl, _ = ndi.label(near)
    edge_ids = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
    edge_ids = edge_ids[edge_ids > 0]
    bgmask = np.isin(lbl, edge_ids)
    fg = ~bgmask
    fg = ndi.binary_opening(fg, iterations=2)
    fg = ndi.binary_fill_holes(fg) | (fg & ~bgmask)
    if HAS_ALPHA:
        alpha_in = np.asarray(im0)[..., 3].astype(np.float32) / 255
        fg = alpha_in > 0.5
    soft = np.clip((dist - a.tol * 0.45) / (a.tol * 0.55), 0, 1)
    alpha = np.where(fg, 1.0, 0.0)
    edge = fg ^ ndi.binary_erosion(fg, iterations=1)
    alpha[edge] = np.maximum(soft[edge], 0.35)
    if HAS_ALPHA:
        alpha = alpha_in

    grp, n = ndi.label(ndi.binary_dilation(fg, iterations=a.group))
    items = []
    for i in range(1, n + 1):
        m = (grp == i) & fg
        area = m.sum()
        if area < a.min * H * W:
            continue
        ys, xs = np.where(m)
        items.append((ys.mean(), xs.mean(), m))
    items.sort(key=lambda t: (round(t[0] / (H / 4)), t[1]))
    R = a.border
    for k, (cy, cx, m) in enumerate(items, 1):
        al = np.where(m, alpha, 0)
        d = ndi.distance_transform_edt(al < 0.5)
        rim = np.clip(R + 1 - d, 0, 1)
        ys, xs = np.where(rim > 0)
        y0, y1 = max(0, ys.min() - 4), min(H, ys.max() + 5)
        x0, x1 = max(0, xs.min() - 4), min(W, xs.max() + 5)
        c = rgb[y0:y1, x0:x1]
        A = al[y0:y1, x0:x1][..., None]
        outimg = c * A + 255 * (1 - A)
        alpha_out = np.maximum(al[y0:y1, x0:x1], rim[y0:y1, x0:x1])
        img = np.dstack([outimg, alpha_out[..., None] * 255]).clip(0, 255).astype(np.uint8)
        p = os.path.join(out, f"{a.prefix}-{k}.png")
        Image.fromarray(img, "RGBA").save(p)
        print(f"{p}  中心=({cx / W:.2f},{cy / H:.2f})  尺寸={x1 - x0}x{y1 - y0}")
    print(f"共 {len(items)} 张 → {out}")
    return 0 if items else 1


if __name__ == "__main__":
    sys.exit(main())
