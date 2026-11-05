"""Self-contained Windows desktop shell for the bundled Super Pinkie runtime."""

from __future__ import annotations

import base64
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser


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


_NOTES_CUT = re.compile(
    r"\n(?:\*\*Full Changelog\*\*|## What's Changed|<!-- pinkie-notes-end -->)",
    re.IGNORECASE,
)


def release_notes_text(body):
    """Keep the user-facing lines and drop the generated commit trailer."""
    text = _NOTES_CUT.split(str(body or "").replace("\r\n", "\n"), maxsplit=1)[0].strip()
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        line = re.sub(r"^[-*]\s+", "", line).replace("**", "").replace("`", "").strip()
        if line:
            lines.append(line)
    notes = "\n".join(lines)
    if len(notes) > 1200:
        notes = notes[:1200].rsplit("\n", 1)[0].strip()
    return notes


def bundled_release_notes(resource_root):
    try:
        return release_notes_text((Path(resource_root) / "release-notes.md").read_text(encoding="utf-8-sig"))
    except OSError:
        return ""


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
    directory = state_root() / "logs"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / f"{name}.log").open("a", encoding="utf-8") as handle:
        handle.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")


def http_alive(url, expected_service=None):
    try:
        with urllib.request.urlopen(url, timeout=.8) as response:
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
        with urllib.request.urlopen(url, timeout=.8) as response:
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
        with urllib.request.urlopen(url, timeout=.8) as response:
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


