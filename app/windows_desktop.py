"""Self-contained Windows desktop shell for the bundled Super Pinkie runtime."""

from __future__ import annotations

import base64
import atexit
import importlib.util
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser

import release_notes


GATEWAY_URL = "http://127.0.0.1:18789/"
GATEWAY_CHAT_URL = urllib.parse.urljoin(GATEWAY_URL, "chat")
PARTY_URL = "http://127.0.0.1:18889/"
ROUNDTABLE_URL = "http://127.0.0.1:18891/"
TTS_URL = "http://127.0.0.1:18888/health"
# The injection relay reports this name on /health. Port 1467 is a shared
# convention: the user may run their own retry proxy there, and it answers
# {"ok": true} just like ours does, so identity is what separates the two.
RELAY_SERVICE = "super-pinkie-relay"
UPDATE_API_URL = "https://api.github.com/repos/Cle0726/super-pinkie/releases/latest"
UPDATE_ASSET_PREFIX = "super-pinkie-windows-"
TRUSTED_UPDATE_HOSTS = {
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}
UPDATE_RELEASES_URL = "https://github.com/Cle0726/super-pinkie/releases"
# 国内线路：每个版本都附一份 latest.json（版本、说明、每个文件的 SHA-256 和大小），
# 经 GitHub 加速代理或国内存储桶读它，再从同一条线路下载安装包。
UPDATE_MANIFEST_NAME = "latest.json"
DEFAULT_UPDATE_PROXIES = ("https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/")
# Only this configured proxy was verified to carry GitHub's public release API.
# Do not spray API requests at other hosts or silently invent a release version.
UPDATE_RELEASE_API_PROXY_HOSTS = frozenset({"gh-proxy.com"})


DEFAULT_APP_DOCUMENT_EXTENSIONS = frozenset({
    "pdf", "txt", "md", "markdown", "rtf", "csv", "tsv", "json", "log",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub",
    "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "tif", "tiff", "bmp", "svg", "psd", "ai",
    "mp4", "mov", "m4v", "webm", "mkv", "avi", "mp3", "m4a", "wav", "aac", "flac",
    "srt", "ass", "vtt", "zip",
})


