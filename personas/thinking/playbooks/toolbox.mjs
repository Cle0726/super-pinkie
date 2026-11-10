#!/usr/bin/env node
// 工具箱：碧琪干活要用的能力，一条命令查清、缺的装好、装完真的试一次。
// 用碧琪自带的 node 跑，Mac / Windows 一样：
//   node toolbox.mjs check [能力…]     只查不装
//   node toolbox.mjs ensure 能力…      缺的装进用户空间，装完用一个最小的真实样例验证
//   node toolbox.mjs list              有哪些能力
// 兼容旧能力名 docs；新能力清单见 toolbox-manifest.json。
// 默认每个能力输出一行 JSON；--human 输出方便阅读的结果。
// 规矩：不用管理员密码、不改系统 PATH、不动系统自带的 Python；国内镜像排在前面；装不上就如实说卡在哪。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import crypto from 'node:crypto';

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const userHome = process.env.PINKIE_TOOLBOX_HOME ? path.resolve(process.env.PINKIE_TOOLBOX_HOME) : os.homedir();
const STATE = process.env.OPENCLAW_STATE_DIR ? path.resolve(process.env.OPENCLAW_STATE_DIR) : path.join(userHome, '.openclaw');
const BOX = process.env.PINKIE_TOOLBOX_DIR ? path.resolve(process.env.PINKIE_TOOLBOX_DIR)
  : WIN ? path.join(process.env.LOCALAPPDATA || path.join(userHome, 'AppData', 'Local'), 'Pinkie', 'toolbox')
    : path.join(userHome, '.pinkie', 'toolbox');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OFFLINE = process.env.PINKIE_TOOLBOX_OFFLINE === '1';
const NO_SYSTEM = process.env.PINKIE_TOOLBOX_NO_SYSTEM === '1';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, 'toolbox-manifest.json'), 'utf8'));
const PIP_MIRRORS = MANIFEST.pypiMirrors;
const DOC_PACKAGES = {pptx: 'python-pptx', docx: 'python-docx', openpyxl: 'openpyxl'};

function run(file, args = [], options = {}) {
  const result = spawnSync(file, args, {encoding: 'utf8', timeout: options.timeout || 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONNOUSERSITE: '1', PYTHONPATH: '',
      PIP_CONFIG_FILE: os.devNull, PIP_NO_INPUT: '1', PLAYWRIGHT_BROWSERS_PATH: path.join(BOX, 'browsers'), ...(options.env || {})}, cwd: options.cwd});
  return {ok: !result.error && result.status === 0, out: String(result.stdout || '').trim(), err: String(result.stderr || result.error?.message || '').trim()};
}
const exists = file => { try { return Boolean(file) && fs.existsSync(file); } catch { return false; } };
const firstLine = text => String(text || '').split(/\r?\n/).find(Boolean) || '';

function requireSpace(bytes) {
  const extraReserve = Number(process.env.PINKIE_TOOLBOX_MIN_FREE_BYTES || 0);
  if (Number.isFinite(extraReserve)) bytes = Math.max(bytes, extraReserve);
  let parent = BOX;
  while (!exists(parent)) {
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
  try {
    const stats = fs.statfsSync(parent);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (free >= bytes) return {ok: true, free};
    return {ok: false, how: 'failed', note: `磁盘空间不够，至少需要 ${Math.ceil(bytes / 1024 / 1024)} MB 可用空间。`};
  } catch {
    return {ok: false, how: 'failed', note: '无法确认工具箱目录的可用空间，暂时没有下载。'};
  }
}

function fileIntegrity(file, integrity) {
  const [algorithm, expected] = String(integrity || '').split('-', 2);
  if (!['sha256', 'sha512'].includes(algorithm) || !expected) return false;
  const hash = crypto.createHash(algorithm);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest('base64') === expected;
}

function downloadArtifact(name, urls, integrity, maxBytes) {
  if (OFFLINE) return {ok: false, note: '离线状态，不能下载缺少的工具。'};
  const target = path.join(BOX, 'downloads', path.basename(name));
  if (exists(target)) return fileIntegrity(target, integrity) ? {ok: true, path: target} : {ok: false, note: '已有下载文件的校验不符，未覆盖它。'};
  const helper = path.join(HERE, 'toolbox-download.mjs');
  if (!exists(helper)) return {ok: false, note: '缺少工具箱下载程序。'};
  const downloaded = run(process.execPath, [helper, JSON.stringify({urls, target, integrity, maxBytes})], {timeout: 900_000});
  let result;
  try { result = JSON.parse(downloaded.out); } catch { result = {ok: false, note: firstLine(downloaded.err || downloaded.out) || '下载失败'}; }
  return downloaded.ok && result.ok && exists(target) && fileIntegrity(target, integrity) ? {ok: true, path: target} : {ok: false, note: result.note || '下载校验失败。'};
}

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
  const managed = [];
  for (const root of [path.join(BOX, 'python'), WIN ? path.join(process.env.APPDATA || path.join(userHome, 'AppData', 'Roaming'), 'uv', 'python') : path.join(userHome, '.local', 'share', 'uv', 'python')]) {
    try {
      for (const name of fs.readdirSync(root).filter(item => /^cpython-3\.(?:1[1-9]|[2-9]\d)/.test(item)).sort().reverse()) {
        managed.push(WIN ? path.join(root, name, 'python.exe') : path.join(root, name, 'bin', 'python3'));
      }
    } catch {}
  }
  return [bin(path.join(BOX, 'venv')), process.env.PINKIE_AGENT_PYTHON, bin(path.join(STATE, 'agent-env')),
    ...managed, ...(!NO_SYSTEM ? [which('python3'), which('python')] : [])].filter(Boolean);
}
function pythonInfo(file) {
  if (!exists(file)) return null;
  const probe = run(file, ['-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3]);print(sys.prefix!=sys.base_prefix)'], {timeout: 20_000});
  if (!probe.ok) return null;
  const [version, venv] = probe.out.split(/\r?\n/);
  const [major, minor] = version.split('.').map(Number);
  return major === 3 && minor >= 11 ? {path: file, version, venv: venv === 'True'} : null;
}
function findPython({needVenv = false} = {}) {
  for (const file of pythonCandidates()) {
    const info = pythonInfo(file);
    if (info && (!needVenv || info.venv)) return info;
  }
  if (WIN && !NO_SYSTEM) {
    const py = run('py', ['-3', '-c', 'import sys;print(sys.executable)'], {timeout: 20_000});
    const info = py.ok ? pythonInfo(firstLine(py.out)) : null;
    if (info && (!needVenv || info.venv)) return info;
  }
  return null;
}
function ensurePython() {
  const venv = WIN ? path.join(BOX, 'venv', 'Scripts', 'python.exe') : path.join(BOX, 'venv', 'bin', 'python');
  let info = pythonInfo(venv);
  if (info?.venv) return {ok: true, ...info, how: 'found'};
  const space = requireSpace(600 * 1024 * 1024);
  if (!space.ok) return space;
  let base = findPython();
  const steps = [];
  if (!base) {
    const uv = NO_SYSTEM ? '' : which('uv');
    if (uv && !OFFLINE) {
      fs.mkdirSync(BOX, {recursive: true});
      const uvEnv = {UV_PYTHON_INSTALL_DIR: path.join(BOX, 'python'), UV_CACHE_DIR: path.join(BOX, 'cache', 'uv'), UV_NO_CONFIG: '1',
        UV_PYTHON_INSTALL_MIRROR: undefined, UV_PYTHON_DOWNLOADS_JSON_URL: undefined, UV_INSECURE_HOST: undefined};
      steps.push(['下载独立 Python', run(uv, ['python', 'install', '--no-bin', MANIFEST.pythonVersion], {timeout: 900_000, env: uvEnv})]);
      base = findPython();
    }
  }
  if (base && !info) {
    fs.mkdirSync(BOX, {recursive: true});
    steps.push(['建工具箱自己的环境', run(base.path, ['-m', 'venv', path.join(BOX, 'venv')], {timeout: 300_000})]);
  }
  info = pythonInfo(venv);
  if (info) { ledger(path.join(BOX, 'venv'), '碧琪工具箱的 Python 环境'); return {ok: true, ...info, how: 'installed'}; }
  return {ok: false, how: 'failed', note: lastError(steps) || '没有找到 Python 3.11 以上，也没有可用的 uv；需要先提供碧琪自带的 Python。'};
}
function lastError(steps) {
  const failed = steps.filter(([, result]) => result && !result.ok).at(-1);
  return failed ? `${failed[0]} 没成功：${firstLine(failed[1].err || failed[1].out).slice(0, 200)}` : '';
}

