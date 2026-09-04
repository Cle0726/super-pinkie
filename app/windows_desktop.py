"""Self-contained Windows desktop shell for the bundled Super Pinkie runtime."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser


GATEWAY_URL = "http://127.0.0.1:18789/"
PARTY_URL = "http://127.0.0.1:18889/"
ROUNDTABLE_URL = "http://127.0.0.1:18891/"
TTS_URL = "http://127.0.0.1:18888/health"
UPDATE_API_URL = "https://api.github.com/repos/Cle0726/super-pinkie/releases/latest"
UPDATE_ASSET_PREFIX = "super-pinkie-windows-"
TRUSTED_UPDATE_HOSTS = {
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}


def version_tuple(value):
    """Return a stable four-part key for the release versions used by this app."""
    match = re.fullmatch(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?", str(value).strip())
    if not match:
        raise ValueError("invalid release version")
    return tuple(int(part or 0) for part in match.groups())


def trusted_update_url(value):
    parsed = urllib.parse.urlparse(str(value))
    return parsed.scheme == "https" and parsed.hostname in TRUSTED_UPDATE_HOSTS


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
    }


def app_version(resource_root):
    try:
        return (Path(resource_root) / "VERSION").read_text(encoding="utf-8-sig").strip()
    except OSError:
        return "0.0.0"


def state_root():
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
        with urllib.request.urlopen(url, timeout=1.4) as response:
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
        with urllib.request.urlopen(url, timeout=1.4) as response:
            return 200 <= int(response.status) < 400
    except urllib.error.HTTPError:
        return False
    except (OSError, ValueError, urllib.error.URLError):
        return False


def gateway_ui_url():
    """Return the local UI URL, including a legacy token when one is configured."""
    config_name = os.environ.get("OPENCLAW_CONFIG_PATH")
    config_path = Path(config_name) if config_name else Path.home() / ".openclaw" / "openclaw.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        auth = config.get("gateway", {}).get("auth", {})
        token = auth.get("token") if auth.get("mode") == "token" else None
        if isinstance(token, str) and token:
            return GATEWAY_URL + "#token=" + urllib.parse.quote(token, safe="")
    except (OSError, ValueError, AttributeError):
        pass
    return GATEWAY_URL


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

    def __init__(self, resource_root, opener=None, executable=None):
        self.current_version = app_version(resource_root)
        self.opener = opener or urllib.request.urlopen
        self.executable = Path(executable or os.environ.get("PINKIE_EXECUTABLE_PATH") or sys.executable).resolve()
        self.portable = self.executable.parent.name == "超級碧琪" and (
            (self.executable.parent / "runtime").is_dir()
            or (self.executable.parent / "_internal").is_dir()
        )
        self.enabled = self.executable.suffix.lower() == ".exe" and (
            bool(getattr(sys, "frozen", False)) or bool(os.environ.get("PINKIE_EXECUTABLE_PATH")) or executable is not None
        )
        self.lock = threading.RLock()
        self.last_checked = 0.0
        self.latest = None
        self.prepared = None

    @staticmethod
    def _request(url):
        if not trusted_update_url(url):
            raise ValueError("untrusted update address")
        return urllib.request.Request(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": "SuperPinkie-Windows-Updater",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )

    def _read(self, url, limit):
        with self.opener(self._request(url), timeout=20) as response:
            value = response.read(limit + 1)
        if len(value) > limit:
            raise ValueError("update metadata is too large")
        return value

    def check(self, force=False):
        if not self.enabled:
            return {"available": False, "supported": False, "currentVersion": self.current_version}
        with self.lock:
            if not force and self.latest is not None and time.monotonic() - self.last_checked < 21600:
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
                }
            return dict(self.latest)

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

    def _download(self, url, destination, maximum=2 * 1024 * 1024 * 1024):
        temporary = destination.with_suffix(destination.suffix + ".download")
        temporary.unlink(missing_ok=True)
        received = 0
        try:
            with self.opener(self._request(url), timeout=30) as response, temporary.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > maximum:
                        raise ValueError("update package is too large")
                    handle.write(chunk)
            if received < 1024 * 1024:
                raise ValueError("update package is incomplete")
            os.replace(temporary, destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise

    def prepare(self):
        with self.lock:
            metadata = self.check(force=True)
            if not metadata.get("available"):
                return {**metadata, "ready": False}
            directory = state_root() / "updates" / metadata["version"]
            directory.mkdir(parents=True, exist_ok=True)
            payload = directory / metadata["name"]
            expected = self._checksum(
                self._read(metadata["checksumUrl"], 4096), metadata["name"]
            )
            if not payload.is_file() or self._file_hash(payload) != expected:
                payload.unlink(missing_ok=True)
                self._download(metadata["executableUrl"], payload)
            if self._file_hash(payload) != expected:
                payload.unlink(missing_ok=True)
                raise ValueError("downloaded update checksum mismatch")
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
  [Parameter(Mandatory=$true)][string]$HealthMarker,
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][string]$LogPath
)
$ErrorActionPreference = 'Stop'
function Write-UpdateLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}
function Restore-PreviousVersion {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      if (Test-Path -LiteralPath $Backup) {
        if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force }
        Move-Item -LiteralPath $Backup -Destination $Target -Force
      }
      break
    } catch {
      if ($attempt -eq 39) { throw }
      Start-Sleep -Milliseconds 250
    }
  }
  if (Test-Path -LiteralPath $Target) { Start-Process -FilePath $Target | Out-Null }
}
try {
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) { throw 'old process did not exit' }
  Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $Target -Destination $Backup -Force
  Move-Item -LiteralPath $Payload -Destination $Target -Force
  $actual = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedHash.ToLowerInvariant()) { throw 'installed update checksum mismatch' }
  $launched = Start-Process -FilePath $Target -ArgumentList "--update-health-token=$Token" -PassThru
  $healthDeadline = (Get-Date).AddSeconds(120)
  while (-not (Test-Path -LiteralPath $HealthMarker) -and -not $launched.HasExited -and (Get-Date) -lt $healthDeadline) {
    Start-Sleep -Milliseconds 500
    $launched.Refresh()
  }
  if (-not (Test-Path -LiteralPath $HealthMarker)) {
    if (-not $launched.HasExited) {
      & taskkill.exe /PID $launched.Id /T /F | Out-Null
      try { Wait-Process -Id $launched.Id -Timeout 10 -ErrorAction SilentlyContinue } catch {}
    }
    throw 'new version did not become healthy'
  }
  Remove-Item -LiteralPath $Backup -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
  Write-UpdateLog 'update completed'
} catch {
  Write-UpdateLog "update failed, restoring previous version: $($_.Exception.Message)"
  try { Restore-PreviousVersion } catch { Write-UpdateLog "rollback failed: $($_.Exception.Message)" }
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
  [Parameter(Mandatory=$true)][string]$HealthMarker,
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][string]$LogPath
)
$ErrorActionPreference = 'Stop'
function Write-UpdateLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}
function Restore-PreviousVersion {
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      if (Test-Path -LiteralPath $Backup) {
        if (Test-Path -LiteralPath $TargetDir) { Remove-Item -LiteralPath $TargetDir -Recurse -Force }
        Move-Item -LiteralPath $Backup -Destination $TargetDir -Force
      }
      break
    } catch {
      if ($attempt -eq 39) { throw }
      Start-Sleep -Milliseconds 250
    }
  }
  if (Test-Path -LiteralPath $TargetExe) { Start-Process -FilePath $TargetExe | Out-Null }
}
try {
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) { throw 'old process did not exit' }
  Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
  $stage = Join-Path (Split-Path -Parent $TargetDir) ('.pinkie-stage-' + $Token)
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $Payload -DestinationPath $stage -Force
  $newDir = Join-Path $stage '超級碧琪'
  if (-not (Test-Path -LiteralPath (Join-Path $newDir '超級碧琪.exe'))) { throw 'portable package layout is invalid' }
  Move-Item -LiteralPath $TargetDir -Destination $Backup -Force
  Move-Item -LiteralPath $newDir -Destination $TargetDir -Force
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  $actual = (Get-FileHash -LiteralPath $Payload -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedHash.ToLowerInvariant()) { throw 'installed update checksum mismatch' }
  $launched = Start-Process -FilePath $TargetExe -ArgumentList "--update-health-token=$Token" -PassThru
  $healthDeadline = (Get-Date).AddSeconds(120)
  while (-not (Test-Path -LiteralPath $HealthMarker) -and -not $launched.HasExited -and (Get-Date) -lt $healthDeadline) {
    Start-Sleep -Milliseconds 500
    $launched.Refresh()
  }
  if (-not (Test-Path -LiteralPath $HealthMarker)) {
    if (-not $launched.HasExited) { & taskkill.exe /PID $launched.Id /T /F | Out-Null }
    throw 'new version did not become healthy'
  }
  Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
  Write-UpdateLog 'portable update completed'
} catch {
  Write-UpdateLog "portable update failed, restoring previous version: $($_.Exception.Message)"
  try { Restore-PreviousVersion } catch { Write-UpdateLog "rollback failed: $($_.Exception.Message)" }
}
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
'''

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
            helper = update_root / f"apply-{token}.ps1"
            marker = health_root / f"{token}.ready"
            if self.portable:
                target_dir = self.executable.parent
                backup = target_dir.with_name(target_dir.name + ".previous")
                helper.write_text(self._directory_helper_source(), encoding="utf-8")
                command = [
                    "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                    "-File", str(helper),
                    "-TargetDir", str(target_dir),
                    "-Payload", str(payload),
                    "-Backup", str(backup),
                    "-TargetExe", str(self.executable),
                    "-CurrentPid", str(os.getpid()),
                    "-ExpectedHash", expected,
                    "-HealthMarker", str(marker),
                    "-Token", token,
                    "-LogPath", str(state_root() / "logs/updater.log"),
                ]
            else:
                backup = self.executable.with_name(self.executable.stem + ".previous" + self.executable.suffix)
                helper.write_text(self._helper_source(), encoding="utf-8")
                command = [
                "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                "-File", str(helper),
                "-Target", str(self.executable),
                "-Payload", str(payload),
                "-Backup", str(backup),
                "-CurrentPid", str(os.getpid()),
                "-ExpectedHash", expected,
                "-HealthMarker", str(marker),
                "-Token", token,
                "-LogPath", str(state_root() / "logs/updater.log"),
                ]
            try:
                subprocess.Popen(
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
            append_log("updater", f"switching to {self.prepared['version']}")
            return {"started": True, "version": self.prepared["version"]}


def hidden_process_kwargs():
    return {
        "creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW,
    }


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
        environment["PINKIE_MANAGED_GATEWAY"] = "1"
        environment["PINKIE_GATEWAY_URL"] = GATEWAY_URL
        environment["PINKIE_STATE_ROOT"] = str(state_root())
        environment["PYTHONUTF8"] = "1"
        environment.pop("CLAUDECODE", None)
        return environment


class GatewaySupervisor:
    def __init__(self, runtime):
        self.runtime = runtime
        self.process = None
        self.closing = threading.Event()
        self.lock = threading.RLock()
        self.last_restart = 0.0
        self.started_at = 0.0
        self.startup_grace = 90.0
        self.failure_limit = 3

    def start(self):
        with self.lock:
            if http_ready(GATEWAY_URL):
                return
            if self.process and self.process.poll() is None:
                return
            if time.monotonic() - self.last_restart < 4:
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
                self.process = subprocess.Popen(
                    command,
                    cwd=str(self.runtime.openclaw.parent),
                    env=self.runtime.environment(),
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=output,
                    **hidden_process_kwargs(),
                )
                self.started_at = time.monotonic()
                append_log("launcher", f"gateway started pid={self.process.pid}")
            except OSError as error:
                output.close()
                append_log("launcher", f"gateway start failed: {error}")

    def wait_ready(self, seconds=126):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and not self.closing.is_set():
            if http_ready(GATEWAY_URL):
                return True
            self.start()
            time.sleep(.35)
        return False

    def monitor(self):
        failures = 0
        while not self.closing.wait(2):
            with self.lock:
                process = self.process
                alive = bool(process and process.poll() is None)
                age = time.monotonic() - self.started_at if self.started_at else 0
            if http_ready(GATEWAY_URL):
                failures = 0
                continue
            # Cold bundled OpenClaw startup can spend tens of seconds loading.
            # Never taskkill a live process in this grace period.
            if alive and age < self.startup_grace:
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


class LocalServices:
    def __init__(self, runtime):
        self.runtime = runtime
        self.servers = []
        self.threads = []

    def _start(self, name, relative, target, arguments, health, expected=None):
        if http_alive(health, expected):
            return

        def run():
            try:
                module = load_file_module(f"pinkie_windows_{name}", self.runtime.root / relative)

                def ready(server):
                    self.servers.append(server)

                getattr(module, target)(*arguments, on_ready=ready)
            except OSError as error:
                if not http_alive(health, expected):
                    append_log("launcher", f"{name} service failed: {error}")
            except Exception as error:
                append_log("launcher", f"{name} service failed: {error}")

        thread = threading.Thread(target=run, name=f"pinkie-{name}", daemon=True)
        thread.start()
        self.threads.append(thread)

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
        relay_port = int(os.environ.get("UR_PROXY_LISTEN", "1467"))
        self._start(
            "relay", "proxy/ur-rewrite-proxy.py", "serve", (relay_port,),
            f"http://127.0.0.1:{relay_port}/health",
        )

    def close(self):
        for server in list(self.servers):
            try:
                server.shutdown()
            except Exception:
                pass


class NativeBridge:
    def __init__(self, updater):
        self.updater = updater
        self.window = None
        self.maximized = False
        self.dictation_stop = threading.Event()
        self.dictation_thread = None
        self.dictation_text = ""

    def attach(self, window):
        self.window = window

    def open_chat(self):
        self.window.load_url(gateway_ui_url())

    def open_party(self):
        self.window.load_url(PARTY_URL)

    def open_roundtable(self):
        self.window.load_url(ROUNDTABLE_URL)

    def project_folder(self, payload):
        payload = payload if isinstance(payload, dict) else {}
        request_id = str(payload.get("requestId", ""))
        if payload.get("action") == "reveal":
            path = Path(str(payload.get("path", "")))
            if path.is_dir():
                subprocess.Popen(["explorer.exe", str(path)], **hidden_process_kwargs())
            return {"requestId": request_id, "cancelled": not path.is_dir()}
        if payload.get("action") != "choose":
            return {"requestId": request_id, "cancelled": True}
        import webview

        initial = Path(str(payload.get("path", "")))
        directory = str(initial if initial.is_dir() else Path.home())
        selected = self.window.create_file_dialog(
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
            self.window.evaluate_js(
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
        self.window.minimize()

    def _native_window_handle(self):
        """Return the Win32 HWND exposed by pywebview's WinForms backend."""
        if os.name != "nt" or not self.window:
            return None
        try:
            handle = self.window.native.Handle
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
        if self.maximized:
            self.window.restore()
        else:
            self.window.maximize()
        # The native maximized/restored events are the source of truth. This
        # optimistic value keeps double-clicks correct before that event lands.
        self.maximized = not self.maximized
        return {"maximized": self.maximized}

    def window_close(self):
        self.window.destroy()

    def control_center(self):
        subprocess.Popen([sys.executable, "--control-center"], **hidden_process_kwargs())

    def check_for_updates(self):
        return self.updater.check(force=True)

    def prepare_update(self):
        try:
            return self.updater.prepare()
        except Exception as error:
            append_log("updater", f"update preparation failed: {error}")
            return {"available": True, "ready": False, "temporaryError": True, "message": "新版下载没有完成，稍后再点一次就会重试"}

    def apply_update(self):
        result = self.updater.launch_replacer()
        if result.get("started"):
            threading.Timer(.6, self.window.destroy).start()
        return result


