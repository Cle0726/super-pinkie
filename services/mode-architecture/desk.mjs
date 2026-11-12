// computer_flow：操控电脑上的软件（Mac 和 Windows 的 App / exe 都行），不用每次现写脚本。
//
// 为什么要有：用户反映碧琪操控电脑又慢又不准。查下来两个原因。一是 Mac 上的 computer 工具一次只做一个动作，
// 「打开软件、等窗口、点菜单、输入、保存」要来回十几轮；二是 Windows 上根本没有桌面执行器，每次都靠模型
// 现写 PowerShell（找窗口、UIAutomation、发按键），小模型写得慢、常写错，写对了下次还得重写。
//
// 这里把这些动作做成引擎里写好、测过的现成动作，三样东西解决慢和不准：
//   1. 现成动作：打开软件、找窗口、按名字点控件、填输入框、按快捷键、打字、截图、剪贴板……模型只填参数。
//   2. 一次连做多步：steps 里按顺序列出来，一轮做完，中间失败就停在那一步并说明原因，最后回报当前窗口。
//   3. 存成流程：跑通的一串步骤起个名字存下来（带 {{变量}}），下次同样的事一步重放；流程是存在这台电脑上的，
//      所以天然就是「按这台电脑调好的」——软件叫什么、按钮叫什么、要等多久，都是在这台机器上试出来的。
//
// 控件按名字找（系统的辅助功能接口：Mac 是 System Events，Windows 是 UIAutomation），不靠截图猜坐标，所以准。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {DESK_PS1, comboToVk} from './desk-win.mjs';

const OPS = Object.freeze({
  windows: {}, open_app: {need: ['name']}, open: {need: ['target']}, close_app: {need: ['name']}, focus: {need: ['window']},
  wait_window: {need: ['window']}, window_set: {need: ['window']}, keys: {need: ['keys']}, type: {need: ['text']},
  click: {need: ['x', 'y']}, ui: {}, ui_click: {need: ['name']}, ui_set: {need: ['name', 'value']}, menu: {need: ['app', 'path']},
  clipboard_get: {}, clipboard_set: {need: ['text']}, screenshot: {}, wait: {need: ['ms']},
});
export const DESK_OPS = Object.freeze(Object.keys(OPS));
const MAX_STEPS = 40;

const stateRoot = () => process.env.PINKIE_STATE_ROOT || path.join(os.homedir(), 'Library/Application Support/SuperPinkie');
const deskDir = () => path.join(stateRoot(), 'desk');

// {{变量}} 换成 vars 里的值；缺变量就报出来，不带着花括号去执行。
export function fillVars(value, vars = {}) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\p{L}\p{N}_-]+)\s*\}\}/gu, (_, name) => {
      if (vars[name] == null) throw new Error(`这个流程需要变量「${name}」，用 vars 传进来。`);
      return String(vars[name]);
    });
  }
  if (Array.isArray(value)) return value.map(item => fillVars(item, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillVars(item, vars)]));
  return value;
}

export function normalizeSteps(steps, {platform = process.platform, shotDir = path.join(deskDir(), 'shots'), now = Date.now()} = {}) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('steps 要是一个至少有一步的列表，每一步形如 {"op": "open_app", "name": "记事本"}。');
  if (steps.length > MAX_STEPS) throw new Error(`一次最多 ${MAX_STEPS} 步；更长的拆成几次，或者存成几个流程。`);
  return steps.map((raw, index) => {
    const step = raw && typeof raw === 'object' ? {...raw} : {};
    const spec = OPS[step.op];
    if (!spec) throw new Error(`第 ${index + 1} 步的 op「${step.op}」不认识。可用的：${DESK_OPS.join('、')}。`);
    for (const key of spec.need || []) if (step[key] == null || step[key] === '') throw new Error(`第 ${index + 1} 步（${step.op}）缺参数 ${key}。`);
    if (step.op === 'keys') {
      const combos = (Array.isArray(step.keys) ? step.keys : String(step.keys).split(/\s+/)).filter(Boolean);
      step.combos = combos;
      if (platform === 'win32') step.vk = combos.map(comboToVk);
      else combos.forEach(macCombo);
    }
    if (step.op === 'screenshot' && !step.path) step.path = path.join(shotDir, `shot-${now}-${index + 1}.png`);
    if (step.op === 'menu' && !Array.isArray(step.path)) step.path = String(step.path).split(/\s*[>›→/]\s*/).filter(Boolean);
    if (step.op === 'menu' && platform === 'win32') throw new Error(`第 ${index + 1} 步：Windows 上没有 menu 这个动作。用 ui_click 按名字点菜单项（先点「文件」，再点「另存为」），或者直接用快捷键 keys。`);
    if (step.op === 'click' && platform === 'darwin') throw new Error(`第 ${index + 1} 步：Mac 上按坐标点击用 computer 工具的 click；这里按名字点控件用 ui_click。`);
    return step;
  });
}

