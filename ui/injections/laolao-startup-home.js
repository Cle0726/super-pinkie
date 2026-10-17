(() => {
  'use strict';
  // UI copy only. Nothing in this table is added to chat history or a prompt.
  const lines = Object.freeze({
    chat: {
      morning: ['晨光刚落上窗台，先生，早安', '新的一天还没写下一个字，先生想从哪句聊起？', '早安先生，咖啡的香气和碧琪，都已经在了'],
      noon: ['日头正高，影子缩成小小一团，先生歇一会儿吧', '午间的风走得很慢，适合说些不着急的话', '先生吃过饭了吗？这一刻留给闲聊就好'],
      afternoon: ['阳光斜进来一半，刚好够聊完一壶茶', '下午的时光有点黏，碧琪陪先生慢慢把它搅开', '窗外的云走得很慢，先生也不必着急'],
      evening: ['天色一点点暗下来，今天的事，说给碧琪听听？', '灯亮起来了，先生，辛苦了一整天', '晚风把白天吹远了，现在只剩先生和碧琪'],
      night: ['夜深了，连星星都放轻了声音，先生还醒着吗？', '这么静的夜，适合说些白天说不出口的话', '月亮在值夜班，碧琪也在，先生想聊点什么？'],
    },
    project: {
      morning: ['老板早，晨光正好，今天先把哪块砖砌上？', '图纸已经铺开，老板一句话，碧琪就动手', '清早的头脑最锋利，老板，开工吧'],
      noon: ['日到中天，进度也该过半了，老板想让碧琪盯哪一处？', '老板先去吃饭，键盘交给碧琪守着'],
      afternoon: ['下午的光很稳，正适合把最难啃的那块啃下来', '老板，趁这段安静，把卡住的地方理一理？'],
      evening: ['夕阳落进进度表里，老板，今天要收哪几个尾？', '灯下的活儿最见功夫，老板，剩下的交给碧琪'],
      night: ['夜深了，老板还在，那碧琪也在', '整座城都睡了，只有老板的项目还亮着灯'],
    },
    thinking: {
      morning: ['清晨的念头最干净，先生，趁它还没被日子揉皱', '早安先生，今天的第一个想法，想安放在哪里？'],
      noon: ['正午没有影子，想法也最透明，先生说来听听？', '一边发呆一边想事，是午间最好的奢侈'],
      afternoon: ['云在天上慢慢改着形状，先生的想法也可以', '下午适合把一个念头翻过来，看看它的背面'],
      evening: ['黄昏是白天和夜晚之间的缝，好想法常从那里漏出来', '天暗下来，脑子反倒亮了，先生在想什么？'],
      night: ['深夜的灵感像萤火，先生，趁它还亮着说给碧琪', '睡不着的夜里，想法会自己长出翅膀'],
    },
    learning: {
      morning: ['晨读的声音最好听，先生，翻开今天的第一页吧', '早安先生，脑子像刚擦净的黑板，正好写点新东西', '晨光正好，先生，要开始今天的学习了吗？'],
      noon: ['吃饱了，先生要不要把上午学的在心里过一遍？', '午睡之前，先生想温习哪一节？'],
      afternoon: ['下午适合做题，一道一道，像踩着台阶往上走', '先生上次停下的地方，碧琪还替先生夹着书签呢'],
      evening: ['灯下读书，是一天里最安静的事，先生今天学到哪儿了？', '白天学过的东西，正等着先生在晚上再看它一眼'],
      night: ['夜深了，先生还在学，碧琪陪着，可别熬太晚', '把今天学的轻轻合上吧，明天它会比今天更牢'],
    },
    unrestricted: {
      morning: ['先生早上好！现在可以畅所欲言啦～', '早安先生，今天这里没有门，也没有锁'],
      noon: ['正午的光照到每个角落，这里也没有什么要藏的'],
      afternoon: ['下午好先生，话想怎么说就怎么说，碧琪都接得住'],
      evening: ['天黑了，规矩也下班了，先生想聊点什么？'],
      night: ['夜深啦先生，这会儿最适合说真心话', '深夜里没有旁人，只有先生和碧琪'],
    },
  });
  const timeBucket = (date = new Date()) => {
    const hour = date.getHours();
    return hour >= 5 && hour < 11 ? 'morning' : hour < 13 && hour >= 11 ? 'noon'
      : hour >= 13 && hour < 18 ? 'afternoon' : hour >= 18 && hour < 23 ? 'evening' : 'night';
  };
  const greeting = (mode, date = new Date(), random = Math.random, cache = new Map()) => {
    const selected = Object.hasOwn(lines, mode) ? mode : 'chat';
    const bucket = timeBucket(date), key = `${selected}:${bucket}`;
    if (!cache.has(key)) {
      const choices = lines[selected][bucket];
      const index = Math.max(0, Math.min(choices.length - 1, Math.floor(random() * choices.length)));
      cache.set(key, choices[index]);
    }
    return cache.get(key);
  };
  window.PinkieStartupHomeData = Object.freeze({lines, timeBucket, greeting});
  if (window.__laolaoStartupHome) return;

  const root = document.documentElement;
  const onceKey = 'laolao:startup-home-seen';
  const url = new URL(window.location.href);
  let seen = false, switching = false;
  try {
    seen = sessionStorage.getItem(onceKey) === '1';
    switching = sessionStorage.getItem('laolao:skip-entry-splash') === '1'
      || Boolean(sessionStorage.getItem('laolao:mode-handoff'));
    sessionStorage.setItem(onceKey, '1');
  } catch { /* Navigation type still protects refresh when storage is disabled. */ }
  const navType = window.performance?.getEntriesByType?.('navigation')?.[0]?.type;
  const docked = () => new URL(window.location.href).searchParams.get('laolao-dock') === '1'
    || root.getAttribute('data-laolao-workspace-dock') === '1';
  // Cold launch shows the home once per window. A mode switch shows the new
  // mode's home too (in-page below; the rare reload fallback lands here).
  let active = /^\/chat\/?$/.test(url.pathname) && !docked()
    && (switching || (!seen && !['reload', 'back_forward'].includes(navType)));
  // This script runs in the head, before the native module can paint history.
  if (active) root.setAttribute('data-laolao-startup-home', '1');
  // Read the clock at each mount: a mode switch hours later gets that hour's line.
  const clock = () => typeof window.__laolaoStartupHomeClock === 'function'
    ? window.__laolaoStartupHomeClock() : new Date();
  const random = window.__laolaoStartupHomeRandom || Math.random;
  const greetingCache = new Map();
  const agentFor = mode => mode === 'chat' ? 'main' : mode;
  const mode = () => {
    const selected = root.getAttribute('data-laolao-mode');
    if (Object.hasOwn(lines, selected)) return selected;
    const session = new URL(window.location.href).searchParams.get('session') || '';
    const agent = /^agent:([^:]+):/.exec(session)?.[1];
    return agent === 'main' ? 'chat' : Object.hasOwn(lines, agent) ? agent : 'chat';
  };
  const sessionKey = () => new URL(window.location.href).searchParams.get('session') || '';
  const notify = message => {
    if (typeof window.__laolaoToast === 'function') window.__laolaoToast(message);
    else window.dispatchEvent(new CustomEvent('laolao:toast', {detail: {message}}));
  };
  let busy = false, ready = false, operation = 0, observer, revealObserver, scheduled = false;
  let sendingNative = false, creatingNative = false;
  let expectedModeSession = '', pendingDraft = null, nativeRequest = null;
  const previous = new Map();
  const remember = () => {
    const selected = mode(), key = sessionKey();
    if (key.startsWith(`agent:${agentFor(selected)}:`)) previous.set(selected, key);
  };
  remember();
  // 「继续之前的工作」: the mode's most recent conversations, newest first.
  const recent = new Map(), loadingRecent = new Set();
  const sessionTitle = item => {
    const values = [item.label, item.derivedTitle, item.title, item.displayName, item.name];
    const found = values.find(value => typeof value === 'string' && value.trim() && !/^agent:/.test(value.trim())
      && !/^(?:(?:.+?)\s*·\s*)?(?:新会话(?:\s*\d+)?|会话\s*\d+)$/.test(value.trim()));
    return found ? found.trim() : (String(item.key || '').endsWith(':main') ? '主会话' : '');
  };
  const requestRecent = selected => {
    if (recent.has(selected) || loadingRecent.has(selected) || typeof window.__laolaoSidebar?.gwRequest !== 'function') return;
    loadingRecent.add(selected);
    const agent = agentFor(selected);
    window.__laolaoSidebar.gwRequest('sessions.list', {agentId: agent, includeDerivedTitles: true, limit: 60})
      .then(result => {
        const rows = (result?.sessions || [])
          .filter(item => item.key?.startsWith(`agent:${agent}:`) && !item.key.includes(':subagent:') && !item.archived)
          .map(item => ({key: item.key, title: sessionTitle(item), at: Number(item.updatedAt) || 0}))
          .filter(item => item.title)
          .sort((x, y) => y.at - x.at).slice(0, 4);
        recent.set(selected, rows);
        schedule();
      }).catch(() => { recent.set(selected, []); })
      .finally(() => loadingRecent.delete(selected));
  };
  const when = at => {
    if (!at) return '';
    const date = new Date(at), now = new Date();
    const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((day(now) - day(date)) / 86400000);
    return diff <= 0 ? '今天' : diff === 1 ? '昨天' : `${date.getMonth() + 1}月${date.getDate()}日`;
  };
  const MODE_NAMES = {chat: '唠嗑模式', project: '项目模式', thinking: '想法模式', learning: '学习模式', unrestricted: '无限制模式'};
  const setDraft = (input, text) => {
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement?.prototype || {}, 'value')?.set;
    if (setter) setter.call(input, text); else input.value = text;
    input.dispatchEvent(new Event('input', {bubbles: true, composed: true}));
    return true;
  };
  const activePane = (key = sessionKey()) => {
    const panes = Array.from(document.querySelectorAll('openclaw-chat-pane'));
    const matching = panes.filter(pane => pane.state?.sessionKey === key);
    return matching.find(pane => pane.active === true) || matching[0]
      || panes.find(pane => pane.active === true) || panes[0] || null;
  };
  const currentInput = (pane = activePane()) => pane?.querySelector('.agent-chat__composer-combobox textarea');
  const paneReady = (pane, key) => {
    const state = pane?.state;
    const page = pane?.closest?.('openclaw-chat-page')
      || Array.from(document.querySelectorAll('openclaw-chat-page')).find(page => page.data?.sessionKey === key)
      || document.querySelector('openclaw-chat-page');
    const pageKey = page?.data?.sessionKey;
    return activePane(key) === pane && state?.sessionKey === key
      && (!pageKey || pageKey === key) && !state.chatLoading && !state.chatSending && !state.chatRunId
      && (!state.chatMessages || state.chatMessages.length === 0);
  };
  const releaseDraft = () => {
    if (!pendingDraft) return;
    const input = currentInput();
    if (input) { input.readOnly = false; setDraft(input, pendingDraft.text); }
    pendingDraft.input.readOnly = false;
    pendingDraft = null;
  };
  const leave = () => {
    if (!active) return;
    active = false; busy = false; operation++; nativeRequest = null;
    releaseDraft();
    root.removeAttribute('data-laolao-startup-home');
    root.removeAttribute('data-laolao-startup-ready');
    root.removeAttribute('data-laolao-startup-reveal');
    root.removeAttribute('data-laolao-startup-busy');
    document.querySelectorAll('.laolao-startup-home, .laolao-startup-home__recent').forEach(node => node.remove());
    observer?.disconnect();
    revealObserver?.disconnect();
  };
  const openSession = key => {
    leave();
    if (!key || sessionKey() === key) return;
    if (typeof window.__laolaoSidebar?.navigateSession === 'function') { window.__laolaoSidebar.navigateSession(key); return; }
    const row = Array.from(document.querySelectorAll('.shell-nav a[href*="session="]'))
      .find(item => new URL(item.href, window.location.href).searchParams.get('session') === key);
    if (row) row.click();
  };
  const chatGlyph = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h0.5A2.5 2.5 0 0 1 5 12.5Z"/></svg>';
  const mount = () => {
    if (!active) return;
    if (root.getAttribute('data-laolao-workspace-dock') === '1') { leave(); return; }
    const main = document.querySelector('.chat-main');
    if (!main) return;
    let home = main.querySelector('.laolao-startup-home');
    if (!home) {
      home = document.createElement('section');
      home.className = 'laolao-startup-home';
      home.setAttribute('aria-label', '碧琪的首页');
      const welcome = document.createElement('div');
      welcome.className = 'agent-chat__welcome';
      welcome.setAttribute('data-laolao-minimal-welcome', '1');
      const text = document.createElement('h2');
      text.className = 'laolao-startup-home__greeting';
      welcome.append(text);
      home.append(welcome);
      main.insertBefore(home, main.firstChild);
    }
    const selected = mode();
    const text = home.querySelector('h2');
    const line = greeting(selected, clock(), random, greetingCache);
    if (text.textContent !== line) text.textContent = line;
    let list = Array.from(main.children).find(node => node.classList?.contains('laolao-startup-home__recent'));
    if (!list) {
      list = document.createElement('section');
      list.className = 'laolao-startup-home__recent';
      list.setAttribute('aria-label', '继续之前的工作');
      main.append(list);
    }
    requestRecent(selected);
    const rows = recent.get(selected) || [];
    const signature = JSON.stringify([selected, busy, rows]);
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.replaceChildren();
      if (rows.length) {
        const heading = document.createElement('h3');
        heading.textContent = '继续之前的工作';
        list.append(heading);
        for (const item of rows) {
          const entry = document.createElement('button');
          entry.type = 'button'; entry.className = 'laolao-startup-home__item';
          entry.disabled = busy; entry.title = item.title;
          const icon = document.createElement('span');
          icon.className = 'laolao-startup-home__icon'; icon.innerHTML = chatGlyph;
          const body = document.createElement('span'); body.className = 'laolao-startup-home__item-body';
          const name = document.createElement('span'); name.className = 'laolao-startup-home__item-title'; name.textContent = item.title;
          const meta = document.createElement('span'); meta.className = 'laolao-startup-home__item-meta';
          meta.textContent = [MODE_NAMES[selected], when(item.at)].filter(Boolean).join(' · ');
          body.append(name, meta); entry.append(icon, body);
          entry.addEventListener('click', () => openSession(item.key));
          list.append(entry);
        }
      }
    }
    if (ready) root.setAttribute('data-laolao-startup-ready', '1');
  };
  function schedule() {
    if (!active || scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => { scheduled = false; mount(); });
  }
  const waitFor = async (predicate, token, milliseconds, message = '会话暂时没有准备好，原文已保留，请再试一次。') => {
    const deadline = Date.now() + milliseconds;
    while (active && token === operation && Date.now() < deadline) {
      const value = predicate(); if (value) return value;
      await new Promise(resolve => window.setTimeout(resolve, 40));
    }
    throw new Error(message);
  };
  const ownsNativeRequest = request => nativeRequest === request && active && busy
    && operation === request.token && mode() === request.mode && sessionKey() === request.key
    && activePane(request.key) === request.pane && request.pane.state?.sessionKey === request.key;
  // The existing tier / WebGPT interceptors own asynchronous preparation.
  // Give their replay a scoped lease; never keep the window capture bypass
  // open while waiting, and never send a retired operation into another pane.
  const delegateNativeSend = (button, prepare) => {
    const request = nativeRequest;
    if (!request || request.button !== button || !ownsNativeRequest(request)) return false;
    const isCurrent = () => ownsNativeRequest(request);
    const replay = () => {
      if (!isCurrent() || !paneReady(request.pane, request.key)
          || currentInput(request.pane)?.value !== request.text || button.disabled || !button.isConnected) return false;
      const previousBypass = sendingNative;
      sendingNative = true;
      try { button.click(); } finally { sendingNative = previousBypass; }
      return true;
    };
    request.preparations.push(Promise.resolve().then(() => isCurrent()
      ? prepare(replay, isCurrent, {text: request.text, input: request.input}) : {status: 'cancelled'}));
    return true;
  };
  const sendFromHome = async (input, pane, dispatch) => {
    if (!active || busy || !input?.value?.trim()) return false;
    const create = document.querySelector('.sidebar-new-session');
    if (!create || create.disabled) { notify('新会话暂时没有准备好，文字还在输入框里。'); return false; }
    const originalKey = sessionKey(), selected = mode(), text = input.value;
    const attachments = Array.isArray(pane?.state?.chatAttachments) ? [...pane.state.chatAttachments] : null;
    busy = true; const token = ++operation;
    pendingDraft = {text, input}; input.readOnly = true;
    root.setAttribute('data-laolao-startup-busy', '1'); mount();
    try {
      // Use the existing sidebar workflow, including project binding, names,
      // routing and deduplication. It is the only owner of sessions.create.
      creatingNative = true;
      try { create.click(); } finally { creatingNative = false; }
      const next = await waitFor(() => {
        if (mode() !== selected) return null;
        const key = sessionKey();
        const livePane = activePane(key);
        return key && key !== originalKey && key.startsWith(`agent:${agentFor(selected)}:`)
          && paneReady(livePane, key) && currentInput(livePane)
          ? {key, pane: livePane, input: currentInput(livePane)} : null;
      }, token, 25000);
      next.input.readOnly = true;
      if (attachments?.length) { next.pane.state.chatAttachments = attachments; next.pane.requestUpdate?.(); }
      setDraft(next.input, text);
      await Promise.resolve(next.pane.updateComplete);
      if (!active || token !== operation || mode() !== selected || sessionKey() !== next.key
          || !paneReady(next.pane, next.key)) throw new Error('会话已切换，原文已保留。');
      const send = next.pane.querySelector('.chat-send-btn:not(.chat-send-btn--stop)');
      if (!send || send.disabled) throw new Error('发送暂时没有准备好，原文已保留。');
      const request = {token, mode: selected, key: next.key, pane: next.pane, input: next.input, button: send, text, preparations: []};
      nativeRequest = request;
      // No direct chat.send RPC: the native composer keeps its own attachment,
      // queue, idempotency and offline semantics.
      if (dispatch) await dispatch({input: next.input, pane: next.pane, button: send});
      else {
        sendingNative = true;
        try { send.click(); } finally { sendingNative = false; }
      }
      let delivery = 'native';
      for (let index = 0; index < request.preparations.length; index++) {
        const result = await request.preparations[index];
        if (!ownsNativeRequest(request)) throw new Error('会话已切换，原文已保留。');
        if (result?.status === 'blocked' || result?.status === 'cancelled') {
          const error = new Error(result.reason || '发送已停止，原文已保留。');
          error.notified = result.notified; throw error;
        }
        if (result?.status === 'web-direct') delivery = 'web-direct';
      }
      // Start the native acceptance window only after preparation finishes.
      // Web-direct has already confirmed delivery and written its transcript;
      // it intentionally never produces a native chatSending/user event.
      if (delivery !== 'web-direct') await waitFor(() => ownsNativeRequest(request)
        && (next.pane.state?.chatSending || next.pane.state?.chatRunId
          || next.pane.state?.chatMessages?.some(message => message.role === 'user')),
      token, 4000, '消息暂时没有确认发送，原文已保留，请再试一次。');
      next.input.readOnly = false; input.readOnly = false; pendingDraft = null;
      leave();
      return true;
    } catch (error) {
      if (token === operation) {
        releaseDraft(); busy = false;
        nativeRequest = null;
        root.removeAttribute('data-laolao-startup-busy'); mount();
        if (!error.notified) notify(error.message || '暂时没能送出，原文已保留。');
      }
      return false;
    }
  };
  window.__laolaoStartupHome = {
    get active() { return active; }, get busy() { return busy; },
    leave, mount, sendFromHome, delegateNativeSend,
    refreshRecent: () => { recent.clear(); schedule(); },
    status: () => ({active, busy, ready, mode: mode(), sessionKey: sessionKey()}),
  };
  const materialize = () => {
    const welcome = document.querySelector('.laolao-startup-home .agent-chat__welcome');
    welcome?.classList.remove('laolao-welcome--materializing');
    window.requestAnimationFrame(() => welcome?.classList.add('laolao-welcome--materializing'));
    window.setTimeout(() => welcome?.classList.remove('laolao-welcome--materializing'), 1100);
  };
  const watch = () => {
    observer?.disconnect();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {childList: true, subtree: true});
  };
  // Mode switch: the transition cover is up when the handoff fires, so the
  // home is in place before the new mode's history could ever be seen.
  const enter = () => {
    if (docked()) return;
    if (active) { remember(); schedule(); return; }
    active = true; busy = false; ready = true; operation++;
    root.setAttribute('data-laolao-startup-home', '1');
    watch(); mount();
  };
  const pathMatch = (event, selector) => (event.composedPath?.() || [])
    .find(node => node?.matches?.(selector)) || event.target?.closest?.(selector);
  window.addEventListener('keydown', event => {
    if (!active || event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    const input = pathMatch(event, '.agent-chat__composer-combobox textarea');
    if (!input) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void sendFromHome(input, input.closest?.('openclaw-chat-pane') || activePane());
  }, true);
  window.addEventListener('click', event => {
    if (!active || sendingNative) return;
    const send = pathMatch(event, '.chat-send-btn:not(.chat-send-btn--stop)');
    if (send && !send.disabled) {
      event.preventDefault(); event.stopImmediatePropagation();
      const pane = send.closest?.('openclaw-chat-pane') || activePane();
      if (!busy) void sendFromHome(currentInput(pane), pane);
    } else if (!creatingNative && pathMatch(event, '.shell-nav a[href*="session="], .sidebar-new-session')) leave();
  }, true);
  window.addEventListener('pinkie:session-selected', event => {
    if (!active || busy) return;
    if (event.detail?.sessionKey === expectedModeSession) { expectedModeSession = ''; return; }
    leave();
  });
  window.addEventListener('laolao:mode-session-handoff', event => {
    expectedModeSession = event.detail?.sessionKey || '';
    if (event.detail?.mode && expectedModeSession) previous.set(event.detail.mode, expectedModeSession);
    if (busy) { operation++; releaseDraft(); busy = false; root.removeAttribute('data-laolao-startup-busy'); }
    enter();
  });
  window.addEventListener('laolao:mode-transition-finished', () => {
    if (!active) return;
    mount(); materialize();
  });
  window.addEventListener('laolao:modechange', () => {
    if (!active) return;
    if (busy) { operation++; releaseDraft(); busy = false; root.removeAttribute('data-laolao-startup-busy'); }
    remember(); schedule();
  });
  window.addEventListener('laolao:splash-cleared', event => {
    if (!active) return;
    if (event.detail?.docked) { leave(); return; }
    ready = true; mount();
    root.removeAttribute('data-laolao-startup-reveal');
    revealObserver?.disconnect();
    materialize();
  });
  const boot = () => {
    if (!active) return;
    const splash = document.getElementById('laolao-splash');
    if (!splash) ready = true;
    mount();
    if (splash) {
      // The existing entry movie uncovers the page before removing its host.
      // Prepare the homepage underneath that cover, so its hole/fade cannot
      // reveal bare wallpaper. The normal splash-cleared event still owns
      // the greeting and particle entrance; the movie itself is unchanged.
      const prepareReveal = () => {
        if (!active || ready || !splash.classList.contains('is-fx-leaving')
            && !splash.classList.contains('is-leaving')) return;
        root.setAttribute('data-laolao-startup-reveal', '1');
        mount();
        revealObserver?.disconnect();
      };
      revealObserver = new MutationObserver(prepareReveal);
      revealObserver.observe(splash, {attributes: true, attributeFilter: ['class']});
      prepareReveal();
    }
    watch();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once: true});
  else boot();
})();
