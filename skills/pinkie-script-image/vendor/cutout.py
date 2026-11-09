#!/usr/bin/env python3
"""把图从纯色背景里抠出来：透明 PNG + "纸贴纸"版（不规则白边 + 投影）。
通用版：不绑定任何项目目录，输入图片、输出目录都可以直接给。

用法:
  python cutout.py 图1.png [图2.jpg ...] [--out 输出目录] [--no-sticker]
  python cutout.py 输入目录 [--out 输出目录]

输出:
  输出目录/<名>.png         透明底
  输出目录/<名>-贴纸.png    带白纸边和投影（除非 --no-sticker）

原理: 背景 = 与四边框同色、且和图像边缘连通的区域。所以主体手里的白板、浅色道具不会被误抠。
"""
import argparse, glob, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi


def to_lab(rgb):
    c = rgb.astype(np.float32) / 255
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def cut(path, out_dir, sticker=True):
    name = os.path.splitext(os.path.basename(path))[0]
    rgb = np.asarray(Image.open(path).convert("RGB"))
    H, W, _ = rgb.shape
    lab = to_lab(rgb)
    b = min(20, max(4, min(H, W) // 20))
    border = np.concatenate([lab[:b].reshape(-1, 3), lab[-b:].reshape(-1, 3), lab[:, :b].reshape(-1, 3), lab[:, -b:].reshape(-1, 3)])
    bg_lab = np.median(border, 0)
    dist = np.linalg.norm(lab - bg_lab, axis=-1)
    bdist = np.linalg.norm(border - bg_lab, axis=-1)
    tol = float(np.clip(np.percentile(bdist, 99) + 6, 12, 26))
    near = ndi.binary_opening(dist < tol, iterations=1)
    lbl, n = ndi.label(near)
    edge_ids = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
    bg = np.isin(lbl, edge_ids[edge_ids > 0])
    subj = ~bg
    subj = ndi.binary_closing(subj, iterations=2)
    filled = ndi.binary_fill_holes(subj)
    holes = filled & ~subj
    hl, hn = ndi.label(holes)
    subj = filled.copy()
    for i in range(1, hn + 1):
        reg = hl == i
        if reg.sum() > 0.001 * H * W and np.median(dist[reg]) < tol:
            subj[reg] = False
    lbl, n = ndi.label(subj)
    if n > 1:
        sizes = ndi.sum(subj, lbl, range(1, n + 1))
        keep = np.isin(lbl, 1 + np.where(sizes >= 0.0005 * H * W)[0])
        subj = keep
    if not subj.any():
        return name, tol, 0.0, False
    a = ndi.gaussian_filter(subj.astype(np.float32), 1.1)
    a = np.clip((a - 0.15) / 0.85, 0, 1)
    bg_rgb = np.median(np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3)]), 0).astype(np.float32)
    col = rgb.astype(np.float32)
    edge = (a > 0.02) & (a < 0.98)
    aa = np.maximum(a, 0.05)[..., None]
    fixed = np.clip((col - (1 - aa) * bg_rgb) / aa, 0, 255)
    col = np.where(edge[..., None], fixed, col)
    rgba = np.dstack([col, a * 255]).astype(np.uint8)
    ys, xs = np.where(a > 0.05)
    m = max(2, min(H, W) // 60)
    y0, y1 = max(0, ys.min() - m), min(H, ys.max() + m)
    x0, x1 = max(0, xs.min() - m), min(W, xs.max() + m)
    Image.fromarray(rgba[y0:y1, x0:x1]).save(os.path.join(out_dir, f"{name}.png"))

    if sticker:
        pad = max(8, min(H, W) // 40)
        sub = np.pad(subj, pad)
        al = np.pad(a, pad)
        colp = np.pad(col, ((pad, pad), (pad, pad), (0, 0)))
        d_out = ndi.distance_transform_edt(~sub)
        rng = np.random.default_rng(abs(hash(name)) % 2 ** 32)
        noise = ndi.gaussian_filter(rng.standard_normal(sub.shape).astype(np.float32), 22)
        noise = noise / (noise.std() + 1e-6)
        fine = ndi.gaussian_filter(rng.standard_normal(sub.shape).astype(np.float32), 1.5)
        width = (13 * min(H, W) / 1024) + 4 * noise + 1.2 * fine / (fine.std() + 1e-6)
        paper = (d_out <= width) | sub
        paper = ndi.binary_fill_holes(paper)
        pa = np.clip(ndi.gaussian_filter(paper.astype(np.float32), 0.8) * 1.2 - 0.1, 0, 1)
        grain = ndi.gaussian_filter(rng.standard_normal(sub.shape).astype(np.float32), 1.0)
        paper_rgb = np.clip(np.array([247, 241, 227], np.float32) + 6 * grain[..., None], 0, 255)
        sh = ndi.shift(ndi.gaussian_filter(pa, 9), (max(2, pad // 6), 0), order=1) * 0.32
        out = np.zeros(sub.shape + (4,), np.float32)
        out_a = sh
        out_c = np.zeros(sub.shape + (3,), np.float32) + np.array([24, 20, 30], np.float32)

        def over(c_top, a_top, c_bot, a_bot):
            a_out = a_top + a_bot * (1 - a_top)
            c = (c_top * a_top[..., None] + c_bot * a_bot[..., None] * (1 - a_top[..., None])) / np.maximum(a_out[..., None], 1e-6)
            return c, a_out

        out_c, out_a = over(paper_rgb, pa, out_c, out_a)
        out_c, out_a = over(colp, al, out_c, out_a)
        out = np.dstack([out_c, out_a * 255]).astype(np.uint8)
        ys, xs = np.where(out_a > 0.02)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        Image.fromarray(out[y0:y1, x0:x1]).save(os.path.join(out_dir, f"{name}-贴纸.png"))
    return name, tol, float(subj.mean() * 100), True


def main():
    ap = argparse.ArgumentParser(description="抠图：透明底 + 纸贴纸版")
    ap.add_argument("inputs", nargs="+", help="图片文件或文件夹")
    ap.add_argument("--out", default="", help="输出目录，默认 ./cutout-out")
    ap.add_argument("--no-sticker", action="store_true", help="只要透明底，不要贴纸版")
    a = ap.parse_args()

    out_dir = a.out or os.path.join(os.getcwd(), "cutout-out")
    os.makedirs(out_dir, exist_ok=True)
    files = []
    for p in a.inputs:
        if os.path.isdir(p):
            for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp"):
                files += sorted(glob.glob(os.path.join(p, ext)))
        elif os.path.isfile(p):
            files.append(p)
    if not files:
        print("没有找到图片", file=sys.stderr)
        return 2
    ok = 0
    for f in files:
        try:
            n, tol, area, good = cut(f, out_dir, sticker=not a.no_sticker)
            if good:
                print(f"{n}: 容差 {tol:.1f}，主体占 {area:.1f}% → {out_dir}")
                ok += 1
            else:
                print(f"{n}: 没找到主体（整张都像背景色），跳过", file=sys.stderr)
        except Exception as e:
            print(f"{f}: 失败 {e}", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
