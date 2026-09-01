"""Persistent aggregate counters only; never import prompts, accounts or API keys."""
from contextlib import closing
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time


def number(value):
    return value if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>=0 else None


def read_json(path):
    try:
        value=json.loads(Path(path).read_text(encoding='utf-8'))
        return value if isinstance(value,dict) else {}
    except (OSError,ValueError):return {}


def snapshot(home=None):
    home=Path(home or Path.home())
    raw=read_json(home/'.antigravity_cle/codex_local_access_stats.json')
    src=raw.get('totals') or raw.get('daily',{}).get('totals') or {}
    daily=not bool(raw.get('totals'))
    counters={}
    for field,key in [('input','inputTokens'),('output','outputTokens'),('cacheRead','cachedTokens'),('cacheWrite','cacheWriteTokens'),('requests','requestCount')]:
        value=number(src.get(key))
        if value is not None:counters[field]=value
    cost=number(src.get('estimatedCostUsd'))
    cost_note='C.le 上报的估算费用，不是实际账单或余额'
    if cost is None and 'input' in counters and 'output' in counters:
        # Compatibility with the previous visual meter, explicitly estimated.
        cost=(counters['input']*.2+counters['output']*1.5+counters.get('cacheRead',0)*.02)/1e6
        cost_note='按原界面展示系数估算，不是实际账单或余额'
    if cost is not None:counters['cost']=cost
    epoch=str((raw.get('daily') or {}).get('since','daily') if daily else raw.get('since','total'))
    stamp=number((raw.get('daily') or {}).get('updatedAt')) if daily else number(raw.get('updatedAt'))
    quota=[]
    for path in (home/'.antigravity_cle/cache/quota_api_v1_desktop/authorized').glob('*.json'):
        models=read_json(path).get('payload',{}).get('models') or {}
        for key,model in models.items():
            if not key.startswith(('gemini','claude','gpt')) or not isinstance(model,dict):continue
            value=number((model.get('quotaInfo') or {}).get('remainingFraction'))
            if value is not None and value<=1:quota.append(value)
    return {'counters':counters,'epoch':epoch,'stamp':stamp or 0,'costNote':cost_note,
            'quota':f'{min(quota):.0%}' if quota else None,
            'quotaNote':'本机配额缓存：相关模型中最低剩余比例；不是美元余额' if quota else '未取得上游剩余额度'}


def collect(home=None):
    home=Path(home or Path.home());state=home/'Library/Application Support/SuperPinkie'
    state.mkdir(parents=True,exist_ok=True,mode=0o700)
    path=state/'usage.sqlite3';sample=snapshot(home)
    with closing(sqlite3.connect(str(path),timeout=10)) as db:
        db.execute('CREATE TABLE IF NOT EXISTS counters(source TEXT PRIMARY KEY,epoch TEXT,stamp REAL,last TEXT,total TEXT)')
        db.execute('BEGIN IMMEDIATE')
        row=db.execute("SELECT epoch,stamp,last,total FROM counters WHERE source='cle'").fetchone()
        epoch,stamp,last,total=(row[0],row[1],json.loads(row[2]),json.loads(row[3])) if row else ('',0,{}, {})
        fresh=sample['counters'] and (not stamp or sample['stamp']>=stamp)
        if fresh:
            reset=epoch!=sample['epoch']
            if reset:last={}
            # Known reset epochs come from the producer's `since`, not app restarts.
            for field,value in sample['counters'].items():
                delta=value if reset or field not in last else max(0,value-last[field])
                total[field]=total.get(field,0)+delta
                last[field]=value if reset else max(value,last.get(field,0))
            db.execute('INSERT OR REPLACE INTO counters VALUES(?,?,?,?,?)',('cle',sample['epoch'],sample['stamp'],json.dumps(last),json.dumps(total)))
            stamp=sample['stamp']
        db.commit()
    os.chmod(path,0o600)
    return {**{key:total.get(key) for key in ('input','output','cacheRead','cacheWrite','requests','cost')},
            'quota':sample['quota'],'quotaNote':sample['quotaNote'],'costNote':sample['costNote'],
            'scope':'lifetime','source':'本机接口累计 · C.le（未经过此接口的调用不计入）',
            'sourceUpdatedAt':stamp,'updatedAt':int(time.time()*1000),'stale':not bool(fresh)}


def control_roots(home=None):
    home=Path(home or Path.home());roots=[]
    if os.environ.get('OPENCLAW_ROOT'):roots.append(Path(os.environ['OPENCLAW_ROOT'])/'dist/control-ui')
    binary=shutil.which('openclaw')
    if binary:
        parent=Path(binary).resolve().parent
        roots.extend([parent/'dist/control-ui',parent/'node_modules/openclaw/dist/control-ui'])
    roots.extend((home/'.nvm/versions/node').glob('*/lib/node_modules/openclaw/dist/control-ui'))
    return list(dict.fromkeys(p for p in roots if p.is_dir()))


def publish(home=None):
    result=collect(home)
    for root in control_roots(home):
        fd,temp=tempfile.mkstemp(dir=root,prefix='.usage-')
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as handle:json.dump(result,handle,ensure_ascii=False)
            os.replace(temp,root/'laolao-stats.json')
        finally:
            if os.path.exists(temp):os.unlink(temp)
    return result


if __name__=='__main__':
    publish()
    print('累计用量已同步；重启和重复刷新不会重复计费。')