/* ───────── Mac：System Events（JXA）、open、screencapture、pbcopy ───────── */

const MAC_KEYCODE = Object.freeze({enter: 36, return: 36, tab: 48, esc: 53, escape: 53, space: 49, backspace: 51, delete: 117, del: 117, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111});
const MAC_MOD = Object.freeze({cmd: 'command down', command: 'command down', mod: 'command down', ctrl: 'control down', control: 'control down', shift: 'shift down', alt: 'option down', option: 'option down'});

// "cmd+shift+s" → {key 或 code, using:[…]}
export function macCombo(combo = '') {
  const parts = String(combo).toLowerCase().split('+').map(part => part.trim()).filter(Boolean);
  const using = [], keys = [];
  for (const part of parts) { if (MAC_MOD[part]) using.push(MAC_MOD[part]); else keys.push(part); }
  if (keys.length !== 1) throw new Error(`按键组合「${combo}」要有且只有一个主键，例如 cmd+s、cmd+shift+z、enter。`);
  const key = keys[0];
  if (MAC_KEYCODE[key] != null) return {code: MAC_KEYCODE[key], using};
  if (key.length === 1) return {key, using};
  throw new Error(`不认识的按键「${key}」。可用：cmd、ctrl、shift、alt、enter、tab、esc、space、backspace、delete、方向键、home、end、pageup、pagedown、f1–f12、单个字母数字符号。`);
}

