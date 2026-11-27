// Self-contained isolated Control UI visual & hotspot regression harness.
// Uses real ui/injections/* CSS/JS, real ui/assets/* (including bundled
// PinkieUI-NotoSansSC.woff2), and scripts/chat-ui-harness/fake-gateway.js.
// Never connects to the live 18789 gateway or touches any user data.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {playwright} from '../../../tools/study-desk/harness.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const VIEWPORT = Object.freeze({width: 1280, height: 800});
export const FROZEN_TIME_MS = Date.parse('2026-11-20T04:00:00.000Z'); // 2026-11-20 12:00:00 Asia/Shanghai

export const VISUAL_SCENES = Object.freeze([
  {id: 'home-chat', mode: 'chat', label: '唠嗑模式首页'},
  {id: 'home-project', mode: 'project', label: '项目模式首页'},
  {id: 'home-thinking', mode: 'thinking', label: '想法模式首页'},
  {id: 'home-learning', mode: 'learning', label: '学习模式首页'},
  {id: 'home-unrestricted', mode: 'unrestricted', label: '无限制模式首页'},
  {id: 'sidebar-expanded', mode: 'project', label: '侧栏展开'},
  {id: 'sidebar-collapsed', mode: 'project', label: '侧栏收起'},
  {id: 'model-picker', mode: 'project', label: '模型选择菜单'},
  {id: 'settings', mode: 'project', label: '设置页'},
  {id: 'study-desk', mode: 'learning', label: '学习台'},
  {id: 'metre-board', mode: 'metre', label: 'Metre 看板'},
  {id: 'long-conversation', mode: 'project', label: '带工具卡片的长对话'},
]);

export const THEMES = Object.freeze(['day', 'night']);

