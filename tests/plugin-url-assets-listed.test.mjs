// B7 (HOTSPOTS #2 installer/macos/apply-theme.sh, also services/mode-architecture/setup.py):
// the plugin is copied file by file from two hand-written lists, and new files kept
// getting left out (2b1a79a8 metre-plan-mode.mjs, 55ae276b engines-upstream.mjs,
// 9a04116a desktop-apps.mjs). plugin-file-lists.test.mjs follows `import ... from './x'`
// from index.mjs, but not files a module opens itself with
// `new URL('./x.json', import.meta.url)` (learning-zsb-data.json, learning-engine.py, ...).
// Drop one from a list and that test stays green while the installed plugin throws
// on load (most of these are read at module top level). This walks the same import
// graph and requires every such file in both lists too.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'services', 'mode-architecture');
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.\/[^'"]+)['"]|import\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;
const URL_REF = /new URL\(\s*['"`](\.\/[A-Za-z0-9_.-]+)['"`]\s*,\s*import\.meta\.url\s*\)/g;

function urlAssets() {
  const seen = new Set();
  const assets = new Map();
  const queue = ['index.mjs'];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const target = path.posix.normalize(m[1] || m[2]);
      if (!target.includes('/') && fs.existsSync(path.join(dir, target))) queue.push(target);
    }
    for (const m of text.matchAll(URL_REF)) {
      const target = path.posix.normalize(m[1]);
      if (target.includes('/')) continue;
      if (!assets.has(target)) assets.set(target, name);
      if (/\.(mjs|js)$/.test(target)) queue.push(target);
    }
  }
  return assets;
}

test('files the plugin opens via new URL(..., import.meta.url) exist and are copied on Windows and Mac', () => {
  const assets = urlAssets();
  assert.ok(assets.size >= 5, `found only ${assets.size} new URL(..., import.meta.url) files; did the pattern change?`);
  const windows = fs.readFileSync(path.join(dir, 'setup.py'), 'utf8');
  const mac = fs.readFileSync(path.join(root, 'installer', 'macos', 'apply-theme.sh'), 'utf8');
  const inMac = (name) => new RegExp(`\\s${name.replace(/[.]/g, '\\.')}[\\s;]`).test(mac);
  const rows = [...assets].map(([name, from]) => `${name} (${from})`);
  const absent = [...assets.keys()].filter((n) => !fs.existsSync(path.join(dir, n)));
  const missingWindows = rows.filter((r, i) => !windows.includes(`"${[...assets.keys()][i]}"`));
  const missingMac = rows.filter((r, i) => !inMac([...assets.keys()][i]));
  assert.deepEqual(absent, [], 'referenced but not in services/mode-architecture');
  assert.deepEqual(missingWindows, [], 'services/mode-architecture/setup.py 的复制清单少了这些文件');
  assert.deepEqual(missingMac, [], 'installer/macos/apply-theme.sh 的复制清单少了这些文件');
});
