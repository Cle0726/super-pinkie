import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadGenerators} from '../services/mode-architecture/learning-zsb-gen.mjs';

// 专升本题目生成器（learning-zsb-gen.mjs）的纯逻辑单测：不联网、不用模型，只用固定种子的随机函数出题，
// 再用测试里独立写的算法把答案重算一遍，确认「答案由程序计算，保证正确」这句话成立。
const DATA = JSON.parse(fs.readFileSync(new URL('../services/mode-architecture/learning-zsb-data.json', import.meta.url), 'utf8'));
const GENS = loadGenerators(DATA.vocab);
const SEEDS = 400;

// 可复现的随机函数（mulberry32），每个种子一条独立序列。
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gen = name => { const g = GENS.find(x => x.name === name); assert.ok(g, `找不到生成器：${name}`); return g; };
const many = (name, n = SEEDS) => Array.from({length: n}, (_, i) => gen(name).make(rng(i + 1)));
const picked = q => q.o['ABCD'.indexOf(q.a)];

// 已知 bug 先钉住现状：里面写的是正确行为，外面断言「目前仍然不成立」。
// 源码修好后这里会变红，届时去掉 stillBuggy 包装和 todo 标记，直接断言正确行为。
function stillBuggy(correct) {
  assert.throws(correct, {name: 'AssertionError'}, '这个已知 bug 好像已经修好了：请去掉 stillBuggy 包装和 todo 标记，直接断言正确行为');
}

// 独立实现的 IPv4 计算（不用位运算，避免和被测代码写法一样而一起错）
const toInt = s => s.split('.').reduce((a, b) => a * 256 + Number(b), 0);
const toIp = n => [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');
const maskOf = p => 2 ** 32 - 2 ** (32 - p);
const prefixOf = m => 32 - Math.log2(2 ** 32 - toInt(m));

test('生成器清单：29 个、名字不重复，覆盖网络 / 电工 / C 语言 / 数学 / 英语五块', () => {
  assert.equal(GENS.length, 29);
  assert.equal(new Set(GENS.map(g => g.name)).size, GENS.length);
  assert.deepEqual([...new Set(GENS.map(g => g.k))].sort(), ['c2', 'c3', 'c5', 'c6', 'e1', 'ee2', 'ee3', 'ee4', 'ee6', 'ee7', 'ee8', 'ee9', 'm1', 'm2', 'm4', 'm5', 'net4', 'net6']);
  for (const g of GENS) assert.equal(typeof g.make, 'function', g.name);
  // 每次调用都是一套新的生成器，互不串数据
  const again = loadGenerators(DATA.vocab);
  assert.notEqual(again, GENS);
  assert.notEqual(again[0], GENS[0]);
});

test('同一个种子出同一道题（模考打印要能复现），不同种子能出不同的题', () => {
  for (const g of GENS) {
    assert.deepEqual(g.make(rng(7)), g.make(rng(7)), g.name);
    const stems = new Set(Array.from({length: 30}, (_, i) => JSON.stringify(g.make(rng(100 + i)))));
    assert.ok(stems.size > 1, `${g.name} 30 个种子只出了一种题`);
  }
});

test('题目结构不变量：单选 4 个不重复选项且答案落在 A–D；填空答案非空；判断题答案是布尔值、不漏内部字段', () => {
  for (const g of GENS) {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const q = g.make(rng(seed));
      const where = `${g.name} 种子 ${seed}`;
      assert.ok(['single', 'fill', 'judge'].includes(q.t), where);
      assert.equal(typeof q.q, 'string', where);
      assert.ok(q.q.length > 5, where);
      assert.ok(typeof q.x === 'string' && q.x.length > 0, `${where} 缺解析`);
      assert.doesNotMatch(q.q + (q.o || []).join('|') + q.x, /NaN|undefined/, where);
      if (q.t === 'single') {
        assert.equal(q.o.length, 4, where);
        assert.equal(new Set(q.o).size, 4, `${where} 选项重复：${q.o}`);
        assert.match(q.a, /^[ABCD]$/, where);
      } else if (q.t === 'fill') {
        assert.ok(Array.isArray(q.a) && q.a.length > 0, where);
        for (const a of q.a) assert.ok(typeof a === 'string' && a.length > 0 && !/NaN|Infinity/.test(a), `${where} 答案 ${a}`);
      } else {
        assert.equal(typeof q.a, 'boolean', where);
        assert.ok(!('_f' in q), `${where} 内部字段 _f 漏给前端了`);
      }
    }
  }
});