class WindowsUpdater:
    """Release updater for a frozen EXE or PyInstaller onedir directory."""

    # How long the replacer waits for the new version: to report that it
    # started at all, then (while it keeps running) to report its gateway.
    health_start_seconds = 120
    health_ready_seconds = 900
    swap_seconds = 90

    def __init__(self, resource_root, opener=None, executable=None):
        self.current_version = app_version(resource_root)
        self.opener = opener or urllib.request.urlopen
        self.executable = Path(executable or os.environ.get("PINKIE_EXECUTABLE_PATH") or sys.executable).resolve()
        self.portable = self._is_onedir(self.executable)
        self.enabled = self.executable.suffix.lower() == ".exe" and (
            bool(getattr(sys, "frozen", False)) or bool(os.environ.get("PINKIE_EXECUTABLE_PATH")) or executable is not None
        )
        self.lock = threading.RLock()
        self.last_checked = 0.0
        self.latest = None
        self.prepared = None
        self.mirrors = update_mirrors(resource_root)
        self.trusted_hosts = set(TRUSTED_UPDATE_HOSTS) | {
            urllib.parse.urlparse(route["manifest"]).hostname for route in self.mirrors}
        self.mirror_latest = None
        self.mirror_checked = 0.0
        self.health_reporter = None

    @staticmethod
    def _is_onedir(executable):
        """判断当前是不是 onedir（便携目录）构建。

        旧实现要求父目录必须叫「超級碧琪」，于是把装在 `F:\\SuperPinkie` 这类自定义
        目录里的 onedir 包误判成 onefile：更新时去下 `super-pinkie-windows-x.y.z.exe`
        （单文件版），换上去之后同级 `_internal` 目录就变成没人管的孤儿，而且每次启动
        都要重新解包几百 MB。这里只看目录结构，不看安装目录叫什么名字。
        """
        parent = Path(executable).parent
        if (parent / "_internal").is_dir() or (parent / "runtime").is_dir():
            return True
        bundle = getattr(sys, "_MEIPASS", None)
        if bundle:
            bundle = Path(bundle)
            if bundle.name in ("_internal", "runtime") and bundle.parent == parent:
                return True
        return False

    def _request(self, url):
        if not trusted_update_url(url, self.trusted_hosts):
            raise ValueError("untrusted update address")
        return urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "SuperPinkie-Windows-Updater",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )

    def _read(self, url, limit, timeout=20):
        with self.opener(self._request(url), timeout=timeout) as response:
            value = response.read(limit + 1)
        if len(value) > limit:
            raise ValueError("update metadata is too large")
        return value

    def check(self, force=False, route=None):
        if not self.enabled:
            return {"available": False, "supported": False, "currentVersion": self.current_version}
        if route == "mirror":
            return self._check_mirror(force)
        with self.lock:
            if not force and self.latest is not None and time.monotonic() - self.last_checked < 7200:
                return dict(self.latest)
            self.last_checked = time.monotonic()
            try:
                release = json.loads(self._read(UPDATE_API_URL, 1024 * 1024).decode("utf-8"))
                selected = release_update(release, self.current_version, portable=self.portable)
                self.latest = selected or {
                    "available": False,
                    "supported": True,
                    "currentVersion": self.current_version,
                }
            except Exception as error:
                append_log("updater", f"update check failed: {error}")
                self.latest = {
                    "available": False,
                    "supported": True,
                    "currentVersion": self.current_version,
                    "temporaryError": True,
                    "suggestMirror": bool(self.mirrors),
                }
            return dict(self.latest)

    def _check_mirror(self, force=False):
        with self.lock:
            if not force and self.mirror_latest is not None and time.monotonic() - self.mirror_checked < 7200:
                return dict(self.mirror_latest)
            self.mirror_checked = time.monotonic()
            missing_manifest = False
            for route in self.mirrors:
                try:
                    manifest = json.loads(self._read(route["manifest"], 256 * 1024).decode("utf-8"))
                except Exception as error:
                    if isinstance(error, urllib.error.HTTPError) and error.code == 404:
                        missing_manifest = True
                    append_log("updater", f"mirror {urllib.parse.urlparse(route['manifest']).hostname} unavailable: {error}")
                    continue
                if not isinstance(manifest, dict) or not str(manifest.get("version", "")).strip():
                    continue
                try:
                    selected = manifest_update(manifest, self.current_version, route["asset"], portable=self.portable)
                    if not selected and version_tuple(manifest["version"]) > version_tuple(self.current_version):
                        raise ValueError("new mirror release is missing a valid package digest")
                except ValueError:
                    continue
                self.mirror_latest = ({**selected, "route": "mirror", "mirror": route["label"]} if selected else
                                      {"available": False, "supported": True, "route": "mirror", "currentVersion": self.current_version})
                return dict(self.mirror_latest)
            # Old published releases have no latest.json. When the configured,
            # verified API proxy is available, read its public release metadata
            # and still require the official checksum or the release SHA-256.
            if missing_manifest:
                for route in (r for r in self.mirrors if r.get("release_api")):
                    try:
                        release = json.loads(self._read(route["release_api"], 1024 * 1024).decode("utf-8"))
                        selected = mirrored_release_update(release, self.current_version, route["asset"], portable=self.portable)
                        self.mirror_latest = ({**selected, "route": "mirror", "mirror": route["label"]} if selected else
                                              {"available": False, "supported": True, "route": "mirror", "currentVersion": self.current_version})
                        return dict(self.mirror_latest)
                    except Exception as error:
                        append_log("updater", f"mirror legacy release metadata unavailable: {error}")
            self.mirror_latest = None
            return {"available": False, "supported": True, "route": "mirror", "currentVersion": self.current_version,
                    "temporaryError": True, "message": ("国内线路缺少版本清单，暂时无法检查；可换官方线路或手动下载。" if missing_manifest else
                                                          "国内线路暂时都连不上，可以稍后重试，或换回官方线路。")}

    def _expected_checksum(self, metadata):
        try:
            return self._checksum(self._read(metadata["checksumUrl"], 4096, timeout=8 if metadata.get("sha256") else 20),
                                  metadata["name"])
        except Exception as error:
            if not metadata.get("sha256"):
                raise
            # 国内线路：GitHub 官方校验和拿不到时，用 latest.json 里的。下载后照样逐字节核对。
            append_log("updater", f"official checksum unavailable, using the mirror metadata SHA-256: {error}")
            return metadata["sha256"]

    @staticmethod
    def _checksum(value, expected_name):
        line = value.decode("ascii", errors="strict").strip().splitlines()[0]
        match = re.fullmatch(r"([0-9a-fA-F]{64})(?:\s+\*?(.+))?", line)
        if not match or (match.group(2) and match.group(2).strip() != expected_name):
            raise ValueError("invalid checksum file")
        return match.group(1).lower()

    @staticmethod
    def _file_hash(path):
        digest = hashlib.sha256()
        with Path(path).open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        return digest.hexdigest()

    def _download(self, url, destination, maximum=2 * 1024 * 1024 * 1024, attempts=4, progress=None):
        """下载更新包，核对 Content-Length，被掐断时用 Range 续传重试。

        urllib 的 read() 在连接提前关闭时只返回空串、并不抛错，所以旧实现会把「下了一半
        的文件」当成成功，最后在 prepare() 里报成 `downloaded update checksum mismatch`
        ——看起来像校验和写错了，其实是几百 MB 的包经代理中途断了。这里显式核对服务端声明
        的长度，并保留半成品做 Range 续传，避免每次重试都从零开始重下。

        半成品在**最终失败时也要留下**：它就是下一次 prepare() 的续传起点。原先的
        `temporary.unlink()` 只在一次调用内的 4 次重试之间保留了续传，一旦这 4 次都用完就
        把已收到的字节删掉，于是「下到 380MB 断了」在下次启动时退化成「从零再来」——而经
        代理的下行恰恰很少能一口气跑完 404MB，更新因此永远到不了终点。日志里带上已保留的
        字节数，下次失败时能一眼看出进度到底有没有在累积。
        """
        temporary = destination.with_suffix(destination.suffix + ".download")
        for attempt in range(1, attempts + 1):
            try:
                self._fetch(url, temporary, maximum, progress=progress)
                break
            except Exception as error:
                kept = temporary.stat().st_size if temporary.is_file() else 0
                if attempt >= attempts:
                    append_log(
                        "updater",
                        f"download gave up after {attempt} attempts, keeping {kept} bytes "
                        f"to resume from: {error}",
                    )
                    raise
                append_log(
                    "updater",
                    f"download attempt {attempt} interrupted at {kept} bytes: {error}",
                )
                time.sleep(min(2 ** attempt, 10))
        os.replace(temporary, destination)

    def _fetch(self, url, temporary, maximum, progress=None):
        offset = temporary.stat().st_size if temporary.is_file() else 0
        request = self._request(url)
        if offset:
            request.add_header("Range", f"bytes={offset}-")
        with self.opener(request, timeout=60) as response:
            status = getattr(response, "status", None)
            status = int(status) if status is not None else None
            headers = getattr(response, "headers", None)
            declared = headers.get("Content-Length") if headers is not None else None
            declared = int(declared) if isinstance(declared, str) and declared.isdigit() else None
            if status == 206 and offset:
                start = offset
            elif status == 416:
                # 服务端认为续传起点已经越界：丢掉半成品，让下一次重试从头来。
                temporary.unlink(missing_ok=True)
                raise ValueError("update package resume was refused; restarting download")
            else:
                start = 0
            if declared is not None and start + declared > maximum:
                raise ValueError("update package is too large")
            received = start
            # A partial response's Content-Length is only the length of this
            # response. Use Content-Range for the whole file; if it is absent,
            # report an unknown total instead of inventing a percentage.
            total = declared if start == 0 and status != 206 else None
            content_range = headers.get("Content-Range", "") if headers is not None else ""
            match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+|\*)", content_range.strip())
            if match and int(match.group(1)) == start and match.group(3) != "*":
                range_end, range_total = int(match.group(2)), int(match.group(3))
                if range_end >= start and range_total > range_end and (declared is None or range_end - start + 1 == declared):
                    total = range_total
            began = time.monotonic()
            last_sent = 0.0
            def publish(final=False):
                nonlocal last_sent
                now = time.monotonic()
                if not progress or (not final and last_sent and now - last_sent < .25):
                    return
                elapsed = now - began
                speed = (received - start) / elapsed if elapsed > .01 and received > start else None
                eta = (total - received) / speed if total is not None and speed and total >= received else None
                try:
                    progress({"stage": "download", "downloaded": received, "total": total,
                              "bytesPerSecond": speed, "etaSeconds": eta})
                except Exception:
                    # A closed window or failed UI callback must not corrupt a download.
                    pass
                last_sent = now
            publish(final=True)
            with temporary.open("r+b" if start else "wb") as handle:
                handle.seek(start)
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > maximum:
                        raise ValueError("update package is too large")
                    handle.write(chunk)
                    publish()
            publish(final=True)
        if declared is not None and received != start + declared:
            raise ValueError(f"update package download was cut short ({received} of {start + declared} bytes)")
        if received < 1024 * 1024:
            raise ValueError("update package is incomplete")

    def prepare(self, progress=None, route=None):
        with self.lock:
            metadata = self.check(force=True, route=route)
            if not metadata.get("available"):
                return {**metadata, "ready": False}
            directory = state_root() / "updates" / metadata["version"]
            directory.mkdir(parents=True, exist_ok=True)
            payload = directory / metadata["name"]
            expected = self._expected_checksum(metadata)
            if not payload.is_file() or self._file_hash(payload) != expected:
                payload.unlink(missing_ok=True)
                self._download(metadata["executableUrl"], payload, progress=progress)
            if progress:
                try:
                    progress({"stage": "verify"})
                except Exception:
                    pass
            if self._file_hash(payload) != expected:
                payload.unlink(missing_ok=True)
                # 走到这里说明字节数是够的（_download 已核对 Content-Length），
                # 所以不是网络截断，而是发布产物和它的 .sha256 对不上——属于发版问题。
                raise ValueError(
                    "downloaded update checksum mismatch: the release asset and its .sha256 disagree"
                )
            self.prepared = {
                "version": metadata["version"],
                "payload": payload,
                "sha256": expected,
            }
            append_log("updater", f"update {metadata['version']} verified and ready")
            return {"available": True, "ready": True, "version": metadata["version"]}

    @staticmethod
    def _helper_source():
        return r'''param(
  [Parameter(Mandatory=$true)][string]$Target,
  [Parameter(Mandatory=$true)][string]$Payload,
  [Parameter(Mandatory=$true)][string]$Backup,
  [Parameter(Mandatory=$true)][int]$CurrentPid,
  [Parameter(Mandatory=$true)][string]$ExpectedHash,
  [Parameter(Mandatory=$true)][string]$UpdateRoot,
  [Parameter(Mandatory=$true)][string]$HealthMarker,
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][string]$LogPath,
  [Parameter(Mandatory=$true)][string]$ReadyMarker,
  [string]$Version = '',
  [int]$StartSeconds = 120,
  [int]$ReadySeconds = 900
)
# pinkie-update-protocol: 2  (see the portable helper: started, then ready)
$StartedMarker = [IO.Path]::ChangeExtension($HealthMarker, '.started')
# A parent started by PowerShell 7 can pass its module paths to Windows
# PowerShell 5.1. Prefer this interpreter's own inbox modules so commands such
# as Get-FileHash and Expand-Archive cannot resolve to incompatible versions.
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules') + [IO.Path]::PathSeparator + $env:PSModulePath
$ErrorActionPreference = 'Stop'
$script:backupCreated = $false
function Write-UpdateLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}
function Write-UpdateFailure([string]$Message) {
  # The restored old version reads this once and tells the user the update
  # did not land, instead of silently coming back unchanged.
  try {
    @{ version = $Version; message = $Message; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress |
      Set-Content -LiteralPath (Join-Path $UpdateRoot 'last-failure.json') -Encoding UTF8
  } catch {}
}
function Test-UpdateWriteAccess([string]$Folder) {
  $probe = [IO.Path]::Combine($Folder, '.pinkie-write-test-' + $Token + '.tmp')
  $created = $false
  try {
    $stream = [IO.File]::Open($probe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $created = $true
    $stream.Dispose()
  } finally { if ($created) { [IO.File]::Delete($probe) } }
}
function Write-StartupFailure($Record) {
  try {
    $cause = $Record.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    $data = @{ kind = $cause.GetType().Name; hresult = $cause.HResult } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($ReadyMarker + '.error', $data, [Text.Encoding]::UTF8)
  } catch {}
}
function Restore-PreviousVersion {
  # Never delete the exe the user clicks. Rename a failed new file aside, put
  # the previous exe back on that same path, and only then delete the failed
  # one. If the previous exe cannot return, put the failed file back so the
  # desktop shortcut never points at nothing.
  $failed = $null
  if ($script:backupCreated -and (Test-Path -LiteralPath $Backup)) {
    if (Test-Path -LiteralPath $Target) {
      $failed = $Target + '.failed-' + $Token
      if (Test-Path -LiteralPath $failed) { Remove-Item -LiteralPath $failed -Force -ErrorAction SilentlyContinue }
      for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try { Move-Item -LiteralPath $Target -Destination $failed -Force; break }
        catch { if ($attempt -eq 39) { throw }; Start-Sleep -Milliseconds 250 }
      }
    }
    $restored = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      try { Move-Item -LiteralPath $Backup -Destination $Target -Force; $restored = $true; break }
      catch { if ($attempt -eq 39) { break }; Start-Sleep -Milliseconds 250 }
    }
    if (-not $restored -or -not (Test-Path -LiteralPath $Target)) {
      if (-not (Test-Path -LiteralPath $Target) -and $failed -and (Test-Path -LiteralPath $failed)) {
        try { Move-Item -LiteralPath $failed -Destination $Target -Force } catch {}
      }
      throw 'previous version is missing after rollback'
    }
    if ($failed -and (Test-Path -LiteralPath $failed)) {
      Remove-Item -LiteralPath $failed -Force -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path -LiteralPath $Target) { Start-Process -FilePath $Target | Out-Null }
}
try {
  [void](Get-Command Get-FileHash -ErrorAction Stop)
  if ($Token -notmatch '^[0-9a-f]{32}$') { throw 'invalid update token' }
  if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw 'installed executable not found' }
  if (Test-Path -LiteralPath $Backup) { throw 'update backup path already exists' }
  Test-UpdateWriteAccess ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Target)))
  [IO.File]::WriteAllText($ReadyMarker, $Token, [Text.Encoding]::ASCII)
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) { throw 'old process did not exit' }
  Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $Target -Destination $Backup
  $script:backupCreated = $true
  Move-Item -LiteralPath $Payload -Destination $Target -Force
  $actual = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedHash.ToLowerInvariant()) { throw 'installed update checksum mismatch' }
  Remove-Item -LiteralPath $StartedMarker -Force -ErrorAction SilentlyContinue
  $launched = Start-Process -FilePath $Target -ArgumentList "--update-health-token=$Token" -PassThru
  $startDeadline = (Get-Date).AddSeconds($StartSeconds)
  $readyDeadline = (Get-Date).AddSeconds($ReadySeconds)
  $started = $false
  $ready = $false
  while (-not (Test-Path -LiteralPath $HealthMarker)) {
    $launched.Refresh()
    if ($launched.HasExited) { throw "new version exited before it was ready (exit code $($launched.ExitCode))" }
    if (-not $started -and (Test-Path -LiteralPath $StartedMarker)) { $started = $true; Write-UpdateLog 'new version started; waiting for its gateway' }
    if (-not $started -and (Get-Date) -ge $startDeadline) {
      & taskkill.exe /PID $launched.Id /T /F | Out-Null
      try { Wait-Process -Id $launched.Id -Timeout 10 -ErrorAction SilentlyContinue } catch {}
      throw 'new version did not start'
    }
    if ($started -and (Get-Date) -ge $readyDeadline) { Write-UpdateLog "new version is still starting after $ReadySeconds s; keeping it"; break }
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path -LiteralPath $HealthMarker) { $ready = $true }
  # The previous exe stays until this one has actually reported ready. A slow
  # or invisible start must not erase the only copy on the desktop.
  if ($ready -and (Test-Path -LiteralPath $Target)) {
    Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StartedMarker -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $UpdateRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^[vV]?\d+(?:\.\d+){1,3}$' } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $UpdateRoot 'last-failure.json') -Force -ErrorAction SilentlyContinue
    Write-UpdateLog 'update completed'
  } else {
    Write-UpdateLog 'previous executable kept until the new version is ready'
  }
} catch {
  Write-UpdateLog "update failed, restoring previous version: $($_.Exception.Message)"
  Write-UpdateFailure $_.Exception.Message
  if (-not (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue)) {
    try { Restore-PreviousVersion }
    catch {
      Write-UpdateLog "rollback failed: $($_.Exception.Message)"
      try {
        Add-Type -AssemblyName PresentationFramework
        [void][System.Windows.MessageBox]::Show("新版没有装上，原来的程序也没能自动放回去。请到原来的位置找带 previous 的文件，把它改回原来的名字就能继续用。`n`n$($_.Exception.Message)", '超級碧琪更新', 'OK', 'Warning')
      } catch {}
    }
  } else {
    Write-StartupFailure $_
  }
}
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
'''

    @staticmethod
    def _directory_helper_source():
        """PowerShell replacer for the portable onedir package."""
        return r'''param(
  [Parameter(Mandatory=$true)][string]$TargetDir,
  [Parameter(Mandatory=$true)][string]$Payload,
  [Parameter(Mandatory=$true)][string]$Backup,
  [Parameter(Mandatory=$true)][string]$TargetExe,
  [Parameter(Mandatory=$true)][int]$CurrentPid,
  [Parameter(Mandatory=$true)][string]$ExpectedHash,
  [Parameter(Mandatory=$true)][string]$UpdateRoot,
  [Parameter(Mandatory=$true)][string]$HealthMarker,
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][string]$LogPath,
  [Parameter(Mandatory=$true)][string]$ReadyMarker,
  [Parameter(Mandatory=$true)][string]$GatewayRecord,
  [Parameter(Mandatory=$true)][int]$GatewayPort,
  [string]$Version = '',
  [int]$StartSeconds = 120,
  [int]$ReadySeconds = 900,
  [int]$SwapSeconds = 90
)
# pinkie-update-protocol: 2
# The new version reads this line from its own apply-<token>.ps1 to learn that
# this helper waits for "<token>.started" first and then, while the new process
# stays alive, for "<token>.ready".  Older helpers (2.5.27-2.5.31) only know
# "<token>.ready" and allow 120 s, which a new version's first start (per-version
# setup plus a cold gateway over freshly unpacked files that the virus scanner
# reads for the first time) can exceed; they then killed a healthy new version
# and moved the old folder back -- "updated, restarted, nothing changed".
$StartedMarker = [IO.Path]::ChangeExtension($HealthMarker, '.started')
# While this file names a live helper, starting the App shows 「正在更新」
# instead of opening the old version over a half-finished swap.
$InProgress = Join-Path $UpdateRoot 'in-progress.json'
# A parent started by PowerShell 7 can pass its module paths to Windows
# PowerShell 5.1. Prefer this interpreter's own inbox modules so commands such
# as Get-FileHash and Expand-Archive cannot resolve to incompatible versions.
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules') + [IO.Path]::PathSeparator + $env:PSModulePath
$ErrorActionPreference = 'Stop'
$script:backupCreated = $false
function Write-UpdateLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}
function Write-UpdateFailure([string]$Message) {
  # The restored old version reads this once and tells the user the update
  # did not land, instead of silently coming back unchanged.
  try {
    @{ version = $Version; message = $Message; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress |
      Set-Content -LiteralPath (Join-Path $UpdateRoot 'last-failure.json') -Encoding UTF8
  } catch {}
}
# The App window is gone during the swap. A small always-on-top window shows
# each step so the user knows the update is still running and when it is done.
$ProgressFile = Join-Path $UpdateRoot ('progress-' + $Token + '.json')
$ProgressScript = Join-Path $UpdateRoot ('progress-' + $Token + '.ps1')
function Set-UpdateProgress([int]$Step, [string]$Text, [string]$State = 'running') {
  try {
    @{ step = $Step; total = 5; text = $Text; state = $State } | ConvertTo-Json -Compress |
      Set-Content -LiteralPath $ProgressFile -Encoding UTF8
  } catch {}
}
function Start-UpdateProgressWindow {
  try {
    $source = @'
param([string]$Status, [int]$Owner, [string]$Version)
Add-Type -AssemblyName PresentationFramework
$window = New-Object Windows.Window
$window.Title = '超級碧琪更新'; $window.Width = 400; $window.SizeToContent = 'Height'
$window.WindowStartupLocation = 'CenterScreen'; $window.Topmost = $true
$window.ResizeMode = 'NoResize'; $window.WindowStyle = 'ToolWindow'
$panel = New-Object Windows.Controls.StackPanel; $panel.Margin = '22,18,22,18'
$title = New-Object Windows.Controls.TextBlock; $title.FontSize = 15; $title.FontWeight = 'SemiBold'
$title.Text = if ($Version) { "碧琪正在更新到 $Version" } else { '碧琪正在更新' }
$line = New-Object Windows.Controls.TextBlock; $line.Margin = '0,10,0,0'; $line.TextWrapping = 'Wrap'; $line.Text = '正在准备…'
$bar = New-Object Windows.Controls.ProgressBar; $bar.Height = 8; $bar.Minimum = 0; $bar.Maximum = 100; $bar.Margin = '0,12,0,8'
$hint = New-Object Windows.Controls.TextBlock; $hint.Foreground = 'Gray'; $hint.TextWrapping = 'Wrap'
$hint.Text = '请不要点击桌面上的碧琪，也不要关机。换好后会自己打开。记忆和设置不会丢。'
foreach ($node in @($title, $line, $bar, $hint)) { [void]$panel.Children.Add($node) }
$window.Content = $panel
$started = Get-Date
$closeAt = $null
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(500)
$timer.Add_Tick({
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  try {
    $data = Get-Content -LiteralPath $Status -Raw -Encoding UTF8 | ConvertFrom-Json
    $line.Text = "第 $($data.step)/$($data.total) 步：$($data.text)（已用 $seconds 秒）"
    $bar.Value = [Math]::Min(100, [double]$data.step / [double]$data.total * 100)
  } catch {}
  # Stay up until the replacer itself exits. Closing when the status flips
  # made people click the desktop icon while the exe was still being moved,
  # and Windows then said the program had been deleted.
  $ownerAlive = $false
  try { $ownerAlive = [bool](Get-Process -Id $Owner -ErrorAction SilentlyContinue) } catch {}
  if (-not $ownerAlive -and -not $script:closeAt) { $script:closeAt = (Get-Date).AddSeconds(8) }
  if ($script:closeAt -and (Get-Date) -ge $script:closeAt) { $window.Close() }
  if ($seconds -gt 1200) { $window.Close() }
})
$timer.Start()
[void]$window.ShowDialog()
Remove-Item -LiteralPath $Status -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
'@
    [IO.File]::WriteAllText($ProgressScript, $source, (New-Object Text.UTF8Encoding $true))
    Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', ('"' + $ProgressScript + '"'),
      '-Status', ('"' + $ProgressFile + '"'), '-Owner', $PID, '-Version', ('"' + $Version + '"')) | Out-Null
  } catch { Write-UpdateLog "could not show update progress: $($_.Exception.Message)" }
}
function Test-UpdateWriteAccess([string]$Folder) {
  $probe = [IO.Path]::Combine($Folder, '.pinkie-write-test-' + $Token + '.tmp')
  $created = $false
  try {
    $stream = [IO.File]::Open($probe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $created = $true
    $stream.Dispose()
  } finally { if ($created) { [IO.File]::Delete($probe) } }
}
function Show-UpdateProblem([string]$Text) {
  # Last resort when no App window will come back to explain what happened.
  try {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show($Text, '超級碧琪更新', 'OK', 'Warning')
  } catch { Write-UpdateLog "could not show update problem: $($_.Exception.Message)" }
}
function Invoke-WithRetry([scriptblock]$Action, [string]$What, [int]$Seconds) {
  # Windows refuses to rename a folder while any file inside is open. Right
  # after a 30,000-file unpack, the virus scanner, the search indexer or a
  # OneDrive/Desktop sync client routinely holds some of them for a while.
  $deadline = (Get-Date).AddSeconds($Seconds)
  $logged = $false
  while ($true) {
    try { & $Action; return }
    catch {
      if ((Get-Date) -ge $deadline) { throw "$What is still in use: $($_.Exception.Message)" }
      if (-not $logged) { Write-UpdateLog "$What is busy, retrying: $($_.Exception.Message)"; $logged = $true }
      Start-Sleep -Milliseconds 500
    }
  }
}
function Write-StartupFailure($Record) {
  try {
    $cause = $Record.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    $details = @{ kind = $cause.GetType().Name; hresult = $cause.HResult }
    if ($cause.Message -eq 'gateway-owned-by-another-app') { $details.reason = 'gateway-owned-by-another-app' }
    $data = $details | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($ReadyMarker + '.error', $data, [Text.Encoding]::UTF8)
  } catch {}
}
function Stop-InstallProcesses([string]$Root) {
  # The window keeps its gateway (node.exe from runtime\bin) alive after it
  # closes. Windows may even rename the folder while the old gateway keeps
  # serving the old UI, so stop only processes owned by this install first.
  if (-not (Test-Path -LiteralPath $Root)) { return }
  $prefix = (Get-Item -LiteralPath $Root).FullName.TrimEnd('\') + '\'
  for ($round = 0; $round -lt 20; $round++) {
    # A failed process query is not evidence that there are no old processes.
    $owned = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
      $_.ProcessId -ne $PID -and $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($owned.Count -eq 0) { return }
    if ($round -eq 0) {
      Write-UpdateLog ('stopping processes still running from the install: ' + (($owned | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', '))
    }
    foreach ($process in $owned) {
      # Do not kill unrelated child processes merely because a gateway or
      # relay launched them. Every PID stopped here must itself be in Root.
      try { & taskkill.exe /PID $process.ProcessId /F | Out-Null } catch {}
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'processes from the old version are still running'
}
function Get-GatewayListeners {
  # Query all listeners before filtering: -LocalPort reports an error when
  # there is no listener, whereas an empty result here means the port is free.
  @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {
    $_.LocalPort -eq $GatewayPort
  } | Select-Object -ExpandProperty OwningProcess -Unique)
}
function Get-VerifiedGateway([int]$GatewayId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$GatewayId" -ErrorAction Stop
  if (-not $process -or -not $process.ExecutablePath) { throw 'gateway-owned-by-another-app' }
  $prefix = (Get-Item -LiteralPath $TargetDir).FullName.TrimEnd('\') + '\'
  if ($process.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $process }

  # A previous copy can leave its gateway behind. Only its recorded listener
  # with the expected bundled node executable and gateway arguments is ours.
  try { $owner = Get-Content -LiteralPath $GatewayRecord -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'gateway-owned-by-another-app' }
  $pattern = '(?i)(?:^|[\\/\s"])openclaw\.mjs"?(?:\s+)gateway(?:\s+)run(?:\s+)--port(?:\s+)' +
    [regex]::Escape([string]$GatewayPort) + '(?:\s|$)'
  if (-not $owner -or $owner.pid -ne $GatewayId -or -not $owner.node -or
      -not [string]::Equals([string]$owner.node, $process.ExecutablePath, [System.StringComparison]::OrdinalIgnoreCase) -or
      $process.ExecutablePath -notmatch '(?i)[\\/]runtime[\\/]bin[\\/]node\.exe$' -or
      -not $process.CommandLine -or $process.CommandLine -notmatch $pattern) {
    throw 'gateway-owned-by-another-app'
  }
  return $process
}
function Confirm-GatewayOwnership {
  foreach ($gatewayId in @(Get-GatewayListeners)) { [void](Get-VerifiedGateway $gatewayId) }
}
function Stop-VerifiedGateway {
  for ($round = 0; $round -lt 20; $round++) {
    $listeners = @(Get-GatewayListeners)
    if ($listeners.Count -eq 0) { return }
    foreach ($gatewayId in $listeners) {
      $info = Get-VerifiedGateway $gatewayId
      # Get-Process pins a process handle; checking its image again also avoids
      # stopping a different process if a listener PID changed during lookup.
      $running = Get-Process -Id $gatewayId -ErrorAction Stop
      [void]$running.Handle
      if (-not [string]::Equals($running.MainModule.FileName, $info.ExecutablePath, [System.StringComparison]::OrdinalIgnoreCase) -or
          ($running.StartTime.ToUniversalTime() - $info.CreationDate.ToUniversalTime()).Duration().TotalSeconds -gt 1) {
        throw 'gateway-owned-by-another-app'
      }
      Write-UpdateLog ('stopping verified old gateway #' + $gatewayId)
      $running.Kill()
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'old gateway port is still in use'
}
function Confirm-NewInstallGateway {
  # A different App or watchdog can revive an older gateway while the new
  # window is opening. A window health marker alone can come from that old UI.
  $prefix = (Get-Item -LiteralPath $TargetDir).FullName.TrimEnd('\') + '\'
  $listeners = @(Get-GatewayListeners)
  if ($listeners.Count -eq 0) { throw 'new gateway is not listening' }
  foreach ($gatewayId in $listeners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$gatewayId" -ErrorAction Stop
    if (-not $process -or -not $process.ExecutablePath -or
        -not $process.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw 'new version attached to a different install gateway'
    }
  }
}
function Copy-PreviousVersion {
  # Fallback when the previous folder cannot be renamed back. Returns $true
  # only when a complete copy (with its exe) is in place at $TargetDir.
  if (Test-Path -LiteralPath $TargetDir) { return $false }
  $copying = $TargetDir.TrimEnd('\') + '.restoring-' + $Token
  try {
    Remove-Item -LiteralPath $copying -Recurse -Force -ErrorAction SilentlyContinue
    & robocopy.exe $Backup $copying /E /COPY:DAT /R:5 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) { throw "robocopy exit code $code" }
    if (-not (Test-Path -LiteralPath (Join-Path $copying (Split-Path -Leaf $TargetExe)) -PathType Leaf)) { throw 'copied version has no exe' }
    # The copy was made beside the target; this rename touches only new files.
    Invoke-WithRetry { Move-Item -LiteralPath $copying -Destination $TargetDir } 'copied previous version' 30
    Write-UpdateLog "previous version restored by copy; the original stays at $Backup"
    return $true
  } catch {
    Write-UpdateLog "copying the previous version failed: $($_.Exception.Message)"
    Remove-Item -LiteralPath $copying -Recurse -Force -ErrorAction SilentlyContinue
    return $false
  }
}
function Restore-PreviousVersion {
  # Put the previous folder back BEFORE deleting anything. Deleting the new
  # copy first left the desktop path empty: the shortcut said the program had
  # been deleted, and a failed move then removed the only remaining exe.
  $failed = $null
  if ($script:backupCreated -and (Test-Path -LiteralPath $Backup)) {
    if (Test-Path -LiteralPath $TargetDir) {
      # Move the failed copy aside instead of deleting it in place: a rename
      # either happens completely or not at all, so a half-deleted tree can
      # never be left where the user starts the App.
      $failed = $TargetDir.TrimEnd('\') + '.failed-' + $Token
      Invoke-WithRetry { try { Stop-InstallProcesses $TargetDir } catch {}; Move-Item -LiteralPath $TargetDir -Destination $failed } 'new install folder' $SwapSeconds
    }
    try {
      Invoke-WithRetry { try { Stop-InstallProcesses $Backup } catch {}; Move-Item -LiteralPath $Backup -Destination $TargetDir } 'previous version folder' $SwapSeconds
    } catch {
      Write-UpdateLog "rename back failed, copying the previous version instead: $($_.Exception.Message)"
      # A scanner, indexer or a stray child process can keep a handle in the
      # previous folder for minutes, which blocks a rename but not reading.
      # Copying it back leaves the user a working App on the same path.
      if (-not (Copy-PreviousVersion)) {
        if (-not (Test-Path -LiteralPath $TargetDir) -and $failed -and (Test-Path -LiteralPath $failed)) {
          try { Move-Item -LiteralPath $failed -Destination $TargetDir -Force } catch {}
        }
        throw
      }
    }
    if ((Test-Path -LiteralPath $TargetExe) -and $failed) {
      Remove-Item -LiteralPath $failed -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $InProgress -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $TargetExe) { Start-Process -FilePath $TargetExe | Out-Null }
  else { throw 'previous version is missing after rollback' }
}
try {
  [void](Get-Command Get-FileHash -ErrorAction Stop)
  [void](Get-Command Get-CimInstance -ErrorAction Stop)
  [void](Get-Command Get-NetTCPConnection -ErrorAction Stop)
  [void](Get-Command Expand-Archive -ErrorAction Stop)
  if ($Token -notmatch '^[0-9a-f]{32}$') { throw 'invalid update token' }
  if ($GatewayPort -lt 1 -or $GatewayPort -gt 65535) { throw 'invalid gateway port' }
  if (-not (Test-Path -LiteralPath $TargetDir -PathType Container)) { throw 'installed directory not found' }
  if (-not (Test-Path -LiteralPath $TargetExe -PathType Leaf)) { throw 'installed executable not found' }
  if (Test-Path -LiteralPath $Backup) { throw 'update backup path already exists' }
  Test-UpdateWriteAccess ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($TargetDir).TrimEnd('\')))
  Confirm-GatewayOwnership
  @{ pid = $PID; version = $Version; token = $Token } | ConvertTo-Json -Compress |
    Set-Content -LiteralPath $InProgress -Encoding UTF8
  Set-UpdateProgress 1 '正在关闭旧版本'
  Start-UpdateProgressWindow
  [IO.File]::WriteAllText($ReadyMarker, $Token, [Text.Encoding]::ASCII)
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) { throw 'old process did not exit' }
  Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
  Set-UpdateProgress 2 '正在核对更新包'
  # 先验包、再动安装目录：包一旦损坏，展开和替换都不该发生。
  $actual = (Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedHash.ToLowerInvariant()) { throw 'update package checksum mismatch' }
  # Unpack under the App's own data folder when it is on the same drive, so
  # the final swap is still a rename but a Desktop/OneDrive/Documents install
  # does not get 30,000 temporary files synced or indexed next to it.
  $installParent = Split-Path -Parent ([IO.Path]::GetFullPath($TargetDir).TrimEnd('\'))
  $stageParent = $installParent
  if ([string]::Equals([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($UpdateRoot)),
                       [IO.Path]::GetPathRoot($installParent), [System.StringComparison]::OrdinalIgnoreCase)) {
    $stageParent = $UpdateRoot
  }
  $script:stage = Join-Path $stageParent ('.pinkie-stage-' + $Token)
  $stage = $script:stage
  if (Test-Path -LiteralPath $stage) { throw 'update staging path already exists' }
  # This helper has no visible PowerShell window. Per-entry console progress
  # adds substantial overhead for the tens of thousands of portable files;
  # suppress only that hidden process's progress records, not App effects.
  $ProgressPreference = 'SilentlyContinue'
  # The window is already closed here, so every second counts. ZipFile is
  # several times faster than Windows PowerShell 5.1's Expand-Archive on
  # ~30,000 entries (2-3 minutes on CI); Expand-Archive stays as a fallback.
  Set-UpdateProgress 3 '正在解压新版本，大约需要一分钟'
  $unpackStarted = Get-Date
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Payload, $stage)
  } catch {
    Write-UpdateLog "fast unpack failed, using Expand-Archive: $($_.Exception.Message)"
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    Expand-Archive -LiteralPath $Payload -DestinationPath $stage -Force
  }
  Write-UpdateLog ('unpacked in ' + [int]((Get-Date) - $unpackStarted).TotalSeconds + ' s')
  $newDir = Join-Path $stage '超級碧琪'
  if (-not (Test-Path -LiteralPath (Join-Path $newDir '超級碧琪.exe'))) { throw 'portable package layout is invalid' }
  Set-UpdateProgress 4 '正在替换文件'
  Stop-InstallProcesses $TargetDir
  Stop-VerifiedGateway
  Invoke-WithRetry {
    Stop-InstallProcesses $TargetDir
    Move-Item -LiteralPath $TargetDir -Destination $Backup
    $script:backupCreated = $true
  } 'install folder' $SwapSeconds
  # This rename used to have no retry at all: one file of the fresh unpack
  # still open in the virus scanner failed the whole update and rolled back.
  Invoke-WithRetry { Move-Item -LiteralPath $newDir -Destination $TargetDir } 'unpacked new version' $SwapSeconds
  if (-not (Test-Path -LiteralPath $TargetExe -PathType Leaf)) { throw 'new version is missing after the swap' }
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $StartedMarker -Force -ErrorAction SilentlyContinue
  Set-UpdateProgress 5 '正在启动新版本'
  $launched = Start-Process -FilePath $TargetExe -ArgumentList "--update-health-token=$Token" -PassThru
  $startDeadline = (Get-Date).AddSeconds($StartSeconds)
  $readyDeadline = (Get-Date).AddSeconds($ReadySeconds)
  $started = $false
  $ready = $false
  while ($true) {
    if (Test-Path -LiteralPath $HealthMarker) { $ready = $true; break }
    $launched.Refresh()
    if ($launched.HasExited) { throw "new version exited before it was ready (exit code $($launched.ExitCode))" }
    if (-not $started -and (Test-Path -LiteralPath $StartedMarker)) {
      $started = $true
      Write-UpdateLog 'new version started; waiting for its gateway'
      # .started only means the process is up. The window may still be coming.
      # Telling people it is already open made them click the desktop icon
      # while the folder was still being swapped.
      Set-UpdateProgress 5 '新版本正在打开，请不要点击桌面上的图标' 'running'
    }
    if (-not $started -and (Get-Date) -ge $startDeadline) {
      & taskkill.exe /PID $launched.Id /T /F | Out-Null
      throw 'new version did not start'
    }
    # A new version that is running from the new folder is never killed just
    # for being slow: rolling it back cannot make the next start any faster.
    if ($started -and (Get-Date) -ge $readyDeadline) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($ready -and (Test-Path -LiteralPath $TargetExe)) {
    Confirm-NewInstallGateway
    Set-UpdateProgress 5 '新版已经打开' 'done'
    Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $StartedMarker -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $UpdateRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^[vV]?\d+(?:\.\d+){1,3}$' } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $UpdateRoot 'last-failure.json') -Force -ErrorAction SilentlyContinue
    Write-UpdateLog 'portable update completed'
  } else {
    Write-UpdateLog "new version is still starting after $ReadySeconds s; keeping it"
    Write-UpdateLog 'previous folder kept until the new version is ready'
  }
} catch {
  Write-UpdateLog "portable update failed, restoring previous version: $($_.Exception.Message)"
  Set-UpdateProgress 5 '这次没装上，正在恢复原来的版本' 'failed'
  Write-UpdateFailure $_.Exception.Message
  if (-not (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue)) {
    try { Restore-PreviousVersion }
    catch {
      Write-UpdateLog "rollback failed: $($_.Exception.Message)"
      $where = if (Test-Path -LiteralPath $Backup) { "原来的版本保存在：`n$Backup`n把这个文件夹改回「$(Split-Path -Leaf $TargetDir)」就能继续用。" } else { '请重新下载便携版。' }
      Show-UpdateProblem ("新版 $Version 没有装上，自动恢复也没有完成。`n$where`n记忆和设置都在，不受影响。`n`n详细记录：$LogPath")
    }
  } else {
    Write-StartupFailure $_
  }
  if ($script:stage) { Remove-Item -LiteralPath $script:stage -Recurse -Force -ErrorAction SilentlyContinue }
}
Remove-Item -LiteralPath $InProgress -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
'''

    @staticmethod
    def take_last_failure():
        """Read once what the replacer left behind when it rolled an update back."""
        path = state_root() / "updates" / "last-failure.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            return None
        finally:
            try:
                path.unlink()
            except OSError:
                pass
        return value if isinstance(value, dict) else None

    @staticmethod
    def _wait_for_replacer(process, ready_marker, token, timeout=20.0):
        """Keep the App open unless the exact helper confirms it can run."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                ready = ready_marker.read_text(encoding="ascii").strip() == token
            except (OSError, UnicodeError):
                ready = False
            if process.poll() is not None:
                return False
            if ready:
                try:
                    ready_marker.unlink()
                except OSError:
                    pass
                return True
            time.sleep(.1)
        # A delayed helper must not run an update later after the user closes
        # the App for an unrelated reason. This is our own child process.
        try:
            process.terminate()
            process.wait(timeout=5)
        except (OSError, subprocess.SubprocessError):
            pass
        return False

    def launch_replacer(self):
        with self.lock:
            if not self.prepared:
                return {"started": False, "message": "新版还没有准备好"}
            payload = Path(self.prepared["payload"])
            expected = self.prepared["sha256"]
            if not payload.is_file() or self._file_hash(payload) != expected:
                return {"started": False, "message": "新版校验失效，请重新下载"}
            token = uuid.uuid4().hex
            update_root = state_root() / "updates"
            health_root = update_root / "health"
            health_root.mkdir(parents=True, exist_ok=True)
            # Windows PowerShell 5.1 reads a .ps1 without a BOM in the ANSI code
            # page (GBK on Chinese Windows), which garbled the hard-coded
            # 超級碧琪 folder name: every portable update failed its layout
            # check and rolled back.  The BOM makes it read UTF-8.
            helper = update_root / f"apply-{token}.ps1"
            marker = health_root / f"{token}.ready"
            ready_marker = health_root / f"{token}.helper-ready"
            if self.portable:
                target_dir = self.executable.parent
                backup = target_dir.with_name(target_dir.name + ".previous-" + token)
                helper.write_text(self._directory_helper_source(), encoding="utf-8-sig")
                command = [
                    "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                    "-File", str(helper),
                    "-TargetDir", str(target_dir),
                    "-Payload", str(payload),
                    "-Backup", str(backup),
                    "-TargetExe", str(self.executable),
                    "-CurrentPid", str(os.getpid()),
                    "-ExpectedHash", expected,
                    "-UpdateRoot", str(update_root),
                    "-HealthMarker", str(marker),
                    "-Token", token,
                    "-LogPath", str(state_root() / "logs/updater.log"),
                    "-ReadyMarker", str(ready_marker),
                    "-GatewayRecord", str(state_root() / "gateway-owner.json"),
                    "-GatewayPort", str(urllib.parse.urlparse(GATEWAY_URL).port or 18789),
                    "-Version", str(self.prepared["version"]),
                    "-StartSeconds", str(int(self.health_start_seconds)),
                    "-ReadySeconds", str(int(self.health_ready_seconds)),
                    "-SwapSeconds", str(int(self.swap_seconds)),
                ]
            else:
                backup = self.executable.with_name(self.executable.stem + ".previous-" + token + self.executable.suffix)
                helper.write_text(self._helper_source(), encoding="utf-8-sig")
                command = [
                "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-File", str(helper),
                "-Target", str(self.executable),
                "-Payload", str(payload),
                "-Backup", str(backup),
                "-CurrentPid", str(os.getpid()),
                "-ExpectedHash", expected,
                "-UpdateRoot", str(update_root),
                "-HealthMarker", str(marker),
                "-Token", token,
                "-LogPath", str(state_root() / "logs/updater.log"),
                "-ReadyMarker", str(ready_marker),
                "-Version", str(self.prepared["version"]),
                "-StartSeconds", str(int(self.health_start_seconds)),
                "-ReadySeconds", str(int(self.health_ready_seconds)),
                ]
            try:
                process = subprocess.Popen(
                    command,
                    cwd=str(update_root),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    close_fds=True,
                    **hidden_process_kwargs(),
                )
            except OSError as error:
                append_log("updater", f"cannot launch update helper: {error}")
                return {"started": False, "message": "更新程序没有启动，请稍后再试"}
            if not self._wait_for_replacer(process, ready_marker, token):
                append_log("updater", "update helper did not become ready; keeping the current window open")
                failure_marker = Path(str(ready_marker) + ".error")
                permission_denied = False
                gateway_conflict = False
                try:
                    failure = json.loads(failure_marker.read_text(encoding="utf-8-sig"))
                    gateway_conflict = failure.get("reason") == "gateway-owned-by-another-app"
                    permission_denied = (failure.get("kind") in ("UnauthorizedAccessException", "SecurityException") or
                                         int(failure.get("hresult", 0)) & 0xffffffff == 0x80070005)
                except (OSError, ValueError, TypeError, AttributeError):
                    pass
                finally:
                    try:
                        failure_marker.unlink()
                    except OSError:
                        pass
                message = ("更新程序无法写入安装目录，请确认 Windows 管理员授权或检查目录权限；当前版本仍在运行"
                           if permission_denied else
                           "网关端口被其他程序占用，无法安全更新；请先关闭占用该端口的程序，当前版本仍在运行"
                           if gateway_conflict else
                           "更新程序没有准备好，当前版本仍在运行，请稍后再试")
                return {"started": False, "message": message}
            append_log("updater", f"switching to {self.prepared['version']}")
            return {"started": True, "version": self.prepared["version"]}


def hidden_process_kwargs(hide_window=True):
    """Keep a helper's console out of sight, on the platforms that have one.

    creationflags is Windows-only; CREATE_NO_WINDOW does not exist elsewhere, so
    reading it unconditionally made every caller raise AttributeError off
    Windows instead of simply launching the helper.
    """
    if os.name != "nt":
        return {}
    flags = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW}
    if not hide_window:
        return flags  # Explorer/control-center windows are intentional UI.
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    return {**flags, "startupinfo": startup}


def native_corner_geometry(width, height, dpi, maximized=False):
    if maximized or width <= 0 or height <= 0:
        return None
    # The shared HTML shell has a 22 CSS-pixel outer radius. HWND regions use
    # physical pixels; the real test machine is at 125%, not 96 DPI.
    diameter = round(44 * dpi / 96)
    return (0, 0, width + 1, height + 1, diameter, diameter)


def configure_native_corners(window):
    """Clip the HWND as well as HTML, including resize/DPI/maximize changes."""
    if os.name != "nt":
        return
    import ctypes

    class Rect(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int32) for name in ("left", "top", "right", "bottom")]

    user = ctypes.WinDLL("user32", use_last_error=True)
    gdi = ctypes.WinDLL("gdi32", use_last_error=True)
    user.GetClientRect.argtypes = [ctypes.c_void_p, ctypes.POINTER(Rect)]
    user.GetClientRect.restype = ctypes.c_int32
    user.GetDpiForWindow.argtypes = [ctypes.c_void_p]
    user.GetDpiForWindow.restype = ctypes.c_uint32
    user.IsZoomed.argtypes = [ctypes.c_void_p]
    user.IsZoomed.restype = ctypes.c_int32
    user.SetWindowRgn.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int32]
    user.SetWindowRgn.restype = ctypes.c_int32
    gdi.CreateRoundRectRgn.argtypes = [ctypes.c_int32] * 6
    gdi.CreateRoundRectRgn.restype = ctypes.c_void_p
    gdi.DeleteObject.argtypes = [ctypes.c_void_p]
    gdi.DeleteObject.restype = ctypes.c_int32
    native = window.native
    handle = int(native.Handle.ToInt64())
    last = []

    def apply(*_):
        rect = Rect()
        if not user.GetClientRect(handle, ctypes.byref(rect)):
            raise ctypes.WinError(ctypes.get_last_error())
        geometry = native_corner_geometry(rect.right, rect.bottom, user.GetDpiForWindow(handle) or 96,
                                          bool(user.IsZoomed(handle)))
        if last == [geometry]:
            return
        region = gdi.CreateRoundRectRgn(*geometry) if geometry else None
        if geometry and not region:
            raise ctypes.WinError(ctypes.get_last_error())
        if not user.SetWindowRgn(handle, region, True):
            if region:
                gdi.DeleteObject(region)
            raise ctypes.WinError(ctypes.get_last_error())
        # Windows owns the region after SetWindowRgn succeeds. Deleting it
        # here would invalidate the active clipping mask.
        last[:] = [geometry]

    def changed(*_):
        try:
            apply()
        except Exception as error:
            append_log("launcher", f"native corner update failed: {error}")

    native.Resize += changed
    if hasattr(native, "DpiChanged"):
        native.DpiChanged += changed
    window._pinkie_corner_handler = changed  # Keep the managed event delegate alive.
    apply()
    append_log("launcher", "native corners enabled: 22 CSS px; physical-DPI HWND region; square only when maximized")


def configure_native_glass(window):
    """Make the host transparent too, before its first paint on the GUI thread.

    A transparent HTML body over an opaque WinForms background still renders
    as a solid pink sheet. Give WebView2 an alpha-zero base and extend DWM's
    glass over the whole client area. Keep the window/text alpha at 100%.
    """
    if os.name != "nt":
        return
    import ctypes
    from System.Drawing import Color

    class Margins(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int32) for name in ("left", "right", "top", "bottom")]

    native = window.native
    native.BackColor = Color.Black  # DWM's zero-alpha client canvas.
    native.webview.DefaultBackgroundColor = Color.Transparent
    dwm = ctypes.WinDLL("dwmapi", use_last_error=True)
    extend = dwm.DwmExtendFrameIntoClientArea
    extend.argtypes = [ctypes.c_void_p, ctypes.POINTER(Margins)]
    extend.restype = ctypes.c_int32
    margins = Margins(-1, -1, -1, -1)
    handle = int(native.Handle.ToInt64())
    result = extend(handle, ctypes.byref(margins))
    if result < 0:
        raise OSError(f"DwmExtendFrameIntoClientArea failed: 0x{result & 0xffffffff:08x}")
    # pywebview's dark-theme default requests Mica. That would fill the clear
    # canvas again. Use desktop transparency, matching Mac, in either theme.
    # Windows 10 does not implement this Windows 11 attribute; full glass
    # above remains in effect there.
    attribute = dwm.DwmSetWindowAttribute
    attribute.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
    attribute.restype = ctypes.c_int32
    backdrop_none = ctypes.c_int32(1)  # DWMWA_SYSTEMBACKDROP_TYPE / DWMSBT_NONE
    attribute(handle, 38, ctypes.byref(backdrop_none), ctypes.sizeof(backdrop_none))
    append_log("launcher", "native glass enabled: WebView2 alpha=0; DWM full client; window alpha=1")


class BundledRuntime:
    def __init__(self, root):
        self.root = Path(root)
        self.runtime = self.root / "runtime"
        self.node = self.runtime / "bin/node.exe"
        self.openclaw = self.runtime / "node_modules/openclaw/openclaw.mjs"

    def valid(self):
        return self.node.is_file() and self.openclaw.is_file()

    def environment(self):
        environment = os.environ.copy()
        environment["PATH"] = str(self.runtime / "bin") + os.pathsep + environment.get("PATH", "")
        environment["OPENCLAW_ROOT"] = str(self.openclaw.parent)
        environment["PINKIE_NODE_BIN"] = str(self.node)
        environment["PINKIE_OPENCLAW_ENTRY"] = str(self.openclaw)
        skills = self.root / "bundled-skills"
        if skills.is_dir():
            environment["PINKIE_MANAGED_SKILLS_DIR"] = str(skills)
        else:
            environment.pop("PINKIE_MANAGED_SKILLS_DIR", None)
        environment["PINKIE_MANAGED_GATEWAY"] = "1"
        # The private loopback gateway belongs to this desktop user. Keep all
        # registered tools available in every CLE Kk mode; upstream's
        # non-owner sender filter is intended for shared/public gateways.
        environment["CLE_KK_LOCAL_UNRESTRICTED"] = "1"
        environment["PINKIE_RUNTIME_CONFIG_SCHEMA"] = "2026.7"
        environment["PINKIE_GATEWAY_URL"] = GATEWAY_URL
        environment["PINKIE_STATE_ROOT"] = str(state_root())
        # A packaged CLE Kk runtime is updated only by its signed release
        # updater. Never let the embedded upstream runtime advertise or apply
        # an unrelated OpenClaw/Cua update behind that boundary.
        environment["OPENCLAW_NO_AUTO_UPDATE"] = "1"
        environment["CUA_DRIVER_RS_UPDATE_CHECK"] = "false"
        environment["CUA_DRIVER_RS_TELEMETRY_ENABLED"] = "false"
        environment["PYTHONUTF8"] = "1"
        environment.pop("CLAUDECODE", None)
        # A proxy exported without a NO_PROXY exemption sent every call for
        # the local model relay (127.0.0.1) through the proxy, and each one
        # failed with "network connection error" (11-04 on the Mac). Loopback
        # never goes through a proxy. Windows variable names are case-blind,
        # so one NO_PROXY entry also answers node's process.env.no_proxy.
        entries = [e for e in re.split(r"[,\s]+", environment.get("NO_PROXY", "")) if e]
        for host in ("localhost", "127.0.0.1", "::1"):
            if host not in (e.lower() for e in entries):
                entries.append(host)
        environment["NO_PROXY"] = ",".join(entries)
        return environment


class GatewaySupervisor:
    def __init__(self, runtime):
        self.runtime = runtime
        self.process = None
        self.closing = threading.Event()
        self.lock = threading.RLock()
        self.last_restart = 0.0
        self.failure_limit = 2
        self.version = app_version(runtime.root)

    @staticmethod
    def _record_path():
        return state_root() / "gateway-owner.json"

    def _write_record(self, pid):
        try:
            path = self._record_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"pid": pid, "version": self.version, "node": str(self.runtime.node)}), encoding="utf-8")
        except OSError as error:
            append_log("launcher", f"gateway owner record not written: {error}")

    @staticmethod
    def _listener():
        pid = gateway_listener_pid()
        if not pid:
            return None
        image, started = process_image_and_start(pid)
        return {"pid": pid, "image": image, "started": started}

    def retire_stale(self, kill=None, wait=10.0):
        """Stop a kept-alive gateway left by another version before attaching.

        Runs before the window picks its first URL, so a stale gateway's page
        is never shown.  Returns the reason when a gateway was retired.
        """
        if not http_ready(GATEWAY_URL):
            return None
        listener = self._listener()
        if not listener:
            return None
        pid, image = listener["pid"], listener.get("image")
        try:
            record = json.loads(self._record_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            record = None
        try:
            install_time = (self.runtime.root / "VERSION").stat().st_ctime
        except OSError:
            install_time = None
        reason = stale_gateway_reason(listener, self.runtime.node, self.version, install_time, record)
        if not reason:
            if image and os.path.normcase(str(image)) == os.path.normcase(str(self.runtime.node)) and (
                not isinstance(record, dict) or record.get("pid") != pid
            ):
                self._write_record(pid)
            return None
        append_log("launcher", f"retiring stale gateway: {reason}")
        try:
            (kill or (lambda value: subprocess.run(
                ["taskkill", "/PID", str(value), "/T", "/F"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=8,
                **hidden_process_kwargs(),
            )))(pid)
        except (OSError, subprocess.SubprocessError) as error:
            append_log("launcher", f"stale gateway could not be stopped: {error}")
            return None
        deadline = time.monotonic() + wait
        while time.monotonic() < deadline and http_ready(GATEWAY_URL):
            time.sleep(.2)
        return reason

    def start(self):
        with self.lock:
            if http_ready(GATEWAY_URL):
                return
            if self.process and self.process.poll() is None:
                return
            if time.monotonic() - self.last_restart < 2:
                return
            self.last_restart = time.monotonic()
            log_dir = state_root() / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            output = (log_dir / "gateway.log").open("ab")
            command = [
                str(self.runtime.node), str(self.runtime.openclaw),
                "gateway", "run", "--port", "18789", "--bind", "loopback", "--auth", "none", "--allow-unconfigured",
            ]
            try:
                gateway_environment = self.runtime.environment()
                gateway_environment["OPENCLAW_SERVICE_KIND"] = "gateway"
                self.process = subprocess.Popen(
                    command,
                    cwd=str(self.runtime.openclaw.parent),
                    env=gateway_environment,
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=output,
                    **hidden_process_kwargs(),
                )
                append_log("launcher", f"gateway started pid={self.process.pid}")
                self._write_record(self.process.pid)
            except OSError as error:
                output.close()
                append_log("launcher", f"gateway start failed: {error}")

    def wait_ready(self, seconds=126):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and not self.closing.is_set():
            if http_ready(GATEWAY_URL):
                return True
            self.start()
            time.sleep(.2)
        return False

    def monitor(self):
        failures = 0
        while not self.closing.wait(.75):
            with self.lock:
                process = self.process
                alive = bool(process and process.poll() is None)
            if http_ready(GATEWAY_URL):
                failures = 0
                continue
            # A freshly copied onedir runtime may be scanned by Defender while
            # Node imports thousands of files. On slower disks this can exceed
            # any fixed grace period. Never kill a still-live Gateway merely
            # because HTTP is not ready: doing so at 90s restarted cold startup
            # from zero and made Windows appear much slower than macOS.
            if alive:
                failures = 0
                continue
            failures += 1
            if failures >= self.failure_limit:
                failures = 0
                if alive:
                    self.stop_process()
                self.start()

    def stop_process(self):
        with self.lock:
            process = self.process
            self.process = None
        if not process or process.poll() is not None:
            return
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except (OSError, subprocess.SubprocessError):
            process.kill()

    def close(self):
        self.closing.set()
        self.stop_process()


def load_file_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def relay_command(port, upstream):
    """The argv that re-runs this application as the relay process.

    The frozen build ships no Python interpreter -- there is no python.exe
    beside 超級碧琪.exe -- so the relay cannot be started as
    `python proxy/mm-retry-proxy.py`. The app re-executes its own executable in
    relay mode instead; from a source checkout the current interpreter runs the
    launcher script, which handles the same flag.
    """
    arguments = ["--ur-relay", str(port), str(upstream)]
    if getattr(sys, "frozen", False):
        return [sys.executable, *arguments]
    return [sys.executable, str(Path(__file__).resolve().parent / "super_pinkie.py"), *arguments]


class LocalServices:
    def __init__(self, runtime):
        self.runtime = runtime
        self.servers = []
        self.threads = []
        self.relay = None

    def _start(self, name, relative, target, arguments, health, expected=None):
        if http_alive(health, expected):
            return
        if expected:
            # Something is answering on this port but it is not our service --
            # typically a user-run proxy on a shared convention port, or a
            # leftover from another install. Binding would just fail, so name the
            # occupant and say so out loud instead of silently starting nothing
            # and letting callers believe the bundled service is up.
            occupant = http_identity(health)
            if occupant:
                append_log(
                    "launcher",
                    f"{name} port busy: {health} is answered by a different service "
                    f"({json.dumps(occupant, ensure_ascii=False)}); "
                    f"bundled {name} was not started",
                )
                return

        def run():
            try:
                module = load_file_module(f"pinkie_windows_{name}", self.runtime.root / relative)
                # The webview may replace stdout with an ANSI stream after the
                # launcher configured it. Keep service prints in a UTF-8 log
                # without redirecting stdout globally across threads.
                module.print = lambda *values, **kwargs: append_log(name, kwargs.get("sep", " ").join(map(str, values)))

                def ready(server):
                    self.servers.append(server)

                getattr(module, target)(*arguments, on_ready=ready)
            except OSError as error:
                if not http_alive(health, expected):
                    append_log("launcher", f"{name} service failed: {error}")
            except Exception as error:
                append_log("launcher", f"{name} service failed: {error}")
                append_log("launcher", traceback.format_exc())

        thread = threading.Thread(target=run, name=f"pinkie-{name}", daemon=True)
        thread.start()
        self.threads.append(thread)

    def _start_relay(self, port, upstream):
        """Run the full-featured injection relay, deferring to one already up.

        install.ps1 serves this same relay through the OpenClawURProxy task, so
        the app only needs to provide it when that task is absent. Both report
        the same relay identity, which is what lets the app tell "the relay role
        is already covered" apart from "an unrelated process owns the port".
        The relay runs as a separate process because mm-retry-proxy.py binds its
        port at import time and exposes no serve() entry point.
        """
        health = f"http://127.0.0.1:{port}/health"
        if http_alive(health, RELAY_SERVICE):
            return
        occupant = http_identity(health)
        if occupant:
            append_log(
                "launcher",
                f"relay port busy: {health} is answered by a different service "
                f"({json.dumps(occupant, ensure_ascii=False)}); bundled relay was not "
                f"started - it is the one that injects the unrestricted prompt, so stop "
                f"the other proxy or point UR_PROXY_LISTEN at a free port to let it bind",
            )
            return
        script = self.runtime.root / "proxy/mm-retry-proxy.py"
        if not script.is_file():
            append_log("launcher", f"relay script missing: {script}")
            return

        log_dir = state_root() / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        output = (log_dir / "relay.log").open("ab")
        environment = dict(os.environ)
        environment["UR_PROXY_LISTEN"] = str(port)
        environment["UR_PROXY_UPSTREAM_PORT"] = str(upstream)
        try:
            self.relay = subprocess.Popen(
                relay_command(port, upstream),
                cwd=str(self.runtime.root),
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=output,
                **hidden_process_kwargs(),
            )
            append_log("launcher", f"relay started pid={self.relay.pid} on {port} -> {upstream}")
        except OSError as error:
            append_log("launcher", f"relay start failed: {error}")
        finally:
            # The child holds its own handle on the redirect target; keeping this
            # one open would lock the log file against readers.
            output.close()

    def start(self):
        os.environ.update(self.runtime.environment())
        data = state_root()
        self._start(
            "party", "services/party/server.py", "serve",
            (18889, str(data / "party")), PARTY_URL + "api/health", "super-pinkie-party",
        )
        self._start(
            "roundtable", "services/roundtable/server.py", "serve",
            (18891, str(data / "roundtable")), ROUNDTABLE_URL + "api/health", "super-pinkie-roundtable",
        )
        self._start("tts", "services/tts/edge_tts_server.py", "serve", (18888,), TTS_URL)
        self._start_relay(
            int(os.environ.get("UR_PROXY_LISTEN", "1467")),
            int(os.environ.get("UR_PROXY_UPSTREAM_PORT", "1466")),
        )

    def close(self):
        for server in list(self.servers):
            try:
                server.shutdown()
            except Exception:
                pass
        process = self.relay
        self.relay = None
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


class NativeBridge:
    def __init__(self, updater):
        # pywebview recursively exposes public js_api attributes. Keeping a
        # public reference to Window makes it walk Window.native/WebView2 COM
        # objects, producing thousands of cross-thread errors and sometimes
        # freezing startup. Private fields are intentionally not exported.
        self._updater = updater
        self._window = None
        self.maximized = False
        self.dictation_stop = threading.Event()
        self.dictation_thread = None
        self.dictation_text = ""

    def attach(self, window):
        self._window = window

    def open_chat(self):
        self._window.load_url(gateway_ui_url())

    def open_party(self):
        self._window.load_url(PARTY_URL)

    def open_roundtable(self):
        self._window.load_url(ROUNDTABLE_URL)

    def project_folder(self, payload):
        payload = payload if isinstance(payload, dict) else {}
        request_id = str(payload.get("requestId", ""))
        if payload.get("action") == "reveal":
            path = Path(str(payload.get("path", "")))
            if path.is_dir():
                subprocess.Popen(["explorer.exe", str(path)], **hidden_process_kwargs(hide_window=False))
            return {"requestId": request_id, "cancelled": not path.is_dir()}
        if payload.get("action") != "choose":
            return {"requestId": request_id, "cancelled": True}
        import webview

        initial = Path(str(payload.get("path", "")))
        directory = str(initial if initial.is_dir() else Path.home())
        selected = self._window.create_file_dialog(
            webview.FOLDER_DIALOG, directory=directory, allow_multiple=False
        )
        if not selected:
            return {"requestId": request_id, "cancelled": True}
        path = Path(selected[0]).resolve()
        return {
            "requestId": request_id,
            "cancelled": False,
            "path": str(path),
            "name": path.name,
        }

    def preview_material(self, payload):
        """Open, copy, reveal or preview one file after a visible user click.

        The bridge checks the canonical path on every action. Preview bytes
        stay in WebView2 as a data URL; this does not change agent permissions.
        """
        payload = payload if isinstance(payload, dict) else {}
        action = str(payload.get("action", "open"))
        path = Path(str(payload.get("path", ""))).expanduser()
        try:
            path = path.resolve(strict=True)
            home = Path.home().resolve(strict=True)
            relative = path.relative_to(home)
        except (OSError, ValueError):
            return {"ok": False, "message": "只能打开用户主目录里的现有文件，且不能越过符号链接。"}
        if not path.is_file():
            return {"ok": False, "message": "这里只能打开文件，不能打开文件夹。"}
        parts = [part.casefold() for part in relative.parts]
        is_openclaw_workspace = (
            len(parts) >= 2
            and parts[0] == ".openclaw"
            and (parts[1] == "workspace" or parts[1].startswith("workspace-"))
        )
        if (
            parts[0] == ".ssh"
            or len(parts) >= 2 and parts[:2] == ["library", "keychains"]
            or parts[0] == ".openclaw" and not is_openclaw_workspace
        ):
            return {"ok": False, "message": "这个位置包含密钥或 CLE Kk 配置，不能从聊天里打开。"}
        if action == "check":
            return {"ok": True, "name": path.name}

        if action == "save":
            try:
                downloads = Path.home() / "Downloads"
                downloads.mkdir(parents=True, exist_ok=True)
                base = path.name
                stem, suffix = path.stem, path.suffix
                destination = downloads / base
                index = 1
                while destination.exists():
                    index += 1
                    destination = downloads / f"{stem} ({index}){suffix}"
                shutil.copy2(path, destination)
                return {"ok": True, "path": str(destination)}
            except OSError:
                return {"ok": False, "message": "保存到下载文件夹失败，请检查磁盘空间和文件权限。"}
        if action == "reveal":
            try:
                subprocess.Popen(["explorer.exe", "/select,", str(path)], **hidden_process_kwargs(hide_window=False))
                return {"ok": True}
            except OSError:
                return {"ok": False, "message": "无法在文件夹中显示这个文件。"}
        if action == "open-default":
            # Paths come from model output; only hand documents to their viewers,
            # never scripts, installers or executables.
            if path.suffix.lower().lstrip(".") not in DEFAULT_APP_DOCUMENT_EXTENSIONS:
                return {"ok": False, "message": "为了安全，这类文件不直接打开；可以在文件夹中显示后自己处理。"}
            try:
                os.startfile(str(path))
                return {"ok": True}
            except OSError:
                return {"ok": False, "message": "Windows 没有找到能打开这个文件的应用。"}

        suffix = path.suffix.lower()
        mime_types = {
            ".pdf": "application/pdf",
            ".html": "text/html", ".htm": "text/html",
            ".png": "image/png",
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp",
            ".avif": "image/avif", ".bmp": "image/bmp",
            ".tif": "image/tiff", ".tiff": "image/tiff",
            ".heic": "image/heic", ".heif": "image/heic",
            ".svg": "image/svg+xml",
            ".mp4": "video/mp4", ".mov": "video/quicktime",
            ".m4v": "video/x-m4v", ".webm": "video/webm",
            ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
        }
        text_extensions = {
            ".md", ".markdown", ".txt", ".text", ".log", ".csv", ".tsv",
            ".json", ".yaml", ".yml", ".xml", ".toml", ".ini", ".conf",
            ".swift", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
            ".css", ".scss", ".sh", ".bash", ".zsh", ".c", ".h", ".cpp",
            ".hpp", ".rs", ".go", ".java", ".kt", ".rb", ".php", ".sql",
            ".diff", ".patch", ".plist",
        }
        if suffix in text_extensions:
            mime_types[suffix] = "text/plain"
        mime_type = mime_types.get(suffix)
        if not mime_type:
            return {"ok": False, "message": "暂时无法预览这种文件。"}
        try:
            size = path.stat().st_size
            kind_limit = 128 if suffix in {".mp4", ".mov", ".m4v", ".webm", ".mp3", ".m4a", ".wav"} else 64
            if size > kind_limit * 1024 * 1024:
                return {"ok": False, "message": f"这个文件超过 {kind_limit} MB，Windows 版暂时不能直接预览。"}
            content = path.read_bytes()
            if suffix in {".html", ".htm"}:
                # Data URLs have no response headers. Put a restrictive CSP
                # before the selected document so it cannot fetch local or
                # remote resources while it runs in the sandboxed frame.
                content = (
                    b'<!doctype html><meta http-equiv="Content-Security-Policy" '
                    b'content="default-src \'none\'; img-src data: blob:; media-src data: blob:; '
                    b"style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; "
                    b"form-action 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'\">"
                    + content
                )
            encoded = base64.b64encode(content).decode("ascii")
            return {
                "ok": True,
                "src": f"data:{mime_type};base64,{encoded}",
                "mimeType": mime_type,
            }
        except OSError:
            return {"ok": False, "message": "读取这个材料时出了点问题，请再试一次。"}

    def _browser_proxy_paths(self):
        config_name = os.environ.get("OPENCLAW_CONFIG_PATH")
        config = Path(config_name) if config_name else Path.home() / ".openclaw" / "openclaw.json"
        return config, state_root()

    def browser_proxy_get(self):
        import browser_proxy

        config, state = self._browser_proxy_paths()
        try:
            return {"ok": True, **browser_proxy.apply(config, state)}
        except (OSError, ValueError) as error:
            return {"ok": False, "message": str(error), **browser_proxy.status(browser_proxy.load_setting(state))}

    def browser_proxy_set(self, payload):
        import browser_proxy

        payload = payload if isinstance(payload, dict) else {}
        config, state = self._browser_proxy_paths()
        try:
            result = browser_proxy.apply(config, state, {"mode": payload.get("mode"), "server": payload.get("server")})
        except (OSError, ValueError) as error:
            return {"ok": False, "message": str(error)}
        append_log("launcher", f"browser proxy set: {result['effective']}")
        return {"ok": True, "message": "已保存。碧琪下次打开浏览器时生效；浏览器已经开着的话，关掉重开一次。", **result}

    def open_external(self, url):
        if isinstance(url, str) and url.startswith(("https://", "http://")):
            webbrowser.open(url)

    def _dictation_update(self, state, transcript=None, message=None):
        payload = {"state": state}
        if transcript is not None:
            payload["transcript"] = transcript
        if message:
            payload["message"] = message
        try:
            self._window.evaluate_js(
                "window.__laolaoNativeDictationUpdate?.(" + json.dumps(payload, ensure_ascii=False) + ")"
            )
        except Exception:
            pass

    def start_dictation(self):
        if self.dictation_thread and self.dictation_thread.is_alive():
            return
        self.dictation_stop.clear()
        self.dictation_text = ""

        def listen():
            try:
                import pythoncom
                import win32com.client

                pythoncom.CoInitialize()
                recognizer = win32com.client.Dispatch("SAPI.SpSharedRecognizer")
                context = recognizer.CreateRecoContext()
                bridge = self

                class SpeechEvents:
                    def OnRecognition(self, _stream_number, _stream_position, _recognition_type, result):
                        text = str(result.PhraseInfo.GetText() or "").strip()
                        if text:
                            bridge.dictation_text += text
                            bridge._dictation_update("recording", bridge.dictation_text)

                # Keep the COM event sink alive for the whole recording. If it
                # is collected, SAPI keeps listening but no text reaches the UI.
                events = win32com.client.WithEvents(context, SpeechEvents)
                grammar = context.CreateGrammar()
                grammar.DictationLoad()
                grammar.DictationSetState(1)
                self._dictation_update("recording")
                while not self.dictation_stop.wait(.05):
                    pythoncom.PumpWaitingMessages()
                grammar.DictationSetState(0)
                _ = events
                self._dictation_update("idle", self.dictation_text)
            except Exception as error:
                self._dictation_update("error", self.dictation_text, f"语音识别没有启动：{error}")
            finally:
                try:
                    pythoncom.CoUninitialize()
                except Exception:
                    pass

        self.dictation_thread = threading.Thread(target=listen, name="pinkie-dictation", daemon=True)
        self.dictation_thread.start()

    def stop_dictation(self):
        self.dictation_stop.set()

    def minimize(self):
        self._window.minimize()

    def _native_window_handle(self):
        """Return the Win32 HWND exposed by pywebview's WinForms backend."""
        if os.name != "nt" or not self._window:
            return None
        try:
            handle = self._window.native.Handle
            return int(handle.ToInt64()) if hasattr(handle, "ToInt64") else int(handle)
        except (AttributeError, TypeError, ValueError):
            return None

    def _begin_nonclient_action(self, hit_test):
        """Hand the current pointer gesture to Windows for native drag/resize."""
        handle = self._native_window_handle()
        if not handle:
            return False
        try:
            import ctypes

            user32 = ctypes.windll.user32
            user32.ReleaseCapture()
            user32.SendMessageW(handle, 0x00A1, int(hit_test), 0)
            return True
        except (AttributeError, OSError, TypeError, ValueError):
            return False

    def begin_resize(self, direction):
        hit_tests = {
            "w": 10, "e": 11, "n": 12, "nw": 13,
            "ne": 14, "s": 15, "sw": 16, "se": 17,
        }
        return self._begin_nonclient_action(hit_tests.get(str(direction).lower(), 0))

    def toggle_maximize(self):
        previous = self.maximized
        target = not previous
        # Set the optimistic target before asking the host to change state.
        # The native event may arrive synchronously: flipping the value after
        # maximize()/restore() can then undo that event and break the next click.
        self.maximized = target
        try:
            if target:
                self._window.maximize()
            else:
                self._window.restore()
        except Exception:
            self.maximized = previous
            raise
        return {"maximized": self.maximized}

    def window_close(self):
        self._window.destroy()

    def control_center(self):
        subprocess.Popen([sys.executable, "--control-center"], **hidden_process_kwargs(hide_window=False))

    def check_for_updates(self, route=None):
        return self._updater.check(force=True, route="mirror" if route == "mirror" else None)

    def prepare_update(self, route=None):
        try:
            def progress(event):
                if self._window:
                    self._window.evaluate_js("window.__pinkieUpdateProgress?.(" + json.dumps(event) + ")")
            return self._updater.prepare(progress=progress, route="mirror" if route == "mirror" else None)
        except Exception as error:
            append_log("updater", f"update preparation failed: {error}")
            return {"available": True, "ready": False, "temporaryError": True, "message": "新版下载没有完成，稍后再点一次就会重试"}

    def apply_update(self):
        result = self._updater.launch_replacer()
        if result.get("started"):
            threading.Timer(.6, self._window.destroy).start()
        return result


