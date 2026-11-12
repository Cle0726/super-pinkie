import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {explainRules, loadVoice, tutoringRules, validVoicedExplain, _resetVoiceCache} from '../services/mode-architecture/learning-explain-voice.mjs';

const USER = `# USER
- **教学/辅导铁律**：
  - 严禁超纲！
  - 极度口语化。
  - 【严禁任何形式的剧透与暗示】：
    1. 出题时不能写考点
  - 【答对也必讲铁律】：答对也要讲。
  - 【滚动温故法】：讲完出温故题。
  - 【学代码专属铁律（手敲）】：不代写。
  - 遇到生词难词，加上【中文谐音】。

---
tail`;

test('讲解口吻从学习模式工作区读：保留讲题铁律，去掉出题与流程铁律', () => {
  const rules = tutoringRules(USER);
  assert.equal(rules.length, 4);
  assert.ok(rules.some(r => r.includes('答对也必讲')) && rules.some(r => r.includes('谐音')));
  assert.ok(!rules.some(r => /剧透|滚动温故|学代码/.test(r)));
});

test('工作区有规则就用工作区的，改了规则下一次就变；没有就用内置兜底', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-voice-'));
  try {
    fs.writeFileSync(path.join(dir, 'USER.md'), USER);
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '## 当老师的态度\n- **对错不含糊。** 答错第一句直说。\n- **听得懂半句话。** 聊天用。\n## 怎么说话\n- 默认简洁口语化。\n');
    fs.mkdirSync(path.join(dir, 'memory/feedback'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'memory/feedback/mistake_review.md'), '# t\n- x：\n  1. 【甲】：一\n  2. 【乙】：二\n  3. 【丙】：三\n### 其他\n  4. 不要\n');
    _resetVoiceCache();
    const voice = loadVoice({dir, now: 1});
    assert.equal(voice.fromWorkspace, true);
    assert.deepEqual(voice.steps.length, 3);
    assert.ok(voice.soul.some(s => s.includes('对错不含糊')) && !voice.soul.some(s => s.includes('聊天用')));
    const rules = explainRules({dir});
    assert.match(rules, /答对也必讲/); assert.match(rules, /先生/); assert.doesNotMatch(rules, /滚动温故/);
    fs.writeFileSync(path.join(dir, 'USER.md'), USER.replace('严禁超纲！', '只讲 B 级范围。'));
    assert.match(explainRules({dir}), /严禁超纲/, '20 秒内读缓存');
    _resetVoiceCache();
    assert.match(explainRules({dir}), /只讲 B 级范围/);
    _resetVoiceCache();
    const empty = loadVoice({dir: path.join(dir, 'nope'), now: 1});
    assert.equal(empty.fromWorkspace, false);
    assert.ok(empty.rules.length >= 5 && empty.steps.length === 4);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); _resetVoiceCache(); }
});

test('当场讲解短而轻、不分步骤；整卷回看更短', () => {
  const long = '字'.repeat(300);
  assert.equal(validVoicedExplain({text: long}).text.length, long.length);
  assert.ok(validVoicedExplain({text: '字'.repeat(900)}).text.length <= 760) // 英语带读要把整句逐块带完，上限从 520 放到 760;
  assert.ok(validVoicedExplain({text: '字'.repeat(900)}, {brief: true}).text.length <= 420);
  assert.equal(validVoicedExplain({text: '短'}), null);
  assert.equal(validVoicedExplain({text: 'a\\nb 好的好的好的'}).text.includes('\n'), true);
  assert.match(explainRules({brief: true}), /150 字/);
  assert.match(explainRules(), /260 字/); assert.doesNotMatch(explainRules(), /每段开头写/);
});

test('英语题讲解带一句中文翻译', () => { assert.match(explainRules(), /中文翻译/); });
