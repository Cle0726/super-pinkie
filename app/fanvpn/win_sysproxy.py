"""Windows 系统代理接管层：把本地代理挂到「用户的浏览器」上。

设计目标
--------
WebView2 那套方案只覆盖自家窗口。真实用户要的是：打开 Chrome / Edge /
Firefox / 任何走 WinINET 的程序，默认就出去了。

Windows 上唯一能一次覆盖所有浏览器的位置是 **WinINET 的 Internet Settings**
（HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings）。
Chrome 和 Edge 默认跟随系统代理，Firefox 默认也是「使用系统代理设置」，
所以只要改这里 + 广播一次变更通知，全机浏览器立即生效。

两种挂法
--------
1. **PAC（推荐）**：写 ``AutoConfigURL`` 指向本地 ``/proxy.pac``。
   浏览器自己做域名判断，国内站点连本地代理都不经过 —— 少一跳，
   而且代理进程挂掉时浏览器自动回落直连，不会断网。
2. **全局代理**：写 ``ProxyServer=127.0.0.1:10809`` + ``ProxyEnable=1``。
   所有走 WinINET 的流量都进本地代理，分流交给 local_proxy 的 smart 模式。

为什么必须做快照
----------------
改系统代理是有副作用的操作：用户可能本来就在用 Clash / 公司代理。
所以任何 apply 之前先把这个键下的 5 个值**原样**存盘（含「原本不存在」
这一状态），卸载时逐字节还原，而不是简单地把 ProxyEnable 置 0。

跨平台可测
----------
注册表访问抽成 ``RegistryBackend`` 协议。Windows 上走 winreg，
其他平台走 JsonFileBackend（行为等价的文件模拟），因此快照/还原/PAC
生成这些逻辑可以在 Mac 上跑真实单测，不需要 Windows 机器。
"""

from __future__ import annotations

import ctypes
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

LOG = logging.getLogger("win_sysproxy")

INTERNET_SETTINGS = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"

# WinINET 刷新用的选项号（wininet.h）
INTERNET_OPTION_REFRESH = 37
INTERNET_OPTION_SETTINGS_CHANGED = 39

# WM_SETTINGCHANGE：广播给所有顶层窗口，Firefox 等靠它感知代理变化
HWND_BROADCAST = 0xFFFF
WM_SETTINGCHANGE = 0x001A
SMTO_ABORTIFHUNG = 0x0002

REG_SZ = 1
REG_DWORD = 4

# 受管的 5 个值。快照与还原都以这个清单为准。
MANAGED_VALUES = ("ProxyEnable", "ProxyServer", "ProxyOverride", "AutoConfigURL", "AutoDetect")

# 系统代理的绕过表。注意这是 WinINET 语法，不是 Chromium bypassList：
# 用 `;` 分隔，支持 `10.*` 这类前缀通配和 `<local>`。
DEFAULT_OVERRIDE = (
    "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;"
    "172.2*;172.30.*;172.31.*;192.168.*;<local>"
)

