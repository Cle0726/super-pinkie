# v4 怪物抠图（Windows 侧）：BiRefNet 软边遮罩 → 去灰底色边 → 裁到主体 + 留边 → RGBA png。
# 用法：<带 torch/transformers 的 python> tools/study-game/art/matte-v4.py <原图目录> <输出目录> [前缀=mon-]
# 本机用的是 F:\慢半拍-项目\慢半拍\工具\venv（有 CUDA 版 torch 和 BiRefNet 缓存）。之后 ingest-v4.py <输出目录> 入库。
import os, sys
import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

raw, out = sys.argv[1], sys.argv[2]
prefix = sys.argv[3] if len(sys.argv) > 3 else 'mon-'
os.makedirs(out, exist_ok=True)
dev = 'cuda' if torch.cuda.is_available() else 'cpu'
model = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).to(dev).eval()
if dev == 'cuda':
    model.half()
tf = transforms.Compose([transforms.Resize((1024, 1024)), transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
for name in sorted(os.listdir(raw)):
    if not (name.startswith(prefix) and name.lower().endswith('.png')):
        continue
    dest = os.path.join(out, name)
    if os.path.exists(dest) and os.path.getmtime(dest) >= os.path.getmtime(os.path.join(raw, name)):
        continue
    im = Image.open(os.path.join(raw, name)).convert('RGB'); W, H = im.size
    x = tf(im).unsqueeze(0).to(dev)
    with torch.no_grad():
        p = model(x.half() if dev == 'cuda' else x)[-1].sigmoid().float().cpu()[0, 0].numpy()
    a = cv2.resize(p, (W, H), interpolation=cv2.INTER_CUBIC).clip(0, 1)
    # 只留最大的连通块和贴着它的碎片（声波线、飞溅之类保留；远处的噪点丢掉）
    hard = (a > .5).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(hard)
    if n > 2:
        main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = np.isin(lab, [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > stats[main, cv2.CC_STAT_AREA] * .002]).astype(np.uint8)
        a = a * cv2.dilate(keep, np.ones((9, 9), np.uint8))
    a = np.clip((a - .08) / .84, 0, 1)
    rgb = np.asarray(im).astype(np.float32)
    # 去色边：半透明边缘按「观察色 = 前景 × a + 底色 × (1 − a)」反解前景。底色取四角的中位数。
    c = 24; bg = np.median(np.concatenate([rgb[:c, :c].reshape(-1, 3), rgb[:c, -c:].reshape(-1, 3), rgb[-c:, :c].reshape(-1, 3), rgb[-c:, -c:].reshape(-1, 3)]), axis=0)
    aa = a[..., None]
    edge = (aa > .02) & (aa < .98)
    fg = np.where(edge, (rgb - bg * (1 - aa)) / np.maximum(aa, .12), rgb).clip(0, 255)
    rgba = np.dstack([fg, a * 255]).astype(np.uint8)
    ys, xs = np.where(a > .03)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = int(max(x1 - x0, y1 - y0) * 1.08); cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(Image.fromarray(rgba).crop((x0, y0, x1, y1)), (side // 2 - (cx - x0), side // 2 - (cy - y0)))
    canvas.save(dest)
    print('ok', name, canvas.size, f'{(a > .5).mean() * 100:.0f}%')
