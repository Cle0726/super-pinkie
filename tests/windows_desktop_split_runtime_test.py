"""Real-call runtime regression tests for the split app/windows_desktop.py modules.

Calls the actual production functions (never stubbing the function under test)
across every broken path introduced by the M4 split:
- process_guard_alerts (with guard_release_build True and default app_state=None)
- has_guard_receipt (with default openclaw_state=None)
- lock_tampered_guard_counter (hidden_process_kwargs path)
- DesktopControlNode._arguments and start (with fake Popen)
- NativeBridge._create_dock_window before_show callback (configure_native_glass/corners)
- LocalServices._start exception branch (traceback.format_exc)
- importlib.util.spec_from_file_location dynamic loading & instance isolation
- single-copy constants, mutable state, and intra/cross-module monkeypatching
- standalone submodule imports without circular import failures
"""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
APP_DIR = ROOT / "app"
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))
if str(ROOT) not in sys.path:
    sys.path.insert(1, str(ROOT))

import windows_desktop as desktop  # noqa: E402


class _EventSlot:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, fn):
        self.handlers.append(fn)
        return self

    def fire(self, *args, **kwargs):
        for fn in list(self.handlers):
            fn(*args, **kwargs)


class _FakeEvents:
    def __init__(self):
        self.closed = _EventSlot()
        self.loaded = _EventSlot()
        self.before_show = _EventSlot()


class _FakeDockWindow:
    def __init__(self):
        self.events = _FakeEvents()
        self.native = None
        self.evaluated = []

    def evaluate_js(self, script):
        self.evaluated.append(script)


class _FakePopenProcess:
    def __init__(self, pid=42424):
        self.pid = pid
        self._done = threading.Event()
        self._code = None

    def poll(self):
        return self._code

    def wait(self, timeout=None):
        self._done.wait(timeout)
        return 0 if self._code is None else self._code

    def terminate(self):
        self._code = 0
        self._done.set()

    def kill(self):
        self._code = 0
        self._done.set()


def _isolated_env(tmp_dir: Path) -> dict[str, str]:
    env = dict(os.environ)
    for key in ("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"):
        env[key] = str(tmp_dir)
    env["PINKIE_STATE_ROOT"] = str(tmp_dir / "state")
    env["OPENCLAW_CONFIG_PATH"] = str(tmp_dir / ".openclaw" / "openclaw.json")
    env["PYTHONUTF8"] = "1"
    return env


def _os_named(name):
    """A copy of the os module whose only difference is os.name.

    Patching os.name on the real module also flips pathlib's Path() to
    WindowsPath, which cannot be instantiated off Windows (CI ubuntu raised
    NotImplementedError).  windows_desktop runs every split part in one global
    namespace, so rebinding its ``os`` global reaches lock_tampered_guard_counter
    and hidden_process_kwargs without touching pathlib or other modules.
    """
    fake = types.ModuleType("os")
    fake.__dict__.update(os.__dict__)
    fake.name = name
    return fake


class WindowsDesktopSplitRuntimeTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="pinkie-m4-rt-")
        self.root = Path(self._tmp.name)
        self.state_dir = self.root / "state"
        self.oc_dir = self.root / ".openclaw"
        self.oc_dir.mkdir(parents=True, exist_ok=True)
        self._env_patch = mock.patch.dict(
            os.environ,
            {
                "HOME": str(self.root),
                "USERPROFILE": str(self.root),
                "APPDATA": str(self.root),
                "LOCALAPPDATA": str(self.root),
                "PINKIE_STATE_ROOT": str(self.state_dir),
                "OPENCLAW_CONFIG_PATH": str(self.oc_dir / "openclaw.json"),
            },
            clear=False,
        )
        self._env_patch.start()

    def tearDown(self):
        self._env_patch.stop()
        self._tmp.cleanup()

    def test_process_guard_alerts_release_build_default_app_state_and_tamper_receipt(self):
        resource = self.root / "bundle"
        resource.mkdir()
        (resource / "build-info.json").write_text(
            json.dumps({"guard": True, "channel": "release", "version": "2.5.99", "commit": "abc123"}),
            encoding="utf-8",
        )
        # No receipt yet, startup=False -> should return (False, False) cleanly (used to raise NameError: state_root).
        presented = []
        locked = []
        should_exit, verified = desktop.process_guard_alerts(
            resource,
            startup=False,
            seen_ids=set(),
            counter_verified=False,
            presenter=lambda *a: presented.append(a),
            locker=lambda *a: locked.append(a),
            is_updating=lambda _dir: False,
        )
        self.assertEqual((should_exit, verified), (False, False))
        self.assertEqual(presented, [])
        self.assertEqual(locked, [])

        # Now write a matching guard-receipt.json in OPENCLAW_CONFIG_PATH's parent and run startup=True:
        # exercises state_root() AND has_guard_receipt(..., openclaw_state=None) -> openclaw_config_path().
        (self.oc_dir / "guard-receipt.json").write_text(
            json.dumps({"schema": 1, "version": "2.5.99", "commit": "abc123"}),
            encoding="utf-8",
        )
        should_exit, verified = desktop.process_guard_alerts(
            resource,
            startup=True,
            seen_ids=set(),
            counter_verified=False,
            presenter=lambda *a: presented.append(a),
            locker=lambda *a: locked.append(a),
            is_updating=lambda _dir: False,
        )
        self.assertTrue(should_exit)
        self.assertFalse(verified)
        self.assertEqual(len(locked), 1)
        self.assertEqual(len(presented), 1)
        self.assertIn("保护记录文件", presented[0][0])

    def test_has_guard_receipt_default_openclaw_state_resolves_openclaw_config_path(self):
        app_state = self.root / "app-state"
        app_state.mkdir()
        self.assertFalse(desktop.has_guard_receipt(app_state))
        (self.oc_dir / "guard-receipt.json").write_text(
            json.dumps({"schema": 1, "version": "2.5.99"}),
            encoding="utf-8",
        )
        self.assertTrue(desktop.has_guard_receipt(app_state, version="2.5.99"))

    def test_lock_tampered_guard_counter_uses_hidden_process_kwargs_on_windows(self):
        resource = self.root / "bundle"
        node = resource / "runtime" / "bin" / "node.exe"
        guard = resource / "installer" / "guard" / "guard.mjs"
        node.parent.mkdir(parents=True)
        guard.parent.mkdir(parents=True)
        node.write_bytes(b"")
        guard.write_text("", encoding="utf-8")

        captured = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            captured["kwargs"] = kwargs
            return subprocess.CompletedProcess(cmd, 0)

        with (
            mock.patch.object(desktop, "os", _os_named("nt")),
            mock.patch.object(desktop.subprocess, "CREATE_NO_WINDOW", 0x08000000, create=True),
            mock.patch.object(desktop.subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200, create=True),
            mock.patch.object(desktop.subprocess, "STARTUPINFO", mock.MagicMock, create=True),
            mock.patch.object(desktop.subprocess, "STARTF_USESHOWWINDOW", 1, create=True),
            mock.patch.object(desktop.subprocess, "SW_HIDE", 0, create=True),
            mock.patch.object(desktop.subprocess, "run", side_effect=fake_run),
        ):
            ok = desktop.lock_tampered_guard_counter(resource, self.state_dir)

        self.assertTrue(ok)
        self.assertIn("lock-tampered", captured["cmd"])
        self.assertIn("creationflags", captured["kwargs"])
        self.assertIn("startupinfo", captured["kwargs"])
        self.assertIs(desktop.os, os)

    def test_desktop_control_node_arguments_and_start_with_fake_popen(self):
        install = self.root / "install"
        node_bin = install / "runtime" / "bin" / "node.exe"
        entry = install / "runtime" / "node_modules" / "openclaw" / "openclaw.mjs"
        node_bin.parent.mkdir(parents=True)
        entry.parent.mkdir(parents=True)
        node_bin.write_bytes(b"")
        entry.write_text("// stub\n", encoding="utf-8")

        runtime = desktop.BundledRuntime(install)
        control = desktop.DesktopControlNode(runtime)

        args = control._arguments()
        self.assertEqual(
            args,
            [
                str(entry),
                "node",
                "run",
                "--host",
                "127.0.0.1",
                "--port",
                "18789",
                "--display-name",
                desktop.DesktopControlNode.DISPLAY_NAME,
            ],
        )

        spawned = {}
        fake_proc = _FakePopenProcess()

        def fake_popen(cmd, **kwargs):
            spawned["cmd"] = cmd
            spawned["kwargs"] = kwargs
            return fake_proc

        try:
            with (
                mock.patch.object(desktop.subprocess, "Popen", side_effect=fake_popen),
                mock.patch.object(desktop, "bind_to_app_lifetime"),
            ):
                started = control.start()
            self.assertTrue(started)
            self.assertEqual(spawned["cmd"][0], str(node_bin))
            self.assertEqual(spawned["cmd"][1:], args)
            self.assertEqual(spawned["kwargs"]["env"]["OPENCLAW_SERVICE_KIND"], "node")
            self.assertEqual(
                spawned["kwargs"]["env"]["OPENCLAW_STATE_DIR"],
                str(self.state_dir / "desktop-control-node"),
            )
            if os.name == "nt":
                self.assertIn("creationflags", spawned["kwargs"])
        finally:
            control.close()

    def test_dock_window_before_show_calls_native_glass_and_corners_without_error(self):
        fake_dock = _FakeDockWindow()
        fake_webview = types.ModuleType("webview")
        fake_webview.create_window = lambda *args, **kwargs: fake_dock

        logs = []
        called = []
        bridge = desktop.NativeBridge(None)
        with (
            mock.patch.dict(sys.modules, {"webview": fake_webview}),
            mock.patch.object(desktop, "append_log", side_effect=lambda name, msg: logs.append((name, msg))),
            mock.patch.object(desktop, "configure_native_glass", side_effect=lambda w: called.append(("glass", w))),
            mock.patch.object(desktop, "configure_native_corners", side_effect=lambda w: called.append(("corners", w))),
        ):
            bridge._create_dock_window("http://127.0.0.1:18789/chat?laolao-dock=1")
            self.assertEqual(len(fake_dock.events.before_show.handlers), 1)
            fake_dock.events.before_show.fire()

        self.assertEqual(called, [("glass", fake_dock), ("corners", fake_dock)])
        self.assertFalse(any("setup failed" in msg for _, msg in logs), f"unexpected logs: {logs}")

        # Also invoke before_show without stubbing configure_native_glass / configure_native_corners
        # (real implementations handle dock.native=None safely without NameError).
        fake_dock2 = _FakeDockWindow()
        fake_webview.create_window = lambda *args, **kwargs: fake_dock2
        logs2 = []
        with (
            mock.patch.dict(sys.modules, {"webview": fake_webview}),
            mock.patch.object(desktop, "append_log", side_effect=lambda name, msg: logs2.append((name, msg))),
        ):
            bridge2 = desktop.NativeBridge(None)
            bridge2._create_dock_window("http://127.0.0.1:18789/chat?laolao-dock=1")
            fake_dock2.events.before_show.fire()
        self.assertFalse(any("NameError" in msg for _, msg in logs2), f"unexpected NameError: {logs2}")

    def test_local_services_exception_branch_logs_traceback_without_secondary_error(self):
        install = self.root / "install"
        svc_dir = install / "services" / "boom"
        svc_dir.mkdir(parents=True)
        (svc_dir / "server.py").write_text(
            "def serve(*args, **kwargs):\n"
            "    raise RuntimeError('synthetic service crash')\n",
            encoding="utf-8",
        )
        runtime = desktop.BundledRuntime(install)
        services = desktop.LocalServices(runtime)

        logs = []
        with (
            mock.patch.object(desktop, "http_alive", return_value=False),
            mock.patch.object(desktop, "append_log", side_effect=lambda name, msg: logs.append((name, msg))),
        ):
            services._start("boom", "services/boom/server.py", "serve", (), "http://127.0.0.1:5142/health")
            self.assertEqual(len(services.threads), 1)
            services.threads[0].join(timeout=5)
            self.assertFalse(services.threads[0].is_alive())

        messages = [msg for _, msg in logs]
        self.assertTrue(
            any("boom service failed: synthetic service crash" in m for m in messages),
            f"missing error log: {messages}",
        )
        self.assertTrue(
            any("Traceback (most recent call last):" in m and "RuntimeError: synthetic service crash" in m for m in messages),
            f"missing traceback log: {messages}",
        )

    def test_constants_mutable_state_and_intra_module_monkeypatching_use_single_namespace(self):
        install = self.root / "install"
        entry = install / "runtime" / "node_modules" / "openclaw" / "openclaw.mjs"
        entry.parent.mkdir(parents=True)
        entry.write_text("// stub\n", encoding="utf-8")
        runtime = desktop.BundledRuntime(install)

        # 1. Overriding GATEWAY_URL propagates to BundledRuntime, DesktopControlNode, GatewaySupervisor, UpdateHealthReporter.
        with mock.patch.object(desktop, "GATEWAY_URL", "https://127.0.0.1:5140/"):
            self.assertEqual(runtime.environment()["PINKIE_GATEWAY_URL"], "https://127.0.0.1:5140/")
            args = desktop.DesktopControlNode(runtime)._arguments()
            self.assertIn("5140", args)
            self.assertIn("--tls", args)
            seen_urls = []
            with mock.patch.object(desktop, "http_ready", side_effect=lambda url: (seen_urls.append(url), False)[1]):
                desktop.GatewaySupervisor(runtime).retire_stale()
            self.assertEqual(seen_urls, ["https://127.0.0.1:5140/"])
            reporter = desktop.UpdateHealthReporter("a" * 32, install / "runtime" / "bin" / "node.exe")
            self.assertEqual(reporter.port, 5140)

        # 2. Mutating TRUSTED_UPDATE_HOSTS in place is seen by trusted_update_url & WindowsUpdater.
        custom_host = "custom-mirror.example.invalid"
        desktop.TRUSTED_UPDATE_HOSTS.add(custom_host)
        try:
            self.assertTrue(desktop.trusted_update_url(f"https://{custom_host}/release.zip"))
            updater = desktop.WindowsUpdater(install, executable=install / "fake.exe")
            self.assertIn(custom_host, updater.trusted_hosts)
        finally:
            desktop.TRUSTED_UPDATE_HOSTS.discard(custom_host)

        # 3. Overriding UPDATE_MANIFEST_NAME / PARTY_URL / ROUNDTABLE_URL propagates everywhere.
        with mock.patch.object(desktop, "UPDATE_MANIFEST_NAME", "custom-latest.json"):
            mirrors = desktop.update_mirrors(install)
            self.assertTrue(mirrors and all(m["manifest"].endswith("custom-latest.json") for m in mirrors))

        loaded_urls = []

        class _FakeWindow:
            def load_url(self, url):
                loaded_urls.append(url)

        bridge = desktop.NativeBridge(None)
        bridge.attach(_FakeWindow())
        with (
            mock.patch.object(desktop, "PARTY_URL", "http://127.0.0.1:5143/"),
            mock.patch.object(desktop, "ROUNDTABLE_URL", "http://127.0.0.1:5144/"),
        ):
            bridge.open_party()
            bridge.open_roundtable()
        self.assertEqual(loaded_urls, ["http://127.0.0.1:5143/", "http://127.0.0.1:5144/"])

        # 4. Intra-module monkeypatching on windows_desktop intercepts calls inside process_guard_alerts.
        called_verify = []
        with (
            mock.patch.object(desktop, "guard_release_build", return_value=True),
            mock.patch.object(desktop, "verify_guard_counter", side_effect=lambda *a, **k: (called_verify.append(a), True)[1]),
        ):
            should_exit, verified = desktop.process_guard_alerts(
                install,
                startup=False,
                seen_ids=set(),
                counter_verified=False,
                presenter=lambda *a: None,
                locker=lambda *a: None,
                is_updating=lambda _d: False,
            )
        self.assertEqual((should_exit, verified), (False, True))
        self.assertEqual(len(called_verify), 1)

    def test_dynamic_spec_from_file_location_works_without_sys_modules_and_stays_isolated(self):
        # Subprocess 1: mirrors tools/windows-smoke/update_probe.py:55 (nothing in sys.modules).
        probe_script = r'''
import importlib.util, json, sys
from pathlib import Path

desktop_file = Path(sys.argv[1])
tmp = Path(sys.argv[2])
sys.path.insert(0, str(desktop_file.parent))
spec = importlib.util.spec_from_file_location("old_windows_desktop", str(desktop_file))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

assert "windows_desktop" not in sys.modules
assert "app.windows_desktop" not in sys.modules
assert "old_windows_desktop" not in sys.modules

updater = mod.WindowsUpdater(tmp, executable=tmp / "app.exe")
entry = tmp / "openclaw.mjs"
entry.write_text("", encoding="utf-8")
node = mod.DesktopControlNode.__new__(mod.DesktopControlNode)
node._entry = lambda: entry
mod.GATEWAY_URL = "http://127.0.0.1:5141/"
args = node._arguments()
receipt = mod.has_guard_receipt(tmp)
mod.guard_release_build = lambda _r: True
guard_res = mod.process_guard_alerts(
    tmp, startup=False, seen_ids=set(), counter_verified=False,
    presenter=lambda *a: None, locker=lambda *a: None, is_updating=lambda _d: False,
)
print(json.dumps({"version": updater.current_version, "args": args, "receipt": receipt, "guard": list(guard_res)}))
'''
        result = subprocess.run(
            [sys.executable, "-c", probe_script, str(APP_DIR / "windows_desktop.py"), str(self.root)],
            env=_isolated_env(self.root),
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, f"dynamic load failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
        payload = json.loads(result.stdout.strip())
        self.assertEqual(payload["version"], "0.0.0")
        self.assertIn("5141", payload["args"])
        self.assertFalse(payload["receipt"])
        self.assertEqual(payload["guard"], [False, False])

        # In-process isolation: dynamically loading a second copy must not affect `desktop`.
        spec = importlib.util.spec_from_file_location("isolated_windows_desktop_copy", str(APP_DIR / "windows_desktop.py"))
        alt = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(alt)
        alt.GATEWAY_URL = "http://127.0.0.1:5144/"
        self.assertEqual(desktop.GATEWAY_URL, "http://127.0.0.1:18789/")
        self.assertEqual(alt.BundledRuntime(self.root).environment()["PINKIE_GATEWAY_URL"], "http://127.0.0.1:5144/")
        self.assertEqual(desktop.BundledRuntime(self.root).environment()["PINKIE_GATEWAY_URL"], "http://127.0.0.1:18789/")

        # Frozen-mode loader fallback (simulating PyInstaller PYZ.pyz where loose .py siblings are not read).
        frozen_script = r'''
import importlib.util, sys
from pathlib import Path

desktop_file = Path(sys.argv[1])
tmp = Path(sys.argv[2])
sys.path.insert(0, str(desktop_file.parent))
sys.frozen = True
spec = importlib.util.spec_from_file_location("frozen_windows_desktop", str(desktop_file))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
updater = mod.WindowsUpdater(tmp, executable=tmp / "app.exe")
assert updater.current_version == "0.0.0"
assert mod.has_guard_receipt(tmp) is False
print("FROZEN_OK")
'''
        frozen_res = subprocess.run(
            [sys.executable, "-c", frozen_script, str(APP_DIR / "windows_desktop.py"), str(self.root)],
            env=_isolated_env(self.root),
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(
            frozen_res.returncode,
            0,
            f"frozen load failed:\nSTDOUT:\n{frozen_res.stdout}\nSTDERR:\n{frozen_res.stderr}",
        )
        self.assertIn("FROZEN_OK", frozen_res.stdout)

    def test_standalone_submodule_imports_have_no_circular_import_or_none_desktop(self):
        submodules = [
            "windows_ps_templates",
            "windows_bridge_scripts",
            "windows_elevated",
            "windows_update_guard",
            "windows_runtime",
            "windows_gateway",
            "windows_bridge",
            "windows_updater",
        ]
        check_code = r'''
import importlib, sys
from pathlib import Path
app_dir, mod_name, tmp = sys.argv[1], sys.argv[2], Path(sys.argv[3])
sys.path.insert(0, app_dir)
m = importlib.import_module(mod_name)
if mod_name == "windows_update_guard":
    assert m.has_guard_receipt(tmp) is False
elif mod_name == "windows_runtime":
    entry = tmp / "openclaw.mjs"
    entry.write_text("", encoding="utf-8")
    n = m.DesktopControlNode.__new__(m.DesktopControlNode)
    n._entry = lambda: entry
    assert "--port" in n._arguments()
elif mod_name == "windows_updater":
    u = m.WindowsUpdater(tmp, executable=tmp / "fake.exe")
    assert u.current_version == "0.0.0"
print("OK", mod_name)
'''
        env = _isolated_env(self.root)
        for name in submodules:
            r = subprocess.run(
                [sys.executable, "-c", check_code, str(APP_DIR), name, str(self.root)],
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(
                r.returncode,
                0,
                f"standalone import/call failed for {name}:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}",
            )


    def test_package_import_without_app_dir_on_sys_path(self):
        # python -m unittest from the repo root imports app.windows_desktop with
        # only the repo root on sys.path; main raised "No module named
        # release_notes" there unless PYTHONPATH=app was set.
        code = r'''
import importlib, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
app_dir = str(root / "app")
sys.path[:] = [p for p in sys.path if p and Path(p).resolve() != Path(app_dir).resolve()]
sys.path.insert(0, str(root))
desk = importlib.import_module("app.windows_desktop")
guard = importlib.import_module("app.windows_update_guard")
assert "release_notes" not in sys.modules, "bare release_notes should not be importable here"
assert desk.release_notes is sys.modules["app.release_notes"]
assert guard.release_notes is sys.modules["app.release_notes"]
assert desk.release_notes_text("x") == guard.release_notes_text("x")
assert desk.InAppBrowserBridge.__module__ == "app.inapp_browser"
assert "inapp_browser" not in sys.modules
print("PKG_IMPORT_OK")
'''
        env = _isolated_env(self.root)
        env.pop("PYTHONPATH", None)
        r = subprocess.run(
            [sys.executable, "-c", code, str(ROOT)],
            cwd=str(self.root),
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(r.returncode, 0, f"package import failed:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}")
        self.assertIn("PKG_IMPORT_OK", r.stdout)


if __name__ == "__main__":
    unittest.main()
