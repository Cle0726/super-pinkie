const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('native browser workspace is independent from chat modes and keeps one persistent webview', () => {
  const source = read('desktop/macos/Sources/Launcher.swift');

  assert.match(source, /private let browserWorkspaceHandlerName = "laolaoBrowserWorkspace"/);
  assert.match(source, /controller\.add\(self, name: browserWorkspaceHandlerName\)/);
  assert.match(source, /private var browserWebView: WKWebView\?/);
  assert.match(source, /configuration\.websiteDataStore = \.default\(\)/);
  assert.match(source, /private func openBrowserWorkspace\(url: URL\?\)/);
  assert.match(source, /if companionPanel\?\.superview != nil \{\s*closeWorkspaceDock\(nil\)/);
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
  assert.match(mac, /laolao-link-viewer\.js\?v=link4/);
  assert.match(mac, /laolaoBrowserWorkspace/);
  assert.match(windows, /laolao-link-viewer\.js\?v=link4/);
});
