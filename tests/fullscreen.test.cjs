const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'desktop/macos/Sources/Launcher.swift'),
  'utf8',
);

test('native window exposes standard macOS fullscreen controls', () => {
  assert.match(source, /final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate/);
  assert.match(source, /withTitle: "切换全屏"[\s\S]*?#selector\(AppDelegate\.toggleFullScreen\(_:\)\)[\s\S]*?keyEquivalent: "f"/);
  assert.match(source, /fullScreenItem\.keyEquivalentModifierMask = \[\.command, \.control\]/);
  assert.match(source, /window\.collectionBehavior\.insert\(\.fullScreenPrimary\)/);
  assert.match(source, /window\.delegate = self/);
  assert.match(source, /window\?\.toggleFullScreen\(sender\)/);
});

test('sidebar fullscreen icon uses the native window bridge', () => {
  assert.match(source, /private let windowControlHandlerName = "laolaoWindowControl"/);
  assert.match(source, /controller\.add\(self, name: windowControlHandlerName\)/);
  assert.match(source, /const actions = document\.querySelector\("\.sidebar-footer-bar"\);/);
  assert.match(source, /id = "pinkie-window-fullscreen"/);
  assert.match(source, /laolaoWindowControl\?\.postMessage\(\{ action: "toggle-fullscreen" \}\)/);
  assert.match(source, /body\["action"\] as\? String == "toggle-fullscreen"/);
  assert.match(source, /进入全屏 \(⌃⌘F\)/);
  assert.match(source, /退出全屏 \(Esc\)/);
});

test('fullscreen removes only the custom rounded frame and restores it on exit', () => {
  assert.match(source, /contentView\.layer\?\.cornerRadius = active \? 0 : 22/);
  assert.match(source, /contentView\.layer\?\.borderWidth = active \? 0 : 1/);
  assert.match(source, /func windowDidEnterFullScreen[\s\S]*?notifyFullScreenState\(true\)/);
  assert.match(source, /func windowDidExitFullScreen[\s\S]*?setFullScreenChrome\(false\)[\s\S]*?clampWindowToVisibleScreen\(\)/);
});
