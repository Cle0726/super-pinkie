#!/usr/bin/env python3
"""Mac 一键验收：在临时 HOME 里 install -> 冒烟 -> update 到目标提交 -> 冒烟 -> uninstall，最后出一份 Markdown 报告。

隔离：HOME / 状态 / 配置 / App 目录全部指向 /private/tmp/pinkie-accept-*；环境变量只用白名单（不继承任何密钥）；
launchctl / pkill / killall / osascript / open 换成只记日志的垫片，mv / ditto 拒绝临时根以外的目标；
OpenClaw 用干净包的克隆；代理只连本进程里的假上游。不碰真实 ~/Library、钥匙串、/Applications/超級碧琪.app 和 18789 网关。

用法：python3 tools/acceptance/mac/run.py [--report <路径>] [--keep] [--break remove-installed-file]
退出码：0 全绿；1 有检查没过（报告里写明是哪一步哪一项）；2 本机条件不满足，没开跑。
"""
import argparse
import datetime
import glob
import http.client
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEFAULT_OPENCLAW_SRC = "/Users/Admin/release-superpinkie/tools/openclaw-clean-2026.7.1-2/node_modules/openclaw"
APP_NAME = "超級碧琪.app"
BUNDLE_ID = "com.cle0726.super-pinkie"
DESIGNATED = 'designated => identifier "com.cle0726.super-pinkie"'
LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
PROXY_LOG = "/tmp/openclaw-mm-retry-proxy.log"
OPENCLAW_MARKERS = ["pinkie-loopback-model-reliability:v1", "pinkie-sdk-effort-payload:v1", "pinkie-work-thinking:v1"]
INJECTION_MARKER = 'applyUnrestrictedInjection(params, "completions"'
# apply-theme.sh 看到 Launcher 比源码新且带这些字符串，就不再调 swiftc 重编
LAUNCHER_MARKERS = ["super-pinkie.material-preview", "laolaoProjectFolder", "laolaoRoundtable", "laolaoWorkspaceDock",
                    "laolaoBrowserWorkspace", "laolaoMaterialPreview", "pinkieNative"]
# 两个提交的入口脚本必须认这些覆盖变量，否则会装进真实位置：不满足就不开跑
SAFETY = {"install-full.sh": "PINKIE_APP_ROOT", "uninstall-full.sh": "PINKIE_APP_PATH",
          "install.sh": "UR_PROMPTS_DIR", "proxy/mm-retry-proxy.py": "UR_PROXY_UPSTREAM_PORT"}
LOG_SHIMS = ["launchctl", "pkill", "killall", "osascript", "open"]
BREAKS = ["remove-installed-file"]

LOG_SHIM = """#!/bin/bash
echo "%(name)s $*" >> "$PINKIE_TEST_ROOT/shim.log"
exit 0
"""
GUARD_SHIM = """#!/bin/bash
for arg in "$@"; do
  case "$arg" in
    -*) ;;
    "$PINKIE_TEST_ROOT"/*) ;;
    *) echo "%(name)s refused $*" >> "$PINKIE_TEST_ROOT/shim.log"; exit 97 ;;
  esac
done
echo "%(name)s $*" >> "$PINKIE_TEST_ROOT/shim.log"
exec %(real)s "$@"
"""
STUB_REQUIREMENTS = "# 验收桩：TTS 依赖不在验收里装\n"
STUB_BUILD = r"""#!/bin/bash
# 验收桩（tools/acceptance/mac/run.py 只放进临时仓库）：不下载、不编 Swift，只产出一个签好名的最小 App
set -eu
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${PINKIE_BUILD_DIR:?}"
APP="$OUT/超級碧琪.app"
VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
sed "s/@VERSION@/$VERSION/g" "$REPO_ROOT/desktop/macos/Info.plist.in" > "$APP/Contents/Info.plist"
cat > "$OUT/launcher-stub.c" <<'EOF'
#include <stdio.h>
static const char *const markers[] = {MARKERS};
int main(int argc, char **argv) {
  (void)argv;
  if (argc > 1) for (unsigned i = 0; i < sizeof markers / sizeof *markers; i++) puts(markers[i]);
  return 0;
}
EOF
xcrun clang -O0 -o "$APP/Contents/MacOS/Launcher" "$OUT/launcher-stub.c"
rm -f "$OUT/launcher-stub.c"
codesign --force --options runtime --sign - --requirements '=designated => identifier "com.cle0726.super-pinkie"' "$APP"
""".replace("MARKERS", ", ".join('"%s"' % m for m in LAUNCHER_MARKERS))


