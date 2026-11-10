import test from 'node:test';
import assert from 'node:assert/strict';
import {routeSkills} from '../services/mode-architecture/skill-routes.mjs';

test('a request to repair a missing tool routes to the toolbox', () => {
  for (const prompt of ['帮我安装 ffmpeg', '浏览器装不上，帮我修好', '缺少 Python']) {
    assert.ok(routeSkills([], prompt).some(route => route.skill === 'pinkie-toolbox'), prompt);
  }
});

test('ordinary questions about a tool do not automatically trigger installation', () => {
  assert.equal(routeSkills([], 'Python 是什么？').some(route => route.skill === 'pinkie-toolbox'), false);
});
