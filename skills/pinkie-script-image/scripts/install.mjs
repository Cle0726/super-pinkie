// 一次性装好生图技能要用的工具链：
//  - 复制慢半拍项目里真能用的脚本到本技能的 vendor/（不跑项目里的 bash，避免 F: 路径和 venv 依赖）
//  - 把本地加工脚本（抠图/贴纸/联系表/深度/剪影/去水印）改成「可指定任意输入输出目录」
//  - 检查 python 有没有 PIL / numpy / scipy / opencv
// 用法: node install.mjs [--source "F:/慢半拍-项目/慢半拍/工具"]
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const SRC = opt('--source', 'F:/慢半拍-项目/慢半拍/工具');
const VENDOR = path.join(SKILL_DIR, 'vendor');
fs.mkdirSync(VENDOR, {recursive: true});

// 直接照抄就能用的（内部已经把路径算成自己的目录）
const COPY = [
  'gemini_gen.mjs', 'gemini_ui.mjs', 'gpt_web_gen.mjs', 'chatgpt_image.mjs',
  'doubao_gen.mjs', 'doubao_get.mjs', 'doubao_ui.mjs', 'doubao_lock.mjs',
  'doubao_video.sh',
];
// 需要改造成「任意输入输出目录」的本地加工脚本
const PATCH = ['cutout.py', 'sticker.py', 'contact_sheet.py', 'sheet.py', 'depth.py', 'silhouette.py', 'dewatermark.py'];

const log = [];
for (const f of COPY) {
  const s = path.join(SRC, f);
  if (!fs.existsSync(s)) { log.push({file: f, action: 'missing'}); continue; }
  fs.copyFileSync(s, path.join(VENDOR, f));
  log.push({file: f, action: 'copied'});
}
for (const f of PATCH) {
  const s = path.join(SRC, f);
  if (!fs.existsSync(s)) { log.push({file: f, action: 'missing'}); continue; }
  fs.copyFileSync(s, path.join(VENDOR, f));
  log.push({file: f, action: 'copied-needs-port'});
}

// python 依赖检查
const PY = process.env.PK_PYTHON || 'python';
const probe = spawnSync(PY, ['-c', 'import PIL,numpy,scipy,cv2;print("ok", PIL.__version__, numpy.__version__, scipy.__version__, cv2.__version__)'], {encoding: 'utf8'});
const py = probe.status === 0
  ? {ok: true, detail: probe.stdout.trim()}
  : {ok: false, detail: (probe.stderr || '').split('\n').filter(Boolean).pop() || '没装 PIL/numpy/scipy/opencv 之一'};

console.log(JSON.stringify({
  vendor: VENDOR,
  copied: log,
  python: {cmd: PY, ...py},
  hint: py.ok ? '' : '装 python 依赖：python -m pip install pillow numpy scipy opencv-python-headless',
}, null, 2));

