// 工作台的「扩展」市场：语言服务、格式化 / 检查、运行环境、开发工具，一键安装 / 卸载，不弹确认。
//
// VS Code 的扩展需要它自己的扩展宿主，网页编辑器跑不了；这里装的是真正干活的东西（语言服务器、格式化器、
// 运行时、命令行工具），装完自动接进补全 / 报错 / 格式化 / 运行 / code_check。目录之外的软件可以在 Homebrew 里搜。
// 只执行目录里固定的安装命令（或校验过名字的 Homebrew 包），走国内镜像或本机代理；同一时间只装一个。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn, execFile} from 'node:child_process';

const HOME = os.homedir();
export const LSP_DIR = path.join(process.env.PINKIE_STATE_ROOT || path.join(HOME, 'Library/Application Support/SuperPinkie'), 'lsp');
const executable = file => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };
const nvmBins = () => { try { const root = path.join(HOME, '.nvm/versions/node'); return fs.readdirSync(root).sort().reverse().map(v => path.join(root, v, 'bin')); } catch { return []; } };

// 工具可能出现的位置（按优先级）
export function searchDirs() {
  return [path.join(LSP_DIR, 'node_modules/.bin'), path.join(LSP_DIR, 'bin'), path.join(HOME, '.local/bin'), path.join(HOME, '.cargo/bin'), path.join(HOME, 'go/bin'), path.join(HOME, '.local/go/bin'),
    ...nvmBins(), '/opt/homebrew/bin', '/opt/homebrew/opt/openjdk/bin', path.join(HOME, '.homebrew/bin'), '/usr/local/bin', '/usr/bin', '/bin', '/Library/Developer/CommandLineTools/usr/bin'];
}
export function which(name, dirs = searchDirs()) {
  for (const dir of dirs) { const file = path.join(dir, name); if (executable(file)) return file; }
  return '';
}
export function toolPath() {
  return [...searchDirs(), path.dirname(process.execPath), ...(process.env.PATH || '').split(':')].filter((v, i, a) => v && a.indexOf(v) === i).join(':');
}
// 系统 /usr/bin 下有些是「点了才提示安装」的占位程序（java、ruby 旧版等）；只认真的
const rustupHas = component => fs.existsSync(path.join(HOME, '.rustup/toolchains')) && fs.readdirSync(path.join(HOME, '.rustup/toolchains')).some(t => executable(path.join(HOME, '.rustup/toolchains', t, 'bin', component)));

