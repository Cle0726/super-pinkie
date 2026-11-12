import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

test('the bundled plugin rewrites both outbound reply paths and preserves other payload fields', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-renderer-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const fakeSDK = path.join(temporary, 'node_modules/openclaw');
  fs.mkdirSync(fakeSDK, {recursive: true});
  fs.writeFileSync(path.join(fakeSDK, 'package.json'), JSON.stringify({type: 'module',
    exports: {'./plugin-sdk/plugin-entry': './entry.mjs'}}));
  fs.writeFileSync(path.join(fakeSDK, 'entry.mjs'), 'export const definePluginEntry = value => value;\n');
  const source = fileURLToPath(new URL('../services/first-person-renderer/index.mjs', import.meta.url));
  const entry = path.join(temporary, 'index.mjs');
  fs.copyFileSync(source, entry);
  const {default: plugin} = await import(pathToFileURL(entry));
  const hooks = new Map();
  plugin.register({on: (name, callback) => hooks.set(name, callback)});
  assert.deepEqual(await hooks.get('message_sending')({content: '我来帮你'}), {content: '碧琪来帮你'});
  const payload = {text: '我做好了', content: '我在', caption: '我的图', mediaUrl: '/image.png'};
  const result = await hooks.get('reply_payload_sending')({payload});
  assert.deepEqual(result.payload, {text: '碧琪做好了', content: '碧琪在', caption: '碧琪的图', mediaUrl: '/image.png'});
  assert.deepEqual((await hooks.get('reply_payload_sending')(result)).payload, result.payload);
  assert.equal(await hooks.get('reply_payload_sending')({payload: null}), undefined);
});

