// P4：小碧琪气泡和小帮手模型设置弹窗不再把英文异常原文写进界面。
// 复发场景：网关断线 / 超时时 gwRequest 抛 Error('gateway timeout') / Error('gateway socket unavailable')，
// 修复前气泡显示「碧琪这次没连上：gateway timeout」，设置弹窗状态行直接显示 error.message。
// 修复后显示中文说明，原文只进 console.warn；服务端 companion.mjs 本来就是中文的提示照原样显示。
// 直接取 ui/injections/laolao-companion.js 里的真实 zhError / ask 来跑。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-companion.js'), 'utf8');
const line = (prefix) => {
  const start = source.indexOf(prefix);
  assert.ok(start >= 0, `找不到 ${prefix}`);
  return source.slice(start, source.indexOf('\n', start));
};
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return source.slice(start, end);
};

function harness(gwRequest, currentMode = 'chat') {
  const warnings = [];
  const context = {
    window: {__laolaoSidebar: {gwRequest}},
    console: {warn: (...args) => warnings.push(args.map(a => String(a?.message || a)).join(' '))},
    setTimeout: (fn) => { fn(); return 0; },
  };
  const code = `(() => {
    const mode = () => ${JSON.stringify(currentMode)};
    const preview = false, DEMO = {}, DEMO_CLARIFY = () => ({});
    ${line('const esc = ')}
    ${source.includes('const zhError = ') ? line('const zhError = ') : 'const zhError = undefined;'}
    ${between('const helperRequests = ', '/* ── 碧琪本体')}
    return {ask, zhError};
  })()`;
  return {...vm.runInNewContext(code, context, {filename: 'laolao-companion.js'}), warnings};
}

const ENGLISH = /gateway|timeout|socket|unavailable|ECONN|undefined|\[object/i;

for (const raw of ['gateway timeout', 'gateway socket unavailable', 'gateway error']) {
  test(`小碧琪气泡：网关报「${raw}」时显示中文，原文进日志`, async () => {
    const {ask, warnings} = harness(async () => { throw new Error(raw); });
    const res = await ask('explain', {text: 'API'});
    assert.match(res.html, /^碧琪这次没连上：/);
    assert.doesNotMatch(res.html, ENGLISH);
    assert.match(res.html, /[㐀-鿿]{4,}/);
    assert.ok(warnings.some(w => w.includes(raw)), `原文应进日志，实际：${warnings.join(' | ')}`);
  });
}

test('小碧琪气泡：服务端回的中文提示照原样显示', async () => {
  const {ask} = harness(async () => { throw new Error('小帮手等独立模型回复超时了，请稍后再试'); });
  const res = await ask('summary', {text: '一段很长的回复'});
  assert.equal(res.html, '碧琪这次没连上：小帮手等独立模型回复超时了，请稍后再试');
});

test('设置弹窗用的 zhError：英文、堆栈、JSON、非 Error 值都换成中文兜底', () => {
  const {zhError, warnings} = harness(async () => ({}));
  const fallback = '保存失败，请再试一次。';
  assert.equal(zhError(new Error('gateway timeout'), fallback), fallback);
  assert.equal(zhError(new Error('Traceback (most recent call last):\n  File "x.py"'), fallback), fallback);
  assert.equal(zhError(new Error('保存失败 {"code":"E"}'), fallback), fallback);
  assert.equal(zhError(new Error('设置 failed to write file'), fallback), fallback);
  assert.equal(zhError({code: 42}, fallback), fallback);
  assert.equal(zhError(undefined, fallback), fallback);
  assert.equal(zhError(new Error('输出上限需要在 256 到 32000 之间'), fallback), '输出上限需要在 256 到 32000 之间');
  assert.ok(warnings.length >= 7, '每次都应把原文写进日志');
});

test('所有显示报错的地方都走 zhError，不再直接用 error.message', () => {
  for (const fallback of ['保存失败，请再试一次。', '未连接成功，可以换模型或调整参数后再试。', '暂时读不到设置，请稍后重新打开。']) {
    assert.ok(source.includes(`showStatus(zhError(error,"${fallback}"),true)`), `设置弹窗「${fallback}」那行应走 zhError`);
  }
  assert.doesNotMatch(source, /showStatus\(error\.message/);
  assert.doesNotMatch(source, /say\(esc\(error\.message\)\)/);
  assert.doesNotMatch(source, /没连上：\$\{esc\(error\?\.message/);
});
