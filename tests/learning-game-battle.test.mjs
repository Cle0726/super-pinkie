// v4 第二批（11-13，Windows 侧）：刷题有血量——答错掉心、连对回心、倒地站起来一次、再倒算打输；形态技能要攒满才能放。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {gameFixture} from './helpers/learning-game-fixture.mjs';
import {battleStart, BASE_HEARTS, HEAL_COMBO} from '../services/mode-architecture/learning-game-bank.mjs';

const STEMS = ['The more you practice, ____ natural it will be.', 'She ____ here since 2010.', 'He was made ____ the room.', 'I look forward to ____ you.', 'Neither of them ____ right.', 'It is high time we ____.'];
function paper(year) {
  return {paperId: `real-${year}-06`, exam: 'pretco-b', kind: 'real', year, month: 6, title: `${year} 年 6 月真题`, audio: null, version: 5, flags: [],
    sections: [{id: 'vocab', parts: [{id: 'A', kind: 'choice', each: 1, items: STEMS.map((stem, k) => ({no: 25 + k, stem: `${stem} (${year})`, options: ['alpha', 'beta', 'gamma', 'delta'], answer: (k + year) % 4}))}]}]};
}
function setup(t, form = 'daily') {
  const {game} = gameFixture(t);
  const dir = path.join(game.root, 'papers'); fs.mkdirSync(dir, {recursive: true});
  for (let y = 2012; y <= 2020; y++) fs.writeFileSync(path.join(dir, `real-${y}-06.json`), JSON.stringify(paper(y)));
  const pr = game.modules.practice;
  if (form !== 'daily') game.mutate(s => { s.forms.owned.push(form); s.forms.equipped = form; });
  const set = pr.start({mode: 'kind', kind: 'vc', count: 10, requestId: `b-${form}`});
  assert.equal(set.items.length, 10);
  const key = id => pr.bank.item(id).answer;
  const right = it => pr.answer({setId: set.setId, itemId: it.itemId, answer: key(it.itemId)});
  const wrong = it => pr.answer({setId: set.setId, itemId: it.itemId, answer: (key(it.itemId) + 1) % 4});
  return {game, pr, set, right, wrong, key};
}

test('每个上架的形态都有一个技能，种类是四种之一', t => {
  const {game} = gameFixture(t);
  const live = game.catalog.forms.filter(f => !f.retired);
  assert.ok(live.length >= 12);
  for (const f of live) {
    assert.ok(['eliminate', 'heal', 'shield', 'double'].includes(f.skill?.kind), `${f.id} 没有技能`);
    assert.ok(f.skill.name && f.skill.text && f.skill.cost >= 2 && f.skill.cost <= 8, `${f.id} 技能缺字段`);
  }
});

test('开一组：≥5 题有 3 颗心；听力整套和太短的组不计心', () => {
  assert.equal(battleStart({id: 'x'}, {mode: 'random', count: 10}).hp.max, BASE_HEARTS);
  assert.equal(battleStart({id: 'x', skill: {kind: 'shield', hearts: 1, cost: 4, name: '重甲'}}, {mode: 'random', count: 10}).hp.max, BASE_HEARTS + 1);
  assert.equal(battleStart({id: 'x'}, {mode: 'listening', count: 15}).hp, undefined);
  assert.equal(battleStart({id: 'x'}, {mode: 'kind', count: 3}).hp, undefined);
});

test('答错掉心；掉光倒地不能再交；站起来一次回 1 颗；再掉光算打输，没有整组奖励也不算今天的组数', async t => {
  const {game, pr, set, right, wrong} = setup(t);
  assert.deepEqual(set.battle.hp, {max: 3, left: 3, down: false, revived: false, failed: false});
  const [a, b, c, d, e, f] = set.items;
  assert.equal((await wrong(a)).battle.hp.left, 2);
  assert.equal((await right(b)).battle.hp.left, 2);
  await wrong(c);
  const ko = await wrong(d);
  assert.equal(ko.battle.hp.left, 0); assert.equal(ko.battle.down, true); assert.equal(ko.battle.hp.down, true);
  await assert.rejects(() => right(e), /站起来/);
  const up = pr.revive({setId: set.setId});
  assert.deepEqual([up.hp.left, up.hp.down, up.hp.revived], [1, false, true]);
  assert.equal((await right(e)).battle.hp.left, 1);
  const lost = await wrong(f);
  assert.equal(lost.battle.failed, true); assert.equal(lost.battle.hp.failed, true);
  await assert.rejects(() => right(set.items[6]), /打输/);
  assert.throws(() => pr.revive({setId: set.setId}), /打输/);
  const setsBefore = game.day(game.read()).sets;
  const fin = pr.finish({setId: set.setId});
  assert.equal(fin.failed, true); assert.equal(fin.counted, false);
  assert.equal(fin.awards.length, 0, '打输没有「这一组做完」的星星');
  assert.equal(game.day(game.read()).sets, setsBefore);
  assert.equal(game.read().stats.setsLost, 1);
  const again = pr.start({mode: 'kind', kind: 'vc', count: 10, requestId: 'b-daily'});
  assert.equal(again.battle.hp.failed, true, '重放同一组拿到的是当前血量');
});

