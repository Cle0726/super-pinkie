const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('workspace materials preview is narrowly scoped to image/PDF/HTML rows', () => {
  const source = read('ui/injections/laolao-material-preview.js');
  assert.match(source, /\["pdf", "pdf"\]/);
  assert.match(source, /\["html", "html"\], \["htm", "html"\]/);
  assert.match(source, /\["png", "image"\]/);
  assert.match(source, /const RAIL = "\.chat-workbench > \.chat-workspace-rail/);
  assert.match(source, /const pathFromRow =/);
  assert.match(source, /if \(!visiblePath \|\| !previewKind\(visiblePath\)\) return null/);
  assert.match(source, /chat-workspace-rail__file-open, \.chat-workspace-rail__row-action/);
  assert.match(source, /chat-workspace-rail__row-action"\) && !\/preview\|预览\/i\.test/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /text, folders and all existing rail actions remain native/);
});

test('materials stay inside the workspace rail and image click can reuse the existing full viewer', () => {
  const source = read('ui/injections/laolao-material-preview.js');
  const css = read('ui/injections/laolao-material-preview.css');
  const imageViewer = read('ui/injections/laolao-image-viewer.js');
  assert.match(source, /className = "laolao-material-preview/);
  assert.match(source, /makeButton\("放大预览", "laolao-material-preview__expand"\)/);
  assert.match(source, /panel\.classList\.toggle\("is-expanded"\)/);
  assert.match(source, /SIZE_STORAGE_KEY = "laolao-material-preview-size-v2"/);
  assert.match(source, /attachResizeHandle\(panel, resizeHandle, lifecycle\.signal\)/);
  assert.match(source, /拖动以调节预览大小/);
  assert.match(source, /chat-tool-card__preview-image/);
  assert.match(source, /laolao-material-preview__pdf/);
  assert.match(source, /allow-scripts/);
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
  const windows = read('app/windows_desktop.py');
  assert.match(mac, /private final class MaterialPreviewSchemeHandler: NSObject, WKURLSchemeHandler/);
  assert.match(mac, /configuration\.setURLSchemeHandler\(materialPreview, forURLScheme: "clekk-material"\)/);
  assert.match(mac, /materialPreviewHandlerName = "laolaoMaterialPreview"/);
  assert.match(mac, /materialPreview\.register\(path: path\)/);
  assert.match(mac, /case "html", "htm": return "text\/html"/);
  assert.match(mac, /lets an HTML material load its own sibling CSS\/images/);
  assert.match(mac, /does not alter the\n   Agent's filesystem or tool permissions/);
  assert.match(windows, /def preview_material\(self, payload\):/);
  assert.match(windows, /data:\{mime_type\};base64/);
  assert.match(windows, /does not change the agent's tool or\n        filesystem access/);
});

test('Control UI CSP permits only the desktop material preview scheme for media', () => {
  const patch = read('patch/apply-material-preview-csp.mjs');
  const macInstaller = read('installer/macos/apply-theme.sh');
  const windowsInstaller = read('installer/windows/apply-theme.ps1');
  assert.match(patch, /img-src \\'self\\' data: blob: clekk-material:/);
  assert.match(patch, /frame-src \\'self\\' data: clekk-material:/);
  assert.match(patch, /does not change agent permissions/);
  assert.match(macInstaller, /apply-material-preview-csp\.mjs/);
  assert.match(windowsInstaller, /apply-material-preview-csp\.mjs/);
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
