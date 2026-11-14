# 形态 v4 入库（Windows 侧）：forms-v4-src.mjs 出的原图 → ui/assets/study-game/form/<id>/，登记 manifest.json / PROVENANCE.json。
# 用法：<带 torch 的 python> tools/study-game/art/ingest-forms-v4.py [id,id,...] [--char=id,id]
#   <art>/v4/raw/forms/<id>-hero.png   场景里的全身主视觉 → ult.webp；BiRefNet 把她从场景里抠出来 → portrait.webp，并记下她在画面里的位置（plate 的 layout）
#   <id>-cheer.png / <id>-hurt.png      灰底姿势 → 抠图 → cheer.webp / hurt.webp
#   <id>-plate.png                      同一场景的空镜 → plate.webp（没有就不登记，舞台退回 ult）
#   <id>-avatar.png                     胸像 → avatar.webp（512）+ avatar-256.webp
#   --char=id：这个形态从场景里抠得不干净，改用 <id>-char.png（灰底重画的同一站姿）当 portrait
# 本机 python：F:\慢半拍-项目\慢半拍\工具\venv（CUDA 版 torch + BiRefNet 缓存）。幂等：原图没变的跳过。
import json, os, sys, time
import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
ART = os.path.abspath(os.environ.get('STUDY_GAME_ART') or os.path.join(REPO, '..', 'super-pinkie-handoff', 'art', 'study-game'))
RAW = os.path.join(ART, 'v4', 'raw', 'forms')
OUT = os.path.join(REPO, 'ui', 'assets', 'study-game')
TODAY = time.strftime('%Y-%m-%d')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
use_char = set(next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--char=')), '').split(',')) - {''}
force = '--force' in sys.argv
ids = args[0].split(',') if args else sorted({f.rsplit('-', 1)[0] for f in os.listdir(RAW) if f.endswith('-hero.png')})

dev = 'cuda' if torch.cuda.is_available() else 'cpu'
model = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).to(dev).eval()
if dev == 'cuda':
    model.half()
tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])


def alpha_of(im):
    x = tf(im).unsqueeze(0).to(dev)
    with torch.no_grad():
        p = model(x.half() if dev == 'cuda' else x)[-1].sigmoid().float().cpu()[0, 0].numpy()
    a = cv2.resize(p, im.size, interpolation=cv2.INTER_CUBIC).clip(0, 1)
    hard = (a > .5).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard)
    if n > 2:  # 只留最大的一块和贴着它的碎片
        main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = np.isin(lab, [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > stats[main, cv2.CC_STAT_AREA] * .004]).astype(np.uint8)
        a = a * cv2.dilate(keep, np.ones((9, 9), np.uint8))
    return np.clip((a - .1) / .8, 0, 1)


