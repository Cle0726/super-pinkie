#!/usr/bin/env node
// 工具箱：碧琪干活要用的能力，一条命令查清、缺的装好、装完真的试一次。
// 用碧琪自带的 node 跑，Mac / Windows 一样：
//   node toolbox.mjs check [能力…]     只查不装
//   node toolbox.mjs ensure 能力…      缺的装进用户空间，装完用一个最小的真实样例验证
//   node toolbox.mjs list              有哪些能力
// 能力：python screenshot video docs office-view fonts-cjk git
// 每个能力输出一行 JSON（ok、path、version、how、note），最后一行是能直接转给用户的大白话。
// 规矩：不用管理员密码、不改系统 PATH、不动系统自带的 Python；国内镜像排在前面；装不上就如实说卡在哪。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const HOME = os.homedir();
const STATE = process.env.OPENCLAW_STATE_DIR ? path.resolve(process.env.OPENCLAW_STATE_DIR) : path.join(HOME, '.openclaw');
const BOX = process.env.PINKIE_TOOLBOX_DIR ? path.resolve(process.env.PINKIE_TOOLBOX_DIR) : path.join(STATE, 'pinkie', 'toolbox');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIP_MIRRORS = ['https://pypi.tuna.tsinghua.edu.cn/simple', 'https://mirrors.aliyun.com/pypi/simple/', ''];
const DOC_PACKAGES = {pptx: 'python-pptx', docx: 'python-docx', openpyxl: 'openpyxl', pypdf: 'pypdf', PIL: 'Pillow'};

function run(file, args = [], options = {}) {
  const result = spawnSync(file, args, {encoding: 'utf8', timeout: options.timeout || 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...(options.env || {})}, cwd: options.cwd});
  return {ok: !result.error && result.status === 0, out: String(result.stdout || '').trim(), err: String(result.stderr || result.error?.message || '').trim()};
}
const exists = file => { try { return Boolean(file) && fs.existsSync(file); } catch { return false; } };
const firstLine = text => String(text || '').split(/\r?\n/).find(Boolean) || '';

// 在 PATH 里找命令，返回完整路径（Windows 上优先 .exe，避开微软商店的假 python）。
export function which(name) {
  const found = run(WIN ? 'where.exe' : '/usr/bin/which', [name], {timeout: 10_000});
  if (!found.ok) return '';
  const lines = found.out.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.find(line => !/WindowsApps/i.test(line)) || '';
}

// ---- python：碧琪的专用环境 → 工具箱自己的环境 → 系统里的 ----
function pythonCandidates() {
  const bin = dir => WIN ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python');
  return [process.env.PINKIE_AGENT_PYTHON, bin(path.join(STATE, 'agent-env')), bin(path.join(BOX, 'venv')),
    which('python3'), which('python')].filter(Boolean);
}
function pythonInfo(file) {
  if (!exists(file)) return null;
  const probe = run(file, ['-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3]);print(sys.prefix!=sys.base_prefix)'], {timeout: 20_000});
  if (!probe.ok) return null;
  const [version, venv] = probe.out.split(/\r?\n/);
  const [major, minor] = version.split('.').map(Number);
  return major === 3 && minor >= 9 ? {path: file, version, venv: venv === 'True'} : null;
}
function findPython({needVenv = false} = {}) {
  for (const file of pythonCandidates()) {
    const info = pythonInfo(file);
    if (info && (!needVenv || info.venv)) return info;
  }
  if (WIN) {
    const py = run('py', ['-3', '-c', 'import sys;print(sys.executable)'], {timeout: 20_000});
    const info = py.ok ? pythonInfo(firstLine(py.out)) : null;
    if (info && (!needVenv || info.venv)) return info;
  }
  return null;
}
function ensurePython() {
  let info = findPython({needVenv: true});
  if (info) return {ok: true, ...info, how: 'found'};
  let base = findPython();
  const steps = [];
  if (!base) {
    if (which('uv')) steps.push(['uv python install 3.12', run('uv', ['python', 'install', '3.12'], {timeout: 900_000})]);
    else if (WIN && which('winget')) {
      steps.push(['winget Python 3.12（装在用户目录）', run('winget', ['install', '-e', '--id', 'Python.Python.3.12', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], {timeout: 900_000})]);
      const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe');
      if (exists(local)) base = pythonInfo(local);
    } else if (MAC && which('brew')) steps.push(['brew install python@3.12', run('brew', ['install', 'python@3.12'], {timeout: 900_000})]);
    base = base || findPython();
    if (!base && which('uv')) {
      const made = run('uv', ['venv', '--python', '3.12', path.join(BOX, 'venv')], {timeout: 300_000});
      steps.push(['uv venv', made]);
    }
  }
  if (base && !findPython({needVenv: true})) {
    fs.mkdirSync(BOX, {recursive: true});
    steps.push(['建工具箱自己的环境', run(base.path, ['-m', 'venv', path.join(BOX, 'venv')], {timeout: 300_000})]);
  }
  info = findPython({needVenv: true});
  if (info) { ledger(path.join(BOX, 'venv'), '碧琪工具箱的 Python 环境'); return {ok: true, ...info, how: 'installed'}; }
  return {ok: false, how: 'failed', note: lastError(steps) || (WIN ? '没有 Python，winget 也用不了。请到 python.org 下载安装包，安装时勾上「Add python.exe to PATH」' : '没有 Python，也没有 uv 或 Homebrew 可以装它')};
}
function lastError(steps) {
  const failed = steps.filter(([, result]) => result && !result.ok).at(-1);
  return failed ? `${failed[0]} 没成功：${firstLine(failed[1].err || failed[1].out).slice(0, 200)}` : '';
}