test('子网四题：网络地址、广播地址、可用主机数、前缀转掩码都和独立算法一致', () => {
  for (const q of many('子网：求网络地址')) {
    const [, ip, p] = q.q.match(/主机 IP 地址为 ([\d.]+)\/(\d+)，/);
    const block = 2 ** (32 - Number(p));
    assert.deepEqual(q.a, [toIp(toInt(ip) - (toInt(ip) % block))], q.q);
  }
  for (const q of many('子网：求广播地址')) {
    const [, ip, m] = q.q.match(/主机 IP 地址为 ([\d.]+)，子网掩码 ([\d.]+)，/);
    const block = 2 ** (32 - prefixOf(m));
    assert.deepEqual(q.a, [toIp(toInt(ip) - (toInt(ip) % block) + block - 1)], q.q);
  }
  for (const q of many('子网：可用主机数')) {
    const [, m] = q.q.match(/子网掩码 ([\d.]+) 的/);
    assert.equal(picked(q), String(2 ** (32 - prefixOf(m)) - 2), q.q);
  }
  for (const q of many('子网：前缀转掩码')) {
    const [, p] = q.q.match(/前缀 \/(\d+) /);
    assert.deepEqual(q.a, [toIp(maskOf(Number(p)))], q.q);
  }
  for (const q of many('子网：等分 C 类网络')) {
    const [, n] = q.q.match(/等分成 (\d+) 个子网/);
    assert.deepEqual(q.a, [toIp(maskOf(24 + Math.log2(Number(n))))], q.q);
  }
});

test('IP 分类按首字节、常用端口号对得上', () => {
  const cls = b => (b <= 126 ? 'A' : b <= 191 ? 'B' : b <= 223 ? 'C' : 'D');
  for (const q of many('IP 地址分类')) {
    const [, first] = q.q.match(/IP 地址 (\d+)\./);
    assert.equal(picked(q), `${cls(Number(first))} 类`, q.q);
  }
  const PORTS = {HTTP: 80, HTTPS: 443, 'FTP（控制连接）': 21, 'FTP（数据连接）': 20, SMTP: 25, POP3: 110, DNS: 53, Telnet: 23, SSH: 22, 'DHCP 服务器': 67, IMAP: 143, SNMP: 161};
  for (const q of many('常用端口号')) {
    const [, name] = q.q.match(/^(.+) 默认使用的端口号是$/);
    assert.equal(picked(q), String(PORTS[name]), q.q);
  }
});

test('C 语言题：整除取余、自增自减、字符运算、循环次数、sizeof / strlen 都能模拟出同一个答案', () => {
  for (const q of many('整除与取余')) {
    const [, a, b, expr] = q.q.match(/int a = (\d+), b = (\d+); 则表达式 (.+) 的值为/).map((v, i) => (i === 1 || i === 2 ? Number(v) : v));
    const want = {'a / b': Math.trunc(a / b), 'a % b': a % b, 'a / b * b + a % b': a}[expr];
    assert.deepEqual(q.a, [String(want)], q.q);
  }
  for (const q of many('自增自减')) {
    const [, v, expr, ask] = q.q.match(/int a = (\d+), b; b = (\+\+a|--a|a\+\+|a--); 后，变量 ([ab]) 的值/);
    let a = Number(v), b;
    if (expr === '++a') b = ++a; else if (expr === '--a') b = --a; else if (expr === 'a++') b = a++; else b = a--;
    assert.deepEqual(q.a, [String(ask === 'a' ? a : b)], q.q);
  }
  for (const q of many('字符运算')) {
    const add = q.q.match(/printf\("%c", '(.)' \+ (\d+)\)/);
    if (add) {
      const ch = String.fromCharCode(add[1].charCodeAt(0) + Number(add[2]));
      assert.deepEqual(q.a, [ch, `'${ch}'`], q.q);
    } else {
      const [, ch] = q.q.match(/printf\("%d", '(.)'\)/);
      assert.deepEqual(q.a, [String(ch.charCodeAt(0))], q.q);
    }
  }
  for (const q of many('循环次数')) {
    const [, s, op, e, d] = q.q.match(/for \(i = (\d+); i (<=|<) (\d+); i \+= (\d+)\)/);
    let count = 0;
    for (let i = Number(s); op === '<=' ? i <= Number(e) : i < Number(e); i += Number(d)) count += 1;
    assert.deepEqual(q.a, [String(count)], q.q);
  }
  for (const q of many('sizeof 与 strlen')) {
    const [, w, fn] = q.q.match(/char s\[\] = "(.*)"; 则 (sizeof|strlen)\(s\)/);
    assert.deepEqual(q.a, [String(fn === 'sizeof' ? w.length + 1 : w.length)], q.q);
  }
});