def now():
    return datetime.datetime.now().strftime("%H:%M:%S")


def free_port():
    import socket
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def tail(path, n=40):
    try:
        lines = Path(path).read_text(errors="replace").splitlines()
    except OSError:
        return ""
    return "\n".join(lines[-n:])


def http_call(port, method, path, body=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        headers = {"Content-Type": "application/json"} if body is not None else {}
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        return resp.status, resp.read()[:300].decode(errors="replace")
    except OSError as error:
        return None, repr(error)
    finally:
        conn.close()


def resolve_rev(rev):
    r = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--verify", "--quiet", rev + "^{commit}"],
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError("解析不了提交 " + rev)
    return r.stdout.strip()


class FakeUpstream(BaseHTTPRequestHandler):
    hits = []

    def log_message(self, *args):
        pass

    def _send(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/v1/models"):
            self._send(200, {"data": [{"id": "accept-ok"}]})
        else:
            self._send(404, {})

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            model = json.loads(raw or b"{}").get("model")
        except ValueError:
            model = None
        FakeUpstream.hits.append(self.path)
        self._send(200, {"model": model, "choices": [{"index": 0, "message": {
            "role": "assistant", "content": "accept-ok"}, "finish_reason": "stop"}]})


def render_report(steps, meta):
    ok = bool(steps) and all(s["ok"] for s in steps)
    first = next((s for s in steps if not s["ok"]), None)
    out = ["# Mac 一键验收报告", "", "- 结果：**%s**" % ("通过" if ok else "失败")]
    if first:
        bad = [name for name, passed, _ in first["checks"] if not passed]
        why = "、".join(bad) if bad else "退出码 %s" % first["rc"]
        out.append("- 第一个失败：%s → %s" % (first["title"], why))
    for key, value in meta.get("facts", []):
        out.append("- %s：%s" % (key, value))
    out += ["", "## 步骤", "", "| # | 步骤 | 开始 | 耗时 | 退出码 | 结果 |", "|---|---|---|---|---|---|"]
    for i, s in enumerate(steps, 1):
        out.append("| %d | %s | %s | %.1fs | %s | %s |" % (
            i, s["title"], s["start"], s["secs"], "-" if s["rc"] is None else s["rc"], "通过" if s["ok"] else "**失败**"))
    out += ["", "## 检查"]
    for s in steps:
        if not s["checks"]:
            continue
        out += ["", "### " + s["title"], ""]
        for name, passed, detail in s["checks"]:
            out.append("- [%s] %s%s" % ("x" if passed else " ", name, (" — " + str(detail)) if detail else ""))
    for title, items in meta.get("sections", []):
        out += ["", "## " + title, ""]
        out += ["- " + item for item in items] if items else ["- （无）"]
    logged = [s for s in steps if s.get("tail")]
    if logged:
        out += ["", "## 日志尾"]
        for s in logged:
            out += ["", "<details><summary>%s</summary>" % s["title"], "", "```text", s["tail"], "```", "", "</details>"]
    return "\n".join(out) + "\n"


class Acceptance:
    def __init__(self, args):
        import pwd
        self.args = args
        self.steps = []
        self.notes = []
        self.residue = []
        self.shim_calls = []
        self.to_rev, self.from_rev = args.to_sha, args.from_sha
        self.s1 = self.s2 = None
        self.user = pwd.getpwuid(os.getuid()).pw_name
        self.real_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
        self.started = datetime.datetime.now()
        self.root = Path(tempfile.mkdtemp(prefix="pinkie-accept-", dir="/private/tmp")).resolve()
        r = self.root
        self.home, self.state, self.config = r / "home", r / "state", r / "config"
        self.apps, self.shims, self.tmp, self.logs = r / "apps", r / "shims", r / "tmp", r / "logs"
        self.fake, self.work, self.openclaw = r / "origin.git", r / "work", r / "openclaw"
        self.prompts = self.home / ".openclaw"
        self.app = self.apps / APP_NAME
        for d in (self.home, self.state, self.config, self.apps, self.shims, self.tmp, self.logs):
            d.mkdir(parents=True)
        FakeUpstream.hits = []
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream)
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        self.upstream_port = self.upstream.server_address[1]
        self.proxy_port = free_port()
        self.env = {
            "HOME": str(self.home), "CFFIXED_USER_HOME": str(self.home),
            "PATH": "%s:/usr/bin:/bin:/usr/sbin:/sbin" % self.shims, "TMPDIR": str(self.tmp) + "/",
            "LANG": "en_US.UTF-8", "USER": self.user, "LOGNAME": self.user, "SHELL": "/bin/bash",
            "PINKIE_TEST_ROOT": str(r), "PINKIE_STATE_ROOT": str(self.state), "PINKIE_CONFIG_ROOT": str(self.config),
            "PINKIE_APP_ROOT": str(self.apps), "PINKIE_APP_PATH": str(self.app),
            "OPENCLAW_ROOT": str(self.openclaw), "UR_PROMPTS_DIR": str(self.prompts), "UR_PROXY_PROMPTS_DIR": str(self.prompts),
            "UR_PROXY_PORT": str(self.proxy_port), "UR_UPSTREAM_PORT": str(self.upstream_port),
            "UR_PROXY_UPSTREAM_PORT": str(self.upstream_port),
            "PINKIE_PATCH_BACKUP_ROOT": str(r / "patch-backups"), "PINKIE_MANAGED_GATEWAY": "1",
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0",
            "GIT_AUTHOR_NAME": "pinkie-acceptance", "GIT_AUTHOR_EMAIL": "acceptance@localhost",
            "GIT_COMMITTER_NAME": "pinkie-acceptance", "GIT_COMMITTER_EMAIL": "acceptance@localhost",
            "PIP_DISABLE_PIP_VERSION_CHECK": "1", "PIP_NO_INDEX": "1", "PYTHONDONTWRITEBYTECODE": "1",
        }
        self.log_backup = Path(PROXY_LOG).read_bytes() if os.path.isfile(PROXY_LOG) else None
        self.real_before = self.snapshot_real()

    # ── 小工具 ──
    def sh(self, cmd, cwd=None, extra=None, data=None):
        env = dict(self.env)
        env.update(extra or {})
        r = subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, input=data, capture_output=True)
        return r.returncode, (r.stdout + r.stderr).decode(errors="replace").strip()

    def git(self, *args, git_dir=None, cwd=None, extra=None, data=None):
        cmd = ["git"] + (["--git-dir", git_dir] if git_dir else []) + list(args)
        env = dict(self.env)
        env.update(extra or {})
        r = subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, input=data, capture_output=True)
        if r.returncode:
            raise RuntimeError("git %s 失败：%s" % (" ".join(map(str, args)), r.stderr.decode(errors="replace").strip()[-400:]))
        return r.stdout.decode().strip()

    def step(self, key, title, cmd=None, cwd=None, checks=None, timeout=1800):
        rec = {"key": key, "title": title, "start": now(), "rc": None, "checks": [], "tail": ""}
        t0 = time.monotonic()
        if cmd:
            log = self.logs / ("%02d-%s.log" % (len(self.steps) + 1, key))
            try:
                with open(log, "wb") as fh:
                    rec["rc"] = subprocess.run([str(c) for c in cmd], cwd=cwd, env=dict(self.env), stdin=subprocess.DEVNULL,
                                               stdout=fh, stderr=subprocess.STDOUT, timeout=timeout).returncode
            except subprocess.TimeoutExpired:
                rec["rc"] = 124
            rec["tail"] = tail(log)
        if checks:
            try:
                rec["checks"] = checks()
            except Exception as error:  # 检查本身崩了也要进报告，不能让收尾跳过
                rec["checks"] = [("检查本身出错", False, repr(error))]
        rec["secs"] = time.monotonic() - t0
        rec["ok"] = rec["rc"] in (None, 0) and all(passed for _, passed, _ in rec["checks"])
        self.steps.append(rec)
        print("[%s] %-10s %s %.1fs" % (rec["start"], key, "ok" if rec["ok"] else "FAIL", rec["secs"]), flush=True)
        return rec["ok"]

    def snapshot_real(self):
        snap = {}
        agents = self.real_home / "Library/LaunchAgents"
        names = sorted(agents.glob("*")) if agents.is_dir() else []
        for p in names:
            if any(k in p.name for k in ("super-pinkie", "openclaw", "laolao")):
                st = p.lstat()
                snap[str(p)] = (st.st_mtime_ns, st.st_size)
        for p in ("/Applications/" + APP_NAME, "/Applications/%s/Contents/Info.plist" % APP_NAME,
                  str(self.real_home / "Applications" / APP_NAME)):
            try:
                st = os.lstat(p)
                snap[p] = (st.st_mtime_ns, st.st_ino)
            except FileNotFoundError:
                snap[p] = None
        return snap

    # ── 准备 ──
    def stub_commit(self, base, parent, message):
        extra = {"GIT_INDEX_FILE": str(self.tmp / "stub.index")}
        g = lambda *a, **k: self.git(*a, git_dir=self.fake, extra=extra, **k)
        g("read-tree", base)
        build = g("hash-object", "-w", "--stdin", data=STUB_BUILD.encode())
        req = g("hash-object", "-w", "--stdin", data=STUB_REQUIREMENTS.encode())
        g("update-index", "--add", "--cacheinfo", "100755,%s,desktop/macos/build.sh" % build)
        g("update-index", "--add", "--cacheinfo", "100644,%s,services/tts/requirements.txt" % req)
        tree = g("write-tree")
        (self.tmp / "stub.index").unlink()
        return g("commit-tree", tree, "-m", message, *(["-p", parent] if parent else []))

    def prepare(self):
        checks = []
        node = os.path.realpath(shutil.which("node") or "/opt/homebrew/opt/node@22/bin/node")
        os.symlink(node, self.shims / "node")
        for name in LOG_SHIMS:
            (self.shims / name).write_text(LOG_SHIM % {"name": name})
        for name, real in (("mv", "/bin/mv"), ("ditto", "/usr/bin/ditto")):
            (self.shims / name).write_text(GUARD_SHIM % {"name": name, "real": real})
        for p in self.shims.iterdir():
            if not p.is_symlink():
                p.chmod(0o755)
        if self.args.python:
            os.symlink(self.args.python, self.shims / "python3")
        checks.append(("垫片", True, "node → %s；只记日志：%s；限临时根：mv、ditto%s" % (
            node, "、".join(LOG_SHIMS), "；python3 → " + self.args.python if self.args.python else "")))

        src = self.args.openclaw_src
        if subprocess.run(["cp", "-cR", src, str(self.openclaw)], capture_output=True).returncode:
            shutil.rmtree(self.openclaw, ignore_errors=True)
            subprocess.run(["cp", "-R", src, str(self.openclaw)], check=True, capture_output=True)
        checks.append(("OpenClaw 克隆", (self.openclaw / "package.json").is_file(), "%s → %s" % (src, self.openclaw)))

        common = Path(self.git("-C", REPO, "rev-parse", "--path-format=absolute", "--git-common-dir"))
        self.git("init", "-q", "--bare", self.fake)
        (self.fake / "objects/info/alternates").write_text(str(common / "objects") + "\n")
        self.git("symbolic-ref", "HEAD", "refs/heads/main", git_dir=self.fake)
        self.s1 = self.stub_commit(self.from_rev, None, "acceptance S1 (%s + build stub)" % self.from_rev[:8])
        self.s2 = self.stub_commit(self.to_rev, self.s1, "acceptance S2 (%s + build stub)" % self.to_rev[:8])
        unsafe = []
        for rev in (self.s1, self.s2):
            for path, needle in SAFETY.items():
                if needle not in self.git("show", "%s:%s" % (rev, path), git_dir=self.fake):
                    unsafe.append("%s:%s 不认 %s" % (rev[:8], path, needle))
        if unsafe:
            raise RuntimeError("入口脚本不支持临时路径覆盖，拒绝开跑：" + "；".join(unsafe))
        checks.append(("两个提交的入口脚本都认临时路径覆盖", True, "、".join(SAFETY.values())))
        self.git("update-ref", "refs/heads/main", self.s1, git_dir=self.fake)
        self.git("clone", "-q", "--shared", self.fake, self.work, cwd=self.root)
        head = self.git("-C", self.work, "rev-parse", "HEAD")
        branch = self.git("-C", self.work, "branch", "--show-current")
        checks.append(("工作仓库停在 main / S1", head == self.s1 and branch == "main", "%s %s" % (branch, head[:8])))
        return checks

    def apply_break(self):
        victims = sorted(self.prompts.glob("unrestricted-prompt-*.txt"))
        if victims:
            victims[0].unlink()
            self.notes.append("--break remove-installed-file：install 后删掉了 %s（第 1 次冒烟必须红）" % victims[0].name)
        else:
            self.notes.append("--break remove-installed-file：没找到可删的 prompt 文件")

    # ── 冒烟 ──
    def smoke(self, after_update):
        checks = []
        oc = str(self.openclaw)
        comp = glob.glob(oc + "/node_modules/@openclaw/ai/dist/openai-completions-*.mjs") or \
            glob.glob(oc + "/**/@openclaw/ai/dist/openai-completions-*.mjs", recursive=True)
        trans = glob.glob(oc + "/dist/openai-transport-stream-*.js")
        text_c = "".join(Path(f).read_text(errors="replace") for f in comp)
        text_t = "".join(Path(f).read_text(errors="replace") for f in trans)
        missing = [m for m in OPENCLAW_MARKERS + [INJECTION_MARKER] if m not in text_c]
        if INJECTION_MARKER not in text_t:
            missing.append(INJECTION_MARKER + "（transport）")
        checks.append(("OpenClaw 克隆里的补丁标记", bool(comp and trans) and not missing,
                       "缺：" + "、".join(missing) if missing else "4 个都在"))

        plist = self.app / "Contents/Info.plist"
        checks.append(("App 装在临时目录", plist.is_file(), str(self.app)))
        rc, out = self.sh(["codesign", "--verify", "--deep", "--strict", self.app])
        checks.append(("codesign --verify --deep --strict", rc == 0, out[-200:]))
        rc, out = self.sh(["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleIdentifier", plist])
        checks.append(("Bundle ID", out == BUNDLE_ID, out[-120:]))
        rc, out = self.sh(["codesign", "-dr", "-", self.app])
        checks.append(("designated requirement", DESIGNATED in out, "" if DESIGNATED in out else out[-200:]))

        rc, value = self.sh(["/bin/bash", "-c", 'source "$1"; printf %s "$PINKIE_APP_PATH"', "_", self.config / "install.env"])
        checks.append(("install.env 的 PINKIE_APP_PATH 指向临时 App", value == str(self.app), value[-200:]))

        wanted = sorted(Path(p).name for p in glob.glob(str(self.work / "prompts/unrestricted-prompt-*.txt")))
        gone = [n for n in wanted if not (self.prompts / n).is_file()
                or (self.prompts / n).read_bytes() != (self.work / "prompts" / n).read_bytes()]
        checks.append(("prompts 已复制", bool(wanted) and not gone,
                       "缺或不一致：" + "、".join(gone) if gone else "%d 个" % len(wanted)))

        status, body = None, ""
        for _ in range(20):
            status, body = http_call(self.proxy_port, "GET", "/health")
            if status == 200:
                break
            time.sleep(0.5)
        checks.append(("代理 /health（端口 %d）" % self.proxy_port, status == 200, "%s %s" % (status, body[:120])))
        before = len(FakeUpstream.hits)
        payload = json.dumps({"model": "accept-ok", "messages": [{"role": "user", "content": "ping"}]})
        status, body = http_call(self.proxy_port, "POST", "/v1/chat/completions", payload)
        checks.append(("代理转发到假上游（端口 %d）" % self.upstream_port, status == 200 and len(FakeUpstream.hits) > before,
                       "%s %s" % (status, body[:120])))
        if after_update:
            head = self.git("-C", self.work, "rev-parse", "HEAD")
            checks.append(("工作仓库已快进到 S2", head == self.s2, head[:8]))
        return checks

    def uninstall_checks(self):
        agents = self.home / "Library/LaunchAgents"
        trash = glob.glob(str(self.home / ".Trash" / "超級碧琪-*.app"))
        left = [n for n in ("com.super-pinkie.tts.plist", "com.super-pinkie.reapply.plist", "com.openclaw.urproxy.plist")
                if (agents / n).exists()]
        text = "".join(Path(f).read_text(errors="replace") for f in
                       glob.glob(str(self.openclaw / "dist/openai-transport-stream-*.js")))
        checks = [
            ("App 已从临时目录移走", not self.app.exists(), str(self.app)),
            ("App 进了临时 HOME 的废纸篓", bool(trash), ", ".join(Path(t).name for t in trash)),
            ("tts / reapply / urproxy 的 plist 已删", not left, "还在：" + "、".join(left) if left else ""),
            ("无限制注入已摘除", INJECTION_MARKER not in text, ""),
        ]
        groups = {}
        for base, label in ((self.home, "临时 HOME"), (self.state, "STATE_ROOT"), (self.config, "CONFIG_ROOT")):
            for dirpath, dirnames, filenames in os.walk(base):
                rel = Path(dirpath).relative_to(base)
                if rel.parts[:1] == (".Trash",):
                    dirnames[:] = []
                    continue
                for f in filenames:
                    parts = rel.parts + (f,)
                    key = "%s/%s" % (label, "/".join(parts[:3]) + ("/…" if len(parts) > 3 else ""))
                    groups[key] = groups.get(key, 0) + 1
        self.residue = [k if n == 1 else "%s（%d 个文件）" % (k, n) for k, n in sorted(groups.items())]
        return checks

    # ── 收尾 ──
    def stop_procs(self):
        out = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True).stdout
        pids = []
        for line in out.splitlines():
            pid, _, command = line.strip().partition(" ")
            if pid.isdigit() and int(pid) != os.getpid() and str(self.root) + "/" in command:
                pids.append(int(pid))
                try:
                    os.kill(int(pid), signal.SIGTERM)
                except ProcessLookupError:
                    pass
        deadline = time.monotonic() + 3
        for pid in pids:
            while time.monotonic() < deadline:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
            else:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        if pids:
            self.notes.append("%s 停掉临时根下的后台进程：%s（install.sh 用 nohup 起的代理）" % (now(), ", ".join(map(str, pids))))
        return pids

    def cleanup(self):
        checks = []
        self.stop_procs()
        self.upstream.shutdown()
        shim_log = self.root / "shim.log"
        if shim_log.is_file():
            self.shim_calls = shim_log.read_text(errors="replace").splitlines()
        registered = [self.app, self.state / "build" / APP_NAME] + \
            [Path(p) for p in glob.glob(str(self.home / ".Trash" / "超級碧琪-*.app"))]
        unregistered = []
        if os.path.exists(LSREGISTER):
            for p in registered:
                if p.exists():
                    subprocess.run([LSREGISTER, "-u", str(p)], capture_output=True)
                    unregistered.append(str(p))
        self.notes.append("apply-theme.sh 用绝对路径调 lsregister -f，会把临时 App 登记进真实 LaunchServices 数据库；"
                          "收尾已对 %d 个临时 App 路径做 lsregister -u" % len(unregistered))
        self.notes.append("codesign 用的是真的（只签 / 验临时 App，adhoc，不碰钥匙串）")
        if self.args.keep:
            checks.append(("临时根已保留（--keep）", True, str(self.root)))
        else:
            shutil.rmtree(self.root, onerror=lambda fn, p, _: (os.chmod(p, 0o700), fn(p)))
            checks.append(("临时根已删除", not self.root.exists(), str(self.root)))
        left = [line for line in subprocess.run(["ps", "-axo", "command="], capture_output=True, text=True).stdout.splitlines()
                if str(self.root) + "/" in line]
        checks.append(("没有残留进程", not left, "; ".join(left)[:200]))
        if self.log_backup is None:
            if os.path.exists(PROXY_LOG):
                os.remove(PROXY_LOG)
            restored = not os.path.exists(PROXY_LOG)
        else:
            Path(PROXY_LOG).write_bytes(self.log_backup)
            restored = Path(PROXY_LOG).read_bytes() == self.log_backup
        checks.append(("%s 已恢复原样" % PROXY_LOG, restored, ""))
        after = self.snapshot_real()
        changed = [p for p in set(self.real_before) | set(after) if self.real_before.get(p) != after.get(p)]
        checks.append(("真实 ~/Library/LaunchAgents（本项目的 plist）和正式 App 没变", not changed, "、".join(sorted(changed))))
        return checks

    def run(self):
        try:
            if self.step("prepare", "准备临时根（假 origin、工作仓库、OpenClaw 克隆、垫片）", checks=self.prepare):
                self.step("install", "install-full.sh", cmd=["/bin/bash", self.work / "install-full.sh"], cwd=self.work)
                if self.args.break_mode == "remove-installed-file":
                    self.apply_break()
                self.step("smoke1", "install 后第 1 次冒烟", checks=lambda: self.smoke(False))
                self.stop_procs()
                self.git("update-ref", "refs/heads/main", self.s2, self.s1, git_dir=self.fake)
                self.step("update", "update-full.sh（更新到 %s）" % self.to_rev[:8],
                          cmd=["/bin/bash", self.work / "update-full.sh"], cwd=self.work)
                self.step("smoke2", "update 后第 2 次冒烟", checks=lambda: self.smoke(True))
                self.stop_procs()
                self.step("uninstall", "uninstall-full.sh", cmd=["/bin/bash", self.work / "uninstall-full.sh"],
                          cwd=self.work, checks=self.uninstall_checks)
        finally:
            self.step("cleanup", "收尾（停进程、lsregister -u、删临时根、恢复日志、核对真实环境）", checks=self.cleanup)
        return all(s["ok"] for s in self.steps)

    def report(self):
        counts = {}
        for line in self.shim_calls:
            name = line.split(" ", 1)[0] + (" refused" if " refused " in line else "")
            counts[name] = counts.get(name, 0) + 1
        refused = [line[:200] for line in self.shim_calls if " refused " in line]
        secs = (datetime.datetime.now() - self.started).total_seconds()
        meta = {
            "facts": [
                ("时间", "%s，共 %.0f 秒" % (self.started.strftime("%Y-%m-%d %H:%M:%S"), secs)),
                ("临时根", "`%s`" % self.root),
                ("版本", "S1 = %s + 构建桩 → S2 = %s + 构建桩" % (self.from_rev[:8], self.to_rev[:8])),
                ("反例开关", self.args.break_mode or "未开"),
                ("端口", "代理 %d → 假上游 %d（不连 18789）" % (self.proxy_port, self.upstream_port)),
            ],
            "sections": [
                ("副作用与隔离", self.notes),
                ("垫片拦下的调用", ["%s × %d" % kv for kv in sorted(counts.items())] + ["拒绝：" + r for r in refused]),
                ("卸载残留（真实 uninstall-full.sh 的行为，不是验收脚本留下的）", self.residue[:80] +
                 (["……另有 %d 个" % (len(self.residue) - 80)] if len(self.residue) > 80 else [])),
            ],
        }
        return render_report(self.steps, meta)


