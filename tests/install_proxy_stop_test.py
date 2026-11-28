"""install.sh stops only its own rewrite proxy (this checkout's script on UR_PROXY_PORT).

Runs a copy of install.sh in a temp repo with an isolated HOME. The "proxies" are harmless
sleepers, every external command the script would use on the real machine is a logging shim,
and the pkill shim only ever signals pids this test started, so the real launchd proxies
(~/bin/mm-retry-proxy.py, com.openclaw.mm-retry-proxy*) are never touched even when the
pre-fix script is run against this test.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = Path(os.environ.get("PINKIE_INSTALL_SH_UNDER_TEST", REPO / "install.sh"))
PORT = "61467"
OTHER_PORT = "61468"
LOGGED = ("node", "launchctl", "curl", "osascript", "open", "killall")
LOG_SHIM = """#!/bin/bash
echo "NAME $*" >> "$PINKIE_TEST_ROOT/shim.log"
exit 0
"""
# Same matching idea as pkill -f, but restricted to pids recorded by this test.
PKILL_SHIM = """#!/bin/bash
echo "pkill $*" >> "$PINKIE_TEST_ROOT/shim.log"
pat="${@: -1}"
while read -r pid; do
  cmd="$(/bin/ps -ww -o command= -p "$pid" 2>/dev/null)" || continue
  [[ "$cmd" == *"$pat"* ]] && kill "$pid" 2>/dev/null
done < "$PINKIE_TEST_ROOT/pids"
exit 0
"""
# Only the proxy launch reaches a real interpreter; setup.py steps are logged.
PYTHON_SHIM = """#!/bin/bash
if [[ "$1" == "$PINKIE_TEST_PROXY" ]]; then exec "$PINKIE_REAL_PY" "$@"; fi
echo "python3 $*" >> "$PINKIE_TEST_ROOT/shim.log"
exit 0
"""
DUMMY_PROXY = """import os, time
with open(os.path.join(os.environ["PINKIE_TEST_ROOT"], "pids"), "a") as f:
    f.write(f"{os.getpid()}\\n")
time.sleep(60)
"""


def alive(pid):
    out = subprocess.run(["/bin/ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True)
    stat = out.stdout.strip()
    return out.returncode == 0 and stat != "" and not stat.startswith("Z")


@unittest.skipIf(sys.platform == "win32" or not shutil.which("bash"), "needs bash and ps")
class InstallProxyStopTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="pinkie-install-proxy-")).resolve()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.home = self.root / "home"
        (self.home / "Library" / "LaunchAgents").mkdir(parents=True)
        self.repo = self.root / "repo"
        (self.repo / "proxy").mkdir(parents=True)
        (self.repo / "prompts").mkdir()
        (self.repo / "prompts" / "unrestricted-prompt-test.txt").write_text("x", encoding="utf-8")
        shutil.copy(SCRIPT, self.repo / "install.sh")
        self.proxy = self.repo / "proxy" / "mm-retry-proxy.py"
        self.proxy.write_text(DUMMY_PROXY, encoding="utf-8")
        self.lookalike = self.root / "bin" / "mm-retry-proxy.py"
        self.lookalike.parent.mkdir()
        self.lookalike.write_text(DUMMY_PROXY, encoding="utf-8")
        (self.root / "pids").write_text("", encoding="utf-8")
        shims = self.root / "shims"
        shims.mkdir()
        bodies = [(n, LOG_SHIM.replace("NAME", n)) for n in LOGGED]
        bodies += [("pkill", PKILL_SHIM), ("python3", PYTHON_SHIM)]
        for name, body in bodies:
            (shims / name).write_text(body, encoding="utf-8")
            (shims / name).chmod(0o755)
        self.addCleanup(self.kill_recorded)

    def recorded(self):
        return set((self.root / "pids").read_text(encoding="utf-8").split())

    def kill_recorded(self):
        for pid in self.recorded():
            try:
                os.kill(int(pid), 9)
            except (ProcessLookupError, ValueError):
                pass

    def spawn(self, argv, needle):
        env = {**os.environ, "PINKIE_TEST_ROOT": str(self.root)}
        proc = subprocess.Popen(argv, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=True)
        self.addCleanup(proc.wait)
        self.addCleanup(lambda: proc.poll() is None and proc.kill())
        with open(self.root / "pids", "a", encoding="utf-8") as f:
            f.write(f"{proc.pid}\n")
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            cmd = subprocess.run(["/bin/ps", "-ww", "-o", "command=", "-p", str(proc.pid)],
                                 capture_output=True, text=True).stdout
            if needle in cmd:
                return proc
            time.sleep(0.05)
        self.fail(f"spawned process never showed {needle!r}")

    def spawn_fleet(self):
        py = sys.executable
        own = self.spawn([py, str(self.proxy), PORT], f"{self.proxy} {PORT}")
        bystanders = {
            "same script, other port": self.spawn([py, str(self.proxy), OTHER_PORT],
                                                  f"{self.proxy} {OTHER_PORT}"),
            "~/bin style lookalike, same port": self.spawn([py, str(self.lookalike), PORT],
                                                           str(self.lookalike)),
            "unrelated command mentioning the name": self.spawn(
                ["/bin/bash", "-c", f"sleep 60; : {self.proxy} {PORT}"], str(self.proxy)),
        }
        return own, bystanders

    def run_install(self, *args):
        env = {
            "HOME": str(self.home),
            "PATH": f"{self.root / 'shims'}:/usr/bin:/bin:/usr/sbin:/sbin",
            "PINKIE_TEST_ROOT": str(self.root),
            "PINKIE_TEST_PROXY": str(self.proxy),
            "PINKIE_REAL_PY": sys.executable,
            "UR_PROXY_PORT": PORT,
            "UR_PROMPTS_DIR": str(self.root / "prompts-out"),
            "UR_PROXY_LOG": str(self.root / "proxy.log"),
            "OPENCLAW_ROOT": str(self.root / "oc-empty"),
        }
        result = subprocess.run(["bash", str(self.repo / "install.sh"), *args], cwd=self.root, env=env,
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def assert_only_own_stopped(self, own, bystanders):
        own.wait(timeout=5)
        time.sleep(0.3)
        survivors = {name: p.poll() is None for name, p in bystanders.items()}
        self.assertEqual(survivors, {name: True for name in bystanders})

    def test_remove_stops_only_own_proxy(self):
        own, bystanders = self.spawn_fleet()
        self.run_install("--remove")
        self.assert_only_own_stopped(own, bystanders)

    def test_install_restarts_only_own_proxy(self):
        own, bystanders = self.spawn_fleet()
        before = self.recorded()
        self.run_install()
        self.assert_only_own_stopped(own, bystanders)
        deadline = time.monotonic() + 10
        fresh = set()
        while time.monotonic() < deadline and not fresh:
            fresh = self.recorded() - before
            time.sleep(0.05)
        self.assertEqual(len(fresh), 1, "install.sh should start exactly one new proxy")
        self.assertTrue(alive(int(fresh.pop())))


if __name__ == "__main__":
    unittest.main()
