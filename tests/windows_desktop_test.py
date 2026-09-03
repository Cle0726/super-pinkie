import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import super_pinkie


class WindowsDesktopPreservationTests(unittest.TestCase):
    def test_packaged_first_launch_keeps_existing_prompt_and_persona(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / "resources"
            home = root / "home"
            (resources / "prompts").mkdir(parents=True)
            (resources / "personas/chat").mkdir(parents=True)
            (resources / "prompts/unrestricted-prompt-gemini.txt").write_text("发行默认", encoding="utf-8")
            (resources / "personas/chat/SOUL.md").write_text("发行人格", encoding="utf-8")
            prompt_dir = home / ".openclaw"
            workspace = prompt_dir / "workspace"
            workspace.mkdir(parents=True)
            (prompt_dir / "unrestricted-prompt-gemini.txt").write_text("用户手改提示词", encoding="utf-8")
            (workspace / "SOUL.md").write_text("用户手改人格", encoding="utf-8")

            def resource_path(*parts):
                return resources.joinpath(*parts)

            with (
                mock.patch.object(super_pinkie, "resource_path", side_effect=resource_path),
                mock.patch.object(super_pinkie, "prompts_dir", return_value=prompt_dir),
                mock.patch.object(super_pinkie.Path, "home", return_value=home),
                mock.patch.object(super_pinkie.subprocess, "run", return_value=mock.Mock(stdout="[]")),
            ):
                super_pinkie.ensure_prompts(lambda _message: None, preserve_existing=True)
                super_pinkie.install_personas(lambda _message: None, preserve_existing=True)

            self.assertEqual(
                (prompt_dir / "unrestricted-prompt-gemini.txt").read_text(encoding="utf-8"),
                "用户手改提示词",
            )
            self.assertEqual((workspace / "SOUL.md").read_text(encoding="utf-8"), "用户手改人格")


if __name__ == "__main__":
    unittest.main()
