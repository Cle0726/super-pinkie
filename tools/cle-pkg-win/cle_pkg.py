#!/usr/bin/env python3
"""C.le. 本机包的 Windows 三件套：backup-current / install-cle / restore（照 Mac ~/pinkie-mac/cle-pkg）。

不带 --yes 只列出要做的事，什么都不动，退出码 2。带 --yes 才动手：成功 0，做不下去 1，安全检查不过 3。

每个位置都能用参数或环境变量指到别处（自测全指到隔离目录）：
  --app-dir    / CLE_APP_DIR     现装 App，默认 %LOCALAPPDATA%/Programs/SuperPinkie
  --config-dir / CLE_CONFIG_DIR  配置目录，默认 %USERPROFILE%/.openclaw（只备份 / 还原顶层文件，不动子目录）
  --backup-dir / CLE_BACKUP_DIR  备份放哪，默认 %LOCALAPPDATA%/SuperPinkie-cle-pkg/backups
  --pkg        / CLE_PKG         C.le. 包：onedir 目录或 zip，默认本目录 out/超級碧琪
  --tasks      / CLE_TASKS       计划任务名，逗号分隔
  --schtasks   / CLE_SCHTASKS    schtasks 命令（.py 结尾就用当前 Python 跑），默认 schtasks.exe
  --reg-root   / CLE_REG_ROOT    注册表根，只认 HKCU，默认 HKCU/Software/Microsoft/Windows/CurrentVersion
  --reg-values / CLE_REG_VALUES  要管的注册表值「子键/值名」，值名可带 *，逗号分隔
  --reg-file   / CLE_REG_FILE    用一个 JSON 文件代替注册表（自测用）
  --iso-root   / CLE_ISO_ROOT    设了就要求 App / 配置 / 备份 / 假注册表都在它下面，并且 schtasks 换成了假的，否则拒绝

不管怎么设，路径里带 .rollback- 的目录一律拒绝（%LOCALAPPDATA%/Programs/SuperPinkie.rollback-* 等用户定）。
从不删 App：安装时旧 App 原地改名留着，还原时现装的挪进 备份/after-install/<时间>/。
"""
import argparse
import base64
import codecs
import filecmp
import fnmatch
import json
import locale
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
BS = chr(92)
BOM = chr(0xFEFF)
APP_NAME = "超級碧琪"
DEFAULT_TASKS = ("SuperPinkieGatewayWatchdog", "OpenClawGatewayWatchdog", "OpenClawURProxy")
DEFAULT_REG_VALUES = (
    "Run/SuperPinkieGatewayWatchdog",
    "Run/OpenClawGatewayWatchdog",
    "RunOnce/SuperPinkieRestore-*",
)
DEFAULT_REG_ROOT = "HKCU/Software/Microsoft/Windows/CurrentVersion"
PROTECTED = re.compile(r"[.]rollback-", re.IGNORECASE)
MANIFEST = "manifest.json"


class Refused(Exception):
    """安全检查不过：一步都不做。"""


class Failed(Exception):
    """做不下去。"""


# ── 小工具 ──────────────────────────────────────────────────────────────

def lp(path):
    """Windows 上加长路径前缀：App 里 node_modules 很深，超过 260 字符也能拷能挪。"""
    text = os.path.abspath(str(path))
    prefix = BS + BS + "?" + BS
    if os.name == "nt" and not text.startswith(prefix):
        text = prefix + text
    return text


def inside(path, root):
    path = Path(os.path.realpath(str(path)))
    root = Path(os.path.realpath(str(root)))
    return path == root or root in path.parents


def split_list(text):
    return [item.strip() for item in str(text).split(",") if item.strip()]


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(str(tmp), str(path))


def read_json(path, default=None):
    path = Path(path)
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def stamp_now():
    return time.strftime("%Y%m%d-%H%M%S")


def unique(parent, base, suffixes=("",)):
    name, n = base, 2
    while any((Path(parent) / (name + suffix)).exists() for suffix in suffixes):
        name, n = f"{base}-{n}", n + 1
    return name


def decode(data):
    """schtasks 输出可能是 UTF-16、UTF-8 或系统代码页，都认；认不出就报错，不猜。"""
    if data[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE):
        return data.decode("utf-16")
    if bytes(1) in data[:200]:
        return data.decode("utf-16-le")
    if data[:3] == codecs.BOM_UTF8:
        return data[3:].decode("utf-8")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("mbcs" if os.name == "nt" else locale.getpreferredencoding(False))


