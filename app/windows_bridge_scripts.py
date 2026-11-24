"""Injected JavaScript bridge and native reading-surface scripts for the Windows WebView2 host."""

BRIDGE_SCRIPT = r"""
(() => {
  if (location.protocol === 'file:') return;
  document.documentElement.setAttribute('data-pinkie-native-glass', '1');
  document.documentElement.setAttribute('data-pinkie-platform', 'windows');
  const call = (name, payload) => payload === undefined
    ? window.pywebview?.api?.[name]?.()
    : window.pywebview?.api?.[name]?.(payload);
  const handlers = {
    laolaoParty: { postMessage: () => call('open_party') },
    laolaoRoundtable: { postMessage: () => call('open_roundtable') },
    laolaoProjectFolder: { postMessage: payload => call('project_folder', payload).then(result => window.__laolaoProjectFolderResult?.(result)) }
  };
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = Object.assign(window.webkit.messageHandlers || {}, handlers);

  // The web UI talks to a native shell through these names on both platforms.
  // Mac registers them as WKScriptMessageHandlers; here each one forwards to the
  // matching pywebview method so the same page code works unchanged.
  handlers.laolaoWindowControl = { postMessage(payload) {
    const action = payload?.action;
    if (action === 'toggle-fullscreen') return call('toggle_fullscreen');
    if (action === 'appearance') return call('apply_appearance', {dark: Boolean(payload?.dark), mode: payload?.mode});
    return undefined;
  }};

  handlers.pinkieMotion = { postMessage(payload) {
    return call('apply_motion_preference', {reduce: Boolean(payload?.reduce)});
  }};

  handlers.laolaoWorkspaceDock = { postMessage(payload) {
    const action = payload?.action;
    if (action === 'close') return call('close_workspace_dock');
    if (action === 'open') return call('open_workspace_dock', {
      mode: payload?.mode, sessionKey: payload?.sessionKey,
    });
    return undefined;
  }};

  // The Mac shell stamps the dock state on <html> before the page runs. Mirror
  // the same attributes here: the shared CSS and the mode switcher both read
  // them to lay out the split and to offer the way back out.
  const dockState = state => {
    const root = document.documentElement;
    root.toggleAttribute('data-laolao-workspace-split', Boolean(state?.open));
    // `data-laolao-workspace-dock` marks the *companion* pane, which is this
    // document only when it was opened with laolao-dock=1.
    if (new URLSearchParams(location.search).get('laolao-dock') === '1') {
      root.setAttribute('data-laolao-workspace-dock', '1');
    }
  };
  window.__pinkieWorkspaceDockState = dockState;
  dockState({open: false});

  handlers.laolaoNativeDictation = { postMessage(payload) {
    if (payload?.action === 'stop') call('stop_dictation');
    else call('start_dictation');
  }};

  let spokenAudio = null;
  handlers.laolaoLiveVoice = { postMessage(payload) {
    if (payload?.action === 'stop') {
      spokenAudio?.pause();
      spokenAudio = null;
      return;
    }
    const text = String(payload?.text || '').trim();
    if (!text) return;
    fetch('http://127.0.0.1:18888/v1/audio/speech', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({input:text,voice:'zh-CN-XiaoyiNeural'})
    }).then(response => response.ok ? response.blob() : Promise.reject())
      .then(blob => { spokenAudio = new Audio(URL.createObjectURL(blob)); return spokenAudio.play(); })
      .catch(() => {});
  }};

  // Object.assign copies the entries that exist *at the moment it is called*.
  // The first merge above therefore published only the three handlers written
  // into the literal; everything registered afterwards -- window controls,
  // motion, the workspace dock, dictation, live voice -- stayed invisible to
  // the page. On Windows that cost the split-workspace entry entirely, plus a
  // fullscreen button that did nothing, no appearance sync and no dictation,
  // while the identical page worked on macOS because WKScriptMessageHandlers
  // are registered natively instead of being merged by JavaScript.
  // Merge once more now that every handler exists, then announce the bridge.
  window.webkit.messageHandlers = Object.assign(window.webkit.messageHandlers || {}, handlers);
  window.dispatchEvent(new Event('pinkie-native-bridge-ready'));

  const installDictation = () => {
    const actions = document.querySelector('.agent-chat__composer-actions');
    if (!actions || document.getElementById('laolao-native-dictation')) return;
    const button = document.createElement('button');
    button.id = 'laolao-native-dictation';
    button.type = 'button';
    button.className = 'chat-send-btn chat-send-btn--laolao-dictation';
    button.setAttribute('aria-label','碧琪听着呢');
    button.innerHTML = '<svg class="laolao-dictation-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="3" width="7" height="11" rx="3.5"></rect><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7"></path></svg><span class="agent-chat__control-label"></span>';
    let active = false, baseDraft = '';
    const editor = () => document.querySelector('.agent-chat__composer-combobox textarea');
    window.__laolaoNativeDictationUpdate = payload => {
      if (typeof payload?.transcript === 'string' && editor()) {
        editor().value = baseDraft + payload.transcript;
        editor().dataset.laolaoVoiceDraft = '1';
        editor().dispatchEvent(new Event('input',{bubbles:true}));
        window.dispatchEvent(new CustomEvent('laolao:dictation-draft'));
      }
      active = payload?.state === 'recording';
      button.classList.toggle('is-recording',active);
      button.setAttribute('aria-label',payload?.message || (active?'收好啦':'碧琪听着呢'));
    };
    button.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      if (active) handlers.laolaoNativeDictation.postMessage({action:'stop'});
      else { baseDraft = editor()?.value || ''; handlers.laolaoNativeDictation.postMessage({action:'start'}); }
    };
    actions.prepend(button);
  };
  installDictation();
  const dictationTimer = setInterval(installDictation, 900);

  // WebView2 reports the navigation as loaded while the document can still be
  // mid-parse, so `document.body` is not guaranteed to exist yet.  The drag
  // strip went in with `document.body.append(...)`, which threw
  // "Cannot read properties of null (reading 'append')" whenever the app was
  // still waiting for its gateway and the shell had only just started
  // navigating.  Install the chrome only once the document can take it.
  const installWindowChrome = () => {
    if (!document.body || !document.head) return false;
    if (document.getElementById('pinkie-native-window-controls')) return true;
    const drag = document.createElement('div');
    drag.className = 'pywebview-drag-region';
    drag.id = 'pinkie-native-drag-strip';
    drag.setAttribute('aria-label','拖动窗口；双击可最大化');
    drag.addEventListener('dblclick', event => {
      event.preventDefault(); call('toggle_maximize');
    });
    document.body.append(drag);
    const resize = document.createElement('div');
    resize.id = 'pinkie-native-resize-handles';
    resize.innerHTML = ['n','ne','e','se','s','sw','w','nw']
      .map(edge => `<i data-edge="${edge}" aria-hidden="true"></i>`).join('');
    resize.addEventListener('pointerdown', event => {
      const edge = event.target.closest('[data-edge]')?.dataset.edge;
      if (event.button === 0 && edge) { event.preventDefault(); call('begin_resize', edge); }
    });
    document.body.append(resize);
    const controls = document.createElement('div');
    controls.id = 'pinkie-native-window-controls';
    controls.setAttribute('role', 'toolbar');
    controls.setAttribute('aria-label', '窗口操作');
    const captionIcon = paths => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${paths}</svg>`;
    const maximizeIcon = '<rect x="4.5" y="4.5" width="11" height="11" rx="1.5"/>';
    const restoreIcon = '<path d="M7.5 4.5v-1h9v9h-1"/><rect x="3.5" y="6.5" width="10" height="10" rx="1.5"/>';
    controls.innerHTML = '<button type="button" class="pinkie-update-control" data-act="update" aria-label="主动拉取更新" title="检查更新">'
      + captionIcon('<g class="pk-loop"><path d="M15.6 8.3A6 6 0 0 0 4.9 6.6"/><path d="M4.4 3.6v3.5h3.5"/><path d="M4.4 11.7a6 6 0 0 0 10.7 1.7"/><path d="M15.6 16.4v-3.5h-3.5"/></g>'
        + '<path class="pk-star" d="M10 6.6c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3Z"/>')
      + '<i class="pinkie-update-badge" aria-hidden="true"></i></button>'
      + '<button type="button" data-act="full" aria-label="切换全屏" title="切换全屏（F11）">' + captionIcon('<path d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13"/>') + '</button>'
      + '<button type="button" data-act="min" aria-label="最小化" title="最小化">' + captionIcon('<path d="M4.5 12.5h11"/>') + '</button>'
      + '<button type="button" data-act="max" aria-label="最大化" title="最大化" aria-pressed="false">' + captionIcon(maximizeIcon) + '</button>'
      + '<button type="button" data-act="close" aria-label="关闭" title="关闭">' + captionIcon('<path d="m5 5 10 10M15 5 5 15"/>') + '</button>';
    const toast = message => {
      let node = document.getElementById('pinkie-update-toast');
      if (!node) { node = document.createElement('div'); node.id = 'pinkie-update-toast'; document.body.append(node); }
      node.textContent = message; node.classList.add('is-visible');
      clearTimeout(node._timer); node._timer = setTimeout(() => node.classList.remove('is-visible'), 2600);
    };
    window.__pinkieUpdateAvailable = info => {
      if (!info?.available) return;
      controls.querySelector('[data-act="update"]')?.classList.add('has-update');
    };
    const updateDialog = info => {
      if (window.__pinkieUpdateDialog?.open(info)) return;
      document.getElementById('pinkie-update-dialog')?.remove();
      const shade = document.createElement('div'); shade.id = 'pinkie-update-dialog';
      const card = document.createElement('section'); card.className = 'pinkie-update-card';
      const mark = document.createElement('span'); mark.className = 'pinkie-update-mark'; mark.textContent = '✦';
      const title = document.createElement('h3'); title.textContent = '碧琪找到新衣服啦';
      const copy = document.createElement('p'); copy.textContent = `新版本 ${info.version} 已经准备好。更新只替换 App，不会碰人格、会话、项目和上下文。`;
      const notes = document.createElement('ul'); notes.className = 'pinkie-update-notes';
      String(info.notes || '').split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
        const item = document.createElement('li'); item.textContent = line; notes.append(item);
      });
      if (!notes.childElementCount) notes.hidden = true;
      const status = document.createElement('p'); status.className = 'pinkie-update-status'; status.textContent = '更新完成后会自动回来。';
      const actions = document.createElement('div');
      const later = document.createElement('button'); later.textContent = '晚点再说'; later.onclick = () => shade.remove();
      const install = document.createElement('button'); install.className = 'primary'; install.textContent = '更新并重启';
      install.onclick = async () => {
        install.disabled = true; later.disabled = true; status.textContent = '正在把新版安全地收好…'; card.classList.add('is-working');
        const ready = await call('prepare_update');
        if (!ready?.ready) { install.disabled = false; later.disabled = false; card.classList.remove('is-working'); status.textContent = ready?.message || '网络有点晃，稍后再试就好。'; return; }
        status.textContent = '校验完成。窗口会先关掉，换好后自动打开新版，可能要几分钟；这期间不用自己打开碧琪。';
        const applied = await call('apply_update');
        if (!applied?.started) { install.disabled = false; later.disabled = false; card.classList.remove('is-working'); status.textContent = applied?.message || '还没有完成，稍后再试。'; }
      };
      actions.append(later, install); card.append(mark, title, copy, notes, status, actions); shade.append(card); document.body.append(shade);
    };
    window.__pinkieShowInstalledNotes = info => {
      if (window.__pinkieUpdateDialog?.showInstalled?.(info)) return;
      document.getElementById('pinkie-update-dialog')?.remove();
      const shade = document.createElement('div'); shade.id = 'pinkie-update-dialog';
      const card = document.createElement('section'); card.className = 'pinkie-update-card';
      const mark = document.createElement('span'); mark.className = 'pinkie-update-mark'; mark.textContent = '✦';
      const title = document.createElement('h3'); title.textContent = `已经换上 ${info.version || ''}`;
      const copy = document.createElement('p'); copy.textContent = '这次更新了这些：';
      const notes = document.createElement('ul'); notes.className = 'pinkie-update-notes';
      String(info.notes || '').split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
        const item = document.createElement('li'); item.textContent = line; notes.append(item);
      });
      const actions = document.createElement('div');
      const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = '知道了';
      ok.onclick = () => shade.remove();
      actions.append(ok); card.append(mark, title, copy, notes, actions); shade.append(card); document.body.append(shade);
    };
    window.__pinkieShowUpdateFailed = info => {
      document.getElementById('pinkie-update-dialog')?.remove();
      const shade = document.createElement('div'); shade.id = 'pinkie-update-dialog';
      const card = document.createElement('section'); card.className = 'pinkie-update-card';
      const mark = document.createElement('span'); mark.className = 'pinkie-update-mark'; mark.textContent = '✦';
      const title = document.createElement('h3'); title.textContent = `新版 ${info.version || ''} 没有装上`;
      const copy = document.createElement('p');
      copy.textContent = `已经自动回到 ${info.current || '原来的版本'}，记忆和设置都在。可以再点一次更新；还不行的话，关掉碧琪后手动下载新版。`;
      const detail = document.createElement('p'); detail.className = 'pinkie-update-status'; detail.textContent = String(info.message || '');
      const actions = document.createElement('div');
      const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = '知道了';
      ok.onclick = () => shade.remove();
      actions.append(ok); card.append(mark, title, copy, detail, actions); shade.append(card); document.body.append(shade);
    };
    window.__pinkiePresentUpdate = info => {
      if (!info?.available) return;
      window.__pinkieUpdateAvailable(info);
      if (document.getElementById('pinkie-update-dialog')) return;
      updateDialog(info);
    };
    const inspectUpdate = async manual => {
      if (window.__pinkieUpdateDialog?.open()) return;
      const button = controls.querySelector('[data-act="update"]'); button?.classList.add('is-checking');
      const info = await call('check_for_updates'); button?.classList.remove('is-checking');
      if (info?.available) { window.__pinkieUpdateAvailable(info); updateDialog(info); }
      else if (manual) toast(info?.temporaryError ? '现在没连上更新站，稍后再试～' : '已经是最新版啦');
    };
    // Each field is optional. The maximize event and the fullscreen action both
    // call this, and an absent key must leave the other control alone -- reading
    // undefined as false made each one reset the other's indicator.
    window.__pinkieNativeWindowState = state => {
      const has = key => state && Object.prototype.hasOwnProperty.call(state, key);
      if (has('maximized')) {
        const maximized = Boolean(state.maximized);
        document.documentElement.toggleAttribute('data-pinkie-maximized', maximized);
        const button = controls.querySelector('[data-act="max"]');
        const label = maximized ? '还原窗口' : '最大化';
        button?.setAttribute('aria-label', label); button?.setAttribute('title', label);
        button?.setAttribute('aria-pressed', String(maximized));
        const icon = button?.querySelector('svg');
        if (icon) icon.innerHTML = maximized ? restoreIcon : maximizeIcon;
      }
      if (has('fullscreen')) {
        const full = Boolean(state.fullscreen);
        document.documentElement.toggleAttribute('data-pinkie-fullscreen', full);
        const fullButton = controls.querySelector('[data-act="full"]');
        const fullLabel = full ? '退出全屏' : '切换全屏';
        fullButton?.setAttribute('aria-label', fullLabel);
        fullButton?.setAttribute('title', full ? '退出全屏（Esc）' : '切换全屏（F11）');
        fullButton?.setAttribute('aria-pressed', String(full));
      }
    };
    controls.onclick = async event => {
      const action = event.target.closest('button')?.dataset.act;
      if (action === 'update') await inspectUpdate(true);
      if (action === 'full') {
        const state = await call('toggle_fullscreen');
        window.__pinkieNativeWindowState({fullscreen: state?.fullscreen});
      }
      if (action === 'min') call('minimize');
      if (action === 'max') {
        const state = await call('toggle_maximize');
        window.__pinkieNativeWindowState(state);
      }
      if (action === 'close') call('window_close');
    };
    document.body.append(controls);
    const style = document.createElement('style');
    style.textContent = '#pinkie-native-drag-strip{position:fixed;z-index:2147483000;top:7px;right:112px;width:74px;height:27px;background:rgba(255,242,248,.14);border:1px solid rgba(255,255,255,.18);border-radius:999px;box-sizing:border-box;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}#pinkie-native-drag-strip:active{cursor:grabbing}#pinkie-native-drag-strip::after{position:absolute;top:11px;left:50%;width:28px;height:3px;border-radius:999px;background:rgba(179,79,125,.22);content:"";transform:translateX(-50%);transition:background .16s ease,transform .16s ease}#pinkie-native-drag-strip:hover::after{background:rgba(179,79,125,.42);transform:translateX(-50%) scaleX(1.12)}#pinkie-native-resize-handles{position:fixed;z-index:2147483647;inset:0;pointer-events:none}#pinkie-native-resize-handles i{position:absolute;display:block;pointer-events:auto;touch-action:none}#pinkie-native-resize-handles [data-edge="n"],#pinkie-native-resize-handles [data-edge="s"]{left:12px;right:12px;height:7px}#pinkie-native-resize-handles [data-edge="n"]{top:0;cursor:n-resize}#pinkie-native-resize-handles [data-edge="s"]{bottom:0;cursor:s-resize}#pinkie-native-resize-handles [data-edge="e"],#pinkie-native-resize-handles [data-edge="w"]{top:12px;bottom:12px;width:7px}#pinkie-native-resize-handles [data-edge="e"]{right:0;cursor:e-resize}#pinkie-native-resize-handles [data-edge="w"]{left:0;cursor:w-resize}#pinkie-native-resize-handles [data-edge="ne"],#pinkie-native-resize-handles [data-edge="se"],#pinkie-native-resize-handles [data-edge="sw"],#pinkie-native-resize-handles [data-edge="nw"]{width:14px;height:14px}#pinkie-native-resize-handles [data-edge="ne"]{top:0;right:0;cursor:ne-resize}#pinkie-native-resize-handles [data-edge="se"]{right:0;bottom:0;cursor:se-resize}#pinkie-native-resize-handles [data-edge="sw"]{bottom:0;left:0;cursor:sw-resize}#pinkie-native-resize-handles [data-edge="nw"]{top:0;left:0;cursor:nw-resize}html[data-pinkie-maximized] #pinkie-native-resize-handles{display:none}#pinkie-native-window-controls{position:fixed;z-index:2147483647;top:8px;right:9px;display:flex;align-items:center;gap:7px;padding:5px 7px;border:1px solid rgba(255,255,255,.45);border-radius:999px;background:rgba(255,242,248,.38);backdrop-filter:blur(13px);-webkit-app-region:no-drag}#pinkie-native-window-controls button{position:relative;width:11px;height:11px;padding:0;border:0;border-radius:50%;background:#dca0bb;opacity:.55}#pinkie-native-window-controls:hover button{opacity:.92}#pinkie-native-window-controls button[data-act="close"]{background:#d85b91}#pinkie-native-window-controls button[data-act="max"]::after{position:absolute;inset:3px;border:1px solid rgba(105,55,78,.48);border-radius:1px;content:""}html[data-pinkie-maximized] #pinkie-native-window-controls button[data-act="max"]::after{inset:2px 4px 4px 2px;box-shadow:2px 2px 0 -1px #dca0bb,2px 2px 0 0 rgba(105,55,78,.48)}#pinkie-native-window-controls button:focus-visible{outline:1px solid #fff;outline-offset:2px}#pinkie-native-window-controls .pinkie-update-control{width:21px;height:21px;margin:-5px 1px -5px -4px;color:#b73974;background:linear-gradient(145deg,rgba(255,255,255,.94),rgba(250,199,222,.78));box-shadow:0 3px 10px rgba(169,48,103,.16);opacity:.82;font:11px/21px system-ui}#pinkie-native-window-controls .pinkie-update-control span{display:block;transition:transform .35s ease}.pinkie-update-control.is-checking span{animation:pinkieUpdateSpin .8s linear infinite}.pinkie-update-control.has-update{opacity:1;box-shadow:0 0 0 2px rgba(255,255,255,.72),0 0 15px rgba(229,73,142,.65);animation:pinkieUpdateGlow 1.8s ease-in-out infinite}#pinkie-update-toast{position:fixed;z-index:2147483647;top:48px;right:14px;padding:9px 14px;border:1px solid rgba(255,255,255,.7);border-radius:16px;color:#773b5a;background:rgba(255,239,247,.9);box-shadow:0 12px 30px rgba(92,39,65,.16);backdrop-filter:blur(18px);font:12px system-ui;opacity:0;transform:translateY(-7px);pointer-events:none;transition:.22s ease}#pinkie-update-toast.is-visible{opacity:1;transform:none}#pinkie-update-dialog{position:fixed;z-index:2147483646;inset:0;display:grid;place-items:center;background:rgba(63,30,48,.16);backdrop-filter:blur(8px)}.pinkie-update-card{width:min(390px,calc(100vw - 42px));max-height:calc(100vh - 42px);box-sizing:border-box;overflow:auto;padding:clamp(18px,4vw,26px);border:1px solid rgba(255,255,255,.78);border-radius:28px;text-align:center;color:#713d58;background:linear-gradient(145deg,rgba(255,247,251,.95),rgba(247,211,228,.91));box-shadow:0 28px 80px rgba(67,28,49,.25)}.pinkie-update-mark{display:grid;place-items:center;width:42px;height:42px;margin:0 auto 12px;border-radius:15px;color:#c13678;background:rgba(255,255,255,.8);box-shadow:0 8px 24px rgba(190,50,112,.18)}.pinkie-update-card h3{margin:0;font:600 18px/1.4 system-ui}.pinkie-update-card p{margin:9px 0;font:13px/1.65 system-ui}.pinkie-update-notes{margin:4px auto 0;padding:0 0 0 1.15em;max-width:32em;text-align:left;color:#7a4660;font:13px/1.55 system-ui}.pinkie-update-notes li{margin:3px 0}.pinkie-update-notes[hidden]{display:none}.pinkie-update-card .pinkie-update-status{min-height:20px;color:#9c607e;font-size:12px}.pinkie-update-card>div{display:flex;justify-content:center;gap:10px;margin-top:17px}.pinkie-update-card button{min-width:100px;padding:9px 16px;border:1px solid rgba(192,64,120,.22);border-radius:16px;color:#824866;background:rgba(255,255,255,.64);font:13px system-ui}.pinkie-update-card button.primary{color:#fff;background:linear-gradient(135deg,#de6299,#ba3674);box-shadow:0 8px 20px rgba(186,54,116,.23)}.pinkie-update-card button:disabled{opacity:.52}.pinkie-update-card.is-working .pinkie-update-mark{animation:pinkieUpdateSpin 1.1s linear infinite}@media(max-width:900px){#pinkie-native-drag-strip{right:105px;width:56px}#pinkie-native-window-controls{top:6px;right:7px;gap:6px}}@media(max-height:620px){#pinkie-update-toast{top:42px}.pinkie-update-card{padding:16px;border-radius:22px}.pinkie-update-mark{width:34px;height:34px;margin-bottom:7px}.pinkie-update-card p{margin:6px 0;line-height:1.45}.pinkie-update-card>div{margin-top:10px}}@keyframes pinkieUpdateSpin{to{transform:rotate(360deg)}}@keyframes pinkieUpdateGlow{50%{transform:translateY(-1px);filter:saturate(1.3)}}';
    // Native-only caption adapter: the same soft material as the Mac UI,
    // with familiar Windows actions and full-contrast, accessible SVG icons.
    style.textContent += `
      html[data-pinkie-platform="windows"] #pinkie-native-drag-strip {
        top:0;left:264px;right:var(--pinkie-caption-reserve,204px);width:auto;height:34px;
        border:0;border-radius:0;background:transparent;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-drag-strip::after { display:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls {
        --caption-ink:#76596a;--caption-hover:rgba(255,255,255,.8);--caption-face:#fdf3f8;--pinkie-update-mark:#d9508d;
        top:4px;right:12px;height:36px;gap:3px;padding:2px;box-sizing:border-box;
        border:1px solid rgba(255,255,255,.7);border-radius:14px;
        background:linear-gradient(145deg,rgba(255,254,254,.82),rgba(252,233,242,.7));
        box-shadow:0 3px 12px rgba(113,60,86,.06),inset 0 1px rgba(255,255,255,.65);
        backdrop-filter:blur(18px) saturate(130%);-webkit-backdrop-filter:blur(18px) saturate(130%);
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button {
        display:grid;place-items:center;width:32px;height:30px;margin:0;padding:0;
        border:0;border-radius:10px;color:var(--caption-ink);background:transparent;
        opacity:1;cursor:default;box-shadow:none;
        transition:background .16s ease,color .16s ease,box-shadow .16s ease,transform .16s ease;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button::after { content:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls svg {
        display:block;width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.45;
        stroke-linecap:round;stroke-linejoin:round;pointer-events:none;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:hover {
        background:var(--caption-hover);box-shadow:0 2px 6px rgba(100,51,74,.07);
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:active {
        transform:translateY(1px);box-shadow:none;background:rgba(206,146,176,.18);
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:focus:not(:focus-visible) { outline:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:focus-visible {
        outline:2px solid var(--accent,#bf487e);outline-offset:-2px;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button[data-act="close"] {
        border-radius:10px;background:transparent;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button[data-act="close"]:hover {
        color:#fff;background:#cc477d;box-shadow:0 3px 9px rgba(185,57,111,.2);
      }
      /* 检查更新：两道绕圈的箭头，中间一颗粉色小星。悬停转三分之一圈、星星闪；检查中匀速转；
         有新版时右上角一颗粉点轻轻扩散，图标染成粉色。不再用发光方框。 */
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control {
        position:relative;width:32px;height:30px;margin:0;color:var(--caption-ink);background:transparent;
        animation:none;box-shadow:none;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control svg { overflow:visible;transform:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control :is(.pk-loop,.pk-star) {
        transform-box:fill-box;transform-origin:center;
        transition:transform .55s cubic-bezier(.3,1.5,.5,1),opacity .2s ease;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control .pk-loop { transform-box:view-box;transform-origin:10px 10px }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control .pk-star {
        fill:var(--pinkie-update-mark);stroke:none;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control:is(:hover,:focus-visible) {
        background:var(--caption-hover);
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control:is(:hover,:focus-visible) .pk-loop { transform:rotate(120deg) }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control:is(:hover,:focus-visible) .pk-star { animation:pinkieUpdateTwinkle .9s ease-in-out infinite }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control:active .pk-loop { transform:rotate(120deg) scale(.86);transition-duration:.08s }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.is-checking .pk-loop { animation:pinkieUpdateSpin .9s linear infinite }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.is-checking .pk-star { opacity:.35;transform:scale(.7) }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.is-checking svg { animation:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-badge {
        position:absolute;top:5px;right:6px;width:6px;height:6px;border-radius:50%;
        background:var(--pinkie-update-mark);box-shadow:0 0 0 1.5px var(--caption-face);
        opacity:0;transform:scale(.3);transition:opacity .2s ease,transform .35s cubic-bezier(.3,1.6,.5,1);pointer-events:none;
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-badge::after {
        position:absolute;inset:0;border-radius:50%;background:var(--pinkie-update-mark);content:"";
      }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.has-update { color:var(--pinkie-update-mark) }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.has-update .pinkie-update-badge { opacity:1;transform:none }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.has-update .pinkie-update-badge::after { animation:pinkieUpdatePing 2s ease-out infinite }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control.has-update .pk-loop { animation:pinkieUpdateNudge 3.2s ease-in-out infinite }
      html[data-pinkie-platform="windows"] #pinkie-native-window-controls button:focus-visible {
        outline:none;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--pinkie-update-mark) 55%,transparent);
      }
      @keyframes pinkieUpdateTwinkle { 0%,100% { transform:scale(1) rotate(0) } 50% { transform:scale(.6) rotate(45deg);opacity:.6 } }
      @keyframes pinkieUpdatePing { 0% { transform:scale(1);opacity:.55 } 80%,100% { transform:scale(3);opacity:0 } }
      @keyframes pinkieUpdateNudge { 0%,78%,100% { transform:rotate(0) } 86% { transform:rotate(-28deg) } 93% { transform:rotate(8deg) } }
      @media (prefers-reduced-motion: reduce) {
        html[data-pinkie-platform="windows"] #pinkie-native-window-controls .pinkie-update-control * { animation:none!important;transition:none!important }
      }
      html[data-pinkie-platform="windows"][data-pinkie-night] #pinkie-native-window-controls {
        --caption-ink:#e9d6e2;--caption-hover:rgba(255,255,255,.11);--caption-face:#30232f;--pinkie-update-mark:#f28ab8;
        background:linear-gradient(145deg,rgba(54,39,52,.92),rgba(41,31,43,.82));
        border-color:rgba(246,218,234,.2);box-shadow:0 3px 12px rgba(0,0,0,.12),inset 0 1px rgba(255,255,255,.05);
      }
      html[data-pinkie-platform="windows"][data-laolao-classic-shell="1"] body .chat-pane__header { padding-right:var(--pinkie-caption-reserve,204px)!important }
      html[data-pinkie-platform="windows"][data-laolao-classic-shell="1"] body .chat-workbench>.chat-workspace-rail:not(.chat-workspace-rail--collapsed) { padding-top:44px!important } html[data-pinkie-platform="windows"] .pk-metre-board .pk-metre-board__head { padding-top:50px!important } @media(max-width:760px) { html[data-pinkie-platform="windows"] .pk-metre-board .pk-metre-board__close { top:50px!important } }
      html[data-pinkie-platform="windows"][data-pinkie-wb="on"] body .pk-workspace-header { padding-right:var(--pinkie-caption-reserve,204px)!important }
      html[data-pinkie-platform="windows"][data-pinkie-wb="on"][data-pk-wb-narrow="1"][data-pk-wb-view="code"] body .pk-wb-tabs { padding-right:var(--pinkie-caption-reserve,204px)!important }
      @media(max-width:900px) {
        html[data-pinkie-platform="windows"] #pinkie-native-drag-strip { left:54px;right:var(--pinkie-caption-reserve,204px) }
        html[data-pinkie-platform="windows"] #pinkie-native-window-controls { top:4px;right:10px }
      }
    `;
    // The shared renderer uses .topbar, not the retired .chat-pane__header.
    // Reserve native caption-button space so link/cost chips remain readable.
    style.textContent += 'html[data-pinkie-platform="windows"]:not(#pinkie-native-header-specificity) body .topbar{padding-right:var(--pinkie-caption-reserve,204px)!important}';
    document.head.append(style);
    // Keep the native drag surface away from every visible header action.
    (() => {
      // This is also installed by the native bridge. Keep header actions above the
      // draggable surface rather than synthesizing clicks on covered controls.
      // Reuse the elements just created above rather than querying a document
      // which can still be attaching them during WebView2's first load.
      window.__pinkieNativeDragLayout?.dispose();
      const chooseDragInterval = (left, right, occupied, minimum = 30) => {
        const sorted = occupied.map(r => [Math.max(left,r.left-4),Math.min(right,r.right+4)])
          .filter(([a,b]) => b>a).sort((a,b) => a[0]-b[0]);
        let cursor=left, best=null;
        for(const [start,end] of sorted){
          if(start-cursor >= minimum && (!best || start-cursor > best.width)) best={left:cursor,width:start-cursor};
          cursor=Math.max(cursor,end);
        }
        if(right-cursor >= minimum && (!best || right-cursor > best.width)) best={left:cursor,width:right-cursor};
        return best;
      };
      const selector = 'button,a[href],input,select,textarea,summary,[role="button"],[role="tab"],[role="menuitem"],[role="link"],[contenteditable="true"],[onclick],[data-pinkie-no-drag],[title]';
      // Never measure every chat descendant: content-visibility deliberately
      // skips long conversation history, and forcing its layout harms streaming.
      const headers='.topbar,.pk-wb-tabs,.pk-workspace-header,.sidebar-brand,.chat-pane__header';
      const update = () => {
        if(!drag.isConnected || !controls.isConnected)return;
        const left=innerWidth<=900?54:264;
        const caption=controls.getBoundingClientRect();
        // Headers reserve the caption cluster's real width (five buttons now,
        // and it grows with any added later) plus a 14px breathing gap, instead
        // of a fixed guess that left the topbar's last chip touching it.
        if(caption.width>0){
          const reserve=`${Math.ceil(innerWidth-caption.left+14)}px`;
          if(document.documentElement.style.getPropertyValue('--pinkie-caption-reserve')!==reserve)
            document.documentElement.style.setProperty('--pinkie-caption-reserve',reserve);
        }
        const right=Math.max(left,caption.width>0 ? caption.left-8 : innerWidth-12);
        const occupied=[];
        const candidates=[...document.querySelectorAll(headers)].flatMap(header=>[...header.querySelectorAll(selector)]);
        for(const e of candidates){
          if(e===drag || drag.contains(e) || controls.contains(e))continue;
          const r=e.getBoundingClientRect();
          if(r.width<=0 || r.height<=0 || r.bottom<=7 || r.top>=34 || r.right<=left || r.left>=right)continue;
          const s=getComputedStyle(e);
          if(s.display==='none'||s.visibility==='hidden'||s.pointerEvents==='none')continue;
          occupied.push({left:r.left,right:r.right});
        }
        const interval=chooseDragInterval(left,right,occupied);
        if(interval){
          drag.style.left=`${interval.left}px`; drag.style.right='auto'; drag.style.width=`${interval.width}px`;
          drag.style.pointerEvents='auto';
        }else drag.style.pointerEvents='none';
        return {interval,occupiedCount:occupied.length};
      };
      let timer=0;
      const schedule = () => {if(!timer)timer=setTimeout(()=>{timer=0;update();},80);};
      const observer=typeof MutationObserver === 'function' ? new MutationObserver(records=>{
        if(records.some(r=>{
          const e=r.target.nodeType===1?r.target:r.target.parentElement;
          if(e?.closest?.(headers))return true;
          return [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.(headers)||n.querySelector?.(headers)));
        })) schedule();
      }) : null;
      observer?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','aria-hidden','aria-expanded','class']});
      window.addEventListener('resize',schedule,{passive:true});
      document.addEventListener('scroll',schedule,{passive:true,capture:true});
      const interval=setInterval(update,1200);
      window.__pinkieNativeDragLayout={update,dispose(){clearInterval(interval);clearTimeout(timer);observer?.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);}};
      return update();
    })();
    window.__pinkieCheckForUpdates = () => inspectUpdate(false);
    setInterval(() => inspectUpdate(false), 7200000);
    return true;
  };
  if (!installWindowChrome()) {
    document.addEventListener('DOMContentLoaded', installWindowChrome, {once: true});
  }
  // F11 is the Windows convention for the Mac menu's ⌃⌘F "切换全屏".
  document.addEventListener('keydown', event => {
    if (event.key !== 'F11' || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    Promise.resolve(call('toggle_fullscreen')).then(state => {
      window.__pinkieNativeWindowState?.({fullscreen: state?.fullscreen});
    });
  }, true);
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.hostname === '127.0.0.1' && url.port === '18789') {
      // Inside the chat UI its own router handles links such as 设置
      // (/settings/general); only other pages (party, roundtable, dock)
      // are sent back to the chat window.
      if (location.host === url.host) return;
      event.preventDefault(); call('open_chat'); return;
    }
    if (url.protocol.startsWith('http') && !['127.0.0.1','localhost'].includes(url.hostname)) {
      event.preventDefault(); call('open_external',url.href);
    }
  }, true);
  window.addEventListener('beforeunload', () => clearInterval(dictationTimer), {once:true});
})();
"""


NATIVE_READING_SCRIPT = r"""
(() => {
  // Native Windows material preference, not a different browser bundle.
  // Raise the surface's paint alpha; never fade the window or its text.
  const install = () => {
    if (!document.body) return false;
    if (window.__pinkieNativeReadingSurface) {
      window.__pinkieNativeReadingSurface.apply();
      return true;
    }
    const root = document.documentElement;
    const apply = () => {
      const night = root.hasAttribute('data-pinkie-night') ||
        root.getAttribute('data-theme') === 'dark' || root.getAttribute('data-theme-mode') === 'dark';
      document.body.style.setProperty('background-color',
        night ? 'rgba(20,17,25,.96)' : 'rgba(255,250,249,.94)', 'important');
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, {attributes:true, attributeFilter:['data-pinkie-night','data-theme','data-theme-mode']});
    window.__pinkieNativeReadingSurface = {apply, lightAlpha:.94, darkAlpha:.96};
    return true;
  };
  if (!install()) document.addEventListener('DOMContentLoaded', install, {once:true});
})();
"""
