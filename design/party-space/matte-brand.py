"""Deterministic matting authorized by the user; never redraw the foreground.

Input is the 2172x724 white-background brand. Keep original and output separate.
Requires Pillow and numpy. Usage: python matte-brand.py INPUT OUTPUT [PREVIEW_DIR]
"""
from pathlib import Path
from collections import deque
import sys
import numpy as np
from PIL import Image, ImageFilter


def matte(source):
    rgb = np.array(source.convert('RGB'))
    height, width = rgb.shape[:2]
    if (width, height) != (2172, 724):
        raise ValueError('Only the verified 2172×724 brand is supported')
    low = rgb.min(axis=2).astype(int)
    spread = rgb.max(axis=2).astype(int) - low
    candidate = (low >= 245) & (spread <= 14)
    background = np.zeros((height, width), dtype=bool)
    queue = deque()
    # Flood from outside, not a global white key: eyes, crown pearls and hair
    # highlights enclosed by foreground contours stay fully opaque.
    for y, x in [(0,x) for x in range(width)] + [(height-1,x) for x in range(width)] + [(y,0) for y in range(height)] + [(y,width-1) for y in range(height)]:
        if candidate[y,x] and not background[y,x]:
            background[y,x] = True; queue.append((y,x))
    # Verified negative spaces enclosed by mane curls (not eyes or pearls).
    for top,bottom,left,right in [(331,412,257,309),(552,582,219,240),(619,627,344,367),(535,547,667,683)]:
        for y,x in zip(*np.where(candidate[top:bottom,left:right])):
            yy,xx=y+top,x+left
            if not background[yy,xx]:background[yy,xx]=True;queue.append((yy,xx))
    while queue:
        y,x = queue.popleft()
        for yy,xx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
            if 0 <= yy < height and 0 <= xx < width and candidate[yy,xx] and not background[yy,xx]:
                background[yy,xx] = True; queue.append((yy,xx))
    # Chinese letter counters are background too; this region has no white
    # foreground details. Portrait whites are never treated this way.
    background[:,800:] |= candidate[:,800:]
    near_edge = np.asarray(Image.fromarray(np.uint8(background)*255).filter(ImageFilter.MaxFilter(5))) > 0
    local_dark = np.asarray(Image.fromarray(low.astype(np.uint8)).filter(ImageFilter.MinFilter(5))).astype(float)
    feather = np.ones((height,width),dtype=float)
    feather[near_edge] = np.clip((255-low[near_edge]) / np.maximum(255-local_dark[near_edge],1),0,1)
    feather[background] = 0
    alpha = np.rint(feather * 255).astype(np.uint8)
    a = np.maximum(feather[..., None], 1 / 255)
    color = np.clip((rgb.astype(float) - 255 * (1 - a)) / a, 0, 255).round().astype(np.uint8)
    color[alpha == 0] = 0
    return Image.fromarray(np.dstack([color, alpha]), 'RGBA')


if __name__ == '__main__':
    source, target = map(Path, sys.argv[1:3])
    if source.resolve() == target.resolve():
        raise SystemExit('Keep the original source; output must use a different path')
    result = matte(Image.open(source))
    result.save(target)
    alpha = np.asarray(result.getchannel('A'))
    assert np.all(alpha[0] == 0) and np.all(alpha[-1] == 0)
    assert np.all(alpha[:, 0] == 0) and np.all(alpha[:, -1] == 0)
    print({'size': result.size, 'mode': result.mode, 'transparentPixels': int((alpha == 0).sum()), 'edgePixels': int(((alpha > 0) & (alpha < 255)).sum())})
    if len(sys.argv) > 3:
        directory = Path(sys.argv[3]); directory.mkdir(parents=True, exist_ok=True)
        for name, color in [('pink', '#dfb8d0'), ('dark', '#252437'), ('blue', '#799eb8')]:
            bg = Image.new('RGBA', result.size, color)
            Image.alpha_composite(bg, result).convert('RGB').save(directory / (name + '.png'))
