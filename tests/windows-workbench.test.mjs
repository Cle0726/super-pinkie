import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-windows-workbench-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const [source, name] of [
    ['desktop/windows/mac-runtime/services/mode-architecture/workbench.mjs', 'workbench.mjs'],
    ['services/mode-architecture/workbench-lsp.mjs', 'workbench-lsp.mjs'],
    ['services/mode-architecture/workbench-ext.mjs', 'workbench-ext.mjs'],
  ]) fs.copyFileSync(source, path.join(root, name));
  return {root, module: await import(pathToFileURL(path.join(root, 'workbench.mjs')).href)};
}

test('Windows workbench sends reveal and open requests to Explorer', async t => {
  const {root, module} = await fixture(t);
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const file = path.join(project, '例子.txt');
  fs.writeFileSync(file, 'example');
  const resolved = fs.realpathSync(file);
  const calls = [];
  const spawnProcess = (command, args) => {
    calls.push({command, args});
    const child = new EventEmitter();
    child.unref = () => {};
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  const bench = new module.Workbench({platform: 'win32', home: root, spawnProcess,
    config: () => ({agents: {list: [{id: 'project', workspace: project}]}})});
  const params = {sessionKey: 'agent:project:main', path: file};
  assert.deepEqual(await bench.reveal(params), {ok: true});
  assert.deepEqual(await bench.reveal({...params, open: true}), {ok: true});
  assert.deepEqual(calls, [
    {command: 'explorer.exe', args: ['/select,', resolved]},
    {command: 'explorer.exe', args: [resolved]},
  ]);
});

test('notebook uses configured Windows Python and reports a missing interpreter promptly', async t => {
  const {root, module} = await fixture(t);
  assert.equal(new module.NotebookProcess({platform: 'win32', environment: {}}).pythonPath(), 'python');
  const missing = path.join(root, 'missing-python');
  const notebook = new module.NotebookProcess({platform: 'win32', environment: {...process.env, PINKIE_PYTHON_BIN: missing}});
  assert.equal(notebook.pythonPath(), missing);
  const result = await notebook.request({action: 'health'}, 2000);
  assert.equal(result.ok, false);
  assert.match(result.error, /内核进程已退出/);
  assert.doesNotMatch(result.error, /超时/);
});