const S = {npm: 'npm 镜像（npmmirror）', brew: 'Homebrew', go: 'Go 模块（goproxy.cn）', rustup: 'rustup', uv: 'uv（PyPI）', system: '系统自带', nvm: '已安装（nvm）'};
// kind: lsp 语言服务 / format 格式化与检查 / runtime 运行环境 / tool 开发工具
export const CATALOG = [
  // ── 语言服务（补全、跳转、报错）
  {id: 'pyright', name: 'Pyright', kind: 'lsp', icon: 'python', langs: ['python'], desc: 'Python 补全、跳转、类型检查（微软）', license: 'MIT', install: {via: 'npm', pkg: 'pyright'}, bin: 'pyright-langserver'},
  {id: 'gopls', name: 'gopls', kind: 'lsp', icon: 'go', langs: ['go'], desc: 'Go 官方语言服务', license: 'BSD-3', install: {via: 'go', pkg: 'golang.org/x/tools/gopls@latest'}, bin: 'gopls', needs: 'go'},
  {id: 'rust-analyzer', name: 'rust-analyzer', kind: 'lsp', icon: 'rust', langs: ['rust'], desc: 'Rust 官方语言服务', license: 'MIT/Apache-2.0', install: {via: 'rustup', pkg: 'rust-analyzer'}, detect: () => rustupHas('rust-analyzer'), needs: 'rustup'},
  {id: 'clangd', name: 'clangd', kind: 'lsp', icon: 'c', langs: ['c', 'cpp', 'objective-c'], desc: 'C / C++ / Objective-C 语言服务（Xcode 命令行工具自带）', license: 'Apache-2.0', install: {via: 'system'}, bin: 'clangd'},
  {id: 'sourcekit-lsp', name: 'SourceKit-LSP', kind: 'lsp', icon: 'swift', langs: ['swift'], desc: 'Swift 语言服务（Xcode 命令行工具自带）', license: 'Apache-2.0', install: {via: 'system'}, bin: 'sourcekit-lsp'},
  {id: 'bash-language-server', name: 'Bash Language Server', kind: 'lsp', icon: 'console', langs: ['shell'], desc: 'Shell 脚本补全、跳转、提示（装了 shellcheck 会一起检查）', license: 'MIT', install: {via: 'npm', pkg: 'bash-language-server'}, bin: 'bash-language-server'},
  {id: 'yaml-language-server', name: 'YAML Language Server', kind: 'lsp', icon: 'yaml', langs: ['yaml'], desc: 'YAML 补全与校验（Red Hat）', license: 'MIT', install: {via: 'npm', pkg: 'yaml-language-server'}, bin: 'yaml-language-server'},
  {id: 'dockerfile-language-server', name: 'Dockerfile Language Server', kind: 'lsp', icon: 'docker', langs: ['dockerfile'], desc: 'Dockerfile 补全与检查', license: 'MIT', install: {via: 'npm', pkg: 'dockerfile-language-server-nodejs'}, bin: 'docker-langserver'},
  {id: 'intelephense', name: 'Intelephense', kind: 'lsp', icon: 'php', langs: ['php'], desc: 'PHP 补全、跳转、诊断', license: '免费版', install: {via: 'npm', pkg: 'intelephense'}, bin: 'intelephense'},
  {id: 'lua-language-server', name: 'Lua Language Server', kind: 'lsp', icon: 'lua', langs: ['lua'], desc: 'Lua 补全与诊断', license: 'MIT', install: {via: 'brew', pkg: 'lua-language-server'}, bin: 'lua-language-server'},
  {id: 'jdtls', name: 'Eclipse JDT LS', kind: 'lsp', icon: 'java', langs: ['java'], desc: 'Java 补全与诊断（需要 JDK 21+，会一起装 openjdk）', license: 'EPL-2.0', install: {via: 'brew', pkg: 'jdtls'}, bin: 'jdtls'},
  {id: 'kotlin-language-server', name: 'Kotlin Language Server', kind: 'lsp', icon: 'kotlin', langs: ['kotlin'], desc: 'Kotlin 补全与诊断', license: 'MIT', install: {via: 'brew', pkg: 'kotlin-language-server'}, bin: 'kotlin-language-server'},
  {id: 'marksman', name: 'Marksman', kind: 'lsp', icon: 'markdown', langs: ['markdown'], desc: 'Markdown 标题跳转、链接补全、引用检查', license: 'MIT', install: {via: 'brew', pkg: 'marksman'}, bin: 'marksman'},
  {id: 'sqls', name: 'sqls', kind: 'lsp', icon: 'database', langs: ['sql'], desc: 'SQL 补全（连接数据库后可补全表和字段）', license: 'MIT', install: {via: 'go', pkg: 'github.com/sqls-server/sqls@latest'}, bin: 'sqls', needs: 'go'},
  // ── 格式化与检查
  {id: 'prettier', name: 'Prettier', kind: 'format', icon: 'prettier', langs: ['javascript', 'typescript', 'css', 'scss', 'less', 'html', 'json', 'markdown', 'yaml', 'graphql'], desc: '前端通用格式化：JS / TS / CSS / HTML / JSON / Markdown / YAML', license: 'MIT', install: {via: 'npm', pkg: 'prettier'}, bin: 'prettier'},
  {id: 'ruff', name: 'Ruff', kind: 'format', icon: 'python', langs: ['python'], desc: 'Python 极速检查 + 格式化（代替 flake8 / black / isort）', license: 'MIT', install: {via: 'uv', pkg: 'ruff'}, bin: 'ruff'},
  {id: 'shellcheck', name: 'ShellCheck', kind: 'format', icon: 'console', langs: ['shell'], desc: 'Shell 脚本静态检查，找出常见坑', license: 'GPL-3.0（独立程序）', install: {via: 'brew', pkg: 'shellcheck'}, bin: 'shellcheck'},
  {id: 'shfmt', name: 'shfmt', kind: 'format', icon: 'console', langs: ['shell'], desc: 'Shell 脚本格式化', license: 'BSD-3', install: {via: 'brew', pkg: 'shfmt'}, bin: 'shfmt'},
  {id: 'stylua', name: 'StyLua', kind: 'format', icon: 'lua', langs: ['lua'], desc: 'Lua 格式化', license: 'MPL-2.0', install: {via: 'brew', pkg: 'stylua'}, bin: 'stylua'},
  {id: 'clang-format', name: 'clang-format', kind: 'format', icon: 'c', langs: ['c', 'cpp', 'objective-c', 'java'], desc: 'C / C++ / ObjC 格式化（Xcode 命令行工具自带）', license: 'Apache-2.0', install: {via: 'system'}, bin: 'clang-format'},
  {id: 'swift-format', name: 'swift-format', kind: 'format', icon: 'swift', langs: ['swift'], desc: 'Swift 官方格式化（Xcode 命令行工具自带）', license: 'Apache-2.0', install: {via: 'system'}, bin: 'swift-format'},
  {id: 'gofmt', name: 'gofmt', kind: 'format', icon: 'go', langs: ['go'], desc: 'Go 官方格式化（随 Go 安装）', license: 'BSD-3', install: {via: 'system'}, bin: 'gofmt'},
  {id: 'rustfmt', name: 'rustfmt', kind: 'format', icon: 'rust', langs: ['rust'], desc: 'Rust 官方格式化', license: 'MIT/Apache-2.0', install: {via: 'rustup', pkg: 'rustfmt'}, bin: 'rustfmt', needs: 'rustup'},
  {id: 'taplo', name: 'Taplo', kind: 'format', icon: 'toml', langs: ['toml'], desc: 'TOML 格式化与校验（Cargo.toml、pyproject.toml）', license: 'MIT', install: {via: 'brew', pkg: 'taplo'}, bin: 'taplo'},
  // ── 运行环境
  {id: 'node', name: 'Node.js', kind: 'runtime', icon: 'nodejs', desc: 'JavaScript / TypeScript 运行时（已用 nvm 管理）', license: 'MIT', install: {via: 'brew', pkg: 'node'}, bin: 'node'},
  {id: 'python', name: 'Python 3', kind: 'runtime', icon: 'python', desc: 'Python 运行时（uv 管理，项目里 .venv 优先）', license: 'PSF', install: {via: 'brew', pkg: 'python'}, bin: 'python3'},
  {id: 'uv', name: 'uv', kind: 'runtime', icon: 'python', desc: '极速 Python 包和虚拟环境管理', license: 'MIT/Apache-2.0', install: {via: 'brew', pkg: 'uv'}, bin: 'uv'},
  {id: 'go', name: 'Go', kind: 'runtime', icon: 'go', desc: 'Go 编译器与工具链', license: 'BSD-3', install: {via: 'brew', pkg: 'go'}, bin: 'go'},
  {id: 'rust', name: 'Rust', kind: 'runtime', icon: 'rust', desc: 'Rust 编译器与 Cargo（rustup）', license: 'MIT/Apache-2.0', install: {via: 'brew', pkg: 'rustup'}, bin: 'cargo'},
  {id: 'deno', name: 'Deno', kind: 'runtime', icon: 'deno', desc: '自带 TypeScript 的 JS 运行时', license: 'MIT', install: {via: 'brew', pkg: 'deno'}, bin: 'deno'},
  {id: 'bun', name: 'Bun', kind: 'runtime', icon: 'bun', desc: '超快的 JS 运行时 + 包管理器', license: 'MIT', install: {via: 'brew', pkg: 'bun'}, bin: 'bun'},
  {id: 'openjdk', name: 'Java（OpenJDK）', kind: 'runtime', icon: 'java', desc: 'Java 开发工具包（javac / java）', license: 'GPL-2.0+CE', install: {via: 'brew', pkg: 'openjdk'}, detect: () => executable('/opt/homebrew/opt/openjdk/bin/java') || javaHome()},
  {id: 'kotlin', name: 'Kotlin', kind: 'runtime', icon: 'kotlin', desc: 'Kotlin 编译器（kotlinc，可跑 .kts 脚本）', license: 'Apache-2.0', install: {via: 'brew', pkg: 'kotlin'}, bin: 'kotlinc'},
  {id: 'php', name: 'PHP', kind: 'runtime', icon: 'php', desc: 'PHP 解释器', license: 'PHP-3.01', install: {via: 'brew', pkg: 'php'}, bin: 'php'},
  {id: 'ruby', name: 'Ruby', kind: 'runtime', icon: 'ruby', desc: '新版 Ruby（系统自带的是 2.6）', license: 'Ruby', install: {via: 'brew', pkg: 'ruby'}, detect: () => executable('/opt/homebrew/opt/ruby/bin/ruby')},
  {id: 'lua', name: 'Lua', kind: 'runtime', icon: 'lua', desc: 'Lua 解释器', license: 'MIT', install: {via: 'brew', pkg: 'lua'}, bin: 'lua'},
  {id: 'zig', name: 'Zig', kind: 'runtime', icon: 'zig', desc: 'Zig 编译器（也能当 C 交叉编译器用）', license: 'MIT', install: {via: 'brew', pkg: 'zig'}, bin: 'zig'},
  {id: 'dart', name: 'Dart', kind: 'runtime', icon: 'dart', desc: 'Dart SDK', license: 'BSD-3', install: {via: 'brew', pkg: 'dart-sdk'}, bin: 'dart'},
  // ── 开发工具
  {id: 'cmake', name: 'CMake', kind: 'tool', icon: 'cmake', desc: 'C / C++ 项目构建', license: 'BSD-3', install: {via: 'brew', pkg: 'cmake'}, bin: 'cmake'},
  {id: 'pnpm', name: 'pnpm', kind: 'tool', icon: 'pnpm', desc: '省空间的 Node 包管理器', license: 'MIT', install: {via: 'brew', pkg: 'pnpm'}, bin: 'pnpm'},
  {id: 'yarn', name: 'Yarn', kind: 'tool', icon: 'yarn', desc: 'Node 包管理器', license: 'BSD-2', install: {via: 'brew', pkg: 'yarn'}, bin: 'yarn'},
  {id: 'gh', name: 'GitHub CLI', kind: 'tool', icon: 'github', desc: '在终端里管 PR、Issue、仓库', license: 'MIT', install: {via: 'brew', pkg: 'gh'}, bin: 'gh'},
  {id: 'git-lfs', name: 'Git LFS', kind: 'tool', icon: 'git', desc: 'Git 大文件存储', license: 'MIT', install: {via: 'brew', pkg: 'git-lfs'}, bin: 'git-lfs'},
  {id: 'jq', name: 'jq', kind: 'tool', icon: 'json', desc: '命令行 JSON 处理', license: 'MIT', install: {via: 'brew', pkg: 'jq'}, bin: 'jq'},
  {id: 'ripgrep', name: 'ripgrep', kind: 'tool', icon: 'search', desc: '极速全文搜索（工作台搜索就用它）', license: 'MIT/Unlicense', install: {via: 'brew', pkg: 'ripgrep'}, bin: 'rg'},
  {id: 'fd', name: 'fd', kind: 'tool', icon: 'search', desc: '更好用的 find', license: 'MIT/Apache-2.0', install: {via: 'brew', pkg: 'fd'}, bin: 'fd'},
  {id: 'tree', name: 'tree', kind: 'tool', icon: 'list-tree', desc: '以树状列出目录', license: 'GPL-2.0', install: {via: 'brew', pkg: 'tree'}, bin: 'tree'},
  {id: 'sqlite', name: 'SQLite', kind: 'tool', icon: 'database', desc: '新版 SQLite 命令行', license: '公有领域', install: {via: 'brew', pkg: 'sqlite'}, detect: () => executable('/opt/homebrew/opt/sqlite/bin/sqlite3')},
  {id: 'httpie', name: 'HTTPie', kind: 'tool', icon: 'globe', desc: '人性化的 HTTP 调试命令', license: 'BSD-3', install: {via: 'brew', pkg: 'httpie'}, bin: 'http'},
  {id: 'ffmpeg', name: 'FFmpeg', kind: 'tool', icon: 'file-media', desc: '音视频处理', license: 'LGPL/GPL', install: {via: 'brew', pkg: 'ffmpeg'}, bin: 'ffmpeg'},
];
function javaHome() { try { return fs.readdirSync('/Library/Java/JavaVirtualMachines').length > 0; } catch { return false; } }

