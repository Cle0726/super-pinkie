// 86d04f2e「Recover the mode switcher's presentation if a transition throws」：
// 切换模式时转场或收尾抛错，不能让界面卡在「正在切换」——switching 和
// modeTransitionTargetId 要复位、残留的转场遮罩要拿掉、要重新 render，
// 并且下一次点模式还能切。这里把 switchMode 单独拿出来在 vm 里跑。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-mode-switcher.js'), 'utf8');
const from = source.indexOf('  const switchMode = async');
const to = source.indexOf('\n  };\n', from);
assert.ok(from >= 0 && to > from, 'switchMode 必须还在');
const switchModeSource = source.slice(from, to) + '\n  };\n';

const mode = (id) => ({id, label: id, phrases: ['…'], readyPhrase: id, transition: '', sessionKey: `agent:${id}:main`});

function harness({failAt}) {
  const log = [], errors = [];
  let failures = 0;
  const overlay = {remove: () => log.push('overlay-removed')};
  const fail = (where) => {
    if (failAt === where && failures === 0) { failures++; throw new Error(`boom:${where}`); }
  };
  const context = {
    URL, Promise,
    console: {error: (...args) => errors.push(args)},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    window: {location: {href: 'http://127.0.0.1/chat?session=agent:main:main'}, dispatchEvent() {}},
    document: {
      documentElement: {setAttribute() {}},
      querySelector: (selector) => selector === '.laolao-mode-transition' ? overlay : null,
    },
    localStorage: {setItem() {}, getItem() {}}, sessionStorage: {setItem() {}, removeItem() {}},
    activeMode: () => 'chat', closeMenu() {}, ensureModeUnlocked: async () => true,
    resolveTargetSession: async (m) => `agent:${m.id}:main`, rememberSession() {},
    currentSessionKey: () => 'agent:main:main', launchSelectionBurst() {},
    playModeTransition: async (m) => {
      log.push(`play:${m.id}`); fail('play');
      return {overlay: {dataset: {}}};
    },
    navigateWithinApp: () => { log.push('route'); return 'router'; },
    syncModePresentation() {}, flushPendingModePortraitFx() {},
    finishHook: async () => { log.push('finish'); fail('finish'); },
    modeFxReduced: () => true, motion: {frames: async () => {}},
    render: () => log.push('render'),
  };
  // 真实的 finishModeTransition 成功收尾时自己把 switching 复位；抛错时不会走到那一步。
  const api = vm.runInNewContext(`let switching = false, metreExit = null, modeTransitionTargetId = null;
const storageKey = 'k', skipEntrySplashParam = 's', skipEntrySplashKey = 'sk', modeHandoffKey = 'mh';
const finishModeTransition = async (m, ui) => { await finishHook(m, ui); switching = false; };
${switchModeSource}
({switchMode, state: () => ({switching, modeTransitionTargetId})});`, context);
  return {log, errors, switchMode: api.switchMode, state: api.state};
}

for (const failAt of ['play', 'finish']) {
  test(`模式转场在 ${failAt} 阶段抛错后，界面复位、遮罩拿掉，下一次还能切模式`, async () => {
    const h = harness({failAt});
    await assert.doesNotReject(h.switchMode(mode('project')), '转场出错不能变成没人接的 rejection');
    assert.deepEqual({...h.state()}, {switching: false, modeTransitionTargetId: null},
      '出错后 switching / modeTransitionTargetId 必须复位，否则 render 一直提前返回、模式按钮再也点不动');
    assert.ok(h.log.includes('overlay-removed'), '残留的 .laolao-mode-transition 遮罩要拿掉');
    assert.equal(h.log.at(-1), 'render', '复位之后要重新 render 一次');
    assert.equal(h.errors.length, 1, '错误要记进 console.error');
    assert.match(String(h.errors[0][0]), /mode switch failed/);

    h.log.length = 0;
    await h.switchMode(mode('thinking'));
    assert.ok(h.log.includes('play:thinking') && h.log.includes('finish'), '下一次切换照常走完转场');
    assert.deepEqual({...h.state()}, {switching: false, modeTransitionTargetId: null});
  });
}
