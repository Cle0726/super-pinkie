import test from 'node:test';
import assert from 'node:assert/strict';
import {traceC} from '../services/mode-architecture/learning-c-trace.mjs';

// traceC 只解释 clang -Xclang -ast-dump=json 产出的一个小子集。这里按 Clang JSON 的节点形状
// （kind / inner / opcode / castKind / referencedDecl / type.qualType / range.begin.offset）手工搭 AST，
// 只验证解释器自身的纯逻辑：不调用编译器、不运行任何程序、不碰文件与网络。
let seq = 0;
const T = qualType => ({qualType});
const at = offset => offset === undefined ? {} : {range: {begin: {offset}}};
const int = (value, type = 'int') => ({kind: 'IntegerLiteral', value: String(value), type: T(type)});
const flt = value => ({kind: 'FloatingLiteral', value: String(value), type: T('double')});
const chr = code => ({kind: 'CharacterLiteral', value: code, type: T('int')});
// 字符串字面量在 Clang JSON 里是带引号、C 转义的源码文本；ASCII 内容与 JSON.stringify 的结果一致
const str = text => ({kind: 'ImplicitCastExpr', castKind: 'ArrayToPointerDecay', type: T('char *'),
  inner: [{kind: 'StringLiteral', value: JSON.stringify(text), type: T(`char[${Buffer.byteLength(text) + 1}]`)}]});
const decl = (name, type, init) => ({kind: 'VarDecl', id: '0x' + (++seq).toString(16), name, type: T(type), ...(init ? {inner: [init]} : {})});
const declRef = d => ({kind: 'DeclRefExpr', referencedDecl: {id: d.id, kind: 'VarDecl', name: d.name, type: d.type}, type: d.type});
const conv = (castKind, type, node) => ({kind: 'ImplicitCastExpr', castKind, type: T(type), inner: [node]});
const v = d => conv('LValueToRValue', d.type.qualType, declRef(d));
const elem = d => d.type.qualType.replace(/\[\d+\]$/, '').trim();
const decay = d => conv('ArrayToPointerDecay', elem(d) + ' *', declRef(d));
const bin = (opcode, a, b, type = 'int') => ({kind: 'BinaryOperator', opcode, type: T(type), inner: [a, b]});
const assign = (target, value, type = 'int') => bin('=', target, value, type);
const compound = (opcode, target, value, type = 'int') => ({kind: 'CompoundAssignOperator', opcode, type: T(type), inner: [target, value]});
const un = (opcode, x, type = 'int', isPostfix = false) => ({kind: 'UnaryOperator', opcode, isPostfix, type: T(type), inner: [x]});
const addr = d => un('&', declRef(d), d.type.qualType + ' *');
const deref = p => un('*', v(p));
const index = (d, i) => conv('LValueToRValue', elem(d),
  {kind: 'ArraySubscriptExpr', type: T(elem(d)), inner: [decay(d), typeof i === 'number' ? int(i) : i]});
const list = (type, ...items) => ({kind: 'InitListExpr', type: T(type), inner: items});
const call = (name, ...args) => ({kind: 'CallExpr', type: T('int'), inner: [conv('FunctionToPointerDecay', 'int (*)(const char *, ...)',
  {kind: 'DeclRefExpr', referencedDecl: {id: 'fn:' + name, kind: 'FunctionDecl', name}, type: T('int (const char *, ...)')}), ...args]});
const stmt = (node, offset) => ({...node, ...at(offset)});
const declare = (offset, ...decls) => ({kind: 'DeclStmt', ...at(offset), inner: decls});
const ret = (value = int(0), offset) => ({kind: 'ReturnStmt', ...at(offset), inner: [value]});
const block = (...inner) => ({kind: 'CompoundStmt', inner});
const main = (...body) => ({kind: 'FunctionDecl', name: 'main', type: T('int (void)'), inner: [block(...body)]});
// Clang 的 ForStmt.inner 固定 5 项：init、条件变量、cond、inc、body，空位是 {}
const forLoop = (init, cond, inc, body) => ({kind: 'ForStmt', inner: [init ?? {}, {}, cond ?? {}, inc ?? {}, body ?? {kind: 'NullStmt'}]});
const whileLoop = (cond, body) => ({kind: 'WhileStmt', inner: [cond, body]});
const ifStmt = (cond, then, otherwise) => ({kind: 'IfStmt', inner: otherwise ? [cond, then, otherwise] : [cond, then]});
const run = (body, stdout = '', source = '') => traceC(main(...body), source, stdout);
// 最后一帧里按名字取变量当前值
const last = (result, name) => result.frames.at(-1).variables.find(x => x.name === name)?.value;
const values = result => Object.fromEntries(result.frames.at(-1).variables.map(x => [x.name, x.value]));
const failed = (message, undefinedBehavior) => ({frames: [], verifiedOutput: false, message, undefinedBehavior});

