// K4：用户看得到的内核名字是「C.le.」，不再是「CLE Kk」；关于页署名「C.le. 内核 <版本>」。
// 用户 11-24：界面上不再出现 OpenClaw；唯一保留的是关于页「第三方许可」里的 MIT 声明（法律要求）。
// 技术名字（openclaw 包名、~/.openclaw、CLE_KK_* 环境变量、cle-kk 状态目录）不在这里检查，也不许改。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 这些文件里出现的内核名字都会显示给用户（界面文字、通知、错误提示、控制台输出、用户文档）。
const USER_VISIBLE = [
  'app/super_pinkie.py',
  'app/windows_bridge.py',
  'desktop/macos/pinkie/Sources/MaterialPreview.swift',
  'desktop/macos/THIRD_PARTY_NOTICES.md',
  'desktop/windows/mac-runtime/openclaw/dist/control-ui/sw.js',
  'ui/injections/laolao-phrases.js',
  'ui/injections/laolao-settings-user.js',
  'ui/party/party.js',
  'services/party/server.py',
  'update.ps1',
  'update.sh',
  'README.md',
  'docs/CONTEXT-MANAGEMENT.md',
  'docs/FULL_APP.md',
  'docs/LIVE-PROGRESS.md',
  'docs/LONG-TERM-MEMORY.md',
  'docs/PARTY-SPACE.md',
  'docs/PROJECT-SCOPE.md',
  'docs/WINDOWS.md',
];

// 文件里其余的「CLE Kk」是注释、开发日志或给模型看的提示词，只检查这几行用户可见的文字。
const USER_VISIBLE_LINES = {
  'desktop/macos/pinkie/Sources/Launcher.swift': [/lastError = "[^"]*网关仍占用端口/, /lastError = "缺少 [^"]*桌面执行器/],
  'services/party/setup.py': [/print\('派对专属 Agent 已安装。'/],
  'services/roundtable/server.py': [/模型连接器'\)/, /圆桌调用的 [^']* Agent 配置'\)/, /本机 [^']* 执行器'\)/],
  'services/mode-architecture/memory.mjs': [/主模式的有效会话/],
  'services/mode-architecture/mode-architecture-core.mjs': [/主模式与基础/],
  'services/mode-architecture/watchdog-runtime.mjs': [/name: '[^']*续接'/],
  // 交付核对失败的原因会作为失败「原文」显示（laolao-message-actions.js），也会写进重试指令。
  'services/mode-architecture/clekk-supervisor.mjs': [/状态摘要不一致'/, /状态文件不可读'/, /审计日志正被写入/, /审计链断裂'/,
    /审计日志不可读：/, /状态不可验证'/, /正在继续核对真实执行结果'/],
};

test('K4：用户可见处不再出现「CLE Kk」', () => {
  for (const rel of USER_VISIBLE) {
    const hits = read(rel).split('\n').map((line, i) => line.includes('CLE Kk') ? `${rel}:${i + 1}` : '').filter(Boolean);
    assert.deepEqual(hits, [], `用户可见的文件里还有「CLE Kk」：${hits.join('、')}`);
  }
  for (const [rel, patterns] of Object.entries(USER_VISIBLE_LINES)) {
    const lines = read(rel).split('\n');
    for (const pattern of patterns) {
      const matched = lines.filter((line) => pattern.test(line));
      assert.equal(matched.length, 1, `${rel} 里找不到（或不止一处）用户可见的行 ${pattern}`);
      assert.ok(matched[0].includes('C.le.') && !matched[0].includes('CLE Kk'), `${rel} 的用户可见文字没改成 C.le.：${matched[0].trim()}`);
    }
  }
});

test('K4：界面把上游名字和旧名字都换成 C.le.，并仍认得旧名字', () => {
  const phrases = read('ui/injections/laolao-phrases.js');
  for (const [from, to] of [['网关仪表盘', 'C.le. 本地工作台'], ['Gateway 令牌', 'C.le. 访问令牌']]) {
    assert.ok(phrases.includes(`["${from}", "${to}"]`), `缺少界面文字 ${from} → ${to}`);
  }
  assert.match(phrases, /document\.title=document\.title\.replace\(\/OpenClaw\/g,'C\.le\.'\)/);
  // 「问问 …」按钮：上游写 OpenClaw，旧版写 CLE Kk，新版写 C.le.，都要识别成碧琪的入口。
  assert.equal(phrases.split('(?:OpenClaw|CLE\\s*Kk|C\\.le\\.)').length - 1, 2);
  const sw = read('desktop/windows/mac-runtime/openclaw/dist/control-ui/sw.js');
  assert.match(sw, /title: "C\.le\."/);
  assert.match(read('ui/party/party.js'), /openclaw:'C\.le\.'/);
});

