import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "tools/windows-smoke/upstream_probe.py"
spec = importlib.util.spec_from_file_location("upstream_probe", path)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def case():
    return {
        "sent": {"ok": True}, "requests": 1, "watchdog_requests": 0,
        "watchdog_retries": 0, "request_log": [], "gateway": [],
        "timeline": [], "final": {"state": "", "recovered": False},
        "session_errors": [],
    }


class UpstreamProbeTests(unittest.TestCase):
    def test_read_only_cli_pairing_is_verified_without_reporting_tokens(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            exe = root / 'app' / 'pinkie.exe'
            node = root / 'app' / '_internal' / 'runtime' / 'bin' / 'node.exe'
            node.parent.mkdir(parents=True)
            node.touch()
            auth = root / 'profile' / 'home' / '.openclaw' / 'identity' / 'device-auth.json'
            auth.parent.mkdir(parents=True)
            auth.write_text(json.dumps({'tokens': {'operator': {'token': 'private', 'scopes': ['operator.read']}}}))
            with patch.object(probe.subprocess, 'run', return_value=SimpleNamespace(returncode=0)):
                self.assertEqual(probe.seed_read_only_cli(exe, root / 'profile', {}), {'read_only': True})
                auth.write_text(json.dumps({'tokens': {'operator': {'scopes': ['operator.read', 'operator.write']}}}))
                with self.assertRaises(RuntimeError):
                    probe.seed_read_only_cli(exe, root / 'profile', {})

    def test_outage_probe_uses_the_packaged_app_webview(self):
        page = SimpleNamespace(url="http://127.0.0.1:18789/chat")
        splash = SimpleNamespace(url="file:///isolated/launcher-loading.html")
        context = SimpleNamespace(pages=[splash, page])
        browser = SimpleNamespace(contexts=[context])
        endpoints = []
        chromium = SimpleNamespace(connect_over_cdp=lambda endpoint, timeout: (endpoints.append((endpoint, timeout)) or browser))
        playwright = SimpleNamespace(chromium=chromium)
        self.assertEqual(probe.connect_packaged_webview(playwright, "http://127.0.0.1:23456"),
                         (browser, context, page))
        self.assertEqual(endpoints, [("http://127.0.0.1:23456", 5000)])
        with self.assertRaises(RuntimeError):
            probe.connect_packaged_webview(playwright, "http://example.com:23456")
        with self.assertRaises(RuntimeError):
            probe.connect_packaged_webview(playwright, "")

    def test_outage_probe_waits_for_native_page_without_closing_the_app(self):
        context = SimpleNamespace(pages=[])
        browser = SimpleNamespace(contexts=[context])
        playwright = SimpleNamespace(chromium=SimpleNamespace(
            connect_over_cdp=lambda endpoint, timeout: browser))
        page = SimpleNamespace(url="file:///isolated/launcher-loading.html")
        with patch.object(probe.time, "sleep", side_effect=lambda _: context.pages.append(page)):
            self.assertEqual(probe.connect_packaged_webview(playwright, "http://127.0.0.1:23456"),
                             (browser, context, page))

    def test_recovered_reply_alone_is_not_proof_of_upstream_retry(self):
        result = case()
        result["final"]["recovered"] = True
        self.assertTrue(probe.judge("disconnect", result))
        result["gateway"] = ["watchdog retry scheduled session=agent:main:probe-disconnect"]
        result["watchdog_requests"] = 1
        self.assertEqual(probe.judge("disconnect", result), [])

    def test_wrong_endpoint_requires_real_404_and_failure(self):
        result = case()
        self.assertTrue(probe.judge("not-found", result))
        result["request_log"] = [{"behaviour": "not-found"}]
        result["session_errors"] = ["The selected model was not found by the provider"]
        self.assertEqual(probe.judge("not-found", result), [])

    def test_proxy_case_requires_recorded_connection_failure(self):
        result = case()
        self.assertTrue(probe.judge("proxy-down", result))
        result["session_errors"] = ["LLM request failed: network connection error"]
        self.assertEqual(probe.judge("proxy-down", result), [])

    def test_browser_hang_fails_even_when_reply_arrived(self):
        result = case()
        result["final"]["recovered"] = True
        result["gateway"] = ["watchdog retry scheduled session=agent:main:probe-disconnect"]
        result["watchdog_requests"] = 1
        result["screenshot_errors"] = ["timeout"]
        self.assertTrue(probe.judge("disconnect", result))

    def test_action_case_must_also_use_the_upstream_watchdog(self):
        result = case()
        result["final"]["recovered"] = True
        self.assertTrue(probe.judge("disconnect-action", result))
        result["gateway"] = ["watchdog retry scheduled session=agent:main:probe-disconnect-action"]
        result["watchdog_requests"] = 1
        result["requests"] = 3
        self.assertEqual(probe.judge("disconnect-action", result), [])
        result["requests"] = 5
        self.assertTrue(probe.judge("disconnect-action", result))

    def test_action_case_accepts_the_gates_honest_stop_but_not_silence(self):
        result = case()
        result["gateway"] = ["watchdog retry scheduled session=agent:main:probe-disconnect-action"]
        result["watchdog_requests"] = 1
        result["requests"] = 3
        self.assertTrue(probe.judge("disconnect-action", result))
        result["final"]["honestStop"] = True
        self.assertEqual(probe.judge("disconnect-action", result), [])
        # A plain conversation reply must still arrive in full.
        result["gateway"] = ["watchdog retry scheduled session=agent:main:probe-disconnect"]
        self.assertTrue(probe.judge("disconnect", result))


if __name__ == "__main__":
    unittest.main()
