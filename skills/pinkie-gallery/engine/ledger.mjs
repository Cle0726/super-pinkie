// 把成品库自己下载的东西记进下载账本（格式和 playbooks/downloads.mjs 一致），交付后由碧琪问先生要不要删。
import fs from 'node:fs';
import path from 'node:path';
import {ledgerPath} from './paths.mjs';

function sizeOf(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    let stat;
    try { stat = fs.lstatSync(current); } catch { continue; }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      let names = [];
      try { names = fs.readdirSync(current); } catch {}
      for (const name of names) stack.push(path.join(current, name));
    } else total += stat.size;
  }
  return total;
}

export function record({target, what, task = '', source = ''}) {
  try {
    const file = ledgerPath();
    let data = {version: 1, items: []};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && Array.isArray(parsed.items)) data = parsed;
    } catch {}
    const resolved = path.resolve(target);
    const now = new Date().toISOString();
    let item = data.items.find(i => path.resolve(i.path) === resolved && !i.removed);
    if (!item) {
      item = {id: data.items.reduce((m, i) => Math.max(m, i.id), 0) + 1, path: resolved, what, for: [], source, added: now, keep: false, removed: null, size: 0};
      data.items.push(item);
    }
    if (task && !item.for.includes(task)) item.for.push(task);
    if (source) item.source = source;
    item.what = what;
    item.lastUsed = now;
    item.size = sizeOf(resolved);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // 账本写不进去不影响出图；碧琪交付时照样可以用 downloads.mjs 补登记。
  }
}
