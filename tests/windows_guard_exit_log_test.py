"""B110: when the guard forces the App to exit, every close step still runs, and a
step that fails is logged with its name instead of being swallowed. A gateway
that did not close keeps its port; a window that did not go keeps
webview.start() from returning. Before this, the launcher log said nothing.
"""
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from app import windows_desktop
from app.windows_desktop import run_exit_steps

# append_log writes under PINKIE_STATE_ROOT: keep it out of the real profile.
_STATE = tempfile.TemporaryDirectory()
_ENV = mock.patch.dict(os.environ, {"PINKIE_STATE_ROOT": _STATE.name})


def setUpModule():
    _ENV.start()


def tearDownModule():
    _ENV.stop()
    _STATE.cleanup()


def boom(message):
    def fn():
        raise RuntimeError(message)
    return fn


class RunExitStepsTest(unittest.TestCase):
    def test_all_steps_run_and_nothing_is_logged_when_they_succeed(self):
        ran, logged = [], []
        run_exit_steps("guard exit", [("a", lambda: ran.append("a")), ("b", lambda: ran.append("b"))],
                       log=lambda *args: logged.append(args))
        self.assertEqual(ran, ["a", "b"])
        self.assertEqual(logged, [])

    def test_a_failing_step_is_logged_by_name_and_the_rest_still_run(self):
        ran, logged = [], []
        run_exit_steps("guard exit", [
            ("services close", lambda: ran.append("services")),
            ("gateway close", boom("port still held")),
            ("window destroy", lambda: ran.append("window")),
        ], log=lambda *args: logged.append(args))
        self.assertEqual(ran, ["services", "window"])
        self.assertEqual(len(logged), 1)
        name, message = logged[0]
        self.assertEqual(name, "launcher")
        self.assertIn("guard exit: gateway close failed", message)
        self.assertIn("port still held", message)

    def test_every_failure_gets_its_own_line(self):
        logged = []
        run_exit_steps("guard exit", [("a", boom("one")), ("b", boom("two"))],
                       log=lambda *args: logged.append(args))
        self.assertEqual([m for _, m in logged], ["guard exit: a failed: RuntimeError('one')",
                                                  "guard exit: b failed: RuntimeError('two')"])

    def test_a_failing_logger_does_not_raise(self):
        def broken_log(*_):
            raise OSError("log locked")
        run_exit_steps("guard exit", [("a", boom("one"))], log=broken_log)  # must not raise

    def test_the_failure_lands_in_the_launcher_log_file(self):
        run_exit_steps("guard exit", [("window destroy", boom("window already gone"))])
        log = Path(_STATE.name) / "logs" / "launcher.log"
        self.assertIn("guard exit: window destroy failed", log.read_text(encoding="utf-8"))

    def test_enforce_guard_exit_uses_it_for_all_four_steps(self):
        source = Path(windows_desktop.__file__).read_text(encoding="utf-8")
        start = source.index("def enforce_guard_exit():")
        body = source[start:source.index("def monitor_guard():", start)]
        self.assertIn('run_exit_steps("guard exit"', body)
        for step in ("services.close", "computer.close", "gateway.close", "window.destroy"):
            self.assertIn(step, body)
        self.assertNotIn("pass", body)


if __name__ == "__main__":
    unittest.main()
