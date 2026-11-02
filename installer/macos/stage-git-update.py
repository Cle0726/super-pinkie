#!/usr/bin/env python3
"""Stage the Mac Git update while the desktop remains open.

This does not install anything. `apply` is run by the existing detached helper
only after the old process exits; it refuses a changed repository or commit.
"""
from __future__ import annotations
import fcntl
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

STATE = Path(os.environ.get('PINKIE_STATE_ROOT') or Path.home() / 'Library/Application Support/SuperPinkie')
CONFIG = Path(os.environ.get('PINKIE_CONFIG_ROOT') or Path.home() / '.config/super-pinkie') / 'install.env'
UPDATES = STATE / 'updates'
MANAGED = STATE / 'repository'
MANIFEST = UPDATES / 'prepared-git.json'
DEFAULT_REMOTE = 'https://github.com/Cle0726/super-pinkie.git'
# 国内线路：GitHub 加速代理，按顺序试，第一个能列出远端分支的就用它。
# 走代理时 Git 本身仍校验对象哈希，暂存后再核对目标提交，代理改不了内容而不被发现。
MIRRORS = [m.strip() for m in os.environ.get('PINKIE_UPDATE_MIRRORS', 'https://ghfast.top/ https://gh-proxy.com/ https://ghproxy.net/').split() if m.strip().startswith('https://')]
ROUTE = 'mirror' if os.environ.get('PINKIE_UPDATE_ROUTE') == 'mirror' else 'official'
GIT_ROUTE = []
SHA = re.compile(r'^[0-9a-f]{40,64}$')
BYTES = re.compile(r'(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|bytes)(?:\s*\|\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|bytes)/s)?', re.I)


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(',', ':')), flush=True)


def mirror_config(prefix):
    base = prefix.rstrip('/') + '/https://github.com/'
    return ['-c', f'url.{base}.insteadOf=https://github.com/', '-c', f'url.{base}.insteadOf=git@github.com:',
            '-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=60']


def choose_route(repo):
    """国内线路：挑第一个能连上的加速代理；都连不上就报错，不悄悄退回官方线路。"""
    GIT_ROUTE.clear()
    if ROUTE != 'mirror':
        return 'official'
    remote = 'origin' if repo else DEFAULT_REMOTE
    for prefix in MIRRORS:
        cmd = ['git'] + mirror_config(prefix) + (['-C', str(repo)] if repo else []) + ['ls-remote', '--heads', remote, 'refs/heads/main']
        try:
            ok = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=25,
                                env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'}).returncode == 0
        except subprocess.TimeoutExpired:
            ok = False
        if ok:
            GIT_ROUTE.extend(mirror_config(prefix))
            return prefix
    raise RuntimeError('国内线路暂时都连不上，请稍后重试，或换回官方线路。')


def git(repo, *args, check=True):
    cmd = ['git'] + GIT_ROUTE + (['-C', str(repo)] if repo else []) + list(args)
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0'}
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=120, env=env)
    if check and result.returncode:
        raise RuntimeError('Git 操作没有完成，请检查网络和仓库状态。')
    return result.stdout.strip()


