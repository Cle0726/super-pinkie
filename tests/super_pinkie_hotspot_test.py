"""热点第 10 名 app/super_pinkie.py 的复发测试（只补现有测试没锁住的修复）。

逐条对应的修复提交：
- b7a6a32b：proxy_health 只走本机，不经过系统/环境代理
- b8b3e001：prepare_bundled_desktop 把「配置有没有被改」告诉调用方（好让它重载网关）
- f24dc937 / 08f06672 / a0ad8b2d：启动准备里真的调用修模型配置、写网关认证、补头像三步
- f24dc937 / 08f06672：这两步写 openclaw.json 时遇到并发改动就不覆盖、不留临时文件
- 936f6edf：服务安装脚本崩溃时把完整 traceback 写进日志
- 435632be：utf8_console 把 ANSI 代码页的输出流换成 UTF-8，main 在起中继前先调用它
- c092fc4b：探测与 CLI 子进程都带上隐藏窗口参数

只用临时目录、假对象和本机回环端口；不联网、不启动网关或浏览器、不用上游模型。
"""
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from app import super_pinkie


class RelayHealthHandler(BaseHTTPRequestHandler):
    """冒充自带中继：/health 报出 super-pinkie-relay 身份。"""

    def do_GET(self):
        body = json.dumps({"ok": True, "service": super_pinkie.RELAY_SERVICE}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def closed_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ProxyHealthLoopbackTests(unittest.TestCase):
    """b7a6a32b：用户配了代理时，健康检查不能被转去代理，否则自带中继永远显示不健康。"""

    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), RelayHealthHandler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.port = self.server.server_address[1]

    def test_health_probe_ignores_a_configured_proxy(self):
        dead_proxy = f"http://127.0.0.1:{closed_port()}"
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, {"http_proxy": dead_proxy, "HTTP_PROXY": dead_proxy}))
            for name in ("no_proxy", "NO_PROXY", "REQUEST_METHOD"):
                os.environ.pop(name, None)
            # urlopen 会缓存全局 opener；清掉它，让旧写法也按当前环境挑代理。
            stack.enter_context(mock.patch.object(urllib.request, "_opener", None))
            # 先确认这个环境确实会把回环请求送进（不存在的）代理，避免测试空转。
            with self.assertRaises(urllib.error.URLError):
                urllib.request.build_opener().open(f"http://127.0.0.1:{self.port}/health", timeout=2)
            self.assertTrue(super_pinkie.proxy_health(self.port), "自带中继在配了代理时也必须报健康")


PREPARE_STEPS = ("repair_provider_models", "ensure_gateway_auth_none", "apply_browser_proxy", "ensure_workspace_avatars")