// 所有 Python 包和传递依赖都固定版本和 SHA-256，只安装进工具箱自己的虚拟环境。
function pipInstall(python, group) {
  if (OFFLINE) return {ok: false, note: '当前为离线检查，缺少的依赖不能下载。'};
  const lock = path.join(HERE, `toolbox-lock-${group}.txt`);
  if (!exists(lock)) return {ok: false, note: `缺少 ${group} 的校验清单。`};
  let last = null;
  for (const mirror of PIP_MIRRORS) {
    last = run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir', '--no-input',
      '--timeout', '20', '--retries', '0', '--only-binary', ':all:', '--require-hashes', '--index-url', mirror, '-r', lock], {timeout: 600_000});
    if (last.ok) return {ok: true};
  }
  const detail = `${last?.err || ''}\n${last?.out || ''}`;
  if (/hash(?:es)? (?:do not|mismatch)|THESE PACKAGES DO NOT MATCH|sha256/i.test(detail)) return {ok: false, note: '下载文件校验不一致，已停止安装。'};
  if (/timed? ?out|ReadTimeout|ConnectTimeout|Connection(?:Error|Reset)|SSLError|ProxyError|TLS|temporary failure/i.test(detail)) return {ok: false, note: '下载源连接失败或超时，请检查网络后再试。'};
  if (/No matching distribution|Could not find a version/i.test(detail)) return {ok: false, note: '当前系统没有找到兼容的工具版本。'};
  const useful = detail.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^Traceback|^File |^During handling|^ERROR: Exception:/i.test(line)).at(-1);
  return {ok: false, note: `工具安装失败：${String(useful || '没有取得有效的安装结果').slice(0, 160)}`};
}
const canImport = (python, modules) => run(python, ['-c', modules.map(name => `import ${name}`).join(';')], {timeout: 60_000}).ok;

