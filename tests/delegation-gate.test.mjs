import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CompletionIntegrityGuard} from '../services/mode-architecture/index.mjs';
import {isChildDelegation, isSessionOperationEvidence, latestChildReport, SESSION_WAKE_MARK} from '../services/mode-architecture/session-lineage.mjs';

// 11-12 实测：活交给子会话以后，交付门禁在「开子会话那一轮」和「汇报叫醒父会话那一轮」
// 都提醒「执行型修改任务没有主机确认的文件变化」，父会话白跑一轮。改动由子会话自己的门禁把关；
// 父会话只有在子会话没做成、或者自己动了文件却没验证时才该被拦。

const WAKE = '[pinkie-watchdog] [pinkie-session-wake] 有一份你请子会话处理的工作汇报。';
const ASK = '另开一个子会话，把 README 的标题改成 Hello';
const LINEAGES = Symbol.for('pinkie.session-lineage.v1');

const started = (agent = 'project') => {
  const details = {key: `agent:${agent}:pinkie-child:abc123`, title: '改 README 标题', message: '已经开始做了。'};
  return {content: [{type: 'text', text: JSON.stringify(details)}], details};
};

function harness(t, {report = null, agent = 'project'} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-delegation-'));
  const sessionKey = `agent:${agent}:dashboard:${path.basename(root)}`;
  const cards = report ? [{kind: 'report', id: 'r1', childKey: `agent:${agent}:pinkie-child:abc123`, createdAt: 1, ...(report === 'failed' ? {failed: true} : {})}] : [];
  const registry = globalThis[LINEAGES] ??= new Map();
  const id = 'test-' + path.basename(root);
  registry.set(id, {state: key => (key === sessionKey ? {cards} : {})});
  t.after(() => { registry.delete(id); fs.rmSync(root, {recursive: true, force: true}); });
  const guard = new CompletionIntegrityGuard();
  let run = 0;
  // 和 CleKkSupervisor 一样：begin(原始 prompt) → updatePrompt(本轮 prompt) → 工具 → finalize；放行的一轮 end 清掉。
  const turn = (prompt, tools, reply) => {
    const ctx = {agentId: agent, sessionKey, runId: 'run-' + (++run)};
    guard.begin({prompt}, ctx);
    guard.updatePrompt({prompt}, ctx);
    tools.forEach((tool, index) => {
      guard.beforeTool({toolName: tool.name, toolCallId: 't' + index, params: tool.params || {}}, ctx);
      if (tool.write) fs.writeFileSync(tool.write, 'changed');
      guard.afterTool({toolName: tool.name, toolCallId: 't' + index, params: tool.params || {}, result: tool.result}, ctx);
    });
    const result = guard.finalize({lastAssistantMessage: reply}, ctx, {verifyExternal: false});
    if (!result) guard.end({}, ctx);
    return result;
  };
  return {root, turn, sessionKey};
}

test('the wake text carries the mark the gate looks for', () => {
  assert.ok(WAKE.includes(SESSION_WAKE_MARK));
  const source = fs.readFileSync(new URL('../services/mode-architecture/session-lineage.mjs', import.meta.url), 'utf8');
  assert.match(source, /const WAKE_PREFIX = '\[pinkie-watchdog\] \[pinkie-session-wake\]'/);
});

test('handing the change to a started child session is not a missing file change', (t) => {
  for (const agent of ['project', 'thinking', 'main']) {
    const {turn} = harness(t, {agent});
    const result = turn(ASK, [{name: 'pinkie_session_start', params: {initiation: 'user_asked'}, result: started(agent)}],
      '已经开了子会话「改 README 标题」去改，做完会自动汇报回来。');
    assert.equal(result, undefined, `${agent}: ${result?.reason}`);
  }
});

