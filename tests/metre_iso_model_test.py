"""隔离碧琪（tools/metre/iso）默认模型：用户 11-24 决定 hy4free 不可用，改用 hy4flash（免费）；不设后备。

免费档在号池里的模型名是 workbuddy/hy4flash-free（workbuddy/hy4flash 是付费档，见 metre_model_filter_test.py）。
"""
import ast
from pathlib import Path
import re
import unittest

ISO = Path(__file__).resolve().parents[1] / "tools/metre/iso"
FREE = "mm/workbuddy/hy4flash-free"


class MetreIsoModelTests(unittest.TestCase):
    def test_setup_uses_free_hy4flash_without_fallbacks(self):
        source = (ISO / "setup.py").read_text(encoding="utf-8")
        visions = [node for node in ast.walk(ast.parse(source))
                   if isinstance(node, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == "vision" for t in node.targets)]
        self.assertEqual(len(visions), 1)
        self.assertEqual(ast.literal_eval(visions[0].value), {"primary": FREE, "fallbacks": []})
        for key in ("model", "imageModel", "pdfModel"):
            self.assertIn(f"config['agents']['defaults']['{key}'] = dict(vision)", source)
        self.assertIn("用户 11-24：hy4free 不可用，改用 hy4flash（免费）；不设后备", source)
        self.assertNotIn("'mm/workbuddy/hy4free'", source)

    def test_ask_defaults_to_same_model(self):
        source = (ISO / "ask.py").read_text(encoding="utf-8")
        self.assertRegex(source, re.escape(f"os.environ.get('METRE_ISO_MODEL', '{FREE}')"))


if __name__ == "__main__":
    unittest.main()
