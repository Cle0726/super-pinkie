// B3a 复发测试：真题答错生怪时，种子题是「文章 + 空行 + 题干」。旧的 800 字上限会把题干整段切掉，
// 讨伐出变体和离线退回原题时都看不到问的是什么。
import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './helpers/learning-game-fixture.mjs';

const MATERIAL = 'The library is open from Monday to Friday and closes at six. '.repeat(20).slice(0, 1200); // 真题文章上限 1200 字
const STEM = 'STEM-TAIL: When does the library close on weekdays? ___';

test('真题错题怪：种子题保留文章后的题干，离线原题也带着题干', t => {
  const {game} = gameFixture(t);
  const options = ['At five', 'At six', 'At seven', 'At eight'];
  const m = game.mutate(state => game.modules.monsters.spawn(state, {key: 'real:slice-test', subject: '英语', topic: '阅读理解',
    question: `${MATERIAL}\n\n${STEM}`, answer: 'At six', options, source: {type: 'real', id: 's1'}}));
  assert.ok(m, '生出了怪');
  const saved = game.read().monsters.list[m.id];
  assert.ok(saved.seed.question.includes(STEM), '种子题的题干被截掉了');
  assert.ok(saved.seed.question.startsWith(MATERIAL), '文章也要完整');
  const local = game.modules.monsters.localVariant(saved);
  assert.ok(local && local.stem.includes(STEM), '离线退回的原题看不到题干');
  // 同 key 再错一次：更新种子时同样不能截
  const again = game.mutate(state => game.modules.monsters.spawn(state, {key: 'real:slice-test', subject: '英语', topic: '阅读理解',
    question: `${MATERIAL}\n\n${STEM} (again)`, answer: 'At six', options, source: {type: 'real', id: 's2'}}));
  assert.ok(game.read().monsters.list[again.id].seed.question.endsWith('(again)'));
});