# PAC 里需要直连的域名后缀。与 local_proxy.DEFAULT_BYPASS 同源，
# 但这里必须用「点开头」形式，才能在 JS 里做后缀匹配。
BYPASS_SUFFIXES: Tuple[str, ...] = (
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


# ── 注册表抽象 ─────────────────────────────────────────────────


class RegistryBackend:
    """最小注册表接口。只读/写 HKCU 下的单个键，足够用。"""

    def read(self, key_path: str, name: str) -> Optional[Tuple[int, Any]]:
        raise NotImplementedError

    def write(self, key_path: str, name: str, reg_type: int, value: Any) -> None:
        raise NotImplementedError

    def delete(self, key_path: str, name: str) -> None:
        raise NotImplementedError


class WinRegBackend(RegistryBackend):
    """真实注册表（仅 Windows）。"""

    def __init__(self, root: Any = None):
        import winreg  # 仅 Windows 存在

        self._winreg = winreg
        self._root = winreg.HKEY_CURRENT_USER if root is None else root

    def read(self, key_path: str, name: str) -> Optional[Tuple[int, Any]]:
        try:
            with self._winreg.OpenKey(self._root, key_path, 0, self._winreg.KEY_READ) as key:
                value, reg_type = self._winreg.QueryValueEx(key, name)
                return int(reg_type), value
        except OSError:
            return None

    def write(self, key_path: str, name: str, reg_type: int, value: Any) -> None:
        with self._winreg.CreateKeyEx(
            self._root, key_path, 0, self._winreg.KEY_SET_VALUE
        ) as key:
            self._winreg.SetValueEx(key, name, 0, reg_type, value)

    def delete(self, key_path: str, name: str) -> None:
        try:
            with self._winreg.OpenKey(self._root, key_path, 0, self._winreg.KEY_SET_VALUE) as key:
                self._winreg.DeleteValue(key, name)
        except OSError:
            pass


class JsonFileBackend(RegistryBackend):
    """文件模拟后端：语义与注册表一致，用于非 Windows 平台的真实单测。

    每个 (key_path, name) 存成 [type, value]；键不存在就没有该条目，
    这样「原本不存在 → 还原时删除」这条路径也能被测到。
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self._data: Dict[str, Dict[str, List[Any]]] = {}
        self.reload()

    def reload(self) -> None:
        if self.path.is_file():
            try:
                self._data = json.loads(self.path.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                self._data = {}
        else:
            self._data = {}

    def _flush(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def read(self, key_path: str, name: str) -> Optional[Tuple[int, Any]]:
        entry = self._data.get(key_path, {}).get(name)
        if not entry:
            return None
        return int(entry[0]), entry[1]

    def write(self, key_path: str, name: str, reg_type: int, value: Any) -> None:
        self._data.setdefault(key_path, {})[name] = [int(reg_type), value]
        self._flush()

    def delete(self, key_path: str, name: str) -> None:
        bucket = self._data.get(key_path)
        if bucket and name in bucket:
            del bucket[name]
            self._flush()


def make_backend(state_dir: Optional[Path] = None) -> RegistryBackend:
    """按平台挑后端。Windows 用真注册表，其它平台用文件模拟。"""
    if sys.platform.startswith("win"):
        return WinRegBackend()
    base = Path(state_dir) if state_dir else Path.home() / ".fanvpn-bridge"
    return JsonFileBackend(base / "fake_registry.json")


# ── 快照 ───────────────────────────────────────────────────────


@dataclass
class ProxySnapshot:
    """apply 之前的原始状态。values 里没有某个名字 = 它原本不存在。"""

    values: Dict[str, List[Any]] = field(default_factory=dict)
    platform: str = ""
    created_at: float = 0.0

    def missing(self) -> List[str]:
        return [name for name in MANAGED_VALUES if name not in self.values]

    def to_json(self) -> str:
        return json.dumps(
            {"values": self.values, "platform": self.platform, "created_at": self.created_at},
            ensure_ascii=False,
            indent=2,
        )

    @classmethod
    def from_json(cls, text: str) -> "ProxySnapshot":
        raw = json.loads(text)
        return cls(
            values=dict(raw.get("values") or {}),
            platform=str(raw.get("platform") or ""),
            created_at=float(raw.get("created_at") or 0.0),
        )


# ── 系统代理管理 ───────────────────────────────────────────────


def _is_loopback_endpoint(value: str) -> bool:
    """判断 WinINET 的 ProxyServer 是否指向本机。

    支持 ``127.0.0.1:10809`` 和 ``http=127.0.0.1:10809;https=...`` 两种写法。
    """
    parts = [p for p in value.replace(" ", "").split(";") if p]
    if not parts:
        return False
    for part in parts:
        endpoint = part.split("=", 1)[1] if "=" in part else part
        host, _, port = endpoint.rpartition(":")
        host = (host or endpoint).strip("[]").lower()
        if host in _LOOPBACK_HOSTS:
            return True
    return False


_LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1", "0.0.0.0")


def _is_loopback_url(url: str) -> bool:
    """用 urllib 解析 PAC 地址，取 hostname 判断是否本机。"""
    from urllib.parse import urlsplit

    try:
        host = (urlsplit(url if "//" in url else "//" + url).hostname or "").lower()
    except ValueError:
        return False
    return host in _LOOPBACK_HOSTS


class SystemProxyManager:
    """对 WinINET 代理设置做可逆的、带快照的修改。"""

    def __init__(
        self,
        backend: Optional[RegistryBackend] = None,
        key_path: str = INTERNET_SETTINGS,
        notify: bool = True,
        state_dir: Optional[Path] = None,
    ):
        self.backend = backend if backend is not None else make_backend(state_dir)
        self.key_path = key_path
        self.notify = notify and sys.platform.startswith("win")

    # ── 读取 ────────────────────────────────────────────────────
    def current(self) -> Dict[str, Any]:
        """当前受管值的可读视图；缺省值归一成 None。"""
        out: Dict[str, Any] = {}
        for name in MANAGED_VALUES:
            entry = self.backend.read(self.key_path, name)
            out[name] = None if entry is None else entry[1]
        return out

    def is_managed(self) -> bool:
        """判断当前配置是不是我们挂上去的。

        三个曾经的错误做法，都是真 Windows CI 上撞出来的：

        1. 只看 ``"/proxy.pac" in AutoConfigURL`` —— 公司内网也常把
           PAC 叫这个名字，会把别人的配置认成自己的，卸载时吞掉。

        2. 只看 AutoConfigURL 是不是环回 —— 没用。因为 apply_pac
           会先把 ProxyServer 写成 ``127.0.0.1:10809``，之后就算
           用户/公司把 PAC 改成 ``http://corp/proxy.pac``，
           ProxyServer 里的环回值还在，仍然误判成 True。

        3. 把「任一为环回」算作自家 —— 同上问题。

        正确语义：**当前生效的是哪种模式，就只看哪种模式的字段**。
        PAC 模式下 ProxyServer 是残留垃圾，不参与判断；
        静态模式下 AutoConfigURL 同理。
        """
        cur = self.current()
        pac = str(cur.get("AutoConfigURL") or "").strip()
        server = str(cur.get("ProxyServer") or "").strip()

        if pac:
            # PAC 优先：WinINET 会先尝试 PAC，PAC 失败才回退 ProxyServer。
            # 所以只要有 PAC，就看它是不是我们的。
            return _is_loopback_url(pac)

        if server and int(cur.get("ProxyEnable") or 0) == 1:
            return _is_loopback_endpoint(server)

        return False

    # ── 快照 / 还原 ─────────────────────────────────────────────
    def snapshot(self) -> ProxySnapshot:
        values: Dict[str, List[Any]] = {}
        for name in MANAGED_VALUES:
            entry = self.backend.read(self.key_path, name)
            if entry is not None:
                values[name] = [entry[0], entry[1]]
        import time as _time

        return ProxySnapshot(values=values, platform=sys.platform, created_at=_time.time())

    def restore(self, snap: ProxySnapshot) -> None:
        """逐字节还原。原本不存在的值必须删掉，不能写成空串。"""
        for name in MANAGED_VALUES:
            if name in snap.values:
                reg_type, value = snap.values[name]
                self.backend.write(self.key_path, name, int(reg_type), value)
            else:
                self.backend.delete(self.key_path, name)
        self._refresh()
        LOG.info("system proxy restored")

    # ── 应用 ────────────────────────────────────────────────────
    def apply_pac(self, pac_url: str, override: str = DEFAULT_OVERRIDE) -> None:
        """PAC 模式：关掉静态代理，只留 AutoConfigURL。

        同时把 ProxyServer 清成空串而不是留着旧值 —— 某些老版本
        WinINET 在 AutoConfigURL 拉取失败时会回退到 ProxyServer，
        留旧值等于把流量送去一个已经不在的代理。
        """
        self.backend.write(self.key_path, "ProxyEnable", REG_DWORD, 0)
        self.backend.write(self.key_path, "ProxyServer", REG_SZ, "")
        self.backend.write(self.key_path, "ProxyOverride", REG_SZ, override)
        self.backend.write(self.key_path, "AutoDetect", REG_DWORD, 0)
        self.backend.write(self.key_path, "AutoConfigURL", REG_SZ, pac_url)
        self._refresh()
        LOG.info("system proxy -> PAC %s", pac_url)

    def apply_direct(self, proxy_server: str, override: str = DEFAULT_OVERRIDE) -> None:
        """静态代理模式：所有 WinINET 流量进本地代理。"""
        self.backend.write(self.key_path, "AutoConfigURL", REG_SZ, "")
        self.backend.write(self.key_path, "AutoDetect", REG_DWORD, 0)
        self.backend.write(self.key_path, "ProxyServer", REG_SZ, proxy_server)
        self.backend.write(self.key_path, "ProxyOverride", REG_SZ, override)
        self.backend.write(self.key_path, "ProxyEnable", REG_DWORD, 1)
        self._refresh()
        LOG.info("system proxy -> %s", proxy_server)

    def disable(self) -> None:
        self.backend.write(self.key_path, "ProxyEnable", REG_DWORD, 0)
        self.backend.write(self.key_path, "AutoConfigURL", REG_SZ, "")
        self._refresh()

    # ── 让已运行的进程立刻感知 ──────────────────────────────────
    def _refresh(self) -> None:
        if self.notify:
            refresh_wininet()


def refresh_wininet() -> bool:
    """通知 WinINET 配置变了。

    只改注册表是没用的：Chrome/Edge 会缓存系统代理，必须
    InternetSetOption(SETTINGS_CHANGED) + REFRESH 才会重新读取。
    另外广播一次 WM_SETTINGCHANGE，Firefox 这类不订阅 WinINET 通知的
    程序靠它感知。
    """
    if not sys.platform.startswith("win"):
        return False
    ok = False
    try:
        from ctypes import wintypes

        wininet = ctypes.WinDLL("wininet.dll")
        wininet.InternetSetOptionW.argtypes = [
            ctypes.c_void_p,  # HINTERNET；ctypes.wintypes 里没有这个类型
            wintypes.DWORD,
            ctypes.c_void_p,
            wintypes.DWORD,
        ]
        wininet.InternetSetOptionW.restype = wintypes.BOOL
        for option in (INTERNET_OPTION_SETTINGS_CHANGED, INTERNET_OPTION_REFRESH):
            ok = bool(wininet.InternetSetOptionW(None, option, None, 0)) or ok
    except (OSError, AttributeError) as exc:
        LOG.debug("InternetSetOption failed: %s", exc)

    try:
        user32 = ctypes.WinDLL("user32.dll")
        result = wintypes.DWORD()
        user32.SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            ctypes.c_wchar_p("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"),
            SMTO_ABORTIFHUNG,
            1000,
            ctypes.byref(result),
        )
    except (OSError, AttributeError) as exc:
        LOG.debug("broadcast failed: %s", exc)

    return ok


# ── PAC 生成 ───────────────────────────────────────────────────


def pac_suffix_match(host: str, suffixes: Sequence[str]) -> bool:
    """PAC 里那段后缀判断的 Python 镜像，单独抽出来是为了能写单测。

    规则：把 host 前面补一个点再比对后缀。这样 ``notqq.com`` 不会被
    ``.qq.com`` 误判（补点后是 ``.notqq.com``，尾串是 ``tqq.com``）。
    """
    name = (host or "").strip().lower().rstrip(".")
    if not name:
        return True
    if "." not in name:  # 裸主机名，内网
        return True
    padded = "." + name
    for rule in suffixes:
        rule = rule.strip().lower()
        if not rule:
            continue
        if padded == rule or padded.endswith(rule):
            return True
    return False


def build_pac(proxy_endpoint: str, suffixes: Sequence[str] = BYPASS_SUFFIXES) -> str:
    """生成 PAC 脚本。

    proxy_endpoint 形如 ``127.0.0.1:10809``。

    末尾带 ``; DIRECT``：代理没起来时浏览器直接回落直连，
    这是刻意的 —— 系统代理挂上去以后如果本地代理进程死了，
    没有这个回落用户就整个断网了。
    """
    rules = "|".join(s.strip().lower() for s in suffixes if s and s.strip())
    return _PAC_TEMPLATE.replace("__RULES__", rules).replace("__PROXY__", proxy_endpoint)


_PAC_TEMPLATE = """// FanVPN PAC - generated at runtime, do not edit
var RULES = "__RULES__".split("|");
var PROXY = "PROXY __PROXY__; DIRECT";

function FindProxyForURL(url, host) {
  if (!host) return "DIRECT";
  host = host.toLowerCase();
  if (host.charAt(host.length - 1) === ".") host = host.slice(0, -1);

  // 环回与内网前缀：直连，否则本地服务（含面板自己）会绕进代理
  if (host === "localhost" || host.indexOf("127.") === 0 ||
      host.indexOf("10.") === 0 || host.indexOf("192.168.") === 0 ||
      host.indexOf("169.254.") === 0) return "DIRECT";
  if (host.indexOf("172.") === 0) {
    var second = parseInt(host.split(".")[1], 10);
    if (second >= 16 && second <= 31) return "DIRECT";
  }
  if (isPlainHostName(host)) return "DIRECT";

  var padded = "." + host;
  for (var i = 0; i < RULES.length; i++) {
    var rule = RULES[i];
    if (!rule) continue;
    if (padded.length >= rule.length &&
        padded.substring(padded.length - rule.length) === rule) return "DIRECT";
  }
  return PROXY;
}
"""


def pac_url_for(panel_port: int) -> str:
    return f"http://127.0.0.1:{int(panel_port)}/proxy.pac"


def proxy_server_for(proxy_port: int) -> str:
    """WinINET 的 ProxyServer 格式。

    单值时所有协议共用，比 ``http=..;https=..`` 少一处出错点。
    注意不能写 ``http://`` 前缀 —— WinINET 这里不接受 scheme。
    """
    return f"127.0.0.1:{int(proxy_port)}"


# ── 备份落盘 ───────────────────────────────────────────────────


def default_state_dir() -> Path:
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(base) / "FanVPN"
    return Path.home() / ".fanvpn-bridge"


class SnapshotStore:
    """快照存盘。放在 LOCALAPPDATA 下，卸载程序/下次启动都能读到。"""

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else default_state_dir() / "sysproxy_backup.json"

    def save(self, snap: ProxySnapshot) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(snap.to_json(), encoding="utf-8")

    def load(self) -> Optional[ProxySnapshot]:
        if not self.path.is_file():
            return None
        try:
            return ProxySnapshot.from_json(self.path.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            LOG.warning("快照读取失败 %s: %s", self.path, exc)
            return None

    def clear(self) -> None:
        try:
            self.path.unlink()
        except OSError:
            pass
