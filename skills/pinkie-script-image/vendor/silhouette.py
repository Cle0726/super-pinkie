#!/usr/bin/env python3
"""黑色剪影图 → 矢量路径（SVG path，给灯罩投影/影子戏/SVG 动画用）。
通用版：任意输入图、任意输出文件。

用法:
  python silhouette.py 输出.json 名字=图.png [名字2=图2.png ...] [--width 900] [--ts 输出.ts]

做的事：灰度 → 阈值（黑 = 形状）→ 只留最大的几块（去掉散点）→ 裁到形状边缘 → potrace 平滑描边 →
输出 JSON（默认）或 TS（--ts）：{名字: {d, w, h}}，d 是 y 向下、原点左上、单位像素的 SVG path。

没有 potrace 时退回用轮廓点拟合（精度略差但能用）。
"""
import argparse, json, os, subprocess, sys, tempfile

import numpy as np
from PIL import Image
from scipy import ndimage


def have_potrace():
    try:
        subprocess.run(["potrace", "--version"], capture_output=True, check=True)
        return True
    except Exception:
        return False


def trace(mask, width):
    """返回 SVG path 字符串。有 potrace 用 potrace，否则用轮廓简化的多边形。"""
    h, w = mask.shape
    if have_potrace():
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "in.pgm")
            Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).save(src)
            svg = os.path.join(td, "out.svg")
            subprocess.run(["potrace", src, "-s", "-o", svg, "--flat", "-u", "10"], check=True, capture_output=True)
            txt = open(svg, encoding="utf-8", errors="ignore").read()
            import re
            ds = re.findall(r'<path[^>]*\sd="([^"]+)"', txt)
            return " ".join(ds) if ds else ""
    # 兜底：找最大轮廓，按 6 像素步长抽点
    import cv2
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return ""
    c = max(cnts, key=cv2.contourArea)
    eps = 0.004 * cv2.arcLength(c, True)
    ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2)
    pts = [f"{'M' if i == 0 else 'L'} {x} {y}" for i, (x, y) in enumerate(ap)]
    return " ".join(pts) + " Z"


def main():
    ap = argparse.ArgumentParser(description="剪影转矢量路径")
    ap.add_argument("out", help="输出文件（.json 或 .ts）")
    ap.add_argument("items", nargs="+", help="名字=图.png")
    ap.add_argument("--width", type=int, default=900, help="归一化宽度")
    ap.add_argument("--ts", action="store_true", help="输出 TypeScript 而不是 JSON")
    ap.add_argument("--thr", type=int, default=128, help="灰度阈值，低于它算形状")
    a = ap.parse_args()

    res = {}
    for item in a.items:
        if "=" not in item:
            print(f"跳过（要 名字=图.png）：{item}", file=sys.stderr)
            continue
        name, png = item.split("=", 1)
        try:
            im = Image.open(png).convert("L")
            arr = np.asarray(im)
            mask = arr < a.thr
            # 去掉散点，只留较大的块
            lbl, n = ndimage.label(mask)
            if n:
                sizes = ndimage.sum(mask, lbl, range(1, n + 1))
                keep = np.isin(lbl, 1 + np.where(sizes >= max(20, 0.0002 * mask.size))[0])
                mask = keep
            ys, xs = np.where(mask)
            if not len(ys):
                print(f"{name}: 图里没有黑色形状", file=sys.stderr)
                continue
            y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            sub = mask[y0:y1, x0:x1]
            sh, sw = sub.shape
            scale = a.width / max(sw, 1)
            d = trace(sub, a.width)
            res[name] = {"d": d, "w": round(sw * scale, 1), "h": round(sh * scale, 1)}
            print(f"{name}: {sw}x{sh} → 宽 {res[name]['w']}", file=sys.stderr)
        except Exception as e:
            print(f"{name}: 失败 {e}", file=sys.stderr)

    if not res:
        return 1
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
    if a.ts:
        body = "export const SIL = {\n" + ",\n".join(
            f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in res.items()) + "\n};\n"
        open(a.out, "w", encoding="utf-8").write(body)
    else:
        json.dump(res, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