def xml_file_bytes(text):
    """schtasks /Create /XML 要的文件：UTF-16 带 BOM，声明也写 UTF-16。"""
    text = text.lstrip(BOM)
    if text.startswith("<?xml"):
        end = text.find("?>")
        text = re.sub('encoding="[^"]*"', 'encoding="UTF-16"', text[:end], count=1) + text[end:]
    return text.encode("utf-16")


def same_xml(a, b):
    def norm(text):
        lines = (line.strip() for line in text.lstrip(BOM).splitlines())
        return [line for line in lines if line and not line.startswith("<?xml")]
    return norm(a) == norm(b)


def task_file(name):
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name.strip(BS)) + ".xml"


def enc(value):
    if isinstance(value, bytes):
        return {"b64": base64.b64encode(value).decode("ascii")}
    return value


def dec(value):
    if isinstance(value, dict) and "b64" in value:
        return base64.b64decode(value["b64"])
    return value


# ── 计划任务 / 注册表 ────────────────────────────────────────────────────

class Tasks:
    """经 schtasks 命令行查、停、删、建计划任务。自测把命令换成假的 schtasks。"""

    def __init__(self, command):
        if not command:
            self.argv = ["schtasks.exe"]
        elif command.lower().endswith(".py"):
            self.argv = [sys.executable, command]
        else:
            self.argv = [command]

    def _run(self, *args, check=True):
        try:
            result = subprocess.run(self.argv + list(args), capture_output=True, timeout=120)
        except OSError as error:
            raise Failed(f"跑不了 {self.argv[-1]}：{error}")
        if check and result.returncode:
            detail = decode(result.stderr or result.stdout).strip()[:300]
            raise Failed(f"schtasks {' '.join(args)} 失败（rc={result.returncode}）：{detail}")
        return result

    def listed(self, name):
        result = self._run("/Query", "/FO", "CSV", "/NH", check=False)
        if result.returncode:
            raise Failed(f"列不出计划任务（rc={result.returncode}），不敢往下做")
        want = name.strip(BS).lower()
        for line in decode(result.stdout).splitlines():
            first = line.split(",", 1)[0].strip().strip('"')
            if first.strip(BS).lower() == want:
                return True
        return False

    def export(self, name):
        """任务的 XML；没有这个任务返回 None。任务在但导不出就报错，免得当成没有。"""
        result = self._run("/Query", "/TN", name, "/XML", check=False)
        if result.returncode == 0:
            return decode(result.stdout)
        if self.listed(name):
            raise Failed(f"计划任务 {name} 在，但导不出 XML：{decode(result.stderr).strip()[:300]}")
        return None

    def end(self, name):
        self._run("/End", "/TN", name, check=False)  # 没在跑也算停了

    def delete(self, name):
        self._run("/Delete", "/TN", name, "/F")

    def create(self, name, xml_path):
        self._run("/Create", "/TN", name, "/XML", str(xml_path), "/F")


class FileRegistry:
    """自测用：一个 JSON 文件当注册表，{子键: {值名: [类型, 值]}}。"""

    def __init__(self, path):
        self.path = Path(path)

    def _load(self):
        return read_json(self.path, {}) or {}

    def values(self, sub):
        return {name: (kind, value) for name, (kind, value) in self._load().get(sub, {}).items()}

    def set(self, sub, name, kind, value):
        data = self._load()
        data.setdefault(sub, {})[name] = [kind, value]
        write_json(self.path, data)

    def delete(self, sub, name):
        data = self._load()
        data.get(sub, {}).pop(name, None)
        write_json(self.path, data)


