"""The packaged Windows App has no `app` package.

build-win.ps1 runs PyInstaller with `--paths app`: every module in app/ is a
top-level module in the frozen App. An import written only as
`from app.x import ...` / `from app import x` works in the repository (tests
run from the repo root) and fails in the App with ModuleNotFoundError.
11-12: `from app.windows_native import WindowsNative` did exactly that, so the
packaged build had no tray icon, global hotkey, notifications or exports.

Every such import must be the fallback of a plain top-level import:

    try:
        import x
    except ImportError:  # imported as app.<module> (tests)
        from app import x
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_IMPORT = re.compile(r"^(\s*)(?:from app(?:\.(\w+))? import (\w+)|import app\.(\w+))")


class FrozenImportTest(unittest.TestCase):
    def test_app_package_imports_have_a_top_level_first_try(self):
        problems = []
        for path in sorted((ROOT / "app").glob("*.py")):
            lines = path.read_text(encoding="utf-8").splitlines()
            for index, line in enumerate(lines):
                match = APP_IMPORT.match(line)
                if not match:
                    continue
                module = match.group(2) or match.group(3) or match.group(4)
                before = [text.strip() for text in lines[max(0, index - 4):index] if text.strip()]
                guarded = any(text.startswith("except ImportError") for text in before[-1:]) and any(
                    re.match(rf"(?:import {module}\b|from {module} import )", text) for text in before
                )
                if not guarded:
                    problems.append(f"{path.name}:{index + 1}: {line.strip()}")
        self.assertEqual(problems, [], "imports that only work from the repository, not in the packaged App")

    def test_windows_native_is_reachable_the_frozen_way(self):
        source = (ROOT / "app" / "windows_desktop.py").read_text(encoding="utf-8")
        self.assertIn("from windows_native import WindowsNative", source)


if __name__ == "__main__":
    unittest.main()