const BREW_NAME = /^[a-z0-9][a-z0-9@+._-]{0,80}(?:\/[a-z0-9][a-z0-9@+._-]{0,80}){0,2}$/;
const brewBin = () => ['/opt/homebrew/bin/brew', path.join(HOME, '.homebrew/bin/brew'), '/usr/local/bin/brew'].find(executable) || '';

async function proxyEnv() {
  // 本机有代理（Clash 等，127.0.0.1:7897 / 7890）就让下载走它；国内镜像本身不依赖代理
  for (const port of [7897, 7890]) {
    const open = await new Promise(resolve => { const s = net.connect({host: '127.0.0.1', port, timeout: 400}, () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false)); s.on('timeout', () => { s.destroy(); resolve(false); }); });
    if (open) { const url = 'http://127.0.0.1:' + port; return {HTTPS_PROXY: url, HTTP_PROXY: url, https_proxy: url, http_proxy: url, ALL_PROXY: url, NO_PROXY: 'localhost,127.0.0.1,::1,.local,npmmirror.com,goproxy.cn', no_proxy: 'localhost,127.0.0.1,::1,.local,npmmirror.com,goproxy.cn'}; }
  }
  return {};
}

export class ExtensionMarket {
  constructor(options = {}) {
    this.spawnImpl = options.spawn || spawn;
    this.jobs = new Map();          // id → {state, log, startedAt, finishedAt, ok}
    this.queue = Promise.resolve();
    this.listeners = new Set();
  }
  entry(id) { return CATALOG.find(e => e.id === id) || null; }
  installed(entry) {
    if (entry.detect) return Boolean(entry.detect());
    return Boolean(which(entry.bin));
  }
  location(entry) { return entry.bin ? which(entry.bin) : ''; }
  list() {
    return {
      items: CATALOG.map(e => {
        const installed = this.installed(e);
        const job = this.jobs.get(e.id);
        return {id: e.id, name: e.name, kind: e.kind, icon: e.icon, langs: e.langs || [], desc: e.desc, license: e.license, source: S[e.install.via] || e.install.via,
          via: e.install.via, installed, path: installed ? this.location(e) : '', removable: installed && !['system'].includes(e.install.via) && !(e.id === 'node' && /\.nvm/.test(this.location(e))) && !(e.id === 'python' && /\.local\/bin/.test(this.location(e))),
          needs: e.needs && !which(e.needs) ? e.needs : undefined,
          job: job ? {state: job.state, ok: job.ok, log: job.log.slice(-12), action: job.action} : undefined};
      }),
      brew: Boolean(brewBin()),
    };
  }
  emit(id, payload) { for (const fn of this.listeners) { try { fn({id, ...payload}); } catch {} } }

