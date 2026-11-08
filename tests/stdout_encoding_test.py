"""Chinese status prints must survive a non-UTF-8 Windows locale.

On a stock Windows runner (or a fresh install) the process stdout is cp1252,
and a bare ``print('中文')`` raises ``UnicodeEncodeError: 'charmap' codec
can't encode``.  Every service that prints a Chinese status line therefore
reconfigures stdout to UTF-8 at import time, the same way its file writes
already pin ``encoding='utf-8'``.

This test runs the real setup modules inside a subprocess whose stdout is
forced to cp1252 (via ``PYTHONIOENCODING``), then triggers the print.  If any
module drops the reconfigure, the subprocess dies with UnicodeEncodeError and
the test fails -- deterministically, without depending on the host locale.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

# service -> (module path, call that triggers the Chinese print)
# The call is executed inside the subprocess with a scratch PINKIE_STATE_ROOT,
# so it never touches the real user state.
_MODULES = [
    ('context', 'services/context/setup.py', 'install'),
    ('mode-architecture', 'services/mode-architecture/setup.py', 'install'),
    ('party', 'services/party/setup.py', 'install'),
    ('project-scope', 'services/project-scope/setup.py', 'install'),
]

# usage.py prints its Chinese status from the __main__ guard, so it has to run
# as a script rather than being imported and called.
_USAGE_SCRIPT = 'services/party/usage.py'


def _run_print_in_cp1252(module_path, call_name):
    """Load a module and run one callable with stdout pinned to cp1252.

    The sandbox home must already contain ``.openclaw/openclaw.json``: the
    install callables return early when that file is missing, so a bare
    temporary directory would never reach the Chinese print and the test would
    pass vacuously.
    """
    code = (
        "import os, runpy, tempfile, pathlib, sys, json\n"
        "home = pathlib.Path(tempfile.mkdtemp())\n"
        "os.environ['PINKIE_STATE_ROOT'] = str(home)\n"
        "cfg = home/'.openclaw'/'openclaw.json'\n"
        "cfg.parent.mkdir(parents=True, exist_ok=True)\n"
        "cfg.write_text(json.dumps({'models': {'providers': {}}}), encoding='utf-8')\n"
        "m = runpy.run_path(sys.argv[1])\n"
        f"m[sys.argv[2]](home)\n"
    )
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'cp1252'
    env['PINKIE_STATE_ROOT'] = str(Path(tempfile.mkdtemp()))
    # Decode the child's (UTF-8) output explicitly: the child reconfigures its
    # stdout to UTF-8, so the parent must not try to read those bytes as the
    # locale's cp1252 or subprocess's reader thread dies with UnicodeDecodeError.
    return subprocess.run(
        [sys.executable, '-c', code, str(ROOT / module_path), call_name],
        env=env, capture_output=True, text=True, encoding='utf-8',
        errors='replace', timeout=60,
    )


def _run_usage_script_in_cp1252():
    """Run usage.py as a script (hits its __main__ Chinese print)."""
    env = dict(os.environ)
    env['PYTHONIOENCODING'] = 'cp1252'
    env['PINKIE_STATE_ROOT'] = str(Path(tempfile.mkdtemp()))
    return subprocess.run(
        [sys.executable, str(ROOT / _USAGE_SCRIPT)],
        env=env, capture_output=True, text=True, encoding='utf-8',
        errors='replace', timeout=60,
    )


class StdoutEncodingTests(unittest.TestCase):
    def test_chinese_status_print_survives_a_cp1252_stdout(self):
        for label, module_path, call_name in _MODULES:
            with self.subTest(module=label):
                proc = _run_print_in_cp1252(module_path, call_name)
                self.assertEqual(
                    proc.returncode, 0,
                    f'{label} crashed under cp1252 stdout: {proc.stderr}',
                )

    def test_usage_script_chinese_print_survives_a_cp1252_stdout(self):
        proc = _run_usage_script_in_cp1252()
        self.assertEqual(
            proc.returncode, 0,
            f'usage.py crashed under cp1252 stdout: {proc.stderr}',
        )


if __name__ == '__main__':
    unittest.main()
