import importlib.util
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
