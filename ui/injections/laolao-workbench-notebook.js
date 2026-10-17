/* 工作台笔记本视图（.ipynb）
 *
 * 目标：让 .ipynb 在工作台里「看得懂、改得动、跑得了」。
 * 不做的事：不引入 JupyterLab 外壳，不做文件树/终端/主题镜像。
 *
 * 依赖边界：
 * - 执行交给本地 nb 服务（/load /run /restart），内核在服务端持久化，
 *   所以 cell 之间共享内存变量 —— 这是 notebook 区别于跑脚本的核心。
 * - 本文件只负责渲染与交互，不直接接触 ipykernel。
 */
(() => {
  'use strict';

  // 执行走网关 RPC（同源），不新开端口：页面 CSP 的 connect-src 只允许 'self'，
  // 跨端口 fetch 会被直接拦掉，所以不能用本地 HTTP 服务。
  const ENDPOINT = () => 'gateway-rpc';
  const state = {
    cells: [],
    path: '',
    busy: new Set(),
    dirty: false,
  };

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function call(action, body, timeoutMs = 300000) {
    const wb = window.__pinkieWorkbench;
    if (!wb || typeof wb.rpc !== 'function') throw new Error('工作台还没准备好');
    const method = 'pinkie.nb.' + action;
    const payload = await wb.rpc(method, body, timeoutMs);
    if (!payload) throw new Error('内核没有返回结果');
    if (payload.ok === false) throw new Error(payload.error || '内核执行失败');
    return payload;
  }

  /** 把 nbformat 的 outputs 渲染成 DOM。 */
  function renderOutputs(outputs) {
    const box = el('div', 'pk-nb-outputs');
    if (!outputs || !outputs.length) return box;
    for (const output of outputs) {
      const type = output.output_type;
      if (type === 'stream') {
        const pre = el('pre', 'pk-nb-stream' + (output.name === 'stderr' ? ' is-stderr' : ''));
        pre.textContent = Array.isArray(output.text) ? output.text.join('') : String(output.text || '');
        box.append(pre);
      } else if (type === 'error') {
        const pre = el('pre', 'pk-nb-error');
        const trace = Array.isArray(output.traceback) ? output.traceback.join('\n') : '';
        // 去掉 ANSI 颜色转义，工作台里不需要终端控制码
        const clean = (trace || (output.ename + ': ' + output.evalue)).replace(/\u001b\[[0-9;]*m/g, '');
        pre.textContent = clean;
        box.append(pre);
      } else if (type === 'execute_result' || type === 'display_data') {
        const data = output.data || {};
        if (data['image/png']) {
          const img = el('img', 'pk-nb-image');
          img.src = 'data:image/png;base64,' + data['image/png'];
          img.alt = '输出图片';
          box.append(img);
        } else if (data['image/svg+xml']) {
          const wrap = el('div', 'pk-nb-svg');
          wrap.innerHTML = String(data['image/svg+xml']);
          box.append(wrap);
        }
        const plain = data['text/plain'];
        if (plain) {
          const pre = el('pre', 'pk-nb-result');
          pre.textContent = Array.isArray(plain) ? plain.join('') : String(plain);
          box.append(pre);
        }
        if (data['text/html'] && !data['image/png']) {
          const details = el('details', 'pk-nb-html');
          details.append(el('summary', '', 'HTML 输出'));
          const frame = el('iframe', 'pk-nb-html-frame');
          frame.setAttribute('sandbox', '');
          frame.srcdoc = String(data['text/html']);
          details.append(frame);
          box.append(details);
        }
      }
    }
    return box;
  }

  function renderCell(cell, index, total) {
    const wrap = el('section', 'pk-nb-cell' + (cell.cellType === 'markdown' ? ' is-md' : ''));

    const gutter = el('div', 'pk-nb-gutter');
    const runBtn = el('button', 'pk-nb-run', '▶');
    runBtn.type = 'button';
    runBtn.title = cell.cellType === 'code' ? '运行本单元（⌘/Ctrl+Enter）' : 'Markdown 单元不需要执行';
    runBtn.disabled = cell.cellType !== 'code';
    runBtn.addEventListener('click', () => void runCell(index, wrap));

    const count = el('span', 'pk-nb-count', cell.executionCount ? String(cell.executionCount) : '');
    gutter.append(runBtn, count);

    const body = el('div', 'pk-nb-body');
    const input = el('textarea', 'pk-nb-input');
    input.value = cell.source || '';
    input.rows = Math.min(20, Math.max(2, (cell.source || '').split('\n').length));
    input.spellcheck = false;
    input.addEventListener('input', () => {
      state.cells[index].source = input.value;
      state.dirty = true;
      input.rows = Math.min(20, Math.max(2, input.value.split('\n').length));
      emitChange();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && cell.cellType === 'code') {
        event.preventDefault();
        void runCell(index, wrap);
      }
    });
    body.append(input);

    const outHost = el('div', 'pk-nb-out-host');
    outHost.append(renderOutputs(cell.outputs));
    body.append(outHost);

    wrap.append(gutter, body);
    wrap.dataset.index = String(index);
    wrap.dataset.total = String(total);
    return wrap;
  }

  async function runCell(index, cellNode) {
    const cell = state.cells[index];
    if (!cell || cell.cellType !== 'code') return;
    if (state.busy.has(index)) return;
    state.busy.add(index);

    const runBtn = cellNode.querySelector('.pk-nb-run');
    const countNode = cellNode.querySelector('.pk-nb-count');
    const outHost = cellNode.querySelector('.pk-nb-out-host');
    runBtn?.classList.add('is-busy');
    if (countNode) countNode.textContent = '…';
    outHost.replaceChildren(el('div', 'pk-nb-running', '运行中…'));

    try {
      const result = await call('run', {
        path: state.path,
        index,
        source: cell.source,
      });
      cell.outputs = result.outputs || [];
      cell.executionCount = result.executionCount;
      if (countNode) countNode.textContent = String(result.executionCount ?? '');
      outHost.replaceChildren(renderOutputs(cell.outputs));
      const meta = el('div', 'pk-nb-meta',
        `${result.elapsedMs} ms` + (result.saved ? ' · 已写回文件' : ' · 未写回'));
      outHost.append(meta);
      if (result.truncated) outHost.append(el('div', 'pk-nb-warn', '输出过长，已截断显示'));
    } catch (error) {
      outHost.replaceChildren(el('pre', 'pk-nb-error', String(error.message || error)));
      if (countNode) countNode.textContent = '';
    } finally {
      state.busy.delete(index);
      runBtn?.classList.remove('is-busy');
    }
  }

  function emitChange() {
    try {
      window.dispatchEvent(new CustomEvent('pinkie:nb-change', { detail: { path: state.path, dirty: state.dirty } }));
    } catch { /* 事件只是通知，失败不影响编辑 */ }
  }

  /** 渲染整个 notebook。返回 { node, api }。 */
  function render(host, payload) {
    state.cells = (payload.cells || []).map(cell => ({ ...cell }));
    state.path = payload.path;
    state.dirty = false;

    host.replaceChildren();
    const bar = el('div', 'pk-nb-bar');
    bar.append(el('span', 'pk-nb-title', payload.path.split('/').pop() || '.ipynb'));
    bar.append(el('span', 'pk-nb-sub', `${state.cells.length} 个单元 · ipykernel 持久内核`));
    const restart = el('button', 'pk-nb-restart', '重启内核');
    restart.type = 'button';
    restart.title = '清空内存，重新开始（变量会丢失）';
    restart.addEventListener('click', async () => {
      restart.disabled = true;
      restart.textContent = '重启中…';
      try {
        await call('restart', { path: state.path });
        host.querySelectorAll('.pk-nb-out-host').forEach(node => node.replaceChildren());
        host.querySelectorAll('.pk-nb-count').forEach(node => { node.textContent = ''; });
        restart.textContent = '已重启';
      } catch (error) {
        restart.textContent = '重启失败';
        console.warn(error);
      } finally {
        setTimeout(() => { restart.disabled = false; restart.textContent = '重启内核'; }, 1200);
      }
    });
    bar.append(restart);
    host.append(bar);

    const list = el('div', 'pk-nb-cells');
    state.cells.forEach((cell, index) => list.append(renderCell(cell, index, state.cells.length)));
    host.append(list);
    return { node: host, api: { runCell, state } };
  }

  async function open(host, path) {
    host.replaceChildren(el('div', 'pk-nb-loading', '正在读取笔记本…'));
    try {
      const payload = await call('load', { path });
      return render(host, payload);
    } catch (error) {
      host.replaceChildren();
      const box = el('div', 'pk-nb-failed');
      box.append(el('p', 'pk-nb-failed-title', '打不开这个笔记本'));
      box.append(el('pre', 'pk-nb-error', String(error.message || error)));
      box.append(el('p', 'pk-nb-hint',
        '笔记本内核由工作台插件提供。若一直失败，检查插件里的 nb_runner.py 与 Python 环境是否可用。'));
      host.append(box);
      throw error;
    }
  }

  window.__pinkieNotebook = { open, render, call, ENDPOINT };
})();
