import concurrent.futures
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

usage=runpy.run_path(str(Path(__file__).resolve().parents[1]/'services/party/usage.py'))


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pinkie-usage-test-');self.home=Path(self.temp.name)
        self.source=self.home/'.antigravity_cle/codex_local_access_stats.json';self.source.parent.mkdir()
    def tearDown(self):self.temp.cleanup()
    def put(self,epoch='one',stamp=100,**values):
        self.source.write_text(json.dumps({'since':epoch,'updatedAt':stamp,'totals':{'requestCount':10,'inputTokens':1000,'outputTokens':200,'cachedTokens':700,'estimatedCostUsd':1.25,**values}}))
    def collect(self):return usage['collect'](self.home)
    def test_repeated_refresh_concurrency_and_process_restart_are_idempotent(self):
        self.put();first=self.collect()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results=list(pool.map(lambda _:self.collect(),range(12)))
        self.assertTrue(all(r['cost']==first['cost']==1.25 for r in results))
        reloaded=runpy.run_path(str(Path(__file__).resolve().parents[1]/'services/party/usage.py'))
        self.assertEqual(1000,reloaded['collect'](self.home)['input'])
        self.assertTrue((self.home/'Library/Application Support/SuperPinkie/usage.sqlite3').is_file())
    def test_only_deltas_are_added_and_new_source_epoch_does_not_clear_lifetime(self):
        self.put();self.collect()
        self.put(stamp=101,inputTokens=1500,estimatedCostUsd=2);self.assertEqual(2,self.collect()['cost'])
        self.put(epoch='two',stamp=200,requestCount=1,inputTokens=100,outputTokens=50,cachedTokens=0,estimatedCostUsd=.5)
        total=self.collect();self.assertEqual(1600,total['input']);self.assertEqual(2.5,total['cost'])
        self.assertEqual(2.5,self.collect()['cost'])
    def test_stale_lower_or_missing_snapshots_do_not_double_count_or_erase(self):
        self.put();self.collect()
        self.put(epoch='old',stamp=10,inputTokens=99999,estimatedCostUsd=99)
        self.assertEqual(1.25,self.collect()['cost'])
        self.put(stamp=110,inputTokens=5,estimatedCostUsd=.1);self.assertEqual(1000,self.collect()['input'])
        self.source.write_text('broken');result=self.collect();self.assertEqual(1.25,result['cost']);self.assertTrue(result['stale'])
    def test_unknown_values_stay_unknown_and_only_aggregate_data_is_returned(self):
        self.assertIsNone(self.collect()['cost']);self.assertIsNone(self.collect()['input'])
        self.put();result=self.collect();self.assertIsNone(result['cacheWrite']);self.assertIsNone(result['quota'])
        self.assertNotIn('accounts',result);self.assertNotIn('apiKeys',result);self.assertIn('不是实际账单',result['costNote'])
    def test_quota_is_actual_cached_percentage_not_spend_or_sample_balance(self):
        self.put();cache=self.home/'.antigravity_cle/cache/quota_api_v1_desktop/authorized/q.json';cache.parent.mkdir(parents=True)
        cache.write_text(json.dumps({'payload':{'models':{'gemini-a':{'quotaInfo':{'remainingFraction':.97}},'gpt-b':{'quotaInfo':{'remainingFraction':.8}},'tab-internal':{'quotaInfo':{'remainingFraction':0}}}}}))
        result=self.collect();self.assertEqual('日80%',result['quota']);self.assertEqual(1.25,result['cost'])
    def test_every_model_output_adds_a_persistent_display_estimate(self):
        usage['record_model_output']('relay/a','第一条回复',100,20,self.home)
        first=self.collect();self.assertEqual(1,first['requests']);self.assertGreater(first['cost'],.01);self.assertLess(first['cost'],.02)
        usage['record_model_output']('relay/b','第二条回复',50,10,self.home)
        second=self.collect();self.assertEqual(2,second['requests']);self.assertGreater(second['cost'],first['cost'])
        self.assertIn('展示估算',second['source']);self.assertIn('真实单价',second['costNote'])

    def test_old_exaggerated_display_cost_is_migrated_without_clearing_usage(self):
        state=self.home/'Library/Application Support/SuperPinkie';state.mkdir(parents=True)
        path=state/'model-usage.json'
        path.write_text(json.dumps({'input':284825,'output':13434,'cacheRead':874265,'requests':18,'cost':113.49}))
        before=self.collect();self.assertGreater(before['cost'],.18);self.assertLess(before['cost'],.3)
        usage['record_model_output']('relay/a','继续',100,20,self.home)
        saved=json.loads(path.read_text());self.assertEqual(19,saved['requests']);self.assertEqual(2,saved['pricingVersion'])
        self.assertGreater(saved['cost'],before['cost']);self.assertLess(saved['cost'],.4)

    def test_signed_macos_app_resources_are_never_runtime_publish_targets(self):
        app_root=self.home/'Applications/超級碧琪.app/Contents/Resources/SuperPinkie/runtime/openclaw/dist/control-ui'
        normal_root=self.home/'.openclaw/runtime/openclaw/dist/control-ui'
        app_root.mkdir(parents=True);normal_root.mkdir(parents=True)
        with patch.dict('os.environ',{'OPENCLAW_ROOT':str(app_root.parents[1])},clear=True), \
             patch('shutil.which',return_value=None), \
             patch.object(Path,'home',return_value=self.home):
            roots=usage['control_roots'](self.home)
        self.assertNotIn(app_root,roots)


if __name__=='__main__':unittest.main()