class WinRegistry:
    def __init__(self, root):
        hive, _, rest = root.replace("/", BS).partition(BS)
        if hive.upper() not in ("HKCU", "HKEY_CURRENT_USER"):
            raise Refused(f"注册表根 {root} 不在 HKCU 下，这个脚本只管当前用户的项")
        try:
            import winreg
        except ImportError:
            raise Refused("这台机器没有 Windows 注册表；自测请用 --reg-file / CLE_REG_FILE")
        self.w = winreg
        self.base = rest.strip(BS)

    def _path(self, sub):
        return self.base + BS + sub if sub else self.base

    def values(self, sub):
        w = self.w
        try:
            key = w.OpenKey(w.HKEY_CURRENT_USER, self._path(sub))
        except FileNotFoundError:
            return {}
        out = {}
        with key:
            index = 0
            while True:
                try:
                    name, value, kind = w.EnumValue(key, index)
                except OSError:
                    break
                out[name] = (kind, value)
                index += 1
        return out

    def set(self, sub, name, kind, value):
        w = self.w
        with w.CreateKeyEx(w.HKEY_CURRENT_USER, self._path(sub), 0, w.KEY_SET_VALUE) as key:
            w.SetValueEx(key, name, 0, kind, value)

    def delete(self, sub, name):
        w = self.w
        with w.OpenKey(w.HKEY_CURRENT_USER, self._path(sub), 0, w.KEY_SET_VALUE) as key:
            w.DeleteValue(key, name)


def reg_snapshot(reg, patterns):
    items, seen = [], set()
    for pattern in patterns:
        sub, _, name_pattern = pattern.replace("/", BS).rpartition(BS)
        for name, (kind, value) in sorted(reg.values(sub).items()):
            key = (sub.lower(), name.lower())
            if key not in seen and fnmatch.fnmatchcase(name.lower(), name_pattern.lower()):
                seen.add(key)
                items.append({"key": sub, "name": name, "type": kind, "value": enc(value)})
    return items


# ── App / 包 ────────────────────────────────────────────────────────────

def build_info(app):
    for path in (Path(app) / "_internal" / "build-info.json", Path(app) / "build-info.json"):
        if path.is_file():
            try:
                return json.loads(path.read_text(encoding="utf-8-sig"))
            except ValueError as error:
                raise Failed(f"{path} 读不了：{error}")
    return None


def package_info(pkg):
    pkg = Path(pkg)
    if pkg.is_dir():
        return build_info(pkg)
    if pkg.is_file() and zipfile.is_zipfile(str(pkg)):
        with zipfile.ZipFile(str(pkg)) as archive:
            names = [n for n in archive.namelist() if n.replace(BS, "/").endswith("build-info.json")]
            for name in sorted(names, key=lambda n: n.count("/")):
                try:
                    return json.loads(archive.read(name).decode("utf-8-sig"))
                except ValueError:
                    continue
    return None


def unpack(pkg, staging):
    pkg, staging = Path(pkg), Path(staging)
    if pkg.is_dir():
        shutil.copytree(lp(pkg), lp(staging), symlinks=True)
        return
    tmp = staging.with_name(staging.name + ".unzip")
    if tmp.exists():
        shutil.rmtree(lp(tmp))
    with zipfile.ZipFile(str(pkg)) as archive:
        archive.extractall(lp(tmp))
    root = tmp
    while build_info(root) is None:
        kids = list(root.iterdir())
        if len(kids) != 1 or not kids[0].is_dir():
            raise Failed(f"zip {pkg} 里找不到 build-info.json")
        root = kids[0]
    os.replace(lp(root), lp(staging))
    if tmp.exists():
        shutil.rmtree(lp(tmp))


def verify_channel(app):
    info = build_info(app) or {}
    if info.get("channel") != "cle":
        raise Failed(f"{app} 的 build-info channel 是 {info.get('channel')!r}，不是 'cle'")