BRIDGE_SCRIPT = r"""
(() => {
  if (location.protocol === 'file:') return;
  document.documentElement.setAttribute('data-pinkie-native-glass', '1');
  document.documentElement.setAttribute('data-pinkie-platform', 'windows');
  const call = (name, payload) => payload === undefined
    ? window.pywebview?.api?.[name]?.()
    : window.pywebview?.api?.[name]?.(payload);
  const handlers = {
    laolaoParty: { postMessage: () => call('open_party') },
    laolaoRoundtable: { postMessage: () => call('open_roundtable') },
    laolaoProjectFolder: { postMessage: payload => call('project_folder', payload).then(result => window.__laolaoProjectFolderResult?.(result)) }
  };
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = Object.assign(window.webkit.messageHandlers || {}, handlers);

  handlers.laolaoNativeDictation = { postMessage(payload) {
    if (payload?.action === 'stop') call('stop_dictation');
    else call('start_dictation');
  }};

  let spokenAudio = null;
  handlers.laolaoLiveVoice = { postMessage(payload) {
    if (payload?.action === 'stop') {
      spokenAudio?.pause();
      spokenAudio = null;
      return;
    }
    const text = String(payload?.text || '').trim();
    if (!text) return;
    fetch('http://127.0.0.1:18888/v1/audio/speech', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({input:text,voice:'zh-CN-XiaoyiNeural'})
    }).then(response => response.ok ? response.blob() : Promise.reject())
      .then(blob => { spokenAudio = new Audio(URL.createObjectURL(blob)); return spokenAudio.play(); })
      .catch(() => {});
  }};

  const installDictation = () => {
    const actions = document.querySelector('.agent-chat__composer-actions');
    if (!actions || document.getElementById('laolao-native-dictation')) return;
    const button = document.createElement('button');
    button.id = 'laolao-native-dictation';
    button.type = 'button';
    button.className = 'chat-send-btn chat-send-btn--laolao-dictation';
    button.setAttribute('aria-label','碧琪听着呢');
    button.innerHTML = '<svg class="laolao-dictation-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="3" width="7" height="11" rx="3.5"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"></path></svg><span class="agent-chat__control-label"></span>';
    let active = false, baseDraft = '';
    const editor = () => document.querySelector('.agent-chat__composer-combobox textarea');
    window.__laolaoNativeDictationUpdate = payload => {
      if (typeof payload?.transcript === 'string' && editor()) {
        editor().value = baseDraft + payload.transcript;
        editor().dataset.laolaoVoiceDraft = '1';
        editor().dispatchEvent(new Event('input',{bubbles:true}));
        window.dispatchEvent(new CustomEvent('laolao:dictation-draft'));
      }
      active = payload?.state === 'recording';
      button.classList.toggle('is-recording',active);
      button.setAttribute('aria-label',payload?.message || (active?'收好啦':'碧琪听着呢'));
    };
    button.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      if (active) handlers.laolaoNativeDictation.postMessage({action:'stop'});
      else { baseDraft = editor()?.value || ''; handlers.laolaoNativeDictation.postMessage({action:'start'}); }
    };
    actions.prepend(button);
  };
  installDictation();
  const dictationTimer = setInterval(installDictation, 900);

  // WebView2 reports the navigation as loaded while the document can still be
  // mid-parse, so `document.body` is not guaranteed to exist yet.  The drag
  // strip went in with `document.body.append(...)`, which threw
  // "Cannot read properties of null (reading 'append')" whenever the app was
  // still waiting for its gateway and the shell had only just started
  // navigating.  Install the chrome only once the document can take it.
  const installWindowChrome = () => {
    if (!document.body || !document.head) return false;
    if (document.getElementById('pinkie-native-window-controls')) return true;
    const drag = document.createElement('div');
    drag.className = 'pywebview-drag-region';
    drag.id = 'pinkie-native-drag-strip';
    drag.setAttribute('aria-label','拖动窗口；双击可最大化');
    drag.addEventListener('dblclick', event => {
      event.preventDefault(); call('toggle_maximize');
    });
    document.body.append(drag);
    const resize = document.createElement('div');
    resize.id = 'pinkie-native-resize-handles';
    resize.innerHTML = ['n','ne','e','se','s','sw','w','nw']
      .map(edge => `<i data-edge="${edge}" aria-hidden="true"></i>`).join('');
    resize.addEventListener('pointerdown', event => {
      const edge = event.target.closest('[data-edge]')?.dataset.edge;
      if (event.button === 0 && edge) { event.preventDefault(); call('begin_resize', edge); }
    });
    document.body.append(resize);
    const controls = document.createElement('div');
    controls.id = 'pinkie-native-window-controls';
    controls.setAttribute('role', 'toolbar');
    controls.setAttribute('aria-label', '窗口操作');
    const captionIcon = paths => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${paths}</svg>`;
    const maximizeIcon = '<rect x="4.5" y="4.5" width="11" height="11" rx="1.5"/>';
    const restoreIcon = '<path d="M7.5 4.5v-1h9v9h-1"/><rect x="3.5" y="6.5" width="10" height="10" rx="1.5"/>';
    controls.innerHTML = '<button type="button" class="pinkie-update-control" data-act="update" aria-label="主动拉取更新" title="检查更新">'
      + captionIcon('<path d="m10 2 1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8Z"/><path d="M16 14v4m-2-2h4"/>') + '</button>'
      + '<button type="button" data-act="min" aria-label="最小化" title="最小化">' + captionIcon('<path d="M4.5 12.5h11"/>') + '</button>'
      + '<button type="button" data-act="max" aria-label="最大化" title="最大化" aria-pressed="false">' + captionIcon(maximizeIcon) + '</button>'
      + '<button type="button" data-act="close" aria-label="关闭" title="关闭">' + captionIcon('<path d="m5 5 10 10M15 5 5 15"/>') + '</button>';
    const toast = message => {
      let node = document.getElementById('pinkie-update-toast');
      if (!node) { node = document.createElement('div'); node.id = 'pinkie-update-toast'; document.body.append(node); }
      node.textContent = message; node.classList.add('is-visible');
      clearTimeout(node._timer); node._timer = setTimeout(() => node.classList.remove('is-visible'), 2600);
    };
    window.__pinkieUpdateAvailable = info => {
      if (!info?.available) return;
      controls.querySelector('[data-act="update"]')?.classList.add('has-update');
    };
    const updateDialog = info => {
      if (window.__pinkieUpdateDialog?.open(info)) return;
      document.getElementById('pinkie-update-dialog')?.remove();
      const shade = document.createElement('div'); shade.id = 'pinkie-update-dialog';
      const card = document.createElement('section'); card.className = 'pinkie-update-card';
      const mark = document.createElement('span'); mark.className = 'pinkie-update-mark'; mark.textContent = '✦';
      const title = document.createElement('h3'); title.textContent = '碧琪找到新衣服啦';
      const copy = document.createElement('p'); copy.textContent = `新版本 ${info.version} 已经准备好。更新只替换 App，不会碰人格、会话、项目和上下文。`;
      const notes = document.createElement('ul'); notes.className = 'pinkie-update-notes';
      String(info.notes || '').split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
        const item = document.createElement('li'); item.textContent = line; notes.append(item);
      });
      if (!notes.childElementCount) notes.hidden = true;
      const status = document.createElement('p'); status.className = 'pinkie-update-status'; status.textContent = '更新完成后会自动回来。';
      const actions = document.createElement('div');
      const later = document.createElement('button'); later.textContent = '晚点再说'; later.onclick = () => shade.remove();
      const install = document.createElement('button'); install.className = 'primary'; install.textContent = '更新并重启';
      install.onclick = async () => {
        install.disabled = true; later.disabled = true; status.textContent = '正在把新版安全地收好…'; card.classList.add('is-working');
        const ready = await call('prepare_update');
        if (!ready?.ready) { install.disabled = false; later.disabled = false; card.classList.remove('is-working'); status.textContent = ready?.message || '网络有点晃，稍后再试就好。'; return; }
        status.textContent = '校验完成。窗口会先关掉，换好后自动打开新版，可能要几分钟；这期间不用自己打开碧琪。';
        const applied = await call('apply_update');
        if (!applied?.started) { install.disabled = false; later.disabled = false; card.classList.remove('is-working'); status.textContent = applied?.message || '还没有完成，稍后再试。'; }
      };
      actions.append(later, install); card.append(mark, title, copy, notes, status, actions); shade.append(card); document.body.append(shade);
    };
    window.__pinkieShowInstalledNotes = info => {
      document.getElementById('pinkie-update-dialog')?.remove();
      const shade = document.createElement('div'); shade.id = 'pinkie-update-dialog';
      const card = document.createElement('section'); card.className = 'pinkie-update-card';
      const mark = document.createElement('span'); mark.className = 'pinkie-update-mark'; mark.textContent = '✦';
      const title = document.createElement('h3'); title.textContent = `已经换上 ${info.version || ''}`;
      const copy = document.createElement('p'); copy.textContent = '这次更新了这些：';
      const notes = document.createElement('ul'); notes.className = 'pinkie-update-notes';
      String(info.notes || '').split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
        const item = document.createElement('li'); item.textContent = line; notes.append(item);
      });
      const actions = document.createElement('div');
      const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = '知道了';
      ok.onclick = () => shade.remove();
      actions.append(ok); card.append(mark, title, copy, notes, actions); shade.append(card); document.body.append(shade);
    };
    window.__pinkieShowUpdateFailed = info => {
      document.getElementById('pinkie-update-dialog')?.remove();
      const shade = document.createElement('div'); shade.id = 'pinkie-update-dialog';
      const card = document.createElement('section'); card.className = 'pinkie-update-card';
      const mark = document.createElement('span'); mark.className = 'pinkie-update-mark'; mark.textContent = '✦';
      const title = document.createElement('h3'); title.textContent = `新版 ${info.version || ''} 没有装上`;
      const copy = document.createElement('p');
      copy.textContent = `已经自动回到 ${info.current || '原来的版本'}，记忆和设置都在。可以再点一次更新；还不行的话，关掉碧琪后手动下载新版。`;
      const detail = document.createElement('p'); detail.className = 'pinkie-update-status'; detail.textContent = String(info.message || '');
      const actions = document.createElement('div');
      const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = '知道了';
      ok.onclick = () => shade.remove();
      actions.append(ok); card.append(mark, title, copy, detail, actions); shade.append(card); document.body.append(shade);
    };
    window.__pinkiePresentUpdate = info => {
      if (!info?.available) return;
      window.__pinkieUpdateAvailable(info);
      if (document.getElementById('pinkie-update-dialog')) return;
      updateDialog(info);
    };
    const inspectUpdate = async manual => {
      if (window.__pinkieUpdateDialog?.open()) return;
      const button = controls.querySelector('[data-act="update"]'); button?.classList.add('is-checking');
      const info = await call('check_for_updates'); button?.classList.remove('is-checking');
      if (info?.available) { window.__pinkieUpdateAvailable(info); updateDialog(info); }
      else if (manual) toast(info?.temporaryError ? '现在没连上更新站，稍后再试～' : '已经是最新版啦');
    };
    window.__pinkieNativeWindowState = state => {
      const maximized = Boolean(state?.maximized);
      document.documentElement.toggleAttribute('data-pinkie-maximized', maximized);
      const button = controls.querySelector('[data-act="max"]');
      const label = maximized ? '还原窗口' : '最大化';
      button?.setAttribute('aria-label', label); button?.setAttribute('title', label);
      button?.setAttribute('aria-pressed', String(maximized));
      const icon = button?.querySelector('svg');
      if (icon) icon.innerHTML = maximized ? restoreIcon : maximizeIcon;
    };
    controls.onclick = async event => {
      const action = event.target.closest('button')?.dataset.act;
      if (action === 'update') await inspectUpdate(true);
      if (action === 'min') call('minimize');
      if (action === 'max') {
        const state = await call('toggle_maximize');
        window.__pinkieNativeWindowState(state);
      }
      if (action === 'close') call('window_close');
    };
    document.body.append(controls);
    const style = document.createElement('style');
    style.textContent = '#pinkie-native-drag-strip{position:fixed;z-index:2147483000;top:7px;right:112px;width:74px;height:27px;background:rgba(255,242,248,.14);border:1px solid rgba(255,255,255,.18);border-radius:999px;box-sizing:border-box;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}#pinkie-native-drag-strip:active{cursor:grabbing}#pinkie-native-drag-strip::after{position:absolute;top:11px;left:50%;width:28px;height:3px;border-radius:999px;background:rgba(179,79,125,.22);content:"";transform:translateX(-50%);transition:background .16s ease,transform .16s ease}#pinkie-native-drag-strip:hover::after{background:rgba(179,79,125,.42);transform:translateX(-50%) scaleX(1.12)}#pinkie-native-resize-handles{position:fixed;z-index:2147483647;inset:0;pointer-events:none}#pinkie-native-resize-handles i{position:absolute;display:block;pointer-events:auto;touch-action:none}#pinkie-native-resize-handles [data-edge="n"],#pinkie-native-resize-handles [data-edge="s"]{left:12px;right:12px;height:7px}#pinkie-native-resize-handles [data-edge="n"]{top:0;cursor:n-resize}#pinkie-native-resize-handles [data-edge="s"]{bottom:0;cursor:s-resize}#pinkie-native-resize-handles [data-edge="e"],#pinkie-native-resize-handles [data-edge="w"]{top:12px;bottom:12px;width:7px}#pinkie-native-resize-handles [data-edge="e"]{right:0;cursor:e-resize}#pinkie-native-resize-handles [data-edge="w"]{left:0;cursor:w-resize}#pinkie-native-resize-handles [data-edge="ne"],#pinkie-native-resize-handles [data-edge="se"],#pinkie-native-resize-handles [data-edge="sw"],#pinkie-native-resize-handles [data-edge="nw"]{width:14px;height:14px}#pinkie-native-resize-handles [data-edge="ne"]{top:0;right:0;cursor:ne-resize}#pinkie-native-resize-handles [data-edge="se"]{right:0;bottom:0;cursor:se-resize}#pinkie-native-resize-handles [data-edge="sw"]{bottom:0;left:0;cursor:sw-resize}#pinkie-native-resize-handles [data-edge="nw"]{top:0;left:0;cursor:nw-resize}html[data-pinkie-maximized] #pinkie-native-resize-handles{display:none}#pinkie-native-window-controls{position:fixed;z-index:2147483647;top:8px;right:9px;display:flex;align-items:center;gap:7px;padding:5px 7px;border:1px solid rgba(255,255,255,.45);border-radius:999px;background:rgba(255,242,248,.38);backdrop-filter:blur(13px);-webkit-app-region:no-drag}#pinkie-native-window-controls button{position:relative;width:11px;height:11px;padding:0;border:0;border-radius:50%;background:#dca0bb;opacity:.55}#pinkie-native-window-controls:hover button{opacity:.92}#pinkie-native-window-controls button[data-act="close"]{background:#d85b91}#pinkie-native-window-controls button[data-act="max"]::after{position:absolute;inset:3px;border:1px solid rgba(105,55,78,.48);border-radius:1px;content:""}html[data-pinkie-maximized] #pinkie-native-window-controls button[data-act="max"]::after{inset:2px 4px 4px 2px;box-shadow:2px 2px 0 -1px #dca0bb,2px 2px 0 0 rgba(105,55,78,.48)}#pinkie-native-window-controls button:focus-visible{outline:1px solid #fff;outline-offset:2px}#pinkie-native-window-controls .pinkie-update-control{width:21px;height:21px;margin:-5px 1px -5px -4px;color:#b73974;background:linear-gradient(145deg,rgba(255,255,255,.94),rgba(250,199,222,.78));box-shadow:0 3px 10px rgba(169,48,103,.16);opacity:.82;font:11px/21px system-ui}#pinkie-native-window-controls .pinkie-update-control span{display:block;transition:transform .35s ease}.pinkie-update-control.is-checking span{animation:pinkieUpdateSpin .8s linear infinite}.pinkie-update-control.has-update{opacity:1;box-shadow:0 0 0 2px rgba(255,255,255,.72),0 0 15px rgba(229,73,142,.65);animation:pinkieUpdateGlow 1.8s ease-in-out infinite}#pinkie-update-toast{position:fixed;z-index:2147483647;top:48px;right:14px;padding:9px 14px;border:1px solid rgba(255,255,255,.7);border-radius:16px;color:#773b5a;background:rgba(255,239,247,.9);box-shadow:0 12px 30px rgba(92,39,65,.16);backdrop-filter:blur(18px);font:12px system-ui;opacity:0;transform:translateY(-7px);pointer-events:none;transition:.22s ease}#pinkie-update-toast.is-visible{opacity:1;transform:none}#pinkie-update-dialog{position:fixed;z-index:2147483646;inset:0;display:grid;place-items:center;background:rgba(63,30,48,.16);backdrop-filter:blur(8px)}.pinkie-update-card{width:min(390px,calc(100vw - 42px));max-height:calc(100vh - 42px);box-sizing:border-box;overflow:auto;padding:clamp(18px,4vw,26px);border:1px solid rgba(255,255,255,.78);border-radius:28px;text-align:center;color:#713d58;background:linear-gradient(145deg,rgba(255,247,251,.95),rgba(247,211,228,.91));box-shadow:0 28px 80px rgba(67,28,49,.25)}.pinkie-update-mark{display:grid;place-items:center;width:42px;height:42px;margin:0 auto 12px;border-radius:15px;color:#c13678;background:rgba(255,255,255,.8);box-shadow:0 8px 24px rgba(190,50,112,.18)}.pinkie-update-card h3{margin:0;font:600 18px/1.4 system-ui}.pinkie-update-card p{margin:9px 0;font:13px/1.65 system-ui}.pinkie-update-notes{margin:4px auto 0;padding:0 0 0 1.15em;max-width:32em;text-align:left;color:#7a4660;font:13px/1.55 system-ui}.pinkie-update-notes li{margin:3px 0}.pinkie-update-notes[hidden]{display:none}.pinkie-update-card .pinkie-update-status{min-height:20px;color:#9c607e;font-size:12px}.pinkie-update-card>div{display:flex;justify-content:center;gap:10px;margin-top:17px}.pinkie-update-card button{min-width:100px;padding:9px 16px;border:1px solid rgba(192,64,120,.22);border-radius:16px;color:#824866;background:rgba(255,255,255,.64);font:13px system-ui}.pinkie-update-card button.primary{color:#fff;background:linear-gradient(135deg,#de6299,#ba3674);box-shadow:0 8px 20px rgba(186,54,116,.23)}.pinkie-update-card button:disabled{opacity:.52}.pinkie-update-card.is-working .pinkie-update-mark{animation:pinkieUpdateSpin 1.1s linear infinite}@media(max-width:900px){#pinkie-native-drag-strip{right:105px;width:56px}#pinkie-native-window-controls{top:6px;right:7px;gap:6px}}@media(max-height:620px){#pinkie-update-toast{top:42px}.pinkie-update-card{padding:16px;border-radius:22px}.pinkie-update-mark{width:34px;height:34px;margin-bottom:7px}.pinkie-update-card p{margin:6px 0;line-height:1.45}.pinkie-update-card>div{margin-top:10px}}@keyframes pinkieUpdateSpin{to{transform:rotate(360deg)}}@keyframes pinkieUpdateGlow{50%{transform:translateY(-1px);filter:saturate(1.3)}}';
    // Native-only caption adapter: the same soft material as the Mac UI,
    // with familiar Windows actions and full-contrast, accessible SVG icons.
    style.textContent += `
      html[data-pinkie-platform="windows"] #pinkie-native-drag-strip {
        top:0;left:264px;right:184px;width:auto;height:34px;
        border:0;border-radius:0;background:transparent;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-drag-strip::after { display:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls {
        --caption-ink:#76596a;--caption-hover:rgba(255,255,255,.8);
        top:4px;right:12px;height:36px;gap:3px;padding:2px;box-sizing:border-box;
        border:1px solid rgba(255,255,255,.7);border-radius:14px;
        background:linear-gradient(145deg,rgba(255,254,254,.82),rgba(252,233,242,.7));
        box-shadow:0 3px 12px rgba(113,60,86,.06),inset 0 1px rgba(255,255,255,.65);
        backdrop-filter:blur(18px) saturate(130%);-webkit-backdrop-filter:blur(18px) saturate(130%);
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button {
        display:grid;place-items:center;width:32px;height:30px;margin:0;padding:0;
        border:0;border-radius:10px;color:var(--caption-ink);background:transparent;
        opacity:1;cursor:default;box-shadow:none;
        transition:background .16s ease,color .16s ease,box-shadow .16s ease,transform .16s ease;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button::after { content:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls svg {
        display:block;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.45;
        stroke-linecap:round;stroke-linejoin:round;pointer-events:none;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:hover {
        background:var(--caption-hover);box-shadow:0 2px 6px rgba(100,51,74,.07);
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:active {
        transform:translateY(1px);box-shadow:none;background:rgba(206,146,176,.18);
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:focus:not(:focus-visible) { outline:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:focus-visible {
        outline:2px solid var(--accent,#bf487e);outline-offset:-2px;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button[data-act="close"] {
        border-radius:10px;background:transparent;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button[data-act="close"]:hover {
        color:#fff;background:#cc477d;box-shadow:0 3px 9px rgba(185,57,111,.2);
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control {
        width:32px;height:30px;margin:0;color:var(--accent,#ba487d);background:transparent;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control:hover { background:var(--caption-hover) }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.is-checking svg {
        animation:pinkieUpdateSpin .8s linear infinite;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.has-update {
        box-shadow:inset 0 0 0 1px rgba(211,75,136,.3),0 0 9px rgba(229,73,142,.16);
        animation:pinkieUpdateGlow 1.8s ease-in-out infinite;
      }
      html[data-pinkie-platform="windows"][data-pinkie-night] #pinkie-native-window-controls {
        --caption-ink:#e9d6e2;--caption-hover:rgba(255,255,255,.11);
        background:linear-gradient(145deg,rgba(54,39,52,.92),rgba(41,31,43,.82));
        border-color:rgba(246,218,234,.2);box-shadow:0 3px 12px rgba(0,0,0,.12),inset 0 1px rgba(255,255,255,.05);
      }
      html[data-pinkie-platform="windows"][data-laolao-classic-shell="1"] body .chat-pane__header { padding-right:184px!important }
      html[data-pinkie-platform="windows"][data-laolao-classic-shell="1"] body .chat-workbench>.chat-workspace-rail:not(.chat-workspace-rail--collapsed) { padding-top:44px!important }
      html[data-pinkie-platform="windows"][data-pinkie-wb="on"] body .pk-workspace-header { padding-right:184px!important }
      html[data-pinkie-platform="windows"][data-pinkie-wb="on"][data-pk-wb-narrow="1"][data-pk-wb-view="code"] body .pk-wb-tabs { padding-right:184px!important }
      @media(max-width:900px) {
        html[data-pinkie-platform="windows"] #pinkie-native-drag-strip { left:54px;right:184px }
        html[data-pinkie-platform="windows"] #pinkie-native-window-controls { top:4px;right:10px }
      }
    `;
    // The shared renderer uses .topbar, not the retired .chat-pane__header.
    // Reserve native caption-button space so link/cost chips remain readable.
    style.textContent += 'html[data-pinkie-platform="windows"]:not(#pinkie-native-header-specificity) body .topbar{padding-right:184px!important}';
    document.head.append(style);
    // Keep the native drag surface away from every visible header action.
    (() => {
      // This is also installed by the native bridge. Keep header actions above the
      // draggable surface rather than synthesizing clicks on covered controls.
      // Reuse the elements just created above rather than querying a document
      // which can still be attaching them during WebView2's first load.
      window.__pinkieNativeDragLayout?.dispose();
      const chooseDragInterval = (left, right, occupied, minimum = 30) => {
        const sorted = occupied.map(r => [Math.max(left,r.left-4),Math.min(right,r.right+4)])
          .filter(([a,b]) => b>a).sort((a,b) => a[0]-b[0]);
        let cursor=left, best=null;
        for(const [start,end] of sorted){
          if(start-cursor >= minimum && (!best || start-cursor > best.width)) best={left:cursor,width:start-cursor};
          cursor=Math.max(cursor,end);
        }
        if(right-cursor >= minimum && (!best || right-cursor > best.width)) best={left:cursor,width:right-cursor};
        return best;
      };
      const selector = 'button,a[href],input,select,textarea,summary,[role="button"],[role="tab"],[role="menuitem"],[role="link"],[contenteditable="true"],[onclick],[data-pinkie-no-drag],[title]';
      // Never measure every chat descendant: content-visibility deliberately
      // skips long conversation history, and forcing its layout harms streaming.
      const headers='.topbar,.pk-wb-tabs,.pk-workspace-header,.sidebar-brand,.chat-pane__header';
      const update = () => {
        if(!drag.isConnected || !controls.isConnected)return;
        const left=innerWidth<=900?54:264;
        const caption=controls.getBoundingClientRect();
        const right=Math.max(left,caption.width>0 ? Math.min(innerWidth-184,caption.left-8) : innerWidth-12);
        const occupied=[];
        const candidates=[...document.querySelectorAll(headers)].flatMap(header=>[...header.querySelectorAll(selector)]);
        for(const e of candidates){
          if(e===drag || drag.contains(e) || controls.contains(e))continue;
          const r=e.getBoundingClientRect();
          if(r.width<=0 || r.height<=0 || r.bottom<=7 || r.top>=34 || r.right<=left || r.left>=right)continue;
          const s=getComputedStyle(e);
          if(s.display==='none'||s.visibility==='hidden'||s.pointerEvents==='none')continue;
          occupied.push({left:r.left,right:r.right});
        }
        const interval=chooseDragInterval(left,right,occupied);
        if(interval){
          drag.style.left=`${interval.left}px`; drag.style.right='auto'; drag.style.width=`${interval.width}px`;
          drag.style.pointerEvents='auto';
        }else drag.style.pointerEvents='none';
        return {interval,occupiedCount:occupied.length};
      };
      let timer=0;
      const schedule = () => {if(!timer)timer=setTimeout(()=>{timer=0;update();},80);};
      const observer=typeof MutationObserver === 'function' ? new MutationObserver(records=>{
        if(records.some(r=>{
          const e=r.target.nodeType===1?r.target:r.target.parentElement;
          if(e?.closest?.(headers))return true;
          return [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.(headers)||n.querySelector?.(headers)));
        })) schedule();
      }) : null;
      observer?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','aria-hidden','aria-expanded','class']});
      window.addEventListener('resize',schedule,{passive:true});
      document.addEventListener('scroll',schedule,{passive:true,capture:true});
      const interval=setInterval(update,1200);
      window.__pinkieNativeDragLayout={update,dispose(){clearInterval(interval);clearTimeout(timer);observer?.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);}};
      return update();
    })();
    window.__pinkieCheckForUpdates = () => inspectUpdate(false);
    setInterval(() => inspectUpdate(false), 7200000);
    return true;
  };
  if (!installWindowChrome()) {
    document.addEventListener('DOMContentLoaded', installWindowChrome, {once: true});
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.hostname === '127.0.0.1' && url.port === '18789') { event.preventDefault(); call('open_chat'); return; }
    if (url.protocol.startsWith('http') && !['127.0.0.1','localhost'].includes(url.hostname)) {
      event.preventDefault(); call('open_external',url.href);
    }
  }, true);
  window.addEventListener('beforeunload', () => clearInterval(dictationTimer), {once:true});
})();
"""