def defringe(rgba, rounds=6):
    """半透明边上的原背景色收掉：颜色从已经不透明的像素往外扩。"""
    a = rgba[..., 3]
    color = rgba[..., :3].astype(np.float32)
    known = a > 215
    if not known.any():
        return rgba
    for _ in range(rounds):
        grow = (cv2.dilate(known.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) & ~known & (a > 10)
        if not grow.any():
            break
        w = known.astype(np.float32)
        acc = cv2.blur(color * w[..., None], (5, 5)); den = cv2.blur(w, (5, 5))[..., None]
        color[grow] = (acc / np.maximum(den, 1e-3))[grow]
        known |= grow
    out = rgba.copy(); edge = (a > 0) & (a < 250)
    out[..., :3][edge] = np.clip(color[edge], 0, 255).astype(np.uint8)
    return out


def cut(path, max_h=900):
    """抠出主体 → (RGBA 图, 她在原图里的框 [x, y, w, h]，0–1)"""
    im = Image.open(path).convert('RGB'); W, H = im.size
    a = alpha_of(im)
    rgba = defringe(np.dstack([np.asarray(im), (a * 255).astype(np.uint8)]))
    ys, xs = np.where(a > .04)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    out = Image.fromarray(rgba, 'RGBA').crop((x0, y0, x1, y1))
    if out.height > max_h:
        out = out.resize((round(out.width * max_h / out.height), max_h), Image.LANCZOS)
    return out, [round(x0 / W, 4), round(y0 / H, 4), round((x1 - x0) / W, 4), round((y1 - y0) / H, 4)]


def icon_from(char):
    a = np.array(char)[..., 3]; H, W = a.shape
    ys, xs = np.nonzero(a[: int(H * .32)] > 128)
    cx = int(xs.mean()) if len(xs) else W // 2
    side = int(min(W, H * .5)); cy = int(H * .2)
    x0 = max(0, min(W - side, cx - side // 2)); y0 = max(0, min(H - side, cy - side // 2))
    return char.crop((x0, y0, x0 + side, y0 + side)).resize((256, 256), Image.LANCZOS)


man_path = os.path.join(OUT, 'manifest.json'); prov_path = os.path.join(OUT, 'PROVENANCE.json')
man = json.load(open(man_path, encoding='utf-8')); prov = json.load(open(prov_path, encoding='utf-8'))


def put(slot, im, q, note, src, **extra):
    dest = os.path.join(OUT, slot + '.webp'); os.makedirs(os.path.dirname(dest), exist_ok=True)
    im.save(dest, 'WEBP', quality=q, method=6, alpha_quality=100)
    man['slots'][slot] = {'file': slot + '.webp', 'w': im.width, 'h': im.height, 'bytes': os.path.getsize(dest), 'source': 'chatgpt-web', 'date': TODAY, 'rawMtime': int(os.path.getmtime(src) * 1000), **extra}
    prov.setdefault('v4', {})[slot] = {'raw': os.path.basename(src), 'tool': 'tools/study-game/art/gpt-web-batch.mjs', 'prompt': 'tools/study-game/art/forms-v4-src.mjs', 'date': TODAY, 'note': note}


def fresh(slot, src):
    return not force and man['slots'].get(slot, {}).get('rawMtime') == int(os.path.getmtime(src) * 1000)


done = []
for fid in ids:
    p = lambda name: os.path.join(RAW, f'{fid}-{name}.png')
    if not os.path.exists(p('hero')):
        print('skip (no hero)', fid); continue
    base = f'form/{fid}'
    char_src = p('char') if fid in use_char and os.path.exists(p('char')) else p('hero')
    box = man['slots'].get(f'{base}/portrait', {}).get('box')
    if not fresh(f'{base}/portrait', char_src) or not box:
        char, hero_box = cut(char_src)
        if char_src != p('hero'):
            _, hero_box = cut(p('hero'))
        put(f'{base}/portrait', char, 86, '从主视觉里抠出来的全身立绘' if char_src == p('hero') else '灰底重画的同一站姿，抠图', char_src, box=hero_box)
        man['slots'][f'{base}/icon'] = None
        icon = icon_from(char); ip = os.path.join(OUT, base, 'icon.webp'); icon.save(ip, 'WEBP', quality=86, method=6, alpha_quality=100)
        man['slots'][f'{base}/icon'] = {'file': f'{base}/icon.webp', 'w': 256, 'h': 256, 'bytes': os.path.getsize(ip), 'source': 'derived', 'date': TODAY, 'from': f'{base}/portrait'}
        box = hero_box
    if not fresh(f'{base}/ult', p('hero')):
        im = Image.open(p('hero')).convert('RGB')
        if im.width > 1536: im = im.resize((1536, round(im.height * 1536 / im.width)), Image.LANCZOS)
        put(f'{base}/ult', im, 84, '主视觉（角色在场景里）', p('hero'))
    for pose in ('cheer', 'hurt'):
        if os.path.exists(p(pose)) and not fresh(f'{base}/{pose}', p(pose)):
            put(f'{base}/{pose}', cut(p(pose))[0], 86, '灰底姿势，抠图', p(pose))
    if os.path.exists(p('plate')) and not fresh(f'{base}/plate', p('plate')):
        im = Image.open(p('plate')).convert('RGB').resize((1536, 1024), Image.LANCZOS)
        put(f'{base}/plate', im, 82, '同一场景的空镜（没有角色）', p('plate'), layout={'char': box, 'w': 1536, 'h': 1024})
    if os.path.exists(p('avatar')) and not fresh(f'{base}/avatar', p('avatar')):
        im = Image.open(p('avatar')).convert('RGB'); side = min(im.size)
        sq = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2))
        put(f'{base}/avatar', sq.resize((512, 512), Image.LANCZOS), 86, '胸像', p('avatar'), thumb=f'{base}/avatar-256.webp')
        sq.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, base, 'avatar-256.webp'), 'WEBP', quality=84, method=6)
    done.append(fid)
    print('ok', fid, [k.split('/')[-1] for k in man['slots'] if k.startswith(base + '/')])
man['updatedAt'] = TODAY
json.dump(man, open(man_path, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
json.dump(prov, open(prov_path, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
print('ingested', done)