test('只认 main 函数的 AST：缺失或不是 main 时不给轨迹，也不算未定义行为', () => {
  for (const ast of [null, undefined, {}, {kind: 'FunctionDecl', name: 'helper', inner: [block()]}, {kind: 'VarDecl', name: 'main'}])
    assert.deepEqual(traceC(ast, '', ''), failed('当前代码未提供可用轨迹', false));
});

test('声明、整数除法截断与浮点运算逐步执行；行号按 clang 的 UTF-8 字节偏移计算；输出不一致整体作废', () => {
  // 第一行放一长串中文：若误按字符下标切源码，偏移会多出几十个字符，行号就会错到后面几行
  const source = '// 这一行中文注释用来确认行号是按字节偏移而不是按字符个数计算出来的\nint main(void) {\n  int a = 7;\n  int b = a / 2;\n  double h = a / 2.0;\n  printf("%d %.2f\\n", b, h);\n  return 0;\n}\n';
  const off = text => Buffer.from(source).indexOf(text);
  const a = decl('a', 'int', int(7)), b = decl('b', 'int', bin('/', v(a), int(2)));
  const h = decl('h', 'double', bin('/', conv('IntegralToFloating', 'double', v(a)), flt(2.0), 'double'));
  const ast = main(declare(off('int a'), a), declare(off('int b'), b), declare(off('double h'), h),
    stmt(call('printf', str('%d %.2f\n'), v(b), v(h)), off('printf')), ret(int(0), off('return')));
  const result = traceC(ast, source, '3 3.50\n');
  assert.equal(result.verifiedOutput, true, result.message);
  assert.deepEqual(result.frames.map(f => f.line), [3, 4, 5, 6, 7]);
  assert.deepEqual(result.frames.map(f => f.stdout), ['', '', '', '3 3.50\n', '3 3.50\n']);
  assert.deepEqual(result.frames.at(-1).variables, [
    {name: 'a', type: 'int', value: 7}, {name: 'b', type: 'int', value: 3}, {name: 'h', type: 'double', value: 3.5}]);
  // 和真实 Clang 运行结果差一个字符，就不展示「可能不对」的轨迹
  assert.deepEqual(traceC(ast, source, '3 3.5\n'), failed('逐步观察与真实输出不一致，仅展示真实运行结果', false));
});

test('printf 支持 %d %i %c %s %f %.Nf，puts 自动换行；未支持的格式、参数不符或其他函数都停下', () => {
  const ok = run([stmt(call('printf', str('%d %i %c %s|%.2f|%f\n'), int(50), un('-', int(7)), chr(65), str('ok'), flt(3.14159), flt(0.5))),
    stmt(call('puts', str('hi'))), ret()], '50 -7 A ok|3.14|0.500000\nhi\n');
  assert.equal(ok.verifiedOutput, true, ok.message);
  assert.equal(ok.frames.at(-1).stdout, '50 -7 A ok|3.14|0.500000\nhi\n');
  const stop = (...args) => run([stmt(call(...args)), ret()]);
  assert.deepEqual(stop('printf', str('%x\n'), int(1)), failed('printf格式暂不支持', false));
  assert.deepEqual(stop('printf', str('%5d\n'), int(1)), failed('printf格式暂不支持', false));
  assert.deepEqual(stop('printf', str('%d\n'), int(1), int(2)), failed('printf格式暂不支持', false));
  assert.deepEqual(stop('printf', str('%d %d\n'), int(1)), failed('printf参数格式不支持', false));
  assert.deepEqual(stop('printf', str('%d\n'), str('ok')), failed('printf参数格式不支持', false));
  assert.deepEqual(stop('strlen', str('abc')), failed('此函数请查看真实运行结果，暂不提供逐步观察', false));
});

