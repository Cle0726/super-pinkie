"""Opt-in real backend smoke test. Uses a fresh temporary room, never existing history."""
import argparse
import importlib.util
from pathlib import Path
import tempfile
import threading
import time

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('party_smoke',ROOT/'services/party/server.py')
party=importlib.util.module_from_spec(spec);spec.loader.exec_module(party)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--backend',choices=['codex','openclaw','pinkie'],required=True);args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='pinkie-live-smoke-') as temp:
        store=party.Store(temp);manager=party.Manager(store)
        room=store.create_room('独立实时连通测试','',['codex','openclaw'])
        task=store.task(manager.new_task(room['id'],args.backend,'这是实时接口连通测试。不要调用工具，不读写文件。请用两小段中文说明实时输出的用途，总共不超过60字。',approval=True))
        snapshots=[];stop=threading.Event()
        def watch():
            while not stop.wait(.04):
                rows=[(r['id'],len(r['body']),r['status']) for r in store.messages(room['id']) if r['stream_key']]
                if rows and (not snapshots or snapshots[-1]!=rows):snapshots.append(rows)
        watcher=threading.Thread(target=watch);watcher.start()
        try:
            output=manager.execute(task,room)
            if args.backend=='pinkie':manager.host_result(task,output)
            print({'backend':args.backend,'nonempty':bool(output.strip()),'visible_updates':len(snapshots),'saw_running':any(any(r[2]=='running' for r in v) for v in snapshots),'message_count':len([r for r in store.messages(room['id']) if r['stream_key']])},flush=True)
        finally:stop.set();watcher.join();manager.close();store.db.close()