class PrepareBundledDesktopTests(unittest.TestCase):
    """启动准备的每次启动步骤：要真的被调用，且把「配置变了没有」交给调用方。"""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.home = root / "home"
        self.config = self.home / ".openclaw" / "openclaw.json"
        self.config.parent.mkdir(parents=True)
        self.config.write_text("{}\n", encoding="utf-8")
        self.state = root / "state"
        self.state.mkdir()
        # 版本标记已在：跳过人格文件复制，只看每次启动都跑的那段。
        (self.state / "bundled-setup-3.0.0").write_text("preserved\n", encoding="utf-8")
        self.resources = root / "resources"
        self.resources.mkdir()
        (self.resources / "VERSION").write_text("3.0.0\n", encoding="utf-8")
        self.messages = []

    def prepare(self, **steps):
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, {
                "UR_PROMPTS_DIR": str(self.config.parent), "PINKIE_PRESERVE_EXISTING_PROFILE": "0"}))
            stack.enter_context(mock.patch.object(super_pinkie.Path, "home", return_value=self.home))
            stack.enter_context(mock.patch.object(super_pinkie, "windows_state_root", return_value=self.state))
            stack.enter_context(mock.patch.object(
                super_pinkie, "resource_path", side_effect=lambda *parts: self.resources.joinpath(*parts)))
            stack.enter_context(mock.patch.object(super_pinkie, "ensure_mode_agents", return_value=True))
            stack.enter_context(mock.patch.object(super_pinkie, "install_runtime_service", return_value=False))
            stack.enter_context(mock.patch.dict(sys.modules, {
                "browser_proxy": SimpleNamespace(system_proxy=lambda: None)}))
            mocks = {
                name: stack.enter_context(mock.patch.object(super_pinkie, name, side_effect=steps.get(name)))
                for name in PREPARE_STEPS
            }
            result = super_pinkie.prepare_bundled_desktop(self.messages.append)
        return result, mocks

    def test_each_start_runs_the_config_repairs_and_the_avatar_fill(self):
        # f24dc937 / 08f06672 / a0ad8b2d 各自把一步接进启动准备；漏接一步，旧配置就一直坏着。
        _result, mocks = self.prepare()
        for name in ("repair_provider_models", "ensure_gateway_auth_none", "ensure_workspace_avatars"):
            with self.subTest(step=name):
                mocks[name].assert_called_once()

    def test_a_step_that_rewrites_the_config_is_reported_to_the_caller(self):
        # b8b3e001：调用方靠这个返回值决定是否重载已在运行的网关。
        def rewrite(_log):
            self.config.write_text('{"gateway": {"auth": {"mode": "none"}}}\n', encoding="utf-8")

        result, _mocks = self.prepare(ensure_gateway_auth_none=rewrite)
        self.assertIs(result, True)

    def test_an_untouched_config_reports_no_change(self):
        result, _mocks = self.prepare()
        self.assertIs(result, False)


class ConfigWriteRaceTests(unittest.TestCase):
    """f24dc937 / 08f06672：读完配置后有人改了它，就不覆盖，也不留下临时文件。"""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.config = Path(directory.name) / "openclaw.json"
        self.logs = []

    def run_with_concurrent_edit(self, call):
        # 第一次读是函数读原配置，第二次读是写回前的核对：在核对前插入一次用户改动。
        original_read = Path.read_bytes
        reads = 0

        def read_bytes(path):
            nonlocal reads
            if path == self.config:
                reads += 1
                if reads == 2:
                    self.config.write_text('{"user_change": true}', encoding="utf-8")
            return original_read(path)

        with mock.patch.object(Path, "read_bytes", read_bytes):
            return call()

    def assert_user_edit_kept(self, prefix):
        self.assertEqual(json.loads(self.config.read_text(encoding="utf-8")), {"user_change": True})
        self.assertEqual(list(self.config.parent.glob(prefix + "*")), [])

    def test_provider_repair_keeps_a_concurrent_edit(self):
        self.config.write_text(json.dumps({"models": {"providers": {
            "openai": {"apiKey": "sk", "model": "gpt-4o"}}}}), encoding="utf-8")
        result = self.run_with_concurrent_edit(
            lambda: super_pinkie.repair_provider_models(self.logs.append, self.config))
        self.assertFalse(result)
        self.assert_user_edit_kept(".pinkie-provider-")
        self.assertTrue(any("没有修复模型配置" in message for message in self.logs), self.logs)

    def test_gateway_auth_keeps_a_concurrent_edit(self):
        self.config.write_text(json.dumps({"agents": {"list": [{"id": "main"}]}}), encoding="utf-8")
        result = self.run_with_concurrent_edit(
            lambda: super_pinkie.ensure_gateway_auth_none(self.logs.append, self.config))
        self.assertFalse(result)
        self.assert_user_edit_kept(".pinkie-auth-")
        self.assertTrue(any("没有写入网关认证方式" in message for message in self.logs), self.logs)


