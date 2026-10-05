const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('workspace files expose user-clicked actions and preview all supported material types', () => {
  const source = read('ui/injections/laolao-material-preview.js');
  assert.match(source, /\["pdf", "pdf"\]/);
  assert.match(source, /\["html", "html"\], \["htm", "html"\]/);
  assert.match(source, /\["png", "image"\]/);
  assert.match(source, /\["mp4", "video"\]/);
  assert.match(source, /\["mp3", "audio"\]/);
  assert.match(source, /\["md", "text"\]/);
  assert.match(source, /const RAIL = "\.chat-workbench > \.chat-workspace-rail/);
  assert.match(source, /const pathFromRow =/);
  assert.match(source, /if \(!visiblePath\) return null/);
  assert.match(source, /chat-workspace-rail__file-open, \.chat-workspace-rail__row-action/);
  assert.match(source, /chat-workspace-rail__row-action"\) && !\/preview\|预览\/i\.test/);
  assert.match(source, /保存到下载/);
  assert.match(source, /在访达中显示/);
  assert.match(source, /checkAndShowActionMenu/);
  assert.match(source, /pathFromChatClick/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
});

test('materials stay inside the workspace rail and image click can reuse the existing full viewer', () => {
  const source = read('ui/injections/laolao-material-preview.js');
  const css = read('ui/injections/laolao-material-preview.css');
  const imageViewer = read('ui/injections/laolao-image-viewer.js');
  assert.match(source, /panel\.className = `laolao-material-preview/);
  assert.match(source, /makeButton\("放大预览", "laolao-material-preview__expand"\)/);
  assert.match(source, /panel\.classList\.toggle\("is-expanded"\)/);
  assert.match(source, /SIZE_STORAGE_KEY = "laolao-material-preview-size-v2"/);
  assert.match(source, /attachResizeHandle\(panel, resizeHandle, lifecycle\.signal\)/);
  assert.match(source, /拖动以调节预览大小/);
  assert.match(source, /chat-tool-card__preview-image/);
  assert.match(source, /laolao-material-preview__document/);
  assert.match(source, /allow-scripts/);
  assert.match(source, /createElement\(target\.kind\)/);
  assert.match(source, /requestNativeAction\(target, "open"\)/);
  assert.match(css, /laolao-material-preview__media/);
  assert.match(css, /laolao-material-menu/);
  assert.match(css, /laolao-material-toast__reveal/);
  assert.match(css, /\.laolao-material-preview \{[\s\S]*position: absolute;/);
  assert.match(css, /grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /\.laolao-material-preview__pdf \{[\s\S]*height: 100%/);
  assert.match(css, /\.laolao-material-preview\.is-expanded \{[\s\S]*position: fixed/);
  assert.match(css, /--laolao-material-preview-width/);
  assert.match(css, /\.laolao-material-preview__resize \{/);
  assert.match(css, /cursor: nwse-resize/);
  assert.match(imageViewer, /chat-tool-card__preview-image/);
});

test('both desktop shells provide a local material transport without changing tool access', () => {
  const mac = read('desktop/macos/Sources/Launcher.swift');
  const material = read('desktop/macos/Sources/MaterialPreview.swift');
  const windows = read('app/windows_desktop.py');
  assert.match(material, /final class MaterialPreviewSchemeHandler: NSObject, WKURLSchemeHandler/);
  assert.match(mac, /configuration\.setURLSchemeHandler\(materialPreview, forURLScheme: "clekk-material"\)/);
  assert.match(mac, /materialPreviewHandlerName = "laolaoMaterialPreview"/);
  assert.match(mac, /materialPreview\.register\(path: path\)/);
  assert.match(material, /case "html", "htm": return \("text\/html", \.html\)/);
  assert.match(material, /case "mp4": return \("video\/mp4", \.video\)/);
  assert.match(material, /case "mp3": return \("audio\/mpeg", \.audio\)/);
  assert.match(material, /Content-Range/);
  assert.match(material, /read\(upToCount: count\)/);
  assert.match(material, /responseRequiresDownload\(contentDisposition:/);
  assert.match(material, /\.ssh/);
  assert.match(material, /keychains/);
  assert.match(material, /lower\.first == "\.openclaw" && !isOpenClawWorkspace/);
  assert.match(mac, /WKDownloadDelegate/);
  assert.match(mac, /navigationAction\.shouldPerformDownload/);
  assert.match(mac, /responseRequiresDownload\(/);
  assert.match(mac, /在访达中显示/);
  assert.match(windows, /def preview_material\(self, payload\):/);
  assert.match(windows, /data:\{mime_type\};base64/);
  assert.match(windows, /path\.resolve\(strict=True\)/);
  assert.match(windows, /parts\[0\] == "\.openclaw" and not is_openclaw_workspace/);
  assert.match(windows, /Content-Security-Policy/);
  assert.match(windows, /connect-src 'none'/);
  assert.match(windows, /action == "save"/);
});

test('Control UI CSP permits only the desktop material preview scheme for media', () => {
  const patch = read('patch/apply-material-preview-csp.mjs');
  const macInstaller = read('installer/macos/apply-theme.sh');
  const windowsInstaller = read('installer/windows/apply-theme.ps1');
  assert.match(patch, /img-src \\'self\\' data: blob: clekk-material:/);
  assert.match(patch, /frame-src \\'self\\' data: clekk-material:/);
  assert.match(patch, /media-src \\'self\\' data: blob: clekk-material:/);
  assert.match(patch, /does not change agent permissions/);
  assert.match(macInstaller, /apply-material-preview-csp\.mjs/);
  assert.match(windowsInstaller, /apply-material-preview-csp\.mjs/);
});

test('simulated assistant replay offers actions only for a path accepted by the native bridge', async () => {
  const source = read('ui/injections/laolao-material-preview.js');
  const makeHarness = () => {
    class FakeElement {
      constructor(tag = 'div', text = '') {
        this.tagName = tag.toUpperCase();
        this.textContent = text;
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.dataset = {};
        this.style = { setProperty() {}, removeProperty() {} };
        this.classList = {
          values: new Set(),
          add: (...names) => names.forEach((name) => this.classList.values.add(name)),
          remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
          contains: (name) => this.classList.values.has(name),
          toggle: (name) => this.classList.values.has(name) ? (this.classList.values.delete(name), false) : (this.classList.values.add(name), true),
        };
      }
      setAttribute(key, value) { this.attributes[key] = String(value); }
      getAttribute(key) { return this.attributes[key] || null; }
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
      append(...nodes) { this.children.push(...nodes); }
      replaceChildren(...nodes) { this.children = [...nodes]; }
      remove() { this.removed = true; }
      querySelector() { return null; }
      querySelectorAll() { return []; }
      closest(selector) {
        if (selector.includes('a[href]') && this.tagName === 'A' && this.getAttribute('href')) return this;
        if (selector.includes('pre, code') && ['PRE', 'CODE'].includes(this.tagName)) return this;
        if (selector.includes('.chat-bubble') && this.tagName === 'CODE') return this.bubble;
        return null;
      }
      getBoundingClientRect() { return { left: 80, bottom: 110, width: 180, height: 30 }; }
      setPointerCapture() {}
      releasePointerCapture() {}
      get isConnected() { return !this.removed; }
    }
    const documentListeners = {};
    const body = new FakeElement('body');
    const document = {
      readyState: 'complete',
      body,
      documentElement: new FakeElement('html'),
      addEventListener(name, fn) { (documentListeners[name] ||= []).push(fn); },
      querySelectorAll() { return []; },
      querySelector() { return null; },
      getElementById() { return null; },
      createElement(tag) { return new FakeElement(tag); },
      caretRangeFromPoint() { return null; },
    };
    const posted = [];
    let timer = 0;
    const window = {
      innerWidth: 1280,
      innerHeight: 820,
      localStorage: { getItem() { return null; }, setItem() {} },
      addEventListener() {},
      setTimeout() { return ++timer; },
      clearTimeout() {},
      webkit: { messageHandlers: { laolaoMaterialPreview: { postMessage(value) { posted.push(value); } } } },
    };
    vm.runInNewContext(source, {
      window, document, Element: FakeElement, Node: { TEXT_NODE: 3 },
      AbortController, Promise, Map, WeakMap, Date, Math, URL,
      setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    });
    const bubble = new FakeElement('div');
    const code = new FakeElement('code', '/Users/Admin/work/answer.txt');
    code.bubble = bubble;
    return { document, documentListeners, posted, window, code, FakeElement };
  };

  const clickTarget = (harness, target) => {
    let prevented = false;
    let stopped = false;
    harness.documentListeners.click[0]({
      button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
      target, clientX: 95, clientY: 100,
      preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; },
    });
    return { prevented, stopped };
  };
  const clickCode = (harness) => clickTarget(harness, harness.code);
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  const valid = makeHarness();
  const stopped = clickCode(valid);
  assert.deepEqual(stopped, { prevented: true, stopped: true });
  assert.equal(valid.posted[0].action, 'check');
  assert.equal(valid.posted[0].path, '/Users/Admin/work/answer.txt');
  valid.window.__laolaoMaterialPreviewResult({ requestId: valid.posted[0].requestId, ok: true, name: 'answer.txt' });
  await tick();
  const menu = valid.document.body.children.find((item) => item.className === 'laolao-material-menu');
  assert.ok(menu, 'existing assistant output path gets an action menu');
  menu.children[0].listeners.click[0]();
  assert.equal(valid.posted[1].action, 'open');
  assert.equal(valid.posted[1].path, '/Users/Admin/work/answer.txt');

  const markdownLink = makeHarness();
  const linkedPath = new markdownLink.FakeElement('a', '生成的视频');
  linkedPath.setAttribute('href', '/Users/Admin/项目视频剪辑管理/133-cut.mp4');
  clickTarget(markdownLink, linkedPath);
  assert.equal(markdownLink.posted[0].action, 'check');
  assert.equal(markdownLink.posted[0].path, '/Users/Admin/项目视频剪辑管理/133-cut.mp4');

  const windowsFileLink = makeHarness();
  const windowsFilePath = new windowsFileLink.FakeElement('a', '生成的表格');
  windowsFilePath.setAttribute('href', 'file:///C:/Users/Admin/Downloads/report%20final.csv');
  windowsFilePath.href = windowsFilePath.getAttribute('href');
  clickTarget(windowsFileLink, windowsFilePath);
  assert.equal(windowsFileLink.posted[0].path, 'C:/Users/Admin/Downloads/report final.csv');

  const missing = makeHarness();
  clickCode(missing);
  missing.window.__laolaoMaterialPreviewResult({ requestId: missing.posted[0].requestId, ok: false, message: '这个文件已经不在原来的位置了。' });
  await tick();
  assert.equal(missing.document.body.children.some((item) => item.className === 'laolao-material-menu' && item.children.some((child) => child.className === 'laolao-material-menu__item')), false,
    'missing path does not get file action buttons');
});

test('installers ship and inject the material viewer on both platforms', () => {
  const fragment = read('ui/injections/laolao-head.fragment.html');
  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  for (const source of [fragment, mac, windows]) {
    assert.match(source, /laolao-material-preview\.css/);
    assert.match(source, /laolao-material-preview\.js/);
  }
  assert.match(mac, /laolaoMaterialPreview/);
  assert.match(windows, /'laolao-material-preview\.js' = 'material2'/);
});
