import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionHintBlock, noteCompaction, forgetSessionHints, listedTasks, modeAffinity} from '../services/mode-architecture/session-hints.mjs';

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
test('several listed tasks start in parallel as in_scope children, no click needed', () => {
  forgetSessionHints();
  const many = '1. 帮我把登录页重做一版\n2. 写一份用户调研报告\n3. 整理一下上个月的账单表格';
  assert.equal(listedTasks(many), 3);
  const listed = sessionHintBlock('agent:project:a', many, ['web_ui'], {mode: 'project'});
  assert.match(listed, /in_scope/); assert.doesNotMatch(listed, /offer/);
  const parallel = '同时做这两件：\n- 重构订单模块的代码\n- 写一份接口文档';
  const both = sessionHintBlock('agent:project:b', parallel, ['code'], {mode: 'project'});
  assert.match(both, /并行/); assert.match(both, /in_scope/);
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

test('mode affinity: only confident, one-sided matches point at another mode', () => {
  assert.equal(modeAffinity('这个页面配色怎么更高级', 'project'), 'ideas');
  assert.equal(modeAffinity('帮我起个店名', 'project'), 'ideas');
  assert.equal(modeAffinity('帮我做个好看的网页', 'project'), '', 'making it is the job of this mode');
  assert.equal(modeAffinity('帮我写一个记账的网页', 'chat'), 'project');
  assert.equal(modeAffinity('帮我把这个bug修了', 'ideas'), 'project');
  assert.equal(modeAffinity('这道题怎么做啊老师没讲', 'chat'), 'learning');
  assert.equal(modeAffinity('我想系统学一下Python', 'project'), 'learning');
  assert.equal(modeAffinity('配色怎么选', 'ideas'), '');
  assert.equal(modeAffinity('给我讲讲闭包', 'learning'), '');
  assert.equal(modeAffinity('今天好累啊', 'project'), '');
  assert.equal(modeAffinity('这个页面配色怎么更高级', 'none'), '', 'the unrestricted mode never routes elsewhere');
});
test('another mode is suggested through pinkie_mode_ask, not repeated every turn, and recommended once', () => {
  forgetSessionHints();
  const key = 'agent:project:m';
  const first = sessionHintBlock(key, '这个页面配色怎么更高级', ['simple'], {mode: 'project'});
  assert.match(first, /【别的模式更拿手】/); assert.match(first, /pinkie_mode_ask/); assert.match(first, /mode 写 ideas/);
  assert.match(first, /只说这一次/);
  assert.equal(sessionHintBlock(key, '那字体怎么选更好看', ['simple'], {mode: 'project'}), '', 'not on every turn');
  for (let i = 0; i < 5; i += 1) sessionHintBlock(key, '继续改登录接口的代码', ['code'], {mode: 'project'});
  const later = sessionHintBlock(key, '这个按钮的配色是不是太土了', ['simple'], {mode: 'project'});
  assert.match(later, /pinkie_mode_ask/); assert.doesNotMatch(later, /只说这一次/);
  const study = sessionHintBlock('agent:main:n', '我想系统学一下Python，怎么学', ['simple'], {mode: 'chat'});
  assert.match(study, /学习台/);
  assert.equal(sessionHintBlock('agent:project:pinkie-child:abc', '这个页面配色怎么更高级', ['simple'], {mode: 'project'}), '');
});
test('a split hint and a mode hint can arrive together', () => {
  forgetSessionHints();
  const text = '同时做这两件：\n- 重构订单模块的代码\n- 设计新首页更高级的配色方向';
  const hint = sessionHintBlock('agent:project:z', text, ['code'], {mode: 'project'});
  assert.match(hint, /【子会话的时机】/); assert.match(hint, /in_scope/);
});
