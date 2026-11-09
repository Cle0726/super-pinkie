#!/usr/bin/env python3
"""候选图拼一张对比表（挑图用）。用法: 工具/py 工具/sheet.py <输出.jpg> <名1> [<名2> ...]   名=临时/生成/<名>/ 下的候选"""
import glob, sys
from PIL import Image, ImageDraw
out, names = sys.argv[1], sys.argv[2:]
tiles = []
for n in names:
    for p in sorted(glob.glob(f'临时/生成/{n}/*候选*.png')):
        im = Image.open(p).convert('RGB').resize((400, 600))
        ImageDraw.Draw(im).text((10, 10), p.split('/')[-1].replace('.png', ''), fill=(255, 0, 0))
        tiles.append(im)
s = Image.new('RGB', (400 * max(1, len(tiles)), 600))
for i, t in enumerate(tiles):
    s.paste(t, (400 * i, 0))
s.save(out, quality=85)
