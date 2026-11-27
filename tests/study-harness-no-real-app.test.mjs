// 学习台 harness 解析不到本地 Playwright 时必须直接报错，绝不回退正式 App 自带的 playwright-core。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const harnessPath = fileURLToPath(new URL('../tools/study-desk/harness.mjs', import.meta.url));

function notFound(name) {
  const error = new Error(`Cannot find module '${name}'`);
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

const hookSource = `
const Module = require('node:module');
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const text = String(request);
  if (text.startsWith('/Applications/')) {
    process.stderr.write('APP_ACCESS ' + text + '\\n');
    const error = new Error('blocked: ' + text);
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  if (text === 'playwright' || text === 'playwright-core') {
    const error = new Error("Cannot find module '" + text + "'");
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  return original.call(this, request, ...rest);
};
`;

test('源码里不再 require 正式 App 自带的 playwright-core', () => {
  const source = fs.readFileSync(harnessPath, 'utf8');
  assert.doesNotMatch(source, /require\(\s*['"`]\/Applications\/[^'"`]*playwright-core/);
});

test('loadPlaywright 只试 playwright / playwright-core，按顺序回退', async () => {
  const harness = await import(pathToFileURL(harnessPath).href);
  assert.equal(typeof harness.loadPlaywright, 'function', 'harness 应导出 loadPlaywright');
  const asked = [];
  const core = {name: 'core'};
  const got = harness.loadPlaywright((name) => {
    asked.push(name);
    if (name === 'playwright-core') return core;
    throw notFound(name);
  });
  assert.equal(got, core);
  assert.deepEqual(asked, ['playwright', 'playwright-core']);
});

test('两者都解析不到时抛中文错误提示设 NODE_PATH，且不再尝试其他路径', async () => {
  const harness = await import(pathToFileURL(harnessPath).href);
  assert.equal(typeof harness.loadPlaywright, 'function', 'harness 应导出 loadPlaywright');
  const asked = [];
  assert.throws(
    () => harness.loadPlaywright((name) => { asked.push(name); throw notFound(name); }),
    (error) => /NODE_PATH/.test(error.message) && /找不到本地 playwright/.test(error.message),
  );
  assert.deepEqual(asked, ['playwright', 'playwright-core']);
});

test('子进程空 NODE_PATH：playwright() 抛清晰错误，从未解析 /Applications 下的路径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-harness-no-real-app-'));
  try {
    const hook = path.join(dir, 'block-apps.cjs');
    fs.writeFileSync(hook, hookSource);
    const script = `
      const {playwright} = await import(${JSON.stringify(pathToFileURL(harnessPath).href)});
      try { playwright(); console.log('RESULT ' + JSON.stringify({ok: true})); }
      catch (error) { console.log('RESULT ' + JSON.stringify({ok: false, message: String(error && error.message)})); }
    `;
    const env = {...process.env, NODE_PATH: ''};
    delete env.NODE_OPTIONS;
    const run = spawnSync(process.execPath, ['--require', hook, '--input-type=module', '-e', script], {cwd: dir, env, encoding: 'utf8'});
    assert.doesNotMatch(run.stderr, /APP_ACCESS/, `访问了正式 App 路径：\n${run.stderr}`);
    const line = run.stdout.split('\n').find((item) => item.startsWith('RESULT '));
    assert.ok(line, `子进程没有输出结果：\nstdout=${run.stdout}\nstderr=${run.stderr}`);
    const result = JSON.parse(line.slice('RESULT '.length));
    assert.equal(result.ok, false);
    assert.match(result.message, /NODE_PATH/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