def preflight(args):
    problems = []
    if sys.platform != "darwin":
        problems.append("只能在 macOS 上跑")
    for tool in ("git", "xcrun", "codesign", "node"):
        if not shutil.which(tool):
            problems.append("PATH 里没有 " + tool)
    if not os.path.isfile(os.path.join(args.openclaw_src, "package.json")):
        problems.append("找不到干净的 OpenClaw 包：" + args.openclaw_src)
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description="Mac 一键验收（临时 HOME，install → 冒烟 → update → 冒烟 → uninstall）")
    ap.add_argument("--report", help="Markdown 报告路径（默认 /private/tmp/pinkie-accept-report-<时间>.md）")
    ap.add_argument("--keep", action="store_true", help="调试用：不删临时根")
    ap.add_argument("--break", dest="break_mode", choices=BREAKS, help="反例：install 后删掉一个装好的 prompt 文件，第 1 次冒烟必须红")
    ap.add_argument("--to", default="origin/main", help="update 的目标提交（默认 origin/main）")
    ap.add_argument("--from", dest="from_rev", help="install 用的旧提交（默认 <to>^1）")
    ap.add_argument("--openclaw-src", default=os.environ.get("PINKIE_ACCEPT_OPENCLAW_SRC", DEFAULT_OPENCLAW_SRC))
    ap.add_argument("--python", help="把 python3 垫成这个解释器（默认用 /usr/bin/python3）")
    args = ap.parse_args(argv)
    problems = preflight(args)
    try:
        args.to_sha = resolve_rev(args.to)
        args.from_sha = resolve_rev(args.from_rev or args.to + "^1")
    except RuntimeError as error:
        problems.append(str(error))
    if problems:
        print("没开跑：" + "；".join(problems), file=sys.stderr)
        return 2
    report = Path(args.report or "/private/tmp/pinkie-accept-report-%s.md" % datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    run = Acceptance(args)
    ok = False
    try:
        ok = run.run()
    finally:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(run.report())
    print("%s：%s" % ("通过" if ok else "失败", report))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
