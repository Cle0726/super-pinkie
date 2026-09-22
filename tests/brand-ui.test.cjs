const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('connection and fallback chrome use CLE Kk while stored chat text stays protected',()=>{
  const phrases=read('ui/injections/laolao-phrases.js');
  const mac=read('installer/macos/apply-theme.sh');
  const windows=read('installer/windows/apply-theme.ps1');
  assert.match(phrases,/网关仪表盘.*CLE Kk 本地工作台/);
  assert.match(phrases,/OPENCLAW_GATEWAY_TOKEN.*CLE Kk 访问令牌/);
  assert.match(phrases,/OPENCLAW_GATEWAY_TOKEN\(\?:.*可选/);
  assert.match(phrases,/更新凭据后再次点击 Connect。.*填好后再次点击“连接”/);
  assert.match(phrases,/pinkieAskClekk/);
  assert.match(phrases,/homeAssistantLabel/);
  assert.match(phrases,/shell-chrome-controls__custodian/);
  assert.match(phrases,/shell-chrome-controls__home/);
  assert.doesNotMatch(phrases,/askAssistantLabel=.*Home/);
  assert.match(phrases,/问问碧琪/);
  assert.match(phrases,/碧琪正在把新模型请进派对/);
  assert.match(phrases,/watchBrandTitle/);
  assert.match(phrases,/MutationObserver\(\(\) => syncBrandTitle\(\)\)/);
  for(const label of ['Delete message','Open in canvas','Copy as markdown']){
    assert.match(phrases,new RegExp(`\\["${label.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')}"`));
  }
  assert.match(phrases,/exactPhrases\.get\(value\)/);
  assert.match(phrases,/\.chat-group\.user \.chat-sender-name/);
  assert.match(phrases,/sender\.textContent='你'/);
  const theme=read('ui/injections/laolao-theme.css');
  assert.match(theme,/data-pinkie-ask-clekk/);
  assert.match(theme,/data-pinkie-model-startup/);
  assert.match(theme,/laolao-avatar\.png/);
  assert.match(phrases,/isProtectedContent\(node\).*return/s);
  assert.match(mac,/s\{OpenClaw\}\{CLE Kk\}g/);
  assert.match(windows,/Replace\('OpenClaw', 'CLE Kk'\)/);
  assert.match(mac,/phrases21/);assert.match(windows,/phrases21/);
  assert.match(mac,/theme46/);assert.match(windows,/theme46/);
});

test('every mode has its own readable text palette without replacing the selected artwork',()=>{
  const theme=read('ui/injections/laolao-theme.css');
  const palettes={
    chat:'#713550',
    project:'#2d666b',
    thinking:'#65427f',
    learning:'#4f5688',
    unrestricted:'#7b304e',
  };
  for(const [mode,color] of Object.entries(palettes)){
    const block=theme.match(new RegExp(`html\\[data-laolao-mode="${mode}"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1]||'';
    assert.match(block,new RegExp(`--text: ${color.replace('#','\\#')} !important`));
    assert.match(block,/--text-strong:/);
    assert.match(block,/--chat-text:/);
    assert.match(block,/--laolao-wallpaper-image:/);
  }
  assert.equal(new Set(Object.values(palettes)).size,5);
  assert.match(theme,/\[data-mode="learning"\] \{ --mode-button-ink: #615b9a; \}/);
});

test('the mode header keeps its controls readable and uses one clear split-window icon',()=>{
  const classic=read('ui/injections/laolao-classic-shell.css');
  const theme=read('ui/injections/laolao-theme.css');
  const mode=read('ui/injections/laolao-mode-switcher.js');
  assert.match(classic,/\.sidebar-brand__identity \{[\s\S]*display: flex !important;[\s\S]*min-width: 0;/);
  assert.match(classic,/\.sidebar-brand__identity > \.laolao-mode-switcher \{[\s\S]*flex: 1 1 126px;/);
  assert.match(classic,/\.laolao-mode-button__label \{[\s\S]*min-width: max-content;[\s\S]*text-overflow: clip;/);
  assert.match(classic,/\.sidebar-brand__actions > openclaw-tooltip:has\(\.sidebar-search\),[\s\S]*display: none !important;/);
  assert.match(theme,/\.laolao-mode-dock-trigger \{[\s\S]*width: 32px;[\s\S]*flex: 0 0 32px;/);
  assert.match(mode,/rect x="3\.5" y="4\.5" width="17" height="15"/);
  assert.match(mode,/path d="M12 4\.5v15"/);
  assert.doesNotMatch(mode,/rect x="4" y="5" width="10" height="12"/);
});

test('the sidebar footer keeps primary controls visible and groups secondary tools',()=>{
  const classic=read('ui/injections/laolao-classic-shell.css');
  const shell=read('ui/injections/laolao-classic-shell.js');
  assert.match(shell,/const footerSecondaryActions = \[/);
  for(const key of ['fullscreen','theme','pair','memory','docs','update']){
    assert.match(shell,new RegExp(`key: "${key}"`));
  }
  assert.match(shell,/aria-label", "更多工具"/);
  assert.match(shell,/original\.click\(\)/);
  assert.match(classic,/\[data-laolao-footer-secondary="1"\][\s\S]*display: none !important/);
  assert.match(classic,/\.laolao-footer-overflow \{[\s\S]*width: 190px/);
  assert.match(classic,/\.laolao-footer-more \{[\s\S]*width: 32px !important/);
});

test('empty chat keeps only the avatar and name with a bounded particle entrance',()=>{
  const theme=read('ui/injections/laolao-theme.css');
  const mode=read('ui/injections/laolao-mode-switcher.js');
  assert.match(theme,/agent-chat__welcome-glow[\s\S]*agent-chat__badges[\s\S]*agent-chat__hint[\s\S]*agent-chat__suggestions[\s\S]*display: none !important/);
  assert.match(theme,/@keyframes laolao-welcome-particle-gather/);
  assert.match(theme,/prefers-reduced-motion[\s\S]*laolao-welcome-particles[\s\S]*display: none !important/);
  assert.match(mode,/const WELCOME_PARTICLES = \[/);
  assert.match(mode,/data-laolao-minimal-welcome/);
  assert.match(mode,/aria-hidden/);
  assert.match(mode,/laolao:splash-cleared[\s\S]*syncMinimalWelcome\(modeById\(activeMode\(\)\), true\)/);
  assert.match(read('ui/injections/laolao-splash.js'),/splash\.remove\(\)[\s\S]*laolao:splash-cleared/);
  assert.doesNotMatch(mode,/createElement\(["']canvas["']\)|WebGL|setInterval\(/);
});
