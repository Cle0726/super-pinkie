import importlib.util
import json
import shutil
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("windows_smoke", ROOT / "tools/windows-smoke/smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class WindowsSmokeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node is required to check the page-state script")
    def test_page_state_script_detects_a_gateway_error(self):
        script = """
          globalThis.location = {href: 'http://localhost/chat', search: ''};
          globalThis.document = {
            documentElement: {getAttribute: () => null},
            querySelector: () => null,
            body: {innerText: 'GatewayRequestError: Unknown agent id project\\nother'},
          };
          globalThis.getComputedStyle = () => ({fontFamily: 'test'});
          const state = (PAGE_STATE)();
          process.stdout.write(JSON.stringify(state));
        """.replace("PAGE_STATE", smoke.PAGE_STATE)
        result = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)["gatewayError"], "GatewayRequestError: Unknown agent id project")


if __name__ == "__main__":
    unittest.main()
