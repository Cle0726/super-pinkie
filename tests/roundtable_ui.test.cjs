const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('ui/roundtable/index.html');
const js = read('ui/roundtable/roundtable.js');
const css = read('ui/roundtable/roundtable.css');
const sceneCss = read('ui/roundtable/roundtable-scene.css');
const server = read('services/roundtable/server.py');
const entry = read('ui/injections/laolao-roundtable-entry.js');

test('roundtable remains an independent workspace entry', () => {
  assert.match(entry, /chat-workspace-rail/);
  assert.match(entry, /18891/);
  assert.doesNotMatch(entry, /mode-option|mode-switcher/);
});

test('generated visual suite is shipped and actually routed into the UI', () => {
  const assets = [
    'laolao-roundtable-workroom-v3.png',
    'laolao-roundtable-crest-v1.png',
    'laolao-roundtable-project-v1.png',
    'laolao-roundtable-stages-v1.png',
    'laolao-roundtable-tools-v1.png',
  ];
  for (const asset of assets) assert.ok(fs.existsSync(path.join(root, 'ui/assets', asset)), asset);
  for (const route of ['/workroom.png','/crest.png','/project-emblem.png','/stage-totems.png','/tool-totems.png']) {
    assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
  }
  assert.match(css, /url\('\/stage-totems\.png'\)/);
  assert.match(css, /url\('\/tool-totems\.png'\)/);
  assert.match(html, /src="\/project-emblem\.png"/);
});

test('workspace can choose, create, bind and reveal a real project folder', () => {
  assert.match(html, /选择已有文件夹/);
  assert.match(html, /新建空项目/);
  assert.match(js, /laolaoProjectFolder/);
  assert.match(js, /\/api\/projects/);
  assert.match(js, /bindCurrentProject/);
  assert.match(js, /revealProject/);
  assert.match(server, /def validate_project/);
  assert.match(server, /def create_project/);
});

test('all seat models are user selectable and the system only assigns roles', () => {
  assert.match(js, /为'\+info\.name\+'选择模型/);
  assert.match(js, /saveModel/);
  assert.match(js, /落地执行/);
  assert.match(server, /session\['models'\]\[synthesizer\]/);
  assert.match(html, /模型全部由你选择/);
  assert.doesNotMatch(html, /本机 Codex|指定 Codex/);
});

test('four visible stages end in real project execution', () => {
  for (const stage of ['ideas','challenge','consensus','execute']) assert.match(html, new RegExp(`data-stage="${stage}"`));
  for (const label of ['出主意','挑问题','说人话','真执行']) assert.match(html, new RegExp(label));
  assert.match(server, /openclaw-live\.mjs/);
  assert.match(server, /worker_sandbox/);
  assert.match(server, /cwd=project/);
  assert.match(server, /stream_message/);
});

test('work UI has no redundant top bar or unstable blur compositor', () => {
  assert.doesNotMatch(html, /discussion-head/);
  assert.doesNotMatch(css, /backdrop-filter:blur/);
  assert.match(sceneCss, /backdrop-filter:none/);
  assert.match(css, /background:url\('\/workroom\.png'\)/);
  assert.match(html, /id="toggle-seats"/);
});

test('streaming work, tools and plain-language summary have separate UI states', () => {
  assert.match(js, /message\.kind==='progress'/);
  assert.match(js, /message\.kind==='tool'/);
  assert.match(js, /message\.kind==='summary'/);
  assert.match(js, /tool-icon/);
  assert.match(js, /summary-mark/);
  assert.match(html, /id="jump-latest"/);
  assert.match(server, /完成了什么：/);
  assert.match(server, /验证结果：/);
});

test('roundtable names agree with Party Space for shared ponies', () => {
  for (const name of ['碧琪','紫悦','云宝','珍奇','柔柔','苹果嘉儿']) assert.match(server, new RegExp(`'name': '${name}'`));
  for (const wrong of ['暮光闪闪','云宝黛西','小蝶']) assert.doesNotMatch(server, new RegExp(`'name': '${wrong}'`));
  assert.match(server, /laolao-party-twilight-v1\.png/);
  assert.match(server, /laolao-party-rainbow-v1\.png/);
});