NATIVE_READING_SCRIPT = r"""
(() => {
  // Native Windows material preference, not a different browser bundle.
  // Raise the surface's paint alpha; never fade the window or its text.
  const install = () => {
    if (!document.body) return false;
    if (window.__pinkieNativeReadingSurface) {
      window.__pinkieNativeReadingSurface.apply();
      return true;
    }
    const root = document.documentElement;
    const apply = () => {
      const night = root.hasAttribute('data-pinkie-night') ||
        root.getAttribute('data-theme') === 'dark' || root.getAttribute('data-theme-mode') === 'dark';
      document.body.style.setProperty('background-color',
        night ? 'rgba(20,17,25,.96)' : 'rgba(255,250,249,.94)', 'important');
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, {attributes:true, attributeFilter:['data-pinkie-night','data-theme','data-theme-mode']});
    window.__pinkieNativeReadingSurface = {apply, lightAlpha:.94, darkAlpha:.96};
    return true;
  };
  if (!install()) document.addEventListener('DOMContentLoaded', install, {once:true});
})();
"""


def show_startup_error(window):
    window.evaluate_js("""
      (()=>{const box=document.createElement('div');box.style.cssText='position:fixed;left:50%;bottom:9%;transform:translateX(-50%);padding:10px 16px;border:1px solid #fff8;border-radius:18px;background:#f8dcebdd;color:#72455d;font:12px system-ui;box-shadow:0 12px 34px #7b3f5d22';box.textContent='本机服务还没有准备好，现有资料没有改动。重新打开 App 会继续恢复。';(document.body||document.documentElement).append(box)})();
    """)


