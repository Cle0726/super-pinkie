import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    spec = importlib.util.spec_from_file_location("pinkie_setup_" + str(abs(hash(str(path)))), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Windows no longer overlays its own setup.py (desktop/windows/mac-runtime), so
# both platforms install from this one copy.
SOURCE = ROOT / "services/mode-architecture/setup.py"
COPIES = [load(SOURCE)]
RELAY = {"models": {"providers": {"openai": {"baseUrl": "https://relay.example/v1", "apiKey": "k1"}}}}


class MemorySearchChoiceTest(unittest.TestCase):
    def run_choice(self, module, data, state, answer):
        calls = []
        def probe(base, key):
            calls.append((base, key))
            return answer
        module._choose_memory_search(data, state, probe)
        return calls

    def test_both_copies(self):
        for module in COPIES:
            with self.subTest(module=module.__file__), tempfile.TemporaryDirectory() as tmp:
                state = Path(tmp)
                # A relay without text-embedding-3-small: switch to the local full-text index, once.
                data = json.loads(json.dumps(RELAY))
                self.assertEqual(self.run_choice(module, data, state, False), [("https://relay.example/v1", "k1")])
                self.assertEqual(data["agents"]["defaults"]["memorySearch"], {"provider": "none"})
                self.assertEqual(self.run_choice(module, data, state, True), [], "same key is not probed again")
                self.assertEqual(data["agents"]["defaults"]["memorySearch"], {"provider": "none"})
                # A new key that supports embeddings gets semantic search back.
                data["models"]["providers"]["openai"]["apiKey"] = "k2"
                self.assertEqual(len(self.run_choice(module, data, state, True)), 1)
                self.assertNotIn("memorySearch", data["agents"]["defaults"])
                # Offline: use full-text now, probe again next start.
                data["models"]["providers"]["openai"]["apiKey"] = "k3"
                self.run_choice(module, data, state, None)
                self.assertEqual(data["agents"]["defaults"]["memorySearch"], {"provider": "none"})
                self.assertEqual(len(self.run_choice(module, data, state, None)), 1)

    def test_user_choice_and_secret_refs_are_left_alone(self):
        for module in COPIES:
            with tempfile.TemporaryDirectory() as tmp:
                data = {**json.loads(json.dumps(RELAY)), "agents": {"defaults": {"memorySearch": {"provider": "gemini"}}}}
                self.assertEqual(self.run_choice(module, data, Path(tmp), False), [])
                self.assertEqual(data["agents"]["defaults"]["memorySearch"], {"provider": "gemini"})
                ref = {"models": {"providers": {"openai": {"apiKey": {"source": "env", "id": "X"}}}}}
                self.assertEqual(self.run_choice(module, ref, Path(tmp), False), [])
                self.assertNotIn("memorySearch", ref.get("agents", {}).get("defaults", {}))

    def test_new_module_ships_with_the_plugin(self):
        self.assertFalse((ROOT / "desktop/windows/mac-runtime/services/mode-architecture/setup.py").exists())
        for source in (SOURCE,):
            self.assertIn('"web-search-fallback.mjs"', source.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
