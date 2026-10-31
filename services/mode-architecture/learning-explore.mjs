// ChatGPT 式的消息内实验：公式 + 可拖变量 + 实时图。服务器只保存数据定义和参数，
// 前端按概念画图和计算；模型只挑概念、给初值，不写脚本或 HTML。
export const EXPLORE_KINDS = new Set(['concept_lab', 'logic_lab', 'timing_lab', 'sequence_lab']);
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const assert = (value, message) => { if (!value) throw new Error(message); };
const clone = value => structuredClone(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

// 连续量 {key,label,unit,min,max,step,value,log}；离散量 {key,label,options:[[值,名称]],value}；文本量 {key,label,type:'text',value,pattern}
const v = (key, label, unit, min, max, value, step = 0, log = false) => ({key, label, unit, min, max, step, value, ...(log ? {log: true} : {})});
const pick = (key, label, options, value) => ({key, label, options, value: value ?? options[0][0]});
export const CONCEPTS = {
  ohm: {title: '欧姆定律', topic: 'ee1', vars: [v('U', '电压 U', 'V', 0, 36, 12, .5), v('R', '电阻 R', 'Ω', 10, 10000, 1000, 0, true)]},
  series_divider: {title: '串联分压', topic: 'ee2', vars: [v('U', '电源 U', 'V', 0, 36, 12, .5), v('R1', '电阻 R1', 'Ω', 100, 10000, 1000, 0, true), v('R2', '电阻 R2', 'Ω', 100, 10000, 2000, 0, true)]},
  parallel_divider: {title: '并联分流', topic: 'ee2', vars: [v('U', '电源 U', 'V', 0, 36, 12, .5), v('R1', '电阻 R1', 'Ω', 100, 10000, 1000, 0, true), v('R2', '电阻 R2', 'Ω', 100, 10000, 2000, 0, true)]},
  rc_transient: {title: 'RC 电路暂态', topic: 'ee4', vars: [pick('mode', '过程', [['charge', '充电'], ['discharge', '放电']]), v('U', '电源 U', 'V', 1, 24, 10, .5), v('R', '电阻 R', 'kΩ', 1, 100, 10, 0, true), v('C', '电容 C', 'μF', 1, 1000, 100, 0, true), v('k', '观察时刻 t / τ', '', 0, 5, 1, .05)]},
  rl_transient: {title: 'RL 电路暂态', topic: 'ee4', vars: [pick('mode', '过程', [['charge', '接通'], ['discharge', '断开']]), v('U', '电源 U', 'V', 1, 24, 10, .5), v('R', '电阻 R', 'Ω', 10, 1000, 100, 0, true), v('L', '电感 L', 'mH', 10, 1000, 100, 0, true), v('k', '观察时刻 t / τ', '', 0, 5, 1, .05)]},
  sine_ac: {title: '正弦量三要素与相位差', topic: 'ee3', vars: [v('Um', '电压幅值 Um', 'V', 1, 400, 311, 1), v('Im', '电流幅值 Im', 'A', .5, 10, 5, .1), v('f', '频率 f', 'Hz', 10, 200, 50, 1), v('pu', '电压初相 ψu', '°', -180, 180, 30, 5), v('pi', '电流初相 ψi', '°', -180, 180, -30, 5)]},
  rlc_series: {title: 'RLC 串联与谐振', topic: 'ee3', vars: [v('U', '电压有效值 U', 'V', 1, 220, 10, 1), v('R', '电阻 R', 'Ω', 1, 1000, 100, 0, true), v('L', '电感 L', 'mH', 1, 1000, 100, 0, true), v('C', '电容 C', 'μF', .1, 100, 10, 0, true), v('f', '频率 f', 'Hz', 10, 2000, 100, 0, true)]},
  rectifier: {title: '整流与滤波', topic: 'ee5', vars: [pick('type', '整流方式', [['bridge', '桥式全波'], ['half', '半波']]), pick('filter', '滤波', [['none', '无电容'], ['cap', '电容滤波']]), v('U2', '变压器副边 U2', 'V', 1, 50, 10, .5)]},
  bjt_bias: {title: '共射放大电路静态工作点', topic: 'ee6', vars: [v('Vcc', '电源 VCC', 'V', 5, 24, 12, .5), v('Rb', '基极电阻 RB', 'kΩ', 20, 1000, 300, 0, true), v('Rc', '集电极电阻 RC', 'kΩ', .5, 10, 3, 0, true), v('beta', '放大倍数 β', '', 20, 200, 50, 1)]},
  opamp: {title: '比例运算放大器', topic: 'ee7', vars: [pick('mode', '接法', [['inverting', '反相比例'], ['noninverting', '同相比例']]), v('R1', '输入电阻 R1', 'kΩ', 1, 100, 10, 0, true), v('Rf', '反馈电阻 Rf', 'kΩ', 1, 500, 100, 0, true), v('ui', '输入 ui', 'V', -5, 5, .5, .05), v('Vsat', '饱和电压 ±UOM', 'V', 5, 15, 12, .5)]},
  limit: {title: '两个重要极限', topic: 'm1', vars: [pick('fn', '极限', [['sinx', 'sin x / x，x→0'], ['e', '(1 + 1/n)ⁿ，n→∞'], ['cos', '(1 − cos x) / x²，x→0'], ['exp', '(eˣ − 1) / x，x→0']]), v('d', '靠近程度', '', 0, 4, 1, .05)]},
  derivative: {title: '导数与切线', topic: 'm2', vars: [pick('fn', '函数', [['x2', 'x²'], ['x3', 'x³ − 3x'], ['sin', 'sin x'], ['exp', 'eˣ'], ['ln', 'ln x']]), v('x0', '切点 x₀', '', -3, 3, 1, .05), v('h', '割线间距 Δx', '', 0, 2, 1, .01)]},
  integral: {title: '定积分与黎曼和', topic: 'm4', vars: [pick('fn', '函数', [['x2', 'x²'], ['line', '2x + 1'], ['sin', 'sin x'], ['exp', 'eˣ'], ['x3', 'x³ − 3x']]), v('a', '下限 a', '', -3, 3, 0, .1), v('b', '上限 b', '', -3, 3, 2, .1), v('n', '分割数 n', '', 1, 60, 6, 1), pick('method', '取点', [['mid', '中点'], ['left', '左端点'], ['right', '右端点']])]},
  ode: {title: '一阶微分方程 y′ = ky', topic: 'm5', vars: [v('k', '系数 k', '', -1.5, 1.5, .5, .05), v('y0', '初值 y(0)', '', -3, 3, 1, .1)]},
  subnet: {title: '子网划分（二进制）', topic: 'net4', vars: [{key: 'ip', label: '主机 IP', type: 'text', value: '192.168.10.34'}, v('prefix', '前缀长度 /n', '', 8, 30, 27, 1)]},
};
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

// 带单位的写法（"2kΩ"、"100μF"、"50 mH"、"1.5k"）换算成这个变量自己的单位；纯数字按变量单位理解。
const PREFIX = {G: 1e9, M: 1e6, k: 1e3, K: 1e3, '': 1, m: 1e-3, u: 1e-6, 'μ': 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12};
const UNIT_FACTOR = {'kΩ': 1e3, 'μF': 1e-6, 'mH': 1e-3};
function quantity(spec, raw) {
  if (typeof raw !== 'string') return raw;
  const match = raw.normalize('NFKC').replace(/[−–]/g, '-').trim().match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([GMkKmuμµnp]?)\s*(Ω|ohm|欧|V|A|F|H|Hz|s|°)?$/i);
  if (!match) return NaN;
  const [, value, prefix, unit] = match, base = Number(value) * (PREFIX[prefix] ?? 1);
  if (!prefix && !unit) return Number(value);
  return base / (UNIT_FACTOR[spec.unit] || 1);
}
function conceptValue(spec, raw) {
  if (spec.options) { assert(spec.options.some(([value]) => value === raw), `${spec.label}不支持这个选项`); return raw; }
  if (spec.type === 'text') { const value = text(raw, 40); assert(IPV4.test(value), `${spec.label}需要是有效的 IPv4 地址`); return value; }
  raw = quantity(spec, raw);
  assert(typeof raw === 'number' && Number.isFinite(raw) && raw >= spec.min && raw <= spec.max, `${spec.label}需要在 ${spec.min}–${spec.max}${spec.unit ? ' ' + spec.unit : ''} 之间；可以直接写带单位的字符串，例如 "2kΩ"、"100μF"`);
  if (spec.step) return Number((spec.min + Math.round((raw - spec.min) / spec.step) * spec.step).toPrecision(12));
  return Number(raw.toPrecision(4));
}

