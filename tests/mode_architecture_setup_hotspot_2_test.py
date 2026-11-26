"""services/mode-architecture/setup.py 热点第二批复发测试。

只锁原提交自带测试抓不住的修复（已由 mode_architecture_setup_test.py、
mode_architecture_setup_hotspot_test.py、memory_search_choice_test.py、
plugin-file-lists.test.mjs 锁住的不重复）。

install() 一律指向临时 home。去掉 OPENAI_API_KEY，配置里也没有 openai
provider，_choose_memory_search 不会去探测 embeddings 接口：不联网、不用上游。
"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

SCRATCH = Path(tempfile.mkdtemp(prefix='pinkie-setup-hotspot2-'))
(SCRATCH / 'claude').mkdir()
(SCRATCH / 'codex').mkdir()
os.environ['CLAUDE_CONFIG_DIR'] = str(SCRATCH / 'claude')
os.environ['CODEX_HOME'] = str(SCRATCH / 'codex')
os.environ.pop('OPENAI_API_KEY', None)
os.environ.pop('PINKIE_STATE_ROOT', None)
os.environ.pop('PINKIE_MANAGED_GATEWAY', None)

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'mode_setup_hotspot_2', ROOT / 'services/mode-architecture/setup.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def fresh_home(test):
    tmp = tempfile.TemporaryDirectory(prefix='pinkie-setup-hotspot2-home-')
    test.addCleanup(tmp.cleanup)
    home = Path(tmp.name)
    config = home / '.openclaw/openclaw.json'
    config.parent.mkdir(parents=True)
    config.write_text('{}\n', encoding='utf-8')
    return home, config


def os_named(name):
    # 只换 setup 模块看到的 os.name。直接改真 os.name 会连带 pathlib 变成 Windows 路径。
    fake = types.ModuleType('os')
    fake.__dict__.update(os.__dict__)
    fake.name = name
    return fake


class ModeArchitectureSetupHotspot2Tests(unittest.TestCase):
    def test_fresh_config_alone_gets_its_own_allow_list(self):
        # b8b3e001：全新配置没有 plugins.allow，以前只在已有列表时才追加，插件装了却不生效。
        # windows_mode_agents_test 按 project-scope → first-person → mode-architecture 顺序装，
        # 前两个已经建好列表，只回退本文件的修复它仍然是绿的；这里只装这一个。
        data = {'agents': {'list': []}}
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        self.assertEqual(data['plugins']['allow'], ['pinkie-mode-architecture'])
        # 已有列表：追加一次，不重复，不动别人的条目。
        data = {'agents': {'list': []}, 'plugins': {'allow': ['other']}}
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        setup._configure_plugin(data, Path('/tmp/pinkie-mode-test'))
        self.assertEqual(data['plugins']['allow'], ['other', 'pinkie-mode-architecture'])

    def test_fresh_install_writes_the_allow_list_to_disk(self):
        home, config = fresh_home(self)
        self.assertTrue(setup.install(home))
        installed = json.loads(config.read_text(encoding='utf-8'))
        self.assertEqual(installed['plugins']['allow'], ['pinkie-mode-architecture'])

    def test_windows_permission_bits_do_not_count_as_a_change(self):
        # 9db905f2：Windows 只有只读一位，权限永远对不上 0o644/0o755；以前每次安装都 chmod
        # 并报「有改动」，网关跟着重载。内容相同时在 nt 上不比权限。
        with tempfile.TemporaryDirectory(prefix='pinkie-setup-managed-') as temp:
            path = Path(temp) / 'pinkie-collab'
            path.write_text('same\n', encoding='utf-8')
            os.chmod(path, 0o600)
            with patch.object(setup, 'os', os_named('nt')):
                self.assertFalse(setup._write_managed(path, 'same\n', 0o755))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    @unittest.skipIf(os.name == 'nt', '需要 POSIX 权限位')
    def test_posix_still_repairs_permission_bits(self):
        # 上一条的对照：非 Windows 上权限不对仍要改回来，修复只放过 nt。
        with tempfile.TemporaryDirectory(prefix='pinkie-setup-managed-') as temp:
            path = Path(temp) / 'pinkie-collab'
            path.write_text('same\n', encoding='utf-8')
            os.chmod(path, 0o600)
            with patch.object(setup, 'os', os_named('posix')):
                self.assertTrue(setup._write_managed(path, 'same\n', 0o755))
            self.assertEqual(path.stat().st_mode & 0o777, 0o755)
            self.assertFalse(setup._write_managed(path, 'same\n', 0o755))

    def test_install_applies_the_memory_search_choice(self):
        # ad55dad8：memory_search_choice_test 只测函数本身。这里锁 install 里的接线：
        # 没有可用的 embeddings key 时，装完的配置用内置全文检索，并记下选择。
        home, config = fresh_home(self)
        self.assertTrue(setup.install(home))
        installed = json.loads(config.read_text(encoding='utf-8'))
        self.assertEqual(installed['agents']['defaults']['memorySearch'], {'provider': 'none'})
        record = json.loads((Path(setup.state_root(home)) / 'memory-search-choice.json').read_text(encoding='utf-8'))
        self.assertEqual(record['provider'], 'none')

    def test_memory_search_choice_alone_still_rewrites_the_config(self):
        # ad55dad8：config_changed 还要比较 _choose_memory_search 前后的配置。其他设置都已稳定、
        # 只有记忆检索方式要补回时，_configure_plugin 返回 False，不比就不写盘。
        home, config = fresh_home(self)
        setup.install(home)
        self.assertFalse(setup.install(home), '第二次安装应当没有改动')
        data = json.loads(config.read_text(encoding='utf-8'))
        data['agents']['defaults'].pop('memorySearch')
        config.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        self.assertTrue(setup.install(home))
        installed = json.loads(config.read_text(encoding='utf-8'))
        self.assertEqual(installed['agents']['defaults']['memorySearch'], {'provider': 'none'})

    def test_a_failing_memory_probe_never_blocks_setup(self):
        # ad55dad8：探测出错只打印一句，安装照常完成、插件照常登记。
        home, config = fresh_home(self)
        with patch.object(setup, '_choose_memory_search', side_effect=RuntimeError('probe exploded')), \
                patch('builtins.print'):
            self.assertTrue(setup.install(home))
        installed = json.loads(config.read_text(encoding='utf-8'))
        self.assertTrue(installed['plugins']['entries']['pinkie-mode-architecture']['enabled'])
        self.assertNotIn('memorySearch', installed['agents']['defaults'])

    def test_no_mode_persona_keeps_the_old_character_name(self):
        # 68853ca7：把残留的 Li An 换成碧琪。现有测试只看聊天模式的 core.md，
        # 项目 / 想法 / 学习三个模式的人格文件回退成 Li An 也不会红。
        for mode, files in setup.PERSONA.items():
            for name, content in files.items():
                self.assertNotIn('Li An', content, f'{mode}/{name}')
            if 'core.md' in files:
                self.assertIn('你是碧琪', files['core.md'], mode)
        home, _ = fresh_home(self)
        setup.install(home)
        for mode, relative in setup.MODE_WORKSPACES.items():
            for name in setup.PERSONA[mode]:
                text = (home / relative / 'persona' / name).read_text(encoding='utf-8')
                self.assertNotIn('Li An', text, f'{mode}/{name}')


if __name__ == '__main__':
    unittest.main()
