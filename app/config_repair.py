"""Bring a gateway that dies on ``Invalid config`` back without the user.

2.5.36 wrote one key that OpenClaw's strict schema rejects, and from then on the
gateway exited on every start while the window waited on 「正在启动本机网关」
for ever.  The supervisor now reads what the gateway printed and, when it says
the config is invalid, repairs it here, gentlest step first:

  a. known migrations (keys earlier versions of this App wrote);
  b. the broken subtrees (paths the gateway or ``config validate`` names) are
     put back from the last copy the gateway actually ran with;
  c. the whole file goes back to that last-good copy;
  d. only then ``openclaw doctor --fix --non-interactive``.  It also turns off
     skills and writes wizard metadata, so it must stay the last resort.

The broken file is always kept beside the original as
``openclaw.json.invalid-<time>`` before anything is written.
"""

from __future__ import annotations

import copy
import json
import os
from pathlib import Path
import re
import tempfile
import time

INVALID_MARK = "Invalid config"
LAST_GOOD_NAME = "config-last-good.json"
NOTICE = "碧琪发现设置文件有一处写错了，已经自动修好"


def invalid_config_paths(text):
    """Paths the gateway listed after ``Invalid config at …:``; None if it did not say so.

    The gateway prints::

        Gateway failed to start: Invalid config at C:\\...\\openclaw.json:
        browser.ssrfPolicy: Invalid input
        gateway: Invalid input
        Run "openclaw doctor --fix" to repair, then retry.
    """
    text = str(text or "")
    index = text.rfind(INVALID_MARK)
    if index < 0:
        return None
    paths = []
    for line in text[index:].splitlines()[1:]:
        match = re.match(r"^\s*(<root>|[A-Za-z0-9_$\-\[\]]+(?:\.[A-Za-z0-9_$\-\[\]]+)*)\s*:\s+\S", line)
        if not match:
            break
        if match.group(1) not in paths:
            paths.append(match.group(1))
    return paths


def _split(path):
    if not path or path == "<root>":
        return []
    parts = []
    for piece in str(path).split("."):
        # ``agents.list[0].model`` -> agents, list, 0, model
        for name, index in re.findall(r"([^\[\]]+)|\[(\d+)\]", piece):
            parts.append(int(index) if index else name)
    return parts


def _get(tree, parts):
    node = tree
    for part in parts:
        if isinstance(part, int) and isinstance(node, list) and part < len(node):
            node = node[part]
        elif isinstance(part, str) and isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return False, None
    return True, node


def replace_subtree(config, good, path):
    """Put ``path`` back the way ``good`` has it (or drop it when ``good`` has none)."""
    parts = _split(path)
    if not parts:
        return copy.deepcopy(good)
    found, parent = _get(config, parts[:-1])
    if not found or not isinstance(parent, (dict, list)):
        # The parent itself is what changed shape; fall back one level.
        return replace_subtree(config, good, ".".join(str(p) for p in parts[:-1]) or "<root>")
    leaf = parts[-1]
    has, value = _get(good, parts)
    if isinstance(parent, dict):
        if has:
            parent[leaf] = copy.deepcopy(value)
        else:
            parent.pop(leaf, None)
    elif isinstance(leaf, int) and leaf < len(parent):
        if has:
            parent[leaf] = copy.deepcopy(value)
        else:
            parent.pop(leaf)
    return config


