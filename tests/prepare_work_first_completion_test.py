"""tools/claude-deploy/prepare-work-first-completion.py 的纯逻辑单测。

prepare() 本身要 macOS 的 cp -c、codesign 和已安装的 App；这里全部换成临时目录里的假 App、假仓库、假 HOME，
subprocess.run 换成假函数：cp 用 shutil.copytree 模拟，node / codesign 只按计划改动暂存副本，diff -rq 用
Python 比对两棵目录生成同格式输出。不碰 /Applications、~/.openclaw，不签名，不跑真补丁。
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_work_first', REPO_ROOT / 'tools/claude-deploy/prepare-work-first-completion.py')
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)

MA = prep.RES / 'services/mode-architecture'
OC = prep.RES / 'runtime/openclaw'
# 白名单里 Launcher / CodeResources 两条按 POSIX 字符串比较；工具只在 Mac 上用，Windows 上就不模拟签名改动
SIGNED = os.name != 'nt'
AGENTS_MARK = '- **成品要点一下就能用。**'
HEADING = '## 自动整理：别把网页里的定时器当成后台'
END = '要用的工具不在、'
SETUP_PY = ('import shutil\n'
            'def _copy_if_changed(source, target):\n'
            '    if target.is_file() and target.read_bytes() == source.read_bytes():\n'
            '        return False\n'
            '    target.parent.mkdir(parents=True, exist_ok=True)\n'
            '    shutil.copy2(source, target)\n'
            '    return True\n')
LOSSY_SETUP_PY = 'def _copy_if_changed(source, target):\n    target.write_text("stale")\n    return True\n'


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    return path


def tree_diff(a, b):
    """模拟 GNU `diff -rq` 的输出行。"""
    lines = []

    def walk(x, y):
        xs, ys = set(os.listdir(x)), set(os.listdir(y))
        lines.extend(f'Only in {x}: {n}' for n in sorted(xs - ys))
        lines.extend(f'Only in {y}: {n}' for n in sorted(ys - xs))
        for n in sorted(xs & ys):
            px, py = os.path.join(x, n), os.path.join(y, n)
            if os.path.isdir(px) and os.path.isdir(py):
                walk(px, py)
            elif Path(px).read_bytes() != Path(py).read_bytes():
                lines.append(f'Files {px} and {py} differ')

    walk(a, b)
    return lines


class Sha(unittest.TestCase):
    def test_file_missing_and_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(prep.sha(write(root / 'a.txt', '碧琪')), hashlib.sha256('碧琪'.encode()).hexdigest())
            self.assertEqual(prep.sha(write(root / 'empty', '')), hashlib.sha256(b'').hexdigest())
            self.assertIsNone(prep.sha(root / 'missing'))
            self.assertIsNone(prep.sha(root))


class Prepare(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.app = self.root / 'installed' / prep.APP.name
        self.candidate, self.repo, self.home, self.out = (self.root / n for n in ('candidate', 'repo', 'home', 'out'))
        self.stage = self.out / prep.APP.name
        write(self.app / 'Contents/MacOS/Launcher', 'launcher')
        write(self.app / 'Contents/_CodeSignature/CodeResources', 'sig-0')
        for name in prep.PLUGIN_FILES:
            write(self.app / MA / name, 'installed ' + name)
            write(self.candidate / 'services/mode-architecture' / name, ('workFirstContext ' if name == 'index.mjs' else '') + 'candidate ' + name)
        write(self.app / MA / 'setup.py', SETUP_PY)
        write(self.app / MA / 'other.mjs', 'unrelated')
        for rel, text in (('dist/chat-pg-A.js', 'media'), ('dist/control-ui/assets/chat-page-B.js', 'chat'),
                          ('dist/control-ui/assets/other.js', 'other'), ('dist/control-ui/asset-manifest.json', '{"v":1}')):
            write(self.app / OC / rel, text)
        write(self.repo / 'personas/project/AGENTS.md', f'模板\n{AGENTS_MARK} 新段落\n')
        write(self.repo / 'personas/project/playbooks/environment.md', f'# 模板\n\n{HEADING}\n\n新增段落\n\n{END}模板原则\n')
        self.live_agents = write(self.home / '.openclaw/workspace-project/AGENTS.md', f'# 个人\n{AGENTS_MARK} 旧段落\n个人内容\n')
        self.live_env = write(self.home / '.openclaw/workspace-project/playbooks/environment.md', f'# 打法：认清电脑\n\n{END}个人\n')
        self.calls, self.on_sign, self.diff_result, self.node_error = [], None, None, False
        self.node_edits = {'dist/chat-pg-A.js': 'patched media', 'dist/control-ui/assets/chat-page-B.js': 'patched chat',
                           'dist/control-ui/asset-manifest.json': '{"v":2}'}
        mock.patch.object(prep, 'APP', self.app).start()
        mock.patch.object(prep, 'REPO', self.repo).start()
        mock.patch.object(prep.subprocess, 'run', self.fake_run).start()
        mock.patch.object(prep.Path, 'home', return_value=self.home).start()
        self.addCleanup(mock.patch.stopall)

    def fake_run(self, cmd, **kwargs):
        self.calls.append(list(cmd))
        if cmd[0] == 'cp':
            shutil.copytree(cmd[2], cmd[3], symlinks=True)
        elif cmd[0] == 'node':
            if self.node_error:
                raise subprocess.CalledProcessError(1, cmd)
            for rel, text in self.node_edits.items():
                write(Path(cmd[-1]) / rel, text)
        elif cmd[0] == 'codesign' and '--force' in cmd:
            if SIGNED:
                write(Path(cmd[-1]) / 'Contents/MacOS/Launcher', 'signed')
                write(Path(cmd[-1]) / 'Contents/_CodeSignature/CodeResources', 'sig-1')
            if self.on_sign:
                self.on_sign(Path(cmd[-1]))
        elif cmd[0] == 'diff':
            if self.diff_result:
                return self.diff_result
            lines = tree_diff(cmd[-2], cmd[-1])
            return subprocess.CompletedProcess(cmd, 1 if lines else 0, ''.join(line + '\n' for line in lines), '')
        return subprocess.CompletedProcess(cmd, 0, '', '')

    def prepare(self, out=None):
        out = out or self.out
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            prep.prepare(out, self.candidate)
        return json.loads(buffer.getvalue()), json.loads((out.resolve() / 'manifest.json').read_text(encoding='utf-8'))

    def assert_exit(self, message, out=None):
        with self.assertRaises(SystemExit) as ctx:
            self.prepare(out)
        self.assertEqual(ctx.exception.code, message)
        self.assertFalse((self.out / 'manifest.json').exists())

    def test_prepares_staged_copy_and_report(self):
        live = (self.live_agents.read_text(encoding='utf-8'), self.live_env.read_text(encoding='utf-8'))
        summary, report = self.prepare()
        expected = {str(MA / n) for n in prep.PLUGIN_FILES} | {str(OC / 'dist/chat-pg-A.js'), str(OC / 'dist/control-ui/asset-manifest.json'),
                                                                 str(OC / 'dist/control-ui/assets/chat-page-B.js')}
        if SIGNED:
            expected |= {'Contents/MacOS/Launcher', 'Contents/_CodeSignature/CodeResources'}
        self.assertEqual({c['path'] for c in report['changes']}, expected)
        for change in report['changes']:
            self.assertEqual(change['installedBefore'], prep.sha(self.app / change['path']))
            self.assertEqual(change['candidate'], prep.sha(self.stage / change['path']))
        probe = [{'cycle': 1, 'filesMatch': True}, {'cycle': 2, 'filesMatch': True}]
        self.assertEqual((report['status'], report['app'], report['signature'], report['liveGatewayRestarted'], report['startupCopyProbe']),
                         ('prepared_not_installed', str(self.stage), 'deep strict passed', False, probe))
        self.assertEqual(summary, {'status': 'prepared_not_installed', 'appFiles': len(expected), 'handbookFiles': 2,
                                   'signature': 'deep strict passed', 'startupCopyProbe': probe, 'manifest': str(self.out / 'manifest.json')})
        for name in prep.PLUGIN_FILES:
            self.assertEqual(prep.sha(self.out / 'startup-copy-probe' / name), prep.sha(self.candidate / 'services/mode-architecture' / name))
        # 已安装的 App 与个人手册都原样，手册改动只落在暂存目录
        self.assertEqual((self.app / MA / 'index.mjs').read_text(encoding='utf-8'), 'installed index.mjs')
        self.assertEqual((self.live_agents.read_text(encoding='utf-8'), self.live_env.read_text(encoding='utf-8')), live)
        staged = self.out / 'handbooks/workspace-project'
        self.assertEqual((staged / 'AGENTS.md').read_text(encoding='utf-8'), f'# 个人\n{AGENTS_MARK} 新段落\n个人内容\n')
        self.assertEqual((staged / 'playbooks/environment.md').read_text(encoding='utf-8'), f'# 打法：认清电脑\n\n{HEADING}\n\n新增段落\n\n{END}个人\n')
        self.assertEqual(report['personalChanges'], [
            {'path': str(Path('workspace-project/AGENTS.md')), 'installedBefore': prep.sha(self.live_agents), 'candidate': prep.sha(staged / 'AGENTS.md')},
            {'path': str(Path('workspace-project/playbooks/environment.md')), 'installedBefore': prep.sha(self.live_env),
             'candidate': prep.sha(staged / 'playbooks/environment.md')}])
        snapshot = str(self.out / 'snapshot.app')
        self.assertEqual([c[0] for c in self.calls], ['cp', 'cp', 'node', 'codesign', 'codesign', 'diff'])
        self.assertEqual(self.calls[0], ['cp', '-cR', str(self.app), snapshot])
        self.assertEqual(self.calls[1], ['cp', '-cR', snapshot, str(self.stage)])
        node = self.calls[2]
        self.assertEqual(node[:3] + node[4:], ['node', '--input-type=module', '-e', str(self.repo), str(self.stage / OC)])
        for needle in ('/^chat-pg-.*\\.js$/', '/^chat-page-.*\\.js$/', 'patch/apply-work-first-media-gate.mjs', "throw Error('Ambiguous module')"):
            self.assertIn(needle, node[3])
        self.assertEqual(self.calls[3], ['codesign', '--force', '--options', 'runtime', '--sign', '-', '--requirements',
                                         '=designated => identifier "com.cle0726.super-pinkie"', str(self.stage)])
        self.assertEqual(self.calls[4], ['codesign', '--verify', '--deep', '--strict', str(self.stage)])
        self.assertEqual(self.calls[5], ['diff', '-rq', '--no-dereference', snapshot, str(self.stage)])

    def test_refuses_existing_or_live_destinations(self):
        self.out.mkdir()
        # ~/.openclaw 是前缀匹配：同前缀的 ~/.openclaw-review 也被拒（偏严，无害）
        for out in (self.out, self.home / '.openclaw' / 'stage', self.home / '.openclaw-review'):
            with self.subTest(out=out), self.assertRaisesRegex(SystemExit, 'new staging directory'):
                prep.prepare(out, self.candidate)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.home / '.openclaw/stage').exists())

    @unittest.skipIf(os.name == 'nt', '/Applications 只在 POSIX 路径下有意义')
    def test_refuses_applications(self):
        with self.assertRaisesRegex(SystemExit, 'new staging directory'):
            prep.prepare(Path('/Applications/超級碧琪-review'), self.candidate)
        self.assertEqual(self.calls, [])

    def test_candidate_must_be_complete_and_work_first(self):
        (self.candidate / 'services/mode-architecture/file-delivery.mjs').unlink()
        self.assert_exit('Missing candidate: ' + str(self.candidate / 'services/mode-architecture/file-delivery.mjs'))
        shutil.rmtree(self.out)
        write(self.candidate / 'services/mode-architecture/file-delivery.mjs', 'x')
        write(self.candidate / 'services/mode-architecture/index.mjs', 'export const plain = 1;')
        self.assert_exit('Not a work-first candidate')
        self.assertNotIn('node', [c[0] for c in self.calls])

    def test_patch_step_failure_propagates(self):
        self.node_error = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.prepare()
        self.assertNotIn('codesign', [c[0] for c in self.calls])

    def test_startup_copy_must_keep_candidate_bytes(self):
        write(self.app / MA / 'setup.py', LOSSY_SETUP_PY)
        self.assert_exit('Startup copy lost fix: index.mjs')
        self.assertNotIn('codesign', [c[0] for c in self.calls])

    def test_added_or_removed_files_stop(self):
        self.on_sign = lambda stage: write(stage / OC / 'dist/new.js', 'x')
        with self.assertRaisesRegex(SystemExit, r'^Unexpected added/removed file: Only in .*: new\.js$'):
            self.prepare()

    def test_diff_error_exit_code(self):
        self.diff_result = subprocess.CompletedProcess(['diff'], 2, '', 'diff: boom')
        self.assert_exit('diff: boom')

    def test_installed_app_changing_midway_stops(self):
        self.on_sign = lambda stage: write(self.app / MA / 'index.mjs', 'user edit')
        self.assert_exit('Installed App changed during preparation: ' + str(MA / 'index.mjs'))
        self.assertEqual((self.app / MA / 'index.mjs').read_text(encoding='utf-8'), 'user edit')

    def test_ownership_allowlist_boundaries(self):
        cases = {
            OC / 'dist/control-ui/assets/chat-page-B.js.br': True,  # chat-page- 前缀下的孪生压缩文件
            OC / 'dist/chat-pg-A.js.gz': True,
            OC / 'dist/control-ui/assets/other.js': False,
            OC / 'dist/sub/chat-pg-A.js': False,  # 只认 dist 这一层
            OC / 'dist/control-ui/chat-page-B.js': False,  # 不在 assets 下
            OC / 'dist/control-ui/assets/chat-pg-A.js': False,
            prep.RES / 'services/other/index.mjs': False,  # 同名插件文件但不在 mode-architecture
            MA / 'other.mjs': False,
        }
        for index, (rel, allowed) in enumerate(cases.items()):
            with self.subTest(rel=str(rel)):
                if not (self.app / rel).exists():
                    write(self.app / rel, 'before')
                self.on_sign = lambda stage, rel=rel: write(stage / rel, 'after')
                out = self.root / f'out-{index}'
                if allowed:
                    _, report = self.prepare(out)
                    self.assertIn(str(rel), {c['path'] for c in report['changes']})
                else:
                    with self.assertRaises(SystemExit) as ctx:
                        self.prepare(out)
                    self.assertEqual(ctx.exception.code, 'Unowned change: ' + str(rel))

    def test_owned_handbook_paragraph_must_be_unique(self):
        write(self.live_agents, '# 个人\n没有这一段\n')
        self.assert_exit('Cannot identify owned handbook paragraph')
        shutil.rmtree(self.out)
        write(self.live_agents, f'{AGENTS_MARK} a\n')
        write(self.repo / 'personas/project/AGENTS.md', f'{AGENTS_MARK} b\n{AGENTS_MARK} c\n')
        self.assert_exit('Cannot identify owned handbook paragraph')

    def test_environment_handbook_already_changed(self):
        write(self.live_env, f'# 打法\n\n{HEADING}\n用户自己改过\n')
        self.assert_exit('Handbook already changed; review before staging')
        self.assertTrue((self.out / 'handbooks/workspace-project/AGENTS.md').is_file())

    @unittest.expectedFailure
    def test_current_repo_template_still_carries_heading(self):
        # 真 bug：d8278328 把「## 自动整理：别把网页里的定时器当成后台」从 personas/project/playbooks/environment.md
        # 挪走了，这个脚本没跟着改。用当前仓库的模板跑，签名、diff 都过了之后在 template.index(heading)
        # 抛 ValueError（不是 SystemExit 提示），manifest.json 不会写出，脚本对当前仓库已经跑不通。
        with mock.patch.object(prep, 'REPO', REPO_ROOT):
            self.prepare()

    @unittest.expectedFailure
    def test_staging_path_containing_and(self):
        # 真 bug（小）：diff 输出按 ' and ' 切分取路径，暂存目录名里带 ' and ' 时 relative_to 抛 ValueError。
        self.prepare(self.root / 'review and sign' / 'out')


if __name__ == '__main__':
    unittest.main()
