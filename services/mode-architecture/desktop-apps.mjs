import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readSessionJson, registerSessionMethod, writeSessionJson} from './session-titles.mjs';

// 作品装成桌面上的独立应用（任务-官方新功能五项-1125 第 1 项，PR①：安装、打开、卸载）。
// 网关这一半只管文件：把作品库里一件 html 作品的最新版本拷进 <plugin state>/apps/<appId>/，
// 记在 apps/index.json；图标、开始菜单 / 桌面 / ~/Applications 里的入口和独立窗口由原生端做
// （Windows app/windows_app_window.py，macOS desktop/macos/pinkie/Sources/AppWindow.swift）。
// 拷出来的页面默认不联网：在 <head> 最前面插一条 CSP，只放行页面自己的内联代码和 data:/blob:。
// 联网 / 读文件的权限和「更新成新版本」是 PR② 的事；这里 latest 字段先给出来，界面只用它显示。

export const APP_LIMITS = Object.freeze({htmlBytes: 5 * 1024 * 1024, iconBytes: 512 * 1024, nameChars: 40, apps: 200});
export const OFFLINE_CSP = [
  "default-src 'none'", "script-src 'unsafe-inline' 'unsafe-eval' data: blob:", "style-src 'unsafe-inline' data: blob:",
  'img-src data: blob:', 'font-src data:', 'media-src data: blob:', "connect-src 'none'", "frame-src 'none'",
  "worker-src blob:", "form-action 'none'", "base-uri 'none'", "object-src 'none'",
].join('; ');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const appIdFor = artifactId => 'w' + createHash('sha1').update(String(artifactId)).digest('hex').slice(0, 15);

// 名字会变成快捷方式 / .app 的文件名：去掉两个系统都不认的字符，太长截断，空了用「作品」。
export function safeAppName(raw, limit = APP_LIMITS.nameChars) {
  let name = String(raw || '').replace(/\.(html?|htm)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  name = [...name].slice(0, limit).join('').replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name) name = '作品';
  if (RESERVED.test(name)) name = name + ' 作品';
  return name;
}

// 副本按 file:// 打开，没有 HTTP 头报编码；作品自己没写 charset 时 WebKit / WebView2 按本地默认编码猜，中文会乱码。
// 文件是按 utf8 读写的，所以缺了就补 utf-8，放在 CSP 前面。
const DECLARES_CHARSET = /<meta\s[^>]*charset\s*=/i;
export const charsetMeta = text => (DECLARES_CHARSET.test(text) ? '' : '<meta charset="utf-8">');

// CSP 必须在任何脚本之前：有 <head> 插在它后面；没有就插在 doctype / <html> 后面
// （解析器会把它放进隐式的 head）；都没有才放最前面。
export function withOfflinePolicy(html) {
  const text = String(html);
  const meta = charsetMeta(text) + `<meta http-equiv="Content-Security-Policy" content="${OFFLINE_CSP}">`;
  for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const match = pattern.exec(text);
    if (match) return text.slice(0, match.index + match[0].length) + meta + text.slice(match.index + match[0].length);
  }
  return meta + text;
}

function pngSize(png) {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_MAGIC) || png.toString('latin1', 12, 16) !== 'IHDR') return null;
  return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}
// Windows 从 Vista 起认 ICO 里直接放 PNG；macOS 的 icns 用 ic08（256×256 PNG）。都只是加个文件头。
export function icoFromPng(png) {
  const size = pngSize(png);
  if (!size) throw new Error('图标不是 PNG');
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(size.width >= 256 ? 0 : size.width, 6); head.writeUInt8(size.height >= 256 ? 0 : size.height, 7);
  head.writeUInt8(0, 8); head.writeUInt8(0, 9); head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}
export function icnsFromPng(png) {
  if (!pngSize(png)) throw new Error('图标不是 PNG');
  const head = Buffer.alloc(16);
  head.write('icns', 0, 'latin1'); head.writeUInt32BE(16 + png.length, 4);
  head.write('ic08', 8, 'latin1'); head.writeUInt32BE(8 + png.length, 12);
  return Buffer.concat([head, png]);
}
function decodeIcon(dataUrl, limit) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const png = Buffer.from(match[1], 'base64');
  if (png.length > limit || !pngSize(png)) throw new Error('图标不对：要 PNG，不超过 512 KB');
  return png;
}