// pip 装包：只装进虚拟环境；镜像一个个试，一个源 4 分钟没装完就换。
function pipInstall(python, packages) {
  let last = null;
  for (const mirror of PIP_MIRRORS) {
    last = run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...(mirror ? ['-i', mirror] : []), ...packages], {timeout: 240_000});
    if (last.ok) return {ok: true};
  }
  return {ok: false, note: firstLine(last?.err || last?.out).slice(0, 200)};
}
const canImport = (python, modules) => run(python, ['-c', modules.map(name => `import ${name}`).join(';')], {timeout: 60_000}).ok;

// ---- screenshot：playwright + 本机的 Chrome / Edge，都没有才下载浏览器内核 ----
const SHOT_PROBE = `
import sys, pathlib
from playwright.sync_api import sync_playwright
out = pathlib.Path(sys.argv[1])
with sync_playwright() as p:
    for channel in ("chrome", "msedge", None):
        try:
            browser = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        except Exception:
            continue
        page = browser.new_page(viewport={"width": 800, "height": 500})
        page.set_content("<body style='margin:0;background:#f7c9d9;font:48px sans-serif'><h1 style='padding:80px'>\\u78a7\\u742a toolbox</h1></body>")
        page.screenshot(path=str(out))
        browser.close()
        print(channel or "chromium")
        sys.exit(0)
sys.exit(3)
`;
function screenshotProbe(python) {
  const out = path.join(os.tmpdir(), `pinkie-toolbox-shot-${process.pid}.png`);
  const probe = run(python, ['-c', SHOT_PROBE, out], {timeout: 90_000});
  let size = 0;
  try { size = fs.statSync(out).size; fs.unlinkSync(out); } catch {}
  return probe.ok && size > 1500 ? {ok: true, browser: firstLine(probe.out)} : {ok: false, note: firstLine(probe.err).slice(0, 200)};
}
function checkScreenshot() {
  const python = findPython({needVenv: true}) || findPython();
  if (!python) return {ok: false, note: '没有 Python'};
  if (!canImport(python.path, ['playwright'])) return {ok: false, note: '没有 playwright'};
  const probe = screenshotProbe(python.path);
  return probe.ok ? {ok: true, path: python.path, version: probe.browser, how: 'found'} : {ok: false, note: probe.note || '没有能启动的浏览器'};
}
function ensureScreenshot() {
  const found = checkScreenshot();
  if (found.ok) return found;
  const python = ensurePython();
  if (!python.ok) return python;
  if (!canImport(python.path, ['playwright'])) {
    const installed = pipInstall(python.path, ['playwright']);
    if (!installed.ok) return {ok: false, how: 'failed', note: `playwright 装不上：${installed.note}`};
  }
  let probe = screenshotProbe(python.path);
  if (!probe.ok) {
    for (const host of ['https://npmmirror.com/mirrors/playwright', '']) {
      run(python.path, ['-m', 'playwright', 'install', 'chromium'], {timeout: 900_000, env: host ? {PLAYWRIGHT_DOWNLOAD_HOST: host} : {}});
      probe = screenshotProbe(python.path);
      if (probe.ok) { ledger(MAC ? path.join(HOME, 'Library/Caches/ms-playwright') : WIN ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright') : path.join(HOME, '.cache/ms-playwright'), '截图用的浏览器内核'); break; }
    }
  }
  return probe.ok ? {ok: true, path: python.path, version: probe.browser, how: 'installed'} : {ok: false, how: 'failed', note: `浏览器启动不了：${probe.note || '本机没有 Chrome / Edge，内核也没下载下来'}`};
}

// ---- video：ffmpeg ----
function findFfmpeg() {
  const candidates = [which('ffmpeg')];
  if (WIN) {
    const local = process.env.LOCALAPPDATA || '';
    candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
    try {
      const packages = path.join(local, 'Microsoft', 'WinGet', 'Packages');
      for (const name of fs.readdirSync(packages).filter(item => /ffmpeg/i.test(item))) {
        const stack = [path.join(packages, name)];
        while (stack.length) {
          const dir = stack.pop();
          for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
            else if (entry.name.toLowerCase() === 'ffmpeg.exe') candidates.push(path.join(dir, entry.name));
          }
        }
      }
    } catch {}
  }
  if (MAC) candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  const python = findPython({needVenv: true}) || findPython();
  if (python && canImport(python.path, ['imageio_ffmpeg'])) {
    const bundled = run(python.path, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], {timeout: 30_000});
    if (bundled.ok) candidates.push(firstLine(bundled.out));
  }
  return candidates.find(exists) || '';
}
function videoProbe(ffmpeg) {
  const out = path.join(os.tmpdir(), `pinkie-toolbox-video-${process.pid}.mp4`);
  const made = run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-pix_fmt', 'yuv420p', out], {timeout: 60_000});
  let size = 0;
  try { size = fs.statSync(out).size; fs.unlinkSync(out); } catch {}
  return made.ok && size > 500;
}
function checkVideo() {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return {ok: false, note: '没有 ffmpeg'};
  if (!videoProbe(ffmpeg)) return {ok: false, path: ffmpeg, note: 'ffmpeg 在，但合成 1 秒测试视频失败'};
  const probe = [which('ffprobe'), path.join(path.dirname(ffmpeg), WIN ? 'ffprobe.exe' : 'ffprobe')].find(exists) || '';
  return {ok: true, path: ffmpeg, version: firstLine(run(ffmpeg, ['-version'], {timeout: 15_000}).out).slice(0, 60), how: 'found',
    ...(probe ? {} : {note: '没有 ffprobe：看时长和分辨率用 ffmpeg -i 文件 读输出'})};
}
function ensureVideo() {
  const found = checkVideo();
  if (found.ok) return found;
  if (MAC && which('brew')) run('brew', ['install', 'ffmpeg'], {timeout: 1_200_000});
  if (WIN && which('winget')) run('winget', ['install', '-e', '--id', 'Gyan.FFmpeg', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], {timeout: 1_200_000});
  let next = checkVideo();
  if (next.ok) return {...next, how: 'installed'};
  // 兜底：pip 包里自带一个免安装的 ffmpeg，走国内镜像也能下。
  const python = ensurePython();
  if (python.ok && pipInstall(python.path, ['imageio-ffmpeg']).ok) {
    next = checkVideo();
    if (next.ok) return {...next, how: 'installed'};
  }
  return {ok: false, how: 'failed', note: next.note || 'ffmpeg 装不上'};
}

