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