const JXA_LIB = `
const se = Application('System Events');
function proc(q) {
  const all = se.processes.whose({backgroundOnly: false})();
  if (!q) { const front = all.find(p => p.frontmost()); if (front) return front; throw new Error('NO_WINDOW: 没给窗口名，也找不到最前面的软件'); }
  const lower = q.toLowerCase();
  const names = all.map(p => p.name());
  let at = names.findIndex(n => n.toLowerCase() === lower);
  if (at < 0) at = names.findIndex(n => n.toLowerCase().includes(lower));
  if (at < 0) at = all.findIndex(p => { try { return p.windows().some(w => (w.name() || '').toLowerCase().includes(lower)); } catch (e) { return false; } });
  if (at < 0) throw new Error('NO_WINDOW: 没有打开的软件或窗口对得上「' + q + '」。现在开着的：' + names.join('、'));
  return all[at];
}
function props(el) { try { return el.properties(); } catch (e) { return null; } }
function label(pr) {
  for (const f of ['name', 'title', 'description', 'value']) { const v = pr[f]; if (typeof v === 'string' && v) return v; }
  return '';
}
function elements(p) { const w = p.windows[0]; try { return w.entireContents(); } catch (e) { throw new Error('NO_WINDOW: 「' + p.name() + '」没有打开的窗口'); } }
function match(p, name, type) {
  const exact = [], loose = [];
  for (const el of elements(p)) {
    const pr = props(el); if (!pr) continue;
    const role = pr.role || '';
    if (type && role !== type && role !== 'AX' + type) continue;
    const text = label(pr);
    const hit = {el, role, text, pr};
    if (!name) { loose.push(hit); continue; }
    if (text === name) exact.push(hit); else if (text && text.includes(name)) loose.push(hit);
  }
  return exact.length ? exact : loose;
}
`;
const JXA = Object.freeze({
  windows: `${JXA_LIB} JSON.stringify({windows: se.processes.whose({backgroundOnly: false})().map(p => { let t = ''; try { t = p.windows().map(w => w.name()).filter(Boolean)[0] || ''; } catch (e) {} return {app: p.name(), title: t}; })})`,
  front: `${JXA_LIB} (() => { try { const p = proc(''); let t = ''; try { t = p.windows[0].name(); } catch (e) {} return p.name() + (t ? ': ' + t : ''); } catch (e) { return ''; } })()`,
  focus: `${JXA_LIB} function run(argv) { const p = proc(argv[0]); p.frontmost = true; return JSON.stringify({focused: p.name()}); }`,
  close_app: `${JXA_LIB} function run(argv) { const p = proc(argv[0]); const n = p.name(); Application(n).quit(); return JSON.stringify({closed: n}); }`,
  window_set: `${JXA_LIB} function run(argv) { const s = JSON.parse(argv[0]); const p = proc(s.window); const w = p.windows[0]; if (s.x != null && s.y != null) w.position = [s.x, s.y]; if (s.w != null && s.h != null) w.size = [s.w, s.h]; const pos = w.position(), size = w.size(); return JSON.stringify({window: p.name(), rect: [pos[0], pos[1], size[0], size[1]]}); }`,
  ui: `${JXA_LIB} function run(argv) { const s = JSON.parse(argv[0]); const p = proc(s.window); const max = s.max || 120; const skip = new Set(['AXGroup', 'AXScrollArea', 'AXSplitGroup', 'AXImage', 'AXUnknown', 'AXScrollBar', 'AXSplitter', 'AXLayoutArea']); const found = match(p, s.filter || '', s.type || ''); const list = []; for (const hit of found) { const role = hit.role, name = hit.text; if (!name || (!s.all && skip.has(role))) continue; let rect = null; const a = hit.pr.position, b = hit.pr.size; if (a && b) rect = [a[0], a[1], b[0], b[1]]; list.push({name: name.slice(0, 80), type: role.replace(/^AX/, ''), rect}); if (list.length >= max) break; } return JSON.stringify({window: p.name(), total: found.length, elements: list}); }`,
  ui_click: `${JXA_LIB} function run(argv) { const s = JSON.parse(argv[0]); const p = proc(s.window); const found = match(p, s.name, s.type || ''); if (!found.length) throw new Error('NO_ELEMENT: 「' + p.name() + '」的窗口里没有叫「' + s.name + '」的控件。先用 ui 列出窗口里有什么。'); const hit = found[s.index || 0]; if (!hit) throw new Error('NO_ELEMENT: 只有 ' + found.length + ' 个控件对得上'); hit.el.click(); return JSON.stringify({clicked: hit.text, matches: found.length}); }`,
  ui_set: `${JXA_LIB} function run(argv) { const s = JSON.parse(argv[0]); const p = proc(s.window); const found = match(p, s.name, s.type || ''); if (!found.length) throw new Error('NO_ELEMENT: 「' + p.name() + '」的窗口里没有叫「' + s.name + '」的控件。先用 ui 列出窗口里有什么。'); const hit = found[s.index || 0]; if (!hit) throw new Error('NO_ELEMENT: 只有 ' + found.length + ' 个控件对得上'); hit.el.value = s.value; return JSON.stringify({set: hit.text || s.name}); }`,
  menu: `${JXA_LIB} function run(argv) { const s = JSON.parse(argv[0]); const p = proc(s.app); p.frontmost = true; let node = p.menuBars[0].menuBarItems.byName(s.path[0]); for (let i = 1; i < s.path.length; i += 1) node = node.menus[0].menuItems.byName(s.path[i]); node.click(); return JSON.stringify({menu: s.path.join(' > ')}); }`,
  keys: `function run(argv) { const se = Application('System Events'); const combos = JSON.parse(argv[0]); for (const c of combos) { if (c.code != null) se.keyCode(c.code, {using: c.using}); else se.keystroke(c.key, {using: c.using}); delay(0.06); } return '{}'; }`,
});