test('整型按 C 语义向零截断；前置/后置自增和复合赋值写回变量', () => {
  const t = decl('t', 'int', conv('FloatingToIntegral', 'int', flt(7.9)));
  const q = decl('q', 'int', bin('/', un('-', int(7)), int(2))), r = decl('r', 'int', bin('%', un('-', int(7)), int(2)));
  const i = decl('i', 'int', int(1)), j = decl('j', 'int', un('++', declRef(i), 'int', true)), k = decl('k', 'int', un('++', declRef(i)));
  const m = decl('m', 'int', int(5)), n = decl('n', 'int', un('!', int(5)));
  const result = run([declare(0, t, q, r, i, j, k, m, n), stmt(compound('*=', declRef(m), int(3))), stmt(compound('/=', declRef(m), int(2))), ret()]);
  assert.equal(result.verifiedOutput, true, result.message);
  assert.deepEqual(values(result), {t: 7, q: -3, r: -1, i: 3, j: 1, k: 3, m: 7, n: 0});
});

test('数组越界、读未初始化、除零判为未定义行为；超出观察能力只停下，不冤枉成未定义行为', () => {
  const a = decl('a', 'int[3]', list('int[3]', int(1), int(2), int(3)));
  assert.deepEqual(run([declare(0, a), ret(index(a, 3))]), failed('数组越界', true));
  assert.deepEqual(run([declare(0, a), ret(index(a, un('-', int(1))))]), failed('数组越界', true));
  const x = decl('x', 'int'), b = decl('b', 'int[2]');
  assert.deepEqual(run([declare(0, x), ret(v(x))]), failed('变量尚未初始化', true));
  assert.deepEqual(run([declare(0, b), ret(index(b, 0))]), failed('变量尚未初始化', true));
  const z = decl('z', 'int', int(0));
  for (const op of ['/', '%'])
    assert.deepEqual(run([declare(0, z, decl('q', 'int', bin(op, int(1), v(z))))]), failed('除数为零', true));
  // 部分初始化补 0；未初始化数组元素在内存视图里如实标出
  const c = decl('c', 'int[3]', list('int[3]', int(5)));
  const memory = run([declare(0, c, b), ret()]).frames.at(-1).memory;
  assert.deepEqual(memory.map(cell => cell.values), [[5, 0, 0], ['未初始化', '未初始化']]);
  // 以下只是「逐步观察」能力之外，并非程序有错
  assert.deepEqual(run([declare(0, decl('big', 'int[25]'))]), failed('数组超过24个元素', false));
  assert.deepEqual(run([declare(0, decl('o', 'int', bin('+', int(2147483647), int(1))))]), failed('数值超出逐步观察范围', false));
  assert.deepEqual(run([declare(0, decl('s', 'char[3]', {kind: 'StringLiteral', value: '"hi"', type: T('char[3]')}))]), failed('此数组初始化暂不支持', false));
  assert.deepEqual(run([{kind: 'DeclStmt', inner: [{kind: 'TypedefDecl', name: 'T'}]}]), failed('此声明暂不支持', false));
  assert.deepEqual(run([{kind: 'SwitchStmt', inner: []}]), failed('当前语法暂不支持逐步观察', false));
});

