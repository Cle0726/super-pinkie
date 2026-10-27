(() => {
  'use strict';
  if (window.__pinkieLearningDevices) return;
  const base = document.currentScript?.src || location.href;
  let engine;
  const ready = import(new URL('./laolao-learning-devices-engine.js?v=learningdevices1', base).href).then(value => (engine = value));
  ready.catch(() => {});
  const E = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; };
  const S = (tag, attrs = {}, text) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text !== undefined) n.textContent = String(text); return n; };
  const label = (svg, x, y, text, cls = '') => svg.append(S('text', {x, y, class: cls}, text));
  const line = (svg, x1, y1, x2, y2, cls = '') => svg.append(S('line', {x1, y1, x2, y2, class: cls}));
  const f = (v, unit = '') => !Number.isFinite(v) ? '—' : `${Number(v.toPrecision(4))}${unit ? ' ' + unit : ''}`;
  const svg = (title, height = 210) => { const n = S('svg', {viewBox: `0 0 480 ${height}`, role: 'img', 'aria-label': title, class: 'pld-svg'}); n.append(S('title', {}, title)); return n; };
  const table = (headers, rows) => {
    const wrap = E('div', 'pld-table-wrap'), t = E('table', 'pld-table'), head = E('thead'), tr = E('tr');
    headers.forEach(v => tr.append(E('th', '', v))); head.append(tr); t.append(head);
    const body = E('tbody'); rows.forEach(row => { const r = E('tr'); row.forEach(v => r.append(E('td', '', v))); body.append(r); });
    t.append(body); wrap.append(t); return wrap;
  };
  const badge = (name, value, active = false) => { const n = E('span', 'pld-badge', `${name} ${value}`); n.dataset.active = String(active); return n; };
  const stat = (name, value) => { const n = E('div', 'pld-stat'); n.append(E('span', '', name), E('strong', '', value)); return n; };
  const hint = text => E('p', 'pld-hint', text);
  function zenerDiagram(values, result) {
    const n = svg('稳压管并联稳压电路，限流电阻与负载、稳压管支路');
    line(n, 40, 40, 130, 40); n.append(S('rect', {x: 130, y: 28, width: 90, height: 24, rx: 3})); line(n, 220, 40, 410, 40);
    line(n, 410, 40, 410, 82); n.append(S('rect', {x: 398, y: 82, width: 24, height: 55, rx: 3})); line(n, 410, 137, 410, 175);
    line(n, 40, 175, 410, 175); line(n, 40, 40, 40, 75); n.append(S('circle', {cx: 40, cy: 106, r: 30})); line(n, 40, 136, 40, 175);
    label(n, 31, 101, '+'); label(n, 31, 125, '−'); label(n, 61, 112, f(values.Vin, 'V'));
    line(n, 300, 40, 300, 86); line(n, 300, 128, 300, 175);
    n.append(S('path', {d: 'M283 128 L300 91 L317 128 Z M280 86 L286 91 L314 91 L320 96', class: result.Iz > 0 ? 'pld-active' : ''}));
    label(n, 143, 22, 'R ' + f(values.R, 'Ω')); label(n, 330, 118, 'DZ'); label(n, 338, 148, f(values.Vz, 'V'));
    label(n, 376, 73, 'RL'); label(n, 340, 196, f(values.RL, 'Ω')); label(n, 230, 27, 'IR →'); label(n, 245, 162, 'IZ ↓'); label(n, 419, 162, 'IL ↓');
    n.append(S('circle', {cx: 300, cy: 40, r: 4, class: 'pld-node'})); return n;
  }
  function chipDiagram(device, p, r) {
    const n = svg(device === 'decoder138' ? '74LS138 输入与八路低有效输出' : device === 'mux151' ? '74LS151 选择路径与互补输出' : '74LS161 时钟、控制输入和四位输出');
    n.append(S('rect', {x: 147, y: 24, width: 190, height: 170, rx: 12}));
    label(n, 174, 51, device === 'decoder138' ? '74LS138' : device === 'mux151' ? '74LS151' : '74LS161', 'pld-chip-title');
    const names = device === 'counter161' ? ['CP', '/CLR', '/LOAD', 'ENP · ENT'] : ['C', 'B', 'A', device === 'decoder138' ? 'G1 · /G2' : '/G'];
    names.forEach((name, i) => { const y = 78 + i * 31; line(n, 76, y, 147, y); label(n, 9, y + 5, name); });
    if (device === 'decoder138') for (let i = 0; i < 8; i++) { const y = 66 + i * 16; line(n, 341, y, 393, y, r.selected === i ? 'pld-active' : ''); n.append(S('circle', {cx: 341, cy: y, r: 4})); label(n, 399, y + 5, `/Y${i} ${r.outputs[i]}`, r.selected === i ? 'pld-active-text' : ''); }
    else if (device === 'mux151') { label(n, 163, 94, r.enabled ? `CBA=${p.C}${p.B}${p.A}` : '禁止输出'); label(n, 163, 128, r.enabled ? `D${r.selected} → Y` : 'Y=0, W=1'); line(n, 337, 91, 397, 91, r.Y ? 'pld-active' : ''); line(n, 337, 145, 397, 145, r.W ? 'pld-active' : ''); label(n, 403, 96, `Y ${r.Y}`); label(n, 403, 150, `W ${r.W}`); }
    else { label(n, 169, 102, `DCBA=${p.DATA.toString(2).padStart(4, '0')}`); label(n, 174, 143, `Q=${r.binary}`, 'pld-chip-title'); line(n, 337, 100, 405, 100, r.RCO ? 'pld-active' : ''); label(n, 357, 90, `RCO ${r.RCO}`); }
    return n;
  }
  function sweep(values) {
    const n = svg('输入电压变化时的稳压输出曲线', 185), sx = x => 45 + x / 36 * 405, sy = y => 148 - y / 36 * 124;
    for (const x of [0, 12, 24, 36]) { line(n, sx(x), 20, sx(x), 148, 'pld-grid'); label(n, sx(x) - 5, 170, x); }
    for (const y of [0, 12, 24, 36]) { line(n, 45, sy(y), 450, sy(y), 'pld-grid'); label(n, 8, sy(y) + 4, y); }
    let d = ''; for (let i = 0; i <= 100; i++) { const x = i * .36, y = engine.zenerResult({...values, Vin: x}).Vo; d += `${i ? ' L' : 'M'}${sx(x)} ${sy(y)}`; }
    n.append(S('path', {d, class: 'pld-curve'})); n.append(S('circle', {cx: sx(values.Vin), cy: sy(engine.zenerResult(values).Vo), r: 5, class: 'pld-node'})); label(n, 355, 184, '输入 Vin / V'); label(n, 10, 15, 'Vo / V'); return n;
  }
  function counterWave(history) {
    const n = svg('74LS161 控制信号与四位计数时序', 238), points = history.slice(-16);
    const signals = [['CP', v => v.values.CLK], ['/CLR', v => v.values.CLR_n], ['/LOAD', v => v.values.LOAD_n], ['QA', v => v.q & 1], ['QB', v => v.q >> 1 & 1], ['QC', v => v.q >> 2 & 1], ['QD', v => v.q >> 3 & 1], ['RCO', v => +(v.values.ENT === 1 && v.q === 15)]];
    signals.forEach(([name, read], row) => {
      const y = 22 + row * 27, dx = 380 / Math.max(1, points.length); label(n, 2, y + 4, name); line(n, 68, y + 7, 460, y + 7, 'pld-grid');
      let d = ''; points.forEach((p, i) => { const x = 70 + i * dx, py = y + 7 - read(p) * 15; d += i ? ` L${x} ${y + 7 - read(points[i - 1]) * 15} L${x} ${py}` : `M${x} ${py}`; d += ` L${x + dx} ${py}`; }); n.append(S('path', {d, class: 'pld-wave'}));
    }); return n;
  }
  function renderDevice(view, h) {
    const record = view.data.visual, d = record.definition, spec = engine.DEVICES[d.device], root = E('div', 'pld-root'); view.body.append(root);
    const summary = E('div', 'pld-summary'), layout = E('div', 'pld-layout'), figure = E('div', 'pld-figure'), controls = E('div', 'pld-controls'), resultArea = E('div', 'pld-results');
    root.append(summary, layout, resultArea); layout.append(figure, controls);
    const update = patch => {
      try { view.data.visual.state = engine.saveDeviceState(view.data.visual, patch); view.enqueue('visual', {state: patch}); h.preserve(view.element, () => view.draw()); }
      catch (error) { view.say(error.message, true); }
    };
    const event = (type, values) => update({events: [{id: h.uid(), type, ...(values ? {values} : {})}]});
    const setValue = (key, value) => d.device === 'counter161' ? event('inputs', {[key]: value}) : update({values: {[key]: value}});
    const widgets = [];
    for (const field of spec.fields) {
      const row = E('label', 'pld-control'), title = E('span', '', field.label); row.append(title);
      if (field.max === 1) {
        const toggle = h.button('', () => setValue(field.key, 1 - view.data.visual.state.values[field.key]), 'pld-bit'); toggle.setAttribute('aria-label', field.label); row.append(toggle); widgets.push({field, toggle});
      } else {
        const pair = E('div', 'pld-number'), number = E('input'), unit = E('span', '', field.unit), slider = E('input', 'pld-range');
        for (const input of [number, slider]) { input.type = input === number ? 'number' : 'range'; input.min = field.min; input.max = field.max; input.step = field.step; input.value = view.data.visual.state.values[field.key]; input.setAttribute('aria-label', field.label + (input === number ? '数值' : '滑杆')); }
        slider.addEventListener('input', () => setValue(field.key, Number(slider.value)));
        number.addEventListener('change', () => { const value = Number(number.value); if (number.value !== '' && Number.isFinite(value) && value >= field.min && value <= field.max) setValue(field.key, value); else { view.say(`${field.label}需要在 ${field.min}–${field.max} 之间`, true); number.value = view.data.visual.state.values[field.key]; } });
        pair.append(number, unit); row.append(pair, slider); widgets.push({field, number, slider});
      }
      controls.append(row);
    }
    const actions = E('div', 'pinkie-il-actions'); root.append(actions);
    if (d.exampleFields?.length) root.append(hint('未指定的可调示例参数：' + d.exampleFields.map(key => spec.fields.find(f => f.key === key).label).join('、') + '。请按题目或器件资料修改。'));
    if (d.device === 'counter161') {
      actions.append(h.button('一个 CP 脉冲', () => event('tick'), 'pinkie-il-primary'), h.button('复位实验', () => event('reset')));
      const back = h.button('上一步观察', () => update({cursor: Math.max(0, view.data.visual.state.cursor - 1)}));
      const next = h.button('下一步观察', () => update({cursor: Math.min(view.data.visual.state.history.length - 1, view.data.visual.state.cursor + 1)}));
      actions.append(back, next, h.button('回到当前', () => update({cursor: view.data.visual.state.history.length - 1})));
      root.append(hint('CP 脉冲会产生低→高→低；/CLR 随时清零，/LOAD 只在上升沿装数。观察历史不会改变当前芯片状态。'));
    } else actions.append(h.button('恢复题目初值', () => update({values: d.values})));
    const details = E('details', 'pld-details'), caption = E('summary', '', d.device === 'zener' ? '公式与适用条件' : '完整真值表与规则'); details.append(caption); root.append(details);
    view.draw = () => {
      if (view.disposed) return;
      const state = view.data.visual.state, p = state.values, current = engine.deviceResult(d.device, p, state.q, d.minterms);
      widgets.forEach(w => { const value = p[w.field.key]; if (w.toggle) { w.toggle.textContent = value; w.toggle.setAttribute('aria-pressed', String(value === 1)); } else { if (document.activeElement !== w.number) w.number.value = value; w.slider.value = value; } });
      summary.replaceChildren(E('span', 'pld-eyebrow', d.device === 'zener' ? '电路实验' : '数字逻辑'), E('strong', '', spec.title)); figure.replaceChildren(); resultArea.replaceChildren();
      details.querySelectorAll(':scope > :not(summary)').forEach(n => n.remove());
      if (d.device === 'zener') {
        summary.append(badge('状态', current.region, current.regulated)); figure.append(zenerDiagram(p, current), sweep(p));
        const stats = E('div', 'pld-stats'); stats.append(stat('输出 Vo', f(current.Vo, 'V')), stat('限流 IR', f(current.IR * 1000, 'mA')), stat('负载 IL', f(current.IL * 1000, 'mA')), stat('稳压 IZ', f(current.Iz * 1000, 'mA')), stat('管耗 PZ', f(current.Pz, 'W')), stat('电阻耗散', f(current.PR, 'W'))); resultArea.append(stats);
        current.warnings.forEach(w => resultArea.append(E('p', 'pld-warning', w)));
        details.append(hint('IR=(Vin−Vo)/R，IL=Vo/RL，IZ=IR−IL，PZ=Vo·IZ。未击穿时 Vo=Vin·RL/(R+RL)。这是理想钳位模型，临界电流和功率会单独检查，不把理想电压平台当作真实器件保证。'));
        if (current.Rmax > 0) details.append(hint(`当前输入与负载下，按最小电流和稳压管功率推算的限流电阻范围约 ${f(Math.max(0, current.Rmin))}–${f(current.Rmax)} Ω；仍须检查电阻功率。`));
      } else {
        let shownP = p, shown = current;
        if (d.device === 'counter161') { const point = state.history[state.cursor]; shownP = point.values; shown = engine.deviceResult(d.device, shownP, point.q); summary.append(badge('计数', current.q), badge('RCO', current.RCO, current.RCO === 1)); figure.append(chipDiagram(d.device, shownP, shown)); resultArea.append(E('strong', 'pld-step', `观察 ${state.cursor + 1}/${state.history.length}：${point.reason}`), hint(`此步 Q=${point.q}（${shown.binary}），RCO=${shown.RCO}。当前实际 Q=${state.q}。`));
          resultArea.append(counterWave(state.history));
          const history = state.history.slice(-12); details.append(table(['事件', 'CP', '/CLR', '/LOAD', 'Q', 'RCO'], history.map((v, i) => [state.history.length - history.length + i + 1, v.values.CLK, v.values.CLR_n, v.values.LOAD_n, v.q, engine.deviceResult(d.device, v.values, v.q).RCO])));
          details.append(hint('优先级：/CLR=0 异步清零 > 上升沿 /LOAD=0 装数 > ENP=ENT=1 加1 > 保持。RCO=ENT·QA·QB·QC·QD，与 ENP 无关；改变 /LOAD 或 DATA 本身不会装数。'));
        } else if (d.device === 'decoder138') {
          summary.append(badge('选通', current.enabled ? '/Y' + current.selected : '禁止', current.enabled)); figure.append(chipDiagram(d.device, p, current));
          const bits = E('div', 'pld-outputs'); current.outputs.forEach((value, i) => bits.append(badge('/Y' + i, value, value === 0))); resultArea.append(bits, hint('输出低有效：高亮标记的是 0。G1=1 且 /G2A=/G2B=0 时才选通，其余情况所有输出为 1。'));
          if (d.minterms.length) resultArea.append(stat(`F=Σm(${d.minterms.join(',')})`, current.F));
          details.append(table(['C', 'B', 'A', ...Array.from({length: 8}, (_, i) => '/Y' + i)], Array.from({length: 8}, (_, i) => [i >> 2, i >> 1 & 1, i & 1, ...Array.from({length: 8}, (_, j) => +(i !== j))])), hint('此表为使能状态；禁用时八个输出全为 1。'));
        } else {
          summary.append(badge('通道', current.enabled ? 'D' + current.selected : '禁止'), badge('Y', current.Y, current.Y === 1), badge('W', current.W, current.W === 1)); figure.append(chipDiagram(d.device, p, current));
          resultArea.append(hint(current.enabled ? `CBA=${p.C}${p.B}${p.A}，选择 D${current.selected}=${p['D' + current.selected]}。Y 与输入同相，W 反相。` : '/G=1 禁用，Y=0、W=1。'));
          details.append(table(['/G', 'CBA', '选择', 'Y', 'W'], [...Array.from({length: 8}, (_, i) => [0, i.toString(2).padStart(3, '0'), 'D' + i, p['D' + i], 1 - p['D' + i]]), [1, '任意', '禁止', 0, 1]]));
        }
      }
    };
    const explain = h.button('解释我现在这一步', async () => {
      if (explain.disabled) return; explain.disabled = true;
      try {
        if (!await view.flush()) return;
        await h.call('chat.send', {sessionKey: view.ref.sessionKey, idempotencyKey: h.uid(), message: `请解释我现在这一步，沿用这张实验图，不要新建相同的组件。\nactivity_id: ${record.id}\n${JSON.stringify(engine.deviceContext(view.data.visual))}\n说明当前输入、结果和适用条件，操作过不代表已经掌握。`});
        view.say('已把当前实验状态交给碧琪');
      } catch (error) { view.say(error.message || '暂时无法发送问题', true); }
      finally { explain.disabled = false; }
    }); actions.append(explain); view.draw();
  }
  function showImage(image, h) {
    const dialog = E('dialog', 'pld-lightbox'), close = h.button('关闭', () => { dialog.close(); dialog.remove(); });
    const img = E('img'); img.src = image.url; img.alt = image.alt; img.referrerPolicy = 'no-referrer'; dialog.append(close, img, hint(image.caption || image.alt));
    dialog.addEventListener('close', () => dialog.remove(), {once: true}); dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); document.body.append(dialog); dialog.showModal(); close.focus();
  }
  function renderGuide(view, h) {
    const record = view.data.visual, d = record.definition, root = E('div', 'pld-guide'); view.body.append(root);
    for (const card of d.cards) {
      const row = E('article', 'pld-guide-row'), media = E('div', 'pld-guide-media'), copy = E('div', 'pld-guide-copy'); copy.append(E('h3', '', card.title));
      card.body.split(/\n+/).filter(Boolean).forEach(p => copy.append(E('p', '', p)));
      if (card.image) {
        const zoom = h.button('', () => showImage(card.image, h), 'pld-image-button');
        const load = () => {
          const img = E('img'); img.alt = card.image.alt; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
          // A fresh image request matters in WebKit: assigning the same src to
          // a previously failed element can retain its failed request forever.
          img.addEventListener('error', () => {
            zoom.hidden = true; const error = E('div', 'pld-image-error');
            error.append(hint('图片暂时未载入'), h.button('重试图片', () => { error.remove(); zoom.hidden = false; load(); })); media.append(error);
          }, {once:true});
          zoom.replaceChildren(img); img.src = card.image.url;
        };
        zoom.setAttribute('aria-label', '放大：' + card.image.alt); media.append(zoom); load();
        if (card.image.caption) media.append(hint(card.image.caption));
      } else if (card.diagram) {
        const p = card.diagram === 'memory' ? null : Object.fromEntries(engine.DEVICES[card.diagram].fields.map(v => [v.key, v.value]));
        media.append(card.diagram === 'memory' ? memoryThumbnail() : card.diagram === 'zener' ? zenerDiagram(p, engine.zenerResult(p)) : chipDiagram(card.diagram, p, engine.deviceResult(card.diagram, p, 0)));
      } else { row.classList.add('pld-text-only'); }
      row.append(media, copy); root.append(row);
    }
    if (d.table) root.append(table(d.table.columns, d.table.rows));
    if (d.sizes.length) {
      const section = E('section', 'pld-size-section'), picker = E('div', 'pinkie-il-actions'), display = E('div', 'pld-size-preview'), caption = E('p', 'pld-hint'); section.append(E('h3', '', '横竖版比例预览'), picker, display, caption); root.append(section);
      const redraw = () => { const s = d.sizes[view.data.visual.state.size || 0]; display.style.aspectRatio = `${s.width}/${s.height}`; display.style.width = `min(100%,${Math.min(390, 250 * s.width / s.height)}px)`; display.textContent = `${s.width} × ${s.height}`; caption.textContent = `${s.label || '画布'} · 比例示意，非生成图片`; };
      d.sizes.forEach((s, i) => picker.append(h.button(s.label || `${s.width}×${s.height}`, () => { const state = {size: i}; view.data.visual.state = engine.saveDeviceState(view.data.visual, state); view.enqueue('visual', {state}); redraw(); }))); redraw();
    }
  }
  function memoryThumbnail() {
    const n = svg('指针指向数组元素的示意图', 150); label(n, 24, 35, 'int *p'); n.append(S('rect', {x: 24, y: 48, width: 88, height: 42, rx: 5})); label(n, 52, 76, '&a[1]');
    for (let i = 0; i < 3; i++) { n.append(S('rect', {x: 198 + i * 80, y: 48, width: 78, height: 42, rx: 3, class: i === 1 ? 'pld-selected-cell' : ''})); label(n, 219 + i * 80, 76, [10, 20, 30][i]); label(n, 214 + i * 80, 118, `a[${i}]`); }
    n.append(S('path', {d: 'M112 70 C170 70 180 20 308 46', class: 'pld-pointer-link'})); return n;
  }
  function renderMemory(body, memory, h, view) {
    const root = E('section', 'pld-memory'), title = E('h3', '', '内存与指针'), grid = E('div', 'pld-memory-grid'); root.append(title, hint('格子按对象和元素组织；地址是符号示意，不是进程的实际物理地址。'), grid);
    const targets = new Map();
    memory.forEach(cell => {
      const row = E('div', 'pld-memory-row'), name = E('strong', '', cell.name), kind = E('small', '', cell.type + (cell.alive === false ? '（生命周期结束）' : '')), values = E('div', 'pld-cells'); row.dataset.memoryObject = cell.id; row.dataset.alive = String(cell.alive !== false); row.append(name, kind, values);
      cell.values.forEach((value, i) => { const box = E('button', 'pld-cell', value); box.type = 'button'; box.setAttribute('aria-label', `${cell.name}[${i}] 当前值 ${value}`); values.append(box); box.addEventListener('click', () => { root.querySelectorAll('.pld-cell').forEach(n => n.classList.remove('pld-selected-cell')); box.classList.add('pld-selected-cell'); detail.textContent = `${cell.name}${cell.values.length > 1 ? '[' + i + ']' : ''}：${cell.type}，当前值 ${value}`; }); targets.set(cell.id + ':' + i, box); });
      grid.append(row);
    });
    const detail = E('p', 'pld-memory-detail', '点一个内存格，查看对象、下标与当前值。'), links = E('div', 'pld-pointer-list'); root.append(links, detail);
    memory.filter(c => c.pointer).forEach(cell => {
      const p = cell.pointer, target = memory.find(c => c.id === p.target), text = p.null ? 'NULL（不能解引用）' : p.uninitialized ? '未初始化（不能解引用）' : target ? `${target.name}[${p.index}]${p.dangling ? '（悬空，生命周期已结束）' : p.onePast ? '（尾后，不能解引用）' : ''}` : '当前轨迹不支持的目标';
      const link = h.button(`${cell.name} → ${text}`, () => { root.querySelectorAll('.pld-cell').forEach(n => n.classList.remove('pld-selected-cell')); targets.get(cell.id + ':0')?.classList.add('pld-selected-cell'); targets.get(p.target + ':' + p.index)?.classList.add('pld-selected-cell'); detail.textContent = `${cell.name} 指向 ${text}`; }, 'pld-pointer'); links.append(link);
      if (target && !p.onePast) targets.get(p.target + ':' + p.index)?.classList.add('pld-pointed-cell');
    });
    body.append(root);
    const overlay = S('svg', {'aria-hidden': 'true', class: 'pld-memory-arrows'}); grid.append(overlay);
    const draw = () => {
      if (!root.isConnected) return;
      const box = grid.getBoundingClientRect(); if (!box.width || !box.height) return;
      overlay.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`); overlay.replaceChildren();
      const id = 'arrow-' + h.uid(), defs = S('defs'), marker = S('marker', {id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto'}); marker.append(S('path', {d: 'M0 0 L10 5 L0 10 Z', fill: 'currentColor'})); defs.append(marker); overlay.append(defs);
      memory.filter(c => c.pointer && !c.pointer.onePast).forEach(cell => {
        const from = targets.get(cell.id + ':0'), to = targets.get(cell.pointer.target + ':' + cell.pointer.index); if (!from || !to) return;
        const a = from.getBoundingClientRect(), b = to.getBoundingClientRect(), x1 = a.left - box.left + a.width / 2, y1 = a.top - box.top, x2 = b.left - box.left + b.width / 2, y2 = b.bottom - box.top;
        overlay.append(S('path', {d: `M${x1} ${y1} C${x1 + 15} ${y1 - 17} ${x2 + 15} ${y2 + 17} ${x2} ${y2}`, 'marker-end': `url(#${id})`}));
      });
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null; observer?.observe(grid);
    const frame = requestAnimationFrame(draw);
    if (view) { (view.deviceCleanups ||= []).push(() => { observer?.disconnect(); cancelAnimationFrame(frame); }); }
  }
  function render(view, h) {
    if (!engine) { const generation = view.generation; view.body.append(hint('正在准备交互图…')); ready.then(() => { if (!view.disposed && view.generation === generation && view.visible && view.expanded) h.preserve(view.element, () => { view.body.replaceChildren(); render(view, h); }); }).catch(() => view.say('交互组件暂时无法载入，请稍后重新展开', true)); return; }
    if (view.data.visual.kind === 'device_lab') renderDevice(view, h); else renderGuide(view, h);
  }
  ready.then(() => window.dispatchEvent(new Event('pinkie:learning-device-ready'))).catch(() => {});
  function applyPatch(record, patch) {
    if (!patch.events || patch.events.length <= 100) return engine.saveDeviceState(record, patch);
    let state = record.state;
    for (let i = 0; i < patch.events.length; i += 80) state = engine.saveDeviceState({...record, state}, {...patch, events: patch.events.slice(i, i + 80), ...(i + 80 < patch.events.length ? {cursor: undefined} : {})});
    return state;
  }
  window.__pinkieLearningDevices = {ready, render, renderMemory, applyPatch, cleanup(view) { view.deviceCleanups?.forEach(fn => fn()); view.deviceCleanups = []; }};
})();
