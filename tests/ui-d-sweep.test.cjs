const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('D sweep localizes navigation, picker, and duplicate-message chrome', () => {
  const phrases = read('ui/injections/laolao-phrases.js');
  const labels = [
    ['Close navigation', '收起导航'],
    ['Open session menu', '打开会话菜单'],
    ['Color mode: System', '配色：跟随系统'],
    ['Color mode: Light', '配色：浅色'],
    ['Color mode: Dark', '配色：深色'],
    ['Other models', '其他模型'],
    ['Mm models', 'Mm 模型'],
    ['Use default reasoning (Off)', '使用默认思考强度（关闭）'],
    ['Speed', '速度'],
    ['Attached image', '附件图片'],
    ['Chat', '聊天'],
    ['Overview', '概览'],
    ['More', '更多'],
    ['New session', '新会话'],
    ['Worktrees', '工作树'],
    ['Cron', '定时任务'],
    ['Usage', '使用情况'],
    ['Try again', '再试一次'],
    ['Keep waiting', '继续等待'],
    ['Open command palette', '打开命令面板'],
    ['Collapse sidebar', '收起侧边栏'],
    ['Activity', '活动'],
    ['Instances', '实例'],
    ['Sessions', '会话'],
    ['Cron Jobs', '定时任务'],
    ['Tasks', '任务'],
    ['Agents', '代理'],
    ['Skills', '技能'],
    ['Skill Workshop', '技能工坊'],
    ['Nodes', '节点'],
    ['Dreaming', '梦境'],
    ['Sort sessions', '排序会话'],
    ['All sessions', '全部会话'],
    ['Edit pinned items', '自定义侧边栏'],
    ['Settings', '设置'],
    ['Docs', '文档'],
    ['Pair mobile device', '配对移动设备'],
    ['Gateway status: Online', '网关状态：在线'],
    ['Gateway 状态：在线', '网关状态：在线'],
    ['Settings view', '设置视图'],
    ['Your local chat identity', '你在本机的聊天身份'],
    ['Assistant identity', '助手身份'],
  ];
  for (const [source, target] of labels) {
    assert.ok(phrases.includes(`${JSON.stringify(source)}, ${JSON.stringify(target)}`), `${source} should be localized`);
  }
  assert.match(phrases, /consecutive identical messages collapsed/);
  assert.match(phrases, /Message context for/);
  assert.match(phrases, /Showing last\\s\+/);
  assert.match(phrases, /just now[\s\S]*stat-value/);
  assert.match(phrases, /\.ov-recent__time/);
  assert.match(phrases, /sidebar-recent-session/);
  assert.match(phrases, /isOverviewHint[\s\S]*ov-card__hint[\s\S]*tokens\?[\s\S]*msgs\?[\s\S]*active/);
  assert.match(phrases, /attributes: true,[\s\S]*attributeFilter: \["title", "aria-label", "alt", "placeholder"\]/);
  assert.match(phrases, /localizedChromeValue\(value,control\)/);
});

test('D sweep keeps the combined picker inside narrow windows', () => {
  const css = read('ui/injections/laolao-theme.css');
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.content--chat:has\(\.chat-controls__model\[open\]\)[\s\S]*\.chat-main:has\(\.chat-controls__model\[open\]\)[\s\S]*overflow: visible !important;[\s\S]*\.chat-controls__model\[open\] > \.chat-controls__inline-select-menu--combined[\s\S]*left: max\(-3px, calc\(\(100vw - 304px\) \/ 2 - 15px\)\) !important;[\s\S]*right: auto !important;[\s\S]*width: min\(304px, calc\(100vw - 24px\)\) !important;/);
});