function sh(command, args, {input, timeout = 20000} = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout, input, env: process.env});
  if (result.error) throw new Error(`${command} 没能运行：${result.error.message}`);
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || '').trim().replace(/^.*?execution error: (?:Error: )?/s, '').replace(/ \(-\d+\)\s*$/, '');
    if (/not allowed assistive access|-25211|-1719|not authorized to send Apple events|-1743/i.test(String(result.stderr))) throw new Error('PERMISSION: 这台 Mac 还没允许碧琪操控别的软件。请用户到「系统设置 → 隐私与安全性 → 辅助功能」（以及「自动化」）里把碧琪打开，然后再试；在那之前可以改用 computer 工具。');
    throw new Error(message || `${command} 失败`);
  }
  return String(result.stdout || '').trim();
}
const jxa = (name, arg) => { const out = sh('osascript', ['-l', 'JavaScript', '-e', JXA[name], ...(arg == null ? [] : [typeof arg === 'string' ? arg : JSON.stringify(arg)])]); try { return JSON.parse(out); } catch { return {text: out}; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function macStep(step) {
  switch (step.op) {
    case 'windows': return jxa('windows');
    case 'open_app': sh('open', ['-a', step.name]); return {launched: step.name};
    case 'open': sh('open', [step.target]); return {opened: step.target};
    case 'close_app': return jxa('close_app', step.name);
    case 'focus': return jxa('focus', step.window);
    case 'wait_window': {
      const limit = Number(step.timeout) || 10000, started = Date.now(), want = String(step.window).toLowerCase();
      while (Date.now() - started < limit) {
        const hit = (jxa('windows').windows || []).find(w => w.title && (w.app.toLowerCase().includes(want) || w.title.toLowerCase().includes(want)));
        if (hit) return {window: `${hit.app}: ${hit.title}`, waited: Date.now() - started};
        await sleep(250);
      }
      throw new Error(`TIMEOUT: ${limit} 毫秒内没有等到「${step.window}」的窗口`);
    }
    case 'window_set': return jxa('window_set', step);
    case 'keys': if (step.window) jxa('focus', step.window); jxa('keys', step.combos.map(macCombo)); return {pressed: step.combos.join(' ')};
    case 'type': {
      if (step.window) jxa('focus', step.window);
      let old = null; try { old = sh('pbpaste', []); } catch { /* 剪贴板里不是文字 */ }
      sh('pbcopy', [], {input: String(step.text)});
      jxa('keys', [macCombo('cmd+v')]);
      await sleep(150);
      if (old) sh('pbcopy', [], {input: old});
      return {typed: String(step.text).length};
    }
    case 'ui': return jxa('ui', step);
    case 'ui_click': return jxa('ui_click', step);
    case 'ui_set': return jxa('ui_set', step);
    case 'menu': return jxa('menu', step);
    case 'clipboard_get': return {text: sh('pbpaste', [])};
    case 'clipboard_set': sh('pbcopy', [], {input: String(step.text)}); return {set: true};
    case 'screenshot': fs.mkdirSync(path.dirname(step.path), {recursive: true}); sh('screencapture', ['-x', step.path]); if (!fs.existsSync(step.path)) throw new Error('PERMISSION: 截图没有生成，可能没有屏幕录制权限；改用 computer 工具截图。'); return {path: step.path};
    case 'wait': await sleep(Math.min(Number(step.ms) || 0, 60000)); return {waited: Number(step.ms) || 0};
    default: throw new Error(`UNKNOWN_OP: ${step.op}`);
  }
}

async function runMac(steps) {
  const results = [];
  for (const step of steps) {
    try { results.push({op: step.op, ok: true, ...(await macStep(step))}); }
    catch (error) { results.push({op: step.op, ok: false, error: String(error?.message || error)}); break; }
    if (step.after != null) await sleep(Math.min(Number(step.after) || 0, 30000));
  }
  let foreground = '';
  try { foreground = sh('osascript', ['-l', 'JavaScript', '-e', JXA.front]); } catch { /* 没权限时拿不到，不影响结果 */ }
  return {results, foreground};
}

/* ───────── Windows：一次 PowerShell 做完所有步骤 ───────── */

function runWindows(steps, {timeoutMs = 120000} = {}) {
  const dir = deskDir();
  fs.mkdirSync(dir, {recursive: true});
  const script = path.join(dir, 'desk.ps1');
  try { if (fs.readFileSync(script, 'utf8') !== DESK_PS1) throw new Error('stale'); } catch { fs.writeFileSync(script, DESK_PS1); }
  const stamp = `${process.pid}-${Date.now()}`;
  const input = path.join(dir, `in-${stamp}.json`), output = path.join(dir, `out-${stamp}.json`);
  fs.writeFileSync(input, JSON.stringify({steps}));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, input, output], {windowsHide: true});
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已结束 */ } }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); for (const file of [input, output]) { try { fs.unlinkSync(file); } catch { /* 没生成 */ } } };
    child.on('error', error => { cleanup(); reject(new Error(`PowerShell 没能启动：${error.message}`)); });
    child.on('close', () => {
      try { const data = JSON.parse(fs.readFileSync(output, 'utf8').replace(/^﻿/, '')); cleanup(); resolve({results: [].concat(data.results || []), foreground: data.foreground || ''}); }
      catch { cleanup(); reject(new Error(`电脑操控脚本没有给出结果。${stderr.trim().slice(0, 600) || '可能超时了，或者被安全软件拦了。'}`)); }
    });
  });
}

