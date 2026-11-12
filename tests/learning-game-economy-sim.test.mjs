import test from 'node:test';
import assert from 'node:assert/strict';
import {goals, gachaMonteCarlo} from '../tools/study-game/economy-sim.mjs';
import * as E from '../services/mode-architecture/learning-game-economy.mjs';

test('ECONOMY §6：三种玩家 35 天模拟目标全部满足', () => {
  const g = goals();
  for (const [name, ok] of Object.entries(g.checks)) assert.ok(ok, name);
});

test('扭蛋 10 万次：保底从不超过、SSR 率不低于标称', () => {
  const star = gachaMonteCarlo('star', 100_000, 3);
  assert.ok(star.maxDrySsr < 50 && star.maxDrySr < 10);
  assert.ok(star.ssrRate >= 0.015);
  const seal = gachaMonteCarlo('seal', 100_000, 5);
  assert.ok(seal.maxDrySsr < 20 && seal.ssrRate >= 0.05);
});

test('形态加成：单事件叠加封顶 ×2，只改奖励', () => {
  const astro = E.formById('astrologer');
  assert.equal(E.boosted(2, {event: 'combo', form: astro}).value, 4);
  const uncapped = {bonus: {kind: 'comboStepAdd', add: 99}};
  assert.equal(E.boosted(2, {event: 'combo', form: uncapped}).value, 4);
  assert.equal(E.boosted(10, {event: 'capture', form: E.formById('serious')}).value, 14);
  assert.equal(E.boosted(10, {event: 'lesson', form: E.formById('serious')}).value, 10);
});

test('防刷：没到期且记牢的卡 0 星；到期 / 新卡 / 变体全额', () => {
  const now = Date.parse('2026-11-08T04:00:00Z');
  assert.equal(E.cardEligible({strength: 4, nextReviewAt: now + 86400000}, now), false);
  assert.equal(E.cardEligible({strength: 4, nextReviewAt: now - 1}, now), true);
  assert.equal(E.cardEligible({strength: 0}, now), true);
  assert.equal(E.cardEligible({variant: true, strength: 5, nextReviewAt: now + 9e9}, now), true);
  assert.equal(E.answerStars({eligible: false, correct: true}).value, 0);
  assert.equal(E.answerStars({eligible: true, correct: true}).value, 1);
});

test('考试金印每周最多 2 次；守关重刷星星减半、金印只补差', () => {
  assert.equal(E.examReward({score: 72, sealsUsedThisWeek: 2}).seals, 0);
  assert.deepEqual([E.examReward({score: 72}).stars, E.examReward({score: 72}).seals], [132, 4]);
  const first = E.guardReward({pct: 80});
  assert.deepEqual([first.stars, first.seals], [30, 2]);
  const replay = E.guardReward({pct: 100, best: 80});
  assert.deepEqual([replay.stars, replay.seals], [25, 1]);
  assert.equal(E.guardReward({pct: 90, best: 100}).seals, 0);
});