def move_away(path, dest):
    """先原地改名（被占用就干净地失败），再挪进 after-install；不删。"""
    path, dest = Path(path), Path(dest)
    aside = path.with_name(f"{path.name}.cle-removing-{stamp_now()}")
    try:
        os.replace(lp(path), lp(aside))
    except OSError as error:
        raise Failed(f"挪不动 {path}（App 或网关还在跑？先退出再来）：{error}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(lp(aside), lp(dest))


def copy_back(src, dst):
    tmp = Path(dst).with_name(Path(dst).name + ".cle-restoring")
    if tmp.exists():
        shutil.rmtree(lp(tmp))
    shutil.copytree(lp(src), lp(tmp), symlinks=True)
    os.replace(lp(tmp), lp(dst))


def config_files(s):
    if not s.config_dir.is_dir():
        return []
    return sorted(p.name for p in s.config_dir.iterdir() if p.is_file())


# ── 设定 / 安全 ─────────────────────────────────────────────────────────

def settings(args):
    env = os.environ
    home = Path(env.get("USERPROFILE") or env.get("HOME") or str(Path.home()))
    local = Path(env.get("LOCALAPPDATA") or str(home / "AppData" / "Local"))

    def pick(value, var, default):
        return value if value else (env.get(var) or default)

    def path(value, var, default):
        return Path(os.path.abspath(str(pick(value, var, default))))

    reg_file = pick(args.reg_file, "CLE_REG_FILE", "")
    iso_root = pick(args.iso_root, "CLE_ISO_ROOT", "")
    return SimpleNamespace(
        app_dir=path(args.app_dir, "CLE_APP_DIR", local / "Programs" / "SuperPinkie"),
        config_dir=path(args.config_dir, "CLE_CONFIG_DIR", home / ".openclaw"),
        backup_dir=path(args.backup_dir, "CLE_BACKUP_DIR", local / "SuperPinkie-cle-pkg" / "backups"),
        pkg=path(args.pkg, "CLE_PKG", HERE / "out" / APP_NAME),
        tasks=split_list(pick(args.tasks, "CLE_TASKS", ",".join(DEFAULT_TASKS))),
        schtasks=pick(args.schtasks, "CLE_SCHTASKS", ""),
        reg_root=pick(args.reg_root, "CLE_REG_ROOT", DEFAULT_REG_ROOT),
        reg_values=split_list(pick(args.reg_values, "CLE_REG_VALUES", ",".join(DEFAULT_REG_VALUES))),
        reg_file=os.path.abspath(reg_file) if reg_file else "",
        iso_root=os.path.abspath(iso_root) if iso_root else "",
    )


def check_safety(s):
    for label, path in (("App 目录", s.app_dir), ("配置目录", s.config_dir), ("备份目录", s.backup_dir)):
        if any(PROTECTED.search(part) for part in path.parts):
            raise Refused(f"{label} {path} 是 rollback 目录，这个脚本不碰（等用户定）")
    if len(s.app_dir.parts) < 3:
        raise Refused(f"App 目录 {s.app_dir} 太靠近盘根，不像安装目录")
    if inside(s.backup_dir, s.app_dir) or inside(s.app_dir, s.backup_dir):
        raise Refused("备份目录和 App 目录不能互相包含")
    if inside(s.config_dir, s.app_dir) or inside(s.app_dir, s.config_dir):
        raise Refused("配置目录和 App 目录不能互相包含")
    if s.iso_root:
        for label, path in (("App 目录", s.app_dir), ("配置目录", s.config_dir), ("备份目录", s.backup_dir)):
            if not inside(path, s.iso_root):
                raise Refused(f"隔离模式：{label} {path} 不在 {s.iso_root} 里")
        if not s.reg_file or not inside(s.reg_file, s.iso_root):
            raise Refused("隔离模式：要用 --reg-file / CLE_REG_FILE 指到隔离目录里的假注册表")
        if not s.schtasks or Path(s.schtasks).name.lower() in ("schtasks", "schtasks.exe"):
            raise Refused("隔离模式：要用 --schtasks / CLE_SCHTASKS 指到假的 schtasks，不能用真的")


def make_registry(s):
    return FileRegistry(s.reg_file) if s.reg_file else WinRegistry(s.reg_root)


class Runner:
    def __init__(self, yes):
        self.yes = yes

    def __call__(self, desc, action=None):
        print(("[执行] " if self.yes else "[计划] ") + desc, flush=True)
        if self.yes and action is not None:
            action()


def problem(run, message):
    if run.yes:
        raise Failed(message)
    print("[会失败] " + message)


def complete_backups(s):
    """只认写完 manifest 的备份（.partial 是没做完的），并且是同一个 App 目录的。"""
    if not s.backup_dir.is_dir():
        return []
    found = []
    for folder in sorted(s.backup_dir.iterdir()):
        manifest = folder / MANIFEST
        if not (folder.is_dir() and manifest.is_file()):
            continue
        try:
            data = read_json(manifest)
        except ValueError:
            continue
        if Path(data.get("app_dir", "")) == s.app_dir:
            found.append((folder, data))
    return found


# ── 三个命令 ────────────────────────────────────────────────────────────

def cmd_backup(s, run, tasks, reg, args):
    stamp = unique(s.backup_dir, stamp_now(), ("", ".partial"))
    final = s.backup_dir / stamp
    part = s.backup_dir / (stamp + ".partial")
    app_present = s.app_dir.is_dir()
    info = build_info(s.app_dir) if app_present else None
    files = config_files(s)
    xmls = {name: tasks.export(name) for name in s.tasks}
    regs = reg_snapshot(reg, s.reg_values)

    run(f"建备份目录 {part}", lambda: part.mkdir(parents=True))
    if app_present:
        version = (info or {}).get("version", "?")
        channel = (info or {}).get("channel", "?")
        run(f"拷现装 App {s.app_dir} → {part / 'app'}（version {version}，channel {channel}）",
            lambda: shutil.copytree(lp(s.app_dir), lp(part / "app"), symlinks=True))
    else:
        print(f"  现在没装 App（{s.app_dir} 不在），备份记 app_present=false")

    def copy_config():
        (part / "config").mkdir(parents=True, exist_ok=True)
        for name in files:
            shutil.copy2(str(s.config_dir / name), str(part / "config" / name))
    run(f"拷配置 {s.config_dir} 顶层 {len(files)} 个文件：{', '.join(files) or '无'}", copy_config)

    for name, xml in xmls.items():
        if xml is None:
            print(f"  计划任务 {name}：没有，记 absent")
        else:
            run(f"导出计划任务 {name} → tasks/{task_file(name)}",
                lambda name=name, xml=xml: write_bytes(part / "tasks" / task_file(name), xml_file_bytes(xml)))
    listing = ", ".join(f"{i['key']}/{i['name']}" for i in regs) or "无"
    run(f"记注册表 {len(regs)} 项：{listing}", lambda: write_json(part / "registry.json", regs))

    manifest = {
        "version": 1,
        "stamp": stamp,
        "app_dir": str(s.app_dir),
        "app_present": app_present,
        "app_build_info": info,
        "config_dir": str(s.config_dir),
        "config_files": files,
        "task_names": list(s.tasks),
        "tasks": {name: (task_file(name) if xml is not None else None) for name, xml in xmls.items()},
        "reg_source": s.reg_file or s.reg_root,
        "reg_values": list(s.reg_values),
        "registry": regs,
    }

    def finish():
        write_json(part / MANIFEST, manifest)
        os.replace(str(part), str(final))
    run(f"写 manifest，{part.name} 改名成 {final.name}（有 manifest 才算完整备份）", finish)
    if run.yes:
        print(f"备份在 {final}")


def cmd_install(s, run, tasks, reg, args):
    backups = complete_backups(s)
    if not backups:
        return problem(run, f"没有 {s.app_dir} 的完整备份，先跑 backup-current --yes")
    backup, _ = backups[-1]
    print(f"  对应的备份：{backup}")
    info = package_info(s.pkg)
    if info is None:
        return problem(run, f"C.le. 包 {s.pkg} 不在，或读不出 build-info.json")
    if info.get("channel") != "cle":
        return problem(run, f"C.le. 包 {s.pkg} 的 channel 是 {info.get('channel')!r}，不是 'cle'，不装")

    stamp = stamp_now()
    staging = s.app_dir.with_name(s.app_dir.name + ".cle-staging")
    replaced = s.app_dir.parent / unique(s.app_dir.parent, f"{s.app_dir.name}.cle-replaced-{stamp}")
    for name in [n for n in s.tasks if tasks.export(n) is not None]:
        run(f"停计划任务 {name}（它按自己的触发器会再起来）", lambda name=name: tasks.end(name))
    if staging.exists():
        run(f"清掉上次留下的 {staging}", lambda: shutil.rmtree(lp(staging)))
    run(f"把 C.le. 包 {s.pkg}（version {info.get('version', '?')}）放到 {staging}", lambda: unpack(s.pkg, staging))
    run(f"核对 {staging} 的 build-info：channel=cle", lambda: verify_channel(staging))

    had_app = s.app_dir.exists()

    def swap():
        old_info = build_info(s.app_dir) if had_app else None
        if had_app:
            try:
                os.replace(lp(s.app_dir), lp(replaced))
            except OSError as error:
                raise Failed(f"挪不动 {s.app_dir}（App 或网关还在跑？先退出再来）：{error}")
        try:
            os.replace(lp(staging), lp(s.app_dir))
        except OSError as error:
            if had_app:
                os.replace(lp(replaced), lp(s.app_dir))
            raise Failed(f"新包换不进 {s.app_dir}，旧 App 已挪回原处：{error}")
        record = read_json(backup / "install.json", {"installs": []})
        record["installs"].append({
            "stamp": stamp,
            "replaced": str(replaced) if had_app else None,
            "replaced_build_info": old_info,
            "installed_build_info": info,
        })
        write_json(backup / "install.json", record)

    if had_app:
        run(f"现装 App {s.app_dir} 改名成 {replaced.name}（不删，restore 挪回来），再把 {staging.name} 换进 {s.app_dir}", swap)
    else:
        run(f"原来没装 App，把 {staging.name} 放到 {s.app_dir}", swap)


def cmd_restore(s, run, tasks, reg, args):
    backups = complete_backups(s)
    if args.backup:
        backups = [item for item in backups if item[0].name == args.backup]
    if not backups:
        return problem(run, f"没有 {s.app_dir} 的完整备份{('（' + args.backup + '）') if args.backup else ''}，没法还原")
    backup, m = backups[-1]
    if m.get("reg_source") != (s.reg_file or s.reg_root):
        return problem(run, f"备份记的注册表是 {m.get('reg_source')}，现在指的是 {s.reg_file or s.reg_root}，对不上")
    print(f"  用备份：{backup}")
    after = backup / "after-install" / unique(backup / "after-install", stamp_now())
    print(f"  现在的东西挪到：{after}")
    installs = (read_json(backup / "install.json", {"installs": []}) or {}).get("installs", [])

    names = list(dict.fromkeys(list(m.get("task_names", [])) + list(s.tasks)))
    current_xml = {name: tasks.export(name) for name in names}
    for name in names:
        if current_xml[name] is not None:
            run(f"停计划任务 {name}", lambda name=name: tasks.end(name))

    # App
    want = m.get("app_build_info")
    source, leftovers = None, []
    for item in installs:
        path = item.get("replaced")
        if not path or not Path(path).is_dir():
            continue
        if source is None and m.get("app_present") and build_info(path) == want:
            source = Path(path)
        else:
            leftovers.append(Path(path))
    if s.app_dir.exists():
        info = build_info(s.app_dir) or {}
        run(f"现装 App {s.app_dir}（channel {info.get('channel', '?')}）挪到 {after / 'app'}（不删）",
            lambda: move_away(s.app_dir, after / "app"))
    for index, path in enumerate(leftovers, 1):
        run(f"中间换下来的 {path} 挪到 {after / ('replaced-' + str(index))}",
            lambda path=path, index=index: (after.mkdir(parents=True, exist_ok=True),
                                            shutil.move(lp(path), lp(after / f"replaced-{index}"))))
    if m.get("app_present"):
        if source is not None:
            run(f"把装 C.le. 前的 App {source.name} 改名回 {s.app_dir}", lambda: os.replace(lp(source), lp(s.app_dir)))
        else:
            run(f"从备份 {backup / 'app'} 拷回 {s.app_dir}", lambda: copy_back(backup / "app", s.app_dir))
    else:
        print(f"  备份时没装 App，还原后 {s.app_dir} 也不在")

    # 配置（只管顶层文件）
    now_files, old_files = config_files(s), list(m.get("config_files", []))
    for name in sorted(set(now_files) | set(old_files)):
        current, saved = s.config_dir / name, backup / "config" / name
        if name in now_files and name in old_files and filecmp.cmp(str(current), str(saved), shallow=False):
            print(f"  跳过配置 {name}：和备份一样")
            continue
        if name in now_files:
            run(f"配置 {name} 现在这份挪到 after-install/config/",
                lambda current=current, name=name: (
                    (after / "config").mkdir(parents=True, exist_ok=True),
                    shutil.move(str(current), str(after / "config" / name))))
        if name in old_files:
            run(f"配置 {name} 换回备份里那份",
                lambda saved=saved, name=name: (
                    s.config_dir.mkdir(parents=True, exist_ok=True),
                    shutil.copy2(str(saved), str(s.config_dir / name))))

    # 计划任务
    for name in names:
        saved_file = (m.get("tasks") or {}).get(name)
        saved = decode((backup / "tasks" / saved_file).read_bytes()) if saved_file else None
        current = current_xml[name]
        if current is None and saved is None:
            continue
        if current is not None and saved is not None and same_xml(current, saved):
            print(f"  跳过计划任务 {name}：和备份一样")
            continue
        if current is not None:
            run(f"计划任务 {name} 现在的定义存到 after-install/tasks/，然后删掉",
                lambda name=name, current=current: (
                    write_bytes(after / "tasks" / task_file(name), xml_file_bytes(current)),
                    tasks.delete(name)))
        if saved is not None:
            run(f"计划任务 {name} 按备份重建", lambda name=name, f=backup / "tasks" / saved_file: tasks.create(name, f))

    # 注册表
    patterns = list(dict.fromkeys(list(m.get("reg_values", [])) + list(s.reg_values)))
    now = {(i["key"].lower(), i["name"].lower()): i for i in reg_snapshot(reg, patterns)}
    old = {(i["key"].lower(), i["name"].lower()): i for i in m.get("registry", [])}
    replaced_values = []

    def remember(item):
        replaced_values.append(item)
        write_json(after / "registry.json", replaced_values)

    for key in sorted(set(now) | set(old)):
        cur, saved = now.get(key), old.get(key)
        if cur and saved and cur["type"] == saved["type"] and cur["value"] == saved["value"]:
            print(f"  跳过注册表 {saved['key']}/{saved['name']}：和备份一样")
            continue
        if cur and not saved:
            run(f"注册表 {cur['key']}/{cur['name']} 是之后加的，删掉（原值记到 after-install/registry.json）",
                lambda cur=cur: (remember(cur), reg.delete(cur["key"], cur["name"])))
        if saved:
            run(f"注册表 {saved['key']}/{saved['name']} 写回备份值",
                lambda cur=cur, saved=saved: ((remember(cur) if cur else None),
                                              reg.set(saved["key"], saved["name"], saved["type"], dec(saved["value"]))))

    run(f"记一笔还原记录 {after / 'restore.json'}",
        lambda: write_json(after / "restore.json", {"backup": backup.name, "at": stamp_now(), "app_dir": str(s.app_dir)}))


COMMANDS = {"backup-current": cmd_backup, "install-cle": cmd_install, "restore": cmd_restore}


def main(command, argv=None):
    try:
        sys.stdout.reconfigure(errors="replace")
        sys.stderr.reconfigure(errors="replace")
    except AttributeError:
        pass
    parser = argparse.ArgumentParser(prog=command, description=(__doc__ or "").strip().splitlines()[0])
    parser.add_argument("--yes", action="store_true", help="真动手；不带只列出要做的事")
    for flag in ("--app-dir", "--config-dir", "--backup-dir", "--pkg", "--tasks", "--schtasks",
                 "--reg-root", "--reg-values", "--reg-file", "--iso-root"):
        parser.add_argument(flag)
    if command == "restore":
        parser.add_argument("--backup", help="用哪份备份（备份目录名），默认最新")
    else:
        parser.set_defaults(backup=None)
    args = parser.parse_args(argv)
    try:
        s = settings(args)
        check_safety(s)
        print(f"{command}：{'动手（--yes）' if args.yes else '只列计划，不动手（没带 --yes）'}")
        print(f"  App 目录   {s.app_dir}")
        print(f"  配置目录   {s.config_dir}")
        print(f"  备份目录   {s.backup_dir}")
        if command == "install-cle":
            print(f"  C.le. 包   {s.pkg}")
        print(f"  计划任务   {', '.join(s.tasks)}（schtasks：{s.schtasks or 'schtasks.exe'}）")
        print(f"  注册表     {s.reg_file or s.reg_root}：{', '.join(s.reg_values)}")
        COMMANDS[command](s, Runner(args.yes), Tasks(s.schtasks), make_registry(s), args)
    except Refused as error:
        print(f"拒绝：{error}", file=sys.stderr)
        return 3
    except Failed as error:
        print(f"失败：{error}", file=sys.stderr)
        return 1
    if not args.yes:
        print("没带 --yes：上面只是计划，什么都没动。")
        return 2
    print("完成。")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print("用法：python cle_pkg.py {backup-current|install-cle|restore} [--yes] [...]", file=sys.stderr)
        sys.exit(64)
    sys.exit(main(sys.argv[1], sys.argv[2:]))
