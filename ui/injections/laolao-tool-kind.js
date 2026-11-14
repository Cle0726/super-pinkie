/* laolao-tool-kind:v1 —— 工具调用归哪一类、状态词怎么说（PLAN 2.8，所有模式共用）
 *
 * 舞台（laolao-cle-stage）、工具流（laolao-tool-stream）、状态条（laolao-run-status）各有自己的文案表，
 * 这里是第四张「话术」表，也是命令分类的唯一一份：
 *   - ofCommand(cmd)：只看命令开头的程序名（跳过 sudo / 环境变量 / cd x && …），认得
 *     macOS / Linux 和 Windows（cmd、PowerShell）两边的写法；判定不了返回 ''，调用方退回原来的说法。
 *   - refine(base, name, args, trace)：在原来的类别上细分：写入 → 创建（后端 before_tool_call 查过路径在
 *     调用前不存在才算）、命令 → 删除 / 移动 / 安装 / 构建 / git / 下载、读图片 → 看图片、截图、派发……
 *   - runKind({metre, woken, childrenRunning})：Metre 一轮结束仍有子会话在跑 → 等；被汇报叫醒 → 验收。
 * 测试 tests/tool-kind-words.test.cjs 把四张表的类别对齐。 */
(function (root) {
  'use strict';

  // PLAN 2.8 表里的新类别（顺序即表的顺序）
  const KINDS = ['create', 'write', 'delete', 'move', 'install', 'build', 'git', 'download', 'view', 'shot',
    'dispatch', 'wait', 'review', 'manage', 'models'];

  // 进行中
  const ING = {
    create: '正在创建', write: '正在写入', delete: '正在删除', move: '正在移动', install: '正在安装',
    build: '正在构建', git: '正在提交', download: '正在下载', view: '正在看图片', shot: '正在截图',
    dispatch: '正在派发', wait: '在等子会话', review: '正在验收', manage: '正在整理会话', models: '正在看可用模型',
  };
  const GIT_ING = {commit: '正在提交', push: '正在推送', pull: '正在拉取', fetch: '正在拉取'};

  // 完成后（what：文件名 / 命令 / 模式名；没有就只说动作）
  const DONE = {
    create: (what) => what ? '创建了 ' + what : '创建了文件',
    write: (what) => what ? '写入了 ' + what : '写入了文件',
    delete: (what) => what ? '删除了 ' + what : '删除了文件',
    move: (what) => what ? '移动了 ' + what : '移动了文件',
    install: (what) => what ? '安装了 ' + what : '装好了依赖',
    build: () => '构建完成',
    git: (what, sub) => sub === 'push' ? '已推送' : sub === 'pull' || sub === 'fetch' ? '已拉取' : (what ? '已提交 ' + what : '已提交'),
    download: (what) => what ? '下载了 ' + what : '下载了文件',
    view: (what) => what ? '看了 ' + what : '看了图片',
    shot: () => '截了一张图',
    dispatch: (what) => what ? '派给了 ' + what : '派出了一个子会话',
    wait: () => '等子会话',
    review: () => '验收了',
    manage: () => '整理了会话',
    models: () => '看了可用模型',
  };

  const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|heic|avif|tiff?)$/i;
  const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

  /* ── 命令 ── */
  // 取命令开头的程序名和后面的词。只做最浅的切分：跳过 sudo、环境变量赋值、`cd 目录 &&`、PowerShell 的 & 调用。
  function words(cmd) {
    let s = String(cmd || '').trim().split(/\r?\n/)[0];
    for (let i = 0; i < 3; i++) {
      const m = /^(?:cd|Set-Location|pushd|sl)\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;|\|\|)\s*/i.exec(s);
      if (!m) break;
      s = s.slice(m[0].length);
    }
    const parts = s.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    while (parts.length && (/^(?:sudo|doas|time|nohup|exec|env|command|&|call|cmd(?:\.exe)?|\/c)$/i.test(parts[0]) || /^[A-Za-z_][\w]*=/.test(parts[0]))) parts.shift();
    const prog = (parts[0] || '').replace(/^["']|["']$/g, '');
    return {prog: baseName(prog).replace(/\.(?:exe|cmd|bat|ps1)$/i, '').toLowerCase(), rest: parts.slice(1).map((w) => w.replace(/^["']|["']$/g, ''))};
  }
  const lower = (list) => list.map((w) => w.toLowerCase());

  const DELETE = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri', 'trash', 'unlink', 'shred']);
  const MOVE = new Set(['mv', 'move', 'ren', 'rename', 'move-item', 'mi', 'rename-item', 'rni']);
  const INSTALLERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'pipx', 'uv', 'brew', 'winget', 'choco', 'scoop',
    'apt', 'apt-get', 'cargo', 'gem', 'go', 'conda', 'poetry', 'install-module', 'install-package']);
  const INSTALL_VERB = new Set(['install', 'i', 'add', 'ci']);
  const BUILDERS = new Set(['make', 'cmake', 'ninja', 'msbuild', 'tsc', 'webpack', 'xcodebuild', 'gradle', 'gradlew', 'mvn']);
  const BUILD_VERB = new Set(['build', 'assemble', 'compile', 'package']);

  /** 命令归哪一类；判定不了返回 ''。git 另带 sub（commit / push / pull / fetch）。 */
  function ofCommand(cmd) {
    const {prog, rest} = words(cmd);
    if (!prog) return '';
    const args = lower(rest);
    const sub = args.find((w) => !w.startsWith('-')) || '';
    if (DELETE.has(prog)) return 'delete';
    if (MOVE.has(prog)) return 'move';
    if (prog === 'git') return ['commit', 'push', 'pull', 'fetch'].includes(sub) ? 'git' : '';
    if (/^install-(?:module|package)$/.test(prog)) return 'install';
    if (prog === 'go') return sub === 'build' ? 'build' : sub === 'install' || sub === 'get' ? 'install' : '';
    if (prog === 'cargo') return sub === 'build' ? 'build' : sub === 'install' || sub === 'add' ? 'install' : '';
    if (INSTALLERS.has(prog)) {
      if (INSTALL_VERB.has(sub) || (prog === 'apt-get' && sub === 'install')) return 'install';
      if ((prog === 'npm' || prog === 'pnpm' || prog === 'yarn' || prog === 'bun') && (sub === 'build' || (sub === 'run' && /^build(?::|$)/.test(args[args.indexOf('run') + 1] || '')))) return 'build';
      if (prog === 'yarn' && !sub) return 'install';
      return '';
    }
    if (BUILDERS.has(prog)) return 'build';
    if (prog === 'dotnet' || prog === 'swift' || prog === 'vite' || prog === 'next' || prog === 'docker') return BUILD_VERB.has(sub) ? 'build' : '';
    if (prog === 'wget' || prog === 'start-bitstransfer') return 'download';
    if (prog === 'curl' || prog === 'curl.exe') return rest.some((w) => /^-(?:[a-z]*[oO][a-z]*)$|^--output$|^--remote-name/.test(w)) ? 'download' : '';
    if (prog === 'invoke-webrequest' || prog === 'iwr' || prog === 'invoke-restmethod' || prog === 'irm') return args.some((w) => /^-outf(?:ile)?$/.test(w)) ? 'download' : '';
    return '';
  }
  function gitSub(cmd) {
    const {prog, rest} = words(cmd);
    if (prog !== 'git') return '';
    const sub = lower(rest).find((w) => !w.startsWith('-')) || '';
    return GIT_ING[sub] ? sub : '';
  }

  /* ── 一次工具调用 ── */
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
  const pathOf = (a) => a && (a.path || a.file_path || a.filePath || a.file);
  const isImagePath = (p) => typeof p === 'string' && IMAGE_EXT.test(p.trim());
  /**
   * base：调用方原来的类别（read / write / exec / image / browse / computer / session …）。
   * trace：后端带回来的这一次调用的记录 {created, images}；没有就不猜。
   * 返回细分后的类别；没有更细的说法就原样返回 base。
   */
  function refine(base, name, args, trace) {
    const n = norm(name);
    const a = args && typeof args === 'object' ? args : {};
    if (n === 'pinkie_session_start') return 'dispatch';
    if (n === 'pinkie_sessions') return 'manage';
    if (n === 'pinkie_models') return 'models';
    if (n === 'image') return 'view';
    if ((n === 'browser' || n === 'computer' || n === 'computer_flow' || n === 'app_browser') && /screenshot|snapshot_image|capture/i.test(String(a.action || a.kind || ''))) return 'shot';
    if (n === 'read' || n === 'workbench_read') {
      if (isImagePath(pathOf(a)) || (trace && trace.images && trace.images.length)) return 'view';
      return base;
    }
    if (n === 'write' || base === 'write') {
      if (trace && trace.created === true) return 'create';
      return base;
    }
    if (base === 'exec' && (a.command || a.cmd)) return ofCommand(a.command || a.cmd) || base;
    return base;
  }

  /** 进行中的动作词；git 按子命令说「提交 / 推送 / 拉取」。 */
  function ing(kind, args) {
    if (kind === 'git') {
      const a = args && typeof args === 'object' ? args : {};
      const sub = gitSub(a.command || a.cmd || (typeof args === 'string' ? args : ''));
      return GIT_ING[sub] || ING.git;
    }
    return ING[kind] || '';
  }

  /** 完成后的一句；what 是参数原文（命令 / 路径），这里只取文件名。 */
  function done(kind, what) {
    const fn = DONE[kind];
    if (!fn) return '';
    const text = String(what || '').trim();
    if (kind === 'git') return fn('', gitSub(text));
    if (kind === 'dispatch' || kind === 'install') return fn(text.length > 40 ? '' : text);
    if (kind === 'delete' || kind === 'move' || kind === 'download') {
      // 命令：取最后一个像路径的词
      const parts = text.match(/"[^"]*"|'[^']*'|\S+/g) || [];
      const last = parts.slice(1).reverse().find((w) => !/^-/.test(w));
      return fn(last ? baseName(last.replace(/^["']|["']$/g, '')) : '');
    }
    return fn(baseName(text.replace(/:\d+(?:–\d+)?$/, '')));
  }

  /** Metre 一轮的整体状态（不是某个工具）：被汇报叫醒 → 验收；结束时还有子会话在跑 → 等。 */
  function runKind(state) {
    const s = state || {};
    if (!s.metre) return '';
    if (s.woken) return 'review';
    if (s.ended && s.childrenRunning > 0) return 'wait';
    return '';
  }

  /** 过程里一行工具对应的 toolCallId。两种排法：
   *  - 工具结果单独一条：data-message-id = tool:<role>:<callId>
   *  - 时间线（工具调用嵌在助手消息里）：msg:assistant:<时间戳>:<第几条>:timeline:tool:<第几次调用>，
   *    到聊天面板的消息列表里按位置（时间戳核对）找那条助手消息的第 n 个 toolCall。找不到返回 ''。 */
  function rowCallId(row) {
    const host = row && row.closest && row.closest('[data-message-id]');
    const id = host ? String(host.dataset.messageId || '') : '';
    let m = /^tool:[^:]+:([^:]+)/.exec(id);
    if (m) return m[1];
    m = /^msg:assistant:(\d+):(\d+):timeline:tool:(\d+)/.exec(id);
    if (!m || typeof document === 'undefined') return '';
    const pane = document.querySelector('openclaw-chat-pane');
    const msgs = pane && pane.state && Array.isArray(pane.state.chatMessages) ? pane.state.chatMessages : [];
    let msg = msgs[Number(m[2])];
    if (!msg || String(msg.timestamp) !== m[1]) msg = msgs.find((x) => x && x.role === 'assistant' && String(x.timestamp) === m[1]);
    const calls = msg && Array.isArray(msg.content) ? msg.content.filter((b) => b && b.type === 'toolCall') : [];
    const call = calls[Number(m[3])];
    return call && typeof call.id === 'string' ? call.id : '';
  }

  const api = {KINDS, rowCallId, ING, DONE, GIT_ING, IMAGE_EXT, ofCommand, gitSub, refine, ing, done, runKind, baseName, isImagePath};
  root.__pinkieToolKind = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
