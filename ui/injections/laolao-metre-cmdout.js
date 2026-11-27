/* laolao-metre-cmdout —— L37 / T3#9：Metre 对话里「命令输出面板」（11-27）。
 *
 * 模型跑命令（exec 这一步）在工作过程里展开后，原生只给两块等宽文字：一块是参数 JSON，一块是输出原文。
 * 看不出跑的是哪条命令、成没成功、是不是还在后台跑；复制时会带上参数 JSON 和终端颜色控制码。
 * 对照已合的 R2 会话终端（laolao-workbench-term.js），这里在那一步的输出上方补一行命令头：
 *   $ npm test                         退出码 1        复制命令  复制输出
 *   - 命令原文：这一轮的历史里这次调用的参数（command / cmd），拿不到就读原生「参数」那块的 JSON；
 *   - 结果：输出开头就是「Command still running (session …, pid …)」→ 还在后台跑；输出末尾那一句「… exited with code N」→ 退出码 N
 *     （中间行里的不算：那是命令自己打印的）；内核 isError 为真时绝不写成功，矛盾就只写「没成功」；
 *     没有退出码时看 isError：true → 没成功，false → 跑完了，不知道就不写（不猜）；
 *   - 复制输出：去掉终端控制码，规则和 R2 终端上报前的清理是同一个（window.Pinkie.workbench.term.plainText）。
 * 只在 data-laolao-mode="metre" 下生效；离开 Metre 时补上的命令头全部拿掉，其他模式一个字不动。
 * 不改原生工具卡和共用的 laolao-tool-rows.css；模型跑的命令不进 R2 终端（R2 设计定了模型不往终端里输入）。
 * DOM 变化只通过 window.Pinkie.domWatch.watch 登记一个监听，不另挂监听器、不加循环定时器、不新增 window.__ 全局名。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreCmdout) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const COMMAND_TOOLS = /^(?:exec|bash|shell|run_command|terminal)$/i;
  const COMMAND_LABEL = /执行命令|\bexec\b|\bbash\b|\bshell\b/i;
  const TEXT = Object.freeze({copyCommand: '复制命令', copyOutput: '复制输出', copied: '已复制', failedCopy: '没复制上',
    running: '还在后台跑', failed: '没成功', done: '跑完了', code: n => `退出码 ${n}`});

  // 和 R2 终端上报前同一个清理规则；单独加载本文件（测试页）时用同样写法的一份。
  const ownPlain = value => String(value || '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b[@-_]/g, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const plainText = value => {
    const shared = window.Pinkie?.workbench?.term?.plainText;
    return typeof shared === 'function' ? shared(value) : ownPlain(value);
  };

  // ---------- 纯逻辑：一次命令调用 → 命令头要显示什么 ----------
  const parseArgs = value => {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; }
  };
  function commandOf(args) {
    const a = parseArgs(args);
    const command = a && (a.command ?? a.cmd);
    if (Array.isArray(command)) return command.map(String).join(' ').trim();
    return typeof command === 'string' ? command.trim() : '';
  }
  // 只认原文里明说的结果；说不清就返回空，不猜成功或失败。输出里大半是命令自己打印的东西
  // （grep 到源码里的这两句、子进程日志），所以两句都要锚在位置上：
  //   后台：OpenClaw 把命令放到后台时，整段输出就是以「Command still running (session X, pid N)」开头；
  //   退出码：只认整段末尾那一句——exec 的「(Command exited with code N)」、process 的「Process exited with code N.」。
  // 内核的 isError 为真时绝不写成功：末尾退出码 0、或者说在后台跑，都和它矛盾，这时只写「没成功」。
  const RUNNING_AT_START = /^Command still running \(session [\w.-]+, pid [\w/]+\)/;
  const EXIT_AT_END = /(?:^|\n)[ \t]*\(?(?:Command|Process) exited with code (-?\d+)\)?\.?$/i;
  function statusOf(output, isError) {
    const text = plainText(output).trim();
    const failed = {kind: 'fail', text: TEXT.failed};
    // 末尾有退出码就是跑完了，比开头那句更说了算（真放到后台时整段只有那一句，末尾不会有退出码）。
    const exit = EXIT_AT_END.exec(text);
    if (exit) {
      const code = Number(exit[1]);
      if (code === 0) return isError === true ? failed : {kind: 'ok', code, text: TEXT.code(code)};
      return {kind: 'fail', code, text: TEXT.code(code)};
    }
    if (RUNNING_AT_START.test(text)) return isError === true ? failed : {kind: 'running', text: TEXT.running};
    if (isError === true) return failed;
    if (isError === false) return {kind: 'ok', text: TEXT.done};
    return {kind: '', text: ''};
  }
  function model({name = '', args = null, output = '', isError} = {}) {
    const command = commandOf(args);
    if (!command) return null;
    if (name && !COMMAND_TOOLS.test(String(name).trim())) return null;
    return {command, status: statusOf(output, isError), output: plainText(output).replace(/\n+$/, '')};
  }

  // ---------- 从页面上认出一次命令调用 ----------
  const textOf = item => {
    const content = item?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return typeof item?.text === 'string' ? item.text : '';
    return content.filter(part => part && typeof part.text === 'string').map(part => part.text).join('\n');
  };
  const isErrorOf = item => (typeof item?.isError === 'boolean' ? item.isError : typeof item?.is_error === 'boolean' ? item.is_error : undefined);
  // 这一轮历史里按调用 id 找参数和结果（换浏览器、刷新以后也在）。
  function fromHistory(summary) {
    const callId = window.__pinkieToolKind?.rowCallId?.(summary) || '';
    if (!callId) return null;
    const pane = summary.closest('openclaw-chat-pane') || document.querySelector('openclaw-chat-pane[active]') || document.querySelector('openclaw-chat-pane');
    const list = Array.isArray(pane?.state?.chatMessages) ? pane.state.chatMessages : [];
    let call = null, result = null;
    for (const item of list) {
      for (const part of Array.isArray(item?.content) ? item.content : []) {
        const id = part?.id || part?.callId || part?.toolCallId;
        if (!call && id === callId && typeof part.name === 'string' && (part.arguments != null || part.args != null || part.input != null)) call = part;
        if (!result && id === callId && /tool_?result/i.test(String(part?.type || ''))) result = {output: textOf(part), isError: isErrorOf(part)};
      }
      if (!result && item?.toolCallId === callId && /toolresult|tool/i.test(String(item.role || ''))) result = {output: textOf(item), isError: isErrorOf(item)};
    }
    if (!call) return null;
    return {name: call.name, args: call.arguments ?? call.args ?? call.input, output: result?.output || '', isError: result?.isError};
  }
  // 历史里找不到（还在出字等）：原生先画参数块、再画输出块，两块都在才读。
  function fromCard(body, summary) {
    const label = summary?.querySelector('.chat-tool-msg-summary__label')?.textContent || '';
    if (!COMMAND_LABEL.test(label)) return null;
    const blocks = body.querySelectorAll('.chat-tool-card > .chat-tool-card__block .chat-tool-card__block-content');
    if (blocks.length < 2) return null;
    const error = Boolean(body.querySelector('.chat-tool-card--error'));
    return {name: '', args: blocks[0].textContent, output: blocks[blocks.length - 1].textContent, isError: error ? true : undefined};
  }

  // ---------- 命令头 ----------
  async function copy(button, text) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    button.textContent = ok ? TEXT.copied : TEXT.failedCopy;
    clearTimeout(button._pkReset);
    button._pkReset = setTimeout(() => { button.textContent = button.dataset.label; }, 1200);
  }
  function makeButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pk-mcmd__btn';
    button.dataset.action = action;
    button.dataset.label = label;
    button.textContent = label;
    return button;
  }
  function render(head, m) {
    head.textContent = '';
    const line = document.createElement('code');
    line.className = 'pk-mcmd__line';
    line.textContent = '$ ' + m.command.split('\n')[0];
    line.title = m.command;
    head.append(line);
    if (m.status.text) {
      const status = document.createElement('span');
      status.className = 'pk-mcmd__status';
      status.dataset.kind = m.status.kind;
      status.textContent = m.status.text;
      head.append(status);
    }
    const actions = document.createElement('span');
    actions.className = 'pk-mcmd__actions';
    actions.append(makeButton(TEXT.copyCommand, 'command'));
    if (m.output) actions.append(makeButton(TEXT.copyOutput, 'output'));
    head.append(actions);
  }
  const models = new WeakMap();   // 命令头 → 它显示的那次调用（复制时用）
  function ensure(body) {
    const summary = body.closest('.chat-tool-msg-collapse')?.querySelector('.chat-tool-msg-summary');
    const m = model(fromHistory(summary || body) || fromCard(body, summary) || {});
    let head = body.querySelector(':scope > .pk-mcmd');
    if (!m) { head?.remove(); return; }
    const key = JSON.stringify([m.command, m.status.text, m.output.length]);
    if (head && head.dataset.key === key) { models.set(head, m); return; }
    if (!head) {
      head = document.createElement('div');
      head.className = 'pk-mcmd';
      head.setAttribute('role', 'group');
      head.setAttribute('aria-label', '命令');
      body.prepend(head);
    }
    head.dataset.key = key;
    models.set(head, m);
    render(head, m);
  }
  function paint() {
    if (!isMetre()) { cleanup(); return; }
    for (const body of document.querySelectorAll('.pinkie-process .chat-tool-msg-body')) ensure(body);
  }
  function cleanup() {
    for (const head of document.querySelectorAll('.pk-mcmd')) head.remove();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('.pk-mcmd__btn');
    if (!button || !isMetre()) return;
    event.preventDefault();
    event.stopPropagation();
    const m = models.get(button.closest('.pk-mcmd'));
    if (m) void copy(button, button.dataset.action === 'output' ? m.output : m.command);
  }, true);

  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); }); };
  window.Pinkie?.domWatch?.watch('.pinkie-process .chat-tool-msg-body, .pk-mcmd', schedule, {immediate: true});
  window.addEventListener('laolao:modechange', schedule);
  window.addEventListener('pinkie:session-selected', schedule);

  ns.metreCmdout = Object.freeze({model, statusOf, commandOf, plainText, paint: schedule});
})();
