#!/usr/bin/env python3
"""学习台游戏「碧琪上岸记」上线（briefs/study-desk-game/SESSION-A.md「上线」）。照 tools/study-desk/deploy-drill.py 的做法：

线上是两份来源拼起来的（记忆 biqi-live-is-two-sources），线上文件还可能有仓库里没有的改动，所以**不整文件拷**：
  改过的已有文件三方合并：基准 = 069c5cc（背一背上线时的提交，线上 drill2 就是它），我方 = 线上文件，对方 = --rev（默认 feat/study-game-fx）。
  后端的基准和对方先把 Li An 换成碧琪再合并。合并有冲突就整个停下，什么都不写。
新文件直接拷：后端 learning-game*（两份线上副本），前端 laolao-game-* + three 后期插件（control-ui 和包内 ui/injections 两处），
美术 ui/assets/study-game/ → control-ui/study-game/（页面按脚本所在目录取）和包内 ui/assets/study-game/。
index.html 只动自己的行：在背一背脚本后面插游戏的标签（?v=VERSION），改过的两个已有前端文件换成 VERSION；包内 setup.py 补后端文件名。
不带参数是真部署：先备份（learning/ 快照 + 每个要动的文件 + 签名目录），再写、重新签名。--check 只试跑。
后端改动要完整重启网关才生效（杀掉 18789 的进程，App 会拉起），那一步在脚本外做。"""
import datetime, hashlib, json, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ARGS = sys.argv[1:]
CHECK = '--check' in ARGS
REV = next((a.split('=', 1)[1] for a in ARGS if a.startswith('--rev=')), 'review/study-game')
# --base：三方合并的共同祖先 = 线上那份上次装的是哪个提交（默认 069c5cc；上次装过游戏就传那次的 --rev，例如 game3 = 4121bdc）。
# 文件清单仍按 069c5cc → REV 算（新文件整份覆盖，不受影响）。
MERGE_BASE = next((a.split('=', 1)[1] for a in ARGS if a.startswith('--base=')), None)
if [a for a in ARGS if a != '--check' and not a.startswith(('--rev=', '--base='))]:
    sys.exit('用法：deploy-game.py [--check] [--rev=<提交>] [--base=<线上上次装的提交>]')

home = Path.home()
repo = Path('/Users/Admin/release-superpinkie/repo')
app = Path('/Applications/超級碧琪.app')
root = app / 'Contents/Resources/SuperPinkie'
ui = root / 'runtime/openclaw/dist/control-ui'
ext = home / '.openclaw/extensions/pinkie-mode-architecture'
learning_data = home / 'Library/Application Support/SuperPinkie/learning'
stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
backup = home / 'Library/Application Support/SuperPinkie/backups' / ('study-game-' + stamp)
BASE = '069c5cc'
MERGE_BASE = MERGE_BASE or BASE
VERSION = 'game7'


def git(*a, text=False):
    return subprocess.run(['git', '-C', str(repo), *a], capture_output=True, check=True, text=text).stdout


def show(rev, rel):
    return git('show', f'{rev}:{rel}')


def branded(data):
    return data.decode().replace('Li An', '碧琪').encode()


changed = git('diff', '--name-only', BASE, REV, text=True).split()
NEW_BACKEND = sorted(Path(p).name for p in changed if re.match(r'services/mode-architecture/learning-game[\w.-]*\.(mjs|json)$', p))
MERGE_BACKEND = sorted(Path(p).name for p in changed if re.match(r'services/mode-architecture/learning[\w.-]*\.mjs$', p) and not Path(p).name.startswith('learning-game'))
NEW_UI = sorted(Path(p).name for p in changed if re.match(r'ui/injections/(laolao-game-[\w-]+\.(js|css)|laolao-vendor-three-addons\.module\.min\.js)$', p))
MERGE_UI = sorted(Path(p).name for p in changed if re.match(r'ui/injections/laolao-[\w.-]+\.(js|css)$', p) and Path(p).name not in NEW_UI)
ASSETS = sorted(p for p in git('ls-tree', '-r', '--name-only', REV, 'ui/assets/study-game', text=True).split())
for name in MERGE_BACKEND + MERGE_UI:
    assert git('cat-file', '-e', f'{BASE}:{"services/mode-architecture" if name.startswith("learning") else "ui/injections"}/{name}') is not None


def same_versions(ours, base):
    known = {}
    for name, version in re.findall(rb"(laolao-[\w.-]+\.(?:js|css))\?v=([\w.-]+)", base):
        known.setdefault(name, version)
    return re.sub(rb"(laolao-[\w.-]+\.(?:js|css))\?v=([\w.-]+)", lambda m: m.group(1) + b'?v=' + known.get(m.group(1), m.group(2)), ours)


