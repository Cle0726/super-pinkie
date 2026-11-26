// B50 工作台状态栏在真实 Control UI 上的复发测试（ui，11-26）。
// 真实安装的 Control UI + 碧琪注入 + 假网关（tests/visual/lib/real-harness.mjs），Metre 模式、工作台开 README.md，
// 长 / 短分支名 × 1440 / 1280 / 1024 日间：
//   1. 右半边每个看得见的项都整项在框里（不留半截，main 上 1280 长分支名时「AI 补全」只露 3px）；碧琪键一直在；
//   2. 只按顺序藏（编码 → 换行 → 缩进 → 语言 → 语言服务 → 行列 → AI → PR，uireview #374 定），并且藏得刚好：把最后藏掉的一项放回来就又放不下；
//   3. 闪现提示（左半边）挤窄右半边时也重算，提示走后藏掉的项回来；
//   4. 不重画、只改窗口宽：1440 → 1024 仍没有半截，回到 1440 藏掉的项回来。
// 反例：删掉 laolao-workbench.js 里 renderStatus 末尾的 fitStatus() → 第 1 条在 1280 / 1024 长分支名时变红（PR 说明里有 main 上的实测）。
// 注意：右半边靠右对齐，溢出在左边，scrollWidth === clientWidth，所以这里按每项的框和右半边的框比，不看 scrollWidth。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REPO_ROOT,
  installRealControlUi,
  launchRealBrowser,
  openRealScenePage,
  startRealUiServer,
} from './visual/lib/real-harness.mjs';

const ORDER = ['enc', 'eol', 'indent', 'lang', 'lsp', 'ln', 'ai', 'pr'];
const LONG = 'feat/metre-ui4-r5-turn-readonly';
const NAMES = ['README.md', 'package.json', 'src/app.js'];

// 假网关只回 {}：这里在页里接住工作台要的 pinkie.fs.*（和 tools/pr-shots/254-wb-diff-tabs.mjs 同一套做法）。
const initScript = new Function(`
const NAMES = ${JSON.stringify(NAMES)};
const rel = (p) => { const s = String(p || ''); return s.startsWith('/proj/') ? s.slice(6) : s === '/proj' ? '' : s; };
const answers = {
  'pinkie.fs.status': () => ({root: '/proj', agentId: 'metre', name: 'proj', bound: true, unrestricted: false}),
  'pinkie.fs.list': (p) => { const d = rel(p.path); const kids = new Map();
    for (const n of NAMES) { if (d && !n.startsWith(d + '/')) continue; const rest = d ? n.slice(d.length + 1) : n; const head = rest.split('/')[0];
      kids.set(head, {name: head, path: d ? d + '/' + head : head, kind: rest.includes('/') ? 'dir' : 'file'}); }
    return {entries: [...kids.values()]}; },
  'pinkie.fs.read': (p) => { const c = ['# proj', '', 'npm run dev', ''].join(String.fromCharCode(10)); return {kind: 'text', content: c, path: p.path, readOnly: false, size: c.length, mtimeMs: 1}; },
  'pinkie.fs.stat': (p) => ({stats: (p.paths || []).map((x) => ({path: x, exists: true, kind: 'file', size: 10, mtimeMs: 1}))}),
  'pinkie.fs.git': () => ({repo: true, branch: localStorage.getItem('b50Branch') || 'main', ahead: 2, behind: 1, changes: [{path: 'README.md', status: 'M'}]}),
  'pinkie.fs.gitShow': () => ({content: '# proj' + String.fromCharCode(10), exists: true}),
};
const patch = (Cls) => {
  if (!Cls?.prototype || Cls.prototype.__b50) return;
  const orig = Cls.prototype.send;
  Cls.prototype.send = function b50Send(data) {
    let f = null; try { f = JSON.parse(data); } catch {}
    if (f && f.type === 'req' && Object.prototype.hasOwnProperty.call(answers, f.method)) {
      Promise.resolve().then(() => this._raw?.({type: 'res', id: f.id, ok: true, payload: answers[f.method](f.params || {})}));
      return;
    }
    return orig.call(this, data);
  };
  Cls.prototype.__b50 = true;
};
let cur = window.WebSocket;
Object.defineProperty(window, 'WebSocket', {configurable: true, enumerable: false, get: () => cur, set: (v) => { patch(v); cur = v; }});`);