// ---- screenshot：playwright + 本机的 Chrome / Edge，都没有才下载浏览器内核 ----
const SHOT_PROBE = `
import sys, pathlib
from playwright.sync_api import sync_playwright
from PIL import Image
out = pathlib.Path(sys.argv[1])
with sync_playwright() as p:
    for channel in ((None,) if sys.argv[2] == '1' else ("chrome", "msedge", None)):
        try:
            browser = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
        except Exception:
            continue
        page = browser.new_page(viewport={"width": 800, "height": 500})
        page.set_content("<body style='margin:0;background:#f7c9d9;font:48px sans-serif'><h1 style='padding:80px'>\\u78a7\\u742a toolbox</h1><button id='go' onclick=\\"document.body.dataset.clicked='yes'\\">go</button></body>")
        page.click('#go')
        assert page.get_attribute('body', 'data-clicked') == 'yes'
        page.screenshot(path=str(out))
        browser.close()
        with Image.open(out).convert('RGB') as image:
            if image.size != (800, 500) or all(lo == hi for lo, hi in image.getextrema()):
                sys.exit(4)
        print(channel or "chromium")
        sys.exit(0)
sys.exit(3)
`;
function screenshotProbe(python) {
  const out = path.join(os.tmpdir(), `pinkie-toolbox-shot-${process.pid}.png`);
  const probe = run(python, ['-c', SHOT_PROBE, out, NO_SYSTEM ? '1' : '0'], {timeout: 90_000});
  let size = 0;
  try { size = fs.statSync(out).size; fs.unlinkSync(out); } catch {}
  return probe.ok && size > 1500 ? {ok: true, browser: firstLine(probe.out)} : {ok: false, note: firstLine(probe.err).slice(0, 200)};
}
function installBrowser(python) {
  const key = `${process.platform}-${process.arch}`;
  const artifact = MANIFEST.browserArtifacts?.[key];
  if (!artifact || !artifact.sha256) return {ok: false, note: '没有可校验的浏览器安装包，暂时不能自动下载。'};
  if (OFFLINE) return {ok: false, note: '当前为离线检查，没有可用浏览器内核。'};
  return {ok: false, note: '浏览器安装包尚未接入解压和自检，暂时不能自动安装。'};
}
function checkScreenshot() {
  const python = findPython({needVenv: true}) || findPython();
  if (!python) return {ok: false, note: '没有 Python'};
  if (!canImport(python.path, ['playwright', 'PIL'])) return {ok: false, note: '缺少浏览器控制或图片检查组件'};
  const probe = screenshotProbe(python.path);
  return probe.ok ? {ok: true, path: python.path, version: probe.browser, how: 'found'} : {ok: false, note: probe.note || '没有能启动的浏览器'};
}
function ensureScreenshot() {
  const found = checkScreenshot();
  if (found.ok) return found;
  const python = ensurePython();
  if (!python.ok) return python;
  if (!canImport(python.path, ['playwright', 'PIL'])) {
    const installed = pipInstall(python.path, 'screenshot');
    if (!installed.ok) return {ok: false, how: 'failed', note: `playwright 装不上：${installed.note}`};
  }
  let probe = screenshotProbe(python.path);
  if (!probe.ok) {
    const installed = installBrowser(python.path);
    if (!installed.ok) return {ok: false, how: 'failed', note: installed.note};
    probe = screenshotProbe(python.path);
    if (probe.ok) ledger(path.join(BOX, 'browsers'), '截图用的浏览器内核');
  }
  return probe.ok ? {ok: true, path: python.path, version: probe.browser, how: 'installed'} : {ok: false, how: 'failed', note: `浏览器启动不了：${probe.note || '本机没有 Chrome / Edge，内核也没下载下来'}`};
}

