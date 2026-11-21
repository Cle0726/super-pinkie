"""Release metadata parsing, Ed25519 update signature verification, and guard alert helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.parse

import release_notes

UPDATE_API_URL = "https://api.github.com/repos/Cle0726/super-pinkie/releases/latest"
UPDATE_ASSET_PREFIX = "super-pinkie-windows-"
TRUSTED_UPDATE_HOSTS = {
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}
UPDATE_RELEASES_URL = "https://github.com/Cle0726/super-pinkie/releases"
UPDATE_MANIFEST_NAME = "latest.json"
DEFAULT_UPDATE_PROXIES = ("https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/")
UPDATE_RELEASE_API_PROXY_HOSTS = frozenset({"gh-proxy.com"})

def _desktop():
    return sys.modules.get("app.windows_desktop") or sys.modules.get("windows_desktop")

def append_log(*args, **kwargs): return _desktop().append_log(*args, **kwargs)
def update_in_progress(*args, **kwargs): return _desktop().update_in_progress(*args, **kwargs)


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
