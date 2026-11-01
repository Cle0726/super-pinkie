import importlib.util
import io
import json
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("windows_smoke", ROOT / "tools/windows-smoke/smoke.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class WindowsSmokeTests(unittest.TestCase):
    def test_fresh_modes_use_pinkies_name_without_overriding_existing_users(self):
        identities = {agent: "碧琪" for agent in smoke.AGENTS}
        self.assertTrue(smoke.fresh_mode_identities_ok("fresh", {"identities": identities}))
        identities["unrestricted"] = "助手"
        self.assertFalse(smoke.fresh_mode_identities_ok("fresh", {"identities": identities}))
        self.assertTrue(smoke.fresh_mode_identities_ok("upgrade", {"identities": identities}))

    def test_service_health_requires_both_expected_identities(self):
        responses = [
            io.BytesIO(json.dumps({"service": "super-pinkie-party"}).encode()),
            io.BytesIO(json.dumps({"service": "some-other-service"}).encode()),
        ]
        with mock.patch.object(smoke.urllib.request, "urlopen", side_effect=responses):
            self.assertEqual(smoke.service_health(), {"party": True, "roundtable": False})

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
