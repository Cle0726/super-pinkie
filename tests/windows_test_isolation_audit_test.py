"""B140: tests/windows_*.py leaking os.environ state into later test modules.

`python -m unittest discover` runs every tests/windows_*.py file in one
process, so a module-level or setUp/tearDown env mutation that does not
restore the *prior* value (not just "unset") corrupts whatever ran after it.
Two real gaps found during the B140 audit, now fixed:

  - windows_update_problem_hint_test.py set CLAUDE_CONFIG_DIR / CODEX_HOME /
    OPENAI_API_KEY at module import time with no tearDownModule at all.
  - windows_update_health_test.py's ReporterTest set/popped PINKIE_STATE_ROOT
    with raw os.environ[...] / .pop(...), so tearDown destroyed a value that
    existed before the test instead of restoring it.

These tests load each fixed module directly (so they do not depend on
discovery order) and drive its setup/teardown with a sentinel value already
in place, proving the sentinel survives.
"""
import importlib.util
import os
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProblemHintModuleIsolationTest(unittest.TestCase):
    ENV_KEYS = ("CLAUDE_CONFIG_DIR", "CODEX_HOME", "OPENAI_API_KEY")

    def test_teardown_restores_the_env_values_that_existed_before_import(self):
        prior = {key: os.environ.get(key) for key in self.ENV_KEYS}
        os.environ["CLAUDE_CONFIG_DIR"] = "sentinel-claude"
        os.environ["CODEX_HOME"] = "sentinel-codex"
        os.environ["OPENAI_API_KEY"] = "sentinel-openai"
        try:
            module = _load("windows_update_problem_hint_isolation_probe",
                            "tests/windows_update_problem_hint_test.py")
            # While loaded, the module's own values are in effect.
            self.assertEqual(os.environ.get("CLAUDE_CONFIG_DIR"), str(module.SCRATCH / "claude"))
            self.assertEqual(os.environ.get("CODEX_HOME"), str(module.SCRATCH / "codex"))
            self.assertNotIn("OPENAI_API_KEY", os.environ)
            self.assertTrue(hasattr(module, "tearDownModule"),
                             "module must define tearDownModule to undo its env mutation")
            module.tearDownModule()
            # Afterward, the sentinels we had before import must be back --
            # not merely "unset", which was the bug for CLAUDE_CONFIG_DIR/CODEX_HOME,
            # and OPENAI_API_KEY must be restored, not left popped.
            self.assertEqual(os.environ.get("CLAUDE_CONFIG_DIR"), "sentinel-claude")
            self.assertEqual(os.environ.get("CODEX_HOME"), "sentinel-codex")
            self.assertEqual(os.environ.get("OPENAI_API_KEY"), "sentinel-openai")
            self.assertFalse(module.SCRATCH.exists(), "tearDownModule must also remove its scratch dir")
        finally:
            for key, value in prior.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


class ReporterStateRootIsolationTest(unittest.TestCase):
    def test_teardown_restores_a_pinkie_state_root_value_that_existed_before_setup(self):
        health = _load("windows_update_health_isolation_probe", "tests/windows_update_health_test.py")
        prior = os.environ.get("PINKIE_STATE_ROOT")
        os.environ["PINKIE_STATE_ROOT"] = "sentinel-state-root"
        try:
            case = health.ReporterTest.__new__(health.ReporterTest)
            case._cleanups = []
            case.setUp()
            try:
                self.assertEqual(os.environ.get("PINKIE_STATE_ROOT"), str(case.root))
            finally:
                case.tearDown()
                # Run the addCleanup callbacks directly: doCleanups() needs
                # TestCase._outcome, which only exists once a case runs
                # through the real test runner, not via __new__ like here.
                for function, args, kwargs in reversed(case._cleanups):
                    function(*args, **kwargs)
            # The old code did os.environ.pop("PINKIE_STATE_ROOT", None) here,
            # which would leave this None instead of restoring the sentinel.
            self.assertEqual(os.environ.get("PINKIE_STATE_ROOT"), "sentinel-state-root")
        finally:
            if prior is None:
                os.environ.pop("PINKIE_STATE_ROOT", None)
            else:
                os.environ["PINKIE_STATE_ROOT"] = prior


if __name__ == "__main__":
    unittest.main()
