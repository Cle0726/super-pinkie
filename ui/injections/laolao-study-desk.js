/* 碧琪学习台 v1. Local, framework-free, scoped to the learning session. */
(() => {
  'use strict';
  if (window.__pinkieStudyDesk) return;
  const BASE = new URL('.', document.currentScript?.src || location.href).href;
  const doc = document.documentElement;
  const MOCK_DATA = {"syllabus": [{"id": "ee", "name": "电工电子", "score": 100, "chapters": [{"k": "ee1", "t": "电路基本概念", "items": ["电流、电压、电位、电功率；理想电压源与电流源", "万用表测电阻、电压、电流"], "lv": [1, 2]}, {"k": "ee2", "t": "直流电路", "items": ["戴维南定理、叠加定理", "KVL、KCL", "电阻串联、并联分析"], "lv": [1, 2, 2]}, {"k": "ee3", "t": "单相正弦交流电路", "items": ["正弦量三要素", "电容、电感伏安关系", "容抗、感抗", "正弦波形分析"], "lv": [1, 1, 1, 2]}, {"k": "ee4", "t": "动态电路", "items": ["RC、RL 充放电规律", "时间常数", "换路定律"], "lv": [1, 1, 2]}, {"k": "ee5", "t": "二极管与直流稳压电源", "items": ["半导体与二极管基础", "二极管测量", "二极管简单应用电路", "线性直流稳压电源分析"], "lv": [1, 2, 2, 2]}, {"k": "ee6", "t": "三极管电路", "items": ["三极管基础", "三极管测量", "开关电路、共射/共集放大电路分析"], "lv": [1, 2, 2]}, {"k": "ee7", "t": "运算放大器电路", "items": ["运放基础", "电压比较器（非线性）", "同相/反相/加法/减法/差动（线性）"], "lv": [1, 2, 2]}, {"k": "ee8", "t": "逻辑代数与门电路", "items": ["逻辑代数基础", "逻辑门电路"], "lv": [1, 1]}, {"k": "ee9", "t": "组合逻辑电路", "items": ["简单组合逻辑电路分析", "简单组合逻辑电路设计"], "lv": [2, 2]}, {"k": "ee10", "t": "时序逻辑电路", "items": ["RS、JK、D 触发器", "简单时序逻辑电路分析"], "lv": [1, 2]}]}, {"id": "c", "name": "C语言", "score": 100, "chapters": [{"k": "c1", "t": "程序设计和 C 语言", "items": ["程序与语言", "C 语言概述", "C 程序结构", "运行步骤：编辑→编译→连接→运行"], "lv": [1, 1, 2, 2]}, {"k": "c2", "t": "数据类型及运算", "items": ["常量与变量", "整型/字符型/浮点型", "类型转换"], "lv": [1, 2, 2]}, {"k": "c3", "t": "顺序程序设计", "items": ["运算符与表达式", "基本语句", "输入输出 printf/scanf"], "lv": [2, 2, 2]}, {"k": "c4", "t": "选择结构", "items": ["关系运算", "逻辑运算", "if 语句", "条件运算符 ?:", "switch 语句"], "lv": [2, 2, 2, 1, 2]}, {"k": "c5", "t": "循环结构", "items": ["三种循环异同", "while / do-while / for", "循环嵌套", "break 与 continue"], "lv": [1, 2, 1, 2]}, {"k": "c6", "t": "数组", "items": ["一维数组", "二维数组", "字符数组"], "lv": [2, 2, 1]}, {"k": "c7", "t": "函数", "items": ["定义与调用", "函数声明与原型", "嵌套与递归", "数组作函数参数", "局部/全局变量", "编译预处理"], "lv": [2, 2, 1, 2, 1, 1]}, {"k": "c8", "t": "指针", "items": ["指针变量定义与引用", "指针引用数组", "指针引用字符串", "指向函数的指针"], "lv": [2, 2, 1, 1]}, {"k": "c9", "t": "结构体/共用体/枚举", "items": ["结构体变量", "结构体数组", "共用体", "枚举"], "lv": [1, 1, 1, 1]}, {"k": "c10", "t": "文件", "items": ["文件定义与分类", "fopen / fclose", "顺序读写", "随机读写 fseek"], "lv": [1, 1, 1, 1]}]}, {"id": "net", "name": "计算机网络", "score": 100, "chapters": [{"k": "net1", "t": "计算机网络概述", "items": ["发展过程", "概念、分类、组成", "电路交换、存储转发包交换", "协议、层次、接口", "OSI、TCP/IP 各层功能"], "lv": [1, 1, 2, 2, 2]}, {"k": "net2", "t": "物理层", "items": ["物理层基本概念", "数据通信基本概念", "传输介质", "数据编码", "多路复用"], "lv": [2, 1, 1, 1, 2]}, {"k": "net3", "t": "数据链路层", "items": ["差错控制", "交换机原理", "VLAN 原理", "ARP", "链路层功能与服务", "CSMA/CD", "二层交换机基本配置"], "lv": [1, 1, 1, 2, 2, 2, 2]}, {"k": "net4", "t": "网络层", "items": ["路由器原理", "NAT、ICMP", "RIP、OSPF", "网络层功能", "IP 协议、IPv4 与 IPv6", "IP 分类、子网掩码与子网划分", "ping、traceroute", "路由器/三层交换机端口地址与路由配置"], "lv": [1, 1, 1, 2, 2, 2, 2, 2]}, {"k": "net5", "t": "传输层", "items": ["传输层功能", "连接管理（三次握手/四次挥手）", "UDP、TCP", "拥塞控制与流量控制"], "lv": [2, 2, 2, 1]}, {"k": "net6", "t": "应用层", "items": ["DNS", "WWW", "FTP", "电子邮件", "DHCP", "常用服务端口"], "lv": [2, 2, 1, 1, 1, 2]}]}, {"id": "math", "name": "高数", "score": 150, "chapters": [{"k": "m1", "t": "函数、极限与连续", "items": ["定义域、函数性质、反函数、复合函数", "求极限方法、两个重要极限", "无穷小比较与等价代换", "连续性与间断点", "闭区间连续函数性质"], "lv": [2, 2, 2, 2, 1]}, {"k": "m2", "t": "导数与微分", "items": ["导数定义、可导与连续", "切线与法线", "求导法则、复合函数求导", "隐函数、对数、参数方程求导", "高阶导数", "微分"], "lv": [2, 2, 2, 2, 2, 2]}, {"k": "m3", "t": "导数的应用", "items": ["中值定理", "洛必达法则", "单调性", "极值、最值", "凹凸性与拐点"], "lv": [1, 2, 2, 2, 2]}, {"k": "m4", "t": "一元函数积分学", "items": ["不定积分与基本公式", "换元法、分部积分", "定积分性质与几何意义", "变上限积分求导、牛顿-莱布尼茨", "广义积分", "定积分应用（面积/体积）"], "lv": [2, 2, 2, 2, 2, 2]}, {"k": "m5", "t": "常微分方程", "items": ["阶、通解、特解", "可分离变量、一阶线性", "降阶法", "二阶线性方程解的结构", "二阶常系数齐次", "二阶常系数非齐次"], "lv": [2, 2, 2, 1, 2, 1]}]}, {"id": "en", "name": "英语", "score": 150, "chapters": [{"k": "e1", "t": "词汇和语法（40 分）", "items": ["3000 词 + 500 短语", "句子结构、时态、语态等语法"], "lv": [2, 2]}, {"k": "e2", "t": "阅读理解（60 分）", "items": ["主旨大意", "细节信息", "判断推论", "猜词义", "作者观点与意图"], "lv": [2, 2, 2, 2, 2]}, {"k": "e3", "t": "英译汉选择（24 分）", "items": ["识别核心词汇与基础语法", "正确理解句意"], "lv": [2, 2]}, {"k": "e4", "t": "汉译英（8 分）", "items": ["恰当词汇与搭配", "正确语法框架", "结构清晰、连贯"], "lv": [2, 2, 2]}, {"k": "e5", "t": "应用文写作（18 分）", "items": ["不少于 80 词，文体规范"], "lv": [2]}]}], "questions": [{"id": "c5-74", "k": "c5", "t": "single", "q": "关于 do-while 循环，正确的说法是", "o": ["循环体可能一次也不执行", "循环体至少执行一次", "不能用 break 退出", "与 while 完全相同"], "a": "B", "x": "do-while 先执行后判断；while 和 for 先判断后执行。"}, {"id": "c5-75", "k": "c5", "t": "single", "q": "for (i = 0; i < 10; i += 3) 循环体执行的次数是", "o": ["3", "4", "10", "9"], "a": "B", "x": "i 依次为 0、3、6、9，共 4 次。"}, {"id": "c5-76", "k": "c5", "t": "single", "q": "以下程序段执行后 s 的值为\n\nint i, s = 0;\nfor (i = 1; i <= 5; i++) {\n  if (i % 2 == 0) continue;\n  s += i;\n}", "o": ["15", "9", "6", "5"], "a": "B", "x": "continue 跳过偶数，s = 1 + 3 + 5 = 9。"}, {"id": "c5-77", "k": "c5", "t": "single", "q": "for (int i = 0; i < 5; i++) { if (i == 2) continue; printf(\"%d \", i); } 的输出是", "o": ["0 1 3 4", "0 1 2 3 4", "0 1 2", "0 1"], "a": "A", "x": "continue 只跳过本次，break 才会结束整个循环（输出 0 1）。"}, {"id": "c6-78", "k": "c6", "t": "single", "q": "若有定义 int a[10]; 则数组元素下标的合法范围是", "o": ["1~10", "0~9", "0~10", "1~9"], "a": "B", "x": "C 数组下标从 0 开始，最大为长度减 1。"}, {"id": "c6-79", "k": "c6", "t": "single", "q": "定义 char s[] = \"hello\"; 则 sizeof(s) 的值为", "o": ["5", "6", "4", "10"], "a": "B", "x": "字符串末尾自动加 '\\0'，占 6 字节；strlen(s) 才是 5。"}]};
  const CHAPTERS = new Map(MOCK_DATA.syllabus.flatMap(subject => subject.chapters.map(chapter => [chapter.k, chapter.t])));
  const views = new Map(), stageModes = new Map(), sessions = new Map(), animations = new Set(), splits = new Set();
  const vendors = window.__pinkieDeskVendors || {};
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const state = {root: null, active: '', key: '', controller: null, timer: 0, generation: 0, native: new Map()};
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const button = (label, action, cls = '') => { const n = el('button', cls, label); n.type = 'button'; n.addEventListener('click', action); return n; };
  const sessionKey = () => new URL(location.href).searchParams.get('session')
    || document.querySelector('.sidebar-recent-session--active[data-session-key]')?.dataset.sessionKey
    || document.querySelector('openclaw-app-shell')?.context?.gateway?.snapshot?.sessionKey || '';
  const inLearning = () => {
    const owner = /^agent:([^:]+):/.exec(sessionKey())?.[1], mode = doc.dataset.laolaoMode;
    return mode ? mode === 'learning' && (!owner || owner === 'learning') : owner === 'learning';
  };
  // 桌上的每一页是一张能拖、能改大小的卡片。位置按学习台内容区的比例存（0–1），换窗口大小也不会跑出去。
  const MAX_CARDS = 4, MIN_W = 320, MIN_H = 260, SNAP = 14;
  // 4 张学习页的上限不算聊天卡：桌上摊满了也总能开合对话。
  const full = w => w.panes.filter(p => p.view !== 'deskchat').length >= MAX_CARDS;
  const validRect = r => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0 ? {x: r.x, y: r.y, w: Math.min(1, r.w), h: Math.min(1, r.h)} : null;
  // 平铺：从左到右排成一本摊开的本子；聊天卡固定窄一点、放最右边。
  function tileRects(w) {
    const chat = w.panes.filter(p => p.view === 'deskchat'), pages = w.panes.filter(p => p.view !== 'deskchat');
    const chatW = chat.length && pages.length ? 0.27 : 0, gap = chatW ? 0.012 : 0, each = pages.length ? (1 - chatW - gap) / pages.length : 0;
    pages.forEach((p, i) => { p.rect = {x: i * each, y: 0, w: each, h: 1}; });
    chat.forEach(p => { p.rect = pages.length ? {x: 1 - chatW, y: 0, w: chatW, h: 1} : {x: 0, y: 0, w: 1, h: 1}; });
    w.tiled = true;
  }
  const workspace = () => {
    if (!sessions.has(state.key)) {
      let saved; try { saved = JSON.parse(localStorage.getItem('pinkie-desk-pages:' + state.key) || 'null'); } catch {}
      const configs = Array.isArray(saved?.panes) && saved.panes.length ? saved.panes.slice(0, MAX_CARDS + 1) : [{view: 'today'}];
      const panes = configs.map((config, i) => ({id: 'page-' + i, view: config.view === 'chat' ? 'today' : config.view || 'today', state: {view: config.view || 'today', deskView: config.view || 'today', notesRoute: config.notesRoute, vocabRoute: config.vocabRoute}, rect: validRect(config.rect), z: Number(config.z) || i + 1, host: null}));
      const w = {panes, focus: Math.min(Number(saved?.focus) || 0, panes.length - 1), chat: true, chatFocus: false, tiled: saved?.tiled !== false || panes.some(p => !p.rect), zTop: panes.length};
      if (w.tiled) tileRects(w); w.zTop = Math.max(...panes.map(p => p.z)); sessions.set(state.key, w);
    }
    return sessions.get(state.key);
  };
  const focusedPane = () => workspace().panes[workspace().focus] || workspace().panes[0];
  const current = () => focusedPane().state;
  const conversationKey = () => {
    const key='pinkie-desk-conversation:'+state.key;
    const w=workspace();if(w.conversation)return w.conversation;
    try{const saved=localStorage.getItem(key);if(/^agent:learning:desk-chat:[a-f0-9-]+$/.test(saved||''))w.conversation=saved;}catch{}
    w.conversation ||= 'agent:learning:desk-chat:'+crypto.randomUUID();
    try{localStorage.setItem(key,w.conversation);}catch{}return w.conversation;
  };
  const focused = pane => Boolean(state.root) && !workspace().chat && !workspace().chatFocus && focusedPane() === pane && !document.hidden;
  const saveWorkspace = () => { try { const w = workspace(); localStorage.setItem('pinkie-desk-pages:' + state.key, JSON.stringify({focus: w.focus, tiled: w.tiled, panes: w.panes.map(p => ({view: p.view, notesRoute: p.state.notesRoute, vocabRoute: p.state.vocabRoute, rect: p.rect, z: p.z}))})); } catch {} };
  // 页面刚加载时请求可能抢在 App 的 connect 握手前，被网关拒绝或连接还没就绪；这些请求都没被处理，
  // 稍等重试是安全的（包括作答这类写操作）。其他错误照旧抛出。
  const CONNECTING = /invalid handshake|first request must be connect|gateway socket unavailable|学习台正在连接/i;
  const readJobs = new Map();
  const request = (method, params = {}, timeout = 20000) => {
    const payload = {sessionKey: state.root && !workspace().chat ? conversationKey() : sessionKey(), ...params};
    const key = method === 'pinkie.learning.desk.today' ? method + ':' + payload.sessionKey : null;
    if (key && readJobs.has(key)) return readJobs.get(key);
    const job = (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const gateway = window.__laolaoSidebar?.gwRequest;
        if (typeof gateway !== 'function') throw new Error('学习台正在连接，请稍后再试');
        const result = await gateway(method, payload, timeout);
        if (/^pinkie\.learning\.(?:desk\.answer|notes\.(?:recall\.)?review|vocab\.review|desk\.lesson\.(?:begin|event|finish)|ref\.(?:collect|undo))$/.test(method)) window.dispatchEvent(new CustomEvent('pinkie:desk-changed', {detail:{sessionKey:payload.sessionKey}}));
        return result;
      } catch (error) {
        if (attempt >= 4 || !CONNECTING.test(error?.message || '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    })();
    if (key) { readJobs.set(key, job); job.finally(() => { if (readJobs.get(key) === job) readJobs.delete(key); }).catch(() => {}); }
    return job;
  };
  const tokens = {get: name => state.root ? getComputedStyle(state.root).getPropertyValue(name.startsWith('--') ? name : '--' + name).trim() : ''};
  const track = animation => { if (animation) { animations.add(animation); const complete = animation.eventCallback?.('onComplete'); animation.eventCallback?.('onComplete', () => { animations.delete(animation); complete?.(); }); } return animation; };
  const clearMotion = (finish = false) => {
    for (const animation of [...animations]) { if (finish) animation.progress?.(1); animation.kill?.(); animation.cancel?.(); }
    animations.clear();
    for (const split of splits) split.revert();
    splits.clear();
    // Removed view nodes cancel their CSS animations automatically. Enumerating
    // all 144 map animations here forces style work during the shared transition.
    state.confetti?.reset();
    state.root?.querySelectorAll('.morph').forEach(n => n.remove());
    // This GSAP instance belongs only to this desk and its registered views.
    for (const child of vendors.gsap?.globalTimeline.getChildren(true, true, true) || []) child.kill();
    vendors.gsap?.ticker.sleep();
  };
  const motion = {
    gsap: vendors.gsap || null,
    get reduced() { return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches); },
    splitIn(node, options = {}) {
      if (!node || motion.reduced || !state.root?.contains(node)) return null;
      if (!vendors.gsap || !vendors.SplitText) return null;
      const split = new vendors.SplitText(node, {type: 'chars', aria: 'auto'}); splits.add(split);
      const tween = vendors.gsap.from(split.chars, {opacity: 0, y: 14, duration: .55, stagger: .014, ease: 'power3.out', ...options});
      animations.add(tween);
      tween.eventCallback('onComplete', () => { split.revert(); splits.delete(split); animations.delete(tween); });
      return tween;
    },
    drawIn(path, options = {}) {
      if (!path || motion.reduced) return null;
      if (vendors.gsap && vendors.DrawSVGPlugin) return track(vendors.gsap.fromTo(path, {drawSVG: '0%'}, {drawSVG: '100%', duration: .6, ease: 'power2.out', ...options}));
      return null;
    },
    confettiAt(target, preset = 'small') {
      if (motion.reduced || !state.root || !vendors.confetti) return null;
      if (!state.confetti) state.confetti = vendors.confetti.create(state.root.querySelector('canvas.party'), {resize: true, useWorker: false});
      const bounds = state.root.getBoundingClientRect(), r = target?.getBoundingClientRect?.();
      const point = r ? {x: (r.left + r.width / 2 - bounds.left) / bounds.width, y: (r.top - bounds.top) / bounds.height} : target || {x: .4, y: .55};
      return state.confetti({particleCount: preset === 'large' ? 80 : 26, spread: 64, startVelocity: 34, gravity: 1.05, decay: .91, ticks: 190,
        origin: point, colors: [tokens.get('pink'), tokens.get('ink'), '#FFFFFF', '#F4C84A'], shapes: ['star', 'circle', 'square'], disableForReducedMotion: true});
    },
  };
  // 图标只有这一个出口（UI-UPGRADE.md 4.3）：Lucide 子集在 vendor/lucide/icons.js，本地打包、运行时不联网。
  // 旧名字只作别名保留，学习台自己的图标用 pinkie: 前缀。
  const ICON_ALIAS = {today: 'house', stage: 'pencil-line', board: 'chart-line', notes: 'notebook-text', vocab: 'book-a', chat: 'message-square', arrow: 'arrow-right', back: 'arrow-left'};
  // 笔记本 v2 的 Lucide 子集放在本文件，避免改动共用 vendor。
  const NOTE_ICONS = {"inbox": "<path d=\"M22 12h-6l-2 3h-4l-2-3H2\"/><path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z\"/>", "book-open": "<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>", "pen-line": "<path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z\"/>", "code": "<path d=\"m16 18 6-6-6-6M8 6l-6 6 6 6\"/>", "network": "<rect x=\"16\" y=\"16\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"2\" y=\"16\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"9\" y=\"2\" width=\"6\" height=\"6\" rx=\"1\"/><path d=\"M5 16v-4h14v4M12 12V8\"/>", "sigma": "<path d=\"M18 7V4H6l6 8-6 8h12v-3\"/>", "zap": "<path d=\"m13 2-3 8h9L8 22l3-8H2L13 2Z\"/>", "arrow-right-left": "<path d=\"m16 3 4 4-4 4M20 7H4m4 14-4-4 4-4M4 17h16\"/>", "notebook-pen": "<path d=\"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4M2 6h4M2 10h4M2 14h4M2 18h4\"/><path d=\"m17.5 2.5 4 4-9 9-5 1 1-5Z\"/>", "ellipsis": "<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/><circle cx=\"5\" cy=\"12\" r=\"1\"/>", "chevron-down": "<path d=\"m6 9 6 6 6-6\"/>", "plus": "<path d=\"M12 5v14M5 12h14\"/>", "sparkles": "<path d=\"m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z\"/><path d=\"M20 2v4M18 4h4M4 17v4M2 19h4\"/>", "copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\"/><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"/>", "download": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3\"/>", "list": "<path d=\"M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13\"/>", "layout-grid": "<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\"/><rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\"/>", "upload": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12\"/>", "undo-2": "<path d=\"M9 14 4 9l5-5\"/><path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11\"/>"};
  const ICON_SIZES = {xs: [14, 2], sm: [16, 1.75], md: [20, 1.6], lg: [24, 1.5]};
  const warnedIcons = new Set();
  const icon = (name, {size = 'md', label, value = 0} = {}) => {
    const holder = el('span', 'desk-icon desk-icon--' + size), [px, stroke] = ICON_SIZES[size] || ICON_SIZES.md;
    holder.style.width = holder.style.height = px + 'px';
    if (label) { holder.setAttribute('role', 'img'); holder.setAttribute('aria-label', label); } else holder.setAttribute('aria-hidden', 'true');
    const open = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + stroke + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    const set = {...NOTE_ICONS, ...(window.__pinkieDeskIcons || {})}, key = ICON_ALIAS[name] || name;
    let body = null;
    if (name === 'pinkie:brand' && set.star) body = set.star.replace('<path ', '<path fill="currentColor" ');
    else if (name === 'pinkie:progress') {
      const c = 2 * Math.PI * 9, done = Math.max(0, Math.min(1, Number(value) || 0));
      body = '<circle cx="12" cy="12" r="9" stroke="var(--hair-2)"/><circle cx="12" cy="12" r="9" transform="rotate(-90 12 12)" stroke-dasharray="' + (c * done).toFixed(2) + ' ' + c.toFixed(2) + '" style="transition:stroke-dasharray .2s"/>';
    } else if (set[key]) body = set[key];
    if (!body) { if (!warnedIcons.has(name)) { warnedIcons.add(name); console.warn('[study-desk] unknown icon:', name); } return holder; }
    holder.innerHTML = open + body + '</svg>'; return holder;
  };
  // 碧琪手账 v2：专属贴纸（白边已烘焙，480px WebP）和手绘索引贴图标（1.6px 圆头描边，故意不完全对称）。
  const sticker = name => BASE + 'study-desk/stickers/' + name + '.webp';
  const HAND = {
    today: '<path d="M6.2 7.4c5.3-.4 10.4-.5 15.6.1.4 5 .5 10 .1 15-5.2.4-10.4.5-15.7 0-.4-5.1-.4-10.1 0-15.1z"/><path d="M6.4 11.6c5.1-.2 10.3-.2 15.4 0M10 5v4M18 5v4"/><path d="M11.4 16.7l2 2 3.6-4.2"/>',
    stage: '<path d="M17.8 5.6l4.6 4.6-11.6 11.7-5.4 1 .9-5.5z"/><path d="M15.6 7.9l4.5 4.5M7.1 17.6l3.3 3.3"/>',
    board: '<path d="M4.8 21.6c6.2.3 12.4.3 18.6-.1"/><path d="M6 17.4l4.6-5 3.8 3 6.4-7.6"/><path d="M17.6 7.6l3.3.2.1 3.2"/><path d="M5.4 21.4v-2M9.4 21.6v-1.5M13.4 21.6v-2M17.4 21.6v-1.5M21.4 21.5v-2"/>',
    library: '<path d="M5.6 6.2h4.6v16.2H5.6zM10.2 8.4h4.2v14H10.2z"/><path d="M15.4 8.8l4.1-1.1 3.9 14.1-4.1 1.1z"/><path d="M5.6 10h4.6M10.2 12h4.2"/>',
    notes: '<path d="M8 5.2c4.9-.2 9.7-.2 14.4.2.3 5.8.3 11.6-.1 17.4-4.8.3-9.6.3-14.3 0z"/><path d="M5.4 8.6h4.4M5.4 13.6h4.4M5.4 18.6h4.4"/><path d="M12.6 10.4h6M12.6 14.4h6M12.6 18.4h3.6"/>',
    vocab: '<path d="M4.8 9.4l14.7-3.3 2.9 12.6-14.7 3.3z"/><path d="M9.6 16.4l2.3-6.6 3.4 5.8M10.4 14.3l3.8-.9"/><path d="M22.4 10.8l1.6 7"/>',
    chat: '<path d="M5.4 6.4c5.8-.5 11.5-.5 17.2 0 .4 3.9.4 7.7 0 11.5-3.6.3-7.2.4-10.8.3l-4.6 3.7.4-3.9c-.8-.1-1.5-.1-2.2-.2-.4-3.8-.4-7.6 0-11.4z"/><path d="M10 11h8.2M10 14.4h5"/>',
    moon: '<path d="M22.4 17A9.4 9.4 0 0111 5.2a9.4 9.4 0 1011.4 11.8z"/>',
    sun: '<path d="M14 9.2c2.7-.1 4.9 2 4.9 4.8s-2.1 4.9-4.8 4.9-4.9-2.2-4.9-4.9 2.1-4.7 4.8-4.8z"/><path d="M14 3.6v2.2M14 22.2v2.2M3.6 14h2.2M22.2 14h2.2M6.6 6.6l1.6 1.6M19.8 19.8l1.6 1.6M6.6 21.4l1.6-1.6M19.8 8.2l1.6-1.6"/>',
    box: '<path d="M5.2 5.6c5.9-.4 11.8-.4 17.7.1.4 5.6.4 11.1-.1 16.6-5.9.4-11.8.4-17.6 0-.4-5.6-.4-11.1 0-16.7z"/>',
    pencil: '<path d="M18 5.4l4.6 4.6-11.6 11.6-5.5.9.9-5.5z"/><path d="M15.7 7.7l4.6 4.6"/>',
  };
  const handIcon = name => {
    if (!HAND[name]) return icon(name);
    const holder = el('span', 'desk-icon pk-hand-icon'); holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = '<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + HAND[name] + '</svg>';
    return holder;
  };
  const emptyState = (title, sentence, actions, art = 'thinking-pencil') => {
    const box = el('div', 'desk-empty'), img = el('img', 'pk-sticker'); img.src = sticker(art); img.alt = ''; img.setAttribute('aria-hidden', 'true');
    const row = el('div', 'desk-empty-actions'); row.append(...actions);
    box.append(img, el('h2', 'desk-empty-title', title), el('p', '', sentence), row); return box;
  };
  const notice = text => { if (state.root) { const n = state.root.querySelector('.desk-status'); n.textContent = text; } };
  const context = pane => ({request, sessionKey:conversationKey, motion: pane.motion, tokens, go: (id, options) => goPane(pane, id, options), local: () => pane.state, pane, desk: deskForPane(pane)});
  let focusQueue = Promise.resolve(), focusOwned = null;
  function syncFocusClock() {
    focusQueue = focusQueue.then(async () => {
      const pane = state.root ? focusedPane() : null;
      const wanted = pane && focused(pane) && pane.view === 'stage' && !pane.state.stage?.summary;
      const owner = wanted ? state.key + '/' + pane.id : '';
      if (focusOwned && focusOwned.owner !== owner) {
        const previous = focusOwned; focusOwned = null;
        await request('pinkie.learning.focus.stop', {sessionKey: previous.key, id: previous.id});
      }
      if (!wanted || focusOwned) return;
      const key = state.key, chapter = pane.state.stage?.set?.questions?.[pane.state.stage.index]?.k || '';
      const subject = pane.state.today?.mastery?.subjects?.find(s => s.chapters.some(ch => ch.k === chapter))?.id || (/^ee/.test(chapter) ? 'ee' : /^net/.test(chapter) ? 'net' : /^c/.test(chapter) ? 'c' : /^e/.test(chapter) ? 'en' : /^m/.test(chapter) ? 'math' : '');
      const existing = await request('pinkie.learning.focus.status', {sessionKey: key});
      if (!existing.active && state.key === key && focused(pane)) {
        const result = await request('pinkie.learning.focus.start', {sessionKey: key, minutes: pane.state.today?.goals?.minutes || 30, ...(chapter ? {chapter} : {}), ...(subject ? {subject} : {})});
        if (result.focus?.id) focusOwned = {owner, key, id: result.focus.id};
      }
    }).catch(error => { if (state.root) notice('专注记录：' + error.message); });
  }
  function createBuiltin(pane, shell) {
    // Every callback below closes over its own page, including callbacks resumed after an RPC.
    const state = new Proxy(shell, {
      get(target, key) { return key === 'root' ? pane.host : key === 'active' ? pane.view : ['timer', 'tuckBubble'].includes(key) ? pane[key] : target[key]; },
      set(target, key, value) { if (['timer', 'tuckBubble'].includes(key)) pane[key] = value; else target[key] = value; return true; }
    });
    const current = () => pane.state, motion = pane.motion;
    const go = (id, options) => goPane(pane, id, options), renderView = id => renderPane(pane, id);
    const context = () => window.__pinkieStudyDesk.context(pane);
    const focusClock = () => syncFocusClock();
    const track = animation => { if (animation) pane.animations.add(animation); return animation; };
    const lesson = () => window.__pinkieStudyDeskLesson?.forPane?.(pane) || window.__pinkieStudyDeskLesson;
  const reveal = (node, i) => { node.classList.add('rv'); node.style.setProperty('--i', i); return node; };
  const clone = value => JSON.parse(JSON.stringify(value));
  function mockToday() {
    const subjects = clone(MOCK_DATA.syllabus).map(subject => ({...subject, chapters: subject.chapters.map(chapter => ({...chapter, items: chapter.items.map((text, i) => ({i, text, state: 'none', evidence: {attempts: 0, correct: 0, lastAt: 0}}))}))}));
    return {date: new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai'}).format(new Date()), studyDay: 1,
      exams: [{id: 'pretco-b', name: '英语 B 级', date: null, daysLeft: null}, {id: 'zsb', name: '专升本', date: null, daysLeft: null}],
      streak: {current: 0}, goals: {minutes: 30, questions: 20}, progress: {minutes: 0, questions: 0, reviews: 0},
      focus: {kind: 'set', title: 'C 语言 · 循环结构', subtitle: '6 道题，约 12 分钟。先自己判断，再一起核对。', payload: {chapter: 'c5', size: 6}},
      quiet: [{kind: 'vocab', label: '背单词', meta: '打开生词复习'}, {kind: 'notes', label: '笔记回顾', meta: '今天最多 10 条'}, {kind: 'retest', label: '错题复测', meta: '复测到期考点'}],
      mastery: {total: 144, lit: 0, mastered: 0, subjects}, biqiLine: {text: '先生，先做一小组。答完以后，我们再看哪里需要补一补。', source: 'rule'}};
  }
  function mockRequest(method, params, local = current()) {
    if (method.endsWith('.today')) return clone(local.mockToday || (local.mockToday = mockToday()));
    if (method.endsWith('.set')) {
      const candidates = MOCK_DATA.questions.filter(q => !params.chapter || q.k === params.chapter);
      const selected = [...candidates, ...MOCK_DATA.questions.filter(q => !candidates.includes(q))].slice(0, params.size || 6);
      const set = {setId: 'demo-' + Date.now(), title: 'C 语言 · 循环结构', questions: selected.map(q => ({id: q.id, k: q.k, i: 0, kind: 'single', q: q.q, o: q.o}))};
      local.mockSet = set; return clone(set);
    }
    if (method.endsWith('.answer')) {
      const q = MOCK_DATA.questions.find(q => q.id === params.questionId); if (!q) throw Error('示意题目不存在');
      const correct = params.answer === q.a;
      return {correct, answer: q.a, explanation: q.x, independent: correct && !params.hintUsed && params.confidence >= 70, item: {k: q.k, i: 0, state: 'none'}, lit: false, streakToday: 0};
    }
    throw Error('示意数据不支持这个操作');
  }
  async function deskRequest(suffix, params = {}) {
    const local = current();
    const method = 'pinkie.learning.desk.' + suffix;
    if (local.lessonUi?.mock.has('lesson') && ['set', 'answer'].includes(suffix)) { local.demo = true; return mockRequest(method, params, local); }
    // Only a missing method enables demonstration mode. Other errors remain visible.
    try { const result = await request(method, params); local.demo = false; return result; }
    catch (error) { if (!/unknown method|method (?:not found|not registered)|未知方法/i.test(error.message || '')) throw error; local.demo = true; return mockRequest(method, params, local); }
  }
  const showDemo = host => { if (current().demo) host.append(el('small', 'demo-label', '示意数据')); };
  function animateCount(node, to) {
    if (!Number.isFinite(to)) return;
    if (motion.reduced || !vendors.gsap) { node.textContent = String(to); return; }
    const value = {n: 0};
    track(vendors.gsap.to(value, {n: to, duration: 1.1, ease: 'power3.out', onUpdate: () => { if (node.isConnected) node.textContent = Math.round(value.n); }}));
  }
  async function askBiqi(message) {
    const key = state.key;
    if (!message.trim()) return;
    if (window.__pinkieDeskChat?.send) return window.__pinkieDeskChat.send(message.trim());
    await request('chat.send', {sessionKey: conversationKey(), message: message.trim(), idempotencyKey: crypto.randomUUID()}, 30000);
    if (state.key !== key) return;
    window.__pinkieDeskSplit?.open?.();
    // The rail's stage button returns to the saved question, selections and feedback.
    document.querySelector('.agent-chat__input textarea, textarea.agent-chat__textarea')?.focus();
  }
  function examForm(exam, host) {
    state.root.querySelector('dialog.desk-exam')?.remove();
    const dialog = el('dialog', 'desk-exam'), form = el('form'); form.method = 'dialog';
    const label = el('label', '', exam.name + '考试日期'), input = el('input'); input.type = 'date'; input.required = true; input.value = exam.date || ''; label.append(input);
    const error = el('p', 'err'); error.setAttribute('role', 'status');
    const save = button('保存日期', () => {}, 'confirm'); save.type = 'submit';
    form.append(el('h3', '', '设置考试日期'), label, error, save, button('取消', () => dialog.close(), 'link')); dialog.append(form); state.root.append(dialog);
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!input.value || save.disabled) return; save.disabled = true;
      try {
        const exams = (current().today?.exams || []).map(item => ({id: item.id, name: item.name, date: item.id === exam.id ? input.value : item.date}));
        await request('pinkie.learning.pact.set', {patch: {exams}}); dialog.close(); if (host.isConnected) renderView('today');
      } catch (err) { error.textContent = err.message; } finally { save.disabled = false; }
    });
    dialog.showModal(); input.focus();
  }
  async function mountToday(host) {
    host.classList.add('home'); host.setAttribute('aria-busy', 'true');
    const loading = el('p', 'desk-loading', '正在打开今日学习…'); host.append(loading);
    let data;
    try { data = await deskRequest('today'); }
    catch (error) { if (!host.isConnected) return; loading.textContent = error.message; host.append(button('重试', () => renderView('today'), 'link')); host.setAttribute('aria-busy', 'false'); return; }
    if (!host.isConnected) return;
    current().today = data; host.replaceChildren(); host.setAttribute('aria-busy', 'false');
    const left = el('div', 'h-left'), right = el('div', 'h-right');
    const date = new Date(data.date + 'T12:00:00+08:00');
    const dateLabel = Number.isFinite(+date) ? `${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日 · 星期${'日一二三四五六'[date.getUTCDay()]}` : data.date;
    // 页眉小字：日期 · 时段，农历和节气用碧琪的铅笔字；「备考第 N 天」盖在页边。
    const alm = data.almanac, hero = alm?.protagonist, hour = Number.isFinite(alm?.hour) ? alm.hour : Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23'}).format(new Date())), night = hour >= 18 || hour < 5, greeting = hero?.greeting?.replace(/，先生$/, '') || (night ? '晚上好' : hour < 12 ? '早上好' : '下午好');
    const dateRow = reveal(el('div', 'desk-date-row'), 0), dateText = el('div', 'date', `${dateLabel} · ${alm?.period?.label || (night ? '晚上' : hour < 12 ? '早上' : '下午')}`);
    if (alm?.notes?.length) dateText.append(el('span', 'pk-alm', alm.notes.join(' · ')));
    dateRow.append(dateText);
    lesson()?.mountStatus(dateRow, data.materials); left.append(dateRow);
    const dayStamp = el('span', 'pk-stamp pk-mstamp', `第 ${data.studyDay || 1} 天`); dayStamp.dataset.tone = 'ink'; host.append(dayStamp);
    // 页码 = 这一天是今年手账的第几页（北京日期）。
    const yearDay = Number.isFinite(+date) ? Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000) + 1 : 0;
    if (yearDay) host.append(el('div', 'pk-pageno', 'P.' + yearDay));
    if (alm) { state.root.dataset.tape = hero?.tape || alm.season || ''; state.root.dataset.period = alm.period?.id || ''; state.root.toggleAttribute('data-quiet', Boolean(hero?.quiet)); }
    const greet = el('h2', 'greet', `${greeting}，先生。`); greet.append(el('span', 'greet-sub', hero?.late ? '剩下的明天再做，早点睡。' : hero?.quiet ? '今晚只做这一件。' : night ? '今晚只做一件事就好。' : '今天只做一件事就好。')); left.append(reveal(greet, 1));
    const focus = data.focus || {}, kind = focus.kind;
    const task = button('', () => {
      if (focus.payload?.practiceInChat) {
        if (task.disabled) return; task.disabled = true;
        void askBiqi(`请围绕「${focus.title || '这个考点'}」出一道理解练习题，一次只出一题。`).catch(error => notice(error.message)).finally(() => { task.disabled = false; });
      } else if (kind === 'learn' || kind === 'lesson') void lesson()?.openFocus(focus);
      else void startSet(focus.payload || {}, task);
    }, 'task'); task.setAttribute('aria-label', '开始：' + (focus.title || '今日练习')); task.dataset.kind = kind || 'set';
    const title = /^(?:学|继续|继续上课)\s*·/.test(focus.title || '') ? focus.title : (kind === 'learn' ? '学 · ' : kind === 'lesson' ? '继续 · ' : '') + (focus.title || '今日练习');
    // 胶带卡：标题里考点那一段用荧光笔（一页只此一处），右边是粉色「开始 ★」。
    const taskTitle = el('h3'), cut = title.lastIndexOf(' · ');
    if (cut > 0) { const hl = el('span', 'pk-hl', title.slice(cut + 3)); if (!motion.reduced) hl.classList.add('pk-anim'); taskTitle.append(title.slice(0, cut + 3), hl); } else taskTitle.textContent = title;
    const copy = el('div'); copy.append(el('small', '', kind === 'learn' ? '今日 · 先学' : kind === 'lesson' ? '上次没讲完' : '今日 · 碧琪替你挑的'), taskTitle, el('p', '', focus.subtitle || '先从一小组开始。'));
    const start = el('span', 'go', kind === 'lesson' ? '继续' : kind === 'learn' ? '去学' : '开始'); start.append(window.__pinkieDeskKit?.star('full') || ''); task.append(copy, start); left.append(reveal(task, 2));
    const quiet = el('div', 'quiet');
    for (const item of data.quiet || []) {
      // 背单词进生词本直接开始复习；笔记回顾进笔记本的「今天回顾」；旧版 review 仍走舞台闪卡。
      const open = {vocab: () => go('vocab', {review: true}), notes: () => go('notes', {view: 'review'}), review: () => void switchStageMode('flashcard')}[item.kind] || (() => void startSet({mode: 'retest', size: 6}, task));
      const row = button('', open, 'q-row');
      row.append(handIcon('box'), el('span', 'stroke', item.label), el('em', '', item.meta || '')); quiet.append(row);
    }
    left.append(reveal(quiet, 3));
    const ask = el('form', 'ask'), input = el('input'); input.placeholder = '问碧琪，或者说「出 3 道 RC 暂态」'; input.setAttribute('aria-label', '问碧琪');
    // 发送键、发送中和失败都显示在输入框上：只靠回车、错误只写在角落里，先生会以为发不出去。
    const send = el('button', 'ask-send'); send.type = 'submit'; send.disabled = true; send.setAttribute('aria-label', '发送'); send.append(icon('arrow-up', {size: 'sm'}));
    const askError = el('p', 'ask-error'); askError.setAttribute('role', 'alert'); askError.hidden = true;
    ask.append(handIcon('pencil'), input, el('kbd', '', /Mac/.test(navigator.platform) ? '⌘K' : 'Ctrl K'), send);
    const sync = () => { send.disabled = ask.classList.contains('sending') || !input.value.trim(); };
    input.addEventListener('input', () => { askError.hidden = true; sync(); });
    ask.addEventListener('click', event => { if (!event.target.closest('button')) input.focus(); });
    ask.addEventListener('submit', async event => {
      event.preventDefault(); if (ask.classList.contains('sending') || !input.value.trim()) return;
      ask.classList.add('sending'); input.readOnly = true; askError.hidden = true; send.replaceChildren(icon('loader-circle', {size: 'sm', label: '发送中'})); sync();
      try { await askBiqi(window.__pinkieDeskHandbook?.withRefs?.(input.value, ask) ?? input.value); input.value = ''; }
      catch (error) { askError.textContent = '没发出去：' + (error.message || '连接断了') + '。文字还在，再按一次发送。'; askError.hidden = false; }
      finally { ask.classList.remove('sending'); input.readOnly = false; send.replaceChildren(icon('arrow-up', {size: 'sm'})); sync(); }
    });
    left.append(reveal(ask, 4), askError);
    const countdown = el('div', 'countdown');
    [...(data.exams || [])].sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)).forEach((exam, i) => {
      const card = el('div', 'cd' + (i ? ' far' : '')), name = el('small', '', exam.name + (exam.date ? ' 还剩' : '')); if (!i && exam.date) name.prepend(el('i'));
      card.append(name);
      if (exam.date && Number.isFinite(exam.daysLeft)) { const number = el('b'), count = el('strong', '', '0'); number.append(count, el('span', '', '天')); card.append(number, el('em', '', exam.note || '')); animateCount(count, exam.daysLeft); }
      else { const number = el('b', 'cd-none'); number.append(el('strong', '', '未定')); const set = button('设置考试日期', () => examForm(exam, host), 'exam-set'); set.prepend(icon('calendar', {size: 'xs'})); card.append(number, set); }
      countdown.append(card);
    });
    // 连续天数用一排七颗星（星星是唯一的进度单位）；目标和上课数是铅笔小字。
    const kit = window.__pinkieDeskKit, streakDays = data.streak?.current || 0, streak = el('div', 'pk-streak', `连续 ${streakDays} 天`);
    if (kit) streak.append(kit.stars(Array.from({length: 7}, (_, i) => i < streakDays % 7 || (streakDays && streakDays % 7 === 0) ? 'full' : ''), {label: `连续 ${streakDays} 天`}));
    right.append(reveal(countdown, 1), reveal(streak, 2), reveal(el('div', 'cd-sub', `每天 ${data.goals?.minutes ?? 30} 分钟 · 上课 ${data.progress?.lessons || 0} / ${data.goals?.lessons ?? 2} 节`), 2));
    const warning = data.subjectWarnings?.[0];
    if (warning) right.append(el('p', 'subject-warning', `${warning.name}已有 ${warning.daysIdle ?? '几'} 天没碰，可以留一小组给它。`));
    const map = el('div', 'map in'), heading = el('div', 'map-h'), count = el('b', '', String(data.mastery?.lit || 0));
    heading.append(count, document.createTextNode(` / ${data.mastery?.total || 144} 个考点已点亮`)); map.append(heading);
    const rows = el('div', 'map-rows'), cap = el('div', 'map-cap', '悬停看考点，点一下，先学再练。'); let index = 0;
    for (const subject of data.mastery?.subjects || []) {
      const row = el('div', 'mrow'), dots = el('div', 'dots'); const label = el('span', 'mrow-name'); label.title = subject.name; label.append(el('span', 'full', subject.name), el('span', 'short', {'计算机网络': '计网', '电工电子': '电工'}[subject.name] || subject.name)); row.append(label, dots);
      for (const [ci, chapter] of subject.chapters.entries()) for (const [ii, item] of chapter.items.entries()) {
        const dot = button('', () => {
          if (lesson()) void lesson().open({k: chapter.k, i: item.i ?? ii});
          else void startSet({chapter: chapter.k, item: item.i, size: 3}, task);
        }, 'dot' + (item.state === 'mastered' ? ' m' : item.state === 'lit' ? ' l' : item.state === 'weak' ? ' weak' : item.state === 'learned' ? ' learned' : '') + (!ii && ci ? ' gap' : ''));
        if (kit) dot.append(kit.star(item.state || 'none'));
        dot.dataset.ch = chapter.k; dot.style.setProperty('--d', index++); dot.setAttribute('aria-label', `${subject.name} · ${chapter.t} · ${item.text}`);
        const description = `${subject.name} · ${chapter.t}：${item.text} · ${{none: '没学', learned: '学过', lit: '做对过', mastered: '独立掌握', weak: '待复测'}[item.state] || '没学'} · 上过 ${item.evidence?.lessons || 0} 节课 · 答过 ${item.evidence?.attempts || 0} 题`;
        dot.setAttribute('aria-label', description);
        const focus = () => { cap.textContent = description; rows.querySelectorAll('.dot').forEach(n => n.classList.toggle('dim', n.dataset.ch !== chapter.k)); };
        const blur = () => rows.querySelectorAll('.dot').forEach(n => n.classList.remove('dim'));
        dot.addEventListener('pointerenter', focus); dot.addEventListener('focus', focus); dot.addEventListener('pointerleave', blur); dot.addEventListener('blur', blur); dots.append(dot);
      }
      rows.append(row);
    }
    const legend = el('div', 'map-legend'); for (const [st, label] of [['none', '没学'], ['learned', '学过'], ['weak', '待复测'], ['lit', '做对过'], ['mastered', '独立掌握']]) { const entry = el('span'); entry.dataset.state = st; entry.append(kit ? kit.star(st) : el('i', 'map-key'), document.createTextNode(label)); legend.append(entry); }
    map.append(rows, legend, cap); right.append(map);
    // 碧琪贴纸按时段换：白天抱着热可可，傍晚以后在台灯下翻手账，深夜打哈欠。
    const special = hero?.id === 'exam-day' ? 'exam-day' : !hero?.quiet && hero?.id === 'festival' ? ({'new-year':'fest-newyear',spring:'fest-spring',chuxi:'fest-spring',lantern:'fest-lantern',sanyuesan:'fest-sanyuesan'}[hero.festival]) : null;
    const buddy = el('img', 'biqi pk-sticker'); buddy.src = sticker(hero?.late ? 'late-yawn' : special || (hour >= 5 && hour < 17 ? 'today-morning' : 'today-night')); buddy.alt = '碧琪'; buddy.decoding = 'async';
    const bubble = el('div', 'bubble pk-note', data.biqiLine?.text || '先生，先做一小组。'); right.append(buddy, bubble);
    // 气泡不许压住地图说明或地图的点（UI-UPGRADE.md 5.1）；压到时收成小圆点，悬停再展开。
    bubble.tabIndex = 0;
    state.tuckBubble = () => {
      if (!bubble.isConnected) return; bubble.classList.remove('tucked');
      const b = bubble.getBoundingClientRect();
      const hit = [...host.querySelectorAll('.map-cap,.map-rows,.map-legend')].some(n => { const r = n.getBoundingClientRect(); return r.width && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; });
      bubble.classList.toggle('tucked', hit);
    };
    requestAnimationFrame(() => state.tuckBubble?.()); setTimeout(() => state.tuckBubble?.(), 900);
    host.append(left, right); showDemo(host);
    try { window.__pinkieDeskHandbook?.today(host, data, context()); } catch (error) { console.warn('[study-desk] handbook', error); }
    if (current().focusAsk) { current().focusAsk = false; input.focus(); }
  }
  function pauseStage() {
    clearInterval(state.timer); state.timer = 0;
    const stage = current().stage;
    if (stage?.activeAt) { stage.elapsed += performance.now() - stage.activeAt; stage.activeAt = 0; }
  }
  function stageSeconds(stage) { return Math.floor((stage.elapsed + (stage.activeAt ? performance.now() - stage.activeAt : 0)) / 1000); }
  async function startSet(params = {}, source) {
    if (current().loadingSet) return;
    const local = current(), key = state.key, generation = state.generation; local.loadingSet = true;
    if (source) source.disabled = true;
    try {
      const set = await deskRequest('set', {size: 6, mode: 'practice', ...params});
      if (!state.root || key !== state.key || generation !== state.generation) return;
      if (!set.questions?.length) throw Error('这组暂时没有可用题目，换个考点试试');
      local.stageMode = 'practice';
      local.stage = {set, index: 0, selected: [], confidence: null, hintUsed: false, results: [], elapsed: 0, activeAt: 0, questionAt: Date.now(), streak: 0, mode: 'practice'};
      if (!source?.isConnected || motion.reduced || !vendors.gsap || state.active !== 'today') { go('stage'); return; }
      const root = state.root, rect = source.getBoundingClientRect(), origin = root.getBoundingClientRect();
      const width = origin.width - 114, height = origin.height - 28;
      const morph = el('div', 'morph'); Object.assign(morph.style, {left: '100px', top: '14px', width: width + 'px', height: height + 'px', borderRadius: '28px', backgroundColor: tokens.get('card'), transformOrigin: '0 0'}); root.append(morph);
      track(vendors.gsap.timeline({onComplete: () => { if (state.root === root) go('stage'); morph.remove(); }})
        .to(source.closest('.view'), {opacity: 0, y: -8, duration: .13, ease: 'power2.in'}, 0)
        .fromTo(morph, {x: rect.left - origin.left - 100, y: rect.top - origin.top - 14, scaleX: rect.width / width, scaleY: rect.height / height}, {x: 0, y: 0, scaleX: 1, scaleY: 1, duration: .26, ease: 'power2.inOut'}, 0));
    } catch (error) { if (key === state.key) notice(error.message); }
    finally { local.loadingSet = false; if (source) source.disabled = false; }
  }
  const question = stage => stage.set.questions[stage.index];
  const answerIds = answer => Array.isArray(answer) ? answer.map(String) : String(answer ?? '').split(/[,，\s]+/).filter(Boolean);
  const optionId = (option, index) => typeof option === 'object' ? String(option.id || 'ABCD'[index] || index + 1) : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[index];
  // 题库题干和代码之间可能隔一个空行，也可能只换一行；综合题拆出的小题在最后一个空行后带小题标记（① 或「(1) 输出的 max = ____」）。
  function stemParts(q) {
    let body = String(q.q || ''), part = '';
    if (q.kind === 'blank' && body.includes('\n\n')) { const at = body.lastIndexOf('\n\n'); part = body.slice(at + 2).trim(); body = body.slice(0, at); }
    let [stem, ...rest] = body.split('\n\n'), code = rest.join('\n\n');
    if (!code && stem.includes('\n')) { const [first, ...lines] = stem.split('\n'); if (/[;{}#]/.test(lines.join('\n'))) { stem = first; code = lines.join('\n'); } }
    const judge = q.kind === 'single' && /^判断[：:]/.test(stem);
    return {stem: judge ? stem.replace(/^判断[：:]\s*/, '') : stem, code, part, judge};
  }
  function pickOption(index, event) {
    const stage = current().stage, q = stage && question(stage);
    if (!q || stage.pending || stage.results[stage.index] || stage.summary || !q.o?.[index]) return;
    const id = q.optionIds?.[index] || optionId(q.o[index], index);
    stage.selected = q.kind === 'multi' ? stage.selected.includes(id) ? stage.selected.filter(x => x !== id) : [...stage.selected, id] : [id];
    // 晕墨从落笔处开始；键盘作答没有坐标，就从序号圆圈开始。
    const target = event?.currentTarget, r = event?.detail && target?.getBoundingClientRect();
    if (r) { target.style.setProperty('--ink-x', event.clientX - r.left + 'px'); target.style.setProperty('--ink-y', event.clientY - r.top + 'px'); }
    state.root.querySelectorAll('.opt').forEach(n => { const selected = stage.selected.includes(n.dataset.option); n.classList.toggle('sel', selected); n.setAttribute('aria-pressed', String(selected)); });
    const error = state.root.querySelector('.err'); if (error) error.textContent = '';
  }
  function hop(buddy) {
    if (!buddy || motion.reduced) return;
    if (!vendors.gsap) { buddy.classList.remove('psd-hop'); void buddy.offsetWidth; buddy.classList.add('psd-hop'); buddy.addEventListener('animationend', () => buddy.classList.remove('psd-hop'), {once: true}); return; }
    buddy.style.animation = 'none';
    track(vendors.gsap.timeline({defaults: {transformOrigin: '50% 100%'}, onComplete: () => { buddy.style.animation = ''; vendors.gsap.set(buddy, {clearProps: 'transform'}); }})
      .to(buddy, {scaleY: .93, scaleX: 1.05, duration: .12, ease: 'power2.out'})
      .to(buddy, {y: -18, scaleY: 1.05, scaleX: .97, duration: .24, ease: 'power2.out'})
      .to(buddy, {y: 0, scaleY: .96, scaleX: 1.03, duration: .2, ease: 'power2.in'})
      .to(buddy, {scaleY: 1, scaleX: 1, duration: .5, ease: 'elastic.out(1, .45)'}));
  }
  async function submitAnswer() {
    const stage = current().stage, q = stage && question(stage); if (!q || stage.pending || stage.summary || stage.results[stage.index]) return;
    const blank = state.root.querySelector('.blank-answer')?.value.trim();
    if (q.kind === 'blank' ? !blank : !stage.selected.length) { state.root.querySelector('.err').textContent = '先写下你的答案'; return; }
    stage.pending = true;
    const confirm = state.root.querySelector('.confirm-answer'); if (confirm) { confirm.disabled = true; confirm.textContent = '正在核对…'; }
    const key = state.key;
    try {
      const result = await deskRequest('answer', {setId: stage.set.setId, questionId: q.id, answer: q.kind === 'blank' ? blank : q.kind === 'multi' ? [...stage.selected].sort() : stage.selected[0], confidence: stage.confidence, hintUsed: stage.hintUsed, ms: Math.max(0, Date.now() - stage.questionAt)});
      stage.results[stage.index] = result; stage.streak = result.correct ? stage.streak + 1 : 0; stage.pending = false;
      if (state.key !== key || current().stage !== stage) return;
      if (state.active === 'stage') {
        paintAnswer(state.root.querySelector('.view[data-view="stage"]'), stage);
        if (result.correct) hop(state.root.querySelector('.fig img'));
        if (stage.streak === 3) motion.confettiAt(state.root.querySelector('.opt.ok'), 'small');
      }
    } catch (error) { stage.pending = false; if (state.key === key && state.active === 'stage') { const n = state.root.querySelector('.err'); if (n) n.textContent = error.message; if (confirm?.isConnected) { confirm.disabled = false; confirm.textContent = '重试核对'; } } }
  }
  function nextQuestion() {
    const stage = current().stage; if (!stage || stage.pending || !stage.results[stage.index] || stage.summary) return;
    if (stage.index + 1 >= stage.set.questions.length) {
      stage.summary = true; renderView('stage'); motion.confettiAt({x: .4, y: .55}, 'large'); hop(state.root.querySelector('.fig img')); return;
    }
    stage.index++; stage.selected = []; stage.confidence = null; stage.hintUsed = false; stage.questionAt = Date.now(); renderView('stage');
  }
  function showHint() {
    const stage = current().stage; if (!stage || stage.results[stage.index] || stage.summary) return;
    stage.hintUsed = true;
    const say = state.root.querySelector('.say'); if (!say) return;
    say.replaceChildren(); speak(say, [HINT], '已记录使用提示，这次答对后先不算独立掌握。');
  }
  const HINT = '先生，先把题目里的已知条件圈出来，再一步步推；拿不准的选项先排除。';
  const optionNumber = (q, id) => { const i = (q.optionIds || (q.o || []).map(optionId)).indexOf(id); return i < 0 ? id : String(i + 1); };
  function feedback(stage, result, q) {
    if (!result.correct) return q.kind === 'blank' ? `差一点，答案是 ${String(result.answer ?? '')}。` : `差一点，正确的是第 ${answerIds(result.answer).map(id => optionNumber(q, id)).join('、')} 项。明天不看提示再做一次。`;
    if (result.independent) return result.lit ? '对，而且你很确定，这个考点亮一格。' : '对，而且你很确定。';
    if (stage.hintUsed) return '对了。这次看过提示，明天不看提示再试一次。';
    if (stage.confidence == null) return '对了！下次选一下把握度，我才知道你是不是真的会了。';
    return '对了。你说还没把握，先记作待确认，明天再考你一次。';
  }
  // 作答结果原地落到当前题上：选项晕墨或划掉、进度段、碧琪换图、讲解。不重建舞台，题干也不重播。
  function paintAnswer(host, stage) {
    const result = stage.results[stage.index], q = question(stage); if (!host || !result) return;
    const answer = answerIds(result.answer);
    host.querySelectorAll('.opt').forEach(b => {
      const id = b.dataset.option, correct = answer.includes(id);
      b.classList.remove('sel'); b.classList.add('answered');
      if (correct) b.classList.add(result.correct ? 'ok' : 'rev'); else if (stage.selected.includes(id)) b.classList.add('no');
      b.disabled = true;
    });
    host.querySelectorAll('.conf button').forEach(b => { b.disabled = true; });
    const input = host.querySelector('.blank-answer'); if (input) input.disabled = true;
    const seg = host.querySelectorAll('.segs i')[stage.index]; if (seg) { seg.className = result.correct ? 'ok' : 'no'; seg.replaceChildren(window.__pinkieDeskKit?.star(result.correct ? 'full' : 'half') || ''); seg.setAttribute('aria-label', `第 ${stage.index + 1} 题${result.correct ? '答对' : '待复测'}`); }
    const streak = host.querySelector('.streak'); if (streak) { streak.classList.toggle('on', stage.streak >= 2); streak.textContent = stage.streak >= 2 ? `连对 ${stage.streak}` : ''; }
    const confirm = host.querySelector('.confirm-answer');
    if (confirm) { confirm.disabled = false; confirm.replaceChildren(document.createTextNode(stage.index + 1 === stage.set.questions.length ? '看看这一组' : '下一题'), el('kbd', '', 'N')); }
    // 碧琪的贴纸跟着结果换：答对举星星（连对 3 题蹦起来），答错递橡皮。
    const buddy = host.querySelector('.fig img'); if (buddy) buddy.src = sticker(result.correct ? stage.streak >= 3 ? 'streak3' : 'correct' : 'wrong-eraser');
    const say = host.querySelector('.say'); if (say) { say.replaceChildren(); speak(say, [feedback(stage, result, q)], result.explanation || ''); }
  }
  function stageHeader(host, stage) {
    const top = el('header', 's-top'), back = button('', () => go('today'), 'back'); back.setAttribute('aria-label', '返回今日'); back.append(icon('arrow-left'));
    const heading = el('div', 's-heading'); heading.append(el('div', 'crumb', '舞台 · ' + (stage?.set?.title || '学习舞台')));
    if (stage?.set && !stage.summary) heading.append(el('h2', 's-number', `第 ${stage.index + 1} 题`));
    top.append(back, heading);
    if (stage?.set) {
      const segs = el('div', 'segs'); stage.set.questions.forEach((q, i) => { const seg = el('i', stage.results[i] ? stage.results[i].correct ? 'ok' : 'no' : i === stage.index ? 'cur' : ''); seg.setAttribute('aria-label', `第 ${i + 1} 题${stage.results[i] ? stage.results[i].correct ? '答对' : '待复测' : ''}`); seg.append(window.__pinkieDeskKit?.star(stage.results[i] ? stage.results[i].correct ? 'full' : 'half' : '') || ''); segs.append(seg); }); top.append(segs);
      top.append(el('span', 'streak' + (stage.streak >= 2 ? ' on' : ''), stage.streak >= 2 ? `连对 ${stage.streak}` : ''));
    }
    const clock = el('span', 'clock'); top.append(clock);
    const update = () => { const seconds = stage ? stageSeconds(stage) : 0; clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
    update(); pane.updateClock = stage && !stage.summary ? update : null; if (pane.updateClock && focused(pane)) state.timer = setInterval(update, 1000);
    const modes = el('div', 'modes'); for (const [id, title] of [...[...stageModes].map(([id, spec]) => [id, spec.title]), ['practice', '刷题'], ['flashcard', '闪卡'], ['experiment', '实验'], ['mock', '模拟考']]) { const b = button(title, () => void switchStageMode(id), (stage?.mode || current().stageMode || 'practice') === id ? 'on' : ''); b.dataset.mode = id; modes.append(b); } const menu = button('模式', () => { top.classList.toggle('s-modes-open'); menu.setAttribute('aria-expanded', String(top.classList.contains('s-modes-open'))); }, 's-mode-toggle'); menu.setAttribute('aria-expanded', 'false'); top.append(menu, modes); host.append(top);
  }
  function speak(host, lines, key) {
    host.append(el('div', 'who', '碧琪写在页边'));
    for (const [i, text] of lines.entries()) { const p = el('p'), line = el('span', 'ln', text); line.style.animationDelay = i * 90 + 'ms'; p.append(line); host.append(p); }
    if (key) { const line = el('p', 'ln keyp', key); line.style.animationDelay = lines.length * 90 + 60 + 'ms'; host.append(line); }
  }
  function mountStage(host) {
    host.classList.add('stage');
    if (stageModes.has(current().stageMode)) { stageHeader(host); return stageMode(pane).mount(host, context()); }
    const stage = current().stage;
    if (current().stageMode && current().stageMode !== 'practice') { mountOtherStage(host); return; }
    if (!stage) { stageHeader(host); const empty = el('div', 'stage-empty'); empty.append(emptyState('先从一小组开始。', '碧琪会挑 6 道题，做完一起看哪里还不稳。', [button('开始练习', () => void startSet(), 'confirm'), button('回到今日', () => go('today'), 'link')])); host.append(empty); return; }
    stage.mode = 'practice'; if (!stage.summary && focused(pane)) stage.activeAt = performance.now(); stageHeader(host, stage);
    const column = el('div', 'qcol'), side = reveal(el('aside', 'side'), 3), figure = el('div', 'fig'), buddy = el('img');
    const result = stage.results[stage.index], q = question(stage);
    buddy.className = 'pk-sticker'; buddy.src = sticker(stage.summary ? 'done-stamp' : result ? result.correct ? 'correct' : 'wrong-eraser' : 'stage-thinking'); buddy.alt = '碧琪'; figure.append(buddy); side.append(figure);
    const say = el('div', 'say'); side.append(say);
    if (stage.summary) {
      const correct = stage.results.filter(r => r.correct).length, independent = stage.results.filter(r => r.independent).length, sec = stageSeconds(stage);
      const summary = el('div', 'summary on'), done = el('span', 'pk-stamp pk-anim pk-done-stamp', '这一组 · 完成'); done.dataset.size = 'lg';
      summary.append(done, el('h3', '', `这一组，答对 ${correct} 题。`), el('p', '', `${[independent && `其中 ${independent} 题是独立且确定的`, stage.results.length - independent && `${independent ? '其余' : '这一组'} ${stage.results.length - independent} 题明天再考一次`].filter(Boolean).join('；')}。用时 ${Math.floor(sec / 60)} 分 ${sec % 60} 秒。`));
      const dots = el('div', 'sum-dots'); stage.results.forEach((r, i) => { const n = el('i', r.correct ? 'l' : ''); n.style.animationDelay = 300 + i * 120 + 'ms'; dots.append(n); });
      const actions = el('div', 'sum-act'); actions.append(button('再来一组变式', () => void startSet({chapter: q.k}), 'confirm'), button('回到今日', () => go('today'), 'link')); summary.append(dots, actions); column.append(summary);
      speak(say, ['先生，这一组做完啦。', '休息一下，再一起补薄弱的地方。']);
    } else {
      const {stem, code, part, judge} = stemParts(q);
      column.append(reveal(el('div', 'q-meta', `第 ${stage.index + 1} 题 · ${judge ? '判断' : {single: '单选', multi: '多选', blank: '填空'}[q.kind] || '作答'} · ${CHAPTERS.get(q.k) || q.k || ''}`), 1));
      // 多行题干（英语对话）用 <br> 换行，逐字落座拆字时也保得住。
      const text = reveal(el('div', 'q-text'), 2); stem.split('\n').forEach((line, i) => text.append(...(i ? [document.createElement('br'), line] : [line]))); column.append(text);
      if (code) column.append(reveal(el('pre', 'q-code', code), 3));
      if (q.kind === 'blank' && part) column.append(reveal(el('div', 'q-part', /^[①-⑳]$/.test(part) ? `填第 ${part} 空` : part), 4));
      if (q.kind === 'blank') {
        const input = el('input', 'blank-answer'); input.setAttribute('aria-label', '你的答案'); input.value = stage.blank || ''; input.disabled = Boolean(result); input.addEventListener('input', () => { stage.blank = input.value; }); input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.repeat && !event.isComposing) { event.preventDefault(); void submitAnswer(); } }); column.append(input);
      } else {
        const options = reveal(el('ol', 'opts'), 4);
        (q.o || []).forEach((o, i) => {
          const id = q.optionIds?.[i] || optionId(o, i), picked = stage.selected.includes(id);
          const b = button('', event => pickOption(i, event), 'opt' + (picked ? ' sel' : ''));
          b.dataset.option = id; b.setAttribute('aria-pressed', String(picked)); b.disabled = stage.pending;
          const mark = el('span', 'mk'); mark.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
          b.append(el('span', 'bl'), el('span', 'k', String(i + 1)), el('span', 't', typeof o === 'object' ? o.label || o.text : o), mark);
          const li = el('li'); li.append(b); options.append(li);
        }); column.append(options);
      }
      const foot = reveal(el('div', 'q-foot'), 5), confidence = el('div', 'conf'); confidence.setAttribute('role', 'group'); confidence.setAttribute('aria-label', '把握');
      for (const [value, label] of [[40, '没把握'], [70, '有点把握'], [95, '很确定']]) {
        const b = button(label, () => { if (stage.pending || stage.results[stage.index]) return; stage.confidence = value; confidence.querySelectorAll('button').forEach(n => n.setAttribute('aria-pressed', String(n === b))); }); b.setAttribute('aria-pressed', String(stage.confidence === value)); b.disabled = Boolean(result) || stage.pending; confidence.append(b);
      }
      const error = el('span', 'err'); error.setAttribute('role', 'status');
      const confirm = button(stage.pending ? '正在核对…' : '提交', () => stage.results[stage.index] ? nextQuestion() : void submitAnswer(), 'confirm confirm-answer'); confirm.disabled = Boolean(stage.pending); confirm.append(window.__pinkieDeskKit?.star('full') || '', el('kbd', '', 'Enter'));
      // 按住 Enter 的连发不再触发按钮，避免判分后紧接着跳到下一题。
      confirm.addEventListener('keydown', event => { if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault(); });
      foot.append(el('span', 'conf-label', '把握'), confidence, error, confirm); column.append(foot);
      if (stage.hintUsed && !result) speak(say, [HINT], '已记录使用提示，这次答对后先不算独立掌握。');
      else if (!result) speak(say, [`先生，这组有 ${stage.set.questions.length} 道题。`, '先把已知条件写在草稿上～']);
      const more = el('div', 'more'); const tool = (label, name, action) => { const b = button(label, action); b.prepend(icon(name, {size: 'xs'})); return b; }; more.append(tool('换个说法讲', 'rotate-ccw', () => void followUp('换个说法讲')), tool('画执行过程', 'route', () => void followUp('画执行过程')), tool('提示 H', 'lightbulb', showHint)); side.append(more);
      host.append(column, side); paintAnswer(host, stage); showDemo(host); motion.splitIn(text); return;
    }
    host.append(column, side); showDemo(host);
  }
  function stageKey(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const stage = current().stage; if (!stage || current().stageMode && current().stageMode !== 'practice') { otherStageKey(event); return; }
    if (/^[1-4]$/.test(event.key)) { event.preventDefault(); pickOption(Number(event.key) - 1); }
    else if (event.key === 'Enter') {
      // A focused button handles Enter through its native click exactly once.
      if (event.target.closest?.('button, a')) return;
      event.preventDefault(); if (stage.results[stage.index]) nextQuestion(); else void submitAnswer();
    } else if (event.key.toLowerCase() === 'n') { event.preventDefault(); nextQuestion(); }
    else if (event.key.toLowerCase() === 'h') { event.preventDefault(); showHint(); }
  }
  async function followUp(action) {
    const stage = current().stage, q = stage && question(stage); if (!q) return;
    const result = stage.results[stage.index];
    const options = (q.o || []).map((o, i) => `${q.optionIds?.[i] || optionId(o, i)}. ${typeof o === 'object' ? o.label || o.text : o}`).join('\n');
    const context = `正在学习：${stage.set.title}\n题目：${q.q}\n${options}\n${result ? `我选了：${stage.selected.join('、') || stage.blank || ''}\n核对结果：${result.correct ? '答对' : '待复测'}\n解析：${result.explanation || ''}` : '我还没提交答案，请先引导，不要直接给答案。'}`;
    try { await askBiqi(`${action}。请结合这道题讲给我听。\n\n${context}\n\n我可以点左侧「学习台」回到原题。`); }
    catch (error) { notice(error.message); }
  }
  async function switchStageMode(mode) {
    if (!allowHeavy(pane, mode)) return;
    if (current().stageMode !== mode) focusClock(false);
    current().stageMode = mode;
    if (mode === 'practice' && !current().stage) { await startSet(); return; }
    go('stage');
  }
  async function rateCard(rating) {
    const local = current(), flash = local.flash; if (!flash || !flash.flipped || flash.pending) return;
    const note = flash.notes[flash.index]; if (!note) return;
    flash.pending = true;
    try {
      await request(note.recallId ? 'pinkie.learning.notes.recall.review' : 'pinkie.learning.notes.review', {sessionKey: 'agent:learning:notes-library', id: note.id, recallId: note.recallId, rating});
      flash.index++; flash.flipped = false; flash.pending = false;
      if (current() === local && state.active === 'stage') renderView('stage');
    } catch (error) { flash.pending = false; notice(error.message); }
  }
  function flipCard() {
    const flash = current().flash; if (!flash || flash.pending) return;
    flash.flipped = !flash.flipped; renderView('stage');
  }
  async function loadInline(kind, visual) {
    const local = current(), mode = local.stageMode, key = state.key;
    const slot = state.root.querySelector('.desk-inline-slot'); if (!slot) return;
    slot.textContent = '正在准备…';
    try {
      const data = await request('pinkie.learning.practice.open', {kind, visual});
      local.inline ||= {}; local.inline[mode] = data.inline;
      if (!slot.isConnected || state.key !== key || current().stageMode !== mode) return;
      slot.replaceChildren();
      if (!window.__pinkieLearningInline?.mount) throw Error('互动卡片组件正在连接，请稍后重试');
      window.__pinkieLearningInline.mount(data.inline, slot);
    } catch (error) { if (slot.isConnected) { slot.textContent = error.message; slot.append(button('重试', () => void loadInline(kind, visual), 'link')); } }
  }
  function mountOtherStage(host) {
    const local = current(), mode = local.stageMode; stageHeader(host);
    const body = el('div', 'other-stage'); host.append(body);
    if (mode === 'flashcard') {
      const render = () => {
        if (!host.isConnected) return;
        const flash = local.flash, note = flash?.notes[flash.index]; body.replaceChildren();
        if (!note) { body.append(emptyState(flash?.notes.length ? '这一轮复习完成。' : '今天没有到期闪卡。', flash?.notes.length ? '这些卡片会按记忆曲线再回来。' : '到期的卡片会自动出现在这里。', [button('回到今日', () => go('today'), 'link')])); return; }
        body.append(el('div', 'q-meta', `闪卡 ${flash.index + 1} / ${flash.notes.length}`));
        const card = button('', flipCard, 'flashcard' + (flash.flipped ? ' flipped' : ''));
        card.setAttribute('aria-label', flash.flipped ? '查看闪卡正面' : '翻开闪卡');
        if (flash.flipped) { card.append(el('p', '', note.recallAnswer || note.meaning || note.content || ''), el('small', '', note.example || note.note || '')); }
        else { card.append(el('h2', '', note.recallQuestion || (note.cue && /[?？]|什么|怎么|如何|哪/.test(note.cue) ? note.cue : '请回忆这条笔记的关键知识点。')), el('p', '', '先在心里回忆，再按空格翻面。')); }
        body.append(card);
        if (flash.flipped) {
          body.append(el('p', 'hint', '对照原笔记自评'));
          const grades = el('div', 'flash-grades'); for (const [i, [rating, label]] of [['forgot', '忘了'], ['fuzzy', '模糊'], ['remembered', '记得']].entries()) { const b = button(`${i + 1} · ${label}`, () => void rateCard(rating), 'confirm'); b.disabled = flash.pending; grades.append(b); } body.append(grades);
        }
      };
      if (local.flash) { render(); return; }
      body.textContent = '正在读取闪卡…';
      request('pinkie.learning.notes.recall.queue', {sessionKey: 'agent:learning:notes-library', limit: 10}).then(data => { local.flash = {notes: data.notes || [], index: 0, flipped: false}; render(); }).catch(error => { if (body.isConnected) { body.textContent = error.message; body.append(button('重试', () => renderView('stage'), 'link')); } }); return;
    }
    const tabs = el('div', 'inline-tabs');
    if (mode === 'experiment') {
      for (const [label, kind, visual] of [['RC 暂态', 'concept_lab', {concept: 'rc_transient'}], ['指针内存', 'memory_lab', {}], ['C 语言', 'c_program', {}], ['电路', 'circuit_lab', {}], ['网络', 'network_lab', {}], ['数学', 'math_check', {}]]) tabs.append(button(label, () => void loadInline(kind, visual), 'link'));
    } else {
      for (const [paper, label] of [['pro', '专业综合'], ['c', 'C 语言'], ['ee', '电工电子'], ['net', '网络'], ['math', '高数'], ['en', '英语']]) tabs.append(button(label, () => void loadInline('mock_exam', {bank: {paper}}), 'link'));
    }
    const slot = el('div', 'desk-inline-slot'); body.append(tabs, slot);
    if (local.inline?.[mode] && window.__pinkieLearningInline?.mount) window.__pinkieLearningInline.mount(local.inline[mode], slot);
    else void loadInline(mode === 'mock' ? 'mock_exam' : 'concept_lab', mode === 'mock' ? {bank: {paper: 'pro'}} : {concept: 'rc_transient'});
  }
  function otherStageKey(event) {
    if (current().stageMode !== 'flashcard') return;
    if (event.key === ' ' && !event.target.closest?.('button')) { event.preventDefault(); flipCard(); }
    else if (/^[1-3]$/.test(event.key)) { event.preventDefault(); void rateCard(['forgot', 'fuzzy', 'remembered'][Number(event.key) - 1]); }
  }
    return {mountToday, mountStage, stageKey, startSet, switchStageMode, pauseStage,
      resume() { if (pane.view !== 'stage' || !focused(pane)) return; const stage = current().stage; if (stage && !stage.summary && !stage.activeAt) stage.activeAt = performance.now(); clearInterval(pane.timer); if (pane.updateClock) { pane.updateClock(); pane.timer = setInterval(pane.updateClock, 1000); } },
      askBiqi};
  }
  function closeLibrary() {
    // 书架没有公开的关闭入口；和它自己的 closeShelf 一样隐藏抽屉。
    const drawer = document.querySelector('.pinkie-library'); if (drawer && !drawer.hidden) { drawer.hidden = true; drawer.inert = true; }
  }
  function adoptDrawer(selector) {
    const drawer = document.querySelector(selector); if (!drawer || !state.root) return;
    state.drawers ||= new Map(); if (!state.drawers.has(drawer)) state.drawers.set(drawer, drawer.parentNode);
    state.root.append(drawer);
  }
  function observeStickers(root) {
    const sizes = [36,64,96,128,192,240,320,384,480], observed = new Set();
    const fit = img => {
      const url = String(img.src || ''), match = url.match(/\/study-desk\/stickers\/(?:responsive\/)?([^/?]+?)(?:@\d+)?\.webp(?:\?|$)/); if (!match || !img.isConnected) return;
      const width = img.clientWidth; if (!width) return;
      const limit = width * Math.min(devicePixelRatio || 1, 2), size = [...sizes].reverse().find(n => n <= limit + 1) || 36;
      const next = BASE + 'study-desk/stickers/responsive/' + match[1] + '@' + size + '.webp'; if (img.src !== next) img.src = next;
    };
    const resize = new ResizeObserver(entries => { for (const entry of entries) fit(entry.target); });
    const scan = () => {
      for (const img of observed) if (!img.isConnected) { resize.unobserve(img); observed.delete(img); }
      for (const img of root.querySelectorAll('img')) if (String(img.src).includes('/study-desk/stickers/')) { if (!observed.has(img)) { observed.add(img); resize.observe(img); } fit(img); }
    };
    const mutations = new MutationObserver(scan); mutations.observe(root, {childList:true,subtree:true,attributes:true,attributeFilter:['src']}); scan();
    state.disposeStickers = () => { resize.disconnect(); mutations.disconnect(); observed.clear(); };
  }
  function syncTheme() {
    if (!state.root) return;
    const night = doc.hasAttribute('data-pinkie-night') || doc.dataset.themeMode === 'dark';
    state.root.dataset.theme = night ? 'night' : 'day';
    const kind = night ? 'night' : 'day';
    if (state.loadAsset && !state.assets?.[kind]) state.loadAsset(kind, 'backplate-' + kind + '.webp');
    const plate = state.assets?.[kind];
    if (state.assets) delete state.assets[night ? 'day' : 'night'];
    state.root.dataset.backplate = String(Boolean(plate));
    if (plate) state.root.style.setProperty('--desk-backplate', `url("${plate}")`);
    else state.root.style.removeProperty('--desk-backplate');
    const b = state.root.querySelector('[data-theme-toggle]');
    if (b) { b.replaceChildren(handIcon(night ? 'sun' : 'moon'), el('span', 'nav-tip', night ? '切到日间' : '切到夜间')); b.setAttribute('aria-pressed', String(night)); }
  }
  function toggleTheme() {
    const night = state.root?.dataset.theme !== 'night';
    doc.dataset.themeMode = night ? 'dark' : 'light';
    doc.toggleAttribute('data-pinkie-night', night);
    window.__pinkieNight?.apply();
    syncTheme();
  }
  function setNativeChat(show) {
    for (const n of document.querySelectorAll('.shell, openclaw-app-shell')) {
      if (n.contains(state.root)) continue;
      if (!state.native.has(n)) state.native.set(n, n.inert);
      // Visibility scopes the covered App out of focus navigation. Setting inert
      // on its entire Lit shell can conflict with the native focus controller.
      n.inert = state.native.get(n);
    }
    doc.dataset.pinkieStudyDesk = show ? 'chat' : 'desk';
    if (state.root) state.root.dataset.view = show ? 'chat' : current().view;
    syncEntry(show);
  }
  // 对话视图不放整条细导航（会压住 App 原生侧栏），只放一个回学习台的入口：
  // 侧栏展开时放在原生侧栏「概览」一组，侧栏收起时放到顶栏面包屑后面。
  // 两处都找不到时（例如隔离页面）才保留细导航，保证总能回来。
  function entryHost() {
    if (!document.querySelector('aside.sidebar.sidebar--collapsed')) {
      const items = document.querySelector('aside.sidebar .sidebar-nav .nav-section__items');
      if (items) return items;
    }
    return document.querySelector('.dashboard-header__breadcrumb');
  }
  function syncEntry(show) {
    let entry = document.querySelector('.pinkie-desk-entry');
    if (!show) { entry?.remove(); state.entryObserver?.disconnect(); state.entryObserver = null; doc.removeAttribute('data-pinkie-desk-entry'); return; }
    const host = entryHost();
    if (entry && entry.parentElement !== host) { entry.remove(); entry = null; }
    if (host && !entry) {
      const inSidebar = host.classList.contains('nav-section__items');
      entry = el('a', inSidebar ? 'nav-item pinkie-desk-entry' : 'pinkie-desk-entry pinkie-desk-entry--crumb'); entry.href = '#'; entry.setAttribute('role', 'button'); entry.setAttribute('aria-label', '回到学习台');
      const mark = icon('star', {size: 'sm'}); mark.className = inSidebar ? 'nav-item__icon' : 'pinkie-desk-entry__icon'; mark.setAttribute('aria-hidden', 'true');
      entry.append(mark, el('span', inSidebar ? 'nav-item__text' : '', '学习台'));
      entry.addEventListener('click', event => { event.preventDefault(); go(current().deskView || 'today'); });
      if (inSidebar) host.prepend(entry); else host.append(entry);
    }
    doc.toggleAttribute('data-pinkie-desk-entry', Boolean(host));
    if (!state.entryObserver) {
      // 原生页面由 Lit 重绘，侧栏也会收起或展开；入口被冲掉或位置不对时补回。
      state.entryObserver = new MutationObserver(() => {
        if (doc.dataset.pinkieStudyDesk !== 'chat') return;
        const found = document.querySelector('.pinkie-desk-entry');
        if (!found || found.parentElement !== entryHost()) syncEntry(true);
      });
      state.entryObserver.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
    }
  }
  function pageMotion(pane) {
    return {
      get reduced() { return motion.reduced || !focused(pane); },
      get gsap() { return focused(pane) ? vendors.gsap || null : null; },
      splitIn: (...args) => focused(pane) ? motion.splitIn(...args) : null,
      drawIn: (...args) => focused(pane) ? motion.drawIn(...args) : null,
      confettiAt: (...args) => focused(pane) ? motion.confettiAt(...args) : null,
    };
  }
  function deskForPane(pane) {
    return {...window.__pinkieStudyDesk, local: () => pane.state, pane: () => pane, motion: pane.motion, sessionKey:conversationKey,
      go: (id, options) => goPane(pane, id, options), refresh: () => renderPane(pane, pane.view),
      startSet: (...args) => pane.builtin.startSet(...args), switchStageMode: mode => pane.builtin.switchStageMode(mode),
      askBiqi: text => pane.builtin.askBiqi(text), askRef: (ref, title) => pane.builtin.askBiqi('请帮我讲清楚「' + title + '」，先引导我回忆。\n\n[[DESK_REF_V1 ' + ref + ']]'), revealRef: async ref => { const r = await request('pinkie.learning.ref.resolve', {refs:[ref]}); window.__pinkieDeskChat?.reveal?.(r.cards?.[0]?.origin); }, isFocused: () => focused(pane)};
  }
  function stageMode(pane) {
    const spec = stageModes.get(pane.state.stageMode);
    if (!spec) return null;
    if (pane.modeName !== pane.state.stageMode) {
      pane.modeRuntime?.unmount?.(); pane.modeName = pane.state.stageMode;
      pane.modeRuntime = spec.create ? spec.create(context(pane)) : spec;
    }
    return pane.modeRuntime;
  }
  function isHeavy(pane, mode = pane.state.stageMode) { return pane.view === 'library' || pane.view === 'stage' && ['mock', 'experiment'].includes(mode) || pane.heavy; }
  function allowHeavy(pane, mode) {
    if (!['mock', 'experiment', 'library', 'pdf'].includes(mode)) return true;
    if (workspace().panes.some(p => p !== pane && isHeavy(p))) { notice('先合上另一页的书架、模拟考或实验，再打开这一页。'); return false; }
    return true;
  }
  function unmountPane(pane) {
    pane.builtin?.pauseStage(); if (pane.runtime?.unmount) pane.runtime.unmount(); else pane.viewSpec?.unmount?.(context(pane)); pane.runtime = null; pane.viewSpec = null;
    pane.modeRuntime?.unmount?.(); pane.modeRuntime = null; pane.modeName = '';
    for (const animation of pane.animations || []) { animation.kill?.(); animation.cancel?.(); }
    pane.animations?.clear();
    for (const tween of vendors.gsap?.globalTimeline.getChildren(true, true, true) || []) {
      if (tween.targets?.().some(n => n?.nodeType && pane.host?.contains(n))) tween.kill();
    }
    pane.updateClock = null;
  }
  function focusPage(pane, {chat = false, resume = false} = {}) {
    if (!state.root) return;
    // 聊天卡片和原来的便签栏一样：点它只是把它提到最上面、焦点进聊天；当前页仍是上一张学习页（课程条、计时都跟着那页）。
    if (pane?.view === 'deskchat') {
      const w = workspace(), page = focusedPane()?.view !== 'deskchat' ? focusedPane() : [...w.panes].filter(p => p.view !== 'deskchat').sort((a, b) => b.z - a.z)[0];
      if (pane.z !== w.zTop) { pane.z = ++w.zTop; if (pane.host) pane.host.style.zIndex = String(pane.z); }
      if (page) { pane = page; chat = true; }
    }
    const w = workspace(), previous = focusedPane();
    const changed = previous !== pane || w.chatFocus !== chat || (!w.chat && !chat && !pane.host?.hasAttribute('data-focused'));
    if (previous !== pane || w.chatFocus !== chat) {
      previous?.builtin?.pauseStage(); previous?.runtime?.pause?.(); previous?.modeRuntime?.pause?.({chat,samePane:previous===pane});
    }
    w.focus = Math.max(0, w.panes.indexOf(pane)); w.chatFocus = chat;
    if (!chat && pane.z !== w.zTop) { pane.z = ++w.zTop; if (pane.host) pane.host.style.zIndex = String(pane.z); }
    state.active = w.chat ? 'chat' : pane.view;
    for (const p of w.panes) {
      const on = !chat && !w.chat && p === pane; p.host?.toggleAttribute('data-focused', on);
      if (p.host) p.host.dataset.reduced = String(motion.reduced || !on);
      if (!on) { p.builtin?.pauseStage(); p.runtime?.pause?.(); p.modeRuntime?.pause?.({chat,samePane:p===pane}); }
    }
    if (!chat && !w.chat && (changed || resume)) { pane.builtin?.resume(); pane.runtime?.resume?.(); pane.modeRuntime?.resume?.(); }
    for (const b of state.root.querySelectorAll('[data-go]')) { const on = b.dataset.go === (w.chat ? 'chat' : pane.view); b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); }
    state.root.dataset.view = w.chat ? 'chat' : pane.view;
    if (motion.reduced) for (const animation of state.root.getAnimations?.({subtree:true}) || []) animation.cancel();
    saveWorkspace(); syncFocusClock();
    if (changed) window.dispatchEvent(new CustomEvent('pinkie:study-desk-focus', {detail: {paneId: pane.id, chat, sessionKey: state.key}}));
  }
  function renderPane(pane, id = pane.view) {
    if (!state.root || !pane.host) return;
    unmountPane(pane); pane.view = id; pane.state.view = id; pane.state.deskView = id;
    pane.host.dataset.view = id; pane.body.replaceChildren();
    pane.title.textContent = views.get(id)?.title || {library: '书架', stage: '舞台'}[id] || id;
    const spec = views.get(id); if (!spec) return; pane.viewSpec = spec;
    const host = el('section', 'view glass in'); host.dataset.view = id; host.setAttribute('aria-label', spec.title || id); pane.body.append(host);
    pane.host.dataset.reduced = String(motion.reduced || !focused(pane));
    try {
      const result = spec.mount(host, context(pane));
      if (result?.then) result.then(runtime => { if (host.isConnected) pane.runtime = runtime || null; else runtime?.unmount?.(); }).catch(error => { if (host.isConnected) notice(error.message); });
      else pane.runtime = result || null;
    } catch (error) { notice(error.message); }
    saveWorkspace();
  }
  function createPane(pane) {
    pane.animations = new Set(); pane.motion = pageMotion(pane); pane.builtin = createBuiltin(pane, state);
    const host = pane.host = el('article', 'desk-page'); host.dataset.pane = pane.id; host.setAttribute('aria-label', '学习手账页');
    const tools = el('header', 'desk-page-tools'); pane.title = el('span', 'desk-page-title');
    const close = button('', () => closePage(pane), 'desk-page-action'); close.setAttribute('aria-label', '合上这一页'); close.append(icon('x', {size: 'xs'}));
    tools.append(pane.title, close); pane.body = el('div', 'desk-page-body');
    // 顶上那条胶带是把手：按住拖动换位置，双击铺满 / 还原。右边、下边和右下角拖动改大小。
    const grip = el('div', 'desk-page-grip'); grip.title = '按住拖动；双击铺满'; grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('pointerdown', event => dragCard(pane, event, 'move'));
    const handles = ['e', 's', 'se'].map(edge => { const h = el('div', 'desk-page-resize'); h.dataset.edge = edge; h.setAttribute('aria-hidden', 'true'); h.addEventListener('pointerdown', event => dragCard(pane, event, edge)); return h; });
    host.append(grip, tools, pane.body, ...handles);
    for (const name of ['pointerdown', 'focusin']) host.addEventListener(name, () => focusPage(pane), {capture: true});
    host.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-pinkie-view')) { event.preventDefault(); host.dataset.drop = ''; } });
    host.addEventListener('dragleave', () => delete host.dataset.drop);
    host.addEventListener('drop', event => { const view = event.dataTransfer.getData('application/x-pinkie-view'); delete host.dataset.drop; if (!view) return; event.preventDefault(); event.stopPropagation(); dropCard(view, event, pane); });
    return pane;
  }
  function applyRect(pane) {
    const r = pane.rect || {x: 0, y: 0, w: 1, h: 1}, s = pane.host?.style; if (!s) return;
    s.left = r.x * 100 + '%'; s.top = r.y * 100 + '%'; s.width = r.w * 100 + '%'; s.height = r.h * 100 + '%'; s.zIndex = String(pane.z || 1); s.transform = '';
  }
  // 拖动时只改 transform（移动）或宽高（改大小），松手才写回比例；不起常驻的动画循环。
  function dragCard(pane, event, mode) {
    if (event.button !== 0) return;
    const container = state.root?.querySelector('.desk-content'), host = pane.host; if (!container || !host) return;
    event.preventDefault(); focusPage(pane);
    const box = container.getBoundingClientRect(), W = box.width, H = box.height, start = {...pane.rect}, x0 = event.clientX, y0 = event.clientY;
    const minW = Math.min(1, MIN_W / W), minH = Math.min(1, MIN_H / H), w = workspace();
    const edges = axis => [0, 1, ...w.panes.filter(p => p !== pane && p.rect).flatMap(p => axis === 'x' ? [p.rect.x, p.rect.x + p.rect.w] : [p.rect.y, p.rect.y + p.rect.h])];
    const snap = (value, axis, size) => { const limit = SNAP / (axis === 'x' ? W : H); let best = value, gap = limit; for (const e of edges(axis)) for (const v of [e, e - size]) if (Math.abs(v - value) < gap) { gap = Math.abs(v - value); best = v; } return best; };
    let next = {...start}, frame = 0;
    const paint = () => { frame = 0; if (mode === 'move') host.style.transform = `translate(${(next.x - start.x) * W}px,${(next.y - start.y) * H}px)`; else { host.style.width = next.w * 100 + '%'; host.style.height = next.h * 100 + '%'; } };
    const move = e => {
      const dx = (e.clientX - x0) / W, dy = (e.clientY - y0) / H;
      if (mode === 'move') { next.x = snap(Math.min(1 - start.w, Math.max(0, start.x + dx)), 'x', start.w); next.y = snap(Math.min(1 - start.h, Math.max(0, start.y + dy)), 'y', start.h); }
      else {
        if (mode.includes('e')) { const right = snap(Math.min(1, Math.max(start.x + minW, start.x + start.w + dx)), 'x', 0); next.w = right - start.x; }
        if (mode.includes('s')) { const bottom = snap(Math.min(1, Math.max(start.y + minH, start.y + start.h + dy)), 'y', 0); next.h = bottom - start.y; }
      }
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const end = () => {
      cancelAnimationFrame(frame); host.releasePointerCapture?.(event.pointerId); host.removeAttribute('data-dragging');
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', end); host.removeEventListener('pointercancel', end);
      const moved = Math.abs(next.x - start.x) + Math.abs(next.y - start.y) + Math.abs(next.w - start.w) + Math.abs(next.h - start.h) > 0.001;
      if (moved) { pane.rect = next; pane.maximized = null; w.tiled = false; state.root.dataset.tiled = 'false'; }
      applyRect(pane); saveWorkspace(); pane.tuckBubble?.();
      // 指针被卡片接管后 dblclick 不落在胶带上，这里自己数两下。
      if (mode === 'move' && !moved) { const now = performance.now(); if (now - (pane.lastTap || 0) < 380) { pane.lastTap = 0; toggleMaximize(pane); } else pane.lastTap = now; }
    };
    // 拖的时候不选中文字。
    const noSelect = e => e.preventDefault(); document.addEventListener('selectstart', noSelect); getSelection()?.removeAllRanges();
    host.addEventListener('pointerup', () => document.removeEventListener('selectstart', noSelect), {once: true}); host.addEventListener('pointercancel', () => document.removeEventListener('selectstart', noSelect), {once: true});
    host.setAttribute('data-dragging', mode); host.setPointerCapture?.(event.pointerId);
    host.addEventListener('pointermove', move); host.addEventListener('pointerup', end); host.addEventListener('pointercancel', end);
  }
  function toggleMaximize(pane) {
    const w = workspace();
    if (pane.maximized) { pane.rect = pane.maximized; pane.maximized = null; }
    else { pane.maximized = pane.rect; pane.rect = {x: 0, y: 0, w: 1, h: 1}; }
    w.tiled = false; state.root.dataset.tiled = 'false'; focusPage(pane); applyRect(pane); saveWorkspace();
  }
  // 新卡片：桌面是平铺的就重新平铺；已经被拖乱了，就叠在当前卡片右下方一点。
  function placeCard(pane) {
    const w = workspace();
    if (w.tiled) { tileRects(w); return; }
    const from = focusedPane()?.rect || {x: 0, y: 0}, cw = pane.view === 'deskchat' ? 0.3 : 0.46, ch = 0.88;
    pane.rect = {x: Math.min(1 - cw, from.x + 0.05), y: Math.min(1 - ch, from.y + 0.05), w: cw, h: ch};
  }
  function addCard(view) {
    const w = workspace();
    if (view !== 'deskchat' && full(w)) { notice(`桌上最多摊开 ${MAX_CARDS} 张，先合上一张。`); return null; }
    const pane = {id: 'page-' + crypto.randomUUID(), view: view === 'library' ? 'today' : view, state: {view, deskView: view}, z: ++w.zTop, host: null};
    w.panes.push(pane); placeCard(pane); return pane;
  }
  // 把索引贴拖到桌上：松手的地方摊开一张新卡片；桌上摊满了，就换掉松手处那一张。
  function dropCard(view, event, under) {
    const w = workspace(), box = state.root.querySelector('.desk-content').getBoundingClientRect();
    if (view === 'deskchat') { toggleChat(true); return; }
    if (full(w)) { if (under) goPane(under, view); else notice(`桌上最多摊开 ${MAX_CARDS} 张，先合上一张。`); return; }
    const pane = addCard(view); if (!pane) return;
    const px = (event.clientX - box.left) / box.width, py = (event.clientY - box.top) / box.height, cw = Math.max(0.36, Math.min(1, MIN_W / box.width)), ch = 0.82;
    pane.rect = {x: Math.min(1 - cw, Math.max(0, px - cw / 2)), y: Math.min(1 - ch, Math.max(0, py - 0.06)), w: cw, h: ch}; w.tiled = false;
    w.chat = false; w.focus = w.panes.indexOf(pane); w.chatFocus = false; renderWorkspace(); goPane(pane, view);
  }
  function tileCards() { const w = workspace(); tileRects(w); renderWorkspace(); saveWorkspace(); }
  const chatCard = () => workspace().panes.find(p => p.view === 'deskchat');
  function toggleChat(force) {
    if (!state.root) return;
    const w = workspace(), card = chatCard(), on = typeof force === 'boolean' ? force : !card;
    if (w.chat) { w.chat = false; renderWorkspace(); }
    if (!on) { if (card) closePage(card); return; }
    if (card) { focusPage(card, {}); return; }
    const pane = addCard('deskchat'); if (!pane) return;
    w.focus = w.panes.indexOf(pane); renderWorkspace(); goPane(pane, 'deskchat');
  }
  // 「对话」索引贴：聊天卡已在最上面就合上；没开或被压着就摊开 / 提上来。
  function tabChat() {
    const w = workspace(), card = chatCard();
    toggleChat(!(card && card.z === Math.max(...w.panes.map(p => p.z))));
  }
  function renderWorkspace() {
    if (!state.root) return;
    const w = workspace(), container = state.root.querySelector('.desk-content');
    for (const pane of w.panes) {
      if (!pane.host) createPane(pane);
      if (pane.host.parentElement !== container) container.append(pane.host);
      applyRect(pane);
      if (!w.chat && !pane.body.childElementCount) renderPane(pane);
    }
    state.root.dataset.pages = String(w.panes.length); state.root.dataset.tiled = String(w.tiled); setNativeChat(w.chat); focusPage(focusedPane(), {chat: w.chatFocus});
    window.dispatchEvent(new CustomEvent('pinkie:desk-split-changed', {detail: {open: Boolean(chatCard())}}));
  }
  // 点索引贴：这一页已经摊开就提到最前面；没开就另摊一张（满了换掉最久没碰的那张）。⌥ 点击才在当前卡里换页。
  function openCard(view) {
    const w = workspace(), open = w.panes.find(p => p.view === view);
    if (!open) { if (allowHeavy(null, view)) openOtherPage(view); return; }
    if (w.chat) { w.focus = w.panes.indexOf(open); goPane(open, view); return; }
    focusPage(open); saveWorkspace();
  }
  // 在另一张卡片上打开：桌上还有空位就新摊一张；摊满了就换掉最久没碰的那张（不动聊天卡和当前卡）。
  function openOtherPage(id, options) {
    const w = workspace();
    if (id === 'deskchat') { toggleChat(true); return; }
    let pane = !full(w) ? addCard(id) : [...w.panes].filter(p => p !== focusedPane() && p.view !== 'deskchat').sort((a, b) => a.z - b.z)[0];
    if (!pane) { notice(`桌上最多摊开 ${MAX_CARDS} 张，先合上一张。`); return; }
    w.chat = false; w.focus = w.panes.indexOf(pane); w.chatFocus = false; renderWorkspace(); goPane(pane, id, options);
  }
  function closePage(pane) {
    const w = workspace(); if (w.panes.length === 1) { goPane(pane, 'today'); return; }
    const i = w.panes.indexOf(pane); unmountPane(pane); pane.host.remove(); w.panes.splice(i, 1);
    const top = [...w.panes].sort((a, b) => b.z - a.z)[0]; w.focus = w.panes.indexOf(top);
    // 只剩一张时铺满；平铺的桌面合上一张后重新平铺。
    if (w.panes.length === 1) { w.panes[0].rect = {x: 0, y: 0, w: 1, h: 1}; w.tiled = true; } else if (w.tiled) tileRects(w);
    renderWorkspace(); saveWorkspace();
  }
  // 一键排法（生词本页脚的小图标和测试用）：几页并排，要不要聊天卡；排完是平铺状态，之后照样能拖。
  function setLayout(value) {
    const withChat = value.endsWith('-chat'), count = value.startsWith('triple') ? 3 : value.startsWith('spread') ? 2 : 1, w = workspace();
    const pages = () => w.panes.filter(p => p.view !== 'deskchat');
    while (pages().length > count) { const p = pages().sort((a, b) => a.z - b.z)[0]; unmountPane(p); p.host?.remove(); w.panes.splice(w.panes.indexOf(p), 1); }
    while (pages().length < count) w.panes.splice(pages().length, 0, {id: 'page-' + crypto.randomUUID(), view: pages().length === 1 ? 'vocab' : 'board', state: {view: 'notes', deskView: 'notes'}, z: ++w.zTop, host: null});
    const card = chatCard();
    if (!withChat && card) { unmountPane(card); card.host?.remove(); w.panes.splice(w.panes.indexOf(card), 1); }
    if (withChat && !card) w.panes.push({id: 'page-' + crypto.randomUUID(), view: 'deskchat', state: {view: 'deskchat', deskView: 'deskchat'}, z: ++w.zTop, host: null});
    w.focus = Math.max(0, w.panes.indexOf(pages()[0])); w.chat = false; w.chatFocus = false;
    tileRects(w); renderWorkspace();
    for (const pane of w.panes) if (pane.view === 'notes' && !views.has('notes')) goPane(pane, 'notes');
    saveWorkspace();
  }
  function goPane(pane, id, options) {
    id = id === 'home' ? 'today' : id; if (!state.root) return;
    const w = workspace();
    if (id === 'chat') { w.chat = true; pane.state.view = 'chat'; pane.state.deskView = pane.view; for (const p of w.panes) { unmountPane(p); p.body?.replaceChildren(); } renderWorkspace(); }
    else {
      if (!allowHeavy(pane, id)) return;
      const chat = id === 'deskchat' && chatCard(); if (chat && chat !== pane) { focusPage(chat); return; }
      w.chat = false; w.chatFocus = false; w.focus = w.panes.indexOf(pane);
      if (!pane.host) createPane(pane);
      if (id === 'notes') {
        if (options) pane.state.notesRoute = options;
        if (!views.has(id)) {
          pane.view = id; pane.state.view = id;
          if (!state.notesLoading) {
            state.notesLoading = true;
            const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = BASE + 'laolao-study-desk-notes.css?v=pages1'; css.dataset.notebookV2 = '';
            if (!document.querySelector('link[data-notebook-v2]')) document.head.append(css);
            const script = document.createElement('script'); script.src = BASE + 'laolao-study-desk-notes.js?v=pages1';
            script.onload = () => { state.notesLoading = false; for (const p of workspace().panes) if (p.view === 'notes') renderPane(p); };
            script.onerror = () => { state.notesLoading = false; script.remove(); notice('笔记本未能加载，请重试'); }; document.head.append(script);
          }
          renderWorkspace(); return;
        }
      }
      if (id === 'vocab' && options) pane.state.vocabRoute = options;
      if (id === 'entry' && options) pane.state.entryRef = options.ref;
      if (!views.has(id)) { notice('这一页正在准备，请稍后再试'); return; }
      closeLibrary(); renderPane(pane, id); renderWorkspace();
    }
    window.dispatchEvent(new CustomEvent('pinkie:study-desk-view', {detail: {view: id, paneId: pane.id, sessionKey: state.key}}));
  }
  const go = (id, options) => goPane(focusedPane(), id, options);
  const renderView = id => go(id);
  function registerView(id, view) {
    if (!id || typeof view?.mount !== 'function') throw new TypeError('学习台视图需要 mount()');
    views.set(id, view);
    if (state.root) for (const pane of workspace().panes) if (pane.view === id) renderPane(pane);
    return () => { if (views.get(id) !== view) return; if (state.root) for (const pane of workspace().panes) if (pane.view === id) goPane(pane, 'today'); views.delete(id); };
  }
  function onKey(event) {
    // 学习台页面上不开工作台；回到对话界面后 ⌥⌘B 照常开关工作台。
    if (event.altKey && event.metaKey && event.code === 'KeyB') { if (!workspace().chat) { event.preventDefault(); event.stopImmediatePropagation(); } return; }
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    const modal = [...(state.root?.querySelectorAll('.lesson-dialog[open]') || [])].at(-1);
    if (modal && event.key === 'Escape') { event.preventDefault(); modal.close(); return; }
    if (modal) return;
    if ((event.metaKey || event.ctrlKey) && event.code === 'KeyK') {
      current().focusAsk = true;
      if (current().view !== 'today') go('today');
      const input = state.root?.querySelector('.ask input'); if (input) { current().focusAsk = false; input.focus(); } event.preventDefault(); return;
    }
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"], dialog, .pinkie-library, .laolao-learning-notes')) return;
    if (event.key === 'Escape') { focusedPane().runtime?.keydown?.(event); if (event.defaultPrevented) return; }
    if (event.key === 'Escape' && current().view !== 'chat') { event.preventDefault(); go('today'); return; }
    if (workspace().chat || workspace().chatFocus) return;
    const pane = focusedPane(); (pane.runtime?.keydown || views.get(pane.view)?.keydown)?.(event, context(pane));
  }
  function mount() {
    state.key = sessionKey(); state.generation++; state.controller = new AbortController();
    // Selecting a chat always shows its conversation. Keep its deskView and
    // exercise payload so the explicit desk entry can resume the same work.
    workspace().chat = true;
    const root = state.root = el('div', 'pk-ink'); root.id = 'pinkie-study-desk'; root.setAttribute('aria-label', '碧琪学习台');
    const plate = el('div', 'plate'); plate.setAttribute('aria-hidden', 'true');
    const rail = el('nav', 'rail glass'); rail.setAttribute('aria-label', '学习导航');
    const logo = button('', () => { go('chat'); document.querySelector('.laolao-mode-switcher button, .laolao-mode-button')?.click(); }, 'logo'); logo.setAttribute('aria-label', '切换模式'); logo.append(icon('pinkie:brand', {size: 'sm'}), el('span', 'nav-tip', '切换模式'));
    const nav = el('div', 'rail-nav');
    for (const [id, label] of [['today', '今日'], ['stage', '舞台'], ['board', '看板'], ['library', '书架'], ['notes', '笔记本'], ['vocab', '生词本'], ['chat', '对话']]) {
      const target=id==='chat'?'deskchat':id;
      const b = button('', event => id === 'chat' ? tabChat() : event.altKey ? go(target) : openCard(target)); b.dataset.go = target; b.draggable = true; b.addEventListener('dragstart', event => { event.dataTransfer.setData('application/x-pinkie-view', target); event.dataTransfer.effectAllowed = 'copy'; }); b.setAttribute('aria-label', label); b.append(handIcon(id), el('span', 'nav-tip', label)); nav.append(b);
    }
    const foot = el('div', 'rail-foot'), theme = button('', toggleTheme); theme.dataset.themeToggle = ''; theme.setAttribute('aria-label', '切换日间和夜间');
    const tidy = button('', tileCards); tidy.dataset.tidy = ''; tidy.setAttribute('aria-label', '把卡片排整齐'); tidy.append(icon('layout-grid', {size: 'md'}), el('span', 'nav-tip', '排整齐'));
    const avatar = el('img'); avatar.src = sticker('split-peek'); avatar.alt = '碧琪'; foot.append(tidy, theme, avatar); rail.append(logo, nav, foot);
    const status = el('div', 'desk-status'); status.setAttribute('role', 'status');
    const canvas = el('canvas', 'party'); canvas.setAttribute('aria-hidden', 'true');
    const content = el('div', 'desk-content');
    content.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-pinkie-view')) event.preventDefault(); });
    content.addEventListener('drop', event => { const id = event.dataTransfer.getData('application/x-pinkie-view'); if (id) { event.preventDefault(); dropCard(id, event); } });
    // 先定好对话视图和日夜再挂上去：否则新根节点先按白天纸色算一次样式，切成对话视图时背景的 .4s 过渡会在聊天上淡出一层白（切换会话时闪白）。
    root.dataset.view = 'chat'; root.dataset.theme = doc.hasAttribute('data-pinkie-night') || doc.dataset.themeMode === 'dark' ? 'night' : 'day';
    root.append(plate, rail, content, canvas, status); document.body.append(root); observeStickers(root);
    // The grain is generated once, then composited as a static overlay.
    const grain = el('canvas'); grain.width = grain.height = 140;
    const ctx = grain.getContext('2d'); if (ctx) { const data = ctx.createImageData(140, 140); let seed = 11; for (let i = 0; i < data.data.length; i += 4) { seed = (seed * 9301 + 49297) % 233280; data.data[i] = data.data[i + 1] = data.data[i + 2] = seed / 233280 * 255; data.data[i + 3] = 255; } ctx.putImageData(data, 0, 0); root.style.setProperty('--grain', `url(${grain.toDataURL()})`); }
    state.assets = {};
    state.assetLoads = new Set();
    // Only approved assets installed under ui/assets are eligible. Missing files
    // keep the local wallpaper/grain placeholder and never fetch a remote URL.
    state.loadAsset = (kind, file) => {
      if (state.assets[kind] || [...state.assetLoads].some(n => n.dataset.kind === kind)) return;
      const image = new Image(); image.dataset.kind = kind; state.assetLoads.add(image); image.onerror = () => state.assetLoads.delete(image); image.onload = () => { state.assetLoads.delete(image); if (state.root !== root) return; state.assets[kind] = image.src; if (kind === 'grain') root.style.setProperty('--grain', `url("${image.src}")`); else if (kind === 'paper') root.style.setProperty('--paper-texture', `url("${image.src}")`); syncTheme(); }; image.src = BASE + 'study-desk/' + file;
    };
    state.loadAsset('grain', 'grain.png'); state.loadAsset('paper', 'paper.webp');
    document.addEventListener('keydown', onKey, {capture: true, signal: state.controller.signal});
    document.addEventListener('pointerdown', event => { if (!root.contains(event.target) && event.target.closest?.('#pinkie-desk-chat,.shell,openclaw-app-shell')) focusPage(focusedPane(), {chat: true}); }, {capture: true, signal: state.controller.signal});
    window.addEventListener('resize', renderWorkspace, {signal: state.controller.signal});
    document.addEventListener('visibilitychange', () => {
      for (const p of workspace().panes) { if (document.hidden) { p.builtin?.pauseStage(); p.runtime?.pause?.(); p.modeRuntime?.pause?.(); } }
      if (!document.hidden) focusPage(focusedPane(), {chat: workspace().chatFocus, resume:true});
      syncFocusClock();
    }, {signal: state.controller.signal});
    const reduced = () => { if (motion.reduced) clearMotion(true); root.dataset.reduced = String(motion.reduced); for (const p of workspace().panes) if (p.host) p.host.dataset.reduced = String(motion.reduced || !focused(p)); };
    media?.addEventListener?.('change', reduced, {signal: state.controller.signal}); reduced(); syncTheme(); renderWorkspace();
    window.dispatchEvent(new CustomEvent('pinkie:study-desk-mounted', {detail: {sessionKey: state.key}}));
  }
  function unmount() {
    window.dispatchEvent(new CustomEvent('pinkie:study-desk-unmount', {detail: {sessionKey: state.key}}));
    for (const pane of workspace().panes) { unmountPane(pane); pane.host = null; }
    workspace().chat = true; syncFocusClock();
    state.disposeStickers?.(); state.generation++; state.controller?.abort(); state.controller = null;
    clearInterval(state.timer); state.timer = 0;
    syncEntry(false);
    for (const [n, inert] of state.native) n.inert = inert;
    state.native.clear();
    window.__pinkieLearningNotes?.close?.();
    for (const [drawer, parent] of state.drawers || []) { parent?.append(drawer); if (drawer.classList.contains('pinkie-library')) { drawer.hidden = true; drawer.inert = true; } }
    state.drawers?.clear();
    for (const image of state.assetLoads || []) { image.onload = image.onerror = null; image.removeAttribute('src'); }
    state.assetLoads?.clear();
    state.root?.remove(); state.root = null; state.confetti = null; state.key = '';
    delete doc.dataset.pinkieStudyDesk;
  }
  function reconcile() {
    if (!inLearning()) { if (state.root) unmount(); return; }
    if (state.root && state.key !== sessionKey()) unmount();
    if (!state.root && document.body) mount(); else syncTheme();
  }
  function selectConversation(event) {
    if (event.detail?.sessionKey && event.detail.sessionKey !== sessionKey()) return;
    reconcile();
    if (state.root) go('chat');
  }
  registerView('today', {title: '今日', mount: (host, ctx) => ctx.pane.builtin.mountToday(host)});
  registerView('stage', {title: '舞台', mount: (host, ctx) => ctx.pane.builtin.mountStage(host), keydown: (event, ctx) => ctx.pane.builtin.stageKey(event)});
  registerView('library', {title: '书架', mount(host, ctx) {
    const shelf = window.__pinkieLibrary?.shelf; if (!shelf) { host.append(el('p', 'desk-loading', '书架正在连接')); return; }
    const previous = new Map(); Promise.resolve(shelf()).then(() => { if (!host.isConnected) return; const drawer = document.querySelector('.pinkie-library'); if (drawer) { previous.set(drawer, drawer.parentElement); host.append(drawer); drawer.hidden = false; drawer.inert = false; } }).catch(error => notice(error.message));
    const closed = () => { if (host.isConnected) for (const drawer of previous.keys()) { drawer.hidden = false; drawer.inert = false; } }; window.addEventListener('pinkie:library-closed', closed);
    return {unmount() { window.removeEventListener('pinkie:library-closed', closed); if (window.__pinkieLibrary?.state?.deskHost === host) window.__pinkieLibrary.closeReader(); for (const [drawer, parent] of previous) { drawer.hidden = true; drawer.inert = true; parent?.append(drawer); } }};
  }});
  window.__pinkieStudyDesk = {registerView, request, go, sessionKey, conversationKey, motion, tokens, icon, handIcon, sticker, askBiqi: text => focusedPane().builtin.askBiqi(text), startSet: (...args) => focusedPane().builtin.startSet(...args), base: BASE, local: current, switchStageMode: mode => focusedPane().builtin.switchStageMode(mode),
    pane: focusedPane, forPane: deskForPane, context, openOtherPage, setLayout, tile: tileCards, toggleChat, hasChat: () => Boolean(state.root && chatCard()), cards: () => workspace().panes.map(p => ({id: p.id, view: p.view, rect: {...p.rect}, z: p.z})), focusPane: id => { const p = workspace().panes.find(p => p.id === id); if (p) focusPage(p); },
    contexts: () => workspace().panes.map(context),
    pages: () => workspace().panes.map(p => ({id: p.id, view: p.view, focused: focused(p), state: p.state})),
    claimHeavy(kind, pane = focusedPane()) { if (!allowHeavy(pane, kind)) return false; const token={kind}; pane.heavy = token; return () => { if(pane.heavy===token)pane.heavy=false; }; },
    readerContext() { const pane = focusedPane(); if (!allowHeavy(pane, 'pdf')) return false; if (pane.view !== 'library' || workspace().chat) goPane(pane, 'library'); const token={kind:'pdf'}; pane.heavy = token; return {host:pane.body.querySelector('.view'),release:()=>{if(pane.heavy===token)pane.heavy=false;}}; },
    registerStageMode(id, spec) { stageModes.set(id, spec); }, refresh: () => renderPane(focusedPane(), focusedPane().view)};
  const observer = new MutationObserver(reconcile);
  const observe = () => observer.observe(doc, {attributes: true, attributeFilter: ['data-laolao-mode', 'data-pinkie-night', 'data-theme-mode']});
  observe();
  window.addEventListener('pinkie:session-selected', selectConversation);
  for (const name of ['laolao:modechange', 'popstate', 'pinkie:night']) window.addEventListener(name, reconcile);
  window.addEventListener('resize', () => { if (state.root) for (const p of workspace().panes) p.tuckBubble?.(); });
  window.addEventListener('pagehide', () => { unmount(); observer.disconnect(); });
  window.addEventListener('pageshow', () => { observe(); reconcile(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reconcile, {once: true}); else reconcile();
})();
