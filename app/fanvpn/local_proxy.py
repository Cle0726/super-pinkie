"""可运行时切换上游节点的本地代理。

为什么需要它：
    WebView2 的 --proxy-server 只能在环境创建时确定，改一次要重建整个
    WebView2 环境（页面全部重载、登录态丢失）。把 WebView2 固定指向本机
    环回端口，切换节点只改这里的 self.upstream —— 页面完全无感知。

支持：
    * CONNECT 方法（HTTPS/TLS 隧道）
    * 普通 HTTP 绝对 URI 转发
    * 智能分流：命中 bypass 列表的直连，其余走上游
    * 上游失败自动回退直连（fail-open，避免整机断网）

用法：
    p = LocalProxy(port=10809)
    await p.start()
    p.set_upstream("fan.365747.xyz", 443)
    p.set_mode("smart")       # 或 "global"
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import ssl
from dataclasses import dataclass
from typing import Iterable, Optional

LOG = logging.getLogger("local_proxy")

BUFFER = 64 * 1024

# 上游节点连接超时。取值要短：节点挂了必须快速 fail-open 回直连，
# 让用户感觉“慢一下”而不是“整个浏览器卡死十几秒”。
UPSTREAM_CONNECT_TIMEOUT = 6.0

# 与扩展 v1.6.3 的 CN_BYPASS_LIST 等价的可执行子集。
# Chrome 的 bypassList 支持 "<local>" 与 CIDR；这里把它们实现成真实判断。
DEFAULT_BYPASS = (
    ".cn", ".gov.cn", ".edu.cn", ".org.cn", ".com.cn", ".net.cn",
    ".baidu.com", ".sogou.com", ".so.com", ".360.cn",
    ".sina.com.cn", ".sohu.com", ".163.com", ".126.com", ".qq.com",
    ".taobao.com", ".tmall.com", ".alipay.com", ".aliyun.com",
    ".jd.com", ".jdcloud.com", ".alicdn.com",
    ".pinduoduo.com", ".yangkeduo.com",
    ".suning.com", ".meituan.com", ".dianping.com",
    ".ele.me", ".koubei.com",
    ".weixin.qq.com", ".wechat.com", ".weibo.com", ".weibo.cn",
    ".zhihu.com", ".zhihu.cn", ".douban.com",
    ".xiaohongshu.com", ".xhslink.com",
    ".bilibili.com", ".bilivideo.com", ".hdslb.com",
    ".iqiyi.com", ".qiyi.com", ".iqiyipic.com",
    ".youku.com", ".ykimg.com",
    ".douyin.com", ".bytedance.com", ".toutiao.com",
    ".kuaishou.com", ".kwimgs.com",
    ".huya.com", ".douyu.com",
    ".qqmusic.com", ".kugou.com", ".kuwo.cn",
    ".ctrip.com", ".elong.com", ".qunar.com", ".tuniu.com",
    ".fliggy.com", ".feizhu.com",
    ".amap.com", ".autonavi.com", ".bdimg.com",
    ".12306.cn", ".sf-express.com", ".kuaidi100.com",
    ".huawei.com", ".huaweicloud.com", ".hicloud.com",
    ".xiaomi.com", ".mi.com", ".miui.com",
    ".oppo.com", ".vivo.com", ".lenovo.com",
    ".csdn.net", ".cnblogs.com", ".jianshu.com",
    ".juejin.cn", ".gitee.com", ".oschina.net",
    ".aliyuncs.com", ".tencent-cloud.net", ".myqcloud.com",
    ".qcloudcdn.com", ".qpic.cn",
    ".thepaper.cn", ".cctv.com", ".cnn.com.cn",
    ".smzdm.com", ".hupu.com", ".acfun.cn",
    ".tencent.com", ".alibaba.com", ".taobaocdn.com",
    ".aliyuncdn.com", ".aliyun-inc.com",
)

PRIVATE_NETS = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
)


def should_bypass(host: str, bypass: Iterable[str] = DEFAULT_BYPASS) -> bool:
    """判断某主机是否应直连（等价 Chrome bypassList 语义）。

    规则：
      * 无点的裸主机名（intranet）→ 直连，等价 "<local>"
      * 私有/环回地址 → 直连
      * ".example.com" 匹配 example.com 及其所有子域
    """
    name = (host or "").strip().lower().rstrip(".")
    if not name:
        return True

    try:
        addr = ipaddress.ip_address(name)
        return any(addr in net for net in PRIVATE_NETS)
    except ValueError:
        pass

    if "." not in name:
        return True  # <local>

    for rule in bypass:
        rule = rule.strip().lower()
        if not rule or rule == "<local>":
            continue
        if rule.startswith("."):
            # ".qq.com" -> 匹配 qq.com 与 *.qq.com
            if name == rule[1:] or name.endswith(rule):
                return True
        elif name == rule:
            return True
    return False


@dataclass
class Upstream:
    host: str
    port: int
    # FanVPN 下发的节点是 HTTPS 代理：必须先和代理做 TLS 握手，
    # 再在 TLS 通道里发 CONNECT。明文 CONNECT 会被直接拒。
    tls: bool = True

    @property
    def label(self) -> str:
        scheme = "https" if self.tls else "http"
        return f"{scheme}://{self.host}:{self.port}"


class LocalProxy:
    """单端口、可热切换上游的 HTTP 代理。"""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 10809,
        upstream: Optional[Upstream] = None,
        mode: str = "smart",
        bypass: Iterable[str] = DEFAULT_BYPASS,
        fail_open: bool = True,
    ):
        self.host = host
        self.port = port
        self.upstream = upstream
        self.mode = mode  # "smart" | "global"
        self.bypass = tuple(bypass)
        self.fail_open = fail_open

        self._server: Optional[asyncio.AbstractServer] = None
        self._connections = 0
        self._stats = {"direct": 0, "proxied": 0, "failed": 0}

    # ── 生命周期 ────────────────────────────────────────────────
    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, self.host, self.port)
        bound = self._server.sockets[0].getsockname()
        self.port = bound[1]
        LOG.info("local proxy listening on %s:%s", bound[0], bound[1])

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    # ── 热切换：这些方法就是“用户选节点”的入口 ──────────────────
    def set_upstream(self, host: str, port: int, tls: Optional[bool] = None) -> None:
        """切换上游节点。无需重启监听，已建立的隧道不受影响。

        这就是“用户自己选节点”的唯一入口：UI 点一下 -> 调这里 -> 立即生效。
        """
        if tls is None:
            tls = self.upstream.tls if self.upstream else True
        self.upstream = Upstream(host=host, port=int(port), tls=bool(tls))
        LOG.info("upstream -> %s", self.upstream.label)

    def clear_upstream(self) -> None:
        self.upstream = None
        LOG.info("upstream cleared (all direct)")

    def set_mode(self, mode: str) -> None:
        if mode not in ("smart", "global"):
            raise ValueError("mode 只能是 'smart' 或 'global'")
        self.mode = mode

    @property
    def stats(self) -> dict:
        return dict(self._stats, connections=self._connections, mode=self.mode,
                    upstream=self.upstream.label if self.upstream else None)

    # ── 决策 ────────────────────────────────────────────────────
    def _route(self, host: str) -> str:
        """返回 'direct' 或 'proxy'。"""
        if self.upstream is None:
            return "direct"
        if self.mode == "global":
            return "proxy"
        return "direct" if should_bypass(host, self.bypass) else "proxy"

    # ── 连接处理 ────────────────────────────────────────────────
    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._connections += 1
        try:
            head = await self._read_head(reader)
            if head is None:
                return
            first_line, headers, rest = head
            parts = first_line.split()
            if len(parts) < 3:
                return

            method, target, version = parts[0].upper(), parts[1], parts[2]

            if method == "CONNECT":
                await self._do_connect(target, writer, reader, rest)
            else:
                await self._do_http(method, target, version, headers, rest, writer, reader)
        except (ConnectionResetError, BrokenPipeError, asyncio.IncompleteReadError):
            pass
        except (ssl.SSLError, ssl.CertificateError) as exc:
            # 上游 TLS 握手失败（节点挂了/被墙/证书坏）必须能回落到直连，
            # 不能被当成致命错误直接断开连接。
            LOG.debug("tls handshake failed: %s", exc)
        except (asyncio.TimeoutError, TimeoutError) as exc:
            LOG.debug("connection timed out: %s", exc)
        except OSError as exc:
            LOG.debug("connection error: %s", exc)
        except Exception as exc:  # 单个连接异常不影响服务
            LOG.debug("unexpected connection error: %r", exc)
        finally:
            self._connections -= 1
            try:
                writer.close()
            except Exception:
                pass

    @staticmethod
    async def _read_head(reader: asyncio.StreamReader):
        """读到 \\r\\n\\r\\n 为止，返回 (起始行, 不含起始行的其余头, 余下字节)。

        注意：返回的头**不包含**起始行。早期版本把起始行也一起返回，导致
        _do_http 拼出两行请求行，目标服务器直接回 400 Bad Request。
        """
        try:
            raw = await reader.readuntil(b"\r\n\r\n")
        except asyncio.IncompleteReadError:
            return None
        lines = raw[:-4].split(b"\r\n")
        if not lines or not lines[0]:
            return None
        first_line = lines[0].decode("latin-1")
        rest_headers = b"\r\n".join(lines[1:])
        return first_line, rest_headers, b""

    @staticmethod
    def _split_hostport(target: str, default_port: int) -> Optional[tuple]:
        host, _, port = target.rpartition(":")
        if not host:
            host, port = target, str(default_port)
        try:
            return host.strip("[]"), int(port)
        except ValueError:
            return None

    async def _open(self, host: str, port: int):
        return await asyncio.wait_for(asyncio.open_connection(host, port), timeout=10)

    async def _open_upstream(self):
        """连接上游代理，HTTPS 代理先做 TLS。

        三个关键约束，每一条都是真环境撞出来的：

        1. **不能把 SSLSocket 交给 asyncio。**
           Python 3.12 的 `_check_ssl_socket()` 会直接抛
           `TypeError: Socket cannot be of type SSLSocket`。
           3.9 没有这个检查，所以 macOS 上「本地测试通过」，
           真 Windows + 3.12 上所有连接 fail-open 退直连。
           正确做法：传**裸 socket** + `ssl=` 参数，让 asyncio 自己
           在非阻塞 fd 上做握手。

        2. 不用 `writer.start_tls()`：那是 3.11+ 才有的 API，
           目标机可能是 3.9/3.10。

        3. 只有**阻塞的 TCP 建连**丢进线程池。`socket.create_connection`
           是阻塞调用，写在协程里会把事件循环卡住整个超时时长 ——
           期间所有其他连接（含正在传输的隧道）全部冻结，
           在 Windows 上就是“浏览器假死”。而 TLS 握手不需要进线程池：
           交给 asyncio 后是基于非阻塞 fd 的，不会卡循环。
        """
        up = self.upstream
        if up is None:
            raise ConnectionError("no upstream configured")

        loop = asyncio.get_running_loop()
        try:
            raw = await asyncio.wait_for(
                loop.run_in_executor(None, self._connect_tcp_blocking, up),
                timeout=UPSTREAM_CONNECT_TIMEOUT + 4,
            )
        except asyncio.TimeoutError as exc:
            raise OSError("upstream connect timed out") from exc

        # create_connection 会留下超时设置，asyncio 要求非阻塞
        raw.setblocking(False)
        try:
            raw.settimeout(None)
        except OSError:
            pass

        if not up.tls:
            return await asyncio.open_connection(sock=raw)

        ctx = ssl.create_default_context()
        # 这些节点普遍用自签/通配证书，链路本身已由最外层 TLS 保护。
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        try:
            return await asyncio.wait_for(
                asyncio.open_connection(sock=raw, ssl=ctx, server_hostname=up.host),
                timeout=UPSTREAM_CONNECT_TIMEOUT,
            )
        except (ssl.SSLError, OSError) as exc:
            try:
                raw.close()
            except OSError:
                pass
            raise OSError(f"TLS handshake failed: {exc}") from exc

    @staticmethod
    def _connect_tcp_blocking(up: "Upstream"):
        """阻塞地建 TCP 连接，只在线程池里调用。**不做 TLS。**"""
        return socket.create_connection(
            (up.host, up.port), timeout=UPSTREAM_CONNECT_TIMEOUT
        )

    async def _tunnel(self, host: str, port: int, writer, reader, initial: bytes, target: str):
        """建立到目标（直连或经上游）的隧道并双向泵数据。"""
        route = self._route(host)
        up_reader = up_writer = None
        try:
            if route == "proxy" and self.upstream is not None:
                up_reader, up_writer = await self._open_upstream()
                req = f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode()
                up_writer.write(req)
                await up_writer.drain()
                status = await asyncio.wait_for(up_reader.readuntil(b"\r\n\r\n"), timeout=10)
                if b" 200 " not in status.split(b"\r\n")[0]:
                    raise ConnectionError(f"upstream refused: {status[:80]!r}")
                self._stats["proxied"] += 1
            else:
                up_reader, up_writer = await self._open(host, port)
                self._stats["direct"] += 1
        except Exception as exc:
            self._stats["failed"] += 1
            # 上游没接成，把写端关掉即可释放底层 socket。
            # StreamReader 本身没有 close()，只能关 StreamWriter。
            if up_writer is not None:
                try:
                    up_writer.close()
                except Exception:
                    pass
            up_reader = up_writer = None

            if not self.fail_open:
                writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                await writer.drain()
                return
            LOG.debug("upstream failed (%s), direct fallback", exc)
            try:
                up_reader, up_writer = await self._open(host, port)
                self._stats["direct"] += 1
            except Exception as direct_exc:
                # 直连也不行，才是真的没法访问，明说而不是干等
                LOG.debug("direct fallback also failed: %s", direct_exc)
                writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                await writer.drain()
                return

        writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        await writer.drain()
        await self._pump(reader, writer, up_reader, up_writer, initial)

    async def _do_connect(self, target: str, writer, reader, initial: bytes):
        parsed = self._split_hostport(target, 443)
        if not parsed:
            writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            await writer.drain()
            return
        await self._tunnel(parsed[0], parsed[1], writer, reader, initial, target)

    async def _do_http(self, method, target, version, headers, initial, writer, reader):
        # 绝对 URI 形式：GET http://host/path HTTP/1.1
        if not target.lower().startswith("http://"):
            writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            await writer.drain()
            return

        without_scheme = target[7:]
        slash = without_scheme.find("/")
        authority = without_scheme if slash < 0 else without_scheme[:slash]
        path = "/" if slash < 0 else without_scheme[slash:]

        parsed = self._split_hostport(authority, 80)
        if not parsed:
            writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            await writer.drain()
            return
        host, port = parsed

        route = self._route(host)
        up = self.upstream
        suffix = b"\r\n\r\n"
        header_block = (b"\r\n" + headers) if headers else b""

        out_reader = out_writer = None
        used_proxy = route == "proxy" and up is not None
        if used_proxy:
            # 经上游：把绝对 URI 原样发给上游代理
            try:
                out_reader, out_writer = await self._open_upstream()
                self._stats["proxied"] += 1
                out_writer.write(f"{method} {target} {version}".encode() + header_block + suffix)
                await out_writer.drain()
            except Exception as exc:
                # 明文 HTTP 同样需要 fail-open，否则节点一挂，
                # 所有 http:// 请求会直接断掉（Windows 上表现为页面空白）。
                self._stats["failed"] += 1
                if out_writer is not None:
                    try:
                        out_writer.close()
                    except Exception:
                        pass
                out_reader = out_writer = None
                if not self.fail_open:
                    writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                    await writer.drain()
                    return
                LOG.debug("upstream http failed (%s), direct fallback", exc)
                used_proxy = False

        if not used_proxy:
            # 直连：转成 origin-form 发往目标
            try:
                out_reader, out_writer = await self._open(host, port)
                self._stats["direct"] += 1
                out_writer.write(f"{method} {path} {version}".encode() + header_block + suffix)
                await out_writer.drain()
            except Exception as exc:
                LOG.debug("direct http failed: %s", exc)
                writer.write(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
                await writer.drain()
                return

        await self._pump(reader, writer, out_reader, out_writer, initial)

    @staticmethod
    async def _pump(c_reader, c_writer, s_reader, s_writer, initial: bytes):
        """双向泵；任一侧结束就收尾。"""
        if initial:
            s_writer.write(initial)
            await s_writer.drain()

        async def forward(src, dst):
            try:
                while True:
                    chunk = await src.read(BUFFER)
                    if not chunk:
                        break
                    dst.write(chunk)
                    await dst.drain()
            except Exception:
                pass
            finally:
                try:
                    if dst.can_write_eof():
                        dst.write_eof()
                except Exception:
                    pass

        tasks = [
            asyncio.create_task(forward(c_reader, s_writer)),
            asyncio.create_task(forward(s_reader, c_writer)),
        ]
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for w in (s_writer, c_writer):
                try:
                    w.close()
                except Exception:
                    pass
