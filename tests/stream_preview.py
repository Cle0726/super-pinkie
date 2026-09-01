"""Manual, isolated UI fixture. Synthetic progress, never calls a model or edits a project."""
import importlib.util
from pathlib import Path
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('party_preview',ROOT/'services/party/server.py')
party=importlib.util.module_from_spec(spec);spec.loader.exec_module(party)

if __name__=='__main__':
    state=tempfile.mkdtemp(prefix='pinkie-live-preview-')
    store=party.Store(state)
    a=store.create_room('实时验收 · 甲','',['codex','openclaw'])
    b=store.create_room('隔离验收 · 乙','',['codex','openclaw'])
    manager=party.Manager(store)
    manager.available=lambda name:True
    def execute(task,room):
        live=party.LIVE['LiveItems'](store,task,party.redact)
        final='测试完成：实时文字、工具状态和阶段说明都能按顺序显示。这是隔离验收数据，没有调用模型或修改项目。'
        for key,text,kind in [('plan','紫悦先检查目录，再验证输出。这是流式验收演示。','text'),('tool','读取 README.md\n示例文件内容','tool'),('stage','已完成目录检查，接下来验证中文与换行。','text'),('answer',final,'text')]:
            for end in range(1,len(text)+1,2):
                if store.task(task['id'])['status'] in party.TERMINAL:return ''
                live.put(key,text[:end],kind);time.sleep(.08)
            live.put(key,text,kind,status='done')
        return final
    manager.execute=execute
    party.roster=lambda:[{'id':k,'name':v,'available':k in ('pinkie','codex','openclaw'),'detail':'离线验收','reason':''} for k,v in party.LABELS.items()]
    party.model_catalog=lambda force=False:{'models':{},'notes':{}}
    http=party.ThreadingHTTPServer(('127.0.0.1',18891),party.Handler);http.store=store;http.manager=manager;http.token='offline-preview-only'
    print('http://127.0.0.1:18891/?room='+a['id'],flush=True)
    print('second-room='+b['id'],flush=True)
    try:http.serve_forever()
    finally:manager.close();http.server_close();store.db.close()
