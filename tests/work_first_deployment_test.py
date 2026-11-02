import unittest,tempfile,hashlib,json,importlib.util
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'tools/claude-deploy/install-work-first-completion.py'
spec=importlib.util.spec_from_file_location('deploy',p);deploy=importlib.util.module_from_spec(spec);spec.loader.exec_module(deploy)
class Deployment(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.home=self.root/'home';self.app=self.root/'installed/超級碧琪.app';self.stage=self.root/'candidate/超級碧琪.app';self.changes=[]
  for name in ['index.mjs','companion.mjs']:
   rel=deploy.RES/'services/mode-architecture'/name
   for d,body in [(self.app,'old-'+name),(self.stage,'new-'+name)]:
    f=d/rel;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(body)
   self.changes.append({'path':str(rel),'installedBefore':deploy.sha(self.app/rel),'candidate':deploy.sha(self.stage/rel)})
  self.manifest=self.root/'candidate/manifest.json';self.manifest.write_text(json.dumps({'status':'prepared_not_installed','app':str(self.stage),'changes':self.changes}))
 def run_install(self,**kwargs):return deploy.install(self.manifest,app=self.app,home=self.home,backup_root=self.root/'backups',verify=kwargs.pop('verify',lambda p:None),**kwargs)
 def test_dry_run_leaves_targets_untouched(self):
  self.assertEqual(self.run_install()['status'],'dry_run')
  self.assertEqual(deploy.sha(self.app/self.changes[0]['path']),self.changes[0]['installedBefore'])
  self.assertFalse((self.root/'backups').exists())
 def test_concurrent_change_stops_before_writes(self):
  (self.app/self.changes[1]['path']).write_text('user edit')
  with self.assertRaisesRegex(RuntimeError,'Target changed'):self.run_install(apply=True)
  self.assertEqual(deploy.sha(self.app/self.changes[0]['path']),self.changes[0]['installedBefore'])
 def test_install_keeps_backup(self):
  result=self.run_install(apply=True)
  self.assertEqual(result['files'],2)
  self.assertEqual(deploy.sha(self.app/self.changes[0]['path']),self.changes[0]['candidate'])
  self.assertTrue(Path(result['backup']).is_dir())
 def test_failed_verification_rolls_back_owned_files(self):
  def verify(p):
   if p==self.app:raise RuntimeError('signature test failure')
  with self.assertRaisesRegex(RuntimeError,'signature test failure'):self.run_install(apply=True,verify=verify)
  for change in self.changes:self.assertEqual(deploy.sha(self.app/change['path']),change['installedBefore'])
if __name__ == "__main__": unittest.main()