// ---- docs：读写 PPT / Word / Excel / PDF、处理图片的 Python 包 ----
function checkDocs() {
  const python = findPython({needVenv: true}) || findPython();
  if (!python) return {ok: false, note: '没有 Python'};
  const missing = Object.entries(DOC_PACKAGES).filter(([module]) => !canImport(python.path, [module])).map(([, name]) => name);
  return missing.length ? {ok: false, path: python.path, note: `缺：${missing.join('、')}`} : {ok: true, path: python.path, how: 'found'};
}
function ensureDocs() {
  const found = checkDocs();
  if (found.ok) return found;
  const python = ensurePython();
  if (!python.ok) return python;
  const missing = Object.entries(DOC_PACKAGES).filter(([module]) => !canImport(python.path, [module])).map(([, name]) => name);
  const installed = missing.length ? pipInstall(python.path, missing) : {ok: true};
  const next = checkDocs();
  return next.ok ? {...next, how: 'installed'} : {ok: false, how: 'failed', note: installed.note || next.note};
}

// ---- office-view：把 PPT / Word / Excel 转成 PDF 或图片来看（LibreOffice） ----
function findSoffice() {
  const candidates = [which('soffice')];
  if (MAC) candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice', path.join(HOME, 'Applications/LibreOffice.app/Contents/MacOS/soffice'));
  if (WIN) for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (root) candidates.push(path.join(root, 'LibreOffice', 'program', 'soffice.exe'));
  }
  return candidates.find(exists) || '';
}
function officeProbe(soffice) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-toolbox-office-'));
  try {
    fs.writeFileSync(path.join(dir, 'probe.txt'), '碧琪 toolbox\n', 'utf8');
    run(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, 'probe.txt')], {timeout: 120_000});
    return exists(path.join(dir, 'probe.pdf'));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
