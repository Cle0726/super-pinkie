import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionHintBlock, noteCompaction, forgetSessionHints, listedTasks} from '../services/mode-architecture/session-hints.mjs';

test('no hint for ordinary messages, child sessions, or the unrestricted mode', () => {
  forgetSessionHints();
  assert.equal(sessionHintBlock('agent:project:a', '帮我把这个按钮改成蓝色', ['code'], {mode: 'project'}), '');
  assert.equal(sessionHintBlock('agent:project:pinkie-child:abc', '另开一个会话做这个', ['code'], {mode: 'project'}), '');
  assert.equal(sessionHintBlock('agent:x:a', '另开一个会话做这个', ['code'], {mode: 'none'}), '');
});
test('explicit request starts right away with user_asked', () => {
  forgetSessionHints();
  const hint = sessionHintBlock('agent:project:a', '这个放到后台跑，我先问你别的', ['code'], {mode: 'project'});
  assert.match(hint, /user_asked/);
});
test('several listed tasks: offer cards, parallel wording says so', () => {
  forgetSessionHints();
  const many = '1. 帮我把登录页重做一版\n2. 写一份用户调研报告\n3. 整理一下上个月的账单表格';
  assert.equal(listedTasks(many), 3);
  assert.match(sessionHintBlock('agent:project:a', many, ['web_ui'], {mode: 'project'}), /offer/);
  const parallel = '同时做这两件：\n- 重构订单模块的代码\n- 写一份接口文档';
  assert.match(sessionHintBlock('agent:project:b', parallel, ['code'], {mode: 'project'}), /并行/);
});
test('topic switch in a long session is hinted once, not every turn', () => {
  forgetSessionHints();
  const key = 'agent:chat:a';
  for (let i = 0; i < 14; i += 1) assert.equal(sessionHintBlock(key, '继续改这个网页的样式', ['web_ui'], {mode: 'chat'}), '');
  const hint = sessionHintBlock(key, '帮我分析一下这份销售数据的趋势', ['data_charts'], {mode: 'chat'});
  assert.match(hint, /不是一件事/); assert.match(hint, /offer/);
  assert.equal(sessionHintBlock(key, '再写一篇公众号文章介绍它', ['writing'], {mode: 'chat'}), '');
});
test('after several compactions a tidy hand-over card is suggested once', () => {
  forgetSessionHints();
  const key = 'agent:project:c';
  for (let i = 0; i < 3; i += 1) noteCompaction(key);
  assert.match(sessionHintBlock(key, '继续', ['code'], {mode: 'project'}), /own_initiative/);
  assert.equal(sessionHintBlock(key, '继续', ['code'], {mode: 'project'}), '');
  noteCompaction(key); noteCompaction(key);
  assert.match(sessionHintBlock(key, '继续', ['code'], {mode: 'project'}), /压缩过 5 次/);
});
