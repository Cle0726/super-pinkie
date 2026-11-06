"""Keep OpenClaw's process-wide proxy away from the local model relay.

OpenClaw turns a root ``"proxy": {"enabled": true, "proxyUrl": ...}`` in
openclaw.json into Proxyline routing for the whole gateway process: it blanks
``NO_PROXY`` and sends every HTTP request through the proxy.  Its default
``loopbackMode: "gateway-only"`` exempts only the gateway's own control plane
and the browser's CDP port -- not the model relay on 127.0.0.1:1466/1467.
Clash and similar tools refuse loopback targets, so after 碧琪 (or the user)
added that block every model failed with ``UND_ERR_SOCKET`` / "Connection
error" (11-05 on Windows: the agent wrote it itself after a failed web_fetch).

The desktop shell already handles the browser's proxy (``browser.extraArgs``,
see browser_proxy.py).  For the gateway itself the same intent is kept, but as
``HTTP_PROXY``/``HTTPS_PROXY`` environment variables, which OpenClaw honours
together with ``NO_PROXY`` -- so the internet still goes through the proxy
while loopback stays direct.  The root block is left in place with
``enabled: false`` (the key the user or agent wrote is still visible) and the
URL this module took over is recorded in the state folder.  Removing the
block, or changing its URL, ends the takeover.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile

RECORD_NAME = "gateway-proxy.json"
# Modes in which the operator explicitly asked for loopback to be proxied or
# refused. Those are deliberate choices, not the accident this module repairs.
EXPLICIT_LOOPBACK_MODES = ("proxy", "block")


def record_path(state_root):
    return Path(state_root) / RECORD_NAME


def load_record(state_root):
    try:
        value = json.loads(record_path(state_root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if isinstance(value, dict) and isinstance(value.get("proxyUrl"), str) and value["proxyUrl"]:
        return value
    return None


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".pinkie-gateway-proxy-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def takeover(config):
    """Disable an enabled root proxy in a config dict. Returns its URL or None."""
    proxy = config.get("proxy") if isinstance(config, dict) else None
    if not isinstance(proxy, dict) or proxy.get("enabled") is not True:
        return None
    if proxy.get("loopbackMode") in EXPLICIT_LOOPBACK_MODES:
        return None
    url = proxy.get("proxyUrl")
    if not isinstance(url, str) or not url.strip():
        # Without a URL OpenClaw reads OPENCLAW_PROXY_URL; nothing to carry over.
        return None
    proxy["enabled"] = False
    return url.strip()


def proxy_url(state_root, config):
    """The proxy the gateway should get as environment variables, if any."""
    record = load_record(state_root)
    if not record:
        return None
    proxy = config.get("proxy") if isinstance(config, dict) else None
    if not isinstance(proxy, dict) or proxy.get("enabled") is not False:
        return None
    if str(proxy.get("proxyUrl") or "").strip() != record["proxyUrl"]:
        return None
    return record["proxyUrl"]


def _read(config_path):
    path = Path(config_path)
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return b"", {}
    config = json.loads(raw.decode("utf-8-sig") or "{}")
    return raw, config if isinstance(config, dict) else {}


def repair(config_path, state_root, log=None):
    """Take over an enabled root proxy. Returns the URL now handled, or None.

    Never raises: an unreadable or concurrently changed file is left alone
    and the next check tries again.
    """
    log = log or (lambda message: None)
    config_path = Path(config_path)
    try:
        raw, config = _read(config_path)
        url = takeover(config)
        if url is None:
            stored = load_record(state_root)
            if stored and proxy_url(state_root, config) is None:
                # The block was removed or now names another proxy.
                try:
                    record_path(state_root).unlink()
                except OSError:
                    pass
                log("gateway proxy: openclaw.json no longer names the proxy that was taken over; record removed")
            return None
        if config_path.read_bytes() != raw:
            log("gateway proxy: openclaw.json changed while it was read; will check again")
            return None
        _write_json(record_path(state_root), {"proxyUrl": url})
        _write_json(config_path, config)
        log(f"gateway proxy: root proxy {url} disabled in openclaw.json; the gateway gets it as "
            "HTTP(S)_PROXY with loopback exempt, so the local model relay stays direct")
        return url
    except (OSError, ValueError, UnicodeError) as error:
        log(f"gateway proxy: check skipped: {error}")
        return None


def apply_environment(environment, url):
    """Route the gateway's internet traffic through ``url``; keep loopback direct."""
    if not url:
        return environment
    for key in ("HTTP_PROXY", "HTTPS_PROXY"):
        if not environment.get(key):
            environment[key] = url
    entries = [entry for entry in str(environment.get("NO_PROXY", "")).replace(" ", ",").split(",") if entry]
    for host in ("localhost", "127.0.0.1", "::1"):
        if host not in (entry.lower() for entry in entries):
            entries.append(host)
    environment["NO_PROXY"] = ",".join(entries)
    return environment
