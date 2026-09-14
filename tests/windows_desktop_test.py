import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from app import super_pinkie, windows_desktop
from app.windows_desktop import (
    RELAY_SERVICE,
    LocalServices,
    http_alive,
    http_identity,
)


class WindowsDesktopPreservationTests(unittest.TestCase):
    def test_packaged_first_launch_keeps_existing_prompt_and_persona(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            resources = root / "resources"
            home = root / "home"
            (resources / "prompts").mkdir(parents=True)
            (resources / "personas/chat").mkdir(parents=True)
            (resources / "prompts/unrestricted-prompt-gemini.txt").write_text("发行默认", encoding="utf-8")
            (resources / "personas/chat/SOUL.md").write_text("发行人格", encoding="utf-8")
            prompt_dir = home / ".openclaw"
            workspace = prompt_dir / "workspace"
            workspace.mkdir(parents=True)
            (prompt_dir / "unrestricted-prompt-gemini.txt").write_text("用户手改提示词", encoding="utf-8")
            (workspace / "SOUL.md").write_text("用户手改人格", encoding="utf-8")

            def resource_path(*parts):
                return resources.joinpath(*parts)

            with (
                mock.patch.object(super_pinkie, "resource_path", side_effect=resource_path),
                mock.patch.object(super_pinkie, "prompts_dir", return_value=prompt_dir),
                mock.patch.object(super_pinkie.Path, "home", return_value=home),
                mock.patch.object(super_pinkie.subprocess, "run", return_value=mock.Mock(stdout="[]")),
            ):
                super_pinkie.ensure_prompts(lambda _message: None, preserve_existing=True)
                super_pinkie.install_personas(lambda _message: None, preserve_existing=True)

            self.assertEqual(
                (prompt_dir / "unrestricted-prompt-gemini.txt").read_text(encoding="utf-8"),
                "用户手改提示词",
            )
            self.assertEqual((workspace / "SOUL.md").read_text(encoding="utf-8"), "用户手改人格")


class ForeignProxyHandler(BaseHTTPRequestHandler):
    """Stands in for any other proxy on the shared 1467 convention.

    Responds exactly like the bundled relay's legacy shape would: ok + attempts,
    but no service name.
    """

    attempts = 24

    def do_GET(self):
        body = json.dumps({"ok": True, "attempts": self.attempts}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


class RelayPortIdentityTests(unittest.TestCase):
    """Port 1467 is shared with user-run proxies, so identity must be checked.

    A bare "something answered with 200" test made the launcher believe its own
    relay was already running, so it started nothing and said nothing.
    """

    ROOT = Path(__file__).resolve().parents[1]
    RELAY = ROOT / "proxy" / "mm-retry-proxy.py"

    @staticmethod
    def free_port():
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        return port

    def wait_health(self, url, timeout=30):
        deadline = time.time() + timeout
        while time.time() < deadline:
            identity = http_identity(url)
            if identity:
                return identity
            time.sleep(0.25)
        return {}

    def start_foreign_proxy(self):
        port = self.free_port()
        server = ThreadingHTTPServer(("127.0.0.1", port), ForeignProxyHandler)

        def stop():
            server.shutdown()
            server.server_close()

        self.addCleanup(stop)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return port, f"http://127.0.0.1:{port}/health"

    def start_relay_process(self, script, port=None, extra_args=()):
        """Launch a relay script on a free port and return its /health URL."""

        def stop(process):
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

        port = port or self.free_port()
        relay = subprocess.Popen(
            [sys.executable, str(script), str(port), *extra_args],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.addCleanup(stop, relay)
        url = f"http://127.0.0.1:{port}/health"
        self.wait_health(url)
        return url

    def test_bundled_relay_identifies_itself_on_health(self):
        url = self.start_relay_process(self.RELAY, extra_args=(str(self.free_port()),))

        identity = http_identity(url)
        self.assertEqual(identity.get("service"), RELAY_SERVICE, identity)
        self.assertIsInstance(identity.get("attempts"), int, identity)
        self.assertTrue(http_alive(url, RELAY_SERVICE))

    def test_the_app_serves_the_same_relay_the_installer_does(self):
        """install.ps1 and the app must not run two different relays.

        The installer has always run mm-retry-proxy.py; the app used to start
        the older ur-rewrite-proxy.py on the same port, which silently decided
        which features were in the path.
        """
        self.assertTrue(super_pinkie.resource_path("proxy", "mm-retry-proxy.py").is_file())
        launcher = (self.ROOT / "app" / "windows_desktop.py").read_text(encoding="utf-8")
        installer = (self.ROOT / "install.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("mm-retry-proxy.py", installer)
        self.assertIn("proxy/mm-retry-proxy.py", launcher)

    def test_a_foreign_proxy_is_not_mistaken_for_the_bundled_relay(self):
        _port, url = self.start_foreign_proxy()

        self.assertTrue(http_identity(url), "the foreign proxy should be detectable")
        self.assertTrue(http_alive(url), "it does answer on the port")
        self.assertFalse(
            http_alive(url, RELAY_SERVICE),
            "an unknown proxy must not satisfy the relay identity check",
        )

    def test_occupied_relay_port_is_reported_instead_of_silently_skipped(self):
        port, _url = self.start_foreign_proxy()

        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(windows_desktop, "state_root", return_value=Path(directory)):
                services = LocalServices(runtime=mock.Mock(root=self.ROOT))
                services._start_relay(port, self.free_port())
                time.sleep(0.3)

            self.assertIsNone(services.relay, "the bundled relay must not be started")
            log = (Path(directory) / "logs" / "launcher.log").read_text(encoding="utf-8")

        self.assertIn("relay port busy", log)
        self.assertIn('"attempts": 24', log)
        self.assertIn("was not started", log)
        self.assertIn("unrestricted prompt", log)

    def test_relay_is_served_by_reexecuting_the_app_when_the_port_is_free(self):
        """The frozen build has no interpreter, so the app re-executes itself.

        This exercises the real path end to end: LocalServices spawns the app in
        relay mode, and the relay that answers is mm-retry-proxy.py.
        """
        port = self.free_port()
        upstream = self.free_port()

        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(windows_desktop, "state_root", return_value=Path(directory)):
                services = LocalServices(runtime=mock.Mock(root=self.ROOT))
                services._start_relay(port, upstream)

                self.assertIsNotNone(services.relay, "the relay process should have started")
                pid = services.relay.pid
                identity = self.wait_health(f"http://127.0.0.1:{port}/health")
                log = (Path(directory) / "logs" / "launcher.log").read_text(encoding="utf-8")
                # Stop the relay before the temporary directory goes away: its
                # stdout handle keeps relay.log open otherwise.
                services.close()

        self.assertEqual(identity.get("service"), RELAY_SERVICE, identity)
        self.assertIn(f"relay started pid={pid}", log)

    def test_relay_command_reexecutes_the_app_not_a_bare_script(self):
        command = windows_desktop.relay_command(1467, 1466)

        self.assertEqual(command[0], sys.executable)
        self.assertIn("--ur-relay", command)
        self.assertEqual(command[-2:], ["1467", "1466"])
        self.assertEqual(super_pinkie.relay_ports_from_argv(["--ur-relay", "1467", "1466"]), (1467, 1466))
        self.assertIsNone(super_pinkie.relay_ports_from_argv(["--control-center"]))

    def test_super_pinkie_health_requires_the_bundled_relay(self):
        self.assertEqual(
            super_pinkie.RELAY_SERVICE,
            RELAY_SERVICE,
            "both launchers must agree on the relay's reported identity",
        )
        port, _url = self.start_foreign_proxy()

        self.assertFalse(
            super_pinkie.proxy_health(port),
            "a foreign proxy must not read as a healthy bundled relay",
        )

        relay_port = int(
            self.start_relay_process(self.RELAY, extra_args=(str(self.free_port()),)).split(":")[2].split("/")[0]
        )
        self.assertTrue(super_pinkie.proxy_health(relay_port))


if __name__ == "__main__":
    unittest.main()
