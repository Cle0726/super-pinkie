#!/usr/bin/env python3
"""检查 / 取出这次发版要给用户看的更新说明（碧琪口吻，摘要 + 细节）。

python3 tools/release/release_notes.py check [VERSION] [desktop/windows/release-notes.md]
python3 tools/release/release_notes.py body  [VERSION] [desktop/windows/release-notes.md] > release-body.md

VERSION 默认读仓库根的 VERSION。规则见 docs/RELEASE-NOTES.md。
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app"))
import release_notes  # noqa: E402


def main(argv):
    if not argv or argv[0] not in {"check", "body"}:
        print(__doc__, file=sys.stderr)
        return 2
    version = argv[1] if len(argv) > 1 else (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    path = Path(argv[2]) if len(argv) > 2 else ROOT / "desktop/windows/release-notes.md"
    text = path.read_text(encoding="utf-8-sig")
    problems = release_notes.lint(text, version)
    if problems:
        print(f"{path} 里 {version.removeprefix('v')} 的更新说明还不能发：", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    if argv[0] == "body":
        sys.stdout.write(release_notes.section_markdown(text, version))
    else:
        parts = release_notes.parse(text, version)
        print(f"{version} 的更新说明可以发：摘要 {len(parts['summary'])} 字，细节 {len(parts['details'])} 条。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
