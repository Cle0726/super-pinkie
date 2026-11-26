/* Metre 设置弹层里的「对话」卡片（「以后」S 级 M8 自动滚动三档 + G2 对话正文字号 / 行距 + I7 发送键可选）。
 *
 * 原生聊天设置齿轮在所有模式都被 laolao-ui-subtraction.css 藏掉了（#31，用户要求「对话栏去掉设置齿轮，侧栏设置入口保留」），
 * 所以不把齿轮露回来，而是在碧琪设置弹层（pinkie:settings-ready）里加一张卡片，只在 Metre 模式显示。
 *
 * M8 自动滚动：值归原生管。原生 openclaw-chat-pane 的 state.applySettings 会把 chatAutoScroll 存进
 * localStorage（openclaw.control.settings.v1:<网关>），重开还在。取值和原生一样：always / near-bottom / off。
 * 但从侧栏「设置」进来路由是 /settings/general，那时对话面板不在；设置页自己的 openclaw-config-page
 * 只认主题 / 圆角 / 字号，写 chatAutoScroll 不会存（浏览器实测）。所以设置页上点了先记成「待生效」
 * （本文件自己的 localStorage 键），一回到对话页就经对话面板的 applySettings 交给原生、清掉待生效。
 *
 * G2 字号 / 行距：不用原生 textScale——它是全局的，会连带改其他五个模式，而那边没有入口改回来。
 * 这里只在 Metre 生效：值存本文件自己的 localStorage 键，写成根元素上的 --metre-chat-fs / --metre-chat-lh，
 * 只有 laolao-metre-skin.css「对话页」那条 Metre 规则读它们；「标准」档不写变量，和原来逐像素一样。
 * G3「技能」卡：Metre 侧栏展开时原生导航（含 /skills）被 laolao-metre-skin.css 整个藏掉，设置弹层里也没有技能入口，
 * 这里补一个按钮，走原生路由 navigate('skills')（和 laolao-mode-switcher.js 同一写法），只做入口，不造后台。
 * 不新增观察器、定时器和 window 全局名；回到对话页的检测走 window.Pinkie.domWatch.poll。 */