// ---- video：ffmpeg ----
function findFfmpeg() {
  const candidates = NO_SYSTEM ? [] : [which('ffmpeg')];
  if (WIN && !NO_SYSTEM) {
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
  if (MAC && !NO_SYSTEM) candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  const python = findPython({needVenv: true}) || findPython();
  if (python && canImport(python.path, ['imageio_ffmpeg'])) {
    const bundled = run(python.path, ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], {timeout: 30_000});
    if (bundled.ok) candidates.unshift(firstLine(bundled.out));
  }
  return candidates.find(exists) || '';
}
function findFfprobe(ffmpeg = '') {
  return [path.join(BOX, 'bin', WIN ? 'ffprobe.exe' : 'ffprobe'), ...(!NO_SYSTEM ? [which('ffprobe'), ffmpeg && path.join(path.dirname(ffmpeg), WIN ? 'ffprobe.exe' : 'ffprobe')] : [])].find(exists) || '';
}
function installFfprobe(python) {
  const platform = `${process.platform}-${process.arch}`;
  const artifact = MANIFEST.ffprobe[platform];
  if (!artifact) return {ok: false, note: `暂时没有 ${platform} 的可校验 ffprobe。`};
  const relative = `@ffprobe-installer/${platform}/-/${platform}-${artifact.version}.tgz`;
  const urls = [`https://registry.npmmirror.com/${relative}`, `https://registry.yarnpkg.com/${relative}`, `https://registry.npmjs.org/${relative}`];
  const download = downloadArtifact(`ffprobe-${platform}-${artifact.version}.tgz`, urls, artifact.integrity, 160 * 1024 * 1024);
  if (!download.ok) return download;
  const target = path.join(BOX, 'bin', WIN ? 'ffprobe.exe' : 'ffprobe');
  if (exists(target)) return {ok: false, note: '工具箱里的 ffprobe 不可用，未覆盖已有文件。'};
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temp = `${target}.${process.pid}.tmp`;
  const script = `import os,sys,tarfile,shutil\nsource,target,name=sys.argv[1:]\nwith tarfile.open(source,'r:gz') as archive:\n member=archive.getmember('package/'+name)\n assert member.isfile() and 0 < member.size <= 200*1024*1024\n with archive.extractfile(member) as src, open(target,'xb') as out: shutil.copyfileobj(src,out)\nos.chmod(target,0o755)\n`;
  const unpacked = run(python, ['-c', script, download.path, temp, WIN ? 'ffprobe.exe' : 'ffprobe'], {timeout: 120_000});
  if (!unpacked.ok) { try { fs.unlinkSync(temp); } catch {} return {ok: false, note: `ffprobe 解压失败：${firstLine(unpacked.err).slice(0, 100)}`}; }
  try { fs.renameSync(temp, target); } catch (error) { try { fs.unlinkSync(temp); } catch {} return {ok: false, note: String(error.message || error)}; }
  ledger(target, '视频信息检查工具 ffprobe');
  return {ok: true, path: target};
}
function videoProbe(ffmpeg, ffprobe) {
  const out = path.join(os.tmpdir(), `pinkie-toolbox-video-${process.pid}.mp4`);
  const made = run(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', '-pix_fmt', 'yuv420p', out], {timeout: 60_000});
  try {
    if (!made.ok || fs.statSync(out).size <= 500) return false;
    const readback = run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', out], {timeout: 30_000});
    const seconds = Number(readback.out);
    return readback.ok && seconds >= 0.8 && seconds <= 1.2;
  } catch { return false; } finally { try { fs.unlinkSync(out); } catch {} }
}
function checkVideo() {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return {ok: false, note: '没有 ffmpeg'};
  const probe = findFfprobe(ffmpeg);
  if (!probe) return {ok: false, path: ffmpeg, note: '找到了 ffmpeg，但缺少 ffprobe，无法验证视频。'};
  if (!videoProbe(ffmpeg, probe)) return {ok: false, path: ffmpeg, note: 'ffmpeg 或 ffprobe 在，但合成并读回 1 秒测试视频失败'};
  return {ok: true, path: ffmpeg, version: firstLine(run(ffmpeg, ['-version'], {timeout: 15_000}).out).slice(0, 60), how: 'found',
    ffprobe: probe};
}
function ensureVideo() {
  const found = checkVideo();
  if (found.ok) return found;
  const python = ensurePython();
  if (!python.ok) return python;
  const currentFfmpeg = findFfmpeg();
  const currentProbe = findFfprobe(currentFfmpeg);
  if (!currentFfmpeg || (currentProbe && !videoProbe(currentFfmpeg, currentProbe))) {
    const installed = pipInstall(python.path, 'video');
    if (!installed.ok) return {ok: false, how: 'failed', note: installed.note};
  }
  if (!findFfprobe(findFfmpeg())) {
    const probe = installFfprobe(python.path);
    if (!probe.ok) return {ok: false, how: 'failed', note: probe.note};
  }
  const next = checkVideo();
  if (next.ok) return {...next, how: 'installed'};
  return {ok: false, how: 'failed', note: next.note || 'ffmpeg 装不上'};
}

// ---- docs：读写 PPT / Word / Excel / PDF、处理图片的 Python 包 ----
const DOC_PROBE = `
import tempfile
from pathlib import Path
from docx import Document
from pptx import Presentation
from pptx.util import Inches
from openpyxl import Workbook, load_workbook
with tempfile.TemporaryDirectory(prefix='pinkie-docs-') as folder:
    root=Path(folder)
    doc=Document(); doc.add_paragraph('碧琪'); doc.save(root/'test.docx')
    assert Document(root/'test.docx').paragraphs[0].text == '碧琪'
    slide=Presentation(); box=slide.slides.add_slide(slide.slide_layouts[6]).shapes.add_textbox(Inches(1), Inches(1), Inches(3), Inches(1)); box.text='碧琪'; slide.save(root/'test.pptx')
    assert Presentation(root/'test.pptx').slides[0].shapes[0].text == '碧琪'
    book=Workbook(); book.active['A1']='碧琪'; book.save(root/'test.xlsx')
    assert load_workbook(root/'test.xlsx').active['A1'].value == '碧琪'
`;
function checkDocs() {
  const python = findPython({needVenv: true}) || findPython();
  if (!python) return {ok: false, note: '没有 Python'};
  const missing = Object.entries(DOC_PACKAGES).filter(([module]) => !canImport(python.path, [module])).map(([, name]) => name);
  if (missing.length) return {ok: false, path: python.path, note: `缺：${missing.join('、')}`};
  const probe = run(python.path, ['-c', DOC_PROBE], {timeout: 90_000});
  return probe.ok ? {ok: true, path: python.path, how: 'found'} : {ok: false, path: python.path, note: `文档读写自检失败：${firstLine(probe.err).slice(0, 150)}`};
}
function ensureDocs() {
  const found = checkDocs();
  if (found.ok) return found;
  const python = ensurePython();
  if (!python.ok) return python;
  const missing = Object.entries(DOC_PACKAGES).filter(([module]) => !canImport(python.path, [module])).map(([, name]) => name);
  const installed = missing.length ? pipInstall(python.path, 'docs-write') : {ok: true};
  const next = checkDocs();
  return next.ok ? {...next, how: 'installed'} : {ok: false, how: 'failed', note: installed.note || next.note};
}

const PDF_PROBE = `
import tempfile
from pathlib import Path
from pypdf import PdfWriter, PdfReader
import pypdfium2 as pdfium
with tempfile.TemporaryDirectory(prefix='pinkie-pdf-') as folder:
    from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject
    root=Path(folder); writer=PdfWriter(); page=writer.add_blank_page(width=200, height=100)
    font=writer._add_object(DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')}))
    page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    content=DecodedStreamObject(); content.set_data(b'BT /F1 12 Tf 20 50 Td (pinkie) Tj ET'); page[NameObject('/Contents')]=writer._add_object(content)
    with (root/'one.pdf').open('wb') as out: writer.write(out)
    assert 'pinkie' in PdfReader(root/'one.pdf').pages[0].extract_text()
    merged=PdfWriter(); merged.append(root/'one.pdf'); merged.append(root/'one.pdf')
    with (root/'test.pdf').open('wb') as out: merged.write(out)
    assert len(PdfReader(root/'test.pdf').pages) == 2
    pdf=pdfium.PdfDocument(str(root/'test.pdf')); image=pdf[0].render(scale=1).to_pil(); image.save(root/'page.png')
    assert image.size == (200, 100) and (root/'page.png').stat().st_size > 30
`;
const IMAGE_PROBE = `
import tempfile
from pathlib import Path
from PIL import Image
with tempfile.TemporaryDirectory(prefix='pinkie-image-') as folder:
    out=Path(folder)/'test.png'
    Image.new('RGB',(20,20),'#f85a9a').crop((2,2,18,18)).resize((8,8)).save(out)
    with Image.open(out) as image: assert image.size == (8,8) and image.getpixel((0,0)) == (248,90,154)
`;
function checkPythonGroup(group, modules, probe) {
  const python = findPython({needVenv: true}) || findPython();
  if (!python) return {ok: false, note: '没有 Python 3.11 以上'};
  if (!canImport(python.path, modules)) return {ok: false, path: python.path, note: `缺少 ${group} 组件`};
  const result = run(python.path, ['-c', probe], {timeout: 90_000});
  return result.ok ? {ok: true, path: python.path, how: 'found'} : {ok: false, path: python.path, note: `${group} 自检失败：${firstLine(result.err).slice(0, 150)}`};
}
const checkPdf = () => checkPythonGroup('PDF', ['pypdf', 'pypdfium2'], PDF_PROBE);
const checkImage = () => checkPythonGroup('图片', ['PIL'], IMAGE_PROBE);
function ensureGroup(group, check) {
  const found = check();
  if (found.ok) return found;
  const python = ensurePython();
  if (!python.ok) return python;
  const installed = pipInstall(python.path, group);
  if (!installed.ok) return {ok: false, how: 'failed', note: installed.note};
  const next = check();
  return next.ok ? {...next, how: 'installed'} : {...next, how: 'failed'};
}
function legacyDocs(command) {
  const operations = command === 'check' ? [checkDocs, checkPdf, checkImage]
    : [ensureDocs, () => ensureGroup('pdf', checkPdf), () => ensureGroup('image', checkImage)];
  const results = operations.map(operation => operation());
  const failed = results.filter(result => !result.ok);
  return failed.length ? {ok: false, how: 'failed', note: failed.map(item => item.note).filter(Boolean).join('；')}
    : {ok: true, path: results[0].path, how: results.some(item => item.how === 'installed') ? 'installed' : 'found'};
}

// ---- office-view：把 PPT / Word / Excel 转成 PDF 或图片来看（LibreOffice） ----
function findSoffice() {
  const candidates = [WIN ? path.join(BOX, 'office', 'program', 'soffice.exe') : path.join(BOX, 'office', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'), ...(!NO_SYSTEM ? [which('soffice')] : [])];
  if (MAC && !NO_SYSTEM) candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice', path.join(userHome, 'Applications/LibreOffice.app/Contents/MacOS/soffice'));
  if (WIN && !NO_SYSTEM) for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (root) candidates.push(path.join(root, 'LibreOffice', 'program', 'soffice.exe'));
  }
  return candidates.find(exists) || '';
}
function officeProbe(soffice) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinkie-toolbox-office-'));
  try {
    const python = findPython({needVenv: true}) || findPython();
    if (!python || !canImport(python.path, ['pptx', 'docx', 'openpyxl'])) return false;
    const make = `from pathlib import Path\nimport sys\nfrom docx import Document\nfrom pptx import Presentation\nfrom pptx.util import Inches\nfrom openpyxl import Workbook\np=Path(sys.argv[1]); d=Document(); d.add_paragraph('碧琪'); d.save(p/'doc.docx')\nr=Presentation(); s=r.slides.add_slide(r.slide_layouts[6]); s.shapes.add_textbox(Inches(1),Inches(1),Inches(3),Inches(1)).text='碧琪'; r.save(p/'slide.pptx')\nw=Workbook(); w.active['A1']='碧琪'; w.save(p/'sheet.xlsx')`;
    if (!run(python.path, ['-c', make, dir], {timeout: 90_000}).ok) return false;
    const profile = pathToFileURL(path.join(dir, 'profile')).href;
    for (const [name, ext] of [['doc', 'docx'], ['slide', 'pptx'], ['sheet', 'xlsx']]) {
      const converted = run(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, `${name}.${ext}`)], {timeout: 120_000});
      const pdf = path.join(dir, `${name}.pdf`);
      if (!converted.ok || !exists(pdf) || fs.statSync(pdf).size < 100 || fs.readFileSync(pdf).subarray(0, 5).toString() !== '%PDF-') return false;
    }
    return true;
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
  const docs = ensureDocs();
  if (!docs.ok) return docs;
  if (findSoffice()) {
    const next = checkOffice();
    if (next.ok) return next;
    return {ok: false, how: 'failed', note: next.note};
  }
  const artifact = MANIFEST.office[`${process.platform}-${process.arch}`];
  if (!artifact || (!MAC && !WIN)) return {ok: false, how: 'failed', note: '当前系统还没有可校验的办公软件免安装包。'};
  const name = `LibreOffice_${artifact.version}_${MAC ? 'MacOS' : 'Win'}_${artifact.arch}.${MAC ? 'dmg' : 'msi'}`;
  const relative = `libreoffice/stable/${artifact.version}/${MAC ? 'mac' : 'win'}/${artifact.folder}/${name}`;
  const downloaded = downloadArtifact(name, [`https://mirrors.tuna.tsinghua.edu.cn/libreoffice/${relative}`, `https://mirrors.aliyun.com/libreoffice/${relative}`, `https://download.documentfoundation.org/${relative}`], artifact.integrity, 850 * 1024 * 1024);
  if (!downloaded.ok) return {ok: false, how: 'failed', note: downloaded.note};
  const office = path.join(BOX, 'office');
  if (exists(office)) return {ok: false, how: 'failed', note: '工具箱内已有办公软件目录，未覆盖已有文件。'};
  if (WIN) {
    const stage = fs.mkdtempSync(path.join(BOX, 'office-stage-'));
    try {
      const extracted = path.join(stage, 'SourceDir');
      const msi = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'msiexec.exe');
      const unpacked = run(msi, ['/a', downloaded.path, '/qn', `TARGETDIR=${extracted}`], {timeout: 900_000});
      let source = extracted;
      if (!exists(path.join(source, 'program', 'soffice.exe')) && exists(path.join(source, 'LibreOffice', 'program', 'soffice.exe'))) source = path.join(source, 'LibreOffice');
      if (!unpacked.ok || !exists(path.join(source, 'program', 'soffice.exe'))) return {ok: false, how: 'failed', note: '办公软件免安装解包失败；没有修改系统安装。'};
      const fonts = path.join(source, 'Fonts');
      if (exists(fonts)) fs.cpSync(fonts, path.join(source, 'share', 'fonts', 'truetype'), {recursive: true, force: false});
      fs.renameSync(source, office);
      ledger(downloaded.path, '办公软件安装包'); ledger(office, '办公文档查看工具 LibreOffice');
      const verified = checkOffice();
      return verified.ok ? {...verified, how: 'installed'} : {ok: false, how: 'failed', note: verified.note};
    } finally { if (exists(stage)) { try { fs.rmSync(stage, {recursive: true, force: true}); } catch {} } }
  }
  const mount = fs.mkdtempSync(path.join(BOX, 'office-mount-'));
  const stage = fs.mkdtempSync(path.join(BOX, 'office-stage-'));
  let mounted = false;
  try {
    const attached = run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, downloaded.path], {timeout: 180_000});
    if (!attached.ok) return {ok: false, how: 'failed', note: '办公软件安装包无法打开。'};
    mounted = true;
    const source = path.join(mount, 'LibreOffice.app');
    const target = path.join(stage, 'LibreOffice.app');
    if (!exists(source) || !run('/usr/bin/ditto', ['--norsrc', '--noextattr', source, target], {timeout: 600_000}).ok) return {ok: false, how: 'failed', note: '办公软件无法复制到工具箱。'};
    if (!run('/usr/bin/codesign', ['--verify', '--deep', '--strict', target], {timeout: 180_000}).ok) return {ok: false, how: 'failed', note: '办公软件签名验证没有通过。'};
    fs.renameSync(stage, office);
    ledger(downloaded.path, '办公软件安装包');
    ledger(office, '办公文档查看工具 LibreOffice');
    const verified = checkOffice();
    return verified.ok ? {...verified, how: 'installed'} : {ok: false, how: 'failed', note: verified.note};
  } finally {
    if (mounted) {
      const detached = run('/usr/bin/hdiutil', ['detach', mount], {timeout: 60_000});
      if (!detached.ok) console.error('办公软件安装镜像未能自动卸载：' + mount);
    }
    try { fs.rmdirSync(mount); } catch {}
    if (exists(stage)) { try { fs.rmSync(stage, {recursive: true, force: true}); } catch {} }
  }
}

