import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / 'installer/macos/stage-git-update.py'
spec = importlib.util.spec_from_file_location('stage_git_update', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def run(*args, cwd=None):
    result = subprocess.run(['git', *map(str,args)], cwd=cwd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return result.stdout.strip()


class StageGitUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='pinkie-git-update-')
        self.root=Path(self.temp.name)
        self.env={key:getattr(module,key) for key in ('STATE','CONFIG','UPDATES','MANAGED','MANIFEST')}
        module.STATE=self.root/'state';module.CONFIG=self.root/'config/install.env';module.UPDATES=module.STATE/'updates';module.MANAGED=module.STATE/'repository';module.MANIFEST=module.UPDATES/'prepared-git.json'
        self.remote=self.root/'remote.git';self.writer=self.root/'writer';self.repo=self.root/'installed'
        run('init','--bare',self.remote)
        run('init','-b','main',self.writer)
        run('-C',self.writer,'config','user.email','test@example.invalid');run('-C',self.writer,'config','user.name','Test')
        (self.writer/'update-full.sh').write_text('#!/bin/sh\n',encoding='utf-8');(self.writer/'VERSION').write_text('1.0.0\n',encoding='utf-8');(self.writer/'CHANGELOG.md').write_text('# 更新\n## 1.1.0\n- 第一项\n- 第二项\n- 第三项\n',encoding='utf-8')
        installer=self.writer/'install-full.sh';installer.write_text('#!/bin/bash\nprintf "%s\\n" "$PINKIE_APP_ROOT" "$@" > "$PINKIE_TEST_INSTALL_MARKER"\n');installer.chmod(0o755)
        run('-C',self.writer,'add','update-full.sh','install-full.sh','VERSION','CHANGELOG.md');run('-C',self.writer,'commit','-m','initial');run('-C',self.writer,'remote','add','origin',self.remote);run('-C',self.writer,'push','origin','main')
        run('clone','--branch','main',self.remote,self.repo)
        run('-C',self.repo,'config','user.email','test@example.invalid');run('-C',self.repo,'config','user.name','Test')
        module.CONFIG.parent.mkdir(parents=True);module.CONFIG.write_text('PINKIE_REPO='+shlex.quote(str(self.repo))+'\nPINKIE_PROVIDER=demo\n',encoding='utf-8')
        (self.writer/'VERSION').write_text('1.1.0\n',encoding='utf-8');run('-C',self.writer,'add','VERSION');run('-C',self.writer,'commit','-m','new');run('-C',self.writer,'push','origin','main')
    def tearDown(self):
        for key,value in self.env.items():setattr(module,key,value)
        self.temp.cleanup()
    def test_fetches_without_changing_checkout_then_applies_exact_commit(self):
        old=run('-C',self.repo,'rev-parse','HEAD')
        self.assertTrue(module.check()['available'])
        with contextlib.redirect_stdout(io.StringIO()) as out: result=module.prepare()
        self.assertTrue(result['ready']);self.assertEqual(result['version'],'1.1.0');self.assertEqual(len(result['notes'].splitlines()),3)
        self.assertEqual(old,run('-C',self.repo,'rev-parse','HEAD'))
        self.assertIn('"stage":"verify"',out.getvalue())
        manifest=json.loads(module.MANIFEST.read_text());target=manifest['target']
        applied=module.apply();self.assertEqual(target,applied['target']);self.assertEqual(target,run('-C',self.repo,'rev-parse','HEAD'))
    def test_tracked_changes_are_never_overwritten(self):
        (self.repo/'VERSION').write_text('my changes\n')
        with self.assertRaisesRegex(RuntimeError,'修改'):module.prepare()
        self.assertEqual((self.repo/'VERSION').read_text(),'my changes\n')
    def test_checkout_change_after_download_prevents_apply(self):
        with contextlib.redirect_stdout(io.StringIO()):module.prepare()
        (self.repo/'VERSION').write_text('later edit\n')
        with self.assertRaisesRegex(RuntimeError,'修改'):module.apply()
        self.assertEqual((self.repo/'VERSION').read_text(),'later edit\n')
    def test_unknown_size_never_converts_object_percentage_to_file_percentage(self):
        event=module.parse_git_progress('Receiving objects:  50% (5/10), 1.25 MiB | 2.00 MiB/s')
        self.assertEqual(event['downloaded'],1310720);self.assertEqual(event['bytesPerSecond'],2097152);self.assertIsNone(event['total']);self.assertIsNone(event['etaSeconds'])
        self.assertIsNone(module.parse_git_progress('Receiving objects: 100% (10/10)'))
    def test_first_install_stages_separately_until_apply(self):
        old_remote=module.DEFAULT_REMOTE
        try:
            module.DEFAULT_REMOTE=str(self.remote)
            module.CONFIG.unlink()
            self.assertTrue(module.check()['available'])
            with contextlib.redirect_stdout(io.StringIO()):result=module.prepare()
            self.assertTrue(result['ready']);self.assertFalse(module.MANAGED.exists())
            staged=Path(json.loads(module.MANIFEST.read_text())['repo']);self.assertTrue(staged.is_dir())
            applied=module.apply();self.assertEqual(Path(applied['repo']),module.MANAGED.resolve());self.assertTrue(module.MANAGED.is_dir())
        finally:
            module.DEFAULT_REMOTE=old_remote
    def run_detached_prepared_branch(self):
        # Run only the prepared-install branch, with a fake installer entirely
        # inside this temporary Git repo. Never inspect or stop a real gateway.
        source=(SCRIPT.parent/'detached-update.sh').read_text()
        start=source.index('# New dialog:');end=source.index('\nREPO=""',start)
        prefix='set -eu\nAPP_PATH="$2"\nCONFIG_FILE="$PINKIE_CONFIG_ROOT/install.env"\nnotify() { :; }\nreopen_app() { :; }\n'
        marker=self.root/'installed-marker';app=self.root/'Applications/Pinkie.app'
        env={**os.environ,'PINKIE_STATE_ROOT':str(module.STATE),'PINKIE_CONFIG_ROOT':str(module.CONFIG.parent),
             'PINKIE_PYTHON_BIN':os.sys.executable,'PINKIE_TEST_INSTALL_MARKER':str(marker)}
        result=subprocess.run(['/bin/bash','-c',prefix+source[start:end],'fixture','0',str(app),'--prepared',str(SCRIPT)],
                              env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        return result,marker,app
    def test_prepared_helper_uses_verified_commit_and_original_provider(self):
        with contextlib.redirect_stdout(io.StringIO()):module.prepare()
        target=json.loads(module.MANIFEST.read_text())['target']
        result,marker,app=self.run_detached_prepared_branch()
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(run('-C',self.repo,'rev-parse','HEAD'),target)
        self.assertEqual(marker.read_text().splitlines(),[str(app.parent),'--provider','demo'])
    def test_prepared_helper_does_not_install_after_user_changes(self):
        with contextlib.redirect_stdout(io.StringIO()):module.prepare()
        (self.repo/'VERSION').write_text('changed later\n')
        result,marker,_=self.run_detached_prepared_branch()
        self.assertNotEqual(result.returncode,0);self.assertFalse(marker.exists());self.assertEqual((self.repo/'VERSION').read_text(),'changed later\n')

if __name__ == '__main__':unittest.main()
