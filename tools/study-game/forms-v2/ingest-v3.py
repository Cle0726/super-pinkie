#!/usr/bin/env python3
"""形态 v3 入库（REDO-1109 E4）。

layers.py 已经把过审的 hero / cheer / hurt 拆成 art/study-game/v3/layers/<id>/。
本脚本：
- 6 个重画 / 新形态：char→portrait、plate、hero→ult、cheer、hurt，并按 v2 的办法重裁 icon
- 12 个形态的 avatar：居中裁正方形，写 512 的 avatar.webp 和 256 的 avatar-256.webp
- 营地 day / night 换成湖边营地
边缘半透明像素换成邻近不透明像素的颜色，避免换到营地背景时露出原场景的色边。
"""
import datetime, json, os
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
LAY = '/Users/Admin/release-superpinkie/art/study-game/v3/layers'
RAW = '/Users/Admin/release-superpinkie/art/study-game/raw/v3'
OUT = os.path.join(ROOT, 'ui/assets/study-game')
TODAY = datetime.date.today().isoformat()
REDRAW = ['daily', 'unrestricted', 'breezie', 'changeling', 'lidong', 'detective']
AVATAR = ['daily', 'unrestricted', 'alicorn', 'crystal', 'seapony', 'kirin', 'batpony', 'serious', 'breezie', 'changeling', 'lidong', 'detective']

man = json.load(open(os.path.join(OUT, 'manifest.json')))
prov_path = os.path.join(OUT, 'PROVENANCE.json')
prov = json.load(open(prov_path))
layout = json.load(open(os.path.join(LAY, 'layout.part.json')))

def put(slot, path, **extra):
    im = Image.open(path)
    man['slots'][slot] = {'file': os.path.relpath(path, OUT), 'w': im.width, 'h': im.height,
                          'bytes': os.path.getsize(path), 'source': extra.pop('source', 'chatgpt-web'),
                          'date': TODAY, **extra}

def save_webp(im, path, q=86):
    im.save(path, 'WEBP', quality=q, method=6, alpha_quality=100)

def defringe(im, rounds=6):
    """半透明边上的原背景色收掉：颜色从已经不透明的像素往外扩。"""
    rgba = np.array(im.convert('RGBA'))
    a = rgba[..., 3]
    color = rgba[..., :3].astype(np.float32)
    known = a > 210
    if not known.any():
        return im
    for _ in range(rounds):
        dil = cv2.dilate(known.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        grow = dil & ~known & (a > 12)
        if not grow.any():
            break
        w = known.astype(np.float32)
        acc = cv2.blur(color * w[..., None], (5, 5))
        den = cv2.blur(w, (5, 5))[..., None]
        color[grow] = (acc / np.maximum(den, 1e-3))[grow]
        known |= grow
    out = rgba.copy()
    edge = (a > 0) & (a < 250)
    out[..., :3][edge] = np.clip(color[edge], 0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

def icon_from(char):
    a = np.array(char.convert('RGBA'))[..., 3]
    H, W = a.shape
    top = a[: int(H * .32)]
    ys, xs = np.nonzero(top > 128)
    cx = int(xs.mean()) if len(xs) else W // 2
    side = int(min(W, H * .5))
    cy = int(H * .2)
    x0 = max(0, min(W - side, cx - side // 2))
    y0 = max(0, min(H - side, cy - side // 2))
    return char.crop((x0, y0, x0 + side, y0 + side)).resize((256, 256), Image.LANCZOS)

for fid in REDRAW:
    src = os.path.join(LAY, fid)
    dst = os.path.join(OUT, 'form', fid)
    os.makedirs(dst, exist_ok=True)
    lay = layout[fid]
    mapping = [('char', 'portrait', 86), ('plate', 'plate', 82), ('hero', 'ult', 84), ('cheer', 'cheer', 86), ('hurt', 'hurt', 86)]
    for name, slot, q in mapping:
        im = Image.open(os.path.join(src, name + '.webp'))
        if slot != 'plate' and slot != 'ult':
            im = defringe(im)
        path = os.path.join(dst, slot + '.webp')
        save_webp(im, path, q)
        extra = {}
        if slot == 'plate':
            extra['layout'] = {'char': lay['char'], 'w': lay['w'], 'h': lay['h']}
        put(f'form/{fid}/{slot}', path, **extra)
        prov['items'][f'form/{fid}/{slot}'] = {
            'source': 'chatgpt-web', 'prompt': 'art/study-game/v3/prompts.json',
            'reviewed': '2026-11-09',
            'note': 'v3 过审原图，Vision 抠图后入库' + ('；边缘去了原场景色溢' if slot in ('portrait', 'cheer', 'hurt') else ''),
        }
    char = defringe(Image.open(os.path.join(src, 'char.webp')))
    icon = icon_from(char)
    ip = os.path.join(dst, 'icon.webp')
    save_webp(icon, ip, 86)
    put(f'form/{fid}/icon', ip, source='derived', **{'from': f'form/{fid}/portrait'})
    prov['items'][f'form/{fid}/icon'] = {'source': 'derived', 'prompt': '', 'reviewed': TODAY, 'note': '从 v3 portrait 上部裁的头像，avatar 缺失时退回'}

for fid in AVATAR:
    src = os.path.join(RAW, fid, 'avatar.png')
    im = Image.open(src).convert('RGB')
    side = min(im.size)
    x0 = (im.width - side) // 2
    y0 = (im.height - side) // 2
    sq = im.crop((x0, y0, x0 + side, y0 + side))
    dst = os.path.join(OUT, 'form', fid)
    os.makedirs(dst, exist_ok=True)
    big = os.path.join(dst, 'avatar.webp')
    small = os.path.join(dst, 'avatar-256.webp')
    save_webp(sq.resize((512, 512), Image.LANCZOS), big, 86)
    save_webp(sq.resize((256, 256), Image.LANCZOS), small, 84)
    put(f'form/{fid}/avatar', big, source='chatgpt-web', thumb='form/%s/avatar-256.webp' % fid)
    prov['items'][f'form/{fid}/avatar'] = {
        'source': 'chatgpt-web', 'prompt': 'art/study-game/v3/prompts.json',
        'reviewed': '2026-11-09',
        'note': 'v3 胸像，居中裁正方形后 512；另存 256 的 avatar-256.webp',
    }

for name, q in (('day', 84), ('night', 84)):
    im = Image.open(os.path.join(RAW, 'camp', name + '.png')).convert('RGB')
    path = os.path.join(OUT, 'camp', name + '.webp')
    save_webp(im, path, q)
    put(f'camp/{name}', path)
    prov['items'][f'camp/{name}'] = {
        'source': 'chatgpt-web', 'prompt': 'art/study-game/v3/prompts.json',
        'reviewed': '2026-11-09',
        'note': 'v3 湖边上岸营地' + ('清晨' if name == 'day' else '夜晚') + '，画面里没有角色',
    }

man['updatedAt'] = TODAY
json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
json.dump(prov, open(prov_path, 'w'), ensure_ascii=False, indent=1)
print('ingested', REDRAW, 'avatars', len(AVATAR), 'camp')
