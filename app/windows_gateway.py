"""GatewaySupervisor and LocalServices supervisors for the Windows desktop shell."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import traceback

if "_PINKIE_DESKTOP_PART" not in globals():
    GATEWAY_URL = "http://127.0.0.1:18789/"
    PARTY_URL = "http://127.0.0.1:18889/"
    ROUNDTABLE_URL = "http://127.0.0.1:18891/"
    TTS_URL = "http://127.0.0.1:18888/health"
    RELAY_SERVICE = "super-pinkie-relay"

    def _desktop():
        module = sys.modules.get("app.windows_desktop") or sys.modules.get("windows_desktop")
        if module is not None:
            return module
        try:
            import windows_desktop as module
        except ImportError:  # imported as app.windows_gateway (tests)
            from app import windows_desktop as module
        return module

    def _config_repair_module(*args, **kwargs): return _desktop()._config_repair_module(*args, **kwargs)
    def _gateway_proxy_module(*args, **kwargs): return _desktop()._gateway_proxy_module(*args, **kwargs)
    def app_version(*args, **kwargs): return _desktop().app_version(*args, **kwargs)
    def append_log(*args, **kwargs): return _desktop().append_log(*args, **kwargs)
    def bind_to_app_lifetime(*args, **kwargs): return _desktop().bind_to_app_lifetime(*args, **kwargs)
    def gateway_closed_marker(*args, **kwargs): return _desktop().gateway_closed_marker(*args, **kwargs)
    def gateway_listener_pid(*args, **kwargs): return _desktop().gateway_listener_pid(*args, **kwargs)
    def hidden_process_kwargs(*args, **kwargs): return _desktop().hidden_process_kwargs(*args, **kwargs)
    def http_alive(*args, **kwargs): return _desktop().http_alive(*args, **kwargs)
    def http_identity(*args, **kwargs): return _desktop().http_identity(*args, **kwargs)
    def http_ready(*args, **kwargs): return _desktop().http_ready(*args, **kwargs)
    def keep_gateway_after_close(*args, **kwargs): return _desktop().keep_gateway_after_close(*args, **kwargs)
    def kill_process_tree(*args, **kwargs): return _desktop().kill_process_tree(*args, **kwargs)
    def openclaw_config_path(*args, **kwargs): return _desktop().openclaw_config_path(*args, **kwargs)
    def process_image_and_start(*args, **kwargs): return _desktop().process_image_and_start(*args, **kwargs)
    def stale_gateway_reason(*args, **kwargs): return _desktop().stale_gateway_reason(*args, **kwargs)
    def state_root(*args, **kwargs): return _desktop().state_root(*args, **kwargs)


class GatewaySupervisor:
    def __init__(self, runtime):
        self.runtime = runtime
        self.process = None
        self.closing = threading.Event()
        self.marker_cleared = False
        self.lock = threading.RLock()
        self.last_restart = 0.0
        self.failure_limit = 2
        self.version = app_version(runtime.root)
        self.log_offset = 0
        self.exit_inspected = True
        self.good_saved = False
        self.repairs = 0
        self.repair_limit = 3
        self.repairing = threading.Lock()
        # Shown once on the startup page, e.g. 「碧琪发现设置文件有一处写错了，已经自动修好」.
        self.notice = ""
        self.exits = 0
        self.proxy_checked = 0.0
        self.proxy_mtime = None

    def root_proxy(self, force=False):
        """Take over a root ``proxy`` block before it reroutes the model relay.

        Returns the proxy URL the gateway should get as environment variables.
        Cheap enough for the watchdog: the file is only read when it changed.
        """
        module = _gateway_proxy_module()
        path = openclaw_config_path()
        try:
            mtime = path.stat().st_mtime_ns
        except OSError:
            mtime = None
        if force or mtime != self.proxy_mtime:
            self.proxy_mtime = mtime
            module.repair(path, state_root(), log=lambda message: append_log("launcher", message))
            try:
                self.proxy_mtime = path.stat().st_mtime_ns
            except OSError:
                pass
        try:
            config = json.loads(path.read_text(encoding="utf-8-sig") or "{}")
        except (OSError, ValueError, UnicodeError):
            return None
        return module.proxy_url(state_root(), config)

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
            # The window is closing: a monitor tick that was already past its
            # wait must not spawn a gateway after close() stopped the last one.
            if self.closing.is_set():
                return
            if not self.marker_cleared:
                # 碧琪 is running again, so the gateway watchdog may recover a
                # crashed gateway again.
                self.marker_cleared = True
                try:
                    gateway_closed_marker().unlink(missing_ok=True)
                except OSError:
                    pass
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
            # Only what this process prints is read when it exits.
            self.log_offset = 0
            try:
                output.seek(0, os.SEEK_END)
                self.log_offset = output.tell()
            except OSError:
                pass
            self.exit_inspected = False
            self.good_saved = False
            command = [
                str(self.runtime.node), str(self.runtime.openclaw),
                "gateway", "run", "--port", "18789", "--bind", "loopback", "--auth", "none", "--allow-unconfigured",
            ]
            try:
                gateway_environment = self.runtime.environment()
                gateway_environment["OPENCLAW_SERVICE_KIND"] = "gateway"
                try:
                    _gateway_proxy_module().apply_environment(gateway_environment, self.root_proxy(force=True))
                except Exception as error:  # never block the gateway on this
                    append_log("launcher", f"gateway proxy check failed: {error}")
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
                if not keep_gateway_after_close():
                    bind_to_app_lifetime(self.process, "gateway")
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

    def _node_command(self, *arguments, timeout=60):
        environment = self.runtime.environment()
        environment["OPENCLAW_SERVICE_KIND"] = "cli"
        return subprocess.run(
            [str(self.runtime.node), str(self.runtime.openclaw), *arguments],
            cwd=str(self.runtime.openclaw.parent), env=environment,
            stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout,
            **hidden_process_kwargs(),
        )

    def validate_config(self):
        try:
            result = self._node_command("config", "validate", "--json", timeout=60)
            data = json.loads(result.stdout.decode("utf-8", "replace"))
            paths = [str(issue.get("path") or "<root>") for issue in data.get("issues") or [] if isinstance(issue, dict)]
            return bool(data.get("valid")), paths
        except (OSError, ValueError, subprocess.SubprocessError, AttributeError) as error:
            append_log("launcher", f"config validate could not run: {error}")
            return None, []

    def doctor_fix(self):
        try:
            result = self._node_command("doctor", "--fix", "--non-interactive", timeout=240)
            append_log("launcher", f"doctor --fix exited {result.returncode}")
            return result.returncode == 0
        except (OSError, subprocess.SubprocessError) as error:
            append_log("launcher", f"doctor --fix could not run: {error}")
            return False

    def config_repair(self):
        return _config_repair_module().ConfigRepair(
            openclaw_config_path(), state_root(), validate=self.validate_config,
            doctor=self.doctor_fix, log=lambda message: append_log("launcher", message),
        )

    def _new_gateway_output(self, limit=256 * 1024):
        try:
            with (state_root() / "logs/gateway.log").open("rb") as handle:
                handle.seek(0, os.SEEK_END)
                end = handle.tell()
                start = max(self.log_offset, end - limit) if end >= self.log_offset else max(0, end - limit)
                handle.seek(start)
                return handle.read().decode("utf-8", "replace")
        except OSError:
            return ""

    def repair_config(self, paths=None, force=False):
        """Repair openclaw.json once the gateway said it is invalid."""
        if not self.repairing.acquire(blocking=False):
            return {"repaired": False, "step": "busy", "message": "正在修复，请稍等"}
        try:
            if not force and self.repairs >= self.repair_limit:
                return {"repaired": False, "step": "limit", "message": ""}
            self.repairs += 1
            result = self.config_repair().repair(paths)
            if result.get("repaired"):
                self.notice = result.get("message", "")
            append_log("launcher", f"config repair result: {result.get('step')}")
            return result
        except Exception as error:
            append_log("launcher", f"config repair failed: {error}")
            return {"repaired": False, "step": "error", "message": "自动修复没有完成，请打开日志文件夹查看"}
        finally:
            self.repairing.release()

    def inspect_exit(self):
        """Read what the exited gateway printed; repair an invalid config."""
        if self.exit_inspected:
            return None
        self.exit_inspected = True
        self.exits += 1
        paths = _config_repair_module().invalid_config_paths(self._new_gateway_output())
        if paths is None:
            return None
        append_log("launcher", "gateway exited on an invalid config")
        return self.repair_config(paths)

    def note_ready(self):
        if self.good_saved:
            return
        self.good_saved = True
        self.repairs = 0
        try:
            self.config_repair().save_last_good()
        except Exception as error:
            append_log("launcher", f"last-good config not saved: {error}")

    def monitor(self):
        failures = 0
        while not self.closing.wait(.75):
            with self.lock:
                process = self.process
                alive = bool(process and process.poll() is None)
            if http_ready(GATEWAY_URL):
                failures = 0
                self.note_ready()
                # 碧琪 can edit openclaw.json herself (11-05: she added a root
                # proxy after a failed web_fetch and restarted the gateway).
                # Undo that within seconds; the gateway hot-reloads "proxy".
                if time.monotonic() - self.proxy_checked >= 5:
                    self.proxy_checked = time.monotonic()
                    try:
                        self.root_proxy()
                    except Exception as error:
                        append_log("launcher", f"gateway proxy check failed: {error}")
                continue
            if process is not None and not alive:
                # A gateway that died on a bad openclaw.json would die again on
                # every restart. Fix the file first, then restart.
                self.inspect_exit()
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

    def reload_for_config(self, seconds=90):
        """Restart the gateway so it picks up config written while it was up.

        OpenClaw reads plugins and agents once at startup. A gateway kept alive
        after the previous window closed therefore keeps serving the old set,
        and a plugin installed by this launch would look present-but-inactive
        until the user restarted by hand. Stopping and waiting for the port
        makes the next start read the new config.
        """
        self.stop_process()
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and http_ready(GATEWAY_URL):
            time.sleep(0.2)
        self.start()
        return self.wait_ready(seconds)

    def stop_adopted(self):
        """Stop a gateway this launch attached to instead of starting.

        A gateway left by an earlier run of this same install (kept alive by an
        older version, or orphaned by a crash) answers on the port, so start()
        never spawned one and there is no process handle to stop. Only this
        install's own bundled node.exe is ever ended; a gateway the user runs
        themselves is left alone.
        """
        try:
            listener = self._listener()
            image = str((listener or {}).get("image") or "")
            if not image or os.path.normcase(image) != os.path.normcase(str(self.runtime.node)):
                return False
            kill_process_tree(listener["pid"])
            append_log("launcher", f"stopped adopted gateway pid={listener['pid']}")
            return True
        except (OSError, subprocess.SubprocessError, KeyError) as error:
            append_log("launcher", f"adopted gateway could not be stopped: {error}")
            return False

    def close(self):
        self.closing.set()
        try:
            gateway_closed_marker().write_text(f"{time.strftime('%Y-%m-%d %H:%M:%S')} pid={os.getpid()}\n", encoding="utf-8")
        except OSError as error:
            append_log("launcher", f"gateway-closed marker not written: {error}")
        self.stop_process()
        self.stop_adopted()


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
            bind_to_app_lifetime(self.relay, "relay")
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
