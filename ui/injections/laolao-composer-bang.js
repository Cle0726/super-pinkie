/* I6 聊天里用 ! 直接跑命令（briefs/program-1120/设计-I6.md 第 2 版）。
   判档、审批、执行全在网关 pinkie.shell.*（services/mode-architecture/shell-run.mjs），这里不信自己的判断：
   设置卡开关、输入框「命令」标签、确认框、不能跑时输入框上方的提示，以及 sidebar chat.send 队列里的 intercept。
   不新增观察器：标签跟 input 事件走，设置卡重开走 Pinkie.domWatch.poll。 */
(() => {
  'use strict';
  const S = 'pinkie-user-settings__';
  const B = 'laolao-composer-bang';
  const COMBO = '.agent-chat__composer-combobox';
  const INPUT = COMBO + ' textarea';
  const DESC = '打开后，以 ! 开头的消息不发给模型，直接在这个会话绑定的文件夹里跑；结果只显示在对话里，模型看不到。';
  const request = (method, params, timeout = 20_000) => {
    const rpc = window.__laolaoSidebar?.gwRequest;
    return typeof rpc === 'function' ? rpc(method, params, timeout) : Promise.reject(new Error('网关未连接'));
  };
  const toast = text => {
    if (typeof window.__laolaoToast === 'function') window.__laolaoToast(text);
    else window.__laolaoSidebar?.toast?.(text);
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, className, onClick) => {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = event => { event.stopPropagation(); onClick(event); };
    return node;
  };

  let enabled = false, known = false;
  const readConfig = () => request('pinkie.shell.config.get', {})
    .then(value => { enabled = value?.enabled === true; known = true; return enabled; }, () => enabled);

  // 和服务端 parseBang 同一规则：半角 ! 后面紧跟非空白才算命令；!! 去掉一个 ! 当普通消息。
  function parseBang(text) {
    const s = String(text ?? '');
    if (s.startsWith('!!')) return {kind: 'message', text: s.slice(1)};
    if (s[0] === '!' && s.length > 1 && !/\s/.test(s[1])) return {kind: 'command', command: s.slice(1).trim()};
    return {kind: 'message', text: s};
  }

  function paintTag(input) {
    const combo = input?.closest?.(COMBO);
    if (!combo) return;
    const on = enabled && parseBang(input.value).kind === 'command';
    let tag = combo.querySelector(`.${B}__tag`);
    if (on && !tag) {
      tag = el('span', `${B}__tag`, '命令');
      combo.prepend(tag);
    } else if (!on) tag?.remove();
    combo.classList.toggle(`${B}--on`, on);
  }
  function hint(text) {
    const combo = document.querySelector(COMBO);
    let node = combo?.querySelector(`.${B}__hint`);
    if (!text) { node?.remove(); return; }
    if (!combo) { toast(text); return; }
    if (!node) {
      node = el('div', `${B}__hint`);
      node.setAttribute('role', 'status');
      combo.prepend(node);
    }
    node.textContent = text;
  }
  // 原生发送时先清空输入框；没跑成就把命令放回去，不发给模型。
  function restore(text) {
    const input = document.querySelector(INPUT);
    if (!input) return;
    const pane = input.closest('openclaw-chat-pane') || document.querySelector('openclaw-chat-pane');
    if (pane?.state && typeof pane.state.chatMessage === 'string') {
      pane.state.chatMessage = text;
      pane.state.requestUpdate?.();
      pane.requestUpdate?.();
    }
    if (input.value !== text) {
      input.value = text;
      input.dispatchEvent(new Event('input', {bubbles: true}));
    }
    paintTag(input);
  }

  function confirmRun(command, cwd) {
    return new Promise(resolve => {
      const mask = el('div', `laolao-modal-mask pinkie-tools-mask pinkie-art-confirm ${B}__mask`);
      const box = el('div', `laolao-modal pinkie-tools-modal ${B}__dialog`);
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-label', '跑这条命令？');
      box.append(el('h3', 'laolao-modal__title', '跑这条命令？'), el('pre', `${B}__command`, command),
        el('p', `pinkie-art-confirm__text ${B}__cwd`, `文件夹：${cwd}`));
      const done = result => { mask.remove(); document.removeEventListener('keydown', onKey, true); resolve(result); };
      const onKey = event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); done(false); }
      };
      document.addEventListener('keydown', onKey, true);
      const cancel = button('算了', 'laolao-modal__button', () => done(false));
      const buttons = el('div', 'laolao-modal__buttons');
      buttons.append(cancel, button('跑', 'laolao-modal__button laolao-modal__button--primary', () => done(true)));
      box.append(buttons);
      mask.append(box);
      document.body.append(mask);
      cancel.focus();
    });
  }

  const refuse = (reply, raw, message, quiet = false) => {
    reply(false, message);
    if (!quiet) hint(message);
    setTimeout(() => restore(raw), 0);
    return true;
  };

  // sidebar chat.send 队列调用。返回 true：已处理（reply 已回 res，不往下发）；'rewrite'：request 已改，照常发；false：照常发。
  async function intercept(key, req, reply) {
    const raw = req?.params?.message;
    if (typeof raw !== 'string' || !key || raw[0] !== '!') return false;
    if (!known) await readConfig();
    if (!enabled) return false;
    const bang = parseBang(raw);
    if (bang.kind !== 'command') {
      if (bang.text === raw) return false;
      req.params.message = bang.text;
      return 'rewrite';
    }
    hint('');
    const run = confirmed => request('pinkie.shell.run', {sessionKey: key, command: bang.command, ...(confirmed ? {confirmed} : {})}, 30_000);
    let out;
    try {
      out = await run(false);
      if (out?.status === 'confirm') {
        if (!(await confirmRun(out.command, out.cwd))) return refuse(reply, raw, '没有跑', true);
        out = await run(true);
      }
    } catch (error) {
      const message = String(error?.message || '命令没跑成');
      if (/还没打开/.test(message)) { enabled = false; return false; }
      return refuse(reply, raw, message);
    }
    // 回 ok：原生发送清草稿并马上刷新历史；inject 的「$ 命令」此时已在记录里，本地「!命令」气泡在刷新时被换掉。
    reply(true, {status: 'ok', runId: typeof req.params.idempotencyKey === 'string' ? req.params.idempotencyKey : null});
    const input = document.querySelector(INPUT);
    if (input) paintTag(input);
    return true;
  }

  document.addEventListener('input', event => {
    const input = event.target;
    if (!(input instanceof HTMLTextAreaElement) || !input.matches(INPUT)) return;
    if (event.isTrusted) hint('');
    paintTag(input);
  });

  function mount(target) {
    if (!target || target.querySelector('.pk-shell-card')) return;
    const card = el('section', S + 'card pk-shell-card');
    const head = el('header', S + 'card-header');
    const icon = el('span', S + 'icon', '$');
    icon.setAttribute('aria-hidden', 'true');
    head.append(icon, el('h3', S + 'card-title', '聊天里用 ! 直接跑命令'));
    const row = el('div', S + 'row');
    const copy = el('div', S + 'row-copy');
    copy.append(el('span', S + 'row-title', '打开'), el('span', S + 'hint', DESC));
    const control = el('div', S + 'row-control');
    const sw = el('button', S + 'switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', '聊天里用 ! 直接跑命令');
    sw.setAttribute('aria-checked', String(enabled));
    sw.append(el('span', S + 'switch-knob'));
    sw.onclick = async event => {
      event.stopPropagation();
      const next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(next));
      sw.disabled = true;
      try {
        const out = await request('pinkie.shell.config.set', {enabled: next});
        enabled = out?.enabled === true;
        known = true;
        sw.setAttribute('aria-checked', String(enabled));
      } catch (error) {
        sw.setAttribute('aria-checked', String(!next));
        toast('没改成：' + (error?.message || '不知道为什么'));
      } finally { sw.disabled = false; }
    };
    control.append(sw);
    row.append(copy, control);
    card.append(head, row);
    const footer = target.querySelector('.' + S + 'footer');
    footer ? footer.before(card) : target.append(card);
    const paint = () => readConfig().then(() => { if (!sw.disabled) sw.setAttribute('aria-checked', String(enabled)); });
    void paint();
    let shown = true;
    const watch = window.Pinkie?.domWatch?.poll?.(() => {
      if (!card.isConnected) { watch?.stop?.(); return; }
      const visible = Boolean(card.offsetParent);
      if (visible && !shown) void paint();
      shown = visible;
    }, 1200);
  }

  window.Pinkie = window.Pinkie || {};
  window.Pinkie.composerBang = {intercept, parseBang, isEnabled: () => enabled};
  window.addEventListener('pinkie:settings-ready', event => mount(event.detail));
  const ready = () => {
    mount(document.querySelector('#laolao-user-settings .' + S + 'scroll'));
    void readConfig();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true}); else ready();
})();
