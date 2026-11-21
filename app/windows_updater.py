"""WindowsUpdater and UpdateHealthReporter for self-updating Windows builds."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

try:
    from windows_ps_templates import (
        FOREGROUND_PS,
        PINKIE_WPF_PS,
        PROGRESS_WINDOW_PS,
        REPAIR_PS,
        UPDATE_LOG_PS,
        UPDATE_UI_PS,
    )
except ImportError:  # imported as app.windows_updater (tests)
    from app.windows_ps_templates import (
        FOREGROUND_PS,
        PINKIE_WPF_PS,
        PROGRESS_WINDOW_PS,
        REPAIR_PS,
        UPDATE_LOG_PS,
        UPDATE_UI_PS,
    )

GATEWAY_URL = "http://127.0.0.1:18789/"
UPDATE_API_URL = "https://api.github.com/repos/Cle0726/super-pinkie/releases/latest"
TRUSTED_UPDATE_HOSTS = {
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
}
UPDATE_RELEASES_URL = "https://github.com/Cle0726/super-pinkie/releases"
UPDATE_MANIFEST_NAME = "latest.json"
GUARD_UPDATE_REFUSED = "更新包的签名不对，没有安装，旧版没有改动。"

def _desktop():
    return sys.modules.get("app.windows_desktop") or sys.modules.get("windows_desktop")

def GatewaySupervisor(*args, **kwargs): return _desktop().GatewaySupervisor(*args, **kwargs)
def app_version(*args, **kwargs): return _desktop().app_version(*args, **kwargs)
def append_log(*args, **kwargs): return _desktop().append_log(*args, **kwargs)
def guard_release_build(*args, **kwargs): return _desktop().guard_release_build(*args, **kwargs)
def hidden_process_kwargs(*args, **kwargs): return _desktop().hidden_process_kwargs(*args, **kwargs)
def manifest_update(*args, **kwargs): return _desktop().manifest_update(*args, **kwargs)
def mirrored_release_update(*args, **kwargs): return _desktop().mirrored_release_update(*args, **kwargs)
def release_update(*args, **kwargs): return _desktop().release_update(*args, **kwargs)
def start_elevated(*args, **kwargs): return _desktop().start_elevated(*args, **kwargs)
def state_root(*args, **kwargs): return _desktop().state_root(*args, **kwargs)
def trusted_update_url(*args, **kwargs): return _desktop().trusted_update_url(*args, **kwargs)
def update_helper_protocol(*args, **kwargs): return _desktop().update_helper_protocol(*args, **kwargs)
def update_mirrors(*args, **kwargs): return _desktop().update_mirrors(*args, **kwargs)
def verify_signed_latest(*args, **kwargs): return _desktop().verify_signed_latest(*args, **kwargs)
def version_tuple(*args, **kwargs): return _desktop().version_tuple(*args, **kwargs)


class WindowsUpdater:
    """Release updater for a frozen EXE or PyInstaller onedir directory."""

    # How long the replacer waits for the new version: to report that it
    # started at all, then (while it keeps running) to report its gateway.
    health_start_seconds = 120
    health_ready_seconds = 900
    swap_seconds = 90

    def __init__(self, resource_root, opener=None, executable=None):
        self.resource_root = Path(resource_root)
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
                if selected:
                    selected["signedManifest"] = manifest  # 正式版更新前验它的签名（设定防护 A6）
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

    def _require_signed(self, metadata, expected):
        """正式版：只装 latest.json 签名覆盖的安装包（文件名 + SHA-256）。开发版不检查，行为不变。"""
        if not guard_release_build(self.resource_root):
            return
        latest = metadata.get("signedManifest")
        if not isinstance(latest, dict):
            try:
                url = f"{UPDATE_RELEASES_URL}/download/v{metadata['version']}/{UPDATE_MANIFEST_NAME}"
                latest = json.loads(self._read(url, 256 * 1024).decode("utf-8-sig"))
            except Exception as error:
                append_log("updater", f"signed release manifest unavailable: {error}")
                latest = None
        if (not isinstance(latest, dict) or str(latest.get("version", "")).removeprefix("v") != metadata["version"]
                or not verify_signed_latest(self.resource_root, latest, metadata["name"], expected)):
            append_log("updater", f"update {metadata['version']} refused: release signature does not cover {metadata['name']}")
            raise ValueError(GUARD_UPDATE_REFUSED)

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
            self._require_signed(metadata, expected)
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
        return WindowsUpdater._onefile_helper_template().replace("#@@UPDATE_UI@@", UPDATE_LOG_PS + UPDATE_UI_PS.rstrip())

    @staticmethod
    def _directory_helper_source():
        """PowerShell replacer for the portable onedir package."""
        return WindowsUpdater._directory_helper_template().replace("#@@UPDATE_UI@@", UPDATE_LOG_PS + UPDATE_UI_PS.rstrip())

    @staticmethod
    def _onefile_helper_template():
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
  [int]$ReadySeconds = 900,
  [string]$ProgressScript = '',
  [string]$RepairScript = '',
  [switch]$ProgressShown,
  [switch]$LaunchAsUser,
  [switch]$ProbeFailRollback,
  [string]$StateRoot = ''
)
# pinkie-update-protocol: 2  (see the portable helper: started, then ready)
$StartedMarker = [IO.Path]::ChangeExtension($HealthMarker, '.started')
# A parent started by PowerShell 7 can pass its module paths to Windows
# PowerShell 5.1. Prefer this interpreter's own inbox modules so commands such
# as Get-FileHash and Expand-Archive cannot resolve to incompatible versions.
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules') + [IO.Path]::PathSeparator + $env:PSModulePath
$ErrorActionPreference = 'Stop'
$script:backupCreated = $false
function Write-UpdateFailure([string]$Message) {
  # The restored old version reads this once and tells the user the update
  # did not land, instead of silently coming back unchanged.
  try {
    @{ version = $Version; message = $Message; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress |
      Set-Content -LiteralPath (Join-Path $UpdateRoot 'last-failure.json') -Encoding UTF8
  } catch {}
}
#@@UPDATE_UI@@
$script:ProblemFolder = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Target))
$script:RepairArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-Argument $RepairScript),
  '-Mode', 'file', '-Target', (ConvertTo-Argument $Target), '-TargetExe', (ConvertTo-Argument $Target),
  '-Backup', (ConvertTo-Argument $Backup), '-Failed', (ConvertTo-Argument ($Target + '.failed-' + $Token)),
  '-LogPath', (ConvertTo-Argument $LogPath))
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
  if ($ProbeFailRollback) { throw 'probe: simulated rollback failure' }
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
  if (Test-Path -LiteralPath $Target) { [void](Start-AsUser $Target) }
}
try {
  [void](Get-Command Get-FileHash -ErrorAction Stop)
  if ($Token -notmatch '^[0-9a-f]{32}$') { throw 'invalid update token' }
  if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw 'installed executable not found' }
  if (Test-Path -LiteralPath $Backup) { throw 'update backup path already exists' }
  Test-UpdateWriteAccess ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Target)))
  Set-UpdateProgress 1 '正在关闭旧版本'
  Start-UpdateProgressWindow
  [IO.File]::WriteAllText($ReadyMarker, $Token, [Text.Encoding]::ASCII)
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue) { throw 'old process did not exit' }
  Remove-Item -LiteralPath $HealthMarker -Force -ErrorAction SilentlyContinue
  Set-UpdateProgress 3 '正在替换文件'
  Move-Item -LiteralPath $Target -Destination $Backup
  $script:backupCreated = $true
  Move-Item -LiteralPath $Payload -Destination $Target -Force
  $actual = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $ExpectedHash.ToLowerInvariant()) { throw 'installed update checksum mismatch' }
  Remove-Item -LiteralPath $StartedMarker -Force -ErrorAction SilentlyContinue
  Set-UpdateProgress 5 '正在启动新版本'
  $launched = Start-AsUser $Target $Token
  if (-not $launched) { throw 'new version did not start' }
  $startDeadline = (Get-Date).AddSeconds($StartSeconds)
  $readyDeadline = (Get-Date).AddSeconds($ReadySeconds)
  $started = $false
  $ready = $false
  while (-not (Test-Path -LiteralPath $HealthMarker)) {
    $launched.Refresh()
    if ($launched.HasExited) { throw "new version exited before it was ready (exit code $($launched.ExitCode))" }
    if (-not $started -and (Test-Path -LiteralPath $StartedMarker)) {
      $started = $true; Write-UpdateLog 'new version started; waiting for its gateway'
      Set-UpdateProgress 5 '新版本正在打开，请不要点击桌面上的图标'
    }
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
    Set-UpdateProgress 5 '新版已经打开' 'done'
    Write-UpdateLog 'update completed'
  } else {
    Write-UpdateLog 'previous executable kept until the new version is ready'
  }
} catch {
  Write-UpdateLog "update failed, restoring previous version: $($_.Exception.Message)"
  Set-UpdateProgress 5 '这次没装上，正在恢复原来的版本' 'failed'
  Write-UpdateFailure $_.Exception.Message
  if (-not (Get-Process -Id $CurrentPid -ErrorAction SilentlyContinue)) {
    try { Restore-PreviousVersion }
    catch {
      Write-UpdateLog "rollback failed: $($_.Exception.Message)"
      Show-UpdateProblem ("新版 $Version 没有装上，原来的程序也没能自动放回去。`n请点「用管理员权限修复」；或者到原来的位置找带 previous 的文件，把它改回原来的名字。`n记忆和设置都在，不受影响。`n`n详细记录：$LogPath")
    }
  } else {
    Write-StartupFailure $_
  }
}
Remove-UnusedRepairScript
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
'''

    @staticmethod
    def _directory_helper_template():
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
  [int]$SwapSeconds = 90,
  [string]$ProgressScript = '',
  [string]$RepairScript = '',
  [switch]$ProgressShown,
  [switch]$LaunchAsUser,
  [switch]$ProbeFailRollback,
  [string]$StateRoot = ''
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
#@@UPDATE_UI@@
$script:ProblemFolder = Split-Path -Parent ([IO.Path]::GetFullPath($TargetDir).TrimEnd('\'))
# Wherever a complete copy is at this moment: the install, or the previous one.
$script:PinkieArtFallbacks = @(
  (Join-Path $TargetDir '_internal\ui\assets'),
  (Join-Path $Backup '_internal\ui\assets'),
  (Join-Path ($TargetDir.TrimEnd('\') + '.failed-' + $Token) '_internal\ui\assets'))
$script:RepairArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-Argument $RepairScript),
  '-Mode', 'dir', '-Target', (ConvertTo-Argument $TargetDir), '-TargetExe', (ConvertTo-Argument $TargetExe),
  '-Backup', (ConvertTo-Argument $Backup), '-Failed', (ConvertTo-Argument ($TargetDir.TrimEnd('\') + '.failed-' + $Token)),
  '-LogPath', (ConvertTo-Argument $LogPath))
function Test-UpdateWriteAccess([string]$Folder) {
  $probe = [IO.Path]::Combine($Folder, '.pinkie-write-test-' + $Token + '.tmp')
  $created = $false
  try {
    $stream = [IO.File]::Open($probe, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $created = $true
    $stream.Dispose()
  } finally { if ($created) { [IO.File]::Delete($probe) } }
}
function Move-Folder([string]$From, [string]$To) {
  # A plain rename. Move-Item on Windows PowerShell can fall back to copying
  # when the rename is refused, leaving a half-copied folder at the target;
  # every retry then fails with "already exists" long after the file that
  # blocked the rename was closed (a scanner holding the fresh unpack, 11-19).
  [IO.Directory]::Move($From, $To)
}
function Invoke-WithRetry([scriptblock]$Action, [string]$What, [int]$Seconds) {
  # Windows refuses to rename a folder while any file inside is open. Right
  # after a 30,000-file unpack, the virus scanner, the search indexer or a
  # OneDrive/Desktop sync client routinely holds some of them for a while.
  $deadline = (Get-Date).AddSeconds($Seconds)
  $logged = ''
  while ($true) {
    try { & $Action; return }
    catch {
      if ((Get-Date) -ge $deadline) { throw "$What is still in use: $($_.Exception.Message)" }
      # Log the first refusal and every different one after it, so a changed cause is visible.
      if ($logged -ne $_.Exception.Message) { Write-UpdateLog "$What is busy, retrying: $($_.Exception.Message)"; $logged = $_.Exception.Message }
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
function Stop-InstallLeftovers([string]$Root) {
  # Processes that keep files of the install open without running from it:
  # WebView2 (msedgewebview2.exe lives in Program Files), a browser started
  # with an extension from the install, python/cmd children of the gateway.
  # Any of them makes the folder rename fail with "Access denied" / "in use"
  # (the 11-04 and 11-05 rollbacks). Only a helper whose command line names
  # the install folder or one of the App's own WebView2 profiles is stopped,
  # and only that process (no /T): a program 碧琪 opened for the user from
  # elsewhere -- even a node.exe -- keeps running.
  $stopped = @()
  $alive = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $helpers = @('msedgewebview2.exe', 'msedge.exe', 'chrome.exe', 'node.exe', 'python.exe', 'pythonw.exe', 'cmd.exe', 'conhost.exe')
  # A command line may spell the folder in 8.3 form (C:\Users\RUNNER~1\...,
  # what %TEMP% often is) while Get-Item gives the long name, or the other
  # way round, so both spellings count.
  function Get-PathSpellings([string]$Path) {
    $forms = @()
    if (-not $Path) { return $forms }
    # Exactly as given first: on Windows PowerShell (.NET Framework) GetFullPath
    # and Get-Item expand 8.3 names, so a mixed spelling (short parent, long
    # leaf -- what a child started from %TEMP% sees) is only kept this way.
    $forms += $Path.TrimEnd('\')
    try { $forms += [IO.Path]::GetFullPath($Path).TrimEnd('\') } catch {}
    if (Test-Path -LiteralPath $Path) {
      try { $forms += (Get-Item -LiteralPath $Path).FullName.TrimEnd('\') } catch {}
      try {
        $fso = New-Object -ComObject Scripting.FileSystemObject
        $short = [string]$fso.GetFolder($Path).ShortPath
        if ($short) { $forms += $short.TrimEnd('\') }
        $leaf = Get-Item -LiteralPath $Path
        if ($leaf.Parent) { $forms += (Join-Path ([string]$fso.GetFolder($leaf.Parent.FullName).ShortPath).TrimEnd('\') $leaf.Name) }
        # The long form: walk up resolving each segment to its real name
        # (a directory filter matches the 8.3 name as well as the long one).
        $parts = @(); $item = Get-Item -LiteralPath $Path
        while ($item -and $item.Parent) {
          $real = Get-ChildItem -LiteralPath $item.Parent.FullName -Filter $item.Name -Force -ErrorAction Stop | Select-Object -First 1
          $parts = @($(if ($real) { $real.Name } else { $item.Name })) + $parts
          $item = $item.Parent
        }
        if ($item) { $forms += (Join-Path $item.FullName.TrimEnd('\') ($parts -join '\')).TrimEnd('\') }
      } catch {}
    }
    return @($forms | Where-Object { $_ } | Sort-Object -Unique)
  }
  $rootForms = if ($Root -and (Test-Path -LiteralPath $Root)) { @(Get-PathSpellings $Root) } else { @() }
  $stateForms = if ($StateRoot) { @(Get-PathSpellings $StateRoot) } else { @() }
  foreach ($process in $alive) {
    if ($process.ProcessId -eq $PID -or -not $process.CommandLine) { continue }
    if ($helpers -notcontains $process.Name.ToLowerInvariant()) { continue }
    $line = [string]$process.CommandLine
    $ours = $false
    foreach ($form in $rootForms) { if ($line.IndexOf($form, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $ours = $true } }
    if (-not $ours -and $line -match '--user-data-dir=') {
      foreach ($form in $stateForms) { if ($line.IndexOf($form, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $ours = $true } }
    }
    if ($ours) { $stopped += $process }
  }
  $stopped = @($stopped | Sort-Object ProcessId -Unique)
  if ($stopped.Count -eq 0) { return }
  Write-UpdateLog ('stopping leftover processes of the App: ' + (($stopped | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ', '))
  foreach ($process in $stopped) { try { & taskkill.exe /PID $process.ProcessId /F | Out-Null } catch {} }
  Start-Sleep -Milliseconds 500
}
function Register-RestoreAtLogon {
  # Last safety net: when neither rename nor copy could put the previous
  # version back, the desktop shortcut points at nothing. After a restart no
  # process holds the folder, so move it back once at the next sign-in.
  try {
    if ((Test-Path -LiteralPath $TargetDir) -or -not (Test-Path -LiteralPath $Backup)) { return }
    $restore = Join-Path $UpdateRoot ('restore-' + $Token + '.ps1')
    $target = $TargetDir.Replace("'", "''"); $backupPath = $Backup.Replace("'", "''"); $log = $LogPath.Replace("'", "''")
    @(
      "if (-not (Test-Path -LiteralPath '$target') -and (Test-Path -LiteralPath '$backupPath')) {",
      "  try { Move-Item -LiteralPath '$backupPath' -Destination '$target' -ErrorAction Stop; `$message = 'previous version restored at sign-in' }",
      "  catch { `$message = 'restore at sign-in failed: ' + `$_.Exception.Message }",
      "  try { Add-Content -LiteralPath '$log' -Encoding UTF8 -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + `$message) -ErrorAction Stop } catch {}",
      "}",
      "Remove-Item -LiteralPath `$PSCommandPath -Force -ErrorAction SilentlyContinue"
    ) | Set-Content -LiteralPath $restore -Encoding UTF8
    $command = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $restore + '"'
    New-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name ('SuperPinkieRestore-' + $Token.Substring(0, 8)) -Value $command
    Write-UpdateLog "previous version will be moved back at the next sign-in ($restore)"
  } catch { Write-UpdateLog "could not schedule the restore at sign-in: $($_.Exception.Message)" }
}
function Stop-InstallProcesses([string]$Root) {
  # The window keeps its gateway (node.exe from runtime\bin) alive after it
  # closes. Windows may even rename the folder while the old gateway keeps
  # serving the old UI, so stop only processes owned by this install first.
  if (-not (Test-Path -LiteralPath $Root)) { return }
  try { Stop-InstallLeftovers $Root } catch { Write-UpdateLog "leftover process check failed: $($_.Exception.Message)" }
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
  if (-not $process -or -not $process.ExecutablePath) {
    Write-UpdateLog "gateway port $GatewayPort is held by #$GatewayId whose executable cannot be read"
    throw 'gateway-owned-by-another-app'
  }
  $prefix = (Get-Item -LiteralPath $TargetDir).FullName.TrimEnd('\') + '\'
  if ($process.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $process }
  Write-UpdateLog "gateway port $GatewayPort is held by $($process.Name)#$GatewayId at $($process.ExecutablePath), outside $prefix; checking the owner record $GatewayRecord"

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
  if (Test-Path -LiteralPath $TargetDir) {
    if (Test-Path -LiteralPath $TargetExe -PathType Leaf) { Write-UpdateLog 'not copying the previous version: the install folder already has its exe'; return $false }
    # A rename that failed half-way can leave an empty or partial folder at the
    # target. It holds nothing the user needs; move it aside so the copy can land.
    $stray = $TargetDir.TrimEnd('\') + '.partial-' + $Token
    try { Move-Folder $TargetDir $stray; Write-UpdateLog "an incomplete install folder was in the way; moved it to $stray" }
    catch { Write-UpdateLog "not copying the previous version: the install folder is in the way ($($_.Exception.Message))"; return $false }
  }
  $copying = $TargetDir.TrimEnd('\') + '.restoring-' + $Token
  try {
    Remove-Item -LiteralPath $copying -Recurse -Force -ErrorAction SilentlyContinue
    & robocopy.exe $Backup $copying /E /COPY:DAT /R:5 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) { throw "robocopy exit code $code" }
    if (-not (Test-Path -LiteralPath (Join-Path $copying (Split-Path -Leaf $TargetExe)) -PathType Leaf)) { throw 'copied version has no exe' }
    # The copy was made beside the target; this rename touches only new files.
    Invoke-WithRetry { Move-Folder $copying $TargetDir } 'copied previous version' 30
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
  if ($ProbeFailRollback) { throw 'probe: simulated rollback failure' }
  $failed = $null
  if ($script:backupCreated -and (Test-Path -LiteralPath $Backup)) {
    if (Test-Path -LiteralPath $TargetDir) {
      # Move the failed copy aside instead of deleting it in place: a rename
      # either happens completely or not at all, so a half-deleted tree can
      # never be left where the user starts the App.
      $failed = $TargetDir.TrimEnd('\') + '.failed-' + $Token
      Invoke-WithRetry { try { Stop-InstallProcesses $TargetDir } catch {}; Move-Folder $TargetDir $failed } 'new install folder' $SwapSeconds
    }
    try {
      Invoke-WithRetry { try { Stop-InstallProcesses $Backup } catch {}; Move-Folder $Backup $TargetDir } 'previous version folder' $SwapSeconds
    } catch {
      Write-UpdateLog "rename back failed, copying the previous version instead: $($_.Exception.Message)"
      # A scanner, indexer or a stray child process can keep a handle in the
      # previous folder for minutes, which blocks a rename but not reading.
      # Copying it back leaves the user a working App on the same path.
      if (-not (Copy-PreviousVersion)) {
        if (-not (Test-Path -LiteralPath $TargetDir) -and $failed -and (Test-Path -LiteralPath $failed)) {
          try { Move-Folder $failed $TargetDir } catch {}
        }
        throw
      }
    }
    if ((Test-Path -LiteralPath $TargetExe) -and $failed) {
      Remove-Item -LiteralPath $failed -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $InProgress -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $TargetExe) { [void](Start-AsUser $TargetExe) }
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
    Move-Folder $TargetDir $Backup
    $script:backupCreated = $true
  } 'install folder' $SwapSeconds
  # This rename used to have no retry at all: one file of the fresh unpack
  # still open in the virus scanner failed the whole update and rolled back.
  Invoke-WithRetry { Move-Folder $newDir $TargetDir } 'unpacked new version' $SwapSeconds
  if (-not (Test-Path -LiteralPath $TargetExe -PathType Leaf)) { throw 'new version is missing after the swap' }
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $StartedMarker -Force -ErrorAction SilentlyContinue
  Set-UpdateProgress 5 '正在启动新版本'
  $launched = Start-AsUser $TargetExe $Token
  if (-not $launched) { throw 'new version did not start' }
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
      Register-RestoreAtLogon
      $where = if (Test-Path -LiteralPath $Backup) { "原来的版本保存在：`n$Backup`n请点「用管理员权限修复」，或者把这个文件夹改回「$(Split-Path -Leaf $TargetDir)」。" } else { '请点「用管理员权限修复」，或者重新下载便携版。' }
      Show-UpdateProblem ("新版 $Version 没有装上，自动恢复也没有完成。`n$where`n记忆和设置都在，不受影响。`n`n详细记录：$LogPath")
    }
  } else {
    Write-StartupFailure $_
  }
  if ($script:stage) { Remove-Item -LiteralPath $script:stage -Recurse -Force -ErrorAction SilentlyContinue }
}
Remove-Item -LiteralPath $InProgress -Force -ErrorAction SilentlyContinue
Remove-UnusedRepairScript
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

    @staticmethod
    def _start_progress_window(update_root, token, version):
        """Open the progress window from the App itself, before it closes.

        CREATE_NO_WINDOW without a STARTUPINFO show state: the window is shown
        normally. The replacer (whose PID the window reads from the status
        file) would otherwise be the one to start it, after this window is gone.
        """
        if os.name != "nt":
            return None
        script = update_root / f"progress-{token}.ps1"
        status = update_root / f"progress-{token}.json"
        try:
            script.write_text(PROGRESS_WINDOW_PS, encoding="utf-8-sig")
            status.write_text(json.dumps({"step": 1, "total": 5, "text": "正在关闭旧版本", "state": "running"},
                                         ensure_ascii=False), encoding="utf-8")
            process = subprocess.Popen(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-File", str(script),
                 "-Status", str(status), "-Owner", "0", "-Version", str(version)],
                cwd=str(update_root), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, close_fds=True, **hidden_process_kwargs(hide_window=False),
            )
            shown = Path(str(status) + ".shown")
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                if shown.is_file():
                    return process
                if process.poll() is not None:
                    break
                time.sleep(0.05)
            append_log("updater", "progress window did not appear; the replacer will open it")
            try:
                process.terminate()
            except OSError:
                pass
            return None
        except OSError as error:
            append_log("updater", f"progress window not started by the App: {error}")
            return None

    UPDATE_ART = ("working", "done", "oops")

    def _stage_update_art(self, update_root):
        """Copy 碧琪's pictures for the update windows out of the install folder.

        The progress and failure windows stay open while the install folder is
        renamed away, so they read the art from <state>/updates/art instead.
        Missing art only means a card without a picture.
        """
        art = update_root / "art"
        try:
            art.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            append_log("updater", f"update art folder not created: {error}")
            return
        for name in self.UPDATE_ART:
            file_name = f"laolao-pinkie-status-{name}.png"
            source = self.resource_root / "ui" / "assets" / file_name
            target = art / file_name
            try:
                if source.is_file() and (not target.is_file() or target.stat().st_size != source.stat().st_size):
                    shutil.copyfile(source, target)
            except OSError as error:
                append_log("updater", f"update art {name} not copied: {error}")

    @staticmethod
    def _stop_progress_window(process, update_root, token):
        if process is not None:
            try:
                process.terminate()
            except (OSError, AttributeError):
                pass
        for name in (f"progress-{token}.json", f"progress-{token}.ps1", f"repair-{token}.ps1"):
            try:
                (update_root / name).unlink()
            except OSError:
                pass

    def launch_replacer(self, elevated=False):
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
            progress_script = update_root / f"progress-{token}.ps1"
            repair_script = update_root / f"repair-{token}.ps1"
            try:
                repair_script.write_text(REPAIR_PS, encoding="utf-8-sig")
            except OSError as error:
                append_log("updater", f"admin repair script not written: {error}")
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
                    "-StateRoot", str(state_root()),
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
            command += ["-ProgressScript", str(progress_script), "-RepairScript", str(repair_script)]
            if elevated:
                command.append("-LaunchAsUser")
            if os.environ.get("PINKIE_UPDATE_PROBE_FAIL_ROLLBACK") == "1":
                command.append("-ProbeFailRollback")  # update_probe.py only: shows the failure window
            self._stage_update_art(update_root)
            progress = self._start_progress_window(update_root, token, self.prepared["version"])
            if progress is not None:
                command.append("-ProgressShown")
            elif not progress_script.exists():
                try:
                    progress_script.write_text(PROGRESS_WINDOW_PS, encoding="utf-8-sig")
                except OSError:
                    pass
            try:
                if elevated:
                    # -WindowStyle Hidden hides only PowerShell's own console;
                    # every window the helper shows calls Show-Foreground.
                    process = start_elevated([command[0], "-WindowStyle", "Hidden", *command[1:]], update_root)
                else:
                    # No SW_HIDE here: Windows applies a process's startup show
                    # state to its first ShowWindow, which made the failure
                    # window invisible. CREATE_NO_WINDOW alone keeps the
                    # console away.
                    process = subprocess.Popen(
                        command,
                        cwd=str(update_root),
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        close_fds=True,
                        **hidden_process_kwargs(hide_window=False),
                    )
            except OSError as error:
                append_log("updater", f"cannot launch update helper: {error}")
                self._stop_progress_window(progress, update_root, token)
                cancelled = getattr(error, "winerror", None) == 1223
                return {"started": False, "message": "没有拿到管理员权限，当前版本仍在运行" if cancelled
                        else "更新程序没有启动，请稍后再试"}
            if not self._wait_for_replacer(process, ready_marker, token):
                self._stop_progress_window(progress, update_root, token)
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
                # acl_denied: offer the same update through UAC instead.
                return {"started": False, "message": message, "elevate": bool(permission_denied and not elevated)}
            append_log("updater", f"switching to {self.prepared['version']}")
            return {"started": True, "version": self.prepared["version"]}


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