// ---------- 逻辑函数：解析、真值表、最简与或式 ----------
export function parseLogic(source) {
  const input = text(source, 200).replace(/[＋]/g, '+').replace(/[·•∙×*&∧]/g, '&').replace(/[|∨]/g, '+').replace(/[⊕^]/g, '^').replace(/[¬~！]/g, '!').replace(/[’′]/g, "'");
  assert(input, '请给出逻辑表达式');
  let index = 0;
  const unknown = () => `表达式第 ${index + 1} 个字符「${input[index] ?? '结尾'}」无法识别；变量用 A–H，与用 · 或 *，或用 +，非用 ! 或 '，异或用 ⊕`;
  const peek = () => { while (input[index] === ' ') index++; return input[index]; };
  const variables = new Set();
  const primary = () => {
    const c = peek();
    let node;
    if (c === '!') { index++; return {op: 'not', args: [primary()]}; }
    if (c === '(') { index++; node = or(); assert(peek() === ')', '括号不配对'); index++; }
    else if (/[A-H]/.test(c || '')) { index++; variables.add(c); node = {op: 'var', name: c}; }
    else if (c === '0' || c === '1') { index++; node = {op: 'const', value: Number(c)}; }
    else throw new Error(unknown());
    while (peek() === "'") { index++; node = {op: 'not', args: [node]}; }
    return node;
  };
  const and = () => {
    const args = [primary()];
    for (;;) {
      const c = peek();
      if (c === '&') { index++; args.push(primary()); }
      else if (c && /[A-H01(!]/.test(c)) args.push(primary());
      else break;
    }
    return args.length === 1 ? args[0] : {op: 'and', args};
  };
  const xor = () => { const args = [and()]; while (peek() === '^') { index++; args.push(and()); } return args.length === 1 ? args[0] : {op: 'xor', args}; };
  const or = () => { const args = [xor()]; while (peek() === '+') { index++; args.push(xor()); } return args.length === 1 ? args[0] : {op: 'or', args}; };
  const tree = or();
  assert(peek() === undefined, peek() === ')' ? '括号不配对' : unknown());
  const names = [...variables].sort();
  assert(names.length >= 1 && names.length <= 4, '逻辑实验支持 1–4 个变量');
  let gates = 0; const count = node => { if (node.args) { gates++; node.args.forEach(count); } }; count(tree);
  assert(gates <= 24, '表达式太长，请拆成小一点的函数');
  return {tree, variables: names};
}
export function evalLogic(node, env) {
  switch (node.op) {
    case 'var': return env[node.name] ? 1 : 0;
    case 'const': return node.value;
    case 'not': return evalLogic(node.args[0], env) ? 0 : 1;
    case 'and': return node.args.every(arg => evalLogic(arg, env)) ? 1 : 0;
    case 'or': return node.args.some(arg => evalLogic(arg, env)) ? 1 : 0;
    default: return node.args.reduce((acc, arg) => acc ^ evalLogic(arg, env), 0);
  }
}
export function minimizeSop(variables, outputs) {
  const n = variables.length, on = outputs.flatMap((out, m) => out ? [m] : []);
  if (!on.length) return [];
  if (on.length === outputs.length) return [[]];
  // 用 0/1/- 表示乘积项；4 个变量以内直接枚举全部 3ⁿ 个项。
  const cubes = [];
  for (let code = 0; code < 3 ** n; code++) {
    const cube = []; let c = code;
    for (let i = 0; i < n; i++) { cube.push(c % 3); c = Math.floor(c / 3); }
    const covers = outputs.map((_, m) => cube.every((digit, i) => digit === 2 || digit === ((m >> (n - 1 - i)) & 1))).flatMap((hit, m) => hit ? [m] : []);
    if (covers.every(m => outputs[m])) cubes.push({cube, covers});
  }
  const primes = cubes.filter(a => !cubes.some(b => b !== a && b.covers.length > a.covers.length && a.covers.every(m => b.covers.includes(m))));
  let best = null;
  for (let mask = 1; mask < 1 << primes.length; mask++) {
    const chosen = primes.filter((_, i) => mask >> i & 1);
    if (!on.every(m => chosen.some(p => p.covers.includes(m)))) continue;
    const literals = chosen.reduce((sum, p) => sum + p.cube.filter(d => d !== 2).length, 0);
    if (!best || chosen.length < best.length || chosen.length === best.length && literals < best.literals) best = Object.assign(chosen, {literals});
  }
  return best.map(p => p.cube.flatMap((digit, i) => digit === 2 ? [] : [{v: variables[i], neg: digit === 0}]));
}

// ---------- 协议时序：模板只放数据，{x}/{y} 由前端按初始序号代入 ----------
export const SEQUENCES = {
  tcp_handshake: {title: 'TCP 三次握手', topic: 'net5', actors: ['客户端', '服务器'], start: ['CLOSED', 'LISTEN'], seeds: {x: 100, y: 300}, messages: [
    {from: 0, to: 1, label: 'SYN=1, seq={x}', detail: '客户端请求建立连接，选初始序号 x。SYN 报文不携带数据，但要消耗一个序号。', states: ['SYN-SENT', 'LISTEN']},
    {from: 1, to: 0, label: 'SYN=1, ACK=1, seq={y}, ack={x+1}', detail: '服务器同意连接，选自己的初始序号 y，并确认收到 x（期望下一个是 x+1）。', states: ['SYN-SENT', 'SYN-RCVD']},
    {from: 0, to: 1, label: 'ACK=1, seq={x+1}, ack={y+1}', detail: '客户端确认服务器的 SYN。第三次握手可以携带数据；不携带数据则不消耗序号。', states: ['ESTABLISHED', 'ESTABLISHED']},
  ], why: '为什么不是两次：防止已失效的旧连接请求突然又传到服务器，让服务器白白建立连接、空等资源。'},
  tcp_close: {title: 'TCP 四次挥手', topic: 'net5', actors: ['客户端', '服务器'], start: ['ESTABLISHED', 'ESTABLISHED'], seeds: {x: 500, y: 800}, messages: [
    {from: 0, to: 1, label: 'FIN=1, seq={x}', detail: '客户端没有数据要发了，请求关闭自己这个方向。', states: ['FIN-WAIT-1', 'ESTABLISHED']},
    {from: 1, to: 0, label: 'ACK=1, seq={y}, ack={x+1}', detail: '服务器确认。此后连接处于半关闭：服务器还能继续给客户端发数据。', states: ['FIN-WAIT-2', 'CLOSE-WAIT']},
    {from: 1, to: 0, label: 'FIN=1, ACK=1, seq={y+1}, ack={x+1}', detail: '服务器的数据也发完了，请求关闭另一个方向。', states: ['FIN-WAIT-2', 'LAST-ACK']},
    {from: 0, to: 1, label: 'ACK=1, seq={x+1}, ack={y+2}', detail: '客户端确认后进入 TIME-WAIT，等 2MSL 才真正关闭；服务器收到后立即 CLOSED。', states: ['TIME-WAIT', 'CLOSED']},
  ], why: '为什么要等 2MSL：保证最后一个 ACK 丢了还能重传，并让本连接的旧报文在网络中消失。'},
  dns_query: {title: 'DNS 解析过程', topic: 'net6', actors: ['主机', '本地域名服务器', '根域名服务器', '顶级域名服务器', '权限域名服务器'], start: ['', '', '', '', ''], seeds: {}, messages: [
    {from: 0, to: 1, label: '查询 www.gxu.edu.cn（递归）', detail: '主机向本地域名服务器发递归查询：要么给最终答案，要么报错。'},
    {from: 1, to: 2, label: '查询 www.gxu.edu.cn', detail: '本地域名服务器缓存里没有，开始迭代查询：先问根域名服务器。'},
    {from: 2, to: 1, label: '去问 .cn 顶级域名服务器', detail: '根服务器不直接给答案，只告诉下一步去问谁。'},
    {from: 1, to: 3, label: '查询 www.gxu.edu.cn', detail: '本地域名服务器继续问顶级域名服务器。'},
    {from: 3, to: 1, label: '去问 gxu.edu.cn 的权限服务器', detail: '顶级域名服务器给出下一级权限域名服务器的地址。'},
    {from: 1, to: 4, label: '查询 www.gxu.edu.cn', detail: '问到负责这个域名的权限域名服务器。'},
    {from: 4, to: 1, label: 'A 记录：IP 地址', detail: '权限域名服务器给出 IP 地址。'},
    {from: 1, to: 0, label: '返回 IP 地址（并缓存）', detail: '本地域名服务器把结果交给主机，同时缓存，下次直接回答。'},
  ], why: '主机到本地域名服务器一般是递归查询；本地域名服务器向根、顶级、权限服务器一般是迭代查询。'},
  http_request: {title: '浏览器访问网页的过程', topic: 'net6', actors: ['浏览器', 'DNS', 'Web 服务器'], start: ['', '', ''], seeds: {}, messages: [
    {from: 0, to: 1, label: '解析域名', detail: '应用层 DNS（UDP 53 端口）把域名解析成 IP 地址。'},
    {from: 1, to: 0, label: '返回 IP 地址', detail: '拿到服务器 IP。'},
    {from: 0, to: 2, label: 'TCP 三次握手（80/443）', detail: '传输层建立 TCP 连接。'},
    {from: 0, to: 2, label: 'HTTP 请求 GET /index.html', detail: '应用层发送 HTTP 请求报文：请求行、首部行、实体。'},
    {from: 2, to: 0, label: 'HTTP 响应 200 OK + 页面', detail: '服务器返回状态行和页面内容。'},
    {from: 0, to: 2, label: '释放 TCP 连接', detail: '四次挥手（HTTP/1.1 默认可持续连接，可复用后再释放）。'},
  ], why: '这一个过程串起了 DNS（应用层）、TCP（传输层）、IP（网络层）的分工。'},
};

function normalizeSequence(payload, spec) {
  if (spec.template) {
    const template = SEQUENCES[spec.template];
    assert(template, 'sequence_lab 模板支持 tcp_handshake、tcp_close、dns_query、http_request');
    return {kind: 'sequence_lab', title: text(payload.topic || template.title, 160), definition: {template: spec.template, ...clone(template)}};
  }
  const actors = Array.isArray(spec.actors) ? spec.actors.map(a => text(a, 30)).filter(Boolean) : [];
  assert(actors.length >= 2 && actors.length <= 5, '时序图需要 2–5 个参与方');
  assert(Array.isArray(spec.messages) && spec.messages.length >= 1 && spec.messages.length <= 14, '时序图需要 1–14 条消息');
  const messages = spec.messages.map(raw => {
    assert(plain(raw), '消息格式不正确');
    const from = actors.indexOf(text(raw.from, 30)), to = actors.indexOf(text(raw.to, 30));
    assert(from >= 0 && to >= 0 && from !== to, '消息的 from/to 需要是不同的参与方名称');
    return {from, to, label: text(raw.label, 80), detail: text(raw.detail, 600)};
  });
  assert(messages.every(m => m.label), '每条消息需要 label');
  return {kind: 'sequence_lab', title: text(payload.topic || '时序图', 160), definition: {actors, start: actors.map(() => ''), seeds: {}, messages, why: text(spec.why, 400)}};
}

const TIMING_INPUTS = {d: ['D'], jk: ['J', 'K'], t: ['T'], rs: ['S', 'R'], counter: []};
const TIMING_NAMES = {d: 'D 触发器', jk: 'JK 触发器', t: 'T 触发器', rs: '同步 RS 触发器', counter: '二进制计数器'};

export function normalizeExplore(payload) {
  const spec = payload.visual;
  assert(plain(spec), '请提供 visual 交互定义');
  if (payload.kind === 'concept_lab') {
    const concept = CONCEPTS[spec.concept];
    assert(concept, `concept_lab 的 concept 支持：${Object.keys(CONCEPTS).join('、')}`);
    const values = plain(spec.values) ? spec.values : {};
    assert(Object.keys(values).every(key => concept.vars.some(entry => entry.key === key)), '实验变量名称不正确');
    const vars = concept.vars.map(entry => ({...clone(entry), value: values[entry.key] === undefined ? entry.value : conceptValue(entry, values[entry.key])}));
    return {kind: 'concept_lab', title: text(payload.topic || concept.title, 160), definition: {concept: spec.concept, topic: concept.topic, vars}};
  }
  if (payload.kind === 'logic_lab') {
    const {tree, variables} = parseLogic(spec.expression);
    const outputs = Array.from({length: 1 << variables.length}, (_, m) => evalLogic(tree, Object.fromEntries(variables.map((name, i) => [name, (m >> (variables.length - 1 - i)) & 1]))));
    return {kind: 'logic_lab', title: text(payload.topic || '逻辑函数实验', 160), definition: {expression: text(spec.expression, 200), tree, variables, outputs, sop: minimizeSop(variables, outputs)}};
  }
  if (payload.kind === 'timing_lab') {
    const device = String(spec.device || 'd');
    assert(TIMING_INPUTS[device], 'timing_lab 的 device 支持 d、jk、t、rs、counter');
    const clocks = spec.clocks ?? 8; assert(Number.isInteger(clocks) && clocks >= 4 && clocks <= 12, '时钟个数需要 4–12');
    const edge = spec.edge === 'falling' ? 'falling' : 'rising';
    const bits = device === 'counter' ? spec.bits ?? 3 : 1; assert(Number.isInteger(bits) && bits >= 2 || device !== 'counter', '计数器位数需要 2–4'); assert(bits <= 4, '计数器位数需要 2–4');
    const direction = spec.direction === 'down' ? 'down' : 'up';
    const inputs = {};
    for (const name of TIMING_INPUTS[device]) {
      const raw = spec.inputs?.[name] ?? Array.from({length: clocks}, (_, i) => name === 'K' || name === 'R' ? (i % 3 === 2 ? 1 : 0) : (i % 2 === 0 ? 1 : 0));
      assert(Array.isArray(raw) && raw.length === clocks && raw.every(bit => bit === 0 || bit === 1), `${name} 需要 ${clocks} 个 0/1`);
      inputs[name] = raw;
    }
    return {kind: 'timing_lab', title: text(payload.topic || TIMING_NAMES[device] + '时序', 160), definition: {device, name: TIMING_NAMES[device], clocks, edge, bits, direction, inputNames: TIMING_INPUTS[device], inputs, q0: spec.q0 === 1 ? 1 : 0}};
  }
  return normalizeSequence(payload, spec);
}

export function createExploreState(normalized, previous) {
  const old = previous?.state, d = normalized.definition;
  if (normalized.kind === 'concept_lab') {
    const keep = previous?.definition?.concept === d.concept && old?.values;
    return {values: Object.fromEntries(d.vars.map(entry => [entry.key, keep && keep[entry.key] !== undefined ? keep[entry.key] : entry.value]))};
  }
  if (normalized.kind === 'logic_lab') return {inputs: Object.fromEntries(d.variables.map(name => [name, old?.inputs?.[name] ?? 0])), view: old?.view || (d.variables.length >= 4 ? 'kmap' : 'table')};
  if (normalized.kind === 'timing_lab') return {inputs: clone(d.inputs), q0: d.q0, cursor: 0};
  return {step: 0, seeds: clone(d.seeds)};
}

export function saveExploreState(record, patch) {
  assert(plain(patch), '交互状态格式不正确');
  const next = clone(record.state), d = record.definition;
  if (record.kind === 'concept_lab') {
    assert(Object.keys(patch).every(key => key === 'values') && plain(patch.values), '实验状态包含未知字段');
    for (const [key, raw] of Object.entries(patch.values)) {
      const entry = d.vars.find(item => item.key === key); assert(entry, '实验变量名称不正确');
      next.values[key] = conceptValue(entry, raw);
    }
    return next;
  }
  if (record.kind === 'logic_lab') {
    assert(Object.keys(patch).every(key => ['inputs', 'view'].includes(key)), '逻辑实验状态包含未知字段');
    if (patch.inputs !== undefined) {
      assert(plain(patch.inputs), '输入格式不正确');
      for (const [name, bit] of Object.entries(patch.inputs)) { assert(d.variables.includes(name) && (bit === 0 || bit === 1), '输入需要是已有变量的 0/1'); next.inputs[name] = bit; }
    }
    if (patch.view !== undefined) { assert(['table', 'kmap', 'gates'].includes(patch.view), '视图不正确'); next.view = patch.view; }
    return next;
  }
  if (record.kind === 'timing_lab') {
    assert(Object.keys(patch).every(key => ['inputs', 'q0', 'cursor'].includes(key)), '时序实验状态包含未知字段');
    if (patch.inputs !== undefined) {
      assert(plain(patch.inputs), '输入格式不正确');
      for (const [name, bits] of Object.entries(patch.inputs)) {
        assert(d.inputNames.includes(name) && Array.isArray(bits) && bits.length === d.clocks && bits.every(bit => bit === 0 || bit === 1), `${name} 需要 ${d.clocks} 个 0/1`);
        next.inputs[name] = bits;
      }
    }
    if (patch.q0 !== undefined) { assert(patch.q0 === 0 || patch.q0 === 1, '初态需要是 0 或 1'); next.q0 = patch.q0; }
    if (patch.cursor !== undefined) { assert(Number.isInteger(patch.cursor) && patch.cursor >= 0 && patch.cursor < d.clocks, '时钟位置不正确'); next.cursor = patch.cursor; }
    return next;
  }
  assert(Object.keys(patch).every(key => ['step', 'seeds'].includes(key)), '时序图状态包含未知字段');
  if (patch.step !== undefined) { assert(Number.isInteger(patch.step) && patch.step >= 0 && patch.step <= d.messages.length, '步骤不正确'); next.step = patch.step; }
  if (patch.seeds !== undefined) {
    assert(plain(patch.seeds), '序号格式不正确');
    for (const [name, value] of Object.entries(patch.seeds)) { assert(name in d.seeds && Number.isInteger(value) && value >= 0 && value <= 4294967295, '初始序号需要是 0–2³²−1 的整数'); next.seeds[name] = value; }
  }
  return next;
}

export function timingWave(definition, state) {
  const {device, clocks, bits, direction} = definition;
  if (device === 'counter') {
    const size = 1 << bits;
    return Array.from({length: clocks + 1}, (_, i) => direction === 'up' ? i % size : (size - i % size) % size);
  }
  const q = [state.q0];
  for (let i = 0; i < clocks; i++) {
    const prev = q[i], input = name => state.inputs[name][i];
    let next = prev;
    if (device === 'd') next = input('D');
    else if (device === 't') next = input('T') ? 1 - prev : prev;
    else if (device === 'jk') next = input('J') && input('K') ? 1 - prev : input('J') ? 1 : input('K') ? 0 : prev;
    else next = input('S') && input('R') ? prev : input('S') ? 1 : input('R') ? 0 : prev;
    q.push(next);
  }
  return q;
}

export function exploreContext(record) {
  const {kind, definition: d, state} = record;
  if (kind === 'concept_lab') return {concept: d.concept, values: state.values};
  if (kind === 'logic_lab') return {expression: d.expression, inputs: state.inputs, output: evalLogic(d.tree, state.inputs), view: state.view};
  if (kind === 'timing_lab') return {device: d.device, edge: d.edge, inputs: state.inputs, q: timingWave(d, state)};
  return {template: d.template || 'custom', step: state.step, of: d.messages.length, seeds: state.seeds};
}
