// tools/study-desk/drill-qa.mjs 的纯逻辑部分：假组卷 / 假后端（drill-fixtures.mjs）与奖励层源码静态检查。
// drill-qa.mjs 本身一导入就会起浏览器跑录像和截图（只在 Mac 上手动跑），这里不导入它，
// 只验它依赖的假数据是否自洽、假后端的分支是否如注释所说，以及它那条「只动 transform / opacity」的静态检查。
// 不起浏览器、不联网、不碰 18789 与用户目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIXTURES, MODES, SUMMARIES, drillHandler} from '../tools/study-desk/drill-fixtures.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const read = rel => fs.readFileSync(path.join(repo, rel), 'utf8');

// 选项类题型：answer 是选项下标。
const OPTION_MODES = ['choice', 'truefalse', 'word2meaning', 'meaning2word', 'listen'];
// 填空类题型：prompt 里的 {{n}} 个数要和 answer 一致，答案都在词库里。
const CLOZE_MODES = ['cloze', 'collocation'];
const PAIR_MODES = ['pairs', 'homophonePairs'];

test('每种题型都有且只有一张假卡，itemId 与 mode 都等于题型名', () => {
  assert.equal(new Set(MODES).size, MODES.length, 'MODES 不应有重复');
  assert.deepEqual(Object.keys(FIXTURES).sort(), [...MODES].sort());
  for (const mode of MODES) {
    const card = FIXTURES[mode];
    assert.equal(card.itemId, mode);
    assert.equal(card.mode, mode);
    assert.ok(card.prompt && typeof card.prompt === 'string', `${mode} 缺题干`);
    assert.deepEqual(card.cardRef, {book: 'notes', noteId: 'n-' + mode, recallId: 'r-' + mode, wordId: 'w-' + mode});
    assert.ok(card.reveal && typeof card.reveal.answer === 'string' && card.reveal.answer, `${mode} 缺揭晓答案`);
  }
  // 初见类卡片强度为 0，主动输出类为 3，其余默认 1。
  assert.equal(FIXTURES.look.strength, 0);
  assert.equal(FIXTURES.meet.strength, 0);
  for (const mode of ['order', 'write', 'spell', 'dictate']) assert.equal(FIXTURES[mode].strength, 3, mode);
  assert.equal(FIXTURES.choice.strength, 1);
});

test('选项类假卡的正确下标在范围内，且与揭晓答案、发音一致', () => {
  for (const mode of OPTION_MODES) {
    const {options, answer, reveal} = FIXTURES[mode];
    assert.ok(Array.isArray(options) && options.length >= 2, `${mode} 至少两个选项（drill-qa 答错时要点另一个）`);
    assert.ok(Number.isInteger(answer) && answer >= 0 && answer < options.length, `${mode} 下标越界`);
    assert.ok(reveal.answer.startsWith(options[answer]), `${mode} 揭晓答案 ${reveal.answer} 与选项 ${options[answer]} 对不上`);
  }
  // 听音选词：读出来的词就是正确选项。
  assert.equal(FIXTURES.listen.speak, FIXTURES.listen.options[FIXTURES.listen.answer]);
});

test('填空、配对、拼写类假卡的答案结构自洽', () => {
  for (const mode of CLOZE_MODES) {
    const {prompt, answer, bank} = FIXTURES[mode];
    const blanks = prompt.match(/\{\{\d+\}\}/g) || [];
    assert.equal(blanks.length, answer.length, `${mode} 空格数与答案数不一致`);
    for (const word of answer) assert.ok(bank.includes(word), `${mode} 答案 ${word} 不在词库`);
    // drill-qa 答对点第 0 个词块、答错点第 1 个：第 0 个必须是答案，第 1 个必须不是。
    assert.equal(bank[0], answer[0]);
    assert.notEqual(bank[1], answer[0]);
  }
  for (const mode of PAIR_MODES) {
    const {pairs, answer} = FIXTURES[mode];
    assert.equal(pairs.left.length, pairs.right.length, `${mode} 两栏长度不同`);
    assert.equal(answer.length, pairs.left.length);
    assert.deepEqual(answer.map(([l]) => l).sort(), pairs.left.map((_, i) => i));
    assert.deepEqual(answer.map(([, r]) => r).sort(), pairs.right.map((_, i) => i));
  }
  for (const mode of ['spell', 'dictate']) assert.equal(FIXTURES[mode].answer, FIXTURES[mode].speak, `${mode} 听到的和要拼的应是同一个词`);
  assert.ok(FIXTURES.order.steps.length >= 2);
  assert.equal(new Set(FIXTURES.order.steps).size, FIXTURES.order.steps.length, 'order 步骤不能重复，否则按文字点不出顺序');
  assert.equal(FIXTURES.write.judge, 'model');
});

