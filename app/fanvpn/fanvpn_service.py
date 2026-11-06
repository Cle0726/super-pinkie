"""Windows WebView2 客户端接入层：节点选择 + 运行时热切换。

这一段就是回答“用户怎么自己选节点”的落点。它不碰 Chrome 扩展体系，
只做三件事：
    1. 启动本地代理，把 WebView2 固定指向 127.0.0.1:10809（永不变）
    2. 拉起一个本地节点面板（HTTP + HTML），列出所有节点、延迟、当前选中
    3. 用户在面板上点节点 -> POST /api/select -> proxy.set_upstream()
       -> 立即生效，WebView2 无需重载

接入到你现有的 app/windows_desktop.py 里，只需要在 run_desktop() 中
调用 start_fanvpn() 并把返回的 playwright 参数塞进环境变量。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from fanvpn_core import ConfigError, FanVpnConfig, Node, probe_node
from local_proxy import LocalProxy
from win_sysproxy import (
    SystemProxyManager,
    SnapshotStore,
    build_pac,
    pac_url_for,
    proxy_server_for,
)

LOG = logging.getLogger("fanvpn_service")


def _configure_logging() -> None:
    """在 PyInstaller --windowed 下给 logging 兜底。

    --windowed 构建的 sys.stderr 可能是 None，logging 的 lastResort handler
    会往 None 里写而抛错。这里只在没有任何 handler 时补一个，
    避免与宿主的 logging 配置打架。
    """
    if LOG.handlers or logging.getLogger().handlers:
        return
    LOG.addHandler(logging.NullHandler())
    LOG.propagate = False


_configure_logging()


def sys_platform() -> str:
    return sys.platform

PANEL_HTML = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FanVPN 节点</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px;
    font: 14px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    background: #efcbd3; color: #2b1d22;
  }
  .card { background: #fff; border-radius: 14px; padding: 14px 16px; margin-bottom: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,.06); }
  .row { display: flex; align-items: center; gap: 10px; }
  .node { cursor: pointer; transition: .12s; }
  .node:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,.1); }
  .node.active { outline: 2px solid #d94f78; }
  .flag { width: 34px; height: 24px; border-radius: 5px; background: #eee;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; color: #666; flex: none; }
  .name { flex: 1; font-weight: 600; }
  .ms { font-variant-numeric: tabular-nums; font-size: 12px; color: #7a6b70; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #bbb; flex: none; }
  .dot.ok { background: #17a673; } .dot.fail { background: #d94f4f; }
  .dot.checking { background: #e0a32e; }
  h3 { margin: 0 0 4px; font-size: 15px; }
  .muted { color: #7a6b70; font-size: 12px; }
  button { border: 0; border-radius: 9px; padding: 7px 13px; cursor: pointer;
           background: #d94f78; color: #fff; font: inherit; }
  button.ghost { background: #f2e2e7; color: #7a3b50; }
  #status { font-weight: 600; }
</style>
</head>
<body>
  <div class="card row">
    <div style="flex:1">
      <h3 id="status">未连接</h3>
      <div class="muted" id="sub">选择节点后立即生效</div>
    </div>
    <button class="ghost" id="mode">智能分流</button>
    <button id="reload">刷新</button>
  </div>

  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div style="flex:1">
        <h3>系统浏览器</h3>
        <div class="muted" id="sys-sub">接管 Chrome / Edge / Firefox 的代理设置</div>
      </div>
      <button id="sys-toggle">接管</button>
    </div>
    <div class="muted" id="sys-detail" style="margin-top:8px"></div>
  </div>

  <div id="list"></div>
<script>
let state = { nodes: [], active: null, mode: "smart", connected: false };

const api = (path, body) => fetch(path, body ? {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
} : {}).then(r => r.json());

function paint() {
  document.getElementById("status").textContent =
    state.connected ? "已连接" : "未连接";
  const act = state.nodes.find(n => n.server === state.active);
  document.getElementById("sub").textContent =
    act ? act.name + " · " + act.server : "选择节点后立即生效";
  document.getElementById("mode").textContent =
    state.mode === "global" ? "全局模式" : "智能分流";
  document.getElementById("mode").classList.toggle("ghost", state.mode !== "global");

  const list = document.getElementById("list");
  list.innerHTML = "";

  const sys = state.system || {};
  const toggle = document.getElementById("sys-toggle");
  toggle.textContent = sys.applied ? "还原" : "接管";
  toggle.classList.toggle("ghost", !!sys.applied);
  document.getElementById("sys-sub").textContent = sys.applied
    ? "已接管系统代理（" + (sys.method === "pac" ? "PAC 分流" : "全局代理") + "）"
    : "接管 Chrome / Edge / Firefox 的代理设置";
  const cur = sys.current || {};
  document.getElementById("sys-detail").textContent = sys.applied
    ? "PAC: " + (sys.pacUrl || "") + "  ·  还原后回到接管前的所有浏览器设置"
    : "当前系统代理: " + (cur.ProxyServer || "未设置") +
      (cur.AutoConfigURL ? "  ·  PAC " + cur.AutoConfigURL : "");
  state.nodes.forEach(n => {
    const el = document.createElement("div");
    el.className = "card node row" + (n.server === state.active ? " active" : "");
    const cls = n.status === "ok" ? "ok" : n.status === "fail" ? "fail"
              : n.status === "checking" ? "checking" : "";
    el.innerHTML = `<div class="flag">${n.flag || "US"}</div>
      <div class="name">${n.name}<div class="muted">${n.server}:${n.port}</div></div>
      <span class="ms">${n.ms ? n.ms + " ms" : ""}</span>
      <div class="dot ${cls}"></div>`;
    if (n.status !== "fail") {
      el.onclick = async () => {
        state = await api("/api/select", { server: n.server, port: n.port });
        paint();
      };
    }
    list.appendChild(el);
  });
}

document.getElementById("reload").onclick = async () => {
  state.nodes.forEach(n => n.status = "checking");
  paint();
  state = await api("/api/nodes?force=1");
  paint();
};

document.getElementById("mode").onclick = async () => {
  state = await api("/api/mode", { mode: state.mode === "global" ? "smart" : "global" });
  paint();
};

document.getElementById("sys-toggle").onclick = async () => {
  const btn = document.getElementById("sys-toggle");
  btn.disabled = true;
  try {
    const applied = !!(state.system && state.system.applied);
    if (applied) await api("/api/system/restore", {});
    else await api("/api/system/apply", { method: "pac" });
    state = await api("/api/state");
    paint();
  } finally {
    btn.disabled = false;
  }
};

api("/api/state").then(s => { state = s; paint(); });
</script>
</body>
</html>
"""


