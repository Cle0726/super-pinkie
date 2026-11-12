import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CHAT_MOVES, chatMoveBlock} from '../services/mode-architecture/chat-moves.mjs';
import {classifyWorkKind} from '../services/mode-architecture/work-kinds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function routed(text, mode = 'chat') {
  const {kinds} = classifyWorkKind(text, {mode});
  return chatMoveBlock(text, {mode, kinds});
}

function title(block) {
  const found = [...block.matchAll(/只用「([^」]+)」/g)];
  assert.equal(found.length, 1);
  return found[0][1];
}

test('ten chat moves, one card, chat mode only', () => {
  assert.equal(CHAT_MOVES.length, 10);
  assert.equal(new Set(CHAT_MOVES.map(move => move.id)).size, 10);
  const cases = [
    ['今天好累，想哭', '认真听'],
    ['气死了，这个甲方太离谱', '一起吐槽'],
    ['哈哈哈你还记得上次那个蛋糕吗', '接梗'],
    ['好无聊，讲个笑话', '冷幽默'],
    ['我是不是想多了', '给个判断'],
    ['不知道说什么', '把话聊开'],
    ['我先睡了，明天再说', '收住'],
    ['今天中午吃了碗面，跟你说巨香', '接住这件事'],
    ['快夸我', '轻轻损一下'],
    ['终于考过了', '小小庆祝'],
  ];
  for (const [text, expected] of cases) {
    const block = routed(text);
    assert.equal(title(block), expected, text);
    assert.match(block, /不要告诉先生/);
    assert.match(block, /自称碧琪/);
  }
});

test('a heavier feeling wins over a joke in the same sentence', () => {
  assert.equal(title(routed('哈哈哈我今天想哭')), '认真听');
  assert.equal(title(routed('终于考过了哈哈哈')), '小小庆祝');
  assert.equal(title(routed('算了不说了，我好累')), '收住');
});

test('straight talk and real tasks get no chat card', () => {
  for (const text of [
    '你好',
    '谢谢',
    '什么是光合作用',
    '继续',
    '今天星期几',
    '帮我做个小红书封面',
    '帮我写一段朋友圈文案',
    '帮我翻译下面这段',
    '这道题怎么做',
    '咖啡和茶哪个好',
    '现在黄金多少钱',
    '帮我看看这段对不对',
    '今天吃了亏',
  ]) {
    assert.equal(routed(text), '', text);
  }
});

test('other modes never get a chat card', () => {
  for (const mode of ['project', 'ideas', 'learning', 'none']) {
    assert.equal(routed('今天好累，想哭', mode), '', mode);
    assert.equal(chatMoveBlock('哈哈哈', {mode, kinds: ['simple']}), '', mode);
  }
});

test('a long pasted note does not pick up a light move from one word', () => {
  const text = `哈哈。${'这是一段贴进来的会议记录，里面都是事项和负责人。'.repeat(12)}`;
  assert.ok(text.length > 280);
  assert.equal(routed(text), '');
});

test('a long hard day still gets the listening card', () => {
  const text = `今天好累。${'会上被追着改了三版，回到家还在想那句话。'.repeat(16)}`;
  assert.ok(text.length > 280);
  assert.equal(title(routed(text)), '认真听');
});

test('the router is installed for Mac and the Windows snapshot', () => {
  for (const file of [
    'services/mode-architecture/index.mjs',
    'desktop/windows/mac-runtime/services/mode-architecture/index.mjs',
  ]) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /import \{chatMoveBlock\} from '\.\/chat-moves\.mjs'/);
    assert.match(source, /chatMoveBlock\(routedPrompt, \{mode, kinds: routed\.kinds/);
  }
  for (const file of [
    'services/mode-architecture/setup.py',
    'desktop/windows/mac-runtime/services/mode-architecture/setup.py',
    'installer/macos/apply-theme.sh',
  ]) {
    assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /chat-moves\.mjs/);
  }
});
