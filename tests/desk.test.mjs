import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeSteps, fillVars, macCombo, FlowStore, formatRun, createDeskTool, deskHintBlock, DESK_OPS} from '../services/mode-architecture/desk.mjs';
import {comboToVk, DESK_PS1} from '../services/mode-architecture/desk-win.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'desk-'));

test('keys: Windows virtual keys and Mac combos, unknown keys are refused', () => {
  assert.deepEqual(comboToVk('ctrl+shift+s'), [0x11, 0x10, 0x53]);
  assert.deepEqual(comboToVk('enter'), [0x0D]);
  assert.deepEqual(comboToVk('f5'), [0x74]);
  assert.throws(() => comboToVk('ctrl+banana'), /不认识的按键/);
  assert.deepEqual(macCombo('cmd+shift+s'), {key: 's', using: ['command down', 'shift down']});
  assert.deepEqual(macCombo('enter'), {code: 36, using: []});
  assert.throws(() => macCombo('cmd+shift'), /主键/);
});
test('normalizeSteps validates ops, required params and platform differences', () => {
  const win = normalizeSteps([{op: 'open_app', name: '记事本'}, {op: 'keys', keys: 'ctrl+a ctrl+c'}, {op: 'screenshot'}], {platform: 'win32', shotDir: '/x', now: 1});
  assert.deepEqual(win[1].vk, [[0x11, 0x41], [0x11, 0x43]]);
  assert.equal(win[2].path, path.join('/x', 'shot-1-3.png'));
  assert.throws(() => normalizeSteps([{op: 'fly'}]), /不认识/);
  assert.throws(() => normalizeSteps([{op: 'ui_click', window: 'a'}]), /缺参数 name/);
  assert.throws(() => normalizeSteps([{op: 'menu', app: 'a', path: ['文件']}], {platform: 'win32'}), /ui_click/);
  assert.throws(() => normalizeSteps([{op: 'click', x: 1, y: 2}], {platform: 'darwin'}), /computer/);
  assert.deepEqual(normalizeSteps([{op: 'menu', app: 'a', path: '文件 > 导出'}], {platform: 'darwin'})[0].path, ['文件', '导出']);
  assert.throws(() => normalizeSteps([]), /至少有一步/);
});
test('fillVars fills placeholders everywhere and names the missing one', () => {
  assert.deepEqual(fillVars([{op: 'type', text: '你好 {{名字}}'}], {名字: '小王'}), [{op: 'type', text: '你好 小王'}]);
  assert.throws(() => fillVars([{op: 'type', text: '{{内容}}'}], {}), /变量「内容」/);
});
test('the PowerShell script is ASCII only and covers every op it should', () => {
  assert.ok(/^[\x00-\x7F]*$/.test(DESK_PS1), 'non-ASCII characters break Windows PowerShell 5.1 without a BOM');
  assert.doesNotMatch(DESK_PS1, /\?\?|\? .* : /, 'no PowerShell 7 only syntax');
  for (const op of DESK_OPS.filter(name => name !== 'menu')) assert.ok(DESK_PS1.includes(`'${op}'`), op);
  const opens = (DESK_PS1.match(/\{/g) || []).length, closes = (DESK_PS1.match(/\}/g) || []).length;
  assert.equal(opens, closes, 'balanced braces');
});
test('flows: save, list, replay with vars, failures are counted', async () => {
  const store = new FlowStore(path.join(tmp(), 'flows.json'));
  const calls = [];
  const runner = async steps => { calls.push(steps); return {results: steps.map(step => ({op: step.op, ok: true})), foreground: '微信'}; };
  const tool = createDeskTool({}, {store, platform: 'win32', runner});
  let r = await tool.execute('1', {do: 'flows'});
  assert.match(r.content[0].text, /还没有存过/);
  const steps = [{op: 'open_app', name: '微信'}, {op: 'wait_window', window: '微信'}, {op: 'ui_set', window: '微信', name: '搜索', value: '{{联系人}}'}, {op: 'keys', keys: 'enter'}, {op: 'type', text: '{{内容}}'}];
  r = await tool.execute('2', {do: 'save_flow', name: '微信找人', steps, note: '打开微信找到联系人并填好内容，不发送'});
  assert.deepEqual(r.details.vars, ['联系人', '内容']);
  r = await tool.execute('3', {do: 'run_flow', name: '微信找人', vars: {联系人: '妈妈', 内容: '到家了'}});
  assert.equal(r.details.ok, true); assert.equal(calls[0][2].value, '妈妈'); assert.equal(calls[0][4].text, '到家了');
  r = await tool.execute('4', {do: 'run_flow', name: '微信找人', vars: {联系人: '妈妈'}});
  assert.equal(r.isError, true); assert.match(r.content[0].text, /变量「内容」/);
  assert.equal(store.list({platform: 'win32'})[0].runs, 1);
  assert.equal(store.list({platform: 'darwin'}).length, 0, 'flows are per platform');
  const hint = deskHintBlock('帮我发个微信给妈妈', {mode: 'chat', store, platform: 'win32'});
  assert.match(hint, /微信找人/); assert.match(hint, /变量：联系人、内容/);
  assert.equal(deskHintBlock('今天天气怎么样', {mode: 'chat', store}), '');
  assert.equal(deskHintBlock('打开微信', {mode: 'none', store}), '');
  r = await tool.execute('5', {do: 'delete_flow', name: '微信找人'});
  assert.equal(store.list({platform: 'win32'}).length, 0);
});
test('a failed step stops the run and tells what to do next', async () => {
  const runner = async steps => ({results: [{op: 'open_app', ok: true, launched: 'x'}, {op: 'ui_click', ok: false, error: "NO_ELEMENT: nothing named '保存'"}], foreground: '记事本'});
  const tool = createDeskTool({}, {store: new FlowStore(path.join(tmp(), 'f.json')), platform: 'win32', runner});
  const r = await tool.execute('1', {steps: [{op: 'open_app', name: '记事本'}, {op: 'ui_click', window: '记事本', name: '保存'}, {op: 'keys', keys: 'enter'}]});
  assert.equal(r.isError, true); assert.equal(r.details.done, 1);
  assert.match(r.content[0].text, /后面 1 步没有执行/); assert.match(r.content[0].text, /先发一步/); assert.match(r.content[0].text, /现在最前面的窗口：记事本/);
});
test('formatRun lists controls by their real names', () => {
  const text = formatRun({results: [{op: 'ui', ok: true, window: '记事本', total: 2, elements: [{name: '文件', type: 'MenuItem', id: ''}, {name: '保存', type: 'Button', id: 'save', enabled: false}]}], foreground: ''}, 1);
  assert.match(text, /MenuItem「文件」/); assert.match(text, /Button「保存」 id=save（不可用）/);
});
