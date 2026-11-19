import importlib.util
from pathlib import Path
import re
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mac_package_check", ROOT / "tools/macos-package/check_runtime.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class MacPackageRuntimeTests(unittest.TestCase):
    def test_macos_staging_contains_every_file_that_mode_setup_installs(self):
        # The Mac bundle stages files once, then setup.py copies them again on
        # first launch. A file in only the latter list cannot reach the App.
        spec = importlib.util.spec_from_file_location("windows_runtime_check", ROOT / "tools/windows-package/check_runtime.py")
        windows = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(windows)
        installer = (ROOT / "installer/macos/apply-theme.sh").read_text(encoding="utf-8")
        match = re.search(r"for service_file in ([^\n]*session-lineage\.mjs[^\n]*); do", installer)
        self.assertIsNotNone(match, "cannot locate the mode-plugin staging list")
        staged = set(match.group(1).split())
        self.assertEqual(sorted(windows.setup_copy_list() - staged), [])

    def test_fresh_install_loads_the_complete_plugin_and_rejects_missing_import(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is needed to load the packaged plugin")
        with tempfile.TemporaryDirectory(prefix="pinkie-mac-bundle-") as temporary:
            root = Path(temporary) / "SuperPinkie"
            services = root / "services"
            services.mkdir(parents=True)
            shutil.copy2(ROOT / "services/state_root.py", services / "state_root.py")
            shutil.copytree(ROOT / "services/mode-architecture", services / "mode-architecture")
            checker.check(root, node)
            for part in ("metre/roles", "project/playbooks"):
                shutil.copytree(ROOT / "personas" / part, root / "personas" / part)
            visual = root / "personas/thinking"
            visual.mkdir(parents=True)
            shutil.copy2(ROOT / "personas/thinking/AESTHETICS.md", visual)
            self.assertEqual(checker.check(root, node, metre_roles=True)["officialCount"], 33)
            (root / "personas/metre/roles/researcher.md").unlink()
            with self.assertRaisesRegex(RuntimeError, "33 byte-identical"):
                checker.check(root, node, metre_roles=True)
            (services / "mode-architecture/openclaw-paths.mjs").unlink()
            with self.assertRaisesRegex(RuntimeError, "openclaw-paths"):
                checker.check(root, node)


if __name__ == "__main__":
    unittest.main()
