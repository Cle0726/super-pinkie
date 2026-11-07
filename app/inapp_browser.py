"""碧琪的浏览器 on Windows: manager that lives in the main App process.

* Owns a loopback control endpoint.  The gateway's app_browser tool finds
  it through PINKIE_APP_BROWSER_ENDPOINT (which names an endpoint file, so a
  gateway kept alive across App restarts still finds the new port/token).
* Starts the browser window process (inapp_browser_host) on first use and
  forwards requests to it.  Restarts it when the browser's proxy changes.
* Runs the browser-only VPN: subscriptions, node list, latency, selection,
  and the mihomo core that only the in-app browser is pointed at.

Nothing here changes the system proxy, the gateway's environment beyond
the endpoint variable, or the model relay.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import browser_vpn_subscription as subs
from browser_vpn_core import CoreError, MihomoCore, assign_to_kill_job, locate_core, window_process_kwargs

ENDPOINT_ENV = "PINKIE_APP_BROWSER_ENDPOINT"
IP_CHECK_URL = "https://api.ip.sb/geoip"
HOST_START_TIMEOUT = 25
FAILOVER_COOLDOWN = 20.0     # seconds between automatic node checks
FAILOVER_TEST_MS = 3000      # per-node timeout of the quick test behind a failover
HEALTH_INTERVAL = 300.0      # background check of the current node while proxied
# Operations 碧琪 (the gateway's app_browser tool) may run on the node service.
# Removing subscriptions stays with the user in the panel.
AGENT_VPN_OPS = {"status", "test", "best", "select", "enable", "auto", "ip", "refresh", "add"}

# Rough region from a node's display name; airports name nodes by place.
REGION_HINTS = [
    ("香港", ("香港", "hong kong", "hongkong", "hk")), ("台湾", ("台湾", "台灣", "taiwan", "tw")),
    ("日本", ("日本", "japan", "tokyo", "osaka", "jp")), ("新加坡", ("新加坡", "singapore", "sg")),
    ("美国", ("美国", "美國", "united states", "usa", "los angeles", "san jose", "seattle", "us")),
    ("韩国", ("韩国", "韓國", "korea", "seoul", "kr")), ("英国", ("英国", "united kingdom", "london", "uk", "gb")),
    ("德国", ("德国", "germany", "frankfurt", "de")), ("法国", ("法国", "france", "paris", "fr")),
    ("加拿大", ("加拿大", "canada", "ca")), ("澳大利亚", ("澳大利亚", "澳洲", "australia", "au")),
    ("俄罗斯", ("俄罗斯", "russia", "ru")), ("印度", ("印度", "india", "in")), ("土耳其", ("土耳其", "turkey", "tr")),
    ("荷兰", ("荷兰", "netherlands", "nl")), ("马来西亚", ("马来西亚", "malaysia", "my")),
    ("泰国", ("泰国", "thailand", "th")), ("越南", ("越南", "vietnam", "vn")), ("菲律宾", ("菲律宾", "philippines", "ph")),
    ("阿根廷", ("阿根廷", "argentina", "ar")), ("巴西", ("巴西", "brazil", "br")),
]
FLAG_REGIONS = {"🇭🇰": "香港", "🇹🇼": "台湾", "🇯🇵": "日本", "🇸🇬": "新加坡", "🇺🇸": "美国", "🇰🇷": "韩国", "🇬🇧": "英国",
                "🇩🇪": "德国", "🇫🇷": "法国", "🇨🇦": "加拿大", "🇦🇺": "澳大利亚", "🇷🇺": "俄罗斯", "🇮🇳": "印度", "🇹🇷": "土耳其",
                "🇳🇱": "荷兰", "🇲🇾": "马来西亚", "🇹🇭": "泰国", "🇻🇳": "越南", "🇵🇭": "菲律宾", "🇦🇷": "阿根廷", "🇧🇷": "巴西"}


def node_region(name: str) -> str:
    text = str(name or "")
    for flag, region in FLAG_REGIONS.items():
        if flag in text:
            return region
    lowered = text.lower()
    words = set(re.findall(r"[a-z]+", lowered))
    for region, keys in REGION_HINTS:
        for key in keys:
            # Two-letter codes only count as whole words ("US 01", not "plus").
            short = len(key) <= 2 and key.isascii()
            if (short and key in words) or (not short and key in lowered):
                return region
    return ""


def region_matches(name: str, wanted: str) -> bool:
    wanted = str(wanted or "").strip().lower()
    if not wanted:
        return True
    region = node_region(name)
    return wanted in str(name).lower() or (region and (wanted in region.lower() or region.lower() in wanted))


def browser_state_dir(state_root: Path) -> Path:
    return Path(state_root) / "inapp-browser"


def endpoint_environment_value(endpoint_file: Path) -> str:
    return json.dumps({"v": 1, "endpointFile": str(endpoint_file)}, ensure_ascii=False)


def host_command(arguments: List[str]) -> List[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--inapp-browser-host", *arguments]
    entry = Path(__file__).resolve().parent / "super_pinkie.py"
    return [sys.executable, str(entry), "--inapp-browser-host", *arguments]


def control_script_path(resource_root: Optional[Path]) -> Optional[Path]:
    candidates = []
    if resource_root:
        candidates.append(Path(resource_root) / "inapp-browser" / "BrowserControl.js")
    if getattr(sys, "_MEIPASS", None):
        candidates.append(Path(sys._MEIPASS) / "inapp-browser" / "BrowserControl.js")
    candidates.append(Path(__file__).resolve().parents[1] / "desktop" / "macos" / "pinkie" / "Sources" / "BrowserControl.js")
    return next((c for c in candidates if c.is_file()), None)


def format_bytes(value: int) -> str:
    size = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.0f} {unit}" if unit in ("B", "KB") else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def usage_text(info: Dict[str, int]) -> str:
    parts = []
    if info.get("total"):
        used = info.get("upload", 0) + info.get("download", 0)
        parts.append(f"已用 {format_bytes(used)} / {format_bytes(info['total'])}")
    if info.get("expire"):
        parts.append("到期 " + time.strftime("%Y-%m-%d", time.localtime(info["expire"])))
    return " · ".join(parts)


class VpnStore:
    """Subscriptions and choices, kept in <state>/inapp-browser/vpn.json."""

    def __init__(self, folder: Path):
        self.path = Path(folder) / "vpn.json"
        self.data: Dict[str, Any] = {"subscriptions": [], "selected": None, "enabled": False}
        try:
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                self.data.update(loaded)
        except (OSError, ValueError):
            pass

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(temp, self.path)

    @property
    def subscriptions(self) -> List[Dict[str, Any]]:
        return self.data.setdefault("subscriptions", [])

    def all_proxies(self) -> List[Dict[str, Any]]:
        combined = []
        for sub in self.subscriptions:
            for proxy in sub.get("nodes") or []:
                item = dict(proxy)
                item["_sub"] = sub.get("id")
                combined.append(item)
        combined = subs.unique_names(combined)
        return combined


def fetch_exit_ip(proxy_port: int, timeout: float = 8.0) -> Dict[str, Any]:
    """Where the browser's traffic comes out: through our core when proxied,
    otherwise the same way a normal browser would go."""
    import urllib.request

    handlers = []
    if proxy_port:
        address = f"http://127.0.0.1:{int(proxy_port)}"
        handlers.append(urllib.request.ProxyHandler({"http": address, "https": address}))
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(IP_CHECK_URL, headers={"User-Agent": "Mozilla/5.0 PinkieBrowser"})
    with opener.open(request, timeout=timeout) as response:
        data = json.loads(response.read() or b"{}")
    return {"ip": data.get("ip", ""), "country": data.get("country", ""), "region": data.get("region", ""),
            "city": data.get("city", ""), "isp": data.get("organization") or data.get("isp") or ""}


class VpnService:
    def __init__(self, folder: Path, resource_root: Optional[Path], log: Callable[[str], None],
                 fetch: Callable[[str], Any] = subs.fetch_subscription,
                 ip_lookup: Callable[[int], Dict[str, Any]] = fetch_exit_ip):
        self.folder = Path(folder)
        self.store = VpnStore(self.folder)
        self.store.data.setdefault("auto", True)
        self.core = MihomoCore(self.folder / "core", locate_core(resource_root), log)
        self.log = log
        self.fetch = fetch
        self.ip_lookup = ip_lookup
        self.delays: Dict[str, Optional[int]] = {}
        self.tested: set = set()
        self.tested_at = 0.0
        self.testing = False
        self.applied_port = 0
        self.message = ""
        self.message_kind = ""
        self.last_failover = 0.0
        self.exit_info: Dict[str, Any] = {}
        self.switches: List[Dict[str, Any]] = []
        self.lock = threading.RLock()
        self.on_change: Callable[[], None] = lambda: None
        self.restart_browser: Callable[[int], None] = lambda _port: None
        self.health_stop = threading.Event()
        self.health_thread: Optional[threading.Thread] = None

    # ── state for the panel (no secrets) ──
    def state(self) -> Dict[str, Any]:
        proxies = self.store.all_proxies()
        selected = self.store.data.get("selected")
        if selected not in [p["name"] for p in proxies]:
            selected = None
        return {
            "enabled": bool(self.store.data.get("enabled")),
            "applied": bool(self.applied_port),
            "auto": bool(self.store.data.get("auto", True)),
            "coreAvailable": bool(self.core.binary),
            "selected": selected,
            "testing": self.testing,
            "message": self.message,
            "messageKind": self.message_kind,
            "subscriptions": [{
                "id": s.get("id"), "title": s.get("title") or "订阅", "host": s.get("host", ""),
                "count": len(s.get("nodes") or []), "updatedAt": s.get("updatedAt"), "error": s.get("error", ""),
                "refreshable": bool(s.get("url")),
                "usage": usage_text(s.get("usage") or {}),
            } for s in self.store.subscriptions],
            "nodes": [{**subs.describe(p), "delay": self.delays.get(p["name"]), "tested": p["name"] in self.tested}
                      for p in proxies],
        }

    def _note(self, text: str, kind: str = "") -> None:
        self.message, self.message_kind = text, kind

    def _core_proxies(self) -> List[Dict[str, Any]]:
        return [{k: v for k, v in p.items() if not k.startswith("_")} for p in self.store.all_proxies()]

    # ── operations (each returns {"ok", "message"}) ──
    def handle(self, op: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        handler = {
            "status": lambda: {"ok": True},
            "add": lambda: self.add(str(payload.get("url", ""))),
            "refresh": lambda: self.refresh(str(payload.get("id", ""))),
            "remove": lambda: self.remove(str(payload.get("id", ""))),
            "test": self.test,
            "select": lambda: self.select(str(payload.get("name") or payload.get("node") or "")),
            "enable": lambda: self.enable(bool(payload.get("on"))),
            "open_ip_check": lambda: {"ok": True, "url": IP_CHECK_URL},
            "best": lambda: self.best(str(payload.get("region") or ""), bool(payload.get("on"))),
            "auto": lambda: self.set_auto(bool(payload.get("on"))),
            "failover": lambda: self.failover(str(payload.get("reason") or "")),
            "ip": self.exit_ip,
        }.get(op)
        if not handler:
            return {"ok": False, "message": "不认识的节点操作。"}
        try:
            result = handler()
        except subs.SubscriptionError as error:
            result = {"ok": False, "message": str(error)}
        except CoreError as error:
            result = {"ok": False, "message": str(error)}
        except Exception as error:  # noqa: BLE001
            self.log(f"browser vpn {op} failed: {error!r}")
            result = {"ok": False, "message": f"操作没有完成：{error}"}
        if op != "status" and not (op == "failover" and result.get("ok") and not result.get("switched")):
            self._note(result.get("message", ""), "err" if not result.get("ok") else "ok")
        self.on_change()
        return result

    def _download(self, source: str) -> Dict[str, Any]:
        if subs.looks_like_url(source):
            text, headers = self.fetch(source)
            nodes = subs.parse_subscription(text)
            host = urllib.parse.urlsplit(source).hostname or ""
            return {"url": source, "host": host, "title": subs.subscription_title(headers, source), "nodes": nodes,
                    "usage": subs.parse_userinfo(headers.get("subscription-userinfo", ""))}
        nodes = subs.parse_subscription(source)
        return {"url": "", "host": "手动添加", "title": f"手动节点（{len(nodes)}）", "nodes": nodes, "usage": {}, "inline": source}

    def add(self, source: str) -> Dict[str, Any]:
        source = source.strip()
        if not source:
            raise subs.SubscriptionError("先粘贴订阅链接。")
        with self.lock:
            if source in [s.get("url") for s in self.store.subscriptions if s.get("url")]:
                raise subs.SubscriptionError("这个订阅已经添加过了，需要更新请点它旁边的「刷新」。")
        item = self._download(source)
        item.update({"id": uuid.uuid4().hex[:10], "updatedAt": int(time.time()), "error": ""})
        with self.lock:
            self.store.subscriptions.append(item)
            if not self.store.data.get("selected"):
                self.store.data["selected"] = self.store.all_proxies()[0]["name"]
            self.store.save()
        self._reload_core()
        return {"ok": True, "message": f"已添加「{item['title']}」，共 {len(item['nodes'])} 个节点。点「测速」看看哪个快。"}

    def refresh(self, sub_id: str) -> Dict[str, Any]:
        targets = [s for s in self.store.subscriptions if not sub_id or s.get("id") == sub_id]
        if not targets:
            raise subs.SubscriptionError("找不到这个订阅。")
        failures = []
        for sub in targets:
            if not sub.get("url"):
                continue
            try:
                fresh = self._download(sub["url"])
            except subs.SubscriptionError as error:
                sub["error"] = str(error)
                failures.append(str(error))
                continue
            sub.update({"nodes": fresh["nodes"], "usage": fresh["usage"], "title": fresh["title"] or sub.get("title"),
                        "updatedAt": int(time.time()), "error": ""})
        with self.lock:
            self.store.save()
        self.delays.clear()
        self.tested.clear()
        self._reload_core()
        if failures:
            return {"ok": False, "message": failures[0] + "（已保留上次的节点）"}
        return {"ok": True, "message": "订阅已更新。"}

    def remove(self, sub_id: str) -> Dict[str, Any]:
        with self.lock:
            before = len(self.store.subscriptions)
            self.store.data["subscriptions"] = [s for s in self.store.subscriptions if s.get("id") != sub_id]
            if len(self.store.subscriptions) == before:
                raise subs.SubscriptionError("找不到这个订阅。")
            names = [p["name"] for p in self.store.all_proxies()]
            if self.store.data.get("selected") not in names:
                self.store.data["selected"] = names[0] if names else None
            if not names and self.store.data.get("enabled"):
                self.store.data["enabled"] = False
                self.store.save()
                self._apply(False)
                return {"ok": True, "message": "订阅已删除；没有节点了，浏览器已改回直连。"}
            self.store.save()
        self._reload_core()
        return {"ok": True, "message": "订阅已删除。"}

    def _ensure_core(self) -> None:
        proxies = self._core_proxies()
        if not proxies:
            raise CoreError("还没有可用节点，请先添加订阅。")
        if not self.core.running():
            self.core.start(proxies, self.store.data.get("selected"))

    def _reload_core(self) -> None:
        """Pick up changed nodes.  The port stays the same, so a proxied
        browser keeps working without restarting."""
        if self.core.running():
            proxies = self._core_proxies()
            if proxies:
                self.core.start(proxies, self.store.data.get("selected"))
            elif not self.store.data.get("enabled"):
                self.core.stop()

    def _measure(self, timeout_ms: Optional[int] = None) -> bool:
        """Test every node; False when another test is already running."""
        with self.lock:
            if self.testing:
                return False
            self.testing = True
        self.on_change()
        try:
            self._ensure_core()
            names = [p["name"] for p in self.store.all_proxies()]
            results = self.core.delays(timeout_ms=timeout_ms) if timeout_ms else self.core.delays()
            self.delays = {name: results.get(name) for name in names}
            self.tested = set(names)
            self.tested_at = time.time()
        finally:
            self.testing = False
            if not self.store.data.get("enabled") and not self.applied_port:
                # Testing alone should not keep a core running in the background.
                self.core.stop()
        return True

    def _fastest(self, region: str = "", exclude: Optional[str] = None) -> Optional[str]:
        alive = [(delay, name) for name, delay in self.delays.items()
                 if delay and name != exclude and region_matches(name, region)]
        return min(alive)[1] if alive else None

    def _switch(self, name: str, why: str) -> None:
        previous = self.store.data.get("selected")
        with self.lock:
            self.store.data["selected"] = name
            self.store.save()
        if self.core.running():
            self.core.select(name)
        self.switches = ([{"at": int(time.time()), "from": previous, "to": name, "why": why}] + self.switches)[:5]
        self.exit_info = {}
        self.log(f"browser vpn switched node ({why})")

    def test(self) -> Dict[str, Any]:
        if not self._measure():
            return {"ok": True, "message": "正在测速…"}
        good = sum(1 for v in self.delays.values() if v)
        if not good:
            return {"ok": False, "message": "所有节点都连不上：可能订阅过期、节点维护，或者本机网络限制了这些协议。"}
        selected = self.store.data.get("selected")
        hint = ""
        if selected and not self.delays.get(selected):
            fastest = self._fastest()
            if self.store.data.get("auto", True) and fastest:
                self._switch(fastest, "测速发现当前节点不通")
                hint = f"原来的节点连不上，已自动换到最快的「{fastest}」（{self.delays[fastest]} ms）。"
            else:
                hint = "当前选中的节点连不上，换一个绿色的。"
        return {"ok": True, "message": f"测速完成：{good}/{len(self.delays)} 个节点可用。{hint}"}

    def resolve_name(self, name: str) -> str:
        """Exact node name, or the one node whose name contains what was asked."""
        names = [p["name"] for p in self.store.all_proxies()]
        if name in names:
            return name
        wanted = name.strip().lower()
        matches = [n for n in names if wanted and wanted in n.lower()] if wanted else []
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise subs.SubscriptionError(f"有 {len(matches)} 个节点名字里含「{name}」，请说完整名称，或用 best 加 region 自动挑最快的："
                                         + "、".join(matches[:6]))
        raise subs.SubscriptionError("这个节点已经不在订阅里了，请刷新订阅。")

    def select(self, name: str) -> Dict[str, Any]:
        name = self.resolve_name(name)
        with self.lock:
            self.store.data["selected"] = name
            self.store.save()
        if self.core.running():
            self.core.select(name)
        self.exit_info = {}
        offline = name in self.tested and not self.delays.get(name)
        message = f"已切换到「{name}」。" + ("这个节点刚才测速连不上，网页可能打不开。" if offline else "")
        if not self.store.data.get("enabled"):
            message += "打开「浏览器走节点」后生效。"
        return {"ok": True, "message": message, "node": name}

    def best(self, region: str = "", turn_on: bool = False) -> Dict[str, Any]:
        """Test all nodes and use the fastest (optionally in one region)."""
        if not self._measure():
            return {"ok": False, "message": "正在测速，请几秒后再试。"}
        fastest = self._fastest(region)
        if not fastest:
            where = f"「{region}」的" if region else ""
            return {"ok": False, "message": f"没有{where}可用节点：测速全部超时。可以刷新订阅后再试。"}
        if fastest != self.store.data.get("selected"):
            self._switch(fastest, f"挑最快节点{('（' + region + '）') if region else ''}")
        message = f"已选最快的「{fastest}」（{self.delays[fastest]} ms）。"
        if turn_on and not self.store.data.get("enabled"):
            message += self.enable(True)["message"]
        elif not self.store.data.get("enabled"):
            message += "浏览器当前直连，要用这个节点请开启「浏览器走节点」。"
        return {"ok": True, "message": message, "node": fastest, "delay": self.delays[fastest]}

    def set_auto(self, on: bool) -> Dict[str, Any]:
        with self.lock:
            self.store.data["auto"] = bool(on)
            self.store.save()
        if on:
            self._start_health()
        return {"ok": True, "message": "已开启自动切换：当前节点不通时会自动换到最快的可用节点。" if on
                else "已关闭自动切换，节点只会在手动选择时改变。"}

    def failover(self, reason: str = "") -> Dict[str, Any]:
        """The current node looks dead (a page failed to load through it):
        switch to the fastest node that answers.  Rate limited."""
        if not (self.store.data.get("enabled") and self.applied_port):
            return {"ok": True, "switched": False, "message": "浏览器没有走节点，不需要切换。"}
        if not self.store.data.get("auto", True):
            return {"ok": True, "switched": False, "message": "自动切换已关闭。"}
        now = time.monotonic()
        if now - self.last_failover < FAILOVER_COOLDOWN:
            return {"ok": True, "switched": False, "message": "刚刚已经检查过节点。"}
        self.last_failover = now
        current = self.store.data.get("selected")
        # A short test: 碧琪 (or the user) is waiting on a page.
        if not self._measure(timeout_ms=FAILOVER_TEST_MS):
            return {"ok": True, "switched": False, "message": "正在测速。"}
        if current and self.delays.get(current):
            # The node answers; the site itself is the problem.
            return {"ok": True, "switched": False, "node": current, "delay": self.delays[current],
                    "message": f"当前节点「{current}」是通的（{self.delays[current]} ms），打不开可能是网站本身的问题。"}
        fastest = self._fastest(exclude=current)
        if not fastest:
            return {"ok": False, "switched": False, "message": "所有节点都连不上：可能订阅过期，或本机网络限制了这些协议。"}
        self._switch(fastest, reason or "网页打不开")
        return {"ok": True, "switched": True, "node": fastest, "delay": self.delays[fastest], "from": current,
                "message": f"节点「{current}」不通，已自动换到「{fastest}」（{self.delays[fastest]} ms）。"}

    def exit_ip(self) -> Dict[str, Any]:
        port = self.applied_port if self.store.data.get("enabled") else 0
        try:
            info = self.ip_lookup(port)
        except Exception as error:  # noqa: BLE001
            return {"ok": False, "message": f"查不到出口 IP：{error}"[:200]}
        self.exit_info = {**info, "via": self.store.data.get("selected") if port else "直连", "at": int(time.time())}
        place = " ".join(x for x in (info.get("country"), info.get("city")) if x)
        return {"ok": True, "message": f"浏览器出口 IP {info.get('ip')}（{place or '未知地区'}）。", "exit": self.exit_info}

    def agent_view(self, limit: int = 12) -> Dict[str, Any]:
        """What 碧琪 needs to reason about her browser's network, no secrets:
        current node, its latency and region, the best alternatives."""
        proxies = self.store.all_proxies()
        names = [p["name"] for p in proxies]
        selected = self.store.data.get("selected") if self.store.data.get("selected") in names else None
        enabled = bool(self.store.data.get("enabled"))
        types = {p["name"]: p.get("type") for p in proxies}

        def node(name: str) -> Dict[str, Any]:
            item: Dict[str, Any] = {"name": name, "type": types.get(name), "region": node_region(name)}
            if name in self.tested:
                item["delayMs"] = self.delays.get(name)  # None = timed out
            return item

        alive = sorted((n for n in names if self.delays.get(n)), key=lambda n: self.delays[n])
        regions: Dict[str, int] = {}
        for name in alive:
            region = node_region(name) or "其他"
            regions[region] = regions.get(region, 0) + 1
        view: Dict[str, Any] = {
            "mode": ("节点：" + str(selected)) if enabled and self.applied_port else ("直连" if not enabled else "节点已开启但未生效"),
            "enabled": enabled, "applied": bool(self.applied_port), "autoSwitch": bool(self.store.data.get("auto", True)),
            "coreAvailable": bool(self.core.binary), "current": node(selected) if selected else None,
            "nodeCount": len(names), "testing": self.testing,
            "subscriptions": [{"title": s.get("title") or "订阅", "count": len(s.get("nodes") or []),
                               "usage": usage_text(s.get("usage") or {}), "error": s.get("error", "")}
                              for s in self.store.subscriptions],
        }
        if self.tested:
            view["testedAgoS"] = int(time.time() - self.tested_at) if self.tested_at else None
            view["alive"] = len(alive)
            view["fastest"] = [node(n) for n in alive[:limit]]
            view["aliveByRegion"] = regions
        else:
            view["hint"] = "还没测过速：用 vpn op=test 或 op=best 拿到每个节点的延迟。"
        if self.exit_info:
            view["exit"] = self.exit_info
        if self.switches:
            view["recentSwitches"] = self.switches
        if self.message:
            view["lastMessage"] = self.message
        return view

    # ── background health check while proxied ──
    def _start_health(self) -> None:
        if self.health_thread and self.health_thread.is_alive():
            return
        self.health_stop.clear()
        self.health_thread = threading.Thread(target=self._health_loop, name="browser-vpn-health", daemon=True)
        self.health_thread.start()

    def _health_loop(self) -> None:
        while not self.health_stop.wait(HEALTH_INTERVAL):
            if not (self.store.data.get("enabled") and self.applied_port and self.store.data.get("auto", True)):
                continue
            current = self.store.data.get("selected")
            try:
                if current and self.core.running() and self.core.delay(current):
                    continue
                result = self.failover("定时检查发现当前节点不通")
                if result.get("switched"):
                    self._note(result["message"], "ok")
                    self.on_change()
            except Exception as error:  # noqa: BLE001
                self.log(f"browser vpn health check failed: {error!r}")

    def enable(self, on: bool) -> Dict[str, Any]:
        if on:
            if not self.core.binary:
                raise CoreError("这个安装包里没有节点核心（mihomo），浏览器节点功能用不了。请重新安装最新版。")
            selected = self.store.data.get("selected")
            note = ""
            if self.store.data.get("auto", True) and selected in self.tested and not self.delays.get(selected):
                fastest = self._fastest()
                if fastest:
                    self._switch(fastest, "开启时当前节点不通")
                    note = f"（原节点不通，已换成最快的「{fastest}」）"
            self._ensure_core()
            with self.lock:
                self.store.data["enabled"] = True
                self.store.save()
            self._apply(True)
            self._start_health()
            return {"ok": True, "message": f"浏览器已走节点「{self.store.data.get('selected')}」{note}。点「检查出口 IP」确认。"}
        with self.lock:
            self.store.data["enabled"] = False
            self.store.save()
        self._apply(False)
        return {"ok": True, "message": "浏览器已改回直连（和系统设置一致）。"}

    def _apply(self, on: bool) -> None:
        port = self.core.mixed_port if on and self.core.running() else 0
        if port != self.applied_port:
            self.applied_port = port
            self.restart_browser(port)
        if not on:
            self.core.stop()

    def startup_port(self) -> int:
        """Proxy port for a fresh browser launch (0 = direct)."""
        if not self.store.data.get("enabled"):
            return 0
        try:
            self._ensure_core()
            self.applied_port = self.core.mixed_port
            self._start_health()
            return self.applied_port
        except CoreError as error:
            # Tell the user instead of silently browsing direct.
            self.store.data["enabled"] = False
            self.store.save()
            self._note(f"{error} 浏览器节点已关闭，当前为直连。", "err")
            self.applied_port = 0
            return 0

    def shutdown(self) -> None:
        self.health_stop.set()
        self.core.stop()


class BrowserManager:
    def __init__(self, state_root: Path, resource_root: Optional[Path] = None, log: Callable[[str], None] = lambda _m: None):
        self.folder = browser_state_dir(state_root)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.resource_root = Path(resource_root) if resource_root else None
        self.log = log
        self.endpoint_file = self.folder / "endpoint.json"
        self.client_token = secrets.token_hex(24)
        self.host_token = secrets.token_hex(24)
        self.listener: Optional[socket.socket] = None
        self.port = 0
        self.host_process: Optional[subprocess.Popen] = None
        self.host_conn: Optional[socket.socket] = None
        self.host_lock = threading.RLock()
        self.send_lock = threading.Lock()
        self.host_ready = threading.Event()
        self.pending: Dict[str, Dict[str, Any]] = {}
        self.owner_hwnd: Callable[[], int] = lambda: 0
        self.vpn = VpnService(self.folder, self.resource_root, log)
        self.vpn.on_change = self.push_vpn
        self.vpn.restart_browser = self.restart_host
        self.closing = False

    # ── endpoint ──
    def start(self) -> None:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        self.listener = listener
        self.port = listener.getsockname()[1]
        data = {"v": 1, "host": "127.0.0.1", "port": self.port, "token": self.client_token, "pid": os.getpid()}
        temp = self.endpoint_file.with_suffix(".tmp")
        temp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(temp, self.endpoint_file)
        os.environ[ENDPOINT_ENV] = endpoint_environment_value(self.endpoint_file)
        threading.Thread(target=self._accept_loop, name="inapp-browser-endpoint", daemon=True).start()
        self.log(f"in-app browser endpoint 127.0.0.1:{self.port}")

    def _accept_loop(self) -> None:
        while not self.closing and self.listener:
            try:
                conn, _ = self.listener.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn: socket.socket) -> None:
        reader = conn.makefile("r", encoding="utf-8", newline="\n")
        try:
            conn.settimeout(10)
            first = reader.readline()
            conn.settimeout(None)
            message = json.loads(first) if first.strip() else {}
        except (OSError, ValueError):
            conn.close()
            return
        if message.get("hello") == "host":
            if secrets.compare_digest(str(message.get("token", "")), self.host_token):
                self._host_session(conn, reader)
            else:
                conn.close()
            return
        try:
            if not secrets.compare_digest(str(message.get("token", "")), self.client_token):
                reply = {"id": message.get("id", ""), "ok": False, "reason": "App 浏览器拒绝了没有授权的连接。"}
            else:
                reply = self.request(message)
            conn.sendall((json.dumps(reply, ensure_ascii=False) + "\n").encode("utf-8"))
        except OSError:
            pass
        finally:
            try:
                conn.close()
            except OSError:
                pass

    # ── host process ──
    def _host_session(self, conn: socket.socket, reader) -> None:
        with self.host_lock:
            old, self.host_conn = self.host_conn, conn
        if old:
            try:
                old.close()
            except OSError:
                pass
        try:
            for line in reader:
                line = line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                if "up" in message:
                    threading.Thread(target=self._upcall, args=(message,), daemon=True).start()
                elif message.get("event") == "ready":
                    self.host_ready.set()
                    self.push_vpn()
                elif message.get("event") == "error":
                    self.log("in-app browser: " + str(message.get("message")))
                elif "id" in message:
                    slot = self.pending.get(str(message["id"]))
                    if slot:
                        slot["reply"] = message
                        slot["event"].set()
        except OSError:
            pass
        finally:
            with self.host_lock:
                if self.host_conn is conn:
                    self.host_conn = None
                    self.host_ready.clear()
            for slot in list(self.pending.values()):
                if not slot["event"].is_set():
                    slot["reply"] = {"ok": False, "reason": "App 浏览器窗口已关闭，请重新打开后再试。"}
                    slot["event"].set()

    def _send_host(self, message: Dict[str, Any]) -> bool:
        conn = self.host_conn
        if not conn:
            return False
        try:
            with self.send_lock:
                conn.sendall((json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8"))
            return True
        except OSError:
            return False

    def host_running(self) -> bool:
        return bool(self.host_process and self.host_process.poll() is None and self.host_conn)

    def ensure_host(self, hidden: bool = True, restore: bool = False) -> None:
        with self.host_lock:
            if self.host_running() and self.host_ready.is_set():
                return
            if not (self.host_process and self.host_process.poll() is None):
                self._spawn_host(self.vpn.startup_port(), hidden, restore)
        if not self.host_ready.wait(HOST_START_TIMEOUT):
            raise RuntimeError("App 浏览器窗口没有启动（WebView2 可能缺失或被安全软件拦截），请稍后再试。")

    def _spawn_host(self, proxy_port: int, hidden: bool, restore: bool) -> None:
        self.host_ready.clear()
        script = control_script_path(self.resource_root)
        arguments = [
            "--connect", str(self.port), "--token", self.host_token,
            "--profile", str(self.folder / "profile"), "--state-dir", str(self.folder),
            "--control-js", str(script or ""),
        ]
        if proxy_port:
            arguments += ["--proxy-port", str(proxy_port)]
        owner = 0
        try:
            owner = int(self.owner_hwnd() or 0)
        except Exception:  # noqa: BLE001
            owner = 0
        if owner:
            arguments += ["--owner", str(owner)]
        if restore:
            arguments.append("--restore")
        if hidden:
            arguments.append("--hidden")
        environment = os.environ.copy()
        environment.pop(ENDPOINT_ENV, None)
        log_file = (self.folder / "host.log").open("ab")
        try:
            self.host_process = subprocess.Popen(
                host_command(arguments), stdin=subprocess.DEVNULL, stdout=log_file, stderr=log_file,
                env=environment, **window_process_kwargs(),
            )
        finally:
            log_file.close()
        assign_to_kill_job(self.host_process.pid)
        self.log(f"in-app browser host pid={self.host_process.pid} proxied={bool(proxy_port)}")

    def restart_host(self, proxy_port: int) -> None:
        """Relaunch the browser window with/without the node proxy, keeping
        its tabs and position (WebView2 fixes the proxy at creation)."""
        with self.host_lock:
            process = self.host_process
            was_running = bool(process and process.poll() is None)
            visible = was_running
            if was_running:
                status = self.request({"id": uuid.uuid4().hex, "action": "status"}, launch=False)
                visible = bool(status.get("ok") and status.get("result", {}).get("open"))
                self._send_host({"action": "quit"})
                try:
                    process.wait(8)
                except subprocess.TimeoutExpired:
                    process.kill()
                self.host_conn = None
                self.host_ready.clear()
            if was_running:
                self._spawn_host(proxy_port, hidden=not visible, restore=True)
        if was_running:
            self.host_ready.wait(HOST_START_TIMEOUT)

    def request(self, message: Dict[str, Any], launch: bool = True, timeout: Optional[float] = None) -> Dict[str, Any]:
        request_id = str(message.get("id") or uuid.uuid4().hex)
        action = str(message.get("action", ""))
        if action == "vpn":
            return self.vpn_request(request_id, message)
        if action == "cancel":
            self._send_host({"id": request_id, "action": "cancel", "requestId": message.get("requestId")})
            return {"id": request_id, "ok": True, "result": {"cancelled": True}}
        if not self.host_running():
            if not launch or action == "status":
                return {"id": request_id, "ok": True, "result": {"open": False, "url": "", "title": "", "connected": True,
                                                                 "network": self.vpn.agent_view(limit=5)}} \
                    if action == "status" else {"id": request_id, "ok": False, "reason": "App 浏览器没有打开。"}
            if action == "close":
                return {"id": request_id, "ok": True, "result": {"open": False}}
            try:
                self.ensure_host(hidden=action not in ("open", "show_file", "show"))
            except RuntimeError as error:
                return {"id": request_id, "ok": False, "reason": str(error)}
        forward = {k: v for k, v in message.items() if k != "token"}
        forward["id"] = request_id
        slot = {"event": threading.Event(), "reply": None}
        self.pending[request_id] = slot
        try:
            if not self._send_host(forward):
                return {"id": request_id, "ok": False, "reason": "App 浏览器连接中断，请重试。"}
            wait = timeout or (float(message.get("timeoutMs") or 30000) / 1000 + 5)
            if not slot["event"].wait(wait):
                return {"id": request_id, "ok": False, "reason": "App 浏览器操作超时，请先观察页面确认结果。"}
            reply = dict(slot["reply"] or {})
            reply["id"] = request_id
            if action == "status" and reply.get("ok") and isinstance(reply.get("result"), dict):
                reply["result"]["network"] = self.vpn.agent_view(limit=5)
            return reply
        finally:
            self.pending.pop(request_id, None)

    def vpn_request(self, request_id: str, message: Dict[str, Any]) -> Dict[str, Any]:
        """碧琪 reading or steering her browser's node from the app_browser tool."""
        op = str(message.get("op") or "status")
        debug = (self.folder / "debug").is_file()
        if op not in AGENT_VPN_OPS and not debug:
            return {"id": request_id, "ok": False, "reason": "app_browser 的 vpn 只支持 status、test、best、select、enable、auto、ip、refresh、add；删除订阅请让先生在浏览器「节点」面板里操作。"}
        payload = {k: v for k, v in message.items() if k not in ("id", "action", "op", "token", "timeoutMs")}
        if op == "enable" and "on" not in payload:
            payload["on"] = True
        if op == "refresh" and not payload.get("id"):
            payload["id"] = ""
        result = {"ok": True} if op == "status" else self.vpn.handle(op, payload)
        if debug and op not in AGENT_VPN_OPS:
            return {"id": request_id, "ok": True, "result": result}
        body = {**{k: v for k, v in result.items() if k != "ok"}, "network": self.vpn.agent_view()}
        if not result.get("ok", True):
            return {"id": request_id, "ok": False, "reason": result.get("message") or "节点操作没有完成。", "result": body}
        return {"id": request_id, "ok": True, "result": body}

    def open_url(self, url: str = "") -> Dict[str, Any]:
        """User-initiated open from the chat UI (link click, globe button)."""
        if url:
            return self.request({"action": "open", "url": url, "focus": True, "timeoutMs": 30000})
        return self.request({"action": "show", "timeoutMs": 30000})

    # ── VPN panel plumbing ──
    def _upcall(self, message: Dict[str, Any]) -> None:
        op = str(message.get("op", ""))
        payload = {k: v for k, v in message.items() if k not in ("up", "op")}
        if op.startswith("vpn."):
            reply = self.vpn.handle(op[4:], payload)
            if op == "vpn.failover":
                # The host retries the page itself; it only needs the outcome.
                reply = {k: v for k, v in reply.items() if k in ("ok", "switched", "node", "delay", "from", "message")}
        else:
            reply = {"ok": False, "message": "不认识的请求。"}
        self._send_host({"upreply": message.get("up"), **reply})

    def push_vpn(self) -> None:
        self._send_host({"push": "vpn", "state": self.vpn.state()})

    def shutdown(self) -> None:
        self.closing = True
        try:
            self._send_host({"action": "quit"})
        except Exception:  # noqa: BLE001
            pass
        process = self.host_process
        if process and process.poll() is None:
            try:
                process.wait(3)
            except subprocess.TimeoutExpired:
                process.kill()
        self.vpn.shutdown()
        if self.listener:
            try:
                self.listener.close()
            except OSError:
                pass
        try:
            data = json.loads(self.endpoint_file.read_text(encoding="utf-8"))
            if data.get("pid") == os.getpid():
                self.endpoint_file.unlink()
        except (OSError, ValueError):
            pass


