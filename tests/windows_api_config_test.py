import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import super_pinkie


class ApiConfigTests(unittest.TestCase):
    """The control center's API form must write a config OpenClaw accepts.

    A provider carrying "model" is rejected as invalid, the gateway then
    refuses to start, and the page waits for 「上游恢复」 forever."""

    def save(self, initial, *args):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "openclaw.json"
            if initial is not None:
                config.write_text(json.dumps(initial), encoding="utf-8")
            with mock.patch.object(super_pinkie, "openclaw_config_path", return_value=config):
                super_pinkie.update_api_config(*args, lambda _message: None)
            return json.loads(config.read_text(encoding="utf-8"))

    def test_model_goes_into_the_models_list_and_the_default(self):
        cfg = self.save(None, "openai", "sk-test", "https://relay.example/v1", "gpt-4o")
        provider = cfg["models"]["providers"]["openai"]
        self.assertNotIn("model", provider)
        self.assertEqual(provider["api"], "openai-completions")
        self.assertEqual(provider["models"], [{"id": "gpt-4o", "name": "gpt-4o"}])
        self.assertEqual(cfg["agents"]["defaults"]["model"], {"primary": "openai/gpt-4o"})

    def test_an_earlier_invalid_model_key_is_repaired_and_fallbacks_are_kept(self):
        initial = {
            "models": {"providers": {"mm": {"apiKey": "old", "model": "x", "models": [{"id": "x", "name": "x"}]}}},
            "agents": {"defaults": {"model": {"primary": "mm/x", "fallbacks": ["mm/y"]}}, "list": [{"id": "main"}]},
        }
        cfg = self.save(initial, "mm", "", "", "x")
        provider = cfg["models"]["providers"]["mm"]
        self.assertNotIn("model", provider)
        self.assertEqual(provider["models"], [{"id": "x", "name": "x"}])
        self.assertEqual(provider["apiKey"], "old")
        self.assertEqual(cfg["agents"]["defaults"]["model"], {"primary": "mm/x", "fallbacks": ["mm/y"]})
        self.assertEqual(cfg["agents"]["list"], [{"id": "main"}])

    def test_key_only_leaves_the_model_choice_alone(self):
        cfg = self.save(None, "deepseek", "sk-test", "", "")
        self.assertEqual(cfg["models"]["providers"]["deepseek"], {"apiKey": "sk-test"})
        self.assertNotIn("agents", cfg)


if __name__ == "__main__":
    unittest.main()
