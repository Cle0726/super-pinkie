const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('native browser workspace is independent from chat modes and keeps one persistent webview', () => {
  const source = read('desktop/macos/Sources/Launcher.swift');

  assert.match(source, /private let browserWorkspaceHandlerName = "laolaoBrowserWorkspace"/);
  assert.match(source, /controller\.add\(self, name: browserWorkspaceHandlerName\)/);
  assert.match(source, /private var browserWebView: WKWebView\?/);
  assert.match(source, /configuration\.websiteDataStore = \.default\(\)/);
  assert.match(source, /private func openBrowserWorkspace\(url: URL\?\)/);
  assert.match(source, /private func ensureBrowserWorkspace\(url: URL\?, focus: Bool, showStartPage: Bool = true\)/);
  assert.match(source, /browserPresentation = \.floating/);
  assert.match(source, /data-laolao-browser-workspace/);

  const closeStart = source.indexOf('private func detachBrowserWorkspace');
  const closeEnd = source.indexOf('@objc private func browserAddressSubmitted', closeStart);
  const close = source.slice(closeStart, closeEnd);
  assert.match(close, /browserPanel\?\.removeFromSuperview\(\)/);
  assert.doesNotMatch(close, /browserWebView\s*=\s*nil/);
  assert.doesNotMatch(close, /lastBrowserURL\s*=\s*nil/);
  assert.match(close, /CABasicAnimation\(keyPath: "transform\.translation\.x"\)/);
});

test('browser workspace supports navigation, popup links and drag resizing', () => {
  const source = read('desktop/macos/Sources/Launcher.swift');
  assert.match(source, /private final class BrowserResizeHandle/);
  assert.match(source, /onDrag\?\(previousX - currentX\)/);
  assert.match(source, /browser\.allowsBackForwardNavigationGestures = true/);
  assert.match(source, /@objc private func browserGoBack/);
  assert.match(source, /@objc private func browserGoForward/);
  assert.match(source, /@objc private func browserReload/);
  assert.match(source, /createWebViewWith configuration: WKWebViewConfiguration/);
  assert.match(source, /navigationAction\.targetFrame == nil/);
  assert.match(source, /openBrowserWorkspace\(url: url\)/);
  assert.match(source, /arrow\.up\.right\.square/);
  assert.match(source, /@objc private func browserOpenExternally/);
  assert.match(source, /NSWorkspace\.shared\.open\(url\)/);
  assert.match(source, /正在通过安全验证/);
  assert.match(source, /private func browserErrorPage/);
  assert.match(source, /webViewWebContentProcessDidTerminate/);
  assert.match(source, /private func isChatGPTURL/);
  assert.match(source, /private func sendChatGPTMessage/);
  assert.match(source, /private func chatGPTSnapshot/);
  assert.match(source, /message\.utf8\.count <= 12_000/);
  assert.match(source, /body\["action"\] as\? String == "chatgpt-control"/);
});

test('every mode gets the same sidebar browser launcher and chat links use it', () => {
  const source = read('ui/injections/laolao-link-viewer.js');
  assert.match(source, /laolao-browser-workspace-entry/);
  assert.match(source, /messageHandlers\?\.laolaoBrowserWorkspace/);
  assert.match(source, /bridge\.postMessage\(\{ action: "open", url \}\)/);
  assert.match(source, /setInterval\(mountBrowserLauncher, 1500\)/);
  assert.match(source, /flex:0 0 28px;width:28px;height:28px/);
  assert.match(source, /button\.innerHTML = '<svg[\s\S]*?<\/svg>';/);
  assert.doesNotMatch(source, /<span>网页资料<\/span>/);
  assert.doesNotMatch(source, /learning.*laolao-browser-workspace-entry/i);

  const mac = read('installer/macos/apply-theme.sh');
  const windows = read('installer/windows/apply-theme.ps1');
  assert.match(mac, /laolao-link-viewer\.js\?v=link6/);
  assert.match(mac, /laolaoBrowserWorkspace/);
  assert.match(windows, /laolao-link-viewer\.js\?v=link6/);
});

test('browser width remains bounded through full-screen, drag and ordinary-window sizes', {skip: process.platform !== 'darwin'}, () => {
  const source = read('desktop/macos/Sources/Launcher.swift');
  const start = source.indexOf('enum BrowserWorkspaceGeometry {');
  const end = source.indexOf('private final class MaterialDownloadContext', start);
  const edges = source.slice(source.indexOf('struct BrowserResizeEdges: OptionSet {'), source.indexOf('private final class BrowserPanelResizeHandle'));
  const dock = source.slice(source.indexOf('enum BrowserDockEdge:'), start);
  assert.ok(start >= 0 && end > start);
  const result = spawnSync('xcrun', ['swift', '-'], {encoding: 'utf8', input: `import AppKit\n${edges}\n${dock}\n${source.slice(start, end)}
    for size: CGFloat in [860, 1180, 1440, 1920, 2560, 4036] {
      for ratio: CGFloat in [0.15, 0.44, 0.7, 0.85, 1.0] {
        let browser = BrowserWorkspaceGeometry.browserWidth(totalWidth: size, fraction: ratio)
        precondition(browser >= 360)
        precondition(size - browser >= 430)
      }
    }
    let full = BrowserWorkspaceGeometry.browserWidth(totalWidth: 4036, fraction: 0.7)
    let ordinary = BrowserWorkspaceGeometry.browserWidth(totalWidth: 860, fraction: 0.7)
    precondition(full > ordinary)
    precondition(ordinary <= 430)
    precondition(BrowserWorkspaceGeometry.browserWidth(totalWidth: 0, fraction: 0.44) == 0)
    precondition(BrowserWorkspaceGeometry.browserWidth(totalWidth: .nan, fraction: 0.44) == 0)
    precondition(BrowserWorkspaceGeometry.browserWidth(totalWidth: 860, fraction: .nan).isFinite)
    let bounds = NSRect(x: 0, y: 0, width: 860, height: 600)
    let fitted = BrowserWorkspaceGeometry.floatingFrame(in: bounds, proposed: NSRect(x: -500, y: 4000, width: 2000, height: 2000))
    precondition(bounds.contains(fitted))
    for edges in BrowserResizeEdges.allHandles {
      let resized = BrowserWorkspaceGeometry.resizedFloatingFrame(in: bounds, frame: fitted, edges: edges, delta: NSPoint(x: -3000, y: 3000))
      precondition(bounds.contains(resized))
      precondition(resized.width >= 360 && resized.height >= 260)
    }
  `});
  assert.equal(result.status, 0, result.stderr);
});
