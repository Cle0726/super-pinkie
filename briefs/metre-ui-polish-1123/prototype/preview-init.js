// 预览页：页面脚本加载前，按网址参数定日夜、首页 / 对话页，放几条假会话（只在预览页有）。
(() => {
  const q = new URLSearchParams(location.search);
  const night = q.get('night') === '1';
  try {
    const p = 'openclaw.control.settings.v1', h = location.hostname;
    for (const key of [p, p + ':default', p + ':ws://' + location.host, p + ':ws://' + h + ':18789']) {
      const s = JSON.parse(localStorage.getItem(key) || '{}'); s.themeMode = night ? 'dark' : 'light'; localStorage.setItem(key, JSON.stringify(s));
    }
    // 首页 = 刚打开 App 的样子；对话页 = 已经在用的窗口（不再出首页）
    if (q.get('empty') === '1') sessionStorage.removeItem('laolao:startup-home-seen'); else sessionStorage.setItem('laolao:startup-home-seen', '1');
    localStorage.setItem('laolao:active-mode', 'metre');
    if (q.has('v')) sessionStorage.setItem('pv-ver', q.get('v') === '1' ? '1' : '3'); else if (!sessionStorage.getItem('pv-ver')) sessionStorage.setItem('pv-ver', '3');
    localStorage.setItem('openclaw.i18n.locale', 'zh-CN');
  } catch {}
  const t = (x) => [{type: 'text', text: x}];
  if (q.get('empty') === '1') window.__fakeSeedHistory = [];
  else window.__fakeSeedHistory = [
    {role: 'user', content: t('把登录页的按钮改成蓝色，顺便跑一下测试')},
    {role: 'assistant', content: t('好。我先派一个声部去改按钮颜色，另一个声部跑登录相关的测试，两边做完我再对一遍。\n\n- 声部一：改 `login.css` 里的主按钮颜色\n- 声部二：跑 `tests/login*.test.mjs`\n\n做完会在总谱里收住。'), stopReason: 'stop'},
    {role: 'user', content: t('好，顺便看看注册页是不是也用了同一个按钮')},
    {role: 'assistant', content: t('注册页用的是同一个 `.btn-primary`，这次改动会一起生效，不用另改。'), stopReason: 'stop'},
  ];
  window.__fakeExtraSessions = [
    {key: 'agent:metre:dashboard:preview2', sessionId: 'p2', label: '整理发版说明', displayName: '整理发版说明', updatedAt: Date.now() - 3600e3},
    {key: 'agent:metre:dashboard:preview3', sessionId: 'p3', label: '首页加载变慢排查', displayName: '首页加载变慢排查', updatedAt: Date.now() - 7200e3},
  ];
})();
