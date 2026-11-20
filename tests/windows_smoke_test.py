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


class ReleaseMetrePromptTests(unittest.TestCase):
    def setUp(self):
        self.before = {"mode": "unrestricted", "pending": None,
                       "session": "agent:unrestricted:main", "shellSession": ""}
        self.page = mock.Mock()
        self.password = mock.Mock()
        self.option = mock.Mock()
        self.page.locator.side_effect = {
            f'{smoke.METRE_DIALOG} input[type="password"]': self.password,
            '.laolao-mode-menu__option[data-mode="metre"]': self.option,
        }.__getitem__
        self.password.is_visible.return_value = False
        self.page.evaluate.side_effect = [self.before, True]

    def open_prompt(self):
        return smoke.open_release_metre_prompt(self.page, self.before, TimeoutError, "fresh")

    def test_first_click_needs_no_retry(self):
        self.assertEqual(self.open_prompt(), "first")
        self.option.click.assert_called_once()
        self.page.evaluate.assert_not_called()

    def test_one_retry_after_slow_gateway_with_locked_status(self):
        self.password.wait_for.side_effect = [TimeoutError("slow gateway"), None]
        self.assertEqual(self.open_prompt(), "retry")
        self.assertEqual(self.page.evaluate.call_args_list, [mock.call(smoke.PAGE_STATE), mock.call(smoke.METRE_LOCK_READY)])
        self.assertEqual(self.option.click.call_count, 2)

    def test_late_prompt_is_not_clicked_twice(self):
        self.password.wait_for.side_effect = TimeoutError("slow gateway")
        self.password.is_visible.return_value = True
        self.assertEqual(self.open_prompt(), "late")
        self.option.click.assert_called_once()

    def test_retry_cannot_mask_a_mode_change_or_an_unconfirmed_lock(self):
        self.password.wait_for.side_effect = TimeoutError("missing prompt")
        for state, locked, error in (
            ({**self.before, "shellSession": "agent:metre:main"}, True, "mode/session changed"),
            (self.before, False, "did not confirm"),
        ):
            with self.subTest(state=state, locked=locked):
                self.option.reset_mock()
                self.page.evaluate.side_effect = [state, locked]
                with self.assertRaisesRegex(RuntimeError, error):
                    self.open_prompt()
                self.option.click.assert_called_once()

    def test_a_second_timeout_still_fails_the_smoke_test(self):
        self.password.wait_for.side_effect = TimeoutError("missing prompt")
        with self.assertRaisesRegex(TimeoutError, "missing prompt"):
            self.open_prompt()
        self.assertEqual(self.option.click.call_count, 2)


class WindowsSmokeTests(unittest.TestCase):
    def test_fresh_modes_use_pinkies_name_without_overriding_existing_users(self):
        identities = {agent: "碧琪" for agent in smoke.AGENTS}
        identities["metre"] = "Metre"
        self.assertTrue(smoke.fresh_mode_identities_ok("fresh", {"identities": identities}))
        identities["unrestricted"] = "助手"
        self.assertFalse(smoke.fresh_mode_identities_ok("fresh", {"identities": identities}))
        self.assertTrue(smoke.fresh_mode_identities_ok("upgrade", {"identities": identities}))

    def test_metre_is_checked_in_the_packaged_app(self):
        self.assertIn("metre", smoke.AGENTS)
        self.assertIn(("metre", "agent:metre:"), smoke.MODES)
        identities = {agent: "碧琪" for agent in smoke.AGENTS}
        self.assertFalse(smoke.fresh_mode_identities_ok("fresh", {"identities": identities}))

    def test_a_guard_notice_is_spotted_from_the_profile_log(self):
        import tempfile
        with tempfile.TemporaryDirectory() as scratch:
            env = {"LOCALAPPDATA": scratch}
            self.assertEqual(smoke.guard_alert(env), "")
            logs = Path(scratch) / "SuperPinkie/logs"
            logs.mkdir(parents=True)
            (logs / "guard.log").write_text("[t] runtime guard check failed: x\n", encoding="utf-8")
            self.assertEqual(smoke.guard_alert(env), "")
            with (logs / "guard.log").open("a", encoding="utf-8") as handle:
                handle.write("[t] alert: 碧琪发现自己的基础运行配置被改动了，已经换回官方版本\n")
            self.assertIn("基础运行配置", smoke.guard_alert(env))

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
