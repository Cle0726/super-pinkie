import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import super_pinkie

KEYS = ("UR_PROXY_FIRST_BYTE_TIMEOUT", "UR_PROXY_RETRY_BUDGET")
SLOW_MODEL = {"UR_PROXY_FIRST_BYTE_TIMEOUT": "180", "UR_PROXY_RETRY_BUDGET": "300"}


# Without these the relay falls back to the script's 35s / 75s and cuts
# hy4flash-free long-context replies (first byte 76-90s) into retries and a 503.
class RelayTimeoutTests(unittest.TestCase):
    def fake_script(self, directory):
        seen = Path(directory) / "seen.json"
        script = Path(directory) / "mm-retry-proxy.py"
        script.write_text(
            "import json, os, pathlib\n"
            f"pathlib.Path({str(seen)!r}).write_text(json.dumps({{k: os.environ.get(k) for k in {KEYS!r}}}))\n",
            encoding="utf-8",
        )
        return script, seen

    def relay_env(self, environment):
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, environment, clear=True):
            script, seen = self.fake_script(directory)
            with mock.patch.object(super_pinkie, "resource_path", return_value=script), \
                    mock.patch.object(super_pinkie, "prompts_dir", return_value=Path(directory)), \
                    mock.patch.object(super_pinkie.sys, "argv", ["super_pinkie"]):
                super_pinkie.run_relay(1467, 1466)
            return json.loads(seen.read_text(encoding="utf-8"))

    def proxy_manager_env(self, environment):
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, environment, clear=True):
            script, _seen = self.fake_script(directory)
            with mock.patch.object(super_pinkie, "resource_path", return_value=script), \
                    mock.patch.object(super_pinkie, "prompts_dir", return_value=Path(directory)), \
                    mock.patch.object(super_pinkie.subprocess, "Popen") as popen, \
                    mock.patch.object(super_pinkie.threading, "Thread"):
                super_pinkie.ProxyManager(lambda _message: None).start()
            env = popen.call_args.kwargs["env"]
            return {key: env.get(key) for key in KEYS}

    def test_relay_process_gets_slow_model_timeouts(self):
        self.assertEqual(self.relay_env({}), SLOW_MODEL)

    def test_control_center_proxy_gets_slow_model_timeouts(self):
        self.assertEqual(self.proxy_manager_env({}), SLOW_MODEL)

    def test_values_the_user_set_are_kept(self):
        mine = {"UR_PROXY_FIRST_BYTE_TIMEOUT": "240", "UR_PROXY_RETRY_BUDGET": "290"}
        self.assertEqual(self.relay_env(mine), mine)
        self.assertEqual(self.proxy_manager_env(mine), mine)


if __name__ == "__main__":
    unittest.main()
