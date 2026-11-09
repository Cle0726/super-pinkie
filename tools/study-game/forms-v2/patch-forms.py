#!/usr/bin/env python3
"""形态 v2（FORMS-V2.md）：在 learning-game-forms.json 上加 6 个新形态、改 2 个保留形态、把旧的换装/贴纸形态退场。
幂等：重复跑结果一样。退场 = source 清空 + retired: true（已拥有的人还能装备，商店 / 扭蛋 / 图鉴不再出现）。"""
import json, os
P = os.path.join(os.path.dirname(__file__), '../../../services/mode-architecture/learning-game-forms.json')
d = json.load(open(P))
KEEP = ['daily', 'unrestricted', 'alicorn', 'crystal', 'seapony', 'kirin', 'batpony', 'serious']
def art(i): return {'portrait': f'form/{i}/portrait', 'ult': f'form/{i}/ult', 'icon': f'form/{i}/icon', 'idle': f'form/{i}/idle', 'stage': f'form/{i}/plate'}
NEW = {
 'alicorn': dict(name='天角兽公主碧琪', series='v2', rarity='SSR', source=['gacha-star', 'gacha-seal', 'seal-shop'], palette=['#FFD9E8', '#E0418A', '#F6C76A'], particle='petals', hit='sparkle', ult='rain', sig='rose', sound='harp',
   bonus={'kind': 'streakMilestoneMul', 'mul': 2, 'text': '加冕：连续盖章里程碑奖励 ×2'}, awaken={'stat': 'streak', 'count': 14, 'text': '连续盖章 14 天'}, form='长螺旋角、一对羽翼、会发光的流动鬃毛'),
 'crystal': dict(name='水晶碧琪', series='v2', rarity='SR', source=['shop', 'gacha-star', 'gacha-seal'], palette=['#F3D6FF', '#8E4BD6', '#9FE7FF'], particle='crystal', hit='shard', ult='spell', sig='lattice', sound='glass',
   bonus={'kind': 'writeStarsMul', 'mul': 1.5, 'text': '折光：默写 / 挖空 ⭐ ×1.5'}, awaken={'stat': 'writePerfectSets', 'count': 3, 'text': '默写全对 3 组'}, form='玫瑰水晶的身体、刻面水晶卷鬃'),
 'seapony': dict(name='海马碧琪', series='v2', rarity='SR', source=['gacha-star', 'gacha-seal'], palette=['#BFF3F0', '#F06A8F', '#FFE0C2'], particle='bubbles', hit='ping', ult='rain', sig='orbit', sound='sine',
   bonus={'kind': 'lessonStarsPct', 'pct': 0.3, 'text': '潮汐：学习关 ⭐ +30%'}, awaken={'stat': 'nodesLit', 'count': 15, 'text': '点亮 15 个节点'}, form='鱼尾、鳍耳、在水里漂浮的鬃毛'),
 'kirin': dict(name='麒麟碧琪', series='v2', rarity='SSR', source=['seal-shop', 'gacha-seal'], palette=['#FFD3B0', '#D8343C', '#F2C14E'], particle='embers', hit='flame', ult='beam', sig='dragon', sound='guzheng',
   bonus={'kind': 'examStarsPct', 'pct': 0.3, 'text': '祥瑞：考试交卷 ⭐ +30%'}, awaken={'stat': 'examsSafe', 'count': 3, 'text': '考试 3 次 ≥ 稳过线'}, form='鳞片、单角、火焰尖的云鬃、狮尾'),
 'batpony': dict(name='夜骐碧琪', series='v2', rarity='SR', source=['gacha-star', 'gacha-seal'], palette=['#2A1E4A', '#B04FA0', '#FFE6A8'], particle='stars', hit='constellation', ult='warp', sig='zodiac', sound='celesta',
   bonus={'kind': 'huntStarsPct', 'pct': 0.3, 'text': '夜行：讨伐 ⭐ +30%'}, awaken={'stat': 'captures', 'count': 20, 'text': '收服 20 只'}, form='蝙蝠膜翼、簇毛尖耳、竖瞳、小尖牙'),
 'serious': dict(name='较真碧琪', series='v2', rarity='R', source=['shop', 'gacha-star'], palette=['#E7B3C2', '#8E2F4E', '#F3E6D8'], particle='ink', hit='brush', ult='ink', sig='scroll', sound='pluck',
   bonus={'kind': 'captureStarsPct', 'pct': 0.4, 'text': '较真：收服错题怪 ⭐ +40%'}, awaken={'stat': 'captures', 'count': 30, 'text': '收服 30 只'}, form='卷毛全部变直、冷静锐利的眼神'),
}
forms = {f['id']: f for f in d['forms']}
for i, v in NEW.items():
    f = forms.get(i, {'id': i})
    f.update(v); f['art'] = art(i); f['season1'] = True; f.pop('retired', None)
    forms[i] = f
forms['daily'].update(series='v2', form='原本的碧琪', art=art('daily')); forms['daily'].pop('retired', None)
forms['unrestricted'].update(series='v2', source=['shop'], form='鬃毛尾巴变长、彩虹挑染', art=art('unrestricted')); forms['unrestricted'].pop('retired', None)
for i, f in forms.items():
    if i in KEEP: continue
    f['retired'] = True; f['source'] = []; f['season1'] = False
d['forms'] = [forms[i] for i in KEEP] + [f for i, f in forms.items() if i not in KEEP]
d['sets'] = [s for s in d['sets'] if s['id'] not in ('royal', 'mode', 'v2')] + [{'id': 'v2', 'name': '八面碧琪', 'forms': KEEP, 'rewards': ['title:five-faces']}]
for it in d['items']:
    if it['id'] == 'title:five-faces': it['name'] = '八面碧琪'; it['reward'] = 'set:v2'
json.dump(d, open(P, 'w'), ensure_ascii=False, indent=1); open(P, 'a').write('\n')
print('forms', len(d['forms']), 'active', sum(1 for f in d['forms'] if not f.get('retired')))