def migrate(config):
    """Known fixes for keys this App itself once wrote. Returns the names applied."""
    applied = []
    browser = config.get("browser") if isinstance(config, dict) else None
    if isinstance(browser, dict):
        try:
            import browser_proxy
        except ImportError:  # imported as app.config_repair in tests
            from app import browser_proxy
        if browser_proxy.repair_policy(browser):
            applied.append("browser.ssrfPolicy.allowPrivateNetwork")
        if not browser:
            config.pop("browser")
    return applied


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".pinkie-config-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class ConfigRepair:
    """Repairs one openclaw.json.

    ``validate()`` returns ``(valid, paths)`` with ``valid`` None when the check
    itself could not run; ``doctor()`` returns True when doctor exited cleanly.
    """

    def __init__(self, config_path, state_root, validate=None, doctor=None, log=None, clock=time.time):
        self.config_path = Path(config_path)
        self.last_good = Path(state_root) / LAST_GOOD_NAME
        self.validate = validate or (lambda: (None, []))
        self.doctor = doctor or (lambda: False)
        self.log = log or (lambda message: None)
        self.clock = clock
        self._kept = None

    def save_last_good(self):
        """Called once the gateway answered HTTP: the file it loaded is good."""
        try:
            raw = self.config_path.read_bytes()
            json.loads(raw.decode("utf-8-sig") or "{}")
        except (OSError, ValueError, UnicodeError):
            return False
        try:
            if self.last_good.read_bytes() == raw:
                return True
        except OSError:
            pass
        try:
            self.last_good.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.last_good.with_name(self.last_good.name + ".tmp")
            temporary.write_bytes(raw)
            os.replace(temporary, self.last_good)
            return True
        except OSError as error:
            self.log(f"last-good config not saved: {error}")
            return False

    def _load(self, path):
        try:
            value = json.loads(Path(path).read_text(encoding="utf-8-sig") or "{}")
        except (OSError, ValueError, UnicodeError):
            return None
        return value if isinstance(value, dict) else None

    def _keep_broken(self):
        if self._kept or not self.config_path.exists():
            return self._kept
        stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(self.clock()))
        kept = self.config_path.with_name(f"{self.config_path.name}.invalid-{stamp}")
        try:
            kept.write_bytes(self.config_path.read_bytes())
            self._kept = kept
            self.log(f"config repair: kept the broken file as {kept.name}")
        except OSError as error:
            self.log(f"config repair: could not keep a copy of the broken file: {error}")
        return self._kept

    def _check(self, step):
        valid, paths = self.validate()
        if valid is None:
            self.log(f"config repair: {step} applied; validation could not run, the next start will tell")
            return True, paths
        self.log(f"config repair: {step} -> {'valid' if valid else 'still invalid at ' + ', '.join(paths or ['?'])}")
        return bool(valid), paths

    def repair(self, paths=None):
        """Returns {"repaired": bool, "step": str, "message": str}."""
        self._kept = None
        paths = list(paths or [])
        config = self._load(self.config_path)
        good = self._load(self.last_good)
        self.log(f"config repair: gateway reported invalid config at {', '.join(paths) or 'unknown paths'}")

        if config is not None:
            fixed = copy.deepcopy(config)
            applied = migrate(fixed)
            if applied:
                self._keep_broken()
                _write_json(self.config_path, fixed)
                ok, remaining = self._check("migration " + ", ".join(applied))
                if ok:
                    return {"repaired": True, "step": "migration", "message": NOTICE}
                paths = remaining or paths
                config = fixed

        if not paths:
            valid, paths = self.validate()
            if valid:
                self.log("config repair: config validates; nothing to repair")
                return {"repaired": False, "step": "none", "message": "设置文件没有发现问题"}

        if good is not None and config is not None and paths and "<root>" not in paths:
            patched = copy.deepcopy(config)
            for path in paths:
                patched = replace_subtree(patched, good, path)
            self._keep_broken()
            _write_json(self.config_path, patched)
            ok, paths = self._check("restored " + ", ".join(paths) + " from the last good copy")
            if ok:
                return {"repaired": True, "step": "subtree", "message": NOTICE}

        if good is not None:
            self._keep_broken()
            _write_json(self.config_path, good)
            ok, paths = self._check("whole file restored from the last good copy")
            if ok:
                return {"repaired": True, "step": "last-good", "message": NOTICE}

        self._keep_broken()
        self.log("config repair: running doctor --fix --non-interactive as the last resort")
        if self.doctor():
            ok, _ = self._check("doctor --fix")
            if ok:
                return {"repaired": True, "step": "doctor", "message": NOTICE + "（部分技能可能需要重新打开）"}
        self.log("config repair: gave up; the broken file is unchanged in its .invalid copy")
        return {"repaired": False, "step": "failed",
                "message": "设置文件有错误，碧琪没能自动修好。请点「打开日志文件夹」把记录发给我们。"}