test('指针：可指到尾后一位但不能解引用；越出对象、跨对象相减会停下；经指针写回目标变量', () => {
  const a = decl('a', 'int[3]', list('int[3]', int(1), int(2), int(3))), p = decl('p', 'int *', decay(a));
  const move = (op, n) => stmt(assign(declRef(p), bin(op, v(p), int(n), 'int *'), 'int *'));
  const end = run([declare(0, a, p), move('+', 3), ret()]);
  assert.equal(end.verifiedOutput, true, end.message);
  const cell = end.frames.at(-1).memory.find(c => c.name === 'p');
  assert.deepEqual(cell.pointer, {target: 'm0', index: 3, onePast: true, dangling: false});
  assert.deepEqual(cell.values, ['→ a[3]']);
  assert.deepEqual(run([declare(0, a, p), move('+', 3), ret(deref(p))]), failed('数组越界', true));
  assert.deepEqual(run([declare(0, a, p), move('+', 4), ret()]), failed('指针运算越出同一对象及其尾后范围', true));
  assert.deepEqual(run([declare(0, a, p), move('-', 1), ret()]), failed('指针运算越出同一对象及其尾后范围', true));
  // 同一数组内相减得元素个数；不同对象的指针相减直接拒绝
  const q = decl('q', 'int *', bin('+', decay(a), int(2), 'int *')), d = decl('d', 'long', bin('-', v(q), v(p), 'long'));
  assert.equal(last(run([declare(0, a, p, q, d), ret()]), 'd'), 2);
  const x = decl('x', 'int', int(1)), r = decl('r', 'int *', addr(x));
  assert.deepEqual(run([declare(0, a, p, x, r), ret(bin('-', v(r), v(p), 'long'))]), failed('不同对象的指针不能相减', false));
  // *r = 9 改的是 x 本身；标量的尾后一位同样不能解引用
  const wrote = run([declare(0, x, r), stmt(assign(un('*', v(r)), int(9))), ret()]);
  assert.equal(last(wrote, 'x'), 9);
  assert.equal(last(wrote, 'r'), '→ x[0]');
  assert.deepEqual(run([declare(0, x, r), ret(un('*', bin('+', v(r), int(1), 'int *')))]), failed('指针越界', true));
  // 空指针与未初始化指针在内存视图里分开标注
  const nil = decl('nil', 'int *', conv('NullToPointer', 'int *', int(0))), wild = decl('wild', 'int *');
  const mem = run([declare(0, nil, wild), ret()]).frames.at(-1).memory;
  assert.deepEqual(mem.map(c => c.pointer), [{target: '', null: true, uninitialized: false}, {target: '', null: false, uninitialized: true}]);
  assert.deepEqual(mem.map(c => c.values), [[0], ['未初始化']]);
});

test('块结束后局部变量失效：悬空指针在快照里标出，再解引用或做指针运算判为未定义行为', () => {
  const p = decl('p', 'int *'), x = decl('x', 'int', int(4));
  const inner = block(declare(0, x), stmt(assign(declRef(p), addr(x), 'int *')));
  const ok = run([declare(0, p), inner, ret()]);
  assert.equal(ok.verifiedOutput, true, ok.message);
  // 帧依次是：声明 p、声明 x、p = &x、内层块结束、return
  assert.equal(ok.frames.length, 5);
  const closing = ok.frames[3].memory;
  assert.equal(closing.find(c => c.name === 'x').alive, false);
  assert.deepEqual(closing.find(c => c.name === 'p').pointer, {target: 'm1', index: 0, onePast: false, dangling: true});
  assert.deepEqual(run([declare(0, p), inner, ret(deref(p))]), failed('指针引用了生命周期已经结束的对象', true));
  assert.deepEqual(run([declare(0, p), inner, stmt(assign(declRef(p), bin('+', v(p), int(0), 'int *'), 'int *')), ret()]),
    failed('指针所指对象的生命周期已经结束', true));
});

test('for / while / do-while、break / continue、三目与短路求值按 C 的顺序执行', () => {
  const s = decl('s', 'int', int(0)), i = decl('i', 'int', int(0));
  const sum = run([declare(0, s), forLoop(declare(0, i), bin('<', v(i), int(4)), un('++', declRef(i), 'int', true), compound('+=', declRef(s), v(i))),
    stmt(call('printf', str('%d\n'), v(s))), ret()], '6\n');
  assert.equal(sum.verifiedOutput, true, sum.message);
  // 声明 s、声明 i、4 轮 ×（条件、循环体、自增）、printf、return
  assert.equal(sum.frames.length, 16);
  const n = decl('n', 'int', int(0));
  const body = block(stmt(un('++', declRef(n), 'int', true)), ifStmt(bin('==', v(n), int(2)), {kind: 'ContinueStmt'}),
    ifStmt(bin('==', v(n), int(4)), {kind: 'BreakStmt'}), stmt(call('printf', str('%d'), v(n))));
  const loop = run([declare(0, n), whileLoop(bin('<', v(n), int(10)), body), ret()], '13');
  assert.equal(loop.verifiedOutput, true, loop.message);
  assert.equal(last(loop, 'n'), 4);
  // do-while 的循环体至少执行一次
  const k = decl('k', 'int', int(5));
  assert.equal(last(run([declare(0, k), {kind: 'DoStmt', inner: [block(stmt(un('--', declRef(k), 'int', true))), bin('>', v(k), int(10))]}, ret()]), 'k'), 4);
  // 短路：右侧的 10 / z 不应被求值，否则会报除零
  const z = decl('z', 'int', int(0));
  const pick = decl('pick', 'int', {kind: 'ConditionalOperator', type: T('int'),
    inner: [bin('&&', bin('!=', v(z), int(0)), bin('>', bin('/', int(10), v(z)), int(1))), int(1), int(2)]});
  const either = decl('either', 'int', bin('||', int(1), bin('/', int(10), v(z))));
  const result = run([declare(0, z, pick, either), ret()]);
  assert.equal(result.verifiedOutput, true, result.message);
  assert.deepEqual(values(result), {z: 0, pick: 2, either: 1});
});

