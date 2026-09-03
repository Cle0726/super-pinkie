"""Persistent aggregate counters only; never import prompts, accounts or API keys."""
from contextlib import closing
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import threading
import time

USAGE_LOCK=threading.Lock()
DISPLAY_PRICING_VERSION=2


def state_root(home=None):
    configured=os.environ.get('PINKIE_STATE_ROOT')
    return Path(configured) if configured else Path(home or Path.home())/'Library/Application Support/SuperPinkie'


def number(value):
    return value if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>=0 else None


def read_json(path):
    try:
        value=json.loads(Path(path).read_text(encoding='utf-8'))
        return value if isinstance(value,dict) else {}
    except (OSError,ValueError):return {}


def display_cost(value, requests=None):
    requests=number(value.get('requests')) if requests is None else number(requests)
    return ((requests or 0)*.01
            +(number(value.get('input')) or 0)/1e6*.2
            +(number(value.get('output')) or 0)/1e6*1.5
            +(number(value.get('cacheRead')) or 0)/1e6*.02
            +(number(value.get('cacheWrite')) or 0)/1e6*.2)


def runtime_cost(value):
    if value.get('pricingVersion') == DISPLAY_PRICING_VERSION and number(value.get('cost')) is not None:
        return value['cost']
    # 旧版每次回复固定加数美元。保留累计次数和 Token，只按新版低倍率
    # 重算展示金额，避免升级后仍显示夸张的历史数字。
    return display_cost(value)


def record_model_output(model, text='', input_tokens=0, output_tokens=None, home=None):
    home=Path(home or Path.home());state=state_root(home)
    state.mkdir(parents=True,exist_ok=True,mode=0o700);path=state/'model-usage.json'
    output_tokens=number(output_tokens)
    if output_tokens is None:output_tokens=max(1,len(str(text).encode('utf-8'))//3)
    input_tokens=number(input_tokens) or 0
    with USAGE_LOCK:
        current=read_json(path)
        next_value={
            'input':(number(current.get('input')) or 0)+input_tokens,
            'output':(number(current.get('output')) or 0)+output_tokens,
            'cacheRead':number(current.get('cacheRead')) or 0,
            'cacheWrite':number(current.get('cacheWrite')) or 0,
            'requests':(number(current.get('requests')) or 0)+1,
            'cost':runtime_cost(current)+display_cost({'input':input_tokens,'output':output_tokens},1),
            'pricingVersion':DISPLAY_PRICING_VERSION,
            'updatedAt':int(time.time()*1000),
        }
        fd,temp=tempfile.mkstemp(dir=state,prefix='.model-usage-')
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as handle:json.dump(next_value,handle,ensure_ascii=False)
            os.chmod(temp,0o600);os.replace(temp,path)
        finally:
            if os.path.exists(temp):os.unlink(temp)
    return next_value


def parse_reset(value):
    if not isinstance(value,str):return None
    try:return datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:return None


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
    daily=[];weekly=[]
    for path in (home/'.antigravity_cle/cache/quota_api_v1_desktop/authorized').glob('*.json'):
        models=read_json(path).get('payload',{}).get('models') or {}
        for key,model in models.items():
            if not key.startswith(('gemini','claude','gpt')) or not isinstance(model,dict):continue
            qi=model.get('quotaInfo') or {}
            value=number(qi.get('remainingFraction'))
            if value is None or value>1:continue
            reset=parse_reset(qi.get('resetTime'))
            horizon=(reset-datetime.now(timezone.utc)).total_seconds() if reset else 0
            # 重置周期超过 36 小时的视为周配额池，否则为日配额池。
            (weekly if horizon>129600 else daily).append(value)
    parts=[]
    if daily:parts.append(f'日{min(daily):.0%}')
    if weekly:parts.append(f'周{min(weekly):.0%}')
    return {'counters':counters,'epoch':epoch,'stamp':stamp or 0,'costNote':cost_note,
            'quota':' · '.join(parts) if parts else None,
            'quotaNote':'本机配额缓存：日=每日重置池最低剩余，周=每周重置池最低剩余；不是美元余额' if parts else '未取得上游剩余额度'}


def collect(home=None):
    home=Path(home or Path.home());state=state_root(home)
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
    runtime=read_json(state/'model-usage.json')
    combined={}
    for key in ('input','output','cacheRead','cacheWrite','requests','cost'):
        runtime_value=runtime_cost(runtime) if key == 'cost' and runtime else number(runtime.get(key))
        parts=[number(total.get(key)),runtime_value]
        combined[key]=sum(value for value in parts if value is not None) if any(value is not None for value in parts) else None
    runtime_stamp=number(runtime.get('updatedAt')) or 0
    return {**combined,
            'quota':sample['quota'],'quotaNote':sample['quotaNote'],'costNote':sample['costNote'],
            'scope':'lifetime','source':'本机全模型累计 · 展示估算',
            'costNote':'按模型输出次数与 Token 生成的展示估算，不是实际账单、余额或真实单价',
            'runtimeIncluded':True,
            'sourceUpdatedAt':max(stamp,runtime_stamp),'updatedAt':int(time.time()*1000),'stale':not bool(fresh or runtime)}


def control_roots(home=None):
    home=Path(home or Path.home());roots=[]
    if os.environ.get('OPENCLAW_ROOT'):roots.append(Path(os.environ['OPENCLAW_ROOT'])/'dist/control-ui')
    binary=shutil.which('openclaw')
    if binary:
        parent=Path(binary).resolve().parent
        roots.extend([parent/'dist/control-ui',parent/'node_modules/openclaw/dist/control-ui'])
    roots.extend((home/'.nvm/versions/node').glob('*/lib/node_modules/openclaw/dist/control-ui'))
    # A running macOS App must never rewrite files inside its signed bundle.
    # The live gateway RPC supplies current counters to that UI instead.
    return list(dict.fromkeys(
        p for p in roots
        if p.is_dir() and not any(part.lower().endswith('.app') for part in p.parts)
    ))


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
