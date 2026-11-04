#!/usr/bin/env node
// 下载账本：碧琪为了做活自己下载/安装的东西都记在这里，作品交付后再问先生要不要删。
// 用法（node 是碧琪自带的，Mac / Windows 一样）：
//   node downloads.mjs add --path <装在哪> --what <是什么> [--for <为了哪件活>] [--source <从哪下的>]
//   node downloads.mjs list [--pending] [--json]
//   node downloads.mjs ask [--for <活>]          生成一句交付后问先生的话（没有要问的就什么都不说）
//   node downloads.mjs keep <编号|路径|all>       先生说留着：以后不再问
//   node downloads.mjs remove <编号|路径|pending> 先生说删：移进废纸篓 / 回收站
// 账本位置：$PINKIE_DOWNLOADS_LEDGER，或 <OpenClaw 状态目录>/pinkie/downloads.json。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HOME = os.homedir();

export function ledgerPath(env = process.env) {
  if (env.PINKIE_DOWNLOADS_LEDGER) return path.resolve(env.PINKIE_DOWNLOADS_LEDGER);
  const state = env.OPENCLAW_STATE_DIR ? path.resolve(env.OPENCLAW_STATE_DIR) : path.join(HOME, '.openclaw');
  return path.join(state, 'pinkie', 'downloads.json');
}

export function load(file = ledgerPath()) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && Array.isArray(data.items)) return data;
  } catch {}
  return {version: 1, items: []};
}

