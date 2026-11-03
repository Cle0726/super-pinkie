import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_windows_runtime", ROOT / "tools/windows-package/check_runtime.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class WindowsRuntimeFilesTests(unittest.TestCase):
    def test_every_module_the_mode_plugin_imports_is_installed(self):
        self.assertEqual(check.source_problems(), [])

    def test_a_module_left_out_of_setup_is_reported(self):
        listed = check.setup_copy_list() - {"workbench.mjs"}
        with mock.patch.object(check, "setup_copy_list", return_value=listed):
            self.assertIn("mode plugin imports workbench.mjs, but setup.py does not install it",
                          check.source_problems())

    def test_a_patched_runtime_file_overwritten_after_the_snapshot_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory)
            openclaw = package / "_internal/runtime/node_modules/openclaw"
            ai = package / "_internal/runtime/node_modules/@openclaw/ai/dist"
            services = package / "_internal/services"
            (services / "mode-architecture").mkdir(parents=True)
            (services / "mode-architecture/setup.py").write_text("", encoding="utf-8")
            ai.mkdir(parents=True)
            openclaw.mkdir(parents=True)
            (openclaw / "openclaw.mjs").write_text("", encoding="utf-8")
            sums = []
            for digest, relative in check.snapshot_hashes():
                if relative.startswith("openclaw/"):
                    target = openclaw / relative[len("openclaw/"):]
                elif relative.startswith("ai/"):
                    target = ai / Path(relative).name
                else:
                    target = services / relative[len("services/"):]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((check.SNAPSHOT / relative).read_bytes())
                sums.append(relative)
            self.assertEqual(check.package_problems(package), [])
            transport = next(r for r in sums if "openai-transport-stream" in r)
            (openclaw / transport[len("openclaw/"):]).write_text("// unpatched", encoding="utf-8")
            self.assertEqual(check.package_problems(package),
                             [f"package changed {transport} after the snapshot was applied"])


if __name__ == "__main__":
    unittest.main()
