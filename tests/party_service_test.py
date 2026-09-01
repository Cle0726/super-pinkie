"""Offline regression tests: python3 -m unittest discover -s tests -p '*_test.py'."""
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import signal
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, Mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SMALL_CONTEXT={'model':'test/small','window':32768,'threshold':22937,'reserve':9831,'target':16384,'keepRecent':6553,'source':'test-fixture'}
spec = importlib.util.spec_from_file_location('party', ROOT / 'services/party/server.py')
party = importlib.util.module_from_spec(spec)
spec.loader.exec_module(party)
setup_spec = importlib.util.spec_from_file_location('party_setup', ROOT / 'services/party/setup.py')
setup = importlib.util.module_from_spec(setup_spec)
setup_spec.loader.exec_module(setup)


class PartyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pinkie-party-unit-')
        self.store = party.Store(self.temp.name)
        self.manager = party.Manager(self.store)
        self.available = patch.object(self.manager, 'available', return_value=True)
        self.available.start()
        self.submit = patch.object(self.manager.pool, 'submit')
        self.submit.start()
        self.a = self.store.create_room('甲', members=['codex', 'openclaw'])
        self.b = self.store.create_room('乙', members=['codex'])

    def tearDown(self):
        self.manager.close()
        self.manager.pool.shutdown(wait=True)
        self.submit.stop()
        self.available.stop()
        self.store.db.close()
        self.temp.cleanup()

    def test_room_context_and_search_are_isolated(self):
        secret = self.store.message(self.a['id'], 'user', '只属于甲的项目')
        self.assertNotIn('只属于甲', self.store.context(self.b['id']))
        self.assertEqual([], self.store.messages(self.b['id'], query='只属于甲'))
        with self.assertRaises(ValueError):
            self.manager.send(self.b['id'], dict(requestId='request000', text='引用', reply=secret))
        self.assertNotEqual(self.a['path'], self.b['path'])

    def test_compaction_preserves_records_and_isolates_checkpoints_by_room_and_model(self):
        old=self.store.message(self.a['id'],'user','保留完整原文。'*6000)
        self.store.message(self.a['id'],'codex','早期进展'*2000,'tool')
        result=self.manager.send(self.a['id'],dict(requestId='compact_case_01',agent='codex',text='继续检查'))
        task=self.store.task(result['taskId'])
        limits=dict(SMALL_CONTEXT)
        before=self.store.context_rows(self.a['id'])
        with patch.object(self.manager,'_archive_context_before_compaction',return_value=None),patch.object(self.manager,'context_budget',return_value=limits),patch.object(self.manager,'execute_managed',return_value='目标、文件路径和待办摘要') as execute:
            prepared=json.loads(self.manager.prepare_context(task,self.a))
        self.assertGreater(execute.call_count,0)
        self.assertTrue(all(c.kwargs['internal'] for c in execute.call_args_list))
        self.assertEqual('继续检查',prepared['recent_messages'][-1]['body'])
        self.assertEqual(before,self.store.context_rows(self.a['id']))
        self.assertGreaterEqual(self.store.context_checkpoint(self.a['id'],'test/small')['through_id'],old)
        self.assertEqual(0,self.store.context_checkpoint(self.a['id'],'test/other')['through_id'])
        self.assertEqual(0,self.store.context_checkpoint(self.b['id'],'test/small')['through_id'])
        with patch.object(self.manager,'context_budget',return_value=limits),patch.object(self.manager,'execute_managed') as execute:
            self.manager.prepare_context(task,self.a)
            execute.assert_not_called()

    def test_failed_compaction_keeps_checkpoint_and_internal_output_is_not_chat(self):
        self.store.message(self.a['id'],'user','旧内容'*9000)
        result=self.manager.send(self.a['id'],dict(requestId='compact_case_02',agent='codex',text='继续'))
        task=self.store.task(result['taskId']);before=self.store.context_rows(self.a['id'])
        limits=dict(SMALL_CONTEXT)
        with patch.object(self.manager,'context_budget',return_value=limits),patch.object(self.manager,'execute_managed',return_value=''):
            with self.assertRaisesRegex(ValueError,'原始记录没有删除'):
                self.manager.prepare_context(task,self.a)
        self.assertEqual(0,self.store.context_checkpoint(self.a['id'],'test/small')['through_id'])
        response=self.manager.codex_event(task,json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'内部摘要'}}),internal=True)
        self.assertEqual('内部摘要',response);self.assertEqual(before,self.store.context_rows(self.a['id']))

    def test_codex_command_has_selected_model_seventy_percent_total_limit(self):
        limits=dict(SMALL_CONTEXT)
        task={'agent':'codex','permission':'read-only','model':'test-model'}
        with patch.object(self.manager,'context_budget',return_value=limits):command=self.manager.command(task,self.a)
        self.assertIn('model_context_window=32768',command)
        self.assertIn('model_auto_compact_token_limit=22937',command)
        self.assertIn('model_auto_compact_token_limit_scope="total"',command)
        self.assertIn('test-model',command)

    def test_write_and_host_dispatch_require_approval(self):
        result = self.manager.send(self.a['id'], dict(requestId='request001', agent='codex', text='改测试文件', permission='workspace-write'))
        task = self.store.task(result['taskId'])
        self.assertEqual('pending', task['status'])
        self.manager.pool.submit.assert_not_called()
        with self.assertRaises(ValueError):
            self.manager.approve(self.b['id'], task['id'])
        self.manager.approve(self.a['id'], task['id'])
        self.assertEqual('queued', self.store.task(task['id'])['status'])
        self.manager.pool.submit.assert_called_once()
        with self.assertRaises(ValueError):
            self.manager.approve(self.a['id'], task['id'])

    def test_send_idempotency(self):
        data = dict(requestId='request002', text='你好')
        first = self.manager.send(self.a['id'], data)
        self.assertEqual(first, self.manager.send(self.a['id'], data))
        self.assertEqual(1, len(self.store.rows("SELECT * FROM messages WHERE sender='user'")))

    def test_send_rolls_back_message_when_task_creation_fails(self):
        with patch.object(self.manager, 'new_task', side_effect=ValueError('队列已满')):
            with self.assertRaises(ValueError):
                self.manager.send(self.a['id'], dict(requestId='request_failed', text='不应残留'))
        self.assertEqual([], self.store.rows("SELECT * FROM messages WHERE sender='user'"))
        self.assertEqual([], self.store.rows('SELECT * FROM requests'))

    def test_send_rolls_back_task_when_request_record_fails(self):
        original = self.store.write
        def fail_request(sql, args=()):
            if sql.startswith('INSERT INTO requests'):
                raise sqlite3.OperationalError('test disk error')
            return original(sql, args)
        with patch.object(self.store, 'write', side_effect=fail_request):
            with self.assertRaises(sqlite3.OperationalError):
                self.manager.send(self.a['id'], dict(requestId='request_disk', text='不应半成功'))
        self.assertEqual([], self.store.rows('SELECT * FROM tasks'))
        self.assertEqual([], self.store.rows("SELECT * FROM messages WHERE sender='user'"))

    def test_archiving_keeps_history_project_and_is_reversible(self):
        self.store.message(self.a['id'], 'user', '要保留的记录')
        updated = self.manager.update_room(self.a['id'], {'name': '甲改名', 'archived': True})
        self.assertEqual('甲改名', updated['name'])
        self.assertEqual(1, updated['archived'])
        self.assertEqual(self.a['path'], updated['path'])
        self.assertTrue(Path(updated['path']).is_dir())
        self.assertIn('要保留的记录', self.store.context(self.a['id']))
        with self.assertRaises(ValueError):
            self.manager.send(self.a['id'], dict(requestId='request_archived', text='归档不能发'))
        self.assertFalse(any(m['body'] == '归档不能发' for m in self.store.messages(self.a['id'])))
        self.assertEqual(0, self.manager.update_room(self.a['id'], {'archived': False})['archived'])

    def test_active_tasks_block_member_removal_and_archive_but_not_rename(self):
        task = self.manager.new_task(self.a['id'], 'codex', '待确认', approval=True)
        for change in [{'members':['pinkie']}, {'archived':True}]:
            with self.assertRaises(ValueError):
                self.manager.update_room(self.a['id'], change)
        self.assertEqual('可以改名', self.manager.update_room(self.a['id'], {'name':'可以改名'})['name'])
        self.manager.cancel(self.a['id'], task)
        self.assertEqual(['pinkie'], self.manager.update_room(self.a['id'], {'members':[]})['members'])

    def test_cannot_rebind_project_or_invite_unsupported_agent(self):
        for data in [{'path':self.b['path']}, {'members':['claude']}, {'name':' '}, {'archived':'true'}]:
            with self.assertRaises(ValueError):
                self.manager.update_room(self.a['id'], data)
        self.assertEqual(self.a['path'], self.store.room(self.a['id'])['path'])

    def test_new_member_requires_live_connector(self):
        with patch.object(self.manager, 'available', return_value=False):
            with self.assertRaises(ValueError):
                self.manager.update_room(self.b['id'], {'members':['codex','openclaw']})
        self.assertEqual(['pinkie','codex','openclaw'], self.manager.update_room(self.b['id'], {'members':['codex','openclaw']})['members'])

    def test_retry_is_idempotent_pending_and_keeps_original(self):
        task = self.manager.new_task(self.a['id'], 'codex', '改文件', permission='workspace-write')
        self.manager.cancel(self.a['id'], task)
        data = dict(taskId=task, requestId='retry_request01')
        with self.assertRaises(ValueError):
            self.manager.retry(self.b['id'], data)
        result = self.manager.retry(self.a['id'], data)
        self.assertEqual(result, self.manager.retry(self.a['id'], data))
        copied = self.store.task(result['taskId'])
        self.assertEqual('pending', copied['status'])
        self.assertEqual('workspace-write', copied['permission'])
        self.assertEqual('改文件', copied['prompt'])
        self.assertEqual('cancelled', self.store.task(task)['status'])
        self.manager.pool.submit.assert_not_called()
        with self.assertRaises(ValueError):
            self.manager.retry(self.a['id'], dict(taskId=result['taskId'], requestId='retry_request02'))

    def test_old_pending_tasks_stay_visible_after_many_completed_jobs(self):
        old = self.manager.new_task(self.a['id'], 'codex', '最早待办', approval=True)
        for i in range(65):
            task = self.manager.new_task(self.a['id'], 'pinkie', '历史'+str(i), approval=True)
            self.store.write("UPDATE tasks SET status='done' WHERE id=?", (task,))
        visible = self.store.tasks(self.a['id'])
        self.assertIn(old, [t['id'] for t in visible])
        self.assertEqual(61, len(visible))

    def test_upgrade_old_database_backs_up_and_preserves_rows(self):
        root = Path(self.temp.name) / 'old-db'
        root.mkdir()
        with sqlite3.connect(root/'party.sqlite3') as database:
            database.execute('CREATE TABLE rooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,members TEXT NOT NULL,created REAL NOT NULL)')
            database.execute('INSERT INTO rooms VALUES(?,?,?,?,?)', ('old-id','旧群',self.a['path'],'["pinkie"]',1))
        migrated = party.Store(root)
        self.assertEqual('旧群', migrated.room('old-id')['name'])
        self.assertEqual(0, migrated.room('old-id')['archived'])
        migrated.db.close()
        self.assertEqual(1, len(list(root.glob('before-room-management-*.sqlite3'))))

    def test_cancel_scope_and_no_restart(self):
        task = self.manager.new_task(self.a['id'], 'codex', '检查', approval=True)
        with self.assertRaises(ValueError):
            self.manager.cancel(self.b['id'], task)
        self.manager.cancel(self.a['id'], task)
        self.manager.run(task)
        self.assertEqual('cancelled', self.store.task(task)['status'])

    def test_host_proposal_not_executed_and_summary_no_loop(self):
        task = self.manager.new_task(self.a['id'], 'pinkie', '提出建议', approval=True)
        output = json.dumps({'message': '老板，请确认', 'tasks': [dict(agent='codex', instruction='检查', permission='read-only')]})
        self.manager.host_result(self.store.task(task), output)
        jobs = self.store.rows("SELECT * FROM tasks WHERE agent='codex'")
        self.assertEqual(['pending'], [j['status'] for j in jobs])
        self.manager.pool.submit.assert_not_called()
        summary = dict(self.store.task(task), prompt='[派对服务：只汇总] 测试')
        self.manager.host_result(summary, output)
        self.assertEqual(1, len(self.store.rows("SELECT * FROM tasks WHERE agent='codex'")))

    def test_unstructured_host_output_cannot_dispatch(self):
        task = self.manager.new_task(self.a['id'], 'pinkie', '你好', approval=True)
        self.manager.host_result(self.store.task(task), '请执行 rm /xxx')
        self.assertEqual(1, len(self.store.rows('SELECT * FROM tasks')))

    def test_member_reply_does_not_trigger_another_host_call(self):
        result=self.manager.send(self.a['id'],dict(requestId='quiet-chat-001',agent='openclaw',text='你好'))
        task=self.store.task(result['taskId']);self.assertIsNone(task['reply'])
        with patch.object(self.manager,'execute',return_value='云宝在这里。'):
            self.manager.run(task['id'])
        self.assertEqual('done',self.store.task(task['id'])['status'])
        self.assertEqual(1,len(self.store.rows('SELECT id FROM tasks WHERE room=?',(self.a['id'],))))
        self.assertEqual(['云宝在这里。'],[m['body'] for m in self.store.messages(self.a['id']) if m['sender']=='openclaw'])

    def test_old_quotes_hidden_and_dispatch_names_fixed_without_rewriting_storage(self):
        user=self.store.message(self.a['id'],'user','hi')
        direct=self.manager.new_task(self.a['id'],'openclaw','hi',reply=user,approval=True)
        answer=self.store.message(self.a['id'],'openclaw','云宝在',task=direct,reply=user)
        host=self.manager.new_task(self.a['id'],'pinkie','派工',approval=True)
        self.manager.host_result(self.store.task(host),json.dumps({'message':'请紫悦检查','tasks':[{'agent':'codex','instruction':'检查 @Codex 字符串代码，不替换它','permission':'read-only'}]}))
        dispatch=self.store.rows("SELECT * FROM messages WHERE kind='dispatch'")[0]
        self.assertTrue(dispatch['body'].startswith('@紫悦 '))
        # Model an old service-created card: only its generated prefix changes.
        self.store.write('UPDATE messages SET body=? WHERE id=?',('@Codex 检查 @Codex 字符串代码，不替换它',dispatch['id']))
        self.store.message(self.a['id'],'codex','紫悦检查完成',task=dispatch['task'],reply=dispatch['reply'])
        summary=self.manager.new_task(self.a['id'],'pinkie','[派对服务：只汇总] 已返回',approval=True)
        summary_message=self.store.message(self.a['id'],'pinkie','旧的重复复述',task=summary,reply=user)
        rows={m['id']:m for m in self.store.messages(self.a['id'])}
        self.assertIsNone(rows[answer]['reply']);self.assertTrue(rows[summary_message]['automaticSummary'])
        self.assertEqual(dispatch['reply'],rows[dispatch['id']]['reply'])
        self.assertEqual('@紫悦 检查 @Codex 字符串代码，不替换它',rows[dispatch['id']]['body'])
        self.assertEqual(user,self.store.rows('SELECT reply FROM messages WHERE id=?',(answer,))[0]['reply'])
        self.assertTrue(self.store.rows('SELECT body FROM messages WHERE id=?',(dispatch['id'],))[0]['body'].startswith('@Codex '))

    def test_party_prompt_gives_pony_names_without_changing_dispatch_ids(self):
        task={'agent':'pinkie','prompt':'派工'}
        prompt=self.manager.prompt(task,self.a)
        self.assertIn('codex=紫悦',prompt);self.assertIn('openclaw=云宝',prompt)
        self.assertIn('JSON 的 agent 字段仍使用原内部标识',prompt)

    def test_reasoning_is_not_recorded_and_secrets_are_redacted(self):
        task = self.manager.new_task(self.a['id'], 'codex', '测试', approval=True)
        event = dict(type='item.completed', item=dict(type='reasoning', text='hidden-reasoning'))
        self.manager.codex_event(self.store.task(task), json.dumps(event))
        self.assertNotIn('hidden-reasoning', self.store.context(self.a['id']))
        self.assertNotIn('abcXYZ', party.redact('Bearer abcXYZ'))

    def test_broad_project_rejected(self):
        for path in ['/', str(Path.home()), str(ROOT)]:
            with self.assertRaises(ValueError):
                self.store.create_room('不应该', path)

    def test_create_named_project_without_overwrite_or_traversal(self):
        parent = Path(self.temp.name) / 'chosen-parent'
        parent.mkdir()
        created = self.store.create_project(str(parent), '新项目')
        self.assertTrue(Path(created['path']).is_dir())
        self.assertEqual(parent.resolve() / '新项目', Path(created['path']))
        marker = Path(created['path']) / 'keep.txt'
        marker.write_text('preserve')
        for name in ['新项目', '../outside', 'a/b', '.hidden', 'a\\b', '']:
            with self.assertRaises(ValueError):
                self.store.create_project(str(parent), name)
        self.assertEqual('preserve', marker.read_text())
        default = self.store.create_project('', '默认位置')
        self.assertEqual(self.store.root / 'projects' / '默认位置', Path(default['path']))

    def test_models_are_per_room_and_per_member_and_frozen_per_task(self):
        catalog = {'models': {'codex': [{'id': 'model-a'}, {'id': 'model-b'}], 'pinkie': [{'id': 'provider/model'}]}}
        with patch.object(party, 'model_catalog', return_value=catalog):
            self.manager.update_room(self.a['id'], {'models': {'codex': 'model-a', 'pinkie': 'provider/model'}})
            task_id = self.manager.new_task(self.a['id'], 'codex', '检查', approval=True)
            self.manager.update_room(self.a['id'], {'models': {'codex': 'model-b'}})
            self.assertEqual('model-a', self.store.task(task_id)['model'])
            self.assertEqual({}, self.store.room(self.b['id'])['models'])
            self.manager.cancel(self.a['id'], task_id)
            retried = self.manager.retry(self.a['id'], {'taskId': task_id, 'requestId': 'retry_model01'})
            self.assertEqual('model-a', self.store.task(retried['taskId'])['model'])

    def test_invalid_models_cannot_create_messages_or_change_settings(self):
        with patch.object(party, 'model_catalog', return_value={'models': {'codex': [{'id': 'allowed'}]}}):
            with self.assertRaises(ValueError):
                self.manager.send(self.a['id'], dict(requestId='bad_model_id', agent='codex', model='unknown', text='不发送'))
            self.assertEqual([], self.store.rows("SELECT * FROM messages WHERE sender='user'"))
            with self.assertRaises(ValueError):
                self.manager.update_room(self.a['id'], {'models': {'claude': 'allowed'}})
            self.assertEqual({}, self.store.room(self.a['id'])['models'])

    def test_selected_codex_model_is_in_actual_command(self):
        with patch.object(party, 'model_catalog', return_value={'models': {'codex': [{'id': 'chosen-model'}]}}):
            task_id = self.manager.new_task(self.a['id'], 'codex', '测试', approval=True, model='chosen-model')
            command = self.manager.command(self.store.task(task_id), self.a)
            self.assertEqual('chosen-model', command[command.index('--model') + 1])
            self.assertEqual('-', command[-1])

    def test_desktop_environment_reads_models_and_refresh_bypasses_cache(self):
        home = Path(self.temp.name) / 'catalog-home'
        config = home / '.openclaw/openclaw.json'
        config.parent.mkdir(parents=True)
        config.write_text('{}')
        reply = Mock(stdout=json.dumps({'models': [
            {'key':'provider/chat', 'name':'可选聊天模型'},
            {'key':'provider/gpt-image-1', 'name':'生图'},
            {'key':'codex-cli/test', 'name':'CLI'},
            {'key':'provider/missing', 'missing':True}]}))
        binaries = {'node':'/example/nvm/bin/node', 'openclaw':'/example/nvm/bin/openclaw'}
        with patch.dict(os.environ, {'PATH':'/usr/bin:/bin', 'CLAUDECODE':'1'}), \
                patch.object(party.Path, 'home', return_value=home), \
                patch.object(party, 'executable', side_effect=lambda name:binaries.get(name)), \
                patch.object(party, 'codex_models', return_value=[]), \
                patch.dict(party.MODEL_CACHE, {'until':0, 'data':None}), \
                patch.object(party.subprocess, 'run', return_value=reply) as run:
            result = party.model_catalog()
            self.assertEqual(['provider/chat'], [m['id'] for m in result['models']['pinkie']])
            self.assertEqual('/example/nvm/bin:/usr/bin:/bin', run.call_args.kwargs['env']['PATH'])
            self.assertNotIn('CLAUDECODE', run.call_args.kwargs['env'])
            party.model_catalog()
            self.assertEqual(1, run.call_count)
            party.model_catalog(force=True)
            self.assertEqual(2, run.call_count)

    def test_party_prompt_calls_user_caretaker_for_every_member(self):
        for agent in party.CHARACTERS:
            prompt = self.manager.prompt({'agent':agent, 'prompt':'你好'}, self.a)
            self.assertIn('称呼用户为铲屎官', prompt)
            self.assertNotIn('老板', prompt)

    def test_party_identity_is_name_only_and_preserves_task_writing_requirements(self):
        expected = {'pinkie':'碧琪', 'codex':'紫悦', 'openclaw':'云宝',
                    'claude':'珍奇', 'gemini':'柔柔', 'ollama':'苹果嘉儿'}
        self.assertEqual(expected, party.CHARACTERS)
        self.assertEqual(party.IDENTITIES, setup.IDENTITIES)
        task_text = '请用第一人称写一篇英文长篇故事，保留主角的 I 和 we。'
        for agent, name in expected.items():
            prompt = self.manager.prompt({'agent':agent, 'prompt':task_text}, self.a)
            self.assertIn(f'你在本群的名字是「{name}」', prompt)
            self.assertIn(f'以助手身份自称时，使用「{name}」', prompt)
            self.assertIn('不要用「我」「我们」', prompt)
            self.assertIn('引用原文、代码、翻译和代写作品中的第一人称保留', prompt)
            self.assertTrue(prompt.endswith(task_text))
            for style in ('俏皮但克制', '爽快、自信', '喜欢把难题拆开', '用简洁中文', '中文、简洁、自然', '中文回复', '你在派对里扮演'):
                self.assertNotIn(style, prompt)
            # Operational boundaries are not personality/style instructions.
            self.assertIn('不得沿用上次记忆或假装读取', prompt)
            self.assertIn('只处理当前群和所选项目', prompt)
        host = self.manager.prompt({'agent':'pinkie', 'prompt':'hi'}, self.a)
        self.assertIn('输出且只输出JSON对象', host)
        self.assertIn('派工必须先经铲屎官确认', host)

    def test_names_are_instructions_not_a_destructive_output_filter(self):
        body = '紫悦的示例：\n> 我站在窗边。\n\n```python\nmessage = "我"\n```\nI remember that day.'
        task_id = self.manager.new_task(self.a['id'], 'codex', '写作', approval=True)
        line = json.dumps({'type':'item.completed', 'item':{'type':'agent_message', 'text':body}})
        self.assertEqual(body, self.manager.codex_event(self.store.task(task_id), line))
        self.assertEqual(body, self.store.messages(self.a['id'])[-1]['body'])

    def test_openclaw_model_snapshot_does_not_change_live_config(self):
        home = Path(self.temp.name) / 'model-home'
        config = home / '.openclaw/openclaw.json'
        config.parent.mkdir(parents=True)
        original = {'agents': {'list': [{'id': 'pinkie-party', 'tools': {'deny': ['*']}, 'model': 'old/default'}]}, 'tools': {'allow': ['read']}}
        config.write_text(json.dumps(original))
        script = "import os,json; c=json.load(open(os.environ['OPENCLAW_CONFIG_PATH'])); print(json.dumps({'payloads':[{'text':c['agents']['list'][0]['model']['primary']}]}))"
        task_id = self.manager.new_task(self.a['id'], 'pinkie', '测试', approval=True)
        task = dict(self.store.task(task_id), model='chosen/provider-model')
        with patch.object(party.Path, 'home', return_value=home), patch.object(self.manager, 'command', return_value=[sys.executable, '-c', script]):
            self.assertEqual('chosen/provider-model', self.manager.execute(task, self.a))
        self.assertEqual(original, json.loads(config.read_text()))
        self.assertEqual([], list(self.store.root.glob('.config-*')))

    def test_unicode_process_stream_and_failure(self):
        task_id = self.manager.new_task(self.a['id'], 'codex', '测试', approval=True)
        task = self.store.task(task_id)
        line = json.dumps(dict(type='item.completed', item=dict(type='agent_message', text='老板，连接好了🎉')), ensure_ascii=False)
        code = 'import os,sys;sys.stdin.read();data=' + repr((line+'\n').encode()) + ';[(os.write(1,bytes([b]))) for b in data]'
        with patch.object(self.manager, 'command', return_value=[sys.executable, '-c', code]):
            self.assertEqual('老板，连接好了🎉', self.manager.execute(task, self.a))
        with patch.object(self.manager, 'command', return_value=[sys.executable, '-c', 'import sys;sys.exit(3)']):
            with self.assertRaises(ValueError):
                self.manager.execute(task, self.a)

    def test_running_process_is_stopped(self):
        task_id = self.manager.new_task(self.a['id'], 'codex', '测试取消', approval=True)
        task = self.store.task(task_id)
        with patch.object(self.manager, 'command', return_value=[sys.executable, '-c', 'import time;time.sleep(30)']):
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self.manager.execute, task, self.a)
                for _ in range(100):
                    if task_id in self.manager.processes:
                        break
                    time.sleep(.01)
                process = self.manager.processes[task_id]
                self.manager.cancel(self.a['id'], task_id)
                try:
                    future.result(timeout=4)
                except ValueError:
                    pass
                self.assertIsNotNone(process.poll())
                self.assertEqual('cancelled', self.store.task(task_id)['status'])

    def test_restart_marks_tasks_interrupted(self):
        task = self.manager.new_task(self.a['id'], 'pinkie', '测试中断')
        other = party.Store(self.temp.name)
        self.assertEqual('interrupted', other.task(task)['status'])
        self.assertTrue(any('上次运行已中断' in m['body'] for m in other.messages(self.a['id'])))
        other.db.close()

    def test_http_requires_origin_token_and_safe_host(self):
        http = party.ThreadingHTTPServer(('127.0.0.1', 0), party.Handler)
        http.store, http.manager, http.token = self.store, self.manager, 'test-only-token'
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(http.server_port)
        try:
            headers = {'Content-Type': 'application/json', 'Origin': base, 'X-Party-Token': http.token}
            for overrides in [{'Origin':'https://attacker.example'}, {'X-Party-Token':'bad'}, {'Host':'attacker.example'}]:
                request = Request(base+'/api/rooms', data=b'{"name":"test"}', headers=dict(headers, **overrides))
                with self.assertRaises(HTTPError) as error:
                    urlopen(request)
                self.assertEqual(403, error.exception.code)
                error.exception.close()
            with urlopen(Request(base+'/api/rooms', data=b'{"name":"http-test"}', headers=headers)) as response:
                self.assertEqual('http-test', json.load(response)['name'])
            with urlopen(base+'/') as response:
                self.assertIn(b'party.js', response.read())
                self.assertIn("frame-ancestors 'none'", response.headers['Content-Security-Policy'])
            for name in ('room-invitation', 'room-notebook', 'room-giftbox', 'room-toolbox', 'workbench'):
                with urlopen(base+'/'+name+'.png') as response:
                    self.assertEqual('image/png', response.headers.get_content_type())
                    self.assertTrue(response.read().startswith(b'\x89PNG\r\n\x1a\n'))
            with urlopen(base+'/party-room-art.js') as response:
                self.assertIn(b'PartyRoomArt', response.read())
            with patch.object(party, 'model_catalog', return_value={'models':{}, 'notes':{}}) as catalog:
                with urlopen(base+'/api/models?refresh=1') as response:
                    self.assertEqual(200, response.status)
                catalog.assert_called_once_with(force=True)
        finally:
            http.shutdown(); http.server_close(); thread.join()

    def test_setup_preserves_existing_agents_and_personas(self):
        home = Path(self.temp.name) / 'home'
        config = home / '.openclaw/openclaw.json'
        config.parent.mkdir(parents=True)
        original = {'id':'main', 'workspace':'/original', 'name':'不要改变'}
        config.write_text(json.dumps({'agents':{'list':[original]},'unchanged':42}))
        self.assertTrue(setup.install(home))
        actual = json.loads(config.read_text())
        self.assertEqual(original, actual['agents']['list'][0])
        self.assertEqual(42, actual['unchanged'])
        self.assertEqual(['*'], actual['agents']['list'][1]['tools']['deny'])
        self.assertFalse(setup.install(home))

    def test_address_migration_only_changes_exact_owned_party_template(self):
        home = Path(self.temp.name) / 'address-home'
        config = home / '.openclaw/openclaw.json'
        config.parent.mkdir(parents=True)
        config.write_text('{"agents":{"list":[]}}')
        setup.install(home)
        original_config = config.read_bytes()
        soul = home / '.openclaw/workspace-pinkie-party/SOUL.md'
        custom = home / '.openclaw/workspace-party-openclaw/SOUL.md'
        soul.write_text(setup.party_soul('碧琪', '老板'))
        custom.write_text('用户自定义人格：老板（不能改原文件）')
        self.assertTrue(setup.install(home))
        self.assertIn('称呼用户为铲屎官', soul.read_text())
        self.assertEqual('用户自定义人格：老板（不能改原文件）', custom.read_text())
        self.assertEqual(original_config, config.read_bytes())
        self.assertFalse(setup.install(home))
        backups = list((home / 'Library/Application Support/SuperPinkie/backups').glob('party-identity-*/*SOUL.md'))
        self.assertEqual(1, len(backups))
        self.assertEqual(setup.party_soul('碧琪', '老板'), backups[0].read_text())

    def test_identity_migration_updates_old_generated_names_and_removes_vibe_only(self):
        home = Path(self.temp.name) / 'identity-home'
        config = home / '.openclaw/openclaw.json'
        config.parent.mkdir(parents=True)
        untouched = {'id':'main', 'name':'原模式人格', 'workspace':'/keep-this'}
        agents = [untouched]
        originals = {}
        for agent_id, name in [('pinkie-party','碧琪'), ('party-openclaw','OpenClaw')]:
            workspace = config.parent / ('workspace-' + agent_id)
            workspace.mkdir()
            agents.append({'id':agent_id, 'name':name, 'workspace':str(workspace), 'tools':{'deny':['*']}})
            for filename, content in {'SOUL.md':setup.legacy_party_soul(name),
                                      'IDENTITY.md':setup.identity_file(name)+'- **Vibe:** 清楚、可靠的群聊搭档\n'}.items():
                (workspace / filename).write_text(content)
                originals[agent_id+'-'+filename] = content
            (workspace / 'AGENTS.md').write_text('保留群聊的操作边界')
        config.write_text(json.dumps({'agents':{'list':agents}, 'untouched':123}))
        self.assertTrue(setup.install(home))
        updated = json.loads(config.read_text())
        self.assertEqual(untouched, updated['agents']['list'][0])
        self.assertEqual(123, updated['untouched'])
        self.assertEqual('云宝', updated['agents']['list'][2]['name'])
        for agent_id, name in [('pinkie-party','碧琪'), ('party-openclaw','云宝')]:
            workspace = config.parent / ('workspace-' + agent_id)
            self.assertEqual(setup.party_soul(name), (workspace/'SOUL.md').read_text())
            self.assertEqual(setup.identity_file(name), (workspace/'IDENTITY.md').read_text())
            self.assertEqual('保留群聊的操作边界', (workspace/'AGENTS.md').read_text())
        backups = list((home/'Library/Application Support/SuperPinkie/backups').glob('party-identity-*/*.md'))
        self.assertEqual(4, len(backups))
        for backup in backups:
            self.assertEqual(originals[backup.name], backup.read_text())
        self.assertFalse(setup.install(home))

    def test_identity_migration_preserves_custom_and_symlinked_files(self):
        home = Path(self.temp.name) / 'custom-identity-home'
        config = home / '.openclaw/openclaw.json'
        config.parent.mkdir(parents=True)
        config.write_text('{"agents":{"list":[]}}')
        setup.install(home)
        workspace = config.parent/'workspace-pinkie-party'
        custom = '自定义身份文件，不可覆盖'
        (workspace/'IDENTITY.md').write_text(custom)
        external = home/'external-soul.md'
        external.write_text(setup.legacy_party_soul('碧琪'))
        (workspace/'SOUL.md').unlink()
        (workspace/'SOUL.md').symlink_to(external)
        self.assertFalse(setup.install(home))
        self.assertEqual(custom, (workspace/'IDENTITY.md').read_text())
        self.assertTrue((workspace/'SOUL.md').is_symlink())
        self.assertEqual(setup.legacy_party_soul('碧琪'), external.read_text())


if __name__ == '__main__':
    unittest.main()
