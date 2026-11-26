"""build-win.ps1 stamps which kind of build a package is into build-info.json (channel).

tools/cle-pkg-win install-cle only installs a package whose channel is "cle", so a local
build with the C.le. core (PINKIE_CORE=cle) has to say so. Release builds must stay
"release" whatever the core, and everything that switches on release behaviour (the
settings guard, the release splash, feedback keys) must keep testing for "release" only,
so a "cle" build behaves exactly like a dev build.
"""

import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = (ROOT / "build-win.ps1").read_text(encoding="utf-8-sig")


def channel_line():
    lines = [line for line in BUILD.splitlines() if line.lstrip().startswith("$guardChannel =")]
    assert len(lines) == 1, lines
    return lines[0].strip()


class BuildChannelTest(unittest.TestCase):
    def test_every_release_switch_still_tests_for_release_only(self):
        uses = re.findall(r"\$guardChannel -(eq|ne) '([a-z]+)'", BUILD)
        self.assertTrue(uses)
        self.assertEqual({value for _, value in uses}, {"release"})
        self.assertIn("guard = ($guardChannel -eq 'release')", BUILD)

    def test_channel_is_release_then_cle_then_dev(self):
        line = channel_line()
        self.assertIn("$env:PINKIE_RELEASE_BUILD -eq '1'", line)
        self.assertIn("$coreInfo.core -eq 'cle'", line)
        self.assertLess(line.index("'release'"), line.index("'cle' }"))
        self.assertLess(line.index("'cle' }"), line.index("'dev'"))

    def test_the_real_line_picks_the_channel_in_powershell(self):
        shell = shutil.which("powershell") or shutil.which("pwsh")
        if not shell:
            self.skipTest("no PowerShell on this machine")
        cases = [
            ({}, "openclaw", "dev"),
            ({}, "cle", "cle"),
            ({"PINKIE_RELEASE_BUILD": "1"}, "openclaw", "release"),
            ({"PINKIE_RELEASE_BUILD": "1"}, "cle", "release"),
            ({"PINKIE_RELEASE_BUILD": "0"}, "cle", "cle"),
        ]
        for extra, core, expected in cases:
            with self.subTest(env=extra, core=core):
                env = {key: value for key, value in os.environ.items() if key != "PINKIE_RELEASE_BUILD"}
                env.update(extra)
                script = "$coreInfo = [pscustomobject]@{ core = '%s' }\n%s\nWrite-Output $guardChannel" % (core, channel_line())
                result = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-Command", script],
                                        capture_output=True, text=True, env=env, timeout=60)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), expected)


if __name__ == "__main__":
    unittest.main()