export function allBaselineNames() {
  const names = [];
  for (const scene of VISUAL_SCENES) {
    for (const theme of THEMES) names.push(`${scene.id}-${theme}`);
  }
  return names;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const MODE_META = {
  chat: {
    label: '唠嗑模式',
    avatar: '/laolao-mode-chat-hd.png',
    avatarSm: '/laolao-mode-chat-sm.png',
    welcome: '杯子蛋糕摆好，今天想聊点什么？',
    sessionKey: 'agent:main:dashboard:m5-chat',
  },
  project: {
    label: '项目模式',
    avatar: '/laolao-mode-project-hd.png',
    avatarSm: '/laolao-mode-project-sm.png',
    welcome: '项目工作台就位，把目标交给我吧！',
    sessionKey: 'agent:project:dashboard:m5-project',
  },
  thinking: {
    label: '想法模式',
    avatar: '/laolao-mode-thinking-hd.png',
    avatarSm: '/laolao-mode-thinking-sm.png',
    welcome: '灵感房间亮灯啦，先聊聊你的点子。',
    sessionKey: 'agent:thinking:dashboard:m5-thinking',
  },
  learning: {
    label: '学习模式',
    avatar: '/laolao-mode-learning-hd.png',
    avatarSm: '/laolao-mode-learning-sm.png',
    welcome: '学习小屋就位，今天想攻克哪个知识点？',
    sessionKey: 'agent:learning:dashboard:m5-learning',
  },
  unrestricted: {
    label: '无限制模式',
    avatar: '/laolao-mode-unrestricted-hd.png',
    avatarSm: '/laolao-mode-unrestricted-sm.png',
    welcome: '彩虹力量全开，自由发挥吧！',
    sessionKey: 'agent:unrestricted:dashboard:m5-unrestricted',
  },
  metre: {
    label: 'Metre',
    avatar: '/laolao-mode-metre.svg',
    avatarSm: '/laolao-mode-metre.svg',
    welcome: 'Metre workspace ready.',
    sessionKey: 'agent:metre:dashboard:m5-metre',
  },
};

function renderSceneBody(sceneId, mode, theme = 'day') {
  const meta = MODE_META[mode] || MODE_META.project;
  const collapsed = sceneId === 'sidebar-collapsed';
  const isMetre = mode === 'metre';
  const isNight = theme === 'night';

  let mainContent = '';
  if (sceneId.startsWith('home-') || sceneId === 'sidebar-expanded' || sceneId === 'sidebar-collapsed') {
    mainContent = `
      <div class="chat-thread m5-home-thread">
        <div class="agent-chat__welcome m5-welcome">
          ${isMetre ? '<div class="m5-metre-mark">M</div>' : `<img class="m5-welcome-avatar" src="${meta.avatar}" alt="${meta.label}" />`}
          <h2 class="m5-welcome-title">${meta.label}</h2>
          <p class="m5-welcome-sub">${meta.welcome}</p>
        </div>
      </div>`;
  } else if (sceneId === 'model-picker') {
    mainContent = `
      <div class="chat-thread m5-home-thread">
        <div class="agent-chat__welcome m5-welcome">
          <img class="m5-welcome-avatar" src="${meta.avatar}" alt="${meta.label}" />
          <h2 class="m5-welcome-title">${meta.label}</h2>
        </div>
      </div>
      <div class="m5-picker-anchor">
        <details class="chat-controls__model" open data-pinkie-enhanced="1" data-pinkie-models-open="1" data-pinkie-material="high" data-pinkie-level="3">
          <summary class="m5-model-trigger">Gemini 3 Pro · 高强度</summary>
          <div class="chat-controls__inline-select-menu--combined m5-model-menu" role="listbox" aria-label="模型选择菜单">
            <div class="chat-controls__provider-list">
              <button type="button" class="m5-provider is-active">Google</button>
              <button type="button" class="m5-provider">OpenAI</button>
              <button type="button" class="m5-provider">Anthropic</button>
            </div>
            <div class="chat-controls__provider-models">
              <button type="button" class="m5-model-item is-selected" aria-selected="true">Gemini 3 Pro (1M)</button>
              <button type="button" class="m5-model-item" aria-selected="false">Gemini 3 Flash (1M)</button>
              <button type="button" class="m5-model-item" aria-selected="false">GPT-5.2 (400K)</button>
            </div>
            <div class="chat-controls__reasoning-slider">
              <label for="m5-effort">思考强度：高</label>
              <input id="m5-effort" type="range" min="0" max="4" value="3" />
            </div>
          </div>
        </details>
      </div>`;
  } else if (sceneId === 'settings') {
    mainContent = `
      <section class="m5-settings-page" aria-label="设置页">
        <header class="m5-settings-header">
          <h1>设置</h1>
          <p>外观、动效、模型与本地服务配置</p>
        </header>
        <div class="m5-settings-grid">
          <article class="m5-settings-card">
            <h3>外观与夜间模式</h3>
            <p>跟随系统或手动切换日间 / 夜间主题</p>
            <button type="button" class="m5-pill-btn" data-m5-toggle-theme>切换主题</button>
          </article>
          <article class="m5-settings-card">
            <h3>减少动态效果</h3>
            <p>当前状态：已开启（laolao-motion-preference）</p>
            <span class="m5-badge">reduce</span>
          </article>
          <article class="m5-settings-card">
            <h3>本地网关状态</h3>
            <p>隔离假网关已连接 · 0 外部请求</p>
            <span class="m5-badge m5-badge--ok">在线</span>
          </article>
        </div>
      </section>`;
  } else if (sceneId === 'study-desk') {
    mainContent = `
      <section class="pk-desk m5-study-desk" aria-label="学习台">
        <header class="m5-desk-header">
          <div class="m5-desk-tabs" role="tablist">
            <button type="button" role="tab" aria-selected="true" class="m5-desk-tab is-active">今日复习</button>
            <button type="button" role="tab" aria-selected="false" class="m5-desk-tab">背一背</button>
            <button type="button" role="tab" aria-selected="false" class="m5-desk-tab">笔记本</button>
            <button type="button" role="tab" aria-selected="false" class="m5-desk-tab">题库</button>
          </div>
          <span class="m5-desk-streak">连续学习 7 天 · 今日到期 12 张</span>
        </header>
        <div class="m5-desk-card">
          <p class="m5-desk-eyebrow">非谓语动词 · 专升本英语</p>
          <h2 class="m5-desk-question">This museum is well worth ______.</h2>
          <div class="m5-desk-options">
            <button type="button" class="m5-desk-opt" data-opt="A">A. to visit</button>
            <button type="button" class="m5-desk-opt" data-opt="B">B. visiting</button>
            <button type="button" class="m5-desk-opt" data-opt="C">C. visited</button>
            <button type="button" class="m5-desk-opt" data-opt="D">D. be visited</button>
          </div>
        </div>
      </section>`;
  } else if (sceneId === 'metre-board') {
    mainContent = `
      <section class="m5-metre-board" data-metre-board="1" aria-label="Metre 看板">
        <header class="m5-metre-header">
          <div class="m5-metre-title-row">
            <span class="m5-metre-badge">METRE</span>
            <h1>Tempo · 108 BPM</h1>
          </div>
          <span class="m5-metre-mode-pill">Baton | Virtuoso</span>
        </header>
        <div class="m5-metre-slots">
          <article class="m5-metre-slot">
            <h3>Active Tracks</h3>
            <p>2 running · 1 review queued</p>
          </article>
          <article class="m5-metre-slot">
            <h3>Dispatched Sessions</h3>
            <p>project: 对比度修复 · learning: 整理讲解稿</p>
          </article>
          <article class="m5-metre-slot">
            <h3>Recent Notes</h3>
            <p>Deterministic visual guard active.</p>
          </article>
        </div>
      </section>`;
  } else if (sceneId === 'long-conversation') {
    mainContent = `
      <div class="chat-thread m5-long-thread" id="m5-chat-thread">
        <div class="m5-msg m5-msg--user">
          <div class="m5-msg-body">帮我核对一下今天要改的三个界面文件，顺便跑一下测试。</div>
        </div>
        <div class="m5-msg m5-msg--assistant">
          <img class="chat-avatar m5-msg-avatar" src="${meta.avatarSm}" alt="碧琪" />
          <div class="m5-msg-col">
            <details class="chat-tool-card m5-tool-card" open>
              <summary class="m5-tool-summary">正在读取 <code>ui/injections/laolao-sidebar.css</code> · 完成（0.2s）</summary>
              <div class="m5-tool-body">已核对侧栏宽度与折叠样式，未发现覆盖冲突。</div>
            </details>
            <details class="chat-tool-card m5-tool-card">
              <summary class="m5-tool-summary">正在跑测试 <code>node --test tests/code-health-ratchet.test.mjs</code> · 完成（0.3s）</summary>
              <div class="m5-tool-body">3/3 通过，0 失败。</div>
            </details>
            <div class="m5-msg-body">三个文件都已经核对完毕，棘轮测试 3/3 通过，可以进入下一步。</div>
          </div>
        </div>
        <div class="m5-msg m5-msg--user">
          <div class="m5-msg-body">好，继续检查输入框浮层和夜间模式对比度。</div>
        </div>
        <div class="m5-msg m5-msg--assistant">
          <img class="chat-avatar m5-msg-avatar" src="${meta.avatarSm}" alt="碧琪" />
          <div class="m5-msg-col">
            <details class="chat-tool-card m5-tool-card" open>
              <summary class="m5-tool-summary">正在查代码 <code>ui/injections/laolao-night.css</code> · 完成（0.1s）</summary>
              <div class="m5-tool-body">日夜主题切换后文字对比度均高于 7:1，浮层位置在视口内。</div>
            </details>
            <div class="m5-msg-body">输入框和夜间模式的布局与对比度均已验证正常，没有遮挡。</div>
          </div>
        </div>
      </div>`;
  }

  return `<!doctype html>
<html lang="zh-CN" data-laolao-mode="${mode}" data-theme-mode="${isNight ? 'dark' : 'light'}"${isNight ? ' data-pinkie-night=""' : ''} data-pinkie-platform="windows" data-pinkie-native-glass="1">
  <head>
    <meta charset="utf-8" />
    <title>超級碧琪 · M5 视觉回归</title>
    <script src="/__fake-gateway.js"></script>
    <script src="/laolao-night.js"></script>
    <script src="/laolao-dom-watch.js"></script>
    <link rel="stylesheet" href="/laolao-theme.css" />
    <link rel="stylesheet" href="/laolao-classic-shell.css" />
    <link rel="stylesheet" href="/laolao-sidebar.css" />
    <link rel="stylesheet" href="/laolao-sidebar-surface.css" />
    <link rel="stylesheet" href="/laolao-composer-tray.css" />
    <link rel="stylesheet" href="/laolao-process-card.css" />
    <link rel="stylesheet" href="/laolao-study-desk.css" />
    <link rel="stylesheet" href="/laolao-metre-skin.css" />
    <link rel="stylesheet" href="/laolao-metre-board.css" />
    <link rel="stylesheet" href="/laolao-night.css" />
    <style>
      @font-face {
        font-family: "PinkieDeterministic";
        src: url("/fonts/PinkieUI-NotoSansSC.woff2") format("woff2");
        font-weight: 100 900;
        font-style: normal;
        font-display: block;
      }
      *, *::before, *::after {
        box-sizing: border-box;
        font-family: "PinkieDeterministic", sans-serif !important;
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      [hidden] { display: none !important; }
      html, body {
        margin: 0; padding: 0; width: 1280px; height: 800px; overflow: hidden;
        background: #fdf7fa; color: #241923;
      }
      html[data-pinkie-night], html[data-pinkie-night] body {
        background: #141218; color: #f2edf4;
      }
      html[data-laolao-mode="metre"], html[data-laolao-mode="metre"] body {
        background: #f4f5f7 !important; color: #16181d !important;
      }
      html[data-laolao-mode="metre"][data-pinkie-night], html[data-laolao-mode="metre"][data-pinkie-night] body {
        background: #111317 !important; color: #eceef2 !important;
      }
      #pinkie-native-caption {
        position: fixed; top: 0; right: 0; width: 138px; height: 32px; z-index: 900;
        display: flex; align-items: center; justify-content: flex-end; gap: 2px; padding-right: 4px;
      }
      #pinkie-native-caption button {
        width: 32px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer;
      }
      .m5-shell {
        display: flex; width: 1280px; height: 800px; position: relative;
      }
      .m5-sidebar {
        width: ${collapsed ? '0px' : '268px'};
        min-width: ${collapsed ? '0px' : '268px'};
        overflow: hidden;
        height: 800px;
        border-right: ${collapsed ? '0' : '1px solid rgba(128, 108, 126, 0.22)'};
        background: rgba(255, 250, 253, 0.94);
        display: flex; flex-direction: column; padding: ${collapsed ? '0' : '14px 12px'};
      }
      html[data-pinkie-night] .m5-sidebar { background: rgba(24, 21, 30, 0.96); border-right-color: rgba(255,255,255,0.1); }
      html[data-laolao-mode="metre"] .m5-sidebar { background: #eceef2; border-right-color: rgba(22,24,29,0.12); }
      html[data-laolao-mode="metre"][data-pinkie-night] .m5-sidebar { background: #181b21; border-right-color: rgba(255,255,255,0.1); }
      .sidebar-brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 12px; }
      .sidebar-brand__identity { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
      .laolao-mode-switcher {
        display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px;
        border: 1px solid rgba(128,108,126,0.28); background: rgba(255,255,255,0.85); color: inherit;
        font-size: 14px; font-weight: 600; cursor: pointer; pointer-events: auto !important;
      }
      html[data-pinkie-night] .laolao-mode-switcher { background: rgba(42,36,52,0.9); border-color: rgba(255,255,255,0.14); }
      .m5-mode-avatar { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; }
      .m5-sidebar-toggle {
        width: 30px; height: 30px; border-radius: 8px; border: 1px solid rgba(128,108,126,0.25);
        background: transparent; color: inherit; cursor: pointer;
      }
      .m5-session-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-top: 6px; }
      .m5-session-row {
        display: flex; align-items: center; justify-content: space-between; padding: 9px 10px; border-radius: 10px;
        text-decoration: none; color: inherit; font-size: 13px; border: 1px solid transparent; cursor: pointer;
        background: transparent; text-align: left; width: 100%;
      }
      .m5-session-row.is-active { background: rgba(232, 121, 174, 0.16); border-color: rgba(232, 121, 174, 0.36); font-weight: 600; }
      html[data-laolao-mode="metre"] .m5-session-row.is-active { background: rgba(74, 118, 196, 0.14); border-color: rgba(74, 118, 196, 0.35); }
      .sidebar-footer-bar {
        display: flex; align-items: center; justify-content: space-between; padding-top: 10px;
        border-top: 1px solid rgba(128,108,126,0.18); pointer-events: none;
      }
      .sidebar-footer-bar button {
        pointer-events: auto; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(128,108,126,0.25);
        background: transparent; color: inherit; font-size: 12px; cursor: pointer;
      }
      .m5-main {
        flex: 1; height: 800px; display: flex; flex-direction: column; position: relative; min-width: 0;
      }
      .m5-topbar {
        height: 44px; padding: 6px 156px 6px 18px; display: flex; align-items: center; justify-content: space-between;
        border-bottom: 1px solid rgba(128,108,126,0.16);
      }
      .m5-topbar-left { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; }
      .m5-topbar-actions { display: flex; align-items: center; gap: 8px; }
      .m5-topbar-btn {
        padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(128,108,126,0.28);
        background: transparent; color: inherit; font-size: 12px; cursor: pointer;
      }
      .m5-stage { flex: 1; overflow-y: auto; padding: 24px 32px; position: relative; }
      .m5-welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 460px; gap: 12px; text-align: center; }
      .m5-welcome-avatar { width: 96px; height: 96px; border-radius: 24px; object-fit: cover; }
      .m5-metre-mark { width: 72px; height: 72px; border-radius: 16px; display: grid; place-items: center; font-size: 34px; font-weight: 800; background: #1e2430; color: #f5f7fa; }
      .m5-welcome-title { margin: 0; font-size: 24px; }
      .m5-welcome-sub { margin: 0; font-size: 14px; opacity: 0.78; }
      .m5-composer {
        padding: 14px 32px 20px; border-top: 1px solid rgba(128,108,126,0.16); display: flex; flex-direction: column; gap: 10px;
      }
      .agent-chat__composer-combobox { display: flex; gap: 10px; align-items: flex-end; }
      .agent-chat__input {
        flex: 1; min-height: 54px; padding: 12px 14px; border-radius: 14px; resize: none;
        border: 1px solid rgba(128,108,126,0.32); background: rgba(255,255,255,0.92); color: inherit; font-size: 14px;
      }
      html[data-pinkie-night] .agent-chat__input { background: rgba(34,30,44,0.94); border-color: rgba(255,255,255,0.16); }
      .m5-send-btn {
        height: 42px; padding: 0 18px; border-radius: 12px; border: 0; background: #e86ca8; color: #fff; font-weight: 600; cursor: pointer;
      }
      html[data-laolao-mode="metre"] .m5-send-btn { background: #3b63b8; }
      .m5-composer-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12px; }
      .laolao-context-compact-btn {
        padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(128,108,126,0.3);
        background: transparent; color: inherit; font-size: 12px; cursor: pointer;
      }
      .m5-popover {
        position: fixed; right: 48px; bottom: 112px; width: 280px; padding: 14px; border-radius: 12px;
        border: 1px solid rgba(128,108,126,0.34); background: #ffffff; color: #241923; z-index: 600;
        box-shadow: 0 12px 28px rgba(0,0,0,0.16);
      }
      html[data-pinkie-night] .m5-popover { background: #231f2d; color: #f2edf4; border-color: rgba(255,255,255,0.16); }
      .m5-mode-menu {
        position: fixed; left: 16px; top: 56px; width: 244px; padding: 8px; border-radius: 12px;
        border: 1px solid rgba(128,108,126,0.3); background: #ffffff; color: #241923; z-index: 700;
        display: flex; flex-direction: column; gap: 4px; box-shadow: 0 12px 28px rgba(0,0,0,0.16);
      }
      html[data-pinkie-night] .m5-mode-menu { background: #231f2d; color: #f2edf4; border-color: rgba(255,255,255,0.16); }
      .m5-mode-menu-item {
        display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 0;
        background: transparent; color: inherit; text-align: left; font-size: 13px; cursor: pointer;
      }
      .m5-mode-menu-item.is-current { background: rgba(232,121,174,0.16); font-weight: 600; }
      .m5-picker-anchor { position: fixed; left: 320px; top: 140px; width: 460px; z-index: 500; }
      .m5-model-trigger { list-style: none; padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(128,108,126,0.3); background: #fff; color: inherit; font-weight: 600; }
      html[data-pinkie-night] .m5-model-trigger { background: #24202e; }
      .m5-model-menu {
        margin-top: 8px; padding: 14px; border-radius: 14px; border: 1px solid rgba(128,108,126,0.3);
        background: #ffffff; color: #241923; display: flex; flex-direction: column; gap: 12px;
      }
      html[data-pinkie-night] .m5-model-menu { background: #221e2b; color: #f2edf4; border-color: rgba(255,255,255,0.15); }
      .chat-controls__provider-list { display: flex; gap: 8px; }
      .m5-provider, .m5-model-item {
        padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(128,108,126,0.25); background: transparent; color: inherit; cursor: pointer; text-align: left;
      }
      .m5-provider.is-active, .m5-model-item.is-selected { background: rgba(232,121,174,0.2); border-color: rgba(232,121,174,0.5); font-weight: 600; }
      .chat-controls__provider-models { display: flex; flex-direction: column; gap: 6px; }
      .m5-settings-grid, .m5-metre-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 18px; }
      .m5-settings-card, .m5-metre-slot, .m5-desk-card {
        padding: 18px; border-radius: 14px; border: 1px solid rgba(128,108,126,0.24); background: rgba(255,255,255,0.9);
      }
      html[data-pinkie-night] .m5-settings-card, html[data-pinkie-night] .m5-metre-slot, html[data-pinkie-night] .m5-desk-card {
        background: rgba(30,27,39,0.92); border-color: rgba(255,255,255,0.14);
      }
      .m5-desk-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
      .m5-desk-tabs { display: flex; gap: 8px; }
      .m5-desk-tab { padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(128,108,126,0.28); background: transparent; color: inherit; cursor: pointer; }
      .m5-desk-tab.is-active { background: rgba(232,121,174,0.2); font-weight: 600; }
      .m5-desk-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
      .m5-desk-opt { padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(128,108,126,0.28); background: transparent; color: inherit; text-align: left; cursor: pointer; }
      .m5-desk-opt.is-selected { background: rgba(232,121,174,0.22); border-color: #e86ca8; font-weight: 600; }
      .m5-long-thread { display: flex; flex-direction: column; gap: 16px; max-width: 820px; }
      .m5-msg { display: flex; gap: 12px; align-items: flex-start; }
      .m5-msg--user { justify-content: flex-end; }
      .m5-msg--user .m5-msg-body { background: rgba(232,121,174,0.16); padding: 10px 14px; border-radius: 14px; max-width: 72%; }
      .m5-msg-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
      .m5-msg-col { display: flex; flex-direction: column; gap: 8px; flex: 1; }
      .m5-tool-card { border: 1px solid rgba(128,108,126,0.26); border-radius: 10px; padding: 8px 12px; background: rgba(255,255,255,0.85); }
      html[data-pinkie-night] .m5-tool-card { background: rgba(34,30,44,0.88); border-color: rgba(255,255,255,0.14); }
      .m5-tool-summary { cursor: pointer; font-size: 13px; font-weight: 600; }
      .m5-tool-body { margin-top: 6px; font-size: 12px; opacity: 0.85; }
      .m5-badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 12px; background: rgba(128,108,126,0.18); }
      .m5-badge--ok { background: rgba(46, 160, 67, 0.2); }
      .m5-pill-btn { padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(128,108,126,0.3); background: transparent; color: inherit; cursor: pointer; }
      .m5-metre-header { display: flex; align-items: center; justify-content: space-between; }
      .m5-metre-title-row { display: flex; align-items: center; gap: 10px; }
      .m5-metre-badge { padding: 4px 8px; border-radius: 6px; background: #1e2430; color: #f5f7fa; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
    </style>
  </head>
  <body>
    <div id="pinkie-native-caption" aria-label="Windows 标题栏按钮区">
      <button type="button" aria-label="最小化">—</button>
      <button type="button" aria-label="最大化">□</button>
      <button type="button" aria-label="关闭">×</button>
    </div>
    <openclaw-app class="shell shell--chat m5-shell" data-scene="${sceneId}">
      <aside class="sidebar-shell m5-sidebar" id="m5-sidebar" data-collapsed="${collapsed ? '1' : '0'}">
        <div class="sidebar-brand">
          <div class="sidebar-brand__identity">
            <button type="button" class="laolao-mode-switcher" id="m5-mode-btn" data-mode="${mode}" aria-label="切换模式">
              ${isMetre ? '' : `<img class="m5-mode-avatar" src="${meta.avatarSm}" alt="" />`}
              <span class="laolao-mode-button__label">${meta.label}</span>
            </button>
          </div>
          <button type="button" class="m5-sidebar-toggle" id="m5-collapse-btn" aria-label="收起侧栏">«</button>
        </div>
        <nav class="m5-session-list" id="m5-session-list" aria-label="会话列表">
          <button type="button" class="m5-session-row is-active" data-session-key="${meta.sessionKey}">今天的计划</button>
          <button type="button" class="m5-session-row" data-session-key="agent:${mode === 'chat' ? 'main' : mode}:dashboard:m5-s2">对比度与排版核对</button>
          <button type="button" class="m5-session-row" data-session-key="agent:${mode === 'chat' ? 'main' : mode}:dashboard:m5-s3">版本哈希回归记录</button>
        </nav>
        <div class="sidebar-footer-bar">
          <button type="button" id="m5-settings-btn" aria-label="打开设置">设置</button>
          <button type="button" id="m5-night-btn" aria-label="切换日夜模式">日/夜</button>
        </div>
      </aside>
      <main class="m5-main">
        <header class="m5-topbar">
          <div class="m5-topbar-left">
            ${collapsed ? '<button type="button" class="m5-topbar-btn" id="m5-expand-btn" aria-label="展开侧栏">展开侧栏</button>' : ''}
            <span>${meta.label} · 今天的计划</span>
          </div>
          <div class="m5-topbar-actions">
            <button type="button" class="m5-topbar-btn" id="m5-new-chat-btn">新会话</button>
            <button type="button" class="m5-topbar-btn" id="m5-export-btn">导出</button>
          </div>
        </header>
        <section class="m5-stage" id="m5-stage">${mainContent}</section>
        <footer class="m5-composer">
          <div class="m5-composer-bar">
            <span>当前模型：Gemini 3 Pro</span>
            <button type="button" class="laolao-context-compact-btn" id="m5-compact-btn" aria-label="压缩上下文">压缩上下文</button>
          </div>
          <div class="agent-chat__composer-combobox">
            <textarea class="agent-chat__input" id="m5-input" aria-label="聊天输入" placeholder="输入消息…"></textarea>
            <button type="button" class="m5-send-btn" id="m5-send-btn">发送</button>
          </div>
        </footer>
      </main>
    </openclaw-app>
    <div class="m5-mode-menu" id="m5-mode-menu" hidden role="menu" aria-label="模式切换菜单">
      ${Object.entries(MODE_META).map(([id, m]) => `<button type="button" role="menuitem" class="m5-mode-menu-item${id === mode ? ' is-current' : ''}" data-target-mode="${id}">${m.label}</button>`).join('')}
    </div>
    <div class="m5-popover" id="m5-compact-popover" hidden role="dialog" aria-label="上下文压缩确认">
      <strong>压缩当前会话上下文</strong>
      <p style="margin:8px 0;font-size:12px;">保留关键结论并释放 68% 上下文空间。</p>
      <button type="button" class="m5-pill-btn" id="m5-compact-confirm">立即压缩</button>
    </div>
    <script>
      (() => {
        const modeBtn = document.getElementById('m5-mode-btn');
        const modeMenu = document.getElementById('m5-mode-menu');
        const sidebar = document.getElementById('m5-sidebar');
        const collapseBtn = document.getElementById('m5-collapse-btn');
        const compactBtn = document.getElementById('m5-compact-btn');
        const compactPopover = document.getElementById('m5-compact-popover');
        const nightBtn = document.getElementById('m5-night-btn');
        modeBtn?.addEventListener('click', () => { modeMenu.hidden = !modeMenu.hidden; });
        modeMenu?.addEventListener('click', (e) => {
          const item = e.target.closest('[data-target-mode]');
          if (!item) return;
          document.documentElement.setAttribute('data-laolao-mode', item.dataset.targetMode);
          modeBtn.dataset.mode = item.dataset.targetMode;
          modeBtn.querySelector('.laolao-mode-button__label').textContent = item.textContent;
          modeMenu.hidden = true;
        });
        collapseBtn?.addEventListener('click', () => {
          const next = sidebar.dataset.collapsed === '1' ? '0' : '1';
          sidebar.dataset.collapsed = next;
          sidebar.style.width = next === '1' ? '0px' : '268px';
          sidebar.style.minWidth = next === '1' ? '0px' : '268px';
          sidebar.style.padding = next === '1' ? '0px' : '14px 12px';
        });
        document.getElementById('m5-session-list')?.addEventListener('click', (e) => {
          const row = e.target.closest('.m5-session-row');
          if (!row) return;
          document.querySelectorAll('.m5-session-row').forEach((r) => r.classList.remove('is-active'));
          row.classList.add('is-active');
        });
        compactBtn?.addEventListener('click', () => { compactPopover.hidden = !compactPopover.hidden; });
        nightBtn?.addEventListener('click', () => {
          const dark = !document.documentElement.hasAttribute('data-pinkie-night');
          document.documentElement.toggleAttribute('data-pinkie-night', dark);
          document.documentElement.setAttribute('data-theme-mode', dark ? 'dark' : 'light');
        });
        document.querySelectorAll('.m5-desk-opt').forEach((btn) => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.m5-desk-opt').forEach((b) => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
          });
        });
      })();
    </script>
  </body>
</html>`;
}

export async function startVisualServer({port = 0} = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/__fake-gateway.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(fs.readFileSync(path.join(REPO_ROOT, 'scripts/chat-ui-harness/fake-gateway.js')));
      return;
    }
    if (url.pathname === '/scene') {
      const sceneId = url.searchParams.get('id') || 'home-project';
      const theme = url.searchParams.get('theme') === 'night' ? 'night' : 'day';
      const scene = VISUAL_SCENES.find((s) => s.id === sceneId) || VISUAL_SCENES[0];
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(renderSceneBody(scene.id, scene.mode, theme));
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel.includes('..')) { res.statusCode = 404; res.end(); return; }
    const candidates = [
      path.join(REPO_ROOT, 'ui/injections', rel),
      path.join(REPO_ROOT, 'ui/assets', rel),
    ];
    const hit = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!hit) { res.statusCode = 404; res.end('missing ' + rel); return; }
    res.setHeader('Content-Type', MIME[path.extname(hit)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(fs.readFileSync(hit));
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function launchVisualBrowser(engine = process.env.PINKIE_VISUAL_ENGINE || '') {
  const {chromium} = playwright();
  const launchOpts = {
    headless: true,
    args: [
      '--font-render-hinting=none',
      '--disable-lcd-text',
      '--force-color-profile=srgb',
      '--num-raster-threads=1',
    ],
  };
  if (engine === 'msedge' || engine === 'chrome') {
    return chromium.launch({...launchOpts, channel: engine});
  }
  try {
    return await chromium.launch(launchOpts);
  } catch {
    return chromium.launch({...launchOpts, channel: 'chrome'});
  }
}

export async function openScenePage(browser, origin, sceneId, theme) {
  const isNight = theme === 'night';
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: isNight ? 'dark' : 'light',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript(({frozenMs, isNight: dark}) => {
    const OrigDate = Date;
    class FrozenDate extends OrigDate {
      constructor(...args) { super(...(args.length ? args : [frozenMs])); }
      static now() { return frozenMs; }
    }
    window.Date = FrozenDate;
    let seed = 42;
    Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    localStorage.setItem('laolao:motion-preference', 'reduce');
    localStorage.setItem('pinkie.motion.reduce.v1', '1');
    localStorage.setItem('openclaw.i18n.locale', 'zh-CN');
    localStorage.setItem('openclaw.control.settings.v1', JSON.stringify({
      themeMode: dark ? 'dark' : 'light',
      gatewayUrl: location.origin.replace('http', 'ws'),
      token: 'm5-visual',
    }));
  }, {frozenMs: FROZEN_TIME_MS, isNight});

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await page.goto(`${origin}/scene?id=${encodeURIComponent(sceneId)}&theme=${isNight ? 'night' : 'day'}`, {waitUntil: 'networkidle'});
  await page.evaluate(async (dark) => {
    document.documentElement.toggleAttribute('data-pinkie-night', dark);
    document.documentElement.setAttribute('data-theme-mode', dark ? 'dark' : 'light');
    if (document.fonts) {
      await Promise.all([...document.fonts].map((font) => font.load().catch(() => {})));
      await document.fonts.ready;
    }
    await Promise.all([...document.images].map(async (img) => {
      if (!img.complete) {
        await new Promise((r) => {
          img.addEventListener('load', r, {once: true});
          img.addEventListener('error', r, {once: true});
        });
      }
      if (typeof img.decode === 'function') {
        await img.decode().catch(() => {});
      }
    }));
    const bgUrls = new Set();
    const collectBg = (style) => {
      const bg = style?.backgroundImage || '';
      for (const match of bg.matchAll(/url\((['"]?)(.*?)\1\)/g)) {
        if (match[2] && !match[2].startsWith('data:')) bgUrls.add(match[2]);
      }
    };
    for (const el of [document.documentElement, document.body, ...document.querySelectorAll('*')]) {
      collectBg(getComputedStyle(el));
      collectBg(getComputedStyle(el, '::before'));
      collectBg(getComputedStyle(el, '::after'));
    }
    await Promise.all([...bgUrls].map(async (url) => {
      const probe = new Image();
      probe.src = url;
      await probe.decode().catch(() => {});
    }));
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, isNight);
  return {context, page, pageErrors};
}

// B62 / B51：CI Linux 上 visual-baseline 的 3 遍确定性偶发差 6–8 px（#398 home-learning-day、
// #393 sidebar-collapsed-night、#404 study-desk-day、#407 sidebar-collapsed-day 等，场景分散）。
// 字体 / 图片 / 背景图的「加载完成」不等于「已经画到合成帧上」：解码或光栅化晚到一两帧时，
// 第一张截图会拍到还没画完的帧。所以截图前先等画面本身停下来：每隔两帧拍一张，
// 直到连续两张逐字节相同才算稳定。不加容差、不放宽断言、不加超时；
// 拍满上限张还在变，就直接报错（页面停不下来本身就是问题）。
export const SETTLE_MAX_SHOTS = 8;

export async function screenshotWhenSettled(page, {label = 'scene', maxShots = SETTLE_MAX_SHOTS} = {}) {
  let previous = await page.screenshot({animations: 'disabled', type: 'png'});
  for (let shot = 2; shot <= maxShots; shot += 1) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const next = await page.screenshot({animations: 'disabled', type: 'png'});
    if (Buffer.compare(next, previous) === 0) return next;
    previous = next;
  }
  throw new Error(`${label} never settled: ${maxShots} screenshots taken 2 frames apart, each differed from the one before`);
}

export async function captureScenePng(browser, origin, sceneId, theme) {
  const {context, page, pageErrors} = await openScenePage(browser, origin, sceneId, theme);
  try {
    const png = await screenshotWhenSettled(page, {label: `${sceneId}-${theme}`});
    return {png, pageErrors};
  } finally {
    await context.close();
  }
}