test(`连对 ${HEAL_COMBO} 题回 1 颗心，不超过上限`, async t => {
  const {set, right, wrong} = setup(t);
  await wrong(set.items[0]);
  let r;
  for (let k = 1; k <= HEAL_COMBO; k++) r = await right(set.items[k]);
  assert.equal(r.battle.healed, 1); assert.equal(r.battle.hp.left, 3);
});

test('技能：攒满才能放；回心 / 护盾 / 加倍 / 排除各自生效，放完清零', async t => {
  // 日常碧琪：回心
  {
    const {pr, set, right, wrong} = setup(t);
    assert.equal(set.battle.skill.kind, 'heal');
    const cost = set.battle.skill.cost;
    assert.throws(() => pr.skill({setId: set.setId, itemId: set.items[0].itemId}), /没攒满/);
    await wrong(set.items[0]); await wrong(set.items[1]);
    let r; for (let k = 2; k < 2 + cost; k++) r = await right(set.items[k]);
    assert.equal(r.battle.skill.ready, true);
    const used = pr.skill({setId: set.setId, itemId: set.items[cost + 2].itemId});
    assert.equal(used.used.healed, 1); assert.equal(used.hp.left, 3); assert.equal(used.skill.charge, 0);
  }
  // 水晶碧琪：护盾，下一次答错不掉心不断连击
  {
    const {pr, set, right, wrong} = setup(t, 'crystal');
    assert.equal(set.battle.skill.kind, 'shield');
    const cost = set.battle.skill.cost;
    for (let k = 0; k < cost; k++) await right(set.items[k]);
    assert.equal(pr.skill({setId: set.setId, itemId: set.items[cost].itemId}).guard, true);
    const r = await wrong(set.items[cost]);
    assert.equal(r.battle.guarded, true); assert.equal(r.battle.hp.left, 3); assert.equal(r.combo, cost);
    assert.equal((await wrong(set.items[cost + 1])).battle.hp.left, 2, '护盾只挡一次');
  }
  // 名侦探：排除两个错项，正确答案留着
  {
    const {pr, set, right, key} = setup(t, 'detective');
    assert.equal(set.battle.skill.kind, 'eliminate');
    const cost = set.battle.skill.cost;
    for (let k = 0; k < cost; k++) await right(set.items[k]);
    const it = set.items[cost];
    const used = pr.skill({setId: set.setId, itemId: it.itemId});
    assert.equal(used.used.remove.length, 2); assert.ok(!used.used.remove.includes(key(it.itemId)));
    assert.deepEqual(used.removed[it.itemId], used.used.remove);
  }
  // 彩虹之力：加倍，下一题答对星星翻倍
  {
    const {game, pr, set, right} = setup(t, 'unrestricted');
    assert.equal(set.battle.skill.kind, 'double');
    const cost = set.battle.skill.cost;
    let plain; for (let k = 0; k < cost; k++) { const r = await right(set.items[k]); if (k === 0) plain = r.awards.filter(a => a.kind === 'stars').reduce((n, a) => n + a.amount, 0); }
    assert.equal(pr.skill({setId: set.setId, itemId: set.items[cost].itemId}).double, true);
    // 第 cost+1 题不在 5 连击点上才好比较；cost=4 时这题是第 5 连，单独算基础分
    const before = game.read().wallet.stars;
    const r = await right(set.items[cost]);
    assert.equal(r.battle.doubled, true);
    assert.ok(game.read().wallet.stars - before >= plain * 2, '这一题的星星翻倍');
    assert.equal(r.battle.double, false);
  }
});
