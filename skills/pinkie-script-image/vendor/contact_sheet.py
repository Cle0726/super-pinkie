#!/usr/bin/env python3
"""候选图拼成一张对比表（挑图用）。通用版：给图片或文件夹，自动拼成网格。

用法:
  python contact_sheet.py 图1.png 图2.png ... [--out 对比表.jpg] [--cols 3] [--width 640]
  python contact_sheet.py 输出目录      # 把目录里的图片全拼起来
  python contact_sheet.py 输入目录 --out 对比表.jpg

每张图左上角标文件名，方便挑。
"""
import argparse, glob, os, sys
from PIL import Image, ImageDraw, ImageFont

EXTS = ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.bmp")
FONT_CANDIDATES = [
    "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/msyh.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    ap = argparse.ArgumentParser(description="候选图拼对比表")
    ap.add_argument("inputs", nargs="+", help="图片文件或文件夹")
    ap.add_argument("--out", default="", help="输出文件，默认 ./对比表.jpg")
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--width", type=int, default=640, help="每格宽度")
    a = ap.parse_args()

    files = []
    for p in a.inputs:
        if os.path.isdir(p):
            for e in EXTS:
                files += sorted(glob.glob(os.path.join(p, e)))
        elif os.path.isfile(p):
            files.append(p)
    files = [f for f in files if not os.path.basename(f).startswith("对比表")]
    if not files:
        print("没有找到图片", file=sys.stderr)
        return 2

    # 用第一张的宽高比决定格子高度
    with Image.open(files[0]) as im:
        ratio = im.height / im.width
    W = a.width
    H = max(80, int(W * ratio))
    cols = max(1, a.cols)
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (W * cols, H * rows), "white")
    font = load_font(max(14, W // 26))
    for i, f in enumerate(files):
        try:
            im = Image.open(f).convert("RGB").resize((W, H), Image.LANCZOS)
        except Exception as e:
            print(f"跳过 {f}: {e}", file=sys.stderr)
            continue
        dr = ImageDraw.Draw(im)
        label = os.path.basename(f)
        tw = dr.textlength(label, font=font)
        dr.rectangle([0, 0, tw + 8, font.size + 6], fill=(0, 0, 0))
        dr.text((4, 2), label, fill=(255, 235, 59), font=font)
        sheet.paste(im, ((i % cols) * W, (i // cols) * H))
    out = a.out or os.path.join(os.getcwd(), "对比表.jpg")
    sheet.save(out, quality=90)
    print(f"{len(files)} 张 → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