test('电工与进制：并串联电阻、二进制十进制互转与独立计算一致', () => {
  const r2 = x => String(Math.round(x * 100) / 100);
  for (const q of many('电阻串并联')) {
    const [a, b, c] = [...q.q.matchAll(/R\d = (\d+) Ω/g)].map(m => Number(m[1]));
    assert.deepEqual(q.a, [r2(1 / (1 / a + 1 / b) + c)], q.q);
  }
  for (const q of many('进制转换')) {
    const dec = q.q.match(/十进制数 (\d+) 转换为二进制数/);
    if (dec) assert.equal(parseInt(q.a[0], 2), Number(dec[1]), q.q);
    else assert.equal(q.a[0], String(parseInt(q.q.match(/\(([01]+)\)₂/)[1], 2)), q.q);
  }
});

test('逻辑式判断题：题面给出的 Y 与真值一致时答案才是「对」', () => {
  const F = {
    'A·B + C': (A, B, C) => (A && B) || C,
    '(A + B)·C': (A, B, C) => (A || B) && C,
    'A·B̄ + Ā·C': (A, B, C) => (A && !B) || (!A && C),
    'A ⊕ B ⊕ C': (A, B, C) => (A !== B) !== Boolean(C),
    '¬(A·B)·C': (A, B, C) => !(A && B) && C,
    'AB + BC + AC': (A, B, C) => A + B + C >= 2,
    '¬(A + B) + C': (A, B, C) => !(A || B) || C,
  };
  let truths = 0;
  for (const q of many('逻辑式求值')) {
    const [, s, A, B, C, shown] = q.q.match(/^逻辑函数 Y = (.+)，当 A = (\d)、B = (\d)、C = (\d) 时，Y = (\d)。$/);
    assert.ok(F[s], `测试没收录的逻辑式：${s}`);
    const real = Number(Boolean(F[s](Number(A), Number(B), Number(C))));
    assert.equal(q.a, Number(shown) === real, q.q);
    if (q.a) truths += 1;
  }
  assert.ok(truths > SEEDS * 0.3 && truths < SEEDS * 0.7, `对/错应大致各半，实际「对」${truths}/${SEEDS}`);
});

