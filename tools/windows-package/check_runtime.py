"""Checks that the Windows package carries every file 碧琪's runtime needs.

Two ways this broke before, each time silently:

* The mode plugin's setup.py copies an explicit file list into the user's
  extensions folder.  A module that index.mjs imports but the list forgets
  (workbench.mjs, vendor/) makes the whole plugin fail to load on a new
  install, and with it the upstream watchdog that continues broken turns.
* The patched OpenClaw files come from the Mac runtime snapshot.  Any later
  build step that rewrites one of them drops a patch without an error.

  python tools/windows-package/check_runtime.py            # source check
  python tools/windows-package/check_runtime.py --package dist/超級碧琪
"""

import argparse
import hashlib
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "services/mode-architecture"
SNAPSHOT = ROOT / "desktop/windows/mac-runtime"
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)['"](\.{1,2}/[^'"]+)['"]""")


def plugin_source(name):
    """build-win.ps1 lays the snapshot over the repository's service."""
    overlay = SNAPSHOT / "services/mode-architecture" / name
    return overlay if overlay.exists() else SERVICE / name


def setup_copy_list():
    text = plugin_source("setup.py").read_text(encoding="utf-8")
    start = text.index('"index.mjs"')
    block = text[start:text.index(")", start)]
    return set(re.findall(r'"([^"]+)"', block))


def plugin_imports():
    needed, todo = set(), ["index.mjs"]
    while todo:
        name = todo.pop()
        if name in needed:
            continue
        needed.add(name)
        path = plugin_source(name)
        if not path.is_file() or path.suffix not in (".mjs", ".js"):
            continue
        for relative in IMPORT.findall(path.read_text(encoding="utf-8", errors="replace")):
            todo.append(os.path.normpath(str(Path(name).parent / relative)).replace("\\", "/"))
    return needed


def source_problems():
    problems = []
    listed = setup_copy_list()
    for name in sorted(plugin_imports()):
        if not plugin_source(name).exists():
            problems.append(f"mode plugin imports {name}, which does not exist")
        elif not name.startswith("vendor/") and name not in listed:
            problems.append(f"mode plugin imports {name}, but setup.py does not install it")
    return problems


def snapshot_hashes():
    for line in (SNAPSHOT / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        if line.strip():
            digest, relative = line.split("  ", 1)
            yield digest.lower(), relative.strip()


def package_problems(package):
    package = Path(package)
    roots = [p.parent for p in package.rglob("node_modules/openclaw/openclaw.mjs")]
    if not roots:
        return [f"no bundled OpenClaw under {package}"]
    openclaw = roots[0]
    ai_dirs = [p for p in package.rglob("@openclaw/ai/dist") if p.is_dir()]
    services = [p.parent for p in package.rglob("mode-architecture/setup.py") if "bundled" in str(p) or "services" in str(p)]
    problems = []
    for digest, relative in snapshot_hashes():
        if relative.startswith("openclaw/"):
            targets = [openclaw / relative[len("openclaw/"):]]
        elif relative.startswith("ai/"):
            targets = [d / Path(relative).name for d in ai_dirs]
        elif relative.startswith("services/"):
            targets = [s.parent / relative[len("services/"):] for s in services[:1]]
        else:
            continue
        # The skin and the CSP clean-up rewrite the page entry on purpose.
        if relative.endswith(("control-ui/index.html", "control-ui/sw.js")):
            continue
        if not targets:
            problems.append(f"nowhere to find {relative} in the package")
        for target in targets:
            if not target.is_file():
                problems.append(f"package is missing {relative}")
            elif hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                problems.append(f"package changed {relative} after the snapshot was applied")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--package")
    args = parser.parse_args(argv)
    problems = source_problems()
    if args.package:
        problems += package_problems(args.package)
    for problem in problems:
        print(problem)
    print("runtime files ok" if not problems else f"{len(problems)} runtime file problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