def version_tuple(value):
    """Return a stable four-part key for the release versions used by this app."""
    match = re.fullmatch(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?", str(value).strip())
    if not match:
        raise ValueError("invalid release version")
    return tuple(int(part or 0) for part in match.groups())


def trusted_update_url(value, hosts=TRUSTED_UPDATE_HOSTS):
    parsed = urllib.parse.urlparse(str(value))
    return parsed.scheme == "https" and parsed.hostname in hosts


def _mirror_base(value):
    value = str(value or "").strip()
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.query or parsed.fragment:
        return ""
    return value if value.endswith("/") else value + "/"


def update_mirrors(resource_root):
    """国内线路的候选，按顺序试：先国内存储桶（发版时配置了才有），再 GitHub 加速代理。

    `update-mirrors.json` 由发版流程写进包里：{"bucket": "https://…/super-pinkie/", "proxies": [...]}。
    文件不存在或写错时只用内置的加速代理。
    """
    settings = {}
    try:
        settings = json.loads((Path(resource_root) / "update-mirrors.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    routes = []
    bucket = _mirror_base(settings.get("bucket"))
    if bucket:
        routes.append({"label": "国内服务器", "manifest": bucket + UPDATE_MANIFEST_NAME,
                       "asset": lambda version, name, base=bucket: f"{base}v{version}/{name}"})
    proxies = settings.get("proxies")
    proxies = proxies if isinstance(proxies, list) and proxies else list(DEFAULT_UPDATE_PROXIES)
    for proxy in proxies:
        base = _mirror_base(proxy)
        if not base:
            continue
        route = {"label": "国内加速", "manifest": f"{base}{UPDATE_RELEASES_URL}/latest/download/{UPDATE_MANIFEST_NAME}",
                 "asset": lambda version, name, base=base: f"{base}{UPDATE_RELEASES_URL}/download/v{version}/{name}"}
        if urllib.parse.urlparse(base).hostname.lower() in UPDATE_RELEASE_API_PROXY_HOSTS:
            route["release_api"] = base + UPDATE_API_URL
        routes.append(route)
    return routes


def release_notes_parts(body, version=None):
    """碧琪口吻的摘要 + 细节（格式见 app/release_notes.py）。"""
    parts = release_notes.parse(body, version)
    summary = parts["summary"][:300]
    details, used = [], len(summary)
    for item in parts["details"][:12]:
        used += len(item)
        if used > 1600:
            break
        details.append(item[:240])
    return {"summary": summary, "details": details}


def release_notes_text(body, version=None):
    """Plain lines (summary first) for older dialogs and the update log."""
    return release_notes.as_text(release_notes_parts(body, version))


def bundled_release_notes(resource_root, version=None):
    try:
        text = (Path(resource_root) / "release-notes.md").read_text(encoding="utf-8-sig")
    except OSError:
        return {"summary": "", "details": []}
    return release_notes_parts(text, version)


def release_update(release, current_version, portable=False):
    """Validate latest-release metadata and select the matching package."""
    if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
        return None
    version = str(release.get("tag_name", "")).strip().removeprefix("v")
    if version_tuple(version) <= version_tuple(current_version):
        return None
    suffix = "-portable.zip" if portable else ".exe"
    expected_name = f"{UPDATE_ASSET_PREFIX}{version}{suffix}"
    checksum_name = expected_name + ".sha256"
    assets = {
        str(asset.get("name", "")): str(asset.get("browser_download_url", ""))
        for asset in release.get("assets", []) if isinstance(asset, dict)
    }
    executable_url = assets.get(expected_name, "")
    checksum_url = assets.get(checksum_name, "")
    if not trusted_update_url(executable_url) or not trusted_update_url(checksum_url):
        return None
    return {
        "available": True,
        "version": version,
        "name": expected_name,
        "executableUrl": executable_url,
        "portable": portable,
        "checksumUrl": checksum_url,
        "releaseUrl": str(release.get("html_url", "")),
        "notes": release_notes_text(release.get("body")),
        **release_notes_parts(release.get("body")),
    }


def manifest_update(manifest, current_version, asset_url, portable=False):
    """读国内线路上的 latest.json，挑出和本机安装方式对应的包。"""
    if not isinstance(manifest, dict):
        return None
    version = str(manifest.get("version", "")).strip().removeprefix("v")
    if version_tuple(version) <= version_tuple(current_version):
        return None
    suffix = "-portable.zip" if portable else ".exe"
    expected_name = f"{UPDATE_ASSET_PREFIX}{version}{suffix}"
    assets = manifest.get("assets") if isinstance(manifest.get("assets"), dict) else {}
    entry = assets.get(expected_name) if isinstance(assets.get(expected_name), dict) else {}
    digest = str(entry.get("sha256", "")).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        return None
    official = f"{UPDATE_RELEASES_URL}/download/v{version}/{expected_name}"
    return {
        "available": True,
        "version": version,
        "name": expected_name,
        "executableUrl": asset_url(version, expected_name),
        "portable": portable,
        # 优先用 GitHub 官方的校验和（连得上的话）；连不上才用这份清单里的。
        "checksumUrl": official + ".sha256",
        "sha256": digest,
        "releaseUrl": f"{UPDATE_RELEASES_URL}/tag/v{version}",
        "notes": release_notes_text(manifest.get("notes")),
        **release_notes_parts(manifest.get("notes")),
    }


def mirrored_release_update(release, current_version, asset_url, portable=False):
    """Fallback for older releases that predate latest.json, with the same SHA-256 gate."""
    if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
        raise ValueError("invalid latest release metadata")
    version = str(release.get("tag_name", "")).strip().removeprefix("v")
    if version_tuple(version) <= version_tuple(current_version):
        return None
    selected = release_update(release, current_version, portable=portable)
    if not selected:
        raise ValueError("new release has no matching package and checksum")
    official = f"{UPDATE_RELEASES_URL}/download/v{version}/{selected['name']}"
    if selected["executableUrl"] != official or selected["checksumUrl"] != official + ".sha256":
        raise ValueError("release assets are not from the expected repository and tag")
    selected["executableUrl"] = asset_url(version, selected["name"])
    selected["metadataSource"] = "release-api"
    entry = next((item for item in release.get("assets", [])
                  if isinstance(item, dict) and item.get("name") == selected["name"]), {})
    digest = entry.get("digest")
    if digest:
        match = re.fullmatch(r"sha256:([a-fA-F0-9]{64})", str(digest))
        if not match:
            raise ValueError("invalid release asset digest")
        selected["sha256"] = match.group(1).lower()
    return selected


GUARD_UPDATE_REFUSED = "更新包的签名不对，没有安装，旧版没有改动。"


def guard_release_build(resource_root):
    """现装 App 是不是正式版（设定防护开）：只认包里写死的 build-info.json，不看环境变量。"""
    try:
        return json.loads((Path(resource_root) / "build-info.json").read_text(encoding="utf-8-sig")).get("guard") is True
    except (OSError, ValueError, AttributeError):
        return False


def verify_signed_latest(resource_root, latest, asset, sha256, public_key=None):
    """用包里自带的 node 跑 guard.mjs verify-latest：latest.json 的发布签名对、
    要装的文件名和 SHA-256 在签名覆盖的安装包清单里。公钥写死在 guard.mjs（public_key 只给测试）。"""
    root = Path(resource_root)
    node, guard = root / "runtime" / "bin" / "node.exe", root / "installer" / "guard" / "guard.mjs"
    if not node.is_file():
        node = Path(shutil.which("node") or "")
    if not guard.is_file() or not node.name or not isinstance(latest, dict):
        return False
    fd, temporary = tempfile.mkstemp(prefix="latest-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(latest, handle, ensure_ascii=False)
        command = [str(node), str(guard), "verify-latest", temporary, "--asset", str(asset), "--sha256", str(sha256)]
        if public_key:
            command += ["--public-key", public_key]
        kwargs = {"creationflags": 0x08000000} if os.name == "nt" else {}
        return subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, **kwargs).returncode == 0
    except Exception:
        return False
    finally:
        try:
            os.unlink(temporary)
        except OSError:
            pass


GUARD_PUBLIC_KEY = "MCowBQYDK2VwAyEAcejSsqLWnO2o0lFTrm+Lh22s8Qi5XSfTGX4GnQTgnOs="
GUARD_STRIKE_LIMIT = 3


def guard_bundle_identity(resource_root):
    root = Path(resource_root)
    info = {}
    try:
        info = json.loads((root / "build-info.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        info = {}
    manifest = {}
    manifest_sha = ""
    manifest_file = root / "guard-manifest.json"
    if manifest_file.is_file():
        try:
            raw = manifest_file.read_bytes()
            manifest_sha = hashlib.sha256(raw).hexdigest()
            manifest = json.loads(raw.decode("utf-8"))
        except (OSError, ValueError):
            manifest = {}
    return {
        "channel": str(info.get("channel") or "release"),
        "version": str(info.get("version") or manifest.get("version") or ""),
        "commit": str(manifest.get("commit") or info.get("commit") or ""),
        "manifestSha": manifest_sha,
    }


def _guard_receipt_matches(record, version="", commit="", manifest_sha=""):
    if not isinstance(record, dict):
        return False
    if str(record.get("version") or "") != str(version or ""):
        return False
    rec_commit = str(record.get("commit") or "")
    if commit and rec_commit and rec_commit != commit:
        return False
    rec_sha = str(record.get("manifestSha") or "")
    if manifest_sha and rec_sha and rec_sha != manifest_sha:
        return False
    return True


def has_guard_receipt(app_state, openclaw_state=None, version="", commit="", manifest_sha=""):
    app_dir = Path(app_state)
    status_file = app_dir / "guard" / "status.json"
    try:
        status = json.loads(status_file.read_text(encoding="utf-8-sig"))
        if int(status.get("counterSchema") or 0) >= 1 and _guard_receipt_matches(status, version, commit, manifest_sha):
            return True
    except (OSError, ValueError, TypeError):
        pass
    oc_dir = Path(openclaw_state) if openclaw_state else openclaw_config_path().parent
    receipt_file = oc_dir / "guard-receipt.json"
    try:
        receipt = json.loads(receipt_file.read_text(encoding="utf-8-sig"))
        if int(receipt.get("schema") or 0) >= 1 and _guard_receipt_matches(receipt, version, commit, manifest_sha):
            return True
    except (OSError, ValueError, TypeError):
        pass
    for plugin in ("pinkie-mode-architecture", "pinkie-project-scope", "pinkie-first-person-renderer"):
        mark = oc_dir / "extensions" / plugin / "guard-build.json"
        try:
            obj = json.loads(mark.read_text(encoding="utf-8-sig"))
            if obj.get("counterReady") is True and _guard_receipt_matches(obj, version, commit, manifest_sha):
                return True
        except (OSError, ValueError):
            pass
    return False


def verify_guard_counter(resource_root, app_state, key=GUARD_PUBLIC_KEY):
    identity = guard_bundle_identity(resource_root)
    counter_file = Path(app_state) / "guard" / "counter.json"
    raw_text = None
    for attempt in range(3):
        try:
            raw_text = counter_file.read_text(encoding="utf-8-sig")
            break
        except PermissionError:
            if attempt == 2:
                return False
            time.sleep(0.05 * (attempt + 1))
        except OSError:
            return False
    if raw_text is None:
        return False
    try:
        obj = json.loads(raw_text)
    except ValueError:
        return False
    if not isinstance(obj, dict) or obj.get("schema") != 1 or not isinstance(obj.get("events"), list):
        return False
    for field in ("channel", "version", "commit", "manifestSha"):
        if str(obj.get(field) or "") != identity[field]:
            return False
    updated_at = obj.get("updatedAt")
    mac = obj.get("mac")
    chain_mac = obj.get("chainMac")
    if not isinstance(updated_at, str) or not isinstance(mac, str) or not isinstance(chain_mac, str):
        return False
    locked = "1" if obj.get("tamperLocked") is True else "0"
    events = ",".join(str(x) for x in obj["events"])
    payload = f"1|{identity['channel']}|{identity['version']}|{identity['commit']}|{identity['manifestSha']}|{events}|{locked}|{updated_at}".encode("utf-8")
    bundle_key = hashlib.sha256(
        f"pinkie-guard-counter-v1|{key}|{identity['channel']}|{identity['version']}|{identity['commit']}|{identity['manifestSha']}".encode("utf-8")
    ).digest()
    chain_key = hashlib.sha256(
        f"pinkie-guard-chain-v1|{key}|{identity['channel']}".encode("utf-8")
    ).digest()
    expected_mac = hmac.new(bundle_key, payload, hashlib.sha256).hexdigest()
    expected_chain = hmac.new(chain_key, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac.lower(), expected_mac) and hmac.compare_digest(chain_mac.lower(), expected_chain)


def lock_tampered_guard_counter(resource_root, app_state):
    root = Path(resource_root)
    node = root / "runtime" / "bin" / ("node.exe" if os.name == "nt" else "node")
    if not node.is_file():
        which_node = shutil.which("node")
        if which_node:
            node = Path(which_node)
    guard = root / "installer" / "guard" / "guard.mjs"
    if not node.is_file() or not guard.is_file():
        return False
    kwargs = hidden_process_kwargs() if os.name == "nt" else {}
    try:
        return subprocess.run(
            [str(node), str(guard), "lock-tampered", "--bundle", str(root), "--app-state", str(app_state)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, **kwargs,
        ).returncode == 0
    except Exception:
        return False


def format_guard_alert(payload):
    counter_tampered = payload.get("counterTampered") is True
    limit_reached = payload.get("limitReached") is True
    restore_failed = payload.get("restoreFailed") is True
    non_official = payload.get("nonOfficial") is True
    categories = [str(c) for c in (payload.get("categories") or []) if str(c).strip()]
    cat_text = "、".join(categories) if categories else "产品设定"
    backup = str(payload.get("backup") or "")
    count = int(payload.get("count") or GUARD_STRIKE_LIMIT)
    limit = int(payload.get("limit") or GUARD_STRIKE_LIMIT)

    if counter_tampered:
        title = "保护记录文件被删除或改动，应用即将退出"
        body = (
            "正式版的设定保护记录不完整或被修改，按保护规则这次会先退出应用。\n\n"
            "下次可以正常打开，并会先检查恢复官方设定；24 小时内再改动仍会直接退出。你的记忆和设置都还在。"
        )
        return title, body, True, True
    if restore_failed:
        title = "部分碧琪设定文件没能自动恢复"
        body = (
            "检查时发现有设定文件需要恢复，但写入没有成功（可能是磁盘空间不足、文件夹权限不够，或者被安全软件拦住了）。\n\n"
            "这次没有计入异常次数。请检查磁盘空间或安全软件后重试，你的记忆和设置没有改动。"
        )
        return title, body, False, False
    if non_official:
        title = "当前安装包不是官方完整版本"
        body = "这个安装包缺少官方校验签名，或者安装包里的文件被改动过，无法用来恢复设定。建议到官方渠道重新下载安装，你的记忆和设置都在。"
        return title, body, False, False
    if limit_reached:
        title = f"24 小时内已有 {count} 次改动碧琪的设定，应用即将退出"
        body = f"刚才发现的{cat_text}改动已经换回官方版本。"
        if backup:
            body += f"\n\n原文件备份在：\n{backup}"
        body += (
            "\n\n24 小时内多次改动产品设定会触发保护退出。下次可以正常打开使用；"
            "如果 24 小时内再次改动，仍会直接退出。你的记忆、偏好设置和项目文件都没有受影响。"
        )
        return title, body, True, True
    title = f"碧琪发现自己的{cat_text}被改动了，已经换回官方版本"
    body = "为了保证碧琪正常说话和做事，正式版不允许修改这些设定。你的记忆、偏好设置和项目文件都没有动。"
    if backup:
        body += f"\n\n被改过的文件已备份到：\n{backup}"
    body += f"\n\n（24 小时内第 {count} 次恢复；达到 {limit} 次后应用会自动退出）"
    return title, body, False, False


def show_guard_dialog(title, body, is_critical=False):
    message = f"{title}\n\n{body}"
    append_log("guard", f"alert: {title}")
    if os.name != "nt":
        return
    try:
        import ctypes
        flags = (0x10 if is_critical else 0x30) | 0x10000 | 0x40000
        ctypes.windll.user32.MessageBoxW(None, message, "超級碧琪", flags)
    except Exception:
        pass


def process_guard_alerts(
    resource_root,
    *,
    startup=False,
    app_state=None,
    openclaw_state=None,
    seen_ids=None,
    counter_verified=False,
    presenter=show_guard_dialog,
    locker=lock_tampered_guard_counter,
    is_updating=None,
    key=GUARD_PUBLIC_KEY,
):
    if not guard_release_build(resource_root):
        return False, False
    app_dir = Path(app_state or state_root())
    updating = is_updating(app_dir) if callable(is_updating) else (os.name == "nt" and bool(update_in_progress(app_dir)))
    if updating:
        return False, bool(counter_verified)

    guard_dir = app_dir / "guard"
    alert_file = guard_dir / "pending-alert.json"
    pending_payload = None
    if alert_file.is_file():
        try:
            obj = json.loads(alert_file.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            obj = None
        try:
            alert_file.unlink(missing_ok=True)
        except OSError:
            pass
        if isinstance(obj, dict):
            alert_id = str(obj.get("id") or "")
            already_seen = seen_ids is not None and alert_id and alert_id in seen_ids
            if not already_seen or obj.get("limitReached") is True:
                if seen_ids is not None and alert_id:
                    seen_ids.add(alert_id)
                pending_payload = obj

    identity = guard_bundle_identity(resource_root)
    valid = verify_guard_counter(resource_root, app_dir, key=key)
    if valid:
        counter_verified = True
    elif counter_verified or (
        startup and has_guard_receipt(app_dir, openclaw_state, identity["version"], identity["commit"], identity["manifestSha"])
    ):
        locker(resource_root, app_dir)
        if pending_payload is None:
            pending_payload = {"counterTampered": True, "limitReached": True}
        else:
            pending_payload["counterTampered"] = True
            pending_payload["limitReached"] = True

    if pending_payload is None:
        return False, counter_verified
    title, body, is_critical, should_exit = format_guard_alert(pending_payload)
    presenter(title, body, is_critical)
    return should_exit, counter_verified


def app_version(resource_root):
    try:
        return (Path(resource_root) / "VERSION").read_text(encoding="utf-8-sig").strip()
    except OSError:
        return "0.0.0"


def state_root():
    # An explicit root wins outright, the same way every service resolves its
    # own.  The shell keeps its logs, its staged update and its ledger here, and
    # it exports this value to its children.  Without the override a suite could
    # only shadow LOCALAPPDATA, which is a Windows-only accident, so a test that
    # fails a download on purpose appended to the live profile's updater.log and
    # the result read like a real outage.
    configured = os.environ.get("PINKIE_STATE_ROOT")
    if configured:
        root = Path(configured)
    else:
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData/Local")
        root = Path(base) / "SuperPinkie"
    root.mkdir(parents=True, exist_ok=True)
    return root


def append_log(name, message):
    try:
        directory = state_root() / "logs"
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / f"{name}.log").open("a", encoding="utf-8") as handle:
            handle.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")
    except OSError:
        # The App and the update helper can append to this file at the same
        # time. Diagnostic I/O must not interrupt the update handoff.
        if name != "updater":
            raise


# Loopback probes must never go through a proxy. Without an HTTP(S)_PROXY
# variable, urllib on Windows falls back to the registry proxy that Clash and
# v2rayN write; when its bypass list has no 127.*, every health check went to
# the proxy, the gateway looked dead, and the watchdog started a new gateway
# every ~40 s that then failed on "gateway already running".
_LOOPBACK_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def loopback_urlopen(url, timeout):
    return _LOOPBACK_OPENER.open(url, timeout=timeout)


def http_alive(url, expected_service=None):
    try:
        with loopback_urlopen(url, timeout=.8) as response:
            if expected_service:
                value = json.loads(response.read().decode("utf-8"))
                return value.get("service") == expected_service
            return response.status is not None
    except urllib.error.HTTPError as error:
        return not expected_service and error.code is not None
    except (OSError, ValueError, urllib.error.URLError):
        return False


def http_ready(url):
    """A 2xx/3xx response means the gateway is ready; auth errors are not ready."""
    try:
        with loopback_urlopen(url, timeout=.8) as response:
            return 200 <= int(response.status) < 400
    except urllib.error.HTTPError:
        return False
    except (OSError, ValueError, urllib.error.URLError):
        return False


def http_identity(url):
    """Read a health endpoint's JSON body for diagnostics.

    Used to name whatever is actually listening on a port, so a foreign
    process is reported by its own answer instead of being guessed at.
    """
    try:
        with loopback_urlopen(url, timeout=.8) as response:
            payload = json.loads(response.read(4096).decode("utf-8", "replace"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, ValueError, urllib.error.URLError):
        return {}


def gateway_listener_pid(port=18789, runner=None):
    """PID of the process listening on the loopback gateway port, if any."""
    if os.name != "nt" and runner is None:
        return None
    try:
        result = (runner or subprocess.run)(
            ["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=5,
            **hidden_process_kwargs(),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    for line in str(result.stdout or "").splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[3].upper() == "LISTENING":
            if parts[1].rsplit(":", 1)[-1] == str(port) and parts[4].isdigit():
                return int(parts[4])
    return None


def process_image_and_start(pid):
    """Executable path and creation time (epoch seconds) of a Windows process."""
    if os.name != "nt" or not pid:
        return None, None
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    handle = kernel.OpenProcess(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return None, None
    try:
        size = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        image = buffer.value if kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)) else None
        times = [wintypes.FILETIME() for _ in range(4)]
        started = None
        if kernel.GetProcessTimes(handle, *[ctypes.byref(value) for value in times]):
            ticks = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
            started = ticks / 10_000_000 - 11644473600
        return image, started
    finally:
        kernel.CloseHandle(handle)


def _bundled_node(image):
    """True for a node.exe that sits in a packaged app's runtime\\bin."""
    parts = [part.lower() for part in Path(str(image).replace("\\", "/")).parts]
    return parts[-3:] == ["runtime", "bin", "node.exe"]


def stale_gateway_reason(listener, own_node, own_version, install_time, record=None, read_version=None):
    """Say why a running gateway must be replaced, or None to keep using it.

    The window keeps its gateway alive after closing, so a new version (an
    in-place update, a fresh unzip elsewhere, or an old single-file EXE's temp
    runtime) used to find the previous version still answering on 18789 and
    simply attach to it: the update "installed" but nothing changed.  Only a
    packaged runtime's node.exe is ever replaced; a user's own gateway is left
    alone.
    """
    image = str((listener or {}).get("image") or "")
    if not image or not _bundled_node(image):
        return None
    pid = listener.get("pid")
    same_node = os.path.normcase(image) == os.path.normcase(str(own_node))
    if isinstance(record, dict) and record.get("pid") == pid:
        if str(record.get("version")) == str(own_version):
            return None
        return f"gateway pid {pid} belongs to {record.get('version') or 'an older version'}"
    if same_node:
        started = listener.get("started")
        if started and install_time and started < install_time - 2:
            return f"gateway pid {pid} started before this install"
        return None
    try:
        other = (read_version or app_version)(Path(image.replace("\\", "/")).parents[2])
    except Exception:
        other = ""
    other = "" if other == "0.0.0" else other  # app_version's "unreadable"
    if other and other == str(own_version):
        return None
    return f"gateway pid {pid} runs from another install ({other or 'unknown version'}: {image})"


def gateway_ui_url():
    """Return CLE Kk's chat route, including a legacy token when configured."""
    config_name = os.environ.get("OPENCLAW_CONFIG_PATH")
    config_path = Path(config_name) if config_name else Path.home() / ".openclaw" / "openclaw.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        auth = config.get("gateway", {}).get("auth", {})
        token = auth.get("token") if auth.get("mode") == "token" else None
        if isinstance(token, str) and token:
            return GATEWAY_CHAT_URL + "#token=" + urllib.parse.quote(token, safe="")
    except (OSError, ValueError, AttributeError):
        pass
    return GATEWAY_CHAT_URL


def openclaw_config_path():
    config_name = os.environ.get("OPENCLAW_CONFIG_PATH")
    return Path(config_name) if config_name else Path.home() / ".openclaw" / "openclaw.json"


def cleanup_orphan_webview(storage):
    """Remove only stale Edge WebView2 children owned by this app's storage path."""
    if os.name != "nt":
        return
    path = str(Path(storage).resolve())
    escaped = path.replace("'", "''")
    script = (
        "$root='" + escaped + "'; "
        "Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | "
        "Where-Object { $_.CommandLine -and $_.CommandLine -like ('*--user-data-dir=*' + $root + '*') } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    try:
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        append_log("launcher", "stale WebView2 cleanup skipped")


try:
    from windows_ps_templates import (
        FOREGROUND_PS,
        PINKIE_WPF_PS,
        PROGRESS_WINDOW_PS,
        REPAIR_PS,
        UPDATE_LOG_PS,
        UPDATE_UI_PS,
    )
except ImportError:  # imported as app.windows_desktop (tests)
    from app.windows_ps_templates import (
        FOREGROUND_PS,
        PINKIE_WPF_PS,
        PROGRESS_WINDOW_PS,
        REPAIR_PS,
        UPDATE_LOG_PS,
        UPDATE_UI_PS,
    )


try:
    from windows_updater import UpdateHealthReporter, WindowsUpdater
except ImportError:  # imported as app.windows_desktop (tests)
    from app.windows_updater import UpdateHealthReporter, WindowsUpdater


try:
    from windows_elevated import (
        ElevatedProcess,
        RESIZE_EDGES,
        WINDOW_MIN_SIZE,
        configure_native_corners,
        configure_native_glass,
        follow_native_resize,
        hidden_process_kwargs,
        native_corner_geometry,
        resized_window_rect,
        start_elevated,
    )
except ImportError:  # imported as app.windows_desktop (tests)
    from app.windows_elevated import (
        ElevatedProcess,
        RESIZE_EDGES,
        WINDOW_MIN_SIZE,
        configure_native_corners,
        configure_native_glass,
        follow_native_resize,
        hidden_process_kwargs,
        native_corner_geometry,
        resized_window_rect,
        start_elevated,
    )


try:
    from windows_runtime import (
        BundledRuntime,
        DesktopControlNode,
        _config_repair_module,
        _gateway_proxy_module,
    )
except ImportError:  # imported as app.windows_desktop (tests)
    from app.windows_runtime import (
        BundledRuntime,
        DesktopControlNode,
        _config_repair_module,
        _gateway_proxy_module,
    )


def keep_gateway_after_close():
    """True only when the user asked for the gateway to outlive the window.

    Closing the window used to leave the gateway (node.exe, a few hundred MB)
    and everything it had started running "for background sessions". Users
    saw 碧琪 still holding memory and ports after they had closed her, with no
    window to stop it from. Closing the window now ends everything; set
    PINKIE_KEEP_GATEWAY=1 to get the old behaviour back.
    """
    return os.environ.get("PINKIE_KEEP_GATEWAY", "0") == "1"


def bind_to_app_lifetime(process, name=""):
    """Put a child process in the app's kill-on-close job.

    Windows ends every process in the job (and whatever those start later)
    when this process goes away -- also when it crashes or is ended from Task
    Manager, where no close handler runs. That is the part `taskkill /T` on a
    normal close cannot cover.
    """
    if os.name != "nt" or process is None:
        return
    try:
        from browser_vpn_core import assign_to_kill_job

        assign_to_kill_job(process.pid)
    except Exception as error:  # never block a start on this
        append_log("launcher", f"{name or 'child'} not bound to the app lifetime: {error}")


def gateway_closed_marker():
    """Left behind when closing the window also closed the gateway.

    An install that registered the gateway watchdog (install.ps1, or
    installer/windows/register-bundled-watchdog.ps1) checks every two seconds
    and starts a gateway whenever none is listening. Without this marker it
    would bring the gateway back seconds after the user closed 碧琪, which is
    the very "still running after I closed it" this close path is meant to end.
    The watchdog stands down while the marker exists; the next launch removes it.
    """
    return state_root() / "gateway-closed-by-app"


def kill_process_tree(pid, timeout=8):
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout,
        **hidden_process_kwargs(),
    )


try:
    from windows_gateway import (
        GatewaySupervisor,
        LocalServices,
        load_file_module,
        relay_command,
    )
except ImportError:  # imported as app.windows_desktop (tests)
    from app.windows_gateway import (
        GatewaySupervisor,
        LocalServices,
        load_file_module,
        relay_command,
    )


from inapp_browser import InAppBrowserBridge  # noqa: E402  碧琪的浏览器（独立窗口 + 浏览器专用节点）


try:
    from windows_bridge import (
        NativeBridge,
        _describe_material,
        _image_dimensions,
        run_notify_fields,
    )
except ImportError:  # imported as app.windows_desktop (tests)
    from app.windows_bridge import (
        NativeBridge,
        _describe_material,
        _image_dimensions,
        run_notify_fields,
    )


try:
    from windows_bridge_scripts import BRIDGE_SCRIPT, NATIVE_READING_SCRIPT
except ImportError:  # imported as app.windows_desktop (tests)
    from app.windows_bridge_scripts import BRIDGE_SCRIPT, NATIVE_READING_SCRIPT


def show_startup_error(window):
    window.evaluate_js("""
      (()=>{const box=document.createElement('div');box.style.cssText='position:fixed;left:50%;bottom:9%;transform:translateX(-50%);padding:10px 16px;border:1px solid #fff8;border-radius:18px;background:#f8dcebdd;color:#72455d;font:12px system-ui;box-shadow:0 12px 34px #7b3f5d22';box.textContent='本机服务还没有准备好，现有资料没有改动。重新打开 App 会继续恢复。';(document.body||document.documentElement).append(box)})();
    """)


def update_health_token_from_argv(arguments=None, root=None):
    for argument in arguments if arguments is not None else sys.argv[1:]:
        match = re.fullmatch(r"--update-health-token=([0-9a-f]{32})", str(argument))
        if match:
            return match.group(1)
    if arguments is None:
        return take_pending_launch_token(root)
    return None


def take_pending_launch_token(root=None, max_age=900.0, now=None):
    """Token an elevated replacer left for the start it made through Explorer.

    Explorer passes no command line, so the elevated helper writes the token to
    a file instead. Read once; only while that helper's script still exists.
    """
    path = Path(root or state_root()) / "updates/health/pending-launch.json"
    try:
        age = (now if now is not None else time.time()) - path.stat().st_mtime
        token = str(json.loads(path.read_text(encoding="utf-8-sig")).get("token", ""))
    except (OSError, ValueError, AttributeError):
        return None
    finally:
        try:
            path.unlink()
        except OSError:
            pass
    # Windows 上文件修改时间可能比 time.time() 早走几毫秒（不同时钟），刚写的文件 age 会是小负数。
    if not re.fullmatch(r"[0-9a-f]{32}", token) or not -2.0 <= age <= max_age:
        return None
    if not (path.parents[1] / f"apply-{token}.ps1").is_file():
        return None
    return token


def update_helper_protocol(token, root=None):
    """Which replacer launched this update start, read from its own script.

    "two-phase": this version's helper -- ``.started`` now, ``.ready`` once our
                 gateway listens; it never kills a new version for being slow.
    "gateway":   2.5.29-2.5.31 helpers -- only ``.ready`` within 120 s, and at
                 that moment a gateway from the new folder must be listening.
    "marker":    2.5.27-2.5.28 portable and every onefile helper -- only
                 ``.ready`` within 120 s, nothing else is checked.
    Unknown or unreadable scripts are treated as "gateway", the strictest.
    """
    path = Path(root or state_root()) / "updates" / f"apply-{token}.ps1"
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError):
        return "gateway"
    if "pinkie-update-protocol: 2" in text:
        return "two-phase"
    if "Confirm-NewInstallGateway" in text:
        return "gateway"
    return "marker"




def install_native_bridge(window, updater, update_health_token=None, installed_notes=None):
    """Dress the gateway page with the native bridge and confirm a fresh update.

    pywebview fires `loaded` on WebView2's GUI thread, where a synchronous
    evaluate_js deadlocks, so callers run this on a worker instead.

    The health marker means one thing only -- "the new version came up" -- and it
    is written before the UI script is injected.  The two used to share a single
    try block, so an injected script that threw (WebView2 reports the navigation
    as loaded while the document can still be mid-parse) swallowed the marker
    too: the replacer would wait out its whole 120 s health deadline and roll a
    perfectly good build back.  A cosmetic UI failure must not veto an upgrade.
    """
    current_url = str(window.get_current_url() or "")
    if not current_url.startswith(GATEWAY_URL):
        return

    if update_health_token:
        reporter = getattr(updater, "health_reporter", None)
        if reporter and reporter.token == update_health_token:
            reporter.ready()
        else:
            try:
                health = state_root() / "updates/health" / f"{update_health_token}.ready"
                health.parent.mkdir(parents=True, exist_ok=True)
                health.write_text("ready\n", encoding="ascii")
            except OSError as error:
                append_log("launcher", f"update health marker not written: {error}")

    try:
        window.evaluate_js(NATIVE_READING_SCRIPT + BRIDGE_SCRIPT)
    except Exception as error:
        append_log("launcher", f"native bridge setup skipped: {error}")

    if isinstance(installed_notes, str):
        installed_notes = release_notes_parts(installed_notes)
    if update_health_token and installed_notes and (installed_notes.get("summary") or installed_notes.get("details")):
        try:
            window.evaluate_js(
                "window.__pinkieShowInstalledNotes?.("
                + json.dumps(
                    {"version": updater.current_version, "notes": release_notes.as_text(installed_notes), **installed_notes},
                    ensure_ascii=False,
                )
                + ")"
            )
        except Exception as error:
            append_log("launcher", f"installed notes skipped: {error}")

    failure = None if update_health_token else updater.take_last_failure()
    if failure:
        try:
            window.evaluate_js(
                "window.__pinkieShowUpdateFailed?.("
                + json.dumps(
                    {"version": failure.get("version", ""), "current": updater.current_version,
                     "message": str(failure.get("message", ""))[:300]},
                    ensure_ascii=False,
                )
                + ")"
            )
        except Exception as error:
            append_log("launcher", f"update failure notice skipped: {error}")

    def announce_update():
        if failure:
            return
        info = updater.check()
        if info.get("available"):
            try:
                window.evaluate_js(
                    "window.__pinkiePresentUpdate?.(" + json.dumps(info, ensure_ascii=False) + ")"
                )
            except Exception:
                pass

    threading.Thread(target=announce_update, name="pinkie-update-check", daemon=True).start()


def smoke_debug_port(environ=os.environ):
    """Localhost DevTools port for the isolated smoke run only.

    pywebview sets WebView2's AdditionalBrowserArguments itself, which makes
    WebView2 ignore WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS; the port has to go
    through pywebview's own setting. Normal starts never set this variable.
    """
    match = re.fullmatch(r"http://127\.0\.0\.1:(\d{2,5})", environ.get("PINKIE_SMOKE_WEBVIEW_CDP", ""))
    port = int(match[1]) if match else 0
    return port if 1024 <= port <= 65535 else None


def update_in_progress(root=None, image_of=None):
    """Version being installed when a live replacer owns the install, else None."""
    path = Path(root or state_root()) / "updates" / "in-progress.json"
    try:
        record = json.loads(path.read_text(encoding="utf-8-sig"))
        pid = int(record["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    image = None
    try:
        image = (image_of or (lambda value: process_image_and_start(value)[0]))(pid)
    except Exception:
        image = None
    if not image or Path(str(image).replace("\\", "/")).name.lower() != "powershell.exe":
        return None  # helper is gone: a leftover file must never lock the user out
    return str(record.get("version") or "新版")


def show_update_in_progress(version):
    message = f"碧琪正在换上 {version}，换好后会自动打开，请稍等几分钟。\n\n现在打开会看到旧版本，还可能打断更新。"
    append_log("launcher", f"start refused: update to {version} in progress")
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, "超級碧琪", 0x40)
    except Exception:
        pass


STARTUP_FALLBACK_HTML = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>超級碧琪正在准备</title>
<style>
html,body{margin:0;height:100%;background:#efcbd3;color:#6e3a57;font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif}
body{display:grid;place-items:center}
.card{width:min(460px,calc(100% - 40px));padding:26px 26px 22px;border-radius:26px;border:1.5px solid #fff;
background:linear-gradient(135deg,#fff8fb,#fbddea);box-shadow:0 14px 40px #7b3f5d40}
.chip{display:inline-block;padding:2px 10px 3px;border-radius:9px;background:#f7cadc;color:#a24b76;font-size:11px}
h1{margin:10px 0 6px;font-size:19px}
p{margin:0;font-size:13px;line-height:1.6;color:#8a5a72}
.bar{position:relative;height:12px;margin:16px 0 4px;border-radius:6px;background:#f5cedd;overflow:hidden}
.bar i{position:absolute;inset:0 auto 0 0;width:34%;border-radius:6px;background:linear-gradient(90deg,#f793c0,#c25b8a);animation:slide 1.6s ease-in-out infinite}
@keyframes slide{0%{left:-34%}100%{left:100%}}
.foot{display:flex;justify-content:space-between;font-size:11.5px;color:#9a6f85;margin-top:8px}
.actions{display:none;flex-wrap:wrap;gap:8px;margin-top:16px}
.actions.on{display:flex}
button{flex:1 1 120px;padding:8px 14px;border-radius:17px;border:1.2px solid #e9a9c4;background:#fff;color:#7a3f5e;font:inherit;font-size:13px;cursor:pointer}
button.primary{background:#c25b8a;border-color:#c25b8a;color:#fff;font-weight:600}
#result{margin-top:10px;min-height:1em;color:#c2410c;font-size:12.5px}
</style></head><body><main class="card">
<span class="chip">超級碧琪</span>
<h1 id="title">碧琪正在打开</h1>
<p id="line">正在启动本机服务，第一次打开大约要一两分钟。请不要关掉这个窗口。</p>
<div class="bar"><i></i></div>
<div class="foot"><span id="state">正在等本机网关…</span><span id="clock">已用 0 秒</span></div>
<div class="actions" id="actions">
<button class="primary" data-call="startup_repair">自动修复设置</button>
<button data-call="startup_update">检查更新并安装</button>
<button data-call="open_logs">打开日志文件夹</button>
</div><div id="result"></div>
</main><script>
const started=Date.now(),clock=document.getElementById("clock");
function tick(){const s=Math.round((Date.now()-started)/1000);
clock.textContent=s<60?"已用 "+s+" 秒":"已用 "+Math.floor(s/60)+" 分 "+String(s%60).padStart(2,"0")+" 秒";
if(s>=45){document.getElementById("actions").classList.add("on");
document.getElementById("line").textContent="碧琪的安装文件好像少了一部分（启动页找不到）。可以先自动修复；还不行就检查更新并安装，记忆和设置不会丢。";}}
async function poll(){try{await fetch("http://127.0.0.1:18789/",{mode:"no-cors",cache:"no-store"});
location.replace("http://127.0.0.1:18789/chat");return}catch(e){}setTimeout(poll,1500)}
document.querySelectorAll("[data-call]").forEach(b=>b.onclick=async()=>{const r=document.getElementById("result");
const api=window.pywebview&&window.pywebview.api;if(!api||!api[b.dataset.call]){r.textContent="这个按钮现在用不了，请重新打开碧琪。";return}
b.disabled=true;try{const out=await api[b.dataset.call]();r.textContent=(out&&out.message)||"已经开始了。"}catch(e){r.textContent="没有成功："+e}b.disabled=false});
setInterval(tick,1000);poll();
</script></body></html>"""


# Startup timing is measured from interpreter start, which is what the user
# waits through after double-clicking. Each line gives the elapsed total and,
# for a phase, how long that phase took.
PROCESS_STARTED = time.monotonic()


def startup_timing(label, phase_started=None, now=None):
    now = time.monotonic() if now is None else now
    total = now - PROCESS_STARTED
    phase = "" if phase_started is None else f" took={now - phase_started:.2f}s"
    message = f"startup timing: {label} at +{total:.2f}s{phase}"
    append_log("launcher", message)
    return message


def log_gateway_answer(timeout=300.0, interval=0.25):
    """Record when the local gateway first answers, for before/after numbers."""
    ends = time.monotonic() + timeout
    while time.monotonic() < ends:
        try:
            if http_ready(GATEWAY_URL):
                startup_timing("gateway answered")
                return True
        except Exception:
            pass
        time.sleep(interval)
    return False


def startup_fallback_html():
    return STARTUP_FALLBACK_HTML


def watch_failed_file_navigation(window, log=None, limit=3):
    """Replace WebView2's bare error page for a failed file:// load.

    The splash is checked once at start, but a user still saw 「未找到文件
    ERR_FILE_NOT_FOUND」 on 2.5.40 right after an update: the file existed at
    start and a later load of it failed. Whenever a file:// navigation fails,
    show the built-in page (no files needed; it waits for the gateway and
    offers repair) instead of an error with no way out. Runs on the GUI thread.
    """
    log = log or (lambda message: append_log("launcher", message))
    control = getattr(getattr(getattr(window, "native", None), "browser", None), "webview", None)
    if control is None:
        log("failed-navigation guard not installed: WebView2 control not found")
        return None
    state = {"count": 0}

    def completed(sender, args):
        try:
            if bool(args.IsSuccess):
                return
            source = str(sender.Source or "")
            if not source.lower().startswith("file:"):
                return
            status = str(getattr(args, "WebErrorStatus", "unknown"))
            if state["count"] >= limit:
                log(f"file page failed again ({status}): {source}; built-in page already shown {limit} times")
                return
            state["count"] += 1
            log(f"file page failed to load ({status}): {source}; showing the built-in page")
            sender.CoreWebView2.NavigateToString(startup_fallback_html())
        except Exception as error:  # an event handler must never raise into WebView2
            log(f"failed-navigation guard error: {error}")

    control.NavigationCompleted += completed
    return completed


def run_desktop(resource_root, prepare, update_health_token=None):
    import webview
    if not update_health_token:
        installing = update_in_progress()
        if installing:
            show_update_in_progress(installing)
            return
    debug_port = smoke_debug_port()
    if debug_port:
        webview.settings["REMOTE_DEBUGGING_PORT"] = debug_port

    runtime = BundledRuntime(resource_root)
    if not runtime.valid():
        raise RuntimeError("Windows bundled runtime is incomplete")
    os.environ.update(runtime.environment())
    # 碧琪的浏览器：控制端点必须在网关启动前写进环境变量（app_browser 工具靠它连过来）。
    import inapp_browser

    inapp_browser.install(state_root(), resource_root, lambda message: append_log("launcher", message))
    webview_storage = state_root() / "webview"
    cleanup_orphan_webview(webview_storage)
    updater = WindowsUpdater(resource_root)
    bridge = NativeBridge(updater)
    loading_file = (Path(resource_root) / "ui/launcher-loading.html").resolve()
    loading = loading_file.as_uri()
    # A missing splash file used to put WebView2's bare 「未找到文件
    # ERR_FILE_NOT_FOUND」 page on screen, with no way out. Show 碧琪's own
    # built-in page instead and record where the file was expected.
    loading_html = None if loading_file.is_file() else startup_fallback_html()
    append_log("launcher", f"splash {loading}" + ("" if loading_html is None else " is MISSING; using the built-in page"))
    if update_health_token:
        # First start right after an update: the splash says so, instead of a
        # bare gateway counter that looks like nothing happened.
        version_file = Path(resource_root) / "VERSION"
        version = version_file.read_text(encoding="utf-8").strip() if version_file.is_file() else ""
        loading += "?" + urllib.parse.urlencode({"updated": version or "1"})
    gateway = GatewaySupervisor(runtime)
    bridge._gateway = gateway
    # A gateway kept alive by an older version would otherwise be adopted
    # below, and the new version would show the old one's page.
    gateway.retire_stale()
    if update_health_token:
        # The object is created now, but .started is written only after the
        # window exists. Writing it earlier made the replacer delete the
        # previous copy while this window had not opened yet.
        updater.health_reporter = UpdateHealthReporter(update_health_token, runtime.node)
    # A warm Gateway can be shown directly. This avoids flashing or waiting on
    # the launcher page on the common second-start path.
    initial_url = gateway_ui_url() if http_ready(GATEWAY_URL) else loading
    initial_html = loading_html if initial_url == loading else None
    # The official environment setting applies before WebView2's first paint;
    # setting the API only after navigation can leave a white flash.
    os.environ["WEBVIEW2_DEFAULT_BACKGROUND_COLOR"] = "00000000"
    startup_timing("window create" + (" (gateway already warm)" if initial_html is None and initial_url != loading else ""))
    window = webview.create_window(
        "超級碧琪", None if initial_html else initial_url, html=initial_html, js_api=bridge, width=1280, height=800,
        min_size=(760, 500), resizable=True, frameless=True, easy_drag=False,
        shadow=False, background_color="#000000", transparent=True,
    )
    bridge.attach(window)
    try:
        bridge._pinkie_native().start()  # tray icon + global hotkey (N2, N3)
    except Exception as error:
        append_log("native", f"tray start failed: {type(error).__name__}")
    if inapp_browser.manager() is not None:
        inapp_browser.manager().owner_hwnd = bridge._native_window_handle
    if update_health_token and updater.health_reporter is not None:
        # Old replacers only wait 120 s, so this still happens before setup
        # and the cold gateway. It just no longer happens before a window exists.
        updater.health_reporter.start()
    services = LocalServices(runtime)
    page_loads = []
    computer = DesktopControlNode(runtime)
    bridge._computer = computer

    def loaded(*_):
        # pywebview fires `loaded` on WebView2's GUI thread. Calling its
        # synchronous evaluate_js there deadlocks: ExecuteScriptAsync needs the
        # very same GUI thread to complete. Return from the event immediately
        # and do all synchronous window calls from a worker instead.
        # Count loads without touching the window here: the splash is #1 and
        # the chat page #2 on a cold start; a warm start opens on the chat.
        page_loads.append(1)
        if len(page_loads) <= 3:
            startup_timing(f"page loaded #{len(page_loads)}")
        threading.Thread(
            target=install_native_bridge,
            args=(window, updater, update_health_token, bundled_release_notes(resource_root, updater.current_version)),
            name="pinkie-native-bridge",
            daemon=True,
        ).start()

    def before_show():
        # This event runs synchronously on WinForms' GUI thread. Do not call
        # evaluate_js or marshal back to the same thread from here.
        for label, configure in (("glass", configure_native_glass), ("corners", configure_native_corners),
                                 ("failed-navigation guard", watch_failed_file_navigation)):
            try:
                configure(window)
            except Exception as error:
                append_log("launcher", f"native {label} setup failed: {error}")

    def start_services():
        started = time.monotonic()
        try:
            services.start()
        except Exception as error:
            append_log("launcher", f"local services failed: {error}")
        startup_timing("services", started)

    guard_stop = threading.Event()
    guard_seen_ids = set()
    guard_state = {"verified": False}
    guard_force_exit = {"active": False}
    exit_lock = threading.Lock()
    exit_done = {"ran": False}

    def run_finish_exit(force_close_gateway=False):
        with exit_lock:
            if exit_done["ran"]:
                return
            exit_done["ran"] = True
        finish_exit(bridge, gateway, webview_storage, force_close_gateway=force_close_gateway)

    def enforce_guard_exit():
        guard_force_exit["active"] = True
        guard_stop.set()
        for fn in (services.close, computer.close, gateway.close):
            try:
                fn()
            except Exception:
                pass
        try:
            window.destroy()
        except Exception:
            pass
        run_finish_exit(force_close_gateway=True)

    def monitor_guard():
        while not guard_stop.wait(1.2):
            try:
                should_exit, guard_state["verified"] = process_guard_alerts(
                    resource_root, startup=False, seen_ids=guard_seen_ids, counter_verified=guard_state["verified"],
                )
                if should_exit:
                    enforce_guard_exit()
                    return
            except Exception as error:
                append_log("guard", f"runtime guard check failed: {error}")

    def bootstrap():
        # Party, roundtable, TTS and the relay do not feed the gateway's
        # startup. They used to run (with their port probes) between setup and
        # the gateway, adding ~5 s to every start on Windows. Run them beside
        # the gateway instead, like the Mac launcher does.
        threading.Thread(target=start_services, name="pinkie-services", daemon=True).start()
        # Setup can fail or take a long time. The splash only leaves when the
        # gateway answers, so a setup error must not skip starting it.
        started = time.monotonic()
        config_changed = False
        try:
            config_changed = bool(prepare(lambda message: append_log("setup", message)))
        except Exception as error:
            append_log("launcher", f"startup setup failed: {error}")
        startup_timing("setup", started)
        try:
            should_exit, guard_state["verified"] = process_guard_alerts(
                resource_root, startup=True, seen_ids=guard_seen_ids, counter_verified=guard_state["verified"],
            )
            if should_exit:
                enforce_guard_exit()
                return
        except Exception as error:
            append_log("guard", f"startup guard alert check failed: {error}")
        if guard_release_build(resource_root):
            threading.Thread(target=monitor_guard, name="pinkie-guard-monitor", daemon=True).start()
        if config_changed and http_ready(GATEWAY_URL):
            # A gateway that was already running (kept alive after the last
            # window closed) holds the plugin set it started with. Setup just
            # wrote a new one, so reload instead of leaving the user with a
            # plugin that looks installed but does nothing until a manual
            # restart.
            append_log("setup", "config changed while the gateway was up; reloading it")
            try:
                gateway.reload_for_config()
            except Exception as error:
                append_log("setup", f"gateway reload failed: {error}")
        threading.Thread(target=log_gateway_answer, name="pinkie-startup-timing", daemon=True).start()
        try:
            reporter = getattr(updater, "health_reporter", None)
            if reporter is not None:
                # An old replacer may still be checking the gateway port.
                if not reporter.wait_for_gateway_port():
                    reporter.release_port()
            gateway.start()
            startup_timing("gateway spawn")
            threading.Thread(target=gateway.monitor, name="pinkie-gateway-watchdog", daemon=True).start()
            # Desktop control pairs against the gateway, so it waits for the
            # gateway to answer rather than racing its startup: `start()` only
            # spawns the process and returns, so the node would otherwise try to
            # pair against a port nobody is listening on yet.
            def start_desktop_control():
                if not gateway.wait_ready():
                    append_log("computer", "desktop control skipped: gateway did not become ready")
                    return
                try:
                    computer.start()
                except Exception as error:
                    append_log("computer", f"desktop control start failed: {error}")

            threading.Thread(
                target=start_desktop_control, name="pinkie-computer-start", daemon=True
            ).start()
            # The splash page polls the local gateway itself.  Do not call
            # pywebview window APIs from this worker thread: WebView2 can block
            # its GUI message pump when load_url/evaluate_js crosses threads.
        except Exception as error:
            append_log("launcher", f"gateway start failed: {error}")

    def sync_window_state(maximized):
        bridge.maximized = bool(maximized)
        try:
            window.evaluate_js(
                "window.__pinkieNativeWindowState?.(" +
                json.dumps({"maximized": bridge.maximized}) + ")"
            )
        except Exception:
            pass

    def maximized(*_):
        sync_window_state(True)

    def restored(*_):
        sync_window_state(False)

    def closed(*_):
        guard_stop.set()
        bridge.stop_dictation()
        # The companion has no life of its own: leaving it behind after the main
        # window closes leaves a stray window with no app behind it.
        try:
            bridge.close_workspace_dock()
        except Exception:
            pass
        # Same for the quick-ask box (the global hotkey): while any window is
        # left, webview.start() does not return and finish_exit never runs.
        try:
            native = getattr(bridge, "_native_bridge", None)
            if native is not None:
                native.quick_close()
        except Exception:
            pass
        services.close()
        computer.close()
        # Closing the window closes 碧琪: the gateway, everything it started and
        # the helper processes all go with it. Nothing is left holding memory
        # or ports with no window to stop it from. PINKIE_KEEP_GATEWAY=1 keeps
        # the gateway for people who do want sessions to finish in the background.
        if keep_gateway_after_close() and not guard_force_exit["active"]:
            append_log("launcher", "window closed; keeping gateway for background sessions")
        else:
            gateway.close()
            append_log("launcher", "window closed; gateway and helpers stopped")

    window.events.before_show += before_show
    window.events.loaded += loaded
    window.events.maximized += maximized
    window.events.restored += restored
    window.events.closed += closed
    # Start local services independently of WebView2. A broken/slow renderer
    # must never prevent the Gateway from being launched.

    # FanVPN 的系统代理必须跟着**进程**生命周期走，而不是窗口。
    # 窗口关掉时 gateway 还在跑（上面那段逻辑刻意保活），此时还原代理
    # 会让用户浏览器突然断掉；所以只在进程真正退出时还原。
    # 不注册这个的话，用户点了开关后直接关掉进程，注册表里会留着
    # 一个指向已死端口的 PAC，下次开机整个系统都没网。
    def _restore_fanvpn_on_exit():
        try:
            import fanvpn_bridge

            fanvpn_bridge.shutdown()
        except Exception:  # noqa: BLE001 - 退出路径绝不能抛
            pass

    atexit.register(_restore_fanvpn_on_exit)

    threading.Thread(target=bootstrap, name="pinkie-bootstrap", daemon=True).start()
    webview.start(
        gui="edgechromium", debug=False, private_mode=False,
        storage_path=str(webview_storage),
    )
    run_finish_exit(force_close_gateway=guard_force_exit["active"])


def finish_exit(bridge, gateway, webview_storage, leave=os._exit, force_close_gateway=False):
    """The last window is gone: leave nothing of the app behind, then exit.

    `closed` already stopped the services. This covers what is left: a close
    handler that raised half way, the tray icon, WebView2 helper processes that
    outlive their window, and worker threads (timers, service loops) that would
    otherwise keep 超級碧琪.exe in Task Manager after its window is gone.
    """
    try:
        if force_close_gateway or not keep_gateway_after_close():
            gateway.close()
    except Exception as error:
        append_log("launcher", f"gateway stop on exit failed: {error}")
    try:
        native = getattr(bridge, "_native_bridge", None)
        if native is not None:
            native.stop()
    except Exception:
        pass
    # Registered exit handlers (system proxy restore, the browser window's
    # host) must run before the hard exit below, which skips them.
    try:
        atexit._run_exitfuncs()
    except Exception as error:
        append_log("launcher", f"exit handlers failed: {error}")
    try:
        cleanup_orphan_webview(webview_storage)
    except Exception:
        pass
    append_log("launcher", "exit complete")
    leave(0)