  command(entry, action) {
    const i = entry.install;
    const npm = which('npm');
    if (i.via === 'npm') {
      if (!npm) throw new Error('需要先装 Node.js（npm）。');
      fs.mkdirSync(LSP_DIR, {recursive: true});
      const pkgJson = path.join(LSP_DIR, 'package.json');
      if (!fs.existsSync(pkgJson)) fs.writeFileSync(pkgJson, '{"name":"pinkie-lsp","private":true}\n');
      return action === 'install'
        ? [npm, ['install', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com', '--prefix', LSP_DIR, i.pkg + '@latest'], {}]
        : [npm, ['uninstall', '--prefix', LSP_DIR, i.pkg], {}];
    }
    if (i.via === 'go') {
      const go = which('go');
      if (!go) throw new Error('需要先在「运行环境」里装 Go。');
      if (action === 'install') return [go, ['install', i.pkg], {GOBIN: path.join(LSP_DIR, 'bin'), GOPROXY: 'https://goproxy.cn,direct', GOSUMDB: 'sum.golang.google.cn', GOFLAGS: '-modcacherw'}];
      return ['rm', ['-f', path.join(LSP_DIR, 'bin', entry.bin)], {}];
    }
    if (i.via === 'rustup') {
      const rustup = which('rustup');
      if (!rustup) throw new Error('需要先在「运行环境」里装 Rust（rustup）。');
      return [rustup, ['component', action === 'install' ? 'add' : 'remove', i.pkg], {}];
    }
    if (i.via === 'uv') {
      const uv = which('uv');
      if (!uv) throw new Error('需要先在「运行环境」里装 uv。');
      return [uv, ['tool', action === 'install' ? 'install' : 'uninstall', ...(action === 'install' ? ['--force'] : []), i.pkg], {}];
    }
    if (i.via === 'brew') return this.brewCommand(i.pkg, action);
    throw new Error('这个是系统自带的，不需要安装。' + (entry.bin === 'clangd' || entry.bin === 'clang-format' || entry.bin === 'swift-format' || entry.bin === 'sourcekit-lsp' ? '如果没有，请在终端运行 xcode-select --install。' : ''));
  }
  brewCommand(pkg, action) {
    const brew = brewBin();
    if (!brew) throw new Error('这台电脑没有 Homebrew。');
    if (!BREW_NAME.test(pkg)) throw new Error('软件名不正确。');
    return [brew, action === 'install' ? ['install', '--formula', pkg] : ['uninstall', '--formula', pkg], {HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', HOMEBREW_NO_ENV_HINTS: '1', HOMEBREW_NO_ANALYTICS: '1', NONINTERACTIVE: '1'}];
  }

  // 安装 / 卸载排队执行；输出一行行推给前端
  run(id, action, spec) {
    if (this.jobs.get(id)?.state === 'running' || this.jobs.get(id)?.state === 'queued') throw new Error('正在处理，请稍候。');
    const job = {state: 'queued', log: [], startedAt: Date.now(), action, ok: null};
    this.jobs.set(id, job);
    this.emit(id, {state: 'queued', action});
    this.queue = this.queue.then(() => new Promise(async resolve => {
      job.state = 'running'; this.emit(id, {state: 'running', action});
      const [file, args, env] = spec;
      const child = this.spawnImpl(file, args, {cwd: LSP_DIR, env: {...process.env, PATH: toolPath(), HOME, ...(await proxyEnv()), ...env, CI: '1', TERM: 'dumb', NO_COLOR: '1'}, stdio: ['ignore', 'pipe', 'pipe']});
      const push = chunk => {
        for (const line of String(chunk).split(/\r?\n|\r/)) {
          const text = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim();
          if (!text) continue;
          job.log.push(text.slice(0, 400)); if (job.log.length > 400) job.log.shift();
          this.emit(id, {line: text.slice(0, 400)});
        }
      };
      child.stdout?.on('data', push); child.stderr?.on('data', push);
      const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} push('超过 30 分钟，已停止。'); }, 30 * 60 * 1000);
      timer.unref?.();
      const finish = ok => { clearTimeout(timer); job.state = 'done'; job.ok = ok; job.finishedAt = Date.now(); this.emit(id, {state: 'done', ok, action}); resolve(); };
      child.on('error', error => { push(String(error.message || error)); finish(false); });
      child.on('close', code => finish(code === 0));
    }));
    return {id, state: job.state, action};
  }
  install(id) {
    const entry = this.entry(id);
    if (!entry) throw new Error('目录里没有这个扩展。');
    return this.run(id, 'install', this.command(entry, 'install'));
  }
  uninstall(id) {
    const entry = this.entry(id);
    if (!entry) throw new Error('目录里没有这个扩展。');
    if (entry.install.via === 'system') throw new Error('系统自带的组件不能在这里卸载。');
    return this.run(id, 'uninstall', this.command(entry, 'uninstall'));
  }
  brewInstall(name, action = 'install') {
    const id = 'brew:' + name;
    return this.run(id, action, this.brewCommand(name, action));
  }
  async brewSearch(query) {
    const brew = brewBin();
    const q = String(query || '').trim();
    if (!brew || !q) return {results: []};
    if (!/^[\w@+.\- ]{1,60}$/.test(q)) throw new Error('搜索词只能是字母、数字和 @+.-');
    const run = args => new Promise(resolve => execFile(brew, args, {timeout: 30000, maxBuffer: 8 * 1024 * 1024, env: {...process.env, PATH: toolPath(), HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1', NO_COLOR: '1'}}, (error, stdout) => resolve(String(stdout || ''))));
    const names = (await run(['search', '--formula', q])).split('\n').map(s => s.trim()).filter(s => BREW_NAME.test(s)).slice(0, 30);
    if (!names.length) return {results: []};
    let info = [];
    try { info = JSON.parse(await run(['info', '--json=v2', ...names])).formulae || []; } catch {}
    const byName = new Map(info.map(f => [f.name, f]));
    return {results: names.map(name => { const f = byName.get(name) || {}; return {name, desc: f.desc || '', version: f.versions?.stable || '', homepage: f.homepage || '', license: f.license || '', installed: Boolean(f.installed?.length), job: this.jobs.get('brew:' + name)?.state}; })};
  }
}

/* ───────── 格式化 ───────── */
// 语言 → 按顺序尝试的格式化器；输入走 stdin，输出就是格式化后的全文
const FORMATTERS = {
  python: [['ruff', file => ['format', '--stdin-filename', file, '-']]],
  javascript: [['prettier', file => ['--stdin-filepath', file]]], typescript: [['prettier', file => ['--stdin-filepath', file]]],
  css: [['prettier', file => ['--stdin-filepath', file]]], scss: [['prettier', file => ['--stdin-filepath', file]]], less: [['prettier', file => ['--stdin-filepath', file]]],
  html: [['prettier', file => ['--stdin-filepath', file]]], json: [['prettier', file => ['--stdin-filepath', file]]], markdown: [['prettier', file => ['--stdin-filepath', file]]],
  yaml: [['prettier', file => ['--stdin-filepath', file]]], graphql: [['prettier', file => ['--stdin-filepath', file]]],
  go: [['gofmt', () => []]], rust: [['rustfmt', () => ['--emit', 'stdout', '--edition', '2021']]],
  c: [['clang-format', file => ['--assume-filename=' + file]]], cpp: [['clang-format', file => ['--assume-filename=' + file]]], 'objective-c': [['clang-format', file => ['--assume-filename=' + file]]], java: [['clang-format', file => ['--assume-filename=' + file]]],
  swift: [['swift-format', () => ['format']]], shell: [['shfmt', () => ['-i', '2']]], lua: [['stylua', () => ['-']]], ini: [['taplo', () => ['fmt', '-']]], toml: [['taplo', () => ['fmt', '-']]],
};
export function formatters() {
  const out = {};
  for (const [lang, list] of Object.entries(FORMATTERS)) { const hit = list.find(([bin]) => which(bin)); if (hit) out[lang] = hit[0]; }
  return out;
}
export function formatText({language, content, filePath, cwd}) {
  const list = FORMATTERS[language] || [];
  const hit = list.find(([bin]) => which(bin));
  if (!hit) return Promise.resolve({unavailable: true});
  const [bin, argsFor] = hit;
  if (bin === 'taplo' && !/\.toml$/i.test(filePath)) return Promise.resolve({unavailable: true});
  return new Promise((resolve, reject) => {
    const child = execFile(which(bin), argsFor(filePath), {cwd, timeout: 20000, maxBuffer: 16 * 1024 * 1024, env: {...process.env, PATH: toolPath(), HOME, NO_COLOR: '1'}}, (error, stdout, stderr) => {
      if (error) reject(new Error(bin + ' 格式化失败：' + String(stderr || error.message).split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 300)));
      else resolve({text: String(stdout), formatter: bin});
    });
    child.stdin.end(content);
  });
}