test('结算页样例：罐子、连续章与一周格子的数字彼此对得上', () => {
  assert.deepEqual(Object.keys(SUMMARIES).sort(), ['full', 'normal', 'quiet']);
  for (const [name, s] of Object.entries(SUMMARIES)) {
    const week = s.streak.weekKind;
    assert.equal(week.length, 7, `${name} 一周应有 7 格`);
    const today = week.findLastIndex(kind => kind !== 'future');
    assert.ok(today >= 0);
    assert.ok(week.slice(today + 1).every(kind => kind === 'future'), `${name} 今天之后只能是 future`);
    assert.equal(s.streak.current, week.filter(kind => kind === 'stamped' || kind === 'leave').length, `${name} 连续天数与格子不符`);
    assert.equal(s.streak.stampedToday, week[today] === 'stamped');
    assert.equal(Boolean(s.streak.leaveUsedYesterday), week[today - 1] === 'leave', `${name} 昨天请假标记与格子不符`);
    assert.equal(s.jar.filledNow, s.jar.today >= s.jar.goal, `${name} 罐满标记与数字不符`);
    assert.ok(s.jar.today <= s.jar.goal);
    assert.ok(s.accuracy >= 0 && s.accuracy <= 1);
    // 考前安静版不再推「再背一组」。
    assert.equal(s.nextSuggestion === null, s.quiet === true, `${name} 安静版与再背一组按钮矛盾`);
  }
  assert.equal(SUMMARIES.full.accuracy, 1);
});

test('假后端：设置读写与未知方法', async () => {
  const handler = drillHandler();
  assert.deepEqual(await handler('pinkie.learning.drill.settings.get'), {size: 10, jarGoal: 30, flipOnly: false});
  assert.deepEqual(await handler('pinkie.learning.drill.settings.set', {size: 5}), {ok: true});
  // 去掉前缀与否结果一样。
  assert.deepEqual(await handler('drill.settings.get'), {size: 10, jarGoal: 30, flipOnly: false});
  assert.deepEqual(await handler('pinkie.learning.drill.learned', {}), {ok: true});
  assert.deepEqual(await handler('chat.history'), {messages: []});
  assert.deepEqual(await handler('chat.send', {text: 'x'}), {runId: 'qa', status: 'started'});
  assert.match((await handler('pinkie.learning.drill.cheer')).line, /握手的顺序/);
  assert.deepEqual(await handler('pinkie.learning.something.else'), {});
});

test('假后端：组卷按 scope 取单题型或全部题型，且返回的是副本', async () => {
  const handler = drillHandler();
  const one = await handler('pinkie.learning.drill.session', {scope: {kind: 'notes', ids: ['choice']}});
  assert.match(one.sessionId, /^qa-[0-9a-f]+$/);
  assert.deepEqual(one.items, [FIXTURES.choice]);
  assert.equal(one.pending, 0);
  assert.equal(one.dueLeft, 1);
  assert.deepEqual(one.settings, {soundDefault: true});
  one.items[0].options.push('被改坏的选项');
  assert.equal(FIXTURES.choice.options.length, 4, '修改返回的卡片不能污染共享假数据');

  const all = await handler('pinkie.learning.drill.session', {scope: {kind: 'notes', ids: ['nope']}});
  assert.deepEqual(all.items.map(item => item.mode), MODES);
  assert.equal(all.dueLeft, MODES.length);
  const bare = await handler('pinkie.learning.drill.session');
  assert.equal(bare.items.length, MODES.length);
  assert.notEqual(bare.sessionId, all.sessionId);

  const pending = await handler('pinkie.learning.drill.session', {scope: {kind: 'notes', ids: ['flip'], flag: 'pending'}});
  assert.equal(pending.pending, 4, 'drill-qa 等的是「碧琪还在给 4 张卡出题」');
});

test('假后端：作答评级、星星与回炉', async () => {
  const handler = drillHandler();
  const answer = params => handler('pinkie.learning.drill.answer', {sessionId: 'none', ...params});
  assert.deepEqual(await answer({correct: true, firstTry: true}), {rating: 'remembered', stars: 1, requeue: false});
  assert.deepEqual(await answer({correct: true, firstTry: false}), {rating: 'remembered', stars: 0, requeue: false});
  assert.deepEqual(await answer({correct: true, firstTry: true, hinted: true}), {rating: 'fuzzy', stars: 1, requeue: false});
  assert.deepEqual(await answer({correct: true, verdict: 'partial'}), {rating: 'fuzzy', stars: 0, requeue: false});
  assert.deepEqual(await answer({correct: false, firstTry: true}), {rating: 'forgot', stars: 0, requeue: true});
});

test('假后端：主观题判分按关键词分三档', async () => {
  const handler = drillHandler();
  const judge = text => handler('pinkie.learning.drill.judge', {text});
  assert.equal((await judge('do-while 至少执行一次')).verdict, 'correct');
  assert.deepEqual((await judge('do-while 至少执行一次')).missing, []);
  const partial = await judge('只答对部分');
  assert.equal(partial.verdict, 'partial');
  assert.equal(partial.missing.length, 1);
  assert.equal((await judge('完全错了')).verdict, 'wrong');
  assert.equal((await judge('   ')).verdict, 'wrong', '空白作答判错');
  assert.equal((await judge(undefined)).verdict, 'wrong');
  // 同时含「错」和「部分」时先判错。
  assert.equal((await judge('部分错')).verdict, 'wrong');
});

