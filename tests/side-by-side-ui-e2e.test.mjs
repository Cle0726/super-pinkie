import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {playwright} from '../tools/study-desk/harness.mjs';
import {KEY, ORDER, openFixturePage, until, startFromComposer, finishBoth} from './helpers/side-by-side-fixture.mjs';

// A5 并排答的真页面测试：假页面见 tests/helpers/side-by-side-fixture.mjs（和 pr-shots 脚本共用）。
const engine = process.env.PINKIE_IMAGE_UI_ENGINE || 'chromium';
const WAIT = '先在上面的两栏里选一边，或者都不要，再发下一句';
const BUSY = '这轮跑完再改';
const SKINS = {
  pinkie: {mode: '', hint: '下一句用两个模型同时答', adopt: '用这一边继续', discard: '都不要，回到刚才'},
  metre: {mode: 'metre', hint: '下一拍两个模型对着写', adopt: '留下这一边', discard: '都不留，回到刚才'},
};
const MUTATE = {
  intercept: {'laolao-side-by-side.js': [
    ["window.addEventListener('click', intercept, true);", ''],
    ["window.addEventListener('keydown', intercept, true);", ''],
  ]},
  busy: {'laolao-message-actions.js': [[' || Boolean(window.Pinkie?.sideBySide?.active?.(key))', '']]},
  signature: {'laolao-message-actions.js': [[", Boolean(window.Pinkie?.sideBySide)].join('|')", "].join('|')"]]},
};

let browser;
before(async () => {
  browser = await playwright()[engine].launch({headless: true, ...(engine === 'chromium' ? {channel: 'chrome'} : {})});
}, {timeout: 120_000});
after(async () => { await browser?.close(); });

const openPage = options => openFixturePage(browser, options);
const callsOf = (page, method) => page.evaluate(name => window.__test.calls.filter(call => call.method === name).map(call => call.params), method);
const toastsOf = page => page.evaluate(() => [...window.__test.toasts]);

async function sendWhileComparing(page) {
  const native = (await callsOf(page, 'native-send')).length, waits = (await toastsOf(page)).filter(text => text === WAIT).length;
  await page.locator('textarea').fill('再问一句');
  await page.locator('.chat-send-btn').click();
  await page.locator('textarea').press('Enter');
  const result = {
    native: (await callsOf(page, 'native-send')).length - native,
    toasts: (await toastsOf(page)).filter(text => text === WAIT).length - waits,
    label: await page.locator('.chat-send-btn').getAttribute('aria-label'),
  };
  await page.locator('textarea').fill('');
  return result;
}

const colBoxes = page => Promise.all(['left', 'right'].map(side => page.locator(`.pinkie-sbs__col[data-side="${side}"]`).boundingBox()));

