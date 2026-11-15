// Metre 看到的工具说明不叫「先生」「碧琪」。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAskUserTool, metreWording} from '../services/mode-architecture/ask.mjs';

test('Metre 的 ask_user 说明里没有「先生」「碧琪」，执行函数和参数名不变；别的模式原样', async () => {
  const base = createAskUserTool();
  const metre = metreWording(base, 'agent:metre:main');
  assert.doesNotMatch(JSON.stringify({...metre, execute: undefined}), /先生|碧琪/);
  assert.match(metre.description, /用户/);
  assert.equal(metre.execute, base.execute);
  assert.deepEqual(Object.keys(metre.parameters.properties), Object.keys(base.parameters.properties));
  assert.equal(metreWording(base, 'agent:project:x'), base);
  assert.equal(metreWording(null, 'agent:metre:x'), null);
});