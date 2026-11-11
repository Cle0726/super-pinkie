// 计划 E 11-10 隔离实测（workbuddy/hy4free）：四个模式不发组件写法那一句后，项目模式画图有时改成做网页、不出 chart 代码块；
// 每轮只省 63 字，不值得冒这个险。所有会话照发完整原文，防止以后又被「去重」删掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import {RICH_RULES} from '../services/mode-architecture/rich-runtime.mjs';

test('every session keeps the component syntax line in the rich rules', () => {
  assert.match(RICH_RULES, /按钮\/表单用 ui JSON 代码块，图表用 chart，流程用 mermaid，公式用 \$…\$，追问用 followups。/);
  for (const kept of ['plan_update', 'app 代码块', 'cron', 'pinkie-deep-research']) assert.ok(RICH_RULES.includes(kept), kept);
});