// 右半边现场：每项的 data-opt、字、是否藏了、是否被切；再试「把最后藏掉的一项放回来」会不会切。
const inspect = (order) => {
  const right = document.querySelector('.pk-wb-status > .pk-wb-status__side:last-child');
  if (!right) return null;
  const cutNow = () => { const s = right.getBoundingClientRect();
    return [...right.children].filter((n) => n.offsetWidth).filter((n) => { const r = n.getBoundingClientRect(); return r.left < s.left - 0.5 || r.right > s.right + 0.5; })
      .map((n) => n.dataset.opt || String(n.className)); };
  const items = [...right.children].map((n) => ({opt: n.dataset.opt || '', text: (n.textContent || '').trim().slice(0, 32), hidden: getComputedStyle(n).display === 'none',
    inline: n.style.display === 'none', pinkie: n.classList.contains('pk-wb-status__pinkie')}));
  const cut = cutNow();
  const present = order.filter((k) => right.querySelector(`:scope > [data-opt="${k}"]`));
  const fitHidden = present.filter((k) => right.querySelector(`:scope > [data-opt="${k}"]`).style.display === 'none');
  let restoreCuts = null;
  if (fitHidden.length) {
    const last = right.querySelector(`:scope > [data-opt="${fitHidden[fitHidden.length - 1]}"]`);
    last.style.display = ''; restoreCuts = cutNow().length > 0; last.style.display = 'none';
  }
  return {width: Math.round(right.getBoundingClientRect().width), items, cut, present, fitHidden, restoreCuts};
};

async function openBench(page, branch, width) {
  await page.evaluate((b) => localStorage.setItem('b50Branch', b), branch);
  await page.setViewportSize({width, height: 900});
  await page.evaluate(() => window.__pinkieMetreBoard?.close?.());
  await page.evaluate(() => window.__pinkieWorkbench?.show?.());
  await page.evaluate(() => window.__pinkieWorkbench.open('README.md', {pinned: true}));
  await page.waitForFunction(() => window.__pinkieWorkbench.state.tabs.find((x) => x.path === 'README.md')?.kind === 'text', null, {timeout: 15_000});
  // Metre 的「PR」和代码模块的语言服务 / AI 补全都是异步挂上的，等三项都在再量。
  await page.waitForFunction(() => { const r = document.querySelector('.pk-wb-status > .pk-wb-status__side:last-child');
    return r && ['ln', 'pr', 'ai'].every((k) => r.querySelector(`:scope > [data-opt="${k}"]`)); }, null, {timeout: 15_000});
  await page.evaluate(() => window.__pinkieWorkbench.renderStatus());
  await page.waitForTimeout(300);
}

function checkFit(m, label) {
  assert.ok(m, `${label}：没有状态栏右半边`);
  const where = `${label} 现场 ${JSON.stringify(m)}`;
  assert.deepEqual(m.cut, [], `${label}：右半边有被切成半截的项。${where}`);
  assert.ok(m.items.some((i) => i.pinkie && !i.hidden), `${label}：碧琪键不该藏。${where}`);
  assert.deepEqual(m.fitHidden, m.present.slice(0, m.fitHidden.length), `${label}：只能按顺序从前往后藏。${where}`);
  if (m.fitHidden.length) assert.equal(m.restoreCuts, true, `${label}：藏多了，最后藏掉的那项放回来也放得下。${where}`);
}

