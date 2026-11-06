"""Local proxy core for the in-app browser's VPN.

Runs the bundled mihomo (GPL-3.0, shipped as a separate unmodified binary)
as a loopback-only HTTP/SOCKS proxy.  Only the in-app browser's WebView2
environment is pointed at it with --proxy-server; the system proxy, the
gateway and the model relay are never told about it.

The config is written as JSON (a YAML subset mihomo reads directly):

* `mixed-port` bound to 127.0.0.1, allow-lan off, no TUN, no DNS hijack
* one select group `PINKIE` holding every subscription node, rule MATCH
* external-controller on 127.0.0.1 with a random secret, used for latency
  tests and switching nodes without restarting the browser
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

GROUP = "PINKIE"
DELAY_URL = "https://www.gstatic.com/generate_204"
DELAY_TIMEOUT_MS = 5000
CORE_NAME = "mihomo.exe" if os.name == "nt" else "mihomo"


class CoreError(RuntimeError):
    """User-facing (Chinese) error about the local core."""


def free_port(preferred: int = 0) -> int:
    for candidate in ([preferred] if preferred else []) + [0]:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", candidate))
            return sock.getsockname()[1]
        except OSError:
            continue
        finally:
            sock.close()
    raise CoreError("本机找不到可用的端口来启动节点核心。")


def build_config(proxies: List[Dict[str, Any]], mixed_port: int, controller_port: int, secret: str,
                 selected: Optional[str] = None) -> Dict[str, Any]:
    """mihomo config scoped to loopback; nothing here can affect the system."""
    names = [p["name"] for p in proxies]
    if selected in names:
        names.remove(selected)
        names.insert(0, selected)
    return {
        "mixed-port": int(mixed_port),
        "bind-address": "127.0.0.1",
        "allow-lan": False,
        "ipv6": True,
        "mode": "rule",
        "log-level": "warning",
        "unified-delay": True,
        "tcp-concurrent": True,
        "external-controller": f"127.0.0.1:{int(controller_port)}",
        "secret": secret,
        "geo-auto-update": False,
        "geodata-mode": False,
        "profile": {"store-selected": False, "store-fake-ip": False},
        "tun": {"enable": False},
        "proxies": proxies,
        "proxy-groups": [{"name": GROUP, "type": "select", "proxies": names or ["DIRECT"]}],
        "rules": [f"MATCH,{GROUP}"],
    }


def locate_core(resource_root: Optional[Path] = None) -> Optional[Path]:
    """Find the bundled mihomo.  PINKIE_MIHOMO_PATH overrides for development."""
    override = os.environ.get("PINKIE_MIHOMO_PATH")
    candidates = [Path(override)] if override else []
    roots = []
    if resource_root:
        roots.append(Path(resource_root))
    if getattr(sys, "_MEIPASS", None):
        roots.append(Path(sys._MEIPASS))
    repo = Path(__file__).resolve().parents[1]
    roots.append(repo)
    for root in roots:
        candidates += [root / "runtime" / "browser-vpn" / CORE_NAME, root / "build" / "windows-runtime" / "browser-vpn" / CORE_NAME]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def hidden_kwargs() -> Dict[str, Any]:
    if os.name != "nt":
        return {}
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    return {"startupinfo": startup, "creationflags": 0x08000000}  # CREATE_NO_WINDOW


class MihomoCore:
    """One mihomo process owned by this App process."""

    def __init__(self, home: Path, binary: Optional[Path], log: Callable[[str], None] = lambda _m: None):
        self.home = Path(home)
        self.binary = binary
        self.log = log
        self.process: Optional[subprocess.Popen] = None
        self.secret = secrets.token_hex(16)
        self.mixed_port = 0
        self.controller_port = 0
        self.lock = threading.RLock()

    # ── lifecycle ──
    def running(self) -> bool:
        return bool(self.process and self.process.poll() is None)

    def start(self, proxies: List[Dict[str, Any]], selected: Optional[str] = None, wait: float = 12.0) -> None:
        with self.lock:
            if not self.binary or not Path(self.binary).is_file():
                raise CoreError("这个安装包里没有节点核心（mihomo），浏览器节点功能用不了。请重新安装最新版。")
            if not proxies:
                raise CoreError("还没有可用节点，请先添加订阅。")
            self.stop()
            self.home.mkdir(parents=True, exist_ok=True)
            # Keep the browser's proxy port stable across core restarts in one
            # session, so a running browser keeps working after a refresh.
            self.mixed_port = free_port(self.mixed_port)
            self.controller_port = free_port(self.controller_port)
            config = build_config(proxies, self.mixed_port, self.controller_port, self.secret, selected)
            path = self.home / "config.json"
            path.write_text(json.dumps(config, ensure_ascii=False, indent=1), encoding="utf-8")
            log_file = (self.home / "core.log").open("ab")
            try:
                self.process = subprocess.Popen(
                    [str(self.binary), "-d", str(self.home), "-f", str(path)],
                    cwd=str(self.home), stdin=subprocess.DEVNULL, stdout=log_file, stderr=log_file,
                    **hidden_kwargs(),
                )
            except OSError as error:
                raise CoreError(f"节点核心启动失败：{error}") from None
            finally:
                log_file.close()
            attach_kill_on_close(self)
            deadline = time.monotonic() + wait
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise CoreError("节点核心启动后立刻退出了：" + self.tail_log())
                try:
                    self.api("GET", "/version", timeout=1)
                    break
                except CoreError:
                    time.sleep(0.15)
            else:
                self.stop()
                raise CoreError("节点核心启动超时。" + self.tail_log())
            if selected:
                try:
                    self.select(selected)
                except CoreError:
                    pass
            self.log(f"browser vpn core pid={self.process.pid} port={self.mixed_port}")

    def stop(self) -> None:
        with self.lock:
            process, self.process = self.process, None
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(3)
                except subprocess.TimeoutExpired:
                    process.kill()

    def tail_log(self, limit: int = 600) -> str:
        try:
            data = (self.home / "core.log").read_bytes()[-limit:]
            text = data.decode("utf-8", "replace").strip()
            return text.splitlines()[-1] if text else ""
        except OSError:
            return ""

    # ── controller API ──
    def api(self, method: str, path: str, body: Any = None, timeout: float = 6.0) -> Any:
        if not self.controller_port:
            raise CoreError("节点核心没有运行。")
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.controller_port}{path}", data=data, method=method,
            headers={"Authorization": f"Bearer {self.secret}", "Content-Type": "application/json"},
        )
        # Never route our own loopback control traffic through a system proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read() or b"{}").get("message", "")
            except ValueError:
                message = ""
            raise CoreError(message or f"HTTP {error.code}") from None
        except (urllib.error.URLError, OSError) as error:
            raise CoreError(f"连不上节点核心：{error}") from None
        return json.loads(raw) if raw else {}

    def select(self, name: str) -> None:
        self.api("PUT", f"/proxies/{urllib.parse.quote(GROUP, safe='')}", {"name": name})

    def current(self) -> Optional[str]:
        try:
            return self.api("GET", f"/proxies/{urllib.parse.quote(GROUP, safe='')}").get("now")
        except CoreError:
            return None

    def delay(self, name: str, url: str = DELAY_URL, timeout_ms: int = DELAY_TIMEOUT_MS) -> Optional[int]:
        query = urllib.parse.urlencode({"url": url, "timeout": timeout_ms})
        try:
            value = self.api("GET", f"/proxies/{urllib.parse.quote(name, safe='')}/delay?{query}", timeout=timeout_ms / 1000 + 3)
        except CoreError:
            return None
        delay = value.get("delay") if isinstance(value, dict) else None
        return int(delay) if isinstance(delay, (int, float)) and delay > 0 else None

    def delays(self, url: str = DELAY_URL, timeout_ms: int = DELAY_TIMEOUT_MS) -> Dict[str, int]:
        """Test every node at once.  Missing names timed out or failed."""
        query = urllib.parse.urlencode({"url": url, "timeout": timeout_ms})
        value = self.api("GET", f"/group/{urllib.parse.quote(GROUP, safe='')}/delay?{query}", timeout=timeout_ms / 1000 + 8)
        return {str(k): int(v) for k, v in (value or {}).items() if isinstance(v, (int, float)) and v > 0}


def attach_kill_on_close(core: "MihomoCore") -> None:
    """Tie the core to this process with a Job object, so a crash or a
    task-manager kill of 碧琪 never leaves an orphan proxy behind."""
    if core.process:
        assign_to_kill_job(core.process.pid)


_JOB = None


def create_kill_job():
    """Process-wide job with KILL_ON_JOB_CLOSE (handle is never closed)."""
    global _JOB
    if _JOB or os.name != "nt":
        return _JOB
    import ctypes
    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class EXTENDED(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO_COUNTERS),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel32 = ctypes.windll.kernel32
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return None
    info = EXTENDED()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info)):
        return None
    _JOB = wintypes.HANDLE(job)
    return _JOB


def assign_to_kill_job(pid: int) -> None:
    if os.name != "nt":
        return
    try:
        import ctypes

        job = create_kill_job()
        if not job:
            return
        handle = ctypes.windll.kernel32.OpenProcess(0x1F0FFF, False, int(pid))
        if handle:
            ctypes.windll.kernel32.AssignProcessToJobObject(job, handle)
            ctypes.windll.kernel32.CloseHandle(handle)
    except Exception:  # noqa: BLE001
        pass


def browser_proxy_arguments(proxy_port: Optional[int]) -> List[str]:
    """Chromium switches for the in-app browser's private WebView2 profile.

    With a node: everything except loopback (Chromium keeps 127.0.0.1 and
    localhost direct by default, so local previews still work) goes to our core, and WebRTC may not leak the real address over
    UDP.  Without one the browser behaves like any normal browser.
    """
    if not proxy_port:
        return []
    return [
        f"--proxy-server=http://127.0.0.1:{int(proxy_port)}",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    ]
