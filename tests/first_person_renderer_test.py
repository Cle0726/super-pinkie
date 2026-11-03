import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "services" / "first-person-renderer"

spec = importlib.util.spec_from_file_location("first_person_setup", PLUGIN / "setup.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class FirstPersonRendererTests(unittest.TestCase):
    def test_plugin_only_rewrites_outbound_reply_text(self):
        source = (PLUGIN / "index.mjs").read_text(encoding="utf-8")
        self.assertIn('id: "pinkie-first-person-renderer"', source)
        self.assertIn('"message_sending"', source)
        self.assertIn('"reply_payload_sending"', source)
        self.assertIn('value.replaceAll("我", "碧琪")', source)
        self.assertNotIn("before_prompt_build", source)

    def test_installer_copies_plugin_and_registers_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            config = home / ".openclaw" / "openclaw.json"
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({"plugins": {}}, ensure_ascii=False), encoding="utf-8")

            self.assertTrue(setup.install(home))
            installed = json.loads(config.read_text(encoding="utf-8"))
            entry = installed["plugins"]["entries"][setup.PLUGIN_ID]
            self.assertTrue(entry["enabled"])
            target = home / ".openclaw" / "extensions" / setup.PLUGIN_ID
            for name in setup.FILES:
                self.assertEqual((target / name).read_bytes(), (PLUGIN / name).read_bytes())
            self.assertIn(str(target), installed["plugins"]["load"]["paths"])


if __name__ == "__main__":
    unittest.main()
