// P6 U3（重复代码合一，不改行为）：会话卡片两种按钮的 click 行为锁。
// renderManageCard（pinkie.session.manage.confirm）和 appendDecisionActions（pinkie.session.card.act）
// 各手写了一遍同样的 busy / errors / 刷新流程，只差 RPC 名和回包怎么换卡片：
//   manage   只在 result?.card 存在时用 result.card 换；
//   decision 总是用 result 本身换。
// 合成一个之前先钉住：请求参数、busy 防连点、paint 次数、出错文案、切走会话后不写回。
// 直接取 ui/injections/laolao-session-cards.js 里 cardButton … appendDecisionActions 的真实源码来跑，
// 合并前后这个文件里的用例都应该是绿的。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeTest = require('node:test');
// Every case is pure in-memory; a hang means a lost guard, so fail fast instead of stalling the step.
const test = (name, fn) => nodeTest.test(name, {timeout: 5_000}, fn);

const source = fs.readFileSync(path.join(__dirname, '../ui/injections/laolao-session-cards.js'), 'utf8');
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `找不到 ${from} … ${to}`);
  return source.slice(start, end);
};

class Node {
  constructor(tag, className = '', text = '') { this.tagName = tag.toUpperCase(); this.className = className; this.textContent = text; this.children = []; this.dataset = {}; this.attrs = {}; this.disabled = false; this.onclick = null; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attrs[name] = value; }
}
const walk = (node, out = []) => { for (const c of node.children) { out.push(c); walk(c, out); } return out; };
const buttons = (node) => walk(node).filter((n) => n.tagName === 'BUTTON');
const errorTexts = (node) => walk(node).filter((n) => n.className === 'pinkie-session-card__error').map((n) => n.textContent);

function load() {
  const log = [];
  const pending = [];
  const busy = new Set();
  const errors = new Map();
  const context = {
    el: (tag, className = '', text = '') => new Node(tag, className, text),
    link: () => new Node('a'),
    proposalState: () => 'pending',
    cardActions: (card) => card.actions,
    manageSummary: () => '改名',
    manageLabels: {},
    paint: () => log.push('paint'),
    request: (method, params, timeout) => {
      // params is built inside the vm (another realm); copy it so strict deepEqual compares values only.
      log.push(['request', method, JSON.parse(JSON.stringify(params)), timeout]);
      return new Promise((resolve, reject) => pending.push({resolve, reject}));
    },
    busy, errors,
    window: {PinkieSessionList: {invalidate: () => log.push('invalidate')}},
  };
  const code = `(() => { let selected = '', data = null;\n${between('  function cardButton(', '\n  function renderMetreRoleDraft(')}\n` +
    `return {renderManageCard, appendDecisionActions, set(s, d) { selected = s; data = d; }, get data() { return data; }}; })()`;
  const api = vm.runInNewContext(code, context, {filename: 'laolao-session-cards.js'});
  return {api, log, pending, busy, errors};
}

const tick = () => new Promise((r) => setImmediate(r));
const card = (extra = {}) => ({id: 'c1', actions: [['run', '确认改名'], ['dismiss', '不用了']], ...extra});

function manage(env, key = 'k1') { return env.api.renderManageCard(card({kind: 'manage', target: 't'}), key); }
function decision(env, key = 'k1') { const actions = new Node('div'); env.api.appendDecisionActions(actions, card({actions: [['start', '开始'], ['dismiss', '不用了']]}), key); return actions; }