def update_health_token_from_argv(arguments=None):
    for argument in arguments if arguments is not None else sys.argv[1:]:
        match = re.fullmatch(r"--update-health-token=([0-9a-f]{32})", str(argument))
        if match:
            return match.group(1)
    return None


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


class UpdateHealthReporter:
    """Tell the replacer that this freshly swapped-in version came up.

    The replacer of the version being *replaced* decides whether to keep this
    one, so this side adapts to what that helper can understand.  Old helpers
    gave the whole first start -- per-version setup, a cold gateway over files
    the virus scanner reads for the first time, and the page load -- 120 s, and
    rolled a healthy new version back when it took longer.  Writing the marker
    at the earliest moment each helper accepts is what lets an update from
    those versions land.
    """

    def __init__(self, token, own_node, listener=None, root=None, poll=.5, limit=900.0, port=None, hold_limit=90.0):
        self.token = token
        self.own_node = str(own_node)
        self.listener = listener
        self.root = root
        self.poll = poll
        self.limit = limit
        self.protocol = update_helper_protocol(token, root)
        self.done = threading.Event()
        self.port = port or urllib.parse.urlparse(GATEWAY_URL).port or 18789
        self.hold_limit = hold_limit
        # Set while the gateway port is free for our real gateway to bind.
        self.port_free = threading.Event()
        self.port_free.set()
        self._placeholder = None

    def _marker(self, suffix):
        directory = Path(self.root or state_root()) / "updates" / "health"
        directory.mkdir(parents=True, exist_ok=True)
        return directory / f"{self.token}{suffix}"

    def _write(self, suffix):
        try:
            self._marker(suffix).write_text("ready\n" if suffix == ".ready" else "started\n", encoding="ascii")
            return True
        except OSError as error:
            append_log("launcher", f"update {suffix[1:]} marker not written: {error}")
            return False

    def ready(self):
        if not self.done.is_set() and self._write(".ready"):
            self.done.set()
            append_log("launcher", f"update health confirmed ({self.protocol})")

    def own_gateway_listening(self):
        listener = (self.listener or GatewaySupervisor._listener)()
        image = str((listener or {}).get("image") or "")
        return bool(image) and os.path.normcase(image) == os.path.normcase(self.own_node)

    def start(self):
        self._write(".started")
        append_log("launcher", f"update start reported to a {self.protocol} helper")
        if self.protocol == "marker":
            self.ready()
            return None
        if self.protocol == "gateway" and self._hold_gateway_port():
            # 2.5.29-2.5.31: answered within seconds instead of after a cold
            # gateway start, which on a slow, virus-scanned first start runs
            # past their fixed 120 s and rolled the update back.  Users who
            # cannot download from GitHub have no manual way around that.
            self.ready()
            thread = threading.Thread(target=self._release_after_helper, name="pinkie-update-port", daemon=True)
            thread.start()
            return thread
        thread = threading.Thread(target=self._watch, name="pinkie-update-health", daemon=True)
        thread.start()
        return thread

    def _hold_gateway_port(self):
        """Listen on the gateway port from this new install's own process.

        Those helpers accept the update when every listener on the gateway port
        runs from the new install folder -- their guard against an *old*
        gateway being adopted.  This process is the new install's own exe, so
        it truthfully passes that check; the stale-gateway retirement above has
        already run.  The real gateway is started only after the helper has
        finished and this placeholder is closed (see wait_for_gateway_port).
        """
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
            if exclusive is not None:
                listener.setsockopt(socket.SOL_SOCKET, exclusive, 1)
            listener.bind(("127.0.0.1", self.port))
            listener.listen(16)
        except OSError as error:
            listener.close()
            append_log("launcher", f"update port placeholder unavailable ({error}); waiting for the gateway instead")
            return False
        self._placeholder = listener
        self.port_free.clear()
        return True

    def _release_after_helper(self):
        helper = Path(self.root or state_root()) / "updates" / f"apply-{self.token}.ps1"
        deadline = time.monotonic() + self.hold_limit
        # The old helper deletes its own script as its very last step.
        while helper.exists() and time.monotonic() < deadline:
            time.sleep(.2)
        self.release_port()

    def release_port(self):
        listener, self._placeholder = self._placeholder, None
        if listener is not None:
            try:
                listener.close()
            except OSError:
                pass
            append_log("launcher", "update port placeholder released")
        self.port_free.set()

    def wait_for_gateway_port(self, timeout=None):
        return self.port_free.wait(self.hold_limit + 5 if timeout is None else timeout)

    def _watch(self):
        deadline = time.monotonic() + self.limit
        while not self.done.is_set() and time.monotonic() < deadline:
            try:
                if self.own_gateway_listening():
                    self.ready()
                    return
            except Exception as error:  # diagnostics only; the page load still reports
                append_log("launcher", f"update health check failed: {error}")
            self.done.wait(self.poll)


