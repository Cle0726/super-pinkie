"""碧琪形态 v2：把网页版 GPT 出的图拆成舞台图层。
hero.png（带场景）→ plate.webp（角色挖掉补好的背景）+ char.webp（透明角色，按 hero 坐标裁）+ layout（角色在 hero 里的位置）
cheer.png / hurt.png（纯色底姿势图）→ cheer.webp / hurt.webp（透明、裁边）
遮罩来自 masks.swift（macOS Vision）。用法：python layers.py RAW_V2_DIR OUT_DIR form...
"""
import sys, os, json, subprocess
import numpy as np, cv2
from PIL import Image
RAW, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
def vision_mask(png, d):
    if not os.path.isdir(d) or not os.listdir(d):
        subprocess.run(['swift', os.path.join(HERE, 'masks.swift'), png, d], check=True, capture_output=True)
    ms = [np.array(Image.open(os.path.join(d, f)).convert('L')) for f in sorted(os.listdir(d)) if f.endswith('.png')]
    # 最大的那个实例就是碧琪（前景花、碎晶是小块）
    return max(ms, key=lambda m: (m > 128).sum())
def save_webp(img, path, q=86):
    img.save(path, 'WEBP', quality=q, method=6, alpha_quality=100)
    return os.path.getsize(path)
def cutout(rgb, m, pad=0.04):
    a = cv2.GaussianBlur(m, (3, 3), 0)
    ys, xs = np.where(a > 24)
    H, W = a.shape
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    p = int(max(x1 - x0, y1 - y0) * pad)
    x0, y0, x1, y1 = max(0, x0 - p), max(0, y0 - p), min(W, x1 + p), min(H, y1 + p)
    # 边缘去色溢：半透明边上的背景色往里收一点
    rgba = np.dstack([rgb, a])[y0:y1, x0:x1]
    return Image.fromarray(rgba, 'RGBA'), (x0, y0, x1, y1)
info = {}
for form in sys.argv[3:]:
    src = os.path.join(RAW, form)
    od = os.path.join(OUT, form); os.makedirs(od, exist_ok=True)
    hero = np.array(Image.open(os.path.join(src, 'hero.png')).convert('RGB'))
    H, W = hero.shape[:2]
    m = vision_mask(os.path.join(src, 'hero.png'), os.path.join(src, 'masks'))
    if m.shape != (H, W): m = cv2.resize(m, (W, H))
    char, box = cutout(hero, m, pad=0.01)
    # 舞台按 1536 宽存（模式原图 1672×941 也缩到这个宽）
    scale = 1536 / W
    if scale != 1:
        char = char.resize((round(char.width * scale), round(char.height * scale)), Image.LANCZOS)
    sizes = {'char': save_webp(char, os.path.join(od, 'char.webp'))}
    # 背景板：遮罩外扩后在 1/3 尺寸上补洞，再放大、模糊，只替换洞里的像素
    hole = cv2.dilate((m > 40).astype(np.uint8) * 255, np.ones((25, 25), np.uint8))
    small = cv2.resize(hero, (W // 3, H // 3), interpolation=cv2.INTER_AREA)
    hs = cv2.resize(hole, (W // 3, H // 3), interpolation=cv2.INTER_NEAREST)
    fill = cv2.inpaint(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), hs, 15, cv2.INPAINT_TELEA)
    fill = cv2.cvtColor(cv2.resize(fill, (W, H), interpolation=cv2.INTER_CUBIC), cv2.COLOR_BGR2RGB)
    fill = cv2.GaussianBlur(fill, (0, 0), 6)
    k = cv2.GaussianBlur(hole.astype(np.float32) / 255, (0, 0), 8)[..., None]
    plate = (hero * (1 - k) + fill * k).astype(np.uint8)
    plate = Image.fromarray(plate)
    if scale != 1: plate = plate.resize((1536, round(H * scale)), Image.LANCZOS)
    sizes['plate'] = save_webp(plate, os.path.join(od, 'plate.webp'), 82)
    full = Image.fromarray(hero)
    if scale != 1: full = full.resize((1536, round(H * scale)), Image.LANCZOS)
    sizes['hero'] = save_webp(full, os.path.join(od, 'hero.webp'), 84)
    pw, ph = plate.size
    x0, y0, x1, y1 = [v * scale for v in box]
    lay = {'w': pw, 'h': ph, 'char': [round(x0 / pw, 4), round(y0 / ph, 4), round((x1 - x0) / pw, 4), round((y1 - y0) / ph, 4)]}
    for st in ('cheer', 'hurt'):
        p = os.path.join(src, st + '.png')
        if not os.path.exists(p): continue
        img = np.array(Image.open(p).convert('RGB'))
        mm = vision_mask(p, os.path.join(src, 'masks-' + st))
        if mm.shape != img.shape[:2]: mm = cv2.resize(mm, (img.shape[1], img.shape[0]))
        c, _ = cutout(img, mm)
        c.thumbnail((900, 900), Image.LANCZOS)
        sizes[st] = save_webp(c, os.path.join(od, st + '.webp'))
        lay[st] = [c.width, c.height]
    lay['bytes'] = sizes
    info[form] = lay
    print(form, json.dumps(lay))
json.dump(info, open(os.path.join(OUT, 'layout.part.json'), 'w'), indent=1)
