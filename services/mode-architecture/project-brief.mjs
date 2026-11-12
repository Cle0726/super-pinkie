// 项目速览：会话绑定了项目文件夹时，替模型把这个项目的事实先查好——是什么技术、
// 真实的启动 / 测试 / 检查命令、目录长什么样、有没有项目自己的规矩。
//
// 为什么要有：小模型在代码库里最常见的错不是不会写，而是猜——猜有 `npm test`、猜入口在 src/、
// 猜没有别人的改动。猜错一次，后面每一步都建在错的地基上。这些事实读几个文件就能确定，
// 引擎读一次（按文件修改时间缓存），模型就不用花三五轮工具调用，也没有机会编。
//
// 只读、只看文件系统，不运行项目里的任何东西。每一步出错就少写一行，不能拖垮这一轮。
// 读不出来的写「没找到」，不编。
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILE = 256 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.idea', '.vscode', '.gradle', 'Pods', 'DerivedData', 'coverage', '.cache', '.turbo', 'vendor', '.tools']);
const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', '.cursorrules', 'GEMINI.md'];
const README_FILES = ['README.md', 'README.zh-CN.md', 'README_CN.md', 'README.txt', 'README', 'readme.md'];

const readSmall = (file) => {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
};
const exists = (file) => { try { return fs.existsSync(file); } catch { return false; } };
const mtime = (file) => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };
const clip = (text, max) => { const flat = String(text).replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };

function listDir(dir) {
  try { return fs.readdirSync(dir, {withFileTypes: true}); } catch { return []; }
}

