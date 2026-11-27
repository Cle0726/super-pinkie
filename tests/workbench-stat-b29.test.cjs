// B29（backlog）：工作台 checkOpenFiles 每 2.5 秒问一次 pinkie.fs.stat；回包里没有 stats（旧网关、出错回 {} 或 {stats: null}）时
// 原来 `for (const s of stats)` 抛「stats is not iterable」。修法：laolao-workbench.js 里改成 `stats || []`，当作没有变化。
// 只把 checkOpenFiles 从源码里切出来放进 vm 跑（照 workbench-editor-lifecycle.test.cjs 的做法），假 rpc。
// 反例：把那一句换回原来的 `for (const s of stats) {`，同样的回包又会抛。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui/injections/laolao-workbench.js'), 'utf8');
const start = source.indexOf('  async function checkOpenFiles() {');
const end = source.indexOf('  window.Pinkie?.domWatch?.poll(() => void checkOpenFiles()', start);
assert.ok(start > 0 && end > start, '找不到 checkOpenFiles');
const fixed = source.slice(start, end);

function run(fn, reply) {
  const tab = {path: 'a.js', name: 'a.js', kind: 'text', mtimeMs: 1, dirty: false};
  const reloaded = [];
  const ctx = {
    state: {tabs: [tab], visible: true, active: 'a.js'}, document: {hidden: false}, notice: {hidden: true},
    rpc: async (method) => { assert.equal(method, 'pinkie.fs.stat'); return reply; },
    findTab: (p) => (p === tab.path ? tab : null), renderTabs() {}, conflictNotice() {}, statusFlash() {},
    reloadTab: async (t) => { reloaded.push(t.path); },
  };
  vm.runInNewContext(fn + ';globalThis.go = checkOpenFiles;', ctx);
  return {go: () => ctx.go(), reloaded, tab};
}

test('B29: checkOpenFiles treats a stat reply without stats as no change', async () => {
  assert.match(fixed, /for \(const s of stats \|\| \[\]\)/, '修法那一句不在了');
  for (const reply of [{}, {stats: null}, undefined]) {
    const r = run(fixed, reply);
    await assert.doesNotReject(r.go(), `回包 ${JSON.stringify(reply)} 不该抛`);
    assert.deepEqual(r.reloaded, []);
  }
});

test('B29: a normal stat reply still reloads a changed, clean tab and marks a missing one gone', async () => {
  const changed = run(fixed, {stats: [{path: 'a.js', exists: true, mtimeMs: 2}]});
  await changed.go();
  assert.deepEqual(changed.reloaded, ['a.js']);
  const gone = run(fixed, {stats: [{path: 'a.js', exists: false}]});
  await gone.go();
  assert.equal(gone.tab.gone, true);
  assert.deepEqual(gone.reloaded, []);
});

test('B29 counter-example: the original loop throws "stats is not iterable" on the same reply', async () => {
  const original = fixed.replace(/for \(const s of stats \|\| \[\]\) \{[^\n]*/, 'for (const s of stats) {');
  assert.notEqual(original, fixed, '反例没换上');
  await assert.rejects(run(original, {}).go(), /not iterable/);
});
