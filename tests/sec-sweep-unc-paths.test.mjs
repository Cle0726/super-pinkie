// 安全普查（app/）：模型给出的 \\host\share 或 //host 路径不能先被解析再拒绝。
// Windows 上对 UNC 路径做 resolve/stat 就会连对方的 SMB 共享并递上 NTLM 凭据，
// 而交付卡片渲染后会自动发 check、浏览器 show_file 的路径来自智能体工具调用，都不需要用户点击。
// 这里在 Linux 上记录每一次 Path.resolve：两条入口都必须直接拒绝，且一次都不能碰到这类路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHECK = String.raw`
import importlib.util, json, pathlib, sys, tempfile
from unittest import mock
repo = pathlib.Path(sys.argv[1])
sys.path.insert(0, str(repo / 'app'))
spec = importlib.util.spec_from_file_location('sec_sweep_windows_desktop', repo / 'app' / 'windows_desktop.py')
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)
import inapp_browser_host as host

remote = [r'\\attacker.example\share\x.png', '//attacker.example/share/x.png',
          r'\\?\UNC\attacker.example\share\x.png', r'/\attacker.example\share\x.png']
touched = []
original = pathlib.Path.resolve
def spy(self, *args, **kwargs):
    text = str(self)
    if len(text) > 1 and text[0] in '\\/' and text[1] in '\\/':
        touched.append(text)
    return original(self, *args, **kwargs)

out = {'bridge': {}, 'host': {}}
with tempfile.TemporaryDirectory() as temp:
    home = pathlib.Path(temp).resolve()
    (home / 'ok.txt').write_text('fine', encoding='utf-8')
    bridge = desktop.NativeBridge(None)
    with mock.patch.object(pathlib.Path, 'home', return_value=home), mock.patch.object(pathlib.Path, 'resolve', spy):
        for raw in remote:
            out['bridge'][raw] = bool(bridge.preview_material({'action': 'check', 'path': raw}).get('ok'))
            try:
                host.safe_home_file(raw)
                out['host'][raw] = True
            except ValueError:
                out['host'][raw] = False
        out['bridgeHomeFile'] = bool(bridge.preview_material({'action': 'check', 'path': str(home / 'ok.txt')}).get('ok'))
        out['hostHomeFile'] = str(host.safe_home_file(str(home / 'ok.txt'))) == str(home / 'ok.txt')
out['touched'] = touched
print(json.dumps(out))
`;

test('UNC and device paths are rejected before anything resolves them', () => {
  const run = spawnSync('python3', ['-I', '-c', CHECK, repo], {encoding: 'utf8', timeout: 60_000});
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.deepEqual(result.touched, [], 'a remote path reached Path.resolve');
  for (const [raw, ok] of Object.entries(result.bridge)) assert.equal(ok, false, 'preview_material accepted ' + raw);
  for (const [raw, ok] of Object.entries(result.host)) assert.equal(ok, false, 'safe_home_file accepted ' + raw);
  assert.equal(result.bridgeHomeFile, true, 'an ordinary home file must still pass preview_material');
  assert.equal(result.hostHomeFile, true, 'an ordinary home file must still pass safe_home_file');
});
