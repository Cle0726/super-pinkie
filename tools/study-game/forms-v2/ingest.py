#!/usr/bin/env python3
"""形态 v2 入库：art/study-game/v2/layers/<id>/ → ui/assets/study-game/form/<id>/，并更新 manifest.json。
portrait = 透明角色（舞台网格用、旧代码当立绘用），plate = 挖掉角色的场景，ult = 主视觉（大招 / 卡片），
cheer / hurt = 答对 / 答错姿势，icon = 从角色裁的头像。plate 槽位带 layout（角色在场景里的位置）。"""
import json, os, sys, datetime
import numpy as np
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
LAY = '/Users/Admin/release-superpinkie/art/study-game/v2/layers'
OUT = os.path.join(ROOT, 'ui/assets/study-game')
man = json.load(open(os.path.join(OUT, 'manifest.json')))
layout = {}
for part in ('layout.part.json',):
    layout.update(json.load(open(os.path.join(LAY, part))))
today = datetime.date.today().isoformat()
def put(slot, path, **extra):
    im = Image.open(path)
    man['slots'][slot] = {'file': os.path.relpath(path, OUT), 'w': im.width, 'h': im.height, 'bytes': os.path.getsize(path), 'source': 'chatgpt-web', 'date': today, **extra}
SRC = {'unrestricted': 'rainbow'}
for fid in sys.argv[1:]:
    sk = SRC.get(fid, fid); src = os.path.join(LAY, sk); dst = os.path.join(OUT, 'form', fid); os.makedirs(dst, exist_ok=True)
    for old in os.listdir(dst): os.remove(os.path.join(dst, old))
    for name, slot in (('char', 'portrait'), ('plate', 'plate'), ('hero', 'ult'), ('cheer', 'cheer'), ('hurt', 'hurt')):
        s = os.path.join(src, name + '.webp')
        if not os.path.exists(s): continue
        d = os.path.join(dst, slot + '.webp'); open(d, 'wb').write(open(s, 'rb').read())
        extra = {'layout': {'char': layout[sk]['char'], 'w': layout[sk]['w'], 'h': layout[sk]['h']}} if slot == 'plate' else {}
        put(f'form/{fid}/{slot}', d, **extra)
    # 头像：角色上部 alpha 质心附近的方块
    ch = Image.open(os.path.join(src, 'char.webp')).convert('RGBA'); a = np.array(ch)[..., 3]
    H, W = a.shape; top = a[: int(H * .32)]
    ys, xs = np.nonzero(top > 128)
    cx = int(xs.mean()) if len(xs) else W // 2
    side = int(min(W, H * .5)); cy = int(H * .2)
    x0 = max(0, min(W - side, cx - side // 2)); y0 = max(0, min(H - side, cy - side // 2))
    icon = ch.crop((x0, y0, x0 + side, y0 + side)).resize((256, 256), Image.LANCZOS)
    d = os.path.join(dst, 'icon.webp'); icon.save(d, 'WEBP', quality=86, alpha_quality=100); put(f'form/{fid}/icon', d, source='derived', **{'from': f'form/{fid}/portrait'})
    man['slots'].pop(f'form/{fid}/idle', None)
man['updatedAt'] = today
json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', sys.argv[1:])