def selected_repo():
    value = ''
    if CONFIG.is_file():
        # Same install.env and source semantics as the existing detached helper.
        result = subprocess.run(['/bin/bash', '-c', 'source "$1"; printf "%s" "${PINKIE_REPO:-}"', 'pinkie', str(CONFIG)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
        if result.returncode:
            raise RuntimeError('无法读取原有安装配置。')
        value = result.stdout
    candidate = Path(value).expanduser() if value else MANAGED
    if (candidate / '.git').is_dir() and (candidate / 'update-full.sh').is_file():
        return candidate.resolve()
    if candidate != MANAGED:
        candidate = MANAGED
        if (candidate / '.git').is_dir() and (candidate / 'update-full.sh').is_file():
            return candidate.resolve()
    return None


def branch_of(repo):
    branch = git(repo, 'branch', '--show-current')
    if not branch or not git(repo, 'check-ref-format', '--branch', branch, check=False):
        raise RuntimeError('当前仓库没有可更新的分支。')
    return branch


def ensure_clean(repo):
    if git(repo, 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('更新源码含有尚未保存的修改，请先处理后再试。')


def remote_head(repo, branch):
    remote = 'origin' if repo else DEFAULT_REMOTE
    lines = git(repo, 'ls-remote', '--heads', remote, 'refs/heads/' + branch).splitlines()
    hits = [line.split()[0] for line in lines if len(line.split()) == 2 and line.split()[1] == 'refs/heads/' + branch]
    if len(hits) != 1 or not SHA.fullmatch(hits[0]):
        raise RuntimeError('没有找到可用的更新分支。')
    return hits[0]


def check():
    repo = selected_repo()
    route = choose_route(repo)
    branch = branch_of(repo) if repo else 'main'
    current = git(repo, 'rev-parse', 'HEAD') if repo else None
    latest = remote_head(repo, branch)
    # The installed App does not record the Git commit it was built from.
    # Even if the checkout is current it may need to be reapplied, so do not
    # claim the App is definitely current based on the checkout alone.
    return {'supported': True, 'available': True, 'route': ROUTE, 'mirror': route if ROUTE == 'mirror' else '',
            'unchangedCheckout': current is not None and current == latest}


def parse_git_progress(text):
    # Git reports *received* bytes, not the remote total. Object percentages
    # are not file percentages; never display them as one.
    if 'Receiving objects:' not in text:
        return None
    match = BYTES.search(text)
    if not match:
        return None
    def amount(number, unit):
        return float(number) * {'bytes': 1, 'kib': 1024, 'mib': 1024**2, 'gib': 1024**3}[unit.lower()]
    received = int(amount(match.group(1), match.group(2)))
    speed = amount(match.group(3), match.group(4)) if match.group(3) else None
    return {'stage': 'download', 'downloaded': received, 'total': None, 'bytesPerSecond': speed, 'etaSeconds': None}


def run_progress(command):
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                               env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
    buffer = bytearray()
    selector = selectors.DefaultSelector()
    selector.register(process.stderr, selectors.EVENT_READ)
    deadline = time.monotonic() + 1800
    try:
        while True:
            if time.monotonic() >= deadline:
                raise RuntimeError('更新下载超时，请检查网络后重试。')
            if not selector.select(1):
                continue
            chunk = os.read(process.stderr.fileno(), 4096)
            if not chunk:
                break
            for char in chunk:
                if char in (10, 13):
                    event = parse_git_progress(buffer.decode('utf-8', 'replace'))
                    if event:
                        emit({'type': 'progress', 'event': event})
                    buffer.clear()
                elif len(buffer) < 4096:
                    buffer.append(char)
        if process.wait(timeout=5) != 0:
            raise RuntimeError('更新下载没有完成，请检查网络后重试。')
    finally:
        selector.close()
        process.stderr.close()
        if process.poll() is None:
            process.kill()
            process.wait()


def notes(repo, revision):
    text = git(repo, 'show', f'{revision}:CHANGELOG.md', check=False)
    version = git(repo, 'show', f'{revision}:VERSION', check=False).strip()
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,32}', version):
        return {'version': '', 'notes': ''}
    lines = []
    inside = False
    for raw in text.splitlines():
        if re.match(r'^##\s+', raw):
            if inside:
                break
            inside = bool(re.match(r'^##\s+v?' + re.escape(version) + r'(?:\s|$)', raw))
            continue
        if not inside:
            continue
        match = re.match(r'^\s*[-*]\s+(.+)', raw)
        if match:
            lines.append(match.group(1)[:240])
        if len(lines) == 5:
            break
    return {'version': version, 'notes': '\n'.join(lines)}


def prepare():
    UPDATES.mkdir(parents=True, exist_ok=True)
    with (UPDATES / 'git-stage.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('已有更新正在下载。')
        MANIFEST.unlink(missing_ok=True)
        repo = selected_repo()
        staging = None
        stage_ref = None
        try:
            choose_route(repo)
            if repo:
                ensure_clean(repo)
                branch = branch_of(repo)
                old = git(repo, 'rev-parse', 'HEAD')
                stage_ref = 'refs/pinkie-staged/' + uuid.uuid4().hex
                run_progress(['git'] + GIT_ROUTE + ['-C', str(repo), 'fetch', '--progress', 'origin',
                              '+refs/heads/' + branch + ':' + stage_ref])
                target = git(repo, 'rev-parse', stage_ref)
                if not SHA.fullmatch(target) or subprocess.run(['git','-C',str(repo),'merge-base','--is-ancestor',old,target],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
                    raise RuntimeError('更新分支不能安全快进，原文件没有改变。')
                ensure_clean(repo)
                if branch_of(repo) != branch or git(repo, 'rev-parse', 'HEAD') != old:
                    raise RuntimeError('源码版本已改变，请重新下载。')
                kind = 'existing'
            else:
                branch, old = 'main', ''
                staging = Path(tempfile.mkdtemp(prefix='pinkie-repository-', dir=UPDATES))
                # 国内线路只拉最新一版（--depth 1）：完整历史经加速代理太大，容易半路被掐断；以后的 fetch 照常快进。
                shallow = ['--depth', '1'] if GIT_ROUTE else []
                run_progress(['git'] + GIT_ROUTE + ['clone','--progress',*shallow,'--branch',branch,'--single-branch',DEFAULT_REMOTE,str(staging)])
                # 克隆下来的 origin 仍写官方地址：以后换回官方线路不用改配置。
                repo = staging.resolve()
                target = git(repo, 'rev-parse', 'HEAD')
                if not SHA.fullmatch(target):
                    raise RuntimeError('更新版本无法确认。')
                kind = 'clone'
            emit({'type':'progress','event':{'stage':'verify'}})
            git(repo, 'cat-file', '-e', f'{target}^{{commit}}')
            info = notes(repo, target)
            manifest = {'kind':kind,'repo':str(repo),'branch':branch,'old':old,'target':target,'ref':stage_ref,'route':ROUTE}
            fd, temporary = tempfile.mkstemp(prefix='prepared-', dir=UPDATES)
            try:
                with os.fdopen(fd,'w',encoding='utf-8') as out:
                    json.dump(manifest,out,ensure_ascii=False)
                os.replace(temporary,MANIFEST)
            finally:
                if os.path.exists(temporary): os.unlink(temporary)
            emit({'type':'progress','event':{'stage':'metadata',**info}})
            return {'available':True,'ready':True,**info}
        except Exception:
            if stage_ref and repo:
                subprocess.run(['git','-C',str(repo),'update-ref','-d',stage_ref],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if staging:
                shutil.rmtree(staging, ignore_errors=True)
            raise


def apply():
    value = json.loads(MANIFEST.read_text(encoding='utf-8'))
    kind, repo, branch, old, target, stage_ref = (value.get(k) for k in ('kind','repo','branch','old','target','ref'))
    if not isinstance(repo,str) or not isinstance(target,str) or not SHA.fullmatch(target):
        raise RuntimeError('暂存的更新信息不完整。')
    repo = Path(repo).resolve()
    if kind == 'existing':
        if selected_repo() != repo or not isinstance(old,str) or not SHA.fullmatch(old):
            raise RuntimeError('安装来源已改变，请重新下载。')
        if not isinstance(stage_ref,str) or not re.fullmatch(r'refs/pinkie-staged/[0-9a-f]{32}', stage_ref):
            raise RuntimeError('暂存的更新信息不完整。')
        ensure_clean(repo)
        if branch_of(repo) != branch or git(repo,'rev-parse','HEAD') != old:
            raise RuntimeError('源码版本已改变，请重新下载。')
        if git(repo,'rev-parse',stage_ref) != target:
            raise RuntimeError('暂存的版本已改变，请重新下载。')
        git(repo,'cat-file','-e',f'{target}^{{commit}}')
        if subprocess.run(['git','-C',str(repo),'merge-base','--is-ancestor',old,target],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
            raise RuntimeError('更新分支不能安全快进。')
        git(repo,'merge','--ff-only','--no-edit',target)
        subprocess.run(['git','-C',str(repo),'update-ref','-d',stage_ref,target],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    elif kind == 'clone':
        if repo.parent != UPDATES.resolve() or not repo.name.startswith('pinkie-repository-') or selected_repo() is not None:
            raise RuntimeError('安装来源已改变，请重新下载。')
        if git(repo,'rev-parse','HEAD') != target:
            raise RuntimeError('暂存的版本已改变。')
        if MANAGED.exists():
            MANAGED.rename(STATE / ('repository.previous-' + str(time.time_ns())))
        repo.rename(MANAGED)
        repo = MANAGED.resolve()
    else:
        raise RuntimeError('暂存的更新类型无效。')
    MANIFEST.unlink(missing_ok=True)
    return {'repo':str(repo),'target':target}


if __name__ == '__main__':
    try:
        mode = sys.argv[1] if len(sys.argv) > 1 else ''
        result = {'check':check,'prepare':prepare,'apply':apply}[mode]()
        emit({'type':'result','value':result})
    except Exception as exc:
        emit({'type':'result','value':{'supported':True,'available':False,'ready':False,'temporaryError':True,'message':str(exc)}})
        sys.exit(1)
