"""Bundled Node/OpenClaw runtime layout and DesktopControlNode supervisor for Windows."""

from __future__ import annotations

import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse

if "_PINKIE_DESKTOP_PART" not in globals():
    def _desktop():
        module = sys.modules.get("app.windows_desktop") or sys.modules.get("windows_desktop")
        if module is not None:
            return module
        try:
            import windows_desktop as module
        except ImportError:  # imported as app.windows_runtime (tests)
            from app import windows_desktop as module
        return module

    def append_log(*args, **kwargs):
        return _desktop().append_log(*args, **kwargs)

    def state_root(*args, **kwargs):
        return _desktop().state_root(*args, **kwargs)

    def bind_to_app_lifetime(*args, **kwargs):
        return _desktop().bind_to_app_lifetime(*args, **kwargs)

    def hidden_process_kwargs(*args, **kwargs):
        return _desktop().hidden_process_kwargs(*args, **kwargs)

    GATEWAY_URL = "http://127.0.0.1:18789/"


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


def _config_repair_module():
    try:
        import config_repair
    except ImportError:  # imported as app.windows_desktop (tests)
        from app import config_repair
    return config_repair


def _gateway_proxy_module():
    try:
        import gateway_proxy
    except ImportError:  # imported as app.windows_desktop (tests)
        from app import gateway_proxy
    return gateway_proxy


class DesktopControlNode:
    """The Mac shell's 「桌面控制」 service, wired the Windows way.

    Mac installs a CUA driver for screen capture and input, then starts a node
    host so the gateway's computer tool can reach it. Windows has no CUA driver,
    so this starts the same headless node with the runtime already bundled:
    without it 碧琪 has no computer target on Windows at all, and the tool
    silently has nothing to call. The node is optional by design -- a failure
    here only costs desktop control, never chat.
    """

    DISPLAY_NAME = "超級碧琪桌面控制"

    def __init__(self, runtime):
        self.runtime = runtime
        self.process = None
        self.closing = threading.Event()
        self.lock = threading.RLock()
        self.generation = 0
        self.last_error = ""
        self.restarts = 0
        self.restart_limit = 5
        self._restarting = False

    def _entry(self):
        entry = self.runtime.openclaw
        return entry if entry.is_file() else None

    @staticmethod
    def device_environment(base):
        """Environment for the node process, with its own device identity.

        OpenClaw keys a device on its stored metadata. Running this node out of
        the desktop state dir registered a second, differently-shaped record for
        the same device, and the gateway then treated the CLI's next connect as
        an unapproved metadata change -- every watchdog chat.send retry was
        refused with "device metadata change pending approval", so a dropped
        stream never resumed. A separate state dir makes the node pair as its
        own device and leaves the CLI's approved identity alone.
        """
        environment = dict(base)
        environment["OPENCLAW_SERVICE_KIND"] = "node"
        environment["OPENCLAW_STATE_DIR"] = str(state_root() / "desktop-control-node")
        return environment

    def _arguments(self):
        entry = self._entry()
        if entry is None:
            return None
        parsed = urllib.parse.urlparse(GATEWAY_URL)
        arguments = [
            str(entry), "node", "run",
            "--host", parsed.hostname or "127.0.0.1",
            "--port", str(parsed.port or 18789),
            "--display-name", self.DISPLAY_NAME,
        ]
        if parsed.scheme == "https":
            arguments.append("--tls")
        return arguments

    def start(self):
        arguments = self._arguments()
        if not arguments:
            self.last_error = "node runtime missing"
            append_log("computer", "desktop control skipped: bundled OpenClaw entry is missing")
            return False
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                return True
            node = self.runtime.node
            if not node.is_file():
                self.last_error = "node binary missing"
                append_log("computer", "desktop control skipped: bundled node is missing")
                return False
            environment = dict(os.environ)
            environment.update(self.runtime.environment())
            environment = self.device_environment(environment)
            environment["PINKIE_OPENCLAW_ENTRY"] = str(self._entry())
            self.generation += 1
            generation = self.generation
            try:
                process = subprocess.Popen(
                    [str(node)] + arguments,
                    cwd=str(self.runtime.root),
                    env=environment,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    **hidden_process_kwargs(),
                )
            except OSError as error:
                self.last_error = str(error)
                append_log("computer", f"desktop control failed to start: {error}")
                return False
            self.process = process
            self.last_error = ""
            bind_to_app_lifetime(process, "desktop control node")
            append_log("computer", f"desktop control node started (pid {process.pid})")
            threading.Thread(
                target=self._watch, args=(process, generation), name="pinkie-computer-watch", daemon=True
            ).start()
            return True

    def _watch(self, process, generation):
        code = process.wait()
        with self.lock:
            if generation != self.generation or self.closing.is_set():
                return
            self.process = None
            self.last_error = f"node exited with {code}"
        append_log("computer", f"desktop control node exited with {code}")
        self._schedule_restart()

    def _schedule_restart(self):
        """Restart once, from a single worker, with backoff.

        A node that dies on a bad gateway URL would die again on every retry, so
        this backs off and gives up after restart_limit. The restart runs on its
        own thread so close() can still cancel it: doing it inline would keep the
        watcher alive after the window was gone.
        """
        if self.closing.is_set():
            return
        with self.lock:
            if self._restarting or self.restarts >= self.restart_limit:
                if self.restarts >= self.restart_limit:
                    append_log("computer", "desktop control node stopped restarting after repeated failures")
                return
            self._restarting = True
            self.restarts += 1
            delay = min(30, 2 ** self.restarts)

        def again():
            try:
                if self.closing.wait(delay):
                    return
                self.start()
            finally:
                with self.lock:
                    self._restarting = False

        threading.Thread(target=again, name="pinkie-computer-restart", daemon=True).start()

    def close(self):
        """Stop the node and cancel any pending restart. Safe to call twice."""
        self.closing.set()
        with self.lock:
            process = self.process
            self.process = None
            # Bumping the generation makes a watcher for the old process return
            # without scheduling another restart.
            self.generation += 1
        if process is not None and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=5)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass

    def status(self):
        process = self.process
        return {
            "running": bool(process is not None and process.poll() is None),
            "pid": process.pid if process is not None and process.poll() is None else None,
            "error": self.last_error,
        }