_MANAGER: Optional[BrowserManager] = None


def install(state_root: Path, resource_root: Optional[Path] = None, log: Callable[[str], None] = lambda _m: None) -> Optional[BrowserManager]:
    """Start the endpoint before the gateway is spawned.  Never raises."""
    global _MANAGER
    if _MANAGER is not None:
        return _MANAGER
    try:
        manager = BrowserManager(state_root, resource_root, log)
        manager.start()
        _MANAGER = manager
        import atexit

        atexit.register(manager.shutdown)
    except Exception as error:  # noqa: BLE001
        log(f"in-app browser unavailable: {error!r}")
        _MANAGER = None
    return _MANAGER


def manager() -> Optional[BrowserManager]:
    return _MANAGER


class InAppBrowserBridge:
    """Mixed into windows_desktop.NativeBridge (pywebview js_api)."""

    def browser_workspace(self, payload=None):
        payload = payload if isinstance(payload, dict) else {}
        current = manager()
        if current is None:
            return {"ok": False, "message": "App 浏览器没有启动。"}
        action = str(payload.get("action") or "open")
        url = str(payload.get("url") or "")
        if action == "open":
            if url and not url.lower().startswith(("http://", "https://")):
                return {"ok": False, "message": "只能打开 http(s) 网址。"}
            # Return to the page at once; the window appears when ready.
            threading.Thread(target=current.open_url, args=(url,), name="inapp-browser-open", daemon=True).start()
            return {"ok": True}
        if action == "close":
            threading.Thread(target=current.request, args=({"action": "close"},), kwargs={"launch": False}, daemon=True).start()
            return {"ok": True}
        return {"ok": False, "message": "不支持的浏览器操作。"}

    def browser_vpn(self, payload=None):
        payload = payload if isinstance(payload, dict) else {}
        current = manager()
        if current is None:
            return {"ok": False, "message": "App 浏览器没有启动。"}
        op = str(payload.get("op") or "status")
        reply = current.vpn.handle(op, payload)
        return {**reply, "state": current.vpn.state()}
