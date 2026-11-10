#!/usr/bin/env node
// 人格安装器会把 playbooks 复制到四个工作区；从同一份源码生成可独立运行的副本。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const groups = ['docs-write', 'pdf', 'image', 'screenshot', 'video', 'tts'];
const files = [
  ['toolbox.mjs', 'toolbox.mjs'], ['toolbox-manifest.json', 'toolbox-manifest.json'], ['toolbox-download.mjs', 'toolbox-download.mjs'],
  ...groups.map(group => [`requirements/${group}.lock`, `toolbox-lock-${group}.txt`]),
];
const check = process.argv.includes('--check');
let different = false;
for (const mode of ['chat', 'project', 'thinking', 'learning']) {
  const target = path.join(repo, 'personas', mode, 'playbooks');
  for (const [source, dest] of files) {
    const data = fs.readFileSync(path.join(here, source));
    const file = path.join(target, dest);
    if (check) {
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(data)) { console.error(`${mode}: ${dest} 不是最新副本`); different = true; }
    } else fs.writeFileSync(file, data);
  }
}
if (different) process.exitCode = 1;
