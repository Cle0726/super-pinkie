const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The slider's route marks must say the same thing as recipeFor() in reasoning.mjs.
const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-model-picker.js'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = [
  slice('  const MATERIALS = [', '  // The nine visual choices'),
  slice('  function nativeTierFor(', '  function selectionFor('),
  slice('  function routeKind(', '  function syncStops('),
  'this.routeKind = routeKind; this.routeDescription = routeDescription;',
].join('\n');
const context = {};
vm.runInNewContext(code, context);
const {routeKind, routeDescription} = context;
const GEMINI = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const GLM = ['high'];

test('each stop is marked native, made up by process, or only faster on this model', async () => {
  const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'ultra'];
  const recipe = (await import('../services/mode-architecture/reasoning.mjs')).recipeFor;
  const ui = {native: 'native', down: 'down', up: 'fill', enhanced: 'fill', adaptive: 'fill'};
  for (const [natives, record] of [[GEMINI, {reasoning: true, compat: {supportedReasoningEfforts: GEMINI}}], [GLM, {reasoning: true, compat: {supportedReasoningEfforts: GLM}}], [['off'], {reasoning: false}]]) {
    for (const level of levels) {
      assert.equal(routeKind(level, natives), ui[recipe(level, record).kind], `${natives.join('/')} · ${level}`);
    }
  }
});

test('the hover text says plainly what each kind of stop does', () => {
  assert.equal(routeDescription('high', GEMINI), '当前模型原生支持这一档');
  assert.match(routeDescription('minimal', GLM), /最低只到 High.*更快.*（模拟）/);
  assert.match(routeDescription('xhigh', GLM), /原生最高到 High；碧琪补 1 份独立起草 \+ 打开成品审稿/);
  // 2026-11-09 升级逻辑：Medium 先弄懂，High 再加交前自查；Medium 以下不补，按最接近的原生档发送。
  assert.match(routeDescription('medium', ['off']), /拆清要求，动手的活先列验收清单/);
  assert.match(routeDescription('high', ['off']), /拆清要求，交之前再逐条核一遍/);
  assert.match(routeDescription('low', ['off']), /当前模型没有这一档，按最接近的 .+ 发送/);
  assert.match(routeDescription('adaptive', GLM), /写东西、做选择按 Medium/);
  // 补强 = 碧琪替这个模型多做一步：拆题 / 独立起草 / 打开成品审稿（reasoning.mjs 的审稿员带只读工具）。
  assert.match(routeDescription('max', GEMINI), /碧琪替当前模型多做一步：2 份独立起草.*打开成品审稿/);
  assert.match(routeDescription('ultra', GLM), /3 份独立起草/);
  assert.match(routeDescription('adaptive', GLM), /动手的活和难题按 XHigh/);
  assert.match(routeDescription('minimal', GLM), /动手的活仍做必要的一次验证/);
  assert.doesNotMatch(routeDescription('ultra', GLM) + routeDescription('max', GLM), /换模型/, 'helpers always use the selected model');
});

test('all nine visible captions contain only the tier name, retaining routing descriptions and semantics', () => {
  const key = 'agent:learning:caption';
  const label = {dataset: {}, textContent: ''};
  const panel = {querySelector: () => label};
  const menu = {querySelector: () => panel};
  const details = {dataset: {}, closest: () => ({dataset: {sessionKey: key}}), querySelector: () => null};
  const document = {addEventListener() {}};
  const window = {addEventListener() {}, localStorage: {getItem: () => null, setItem() {throw Error('captions must not save a selection');}}};
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'window.testCaption = {syncLevelName, MATERIALS, LEVEL_LABELS};})();'), {document, window});
  const {syncLevelName, MATERIALS, LEVEL_LABELS} = window.testCaption;
  for (const native of [GLM, GEMINI, ['off']]) {
    for (let i = 0; i < MATERIALS.length; i++) {
      const attributes = {};
      const range = {dataset: {chatThinkingValues: MATERIALS.join(','), pinkieNativeValues: native.join(',')}, value: String(i), disabled: false, setAttribute: (name, value) => attributes[name] = value};
      syncLevelName(details, menu, range);
      const tier = MATERIALS[i];
      assert.equal(label.textContent, LEVEL_LABELS[tier], `${native.join('/')} · ${tier}`);
      assert.equal(label.dataset.pinkieRoute, routeKind(tier, native), 'route classification stays intact');
      assert.match(attributes['aria-valuetext'], new RegExp('^' + LEVEL_LABELS[tier] + '，'));
      assert.ok(label.title.includes(routeDescription(tier, native)), 'the mechanism stays available on hover');
    }
  }
});
