#!/usr/bin/env python3
"""形态第一季 v3（REDO-1109-PLAN §2.1）：在 v2 的 8 个变身上加 2 个新变身（微风仙子、幻形灵）、2 个回归时装（立冬、名侦探）= 12 个现役。
新增字段 look：transform（变身：身体 / 物种变了）/ outfit（时装：穿戴，但发型跟着变）。衣橱按它分两栏。
art 多一个 avatar 槽（单独画的胸像，没有图时前端退回 icon）。幂等：重复跑结果一样。"""
import json, os
P = os.path.join(os.path.dirname(__file__), '../../../services/mode-architecture/learning-game-forms.json')
d = json.load(open(P))
ACTIVE = ['daily', 'unrestricted', 'alicorn', 'crystal', 'seapony', 'kirin', 'batpony', 'serious', 'breezie', 'changeling', 'lidong', 'detective']
OUTFIT = {'lidong', 'detective'}
def art(i): return {'portrait': f'form/{i}/portrait', 'ult': f'form/{i}/ult', 'icon': f'form/{i}/icon', 'avatar': f'form/{i}/avatar', 'idle': f'form/{i}/idle', 'stage': f'form/{i}/plate'}
UPD = {
 'unrestricted': dict(name='彩虹之力碧琪', form='鬃毛尾巴变长、彩虹挑染、蹄上花纹'),
 'breezie': dict(name='微风仙子碧琪', series='v3', rarity='SR', source=['shop', 'gacha-star', 'gacha-seal'], palette=['#E4F6DA', '#E2649E', '#9AD3F0'], particle='petals', hit='sparkle', ult='rain', sig='aurora', sound='harp',
   bonus={'kind': 'vocabStarsPct', 'pct': 0.3, 'text': '顺风：生词本背一背 ⭐ +30%'}, awaken={'stat': 'setsDone', 'count': 40, 'text': '做完 40 组'}, form='触角、半透明蝶翼、细长腿、更蓬的鬃毛'),
 'changeling': dict(name='幻形灵碧琪', series='v3', rarity='SSR', source=['gacha-star', 'gacha-seal'], palette=['#1F2A2E', '#3FD6B5', '#E35FA0'], particle='stars', hit='shard', ult='warp', sig='smokeclone', sound='synth',
   bonus={'kind': 'comboShield', 'text': '拟态：一组里第一次答错不断连击'}, awaken={'stat': 'perfectSets', 'count': 10, 'text': '一组全对 10 次'}, form='珠光甲壳翅鞘 + 薄翼、弯角、半透明纱质卷鬃'),
 'lidong': dict(series='season', rarity='limited', source=['limited:lidong'], season='lidong',
   bonus={'kind': 'firstSetStars', 'add': 15, 'text': '暖冬：每天第一组 +15 ⭐'}, form='红围巾把鬃毛扎成低马尾、毛线耳罩、卷毛尖挂霜'),
 'detective': dict(series='v3', rarity='SR', source=['shop'], bonus={'kind': 'realStarsPct', 'pct': 0.3, 'text': '推理：真题刷题 ⭐ +30%'},
   awaken={'stat': 'realCorrect', 'count': 200, 'text': '真题答对 200 道'}, form='猎鹿帽压住卷毛只露刘海和低马尾、短披风、胸前挂放大镜'),
}
forms = {f['id']: f for f in d['forms']}
for i in ACTIVE:
    f = forms.get(i, {'id': i})
    f.update(UPD.get(i, {}))
    f['art'] = art(i); f['season1'] = True; f['look'] = 'outfit' if i in OUTFIT else 'transform'
    f.pop('retired', None)
    forms[i] = f
for i, f in forms.items():
    if i in ACTIVE: continue
    f['retired'] = True; f['source'] = []; f['season1'] = False; f.pop('look', None)
d['forms'] = [forms[i] for i in ACTIVE] + [f for i, f in forms.items() if i not in ACTIVE]
d['version'] = max(d.get('version', 1), 3)
json.dump(d, open(P, 'w'), ensure_ascii=False, indent=1); open(P, 'a').write('\n')
print('forms', len(d['forms']), 'active', sum(1 for f in d['forms'] if not f.get('retired')))
