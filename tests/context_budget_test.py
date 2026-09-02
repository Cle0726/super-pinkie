import json
from pathlib import Path
import runpy
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
budget=runpy.run_path(str(ROOT/'services/context/context_budget.py'))
setup=runpy.run_path(str(ROOT/'services/context/setup.py'))


class ContextBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pinkie-context-test-')
        self.home=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_provider_limits_are_not_guessed_from_names(self):
        cfg={'models':{'providers':{'a':{'models':[{'id':'same','contextWindow':16000}]},'b':{'models':[{'id':'same','contextWindow':128000}]}}}}
        a=budget['model_budget']('a/same',cfg,self.home);b=budget['model_budget']('b/same',cfg,self.home)
        self.assertEqual(13600,a['threshold']);self.assertEqual(108800,b['threshold'])
        unknown=budget['model_budget']('other/same',cfg,self.home)
        self.assertEqual('conservative-fallback',unknown['source']);self.assertEqual(1000000,unknown['window'])
    def test_codex_metadata_and_explicit_override(self):
        cache=self.home/'.codex/models_cache.json';cache.parent.mkdir()
        cache.write_text(json.dumps({'models':[{'slug':'model-a','context_window':200000,'effective_context_window_percent':95}]}))
        self.assertEqual(161500,budget['model_budget']('codex-cli/model-a',{},self.home)['threshold'])
        policy=self.home/'Library/Application Support/SuperPinkie/context-policy.json';policy.parent.mkdir(parents=True)
        policy.write_text(json.dumps({'modelLimits':{'codex-cli/model-a':64000}}))
        self.assertEqual(54400,budget['model_budget']('codex-cli/model-a',{},self.home)['threshold'])
    def test_setup_preserves_personas_auth_and_explicit_values_and_is_idempotent(self):
        p=self.home/'.openclaw/openclaw.json';p.parent.mkdir()
        cfg={'models':{'providers':{'a':{'apiKey':'keep-secret','baseUrl':'http://example.test','models':[{'id':'known','contextWindow':64000},{'id':'unknown'}]}}},'agents':{'list':[{'id':'main','workspace':'/preserved'}],'defaults':{'compaction':{'reserveTokens':60000,'keepRecentTokens':40000}}}}
        p.write_text(json.dumps(cfg));self.assertTrue(setup['install'](self.home))
        after=json.loads(p.read_text());self.assertEqual(cfg['agents']['list'],after['agents']['list'])
        provider=after['models']['providers']['a'];self.assertEqual('keep-secret',provider['apiKey']);self.assertEqual('http://example.test',provider['baseUrl'])
        self.assertEqual(64000,provider['models'][0]['contextWindow']);self.assertEqual(1000000,provider['models'][1]['contextWindow'])
        self.assertNotIn('reserveTokens',after['agents']['defaults']['compaction'])
        self.assertFalse(setup['install'](self.home));self.assertTrue(list((self.home/'Library/Application Support/SuperPinkie/backups').glob('context-config-*/openclaw.json')))
    def test_history_summary_keeps_every_old_chunk_and_latest_message(self):
        rows=[{'id':1,'sender':'user','body':'早期重要目标。'*4000},{'id':2,'sender':'codex','body':'已检查文件。'*3000},{'id':3,'sender':'user','body':'继续处理'}]
        original=json.dumps(rows,ensure_ascii=False);calls=[]
        limits=budget['model_budget']('unknown/model',{},self.home)
        limits.update(window=32768,threshold=27852,keepRecent=8192,target=19660)
        def summarize(text):calls.append(text);return '目标、路径与已验证进展；继续处理待办。'
        result=budget['compact_history'](rows,{},limits,1000,summarize)
        self.assertTrue(result['changed']);self.assertEqual(2,result['through_id']);self.assertEqual([rows[-1]],result['rows'])
        self.assertGreater(len(calls),1);self.assertTrue(all(budget['estimate_tokens'](x)<limits['threshold'] for x in calls))
        self.assertEqual(original,json.dumps(rows,ensure_ascii=False))
        self.assertIn('早期重要目标',calls[0]);self.assertIn('已检查文件',calls[-1])
    def test_agent_cap_does_not_overwrite_provider_capacity_and_override_is_effective(self):
        p=self.home/'.openclaw/openclaw.json';p.parent.mkdir()
        cfg={'models':{'providers':{'a':{'models':[{'id':'known','contextWindow':128000,'contextTokens':64000}]}}},'agents':{'defaults':{'contextTokens':16000}}}
        p.write_text(json.dumps(cfg));setup['install'](self.home)
        saved=json.loads(p.read_text());self.assertEqual(cfg['models'],saved['models'])
        self.assertEqual(13600,budget['model_budget']('a/known',saved,self.home)['threshold'])
        policy=self.home/'Library/Application Support/SuperPinkie/context-policy.json'
        policy.write_text(json.dumps({'modelLimits':{'a/known':12000}}))
        setup['install'](self.home);saved=json.loads(p.read_text())
        self.assertEqual(12000,saved['models']['providers']['a']['models'][0]['contextTokens'])
        self.assertEqual(10200,budget['model_budget']('a/known',saved,self.home)['threshold'])
    def test_below_threshold_does_not_call_model_and_oversize_new_message_is_not_truncated(self):
        limits=budget['model_budget']('x/y',{},self.home)
        limits.update(window=32768,threshold=27852,keepRecent=8192,target=19660)
        fail=lambda _:self.fail('unexpected summary request')
        rows=[{'id':1,'body':'你好'}]
        self.assertFalse(budget['compact_history'](rows,{},limits,1000,fail)['changed'])
        huge=[{'id':1,'body':'旧记录'},{'id':2,'body':'中'*20000}]
        with self.assertRaisesRegex(ValueError,'分段发送'):
            budget['compact_history'](huge,{},limits,1000,fail)
        self.assertEqual(20000,len(huge[-1]['body']))
    def test_failed_summary_does_not_modify_old_checkpoint(self):
        limits=budget['model_budget']('x/y',{},self.home);limits.update(window=32768,threshold=27852,keepRecent=8192,target=19660);old={'summary':'已有摘要','through_id':4}
        rows=[{'id':5,'body':'历史'*14000},{'id':6,'body':'继续'}]
        with self.assertRaises(ValueError):budget['compact_history'](rows,old,limits,1000,lambda _:'')
        self.assertEqual({'summary':'已有摘要','through_id':4},old)
    def test_capacity_reduction_can_recompact_an_old_checkpoint_without_dropping_new_input(self):
        limits=budget['model_budget']('x/y',{},self.home)
        limits.update(window=4096,threshold=2867,keepRecent=819,target=2048)
        old={'summary':'之前的目标、路径和决定。'*300,'through_id':100}
        rows=[{'id':101,'body':'新要求'}];calls=[]
        def summarize(text):calls.append(text);return '精简后的目标、路径、决定。'
        result=budget['compact_history'](rows,old,limits,500,summarize)
        self.assertTrue(result['changed']);self.assertEqual(100,result['through_id']);self.assertEqual(rows,result['rows'])
        self.assertGreater(len(calls),1);self.assertTrue(all(budget['estimate_tokens'](x)<2867 for x in calls))


if __name__=='__main__':unittest.main()
