"""FanVPN 配置解密与节点管理核心（纯标准库，零第三方依赖）。

从 Chrome 扩展 background.js 的等价逻辑移植：
  1. 从多个镜像源拉取加密信封 (envelope)
  2. 用内置 RSA-2048 私钥做 RSA-OAEP(SHA-1) 解出 AES-256 会话密钥
  3. 用 AES-CBC 解出明文节点表 JSON
  4. 提供节点测速与选择

工程约束（重要）：
    Windows 发行包由 build-win.ps1 用 PyInstaller 打包，pip 清单里没有
    cryptography，仓库也没有 requirements 约束它。所以这里**只用标准库**：
    hashlib + urllib + purecrypto 里的纯 Python RSA/AES。
    PyInstaller 永远会带标准库，不会漏；第三方 C 扩展则可能整个缺失。
"""

from __future__ import annotations

import json
import socket
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Tuple

from purecrypto import DecryptError, decrypt_envelope, parse_rsa_private_key_pem

# ── 与扩展 background.js 完全一致的常量 ──────────────────────────────
CONFIG_URLS = (
    "https://gitlab.com/zhifan999/fq/-/raw/main/config.json",
    "https://www.githubip.xyz/config.json",
    "https://d23lye95wfkvbk.cloudfront.net/config.json",
)

CACHE_TTL = 5 * 60  # 5 分钟，与扩展一致（秒）


class ConfigError(RuntimeError):
    """配置拉取或解密失败。"""


@dataclass(frozen=True)
class Node:
    """一个代理节点。字段与扩展 config.nodes[] 保持一致。"""

    name: str
    server: str
    port: int
    flag: str = "US"

    @property
    def label(self) -> str:
        return f"{self.name} ({self.server}:{self.port})"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class FanVpnConfig:
    """配置拉取 + RSA/AES 解密 + 节点列表缓存。"""

    def __init__(self, private_key_pem: str, urls: Tuple[str, ...] = CONFIG_URLS, timeout: float = 4.0):
        self._urls = tuple(urls)
        self._timeout = timeout
        self._n, self._e, self._d = parse_rsa_private_key_pem(private_key_pem)
        self._nodes: List[Node] = []
        self._stamp = 0.0
        self._raw: Dict[str, Any] = {}

    # ── 解密 ────────────────────────────────────────────────────
    def _decrypt(self, envelope: Dict[str, Any]) -> Dict[str, Any]:
        try:
            return decrypt_envelope(envelope, self._n, self._e, self._d)
        except DecryptError as exc:
            raise ConfigError(str(exc)) from exc

    # ── 网络拉取 ────────────────────────────────────────────────
    def _fetch_envelope(self) -> Dict[str, Any]:
        """顺序尝试镜像源：任一成功即返回（与扩展的 for 循环语义一致）。"""
        errors = []
        context = ssl.create_default_context()
        for url in self._urls:
            try:
                request = urllib.request.Request(
                    url,
                    headers={"User-Agent": "FanVpnWebView2/1.0", "Cache-Control": "no-cache"},
                )
                with urllib.request.urlopen(request, timeout=self._timeout, context=context) as response:
                    if not 200 <= int(response.status) < 300:
                        errors.append(f"{url} -> HTTP {response.status}")
                        continue
                    value = json.loads(response.read().decode("utf-8"))
                    if isinstance(value, dict):
                        return value
                    errors.append(f"{url} -> 非 JSON 对象")
            except (urllib.error.URLError, OSError, ValueError) as exc:
                errors.append(f"{url} -> {exc}")
                continue
        raise ConfigError("所有配置源均失败: " + "; ".join(errors))

    # ── 对外接口 ────────────────────────────────────────────────
    def load(self, force: bool = False) -> List[Node]:
        """返回节点列表。CACHE_TTL 内复用缓存，与扩展一致。"""
        if not force and self._nodes and (time.time() - self._stamp) < CACHE_TTL:
            return list(self._nodes)

        envelope = self._fetch_envelope()
        raw = self._decrypt(envelope)

        nodes: List[Node] = []
        for item in raw.get("nodes") or []:
            try:
                nodes.append(
                    Node(
                        name=str(item.get("name") or item.get("server")),
                        server=str(item["server"]),
                        port=int(item["port"]),
                        flag=str(item.get("flag") or "US"),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue  # 单条畸形数据跳过，不影响整体

        if not nodes:
            raise ConfigError("配置解密成功但没有任何有效节点")

        self._nodes = nodes
        self._raw = raw
        self._stamp = time.time()
        return list(nodes)

    def raw(self) -> Dict[str, Any]:
        return dict(self._raw)


def probe_node(node: Node, timeout: float = 5.0) -> Dict[str, Any]:
    """基于 TCP+TLS 握手的可达性探测。

    扩展用 fetch(HEAD) 且 no-cors，拿不到状态码，只能判断“有没有抛异常”。
    这里用同样廉价的 TLS 握手，但能给出毫秒数，面板上就能排序。
    """
    started = time.monotonic()
    try:
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        with socket.create_connection((node.server, node.port), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=node.server):
                pass
        return {"server": node.server, "status": "ok", "ms": int((time.monotonic() - started) * 1000)}
    except (OSError, ssl.SSLError) as exc:
        return {"server": node.server, "status": "fail", "ms": 0, "error": str(exc)[:120]}
