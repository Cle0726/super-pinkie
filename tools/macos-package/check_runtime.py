"""Check the Mac bundle can install and import its mode plugin on a fresh profile."""

import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def check(resource_root, node):
    root = Path(resource_root).resolve()
    setup = root / "services/mode-architecture/setup.py"
    if not setup.is_file():
        raise RuntimeError(f"Mac bundle is missing mode setup: {setup}")

    with tempfile.TemporaryDirectory(prefix="pinkie-mac-package-check-") as temporary:
        home = Path(temporary) / "home"
        config = home / ".openclaw/openclaw.json"
        config.parent.mkdir(parents=True)
        config.write_text("{}\n", encoding="utf-8")
        env = os.environ.copy()
        env["HOME"] = str(home)
        env["PINKIE_STATE_ROOT"] = str(Path(temporary) / "state")
        # A source-style test tree has no bundled Node; never fall back to the
        # user's installed App while exercising its setup helper.
        env["PINKIE_APP_PATH"] = str(Path(temporary) / "no-installed-app")
        install = (
            "import importlib.util,sys; "
            "s=importlib.util.spec_from_file_location('pinkie_staged_setup',sys.argv[1]); "
            "m=importlib.util.module_from_spec(s); s.loader.exec_module(m); "
            "m.install(sys.argv[2])"
        )
        result = subprocess.run([sys.executable, "-c", install, str(setup), str(home)],
                                env=env, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError("Mac bundle could not install its mode plugin:\n" + result.stderr[-3000:])
        installed = home / ".openclaw/extensions/pinkie-mode-architecture/index.mjs"
        if not installed.is_file():
            raise RuntimeError("Mac bundle did not install the mode plugin")
        command = 'import {pathToFileURL} from "node:url"; await import(pathToFileURL(process.argv[1]));'
        result = subprocess.run([str(node), "--input-type=module", "-e", command, str(installed)],
                                env=env, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError("Mac installed mode plugin cannot load its dependencies:\n" + result.stderr[-3000:])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resource-root", required=True)
    parser.add_argument("--node", required=True)
    args = parser.parse_args()
    try:
        check(args.resource_root, args.node)
    except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(error, file=sys.stderr)
        return 1
    print("Mac mode plugin fresh-install import OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
