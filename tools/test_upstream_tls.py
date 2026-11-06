"""上游 TLS 连接的回归测试。

守的 bug（真 Windows + Python 3.12 才出现）：

    TypeError: Socket cannot be of type SSLSocket
    at asyncio/base_events.py:204 _check_ssl_socket

原实现是「线程池里 socket.create_connection + ctx.wrap_socket」，
再把得到的 SSLSocket 交给 `asyncio.open_connection(sock=...)`。

Python 3.12 的 `_check_ssl_socket()` 明确禁止这样做 —— 它要求传入
**裸 socket** 并配合 `ssl=` 参数，由 asyncio 自己在非阻塞 fd 上握手。

3.9/3.10 没有这个检查（本机 3.9 连 `_check_ssl_socket` 这个属性都没有），
所以 macOS 上永远测不出来；结果是 Windows 上所有上游连接都失败，
`stats` 显示 proxied=0 failed=N，每个请求都 fail-open 退回直连 ——
用户以为在用节点，其实在裸连。
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _Path

# 测试要 import app/fanvpn 下的扁平模块（local_proxy / win_sysproxy ...）
_APP = _Path(__file__).resolve().parent.parent / "app"
for _p in (_APP / "fanvpn", _APP):
    if str(_p) not in _sys.path:
        _sys.path.insert(0, str(_p))


import asyncio
import inspect
import socket
import ssl
import unittest

from local_proxy import LocalProxy, Upstream


class TestUpstreamTlsContract(unittest.TestCase):
    """静态约定：不能把 SSLSocket 交给 asyncio。"""

    def test_does_not_use_deprecated_helper(self):
        """确认已移除会把 SSLSocket 交给 asyncio 的旧实现。"""
        self.assertFalse(
            hasattr(LocalProxy, "_connect_upstream_blocking"),
            "旧的 _connect_upstream_blocking（会 wrap_socket）应当已删除",
        )

    def test_tcp_helper_returns_raw_socket_only(self):
        """线程池里的函数只能做 TCP 建连，必须不做 TLS。"""
        source = inspect.getsource(LocalProxy._connect_tcp_blocking)
        self.assertNotIn("wrap_socket", source)
        self.assertNotIn("SSLContext", source)
        self.assertIn("create_connection", source)

    def test_open_upstream_passes_ssl_context_not_ssl_socket(self):
        """asyncio 的调用必须用 sock=裸socket + ssl=ctx。"""
        source = inspect.getsource(LocalProxy._open_upstream)
        self.assertIn("ssl=ctx", source, "必须把 ssl 上下文交给 asyncio")
        self.assertNotIn("wrap_socket", source, "不能自己 wrap_socket 再塞给 asyncio")


class TestAgainstRealPython3_12Rule(unittest.TestCase):
    """主动复现 3.12 的拒绝逻辑，让这个 bug 在 3.9 上也能被测到。"""

    def test_ssl_socket_rejected_by_asyncio(self):
        """如果本机有 _check_ssl_socket（3.12+），验证它确实会拒绝。"""
        from asyncio import base_events

        checker = getattr(base_events.BaseEventLoop, "_check_ssl_socket", None)
        if checker is None:
            self.skipTest("本机 Python < 3.12，没有该检查（这正是当初漏测的原因）")

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        left, right = socket.socketpair()
        try:
            ssl_sock = ctx.wrap_socket(left, server_side=False, do_handshake_on_connect=False)
            with self.assertRaises(TypeError):
                checker(ssl_sock)
        finally:
            for s in (left, right):
                try:
                    s.close()
                except OSError:
                    pass

    def test_raw_socket_accepted(self):
        """裸 socket 必须能通过同一检查。"""
        from asyncio import base_events

        checker = getattr(base_events.BaseEventLoop, "_check_ssl_socket", None)
        if checker is None:
            self.skipTest("Python < 3.12")
        left, right = socket.socketpair()
        try:
            checker(left)  # 不应抛
        finally:
            for s in (left, right):
                try:
                    s.close()
                except OSError:
                    pass


class TestOpenUpstreamBehaviour(unittest.IsolatedAsyncioTestCase):
    """实际跑一次 _open_upstream，验证能建出可用的连接。"""

    async def test_non_tls_upstream(self):
        """非 TLS 上游：起一个假服务器，确认能连上并收发。"""

        async def handler(reader, writer):
            writer.write(b"hello")
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(handler, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            proxy = LocalProxy(port=0)
            proxy.upstream = Upstream(host="127.0.0.1", port=port, tls=False)
            reader, writer = await proxy._open_upstream()
            data = await asyncio.wait_for(reader.readexactly(5), timeout=5)
            self.assertEqual(data, b"hello")
            writer.close()
        finally:
            server.close()
            await server.wait_closed()

    async def test_no_upstream_raises(self):
        proxy = LocalProxy(port=0)
        proxy.upstream = None
        with self.assertRaises(ConnectionError):
            await proxy._open_upstream()

    async def test_refused_port_raises_oserror(self):
        """连不上时必须是 OSError，这样上层 fail-open 才认。"""
        proxy = LocalProxy(port=0)
        # 端口 1 基本不会有人监听
        proxy.upstream = Upstream(host="127.0.0.1", port=1, tls=False)
        with self.assertRaises((OSError, ConnectionError)):
            await asyncio.wait_for(proxy._open_upstream(), timeout=20)


if __name__ == "__main__":
    unittest.main(verbosity=2)
