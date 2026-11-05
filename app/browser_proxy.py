"""Proxy for the browser 碧琪 controls (OpenClaw's `browser` tool) on Windows.

OpenClaw starts Edge with ``--no-proxy-server`` unless ``browser.extraArgs``
already carries a proxy flag, so the browser ignored a VPN / proxy the user
had switched on and blocked sites never loaded. The user picks one of:

* ``system`` (default) -- follow the Windows proxy setting (Clash, v2rayN and
  similar tools write it), read again at every App start and on save;
* ``custom`` -- the user's own proxy, e.g. ``127.0.0.1:7890`` or
  ``socks5://127.0.0.1:7891``;
* ``off`` -- connect directly.

Only the arguments this module wrote are ever removed again (recorded in the
settings file), so hand-written ``extraArgs`` survive. A proxied browser
cannot keep OpenClaw's DNS-based private-network check, and OpenClaw then
refuses every navigation; while a proxy is applied the browser profile is
therefore marked ``allowPrivateNetwork`` -- unless the user set that policy
themselves -- and the mark is removed with the proxy.
"""

import json
import os
import re
import tempfile
from pathlib import Path

MODES = ("system", "custom", "off")
PROXY_FLAGS = ("--proxy-server", "--proxy-pac-url", "--proxy-auto-detect", "--proxy-bypass-list", "--no-proxy-server")
_HOST_PORT = re.compile(r"^(?:(?P<scheme>https?|socks4|socks5)://)?(?P<host>\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):(?P<port>\d{1,5})/?$")
_INTERNET_SETTINGS = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"


def normalize_custom(value):
    """Return a Chrome ``--proxy-server`` value, or raise ValueError in Chinese."""
    text = str(value or "").strip()
    if not text:
        raise ValueError("请填写代理地址，例如 127.0.0.1:7890")
    if "@" in text:
        raise ValueError("浏览器代理不支持用户名和密码，请在代理软件里开一个本机端口再填这里")
    match = _HOST_PORT.match(text)
    if not match or not 0 < int(match["port"]) < 65536:
        raise ValueError("代理地址格式不对，请写成 主机:端口，例如 127.0.0.1:7890 或 socks5://127.0.0.1:7891")
    scheme = match["scheme"] or "http"
    return f"{scheme}://{match['host']}:{int(match['port'])}"


def system_proxy(reader=None):
    """Read the current user's Windows proxy setting.

    Returns ``{"server": ..., "bypass": ...}``, ``{"pac": url}`` or ``None``.
    """
    try:
        values = reader() if reader else _read_registry()
    except OSError:
        return None
    pac = str(values.get("AutoConfigURL") or "").strip()
    if pac:
        return {"pac": pac}
    if not values.get("ProxyEnable"):
        return None
    server = str(values.get("ProxyServer") or "").strip()
    if not server or any(ch.isspace() for ch in server):
        return None
    bypass = [item.strip() for item in str(values.get("ProxyOverride") or "").split(";") if item.strip()]
    return {"server": server, "bypass": ";".join(bypass)}


def _read_registry():
    import winreg  # Windows only; callers on other systems pass a reader.

    values = {}
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _INTERNET_SETTINGS) as key:
        for name in ("ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL"):
            try:
                values[name] = winreg.QueryValueEx(key, name)[0]
            except OSError:
                pass
    return values


def wanted_args(setting, reader=None):
    """Chrome arguments for a setting, plus a short Chinese description."""
    mode = setting.get("mode") if setting.get("mode") in MODES else "system"
    if mode == "off":
        return [], "不使用代理，直接连接"
    if mode == "custom":
        server = normalize_custom(setting.get("server"))
        return [f"--proxy-server={server}"], f"使用自定义代理 {server}"
    found = system_proxy(reader)
    if not found:
        return [], "跟随系统：系统现在没有开代理，直接连接"
    if found.get("pac"):
        return [f"--proxy-pac-url={found['pac']}"], "跟随系统：使用系统的自动代理脚本"
    args = [f"--proxy-server={found['server']}"]
    if found.get("bypass"):
        args.append(f"--proxy-bypass-list={found['bypass']}")
    return args, f"跟随系统：使用系统代理 {found['server']}"