test('死循环、过长轨迹、过多步骤和过长输出都有上限，不会卡住渲染', () => {
  assert.deepEqual(run([whileLoop(int(1), {kind: 'NullStmt'}), ret()]), failed('循环超过100次', false));
  const k = decl('k', 'int', int(0));
  assert.deepEqual(run([declare(0, k), whileLoop(int(1), stmt(un('++', declRef(k), 'int', true))), ret()]), failed('轨迹超过160步', false));
  const s = decl('s', 'int', int(0)), ones = Array.from({length: 150}, () => int(1)).reduce((left, right) => bin('+', left, right));
  assert.deepEqual(run([declare(0, s), whileLoop(int(1), stmt(assign(declRef(s), ones))), ret()]), failed('程序步骤过多', false));
  assert.deepEqual(run([whileLoop(int(1), stmt(call('puts', str('x'.repeat(1000))))), ret()]), failed('输出过长', false));
});

test('快照只保留最近 24 个内存格，编号在每一帧内从 m0 重新开始', () => {
  const decls = Array.from({length: 30}, (_, n) => decl('v' + n, 'int', int(n)));
  const {memory, variables} = run([...decls.map(d => declare(0, d)), ret()]).frames.at(-1);
  assert.equal(memory.length, 24);
  assert.equal(variables.length, 24);
  assert.deepEqual(memory.map(c => c.id), Array.from({length: 24}, (_, n) => 'm' + n));
  assert.deepEqual(memory.map(c => c.name), decls.slice(6).map(d => d.name));
});

// —— 以下是已发现的源码问题：按 C 语义写出期望，源码修复前保持 todo（不计失败）——
test('`||` 的结果应为 0 或 1（C11 6.5.14），轨迹里的变量值要与真实程序一致', {
  todo: '源码 bug：|| 直接返回左操作数的值，`int x = 2 || 0;` 轨迹显示 x=2（真实为 1），程序没打印 x 时仍判 verifiedOutput=true',
}, () => {
  const result = run([declare(0, decl('x', 'int', bin('||', int(2), int(0)))), ret()]);
  assert.equal(result.verifiedOutput, true, result.message);
  assert.equal(last(result, 'x'), 1);
});

test('printf 的 %% 应输出一个 %，并通过与真实输出的比对', {
  todo: '源码 bug：%% 先被替换成 %，随后「残留 %」检查把它当成未支持的格式，任何含 %% 的 printf 都拿不到轨迹',
}, () => {
  const result = run([stmt(call('printf', str('%d%%\n'), int(50))), ret()], '50%\n');
  assert.equal(result.verifiedOutput, true, result.message);
  assert.equal(result.frames.at(-1).stdout, '50%\n');
});

test('for 初始化子句声明的变量在循环结束后失效（C11 6.8.5p5），之后经指针读取应判为未定义行为', {
  todo: '源码 bug：for 的 init 声明被挂到外层作用域，循环结束后仍算存活，悬空指针解引用漏报',
}, () => {
  const p = decl('p', 'int *'), i = decl('i', 'int', int(0));
  const result = run([declare(0, p), forLoop(declare(0, i), bin('<', v(i), int(1)), un('++', declRef(i), 'int', true),
    stmt(assign(declRef(p), addr(i), 'int *'))), declare(0, decl('y', 'int', deref(p))), ret()]);
  assert.deepEqual(result, failed('指针引用了生命周期已经结束的对象', true));
});
