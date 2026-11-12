import test from 'node:test';
import assert from 'node:assert/strict';
import {routeSkills} from '../services/mode-architecture/skill-routes.mjs';

test('a request to repair a missing tool routes to the toolbox', () => {
  for (const prompt of ['帮我安装 ffmpeg', '浏览器装不上，帮我修好', '缺少 Python']) {
    assert.ok(routeSkills([], prompt).some(route => route.skill === 'pinkie-toolbox'), prompt);
  }
});

test('ordinary questions about a tool do not automatically trigger installation', () => {
  assert.equal(routeSkills([], 'Python 是什么？').some(route => route.skill === 'pinkie-toolbox'), false);
});

// 11-11 实测：6 条做视频 / 网页 / 「能不能做」的对话里碧琪 0 次调用 toolbox.mjs。引擎按活儿种类直接点名要备的能力。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {toolboxBlock, toolboxCaps} from '../services/mode-architecture/skill-routes.mjs';
import {classifyWorkKind} from '../services/mode-architecture/work-kinds.mjs';

function workspaceWithToolbox(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-kit-ws-'));
  t.after(() => fs.rmSync(ws, {recursive: true, force: true}));
  fs.mkdirSync(path.join(ws, 'playbooks'), {recursive: true});
  fs.writeFileSync(path.join(ws, 'playbooks/toolbox.mjs'), '');
  return ws;
}

test('each kind of hands-on work names the toolbox capabilities it needs', () => {
  const caps = (prompt) => toolboxCaps(classifyWorkKind(prompt, {mode: 'project'}).kinds);
  assert.deepEqual(caps('剪一个30秒的抖音广告 卖咖啡'), ['video']);
  assert.ok(caps('做个记账网页').includes('screenshot'));
  assert.ok(caps('帮我做一份 10 页的产品介绍 PPT').includes('office-view'));
  assert.deepEqual(caps('你好'), []);
});

test('the toolbox line appears only when the toolbox is there, and finds it in the mode workspace behind a project folder', t => {
  const ws = workspaceWithToolbox(t);
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-kit-project-'));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  const video = classifyWorkKind('剪一个30秒的抖音广告 卖咖啡', {mode: 'project'}).kinds;
  const block = toolboxBlock(video, {workspaces: [project, ws], mode: 'project'});
  assert.match(block, /【先备好工具】/);
  assert.ok(block.includes(`node "${path.join(ws, 'playbooks', 'toolbox.mjs')}" ensure video`));
  assert.match(block, /不要让先生自己去装软件/);
  assert.equal(toolboxBlock(video, {workspaces: [project], mode: 'project'}), '', 'no toolbox, no line');
  assert.equal(toolboxBlock(video, {workspaces: [ws], mode: 'none'}), '', 'unrestricted mode gets nothing');
  assert.equal(toolboxBlock(classifyWorkKind('你好', {mode: 'project'}).kinds, {workspaces: [ws], mode: 'project'}), '');
  assert.match(toolboxBlock(['environment'], {workspaces: [ws], mode: 'project'}), /toolbox\.mjs" check`/);
});

test('the plugin prompt carries the toolbox line for a project session bound to a folder', async t => {
  delete process.env.PINKIE_MANAGED_GATEWAY;
  delete process.env.OPENCLAW_SERVICE_KIND;
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-kit-state-'));
  const previous = process.env.PINKIE_STATE_ROOT;
  process.env.PINKIE_STATE_ROOT = stateRoot;
  t.after(() => { fs.rmSync(stateRoot, {recursive: true, force: true}); if (previous === undefined) delete process.env.PINKIE_STATE_ROOT; else process.env.PINKIE_STATE_ROOT = previous; });
  const ws = workspaceWithToolbox(t);
  fs.mkdirSync(path.join(ws, 'persona'), {recursive: true});
  fs.writeFileSync(path.join(ws, 'persona/core.md'), 'persona');
  const {ModeArchitecture} = await import('../services/mode-architecture/index.mjs');
  const context = new ModeArchitecture().prompt({prompt: '剪一个30秒的抖音广告 卖咖啡', messages: []}, {agentId: 'main', sessionKey: 'agent:main:kit', workspaceDir: ws}).appendSystemContext;
  assert.match(context, /【先备好工具】开工前先跑一次 `node ".*toolbox\.mjs" ensure video`/);
  const chat = new ModeArchitecture().prompt({prompt: '你好', messages: []}, {agentId: 'main', sessionKey: 'agent:main:kit', workspaceDir: ws}).appendSystemContext;
  assert.doesNotMatch(chat, /【先备好工具】/);
});