for (const [kind, render, method, action] of [
  ['manage', manage, 'pinkie.session.manage.confirm', 'run'],
  ['decision', decision, 'pinkie.session.card.act', 'start'],
]) {
  test(`${kind}：点主键发 ${method}，先 busy + paint，回来后清 busy、刷新列表、再 paint`, async () => {
    const env = load();
    const old = {id: 'c1', v: 'old'}, other = {id: 'c2'};
    env.api.set('k1', {cards: [old, other]});
    const [primary, secondary] = buttons(render(env));
    assert.equal(primary.className, 'pinkie-session-card__button pinkie-session-card__primary');
    assert.equal(secondary.className, 'pinkie-session-card__button pinkie-session-card__secondary');
    assert.equal(primary.disabled, false);
    const clicked = primary.onclick();
    assert.deepEqual(env.log, ['paint', ['request', method, {key: 'k1', id: 'c1', action}, 45_000]]);
    assert.ok(env.busy.has('c1'));
    // 请求还没回来时再点（任一个键）都不发第二个请求。不 await：防连点要是丢了，第二个请求
    // 永远不回，await 会把用例挂住，而这里要的是红。
    secondary.onclick(); primary.onclick();
    await tick();
    assert.equal(env.log.filter((e) => e[0] === 'request').length, 1, '请求途中再点不能再发请求');
    const fresh = {id: 'c1', v: 'new'};
    env.pending[0].resolve(kind === 'manage' ? {card: fresh} : fresh);
    await clicked;
    assert.deepEqual(env.log.slice(2), ['invalidate', 'paint']);
    assert.equal(env.busy.size, 0);
    assert.deepEqual(env.api.data.cards, [fresh, other]);
    // busy 时重画出来的键是禁用的。
    env.busy.add('c1');
    assert.ok(buttons(render(env)).every((b) => b.disabled));
  });

  test(`${kind}：出错时记文案（没有 message 用兜底），清 busy，下次重画带出错误`, async () => {
    for (const [error, text] of [[new Error('网关断了'), '网关断了'], [new Error(''), '这次没有完成，请再试一次']]) {
      const env = load();
      env.api.set('k1', {cards: [{id: 'c1'}]});
      const clicked = buttons(render(env))[0].onclick();
      env.pending[0].reject(error);
      await clicked;
      assert.equal(env.errors.get('c1'), text);
      assert.equal(env.busy.size, 0);
      assert.deepEqual(env.log.slice(2), ['paint'], '出错不刷新列表');
      assert.deepEqual(errorTexts(render(env)), [text]);
      // 再点一次先把旧错误清掉。
      buttons(render(env))[0].onclick();
      assert.equal(env.errors.has('c1'), false);
    }
  });

  test(`${kind}：不是当前会话不发请求；请求途中切走会话，回来后不写卡片、不记错、不重画`, async () => {
    const env = load();
    env.api.set('k2', {cards: [{id: 'c1'}]});
    await buttons(render(env, 'k1'))[0].onclick();
    assert.deepEqual(env.log, []);
    for (const outcome of ['resolve', 'reject']) {
      const run = load();
      const before = {id: 'c1', v: 'old'};
      run.api.set('k1', {cards: [before]});
      const clicked = buttons(render(run))[0].onclick();
      run.api.set('k2', run.api.data);
      if (outcome === 'resolve') run.pending[0].resolve(kind === 'manage' ? {card: {id: 'c1', v: 'new'}} : {id: 'c1', v: 'new'});
      else run.pending[0].reject(new Error('x'));
      await clicked;
      assert.deepEqual(run.api.data.cards, [before], outcome);
      assert.equal(run.errors.size, 0, outcome);
      assert.equal(run.busy.size, 0, outcome);
      assert.deepEqual(run.log.filter((e) => e === 'paint'), ['paint'], `${outcome}：只有点下去那一次 paint`);
      assert.equal(run.log.includes('invalidate'), outcome === 'resolve', outcome);
    }
  });
}

test('两种卡片换卡片的规则不同：manage 回包没有 card 就不换，decision 总是用回包本身换', async () => {
  const env = load();
  const old = {id: 'c1', v: 'old'};
  env.api.set('k1', {cards: [old]});
  let clicked = buttons(manage(env))[0].onclick();
  env.pending[0].resolve({ok: true});
  await clicked;
  assert.deepEqual(env.api.data.cards, [old]);
  assert.equal(env.api.data.cards[0], old);
  clicked = buttons(decision(env))[0].onclick();
  env.pending[1].resolve({ok: true});
  await clicked;
  assert.deepEqual(env.api.data.cards, [{ok: true}]);
  // data 为空时两种都不写、不报错。
  env.api.set('k1', null);
  clicked = buttons(decision(env))[0].onclick();
  env.pending[2].resolve({id: 'c1'});
  await clicked;
  assert.equal(env.api.data, null);
  assert.equal(env.errors.size, 0);
  await tick();
});