export async function runSteps(steps, {platform = process.platform, runner} = {}) {
  const normalized = normalizeSteps(steps, {platform});
  if (runner) return runner(normalized);
  if (platform === 'darwin') return runMac(normalized);
  if (platform === 'win32') return runWindows(normalized);
  throw new Error('这个系统上没有电脑操控的现成动作，改用命令行。');
}

/* ───────── 流程：这台电脑上跑通过的步骤，存下来重放 ───────── */

export class FlowStore {
  constructor(file = path.join(deskDir(), 'flows.json')) { this.file = file; }
  read() { try { const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); return data && typeof data === 'object' ? data : {}; } catch { return {}; } }
  write(data) { fs.mkdirSync(path.dirname(this.file), {recursive: true}); const tmp = `${this.file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 1)); fs.renameSync(tmp, this.file); }
  save(name, steps, {note = '', platform = process.platform} = {}) {
    const key = String(name || '').trim();
    if (!key || key.length > 40) throw new Error('流程名字要 1 到 40 个字，说清它做什么，例如「微信发消息」「导出本月账单」。');
    normalizeSteps(fillVars(steps, new Proxy({}, {get: () => 'x', has: () => true})), {platform});
    const data = this.read();
    const vars = [...new Set(JSON.stringify(steps).match(/\{\{\s*[\p{L}\p{N}_-]+\s*\}\}/gu)?.map(text => text.replace(/[{}\s]/g, '')) || [])];
    data[key] = {steps, note: String(note || '').slice(0, 200), vars, platform, savedAt: Date.now(), runs: data[key]?.runs || 0, fails: 0};
    if (Object.keys(data).length > 200) throw new Error('这台电脑上已经存了 200 个流程，先删掉不用的。');
    this.write(data);
    return {name: key, vars};
  }
  get(name) { const flow = this.read()[String(name || '').trim()]; if (!flow) throw new Error(`没有叫「${name}」的流程。已存的：${Object.keys(this.read()).join('、') || '还没有'}。`); return flow; }
  mark(name, ok) { const data = this.read(); const flow = data[name]; if (!flow) return; if (ok) { flow.runs = (flow.runs || 0) + 1; flow.fails = 0; flow.lastOk = Date.now(); } else flow.fails = (flow.fails || 0) + 1; this.write(data); }
  remove(name) { const data = this.read(); if (!data[name]) throw new Error(`没有叫「${name}」的流程。`); delete data[name]; this.write(data); return {removed: name}; }
  list({platform = process.platform} = {}) { return Object.entries(this.read()).filter(([, flow]) => flow.platform === platform).map(([name, flow]) => ({name, note: flow.note, vars: flow.vars, steps: flow.steps.length, runs: flow.runs || 0, fails: flow.fails || 0})); }
}

export function formatRun({results = [], foreground = ''}, total) {
  const lines = [];
  results.forEach((item, index) => {
    const {op, ok, error, ...rest} = item;
    if (!ok) { lines.push(`${index + 1}. ${op} 失败：${error}`); return; }
    let detail = '';
    if (op === 'ui') detail = `「${rest.window}」里的控件（共 ${rest.total}，列出 ${rest.elements?.length || 0}）：\n${(rest.elements || []).map(el => `     ${el.type}「${el.name}」${el.id ? ` id=${el.id}` : ''}${el.enabled === false ? '（不可用）' : ''}`).join('\n')}`;
    else if (op === 'windows') detail = (rest.windows || []).map(w => `${w.app}${w.title ? `「${w.title}」` : ''}`).join('、') || '没有打开的窗口';
    else detail = Object.entries(rest).map(([key, value]) => `${key}=${typeof value === 'string' ? value.slice(0, 300) : JSON.stringify(value)}`).join('，');
    lines.push(`${index + 1}. ${op} 成功${detail ? `：${detail}` : ''}`);
  });
  const failed = results.find(item => !item.ok);
  if (failed && results.length < total) lines.push(`后面 ${total - results.length} 步没有执行。修好第 ${results.length} 步之后，从这一步接着发，不用把前面成功的重做一遍。`);
  if (failed && /NO_ELEMENT/.test(failed.error)) lines.push('控件名字对不上时：先发一步 {"op":"ui","window":"…"} 看这个窗口里真实的名字，再照着写；不要猜，也不要改成按坐标点。');
  if (foreground) lines.push(`现在最前面的窗口：${foreground}`);
  return lines.join('\n');
}

const reply = (text, details, isError = false) => ({content: [{type: 'text', text}], details, ...(isError ? {isError: true} : {})});

export function createDeskTool(ctx, {store = new FlowStore(), platform = process.platform, runner} = {}) {
  const mac = platform === 'darwin';
  return {
    name: 'computer_flow', label: '操控软件',
    description: [
      `操控这台电脑上的软件（${mac ? 'Mac 的 App' : 'Windows 的程序 / exe'}），用现成的动作，一次可以连做很多步。要打开软件、点按钮、填内容、按快捷键、导出文件这类事，优先用它，不要现写脚本${mac ? '，也不用 computer 工具一步一步点' : '（PowerShell、AutoHotkey、pyautogui 都不用写）'}。`,
      '用法一：do="run"，steps 是按顺序做的动作列表，一轮做完；哪一步失败就停在那一步并告诉你原因，最后回报现在最前面的窗口。',
      '动作（op）：',
      '- open_app {name}：按名字打开软件（中文名、英文名都行）。open {target}：打开文件、文件夹或网址。close_app {name}。',
      '- windows：列出现在开着的窗口。focus {window}：把一个窗口切到最前。wait_window {window, timeout}：等一个窗口出现（毫秒）。window_set {window, x, y, w, h}：移动和调整大小。',
      '- ui {window, filter?}：列出一个窗口里能操作的控件（按钮、输入框、菜单项）的真实名字。ui_click {window, name}：按名字点一个控件。ui_set {window, name, value}：往一个输入框里填内容。名字有重复时加 index（从 0 起）或 type。',
      `- keys {keys, window?}：按快捷键，如 "${mac ? 'cmd+s' : 'ctrl+s'}"、"enter"；连按几组用空格隔开（"${mac ? 'cmd+a cmd+c' : 'ctrl+a ctrl+c'}"）。type {text, window?}：在当前光标处输入文字（中文也行）。`,
      mac ? '- menu {app, path}：点菜单栏，如 path: ["文件", "导出为 PDF…"]。' : '- click {x, y, button?, double?}：按屏幕坐标点（只在控件没有名字时用，坐标从 screenshot 的结果里量）。',
      '- clipboard_get、clipboard_set {text}、screenshot {window?, path?}、wait {ms}。每一步都可以加 after（做完等多少毫秒）。',
      '怎么又快又准：先 windows / ui 看清真实的窗口名和控件名（一轮），然后把整件事的步骤一次发完（一轮），最后看结果或截图确认（一轮）。按名字点控件，不猜坐标。软件刚打开要等窗口：open_app 后面跟一步 wait_window。',
      '用法二，存成流程：一串步骤跑通之后，do="save_flow"（name、steps、note）存到这台电脑上；会变的内容写成 {{变量}}（如 {{联系人}}、{{内容}}）。下次同样的事 do="run_flow"（name、vars）一步重放。do="flows" 看这台电脑上已经存了哪些，动手前先看一眼有没有现成的。do="delete_flow" 删掉坏了的。流程重放失败（软件更新了、按钮改名了）时，用 ui 看一下现在的名字，改好步骤再 save_flow 覆盖。',
      '发送消息、提交、付款、删除这类对外或不可恢复的最后一步，先问用户；密码和验证码让用户自己输。',
    ].join('\n'),
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        do: {type: 'string', enum: ['run', 'flows', 'save_flow', 'run_flow', 'delete_flow'], description: '默认 run'},
        steps: {type: 'array', maxItems: MAX_STEPS, items: {type: 'object', additionalProperties: true, properties: {op: {type: 'string', enum: DESK_OPS}}, required: ['op']}, description: 'run 和 save_flow 用：按顺序做的动作'},
        name: {type: 'string', description: 'save_flow / run_flow / delete_flow 用：流程的名字'},
        vars: {type: 'object', additionalProperties: true, description: 'run_flow 用：流程里 {{变量}} 的值'},
        note: {type: 'string', description: 'save_flow 用：一句话说明这个流程做什么、什么时候用'},
      },
    },
    async execute(toolCallId, params = {}) {
      try {
        const action = params.do || 'run';
        if (action === 'flows') {
          const flows = store.list({platform});
          if (!flows.length) return reply('这台电脑上还没有存过流程。一串步骤跑通之后用 save_flow 存下来，下次就能一步重放。', {flows: []});
          return reply(['这台电脑上存好的流程（run_flow 直接重放）：', ...flows.map(flow => `- 「${flow.name}」${flow.note ? `：${flow.note}` : ''}（${flow.steps} 步${flow.vars.length ? `，变量：${flow.vars.join('、')}` : ''}，成功过 ${flow.runs} 次${flow.fails ? `，最近连续失败 ${flow.fails} 次，可能要用 ui 重新对一下名字` : ''}）`)].join('\n'), {flows});
        }
        if (action === 'save_flow') { const saved = store.save(params.name, params.steps, {note: params.note, platform}); return reply(`已存成流程「${saved.name}」${saved.vars.length ? `，变量：${saved.vars.join('、')}` : ''}。下次用 run_flow 重放。`, saved); }
        if (action === 'delete_flow') return reply(`已删掉流程「${params.name}」。`, store.remove(String(params.name || '').trim()));
        let steps = params.steps, flowName = '';
        if (action === 'run_flow') { flowName = String(params.name || '').trim(); steps = fillVars(store.get(flowName).steps, params.vars || {}); }
        const outcome = await runSteps(steps, {platform, runner});
        const ok = outcome.results.length === steps.length && outcome.results.every(item => item.ok);
        if (flowName) store.mark(flowName, ok);
        const text = formatRun(outcome, steps.length) + (ok && !flowName && steps.length >= 4 ? '\n这串步骤跑通了。如果这件事以后还会做，现在用 save_flow 存成流程（会变的内容换成 {{变量}}）。' : '') + (!ok && flowName ? `\n流程「${flowName}」这次没跑通，可能软件界面变了：用 ui 看现在的控件名，改好步骤后 save_flow 覆盖。` : '');
        return reply(text, {ok, steps: steps.length, done: outcome.results.filter(item => item.ok).length, results: outcome.results, foreground: outcome.foreground}, !ok);
      } catch (error) {
        const message = String(error?.message || error);
        return reply(message, {error: message}, true);
      }
    },
  };
}

// 消息像是要操控软件时，把这台电脑上存好的流程名放到眼前（有现成的就不用重新摸索）。
const DESK_INTENT = /打开.{0,12}(?:软件|应用|程序|app|微信|qq|钉钉|飞书|wps|word|excel|ppt|记事本|浏览器|网易云|剪映|ps|photoshop)|操作(?:一下)?(?:电脑|软件|这个应用)|帮我(?:点|按|在.{1,12}里)|自动(?:点|填|发|操作)|发(?:个|条)?(?:微信|消息)给|在(?:微信|qq|钉钉|飞书|wps|word|excel|记事本|访达|资源管理器).{0,10}(?:里|上|中)|控制(?:我的)?电脑|\.exe\b/i;
export function deskHintBlock(prompt = '', {mode = '', store = new FlowStore(), platform = process.platform} = {}) {
  if (mode === 'none' || !DESK_INTENT.test(String(prompt || ''))) return '';
  let flows = [];
  try { flows = store.list({platform}).filter(flow => flow.fails < 3).slice(0, 12); } catch { /* 读不了就不提 */ }
  const lines = ['【操控软件】这件事要动电脑上的软件：用 computer_flow，按名字找窗口和控件，一次把步骤发完；不要现写脚本，也不要一步一步截图点。顺序是：看清（windows / ui）→ 一次做完（steps）→ 确认结果。'];
  if (flows.length) lines.push(`这台电脑上已经有跑通过的流程，对得上就直接 run_flow：${flows.map(flow => `「${flow.name}」${flow.note ? `（${flow.note.slice(0, 40)}）` : ''}${flow.vars.length ? `[变量：${flow.vars.join('、')}]` : ''}`).join('；')}`);
  else lines.push('这台电脑上还没有存过流程：这次跑通之后用 save_flow 存下来，以后同样的事一步就能做完。');
  return lines.join('\n');
}
