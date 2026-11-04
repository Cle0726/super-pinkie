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
});
