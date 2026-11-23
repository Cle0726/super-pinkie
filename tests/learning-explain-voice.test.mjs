import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {explainRules, explainVersionFor, loadVoice, preferredAddress, tutoringRules, validVoicedExplain, _resetVoiceCache} from '../services/mode-architecture/learning-explain-voice.mjs';

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
    assert.match(rules, /答对也必讲/); assert.doesNotMatch(rules, /滚动温故/);
    assert.match(rules, /不加「先生」「老板」之类的称呼/, 'no address unless USER.md names one');
    fs.writeFileSync(path.join(dir, 'USER.md'), '- **What to call them:** 先生\n' + USER);
    _resetVoiceCache();
    assert.match(explainRules({dir}), /用户希望被叫「先生」/, 'the address from USER.md reaches the side call');
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

test('当场讲解按 6 板块模板输出（先看选项识考点/回题干秒杀/逐词带读/一块块大白话/四个选项逐词扫/送分搭配/一句话钉牢）；整卷回看更短', () => {
  const long = '字'.repeat(300);
  assert.equal(validVoicedExplain({text: long}).text.length, long.length);
  assert.equal(validVoicedExplain({text: '字'.repeat(3000)}).text.length, 2800);
  assert.ok(validVoicedExplain({text: '字'.repeat(900)}, {brief: true}).text.length <= 650);
  assert.equal(validVoicedExplain({text: '短'}), null);
  assert.equal(validVoicedExplain({text: 'a\\nb 好的好的好的'}).text.includes('\n'), true);
  assert.match(explainRules({brief: true}), /150 字/);
  const full = explainRules();
  for (const heading of ['先看选项识考点', '回题干秒杀', '逐词带读', '一块块大白话', '四个选项逐词扫', '送分搭配', '一句话钉牢']) {
    assert.match(full, new RegExp(heading));
  }
  assert.match(full, /扑拉不冷/);
  assert.doesNotMatch(full, /每段开头写/);
});

test('英语题讲解带一句中文翻译', () => { assert.match(explainRules(), /中文翻译/); });

test('USER.md 里的称呼：OpenClaw 模板那一行，空的和 (optional) 都算没写', () => {
  assert.equal(preferredAddress('- **What to call them:** 小王\n'), '小王');
  assert.equal(preferredAddress('- **What to call them:**\n- **Pronouns:** _(optional)_'), '');
  assert.equal(preferredAddress('# 没有这一行'), '');
});

test('段落翻译与写作使用全篇逐句精讲模板，不套选择题话术且放宽长度上限', () => {
  const tpFull = explainRules({qkind: 'translate-passage', mode: 'full'});
  for (const h of ['审题与扣分点', '逐句精讲与拆译', '全文逐词带读', '核心高频搭配', '完整官方译文', '一句话钉牢']) {
    assert.match(tpFull, new RegExp(h));
  }
  assert.match(tpFull, /一句都不许省|一句不漏/);
  const tpRead = explainRules({qkind: 'translate-passage', mode: 'read'});
  assert.match(tpRead, /全文逐词带读/);
  assert.match(tpRead, /逐句拆译/);
  const wrFull = explainRules({qkind: 'writing', mode: 'full'});
  assert.match(wrFull, /审题与格式要件/);
  assert.match(wrFull, /范文逐句拆译/);
  assert.equal(validVoicedExplain({text: '字'.repeat(5000)}, {long: true}).text.length, 5000);
  assert.ok(explainVersionFor('translate-passage') > explainVersionFor('choice'));
  assert.ok(explainVersionFor('writing') > explainVersionFor('choice'));
});
