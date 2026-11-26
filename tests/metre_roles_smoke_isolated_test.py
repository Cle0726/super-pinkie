"""tools/metre/roles/smoke-isolated.py 的纯逻辑单测。

只测不起网关、不起模拟模型的小函数：dump / free_port / read_json / json_output / leaves，
以及 run() 在动手前对运行时清单的校验。端口一律用假 socket，不绑定任何真实端口（更不碰 18789），
文件只写临时目录，不读用户目录、不联网。
"""
from pathlib import Path
from unittest import mock
import importlib.util
import json
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'tools' / 'metre' / 'roles' / 'smoke-isolated.py'


def load():
    # 文件名带连字符，不能直接 import；模块顶层只有导入和常量，按普通模块名加载不会触发 __main__ 分支。
    spec = importlib.util.spec_from_file_location('metre_roles_smoke_isolated', SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smoke = load()


class FakeSocket:
    """假 socket：按顺序吐出预设端口，记录 bind 地址；不碰系统网络。"""

    def __init__(self, ports, binds):
        self.ports, self.binds = ports, binds
        self.port = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def bind(self, address):
        self.binds.append(address)
        self.port = self.ports.pop(0)

    def getsockname(self):
        return ('127.0.0.1', self.port)


class ConstantsTest(unittest.TestCase):
    def test_repo_points_at_repository_root(self):
        # REPO 用 parents[3] 推出仓库根；挪动脚本位置时这里会先红。
        self.assertEqual(ROOT, smoke.REPO)
        self.assertTrue((smoke.REPO / 'tools' / 'metre' / 'roles' / 'smoke-isolated.py').is_file())

    def test_bad_ports_cover_the_real_gateway(self):
        # 18789 是正式网关端口，必须在黑名单里。
        self.assertIn(18789, smoke.BAD_PORTS)


class DumpTest(unittest.TestCase):
    def test_writes_utf8_pretty_json_with_trailing_newline(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'result.json'
            smoke.dump(out, {'名字': '烟测调研', 'n': [1, 2]})
            raw = out.read_bytes()
        # 中文原样写出（ensure_ascii=False），缩进 2，结尾一个换行。
        self.assertIn('烟测调研'.encode('utf-8'), raw)
        self.assertNotIn(b'\\u', raw)
        self.assertTrue(raw.endswith(b'}\n'))
        self.assertIn(b'\n  "n": [', raw)
        self.assertEqual({'名字': '烟测调研', 'n': [1, 2]}, json.loads(raw))

    def test_round_trips_through_read_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'x.json'
            value = {'cards': [{'id': 'a', 'text': '汇报'}], 'ok': True, 'none': None}
            smoke.dump(out, value)
            self.assertEqual(value, smoke.read_json(out))


class FreePortTest(unittest.TestCase):
    def fake(self, ports):
        binds = []
        factory = mock.patch.object(smoke.socket, 'socket', side_effect=lambda *a, **k: FakeSocket(ports, binds))
        return factory, binds

    def test_returns_os_assigned_loopback_port(self):
        patcher, binds = self.fake([45678])
        with patcher:
            self.assertEqual(45678, smoke.free_port())
        # 只绑回环、端口 0（让系统分配）。
        self.assertEqual([('127.0.0.1', 0)], binds)

    def test_skips_every_bad_port_until_a_good_one(self):
        patcher, binds = self.fake([18789, 1466, 3112, 1467, 50001])
        with patcher:
            self.assertEqual(50001, smoke.free_port())
        self.assertEqual(5, len(binds))

    def test_never_returns_a_bad_port(self):
        for bad in sorted(smoke.BAD_PORTS):
            patcher, _ = self.fake([bad, 40000 + bad])
            with self.subTest(bad=bad), patcher:
                self.assertEqual(40000 + bad, smoke.free_port())


class ReadJsonTest(unittest.TestCase):
    def write(self, tmp, data):
        path = Path(tmp) / 'manifest.json'
        path.write_bytes(data)
        return path

    def test_reads_utf8_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.write(tmp, '{"node": "运行时/node"}'.encode('utf-8'))
            self.assertEqual({'node': '运行时/node'}, smoke.read_json(path))

    def test_accepts_utf8_bom_and_utf16(self):
        # 按字节读，交给 json 自己认编码：Windows 记事本存的带 BOM 文件也能读。
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual({'a': '甲'}, smoke.read_json(self.write(tmp, '﻿{"a": "甲"}'.encode('utf-8'))))
            self.assertEqual({'a': '甲'}, smoke.read_json(self.write(tmp, '{"a": "甲"}'.encode('utf-16'))))

    def test_invalid_json_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                smoke.read_json(self.write(tmp, b'{not json'))


class JsonOutputTest(unittest.TestCase):
    def parse(self, text=None, data=None):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'pending.json'
            path.write_bytes(data if data is not None else text.encode('utf-8'))
            return smoke.json_output(path)

    def test_skips_log_noise_before_the_record(self):
        text = '[gateway] connecting...\nwarn: something\n{"cards": [{"id": "c1"}]}\n'
        self.assertEqual({'cards': [{'id': 'c1'}]}, self.parse(text))

    def test_ignores_trailing_text_after_the_record(self):
        text = '{"state": "adopted"}\n(node) done in 12ms\n'
        self.assertEqual({'state': 'adopted'}, self.parse(text))

    def test_multiline_pretty_record(self):
        text = 'log\n{\n  "state": "rejected",\n  "nested": {"a": [1, 2]}\n}\n'
        self.assertEqual({'state': 'rejected', 'nested': {'a': [1, 2]}}, self.parse(text))

    def test_brace_must_start_a_line(self):
        # 行中间的 { 不算记录开头；只认行首的 {。
        text = 'payload {"wrong": 1}\n{"right": 2}\n'
        self.assertEqual({'right': 2}, self.parse(text))

    def test_broken_record_falls_through_to_next(self):
        text = '{broken line\n{"ok": 1}\n'
        self.assertEqual({'ok': 1}, self.parse(text))

    def test_first_valid_record_wins(self):
        text = '{"first": 1}\n{"second": 2}\n'
        self.assertEqual({'first': 1}, self.parse(text))

    def test_crlf_output(self):
        # Windows 上 CLI 输出是 CRLF，行首匹配照样成立。
        text = 'noise\r\n{"state": "pending"}\r\n'
        self.assertEqual({'state': 'pending'}, self.parse(text))

    def test_invalid_utf8_is_replaced_not_fatal(self):
        data = b'\xff\xfe garbage\n{"ok": true}\n'
        self.assertEqual({'ok': True}, self.parse(data=data))

    def test_no_record_raises_with_file_name(self):
        for text in ('', 'only logs\n', '[1, 2]\n', '  {"indented": 1}\n'):
            with self.subTest(text=text):
                with self.assertRaisesRegex(RuntimeError, r'No JSON record in pending\.json'):
                    self.parse(text)


class LeavesTest(unittest.TestCase):
    def test_plain_string_yields_itself(self):
        self.assertEqual(['abc'], list(smoke.leaves('abc')))

    def test_walks_nested_lists_and_dict_values_in_order(self):
        value = {'role': 'user', 'content': [{'type': 'text', 'text': '第一段'}, ['第二段', {'x': '第三段'}]]}
        self.assertEqual(['user', 'text', '第一段', '第二段', '第三段'], list(smoke.leaves(value)))

    def test_dict_keys_are_not_leaves(self):
        self.assertEqual(['v'], list(smoke.leaves({'only-key': 'v'})))

    def test_non_string_scalars_are_skipped(self):
        self.assertEqual(['s'], list(smoke.leaves([1, 2.5, True, None, {'n': 0}, 's'])))

    def test_empty_containers(self):
        for value in ([], {}, None, 0):
            with self.subTest(value=value):
                self.assertEqual([], list(smoke.leaves(value)))

    def test_marker_search_like_the_smoke_does(self):
        # 烟测用 leaves 在整份请求里找夹具标记；标记藏在深层 tool 消息里也要找得到。
        messages = [{'role': 'user', 'content': '读文件'},
                    {'role': 'tool', 'content': [{'type': 'text', 'text': smoke.MARKER + '\n'}]}]
        self.assertTrue(any(smoke.MARKER in text for text in smoke.leaves(messages)))
        self.assertFalse(any(smoke.MARKER in text for text in smoke.leaves(messages[:1])))

    def test_is_lazy(self):
        # 生成器：any() 找到就停，不必走完整份请求。
        gen = smoke.leaves(['a', 'b'])
        self.assertEqual('a', next(gen))


class RunManifestGuardTest(unittest.TestCase):
    """run() 在建任何目录、起任何进程之前先校验清单里的 node / runtime 必须落在隔离根下。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name).resolve()
        self.root = base / 'iso'
        self.root.mkdir()
        self.outside = base / 'outside'
        self.outside.mkdir()
        self.out = base / 'evidence'

    def tearDown(self):
        self._tmp.cleanup()

    def manifest(self, node, runtime):
        smoke.dump(self.root / 'manifest.json', {'node': str(node), 'runtime': str(runtime)})

    def assert_rejected(self):
        with mock.patch.object(smoke.subprocess, 'Popen') as popen, \
                mock.patch.object(smoke.subprocess, 'run') as run, \
                mock.patch.object(smoke, 'ThreadingHTTPServer') as server:
            with self.assertRaisesRegex(ValueError, 'under the supplied isolated root'):
                smoke.run(self.root, self.out)
        # 校验失败时什么都没动：没建证据目录、没起进程、没开本地模型服务。
        self.assertFalse(self.out.exists())
        popen.assert_not_called()
        run.assert_not_called()
        server.assert_not_called()

    def test_node_outside_root_is_rejected(self):
        node = self.outside / 'node'
        node.write_bytes(b'')
        runtime = self.root / 'openclaw.mjs'
        runtime.write_bytes(b'')
        self.manifest(node, runtime)
        self.assert_rejected()

    def test_runtime_outside_root_is_rejected(self):
        node = self.root / 'node'
        node.write_bytes(b'')
        runtime = self.outside / 'openclaw.mjs'
        runtime.write_bytes(b'')
        self.manifest(node, runtime)
        self.assert_rejected()

    def test_missing_files_under_root_are_rejected(self):
        self.manifest(self.root / 'node', self.root / 'openclaw.mjs')
        self.assert_rejected()

    def test_directory_instead_of_file_is_rejected(self):
        (self.root / 'node').mkdir()
        runtime = self.root / 'openclaw.mjs'
        runtime.write_bytes(b'')
        self.manifest(self.root / 'node', runtime)
        self.assert_rejected()

    def test_dotdot_escape_is_rejected(self):
        # 清单写成 iso/../outside/node 也算出界（先 resolve 再比）。
        node = self.outside / 'node'
        node.write_bytes(b'')
        runtime = self.root / 'openclaw.mjs'
        runtime.write_bytes(b'')
        self.manifest(self.root / '..' / 'outside' / 'node', runtime)
        self.assert_rejected()

    def test_missing_manifest_key_raises_before_touching_out(self):
        smoke.dump(self.root / 'manifest.json', {'node': str(self.root / 'node')})
        with self.assertRaises(KeyError):
            smoke.run(self.root, self.out)
        self.assertFalse(self.out.exists())

    def test_existing_out_dir_is_refused(self):
        # 证据目录必须是新的（exist_ok=False），免得覆盖上一轮证据。
        for name in ('node', 'openclaw.mjs'):
            (self.root / name).write_bytes(b'')
        self.manifest(self.root / 'node', self.root / 'openclaw.mjs')
        self.out.mkdir()
        (self.out / 'old.json').write_text('{}', encoding='utf-8')
        with mock.patch.object(smoke, 'ThreadingHTTPServer') as server:
            with self.assertRaises(FileExistsError):
                smoke.run(self.root, self.out)
        server.assert_not_called()
        self.assertEqual(['old.json'], sorted(p.name for p in self.out.iterdir()))


if __name__ == '__main__':
    unittest.main()
