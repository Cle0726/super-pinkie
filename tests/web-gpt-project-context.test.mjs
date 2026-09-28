import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {projectContext} from '../services/mode-architecture/web-gpt-project-context.mjs';
import {WebGptConnectionManager} from '../services/mode-architecture/web-gpt-connection.mjs';

test('chat mode receives real, line-numbered project text rather than only a directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-chat-files-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'invoice.py'), 'def total(items):\n    return sum(items)\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'Invoice project');
  const result = projectContext(root, {task: '检查 src/invoice.py 的 total 函数'});
  assert.equal(result.files[0].path, 'src/invoice.py');
  assert.match(result.files[0].content, /1: def total\(items\):/);
  assert.match(result.files[0].content, /2:     return sum\(items\)/);
  assert.ok(result.manifest.includes('src/invoice.py'));
  assert.equal(projectContext(root, {task: '你好'}).files.length, 0);
  assert.equal(projectContext(root, {task: '测试网页对话：17×19 等于多少？请给出一步计算。'}).files.length, 0);
  assert.equal(projectContext(root, {task: '帮我分析 17×19'}).files.length, 0);
});

test('only files inside the bound project are shareable, with secret and ignore rules enforced', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-chat-scope-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const workspace = path.join(root, 'project');
  const other = path.join(root, 'other');
  fs.mkdirSync(workspace);
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(workspace, 'main.py'), 'print("safe marker")');
  fs.writeFileSync(path.join(workspace, '.env'), 'SECRET=do-not-share');
  fs.writeFileSync(path.join(workspace, 'private.txt'), 'private marker');
  fs.writeFileSync(path.join(workspace, '.c2cignore'), '*.txt\n');
  fs.writeFileSync(path.join(other, 'outside.py'), 'outside marker');
  fs.symlinkSync(path.join(other, 'outside.py'), path.join(workspace, 'escape.py'));
  const bindingFile = path.join(root, 'bindings.json');
  const session = 'agent:project:chat-file-test';
  fs.writeFileSync(bindingFile, JSON.stringify({[session]: {root: workspace}}));
  const manager = new WebGptConnectionManager({root: path.join(root, 'bridge'), bindingFile});
  const context = await manager.projectContext(session, workspace, {
    paths: ['main.py', '.env', 'private.txt', '../other/outside.py', 'escape.py'],
  });
  assert.deepEqual(context.files.map(file => file.path), ['main.py']);
  assert.equal(context.errors.length, 4);
  assert.doesNotMatch(JSON.stringify(context), /do-not-share|private marker|outside marker/);
  await assert.rejects(() => manager.projectContext('agent:project:unbound', workspace, {paths: ['main.py']}), /未绑定用户项目/);
  await assert.rejects(() => manager.projectContext(session, other, {paths: ['outside.py']}), /只能读取当前会话/);
});

test('web context is bounded and never returns binary media as text', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-chat-bounds-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'long.md'), 'line\n'.repeat(50_000));
  fs.writeFileSync(path.join(root, 'image.png'), Buffer.from([0, 1, 2, 3]));
  const context = projectContext(root, {paths: ['long.md', 'image.png']});
  assert.equal(context.files.length, 1);
  assert.equal(context.files[0].truncated, true);
  assert.ok(Buffer.byteLength(context.files[0].content) <= 4_010);
  assert.ok(context.errors.some(error => error.startsWith('image.png:')));
});

test('obvious credential literals are redacted and embedded private keys are denied', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-chat-redaction-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'settings.py'), 'api_key = "sk-abcdefghijklmnopqrstuvwxyz"\nname = "demo"\n');
  fs.writeFileSync(path.join(root, 'bad.py'), '-----BEGIN PRIVATE KEY-----\nnot-for-web\n');
  const result = projectContext(root, {paths: ['settings.py', 'bad.py']});
  assert.match(result.files[0].content, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(result), /sk-abcdefghijklmnopqrstuvwxyz|not-for-web/);
  assert.equal(result.files.length, 1);
  assert.match(result.errors[0], /私钥/);
});
