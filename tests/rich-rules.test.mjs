// 组件写法（ui / chart / mermaid / 公式 / followups）四个模式的 AGENTS.md 写得更细，插件不再每轮重复；
// 没有手册的会话（无限制模式等）照旧收到完整原文。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RICH_RULES, richRulesFor} from '../services/mode-architecture/rich-runtime.mjs';

test('the four modes get the rich rules without the component syntax their manuals already teach', () => {
  for (const agent of ['main', 'project', 'thinking', 'learning']) {
    const text = richRulesFor(`agent:${agent}:s1`);
    assert.doesNotMatch(text, /追问用 followups/);
    for (const kept of ['plan_update', 'app 代码块', 'cron', 'pinkie-deep-research']) assert.ok(text.includes(kept), kept);
    const manual = fs.readFileSync(`personas/${agent === 'main' ? 'chat' : agent}/AGENTS.md`, 'utf8');
    for (const block of ['`ui`', '`chart`', '`mermaid`', 'LaTeX', '`followups`']) assert.ok(manual.includes(block), `${agent} manual teaches ${block}`);
  }
});

test('sessions without a manual keep the full original text', () => {
  for (const key of ['agent:unrestricted:s1', 'agent:party-claude:s1', '']) assert.equal(richRulesFor(key), RICH_RULES);
  assert.match(RICH_RULES, /按钮\/表单用 ui JSON 代码块，图表用 chart，流程用 mermaid，公式用 \$…\$，追问用 followups。要做可运行的/);
});
