const mainPage  = document.getElementById('mainPage');
const nodePage  = document.getElementById('nodePage');
const connectBtn= document.getElementById('connectBtn');
const ring3     = document.getElementById('ring3');
const ring2     = document.getElementById('ring2');
const ring1     = document.getElementById('ring1');
const statusPill= document.getElementById('statusPill');
const statusDot = document.getElementById('statusDot');
const statusText= document.getElementById('statusText');
const heroTitle = document.getElementById('heroTitle');
const heroSub   = document.getElementById('heroSub');
const nodeFlag  = document.getElementById('nodeFlag');
const nodeName  = document.getElementById('nodeName');
const nodeSub   = document.getElementById('nodeSub');
const switchBtn = document.getElementById('switchBtn');
const nodeCard  = document.getElementById('nodeCard');
const shieldPath= document.getElementById('shieldPath');
const checkPath = document.getElementById('checkPath');
const backBtn   = document.getElementById('backBtn');
const refreshBtn= document.getElementById('refreshBtn');
const nodeList  = document.getElementById('nodeList');
const modeChip  = document.getElementById('modeChip');

// [v1.5.2] 通知相关 DOM
const noticeBar   = document.getElementById('noticeBar');
const noticeText  = document.getElementById('noticeText');
const noticeClose = document.getElementById('noticeClose');

let allNodes = [];

// [v1.5.2] 加载并显示通知
function loadNotice() {
  chrome.runtime.sendMessage({ action: 'getNotice' }, (res) => {
    if (!res || !res.notice) return;  // 无通知或拉取失败,不显示

    const notice = res.notice;

    // 必须有 id 和 message 才显示
    if (!notice.id || !notice.message) return;

    // 检查是否过期
    if (notice.expire) {
      const expireTime = new Date(notice.expire).getTime();
      if (!isNaN(expireTime) && Date.now() > expireTime) return;
    }

    // 检查用户是否已关闭这条通知
    chrome.storage.local.get(['dismissedNotices'], (data) => {
      const dismissed = data.dismissedNotices || [];
      if (dismissed.includes(notice.id)) return;

      // 显示通知
      noticeText.textContent = notice.message;
      noticeBar.classList.add('show');

      // 关闭按钮
      noticeClose.onclick = () => {
        noticeBar.classList.remove('show');
        // 记录这条 id 到本地,下次不再显示
        chrome.storage.local.get(['dismissedNotices'], (d) => {
          const list = d.dismissedNotices || [];
          if (!list.includes(notice.id)) list.push(notice.id);
          // 最多保留 50 条历史(防止无限增长)
          while (list.length > 50) list.shift();
          chrome.storage.local.set({ dismissedNotices: list });
        });
      };
    });
  });
}

// 初次加载就拉通知
loadNotice();

function setShieldColor(color) {
  shieldPath.setAttribute('stroke', color);
  checkPath.setAttribute('stroke', color);
}

function setUI(state, node) {
  // [v2] 通过 body class 控制状态,样式由 CSS 的 [data-state] 选择器接管
  document.body.classList.remove('connecting', 'connected');

  if (state === 'idle') {
    connectBtn.className = '';
    ring3.className = 'ring3'; ring2.className = 'ring2'; ring1.className = 'ring1';
    // [v2] 使用 data-state 让 CSS 自动应用主题色
    statusPill.removeAttribute('data-state');
    statusText.textContent = '未连接';
    heroTitle.style.color = ''; // 让 CSS 默认色生效
    heroTitle.textContent = '点击连接';
    heroSub.textContent = '安全访问全球网络';
    nodeFlag.className = 'flag-box';
    nodeSub.className = 'node-sub'; nodeSub.textContent = '自动选择';
    switchBtn.textContent = '选择 ›';
    setShieldColor('#5A6B85'); // [v2] 深色主题下的中性灰
    // 移除 inline body 背景,使用 CSS 默认深色
    document.body.style.background = '';

  } else if (state === 'connecting') {
    document.body.classList.add('connecting');
    connectBtn.className = 'connecting';
    ring3.className = 'ring3'; ring2.className = 'ring2'; ring1.className = 'ring1';
    statusPill.setAttribute('data-state', 'connecting');
    statusText.textContent = '连接中';
    heroTitle.style.color = '';
    heroTitle.textContent = '正在连接…';
    heroSub.textContent = '请稍候';
    nodeFlag.className = 'flag-box';
    nodeSub.className = 'node-sub'; nodeSub.textContent = '检测节点中';
    switchBtn.textContent = '';
    setShieldColor('#FFB547'); // [v2] 琥珀色
    document.body.style.background = '';

  } else if (state === 'connected') {
    document.body.classList.add('connected');
    connectBtn.className = 'connected';
    ring3.className = 'ring3 on pulse'; ring2.className = 'ring2 on pulse'; ring1.className = 'ring1 on';
    statusPill.setAttribute('data-state', 'connected');
    statusText.textContent = '已连接';
    heroTitle.style.color = '';
    heroTitle.textContent = '连接成功';
    heroSub.textContent = '';
    nodeFlag.className = 'flag-box active';
    nodeSub.className = 'node-sub active'; nodeSub.textContent = '线路畅通';
    switchBtn.textContent = '切换 ›';
    setShieldColor('#0A0E1A'); // [v2] connected 时按钮变青绿渐变,深色文字反差更强
    document.body.style.background = '';

    if (node) {
      nodeFlag.textContent = node.flag || 'US';
      nodeName.textContent = node.name || '美国·01';
    }
  }
}

function doConnect(node) {
  setUI('connecting', node);
  chrome.runtime.sendMessage({ action: 'connect', node: node || null }, (result) => {
    if (result && result.success) {
      setUI('connected', result.node);
    } else {
      setUI('idle');
      heroTitle.textContent = '连接失败,请重试';
      heroSub.textContent = '请检查网络后重试';
    }
  });
}

