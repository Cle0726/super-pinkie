"""FanVPN 接入碧琪：给用户的浏览器挂上节点，并让自家 WebView2 也走代理。

与 standalone 版的区别（**这是重点**）
--------------------------------------
standalone 版用 ``WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`` 环境变量把
WebView2 指到本地代理。**在碧琪里这条路是死的**：pywebview 自己会设置
WebView2 的 AdditionalBrowserArguments，一旦它设了，WebView2 就忽略
环境变量。碧琪 ``windows_desktop.py:3742`` 那段注释就是在说这件事：

    pywebview sets WebView2's AdditionalBrowserArguments itself, which
    makes WebView2 ignore WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS

所以这里改成两条腿走路：

1. **系统浏览器**（Chrome / Edge / Firefox）→ 写 WinINET 注册表 + PAC。
   这条和碧琪自己的 ``browser_proxy.py`` 是两回事：那个只改
   ``--proxy-server`` 给 OpenClaw 单独启动的那个浏览器实例，
   不影响用户自己双击打开的浏览器。

2. **碧琪自己的 WebView2 窗口** → 走 ``webview.settings``。
   pywebview 提供了 ``settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"]`` 之类，
   但代理参数没有官方键，所以这里**不做侵入式改写**：碧琪的窗口本来就是
   在本地 127.0.0.1 上跑 UI，走系统代理时环回已由 PAC 排除，
   不会绕进节点。这是刻意取舍 —— 见 ``webview_proxy_note()``。

依赖方向
--------
本模块只依赖 ``app/fanvpn/`` 下的四个纯标准库模块，不 import 碧琪的
任何东西，方便单独测试和在非 Windows 平台上跑单测。
"""

from __future__ import annotations

import logging
import sys
import threading
from pathlib import Path
from typing import Any, Dict, Optional

LOG = logging.getLogger("pinkie.fanvpn")

# 端口选择：避开碧琪已在用的端口，也不要撞用户自己的 Clash(7890/7891)
DEFAULT_PROXY_PORT = 10809
DEFAULT_PANEL_PORT = 10810


def _ensure_path() -> None:
    """把 app/fanvpn 放进 sys.path，供内部模块互相 import。"""
    here = Path(__file__).resolve().parent
    if str(here) not in sys.path:
        sys.path.insert(0, str(here))