test('工作台状态栏 real page: 放不下按顺序整项藏，不留半截（Metre，1440 / 1280 / 1024 日，长 / 短分支名）', async (t) => {
  const installed = installRealControlUi({repoRoot: REPO_ROOT});
  let server = null;
  let browser = null;
  t.after(async () => {
    try { await browser?.close(); }
    finally {
      try { await server?.close(); }
      finally { installed.cleanup(); }
    }
  });
  server = await startRealUiServer({controlUiDir: installed.controlUiDir, repoRoot: REPO_ROOT, runDir: installed.runDir});
  browser = await launchRealBrowser();

  for (const branch of ['main', LONG]) for (const width of [1440, 1280, 1024]) {
    await t.test(`${width} ${branch === 'main' ? '短' : '长'}分支名`, async () => {
      const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', 'day', {initScript});
      try {
        await openBench(page, branch, width);
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-laolao-mode')), 'metre');
        checkFit(await page.evaluate(inspect, ORDER), `${width} ${branch}`);
        assert.deepEqual(pageErrors, [], '页面不该报错');
      } finally { await context.close(); }
    });
  }

  // uireview #374 ①（协调者 14:25 定在本 PR 做）：分支名长到右半边藏完能藏的也放不下碧琪键时，左半边让——分支名缩成省略号（title 有全名），碧琪键整个露出来。
  // Linux 字体宽，1280 + LONG 就会这样；这里用更长的名字 + 1024，让 Windows 上也能复现。
  const HUGE = 'feat/metre-ui4-r5-turn-readonly-and-a-very-long-description-of-what-this-branch-changes';
  await t.test('分支名特别长：右半边只剩碧琪键也整个露出，分支名缩成省略号', async () => {
    const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', 'day', {initScript});
    try {
      await openBench(page, HUGE, 1024);
      const m = await page.evaluate(inspect, ORDER);
      const lay = await page.evaluate(() => { const s = document.querySelector('.pk-wb-status'); const w = (n) => n ? Math.round(n.getBoundingClientRect().width * 10) / 10 : null;
        const [l, r] = [s.firstElementChild, s.lastElementChild]; const pk = r.querySelector('.pk-wb-status__pinkie');
        return {bar: w(s), left: w(l), right: w(r), rightMin: r.style.minWidth, rightFlex: getComputedStyle(r).flex, leftFlex: getComputedStyle(l).flex, pinkie: w(pk), pinkieOffset: pk?.offsetWidth,
          leftKids: [...l.children].map((n) => `${String(n.className).replace('pk-wb-status__', '')}:${w(n)}:${getComputedStyle(n).flex}`)}; });
      checkFit(m, '1024 特长分支名 布局 ' + JSON.stringify(lay));
      const b = await page.evaluate(() => { const n = document.querySelector('.pk-wb-status__branch'); const s = n?.querySelector('.pk-wb-status__branch-name');
        const pk = document.querySelector('.pk-wb-status__pinkie').getBoundingClientRect(); const bar = document.querySelector('.pk-wb-status').getBoundingClientRect();
        return {title: n?.title || '', clipped: s ? s.scrollWidth > s.clientWidth : null, ellipsis: s ? getComputedStyle(s).textOverflow : '', pinkieIn: pk.left >= bar.left - 0.5 && pk.right <= bar.right + 0.5, pinkieW: Math.round(pk.width)}; });
      assert.ok(b.title.includes(HUGE), '分支键的 title 要有完整分支名。现场 ' + JSON.stringify(b));
      assert.equal(b.clipped, true, '这么长的分支名应该被缩短（不然碧琪键放不下）。现场 ' + JSON.stringify({b, m}));
      assert.equal(b.ellipsis, 'ellipsis', '分支名缩短要带省略号。现场 ' + JSON.stringify(b));
      assert.ok(b.pinkieIn && b.pinkieW > 30, '碧琪键要整个在状态栏里。现场 ' + JSON.stringify({b, m}));
      assert.deepEqual(m.fitHidden, m.present, '右半边能藏的应该先全藏了，才轮到左半边让。现场 ' + JSON.stringify(m));
      assert.deepEqual(pageErrors, [], '页面不该报错');
    } finally { await context.close(); }
  });

  // uireview #374：闪现提示（左半边 .pk-wb-status__flash）只改字、不重画，也要重算；提示走后字清空、藏掉的项回来。
  // 编辑卡要宽于 600px（容器查询 ≤600 会藏掉闪现提示），所以开 1920、把编辑卡压到 640px，长分支名下右半边刚好紧。
  await t.test('闪现提示挤窄右半边：不留半截，提示走后藏掉的项回来', async () => {
    const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', 'day', {initScript});
    try {
      await openBench(page, LONG, 1920);
      await page.evaluate(() => { const ed = document.querySelector('.pk-wb-editor'); ed.style.maxWidth = '640px'; ed.style.minWidth = '0'; });
      await page.waitForTimeout(400);
      const edW = await page.evaluate(() => Math.round(document.querySelector('.pk-wb-editor').getBoundingClientRect().width));
      assert.ok(edW > 600 && edW <= 660, '编辑卡宽 ' + edW + 'px，不在 601–660，测不到闪现提示');
      const before = await page.evaluate(inspect, ORDER);
      checkFit(before, '闪现前');
      await page.evaluate(() => window.__pinkieWorkbench.statusFlash('运行命令已发送到终端'));
      await page.waitForTimeout(150);
      const flashW = await page.evaluate(() => Math.round(document.querySelector('.pk-wb-status__flash')?.getBoundingClientRect().width || 0));
      const during = await page.evaluate(inspect, ORDER);
      checkFit(during, '闪现中（提示宽 ' + flashW + 'px）');
      assert.ok(flashW > 0 && during.fitHidden.length > before.fitHidden.length, '闪现提示应把右半边挤窄、多藏一项。现场 ' + JSON.stringify({edW, flashW, before, during}));
      await page.waitForFunction(() => !document.querySelector('.pk-wb-status__flash')?.textContent, null, {timeout: 6_000});
      await page.waitForTimeout(150);
      const after = await page.evaluate(inspect, ORDER);
      checkFit(after, '闪现后');
      assert.deepEqual(after.fitHidden, before.fitHidden, '提示走后藏掉的项应回来。现场 ' + JSON.stringify({before, after}));
      assert.deepEqual(pageErrors, [], '页面不该报错');
    } finally { await context.close(); }
  });

  // 只改编辑卡宽度、不调 renderStatus：Monaco 宿主跟着变宽窄，走的是已有的 editorResize 帧里的 fitStatus()。
  // （直接改视口不可靠：工作台不一定马上重排编辑卡，B50 首版测试里 1440 → 1024 后右半边仍是 101px。）
  await t.test('不重画只改宽：编辑卡变窄多藏、变回原宽藏掉的回来', async (tt) => {
    const {context, page, pageErrors} = await openRealScenePage(browser, server.origin, 'metre-board', 'day', {initScript});
    const sizes = () => page.evaluate(() => ({bar: Math.round(document.querySelector('.pk-wb-status')?.getBoundingClientRect().width || 0),
      editor: Math.round(document.querySelector('.pk-wb-editor')?.getBoundingClientRect().width || 0)}));
    const settle = async (before) => {
      await page.waitForFunction((w) => Math.round(document.querySelector('.pk-wb-status').getBoundingClientRect().width) !== w, before, {timeout: 5_000}).catch(() => {});
      await page.waitForTimeout(200);   // editorResize 是 ResizeObserver + 一帧
    };
    try {
      await openBench(page, 'main', 1440);
      const wide = await page.evaluate(inspect, ORDER);
      checkFit(wide, '1440 起始');
      const start = await sizes();
      await page.evaluate(() => { const ed = document.querySelector('.pk-wb-editor'); ed.style.maxWidth = '300px'; ed.style.minWidth = '0'; });
      await settle(start.bar);
      const narrowSize = await sizes();
      assert.ok(narrowSize.bar < start.bar, `编辑卡没变窄，测不到 resize。宽度 ${JSON.stringify({start, narrowSize})}`);
      const narrow = await page.evaluate(inspect, ORDER);
      checkFit(narrow, `编辑卡缩到 ${narrowSize.bar}px（没调 renderStatus）`);
      assert.ok(narrow.fitHidden.length > wide.fitHidden.length, `缩窄后应多藏几项。宽度 ${JSON.stringify({start, narrowSize})} 现场 ${JSON.stringify({wide, narrow})}`);
      await page.evaluate(() => { const ed = document.querySelector('.pk-wb-editor'); ed.style.maxWidth = ''; ed.style.minWidth = ''; });
      await settle(narrowSize.bar);
      const back = await page.evaluate(inspect, ORDER);
      checkFit(back, '编辑卡变回原宽');
      assert.deepEqual(back.fitHidden, wide.fitHidden, `变回原宽藏掉的项应回来。现场 ${JSON.stringify({wide, back})}`);
      // 只记不判：直接改视口后编辑卡会不会跟着重排（给 PR 说明用）。
      await page.setViewportSize({width: 1024, height: 900});
      await settle((await sizes()).bar);
      tt.diagnostic(`视口 1440 → 1024 后 ${JSON.stringify(await sizes())}，起始 ${JSON.stringify(start)}；右半边半截项：${JSON.stringify((await page.evaluate(inspect, ORDER)).cut)}`);
      assert.deepEqual(pageErrors, [], '页面不该报错');
    } finally { await context.close(); }
  });
});
