import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mac_package_check", ROOT / "tools/macos-package/check_runtime.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class MacPackageRuntimeTests(unittest.TestCase):
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
            (services / "mode-architecture/openclaw-paths.mjs").unlink()
            with self.assertRaisesRegex(RuntimeError, "openclaw-paths"):
                checker.check(root, node)


if __name__ == "__main__":
    unittest.main()