def _flag(arg):
    return str(arg).split("=", 1)[0].strip().lower()


def apply_to_config(config, setting, reader=None):
    """Update an openclaw.json dict in place. Returns (setting, description)."""
    setting = dict(setting or {})
    applied = setting.get("applied") if isinstance(setting.get("applied"), dict) else {}
    browser = config.setdefault("browser", {})
    if not isinstance(browser, dict):
        raise ValueError("openclaw.json 的 browser 设置不是对象")
    current = [arg for arg in browser.get("extraArgs") or [] if isinstance(arg, str)]
    owned = set(applied.get("args") or [])
    if any(_flag(arg) in PROXY_FLAGS and arg not in owned for arg in current):
        # The user wrote their own proxy flags into openclaw.json; leave them be.
        return setting, "openclaw.json 里已经手动写了浏览器代理参数，碧琪没有改动"
    args, description = wanted_args(setting, reader)
    kept = [arg for arg in current if arg not in owned]
    browser["extraArgs"] = kept + args
    if not browser["extraArgs"]:
        browser.pop("extraArgs")

    policy = browser.get("ssrfPolicy") if isinstance(browser.get("ssrfPolicy"), dict) else None
    if applied.get("allowPrivate") and policy and policy.get("allowPrivateNetwork") is True:
        policy.pop("allowPrivateNetwork")
        if not policy:
            browser.pop("ssrfPolicy")
            policy = None
    marked = False
    routed = any(_flag(arg) in ("--proxy-server", "--proxy-pac-url", "--proxy-auto-detect") for arg in args)
    if routed:
        policy = browser.setdefault("ssrfPolicy", {})
        if "allowPrivateNetwork" not in policy and "dangerouslyAllowPrivateNetwork" not in policy:
            policy["allowPrivateNetwork"] = True
            marked = True
    if not browser:
        config.pop("browser")
    setting["applied"] = {"args": args, "allowPrivate": marked}
    return setting, description


def settings_path(state_root):
    return Path(state_root) / "browser-proxy.json"


def load_setting(state_root):
    try:
        data = json.loads(settings_path(state_root).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"mode": "system"}
    except (OSError, ValueError):
        return {"mode": "system"}


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".pinkie-proxy-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply(config_path, state_root, setting=None, reader=None):
    """Apply (and with ``setting`` also save) the browser proxy. Returns a status dict."""
    config_path = Path(config_path)
    stored = load_setting(state_root)
    if setting is not None:
        mode = setting.get("mode")
        if mode not in MODES:
            raise ValueError("不认识的代理方式")
        next_setting = {"mode": mode, "server": str(setting.get("server") or "").strip(), "applied": stored.get("applied")}
        if mode == "custom":
            next_setting["server"] = normalize_custom(next_setting["server"])
    else:
        next_setting = stored
    raw = config_path.read_bytes() if config_path.exists() else b"{}"
    config = json.loads(raw.decode("utf-8") or "{}")
    before = json.dumps(config, sort_keys=True)
    next_setting, description = apply_to_config(config, next_setting, reader)
    if json.dumps(config, sort_keys=True) != before:
        if (config_path.read_bytes() if config_path.exists() else b"{}") != raw:
            raise OSError("openclaw.json 正在被改动，请稍后再试")
        _write_json(config_path, config)
    _write_json(settings_path(state_root), next_setting)
    return status(next_setting, description, reader)


def status(setting, description="", reader=None):
    found = system_proxy(reader)
    system = "没有开代理"
    if found:
        system = "自动代理脚本" if found.get("pac") else found["server"]
    return {
        "mode": setting.get("mode") if setting.get("mode") in MODES else "system",
        "server": setting.get("server") or "",
        "effective": description,
        "system": system,
    }
