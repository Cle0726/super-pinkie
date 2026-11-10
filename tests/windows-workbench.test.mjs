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
  // Windows ships the repository workbench (no snapshot copy any more).
  return {root, module: await import(pathToFileURL(path.resolve('services/mode-architecture/workbench.mjs')).href)};
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

test('the app guide describes the browser each platform really has', async () => {
  const {appBrowserPlace} = await import('../services/mode-architecture/app-guide.mjs');
  assert.match(appBrowserPlace('win32'), /独立浏览器窗口/);
  assert.match(appBrowserPlace('win32'), /粉色「碧琪」指针/);
  assert.match(appBrowserPlace('darwin'), /App 右侧的浏览器/);
  assert.doesNotMatch(appBrowserPlace('darwin'), /Windows/);
});
