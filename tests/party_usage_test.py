import concurrent.futures
import json
from pathlib import Path
import runpy
import tempfile
import unittest

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
        result=self.collect();self.assertEqual('80%',result['quota']);self.assertEqual(1.25,result['cost'])


if __name__=='__main__':unittest.main()
