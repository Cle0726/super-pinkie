"""Remove the approved logo's baked neutral checkerboard without redrawing it.

User-approved deterministic matting workflow; Pillow + numpy, no model call.
Only this verified source is supported. Never overwrite the input.
Usage: python matte-ensemble.py INPUT OUTPUT [QA_DIRECTORY]
"""
from collections import deque
from pathlib import Path
import hashlib
import sys

import numpy as np
from PIL import Image, ImageFilter


def matte(source):
    rgb = np.asarray(source.convert('RGB'))
    height, width = rgb.shape[:2]
    if (width, height) != (2172, 724):
        raise ValueError('Only the approved 2172×724 ensemble artwork is supported')
    low = rgb.min(axis=2).astype(float)
    chroma = rgb.max(axis=2).astype(float) - low
    candidate = (low >= 230) & (chroma <= 12)
    background = np.zeros((height, width), dtype=bool)
    queue = deque()

    # The outer checkerboard is connected. Additional seeds mark inspected
    # negative spaces inside a ribbon loop and between Pinkie and Twilight.
    # White eyes/highlights are separate enclosed components and stay opaque.
    seeds = [(0, x) for x in range(width)] + [(height-1, x) for x in range(width)]
    seeds += [(y, 0) for y in range(height)] + [(y, width-1) for y in range(height)]
    seeds += [(293, 843), (206, 515), (509, 236), (517, 273), (509, 244),
              (484, 246), (509, 257), (487, 236), (559, 513)]
    for y, x in seeds:
        if candidate[y, x] and not background[y, x]:
            background[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for yy, xx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
            if 0 <= yy < height and 0 <= xx < width and candidate[yy, xx] and not background[yy, xx]:
                background[yy, xx] = True
                queue.append((yy, xx))
    # The lettering region contains no opaque white objects, only pink strokes.
    background[:, 1100:] |= candidate[:, 1100:]
    # One isolated 6×9 generation fleck floats above Twilight's horn; this
    # inspected rectangle contains no part of the approved character outline.
    background[197:213, 874:887] = True

    # Estimate the local neutral matte from adjacent known background pixels.
    # Unlike a white color key this also removes the gray checkerboard fringe.
    summed = np.zeros((height, width), dtype=float)
    samples = np.zeros((height, width), dtype=float)
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            y0, y1 = max(0, -dy), min(height, height-dy)
            x0, x1 = max(0, -dx), min(width, width-dx)
            mask = background[y0+dy:y1+dy, x0+dx:x1+dx]
            summed[y0:y1, x0:x1] += low[y0+dy:y1+dy, x0+dx:x1+dx] * mask
            samples[y0:y1, x0:x1] += mask
    matte_value = np.divide(summed, samples, out=np.full_like(summed, 250), where=samples > 0)
    near = np.asarray(Image.fromarray(background.astype('uint8') * 255).filter(ImageFilter.MaxFilter(5))) > 0
    strength = np.maximum(chroma, np.maximum(matte_value-low, 0))
    local_strength = np.asarray(Image.fromarray(strength.clip(0, 255).astype('uint8')).filter(ImageFilter.MaxFilter(5)))
    alpha = np.ones((height, width), dtype=float)
    alpha[near] = np.clip(strength[near] / np.maximum(local_strength[near], 1), 0, 1)
    alpha[background] = 0
    alpha8 = np.rint(alpha * 255).astype('uint8')
    divisor = np.maximum(alpha[..., None], 1 / 255)
    color = np.clip((rgb.astype(float) - matte_value[..., None] * (1-divisor)) / divisor, 0, 255).round().astype('uint8')
    color[alpha8 == 0] = 0
    return Image.fromarray(np.dstack([color, alpha8]))


if __name__ == '__main__':
    source, target = map(Path, sys.argv[1:3])
    if source.resolve() == target.resolve():
        raise SystemExit('Keep the approved original; output must be separate')
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != '486c4796bf9baeb0b97287f3578f82c57a8bf4600a8107fafa851ca8f221adee':
        raise SystemExit('The source is not the approved ensemble image; do not reuse these masks')
    original = Image.open(source)
    result = matte(original)
    result.save(target)
    a = np.asarray(result.getchannel('A'))
    assert not a[0].any() and not a[-1].any() and not a[:, 0].any() and not a[:, -1].any()
    print({'size': result.size, 'mode': result.mode, 'sourceSha256': digest,
           'transparent': int((a == 0).sum()), 'antialiased': int(((a > 0) & (a < 255)).sum())})
    if len(sys.argv) > 3:
        qa = Path(sys.argv[3])
        qa.mkdir(parents=True, exist_ok=True)
        for name, color in [('dark', '#252437'), ('pink', '#dfb8d0'), ('blue', '#799eb8')]:
            composite = Image.alpha_composite(Image.new('RGBA', result.size, color), result).convert('RGB')
            composite.save(qa / (name + '.png'))
            composite.resize((240, 80), Image.Resampling.LANCZOS).save(qa / (name + '-sidebar.png'))
        original.crop((460, 165, 570, 260)).resize((660, 570)).save(qa / 'hair-gap-source.png')
        result.crop((760, 275, 890, 445)).resize((520, 680)).save(qa / 'twilight-gap-alpha.png')