test('the turn a successful report wakes may relay it without its own edits', (t) => {
  const {root, turn} = harness(t, {report: 'ok'});
  const readme = path.join(root, 'README.md');
  fs.writeFileSync(readme, '# Hello\n');
  assert.equal(turn(ASK, [{name: 'pinkie_session_start', result: started()}], '已经开了子会话去改，做完会汇报回来。'), undefined);
  const relayed = turn(WAKE, [{name: 'read', params: {path: readme}, result: '# Hello\n'}], '子会话已经把 README 标题改成 Hello，我读回确认过了。');
  assert.equal(relayed, undefined, relayed?.reason);
});

test('a failed report cannot be relayed as done', (t) => {
  const {turn} = harness(t, {report: 'failed'});
  turn(ASK, [{name: 'pinkie_session_start', result: started()}], '已经开了子会话去改，做完会汇报回来。');
  assert.equal(turn(WAKE, [], 'README 标题已经改成 Hello 了。')?.action, 'revise');
});

test('without a delegation the old checks are unchanged', (t) => {
  const {turn} = harness(t);
  assert.equal(turn('把 README 的标题改成 Hello', [], 'README 标题已经改成 Hello 了。')?.action, 'revise');
  const failedStart = {content: [{type: 'text', text: '这个父会话已有 4 个子会话在跑'}], isError: true};
  assert.match(turn(ASK, [{name: 'pinkie_session_start', result: failedStart}], 'README 标题已经改成 Hello 了。')?.reason || '', /最后一次工具调用失败/);
  // 只提了一张等用户点的卡片（own_initiative）不是把活交出去了。
  const card = {content: [{type: 'text', text: JSON.stringify({id: 'card-1', title: '改 README'})}], details: {id: 'card-1'}};
  assert.equal(isChildDelegation({name: 'pinkie_session_start', failed: false, output: JSON.stringify(card)}), false);
});

test('a parent that edits on the wake turn still has to check its own edit', (t) => {
  const {root, turn} = harness(t, {report: 'ok'});
  const readme = path.join(root, 'README.md');
  fs.writeFileSync(readme, '# old\n');
  turn(ASK, [{name: 'pinkie_session_start', result: started()}], '已经开了子会话去改，做完会汇报回来。');
  const result = turn(WAKE, [{name: 'write', params: {path: readme}, write: readme, result: 'ok'}], '我把 README 标题合并改成 Hello，测试通过了。');
  assert.match(result?.reason || '', /最后一次实际改动（write）之后没有读取、测试或检查真实结果/);
});

test('latestChildReport reads the newest non-consult report', (t) => {
  const registry = globalThis[LINEAGES] ??= new Map();
  registry.set('latest-test', {state: key => (key === 'agent:project:dashboard:x' ? {cards: [
    {kind: 'report', id: 'a', failed: true}, {kind: 'report', id: 'b'}, {kind: 'report', id: 'c', consult: true, failed: true},
  ]} : {})});
  t.after(() => registry.delete('latest-test'));
  assert.deepEqual(latestChildReport('agent:project:dashboard:x'), {failed: false, childKey: '', at: 0});
  assert.equal(latestChildReport('agent:project:dashboard:none'), null);
});

test('a long pinkie_mode_ask answer cut off by the evidence limit still counts as asked', () => {
  const answer = '名字建议：' + '一个很长的答案。'.repeat(1400);
  const details = {key: 'agent:thinking:pinkie-child:q1', answer};
  // 门禁存的是 JSON.stringify 过的整个结果外壳，最多 12000 字：这里一定被截断。
  const output = JSON.stringify({content: [{type: 'text', text: JSON.stringify(details)}], details}).slice(0, 12_000);
  assert.throws(() => JSON.parse(output));
  assert.equal(isSessionOperationEvidence({name: 'pinkie_mode_ask', output}, '去问问想法模式这个产品叫什么好'), true);
  const startOutput = JSON.stringify(started()).slice(0, 60) + JSON.stringify(started()).slice(60);
  assert.equal(isChildDelegation({name: 'pinkie_session_start', failed: false, output: startOutput}), true);
});
