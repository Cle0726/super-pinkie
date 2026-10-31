// 由 06_互动学习台/build.py --repo 从 src/gen.js 生成，勿手改。
export function loadGenerators(vocab) {
  const window = {VOCAB: vocab};
// 题目生成器：每次随机出新题，答案由程序计算，保证正确。
// make(r) 中 r 是 [0,1) 随机函数（模考打印时用固定种子）。
(function () {
  const G = (window.GENS = []);
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const shuffle = (r, a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
  const frac = (p, q) => { if (q < 0) { p = -p; q = -q; } const g = gcd(p, q) || 1; p /= g; q /= g; return q === 1 ? String(p) : p + '/' + q; };
  const r2 = (x) => String(Math.round(x * 100) / 100);
  // 四选一：正确答案 + 干扰项，去重后打乱
  function choice(r, correct, wrongs) {
    const seen = new Set([String(correct)]);
    const ds = [];
    for (const w of wrongs) { const s = String(w); if (!seen.has(s)) { seen.add(s); ds.push(s); } if (ds.length === 3) break; }
    const o = shuffle(r, [String(correct), ...ds]);
    return { o, a: 'ABCD'[o.indexOf(String(correct))] };
  }
  const add = (k, name, make) => G.push({ k, name, make });

  /* ── 计算机网络：IP 与子网 ── */
  const ip2s = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
  const mask = (p) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
  window.IPUTIL = { ip2s, mask, s2ip: (s) => s.split('.').reduce((a, b) => ((a << 8) + (+b)) >>> 0, 0) };
  const randIp = (r) => ((int(r, 1, 223) << 24) | (int(r, 0, 255) << 16) | (int(r, 0, 255) << 8) | int(r, 1, 254)) >>> 0;
  add('net4', '子网：求网络地址', (r) => {
    const ip = randIp(r), p = int(r, 18, 29), net = (ip & mask(p)) >>> 0;
    return { t: 'fill', q: `主机 IP 地址为 ${ip2s(ip)}/${p}，其所在子网的网络地址为 ____。`, a: [ip2s(net)], x: `掩码 ${ip2s(mask(p))}。IP 与掩码逐位“与”，主机位全部置 0 → ${ip2s(net)}。` };
  });
  add('net4', '子网：求广播地址', (r) => {
    const ip = randIp(r), p = int(r, 18, 29), bc = ((ip & mask(p)) | (~mask(p) >>> 0)) >>> 0;
    return { t: 'fill', q: `主机 IP 地址为 ${ip2s(ip)}，子网掩码 ${ip2s(mask(p))}，该子网的广播地址为 ____。`, a: [ip2s(bc)], x: `前缀 /${p}，主机位 ${32 - p} 位全部置 1 → ${ip2s(bc)}。` };
  });
  add('net4', '子网：可用主机数', (r) => {
    const p = int(r, 20, 30), h = 2 ** (32 - p) - 2;
    const c = choice(r, h, [h + 2, h / 2 - 1, h * 2, 2 ** (32 - p), h - 2, h + 1, h - 1]);
    return { t: 'single', q: `子网掩码 ${ip2s(mask(p))} 的每个子网可用主机地址数为`, o: c.o, a: c.a, x: `主机位 32 − ${p} = ${32 - p}，可用 2^${32 - p} − 2 = ${h}（去掉网络地址和广播地址）。` };
  });
  add('net4', '子网：前缀转掩码', (r) => {
    const p = int(r, 8, 30);
    return { t: 'fill', q: `前缀 /${p} 对应的点分十进制子网掩码为 ____。`, a: [ip2s(mask(p))], x: `前 ${p} 位为 1。记住 128、192、224、240、248、252、254、255。` };
  });
  add('net4', 'IP 地址分类', (r) => {
    const cls = pick(r, ['A', 'B', 'C', 'D']);
    const f = { A: int(r, 1, 126), B: int(r, 128, 191), C: int(r, 192, 223), D: int(r, 224, 239) }[cls];
    const c = choice(r, cls + ' 类', ['A 类', 'B 类', 'C 类', 'D 类']);
    return { t: 'single', q: `IP 地址 ${f}.${int(r, 0, 255)}.${int(r, 0, 255)}.${int(r, 1, 254)} 属于`, o: c.o, a: c.a, x: '首字节：A 1–126，B 128–191，C 192–223，D 224–239（组播），E 240–255。127 为回环。' };
  });
  add('net4', '子网：等分 C 类网络', (r) => {
    const k = int(r, 1, 5), N = 2 ** k, p = 24 + k, base = `192.168.${int(r, 1, 254)}`;
    return { t: 'fill', q: `将 C 类网络 ${base}.0/24 等分成 ${N} 个子网，子网掩码应为 ____。`, a: [ip2s(mask(p))], x: `${N} = 2^${k}，借 ${k} 位主机位 → /${p}，每个子网 ${2 ** (8 - k)} 个地址、可用 ${2 ** (8 - k) - 2} 台。` };
  });
  const PORTS = [['HTTP', 80], ['HTTPS', 443], ['FTP（控制连接）', 21], ['FTP（数据连接）', 20], ['SMTP', 25], ['POP3', 110], ['DNS', 53], ['Telnet', 23], ['SSH', 22], ['DHCP 服务器', 67], ['IMAP', 143], ['SNMP', 161]];
  add('net6', '常用端口号', (r) => {
    const [n, p] = pick(r, PORTS);
    const c = choice(r, p, shuffle(r, PORTS.map((x) => x[1]).filter((x) => x !== p)));
    return { t: 'single', q: `${n} 默认使用的端口号是`, o: c.o, a: c.a, x: PORTS.map((x) => x[0] + ' ' + x[1]).join('，') + '。' };
  });

  /* ── 电工电子 ── */
  const RS = [2, 3, 4, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60];
  add('ee2', '电阻串并联', (r) => {
    const a = pick(r, RS), b = pick(r, RS), c = pick(r, RS);
    const par = (a * b) / (a + b), tot = par + c;
    return { t: 'fill', q: `R1 = ${a} Ω 与 R2 = ${b} Ω 并联后，再与 R3 = ${c} Ω 串联，总电阻为 ____ Ω（保留两位小数）。`, a: [r2(tot)], x: `R1∥R2 = ${a}×${b}/(${a}+${b}) = ${r2(par)} Ω，再加 ${c} Ω = ${r2(tot)} Ω。` };
  });
  add('ee2', '串联分压', (r) => {
    const E = pick(r, [6, 9, 10, 12, 15, 18, 24]), a = pick(r, RS), b = pick(r, RS);
    return { t: 'fill', q: `电源电压 ${E} V，R1 = ${a} Ω 与 R2 = ${b} Ω 串联，R2 两端电压为 ____ V（保留两位小数）。`, a: [r2((E * b) / (a + b))], x: `U2 = E × R2/(R1 + R2) = ${E} × ${b}/${a + b} = ${r2((E * b) / (a + b))} V。` };
  });
  add('ee7', '运放放大倍数', (r) => {
    const R1 = pick(r, [1, 2, 5, 10, 20]), m = int(r, 2, 10), Rf = R1 * m, inv = r() < 0.5, ui = pick(r, [0.1, 0.2, 0.5, 1]);
    const Au = inv ? -m : m + 1, uo = Math.round(Au * ui * 100) / 100;
    if (r() < 0.5) {
      const c = choice(r, Au, [-Au, inv ? -(m + 1) : m, inv ? m + 1 : -m, Au * 2]);
      return { t: 'single', q: `${inv ? '反相' : '同相'}比例运算电路中 R1 = ${R1} kΩ，Rf = ${Rf} kΩ，其电压放大倍数 Au 为`, o: c.o, a: c.a, x: `${inv ? '反相 Au = −Rf/R1' : '同相 Au = 1 + Rf/R1'} = ${Au}。` };
    }
    return { t: 'fill', q: `${inv ? '反相' : '同相'}比例运算电路中 R1 = ${R1} kΩ，Rf = ${Rf} kΩ，输入 ui = ${ui} V，输出 uo = ____ V。`, a: [String(uo)], x: `Au = ${Au}，uo = Au × ui = ${uo} V。` };
  });
  add('ee6', '三极管工作状态', (r) => {
    const npn = r() < 0.6, st = pick(r, ['放大', '饱和', '截止']);
    let e, b, c;
    if (npn) {
      e = int(r, 0, 30) / 10; b = st === '截止' ? e + int(r, -5, 2) / 10 : e + 0.7; c = st === '放大' ? b + int(r, 15, 80) / 10 : st === '饱和' ? e + 0.3 : int(r, 50, 120) / 10;
    } else {
      e = int(r, 60, 120) / 10; b = st === '截止' ? e + int(r, -2, 5) / 10 : e - 0.7; c = st === '放大' ? b - int(r, 15, 50) / 10 : st === '饱和' ? e - 0.3 : int(r, 0, 10) / 10;
    }
    const f = (v) => (Math.round(v * 10) / 10).toFixed(1);
    const c4 = { o: ['放大', '饱和', '截止', '不确定'], a: 'ABC'['放大饱和截止'.indexOf(st) / 2] };
    return { t: 'single', q: `测得某 ${npn ? 'NPN' : 'PNP'} 型硅三极管三个电极电位：发射极 ${f(e)} V，基极 ${f(b)} V，集电极 ${f(c)} V，该管工作在`, o: c4.o, a: c4.a, x: `${npn ? 'NPN' : 'PNP'}：UBE = ${f(b - e)} V，UBC = ${f(b - c)} V。${npn ? '发射结正偏需 UBE ≈ 0.7 V；集电结反偏需 UBC < 0。' : 'PNP 方向相反：发射结正偏需 UBE ≈ −0.7 V；集电结反偏需 UBC > 0。'}发正集反 → 放大；双正偏 → 饱和；发射结不导通 → 截止。本题为“${st}”。` };
  });
  add('ee4', '时间常数', (r) => {
    if (r() < 0.6) {
      const R = pick(r, [1, 2, 5, 10, 20, 47, 100]), C = pick(r, [1, 2, 10, 22, 47, 100]);
      return { t: 'fill', q: `RC 电路中 R = ${R} kΩ，C = ${C} μF，时间常数 τ = ____ ms。`, a: [String(R * C)], x: `τ = RC，kΩ × μF = ms：${R} × ${C} = ${R * C} ms。` };
    }
    const L = pick(r, [0.1, 0.2, 0.5, 1, 2]), R = pick(r, [10, 20, 50, 100, 200]);
    return { t: 'fill', q: `RL 电路中 L = ${L} H，R = ${R} Ω，时间常数 τ = ____ ms。`, a: [r2((L / R) * 1000)], x: `τ = L/R = ${L}/${R} s = ${r2((L / R) * 1000)} ms。` };
  });
  add('ee3', '正弦量三要素', (r) => {
    const [Um, U] = pick(r, [[311, 220], [141, 100], [14.1, 10], [537, 380], [28.2, 20]]);
    const [w, f] = pick(r, [[314, 50], [628, 100], [100 * Math.PI, 50]]);
    const phi = pick(r, [0, 30, 45, 60, 90, -30, -45, -60, -90, 120]);
    const ws = w === 100 * Math.PI ? '100π' : String(w);
    const expr = `u = ${Um}sin(${ws}t ${phi < 0 ? '−' : '+'} ${Math.abs(phi)}°) V`;
    const ask = int(r, 0, 2);
    if (ask === 0) return { t: 'fill', q: `已知 ${expr}，其有效值为 ____ V。`, a: [String(U)], x: `U = Um/√2 = ${Um}/1.414 ≈ ${U} V。` };
    if (ask === 1) return { t: 'fill', q: `已知 ${expr}，其频率为 ____ Hz。`, a: [String(f)], x: `f = ω/2π = ${ws}/2π = ${f} Hz。` };
    return { t: 'fill', q: `已知 ${expr}，其初相位为 ____°。`, a: [String(phi)], x: `sin 括号里 t = 0 时的角度即初相：${phi}°。` };
  });
  add('ee8', '进制转换', (r) => {
    const n = int(r, 5, 255);
    if (r() < 0.5) return { t: 'fill', q: `十进制数 ${n} 转换为二进制数是 ____。`, a: [n.toString(2)], x: `除 2 取余倒排，或拆成 2 的幂之和：${n} = ${n.toString(2).split('').map((d, i, s) => (d === '1' ? 2 ** (s.length - 1 - i) : 0)).filter(Boolean).join(' + ')}。` };
    return { t: 'fill', q: `二进制数 (${n.toString(2)})₂ 对应的十进制数是 ____。`, a: [String(n)], x: `按权展开：${n.toString(2).split('').map((d, i, s) => (d === '1' ? 2 ** (s.length - 1 - i) : 0)).filter(Boolean).join(' + ')} = ${n}。` };
  });
  const LOGIC = [
    ['A·B + C', (A, B, C) => (A & B) | C], ['(A + B)·C', (A, B, C) => (A | B) & C], ['A·B̄ + Ā·C', (A, B, C) => (A & (1 - B)) | ((1 - A) & C)],
    ['A ⊕ B ⊕ C', (A, B, C) => A ^ B ^ C], ['¬(A·B)·C', (A, B, C) => (1 - (A & B)) & C], ['AB + BC + AC', (A, B, C) => (A & B) | (B & C) | (A & C)], ['¬(A + B) + C', (A, B, C) => (1 - (A | B)) | C],
  ];
  add('ee9', '逻辑式求值', (r) => {
    const [s, f] = pick(r, LOGIC), A = int(r, 0, 1), B = int(r, 0, 1), C = int(r, 0, 1);
    return { t: 'judge', q: `逻辑函数 Y = ${s}，当 A = ${A}、B = ${B}、C = ${C} 时，Y = ${r() < 0.5 ? f(A, B, C) : 1 - f(A, B, C)}。`, a: null, _f: f(A, B, C), x: `代入：Y = ${f(A, B, C)}。上横线/¬ 表示取反，⊕ 为异或（相同为 0、不同为 1）。` };
  });

  /* ── C 语言 ── */
  add('c3', '整除与取余', (r) => {
    const a = int(r, 7, 99), b = int(r, 2, 9), op = int(r, 0, 2);
    if (op === 0) return { t: 'fill', q: `若 int a = ${a}, b = ${b}; 则表达式 a / b 的值为 ____。`, a: [String(Math.floor(a / b))], x: `整数相除取整：${a} / ${b} = ${Math.floor(a / b)}。` };
    if (op === 1) return { t: 'fill', q: `若 int a = ${a}, b = ${b}; 则表达式 a % b 的值为 ____。`, a: [String(a % b)], x: `${a} = ${b} × ${Math.floor(a / b)} + ${a % b}。` };
    return { t: 'fill', q: `若 int a = ${a}, b = ${b}; 则表达式 a / b * b + a % b 的值为 ____。`, a: [String(a)], x: `商 × 除数 + 余数 = 被除数：${Math.floor(a / b)} × ${b} + ${a % b} = ${a}。` };
  });
  add('c3', '自增自减', (r) => {
    const v = int(r, 1, 20), pre = r() < 0.5, inc = r() < 0.6, op = inc ? '++' : '--';
    const after = inc ? v + 1 : v - 1, b = pre ? after : v, askB = r() < 0.6;
    const expr = pre ? op + 'a' : 'a' + op;
    return { t: 'fill', q: `执行 int a = ${v}, b; b = ${expr}; 后，变量 ${askB ? 'b' : 'a'} 的值为 ____。`, a: [String(askB ? b : after)], x: `${pre ? '前置：先变后用' : '后置：先用后变'}。b = ${b}，a = ${after}。` };
  });
  add('c2', '字符运算', (r) => {
    const up = r() < 0.5, base = up ? 65 : 97, k = int(r, 1, 20), ch = String.fromCharCode(base), res = String.fromCharCode(base + k);
    if (r() < 0.5) return { t: 'fill', q: `执行 printf("%c", '${ch}' + ${k}); 的输出是 ____。`, a: [res, `'${res}'`], x: `'${ch}' 的 ASCII 为 ${base}，${base} + ${k} = ${base + k} → '${res}'。` };
    return { t: 'fill', q: `执行 printf("%d", '${res}'); 的输出是 ____（'A' 为 65，'a' 为 97）。`, a: [String(base + k)], x: `'${res}' = ${base} + ${k} = ${base + k}。大小写字母相差 32。` };
  });
  add('c5', '循环次数', (r) => {
    const s = int(r, 0, 5), e = s + int(r, 5, 20), d = int(r, 1, 4), le = r() < 0.5;
    const cnt = le ? Math.floor((e - s) / d) + 1 : Math.ceil((e - s) / d);
    return { t: 'fill', q: `循环 for (i = ${s}; i ${le ? '<=' : '<'} ${e}; i += ${d}) 的循环体执行 ____ 次。`, a: [String(cnt)], x: `i 依次取 ${Array.from({ length: Math.min(cnt, 8) }, (_, j) => s + j * d).join('、')}${cnt > 8 ? '…' : ''}，共 ${cnt} 次。` };
  });
  add('c5', '循环累加', (r) => {
    const n = int(r, 6, 20), m = int(r, 2, 5), useC = r() < 0.5;
    let sum = 0; for (let i = 1; i <= n; i++) if (useC ? i % m !== 0 : i % m === 0) sum += i;
    const body = useC ? `if (i % ${m} == 0) continue;\n  s += i;` : `if (i % ${m} == 0) s += i;`;
    return { t: 'fill', q: `执行以下程序段后 s 的值为 ____。<pre>int i, s = 0;\nfor (i = 1; i &lt;= ${n}; i++) {\n  ${body}\n}</pre>`, a: [String(sum)], x: `${useC ? '跳过' : '只累加'} ${m} 的倍数，s = ${sum}。` };
  });
  add('c6', '数组与指针取值', (r) => {
    const a = Array.from({ length: 6 }, () => int(r, 1, 30)), i = int(r, 0, 5), j = int(r, 0, 5), ptr = r() < 0.5;
    return ptr
      ? { t: 'fill', q: `若 int a[6] = {${a.join(', ')}}, *p = a + ${i % 3}; 则 *(p + ${j % 3}) 的值为 ____。`, a: [String(a[(i % 3) + (j % 3)])], x: `p 指向 a[${i % 3}]，p + ${j % 3} 指向 a[${(i % 3) + (j % 3)}] = ${a[(i % 3) + (j % 3)]}。` }
      : { t: 'fill', q: `若 int a[6] = {${a.join(', ')}}; 则 a[${i}] + a[${j}] 的值为 ____。`, a: [String(a[i] + a[j])], x: `下标从 0 开始：a[${i}] = ${a[i]}，a[${j}] = ${a[j]}。` };
  });
  add('c6', 'sizeof 与 strlen', (r) => {
    const w = pick(r, ['hello', 'china', 'abc', 'C program', 'guangxi', 'exam2027']), sz = r() < 0.5;
    return { t: 'fill', q: `若 char s[] = "${w}"; 则 ${sz ? 'sizeof(s)' : 'strlen(s)'} 的值为 ____。`, a: [String(sz ? w.length + 1 : w.length)], x: `strlen 不计 '\\0'，为 ${w.length}；sizeof 计入 '\\0'，为 ${w.length + 1}。空格也算一个字符。` };
  });

  /* ── 数学 ── */
  const term = (c, p) => { if (!c) return ''; const s = c < 0 ? ' − ' : ' + ', a = Math.abs(c); const cs = a === 1 && p ? '' : String(a); return s + cs + (p === 0 ? '' : p === 1 ? 'x' : 'x' + '⁰¹²³⁴'[p]); };
  const poly = (cs) => { const s = cs.map((c, i) => term(c, cs.length - 1 - i)).join('').trim(); return s.replace(/^\+ /, '').replace(/^− /, '−'); };
  add('m2', '多项式求导', (r) => {
    const cs = [int(r, -3, 3) || 1, int(r, -5, 5), int(r, -6, 6), int(r, -9, 9)], x0 = int(r, -2, 3);
    const d = 3 * cs[0] * x0 * x0 + 2 * cs[1] * x0 + cs[2];
    return { t: 'fill', q: `设 f(x) = ${poly(cs)}，则 f′(${x0}) = ____。`, a: [String(d)], x: `f′(x) = ${poly([3 * cs[0], 2 * cs[1], cs[2]])}，代入 x = ${x0} 得 ${d}。` };
  });
  add('m1', '∞/∞ 型极限', (r) => {
    const n = int(r, 1, 3), m = int(r, 1, 3), a = int(r, 1, 6), b = int(r, 1, 6);
    const ans = n < m ? '0' : n > m ? '∞' : frac(a, b);
    const c = choice(r, ans, shuffle(r, ['0', '∞', frac(a, b), frac(b, a), '1', String(a), '−1', String(a + b), '2']));
    return { t: 'single', q: `lim(x→∞) (${poly([a, ...Array(n).fill(0)])} + ${int(r, 1, 9)}) / (${b === 1 ? '' : b}${m === 1 ? 'x' : 'x' + '⁰¹²³'[m]} − ${int(r, 1, 9)}) =`, o: c.o, a: c.a, x: `抓大头：分子最高 ${n} 次，分母最高 ${m} 次。${n < m ? '分子次数低 → 0' : n > m ? '分子次数高 → ∞' : `同次 → 系数比 ${frac(a, b)}`}。` };
  });
  add('m1', '等价无穷小', (r) => {
    const a = int(r, 2, 7), b = int(r, 2, 7);
    const [top, sub] = pick(r, [['sin ' + a + 'x', a], ['tan ' + a + 'x', a], ['ln(1 + ' + a + 'x)', a], ['e^{' + a + 'x} − 1', a], ['arcsin ' + a + 'x', a]]);
    const [bot, sbb] = pick(r, [[b + 'x', b], ['sin ' + b + 'x', b], ['tan ' + b + 'x', b]]);
    const ans = frac(sub, sbb);
    const c = choice(r, ans, shuffle(r, [frac(sbb, sub), '1', '0', String(sub * sbb), frac(sub + 1, sbb)]));
    return { t: 'single', q: `lim(x→0) (${top}) / (${bot}) =`, o: c.o, a: c.a, x: `x → 0 时 ${top} ~ ${a}x，${bot} ~ ${b}x，极限 = ${ans}。` };
  });
  add('m4', '定积分计算', (r) => {
    const a = int(r, 1, 6), b = int(r, -4, 6) || 1, t = int(r, 1, 3), v = (a * t * t * t) / 3 + (b * t * t) / 2;
    const p = a * t * t * t * 2 + b * t * t * 3, q = 6;
    return { t: 'fill', q: `∫₀^${t} (${a === 1 ? '' : a}x² ${b < 0 ? '−' : '+'} ${Math.abs(b) === 1 ? '' : Math.abs(b)}x) dx = ____（可写分数）。`, a: [frac(p, q), r2(v)], x: `原函数 ${frac(a, 3)}x³ ${b < 0 ? '−' : '+'} ${frac(Math.abs(b), 2)}x²，代入上限 ${t}：${frac(p, q)}。` };
  });
  add('m5', '特征方程求通解', (r) => {
    const kind = int(r, 0, 2);
    if (kind === 0) {
      let r1 = int(r, -4, 4), r2_ = int(r, -4, 4); if (r1 === r2_) r2_ = r1 + 1;
      const p = -(r1 + r2_), q = r1 * r2_, e = (k) => (k === 0 ? '1' : k === 1 ? 'eˣ' : `e^{${k}x}`);
      const ans = `y = C₁${e(r1)} + C₂${e(r2_)}`;
      const c = choice(r, ans, [`y = C₁${e(-r1)} + C₂${e(-r2_)}`, `y = (C₁ + C₂x)${e(r1)}`, `y = C₁cos ${Math.abs(r1) || 1}x + C₂sin ${Math.abs(r2_) || 1}x`, `y = C₁${e(r1 + 1)} + C₂${e(r2_ - 1)}`]);
      return { t: 'single', q: `微分方程 y″ ${p < 0 ? '−' : '+'} ${Math.abs(p)}y′ ${q < 0 ? '−' : '+'} ${Math.abs(q)}y = 0 的通解为`, o: c.o, a: c.a, x: `特征方程 r² ${p < 0 ? '−' : '+'} ${Math.abs(p)}r ${q < 0 ? '−' : '+'} ${Math.abs(q)} = 0，r₁ = ${r1}，r₂ = ${r2_}（两不等实根）。` };
    }
    if (kind === 1) {
      const k = int(r, 1, 4), ans = `y = (C₁ + C₂x)e^{${k}x}`;
      const c = choice(r, ans, [`y = C₁e^{${k}x} + C₂e^{−${k}x}`, `y = (C₁ + C₂x)e^{−${k}x}`, `y = C₁cos ${k}x + C₂sin ${k}x`]);
      return { t: 'single', q: `微分方程 y″ − ${2 * k}y′ + ${k * k}y = 0 的通解为`, o: c.o, a: c.a, x: `特征方程 (r − ${k})² = 0，重根 r = ${k} → (C₁ + C₂x)e^{rx}。` };
    }
    const w = int(r, 1, 5), ans = `y = C₁cos ${w === 1 ? '' : w}x + C₂sin ${w === 1 ? '' : w}x`;
    const c = choice(r, ans, [`y = C₁e^{${w}x} + C₂e^{−${w}x}`, `y = (C₁ + C₂x)e^{${w}x}`, `y = C₁cos ${w * w}x + C₂sin ${w * w}x`]);
    return { t: 'single', q: `微分方程 y″ + ${w * w}y = 0 的通解为`, o: c.o, a: c.a, x: `特征根 r = ±${w}i（共轭复根，α = 0，β = ${w}）→ e^{αx}(C₁cos βx + C₂sin βx)。` };
  });

  /* ── 英语词汇（数据来自《英语历年200真题高频词》《常考的固定英语词组搭配》）── */
  add('e1', '高频词释义', (r) => {
    const W = window.VOCAB.words, w = pick(r, W);
    const c = choice(r, w.cn, shuffle(r, W.filter((x) => x.w !== w.w)).map((x) => x.cn));
    return { t: 'single', q: `单词 <b>${w.w}</b> 的意思是`, o: c.o, a: c.a, x: `${w.w}：${w.cn}${w.f ? `（真题出现 ${w.f} 次，排第 ${w.n}）` : `（高频词第 ${w.n} 个）`}。` };
  });
  add('e1', '固定搭配', (r) => {
    const P = window.VOCAB.phrases, w = pick(r, P);
    const c = choice(r, w.cn, shuffle(r, P.filter((x) => x.w !== w.w)).map((x) => x.cn));
    return { t: 'single', q: `词组 <b>${w.w}</b> 的意思是`, o: c.o, a: c.a, x: `${w.w}：${w.cn}（${w.cat}）。` };
  });

  // 判断题生成器统一换算答案
  for (const g of G) { const mk = g.make; g.make = (r) => { const q = mk(r); if (q.t === 'judge' && q.a === null) { const shown = Number(q.q.match(/Y = (\d)。$/)[1]); q.a = shown === q._f; delete q._f; } return q; }; }
})();

  return window.GENS;
}
