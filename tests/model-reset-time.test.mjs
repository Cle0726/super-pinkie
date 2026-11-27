import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ModelHealth, classifyModelFailure, resetText, resetTime} from '../services/mode-architecture/model-health.mjs';

// E8-3（briefs/metre-engines-1122 PLAN 3.8）：上游报错里带了恢复时间，失败卡上写「几点恢复」；认不出就不写，不猜。
const NOW = new Date(2026, 10, 23, 15, 0, 0).getTime(); // 本地时间 11 月 23 日 15:00
const at = iso => new Date(iso).getTime();

test('reset times in the shapes upstream services really write are read; anything vague is left alone', () => {
  assert.equal(resetTime('429 usage limit reached, resets at 2026-11-26T09:44:00Z', NOW), '2026-11-26T09:44:00.000Z');
  const epoch = Math.round(NOW / 1000) + 3 * 3600;
  assert.equal(at(resetTime(`Claude AI usage limit reached|${epoch}`, NOW)), epoch * 1000);
  assert.equal(at(resetTime(`{"error":{"type":"usage_limit","resets_at":${epoch}}}`, NOW)), epoch * 1000);
  assert.equal(at(resetTime('You have hit your usage limit. Try again in 2 hours 30 minutes.', NOW)), NOW + 9_000_000);
  assert.equal(at(resetTime('Rate limit reached. Please try again in 20s.', NOW)), NOW + 20_000);
  assert.equal(at(resetTime('429 Too Many Requests; retry-after: 120', NOW)), NOW + 120_000);
  assert.equal(at(resetTime('Rate-limited — ready in ~3 min', NOW)), NOW + 180_000);
  assert.equal(new Date(resetTime("You've hit your usage limit. Try again at 5:43 PM.", NOW)).getHours(), 17, 'a clock time is this computer\'s local time');
  const morning = new Date(resetTime('quota exceeded, resets 9am', NOW));
  assert.deepEqual([morning.getDate(), morning.getHours()], [24, 9], 'already past today, so tomorrow');
  for (const vague of ['503 auth_unavailable: no auth available', 'insufficient_quota', 'usage limit reached', 'step 2 of 5', 'retry later', 'resets 3',
    'resets at 2020-01-01T00:00:00Z', 'try again in 90 days', '']) assert.equal(resetTime(vague, NOW), null, vague);
});

test('the words on the card: minutes when it is soon, otherwise today / tomorrow / the date', () => {
  assert.equal(resetText(new Date(NOW + 20 * 60_000).toISOString(), NOW), '约 20 分钟后');
  assert.equal(resetText(new Date(2026, 10, 23, 17, 44).toISOString(), NOW), '今天 17:44');
  assert.equal(resetText(new Date(2026, 10, 24, 9, 5).toISOString(), NOW), '明天 09:05');
  assert.equal(resetText(new Date(2026, 10, 26, 17, 44).toISOString(), NOW), '11 月 26 日 17:44');
  assert.equal(resetText(new Date(NOW - 1000).toISOString(), NOW), '', 'past times are not shown');
  assert.equal(resetText(null, NOW), '');
});

test('a failed turn keeps the reset time; once it has passed the card goes back to the old wording', () => {
  let now = NOW;
  const health = new ModelHealth({now: () => now});
  health.turnEnded('agent:main:a', {model: 'codex/gpt-5', reason: 'usage limit reached; try again at 5:43 PM'});
  const {failure} = health.failure('agent:main:a');
  assert.deepEqual([failure.kind, failure.resetText, failure.unusable], ['account', '今天 17:43', false], 'it will come back, so not "unusable"');
  health.turnEnded('agent:main:b', {model: 'x/y', reason: '503 auth_unavailable: no auth available'});
  assert.deepEqual([health.failure('agent:main:b').failure.resetText, health.failure('agent:main:b').failure.unusable], ['', true], 'no time: same as before');
  now = NOW + 4 * 3600_000;
  assert.deepEqual([health.failure('agent:main:a').failure.resetText, health.failure('agent:main:a').failure.resetAt, health.failure('agent:main:a').failure.unusable], ['', null, true]);
  const later = new Date(now + 2 * 86_400_000).toISOString(); // 不依赖这台电脑的时区
  health.turnEnded('agent:main:c', {model: 'x/y', reason: 'usage limit reached ' + 'x'.repeat(500) + ' resets at ' + later});
  assert.equal(health.failure('agent:main:c').failure.reason.length, 300, 'the raw text shown is still clipped');
  assert.equal(health.failure('agent:main:c').failure.resetAt, later, 'but the time is read from the whole reason');
});

test('the failure card says when it comes back, and keeps the old sentence when there is no time', () => {
  const source = fs.readFileSync(new URL('../ui/injections/laolao-message-actions.js', import.meta.url), 'utf8');
  const say = vm.runInNewContext(`(${/const FAILURE_SAY = (\{[\s\S]*?\n  \});/.exec(source)[1]})`);
  assert.equal(say.account('Codex', '今天 17:43'), '「Codex」的额度用完了，今天 17:43 恢复。急的话先换一个模型。');
  assert.equal(say.account('Codex', '约 20 分钟后'), '「Codex」的额度用完了，约 20 分钟后恢复。急的话先换一个模型。');
  assert.match(say.account('Codex', ''), /等多久都不会好/);
  assert.equal(say.busy('Grok 4.5', '约 3 分钟后'), '「Grok 4.5」那边正忙，排队的人太多，约 3 分钟后再发就好。');
  assert.equal(say.busy('Grok 4.5'), '「Grok 4.5」那边正忙，排队的人太多，过一会儿再发就好。');
  assert.match(source, /\(FAILURE_SAY\[failure\.kind\] \|\| FAILURE_SAY\.other\)\(failed, failure\.resetText \|\| ''\)/);
});

test('"the selected model was not found" is a missing model (seen in the real window 11-23)', () => {
  assert.equal(classifyModelFailure('Agent failed before reply: The selected model was not found by the provider.'), 'missing');
});
