"""Subscription parsing for the in-app browser's VPN (browser only).

Turns what a user pastes -- a subscription URL's body, or the links
themselves -- into a list of mihomo proxy dicts.  Supported inputs:

* Clash / Mihomo YAML with a top-level ``proxies:`` list
* base64 (standard or url-safe) lists of share links
* plain share links, one per line:
  vmess://  vless://  trojan://  ss://  hysteria2:// hy2://  tuic://

Pure standard library.  PyYAML is used when it is installed (the packaged
App bundles it); otherwise a small reader for the YAML subset that
subscriptions use takes over, so CI on Linux needs nothing extra.

Every failure raises SubscriptionError with a message meant for the user,
in Chinese.  Nothing here touches the network except fetch_subscription.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

# Proxy types the bundled mihomo core can dial.  Anything else in a Clash
# file is skipped instead of making the whole core refuse to start.
SUPPORTED_TYPES = {
    "ss", "ssr", "vmess", "vless", "trojan", "hysteria", "hysteria2", "tuic",
    "wireguard", "http", "socks5", "snell", "anytls",
}
LINK_SCHEMES = ("vmess", "vless", "trojan", "ss", "hysteria2", "hy2", "tuic")
MAX_BODY = 8 * 1024 * 1024
FETCH_TIMEOUT = 20
USER_AGENT = "clash.meta mihomo/1.19 SuperPinkie"


class SubscriptionError(ValueError):
    """A problem the user can act on; str(error) is shown as-is."""


# ── fetching ────────────────────────────────────────────────────────────

def looks_like_url(text: str) -> bool:
    return bool(re.match(r"^https?://", (text or "").strip(), re.I))


def fetch_subscription(url: str, timeout: float = FETCH_TIMEOUT, opener=None) -> Tuple[str, Dict[str, str]]:
    """Download a subscription body.  Returns (text, interesting headers)."""
    url = (url or "").strip()
    parts = urllib.parse.urlsplit(url)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        raise SubscriptionError("订阅链接要以 http:// 或 https:// 开头，请到机场后台重新复制完整链接。")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    open_url = opener or urllib.request.urlopen
    try:
        with open_url(request, timeout=timeout) as response:
            body = response.read(MAX_BODY + 1)
            headers = {k.lower(): v for k, v in response.headers.items()} if getattr(response, "headers", None) else {}
    except urllib.error.HTTPError as error:
        code = error.code
        if code in (401, 403):
            raise SubscriptionError(f"订阅服务器拒绝了请求（HTTP {code}）：链接可能已失效、被重置，或者需要重新登录机场后台复制。") from None
        if code == 404:
            raise SubscriptionError("订阅链接不存在（HTTP 404），请到机场后台重新复制。") from None
        if code == 429:
            raise SubscriptionError("订阅服务器说请求太频繁（HTTP 429），过几分钟再刷新。") from None
        raise SubscriptionError(f"订阅服务器出错了（HTTP {code}），稍后再试。") from None
    except urllib.error.URLError as error:
        reason = getattr(error, "reason", error)
        raise SubscriptionError(f"连不上订阅服务器：{reason}。请检查网络，或换一个订阅链接。") from None
    except (TimeoutError, OSError) as error:
        raise SubscriptionError(f"下载订阅超时或网络中断（{error}）。请检查网络后再刷新。") from None
    if len(body) > MAX_BODY:
        raise SubscriptionError("订阅内容超过 8 MB，不像正常的订阅，已停止下载。")
    keep = {k: headers[k] for k in ("subscription-userinfo", "content-disposition", "profile-title") if k in headers}
    return decode_body(body), keep


def decode_body(body: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            return body.decode(encoding)
        except UnicodeDecodeError:
            continue
    return body.decode("latin-1")


def subscription_title(headers: Dict[str, str], url: str) -> str:
    """A short display name: profile-title header, file name, or host."""
    title = headers.get("profile-title", "")
    if title.startswith("base64:"):
        try:
            title = base64.b64decode(title[7:]).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            title = ""
    if not title:
        match = re.search(r"filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)", headers.get("content-disposition", ""), re.I)
        if match:
            title = urllib.parse.unquote(match.group(1) or match.group(2) or "")
    if not title:
        title = urllib.parse.urlsplit(url).hostname or "订阅"
    return title.strip()[:60]


def parse_userinfo(value: str) -> Dict[str, int]:
    """subscription-userinfo: upload=1; download=2; total=3; expire=4"""
    info = {}
    for part in (value or "").split(";"):
        key, _, number = part.strip().partition("=")
        if key in ("upload", "download", "total", "expire") and number.strip().isdigit():
            info[key] = int(number.strip())
    return info


# ── top-level parse ─────────────────────────────────────────────────────

def parse_subscription(text: str) -> List[Dict[str, Any]]:
    """Parse a subscription body into unique-named mihomo proxy dicts."""
    text = (text or "").strip().lstrip("﻿")
    if not text:
        raise SubscriptionError("订阅内容是空的：链接可能已过期，或者机场暂时没有返回节点。")
    lowered = text[:2000].lower()
    if lowered.startswith("<!doctype") or lowered.startswith("<html") or "<body" in lowered:
        raise SubscriptionError("这个链接返回的是网页，不是订阅。请复制机场后台里「订阅链接 / Clash 订阅」那一项。")

    proxies: List[Dict[str, Any]] = []
    if re.search(r"^proxies\s*:", text, re.M):
        proxies = parse_clash_yaml(text)
    else:
        decoded = maybe_base64(text)
        source = decoded if decoded is not None else text
        if decoded is not None and re.search(r"^proxies\s*:", decoded, re.M):
            proxies = parse_clash_yaml(decoded)
        else:
            proxies = parse_links(source)
            if not proxies and not any(f"{s}://" in source for s in LINK_SCHEMES):
                raise SubscriptionError("看不懂这个订阅的格式：既不是 Clash/Mihomo 配置，也不是 vmess/vless/trojan/ss/hysteria2 链接列表。")
    if not proxies:
        raise SubscriptionError("订阅里没有能用的节点：可能已经过期、流量用完，或者全是这个版本不支持的协议。")
    return unique_names(proxies)


def maybe_base64(text: str) -> Optional[str]:
    compact = re.sub(r"\s+", "", text)
    if not compact or "://" in compact[:20] or not re.fullmatch(r"[A-Za-z0-9+/=_-]+", compact):
        return None
    decoded = b64decode_loose(compact)
    if decoded is None:
        return None
    try:
        result = decoded.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return result if ("://" in result or "proxies" in result) else None


def b64decode_loose(value: str) -> Optional[bytes]:
    value = value.strip().replace("-", "+").replace("_", "/")
    value += "=" * (-len(value) % 4)
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return None


def b64text(value: str) -> Optional[str]:
    raw = b64decode_loose(urllib.parse.unquote(value))
    if raw is None:
        return None
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return None


def unique_names(proxies: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Dict[str, int] = {}
    result = []
    for proxy in proxies:
        base = str(proxy.get("name") or f"{proxy.get('server')}:{proxy.get('port')}").strip() or "节点"
        name = base
        while name in seen:
            seen[base] += 1
            name = f"{base} {seen[base]}"
        seen.setdefault(name, 1)
        proxy["name"] = name
        result.append(proxy)
    return result


def valid_proxy(proxy: Any) -> bool:
    if not isinstance(proxy, dict):
        return False
    if str(proxy.get("type", "")).lower() not in SUPPORTED_TYPES:
        return False
    if not proxy.get("server") and proxy.get("type") != "wireguard":
        return False
    try:
        port = int(proxy.get("port", 0))
    except (TypeError, ValueError):
        return False
    return 0 < port < 65536 or proxy.get("type") == "wireguard"


# ── Clash YAML ──────────────────────────────────────────────────────────

def parse_clash_yaml(text: str) -> List[Dict[str, Any]]:
    data = None
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(text)
    except ImportError:
        data = None
    except Exception:  # noqa: BLE001 - fall back to the subset reader
        data = None
    if not isinstance(data, dict):
        try:
            data = {"proxies": MiniYaml(proxies_section(text)).parse_document().get("proxies")}
        except (ValueError, IndexError, AttributeError) as error:
            raise SubscriptionError(f"Clash 订阅的格式有错，读不出节点（{error}）。") from None
    proxies = data.get("proxies") if isinstance(data, dict) else None
    if not isinstance(proxies, list):
        raise SubscriptionError("Clash 订阅里没有 proxies 节点列表。")
    result = []
    for item in proxies:
        if valid_proxy(item):
            proxy = dict(item)
            proxy["type"] = str(proxy["type"]).lower()
            proxy["port"] = int(proxy["port"]) if str(proxy.get("port", "")).isdigit() else proxy.get("port")
            result.append(proxy)
    return result


def proxies_section(text: str) -> str:
    """Only the top-level `proxies:` block; the rest of the file is ignored."""
    lines = text.splitlines()
    out: List[str] = []
    inside = False
    for line in lines:
        if not inside:
            if re.match(r"^proxies\s*:", line):
                inside = True
                out.append(line)
            continue
        if line and not line[0].isspace() and not line.startswith("-") and not line.startswith("#"):
            break
        out.append(line)
    return "\n".join(out)


class MiniYaml:
    """Reader for the YAML subset found in subscriptions.

    Handles block mappings and sequences, flow `{}`/`[]`, quoted and plain
    scalars and comments.  Anchors, tags and block scalars are not needed by
    `proxies:` lists and are not supported.
    """

    def __init__(self, text: str):
        self.lines: List[Tuple[int, str]] = []
        for raw in text.splitlines():
            stripped = strip_comment(raw).rstrip()
            if stripped.strip():
                self.lines.append((len(stripped) - len(stripped.lstrip(" ")), stripped.strip()))
        self.index = 0

    def parse_document(self) -> Dict[str, Any]:
        if not self.lines:
            return {}
        value = self.block(self.lines[0][0])
        if not isinstance(value, dict):
            raise ValueError("顶层不是映射")
        return value

    def block(self, indent: int) -> Any:
        _, text = self.lines[self.index]
        if text.startswith("- ") or text == "-":
            return self.sequence(indent)
        return self.mapping(indent)

    def sequence(self, indent: int) -> List[Any]:
        items = []
        while self.index < len(self.lines):
            current, text = self.lines[self.index]
            if current != indent or not (text.startswith("- ") or text == "-"):
                break
            rest = text[1:].strip()
            self.index += 1
            if not rest:
                items.append(self.block(self.lines[self.index][0]) if self.index < len(self.lines) and self.lines[self.index][0] > indent else None)
                continue
            key, value = split_key(rest)
            if key is not None and not rest.startswith(("{", "[", "'", '"')):
                # "- key: value" starts an inline mapping whose other keys sit
                # at the column after "- ".
                child_indent = indent + (len(text) - len(text[1:].lstrip()))
                mapping: Dict[str, Any] = {}
                self.assign(mapping, key, value, child_indent)
                if self.index < len(self.lines) and self.lines[self.index][0] == child_indent and not self.lines[self.index][1].startswith("- "):
                    mapping.update(self.mapping(child_indent))
                items.append(mapping)
            else:
                items.append(flow_value(rest))
        return items

    def mapping(self, indent: int) -> Dict[str, Any]:
        result: Dict[str, Any] = {}
        while self.index < len(self.lines):
            current, text = self.lines[self.index]
            if current < indent:
                break
            if current > indent:
                raise ValueError(f"缩进不对：{text[:40]}")
            if text.startswith("- "):
                break
            key, value = split_key(text)
            if key is None:
                raise ValueError(f"无法识别的行：{text[:40]}")
            self.index += 1
            self.assign(result, key, value, indent)
        return result

    def assign(self, target: Dict[str, Any], key: str, value: str, indent: int) -> None:
        if value:
            target[key] = flow_value(value)
            return
        if self.index < len(self.lines):
            nxt_indent, nxt_text = self.lines[self.index]
            if nxt_indent > indent or (nxt_indent == indent and nxt_text.startswith("- ")):
                target[key] = self.block(nxt_indent)
                return
        target[key] = None


def strip_comment(line: str) -> str:
    quote = None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            return line[:i]
    return line


def split_key(text: str) -> Tuple[Optional[str], str]:
    """Split `key: value`, honouring quoted keys.  (None, text) if no key."""
    if text[:1] in "'\"":
        quote = text[0]
        end = text.find(quote, 1)
        if end > 0 and text[end + 1:end + 2] == ":":
            return text[1:end], text[end + 2:].strip()
        return None, text
    if text[:1] in "{[":
        return None, text
    match = re.match(r"^([^:]+?):(?:\s+|$)(.*)$", text)
    if not match:
        return None, text
    return match.group(1).strip(), match.group(2).strip()


def flow_value(text: str) -> Any:
    parser = FlowParser(text)
    value = parser.value()
    parser.skip_space()
    if parser.pos != len(parser.text):
        # Plain scalars may contain characters like `{` in the middle.
        return scalar(text)
    return value


class FlowParser:
    def __init__(self, text: str):
        self.text = text
        self.pos = 0

    def skip_space(self) -> None:
        while self.pos < len(self.text) and self.text[self.pos] in " \t":
            self.pos += 1

    def value(self, stop: str = "") -> Any:
        self.skip_space()
        if self.pos >= len(self.text):
            return None
        ch = self.text[self.pos]
        if ch == "{":
            return self.mapping()
        if ch == "[":
            return self.sequence()
        if ch in "'\"":
            return self.quoted()
        start = self.pos
        while self.pos < len(self.text) and (not stop or self.text[self.pos] not in stop):
            if stop and self.text[self.pos] == ":" and ":" in stop and self.text[self.pos + 1:self.pos + 2] in (" ", "", ",", "}"):
                break
            self.pos += 1
        return scalar(self.text[start:self.pos].strip())

    def quoted(self) -> str:
        quote = self.text[self.pos]
        self.pos += 1
        out = []
        while self.pos < len(self.text):
            ch = self.text[self.pos]
            if quote == "'" and ch == "'" and self.text[self.pos + 1:self.pos + 2] == "'":
                out.append("'")
                self.pos += 2
                continue
            if quote == '"' and ch == "\\" and self.pos + 1 < len(self.text):
                nxt = self.text[self.pos + 1]
                out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\", "/": "/"}.get(nxt, "\\" + nxt))
                self.pos += 2
                continue
            if ch == quote:
                self.pos += 1
                return "".join(out)
            out.append(ch)
            self.pos += 1
        raise ValueError("引号没有闭合")

    def mapping(self) -> Dict[str, Any]:
        self.pos += 1
        result: Dict[str, Any] = {}
        while True:
            self.skip_space()
            if self.pos >= len(self.text):
                raise ValueError("花括号没有闭合")
            if self.text[self.pos] == "}":
                self.pos += 1
                return result
            key = self.value(stop=":,}")
            self.skip_space()
            value = None
            if self.pos < len(self.text) and self.text[self.pos] == ":":
                self.pos += 1
                value = self.value(stop=",}")
            result[str(key)] = value
            self.skip_space()
            if self.pos < len(self.text) and self.text[self.pos] == ",":
                self.pos += 1

    def sequence(self) -> List[Any]:
        self.pos += 1
        result: List[Any] = []
        while True:
            self.skip_space()
            if self.pos >= len(self.text):
                raise ValueError("方括号没有闭合")
            if self.text[self.pos] == "]":
                self.pos += 1
                return result
            result.append(self.value(stop=",]"))
            self.skip_space()
            if self.pos < len(self.text) and self.text[self.pos] == ",":
                self.pos += 1


def scalar(text: str) -> Any:
    if text in ("", "~", "null", "Null", "NULL"):
        return None if text != "" else ""
    if text in ("true", "True", "TRUE"):
        return True
    if text in ("false", "False", "FALSE"):
        return False
    if re.fullmatch(r"[-+]?\d+", text) and not (len(text.lstrip("+-")) > 1 and text.lstrip("+-").startswith("0")):
        return int(text)
    if re.fullmatch(r"[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?", text):
        return float(text)
    return text


# ── share links ─────────────────────────────────────────────────────────

def parse_links(text: str) -> List[Dict[str, Any]]:
    result = []
    for line in text.splitlines():
        line = line.strip()
        if not line or "://" not in line:
            continue
        scheme = line.split("://", 1)[0].lower()
        parser = LINK_PARSERS.get(scheme)
        if not parser:
            continue
        try:
            proxy = parser(line)
        except (ValueError, KeyError, TypeError, IndexError, UnicodeError):
            proxy = None
        if proxy and valid_proxy(proxy):
            result.append(proxy)
    return result


def parse_link(link: str) -> Dict[str, Any]:
    """Parse one share link, raising SubscriptionError when it is unusable."""
    scheme = link.split("://", 1)[0].lower() if "://" in link else ""
    parser = LINK_PARSERS.get(scheme)
    if not parser:
        raise SubscriptionError(f"不支持 {scheme or '这种'} 链接，只支持 vmess / vless / trojan / ss / hysteria2 / tuic。")
    try:
        proxy = parser(link.strip())
    except (ValueError, KeyError, TypeError, IndexError, UnicodeError):
        proxy = None
    if not proxy or not valid_proxy(proxy):
        raise SubscriptionError(f"这条 {scheme} 链接不完整或格式有误，请重新复制。")
    return proxy


def _fragment_name(url: urllib.parse.SplitResult) -> str:
    return urllib.parse.unquote(url.fragment or "").strip()


def _query(url: urllib.parse.SplitResult) -> Dict[str, str]:
    return {k: v[-1] for k, v in urllib.parse.parse_qs(url.query, keep_blank_values=True).items()}


def _truthy(value: Any) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _host_port(url: urllib.parse.SplitResult) -> Tuple[str, int]:
    host = url.hostname
    port = url.port
    if not host or not port:
        raise ValueError("missing host or port")
    return host, port


def _apply_transport(proxy: Dict[str, Any], network: str, host: str, path: str, service: str, header_type: str = "") -> None:
    network = (network or "tcp").lower()
    if network in ("ws", "websocket"):
        proxy["network"] = "ws"
        opts: Dict[str, Any] = {"path": path or "/"}
        if host:
            opts["headers"] = {"Host": host}
        proxy["ws-opts"] = opts
    elif network == "grpc":
        proxy["network"] = "grpc"
        proxy["grpc-opts"] = {"grpc-service-name": service or path or ""}
    elif network in ("h2", "http") and network == "h2":
        proxy["network"] = "h2"
        proxy["h2-opts"] = {"path": path or "/", **({"host": [host]} if host else {})}
    elif network == "httpupgrade":
        proxy["network"] = "ws"
        proxy["ws-opts"] = {"path": path or "/", "v2ray-http-upgrade": True, **({"headers": {"Host": host}} if host else {})}
    elif network == "tcp" and header_type == "http":
        proxy["network"] = "http"
        proxy["http-opts"] = {"path": [path or "/"], **({"headers": {"Host": [host]}} if host else {})}


def parse_vmess(link: str) -> Optional[Dict[str, Any]]:
    body = link.split("://", 1)[1]
    decoded = b64text(body.split("#", 1)[0])
    if decoded and decoded.strip().startswith("{"):
        data = json.loads(decoded)
        port = int(str(data.get("port", "0")).strip() or 0)
        proxy: Dict[str, Any] = {
            "name": str(data.get("ps") or "").strip() or f"{data.get('add')}:{port}",
            "type": "vmess",
            "server": str(data.get("add", "")).strip(),
            "port": port,
            "uuid": str(data.get("id", "")).strip(),
            "alterId": int(str(data.get("aid", 0) or 0)),
            "cipher": str(data.get("scy") or "auto"),
            "udp": True,
        }
        tls = str(data.get("tls", "")).lower()
        if tls in ("tls", "reality", "1", "true"):
            proxy["tls"] = True
            sni = data.get("sni") or data.get("host")
            if sni:
                proxy["servername"] = str(sni)
            if data.get("alpn"):
                proxy["alpn"] = [a for a in str(data["alpn"]).split(",") if a]
            if data.get("fp"):
                proxy["client-fingerprint"] = str(data["fp"])
            if _truthy(data.get("allowInsecure", data.get("insecure", ""))):
                proxy["skip-cert-verify"] = True
        _apply_transport(proxy, str(data.get("net", "tcp")), str(data.get("host", "") or ""),
                         str(data.get("path", "") or ""), str(data.get("path", "") or ""), str(data.get("type", "") or ""))
        return proxy if proxy["uuid"] else None
    # vmess://uuid@host:port?... (newer "standard" form)
    url = urllib.parse.urlsplit(link)
    host, port = _host_port(url)
    q = _query(url)
    proxy = {"name": _fragment_name(url) or f"{host}:{port}", "type": "vmess", "server": host, "port": port,
             "uuid": urllib.parse.unquote(url.username or ""), "alterId": int(q.get("alterId", q.get("aid", "0")) or 0),
             "cipher": q.get("encryption") or "auto", "udp": True}
    _tls_from_query(proxy, q, host)
    _apply_transport(proxy, q.get("type", "tcp"), q.get("host", ""), q.get("path", ""), q.get("serviceName", ""), q.get("headerType", ""))
    return proxy if proxy["uuid"] else None


def _tls_from_query(proxy: Dict[str, Any], q: Dict[str, str], host: str, key: str = "servername") -> None:
    security = q.get("security", "").lower()
    if security in ("tls", "reality", "xtls"):
        proxy["tls"] = True
        sni = q.get("sni") or q.get("peer") or q.get("host")
        if sni:
            proxy[key] = sni
        if q.get("alpn"):
            proxy["alpn"] = [a for a in q["alpn"].split(",") if a]
        if q.get("fp"):
            proxy["client-fingerprint"] = q["fp"]
        if _truthy(q.get("allowInsecure", q.get("insecure", ""))):
            proxy["skip-cert-verify"] = True
        if security == "reality":
            opts = {"public-key": q.get("pbk", "")}
            if q.get("sid"):
                opts["short-id"] = q["sid"]
            proxy["reality-opts"] = opts
            proxy.setdefault("client-fingerprint", "chrome")


def parse_vless(link: str) -> Optional[Dict[str, Any]]:
    url = urllib.parse.urlsplit(link)
    host, port = _host_port(url)
    q = _query(url)
    proxy: Dict[str, Any] = {"name": _fragment_name(url) or f"{host}:{port}", "type": "vless", "server": host, "port": port,
                             "uuid": urllib.parse.unquote(url.username or ""), "udp": True}
    if q.get("flow"):
        proxy["flow"] = q["flow"]
    _tls_from_query(proxy, q, host)
    _apply_transport(proxy, q.get("type", "tcp"), q.get("host", ""), q.get("path", ""), q.get("serviceName", ""), q.get("headerType", ""))
    return proxy if proxy["uuid"] else None


def parse_trojan(link: str) -> Optional[Dict[str, Any]]:
    url = urllib.parse.urlsplit(link)
    host, port = _host_port(url)
    q = _query(url)
    proxy: Dict[str, Any] = {"name": _fragment_name(url) or f"{host}:{port}", "type": "trojan", "server": host, "port": port,
                             "password": urllib.parse.unquote(url.username or ""), "udp": True}
    sni = q.get("sni") or q.get("peer")
    if sni:
        proxy["sni"] = sni
    if q.get("alpn"):
        proxy["alpn"] = [a for a in q["alpn"].split(",") if a]
    if q.get("fp"):
        proxy["client-fingerprint"] = q["fp"]
    if _truthy(q.get("allowInsecure", q.get("insecure", ""))):
        proxy["skip-cert-verify"] = True
    if q.get("security", "").lower() == "reality":
        proxy["reality-opts"] = {"public-key": q.get("pbk", ""), **({"short-id": q["sid"]} if q.get("sid") else {})}
        proxy.setdefault("client-fingerprint", "chrome")
    _apply_transport(proxy, q.get("type", "tcp"), q.get("host", ""), q.get("path", ""), q.get("serviceName", ""), q.get("headerType", ""))
    return proxy if proxy["password"] else None


def parse_ss(link: str) -> Optional[Dict[str, Any]]:
    body = link.split("://", 1)[1]
    body, _, fragment = body.partition("#")
    name = urllib.parse.unquote(fragment).strip()
    body, _, query = body.partition("?")
    body = body.rstrip("/")
    if "@" in body:
        userinfo, _, hostport = body.rpartition("@")
        userinfo = urllib.parse.unquote(userinfo)
        decoded = b64text(userinfo) if ":" not in userinfo else None
        method, _, password = (decoded or userinfo).partition(":")
    else:
        decoded = b64text(body)
        if not decoded or "@" not in decoded:
            return None
        cred, _, hostport = decoded.rpartition("@")
        method, _, password = cred.partition(":")
    url = urllib.parse.urlsplit("ss://" + hostport)
    host, port = _host_port(url)
    if not method or not password:
        return None
    proxy: Dict[str, Any] = {"name": name or f"{host}:{port}", "type": "ss", "server": host, "port": port,
                             "cipher": method.lower(), "password": password, "udp": True}
    plugin = urllib.parse.parse_qs(query).get("plugin", [""])[-1]
    if plugin:
        parts = urllib.parse.unquote(plugin).split(";")
        kind = parts[0]
        opts = dict(p.split("=", 1) if "=" in p else (p, "true") for p in parts[1:])
        if kind in ("obfs-local", "simple-obfs"):
            proxy["plugin"] = "obfs"
            proxy["plugin-opts"] = {"mode": opts.get("obfs", "http"), **({"host": opts["obfs-host"]} if "obfs-host" in opts else {})}
        elif kind == "v2ray-plugin":
            proxy["plugin"] = "v2ray-plugin"
            proxy["plugin-opts"] = {"mode": opts.get("mode", "websocket"), "tls": "tls" in opts,
                                    **({"host": opts["host"]} if "host" in opts else {}), **({"path": opts["path"]} if "path" in opts else {})}
    return proxy


def parse_hysteria2(link: str) -> Optional[Dict[str, Any]]:
    url = urllib.parse.urlsplit(link)
    q = _query(url)
    host = url.hostname
    # hy2 allows "port hopping" like host:443,5000-6000; take the first port.
    netloc_port = url.netloc.rsplit("@", 1)[-1].rsplit(":", 1)
    try:
        port = url.port
    except ValueError:
        port = None
    if port is None and len(netloc_port) == 2:
        first = re.match(r"\d+", netloc_port[1])
        port = int(first.group(0)) if first else None
    if not host or not port:
        return None
    password = urllib.parse.unquote(url.username or "")
    if url.password:
        password = f"{password}:{urllib.parse.unquote(url.password)}"
    proxy: Dict[str, Any] = {"name": _fragment_name(url) or f"{host}:{port}", "type": "hysteria2", "server": host,
                             "port": port, "password": password, "udp": True}
    if q.get("sni"):
        proxy["sni"] = q["sni"]
    if _truthy(q.get("insecure", q.get("allowInsecure", ""))):
        proxy["skip-cert-verify"] = True
    if q.get("obfs"):
        proxy["obfs"] = q["obfs"]
        if q.get("obfs-password"):
            proxy["obfs-password"] = q["obfs-password"]
    if q.get("alpn"):
        proxy["alpn"] = [a for a in q["alpn"].split(",") if a]
    if q.get("pinSHA256"):
        proxy["fingerprint"] = q["pinSHA256"]
    return proxy if password else None


def parse_tuic(link: str) -> Optional[Dict[str, Any]]:
    url = urllib.parse.urlsplit(link)
    host, port = _host_port(url)
    q = _query(url)
    proxy: Dict[str, Any] = {"name": _fragment_name(url) or f"{host}:{port}", "type": "tuic", "server": host, "port": port,
                             "uuid": urllib.parse.unquote(url.username or ""), "password": urllib.parse.unquote(url.password or ""),
                             "udp": True}
    if q.get("sni"):
        proxy["sni"] = q["sni"]
    if q.get("congestion_control"):
        proxy["congestion-controller"] = q["congestion_control"]
    if q.get("alpn"):
        proxy["alpn"] = [a for a in q["alpn"].split(",") if a]
    if q.get("udp_relay_mode"):
        proxy["udp-relay-mode"] = q["udp_relay_mode"]
    if _truthy(q.get("allow_insecure", q.get("insecure", ""))):
        proxy["skip-cert-verify"] = True
    return proxy if proxy["uuid"] else None


LINK_PARSERS = {
    "vmess": parse_vmess,
    "vless": parse_vless,
    "trojan": parse_trojan,
    "ss": parse_ss,
    "hysteria2": parse_hysteria2,
    "hy2": parse_hysteria2,
    "tuic": parse_tuic,
}


def describe(proxy: Dict[str, Any]) -> Dict[str, Any]:
    """What the UI shows for a node; never includes passwords or UUIDs."""
    return {"name": proxy.get("name"), "type": proxy.get("type"), "server": proxy.get("server"), "port": proxy.get("port")}