BRIDGE_SCRIPT = r"""
(() => {
  if (location.protocol === 'file:') return;
  document.documentElement.setAttribute('data-pinkie-native-glass', '1');
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

  if (!document.getElementById('pinkie-native-window-controls')) {
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
    controls.innerHTML = '<button class="pinkie-update-control" data-act="update" aria-label="检查更新"><span>✦</span></button><button data-act="min" aria-label="最小化"></button><button data-act="max" aria-label="最大化"></button><button data-act="close" aria-label="关闭"></button>';
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
      document.getElementById('pinkie-update-dialog')?.remove();
      const shade = document.createElement('div'); shade.id = 'pinkie-update-dialog';
      const card = document.createElement('section'); card.className = 'pinkie-update-card';
      const mark = document.createElement('span'); mark.className = 'pinkie-update-mark'; mark.textContent = '✦';
      const title = document.createElement('h3'); title.textContent = '碧琪找到新衣服啦';
      const copy = document.createElement('p'); copy.textContent = `新版本 ${info.version} 已经准备好发布。更新只替换 App，不会碰人格、会话、项目和上下文。`;
      const status = document.createElement('p'); status.className = 'pinkie-update-status'; status.textContent = '更新完成后会自动回来。';
      const actions = document.createElement('div');
      const later = document.createElement('button'); later.textContent = '晚点再说'; later.onclick = () => shade.remove();
      const install = document.createElement('button'); install.className = 'primary'; install.textContent = '更新并重启';
      install.onclick = async () => {
        install.disabled = true; later.disabled = true; status.textContent = '正在把新版安全地收好…'; card.classList.add('is-working');
        const ready = await call('prepare_update');
        if (!ready?.ready) { install.disabled = false; later.disabled = false; card.classList.remove('is-working'); status.textContent = ready?.message || '网络有点晃，稍后再试就好。'; return; }
        status.textContent = '校验完成，正在重启…';
        const applied = await call('apply_update');
        if (!applied?.started) { install.disabled = false; later.disabled = false; card.classList.remove('is-working'); status.textContent = applied?.message || '还没有完成，稍后再试。'; }
      };
      actions.append(later, install); card.append(mark, title, copy, status, actions); shade.append(card); document.body.append(shade);
    };
    const inspectUpdate = async manual => {
      const button = controls.querySelector('[data-act="update"]'); button?.classList.add('is-checking');
      const info = await call('check_for_updates'); button?.classList.remove('is-checking');
      if (info?.available) { window.__pinkieUpdateAvailable(info); updateDialog(info); }
      else if (manual) toast(info?.temporaryError ? '现在没连上更新站，稍后再试～' : '已经是最新版啦');
    };
    window.__pinkieNativeWindowState = state => {
      const maximized = Boolean(state?.maximized);
      document.documentElement.toggleAttribute('data-pinkie-maximized', maximized);
      controls.querySelector('[data-act="max"]')?.setAttribute('aria-label', maximized ? '还原窗口' : '最大化');
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
    style.textContent = '#pinkie-native-drag-strip{position:fixed;z-index:2147483000;top:7px;right:112px;width:74px;height:27px;background:rgba(255,242,248,.14);border:1px solid rgba(255,255,255,.18);border-radius:999px;box-sizing:border-box;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}#pinkie-native-drag-strip:active{cursor:grabbing}#pinkie-native-drag-strip::after{position:absolute;top:11px;left:50%;width:28px;height:3px;border-radius:999px;background:rgba(179,79,125,.22);content:"";transform:translateX(-50%);transition:background .16s ease,transform .16s ease}#pinkie-native-drag-strip:hover::after{background:rgba(179,79,125,.42);transform:translateX(-50%) scaleX(1.12)}#pinkie-native-resize-handles{position:fixed;z-index:2147483647;inset:0;pointer-events:none}#pinkie-native-resize-handles i{position:absolute;display:block;pointer-events:auto;touch-action:none}#pinkie-native-resize-handles [data-edge="n"],#pinkie-native-resize-handles [data-edge="s"]{left:12px;right:12px;height:7px}#pinkie-native-resize-handles [data-edge="n"]{top:0;cursor:n-resize}#pinkie-native-resize-handles [data-edge="s"]{bottom:0;cursor:s-resize}#pinkie-native-resize-handles [data-edge="e"],#pinkie-native-resize-handles [data-edge="w"]{top:12px;bottom:12px;width:7px}#pinkie-native-resize-handles [data-edge="e"]{right:0;cursor:e-resize}#pinkie-native-resize-handles [data-edge="w"]{left:0;cursor:w-resize}#pinkie-native-resize-handles [data-edge="ne"],#pinkie-native-resize-handles [data-edge="se"],#pinkie-native-resize-handles [data-edge="sw"],#pinkie-native-resize-handles [data-edge="nw"]{width:14px;height:14px}#pinkie-native-resize-handles [data-edge="ne"]{top:0;right:0;cursor:ne-resize}#pinkie-native-resize-handles [data-edge="se"]{right:0;bottom:0;cursor:se-resize}#pinkie-native-resize-handles [data-edge="sw"]{bottom:0;left:0;cursor:sw-resize}#pinkie-native-resize-handles [data-edge="nw"]{top:0;left:0;cursor:nw-resize}html[data-pinkie-maximized] #pinkie-native-resize-handles{display:none}#pinkie-native-window-controls{position:fixed;z-index:2147483647;top:8px;right:9px;display:flex;align-items:center;gap:7px;padding:5px 7px;border:1px solid rgba(255,255,255,.45);border-radius:999px;background:rgba(255,242,248,.38);backdrop-filter:blur(13px);-webkit-app-region:no-drag}#pinkie-native-window-controls button{position:relative;width:11px;height:11px;padding:0;border:0;border-radius:50%;background:#dca0bb;opacity:.55}#pinkie-native-window-controls:hover button{opacity:.92}#pinkie-native-window-controls button[data-act="close"]{background:#d85b91}#pinkie-native-window-controls button[data-act="max"]::after{position:absolute;inset:3px;border:1px solid rgba(105,55,78,.48);border-radius:1px;content:""}html[data-pinkie-maximized] #pinkie-native-window-controls button[data-act="max"]::after{inset:2px 4px 4px 2px;box-shadow:2px 2px 0 -1px #dca0bb,2px 2px 0 0 rgba(105,55,78,.48)}#pinkie-native-window-controls button:focus-visible{outline:1px solid #fff;outline-offset:2px}#pinkie-native-window-controls .pinkie-update-control{width:21px;height:21px;margin:-5px 1px -5px -4px;color:#b73974;background:linear-gradient(145deg,rgba(255,255,255,.94),rgba(250,199,222,.78));box-shadow:0 3px 10px rgba(169,48,103,.16);opacity:.82;font:11px/21px system-ui}#pinkie-native-window-controls .pinkie-update-control span{display:block;transition:transform .35s ease}.pinkie-update-control.is-checking span{animation:pinkieUpdateSpin .8s linear infinite}.pinkie-update-control.has-update{opacity:1;box-shadow:0 0 0 2px rgba(255,255,255,.72),0 0 15px rgba(229,73,142,.65);animation:pinkieUpdateGlow 1.8s ease-in-out infinite}#pinkie-update-toast{position:fixed;z-index:2147483647;top:48px;right:14px;padding:9px 14px;border:1px solid rgba(255,255,255,.7);border-radius:16px;color:#773b5a;background:rgba(255,239,247,.9);box-shadow:0 12px 30px rgba(92,39,65,.16);backdrop-filter:blur(18px);font:12px system-ui;opacity:0;transform:translateY(-7px);pointer-events:none;transition:.22s ease}#pinkie-update-toast.is-visible{opacity:1;transform:none}#pinkie-update-dialog{position:fixed;z-index:2147483646;inset:0;display:grid;place-items:center;background:rgba(63,30,48,.16);backdrop-filter:blur(8px)}.pinkie-update-card{width:min(390px,calc(100vw - 42px));max-height:calc(100vh - 42px);box-sizing:border-box;overflow:auto;padding:clamp(18px,4vw,26px);border:1px solid rgba(255,255,255,.78);border-radius:28px;text-align:center;color:#713d58;background:linear-gradient(145deg,rgba(255,247,251,.95),rgba(247,211,228,.91));box-shadow:0 28px 80px rgba(67,28,49,.25)}.pinkie-update-mark{display:grid;place-items:center;width:42px;height:42px;margin:0 auto 12px;border-radius:15px;color:#c13678;background:rgba(255,255,255,.8);box-shadow:0 8px 24px rgba(190,50,112,.18)}.pinkie-update-card h3{margin:0;font:600 18px/1.4 system-ui}.pinkie-update-card p{margin:9px 0;font:13px/1.65 system-ui}.pinkie-update-card .pinkie-update-status{min-height:20px;color:#9c607e;font-size:12px}.pinkie-update-card>div{display:flex;justify-content:center;gap:10px;margin-top:17px}.pinkie-update-card button{min-width:100px;padding:9px 16px;border:1px solid rgba(192,64,120,.22);border-radius:16px;color:#824866;background:rgba(255,255,255,.64);font:13px system-ui}.pinkie-update-card button.primary{color:#fff;background:linear-gradient(135deg,#de6299,#ba3674);box-shadow:0 8px 20px rgba(186,54,116,.23)}.pinkie-update-card button:disabled{opacity:.52}.pinkie-update-card.is-working .pinkie-update-mark{animation:pinkieUpdateSpin 1.1s linear infinite}@media(max-width:900px){#pinkie-native-drag-strip{right:105px;width:56px}#pinkie-native-window-controls{top:6px;right:7px;gap:6px}}@media(max-height:620px){#pinkie-update-toast{top:42px}.pinkie-update-card{padding:16px;border-radius:22px}.pinkie-update-mark{width:34px;height:34px;margin-bottom:7px}.pinkie-update-card p{margin:6px 0;line-height:1.45}.pinkie-update-card>div{margin-top:10px}}@keyframes pinkieUpdateSpin{to{transform:rotate(360deg)}}@keyframes pinkieUpdateGlow{50%{transform:translateY(-1px);filter:saturate(1.3)}}';
    document.head.append(style);
    window.__pinkieCheckForUpdates = () => inspectUpdate(false);
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


def show_startup_error(window):
    window.evaluate_js("""
      (()=>{const box=document.createElement('div');box.style.cssText='position:fixed;left:50%;bottom:9%;transform:translateX(-50%);padding:10px 16px;border:1px solid #fff8;border-radius:18px;background:#f8dcebdd;color:#72455d;font:12px system-ui;box-shadow:0 12px 34px #7b3f5d22';box.textContent='本机服务还没有准备好，现有资料没有改动。重新打开 App 会继续恢复。';document.body.append(box)})();
    """)


def update_health_token_from_argv(arguments=None):
    for argument in arguments if arguments is not None else sys.argv[1:]:
        match = re.fullmatch(r"--update-health-token=([0-9a-f]{32})", str(argument))
        if match:
            return match.group(1)
    return None


def run_desktop(resource_root, prepare, update_health_token=None):
    import webview

    runtime = BundledRuntime(resource_root)
    if not runtime.valid():
        raise RuntimeError("Windows bundled runtime is incomplete")
    os.environ.update(runtime.environment())
    webview_storage = state_root() / "webview"
    cleanup_orphan_webview(webview_storage)
    updater = WindowsUpdater(resource_root)
    bridge = NativeBridge(updater)
    loading = (Path(resource_root) / "ui/launcher-loading.html").resolve().as_uri()
    window = webview.create_window(
        "超級碧琪", loading, js_api=bridge, width=1280, height=800,
        min_size=(760, 500), resizable=True, frameless=True, easy_drag=False,
        shadow=True, background_color="#efcbd3",
    )
    bridge.attach(window)
    gateway = GatewaySupervisor(runtime)
    services = LocalServices(runtime)

    def loaded(*_):
        try:
            window.evaluate_js(BRIDGE_SCRIPT)
            current_url = str(window.get_current_url() or "")
            if current_url.startswith(GATEWAY_URL):
                if update_health_token:
                    health = state_root() / "updates/health" / f"{update_health_token}.ready"
                    health.parent.mkdir(parents=True, exist_ok=True)
                    health.write_text("ready\n", encoding="ascii")

                def announce_update():
                    info = updater.check()
                    if info.get("available"):
                        try:
                            window.evaluate_js(
                                "window.__pinkieUpdateAvailable?.(" + json.dumps(info, ensure_ascii=False) + ")"
                            )
                        except Exception:
                            pass

                threading.Thread(target=announce_update, name="pinkie-update-check", daemon=True).start()
        except Exception:
            pass

    def bootstrap():
        try:
            prepare(lambda message: append_log("setup", message))
            services.start()
            gateway.start()
            threading.Thread(target=gateway.monitor, name="pinkie-gateway-watchdog", daemon=True).start()
            # The splash page polls the local gateway itself.  Do not call
            # pywebview window APIs from this worker thread: WebView2 can block
            # its GUI message pump when load_url/evaluate_js crosses threads.
        except Exception as error:
            append_log("launcher", f"startup failed: {error}")

    def shown(*_):
        threading.Thread(target=bootstrap, name="pinkie-bootstrap", daemon=True).start()

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
        gateway.close()

    window.events.loaded += loaded
    window.events.shown += shown
    window.events.maximized += maximized
    window.events.restored += restored
    window.events.closed += closed
    webview.start(
        gui="edgechromium", debug=False, private_mode=False,
        storage_path=str(webview_storage),
    )