for (const [skinName, skin] of Object.entries(SKINS)) {
  test(`输入框开关：两栏各自流式，比较中不可发，选边后出上一版/下一版（${skinName}，${engine}）`, {timeout: 90_000}, async () => {
    const {page, close} = await openPage({mode: skin.mode});
    try {
      await page.locator('.pinkie-sbs-toggle').waitFor({state: 'attached'});
      await page.locator('.pinkie-tray-btn').click();
      const trayRow = page.locator('.pinkie-tray__row[data-key="sidebyside"]');
      assert.equal(await trayRow.locator('.pinkie-tray__hint').textContent(), skin.hint);
      await trayRow.locator('.pinkie-tray__item').click();
      await until(page, () => document.querySelector('.pinkie-sbs-toggle')?.getAttribute('aria-pressed') === 'true');
      await until(page, () => document.querySelector('.pinkie-tray__row[data-key="sidebyside"] .pinkie-tray__item')?.getAttribute('aria-checked') === 'true');
      const rows = await page.evaluate(() => window.__pinkieComposerTray.rows(document.querySelector('.agent-chat__input')));
      assert.deepEqual(rows.find(row => row.key === 'sidebyside'), {key: 'sidebyside', kind: 'switch', on: true});
      assert.deepEqual(rows.find(row => row.key === 'split'), {key: 'split', kind: 'switch', on: false});
      await page.keyboard.press('Escape');

      await until(page, () => document.querySelector('select[aria-label="右边的模型"]')?.value === 'p/b');
      assert.equal(await page.locator('select[aria-label="左边的模型"]').inputValue(), 'p/a', '左边是这个会话现在的模型');
      assert.equal(await page.locator('.chat-send-btn').getAttribute('aria-label'), '并排发送');
      await page.locator('textarea').fill('讲讲光合作用');
      await page.locator('.chat-send-btn').click();
      await page.locator('.pinkie-sbs[data-phase="running"]').waitFor();
      assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide'), [{key: KEY, models: ['p/a', 'p/b'], text: '讲讲光合作用'}]);
      assert.equal((await callsOf(page, 'native-send')).length, 0, '开关打开时这一发不走普通发送');
      assert.equal(await page.locator('textarea').inputValue(), '');
      await until(page, () => document.querySelector('.pinkie-sbs-toggle')?.getAttribute('aria-pressed') === 'false');
      assert.deepEqual(await page.locator('.pinkie-sbs__model').allTextContents(), ['模型甲', '模型乙']);
      assert.equal(await page.locator('.pinkie-sbs__ask').textContent(), '讲讲光合作用');
      assert.equal(await page.locator('.pinkie-sbs').evaluate(node => node.classList.contains('pinkie-sbs--metre')), skin.mode === 'metre');
      assert.equal(await page.locator('#tail + .pinkie-sbs').count(), 1, '输入框发起的挂在最后');

      await page.evaluate(() => window.__test.stream('left', '左边先写了一半'));
      await until(page, () => document.querySelector('.pinkie-sbs__text[data-side="left"]')?.textContent === '左边先写了一半');
      assert.equal(await page.locator('.pinkie-sbs__text[data-side="right"]').textContent(), '', '右边没来事件就不跟着变');
      await page.evaluate(() => window.__test.stream('right', '右边也开始了'));
      await until(page, () => document.querySelector('.pinkie-sbs__text[data-side="right"]')?.textContent === '右边也开始了');
      assert.equal(await page.locator('.pinkie-sbs__text[data-side="left"]').textContent(), '左边先写了一半');
      assert.equal(await page.locator('.pinkie-sbs__stop').count(), 2, '每一栏可以单停');
      assert.equal(await page.locator('.pinkie-sbs__stop-all').count(), 1, '也可以两边都停');

      assert.deepEqual(await sendWhileComparing(page), {native: 0, toasts: 2, label: WAIT}, '比较中点发送和回车都不发');
      assert.equal(await page.locator('html').getAttribute('data-pinkie-sbs'), 'comparing');
      await until(page, () => document.querySelector('#answer button[aria-label="重新回答"]')?.disabled === true);
      for (const label of ['重新回答', '换个模型重新回答', '并排再答']) {
        const node = page.locator(`#answer .pinkie-msg-row--assistant button[aria-label="${label}"]`);
        assert.equal(await node.isDisabled(), true, label);
        assert.equal(await node.getAttribute('title'), BUSY, label);
      }

      await page.locator('.pinkie-tray-btn').click();
      await page.locator('.pinkie-tray__row[data-key="split"] .pinkie-tray__item').click();
      assert.equal((await callsOf(page, 'native-split')).length, 1, '比较中拆分视图照常能开');
      assert.equal(await page.locator('.chat-open-split-view').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.pinkie-sbs').count(), 1);

      await finishBoth(page);
      assert.deepEqual(await page.locator('.pinkie-sbs__state').allTextContents(), ['答完了', '答完了']);
      assert.equal(await page.locator('.pinkie-sbs__text[data-side="left"]').textContent(), '左边的完整回答');
      assert.deepEqual(await page.locator('.pinkie-sbs__usage').allTextContents(), ['输入 1,200 · 输出 340 令牌', '输入 1,200 · 输出 860 令牌']);
      assert.equal(await page.locator('.pinkie-sbs__total').textContent(), '这一题两边一共 3,600 令牌（输入 2,400 · 输出 1,200）');
      assert.deepEqual(await page.locator('.pinkie-sbs__adopt').allTextContents(), [skin.adopt, skin.adopt]);
      assert.equal(await page.locator('.pinkie-sbs__adopt:disabled').count(), 0, 'final 后两边都能选');
      assert.equal(await page.locator('.pinkie-sbs__discard').textContent(), skin.discard);
      assert.equal(await page.locator('.pinkie-sbs__stop, .pinkie-sbs__stop-all').count(), 0);
      assert.equal((await callsOf(page, 'pinkie.chat.sideBySide.adopt')).length, 0, '不自动选');

      let [left, right] = await colBoxes(page);
      assert.ok(Math.abs(left.y - right.y) < 1 && right.x >= left.x + left.width - 1, '1440 宽两栏并排');
      await page.setViewportSize({width: 820, height: 900});
      await until(page, () => {
        const [a, b] = document.querySelectorAll('.pinkie-sbs__col');
        return b.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 1;
      });
      [left, right] = await colBoxes(page);
      assert.ok(right.y >= left.y + left.height - 1 && Math.abs(left.x - right.x) < 1, '820 宽上下叠');
      await page.setViewportSize({width: 1440, height: 900});

      await page.locator('.pinkie-sbs__col[data-side="right"] .pinkie-sbs__adopt').click();
      await page.locator('.pinkie-sbs').waitFor({state: 'detached'});
      assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide.adopt'), [{key: KEY, side: 'right'}]);
      await until(page, () => document.querySelector('.pinkie-msg-variants__count')?.textContent === '3 / 3');
      assert.ok((await callsOf(page, 'chat.history')).some(params => params.sessionKey === KEY && params.limit === 200), '选完重读父会话历史');
      assert.equal(await page.locator('button[aria-label="上一版"]').isDisabled(), false);
      assert.equal(await page.locator('button[aria-label="下一版"]').isDisabled(), true);
      await until(page, () => document.querySelector('#answer button[aria-label="重新回答"]')?.disabled === false);
      assert.equal(await page.locator('.chat-send-btn').getAttribute('aria-label'), '发送');
      assert.equal(await page.locator('html').getAttribute('data-pinkie-sbs'), null);
      const mode = skin.mode || 'default';
      assert.equal(await page.evaluate(name => localStorage.getItem('pinkie.sideBySide.pair.' + name), mode), JSON.stringify(['p/a', 'p/b']));
    } finally { await close(); }
  });
}

test(`动作条「并排再答」：挂在那道题的回复下面，旧回复还在，都不要走 discard（${engine}）`, {timeout: 60_000}, async () => {
  const {page, close} = await openPage({mode: 'metre'});
  try {
    await page.locator('#answer .pinkie-msg-btn--sbs').click();
    await page.locator('.pinkie-sbs[data-phase="running"]').waitFor();
    assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide'), [{key: KEY, models: ['p/a', 'p/b'], entryId: 'E-u1'}]);
    assert.equal(await page.locator('#answer + .pinkie-sbs + #tail').count(), 1, '面板紧跟在那道题的回复后面');
    assert.equal(await page.locator('#answer .chat-text').textContent(), '旧回复：光合作用把光变成糖。', '再答时旧回复还在');
    assert.equal(await page.locator('.pinkie-sbs__ask').count(), 0, '再答发起的不加题');
    await page.locator('.pinkie-sbs__discard').click();
    await page.locator('.pinkie-sbs').waitFor({state: 'detached'});
    assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide.discard'), [{key: KEY}]);
    assert.equal(await page.locator('#answer .chat-text').textContent(), '旧回复：光合作用把光变成糖。');
  } finally { await close(); }
});

test(`动作条「并排再答」没记住另一个模型时先让人挑（${engine}）`, {timeout: 60_000}, async () => {
  const {page, close} = await openPage({pair: null});
  try {
    await page.locator('#answer .pinkie-msg-btn--sbs').click();
    await page.locator('.pinkie-sbs[data-phase="pick"]').waitFor();
    assert.equal(await page.locator('.pinkie-sbs__lead').textContent(), '选两个模型，对这一题各答一份');
    assert.equal((await callsOf(page, 'pinkie.chat.sideBySide')).length, 0);
    await until(page, () => document.querySelector('.pinkie-sbs select[aria-label="左边的模型"]')?.value === 'p/a');
    assert.equal(await page.locator('.pinkie-sbs__go').isDisabled(), true);
    await page.locator('.pinkie-sbs select[aria-label="右边的模型"]').selectOption('p/a');
    assert.equal(await page.locator('.pinkie-sbs__go').isDisabled(), true, '两边同一个模型不能开始');
    await page.locator('.pinkie-sbs select[aria-label="右边的模型"]').selectOption('p/c');
    await page.locator('.pinkie-sbs__go').click();
    await page.locator('.pinkie-sbs[data-phase="running"]').waitFor();
    assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide'), [{key: KEY, models: ['p/a', 'p/c'], entryId: 'E-u1'}]);
    assert.equal(await page.locator('#answer + .pinkie-sbs').count(), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('pinkie.sideBySide.pair.default')), JSON.stringify(['p/a', 'p/c']));
  } finally { await close(); }
});

