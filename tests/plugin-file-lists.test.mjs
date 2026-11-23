import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 插件文件是按两份手写清单复制进安装目录的（Windows：setup.py；Mac：apply-theme.sh）。
// 新文件忘了登记，装好的插件就缺文件，网关加载时整个插件起不来（用户说的「漏插件」）。
// 这里从 index.mjs 顺着 import 找出实际用到的每个文件，两份清单都必须有。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'services', 'mode-architecture');
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.\/[^'"]+)['"]|import\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;

function closure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const match of text.matchAll(IMPORT)) {
      const target = path.posix.normalize(match[1] || match[2]);
      if (!target.includes('/') && /\.(mjs|js|json)$/.test(target) && fs.existsSync(path.join(dir, target))) queue.push(target);
    }
  }
  return [...seen];
}

test('every plugin module that index.mjs loads is copied on both Windows and Mac', () => {
  const used = closure('index.mjs');
  assert.ok(used.length > 20, 'found the import graph');
  const windows = fs.readFileSync(path.join(dir, 'setup.py'), 'utf8');
  const mac = fs.readFileSync(path.join(root, 'installer', 'macos', 'apply-theme.sh'), 'utf8');
  const missingWindows = used.filter(name => !windows.includes(`"${name}"`));
  const missingMac = used.filter(name => !new RegExp(`[\\s]${name.replace(/[.]/g, '\\.')}[\\s;]`).test(mac));
  assert.deepEqual(missingWindows, [], 'services/mode-architecture/setup.py 的复制清单少了这些文件');
  assert.deepEqual(missingMac, [], 'installer/macos/apply-theme.sh 的复制清单少了这些文件');
});