test('K4：关于页有「C.le. 内核 <版本>」，版本来自网关而不是写死，也不写上游名字', () => {
  const source = read('ui/injections/laolao-settings-user.js');
  const window = {};
  const document = {readyState: 'loading', addEventListener() {}};
  vm.runInNewContext(source, {window, document, URL, URLSearchParams, JSON, Object, Array, String, Boolean, Date, Number},
    {filename: 'laolao-settings-user.js'});
  const {kernelCredit} = window.__laolaoUserSettings;
  assert.equal(kernelCredit('2026.10.1'), 'C.le. 内核 2026.10.1');
  assert.equal(kernelCredit('9.9.9-test'), 'C.le. 内核 9.9.9-test');
  // 卡片里有这一行，并且和「版本」一起从网关报的版本刷新。
  const about = source.slice(source.indexOf('const aboutCard = card('), source.indexOf('const footer = element("footer"'));
  assert.match(about, /state\.kernelNote = element\("p", "pinkie-user-settings__soft-note", aboutCard, kernelCredit\(/);
  const sync = source.slice(source.indexOf('function syncVersion()'), source.indexOf('const tokenCount ='));
  assert.match(sync, /serverVersion/);
  assert.match(sync, /ownText\(state\.kernelNote, kernelCredit\(version\)\)/);
  assert.doesNotMatch(source, /C\.le\. 内核 \d/, '版本号不能写死在页面里');
});

test('K4：技术名字不带点', () => {
  // 新增的文件夹名、包名不许以点结尾（Windows 会去掉末尾的点）。
  for (const rel of ['services/party/server.py', 'ui/party/party.js']) {
    assert.doesNotMatch(read(rel), /['"]C\.le\.['"]\s*:/, `${rel} 不应把 C.le. 当作键名`);
  }
  assert.match(read('ui/party/party.js'), /openclaw:'C\.le\.'/, '派对成员 id 仍是 openclaw');
  assert.match(read('services/party/server.py'), /'openclaw': 'C\.le\.'/);
});

// 控制台原生分块：碧琪共用的 ui/runtime 里，用户看得到的文字不再有 OpenClaw（patch/apply-brand-text.mjs 烤进去的）。
// 留下的只有给模型看的内部提示（后端按原文识别）和技术名字。
const RUNTIME_ALLOWED = [
  /^OpenClaw runtime context \(internal\):$/, /^OpenClaw runtime context for the immediately preceding user message\.$/, /^OpenClaw runtime event\.$/,
  /^Internal OpenClaw voice control result\.$/, /^Speak this exact OpenClaw status to the voice call/, /^Tell the person briefly that you are checking, then wait for the final OpenClaw result/,
];
test('K4：控制台界面文字不再出现 OpenClaw（语言包、品牌位、提示、斜杠命令、错误提示）', () => {
  const dir = path.join(root, 'ui/runtime');
  const literal = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  const left = [];
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.js'));
  for (const name of files) {
    const text = read('ui/runtime/' + name);
    for (const m of text.matchAll(literal)) {
      const s = m[0].slice(1, -1);
      if (!/(?<![A-Za-z0-9_$])OpenClaw(?![A-Za-z0-9_$])/.test(s)) continue;
      if (RUNTIME_ALLOWED.some((re) => re.test(s))) continue;
      left.push(name + ': ' + s.replace(/\s+/g, ' ').trim().slice(0, 100));
    }
  }
  assert.deepEqual(left, [], '用户看得到的 OpenClaw：\n' + left.join('\n'));
  // 21 个语言包都在（含简体、繁体中文和英文），否则安装时会落回上游原样的那一份。
  for (const locale of ['i18n', 'zh-CN', 'zh-TW', 'ja-JP', 'de', 'nl']) assert.ok(files.some((n) => n.startsWith(locale + '-')), locale);
  assert.equal(files.filter((n) => /^(?:i18n|ar|de|es|fa|fr|hi|id|it|ja-JP|ko|nl|pl|pt-BR|ru|th|tr|uk|vi|zh-CN|zh-TW)-/.test(n)).length, 21);
  const index = read('ui/runtime/index-Bvtt7vVx.js');
  assert.match(index, /<span class="topbar-brand__title">C\.le\.<\/span>/);
  assert.match(index, /<div class="login-gate__title">C\.le\.<\/div>/);
  assert.match(read('ui/runtime/zh-CN-CDJc7cUL.js'), /`C\.le\. 移动版`/);
  assert.match(read('ui/runtime/chat-page-DrPkxqJK.js'), /e\.assistantName\|\|`C\.le\.`/);
});

test('K4：OpenClaw 的 MIT 声明只在关于页「第三方许可」里，一字不改', () => {
  const js = read('ui/injections/laolao-metre-engine.js');
  const block = /\/\/ NOTICES-BEGIN[\s\S]*?\/\/ NOTICES-END/.exec(js)[0];
  const notices = block.slice(block.indexOf('`') + 1, block.lastIndexOf('`'));
  // openclaw@2026.7.1-2 包里 LICENSE 的第 1–21 行。
  const mit = ['MIT License', '', 'Copyright (c) 2026 OpenClaw Foundation', '',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:', '',
    'The above copyright notice and this permission notice shall be included in all',
    'copies or substantial portions of the Software.', '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE', 'SOFTWARE.'].join('\n');
  assert.ok(notices.endsWith(mit), 'OpenClaw 的 MIT 全文要原样放在第三方许可最后');
  assert.ok(notices.includes('https://github.com/openclaw/openclaw'));
  // 引擎文件里，第三方许可以外的地方不出现 OpenClaw；关于页署名也不出现。
  assert.doesNotMatch(js.replace(block, ''), /OpenClaw/);
  const settings = read('ui/injections/laolao-settings-user.js');
  const creditLine = settings.slice(settings.indexOf('const kernelCredit'), settings.indexOf('\n', settings.indexOf('const kernelCredit')));
  assert.doesNotMatch(creditLine.split('//')[0], /OpenClaw|MIT/, '关于页署名的文字里不写上游名字');
});