test(`网关报错原样显示；单停、失败栏写「未完成」和原因；lost 可以收起（${engine}）`, {timeout: 60_000}, async () => {
  const {page, close} = await openPage();
  try {
    await page.locator('.pinkie-sbs-toggle').waitFor({state: 'attached'});
    await page.evaluate(() => { window.__test.fake.sendError = '这一版还不能限制工具，并排答暂不可用'; });
    await page.evaluate(() => window.Pinkie.sideBySide.start({text: '问一句', models: ['p/a', 'p/b']}));
    assert.ok((await toastsOf(page)).includes('这一版还不能限制工具，并排答暂不可用'));
    await until(page, () => !document.querySelector('.pinkie-sbs'));
    assert.equal(await page.evaluate(key => window.Pinkie.sideBySide.active(key), KEY), false);

    await page.evaluate(() => { window.__test.fake.sendError = ''; });
    await startFromComposer(page);
    await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__stop').click();
    await until(page, () => document.querySelector('.pinkie-sbs__col[data-side="left"]')?.dataset.status === 'aborted');
    assert.deepEqual(await callsOf(page, 'pinkie.chat.sideBySide.abort'), [{key: KEY, side: 'left'}]);
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__state').textContent(), '未完成');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__why').textContent(), '这一边停下了，没答完');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="right"] .pinkie-sbs__stop').count(), 1, '另一边还在答');

    await page.evaluate(async key => {
      Object.assign(window.__test.fake, {phase: 'choosing', sides: {left: 'error', right: 'final'}, errors: {left: '上游 500：模型那边出错了'}});
      await window.Pinkie.sideBySide.refresh(key);
    }, KEY);
    await until(page, () => document.querySelector('.pinkie-sbs__col[data-side="left"]')?.dataset.status === 'error');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__state').textContent(), '未完成');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__why').textContent(), '这一边没答完：上游 500：模型那边出错了');
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="left"] .pinkie-sbs__adopt').isDisabled(), true);
    assert.equal(await page.locator('.pinkie-sbs__col[data-side="right"] .pinkie-sbs__adopt').isDisabled(), false);

    await page.evaluate(async key => {
      Object.assign(window.__test.fake, {phase: 'lost', message: '这次比较没保住，可以重新发起'});
      await window.Pinkie.sideBySide.refresh(key);
    }, KEY);
    await page.locator('.pinkie-sbs[data-phase="lost"]').waitFor();
    assert.equal(await page.locator('.pinkie-sbs__lost').textContent(), '这次比较没保住，可以重新发起');
    await page.locator('.pinkie-sbs[data-phase="lost"] button').click();
    await until(page, () => !document.querySelector('.pinkie-sbs'));
  } finally { await close(); }
});