@dataclass
class FanVpnSettings:
    panel_port: int = 10810
    proxy_port: int = 10809
    key_path: Any = None
    mode: str = "smart"


class FanVpnService:
    """节点面板 + 本地代理的生命周期管理。"""

    def __init__(self, settings: FanVpnSettings):
        self.settings = settings
        self.proxy = LocalProxy(port=settings.proxy_port, mode=settings.mode)
        self.config: Optional[FanVpnConfig] = None
        self.nodes: List[Node] = []
        self.active: Optional[Node] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()
        self._panel_server = None
        # 系统代理：默认只在 Windows 上真正动注册表
        self.sysproxy = SystemProxyManager()
        self.snapshot_store = SnapshotStore()
        self._system_method = "pac"

    # ── 启动 ────────────────────────────────────────────────────
    def start(self, timeout: float = 20.0) -> bool:
        """在后台线程跑事件循环，主线程立即可用。"""
        self._thread = threading.Thread(target=self._run, name="fanvpn-service", daemon=True)
        self._thread.start()
        return self._ready.wait(timeout)

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._boot())
            self._ready.set()
            self._loop.run_forever()
        except Exception as exc:
            LOG.exception("fanvpn service failed: %s", exc)
            self._ready.set()

    async def _boot(self) -> None:
        pem = self._load_key()
        self.config = FanVpnConfig(pem)
        try:
            self.nodes = self.config.load()
            LOG.info("loaded %d nodes", len(self.nodes))
        except ConfigError as exc:
            LOG.warning("node load failed, panel starts empty: %s", exc)
            self.nodes = []

        await self.proxy.start()
        self.settings.proxy_port = self.proxy.port

        # 默认选中第一个节点？不。默认不挂上游（直连），等用户自己选。
        self._panel_server = await asyncio.start_server(
            self._handle_panel, "127.0.0.1", self.settings.panel_port
        )
        bound = self._panel_server.sockets[0].getsockname()
        self.settings.panel_port = bound[1]
        LOG.info("panel on http://127.0.0.1:%s/", bound[1])

    def _load_key(self) -> str:
        source = self.settings.key_path
        if source is None:
            raise ConfigError("缺少 RSA 私钥 (settings.key_path)")
        # 传入的可能是 PEM 文本，也可能是文件路径
        if isinstance(source, Path):
            if not source.is_file():
                raise ConfigError(f"RSA 私钥文件不存在: {source}")
            return source.read_text(encoding="utf-8")
        text = str(source)
        if text.lstrip().startswith("-----BEGIN"):
            return text
        path = Path(text)
        if path.is_file():
            return path.read_text(encoding="utf-8")
        raise ConfigError("私钥既不是 PEM 文本，也不是存在的文件")

    # ── 对外：线程安全的热切换 ───────────────────────────────────
    def select_node(self, server: str, port: int) -> None:
        """从任意线程调用，把切换投递到服务事件循环。"""
        if not self._loop:
            raise RuntimeError("service not started")
        asyncio.run_coroutine_threadsafe(self._select(server, port), self._loop)

    async def _select(self, server: str, port: int) -> None:
        node = next((n for n in self.nodes if n.server == server and n.port == int(port)), None)
        if node is None:
            node = Node(name=server, server=server, port=int(port))
        self.proxy.set_upstream(node.server, node.port)
        self.active = node
        LOG.info("selected %s", node.label)

    # ── 对外：把本地代理挂到系统浏览器上 ──────────────────────────
    def apply_system_proxy(self, method: str = "pac") -> Dict[str, Any]:
        """接管 WinINET 系统代理。调之前会自动做快照。

        method="pac"  : 写 AutoConfigURL -> 本地 /proxy.pac，按域名分流
        method="direct" : 写 ProxyServer -> 本地端口，全部走本地代理

        重复调用是安全的：已经有快照就不覆盖，保证还原到的是
        「用户原本的状态」而不是我们上一次改完的状态。
        """
        method = (method or "pac").lower()
        if method not in ("pac", "direct"):
            raise ValueError("method 只能是 'pac' 或 'direct'")

        # 只有第一次接管前才拍快照
        if self.snapshot_store.load() is None:
            self.snapshot_store.save(self.sysproxy.snapshot())

        self._system_method = method
        if method == "pac":
            self.sysproxy.apply_pac(pac_url_for(self.settings.panel_port))
        else:
            self.sysproxy.apply_direct(proxy_server_for(self.settings.proxy_port))
        return self._state_payload()["system"]

    def restore_system_proxy(self) -> None:
        """回滚到快照里的原始状态。

        没有快照就退化为「关掉代理」，不能让用户卡在断网状态。
        """
        snap = self.snapshot_store.load()
        if snap is None:
            LOG.warning("没有快照，只关闭代理")
            self.sysproxy.disable()
            return
        self.sysproxy.restore(snap)
        self.snapshot_store.clear()

    @property
    def webview2_args(self) -> str:
        """塞进 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 的值。"""
        if not self.settings.proxy_port:
            return ""
        return (
            f'--proxy-server="http://127.0.0.1:{self.settings.proxy_port}" '
            # 只把本地和环回留给 Chromium 自己判断，分流由本地代理负责
            f'--proxy-bypass-list="<-loopback>"'
        )

    @property
    def panel_url(self) -> str:
        return f"http://127.0.0.1:{self.settings.panel_port}/"

    # ── 面板 HTTP 服务 ──────────────────────────────────────────
    def _state_payload(self) -> Dict[str, Any]:
        current = self.sysproxy.current()
        return {
            "nodes": [
                {"name": n.name, "server": n.server, "port": n.port, "flag": n.flag,
                 "status": None, "ms": 0}
                for n in self.nodes
            ],
            "active": self.active.server if self.active else None,
            "mode": self.proxy.mode,
            "connected": self.active is not None,
            "proxyPort": self.settings.proxy_port,
            "system": {
                "applied": self.sysproxy.is_managed(),
                "method": "pac" if self._system_method == "pac" else "direct",
                "pacUrl": pac_url_for(self.settings.panel_port),
                "current": {k: ("" if v is None else v) for k, v in current.items()},
                "platform": sys_platform(),
            },
        }

    async def _handle_panel(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            raw = await reader.readuntil(b"\r\n\r\n")
            head, _, _ = raw.partition(b"\r\n\r\n")
            lines = head.decode("latin-1").split("\r\n")
            method, target, _ = lines[0].split(" ", 2)
            headers = {}
            for line in lines[1:]:
                if ":" in line:
                    k, _, v = line.partition(":")
                    headers[k.strip().lower()] = v.strip()

            body = b""
            length = int(headers.get("content-length") or 0)
            if length:
                body = await reader.readexactly(length)

            path, _, query = target.partition("?")
            status, ctype, payload = await self._route(method, path, query, body)
            writer.write(
                f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\n"
                f"Content-Length: {len(payload)}\r\nCache-Control: no-store\r\n"
                f"Connection: close\r\n\r\n".encode() + payload
            )
            await writer.drain()
        except Exception as exc:
            LOG.debug("panel error: %s", exc)
        finally:
            try:
                writer.close()
            except Exception:
                pass

    async def _route(self, method: str, path: str, query: str, body: bytes):
        if path == "/" and method == "GET":
            return "200 OK", "text/html; charset=utf-8", PANEL_HTML.encode("utf-8")

        if path == "/proxy.pac" and method == "GET":
            # 浏览器会反复拉这个，不能带缓存
            pac = build_pac(proxy_server_for(self.settings.proxy_port))
            return "200 OK", "application/x-ns-proxy-autoconfig", pac.encode("utf-8")

        if path == "/api/system" and method == "GET":
            return "200 OK", "application/json", json.dumps(
                self._state_payload()["system"], ensure_ascii=False
            ).encode()

        if path == "/api/system/apply" and method == "POST":
            try:
                data = json.loads(body.decode("utf-8") or "{}")
                method_name = str(data.get("method") or "pac").lower()
                self.apply_system_proxy(method_name)
                payload = dict(self._state_payload()["system"], ok=True)
                return "200 OK", "application/json", json.dumps(payload, ensure_ascii=False).encode()
            except ValueError as exc:
                return "400 Bad Request", "application/json", json.dumps({"error": str(exc)}).encode()

        if path == "/api/system/restore" and method == "POST":
            self.restore_system_proxy()
            payload = dict(self._state_payload()["system"], ok=True)
            return "200 OK", "application/json", json.dumps(payload, ensure_ascii=False).encode()

        if path == "/api/state":
            return "200 OK", "application/json", json.dumps(self._state_payload(), ensure_ascii=False).encode()

        if path == "/api/nodes":
            force = "force=1" in query
            if force or not self.nodes:
                try:
                    await asyncio.get_running_loop().run_in_executor(None, self._reload_sync, force)
                except Exception as exc:
                    LOG.warning("reload failed: %s", exc)
            results = await asyncio.get_running_loop().run_in_executor(None, self._probe_all)
            by_server = {r["server"]: r for r in results}
            payload = self._state_payload()
            for item in payload["nodes"]:
                r = by_server.get(item["server"])
                if r:
                    item["status"] = r["status"]
                    item["ms"] = r["ms"]
            return "200 OK", "application/json", json.dumps(payload, ensure_ascii=False).encode()

        if path == "/api/select" and method == "POST":
            try:
                data = json.loads(body.decode("utf-8") or "{}")
                await self._select(str(data["server"]), int(data["port"]))
                return "200 OK", "application/json", json.dumps(self._state_payload(), ensure_ascii=False).encode()
            except (KeyError, TypeError, ValueError) as exc:
                return "400 Bad Request", "application/json", json.dumps({"error": str(exc)}).encode()

        if path == "/api/mode" and method == "POST":
            try:
                data = json.loads(body.decode("utf-8") or "{}")
                self.proxy.set_mode(str(data.get("mode", "smart")))
                return "200 OK", "application/json", json.dumps(self._state_payload(), ensure_ascii=False).encode()
            except ValueError as exc:
                return "400 Bad Request", "application/json", json.dumps({"error": str(exc)}).encode()

        return "404 Not Found", "text/plain; charset=utf-8", b"not found"

    def _reload_sync(self, force: bool) -> List[Node]:
        assert self.config is not None
        self.nodes = self.config.load(force=force)
        return self.nodes

    def _probe_all(self) -> List[Dict[str, Any]]:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(probe_node, self.nodes))

    # ── 关停 ────────────────────────────────────────────────────
    def stop(self) -> None:
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)


_service: Optional[FanVpnService] = None


def start_fanvpn(key_source, panel_port: int = 10810, proxy_port: int = 10809) -> FanVpnService:
    """一行接入：启动服务并返回实例，稍后读 webview2_args / panel_url。

    key_source 可以是 Path（文件路径），也可以是 PEM 文本本身。
    """
    global _service
    if isinstance(key_source, Path):
        key_path: object = key_source
    else:
        text = str(key_source)
        # PEM 文本以 -----BEGIN 开头；其余按路径处理
        key_path = Path(text) if not text.lstrip().startswith("-----BEGIN") else text
    settings = FanVpnSettings(panel_port=panel_port, proxy_port=proxy_port, key_path=key_path)
    service = FanVpnService(settings)
    service.start()
    _service = service
    return service


def apply_to_webview2_env(service: FanVpnService) -> None:
    """把代理参数注入环境变量；必须在创建 WebView2 环境之前调用。"""
    args = service.webview2_args
    if not args:
        return
    existing = os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "").strip()
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = (
        f"{existing} {args}".strip() if existing else args
    )