(() => {
  'use strict';
  const S = 'pinkie-user-settings__';
  const PENDING = 'pinkie.metre.prefs.pendingAutoScroll';
  const TEXT_KEY = 'pinkie.metre.prefs.textSize';
  const LEAD_KEY = 'pinkie.metre.prefs.leading';
  const SCROLL = [['always', '始终'], ['near-bottom', '接近底部时'], ['off', '关闭']];
  const TEXT = [['s', '小', '14px'], ['m', '标准', ''], ['l', '大', '17px'], ['xl', '特大', '19px']];
  const LEADING = [['tight', '紧凑', '1.5'], ['normal', '标准', ''], ['loose', '宽松', '1.9']];
  const SEND_KEY = 'pinkie.metre.prefs.sendKey';
  const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '') ? '⌘' : 'Ctrl';
  const SEND = [['enter', 'Enter'], ['modifier-enter', MOD + ' + Enter']];
  const SUGGEST_KEY = 'pinkie.metre.prefs.nextSuggest', SUGGEST = [['on', '开'], ['off', '关']]; // I8：laolao-metre-suggest.js 读同一个键，off = 关
  const valid = (v) => SCROLL.some(([k]) => k === v);
  const known = (list, v, dflt) => (list.some(([k]) => k === v) ? v : dflt);
  const isMetre = () => document.documentElement.getAttribute('data-laolao-mode') === 'metre';
  const chatPane = () => { const st = document.querySelector('openclaw-chat-pane')?.state; return typeof st?.applySettings === 'function' && st.settings ? st : null; };
  // 只读：对话面板不在时，原生当前值在设置页的 openclaw-config-page 上（同一份设置）。
  const nativeValue = () => (chatPane() || document.querySelector('openclaw-config-page'))?.settings?.chatAutoScroll;
  const store = () => { try { return window.localStorage; } catch { return null; } };
  const readKey = (k) => { try { return store()?.getItem(k) ?? null; } catch { return null; } };
  const writeKey = (k, v) => { try { v ? store()?.setItem(k, v) : store()?.removeItem(k); } catch {} };
  const pending = () => { const v = readKey(PENDING); return valid(v) ? v : ''; };
  const setPending = (v) => writeKey(PENDING, v);
  const textSize = () => known(TEXT, readKey(TEXT_KEY), 'm');
  const leading = () => known(LEADING, readKey(LEAD_KEY), 'normal');
  const sendKey = () => known(SEND, readKey(SEND_KEY), 'enter');
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let card = null, skillsCard = null, scrollBtns = [], textBtns = [], leadBtns = [], sendBtns = [], suggestBtns = [], note = null;
  // G3：原生路由优先（不重载页面、不断网关），老版本退回 history + popstate，和 laolao-mode-switcher.js 一样。
  function openSkills() {
    const shell = document.querySelector('openclaw-app-shell');
    const nav = [shell, shell?.context].find((o) => typeof o?.navigate === 'function');
    if (nav) { nav.navigate('skills'); return; }
    window.history.pushState({}, '', '/skills');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  // G2：把字号 / 行距写成根元素上的变量；「标准」档去掉变量，Metre 规则回到原来的 15.5px / 1.7。
  function applyLook() {
    const style = document.documentElement.style;
    if (!style) return;
    const fs = TEXT.find(([k]) => k === textSize())[2], lh = LEADING.find(([k]) => k === leading())[2];
    fs ? style.setProperty('--metre-chat-fs', fs) : style.removeProperty('--metre-chat-fs');
    lh ? style.setProperty('--metre-chat-lh', lh) : style.removeProperty('--metre-chat-lh');
  }
  // 有待生效的值、对话面板又在：交给原生，清掉待生效。
  function flush() {
    const want = pending(), st = chatPane();
    if (!want || !st) return;
    if (st.settings.chatAutoScroll !== want) st.applySettings({...st.settings, chatAutoScroll: want});
    setPending('');
  }
  function current() {
    const want = pending(), v = nativeValue();
    return {value: want || (valid(v) ? v : 'near-bottom'), waiting: Boolean(want) && !chatPane()};
  }
  function mark(btns, value) {
    for (const [key, btn] of btns) {
      const on = key === value;
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('is-selected', on);
    }
  }
  function paint() {
    if (!card) return;
    card.hidden = !isMetre();
    if (skillsCard) skillsCard.hidden = card.hidden;
    if (card.hidden) return;
    const {value, waiting} = current();
    mark(scrollBtns, value);
    mark(textBtns, textSize());
    mark(leadBtns, leading());
    mark(sendBtns, sendKey());
    mark(suggestBtns, readKey(SUGGEST_KEY) === 'off' ? 'off' : 'on');
    note.hidden = !waiting;
  }
  function chooseScroll(key) {
    const st = chatPane();
    if (st) { setPending(''); if (st.settings.chatAutoScroll !== key) st.applySettings({...st.settings, chatAutoScroll: key}); }
    else setPending(key === nativeValue() ? '' : key);
    paint();
  }
  function chooseLook(storeKey, dflt, key) {
    writeKey(storeKey, key === dflt ? '' : key);
    applyLook();
    paint();
  }
  // 一行：标题 + 说明 + 一组互斥按钮；field 是按钮上 data-* 的名字（data-scroll / data-text / data-leading）。
  function segRow(id, label, hint, list, field, onPick) {
    const row = node('div', S + 'row');
    const copy = node('div', S + 'row-copy');
    const title = node('span', S + 'row-title', label); title.id = id;
    copy.append(title, node('span', S + 'hint', hint));
    const control = node('div', S + 'row-control');
    const group = node('div', S + 'segments'); group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', id);
    const btns = list.map(([key, text]) => {
      const btn = node('button', S + 'choice', text); btn.type = 'button'; btn.dataset[field] = key;
      btn.addEventListener('click', () => onPick(key));
      group.append(btn);
      return [key, btn];
    });
    control.append(group);
    row.append(copy, control);
    return [row, btns];
  }
  function mount(target) {
    if (!target || target.querySelector('.pk-metre-prefs')) return;
    card = node('section', S + 'card pk-metre-prefs');
    const head = node('header', S + 'card-header');
    const icon = node('span', S + 'icon', '♩'); icon.setAttribute('aria-hidden', 'true');
    head.append(icon, node('h3', S + 'card-title', '对话'));
    card.append(head, node('p', S + 'card-hint', '只对 Metre 的对话页生效的显示习惯。'));
    const [scrollRow, sb] = segRow('pk-metre-prefs-scroll', '自动滚动', '有新回答时，对话要不要自己滚到最下面。「接近底部时」：你往上翻着看的时候不打断你。', SCROLL, 'scroll', chooseScroll);
    scrollBtns = sb;
    note = node('p', S + 'hint pk-metre-prefs__note', '回到对话页就生效。');
    note.setAttribute('role', 'status');
    const [textRow, tb] = segRow('pk-metre-prefs-text', '字号', '对话里回答和你发的话的字号。', TEXT, 'text', (k) => chooseLook(TEXT_KEY, 'm', k));
    const [leadRow, lb] = segRow('pk-metre-prefs-leading', '行距', '行与行之间的距离。紧凑一屏看得多，宽松读长文更轻松。', LEADING, 'leading', (k) => chooseLook(LEAD_KEY, 'normal', k));
    // 组合键里用不换行空格，「Ctrl + Enter」不会被拆成两行（look.py 1024 / 1440 夜）。
    const combo = (MOD + ' + Enter').replace(/ /g, ' ');
    const [sendRow, nb] = segRow('pk-metre-prefs-send', '发送键', `按哪个键发出去。选 ${combo} 时，Enter 只换行。`, SEND, 'send', (k) => chooseLook(SEND_KEY, 'enter', k));
    const [suggestRow, gb] = segRow('pk-metre-prefs-suggest', '下一句建议', '回答完在输入框上方给两三条接着问的话，点一下只填进输入框，不会直接发出去。', SUGGEST, 'suggest', (k) => { writeKey(SUGGEST_KEY, k === 'off' ? 'off' : ''); paint(); window.Pinkie?.metreSuggest?.check(); });
    textBtns = tb; leadBtns = lb; sendBtns = nb; suggestBtns = gb;
    card.append(scrollRow, note, textRow, leadRow, sendRow, suggestRow);
    const footer = target.querySelector('.' + S + 'footer');
    footer ? footer.before(card) : target.append(card);
    skillsCard = node('section', S + 'card pk-metre-skills');
    const skHead = node('header', S + 'card-header');
    const skIcon = node('span', S + 'icon', '✦'); skIcon.setAttribute('aria-hidden', 'true');
    skHead.append(skIcon, node('h3', S + 'card-title', '技能'));
    const skRow = node('div', S + 'row'), skCopy = node('div', S + 'row-copy'), skControl = node('div', S + 'row-control');
    skCopy.append(node('span', S + 'row-title', '管理技能'), node('span', S + 'hint', '看看装了哪些技能，哪些可用、哪些还要设置，也可以停用。'));
    const skBtn = node('button', S + 'button pk-metre-skills__open', '打开技能'); skBtn.type = 'button';
    skBtn.addEventListener('click', openSkills);
    skControl.append(skBtn); skRow.append(skCopy, skControl);
    skillsCard.append(skHead, skRow);
    card.before(skillsCard);
    paint();
  }

  window.addEventListener('pinkie:settings-ready', (event) => mount(event.detail));
  // I7：选了「Ctrl / ⌘ + Enter」时，输入框里单按 Enter 只换行。原生发送和碧琪共用的 Enter 钩子（queue-steer / resume /
  // immersion / companion，都挂在 document 捕获阶段）都在这之后才收到事件，所以在 window 捕获阶段把这一下拦住：
  // 只停传播、不 preventDefault，换行照常落进输入框。原生 chatSendShortcut 不改（它是全局的，会连带其他五个模式）；
  // Ctrl / ⌘ + Enter 照常往下走，原生和共用钩子都按「发送」处理。输入法组字中、斜杠菜单开着时不拦。
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.keyCode === 229) return;
    if (!isMetre() || sendKey() !== 'modifier-enter') return;
    const ta = event.target?.closest?.('.agent-chat__composer-combobox textarea');
    if (!ta || ta.closest('.agent-chat__input')?.querySelector('.slash-menu')) return;
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('laolao:modechange', paint);
  const ready = () => { applyLook(); flush(); mount(document.querySelector('#laolao-user-settings .' + S + 'scroll')); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true}); else ready();
  // 回到对话页时把待生效的值交给原生；弹层开着时跟上原生的值。没有待生效、卡片又看不见时什么都不做。
  window.Pinkie?.domWatch?.poll(() => {
    if (pending()) flush();
    if (card && card.isConnected && !card.closest('[hidden]')) paint();
  }, 1200);
})();