export class DesktopApps {
  constructor(root, {artifacts, now = Date.now, limits = APP_LIMITS} = {}) {
    this.root = root;
    this.file = path.join(root, 'index.json');
    this.artifacts = artifacts;
    this.now = now;
    this.limits = {...APP_LIMITS, ...limits};
    this.cache = null;
  }
  load() {
    if (this.cache) return this.cache;
    let data = {};
    try { data = readSessionJson(this.file); } catch { data = {}; }
    this.cache = {apps: data.apps && typeof data.apps === 'object' ? data.apps : {}};
    return this.cache;
  }
  save() { writeSessionJson(this.file, this.cache); }
  dirOf(appId) { return path.join(this.root, appId); }
  latestOf(artifactId) {
    try { return this.artifacts?.get(artifactId)?.item?.version || 0; } catch { return 0; }
  }
  view(app) {
    if (!app) return null;
    const dir = this.dirOf(app.id);
    const icon = name => (fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : '');
    return {
      id: app.id, artifactId: app.artifactId, name: app.name, version: app.version, latest: this.latestOf(app.artifactId),
      installedAt: app.installedAt, updatedAt: app.updatedAt, network: false, files: false,
      dir, entry: path.join(dir, 'index.html'), icon: {png: icon('icon.png'), ico: icon('icon.ico'), icns: icon('icon.icns')},
    };
  }
  list() {
    const apps = Object.values(this.load().apps).sort((a, b) => b.installedAt - a.installedAt || (a.id < b.id ? -1 : 1));
    return {ok: true, apps: apps.map(app => this.view(app))};
  }
  app(appId) {
    const app = this.load().apps[String(appId || '')];
    if (!app) throw new Error('没有装过这个应用');
    return app;
  }
  get(appId) { return {ok: true, app: this.view(this.app(appId))}; }
  forArtifact(artifactId) {
    const app = this.load().apps[appIdFor(artifactId)];
    return {ok: true, app: app ? this.view(app) : null};
  }

  // 装同一件作品第二次：覆盖成最新版本、换名字和图标，id 不变（原生端据此替换旧入口）。
  install({id, name, icon} = {}) {
    if (!this.artifacts) throw new Error('作品库没准备好');
    const item = this.artifacts.get(id).item;
    if (item.kind !== 'html') throw new Error('只有网页作品能装成应用');
    const data = this.load();
    const appId = appIdFor(item.id);
    if (!data.apps[appId] && Object.keys(data.apps).length >= this.limits.apps) throw new Error(`最多装 ${this.limits.apps} 个应用`);
    const {path: source} = this.artifacts.versionPath(item.id, item.version);
    const size = fs.statSync(source).size;
    if (size > this.limits.htmlBytes) throw new Error('这件作品太大了，装不了（超过 5 MB）');
    const png = decodeIcon(icon, this.limits.iconBytes);
    const dir = this.dirOf(appId);
    const staging = `${dir}.staging-${process.pid}-${this.now()}`;
    fs.rmSync(staging, {recursive: true, force: true});
    fs.mkdirSync(staging, {recursive: true, mode: 0o700});
    try {
      fs.writeFileSync(path.join(staging, 'index.html'), withOfflinePolicy(fs.readFileSync(source, 'utf8')));
      if (png) {
        fs.writeFileSync(path.join(staging, 'icon.png'), png);
        fs.writeFileSync(path.join(staging, 'icon.ico'), icoFromPng(png));
        fs.writeFileSync(path.join(staging, 'icon.icns'), icnsFromPng(png));
      }
      fs.rmSync(dir, {recursive: true, force: true});
      fs.renameSync(staging, dir);
    } catch (error) {
      fs.rmSync(staging, {recursive: true, force: true});
      throw error;
    }
    const ts = this.now();
    const old = data.apps[appId];
    data.apps[appId] = {id: appId, artifactId: item.id, name: safeAppName(name || item.title), version: item.version,
      installedAt: old?.installedAt || ts, updatedAt: ts};
    this.save();
    return {ok: true, replaced: Boolean(old), previousName: old?.name || '', app: this.view(data.apps[appId])};
  }

  // 只删碧琪数据目录里的副本和记录；入口（快捷方式 / .app）由原生端先删。
  remove(appId) {
    const data = this.load();
    const app = data.apps[String(appId || '')];
    if (!app) return {ok: true, removed: false};
    delete data.apps[app.id];
    this.save();
    fs.rmSync(this.dirOf(app.id), {recursive: true, force: true});
    return {ok: true, removed: true, name: app.name};
  }
}

export function registerDesktopApps(api, {root, artifacts} = {}) {
  const apps = new DesktopApps(root, {artifacts});
  const method = (name, fn) => registerSessionMethod(api, name, async params => {
    try { return await fn(params || {}); } catch (error) { return {ok: false, error: error.message}; }
  });
  method('pinkie.apps.list', () => apps.list());
  method('pinkie.apps.get', ({id}) => apps.get(id));
  method('pinkie.apps.forArtifact', ({id}) => apps.forArtifact(id));
  method('pinkie.apps.install', params => apps.install(params));
  method('pinkie.apps.remove', ({id}) => apps.remove(id));
  return apps;
}
