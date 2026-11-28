import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app import config_repair
from app.config_repair import ConfigRepair, invalid_config_paths, replace_subtree
from app import windows_desktop
from app.windows_desktop import GatewaySupervisor

# What the bundled gateway (OpenClaw 2026.7.1-2) prints, captured in an
# isolated HOME from the config 2.5.36 wrote behind a system proxy.
GATEWAY_LOG = """2026-11-05T03:32:43.597-08:00 [gateway] starting...
2026-11-05T03:32:45.834-08:00 Gateway failed to start: Invalid config at C:\\Users\\a\\.openclaw\\openclaw.json:
browser.ssrfPolicy: Invalid input
gateway: Invalid input
Run "openclaw doctor --fix" to repair, then retry.
If startup is still blocked, inspect the adjacent .bak backup before restoring it manually.
"""


class InvalidConfigPathsTest(unittest.TestCase):
    def test_reads_the_paths_the_gateway_lists(self):
        self.assertEqual(invalid_config_paths(GATEWAY_LOG), ["browser.ssrfPolicy", "gateway"])

    def test_other_exits_are_not_config_errors(self):
        self.assertIsNone(invalid_config_paths("EADDRINUSE 127.0.0.1:18789"))
        self.assertIsNone(invalid_config_paths(""))

    def test_root_and_indexed_paths(self):
        text = "Invalid config at /x/openclaw.json:\n<root>: Unrecognized key\nagents.list[0].model: Invalid input\n"
        self.assertEqual(invalid_config_paths(text), ["<root>", "agents.list[0].model"])

    def test_subtree_replacement_copies_or_drops(self):
        config = {"browser": {"ssrfPolicy": {"bad": 1}, "extraArgs": ["--x"]}, "gateway": {"bogus": 1}}
        good = {"browser": {"ssrfPolicy": {"dangerouslyAllowPrivateNetwork": True}}, "gateway": {"port": 18789}}
        config = replace_subtree(config, good, "browser.ssrfPolicy")
        config = replace_subtree(config, good, "gateway")
        self.assertEqual(config["browser"], {"ssrfPolicy": {"dangerouslyAllowPrivateNetwork": True}, "extraArgs": ["--x"]})
        self.assertEqual(config["gateway"], {"port": 18789})
        self.assertNotIn("extra", replace_subtree({"extra": 1}, {}, "extra"))


class ConfigRepairTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = self.root / "openclaw.json"
        self.state = self.root / "state"
        self.logs = []

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, data, path=None):
        (path or self.config).parent.mkdir(parents=True, exist_ok=True)
        (path or self.config).write_text(json.dumps(data), encoding="utf-8")

    def read(self):
        return json.loads(self.config.read_text(encoding="utf-8"))

    def repairer(self, validate, doctor=None):
        return ConfigRepair(self.config, self.state, validate=validate, doctor=doctor,
                            log=self.logs.append, clock=lambda: 0)

    def kept(self):
        return sorted(p.name for p in self.root.glob("openclaw.json.invalid-*"))

    def test_known_migration_runs_first_and_keeps_the_broken_file(self):
        self.write({"browser": {"ssrfPolicy": {"allowPrivateNetwork": True}, "extraArgs": ["--proxy-server=x"]}})
        doctor = mock.Mock()
        result = self.repairer(lambda: (True, []), doctor).repair(["browser.ssrfPolicy"])
        self.assertTrue(result["repaired"])
        self.assertEqual(result["step"], "migration")
        self.assertEqual(result["message"], config_repair.NOTICE)
        self.assertEqual(self.read()["browser"]["ssrfPolicy"], {"dangerouslyAllowPrivateNetwork": True})
        self.assertEqual(len(self.kept()), 1)
        self.assertIn("allowPrivateNetwork", (self.root / self.kept()[0]).read_text(encoding="utf-8"))
        doctor.assert_not_called()

    def test_broken_subtree_comes_back_from_the_last_good_copy(self):
        self.write({"gateway": {"port": 18789}, "agents": {"list": ["a"]}}, self.state / config_repair.LAST_GOOD_NAME)
        self.write({"gateway": {"bogus": True}, "agents": {"list": ["a", "b"]}})
        answers = iter([(True, [])])
        result = self.repairer(lambda: next(answers)).repair(["gateway"])
        self.assertEqual(result["step"], "subtree")
        # Only the broken subtree goes back; the user's newer agents stay.
        self.assertEqual(self.read(), {"gateway": {"port": 18789}, "agents": {"list": ["a", "b"]}})

    def test_whole_last_good_copy_when_the_subtree_is_not_enough(self):
        good = {"gateway": {"port": 18789}}
        self.write(good, self.state / config_repair.LAST_GOOD_NAME)
        self.write({"gateway": {"bogus": True}, "weird": 1})
        answers = iter([(False, ["<root>"]), (True, [])])
        result = self.repairer(lambda: next(answers)).repair(["gateway"])
        self.assertEqual(result["step"], "last-good")
        self.assertEqual(self.read(), good)

    def test_unparseable_file_goes_back_to_last_good(self):
        self.write({"gateway": {"port": 18789}}, self.state / config_repair.LAST_GOOD_NAME)
        self.config.write_text("{ not json", encoding="utf-8")
        result = self.repairer(lambda: (True, [])).repair(["<root>"])
        self.assertEqual(result["step"], "last-good")
        self.assertEqual(len(self.kept()), 1)

    def test_doctor_is_the_last_resort(self):
        self.write({"gateway": {"bogus": True}})
        doctor = mock.Mock(return_value=True)
        answers = iter([(True, [])])
        result = self.repairer(lambda: next(answers), doctor).repair(["gateway"])
        doctor.assert_called_once_with()
        self.assertEqual(result["step"], "doctor")
        self.assertEqual(len(self.kept()), 1)
        self.assertTrue(any("doctor" in line for line in self.logs))

    def test_gives_up_without_losing_the_file(self):
        self.write({"gateway": {"bogus": True}})
        result = self.repairer(lambda: (False, ["gateway"]), lambda: False).repair(["gateway"])
        self.assertFalse(result["repaired"])
        self.assertEqual(self.read(), {"gateway": {"bogus": True}})
        self.assertEqual(len(self.kept()), 1)

    def test_last_good_is_saved_only_from_parseable_files(self):
        repairer = self.repairer(lambda: (True, []))
        self.config.write_text("{ not json", encoding="utf-8")
        self.assertFalse(repairer.save_last_good())
        self.write({"gateway": {"port": 18789}})
        self.assertTrue(repairer.save_last_good())
        self.assertEqual(json.loads((self.state / config_repair.LAST_GOOD_NAME).read_text()), {"gateway": {"port": 18789}})

    def test_non_utf8_bytes_go_back_to_last_good(self):
        # A config written in GBK (or truncated mid multi-byte UTF-8 sequence)
        # is not valid utf-8-sig: _load must not raise, and repair() must still
        # restore from the last-good copy instead of leaving the gateway stuck.
        self.write({"gateway": {"port": 18789}}, self.state / config_repair.LAST_GOOD_NAME)
        self.config.parent.mkdir(parents=True, exist_ok=True)
        self.config.write_bytes("设置".encode("gbk"))
        result = self.repairer(lambda: (True, [])).repair(["<root>"])
        self.assertEqual(result["step"], "last-good")
        self.assertEqual(self.read(), {"gateway": {"port": 18789}})
        self.assertEqual(len(self.kept()), 1)

    def test_truncated_multibyte_utf8_goes_back_to_last_good(self):
        self.write({"gateway": {"port": 18789}}, self.state / config_repair.LAST_GOOD_NAME)
        self.config.parent.mkdir(parents=True, exist_ok=True)
        # A valid UTF-8 JSON document with its last multi-byte character cut off.
        full = json.dumps({"gateway": {"note": "设置"}}).encode("utf-8")
        self.config.write_bytes(full[:-1])
        result = self.repairer(lambda: (True, [])).repair(["<root>"])
        self.assertEqual(result["step"], "last-good")
        self.assertEqual(self.read(), {"gateway": {"port": 18789}})

    def test_non_dict_json_is_treated_as_unparseable(self):
        # A top-level JSON array/scalar is syntactically valid JSON but not a
        # config object; _load must reject it rather than handing a list
        # downstream where dict-shaped code would blow up.
        self.write({"gateway": {"port": 18789}}, self.state / config_repair.LAST_GOOD_NAME)
        self.config.write_text("[1, 2, 3]", encoding="utf-8")
        result = self.repairer(lambda: (True, [])).repair(["<root>"])
        self.assertEqual(result["step"], "last-good")
        self.assertEqual(self.read(), {"gateway": {"port": 18789}})

    def test_well_formed_json_missing_expected_fields_still_migrates(self):
        # Syntactically fine, semantically incomplete: no "browser" key at all.
        # migrate() must tolerate the missing field instead of raising, and
        # fall through to the subtree/last-good path.
        self.write({"gateway": {"port": 18789}, "agents": {"list": ["a"]}}, self.state / config_repair.LAST_GOOD_NAME)
        self.write({"agents": {"list": ["a", "b"]}})
        answers = iter([(True, [])])
        result = self.repairer(lambda: next(answers)).repair(["gateway"])
        self.assertEqual(result["step"], "subtree")
        self.assertEqual(self.read(), {"gateway": {"port": 18789}, "agents": {"list": ["a", "b"]}})

    def test_empty_object_has_nothing_to_migrate(self):
        self.write({})
        result = self.repairer(lambda: (True, [])).repair()
        self.assertEqual(result, {"repaired": False, "step": "none", "message": "设置文件没有发现问题"})


class SupervisorRepairTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.environment = mock.patch.dict(os.environ, {
            "PINKIE_STATE_ROOT": str(self.root / "state"),
            "OPENCLAW_CONFIG_PATH": str(self.root / "openclaw.json"),
        })
        self.environment.start()
        runtime = mock.Mock()
        runtime.root = self.root
        self.supervisor = GatewaySupervisor(runtime)

    def tearDown(self):
        self.environment.stop()
        self.temporary.cleanup()

    def test_exit_on_invalid_config_repairs_only_what_this_process_printed(self):
        log = self.root / "state/logs/gateway.log"
        log.parent.mkdir(parents=True)
        old = "Invalid config at x:\nold.path: Invalid input\n"
        log.write_text(old, encoding="utf-8")
        self.supervisor.log_offset = len(old.encode())
        self.supervisor.exit_inspected = False
        with log.open("a", encoding="utf-8") as handle:
            handle.write(GATEWAY_LOG)
        with mock.patch.object(self.supervisor, "repair_config", return_value={"repaired": True}) as repair:
            self.supervisor.inspect_exit()
            self.supervisor.inspect_exit()  # the same exit is read once
        repair.assert_called_once_with(["browser.ssrfPolicy", "gateway"])

    def test_other_exits_do_not_touch_the_config(self):
        log = self.root / "state/logs/gateway.log"
        log.parent.mkdir(parents=True)
        log.write_text("listen EADDRINUSE\n", encoding="utf-8")
        self.supervisor.exit_inspected = False
        with mock.patch.object(self.supervisor, "repair_config") as repair:
            self.assertIsNone(self.supervisor.inspect_exit())
        repair.assert_not_called()

    # ---- B135: gateway.log can be empty or hold bytes a prior crash cut mid-write ----
    def test_an_empty_gateway_log_is_read_as_no_output_not_a_crash(self):
        """网关被信号杀掉 / 磁盘写满时，gateway.log 可能存在但一个字节都没写进去。"""
        log = self.root / "state/logs/gateway.log"
        log.parent.mkdir(parents=True)
        log.write_bytes(b"")
        self.supervisor.exit_inspected = False
        with mock.patch.object(self.supervisor, "repair_config") as repair:
            self.assertIsNone(self.supervisor.inspect_exit())
        repair.assert_not_called()

    def test_gateway_log_with_non_utf8_bytes_does_not_crash_the_read(self):
        """写到一半被截断 / 编码不对的字节：解码要替换掉坏字节，不能整条链路炸掉，
        也不能把半截乱码误判成一条 invalid-config 路径。"""
        log = self.root / "state/logs/gateway.log"
        log.parent.mkdir(parents=True)
        log.write_bytes(b"starting gateway...\n\xff\xfe\x80\x81 truncated mid-wri")
        self.supervisor.exit_inspected = False
        with mock.patch.object(self.supervisor, "repair_config") as repair:
            self.assertIsNone(self.supervisor.inspect_exit())
        repair.assert_not_called()

    def test_repair_sets_the_startup_notice_and_is_limited(self):
        fake = mock.Mock()
        fake.repair.return_value = {"repaired": True, "step": "migration", "message": config_repair.NOTICE}
        with mock.patch.object(self.supervisor, "config_repair", return_value=fake):
            for _ in range(5):
                self.supervisor.repair_config(["gateway"])
            self.assertEqual(fake.repair.call_count, self.supervisor.repair_limit)
            self.assertEqual(self.supervisor.notice, config_repair.NOTICE)
            self.supervisor.repair_config(force=True)  # the user's button always runs
            self.assertEqual(fake.repair.call_count, self.supervisor.repair_limit + 1)

    def test_validate_reads_the_runtime_json(self):
        output = json.dumps({"valid": False, "issues": [{"path": "browser.ssrfPolicy", "message": "Invalid input"}]})
        with mock.patch.object(windows_desktop.subprocess, "run",
                               return_value=mock.Mock(stdout=output.encode(), returncode=1)) as run:
            self.supervisor.runtime.environment.return_value = {}
            self.assertEqual(self.supervisor.validate_config(), (False, ["browser.ssrfPolicy"]))
        self.assertEqual(run.call_args.args[0][-3:], ["config", "validate", "--json"])


if __name__ == "__main__":
    unittest.main()