test('假后端：结算按首答统计，finishFails 先失败指定次数再成功', async () => {
  const control = {finishFails: 2};
  const handler = drillHandler(control);
  const {sessionId} = await handler('pinkie.learning.drill.session', {scope: {ids: ['choice']}});
  for (const params of [{correct: true, firstTry: true}, {correct: false, firstTry: true}, {correct: true, firstTry: true}, {correct: true, firstTry: false}]) {
    await handler('pinkie.learning.drill.answer', {sessionId, ...params});
  }
  await assert.rejects(handler('pinkie.learning.drill.finish', {sessionId}), /结算请求超时/);
  assert.equal(control.finishFails, 1);
  await assert.rejects(handler('pinkie.learning.drill.finish', {sessionId}), /结算请求超时/);
  assert.equal(control.finishFails, 0);
  const done = await handler('pinkie.learning.drill.finish', {sessionId});
  // 首答 3 次，对 2 次：星星 = 2 + 5，正确率 2/3，最大连对记为对的次数。
  assert.equal(done.stars, 7);
  assert.equal(done.accuracy, 2 / 3);
  assert.equal(done.maxCombo, 2);
  assert.equal(done.jar.filledNow, done.jar.today >= done.jar.goal);
  assert.equal(done.nextSuggestion.label, '再背一组新的');

  // 没有作答记录（或会话不存在）时正确率按 1 算，不会除以零。
  const empty = await drillHandler()('pinkie.learning.drill.finish', {sessionId: 'missing'});
  assert.equal(empty.accuracy, 1);
  assert.equal(empty.stars, 5);
  assert.equal(empty.maxCombo, 0);
});

// 按花括号配对取出每个 @keyframes 的完整块，再列出其中所有被动画的属性名。
function keyframeBlocks(css) {
  const blocks = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    assert.equal(depth, 0, `@keyframes ${m[1]} 花括号不配对`);
    const body = css.slice(re.lastIndex, i - 1);
    const props = [...body.matchAll(/([{;]|^)\s*([-a-z]+)\s*:/g)].map(p => p[2]);
    blocks.push({name: m[1], props});
    re.lastIndex = i;
  }
  return blocks;
}

test('关键帧解析器自检：嵌套帧也能取到属性，动画到宽度会被抓出来', () => {
  const blocks = keyframeBlocks('@keyframes a{from{opacity:0}} .x{color:red} @keyframes b{0%{width:0;opacity:1}100%{width:10px}}');
  assert.deepEqual(blocks, [{name: 'a', props: ['opacity']}, {name: 'b', props: ['width', 'opacity', 'width']}]);
  assert.deepEqual(keyframeBlocks('.x{transform:none}'), []);
});

test('奖励层与背一背的 CSS 关键帧只动 transform 与 opacity', () => {
  const css = read('ui/injections/laolao-desk-reward.css') + read('ui/injections/laolao-study-desk-drill.css');
  const blocks = keyframeBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  assert.equal(blocks.length, (css.match(/@keyframes/g) || []).length, '每个 @keyframes 都要被解析到');
  assert.ok(blocks.length > 0, '至少应有一个关键帧，否则这条检查没有意义');
  for (const {name, props} of blocks) {
    assert.ok(props.length > 0, `${name} 没解析出属性`);
    for (const prop of props) assert.ok(prop === 'transform' || prop === 'opacity', `${name} 动画了 ${prop}`);
  }
});

test('奖励层源码不探测设备性能、不用 rAF、不用毛玻璃、不带别家品牌元素', () => {
  const js = read('ui/injections/laolao-desk-reward.js') + read('ui/injections/laolao-study-desk-drill.js');
  const css = read('ui/injections/laolao-desk-reward.css') + read('ui/injections/laolao-study-desk-drill.css');
  assert.doesNotMatch(js, /deviceMemory|hardwareConcurrency|matchMedia\(\s*['"]\(prefers-reduced/);
  assert.doesNotMatch(js, /requestAnimationFrame/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(js + css, /#58cc02|owl|feather bold/i);
});

// drill-qa.mjs 第 98 行用 /@keyframes[^{]+\{[^{}]*\}/g 取关键帧：真实 CSS 的关键帧都带嵌套的 from{…}/0%{…}，
// 这个正则在当前两份 CSS 上匹配 0 条（共 4 个 @keyframes），循环一次都不进，检查形同虚设。
// 按要求不改源码，上面的测试已用配对花括号的解析补上同一条约束。
// 不带函数体：tools/release-gate/tap.mjs 只把 # SKIP 排除在失败之外，带失败断言的 todo 会输出
// `not ok … # TODO` 并被发版门禁记成新失败，所以这里只登记，不跑会失败的断言。
test.todo('drill-qa.mjs 的「只动 transform/opacity」检查对嵌套关键帧一条都匹配不到（待修源码）');