def merge(ours, base, theirs, label):
    ours = same_versions(ours, base)
    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for name, data in (('ours', ours), ('base', base), ('theirs', theirs)):
            p = Path(tmp) / name; p.write_bytes(data); paths.append(str(p))
        result = subprocess.run(['git', 'merge-file', '-p', '-L', 'live', '-L', 'base', '-L', 'game', *paths], capture_output=True)
        if result.returncode == 0:
            return result.stdout
        raise SystemExit(f'{label}: 三方合并有 {result.returncode} 处冲突，停下不写。\n' + result.stdout.decode()[:1500])


copies, report = [], {}
for name in NEW_BACKEND:
    data = show(REV, f'services/mode-architecture/{name}')
    assert b'Li An' not in data, f'{name} 里有 Li An'
    for d in (ext, root / 'services/mode-architecture'):
        copies.append((d / name, data)); report[str(d / name)] = 'replace' if (d / name).exists() else 'new'
for name in MERGE_BACKEND:
    base, theirs = branded(show(MERGE_BASE, f'services/mode-architecture/{name}')), branded(show(REV, f'services/mode-architecture/{name}'))
    for d in (ext, root / 'services/mode-architecture'):
        live = (d / name).read_bytes(); out = merge(live, base, theirs, str(d / name))
        assert b'Li An' not in out, f'{d / name} 合并后还有 Li An'
        copies.append((d / name, out)); report[str(d / name)] = 'same' if out == live else ('clean' if live == base else 'merged')
for name in NEW_UI:
    data = show(REV, f'ui/injections/{name}')
    for d in (ui, root / 'ui/injections'):
        copies.append((d / name, data)); report[str(d / name)] = 'replace' if (d / name).exists() else 'new'
for name in MERGE_UI:
    base, theirs = show(MERGE_BASE, f'ui/injections/{name}'), show(REV, f'ui/injections/{name}')
    for d in (ui, root / 'ui/injections'):
        live = (d / name).read_bytes(); out = merge(live, base, theirs, str(d / name))
        copies.append((d / name, out)); report[str(d / name)] = 'same' if out == live else ('clean' if live == base else 'merged')
asset_bytes = 0
for rel in ASSETS:
    data = show(REV, rel); asset_bytes += len(data); sub = rel.split('ui/assets/study-game/', 1)[1]
    for d in (ui / 'study-game', root / 'ui/assets/study-game'):
        copies.append((d / sub, data))

# index.html：改过的已有前端文件换版本号；游戏标签插在背一背脚本后面（按 head fragment 的顺序）。
index = ui / 'index.html'
index_text = index.read_text()
new_index = index_text
for name in MERGE_UI:
    pattern = re.compile(r'((?:href|src)="(?:\./|/)' + re.escape(name) + r')\?v=([^"]+)"')
    if len(pattern.findall(new_index)) == 1:
        new_index = pattern.sub(lambda m: f'{m.group(1)}?v={VERSION}"', new_index)
fragment = show(REV, 'ui/injections/laolao-head.fragment.html').decode()
game_tags = [line.strip() for line in fragment.splitlines() if 'laolao-game-' in line]
assert game_tags, 'head fragment 里没有游戏标签'
drill = re.search(r'([ \t]*)<script defer src="(\.?/)laolao-study-desk-drill\.js\?v=[^"]+"></script>', new_index)
assert drill, 'index.html 里找不到背一背脚本'
indent, prefix = drill.group(1), drill.group(2)
new_index = re.sub(r'\n[ \t]*<(?:link|script)[^\n]*laolao-game-[\w-]+\.(?:js|css)\?v=[^"]+"[^\n]*', '', new_index)
tags = [re.sub(r'(?:href|src)="/', lambda m: m.group(0)[:-1] + prefix, re.sub(r'\?v=[\w.-]+', f'?v={VERSION}', t)) for t in game_tags]
drill = re.search(r'[ \t]*<script defer src="(\.?/)laolao-study-desk-drill\.js\?v=[^"]+"></script>', new_index)
new_index = new_index.replace(drill.group(0), drill.group(0) + ''.join('\n' + indent + t for t in tags), 1)
for name in [n for n in NEW_UI if n.endswith(('.js', '.css')) and 'vendor' not in n]:
    assert new_index.count(f'{name}?v={VERSION}') == 1, f'index.html 里 {name} 标签数不对'