function checkOffice() {
  const soffice = findSoffice();
  if (!soffice) return {ok: false, note: '没有 LibreOffice'};
  return officeProbe(soffice) ? {ok: true, path: soffice, how: 'found'} : {ok: false, path: soffice, note: 'LibreOffice 在，但转 PDF 失败（可能有一个窗口开着，关掉再试）'};
}
function ensureOffice() {
  const found = checkOffice();
  if (found.ok) return found;
  if (MAC && which('brew')) run('brew', ['install', '--cask', 'libreoffice'], {timeout: 1_800_000});
  if (WIN && which('winget')) run('winget', ['install', '-e', '--id', 'TheDocumentFoundation.LibreOffice', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], {timeout: 1_800_000});
  const next = checkOffice();
  if (next.ok) { ledger(MAC ? '/Applications/LibreOffice.app' : path.dirname(path.dirname(next.path)), 'LibreOffice（看 PPT / Word / Excel 成品用）'); return {...next, how: 'installed'}; }
  return {ok: false, how: 'needs-user', note: 'LibreOffice 没装上，多半是需要管理员确认。先用别的办法看成品：PPT 用 python-pptx 读回每页文字和图片，Word 用 python-docx，或者请用户同意安装 LibreOffice'};
}

// ---- fonts-cjk：给视频字幕、图片排字用的中文字体文件 ----
function checkFonts() {
  const candidates = MAC ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc', '/Library/Fonts/Arial Unicode.ttf']
    : WIN ? ['msyh.ttc', 'msyh.ttf', 'simhei.ttf', 'simsun.ttc', 'Deng.ttf'].map(name => path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', name))
      : ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc'];
  const font = candidates.find(exists);
  return font ? {ok: true, path: font, how: 'found', note: WIN ? 'ffmpeg 烧字幕用 FontName=Microsoft YaHei' : MAC ? 'ffmpeg 烧字幕用 FontName=PingFang SC' : ''}
    : {ok: false, note: '没找到系统自带的中文字体。把一款可商用的中文字体（比如思源黑体）下载到项目里，用完整路径指定'};
}

// ---- git ----
function checkGit() {
  const git = which('git');
  if (!git) return {ok: false, note: '没有 git'};
  const version = run(git, ['--version'], {timeout: 15_000});
  // Mac 上没装命令行工具时 /usr/bin/git 只是个会弹安装窗口的壳。
  return version.ok ? {ok: true, path: git, version: version.out.slice(0, 40), how: 'found'} : {ok: false, note: 'git 是系统的占位程序，还没真正装上'};
}
function ensureGit() {
  const found = checkGit();
  if (found.ok) return found;
  if (WIN && which('winget')) run('winget', ['install', '-e', '--id', 'Git.Git', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], {timeout: 900_000});
  if (MAC && which('brew')) run('brew', ['install', 'git'], {timeout: 900_000});
  const next = checkGit();
  if (next.ok) return {...next, how: 'installed'};
  if (WIN) {
    const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe');
    if (exists(local)) return {ok: true, path: local, how: 'installed', note: '当前终端还找不到 git，用这个完整路径调用'};
  }
  return {ok: false, how: 'needs-user', note: MAC ? '装 git 要用户在弹出的「安装命令行开发者工具」窗口里点安装。没有 git 也能干活：大改之前把文件夹复制一份当备份' : '没有 git 也能干活：大改之前把文件夹复制一份当备份'};
}

// 装下来占地方的东西登记进下载账本（同目录的 downloads.mjs），作品交付后再问用户要不要删。
function ledger(target, what) {
  const script = path.join(HERE, 'downloads.mjs');
  if (!exists(script) || !exists(target)) return;
  run(process.execPath, [script, 'add', '--path', target, '--what', what, '--for', '工具箱'], {timeout: 30_000});
}

export const CAPABILITIES = {
  python: {what: 'Python 3.9 以上 + 一个独立环境（装包不碰系统）', check: () => { const info = findPython({needVenv: true}); return info ? {ok: true, ...info, how: 'found'} : {ok: false, note: findPython() ? '有 Python，但还没有独立环境' : '没有 Python'}; }, ensure: ensurePython},
  screenshot: {what: '无界面浏览器：打开网页、截图、点一遍', check: checkScreenshot, ensure: ensureScreenshot},
  video: {what: 'ffmpeg：剪辑、合成、抽帧、烧字幕', check: checkVideo, ensure: ensureVideo},
  docs: {what: '读写 PPT / Word / Excel / PDF、处理图片的 Python 包', check: checkDocs, ensure: ensureDocs},
  'office-view': {what: '把 PPT / Word / Excel 转成 PDF 或图片来亲眼看', check: checkOffice, ensure: ensureOffice},
  'fonts-cjk': {what: '中文字体文件（字幕、图片排字不出方框）', check: checkFonts, ensure: checkFonts},
  git: {what: '版本管理：改坏了能退回', check: checkGit, ensure: ensureGit},
};

export function summarize(results) {
  const bad = results.filter(item => !item.ok);
  if (!bad.length) return `都准备好了：${results.map(item => item.capability).join('、')}。`;
  const good = results.filter(item => item.ok).map(item => item.capability);
  return `${good.length ? `已经能用：${good.join('、')}。` : ''}还不行：${bad.map(item => `${item.capability}（${item.note || '原因不明'}）`).join('；')}。`;
}

function main(argv) {
  const [command = 'check', ...names] = argv;
  if (command === 'list') {
    for (const [name, capability] of Object.entries(CAPABILITIES)) console.log(`${name}\t${capability.what}`);
    return 0;
  }
  if (!['check', 'ensure'].includes(command)) { console.error('用法：node toolbox.mjs check|ensure|list [能力…]'); return 2; }
  const unknown = names.filter(name => !CAPABILITIES[name]);
  if (unknown.length) { console.error(`没有这个能力：${unknown.join('、')}。可用的：${Object.keys(CAPABILITIES).join(' ')}`); return 2; }
  if (command === 'ensure' && !names.length) { console.error('ensure 要写明能力，比如：node toolbox.mjs ensure screenshot video'); return 2; }
  const targets = names.length ? names : Object.keys(CAPABILITIES);
  const results = [];
  for (const name of targets) {
    let result;
    try { result = CAPABILITIES[name][command](); } catch (error) { result = {ok: false, how: 'failed', note: String(error?.message || error).slice(0, 200)}; }
    const line = {capability: name, platform: process.platform, ...result};
    results.push(line);
    console.log(JSON.stringify(line));
  }
  console.log(summarize(results));
  return results.every(item => item.ok) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
