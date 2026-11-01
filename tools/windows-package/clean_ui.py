"""Keep the Windows package's shared UI free of the separate C.le. stage."""

import argparse
import re
from pathlib import Path


STAGE_FILES = (
    "laolao-cle-stage.css",
    "laolao-cle-stage.js",
    "laolao-cle-space.js",
    "laolao-cle-signature.js",
    "laolao-cle-mark.svg",
)
STAGE_TAG = re.compile(
    r"(?im)^[ \t]*<(?:script|link)\b(?=[^>]*laolao-cle-(?:stage|signature)\.(?:js|css))[^>]*>(?:</script>)?[ \t]*(?:\r?\n)?"
)
INSTALLER_TAG = re.compile(
    r"(?im)^[ \t]*['\"]<(?:script|link)\b[^\n]*laolao-cle-(?:stage|signature)\.(?:js|css)[^\n]*\r?\n"
)


def rewrite(path, transform):
    # Keep line endings byte for byte. Text mode on Windows turns LF into CRLF,
    # and the gateway hashes index.html's inline scripts with the CR while the
    # browser hashes them without it, so the CSP then blocks both scripts.
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw[3:].decode("utf-8") if bom else raw.decode("utf-8")
    # PowerShell 5 requires the BOM on a script containing Chinese.
    keep_bom = bom or path.suffix.lower() == ".ps1"
    path.write_bytes((b"\xef\xbb\xbf" if keep_bom else b"") + transform(text).encode("utf-8"))


def clean(ui, control_ui, installer):
    ui, control_ui, installer = Path(ui), Path(control_ui), Path(installer)
    for directory in (ui / "injections", control_ui):
        for name in STAGE_FILES:
            (directory / name).unlink(missing_ok=True)
        css = directory / "laolao-workbench.css"
        rewrite(css, lambda text: text.replace('url("./laolao-cle-mark.svg")', 'url("./ProviderIcon-crossmodel.svg")'))
        rewrite(directory / "laolao-context-compact.js", lambda text: text.replace('icon.textContent = "C.le.";', 'icon.textContent = "碧琪";'))
        rewrite(directory / "laolao-usage-stats.js", lambda text: text.replace("C.le 本地统计", "碧琪本地统计"))
    for icon in (ui / "assets/CLeAppIcon.icns", control_ui / "CLeAppIcon.icns"):
        icon.unlink(missing_ok=True)
    for document in (ui / "injections/laolao-head.fragment.html", control_ui / "index.html"):
        rewrite(document, lambda text: STAGE_TAG.sub("", text))
        if STAGE_TAG.search(document.read_bytes().decode("utf-8-sig")):
            raise ValueError(f"separate product stage still referenced in {document}")
    rewrite(installer / "apply-theme.ps1", lambda text: INSTALLER_TAG.sub("", text))
    # The frontend treats JSON null just like an absent legacy file. Supplying
    # it prevents repeated 404 errors without inventing usage or quota data.
    for name in ("laolao-stats.json", "laolao-quota.json"):
        target = control_ui / name
        if not target.exists():
            target.write_bytes(b"null\n")


def check_inline_scripts(index):
    # The browser normalizes CRLF before hashing an inline script, the gateway
    # does not; any CR inside one makes the CSP block it.
    text = Path(index).read_bytes().decode("utf-8-sig")
    for match in re.finditer(r"<script(?:\s[^>]*)?>([\s\S]*?)</script>", text, re.I):
        if "\r" in match.group(1):
            raise ValueError(f"inline script with CRLF line endings in {index}; the CSP would block it")


def check_package(root):
    root = Path(root)
    blocked = set(STAGE_FILES) | {"CLeAppIcon.icns"}
    if not (root / "_internal/installer/windows/apply-theme.ps1").is_file():
        raise ValueError("the packaged Windows installer is missing")
    for index in root.rglob("control-ui/index.html"):
        check_inline_scripts(index)
    for file in root.rglob("*"):
        parts = [part.lower() for part in file.relative_to(root).parts]
        if file.name in blocked or any(parts[i:i + 2] in (["installer", "cle"], ["services", "cle-studio"]) for i in range(len(parts) - 1)):
            raise ValueError(f"separate product asset in Windows package: {file.relative_to(root)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ui")
    parser.add_argument("--control-ui")
    parser.add_argument("--installer")
    parser.add_argument("--check-package")
    args = parser.parse_args()
    if args.check_package:
        check_package(args.check_package)
    elif args.ui and args.control_ui and args.installer:
        clean(args.ui, args.control_ui, args.installer)
    else:
        parser.error("supply --check-package, or --ui, --control-ui and --installer")