// 用哪个包管理器：看锁文件，不混用。
function nodeRunner(root) {
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (exists(path.join(root, 'bun.lockb')) || exists(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

function nodeFacts(root) {
  const raw = readSmall(path.join(root, 'package.json'));
  if (!raw) return null;
  let pkg;
  try { pkg = JSON.parse(raw); } catch { return {stack: 'Node.js（package.json 解析不了，先看看它是不是写坏了）', commands: []}; }
  const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
  const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
  const flavors = [];
  if (has('next')) flavors.push('Next.js'); else if (has('react')) flavors.push('React');
  if (has('nuxt')) flavors.push('Nuxt'); else if (has('vue')) flavors.push('Vue');
  if (has('svelte')) flavors.push('Svelte');
  if (has('vite')) flavors.push('Vite');
  if (has('electron')) flavors.push('Electron');
  if (has('express') || has('koa') || has('fastify') || has('hono')) flavors.push('后端服务');
  if (has('typescript') || exists(path.join(root, 'tsconfig.json'))) flavors.push('TypeScript');
  const runner = nodeRunner(root);
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const run = (name) => (runner === 'npm' ? (name === 'test' || name === 'start' ? `npm ${name}` : `npm run ${name}`) : `${runner} ${name === 'test' || name === 'start' ? name : `run ${name}`}`);
  const commands = [`装依赖：${runner} install`];
  const pick = (label, names) => { const found = names.find(name => typeof scripts[name] === 'string'); if (found) commands.push(`${label}：${run(found)}（= ${clip(scripts[found], 60)}）`); return found; };
  if (!pick('启动', ['dev', 'start', 'serve'])) commands.push('启动：scripts 里没有 dev / start，先看 README');
  // npm init 默认生成的 test 脚本只会报错退出，不能当成有测试。
  const realTest = typeof scripts.test === 'string' && !/no test specified/i.test(scripts.test);
  if (realTest) commands.push(`测试：${run('test')}（= ${clip(scripts.test, 60)}）`);
  else commands.push('测试：scripts 里没有可用的 test 命令，不要直接跑 npm test');
  pick('检查', ['lint', 'typecheck', 'type-check', 'check']);
  pick('构建', ['build']);
  const others = Object.keys(scripts).filter(name => !['dev', 'start', 'serve', 'test', 'lint', 'typecheck', 'type-check', 'check', 'build'].includes(name)).slice(0, 8);
  if (others.length) commands.push(`其他脚本：${others.join('、')}`);
  const moduleType = pkg.type === 'module' ? '，ES 模块（import）' : '';
  return {stack: `Node.js${flavors.length ? `（${flavors.join('、')}）` : ''}，包管理器 ${runner}${moduleType}`, source: 'package.json', commands};
}

function pythonFacts(root) {
  const pyproject = readSmall(path.join(root, 'pyproject.toml'));
  const requirements = exists(path.join(root, 'requirements.txt'));
  const hasPy = pyproject || requirements || exists(path.join(root, 'setup.py')) || listDir(root).some(entry => entry.isFile() && entry.name.endsWith('.py'));
  if (!hasPy) return null;
  const text = `${pyproject}\n${readSmall(path.join(root, 'requirements.txt'))}`.toLowerCase();
  const flavors = [];
  for (const [name, label] of [['django', 'Django'], ['fastapi', 'FastAPI'], ['flask', 'Flask'], ['streamlit', 'Streamlit'], ['pandas', 'pandas']]) if (text.includes(name)) flavors.push(label);
  const venv = ['.venv', 'venv'].find(name => exists(path.join(root, name)));
  const uv = exists(path.join(root, 'uv.lock'));
  const poetry = /\[tool\.poetry\]/.test(pyproject) || exists(path.join(root, 'poetry.lock'));
  const commands = [];
  if (venv) commands.push(`已有虚拟环境 ${venv}/：用里面的 python（Mac ${venv}/bin/python，Windows ${venv}\\Scripts\\python.exe），不往系统 Python 里装`);
  else commands.push('还没有虚拟环境：先建一个（python3 -m venv .venv，Windows 用 py -3），依赖装进去');
  if (uv) commands.push('装依赖：uv sync');
  else if (poetry) commands.push('装依赖：poetry install');
  else if (requirements) commands.push('装依赖：python -m pip install -r requirements.txt');
  else if (pyproject) commands.push('装依赖：python -m pip install -e .');
  const usesPytest = /pytest/.test(text) || exists(path.join(root, 'pytest.ini')) || exists(path.join(root, 'conftest.py'));
  const testDir = ['tests', 'test'].find(name => exists(path.join(root, name)));
  if (usesPytest) commands.push('测试：python -m pytest -q');
  else if (testDir) commands.push(`测试：有 ${testDir}/ 目录，没看到 pytest；先试 python -m unittest discover -v`);
  else commands.push('测试：没找到测试目录');
  if (/ruff/.test(text)) commands.push('检查：ruff check .');
  if (exists(path.join(root, 'manage.py'))) commands.push('启动：python manage.py runserver');
  return {stack: `Python${flavors.length ? `（${flavors.join('、')}）` : ''}`, source: pyproject ? 'pyproject.toml' : requirements ? 'requirements.txt' : '.py 文件', commands};
}

function otherFacts(root) {
  const table = [
    ['Cargo.toml', 'Rust', ['构建：cargo build', '测试：cargo test', '检查：cargo clippy']],
    ['go.mod', 'Go', ['构建：go build ./...', '测试：go test ./...', '检查：go vet ./...']],
    ['pom.xml', 'Java（Maven）', ['构建和测试：mvn test']],
    ['build.gradle', 'Java / Kotlin（Gradle）', ['构建和测试：./gradlew test（Windows gradlew.bat test）']],
    ['build.gradle.kts', 'Kotlin（Gradle）', ['构建和测试：./gradlew test（Windows gradlew.bat test）']],
    ['pubspec.yaml', 'Flutter / Dart', ['装依赖：flutter pub get', '测试：flutter test']],
    ['Gemfile', 'Ruby', ['装依赖：bundle install']],
    ['composer.json', 'PHP', ['装依赖：composer install']],
    ['project.config.json', '微信小程序', ['用微信开发者工具打开这个文件夹']],
  ];
  const found = table.find(([file]) => exists(path.join(root, file)));
  if (found) return {stack: found[1], source: found[0], commands: found[2]};
  const entries = listDir(root);
  if (entries.some(entry => entry.isFile() && /\.(?:sln|csproj)$/i.test(entry.name))) return {stack: 'C# / .NET', source: '.sln / .csproj', commands: ['构建：dotnet build', '测试：dotnet test']};
  if (entries.some(entry => entry.isFile() && /\.html?$/i.test(entry.name))) return {stack: '纯网页（HTML / CSS / JS，没有包清单）', source: '.html 文件', commands: ['打开：双击 .html；用了 fetch 或 ES 模块就起本地服务器（python3 -m http.server，Windows py -3 -m http.server）']};
  return null;
}

function makeTargets(root) {
  const text = readSmall(path.join(root, 'Makefile'));
  if (!text) return '';
  const targets = [...text.matchAll(/^([A-Za-z][\w.-]*)\s*:(?!=)/gm)].map(match => match[1]).filter(name => name !== 'PHONY');
  return [...new Set(targets)].slice(0, 8).join('、');
}

function tree(root) {
  const top = listDir(root).filter(entry => !entry.name.startsWith('.') || ['.github', '.env.example'].includes(entry.name));
  const dirs = top.filter(entry => entry.isDirectory() && !SKIP_DIRS.has(entry.name)).map(entry => entry.name).sort();
  const files = top.filter(entry => entry.isFile()).map(entry => entry.name).sort();
  const lines = [];
  for (const dir of dirs.slice(0, 14)) {
    const inner = listDir(path.join(root, dir)).filter(entry => !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name));
    const names = inner.slice(0, 6).map(entry => entry.isDirectory() ? `${entry.name}/` : entry.name);
    lines.push(`${dir}/${names.length ? `：${names.join('、')}${inner.length > names.length ? ` …共 ${inner.length} 项` : ''}` : '（空）'}`);
  }
  if (dirs.length > 14) lines.push(`…另有 ${dirs.length - 14} 个文件夹`);
  if (files.length) lines.push(`顶层文件：${files.slice(0, 14).join('、')}${files.length > 14 ? ` …共 ${files.length} 个` : ''}`);
  const skipped = top.filter(entry => entry.isDirectory() && SKIP_DIRS.has(entry.name)).map(entry => entry.name);
  if (skipped.length) lines.push(`不用看的：${skipped.join('、')}（依赖或生成出来的）`);
  return lines;
}

// 只读 .git 里的文件，不启动 git 进程（Windows 上可能没装 git，启动进程也慢）。
function gitFacts(root) {
  const gitPath = path.join(root, '.git');
  if (!exists(gitPath)) return '没有 git：大改之前先复制一份备份，或者 git init';
  let head = readSmall(path.join(gitPath, 'HEAD')).trim();
  if (!head) {
    // 工作树和子模块的 .git 是一个指向真实目录的文件
    const pointer = /^gitdir:\s*(.+)$/m.exec(readSmall(gitPath))?.[1]?.trim();
    if (pointer) head = readSmall(path.join(path.resolve(root, pointer), 'HEAD')).trim();
  }
  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  return `有 git${branch ? `，当前分支 ${branch}` : head ? '（没有停在分支上）' : ''}：动手前先 git status 看有没有别人没提交的改动，那些不碰`;
}

function signature(root) {
  const watched = ['package.json', 'pyproject.toml', 'requirements.txt', 'Makefile', 'Cargo.toml', 'go.mod', '.git/HEAD', ...RULE_FILES, ...README_FILES];
  return [mtime(root), ...watched.map(name => mtime(path.join(root, name)))].join(':');
}

const cache = new Map();
const MAX_CACHE = 60;

// 返回几行文字；root 不是文件夹、或者是空文件夹时返回空串。
export function projectBrief(root, {maxChars = 1400} = {}) {
  if (!root || typeof root !== 'string') return '';
  let stat;
  try { stat = fs.statSync(root); } catch { return ''; }
  if (!stat.isDirectory()) return '';
  const key = signature(root);
  const cached = cache.get(root);
  if (cached?.key === key) return cached.text;
  let text = '';
  try {
    const top = listDir(root);
    if (top.length) {
      const facts = [nodeFacts(root), pythonFacts(root), otherFacts(root)].filter(Boolean);
      // 同一个文件夹既有 package.json 又有 .html 时，纯网页那条是多余的。
      const stacks = facts.filter((fact, index) => !(index > 0 && /^纯网页/.test(fact.stack) && facts.length > 1));
      const lines = [`【项目速览】${root}（系统读文件得到的事实；命令照这里写的用，这里写「没有」的不要自己编一条）`];
      if (stacks.length) for (const fact of stacks) lines.push(`- 技术：${fact.stack}（依据 ${fact.source}）`);
      else lines.push('- 技术：没认出来（没有常见的包清单）；先读 README 和入口文件');
      for (const fact of stacks) for (const command of fact.commands) lines.push(`- ${command}`);
      const targets = makeTargets(root);
      if (targets) lines.push(`- Makefile 里有：${targets}（用 make 名字）`);
      const rules = RULE_FILES.filter(name => exists(path.join(root, name)));
      if (rules.length) lines.push(`- 项目自己的规矩：${rules.join('、')}——动手前先读，它的要求优先于通用做法`);
      const readme = README_FILES.find(name => exists(path.join(root, name)));
      lines.push(readme ? `- 说明文件：${readme}` : '- 没有 README');
      lines.push(`- ${gitFacts(root)}`);
      const layout = tree(root);
      if (layout.length) { lines.push('- 目录：'); for (const line of layout) lines.push(`  ${line}`); }
      text = lines.join('\n');
      if (text.length > maxChars) text = `${text.slice(0, maxChars - 20)}\n  …（目录太长，省略）`;
    }
  } catch { text = ''; }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(root, {key, text});
  return text;
}

// 会话绑定的项目文件夹（pinkie-project-scope 写的 bindings.json）；没有绑定返回空串。
export function boundProjectRoot(sessionKey = '', {stateRoot = process.env.PINKIE_STATE_ROOT || '', bindingsFile = ''} = {}) {
  const file = bindingsFile || (stateRoot ? path.join(stateRoot, 'project-scope', 'bindings.json') : '');
  if (!file || !sessionKey) return '';
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))?.[sessionKey]?.root;
    return typeof stored === 'string' && stored && fs.statSync(stored).isDirectory() ? stored : '';
  } catch { return ''; }
}

const briefedBySession = new Map();

export function forgetBrief(sessionKey = '') {
  if (sessionKey) briefedBySession.delete(sessionKey);
  else briefedBySession.clear();
}

// 同一个会话里，项目没变就只给一次完整速览；项目的包清单、README、分支变了就重新给。
export function projectBriefBlock(sessionKey = '', options = {}) {
  const root = options.root || boundProjectRoot(sessionKey, options);
  if (!root) return '';
  const text = projectBrief(root, options);
  if (!text) return '';
  if (sessionKey) {
    if (briefedBySession.get(sessionKey) === text) return '';
    if (briefedBySession.size >= 400) briefedBySession.delete(briefedBySession.keys().next().value);
    briefedBySession.set(sessionKey, text);
  }
  return text;
}
