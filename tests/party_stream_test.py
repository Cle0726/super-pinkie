"""Offline streaming tests: no model calls, no user history or configuration."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.request import urlopen
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('party_stream',ROOT/'services/party/server.py')
party=importlib.util.module_from_spec(spec);spec.loader.exec_module(party)


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pinkie-stream-test-')
        self.store=party.Store(self.temp.name);self.manager=party.Manager(self.store)
        self.room=self.store.create_room('测试','',['codex','openclaw'])
        with patch.object(self.manager,'available',return_value=True):
            self.task=self.store.task(self.manager.new_task(self.room['id'],'codex','只读检查',approval=True))
        self.live=party.LIVE['LiveItems'](self.store,self.task,party.redact)
    def tearDown(self):
        self.manager.close();self.store.db.close();self.temp.cleanup()
    def streamed(self):
        return [r for r in self.store.messages(self.room['id']) if r['stream_key']]

    def test_deltas_update_same_message_and_complete_authoritatively(self):
        self.live.codex({'method':'item/started','params':{'item':{'id':'a','type':'agentMessage','text':'','phase':'commentary'}}})
        for word in ['先检查','项目🎉']:
            self.live.codex({'method':'item/agentMessage/delta','params':{'itemId':'a','delta':word}})
        self.live.codex({'method':'item/completed','params':{'item':{'id':'a','type':'agentMessage','text':'先检查项目🎉','phase':'commentary'}}})
        rows=self.streamed();self.assertEqual(1,len(rows))
        self.assertEqual('先检查项目🎉',rows[0]['body']);self.assertEqual('done',rows[0]['status'])
        self.assertEqual('commentary',rows[0]['phase'])

    def test_tools_start_update_finish_and_reasoning_is_ignored(self):
        self.live.codex({'method':'item/started','params':{'item':{'id':'secret','type':'reasoning','text':'private'}}})
        self.live.codex({'method':'item/reasoning/textDelta','params':{'itemId':'secret','delta':'private'}})
        self.live.codex({'method':'item/started','params':{'item':{'id':'t','type':'commandExecution','command':'test -f README.md'}}})
        self.assertEqual('running',self.streamed()[0]['status'])
        self.live.codex({'method':'item/completed','params':{'item':{'id':'t','type':'commandExecution','command':'test -f README.md','exitCode':1}}})
        rows=self.streamed();self.assertEqual(1,len(rows));self.assertEqual('failed',rows[0]['status'])

    def test_cancel_rejects_late_deltas_and_rooms_stay_isolated(self):
        self.live.put('a','已有输出')
        second=self.store.create_room('另一群')
        cursor=self.store.live_snapshot(second['id'])['cursor']
        self.assertFalse(any(r['stream_key'] for r in self.store.live_snapshot(second['id'])['messages']))
        self.manager.cancel(self.room['id'],self.task['id'])
        self.live.put('a','不能出现在页面',status='done')
        self.assertEqual('已有输出',self.streamed()[0]['body'])
        self.assertIsNone(self.store.live_patch(second['id'],cursor))

    def test_restart_retains_partial_text_and_marks_interrupted(self):
        self.store.write("UPDATE tasks SET status='running' WHERE id=?",(self.task['id'],))
        self.live.put('a','半段回复')
        reopened=party.Store(self.temp.name)
        try:
            rows=[r for r in reopened.messages(self.room['id']) if r['stream_key']];self.assertEqual('半段回复',rows[0]['body']);self.assertEqual('interrupted',rows[0]['status'])
        finally:reopened.db.close()

    def test_host_partial_json_exposes_only_message_and_never_dispatches(self):
        decode=party.LIVE['public_host_text']
        text='{"message":"你好\\n铲屎官🎉","tasks":[{"instruction":"不要显示"}]}'
        self.assertEqual('你好\n铲屎官🎉',decode(text))
        self.assertEqual('你好',decode('{"message":"你好\\u4'))
        self.assertEqual('',decode('{"tasks":[{"message":"嵌套内容"}]}'))
        self.assertEqual('你好',decode('{"message":"你好\\uD83D'))
        task=dict(self.task,agent='pinkie')
        live=party.LIVE['LiveItems'](self.store,task,party.redact)
        live.openclaw({'stream':'assistant','data':{'text':text}})
        self.assertEqual(1,len(self.store.tasks(self.room['id'])))
        self.assertNotIn('不要显示',self.streamed()[0]['body'])

    def test_event_ids_resume_and_upsert_do_not_duplicate(self):
        before=self.store.live_snapshot(self.room['id'])['cursor']
        self.live.put('a','甲');self.live.put('a','甲乙',status='done')
        data=self.store.live_patch(self.room['id'],before)
        self.assertEqual(1,len(data['messages']));self.assertEqual('甲乙',data['messages'][0]['body'])
        self.assertIsNone(self.store.live_patch(self.room['id'],data['cursor']))

    def test_http_sse_delivers_before_completion(self):
        http=party.ThreadingHTTPServer(('127.0.0.1',0),party.Handler)
        http.store=self.store;http.manager=self.manager;http.token='test'
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        try:
            response=urlopen('http://127.0.0.1:'+str(http.server_port)+'/api/rooms/'+self.room['id']+'/events',timeout=2)
            self.assertIn('text/event-stream',response.headers['Content-Type'])
            def event():
                while True:
                    line=response.readline().decode()
                    if line.startswith('data: '):return json.loads(line[6:])
            snapshot=event();self.live.put('a','正在读取文件')
            update=event();self.assertGreater(update['cursor'],snapshot['cursor'])
            self.assertEqual('running',update['messages'][0]['status'])
            self.assertEqual('正在读取文件',update['messages'][0]['body'])
            response.close()
        finally:self.manager.close();http.shutdown();http.server_close();thread.join(2)

    def test_progress_prompt_does_not_modify_persona_or_limits(self):
        value=self.manager.prompt(self.task,self.room,context='')
        self.assertIn('公开说明',value);self.assertIn('普通聊天直接回答',value)
        self.assertIn('不输出隐藏思维链',value)

if __name__=='__main__':unittest.main()
