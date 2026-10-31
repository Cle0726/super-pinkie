const test = require('node:test');
const assert = require('node:assert/strict');
let harnessModule;
test.before(async () => { harnessModule = await import('../tools/study-desk/harness.mjs'); });
async function run(options, fn) {
  const harness = await harnessModule.startHarness(options);
  const engine = options?.engine || 'webkit';
  const browser = await harnessModule.playwright()[engine].launch(engine === 'chromium' ? {headless: true, channel: 'chrome'} : {headless: true});
  try { const page = await browser.newPage({viewport: {width: 1440, height: 900}}); const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto(harness.url); await page.locator('#pinkie-study-desk').waitFor(); await page.evaluate(() => __pinkieStudyDesk.go('today')); await fn(page, harness); assert.deepEqual(errors, []); }
  finally { await browser.close(); await harness.close(); }
}
test('learning shell mounts once, restores native chat, and cleans up across ten mode changes', async () => {
  await run({}, async page => {
    await page.evaluate(() => {
      window.qaMounts = 0; window.qaUnmounts = 0;
      __pinkieStudyDesk.registerView('board', {title: '看板', mount(host) { qaMounts++; host.textContent = '真实挂载'; }, unmount() { qaUnmounts++; }});
    });
    await page.getByRole('button', {name: '看板', exact: true}).click({modifiers: ['Alt']});
    await page.getByText('真实挂载').waitFor();
    await page.getByRole('button', {name: '对话', exact: true}).click();
    assert.equal(await page.locator('.shell').evaluate(n => n.inert), false);
    await page.getByRole('button', {name: '今日', exact: true}).click({modifiers: ['Alt']});
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => { history.replaceState({}, '', '/chat?session=agent:project:qa'); document.documentElement.dataset.laolaoMode = 'project'; dispatchEvent(new Event('pinkie:session-selected')); });
      assert.equal(await page.locator('#pinkie-study-desk').count(), 0);
      assert.equal(await page.locator('html').getAttribute('data-pinkie-study-desk'), null);
      assert.equal(await page.locator('.shell').evaluate(n => n.inert), false);
      await page.evaluate(() => { history.replaceState({}, '', '/chat?session=agent:learning:study-desk-qa'); document.documentElement.dataset.laolaoMode = 'learning'; dispatchEvent(new Event('pinkie:session-selected')); });
      assert.equal(await page.locator('#pinkie-study-desk').count(), 1);
    }
    assert.deepEqual(await page.evaluate(() => [qaMounts, qaUnmounts]), [1, 1]);
    await page.evaluate(() => __pinkieStudyDesk.go('today'));
    await page.keyboard.press('Alt+Meta+b');
    assert.equal(await page.locator('.pk-wb').isVisible(), false);
  });
});
test('pinned GSAP stays isolated, exact prototype tokens follow night mode', async () => {
  await run({}, async page => {
    assert.equal(await page.evaluate(() => __pinkieStudyDesk.motion.gsap?.version), '3.13.0');
    assert.equal(await page.evaluate(() => __pinkieStudyDesk.tokens.get('paper')), '#FAF6F1');
    // Day secondary ink reaches 3:1 on paper (approved token change 2026-10-26).
    assert.equal(await page.evaluate(() => __pinkieStudyDesk.tokens.get('ink-3')), '#87788D');
    // 手账 v2：今日卡片的主按钮是一颗写着字的粉色「开始 / 去学 / 继续」，不再是墨色圆钮里的箭头。
    await page.locator('.task .go').waitFor();
    assert.match(await page.locator('.task .go').textContent(), /开始|去学|继续/);
    await page.getByRole('button', {name: '切换日间和夜间'}).click();
    assert.equal(await page.evaluate(() => __pinkieStudyDesk.tokens.get('paper')), '#1C1620');
    assert.equal(await page.locator('.rail').evaluate(n => n.getBoundingClientRect().width), 76);
  });
});
test('missing libraries and reduced motion render without exceptions or animation', async () => {
  await run({vendor: false}, async page => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.reload();
    await page.locator('#pinkie-study-desk').waitFor();
    assert.equal(await page.evaluate(() => __pinkieStudyDesk.motion.reduced), true);
    assert.equal(await page.evaluate(() => __pinkieStudyDesk.motion.gsap), null);
    assert.equal(await page.evaluate(() => __pinkieStudyDesk.motion.splitIn(document.querySelector('.greet'))), null);
    assert.equal(await page.evaluate(() => __pinkieStudyDesk.motion.confettiAt({x: .5, y: .5})), null);
    assert.equal(await page.evaluate(() => document.querySelector('#pinkie-study-desk').getAnimations({subtree: true}).length), 0);
  });
});
test('today, exam settings and a complete set use B real RPC; Enter never submits or advances twice', async () => {
  const service = await harnessModule.isolatedService();
  try {
    // legacyUI loads the App theme, whose disabled-button rule must not grey out answered options.
    // v2 的真实 today 会优先选上课；此用例专门回归 v1 判题，固定主任务为 set，其余走真实服务。
    await run({handler: async (method, params) => { const result = await service.handler(method, params); if (method.endsWith('desk.today')) result.focus = {kind: 'set', title: 'C 语言 · 循环结构', payload: {chapter: 'c5', size: 6}}; return result; }, legacyUI: true}, async (page, harness) => {
      await page.locator('.dot').first().waitFor();
      assert.equal(await page.locator('.dot').count(), 144);
      assert.equal(await page.locator('.demo-label').count(), 0);
      await page.getByRole('button', {name: '设置考试日期', exact: true}).first().click();
      await page.locator('input[type=date]').fill('2027-04-25');
      await page.getByRole('button', {name: '保存日期', exact: true}).click();
      await page.locator('dialog').waitFor({state: 'detached'});
      assert.ok(harness.calls.find(c => c.method === 'pinkie.learning.pact.set')?.params.patch.exams);
      await page.getByRole('button', {name: /^开始：/}).click();
      await page.locator('.opt').first().waitFor();
      const question = await page.locator('.q-text').innerText();
      await page.locator('.q-text').evaluate(n => { n.dataset.qaSame = '1'; });
      await page.keyboard.press('1');
      await page.getByRole('button', {name: '很确定', exact: true}).click();
      await page.locator('.confirm-answer').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.confirm-answer')?.textContent.includes('下一题') || document.querySelector('.confirm-answer')?.textContent.includes('看看这一组'));
      assert.equal(harness.calls.filter(c => c.method.endsWith('desk.answer')).length, 1);
      assert.equal(await page.locator('.q-text').innerText(), question);
      assert.equal(await page.locator('.opt').first().evaluate(n => getComputedStyle(n).opacity), '1');
      // Feedback lands in place: the stem is not rebuilt or replayed, and nothing is washed out.
      assert.equal(await page.locator('.q-text[data-qa-same="1"]').count(), 1);
      assert.deepEqual(await page.locator('.opt.answered').first().evaluate(n => [getComputedStyle(n).opacity, getComputedStyle(n).filter]), ['1', 'none']);
      assert.equal(await page.getByRole('button', {name: '很确定', exact: true}).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', {name: '对话', exact: true}).click();
      await page.getByRole('button', {name: '舞台', exact: true}).click({modifiers: ['Alt']});
      assert.equal(await page.locator('.q-text').innerText(), question);
      assert.equal(harness.calls.filter(c => c.method.endsWith('desk.set')).length, 1);
      await page.locator('.confirm-answer').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.q-meta')?.textContent.startsWith('第 2 题'));
      assert.equal(harness.calls.filter(c => c.method.endsWith('desk.answer')).length, 1);
      while (await page.locator('.q-meta').count()) {
        if (await page.locator('.opt').count()) await page.locator('.opt').first().click();
        else await page.locator('.blank-answer').fill('1');
        await page.getByRole('button', {name: '有点把握', exact: true}).click();
        await page.locator('.confirm-answer').click();
        await page.waitForFunction(() => /下一题|看看这一组/.test(document.querySelector('.confirm-answer')?.textContent || ''));
        await page.locator('.confirm-answer').click();
      }
      await page.locator('.summary.on').waitFor();
      const answers = harness.calls.filter(c => c.method.endsWith('desk.answer'));
      assert.ok(answers.length >= 3 && answers.length <= 6);
      assert.equal(new Set(answers.map(c => c.params.questionId)).size, answers.length);
      assert.equal(service.store.pact.today().progress.questions, answers.length);
    });
  } finally { service.close(); }
});
test('only unknown method activates mock; gateway errors are surfaced', async () => {
  await run({handler: () => { throw Error('unknown method'); }}, async page => {
    await page.getByText('示意数据', {exact: true}).waitFor();
    assert.equal(await page.locator('.dot').count(), 144);
  });
  await run({handler: () => { throw Error('连接超时'); }}, async page => {
    await page.getByText('连接超时', {exact: true}).waitFor();
    assert.equal(await page.locator('.demo-label').count(), 0);
  });
});
test('real control-ui Chromium hosts flashcards, an experiment, a mock paper, both drawers and contextual follow-up', async () => {
  const service = await harnessModule.isolatedService();
  service.store.saveNote('agent:learning:study-desk-qa', {title: '循环入口', content: 'do-while 至少执行一次。'});
  try {
    await run({handler: service.handler, realUI: true, engine: 'chromium'}, async (page, harness) => {
      const activate = async locator => { const r = await locator.boundingBox(); assert.ok(r); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); };
      // 索引贴：⌥ 点击 = 在当前卡里换页（普通点击会另摊一张卡）。
      const activateRail = async locator => { await page.keyboard.down('Alt'); try { await activate(locator); } finally { await page.keyboard.up('Alt'); } };
      await page.locator('openclaw-app').waitFor({state: 'attached'});
      await page.locator('.shell').waitFor({state: 'attached'});
      await activateRail(page.getByRole('button', {name: '舞台', exact: true}));
      await activate(page.getByRole('button', {name: '闪卡', exact: true}));
      await page.locator('.flashcard').waitFor();
      await page.locator('.flashcard').focus();
      await page.locator('.other-stage').evaluate(n => { n.tabIndex = -1; n.focus(); });
      await page.keyboard.press('Space');
      await page.locator('.flashcard.flipped').waitFor();
      await page.keyboard.press('3');
      await page.getByText('这一轮复习完成。', {exact: true}).waitFor();
      assert.equal(harness.calls.filter(c => c.method.endsWith('notes.recall.review')).length, 1);
      await activate(page.getByRole('button', {name: '实验', exact: true}));
      await page.locator('.desk-inline-slot .pinkie-learning-inline').waitFor();
      await activate(page.getByRole('button', {name: '模拟考', exact: true}));
      await page.waitForFunction(() => document.querySelector('.desk-inline-slot')?.textContent.includes('专业基础综合课模拟卷'));
      await activateRail(page.getByRole('button', {name: '书架', exact: true}));
      await page.locator('.pinkie-library:not([hidden])').waitFor();
      await activate(page.getByRole('button', {name: '关闭资料库', exact: true}));
      await activateRail(page.getByRole('button', {name: '笔记本', exact: true}));
      // 笔记本 v2：学习台里的整页视图，不再是抽屉；回舞台走左侧导航。
      await page.locator('.pinkie-desk-notes .n-toc').waitFor();
      assert.equal(await page.locator('.laolao-learning-notes.is-open').count(), 0);
      await activateRail(page.locator('.rail [data-go="stage"]'));
      await activate(page.getByRole('button', {name: '刷题', exact: true}));
      await page.locator('.q-text').waitFor();
      const stem = await page.locator('.q-text').innerText();
      await activate(page.getByRole('button', {name: '换个说法讲', exact: true}));
      await page.waitForFunction(() => __pinkieStudyConversation.active());
      const chat = harness.calls.find(c => c.method === 'chat.send'); assert.match(chat.params.message, /我还没提交答案/); assert.ok(chat.params.message.includes(stem));
      await page.getByText('隔离验收回复：已收到这道题的追问，点左侧舞台可回原题。', {exact: true}).waitFor();
      assert.equal(await page.locator('#pinkie-study-desk .rail').isVisible(), true);
      assert.equal(await page.locator('#pinkie-desk-chat .pk-chat-thread').isVisible(), true);
      assert.match(chat.params.sessionKey,/^agent:learning:desk-chat:/);
      await page.getByRole('button',{name:'舞台',exact:true}).click({modifiers: ['Alt']});
      assert.equal(await page.locator('.q-text').innerText(), stem);
    });
  } finally { service.close(); }
});
test('WebKit reuses real flashcard scheduling and inline experiment cards without the host shell', async () => {
  const service = await harnessModule.isolatedService();
  service.store.saveNote('agent:learning:study-desk-qa', {title: '数组下标', content: 'C 数组下标从 0 开始。'});
  try {
    await run({handler: service.handler, legacyUI: true}, async (page, harness) => {
      await page.getByRole('button', {name: '舞台', exact: true}).click({modifiers: ['Alt']});
      await page.getByRole('button', {name: '闪卡', exact: true}).click();
      await page.locator('.flashcard').waitFor();
      await page.locator('.other-stage').evaluate(n => { n.tabIndex = -1; n.focus(); });
      await page.keyboard.press('Space'); await page.locator('.flashcard.flipped').waitFor(); await page.keyboard.press('3');
      await page.getByText('这一轮复习完成。', {exact: true}).waitFor();
      assert.equal(harness.calls.find(c => c.method.endsWith('notes.recall.review')).params.rating, 'remembered');
      await page.getByRole('button', {name: '实验', exact: true}).click();
      await page.locator('.desk-inline-slot .pinkie-learning-inline').waitFor();
      await page.waitForFunction(() => __pinkieLearningInline.stats().loaded > 0);
    });
  } finally { service.close(); }
});
test('macOS registration upgrades stale duplicate desk tags in order and is idempotent', () => {
  const fs = require('node:fs'), path = require('node:path'), {execFileSync} = require('node:child_process');
  const repo = path.resolve(__dirname, '..'), root = fs.mkdtempSync(path.join(repo, 'tools/study-desk/registration-'));
  try {
    const file = path.join(root, 'index.html');
    fs.writeFileSync(file, '<html><head><meta name="keep" content="existing-user-change"><script src="./laolao-study-desk.js?v=old"></script><script src="/laolao-study-desk.js?v=older"></script></head><body>native chat</body></html>');
    const mac = fs.readFileSync(path.join(repo, 'installer/macos/apply-theme.sh'), 'utf8');
    const block = mac.split('  # Study desk: preserve script order,')[1].split('  # Keep display/selection repairs')[0];
    const script = block.slice(block.indexOf('\n'));
    const apply = () => execFileSync('bash', ['-c', script], {env: {...process.env, index_file: file}});
    apply(); const first = fs.readFileSync(file, 'utf8'); apply(); const second = fs.readFileSync(file, 'utf8');
    assert.equal(first, second);
    assert.ok(second.includes('existing-user-change')); assert.ok(second.includes('native chat'));
    const expected = fs.readFileSync(path.join(repo, 'ui/injections/laolao-head.fragment.html'), 'utf8').split('<!-- Study desk:')[1].split('-->')[1];
    const assets = [...expected.matchAll(/(?:src|href)="\.\/([^"?]+)\?v=([^"]+)"/g)];
    let previous = -1;
    for (const [, name, version] of assets) {
      const needle = './' + name + '?v=' + version;
      assert.equal(second.split(needle).length - 1, 1); assert.ok(second.indexOf(needle) > previous); previous = second.indexOf(needle);
      const windows = fs.readFileSync(path.join(repo, 'installer/windows/apply-theme.ps1'), 'utf8');
      assert.ok(windows.includes("'" + name + "' = '" + version + "'"));
    }
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
test('blank Enter submits once, text entry stays literal, and command-K focuses the asynchronously loaded ask field', async () => {
  await run({handler: (method, p) => {
    if (method.endsWith('desk.today')) return {date: '2026-10-26', exams: [], mastery: {total: 144, subjects: []}, focus: {title: '键盘回归', payload: {size: 1}}};
    if (method.endsWith('desk.set')) return {setId: 'keyboard', title: '键盘回归', questions: [{id: 'blank', k: 'm1', i: 0, kind: 'blank', q: '写下 2 + 2 的结果', o: []}]};
    if (method.endsWith('desk.answer')) return {correct: p.answer === '4', answer: '4', explanation: '2 + 2 = 4', independent: false};
    return {};
  }}, async (page, h) => {
    await page.getByRole('button', {name: /^开始：/}).click();
    await page.locator('.blank-answer').fill('4'); await page.keyboard.press('1');
    assert.equal(await page.locator('.blank-answer').inputValue(), '41');
    assert.equal(h.calls.filter(c => c.method.endsWith('desk.answer')).length, 0);
    await page.locator('.blank-answer').fill('4'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.confirm-answer')?.textContent.includes('看看这一组'));
    assert.equal(h.calls.filter(c => c.method.endsWith('desk.answer')).length, 1);
    await page.keyboard.press('Meta+k');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '问碧琪');
    await page.keyboard.type('1nH');
    assert.equal(h.calls.filter(c => c.method.endsWith('desk.set')).length, 1);
  });
});
test('the workbench stays hidden on desk pages but is usable from the learning conversation', async () => {
  await run({}, async page => {
    assert.equal(await page.locator('.pk-wb').isVisible(), false);
    await page.evaluate(() => __pinkieStudyDesk.go('chat')); await page.waitForFunction(() => document.documentElement.dataset.pinkieStudyDesk === 'chat');
    assert.equal(await page.locator('.pk-wb').isVisible(), true);
    await page.evaluate(() => __pinkieStudyDesk.go('today')); await page.waitForFunction(() => document.documentElement.dataset.pinkieStudyDesk !== 'chat');
    assert.equal(await page.locator('.pk-wb').isVisible(), false);
  });
});
test('today ask bar has a send button, shows sending, keeps the text and explains a failed send', async () => {
  let sends = 0;
  await run({handler: async (method) => {
    if (method.endsWith('desk.today')) return {date: '2026-10-26', exams: [], mastery: {total: 144, subjects: []}, focus: {title: '输入框回归', payload: {size: 1}}};
    if (method === 'chat.send') { sends++; if (sends === 1) throw Error('网关连接断开'); await new Promise(r => setTimeout(r, 400)); return {runId: 'r'}; }
    return {};
  }}, async (page, h) => {
    const send = page.locator('.ask-send'), input = page.getByRole('textbox', {name: '问碧琪'});
    await send.waitFor(); assert.equal(await send.isDisabled(), true);
    await page.locator('.ask').click({position: {x: 30, y: 28}}); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '问碧琪');
    await page.keyboard.type('讲讲换路定律'); assert.equal(await send.isDisabled(), false);
    await send.click(); await page.getByRole('alert').filter({hasText: '没发出去：网关连接断开'}).waitFor();
    assert.equal(await input.inputValue(), '讲讲换路定律');
    await send.click(); await page.locator('.ask.sending').waitFor(); assert.equal(await page.locator('.ask.sending .ask-send').isDisabled(), true);
    await page.waitForFunction(() => __pinkieStudyConversation.active());
    assert.equal(h.calls.filter(c => c.method === 'chat.send').length, 2); assert.equal(h.calls.filter(c => c.method === 'chat.send').at(-1).params.message, '讲讲换路定律');
  });
});
test('bank stems keep code on the lined paper, name the blank to fill, and label judgement items', async () => {
  const questions = [
    {id: 'c5-117-b1', k: 'c5', i: 0, kind: 'blank', q: '求和。补全程序：\nint main() {\n  int i, sum = ① ;\n  printf("%d", ⑤ );\n}\n\n①', o: []},
    {id: 'judge', k: 'c5', i: 0, kind: 'single', q: '判断：while 循环至少执行一次。', o: ['正确', '错误'], optionIds: ['1', '2']},
    {id: 'dialog', k: 'e1', i: 0, kind: 'single', q: '— Thank you for helping me.\n— ______', o: ["It's my pleasure.", 'No, thanks.'], optionIds: ['A', 'B']},
  ];
  await run({handler: (method, p) => {
    if (method.endsWith('desk.today')) return {date: '2026-10-26', exams: [], mastery: {total: 144, subjects: []}, focus: {title: '题干格式', payload: {size: 3}}};
    if (method.endsWith('desk.set')) return {setId: 'stems', title: '题干格式', questions};
    if (method.endsWith('desk.answer')) return {correct: false, answer: p.questionId === 'c5-117-b1' ? 'findLast(a,size,n)' : '2', explanation: '', independent: false};
    return {};
  }}, async page => {
    await page.getByRole('button', {name: /^开始：/}).click();
    await page.locator('.q-part').waitFor();
    assert.equal(await page.locator('.q-text').innerText(), '求和。补全程序：');
    assert.match(await page.locator('.q-code').innerText(), /int i, sum = ① ;\n {2}printf/);
    assert.equal(await page.locator('.q-part').innerText(), '填第 ① 空');
    await page.locator('.blank-answer').fill('1'); await page.keyboard.press('Enter');
    await page.getByText('差一点，答案是 findLast(a,size,n)。', {exact: true}).waitFor();
    await page.locator('.confirm-answer').click();
    await page.waitForFunction(() => document.querySelector('.q-meta')?.textContent.includes('第 2 题'));
    assert.match(await page.locator('.q-meta').innerText(), /· 判断 ·/);
    assert.equal(await page.locator('.q-text').innerText(), 'while 循环至少执行一次。');
    assert.equal(await page.locator('.q-code').count(), 0);
    await page.keyboard.press('1'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.confirm-answer')?.textContent.includes('下一题'));
    await page.locator('.confirm-answer').click();
    await page.waitForFunction(() => document.querySelector('.q-meta')?.textContent.includes('第 3 题'));
    await page.waitForFunction(() => document.querySelector('.q-text')?.querySelectorAll('br').length === 1);
    assert.equal(await page.locator('.q-text').innerText(), '— Thank you for helping me.\n— ______');
    assert.equal(await page.locator('.q-code').count(), 0);
  });
});
test('board model chip reports the real model, generation time, duration and usage', async () => {
  const service = await harnessModule.isolatedService();
  try {
    await run({handler: (method, p) => method.endsWith('desk.insight')
      ? {status: 'ok', generatedAt: Date.parse('2026-10-26T18:38:00+08:00'), model: {name: 'Gemini 3.8 Flash Tiered'}, usage: {total: 6607}, ms: 17238, findings: [], plan: null, insightStale: false}
      : service.handler(method, p)}, async page => {
      await page.getByRole('button', {name: '看板', exact: true}).click({modifiers: ['Alt']});
      await page.waitForFunction(() => document.querySelector('.b-model-chip')?.textContent.includes('tokens'));
      assert.equal(await page.locator('.b-model-chip').innerText(), 'Gemini 3.8 Flash Tiered · 18:38 · 用时 17.2 秒 · 6,607 tokens');
    });
  } finally { service.close(); }
});
test('today retries quietly while the gateway handshake is still pending, but surfaces other errors', async () => {
  let rejected = 0;
  await run({handler: method => {
    if (method.endsWith('desk.today') && rejected < 2) { rejected++; throw Error('invalid handshake: first request must be connect'); }
    if (method.endsWith('desk.today')) return {date: '2026-10-26', exams: [], mastery: {total: 144, subjects: []}, focus: {title: '握手之后', payload: {size: 1}}};
    return {};
  }}, async (page, h) => {
    await page.getByText('握手之后').waitFor();
    assert.equal(rejected, 2);
    assert.equal(h.calls.filter(c => c.method.endsWith('desk.today')).length, 3);
    assert.equal(await page.getByRole('button', {name: '重试', exact: true}).count(), 0);
  });
});
test('desk buttons keep their own colours in day and night: the control reset never outranks them', async () => {
  // Regression (2026-10-26): the reset `:is(button,…):not(…)` had specificity (1,1,1) and turned
  // 「采纳为明天的计划」 and the empty-stage 「开始练习」 into blank pills. It must stay at (1,0,0).
  const service = await harnessModule.isolatedService();
  const contrast = locator => locator.first().evaluate(n => {
    const lum = c => c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
    const s = getComputedStyle(n), a = lum(s.color), b = lum(s.backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  try {
    await run({handler: (method, p) => method.endsWith('desk.insight')
      ? {status: 'ok', generatedAt: Date.now(), model: {name: 'QA'}, usage: {total: 1}, ms: 1, findings: [], plan: {id: 'qa-plan', text: '明天先复测循环结构。'}, insightStale: false}
      : service.handler(method, p).then(result => { if (method.endsWith('desk.today')) result.focus = {kind: 'set', title: 'C 语言 · 循环结构', payload: {chapter: 'c5', size: 6}}; return result; })}, async page => {
      for (const theme of ['day', 'night']) {
        if (theme === 'night') await page.getByRole('button', {name: '切换日间和夜间'}).click();
        await page.getByRole('button', {name: '今日', exact: true}).click({modifiers: ['Alt']});
        const [on, off] = await page.evaluate(() => ['.rail-nav button.on', '.rail-nav button:not(.on)'].map(s => getComputedStyle(document.querySelector(s)).color));
        assert.notEqual(on, off, `${theme}: the current rail page looks like the others`);
        // UI-UPGRADE 4.5: the solid brand star uses --on-pink (white by day, dark at night) and must reach 3:1.
        assert.ok(await contrast(page.locator('.logo')) >= 3, `${theme}: logo star`);
        await page.getByRole('button', {name: '看板', exact: true}).click({modifiers: ['Alt']});
        await page.waitForFunction(() => document.querySelector('.b-adopt')?.disabled === false);
        assert.ok(await contrast(page.locator('.b-adopt')) >= 4.5, `${theme}: 采纳为明天的计划`);
        await page.getByRole('button', {name: '舞台', exact: true}).click({modifiers: ['Alt']});
        await page.locator('.stage-empty .confirm').waitFor();
        assert.ok(await contrast(page.locator('.stage-empty .confirm')) >= 4.5, `${theme}: 开始练习`);
      }
      await page.getByRole('button', {name: '今日', exact: true}).click({modifiers: ['Alt']});
      await page.getByRole('button', {name: /^开始：/}).click(); await page.locator('.q-text').waitFor();
      for (const theme of ['night', 'day']) {
        if (theme === 'day') await page.getByRole('button', {name: '切换日间和夜间'}).click();
        assert.ok(await contrast(page.locator('.confirm-answer')) >= 4.5, `${theme}: 确认`);
      }
    });
  } finally { service.close(); }
});

async function v2Run(options, fn) {
  const {createV2Fixture} = await import('../tools/study-desk/v2-fixtures.mjs');
  const fixture = createV2Fixture(options);
  try { await run({handler: fixture.handler, engine: 'chromium', legacyUI: true}, (page, harness) => fn(page, fixture, harness)); }
  finally { fixture.release(); }
}
test('v2 A1: learning focus, five map states and materials controls use the agreed contract', async () => {
  await v2Run({busy: true, missingTool: true}, async (page, f) => {
    await page.getByText('学 · 换路定律', {exact: true}).waitFor();
    assert.equal(await page.locator('.map-rows .dot').count(), 5);
    assert.equal(await page.locator('.map-rows .dot.learned').count(), 1);
    assert.equal(await page.locator('.map-legend>span').count(), 5);
    await page.locator('.map-rows .dot.learned').hover(); assert.match(await page.locator('.map-cap').innerText(), /学过 · 上过 2 节课 · 答过 3 题/);
    assert.match(await page.locator('.cd-sub').innerText(), /上课 1 \/ 2 节/);
    await page.locator('.materials-status').click(); await page.getByText('缺少 tesseract，对应任务暂不可用。', {exact: true}).waitFor();
    assert.equal(await page.locator('.material-job progress').count(), 5);
    await page.getByRole('button', {name: '立即扫描', exact: true}).click();
    await page.getByRole('button', {name: '全部暂停', exact: true}).click(); await page.getByRole('button', {name: '全部继续', exact: true}).waitFor();
    assert.equal(f.controls.calls.filter(c => c.method.endsWith('jobs.control') && c.params.action === 'pause').length, 5);
    await page.keyboard.press('Escape'); await page.locator('.materials-panel').waitFor({state: 'detached'});
    assert.equal(await page.locator('.materials-status').evaluate(n => n === document.activeElement), true);
    await page.locator('.task').click(); await page.locator('.lesson-outline li').first().waitFor();
    assert.ok(f.controls.calls.some(c => c.method.endsWith('lesson.prepare') && c.params.k === 'ee4' && c.params.i === 2));
    assert.equal(await page.locator('.lesson-outline li').count(), 3);
    await page.getByRole('button', {name: '看原页', exact: true}).click(); await page.locator('.page-image').waitFor();
    await page.keyboard.press('+'); assert.equal(await page.locator('.page-image').evaluate(n => n.style.width), '150%');
    await page.keyboard.press('ArrowRight'); await page.waitForFunction(() => document.querySelector('.lesson-viewer>p')?.textContent.includes('第 13 页'));
    await page.getByRole('button', {name: '在访达中显示', exact: true}).click();
    await page.keyboard.press('Escape');
  });
});
test('v2 A2: offline and document sources remain readable, downgraded outlines and missing sources stay usable', async () => {
  await v2Run({offline: true, ocr: true, degraded: true}, async page => {
    await page.getByText('U盘未插 · 用本机索引', {exact: true}).waitFor();
    await page.locator('.task').click(); await page.getByText('这次用的是简版课纲', {exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: '打开视频', exact: true}).isDisabled(), true);
    await page.getByRole('button', {name: '看原页', exact: true}).click(); await page.locator('.page-text').waitFor();
    assert.match(await page.locator('.page-body').innerText(), /插上U盘可以看原页 · 识别文字，公式以原页为准/);
    assert.equal(await page.getByRole('button', {name: '在访达中显示', exact: true}).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: '开始上课', exact: true}).click(); await page.locator('.lesson-bar').waitFor();
  });
  await v2Run({docx: true}, async (page, f) => {
    await page.locator('.task').click(); await page.locator('.lesson-outline').waitFor();
    // 刷新恢复的课程可能只有 ref，文档类型必须以 read 返回的元数据为准。
    await page.evaluate(() => __pinkieStudyDeskLesson.openPage({ref: 'm:fixture:12', title: '讲义出处 1'})); await page.locator('.page-text').waitFor();
    assert.equal(f.controls.calls.filter(c => c.method.endsWith('pageImage')).length, 0);
  });
  await v2Run({noSources: true}, async page => {
    await page.locator('.task').click(); await page.getByText('暂无对应讲义，可以照常上课。', {exact: true}).waitFor(); assert.equal(await page.getByRole('button', {name: '开始上课', exact: true}).isEnabled(), true);
  });
});
test('v2 A2: prepare can be cancelled, late results are ignored and 45 second timeout offers a retry', async () => {
  const {createV2Fixture} = await import('../tools/study-desk/v2-fixtures.mjs');
  const f = createV2Fixture({pending: true});
  try { await run({handler: f.handler, engine: 'chromium'}, async page => {
    await page.locator('.task').click(); await page.locator('.lesson-skeleton').waitFor();
    await page.getByRole('button', {name: '取消', exact: true}).click(); f.release();
    await page.locator('.task').waitFor(); assert.equal(await page.locator('.lesson-outline').count(), 0);
  }); } finally { f.release(); }
  const g = createV2Fixture({pending: true});
  try { await run({handler: g.handler, engine: 'chromium'}, async page => {
    await page.locator('.task').click(); await page.locator('.lesson-skeleton').waitFor();
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 46000; });
    await page.getByText('备课超时，重试', {exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: '重试', exact: true}).count(), 1); g.release();
  }); } finally { g.release(); }
});
test('v2 A2: conflicting lessons require an explicit choice and gateway failures never turn into demo success', async () => {
  await v2Run({conflict: true}, async (page, f) => {
    await page.locator('.task').click(); await page.locator('.lesson-conflict').waitFor();
    assert.equal(f.controls.calls.filter(c => c.method.endsWith('lesson.prepare')).length, 0);
    await page.getByRole('button', {name: '放弃它，开始这一节', exact: true}).click(); await page.locator('.lesson-outline').waitFor();
    assert.ok(f.controls.calls.find(c => c.method.endsWith('lesson.abandon')));
  });
  await v2Run({error: 'lesson.prepare'}, async page => {
    await page.locator('.task').click(); await page.getByText('隔离测试：连接暂时失败', {exact: true}).waitFor();
    assert.equal(await page.locator('.lesson-demo').count(), 0); assert.equal(await page.getByRole('button', {name: '重试', exact: true}).count(), 1);
  });
});
test('v2 A3: course bar, stuck, pause/resume, guarded finish, clean history and four-question bridge', async () => {
  await v2Run({}, async (page, f) => {
    await page.locator('.task').click(); await page.getByRole('button', {name: '开始上课', exact: true}).click(); await page.locator('.lesson-bar').waitFor();
    assert.ok(await page.locator('.lesson-bar').evaluate(n => n.getBoundingClientRect().height <= 48));
    assert.equal(await page.locator('.pk-tonight .lesson-bar').count(), 1);
    await page.getByRole('button', {name: '没懂，换个讲法', exact: true}).click();
    await page.waitForFunction(() => qaCalls.some(c => c.method === 'chat.send' && c.params.message === '这段没懂，换个讲法'));
    await page.getByRole('button', {name: '暂停', exact: true}).click(); await page.getByText('已暂停', {exact: true}).waitFor();
    await page.getByRole('button', {name: '继续上课', exact: true}).click(); await page.getByRole('button', {name: '暂停', exact: true}).waitFor();
    assert.match(f.controls.calls.filter(c => c.method === 'chat.send').at(-1).params.message, /^继续上课：换路定律，从第 1 段「哪些量不能突变」接着讲$/);
    await page.getByRole('button', {name: '讲完了，去练', exact: true}).click(); await page.getByText('还没讲完，确定下课吗？', {exact: true}).waitFor();
    await page.getByRole('button', {name: '再听一会', exact: true}).click(); assert.equal(await page.locator('.lesson-finish-confirm').count(), 0);
    await page.getByRole('button', {name: '讲完了，去练', exact: true}).click(); await page.getByRole('button', {name: '下课', exact: true}).click();
    await page.locator('.lesson-summary-title').waitFor(); await page.locator('.lesson-formula .katex').first().waitFor();
    const finish = f.controls.calls.find(c => c.method.endsWith('lesson.finish'));
    assert.equal(finish.params.transcript.length, 1); assert.equal(finish.params.transcript[0].text, '课上讲解'); assert.ok(!JSON.stringify(finish.params.transcript).includes('secret'));
    assert.equal(await page.locator('.lesson-bar').count(), 0); assert.equal(await page.locator('.shell .chat-thread').evaluate(n => n.style.paddingTop), '');
    await page.getByRole('button', {name: '去练 4 道', exact: true}).click(); await page.locator('.q-text').waitFor();
    const setParams=f.controls.calls.find(c=>c.method.endsWith('desk.set')).params;assert.match(setParams.sessionKey,/^agent:learning:desk-chat:/);assert.deepEqual({...setParams,sessionKey:undefined},{sessionKey:undefined,size:4,mode:'practice',chapter:'ee4',item:2});
  });
});
test('v2 A3: summary generation failure still bridges to chat; mock courses never send real chat messages', async () => {
  await v2Run({summaryFailed: true, chatNext: true, ready: true}, async (page, f) => {
    await page.locator('.task').click(); await page.getByRole('button', {name: '开始上课', exact: true}).click(); await page.locator('.lesson-bar .lesson-pink').waitFor();
    await page.getByRole('button', {name: '讲完了，去练', exact: true}).click(); await page.getByText('这次没生成笔记，对话记录已经保存。', {exact: true}).waitFor();
    await page.getByRole('button', {name: '让碧琪出题', exact: true}).click(); await page.waitForFunction(() => __pinkieStudyConversation.active());
    assert.match(f.controls.calls.filter(c => c.method === 'chat.send').at(-1).params.message, /换路定律/);
  });
  await v2Run({unknown: true}, async (page, f) => {
    await page.locator('.task').click(); await page.locator('.lesson-outline').waitFor(); await page.getByText('示意数据', {exact: true}).waitFor();
    await page.getByRole('button', {name: '开始上课', exact: true}).click(); await page.locator('.lesson-bar[data-demo=true]').waitFor();
    assert.equal(f.controls.calls.filter(c => c.method === 'chat.send').length, 0);
    await page.evaluate(() => { history.replaceState({}, '', '/chat?session=agent:project:qa'); document.documentElement.dataset.laolaoMode = 'project'; dispatchEvent(new Event('pinkie:session-selected')); });
    assert.equal(await page.locator('.lesson-bar').count(), 0); assert.equal(await page.locator('.shell .chat-thread').evaluate(n => n.style.paddingTop), '');
  });
});
test('v2 A4: board learning progress, adopted learn entries and reduced motion remain session scoped', async () => {
  await v2Run({}, async (page, f) => {
    await page.getByRole('button', {name: '看板', exact: true}).click({modifiers: ['Alt']}); await page.locator('.b-learning-row').first().waitFor();
    assert.equal(await page.locator('.b-learning [role=progressbar]').count(), 3);
    assert.match(await page.locator('.b-learning').innerText(), /已学[\s\S]*36 \/ 144[\s\S]*已练[\s\S]*20 \/ 144[\s\S]*已掌握[\s\S]*8 \/ 144/);
    await page.getByText('学 · 换路定律', {exact: true}).waitFor();
    await page.getByRole('button', {name: '去练', exact: true}).click(); await page.locator('.q-text').waitFor();
    await page.emulateMedia({reducedMotion: 'reduce'}); await page.evaluate(() => __pinkieStudyDeskLesson.open({k: 'ee4', i: 2})); await page.locator('.lesson-outline').waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('#pinkie-study-desk').getAnimations({subtree: true}).length), 0);
    await page.getByRole('button', {name: '开始上课', exact: true}).click(); await page.locator('.lesson-bar').waitFor();
    await page.evaluate(() => __pinkieStudyDesk.go('today')); await page.locator('#pinkie-desk-chat .pk-chat-stop').waitFor({state:'hidden'}); await page.waitForTimeout(500); const before = f.controls.calls.filter(c => c.method.endsWith('lesson.current')).length;
    await page.waitForTimeout(4200); assert.equal(f.controls.calls.filter(c => c.method.endsWith('lesson.current')).length, before);
  });
});
test('v2 A3: independent conversation controls fit their paper and the notebook entry locates the lesson', async () => {
  const {createV2Fixture}=await import('../tools/study-desk/v2-fixtures.mjs');const f=createV2Fixture({ready:true});
  try{await run({handler:f.handler,engine:'chromium',realUI:true},async page=>{
    await page.locator('.task').click();await page.getByRole('button',{name:'开始上课',exact:true}).click();await page.locator('#pinkie-desk-chat .lesson-bar').waitFor();
    for(const width of [1440,1024]){await page.setViewportSize({width,height:800});await page.waitForFunction(()=>{const n=document.querySelector('#pinkie-desk-chat .lesson-bar'),paper=document.getElementById('pinkie-desk-chat');if(!n||!paper)return false;const a=n.getBoundingClientRect(),b=paper.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1&&a.height<=48;},{},{polling:100});}
    await page.getByRole('button',{name:'讲完了，去练',exact:true}).click();await page.locator('.lesson-summary-title').waitFor();await page.getByRole('button',{name:'看笔记',exact:true}).click();await page.locator('.n-card[data-note-id="fixture-note"]').waitFor();
    assert.equal(await page.locator('.n-card[data-note-id="fixture-note"]').evaluate(n=>n===document.activeElement),true);
  });}finally{f.release();}
});
test('v2 A2: retrying an opening message never begins the same lesson twice', async () => {
  const {createV2Fixture} = await import('../tools/study-desk/v2-fixtures.mjs'); const f = createV2Fixture(); let failed = false;
  try { await run({engine: 'chromium', handler: (method, params) => { if (method === 'chat.send' && !failed) { failed = true; throw Error('消息发送暂时失败'); } return f.handler(method, params); }}, async page => {
    await page.locator('.task').click(); await page.getByRole('button', {name: '开始上课', exact: true}).click(); await page.getByText('消息发送暂时失败', {exact: true}).waitFor();
    await page.getByRole('button', {name: '开始上课', exact: true}).click(); await page.locator('.lesson-bar').waitFor();
    assert.equal(f.controls.calls.filter(c => c.method.endsWith('lesson.begin')).length, 1);
  }); } finally { f.release(); }
});
test('v2 real lesson RPC: empty material roots and no model still complete a lesson and record learned', async () => {
  const service = await harnessModule.isolatedService();
  try { await run({handler: service.handler, engine: 'chromium'}, async page => {
    assert.deepEqual(service.store.materials.definitions, []);
    await page.evaluate(() => __pinkieStudyDeskLesson.open({k: 'c5', i: 0}));
    await page.getByText('这次用的是简版课纲', {exact: true}).waitFor(); await page.getByText('暂无对应讲义，可以照常上课。', {exact: true}).waitFor();
    assert.match(await page.locator('.lesson-paper>.lesson-meta').first().innerText(), /C.*语言/);
    await page.getByRole('button', {name: '开始上课', exact: true}).click(); await page.locator('.lesson-bar').waitFor();
    await page.getByRole('button', {name: '没懂，换个讲法', exact: true}).click();
    await page.getByRole('button', {name: '讲完了，去练', exact: true}).click(); await page.getByRole('button', {name: '下课', exact: true}).click();
    await page.getByText('这次没生成笔记，对话记录已经保存。', {exact: true}).waitFor();
    const lesson = service.store.lessons.all().at(-1); assert.equal(lesson.status, 'done'); assert.equal(lesson.stuckEvents.length, 1);
    const today = await service.handler('pinkie.learning.desk.today', {sessionKey: 'agent:learning:study-desk-qa'});
    const item = today.mastery.subjects.flatMap(s => s.chapters).find(ch => ch.k === 'c5').items[0]; assert.equal(item.state, 'learned'); assert.equal(today.progress.lessons, 1);
  }); } finally { await service.close(); }
});
test('v2 A1: a learned point without bank questions opens chat practice instead of an empty set', async () => {
  await v2Run({focus: 'set', practiceInChat: true}, async (page, f) => {
    await page.locator('.task').click(); await page.waitForFunction(() => __pinkieStudyConversation.active());
    assert.equal(f.controls.calls.filter(c => c.method.endsWith('desk.set')).length, 0);
    assert.match(f.controls.calls.find(c => c.method === 'chat.send').params.message, /换路定律.*一道理解练习题/);
  });
});