test('first-person rendering keeps code, links, 我们 and idioms, and both copies agree', async t => {
  const {renderFirstPerson} = await import('../services/mode-architecture/first-person.mjs');
  const cases = [
    ['我来帮你', '碧琪来帮你'],
    ['我们一起看看，我先打开', '我们一起看看，碧琪先打开'],
    ['先做个自我介绍：我是碧琪，做事忘我', '先做个自我介绍：碧琪是碧琪，做事忘我'],
    ['我改了 `print("我")`，链接 [我的](https://x.cn/我) 也在', '碧琪改了 `print("我")`，链接 [碧琪的](https://x.cn/我) 也在'],
    ['我写好了：\n```js\nconst me = "我";\n```\n我再检查', '碧琪写好了：\n```js\nconst me = "我";\n```\n碧琪再检查'],
    ['见 https://a.cn/我/b 我', '见 https://a.cn/我/b 碧琪'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(renderFirstPerson(input), expected);
    assert.equal(renderFirstPerson(expected), expected);
  }
  assert.equal(renderFirstPerson(null), null);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-renderer-same-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const fakeSDK = path.join(temporary, 'node_modules/openclaw');
  fs.mkdirSync(fakeSDK, {recursive: true});
  fs.writeFileSync(path.join(fakeSDK, 'package.json'), JSON.stringify({type: 'module', exports: {'./plugin-sdk/plugin-entry': './entry.mjs'}}));
  fs.writeFileSync(path.join(fakeSDK, 'entry.mjs'), 'export const definePluginEntry = value => value;\n');
  const entry = path.join(temporary, 'index.mjs');
  fs.copyFileSync(fileURLToPath(new URL('../services/first-person-renderer/index.mjs', import.meta.url)), entry);
  const {default: plugin} = await import(pathToFileURL(entry));
  const hooks = new Map();
  plugin.register({on: (name, callback) => hooks.set(name, callback)});
  for (const [input, expected] of cases) assert.deepEqual(await hooks.get('message_sending')({content: input}), {content: expected});
  const shared = fs.readFileSync(new URL('../services/mode-architecture/first-person.mjs', import.meta.url), 'utf8');
  const embedded = fs.readFileSync(new URL('../services/first-person-renderer/index.mjs', import.meta.url), 'utf8');
  const rules = text => text.slice(text.indexOf('const KEEP_WORDS'), text.indexOf('\n}\n', text.indexOf('function renderFirstPerson')) ).replace('export ', '');
  assert.equal(rules(embedded), rules(shared));
  // The App chat window renders the same rules in the browser (indented inside an IIFE).
  const ui = fs.readFileSync(new URL('../ui/injections/laolao-first-person.js', import.meta.url), 'utf8');
  const uiRules = text => text.slice(text.indexOf('const KEEP_WORDS'), text.indexOf('// --- first-person rules end ---'))
    .split('\n').map(line => line.replace(/^  /, '')).join('\n').trimEnd();
  assert.equal(uiRules(ui), (rules(shared) + '\n}').trimEnd());
});

test('the App chat window shows 碧琪 for every mode through one display-only injection', () => {
  const fragment = fs.readFileSync(new URL('../ui/injections/laolao-head.fragment.html', import.meta.url), 'utf8');
  assert.match(fragment, /<script defer src="\/laolao-first-person\.js\?v=firstperson\d+"><\/script>/);
  const ui = fs.readFileSync(new URL('../ui/injections/laolao-first-person.js', import.meta.url), 'utf8');
  // Only text node values change: no element rewrites that would break Lit markers.
  assert.doesNotMatch(ui, /\.(?:innerHTML|textContent|innerText)\s*=[^=]/);
  // Never a whole-page subtree observer; the app mount and the study-desk event only.
  assert.doesNotMatch(ui, /observe\(document\.body,\s*\{[^}]*subtree/);
  assert.match(ui, /pinkie:desk-conversation-rendered/);
  for (const skipped of ['.chat-tool-card', '.chat-timeline-tool-row', 'pre', 'code', 'textarea']) assert.ok(ui.includes(`'${skipped}'`), skipped);
});

test('first-person rendering leaves alone what 碧琪 is not saying about herself, and does not repeat the name in one sentence', async () => {
  const {renderFirstPerson: r} = await import('../services/mode-architecture/first-person.mjs');
  const cases = [
    // 同一句里逗号后的主语省掉；换了人、换了句、不是主语时不省
    ['我看了一下，我觉得可以，我先改配色。我再截图。', '碧琪看了一下，觉得可以，先改配色。碧琪再截图。'],
    ['我改好了，你看看，我再调', '碧琪改好了，你看看，碧琪再调'],
    ['这是我的方案，我觉得不错', '这是碧琪的方案，碧琪觉得不错'],
    ['我查了，我这边没问题，我的建议是先备份', '碧琪查了，碧琪这边没问题，碧琪的建议是先备份'],
    // 引号里是按钮名、用户的原话、起草的句子
    ['你可以点「帮我改成暗色」，我马上改。', '你可以点「帮我改成暗色」，碧琪马上改。'],
    ['你说“我想要简单点”，我就删了两块', '你说“我想要简单点”，碧琪就删了两块'],
    // 引用行和两条分隔线之间是替用户写的稿子
    ['> 我想请三天假\n我按正式语气写的', '> 我想请三天假\n碧琪按正式语气写的'],
    ['写好了：\n\n---\n大家好，我想请假。\n---\n\n我按正式语气写的。', '写好了：\n\n---\n大家好，我想请假。\n---\n\n碧琪按正式语气写的。'],
    ['大家好，我叫小王，我喜欢画画。\n我写了两版。', '大家好，我叫小王，我喜欢画画。\n碧琪写了两版。'],
    // 路径、文件名、系统里的名字
    ['文件在 ~/Documents/我的项目/a.txt，我的简历.docx 也在。', '文件在 ~/Documents/我的项目/a.txt，我的简历.docx 也在。'],
    ['放在 C:\\Users\\我\\Desktop 了，我没动别的', '放在 C:\\Users\\我\\Desktop 了，碧琪没动别的'],
    ['打开「我的电脑」，我来教你', '打开「我的电脑」，碧琪来教你'],
    ['在我的文档里，我找到了', '在我的文档里，碧琪找到了'],
    // 「我国、我方」不是碧琪自己；「我方案、我省了」是
    ['我国的标准是这样，我方案如下', '我国的标准是这样，碧琪方案如下'],
    ['我方认为可行；我校对了一遍，我省了一步', '我方认为可行；碧琪校对了一遍，省了一步'],
    ['你我之间，我们一起，时不我待', '你我之间，我们一起，时不我待'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(r(input), expected);
    assert.equal(r(expected), expected, `idempotent: ${input}`);
  }
});
