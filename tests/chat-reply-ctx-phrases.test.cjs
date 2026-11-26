// 第四批 M2 / M10：原生引用回复条（Replying to …）和消息小字里的「% ctx」要显示中文，
// 而且只在各自的部件里换；用户或助手正文里写了同样的英文，不能被改。
// 原生模板（chat-page-*.js）：
//   回复条  <span class="chat-reply-pill__label"> ${kind===`current`?`Replying to current message`:`Replying to ${id}`} </span>
//   输入框上方预览  <span class="chat-reply-preview__label">Replying to ${senderLabel??`message`}</span>（静态 "Replying to " + 另一个绑定）
//   消息小字  <span class="msg-meta__ctx">${n}% ctx</span>（数字一个绑定，"% ctx" 是静态文字）
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
  const match = /^([a-z]*)((?:\.[\w-]+)*)$/i.exec(compound);
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

function loadPhrases() {
  const source = read('ui/injections/laolao-phrases.js')
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

const {localizeText} = loadPhrases();
// 跑两遍：第二遍看到的是已经换好的中文，不能再变。
const run = (node) => { localizeText(node); localizeText(node); return node.nodeValue; };

test('M2：引用回复条和输入框上方的预览显示中文，名字绑定不动', () => {
  const pill = element('chat-reply-pill__label', element('chat-reply-pill', null, 'div'));
  assert.equal(run(textNode(' Replying to current message ', pill)), ' 回复当前消息 ');
  assert.equal(run(textNode(' Replying to msg-42 ', pill)), ' 回复 msg-42 ');

  const preview = element('chat-reply-preview__label', element('chat-reply-preview', null, 'div'));
  // 静态部分后面紧跟另一个绑定（发送者名字），结尾空格必须留着。
  assert.equal(run(textNode('Replying to ', preview)), '回复 ');
  assert.equal(run(textNode('碧琪', preview)), '碧琪');
});

test('M10：消息小字里的「% ctx」换成「% 上下文」，数字绑定不动', () => {
  const ctx = element('msg-meta__ctx msg-meta__ctx--warn', element('msg-meta__details', element('msg-meta', null, 'details')));
  assert.equal(run(textNode('81', ctx)), '81');
  assert.equal(run(textNode('% ctx', ctx)), '% 上下文');
});

test('正文里写着同样的英文时原样保留', () => {
  const body = element('chat-text', element('chat-bubble', element('chat-group user', null, 'div'), 'div'), 'div');
  assert.equal(run(textNode('Replying to current message', body)), 'Replying to current message');
  assert.equal(run(textNode('Replying to ', body)), 'Replying to ');
  assert.equal(run(textNode('% ctx', body)), '% ctx');
});