class FanVpnBridge:
    """碧琪里的 FanVPN 生命周期。线程安全，重复 start 幂等。"""

    def __init__(self, key_source: Any = None, proxy_port: int = DEFAULT_PROXY_PORT):
        self._lock = threading.Lock()
        self._service = None
        self._key_source = key_source
        self.proxy_port = proxy_port
        self.panel_port = DEFAULT_PANEL_PORT
        self.last_error: Optional[str] = None

    # ── 状态 ────────────────────────────────────────────────────
    @property
    def running(self) -> bool:
        return self._service is not None

    def status(self) -> Dict[str, Any]:
        """给 UI 用的状态快照。任何情况下都不抛异常。"""
        if self._service is None:
            return {
                "ok": True,
                "running": False,
                "enabled": False,
                "proxyPort": self.proxy_port,
                "panelUrl": None,
                "nodes": [],
                "active": None,
                "error": self.last_error,
            }
        service = self._service
        try:
            system = service._state_payload().get("system") or {}
        except Exception:  # noqa: BLE001 - 状态查询不能让 UI 崩
            system = {}
        return {
            "ok": True,
            "running": True,
            "enabled": bool(system.get("applied")),
            "proxyPort": self.proxy_port,
            "panelUrl": service.panel_url,
            "nodes": [
                {"name": n.name, "server": n.server, "port": n.port, "flag": n.flag}
                for n in service.nodes
            ],
            "active": service.active.server if service.active else None,
            "mode": service.proxy.mode,
            "system": system,
            "error": self.last_error,
        }

    # ── 启停 ────────────────────────────────────────────────────
    def start(self, enable_system_proxy: bool = False) -> Dict[str, Any]:
        """拉起服务并（可选）接管系统浏览器代理。

        返回结构化结果而不是抛异常：这是给 pywebview 的 js_api 调的，
        抛异常会让前端的 Promise 直接 reject，用户只看到一句看不懂的错。
        """
        with self._lock:
            if self._service is not None:
                return self.status()

            _ensure_path()
            try:
                from fanvpn_service import FanVpnService, FanVpnSettings
            except ImportError as exc:
                self.last_error = f"缺少 FanVPN 服务模块: {exc}"
                LOG.exception("fanvpn import failed")
                return self.status()

            pem = self._resolve_key()
            if not pem:
                self.last_error = self.last_error or "找不到节点配置密钥"
                return self.status()

            try:
                settings = FanVpnSettings(
                    panel_port=self.panel_port,
                    proxy_port=self.proxy_port,
                    key_path=pem,
                )
                service = FanVpnService(settings)
                if not service.start(timeout=20.0):
                    self.last_error = "FanVPN 服务启动超时"
                    return self.status()
                self._service = service
                self.panel_port = service.settings.panel_port
                self.proxy_port = service.settings.proxy_port
                self.last_error = None
            except Exception as exc:  # noqa: BLE001
                self.last_error = f"FanVPN 启动失败: {exc}"
                LOG.exception("fanvpn start failed")
                return self.status()

        if enable_system_proxy:
            return self.enable_browser_proxy()
        return self.status()

    def stop(self) -> Dict[str, Any]:
        """停服务。**必须先把系统代理还原**，否则用户直接断网。"""
        with self._lock:
            service = self._service
            self._service = None

        if service is None:
            return self.status()

        try:
            service.restore_system_proxy()
        except Exception as exc:  # noqa: BLE001
            LOG.exception("restore failed")
            self.last_error = f"还原系统代理失败: {exc}"
        try:
            service.stop()
        except Exception:  # noqa: BLE001
            LOG.exception("service stop failed")
        return self.status()

    # ── 系统浏览器代理 ──────────────────────────────────────────
    def enable_browser_proxy(self, method: str = "pac") -> Dict[str, Any]:
        if self._service is None:
            started = self.start()
            if not started.get("running"):
                return started
        assert self._service is not None
        try:
            self._service.apply_system_proxy(method)
            self.last_error = None
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"设置系统代理失败: {exc}"
            LOG.exception("apply system proxy failed")
        return self.status()

    def disable_browser_proxy(self) -> Dict[str, Any]:
        if self._service is None:
            return self.status()
        try:
            self._service.restore_system_proxy()
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"还原系统代理失败: {exc}"
            LOG.exception("restore system proxy failed")
        return self.status()

    # ── 节点 ────────────────────────────────────────────────────
    def select_node(self, server: str, port: int) -> Dict[str, Any]:
        if self._service is None:
            return self.status()
        try:
            self._service.select_node(str(server), int(port))
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"切换节点失败: {exc}"
        return self.status()

    def refresh_nodes(self) -> Dict[str, Any]:
        if self._service is None:
            return self.start()
        try:
            self._service.nodes = self._service.config.load(force=True)  # type: ignore[union-attr]
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"刷新节点失败: {exc}"
        return self.status()

    # ── 密钥 ────────────────────────────────────────────────────
    def _resolve_key(self) -> Optional[str]:
        """找 RSA 私钥。

        碧琪的运行时里没有单独的 pem 文件，密钥来自 FanVPN 扩展本身
        （``background.js`` 里的 ``PRIVATE_KEY_PEM``）。所以这里优先用
        显式传入的，其次去 bundled 资源目录找扩展源码。
        """
        if self._key_source:
            text = str(self._key_source)
            if "BEGIN PRIVATE KEY" in text:
                return text
            path = Path(text)
            if path.is_file():
                try:
                    content = path.read_text(encoding="utf-8")
                    if "BEGIN PRIVATE KEY" in content:
                        return content
                except OSError:
                    pass

        # 从扩展源码提取（与 standalone 版同一套逻辑）
        try:
            _ensure_path()
            from win_bootstrap_keys import extract_from_js  # type: ignore

            found = extract_from_js()
            if found:
                return found
        except ImportError:
            pass

        # 最后兜底：在常见位置找 pem
        for candidate in (
            Path(__file__).resolve().parent / "fanvpn" / "_key.pem",
            Path.home() / ".openclaw" / "fanvpn" / "_key.pem",
        ):
            try:
                if candidate.is_file():
                    text = candidate.read_text(encoding="utf-8")
                    if "BEGIN PRIVATE KEY" in text:
                        return text
            except OSError:
                continue

        self.last_error = (
            "找不到节点配置密钥。把 FanVPN 扩展的 background.js 放到 "
            "resources/fanvpn/background.js，或把 _key.pem 放到 "
            "~/.openclaw/fanvpn/_key.pem"
        )
        return None


def webview_proxy_note() -> str:
    """为什么不去改 pywebview 的代理参数。留给后来人看。"""
    return (
        "碧琪窗口本身在 127.0.0.1 上跑 UI，PAC 已把环回与私有网段列为直连，"
        "所以系统代理不会把碧琪自己的界面绕进节点。刻意不去动 "
        "webview.settings：pywebview 的 AdditionalBrowserArguments 是它内部"
        "管理的，外部改写会在升级时静默失效，而且会连带影响 CDP 调试端口。"
    )


_bridge: Optional[FanVpnBridge] = None
_bridge_lock = threading.Lock()


def get_bridge() -> FanVpnBridge:
    """进程内单例。碧琪的 js_api 是长驻对象，单例才不会被重复拉起。"""
    global _bridge
    with _bridge_lock:
        if _bridge is None:
            _bridge = FanVpnBridge()
        return _bridge


def shutdown() -> None:
    """进程退出时调用，保证系统代理被还原。"""
    global _bridge
    with _bridge_lock:
        bridge, _bridge = _bridge, None
    if bridge is not None:
        bridge.stop()
