// 刷题作答页「再来一组」之后的按键转发与卸载（L69）。
// 旧写法：mountAgain() 把下一组 runtime 挂到 host.__pkpRuntime，而每一层 runtime 的 keydown 都先看
// host.__pkpRuntime 再转发——下一组自己的 keydown 也转发给自己 → 点「再来一组」后随便按个键就无限递归
// RangeError；而且 unmount 只卸外层，下一组的舞台 / 录音没人卸。
// 这里不起浏览器：从 ui/injections/laolao-game-practice.js 切出 mountAgain、runtime 的 unmount / keydown
// 以及声明那一行，套进一个最小的 mountSet 外壳，在 vm 里用假 host / stage 跑。不联网、不调上游模型。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const PRACTICE = fs.readFileSync(new URL('../ui/injections/laolao-game-practice.js', import.meta.url), 'utf8');

// 从 needle 开始切到与其后第一个「{」配对的「}」为止（被切的代码里没有含不配对花括号的字符串）。
function block(src, needle) {
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `源码里找不到：${needle}`);
  assert.equal(src.indexOf(needle, at + 1), -1, `源码里不止一处：${needle}`);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`花括号不配对：${needle}`);
}
// 切出整行（去掉缩进后以 needle 开头的那一行，必须唯一）。
function line(src, needle) {
  const rows = src.split('\n').filter(l => l.trimStart().startsWith(needle));
  assert.equal(rows.length, 1, `源码里应当正好一行以此开头：${needle}`);
  return rows[0].trim();
}

// 最小 mountSet 外壳：每挂一层编号 +1，舞台 / 录音 / 退出确认都记进 log；挂出来的 runtime 按顺序放进 host.rts。
function harness() {
  const log = [];
  const code = `
    function mountSet(host, ctx) {
      const id = host.rts.length + 1;
      const stage = {destroy() { log.push('destroy:' + id); }};
      const audio = {pause() { log.push('pause:' + id); }};
      const askLeave = () => log.push('leave:' + id);
      let alive = true, qCol = null, battle = null;
      ${line(PRACTICE, 'let picked = null')}
      ${line(PRACTICE, 'function mountAgain()')}
      const rt = {
        ${block(PRACTICE, 'unmount() { alive = false; stage.destroy();')},
        ${block(PRACTICE, 'keydown(event) {')},
      };
      rt.again = mountAgain;
      host.rts.push(rt);
      return rt;
    }
    mountSet;`;
  const mountSet = vm.runInNewContext(code, {log});
  const host = {rts: [], classList: {remove() {}}, replaceChildren() {}, querySelector: () => null};
  return {log, host, first: mountSet(host, {})}; // 学习台的 pane.runtime 一直是第一层
}
const key = k => ({key: k, preventDefault() {}});
const leaves = log => log.filter(x => x.startsWith('leave'));

test('再来一组之后按 Esc：只转发给下一组处理一次，不无限递归', () => {
  const {log, first} = harness();
  first.again();
  assert.doesNotThrow(() => first.keydown(key('Escape')));
  assert.deepEqual(leaves(log), ['leave:2'], '只有当前这一组处理按键');
  assert.doesNotThrow(() => first.keydown(key('a')), '普通键也不能炸');
});

test('连着再来两组：按键沿链交给最新一组', () => {
  const {log, host, first} = harness();
  first.again();
  host.rts[1].again();
  assert.equal(host.rts.length, 3);
  assert.doesNotThrow(() => first.keydown(key('Escape')));
  assert.deepEqual(leaves(log), ['leave:3']);
});

test('卸载第一层会一并卸掉再来一组挂上的下一组', () => {
  const {log, host, first} = harness();
  first.again();
  host.rts[1].again();
  log.length = 0;
  first.unmount();
  for (const n of [2, 3]) {
    assert.ok(log.includes(`destroy:${n}`), `第 ${n} 组的舞台要被销毁，实际：${log.join(' ')}`);
    assert.ok(log.includes(`pause:${n}`), `第 ${n} 组的录音要被暂停，实际：${log.join(' ')}`);
  }
});

test('没点再来一组时按键照常由本组处理', () => {
  const {log, first} = harness();
  first.keydown(key('Escape'));
  assert.deepEqual(leaves(log), ['leave:1']);
});