// 初始化:读取状态和上次节点名
chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
  if (res && res.connected) {
    setUI('connected', res.activeNode);
  } else {
    setUI('idle');
    let retryCount = 0;

    function updateNodeDisplay() {
      chrome.storage.local.get(['lastNode'], (data) => {
        chrome.runtime.sendMessage({ action: 'getNodes' }, (r) => {
          const nodes = r.nodes || [];

          if (nodes.length === 0) {
            retryCount++;
            if (retryCount === 1) {
              // 第一次失败:还在尝试,显示"获取节点中"
              nodeFlag.textContent = '?';
              nodeName.textContent = '获取节点中…';
              setTimeout(updateNodeDisplay, 5000);
            } else {
              // 第二次仍失败:给用户可执行的引导
              nodeFlag.textContent = '!';
              nodeName.textContent = '请访问 fanvpn.net';
              window.nodeLoadFailed = true;  // [v1.5.3] 标记错误状态,nodeCard 点击改为打开官网
            }
            return;
          }

          retryCount = 0;
          window.nodeLoadFailed = false;

          if (!data.lastNode) {
            const first = nodes[0];
            nodeFlag.textContent = first.flag || 'US';
            nodeName.textContent = first.name;
            return;
          }

          const last = nodes.find(n => n.server === data.lastNode);
          if (last) {
            nodeFlag.textContent = last.flag || 'US';
            nodeName.textContent = last.name;
          } else {
            nodeFlag.textContent = '?';
            nodeName.textContent = '自动选择';
            chrome.storage.local.remove(['lastNode']);
          }
        });
      });
    }

    updateNodeDisplay();
  }
});

connectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
    if (res && res.connected) {
      setUI('idle');
      chrome.runtime.sendMessage({ action: 'disconnect' });
    } else {
      doConnect(null);
    }
  });
});

nodeCard.addEventListener('click', () => {
  // [v1.5.3] 节点加载失败时,点击卡片改为打开官网(给用户可执行操作)
  if (window.nodeLoadFailed) {
    chrome.tabs.create({ url: 'https://fanvpn.net' });
    return;
  }
  showNodePage();
});

function showNodePage() {
  mainPage.style.display = 'none';
  nodePage.style.display = 'block';
  loadNodeList();
}

function hideNodePage() {
  nodePage.style.display = 'none';
  mainPage.style.display = 'block';
}

backBtn.addEventListener('click', hideNodePage);

function loadNodeList() {
  chrome.runtime.sendMessage({ action: 'getNodes' }, (res) => {
    allNodes = res.nodes || [];
    renderNodeList(allNodes.map(n => ({ ...n, status: null })));
  });
}

function checkNodes() {
  renderNodeList(allNodes.map(n => ({ ...n, status: 'checking' })));
  chrome.runtime.sendMessage({ action: 'checkNodes' }, (res) => {
    if (res && res.results) renderNodeList(res.results);
  });
}

refreshBtn.addEventListener('click', checkNodes);

function renderNodeList(nodes) {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (res) => {
    const activeServer = res && res.activeNode ? res.activeNode.server : null;
    nodeList.innerHTML = '';
    nodes.forEach(node => {
      const item = document.createElement('div');
      item.className = 'node-item' + (node.status === 'fail' ? ' disabled' : '');

      const siClass = node.status === 'ok'       ? 'si si-ok' :
                      node.status === 'fail'     ? 'si si-fail' :
                      node.status === 'checking' ? 'si si-checking' : '';

      const statusLabel = node.status === 'ok'       ? '可用' :
                          node.status === 'fail'     ? '不可用' :
                          node.status === 'checking' ? '检测中…' : '';

      // [v2] 状态颜色对齐深色主题
      const statusColor = node.status === 'ok'   ? '#00FF94' :
                          node.status === 'fail' ? '#FF4757' : '#5A6B85';

      const isActive = node.server === activeServer;
      const flagActive = isActive ? ' active' : '';

      item.innerHTML = `
        <div class="item-left">
          <div class="item-flag${flagActive}">${node.flag || 'US'}</div>
          <div>
            <div class="item-name">${node.name}</div>
            ${siClass ? `<div class="item-status" style="color:${statusColor}">${statusLabel}</div>` : ''}
          </div>
        </div>
        <div class="item-right">
          ${siClass ? `<span class="${siClass}"></span>` : ''}
          ${isActive ? '<div class="check-on"></div>' : '<div class="check-off"></div>'}
        </div>
      `;

      if (node.status !== 'fail') {
        item.addEventListener('click', () => {
          hideNodePage();
          doConnect(node);
        });
      }
      nodeList.appendChild(item);
    });
  });
}

// ════════════ [v1.6.3] 智能分流 / 全局模式 切换 ════════════
function refreshModeChip() {
  chrome.storage.local.get(['globalMode'], (data) => {
    const isGlobal = data.globalMode === true;
    if (isGlobal) {
      modeChip.textContent = '全局模式';
      modeChip.classList.add('active');
      modeChip.title = '点击切换为智能分流';
    } else {
      modeChip.textContent = '智能分流';
      modeChip.classList.remove('active');
      modeChip.title = '点击切换为全局模式';
    }
  });
}

if (modeChip) {
  // 初始化显示
  refreshModeChip();

  // 点击切换
  modeChip.addEventListener('click', () => {
    chrome.storage.local.get(['globalMode'], (data) => {
      const next = !(data.globalMode === true);
      chrome.storage.local.set({ globalMode: next }, () => {
        // 通知 background 重新应用代理
        chrome.runtime.sendMessage({ action: 'setMode' }, () => {
          refreshModeChip();
        });
      });
    });
  });
}