setup = root / 'services/mode-architecture/setup.py'
setup_text = setup.read_text(); new_setup = setup_text
missing = [n for n in NEW_BACKEND if f'"{n}"' not in new_setup]
if missing:
    anchor = '"learning-drill.mjs", '
    assert new_setup.count(anchor) == 1, 'setup.py 里找不到 learning-drill.mjs'
    new_setup = new_setup.replace(anchor, anchor + ''.join(f'"{n}", ' for n in missing), 1)
compile(new_setup, str(setup), 'exec')

# 用 App 自带的 node + jiti 试加载合并后的后端（learning.mjs 要能把 game 注册上）。
staging = Path(tempfile.mkdtemp(prefix='game-probe-'))
try:
    for target, data in copies:
        if target.parent == ext: (staging / target.name).write_bytes(data)
    for dep in list(ext.glob('*.mjs')) + list(ext.glob('*.json')):
        if not (staging / dep.name).exists(): shutil.copy2(dep, staging / dep.name)
    if (ext / 'vendor').is_dir(): (staging / 'vendor').symlink_to(ext / 'vendor')
    jiti = root / 'runtime/openclaw/node_modules/jiti'
    probe = "const {createJiti}=require(process.argv[1]);const j=createJiti(process.argv[2]+'/x.cjs');for(const f of process.argv.slice(3))j(process.argv[2]+'/'+f);"
    loaded = subprocess.run([str(root / 'runtime/bin/node'), '-e', probe, str(jiti), str(staging), *NEW_BACKEND[:0], 'learning-game.mjs', 'learning-pact.mjs', 'learning-drill.mjs', 'learning.mjs'], capture_output=True, text=True)
    assert loaded.returncode == 0, 'jiti 试加载失败：' + loaded.stderr[-1500:]
    assert 'learning-game' in (staging / 'learning.mjs').read_text(), '合并后的 learning.mjs 没有接游戏'
finally:
    shutil.rmtree(staging, ignore_errors=True)
with tempfile.TemporaryDirectory() as tmp:
    for i, (target, data) in enumerate(copies):
        if target.suffix != '.js' or 'vendor' in target.name: continue
        f = Path(tmp) / f'{i}.cjs'; f.write_bytes(data)
        checked = subprocess.run([str(root / 'runtime/bin/node'), '--check', str(f)], capture_output=True)
        if checked.returncode != 0:
            raise SystemExit(f'{target}: 语法检查失败 {checked.stderr.decode()[-400:]}')

touched = [t for t, data in copies if not t.is_file() or t.read_bytes() != data]
plan = {'rev': git('rev-parse', '--short', REV, text=True).strip(), 'version': VERSION, 'newBackend': NEW_BACKEND, 'mergeBackend': MERGE_BACKEND, 'newUi': NEW_UI, 'mergeUi': MERGE_UI,
        'assets': len(ASSETS), 'assetMB': round(asset_bytes / 1e6, 1), 'copies': len(copies), 'changed': len(touched), 'indexChanged': new_index != index_text, 'setupChanged': new_setup != setup_text,
        'files': {k: v for k, v in report.items()}}
if CHECK:
    print(json.dumps({'check': 'passed', **plan}, ensure_ascii=False, indent=1)); sys.exit(0)

backup.mkdir(parents=True)
shutil.copytree(learning_data, backup / 'learning')
manifest = []
for i, target in enumerate([t for t, _ in copies if not str(t).count('/study-game/')] + [index, setup]):
    manifest.append({'target': str(target), 'existed': target.is_file(), 'saved': f'files/{i}' if target.is_file() else None})
    if target.is_file():
        saved = backup / 'files' / str(i); saved.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(target, saved)
manifest.append({'assets': [str(ui / 'study-game'), str(root / 'ui/assets/study-game')], 'note': '新目录，回滚时整个删掉'})
(backup / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
shutil.copytree(app / 'Contents/_CodeSignature', backup / '_CodeSignature')
for target, data in copies:
    target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
index.write_text(new_index); setup.write_text(new_setup)
with (backup / 'codesign.log').open('w') as out:
    subprocess.run(['codesign', '--force', '--options', 'runtime', '--sign', '-', '--requirements', '=designated => identifier "com.cle0726.super-pinkie"', str(app)], stdout=out, stderr=subprocess.STDOUT, check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], stdout=out, stderr=subprocess.STDOUT, check=True)
sha = lambda b: hashlib.sha256(b).hexdigest()
assert not [str(t) for t, data in copies if sha(t.read_bytes()) != sha(data)]
print(json.dumps({'installed': True, 'backup': str(backup), **{k: v for k, v in plan.items() if k != 'files'}, 'codesign': 'deep strict passed'}, ensure_ascii=False, indent=1))