// ---- fonts-cjk：给视频字幕、图片排字用的中文字体文件 ----
function checkFonts() {
  const candidates = [path.join(BOX, 'fonts', 'NotoSansSC_400Regular.ttf'), ...(NO_SYSTEM ? [] : MAC ? ['/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc', '/Library/Fonts/Arial Unicode.ttf']
    : WIN ? ['msyh.ttc', 'msyh.ttf', 'simhei.ttf', 'simsun.ttc', 'Deng.ttf'].map(name => path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', name))
      : ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc'])];
  const font = candidates.find(exists);
  if (!font) return {ok: false, note: '没有找到中文字体'};
  const python = findPython({needVenv: true}) || findPython();
  if (!python || !canImport(python.path, ['PIL'])) return {ok: false, path: font, note: '缺少图片组件，无法验证中文字体'};
  const script = `from PIL import Image, ImageDraw, ImageFont\nimport sys\nf=ImageFont.truetype(sys.argv[1], 48)\na=f.getmask('碧'); b=f.getmask('琪'); missing=f.getmask('\\U0010ffff')\nassert a.getbbox() and b.getbbox() and (bytes(a)!=bytes(missing) or a.size!=missing.size) and (bytes(b)!=bytes(missing) or b.size!=missing.size)\nim=Image.new('RGB',(150,70),'white'); ImageDraw.Draw(im).text((4,4),'碧琪',font=f,fill='black'); assert im.getbbox()\n`;
  const probe = run(python.path, ['-c', script, font], {timeout: 30_000});
  return probe.ok ? {ok: true, path: font, how: 'found'} : {ok: false, path: font, note: '中文字体存在，但渲染自检没通过'};
}
function ensureFonts() {
  const found = checkFonts();
  if (found.ok) return found;
  const images = ensureGroup('image', checkImage);
  if (!images.ok) return images;
  let next = checkFonts();
  if (next.ok) return next;
  const version = MANIFEST.font.version;
  const relative = `@expo-google-fonts/noto-sans-sc/-/noto-sans-sc-${version}.tgz`;
  const download = downloadArtifact(`noto-sans-sc-${version}.tgz`, [`https://registry.npmmirror.com/${relative}`, `https://registry.yarnpkg.com/${relative}`, `https://registry.npmjs.org/${relative}`], MANIFEST.font.integrity, 150 * 1024 * 1024);
  if (!download.ok) return {ok: false, how: 'failed', note: download.note};
  const target = path.join(BOX, 'fonts', 'NotoSansSC_400Regular.ttf');
  if (exists(target)) return {ok: false, how: 'failed', note: '工具箱里的字体不可用，未覆盖已有文件。'};
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const temp = `${target}.${process.pid}.tmp`;
  const extract = `import os,sys,tarfile,shutil\nsource,target=sys.argv[1:]\nwith tarfile.open(source,'r:gz') as archive:\n matches=[m for m in archive.getmembers() if os.path.basename(m.name)=='NotoSansSC_400Regular.ttf' and m.isfile()]\n assert len(matches)==1 and 0 < matches[0].size <= 40*1024*1024\n with archive.extractfile(matches[0]) as src, open(target,'xb') as out: shutil.copyfileobj(src,out)\n`;
  const unpacked = run(images.path, ['-c', extract, download.path, temp], {timeout: 120_000});
  if (!unpacked.ok) { try { fs.unlinkSync(temp); } catch {} return {ok: false, how: 'failed', note: '中文字体解压失败。'}; }
  fs.renameSync(temp, target);
  next = checkFonts();
  if (next.ok) { ledger(target, '思源黑体中文字体'); return {...next, how: 'installed'}; }
  return {ok: false, how: 'failed', note: next.note};
}

// ---- git ----
function checkGit() {
  const git = [path.join(BOX, 'git', WIN ? 'cmd/git.exe' : 'bin/git'), ...(!NO_SYSTEM ? [which('git')] : [])].find(exists) || '';
  if (!git) return {ok: false, note: '没有 git'};
  if (MAC && git === '/usr/bin/git' && !run('/usr/bin/xcode-select', ['-p'], {timeout: 10_000}).ok) return {ok: false, note: '系统的 git 需要先安装命令行工具'};
  const version = run(git, ['--version'], {timeout: 15_000});
  // Mac 上没装命令行工具时 /usr/bin/git 只是个会弹安装窗口的壳。
  return version.ok ? {ok: true, path: git, version: version.out.slice(0, 40), how: 'found'} : {ok: false, note: 'git 是系统的占位程序，还没真正装上'};
}
export function unpackZip(python, archive, destination) {
  const script = `import sys,zipfile,pathlib,stat,shutil\nsource,dest=sys.argv[1:]\nroot=pathlib.Path(dest).resolve()\nwith zipfile.ZipFile(source) as archive:\n infos=archive.infolist(); assert len(infos)<=20000 and sum(i.file_size for i in infos)<=1024*1024*1024\n for i in infos:\n  name=i.filename; parts=pathlib.PurePosixPath(name).parts\n  assert parts and not name.startswith('/') and '\\\\' not in name and all(p not in ('.','..') and ':' not in p for p in parts) and not stat.S_ISLNK(i.external_attr >> 16)\n  target=root.joinpath(*parts); assert target.resolve().is_relative_to(root)\n  if i.is_dir(): target.mkdir(parents=True,exist_ok=True)\n  else:\n   target.parent.mkdir(parents=True,exist_ok=True)\n   with archive.open(i) as src, target.open('xb') as out: shutil.copyfileobj(src,out)\n`;
  return run(python, ['-c', script, archive, destination], {timeout: 180_000});
}
function ensureGit() {
  const found = checkGit();
  if (found.ok) return found;
  const local = path.join(BOX, 'git', WIN ? 'cmd/git.exe' : 'bin/git');
  if (exists(local) && run(local, ['--version']).ok) return {ok: true, path: local, how: 'found'};
  const artifact = MANIFEST.git[`${process.platform}-${process.arch}`];
  if (WIN && artifact) {
    const python = ensurePython();
    if (!python.ok) return python;
    const name = `MinGit-${artifact.version}-${artifact.arch}.zip`;
    const relative = `git-for-windows/git/releases/download/v${artifact.version.replace(/\.4$/, '.windows.4')}/${name}`;
    const downloaded = downloadArtifact(name, [`https://registry.npmmirror.com/-/binary/git-for-windows/v${artifact.version}/${name}`, `https://github.com/${relative}`], artifact.integrity, 180 * 1024 * 1024);
    if (!downloaded.ok) return {ok: false, how: 'failed', note: downloaded.note};
    const target = path.join(BOX, 'git');
    if (exists(target)) return {ok: false, how: 'failed', note: '工具箱内已有 Git 目录，未覆盖已有文件。'};
    const stage = fs.mkdtempSync(path.join(BOX, 'git-stage-'));
    try {
      const unpacked = unpackZip(python.path, downloaded.path, stage);
      const executable = path.join(stage, 'cmd', 'git.exe');
      if (!unpacked.ok || !exists(executable) || !run(executable, ['--version'], {timeout: 30_000}).ok) return {ok: false, how: 'failed', note: '免安装版 Git 解压或自检失败。'};
      fs.renameSync(stage, target);
      ledger(target, '免安装版 Git');
      return {ok: true, path: local, how: 'installed'};
    } finally { if (exists(stage)) { try { fs.rmSync(stage, {recursive: true, force: true}); } catch {} } }
  }
  return {ok: false, how: 'failed', note: '没有找到可用的 Git，也没有能自动安装的免安装版本；改动前可以先复制文件夹作备份。'};
}

// 装下来占地方的东西登记进下载账本（同目录的 downloads.mjs），作品交付后再问用户要不要删。
function ledger(target, what) {
  const script = path.join(HERE, 'downloads.mjs');
  if (!exists(script) || !exists(target)) return;
  run(process.execPath, [script, 'add', '--path', target, '--what', what, '--for', '工具箱'], {timeout: 30_000});
}

function checkNode() {
  const result = run(process.execPath, ['--version'], {timeout: 15_000});
  if (!result.ok) return {ok: false, note: '碧琪自带的 Node 没能正常启动'};
  const bin = path.dirname(process.execPath);
  const npmScript = [path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(exists);
  const npmCommand = !WIN ? which('npm') : '';
  const npm = npmScript ? run(process.execPath, [npmScript, '--version'], {timeout: 30_000}) : npmCommand ? run(npmCommand, ['--version'], {timeout: 30_000}) : {ok: false};
  return npm.ok ? {ok: true, path: process.execPath, version: result.out, npm: npm.out, how: 'found'} : {ok: false, path: process.execPath, note: 'Node 可用，但没找到可运行的 npm。'};
}
function checkTts() {
  const python = findPython({needVenv: true}) || findPython();
  if (!python || !canImport(python.path, ['edge_tts'])) return {ok: false, note: '缺少中文语音组件'};
  const version = run(python.path, ['-c', "from importlib.metadata import version; print(version('edge-tts'))"], {timeout: 30_000});
  return version.ok ? {ok: true, path: python.path, version: version.out, how: 'found', note: '已检查语音组件；联网合成由 ensure 实测。'} : {ok: false, note: '中文语音组件无法启动'};
}
function ensureTts() {
  const installed = ensureGroup('tts', checkTts);
  if (!installed.ok) return installed;
  if (OFFLINE) return {ok: false, how: 'failed', note: '离线环境无法验证语音服务。'};
  const out = path.join(os.tmpdir(), `pinkie-toolbox-tts-${process.pid}.mp3`);
  try {
    const spoken = run(installed.path, ['-m', 'edge_tts', '--voice', 'zh-CN-XiaoxiaoNeural', '--text', '碧琪，测试一下。', '--write-media', out], {timeout: 90_000});
    if (!spoken.ok || !exists(out) || fs.statSync(out).size < 1000) return {ok: false, how: 'failed', note: '中文语音没有成功生成，请检查网络和语音服务。'};
    return {...installed, verified: true, note: '已实际合成一段中文语音。'};
  } finally { try { fs.unlinkSync(out); } catch {} }
}

function recordWorkspace(result) {
  const workspace = process.env.PINKIE_TOOLBOX_WORKSPACE ? path.resolve(process.env.PINKIE_TOOLBOX_WORKSPACE)
    : path.basename(HERE) === 'playbooks' && /^workspace(?:-.+)?$/.test(path.basename(path.dirname(HERE))) ? path.dirname(HERE) : '';
  if (!workspace) return;
  const file = path.join(workspace, 'TOOLS.md');
  let temp = '';
  try {
    if (exists(file) && fs.lstatSync(file).isSymbolicLink()) return;
    const existingMode = exists(file) ? fs.statSync(file).mode & 0o777 : 0o600;
    const current = exists(file) ? fs.readFileSync(file, 'utf8') : '';
    const start = '<!-- pinkie-toolbox:start -->', end = '<!-- pinkie-toolbox:end -->';
    const first = current.indexOf(start), last = current.indexOf(end);
    if ((first < 0) !== (last < 0) || (first >= 0 && (last < first || current.indexOf(start, first + start.length) >= 0 || current.indexOf(end, last + end.length) >= 0))) return;
    const old = first >= 0 ? current.slice(first + start.length, last).trim().split('\n').filter(Boolean) : [];
    const prefix = `- ${result.capability}: `;
    const safe = String(result.path || '').replace(/[\r\n`]/g, ' ');
    const row = `${prefix}${safe ? `\`${safe}\`` : '已验证可用'}`;
    const lines = old.filter(line => !line.startsWith(prefix));
    lines.push(row);
    const block = `${start}\n${lines.join('\n')}\n${end}`;
    const next = first >= 0 ? current.slice(0, first) + block + current.slice(last + end.length) : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}${block}\n`;
    fs.mkdirSync(workspace, {recursive: true});
    temp = path.join(workspace, `.pinkie-tools-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
    fs.writeFileSync(temp, next, {flag: 'wx', mode: existingMode});
    if (exists(file) && (fs.lstatSync(file).isSymbolicLink() || fs.readFileSync(file, 'utf8') !== current)) throw new Error('文件正在被其他程序修改，保留原内容');
    fs.renameSync(temp, file);
  } catch (error) { if (temp) { try { fs.unlinkSync(temp); } catch {} } console.error(`工具状态没能写入 TOOLS.md：${String(error.message || error).slice(0, 120)}`); }
}

export const CAPABILITIES = {
  python: {check: () => { const info = findPython({needVenv: true}); return info ? {ok: true, ...info, how: 'found'} : {ok: false, note: findPython() ? '有 Python，但还没有独立环境' : '没有 Python 3.11 以上'}; }, ensure: ensurePython},
  screenshot: {what: '无界面浏览器：打开网页、截图、点一遍', check: checkScreenshot, ensure: ensureScreenshot},
  video: {what: 'ffmpeg：剪辑、合成、抽帧、烧字幕', check: checkVideo, ensure: ensureVideo},
  node: {check: checkNode, ensure: checkNode},
  'office-view': {what: '把 PPT / Word / Excel 转成 PDF 或图片来亲眼看', check: checkOffice, ensure: ensureOffice},
  pdf: {check: checkPdf, ensure: () => ensureGroup('pdf', checkPdf)},
  'docs-write': {check: checkDocs, ensure: ensureDocs},
  image: {check: checkImage, ensure: () => ensureGroup('image', checkImage)},
  'fonts-cjk': {what: '中文字体文件（字幕、图片排字不出方框）', check: checkFonts, ensure: ensureFonts},
  tts: {check: checkTts, ensure: ensureTts},
  git: {what: '版本管理：改坏了能退回', check: checkGit, ensure: ensureGit},
  // 旧版打法把文档、PDF 和图片统称为 docs；保留全部旧含义。
  docs: {check: () => legacyDocs('check'), ensure: () => legacyDocs('ensure')},
};

export function summarize(results) {
  const bad = results.filter(item => !item.ok);
  if (!bad.length) return `都准备好了：${results.map(item => item.capability).join('、')}。`;
  const good = results.filter(item => item.ok).map(item => item.capability);
  return `${good.length ? `已经能用：${good.join('、')}。` : ''}还不行：${bad.map(item => `${item.capability}（${item.note || '原因不明'}）`).join('；')}。`;
}

function main(argv) {
  const human = argv.includes('--human');
  const [command = 'check', ...requested] = argv.filter(value => value !== '--human');
  if (command === 'list') {
    for (const [name, capability] of Object.entries(MANIFEST.capabilities)) {
      console.log(human ? `${name}\t${capability.what}` : JSON.stringify({capability: name, ...capability}));
    }
    return 0;
  }
  if (!['check', 'ensure'].includes(command)) { console.error('用法：node toolbox.mjs check|ensure|list [能力…]'); return 2; }
  const names = requested;
  const unknown = names.filter(name => !CAPABILITIES[name]);
  if (unknown.length) { console.error(`没有这个能力：${unknown.join('、')}。可用的：${Object.keys(CAPABILITIES).join(' ')}`); return 2; }
  if (command === 'ensure' && !names.length) { console.error('ensure 要写明能力，比如：node toolbox.mjs ensure screenshot video'); return 2; }
  const targets = names.length ? names : Object.keys(MANIFEST.capabilities);
  const results = [];
  for (const name of targets) {
    let result;
    try {
      const reserve = (MANIFEST.capabilities[name]?.reserveMiB ?? 600) * 1024 * 1024;
      const found = command === 'ensure' ? CAPABILITIES[name].check() : null;
      if (found?.ok && name !== 'tts') result = found;
      else {
        const space = command === 'ensure' && reserve ? requireSpace(reserve) : {ok: true};
        result = space.ok ? CAPABILITIES[name][command]() : space;
      }
    } catch (error) { result = {ok: false, how: 'failed', note: String(error?.message || error).slice(0, 200)}; }
    const line = {capability: name, platform: process.platform, ...result};
    results.push(line);
    if (command === 'ensure' && line.ok) recordWorkspace(line);
    console.log(human ? `${name}: ${line.ok ? '可用' : '不可用'}${line.path ? ` (${line.path})` : ''}${line.note ? ` — ${line.note}` : ''}` : JSON.stringify(line));
  }
  if (human) console.log(summarize(results));
  return results.every(item => item.ok) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
