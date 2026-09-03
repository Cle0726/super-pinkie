import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('roundtable_server', ROOT/'services/roundtable/server.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


MODELS = [
    {'id': 'relay/a', 'name': 'A', 'provider': 'relay'},
    {'id': 'relay/b', 'name': 'B', 'provider': 'relay'},
    {'id': 'relay/c', 'name': 'C', 'provider': 'relay'},
]


class ImmediatePool:
    def __init__(self):
        self.calls = []

    def submit(self, fn, *args):
        self.calls.append((fn, args))

    def shutdown(self, **_):
        pass


class RoundtableServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.models = mock.patch.object(MODULE, 'available_models', return_value=MODELS)
        self.models.start()
        self.store = MODULE.Store(self.temp.name)

    def tearDown(self):
        self.store.db.close()
        self.models.stop()
        self.temp.cleanup()

    def create(self):
        members = ['pinkie', 'twilight', 'xinglan']
        models = {'pinkie': 'relay/a', 'twilight': 'relay/b', 'xinglan': 'relay/c'}
        return self.store.create_session('测试圆桌', members, models)

    def test_history_is_separate_and_defaults_to_seven_members(self):
        session = self.store.create_session('第一张圆桌')
        self.assertEqual(list(MODULE.MEMBERS), session['members'])
        self.assertTrue((Path(self.temp.name)/'roundtable.sqlite3').is_file())
        self.assertEqual('scene', self.store.messages(session['id'])[0]['kind'])

    def test_requires_three_members_and_known_relay_models(self):
        with self.assertRaisesRegex(ValueError, '至少邀请三位'):
            self.store.create_session('太小', ['pinkie', 'xinglan'])
        with self.assertRaisesRegex(ValueError, '不可用'):
            self.store.create_session('错误模型', ['pinkie','twilight','xinglan'],
                                      {'pinkie':'relay/a','twilight':'relay/b','xinglan':'local/nope'})

    def test_send_requires_three_distinct_models_and_queues_one_run(self):
        session = self.create()
        manager = MODULE.Roundtable(self.store)
        manager.pool.shutdown(wait=False, cancel_futures=True)
        manager.pool = ImmediatePool()
        result = manager.send(session['id'], '一起判断这个方案')
        self.assertRegex(result['runId'], r'^[a-f0-9]{32}$')
        self.assertEqual(1, len(manager.pool.calls))
        self.assertEqual('user', self.store.messages(session['id'])[-1]['sender'])

        self.store.write("UPDATE runs SET status='done' WHERE id=?", (result['runId'],))
        self.store.update_session(session['id'], {'models': {'pinkie':'relay/a','twilight':'relay/a','xinglan':'relay/b'}})
        with self.assertRaisesRegex(ValueError, '三个不同模型'):
            manager.send(session['id'], '再讨论一次')

    def test_prompt_only_adds_name_identity_and_public_reasoning_rule(self):
        session = self.create()
        manager = MODULE.Roundtable(self.store)
        prompt = manager.prompt('twilight', 'ideas', '做一个方案', '铲屎官：参考内容')
        self.assertIn('只能说“紫悦”', prompt)
        self.assertIn('不要因此降低真实模型的分析、写作、技术或推理能力', prompt)
        self.assertIn('不要输出隐藏思维链', prompt)
        self.assertIn('所选项目快照', prompt)
        self.assertIn('不得猜测或引用其他项目', prompt)
        manager.close()

    def test_visible_self_reference_uses_pony_name_without_breaking_normal_words(self):
        text = MODULE.clean_self_reference('我认为这是我的方案，我们继续，但保留自我检查。', '星澜')
        self.assertEqual('星澜认为这是星澜的方案，大家继续，但保留自我检查。', text)

    def test_worker_prompt_anchors_to_selected_project_without_blocking_other_folders(self):
        project = str(Path(self.temp.name) / 'chosen-project')
        prompt = MODULE.Roundtable.worker_prompt('xinglan', '完成任务', '参考结论', project, True)
        self.assertIn('主项目与默认工作目录：' + project, prompt)
        self.assertIn('不是访问权限边界', prompt)
        self.assertIn('绝对路径访问电脑上的其他文件夹', prompt)
        self.assertIn('禁止重复已经完成', prompt)
        self.assertTrue(MODULE.transient_failure('upstream connection_reset'))
        self.assertTrue(MODULE.transient_failure('AbortError after connection_closed'))
        self.assertFalse(MODULE.transient_failure('invalid api key'))

    def test_project_brief_reads_only_the_selected_folder(self):
        selected = Path(self.temp.name) / 'selected'; selected.mkdir()
        other = Path(self.temp.name) / 'other'; other.mkdir()
        (selected / 'README.md').write_text('SELECTED FACT', encoding='utf-8')
        (selected / '.env').write_text('SECRET=hidden', encoding='utf-8')
        (other / 'README.md').write_text('OTHER PROJECT', encoding='utf-8')
        brief = self.store.project_brief(str(selected))
        self.assertIn('SELECTED FACT', brief)
        self.assertNotIn('SECRET=hidden', brief)
        self.assertNotIn('OTHER PROJECT', brief)


if __name__ == '__main__':
    unittest.main()
