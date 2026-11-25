/* laolao-metre-read —— M14：Metre 里「朗读这条回答」（11-24）。
 *
 * 碧琪已有的朗读（laolao-live-voice.js → 原生 laolaoLiveVoice）只在「语音输入的那一轮」自动念重点，
 * 没有「点一下念这条」的键；原生桥也不回报什么时候念完，键的「正在念 / 停」状态没法跟上。
 * 所以这里用系统自带的语音合成（speechSynthesis，有开始、结束、出错事件；学习台单词朗读用的也是它）：
 *   - 每条助手回答底部的按键行里加一个「朗读」键；念的时候变成「停止朗读」，念完、出错、换会话、离开 Metre 都会复原。
 *   - 一次只念一条：点另一条会先停掉正在念的。
 *   - 念的是整条回答的正文（不念代码块、工具输出、链接、来源角标的数字）；长文按句子分段排队，避开浏览器长句被截断。
 *   - 没有语音合成的环境（或一个中文 / 任何声音都没有）不出这个键。
 * 只在 Metre 里生效；其他模式一个字不动。不调网关、不加定时器、不新增 window.__ 全局名。 */
(() => {
  'use strict';
  const ns = (window.Pinkie = window.Pinkie || {});
  if (ns.metreRead) return;

  const root = document.documentElement;
  const isMetre = () => root.getAttribute('data-laolao-mode') === 'metre';
  const synth = () => window.speechSynthesis || null;
  const ICON_PLAY = '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/>';
  // 「停止朗读」：播放器通用的实心圆角方块停止键。11-24 打回：原来只是一个空心细框，认不出来；
  // 试过「圆圈里一个小方块」，看图像录音键，所以只用实心方块。
  const ICON_STOP = '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>';
  const LABEL = {idle: '朗读', playing: '停止朗读'};

  // ---------- 要念的文字 ----------
  const SKIP = 'pre, code, .chat-tool-card, .chat-activity-group, .pinkie-cite, .pinkie-sources, .katex-mathml, .pinkie-msg-row, .pinkie-fork-action, button';
  function readableText(group) {
    const parts = [];
    // 段落、列表项、标题各成一行，念起来才有停顿。
    const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th';
    for (const box of group.querySelectorAll('.chat-bubble .chat-text')) {
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      let node, line = '', block;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest(SKIP)) continue;
        const own = node.parentElement?.closest(BLOCK) || box;
        if (own !== block && line) { parts.push(line); line = ''; }
        block = own;
        line += node.nodeValue || '';
      }
      if (line) parts.push(line);
    }
    return parts.map(text => text.replace(/https?:\/\/\S+/g, '').replace(/[*`_~#|[\]{}]/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean).join('\n');
  }
  // 浏览器一次念太长会被截断：按句号、问号、换行切开，每段不超过 160 字。
  function chunks(text) {
    const out = [];
    for (const sentence of text.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || []) {
      let rest = sentence.trim();
      while (rest.length > 160) {
        const cut = Math.max(rest.lastIndexOf('，', 160), rest.lastIndexOf(',', 160), rest.lastIndexOf(' ', 160));
        const at = cut > 40 ? cut + 1 : 160;
        out.push(rest.slice(0, at)); rest = rest.slice(at).trim();
      }
      if (rest) out.push(rest);
    }
    return out;
  }
  function pickVoice(text) {
    const voices = synth()?.getVoices?.() || [];
    const chinese = /[㐀-鿿]/u.test(text);
    const want = chinese ? /^zh(-|_|$)/i : /^en(-|_|$)/i;
    return voices.find(v => want.test(v.lang) && /natural|neural|online/i.test(v.name))
      || voices.find(v => want.test(v.lang) && v.localService)
      || voices.find(v => want.test(v.lang)) || null;
  }

  // ---------- 播放 ----------
  let current = null;   // {group, button, run}
  function setState(button, state) {
    if (!button) return;
    const playing = state === 'playing';
    button.dataset.state = state;
    button.setAttribute('aria-pressed', playing ? 'true' : 'false');
    button.setAttribute('aria-label', LABEL[state]);
    // 悬停提示由 laolao-metre-cite.css 用 aria-label 画（::after），不再设 title，免得系统提示和它叠两层。
    button.removeAttribute('title');
    button.querySelector('svg').innerHTML = playing ? ICON_STOP : ICON_PLAY;
  }
  function stop() {
    if (!current) return;
    const {group, run} = current;
    current = null;
    run.cancelled = true;
    try { synth()?.cancel(); } catch {}
    for (const button of group.isConnected ? group.querySelectorAll('.pk-mread') : []) setState(button, 'idle');
  }
  function play(group, button) {
    const speech = synth();
    const text = readableText(group);
    if (!speech || !text) return false;
    stop();
    const parts = chunks(text);
    const run = {cancelled: false};
    current = {group, button, run};
    setState(button, 'playing');
    const voice = pickVoice(text);
    let index = 0;
    const finish = () => { if (current?.run === run) stop(); };
    const next = () => {
      if (run.cancelled) return;
      if (index >= parts.length) { finish(); return; }
      const say = new SpeechSynthesisUtterance(parts[index++]);
      if (voice) { say.voice = voice; say.lang = voice.lang; } else say.lang = /[㐀-鿿]/u.test(text) ? 'zh-CN' : 'en-US';
      say.rate = 1;
      say.onend = next;
      say.onerror = finish;
      speech.speak(say);
    };
    try { speech.cancel(); } catch {}
    next();
    return true;
  }

  // ---------- 按键 ----------
  function makeButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pinkie-msg-btn pk-mread';
    const icon = document.createElement('span');
    icon.className = 'pinkie-msg-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg>';
    button.append(icon);
    setState(button, 'idle');
    button.addEventListener('click', event => {
      event.stopPropagation();
      const group = button.closest('.chat-group.assistant');
      if (!group) return;
      if (current?.group === group) stop(); else play(group, button);
    });
    return button;
  }
  const available = () => typeof window.SpeechSynthesisUtterance === 'function' && Boolean(synth());
  function paint() {
    if (!isMetre() || !available()) { cleanup(); return; }
    for (const group of document.querySelectorAll('.chat-group.assistant')) {
      if (group.classList.contains('chat-group--timeline-step') || group.closest('.pinkie-session-cards')) continue;
      if (group.querySelector('.chat-bubble.streaming')) continue;   // 还在出字的不给键，念完整的
      // 碧琪的按键行（复制、重新回答……）在就放进去；它要等后端的消息元数据，没来时放进原生底部按键区。
      const slot = group.querySelector('.chat-group-footer .pinkie-msg-row--assistant') || group.querySelector('.chat-group-footer .chat-group-footer-actions');
      if (!slot) continue;
      const old = group.querySelector('.pk-mread');
      if (old && old.parentElement === slot) continue;
      if (!readableText(group)) { old?.remove(); continue; }
      const button = old || makeButton();
      if (current?.group === group) { current.button = button; setState(button, 'playing'); }
      slot.append(button);
    }
  }
  function cleanup() {
    stop();
    for (const button of document.querySelectorAll('.pk-mread')) button.remove();
  }

  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); }); };
  // 一个监听同时管两件事：新出现的按键行补上朗读键；正在念的那条被删掉（删除消息、换分支、会话重载）就停。
  window.Pinkie?.domWatch?.watch('.chat-group.assistant .chat-group-footer-actions', () => {
    if (current && !current.group.isConnected) stop();
    schedule();
  }, {immediate: true, always: true});
  window.addEventListener('laolao:modechange', schedule);
  window.addEventListener('pinkie:session-selected', stop);
  window.addEventListener('pagehide', stop);

  ns.metreRead = Object.freeze({readableText, chunks, play, stop, get playing() { return Boolean(current); }});
})();
