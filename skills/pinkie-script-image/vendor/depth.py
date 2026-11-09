#!/usr/bin/env python3
"""给图片算深度图（Depth Anything V2 Small），让静图能做 2.5D 视差「活」起来。
通用版：任意输入图、任意输出目录。

用法:
  python depth.py 图1.jpg [图2.png ...] [--out 输出目录]
  python depth.py 输入目录 --out 输出目录

输出:
  输出目录/<名>.png      灰度深度图（越亮越近，尺寸 720x1080 以内）
  --relief 时另出 <名>-浮雕.png（石刻/浮雕重新打光用）

第一次跑会下载模型（约 100 MB，缓存在 ~/.cache/huggingface）。有 N 卡自动走 CUDA。
"""
import argparse, glob, os, sys
import numpy as np
from PIL import Image, ImageFilter

MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
EXTS = ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp")


def main():
    ap = argparse.ArgumentParser(description="深度图（Depth Anything V2 Small）")
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", default="", help="输出目录，默认 ./depth-out")
    ap.add_argument("--relief", action="store_true", help="另出浮雕高度图")
    ap.add_argument("--size", default="720x1080", help="深度图尺寸，默认 720x1080")
    a = ap.parse_args()

    import torch
    from scipy import ndimage as ndi
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    out_dir = a.out or os.path.join(os.getcwd(), "depth-out")
    os.makedirs(out_dir, exist_ok=True)
    files = []
    for p in a.inputs:
        if os.path.isdir(p):
            for e in EXTS:
                files += sorted(glob.glob(os.path.join(p, e)))
        elif os.path.isfile(p):
            files.append(p)
    if not files:
        print("没有找到图片", file=sys.stderr)
        return 2

    dev = "cuda" if torch.cuda.is_available() else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
    try:
        w, h = (int(x) for x in a.size.lower().split("x"))
    except Exception:
        w, h = 720, 1080
    print(f"设备 {dev}，模型 {MODEL}", file=sys.stderr)
    proc = AutoImageProcessor.from_pretrained(MODEL)
    net = AutoModelForDepthEstimation.from_pretrained(MODEL).to(dev).eval()

    ok = 0
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        try:
            im = Image.open(f).convert("RGB")
            inputs = proc(images=im, return_tensors="pt").to(dev)
            with torch.no_grad():
                pred = net(**inputs).predicted_depth
            d = torch.nn.functional.interpolate(pred.unsqueeze(1), size=im.size[::-1], mode="bicubic", align_corners=False)[0, 0]
            d = (d - d.min()) / (d.max() - d.min() + 1e-8)
            arr = (d.cpu().numpy() * 255).astype(np.uint8)
            # 前景边缘向外扩一点再柔化：视差时前景不会被背景撕开
            arr = ndi.maximum_filter(arr, size=3)
            arr = ndi.gaussian_filter(arr.astype(np.float32), 1.2)
            dimg = Image.fromarray(arr.astype(np.uint8)).resize((w, h), Image.BILINEAR)
            p1 = os.path.join(out_dir, f"{name}.png")
            dimg.save(p1)
            print(p1)
            if a.relief:
                hp = dimg.filter(ImageFilter.UnsharpMask(radius=3, percent=180, threshold=1))
                p2 = os.path.join(out_dir, f"{name}-浮雕.png")
                hp.save(p2)
                print(p2)
            ok += 1
        except Exception as e:
            print(f"{f}: 失败 {e}", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