class RuntimeServiceFailureTests(unittest.TestCase):
    """936f6edf：安装脚本崩溃时只记一句异常看不出在哪崩，必须带完整 traceback。"""

    def test_a_crashing_setup_logs_its_traceback(self):
        messages = []
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "setup.py"
            script.write_text("def install():\n    raise RuntimeError('合成安装失败')\n", encoding="utf-8")
            with mock.patch.object(super_pinkie, "resource_path", return_value=script):
                self.assertFalse(super_pinkie.install_runtime_service("fixture", messages.append))
        self.assertIn("  [fixture] 安装失败：合成安装失败", messages)
        self.assertTrue(
            any("Traceback (most recent call last):" in m and "RuntimeError: 合成安装失败" in m for m in messages),
            messages,
        )


class Utf8ConsoleTests(unittest.TestCase):
    """435632be：cp1252 / cp936 输出流遇到中文或 emoji 会抛错，把整个安装记成失败。"""

    def test_ansi_streams_become_utf8_and_missing_streams_are_skipped(self):
        out = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")
        err = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")
        self.addCleanup(out.close)
        self.addCleanup(err.close)
        with mock.patch.object(super_pinkie.sys, "stdout", out), mock.patch.object(super_pinkie.sys, "stderr", err):
            super_pinkie.utf8_console()
        for stream in (out, err):
            self.assertEqual(stream.encoding.lower().replace("_", "-"), "utf-8")
            print("模型已安装 🎈", file=stream)  # 修复前这里抛 UnicodeEncodeError
        # 窗口版 exe 没有 stdout/stderr（None），不能因此出错。
        with mock.patch.object(super_pinkie.sys, "stdout", None), mock.patch.object(super_pinkie.sys, "stderr", None):
            super_pinkie.utf8_console()

    def test_main_fixes_the_console_before_serving_the_relay(self):
        order = mock.Mock()
        with mock.patch.object(super_pinkie.sys, "argv", ["super_pinkie.py", "--ur-relay", "1467", "1466"]), \
             mock.patch.object(super_pinkie, "utf8_console", side_effect=lambda: order("utf8_console")), \
             mock.patch.object(super_pinkie, "run_relay", side_effect=lambda *args: order("run_relay", *args)):
            super_pinkie.main()
        self.assertEqual(order.call_args_list, [mock.call("utf8_console"), mock.call("run_relay", 1467, 1466)])


class HiddenChildWindowTests(unittest.TestCase):
    """c092fc4b：Windows 上每个探测/CLI 子进程都要隐藏窗口，否则启动时一串黑框闪过。"""

    def test_probe_and_cli_children_get_the_hidden_window_flags(self):
        hidden = {"creationflags": 0x08000000, "startupinfo": object()}
        calls = []

        def run(command, **kwargs):
            calls.append(kwargs)
            empty = "" if kwargs.get("text") else b""
            return subprocess.CompletedProcess(command, 0, stdout=empty, stderr=empty)

        entries = {
            "check_node": super_pinkie.check_node,
            "check_npm": super_pinkie.check_npm,
            "check_openclaw_cli": super_pinkie.check_openclaw_cli,
            "run_openclaw": lambda: super_pinkie.run_openclaw(("agents", "list", "--json"), timeout=5),
            "restart_openclaw_gateway": lambda: super_pinkie.restart_openclaw_gateway(lambda _message: None),
        }
        with mock.patch.object(super_pinkie, "hidden_process_kwargs", return_value=hidden), \
             mock.patch.object(super_pinkie, "bundled_runtime_root", return_value=None), \
             mock.patch.object(super_pinkie.subprocess, "run", side_effect=run):
            for name, call in entries.items():
                with self.subTest(entry=name):
                    calls.clear()
                    call()
                    self.assertEqual(len(calls), 1)
                    self.assertEqual(calls[0].get("creationflags"), hidden["creationflags"])
                    self.assertIs(calls[0].get("startupinfo"), hidden["startupinfo"])


if __name__ == "__main__":
    unittest.main()