test(`并排答脚本晚于动作条生效时，「并排再答」也会补上（${engine}）`, {timeout: 60_000}, async () => {
  const {page, close} = await openPage({scripts: ORDER.filter(name => name !== 'laolao-side-by-side.js')});
  try {
    await page.locator('#answer .pinkie-msg-row--assistant').waitFor();
    assert.equal(await page.locator('.pinkie-msg-btn--sbs').count(), 0);
    await page.addScriptTag({url: '/laolao-side-by-side.js'});
    await page.locator('#answer .pinkie-msg-btn--sbs').waitFor({timeout: 5000});
  } finally { await close(); }
});

test(`反例：去掉发送拦截、比较中的 busy、签名里的并排答，上面对应的检查会变红（${engine}）`, {timeout: 90_000}, async () => {
  {
    const {page, close} = await openPage({mutate: MUTATE.intercept});
    try {
      await startFromComposer(page);
      const result = await sendWhileComparing(page);
      assert.ok(result.native > 0 && result.toasts === 0, '没有拦截时比较中的发送会漏到普通发送');
    } finally { await close(); }
  }
  {
    const {page, close} = await openPage({mutate: MUTATE.busy});
    try {
      await page.locator('#answer button[aria-label="重新回答"]').waitFor();
      await startFromComposer(page);
      await page.waitForTimeout(800);
      assert.equal(await page.locator('#answer button[aria-label="重新回答"]').isDisabled(), false, '没有 busy 判断时比较中动作条还能点');
    } finally { await close(); }
  }
  {
    const {page, close} = await openPage({mutate: MUTATE.signature, scripts: ORDER.filter(name => name !== 'laolao-side-by-side.js')});
    try {
      await page.locator('#answer .pinkie-msg-row--assistant').waitFor();
      await page.addScriptTag({url: '/laolao-side-by-side.js'});
      await page.waitForTimeout(4000);
      assert.equal(await page.locator('.pinkie-msg-btn--sbs').count(), 0, '签名不看并排答时晚到的脚本补不上按钮');
    } finally { await close(); }
  }
});
