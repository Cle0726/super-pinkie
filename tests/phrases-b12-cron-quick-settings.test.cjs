// B12（backlog）：上游 zh-CN 包（OpenClaw 2026.7.1-2）里漏译、在原生 /cron 和设置弹层里露出英文的五句，走 laolao-phrases.js 覆盖层，只加词条。
// 原生模板（各是整段文字节点）：
//   cron-page-*.js    空状态  ${p(k?`cron.jobs.noMatching`:`cron.jobs.emptyTitle`)} / ${p(k?`cron.jobs.emptyFilteredHint`:`cron.jobs.emptyHint`)}
//   config-page-*.js  设置弹层安全卡  <span class="qs-row__label">${u(`quickSettings.security.browserEnabled`)}</span>（toolProfile 同）
// 命令面板（palette.*）上游已全是中文，不用加。反例：把这几行词条从脚本里拿掉，五句都还是英文。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function element(classes, parent = null, tag = 'span') {
  const node = {
    tagName: tag.toUpperCase(), classes: new Set(classes.split(/\s+/).filter(Boolean)), parentElement: parent,
    dataset: {}, setAttribute() {}, getAttribute() { return null; },
    matches(selector) { return selector.split(',').some((alt) => matchChain(node, alt.trim().split(/\s+/))); },
    closest(selector) {
      for (let current = node; current; current = current.parentElement) if (current.matches(selector)) return current;
      return null;
    },
  };
  return node;
}
function matchCompound(node, compound) {
  const match = /^([a-z-]*)((?:\.[\w-]+)*)$/i.exec(compound);
  if (!match) return false;
  if (match[1] && node.tagName !== match[1].toUpperCase()) return false;
  return match[2].split('.').filter(Boolean).every((name) => node.classes.has(name));
}
function matchChain(node, parts) {
  if (!matchCompound(node, parts.at(-1))) return false;
  let rest = parts.slice(0, -1);
  for (let ancestor = node.parentElement; rest.length && ancestor; ancestor = ancestor.parentElement) {
    if (matchCompound(ancestor, rest.at(-1))) rest = rest.slice(0, -1);
  }
  return rest.length === 0;
}
const textNode = (nodeValue, parentElement) => ({nodeType: 3, nodeValue, parentElement});

const B12 = [
  ['No scheduled jobs yet.', '还没有定时任务。'],
  ['Create one from a plain-language prompt; advanced fields can wait.', '用一句话说清要做什么就能建一个，高级选项以后再填。'],
  ['Clear or change filters to see scheduled jobs.', '清除或修改筛选条件，就能看到定时任务。'],
  ['Browser enabled', '启用浏览器'],
  ['Tool profile', '工具档位'],
];

function loadPhrases(transform = (s) => s) {
  const source = transform(read('ui/injections/laolao-phrases.js'))
    .replace(/\}\)\(\);\s*$/, 'window.__phrasesTest = {localizeText};})();');
  const window = {addEventListener() {}, dispatchEvent() {}};
  const document = {readyState: 'loading', addEventListener() {}};
  class MutationObserver { observe() {} disconnect() {} }
  vm.runInNewContext(source, {
    window, document, MutationObserver, Node: {TEXT_NODE: 3, ELEMENT_NODE: 1}, NodeFilter: {SHOW_TEXT: 4},
    CustomEvent: class {}, console,
  });
  return window.__phrasesTest;
}

// 原生 /cron 空状态在 openclaw-cron-page 里；设置弹层安全卡的行标签是 .qs-row__label。
const cronEmpty = () => element('', element('cron-jobs-empty', element('', null, 'openclaw-cron-page'), 'div'), 'p');
const qsLabel = () => element('qs-row__label', element('qs-row', element('qs-card', null, 'div'), 'div'));
const places = [cronEmpty, cronEmpty, cronEmpty, qsLabel, qsLabel];

const {localizeText} = loadPhrases();
// 跑两遍：第二遍看到的是已经换好的中文，不能再变。
const run = (fn, node) => { fn(node); fn(node); return node.nodeValue; };

test('B12：/cron 空状态三句、设置弹层安全卡两行显示中文（前后空白留着）', () => {
  B12.forEach(([en, zh], i) => {
    assert.equal(run(localizeText, textNode(en, places[i]())), zh, en);
    assert.equal(run(localizeText, textNode(`\n  ${en}\n`, places[i]())), `\n  ${zh}\n`, `${en}（带模板缩进）`);
  });
});

test('B12：用户 / 助手正文、代码里写着同样的英文时原样保留', () => {
  const body = element('chat-text', element('chat-bubble', element('chat-group user', null, 'div'), 'div'), 'div');
  const code = element('', element('', null, 'pre'), 'code');
  for (const [en] of B12) {
    assert.equal(run(localizeText, textNode(en, body)), en, `正文：${en}`);
    assert.equal(run(localizeText, textNode(en, code)), en, `代码：${en}`);
  }
});

test('B12 反例：把这几行词条从脚本里拿掉，五句都还是英文（测试真的在量这几条词条）', () => {
  let removed = 0;
  const strip = (s) => B12.reduce((src, [en, zh]) => {
    const entry = `[${JSON.stringify(en)}, ${JSON.stringify(zh)}],`;
    if (src.includes(entry)) removed++;
    return src.replace(entry, '');
  }, s);
  const bare = loadPhrases(strip).localizeText;
  assert.equal(removed, B12.length, `脚本里应正好有 ${B12.length} 条 B12 词条（找到 ${removed}）`);
  B12.forEach(([en], i) => assert.equal(run(bare, textNode(en, places[i]())), en, `去掉词条后：${en}`));
});