export function save(data, file = ledgerPath()) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function sizeOf(target) {
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

export function human(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

// 绝不删的地方：根目录、主目录本身和它下面的常用大文件夹、碧琪工作区本身。
export function isProtected(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) return true;
  const roots = [HOME, ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Videos', 'Library', 'AppData', '.openclaw', 'Applications'].map(n => path.join(HOME, n))];
  if (roots.some(r => path.resolve(r).toLowerCase() === resolved.toLowerCase())) return true;
  if (/^[a-z]:\\?$/i.test(resolved)) return true;
  if (['/Applications', '/System', '/usr', '/opt', '/bin', '/etc', '/Library', 'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)'].some(r => resolved.toLowerCase() === r.toLowerCase())) return true;
  return /[\\/]\.openclaw[\\/]workspace[^\\/]*$/.test(resolved);
}

function moveToTrash(target) {
  if (process.platform === 'win32') {
    const kind = fs.statSync(target).isDirectory() ? 'DeleteDirectory' : 'DeleteFile';
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${kind}($env:PINKIE_TRASH_TARGET, 'OnlyErrorDialogs', 'SendToRecycleBin')`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {env: {...process.env, PINKIE_TRASH_TARGET: target}, encoding: 'utf8'});
    if (result.status !== 0 || fs.existsSync(target)) throw new Error((result.stderr || '移进回收站失败').trim());
    return;
  }
  const trash = process.platform === 'darwin' ? path.join(HOME, '.Trash') : path.join(HOME, '.local', 'share', 'Trash', 'files');
  fs.mkdirSync(trash, {recursive: true});
  const base = path.basename(target);
  let dest = path.join(trash, base);
  if (fs.existsSync(dest)) dest = path.join(trash, `${base} ${new Date().toISOString().replace(/[:.]/g, '-')}`);
  try {
    fs.renameSync(target, dest);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    if (process.platform === 'darwin') {
      const result = spawnSync('osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', target], {encoding: 'utf8'});
      if (result.status !== 0) throw new Error((result.stderr || '移进废纸篓失败').trim());
    } else {
      fs.cpSync(target, dest, {recursive: true});
      fs.rmSync(target, {recursive: true, force: true});
    }
  }
}

function findItem(data, key) {
  const n = Number(key);
  if (Number.isInteger(n) && n > 0) return data.items.find(i => i.id === n);
  const resolved = path.resolve(key);
  return data.items.find(i => path.resolve(i.path) === resolved);
}

export function pending(data) {
  return data.items.filter(i => !i.keep && !i.removed && fs.existsSync(i.path));
}

export function add(data, {path: target, what, for: task = '', source = ''}) {
  if (!target || !what) throw new Error('add 要写 --path 和 --what');
  const resolved = path.resolve(target);
  if (isProtected(resolved)) throw new Error(`${resolved} 是系统或先生的大文件夹，不能登记成可删的下载`);
  const now = new Date().toISOString();
  let item = data.items.find(i => path.resolve(i.path) === resolved && !i.removed);
  if (!item) {
    item = {id: (data.items.reduce((m, i) => Math.max(m, i.id), 0) || 0) + 1, path: resolved, what, for: [], source, added: now, keep: false, removed: null, size: 0};
    data.items.push(item);
  }
  item.what = what || item.what;
  if (source) item.source = source;
  if (task && !item.for.includes(task)) item.for.push(task);
  item.lastUsed = now;
  item.size = sizeOf(resolved);
  return item;
}

export function askLine(data, task = '') {
  let items = pending(data);
  if (task) {
    const mine = items.filter(i => i.for.includes(task));
    if (mine.length) items = mine;
  }
  if (!items.length) return '';
  for (const item of items) item.size = sizeOf(item.path);
  const total = items.reduce((s, i) => s + i.size, 0);
  const list = items.map(i => `${i.what}（${human(i.size)}）`).join('、');
  const why = task ? `这次为了「${task}」` : '这几次做活';
  return `${why}下载了：${list}，一共 ${human(total)}。留着的话下次做同类的东西会快很多；要删掉吗？`;
}

function parse(argv) {
  const [command = 'list', ...rest] = argv;
  const flags = {}, args = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else args.push(token);
  }
  return {command, flags, args};
}

export function main(argv = process.argv.slice(2), out = console.log) {
  const {command, flags, args} = parse(argv);
  const file = ledgerPath();
  const data = load(file);
  if (command === 'add') {
    const item = add(data, flags);
    save(data, file);
    out(`已记下 #${item.id}：${item.what}（${human(item.size)}）在 ${item.path}`);
    return 0;
  }
  if (command === 'list') {
    const items = flags.pending ? pending(data) : data.items;
    if (flags.json) { out(JSON.stringify(items, null, 2)); return 0; }
    if (!items.length) { out('账本里没有东西。'); return 0; }
    for (const i of items) {
      const state = i.removed ? `已删（${i.removed.slice(0, 10)}）` : i.keep ? '留着' : fs.existsSync(i.path) ? '待问' : '已不在';
      out(`#${i.id}  ${state}  ${human(i.removed ? i.size : sizeOf(i.path))}  ${i.what}  ${i.path}${i.for.length ? `  为了：${i.for.join('、')}` : ''}`);
    }
    return 0;
  }
  if (command === 'ask') {
    const line = askLine(data, typeof flags.for === 'string' ? flags.for : '');
    save(data, file);
    if (line) out(line);
    return 0;
  }
  if (command === 'keep' || command === 'remove') {
    const key = args[0];
    if (!key) throw new Error(`${command} 要写编号、路径，或 ${command === 'keep' ? 'all' : 'pending'}`);
    const targets = (key === 'all' || key === 'pending') ? pending(data) : [findItem(data, key)].filter(Boolean);
    if (!targets.length) { out('没找到要处理的条目。'); return 1; }
    let freed = 0;
    for (const item of targets) {
      if (command === 'keep') { item.keep = true; out(`#${item.id} ${item.what}：留着，以后不再问。`); continue; }
      if (isProtected(item.path)) { out(`#${item.id} ${item.path} 是受保护的位置，不删。`); continue; }
      if (!fs.existsSync(item.path)) { item.removed = new Date().toISOString(); out(`#${item.id} ${item.what}：已经不在了。`); continue; }
      const size = sizeOf(item.path);
      moveToTrash(item.path);
      item.size = size; item.removed = new Date().toISOString(); freed += size;
      out(`#${item.id} ${item.what}：已移进${process.platform === 'win32' ? '回收站' : '废纸篓'}（${human(size)}）。`);
    }
    save(data, file);
    if (command === 'remove' && freed) out(`一共腾出 ${human(freed)}。`);
    return 0;
  }
  out('用法：add / list / ask / keep / remove（见文件开头的说明）');
  return 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