test('英语词汇题：正确选项就是题干单词 / 词组的中文释义；换一套词表也照用', () => {
  // 词表里有同一个词收了两条释义（如 justice「正义」/「正义，公正，司法」），算哪条都对；
  // 同词的其它条目不会被当成干扰项（生成器按 w 排除），所以不会出现两个正确选项。
  const cn = new Map();
  for (const x of [...DATA.vocab.words, ...DATA.vocab.phrases]) cn.set(x.w, [...(cn.get(x.w) || []), x.cn]);
  for (const name of ['高频词释义', '固定搭配']) {
    for (const q of many(name)) {
      const [, w] = q.q.match(/<b>(.+)<\/b>/);
      assert.ok(cn.get(w)?.includes(picked(q)), `${q.q} 选了「${picked(q)}」`);
      assert.equal(q.o.filter(o => cn.get(w).includes(o)).length, 1, `${q.q} 出现了不止一个正确释义：${q.o}`);
    }
  }
  const tiny = {words: [{n: 1, w: 'apple', cn: '苹果', f: 9}, {n: 2, w: 'book', cn: '书'}, {n: 3, w: 'cat', cn: '猫'}, {n: 4, w: 'dog', cn: '狗'}],
    phrases: [{w: 'a', cn: '甲', cat: '测'}, {w: 'b', cn: '乙', cat: '测'}, {w: 'c', cn: '丙', cat: '测'}, {w: 'd', cn: '丁', cat: '测'}]};
  const g = loadGenerators(tiny).find(x => x.name === '高频词释义');
  for (let seed = 1; seed <= 50; seed += 1) {
    const q = g.make(rng(seed));
    assert.deepEqual([...q.o].sort(), ['书', '狗', '猫', '苹果'].sort());
    if (q.q.includes('apple')) assert.match(q.x, /真题出现 9 次/);
    else assert.match(q.x, /高频词第 \d 个/);
  }
});

// 特征方程题：把两个选项化成同一种写法再比（1x 写成 x、e^{1x} 写成 eˣ、C₁ / C₂ 两项交换顺序视为同一个通解）
function sameSolution(a, b) {
  const norm = s => {
    const t = s.replace(/ 1x/g, ' x').replace(/e\^\{1x\}/g, 'eˣ').replace(/e\^\{-/g, 'e^{−');
    const m = /^y = C₁(.+) \+ C₂(.+)$/.exec(t);
    return m ? [m[1], m[2]].sort().join(' & ') : t;
  };
  return norm(a) === norm(b);
}
function noEquivalentDistractor(pred) {
  for (let seed = 1; seed <= 3000; seed += 1) {
    const q = gen('特征方程求通解').make(rng(seed));
    if (!pred(q)) continue;
    const answer = picked(q);
    for (const o of q.o) if (o !== answer) assert.ok(!sameSolution(o, answer), `种子 ${seed}：${q.q} 的干扰项「${o}」和正确答案「${answer}」是同一个通解`);
  }
}

test('特征方程题：正确选项的特征根与题面方程吻合', () => {
  for (const q of many('特征方程求通解')) {
    const real = q.q.match(/^微分方程 y″ ([+−]) (\d+)y′ ([+−]) (\d+)y = 0/);
    if (!real) continue;
    const p = (real[1] === '−' ? -1 : 1) * Number(real[2]), c = (real[3] === '−' ? -1 : 1) * Number(real[4]);
    const disc = p * p - 4 * c;
    if (disc <= 0) continue; // 重根题另走「y″ − 2ky′ + k²y」那一支
    const roots = [(-p - Math.sqrt(disc)) / 2, (-p + Math.sqrt(disc)) / 2];
    // 每一项 C·e^{rx} 取出指数 r：「1」是 r = 0，「eˣ」是 r = 1
    const terms = picked(q).match(/^y = C₁(.+) \+ C₂(.+)$/).slice(1).map(t => (t === '1' ? 0 : t === 'eˣ' ? 1 : Number(t.match(/^e\^\{(-?\d+)x\}$/)[1])));
    assert.deepEqual(terms.sort((x, y) => x - y), roots, `${q.q} → ${picked(q)}`);
  }
});

test('已知 bug：y″ + y = 0（ω = 1）时，干扰项「C₁cos 1x + C₂sin 1x」和正确答案是同一个通解', {todo: '源码未修：ω = 1 时干扰项 w*w 仍是 1，只差一个「1」'}, () => {
  stillBuggy(() => noEquivalentDistractor(q => q.q.startsWith('微分方程 y″ + 1y = 0')));
});

test('已知 bug：两根互为相反数（r₁ = −r₂）时，「根取反」干扰项只是把 C₁、C₂ 两项对调，仍是正确通解', {todo: '源码未修：干扰项 e(−r₁)/e(−r₂) 在 r₁ = −r₂ 时与答案等价'}, () => {
  stillBuggy(() => noEquivalentDistractor(q => / \+ 0y′ /.test(q.q)));
});
