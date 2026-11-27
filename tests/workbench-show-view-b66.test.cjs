// B66（backlog）：820 宽下 metre-files「at 820 …」偶发红（#409 run 45939911423 job 140311598521，metre-files.test.mjs:189 README 签条 element is not visible）。
// 原因：window.__pinkieWorkbench.show() 先 setEnabled(true) 让工作台出来（place() 按 workspaceView 写 data-pk-wb-view），再最多 3 s 等 pinkie.fs.status
// 回来，等到了才 `workspaceView = 'code'; place();`。用户在等的这段里点「对话」，等完又被拉回「代码」，对话页整页 visibility: hidden，签条点不着。
// 修法：show() 进来就切到「代码」，再等 info；等的期间用户切的页不再被改回去。
// 只把 show 从源码里切出来放进 vm 跑（照 workbench-stat-b29.test.cjs 的做法），state / place / setEnabled 打桩，info 人为晚到。
// 反例：把 `workspaceView = 'code'; place();` 挪回等待之后，同样的时序最后停在「代码」。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui/injections/laolao-workbench.js'), 'utf8');
const start = source.indexOf('show: async () => {');
const end = source.indexOf('}};', start);
assert.ok(start > 0 && end > start, '找不到 window.__pinkieWorkbench.show');
const fixed = source.slice(start + 'show: '.length, end + 1);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function load(fn, {view = 'code'} = {}) {
  const ctx = {
    state: {info: null, visible: false, mode: ''}, workspaceView: view, views: [], enabled: false,
    document: {documentElement: {dataset: {laolaoMode: 'metre'}}}, setTimeout,
  };
  vm.runInNewContext(`
    function wanted() { return true; }
    function enabledPref() { return enabled; }
    function place() { if (state.visible) views.push(workspaceView); }
    function setEnabled() { enabled = true; state.visible = true; place(); }
    globalThis.show = ${fn};`, ctx);
  return ctx;
}

test('B66: switching to 对话 while the workbench waits for its status is kept after show() returns', async () => {
  const ctx = load(fixed);
  const shown = ctx.show();
  await wait(20);
  assert.equal(ctx.workspaceView, 'code', 'the bench comes out on 代码 right away');
  ctx.workspaceView = 'chat'; ctx.place();            // 用户点「对话」
  await wait(150);
  ctx.state.info = {root: '/proj'};                  // pinkie.fs.status 晚到
  assert.equal(await shown, true);
  assert.equal(ctx.workspaceView, 'chat', 'show() must not pull the page back to 代码');
  assert.equal(ctx.views.at(-1), 'chat');
});

test('B66: without a switch the chip still lands on 代码, also from the 对话 page, before the status arrives', async () => {
  const ctx = load(fixed, {view: 'chat'});
  const shown = ctx.show();
  await wait(20);
  assert.equal(ctx.views.at(-1), 'code', '代码 is placed before waiting');
  ctx.state.info = {root: '/proj'};
  assert.equal(await shown, true);
  assert.equal(ctx.workspaceView, 'code');
  const failed = load(fixed);
  const pending = failed.show();
  await wait(20);
  failed.state.info = {error: 'no gateway'};
  assert.equal(await pending, false, 'a status error still reports the bench as unavailable');
});

test('B66 counter-example: setting 代码 after the wait pulls the user back from 对话', async () => {
  const original = fixed.replace("workspaceView = 'code'; place(); for (let i = 0; i < 60 && !state.info; i++) await new Promise(r => setTimeout(r, 50));",
    "for (let i = 0; i < 60 && !state.info; i++) await new Promise(r => setTimeout(r, 50)); workspaceView = 'code'; place();");
  assert.notEqual(original, fixed, '反例没换上');
  const ctx = load(original);
  const shown = ctx.show();
  await wait(20);
  ctx.workspaceView = 'chat'; ctx.place();
  await wait(150);
  ctx.state.info = {root: '/proj'};
  await shown;
  assert.equal(ctx.workspaceView, 'code', 'the old order overrides the user');
});