def install_native_bridge(window, updater, update_health_token=None, installed_notes=""):
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

    if update_health_token and installed_notes:
        try:
            window.evaluate_js(
                "window.__pinkieShowInstalledNotes?.("
                + json.dumps(
                    {"version": updater.current_version, "notes": installed_notes},
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
    webview_storage = state_root() / "webview"
    cleanup_orphan_webview(webview_storage)
    updater = WindowsUpdater(resource_root)
    bridge = NativeBridge(updater)
    loading = (Path(resource_root) / "ui/launcher-loading.html").resolve().as_uri()
    if update_health_token:
        # First start right after an update: the splash says so, instead of a
        # bare gateway counter that looks like nothing happened.
        version_file = Path(resource_root) / "VERSION"
        version = version_file.read_text(encoding="utf-8").strip() if version_file.is_file() else ""
        loading += "?" + urllib.parse.urlencode({"updated": version or "1"})
    gateway = GatewaySupervisor(runtime)
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
    # The official environment setting applies before WebView2's first paint;
    # setting the API only after navigation can leave a white flash.
    os.environ["WEBVIEW2_DEFAULT_BACKGROUND_COLOR"] = "00000000"
    window = webview.create_window(
        "超級碧琪", initial_url, js_api=bridge, width=1280, height=800,
        min_size=(760, 500), resizable=True, frameless=True, easy_drag=False,
        shadow=False, background_color="#000000", transparent=True,
    )
    bridge.attach(window)
    if update_health_token and updater.health_reporter is not None:
        # Old replacers only wait 120 s, so this still happens before setup
        # and the cold gateway. It just no longer happens before a window exists.
        updater.health_reporter.start()
    services = LocalServices(runtime)

    def loaded(*_):
        # pywebview fires `loaded` on WebView2's GUI thread. Calling its
        # synchronous evaluate_js there deadlocks: ExecuteScriptAsync needs the
        # very same GUI thread to complete. Return from the event immediately
        # and do all synchronous window calls from a worker instead.
        threading.Thread(
            target=install_native_bridge,
            args=(window, updater, update_health_token, bundled_release_notes(resource_root)),
            name="pinkie-native-bridge",
            daemon=True,
        ).start()

    def before_show():
        # This event runs synchronously on WinForms' GUI thread. Do not call
        # evaluate_js or marshal back to the same thread from here.
        for label, configure in (("glass", configure_native_glass), ("corners", configure_native_corners)):
            try:
                configure(window)
            except Exception as error:
                append_log("launcher", f"native {label} setup failed: {error}")

    def bootstrap():
        # Setup can fail or take a long time. The splash only leaves when the
        # gateway answers, so a setup error must not skip starting it.
        try:
            prepare(lambda message: append_log("setup", message))
        except Exception as error:
            append_log("launcher", f"startup setup failed: {error}")
        try:
            services.start()
        except Exception as error:
            append_log("launcher", f"local services failed: {error}")
        try:
            reporter = getattr(updater, "health_reporter", None)
            if reporter is not None:
                # An old replacer may still be checking the gateway port.
                if not reporter.wait_for_gateway_port():
                    reporter.release_port()
            gateway.start()
            threading.Thread(target=gateway.monitor, name="pinkie-gateway-watchdog", daemon=True).start()
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
        bridge.stop_dictation()
        services.close()
        # Keep the gateway alive after the window closes so in-flight sessions
        # and background jobs are not terminated. The separate bundled
        # watchdog owns recovery; it will restart the process only if it dies.
        if os.environ.get("PINKIE_KEEP_GATEWAY", "1") != "1":
            gateway.close()
        else:
            append_log("launcher", "window closed; keeping gateway for background sessions")

    window.events.before_show += before_show
    window.events.loaded += loaded
    window.events.maximized += maximized
    window.events.restored += restored
    window.events.closed += closed
    # Start local services independently of WebView2. A broken/slow renderer
    # must never prevent the Gateway from being launched.
    threading.Thread(target=bootstrap, name="pinkie-bootstrap", daemon=True).start()
    webview.start(
        gui="edgechromium", debug=False, private_mode=False,
        storage_path=str(webview_storage),
    )
