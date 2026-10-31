// Canonical, data-only teaching models. The browser ships this exact module.
// Digital conventions follow the TI SN74LS138/151/161A function tables.
export const DEVICE_KINDS = new Set(['device_lab', 'illustrated_guide']);
export const DEVICES = {
  zener: {title: '稳压管并联稳压实验', topic: 'ee5', fields: [
    ['Vin', '输入电压', 'V', 0, 36, 12, .1], ['R', '限流电阻', 'Ω', 10, 10000, 330, 1],
    ['RL', '负载电阻', 'Ω', 50, 100000, 1000, 10], ['Vz', '稳压值', 'V', 2, 24, 5.1, .1],
    ['Izmin', '最小稳压电流', 'mA', 0, 20, 1, .1], ['Pmax', '稳压管额定功率', 'W', .1, 5, .5, .1],
    ['PRmax', '电阻额定功率', 'W', .125, 10, .5, .125],
  ]},
  decoder138: {title: '74LS138 译码器', topic: 'ee9', fields: [
    ['A', 'A（最低位）'], ['B', 'B'], ['C', 'C（最高位）'], ['G1', 'G1（高有效）', '', 0, 1, 1], ['G2A', '/G2A（低有效）'], ['G2B', '/G2B（低有效）'],
  ]},
  mux151: {title: '74LS151 数据选择器', topic: 'ee9', fields: [
    ['A', 'A（最低位）'], ['B', 'B'], ['C', 'C（最高位）'], ['G', '/G（低有效）'],
    ...Array.from({length: 8}, (_, i) => ['D' + i, '数据 D' + i, '', 0, 1, i % 2]),
  ]},
  counter161: {title: '74LS161 同步计数器', topic: 'ee10', fields: [
    ['CLR_n', '/CLR（异步清零）', '', 0, 1, 1], ['LOAD_n', '/LOAD（同步装数）', '', 0, 1, 1],
    ['ENP', 'ENP', '', 0, 1, 1], ['ENT', 'ENT', '', 0, 1, 1], ['CLK', 'CP 时钟'], ['DATA', '并行数据 DCBA', '', 0, 15, 9],
  ]},
};
for (const d of Object.values(DEVICES)) d.fields = d.fields.map(([key, label, unit = '', min = 0, max = 1, value = 0, step = 1]) => ({key, label, unit, min, max, value, step}));
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const assert = (v, message) => { if (!v) throw Error(message); };
const text = (v, n = 500) => String(v ?? '').trim().slice(0, n);
const clone = v => structuredClone(v);
function valuesFor(device, values = {}) {
  assert(plain(values), '实验参数需要是对象');
  const fields = DEVICES[device].fields;
  assert(Object.keys(values).every(k => fields.some(f => f.key === k)), '存在未知的实验参数');
  return Object.fromEntries(fields.map(f => {
    const value = values[f.key] ?? f.value;
    assert(typeof value === 'number' && Number.isFinite(value) && value >= f.min && value <= f.max, `${f.label}超出范围`);
    assert(device === 'zener' || Number.isInteger(value), `${f.label}需要整数`);
    return [f.key, value];
  }));
}
function image(raw) {
  if (!raw) return null;
  assert(plain(raw), '图片格式不正确');
  const url = text(raw.url, 2000);
  assert(/^https:\/\//.test(url) || /^\/(?!\/)[^\r\n]*$/.test(url), '图片需要 https 或应用内的真实资源地址');
  const parsed = new URL(url, 'https://app.invalid');
  assert(!parsed.username && !parsed.password && !/[\u0000-\u001f]/.test(url), '图片地址不正确');
  return {url, alt: text(raw.alt, 300) || '讲解插图', caption: text(raw.caption, 400)};
}
export function normalizeDevice(payload) {
  const spec = payload.visual;
  assert(plain(spec), '请提供 visual 定义');
  if (payload.kind === 'illustrated_guide') {
    assert(Array.isArray(spec.cards) && spec.cards.length >= 1 && spec.cards.length <= 8, '图文说明需要 1–8 张卡片');
    const cards = spec.cards.map((c, i) => {
      assert(plain(c) && text(c.title, 120), '每张卡片需要标题');
      if (c.diagram) assert([...Object.keys(DEVICES), 'memory'].includes(c.diagram), '不支持这幅内置示意图');
      return {id: text(c.id || `card-${i + 1}`, 80), title: text(c.title, 120), body: text(c.body, 2200), image: image(c.image), diagram: c.diagram || ''};
    });
    assert(new Set(cards.map(c => c.id)).size === cards.length, '卡片编号不能重复');
    const sizes = (spec.sizes || []).map(s => {
      assert(plain(s) && Number.isInteger(s.width) && Number.isInteger(s.height) && s.width >= 64 && s.height >= 64 && s.width <= 4096 && s.height <= 4096, '画布尺寸需要 64–4096 的整数像素');
      return {label: text(s.label, 80), width: s.width, height: s.height};
    });
    assert(sizes.length <= 6, '最多 6 种画布比例');
    let table = null;
    if (spec.table) {
      const {columns, rows} = spec.table;
      assert(Array.isArray(columns) && columns.length >= 2 && columns.length <= 6 && Array.isArray(rows) && rows.length <= 30, '对比表需要 2–6 列、最多 30 行');
      assert(rows.every(r => Array.isArray(r) && r.length === columns.length && r.every(c => ['string', 'number'].includes(typeof c))), '对比表单元格格式不正确');
      table = {columns: columns.map(v => text(v, 100)), rows: rows.map(r => r.map(v => text(v, 500)))};
    }
    return {kind: payload.kind, title: text(payload.topic || '图解与对比', 160), definition: {cards, sizes, table}};
  }
  const device = spec.device;
  assert(Object.hasOwn(DEVICES, device), 'device_lab 支持 zener、decoder138、mux151、counter161');
  const initial = spec.initial ?? 0;
  assert(Number.isInteger(initial) && initial >= 0 && initial <= 15, '计数器初值为 0–15');
  const minterms = spec.minterms ?? [];
  assert(Array.isArray(minterms) && minterms.length <= 8 && minterms.every(n => Number.isInteger(n) && n >= 0 && n <= 7), '最小项需要 0–7 的编号');
  return {kind: 'device_lab', title: text(payload.topic || DEVICES[device].title, 160), definition: {device, initial, values: valuesFor(device, spec.values), minterms: [...new Set(minterms)],
    exampleFields: DEVICES[device].fields.filter(f => !Object.hasOwn(spec.values || {}, f.key)).map(f => f.key)}};
}
export function zenerResult(p) {
  const {Vin, R, RL, Vz, Izmin, Pmax, PRmax} = valuesFor('zener', p);
  const unclamped = Vin * RL / (R + RL), clamped = unclamped >= Vz;
  const Vo = clamped ? Vz : unclamped, IR = (Vin - Vo) / R, IL = Vo / RL, Iz = Math.max(0, IR - IL);
  const Pz = Vo * Iz, PR = IR * IR * R, enoughCurrent = clamped && Iz >= Izmin / 1000;
  const warnings = [];
  if (!clamped) warnings.push('稳压管未进入反向击穿，输出按电阻分压变化。');
  else if (!enoughCurrent) warnings.push('电流低于设定最小稳压电流，实际器件不能保证稳压。');
  if (Pz > Pmax) warnings.push('稳压管功率超过额定值。');
  if (PR > PRmax) warnings.push('限流电阻功率超过额定值。');
  return {Vo, IR, IL, Iz, Pz, PR, enoughCurrent, regulated: enoughCurrent && Pz <= Pmax && PR <= PRmax,
    region: !clamped ? '未击穿' : !enoughCurrent ? '临界区' : Pz > Pmax || PR > PRmax ? '功率超限' : '稳压区', warnings,
    Rmax: (Vin - Vz) / (Vz / RL + Izmin / 1000), Rmin: (Vin - Vz) / (Vz / RL + Pmax / Vz)};
}
export function deviceResult(device, values, q = 0, minterms = []) {
  const p = valuesFor(device, values);
  if (device === 'zener') return zenerResult(p);
  if (device === 'decoder138') {
    const enabled = p.G1 === 1 && p.G2A === 0 && p.G2B === 0, selected = p.C * 4 + p.B * 2 + p.A;
    return {enabled, selected: enabled ? selected : null, outputs: Array.from({length: 8}, (_, i) => enabled && i === selected ? 0 : 1), F: enabled && minterms.includes(selected) ? 1 : 0};
  }
  if (device === 'mux151') {
    const selected = p.C * 4 + p.B * 2 + p.A, Y = p.G ? 0 : p['D' + selected];
    return {enabled: p.G === 0, selected: p.G ? null : selected, Y, W: 1 - Y};
  }
  return {q, binary: q.toString(2).padStart(4, '0'), RCO: p.ENT === 1 && q === 15 ? 1 : 0};
}
function counterTransition(q, previous, p) {
  if (!p.CLR_n) return {q: 0, reason: '异步清零：无需等待 CP'};
  if (previous.CLK === 0 && p.CLK === 1) {
    if (!p.LOAD_n) return {q: p.DATA, reason: 'CP 上升沿：同步装数'};
    if (p.ENP && p.ENT) return {q: (q + 1) % 16, reason: q === 15 ? 'CP 上升沿：15 → 0 回卷' : 'CP 上升沿：加 1'};
    return {q, reason: '计数使能不足：保持'};
  }
  return {q, reason: '未出现上升沿：保持'};
}
export function createDeviceState(normalized, previous) {
  if (previous && JSON.stringify(previous.definition) === JSON.stringify(normalized.definition)) return clone(previous.state);
  if (normalized.kind === 'illustrated_guide') return {selected: normalized.definition.cards[0].id, size: 0};
  const values = clone(normalized.definition.values), q = values.CLR_n === 0 ? 0 : normalized.definition.initial;
  return {values, q, seen: [], cursor: 0, history: [{values: clone(values), q, reason: '初始状态'}]};
}
export function saveDeviceState(record, patch) {
  assert(plain(patch), '交互状态格式不正确');
  const next = clone(record.state), d = record.definition;
  if (record.kind === 'illustrated_guide') {
    assert(Object.keys(patch).every(k => ['selected', 'size'].includes(k)), '图文状态包含未知字段');
    if (patch.selected !== undefined) { assert(d.cards.some(c => c.id === patch.selected), '卡片不存在'); next.selected = patch.selected; }
    if (patch.size !== undefined) { assert(Number.isInteger(patch.size) && patch.size >= 0 && patch.size < d.sizes.length, '比例不存在'); next.size = patch.size; }
    return next;
  }
  assert(Object.keys(patch).every(k => ['values', 'events', 'cursor'].includes(k)), '实验状态包含未知字段');
  if (d.device !== 'counter161') {
    assert(!patch.events && patch.cursor === undefined, '当前实验没有时钟事件');
    if (patch.values) next.values = valuesFor(d.device, {...next.values, ...patch.values});
    return next;
  }
  assert(!patch.values, '计数器输入需要按事件顺序修改');
  if (patch.events) {
    assert(Array.isArray(patch.events) && patch.events.length <= 100, '一次最多 100 个时钟/输入事件');
    for (const event of patch.events) {
      assert(plain(event) && /^[a-zA-Z0-9_-]{1,100}$/.test(event.id) && ['inputs', 'tick', 'reset'].includes(event.type), '计数器事件格式不正确');
      if (next.seen.includes(event.id)) continue;
      if (event.type === 'reset') {
        const fresh = createDeviceState(record); Object.assign(next, fresh, {seen: next.seen});
      } else {
        const update = values => {
          const transition = counterTransition(next.q, next.values, values);
          next.values = values; next.q = transition.q;
          next.history.push({values: clone(values), q: next.q, reason: transition.reason});
        };
        if (event.type === 'inputs') { assert(plain(event.values), '缺少输入事件参数'); update(valuesFor(d.device, {...next.values, ...event.values})); }
        else {
          // A full pulse always starts low, then rises, then falls. Starting at
          // high must not accidentally skip the next counted rising edge.
          update({...next.values, CLK: 0}); update({...next.values, CLK: 1}); update({...next.values, CLK: 0});
        }
        next.history = next.history.slice(-64); next.cursor = next.history.length - 1;
      }
      next.seen = [...next.seen, event.id].slice(-256);
    }
  }
  if (patch.cursor !== undefined) { assert(Number.isInteger(patch.cursor) && patch.cursor >= 0 && patch.cursor < next.history.length, '观察步骤不存在'); next.cursor = patch.cursor; }
  return next;
}
export function deviceContext(record) {
  if (record.kind === 'illustrated_guide') return {selected: record.state.selected, size: record.definition.sizes[record.state.size] || null};
  return {device: record.definition.device, values: record.state.values, result: deviceResult(record.definition.device, record.state.values, record.state.q, record.definition.minterms),
    ...(record.definition.device === 'counter161' ? {recent: record.state.history.slice(-4)} : {})};
}
