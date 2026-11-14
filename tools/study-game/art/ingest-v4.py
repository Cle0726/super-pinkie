# v4 美术入库（Windows 侧）：把网页 GPT 出的原图转成 webp 放进 ui/assets/study-game/，登记 manifest.json 和 PROVENANCE.json。
# 用法：python tools/study-game/art/ingest-v4.py [原图目录]   默认 ../super-pinkie-handoff/art/study-game/v4/raw
# 规则：bg-<scene>.png → battle/<scene>.webp（宽 1536，q82）；mon-<id>.png（先用 matte-v4.py 抠成透明底，传抠好的目录）→ monster/<id>.webp；
# 其它前缀见 RULES。已入库且原图没变的跳过。幂等。
import json, os, sys, time
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RAW = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.abspath(os.path.join(REPO, '..', 'super-pinkie-handoff', 'art', 'study-game', 'v4', 'raw'))
OUT = os.path.join(REPO, 'ui', 'assets', 'study-game')
# 前缀 → (槽位前缀, 最大宽, 质量)
RULES = {'bg-': ('battle/', 1536, 82), 'key-': ('key/', 1920, 84), 'ui-': ('ui/', 1024, 88), 'mon-': ('monster/', 768, 90)}

manifest_path = os.path.join(OUT, 'manifest.json')
prov_path = os.path.join(OUT, 'PROVENANCE.json')
manifest = json.load(open(manifest_path, encoding='utf-8'))
prov = json.load(open(prov_path, encoding='utf-8')) if os.path.exists(prov_path) else {}
done = []
for name in sorted(os.listdir(RAW)):
    if not name.lower().endswith('.png'):
        continue
    rule = next((v for k, v in RULES.items() if name.startswith(k)), None)
    if not rule:
        continue
    prefix = next(k for k in RULES if name.startswith(k))
    slot = rule[0] + name[len(prefix):-4]
    src = os.path.join(RAW, name)
    mtime = int(os.path.getmtime(src) * 1000)
    if manifest['slots'].get(slot, {}).get('rawMtime') == mtime:
        continue
    im = Image.open(src)
    has_alpha = im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema()[0] < 250
    im = im.convert('RGBA' if has_alpha else 'RGB')
    if im.width > rule[1]:
        im = im.resize((rule[1], round(im.height * rule[1] / im.width)), Image.LANCZOS)
    dest = os.path.join(OUT, slot + '.webp')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    im.save(dest, 'WEBP', quality=rule[2], method=6)
    manifest['slots'][slot] = {'file': slot + '.webp', 'w': im.width, 'h': im.height, 'bytes': os.path.getsize(dest), 'source': 'chatgpt-web', 'date': time.strftime('%Y-%m-%d'), 'rawMtime': mtime}
    if isinstance(prov, dict):
        prov.setdefault('v4', {})[slot] = {'raw': name, 'tool': 'tools/study-game/art/gpt-web-batch.mjs', 'date': time.strftime('%Y-%m-%d')}
    done.append(slot)
json.dump(manifest, open(manifest_path, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
if isinstance(prov, dict):
    json.dump(prov, open(prov_path, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
print('ingested', len(done), done)
