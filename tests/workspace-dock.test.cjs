const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const between = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
};

test('workspace dock uses only the fixed per-mode session map', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const expected = {
    chat: 'agent:main:main',
    project: 'agent:project:main',
    thinking: 'agent:thinking:main',
    learning: 'agent:learning:main',
    unrestricted: 'agent:unrestricted:main',
  };

  for (const [mode, session] of Object.entries(expected)) {
    assert.match(launcher, new RegExp(`"${mode}":\\s*"${session}"`));
  }

  const dock = between(
    launcher,
    'private func openWorkspaceDock(',
    '@objc private func closeWorkspaceDock'
  );
  assert.match(dock, /let canonicalSession = workspaceSessions\[requestedModeID\]/);
  assert.match(dock, /requestedSessionKey == nil \|\| requestedSessionKey == canonicalSession/);
  assert.match(dock, /chatURL\(sessionKey: canonicalSession, docked: true\)/);
  assert.doesNotMatch(dock, /chatURL\(sessionKey:\s*requestedSessionKey/);
});

test('workspace dock is a full-height companion split in the same native window, not another runtime', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const dock = between(
    launcher,
    'private func openWorkspaceDock(',
    '@objc private func closeWorkspaceDock'
  );

  assert.match(launcher, /private var companionWebView: WKWebView\?/);
  assert.match(dock, /let companion = makeChatWebView\(docked: true\)/);
  assert.match(dock, /contentView\.addSubview\(panel\)/);
  assert.match(dock, /companionWebView = companion/);
  assert.doesNotMatch(dock, /let header = NSView/);
  assert.doesNotMatch(dock, /NSButton\(title: "×"/);
  assert.match(dock, /companion\.topAnchor\.constraint\(equalTo: panel\.topAnchor\)/);
  assert.doesNotMatch(dock, /panel\.layer\?\.maskedCorners/);
  assert.match(dock, /primaryFullSizeConstraints\.forEach \{ \$0\.isActive = false \}/);
  assert.match(dock, /panel\.leadingAnchor\.constraint\(equalTo: primaryWebView\.trailingAnchor, constant: -1\)/);
  assert.match(dock, /panel\.widthAnchor\.constraint\(equalTo: primaryWebView\.widthAnchor\)/);
  assert.match(dock, /window\.minSize = splitMinimumSize/);
  assert.doesNotMatch(dock, /\bNSWindow\s*\(/);
  assert.doesNotMatch(dock, /Gateway\.(?:start|stop|repair)\s*\(/);
  assert.doesNotMatch(dock, /DesktopControlService\s*\(/);
});

test('split close action lives in the existing primary dock picker, not a second-pane title bar', () => {
  const mode = read('ui/injections/laolao-mode-switcher.js');
  assert.match(mode,/const closeWorkspaceDock = \(\) =>/);
  assert.match(mode,/bridge\.postMessage\(\{ action: "close" \}\)/);
  assert.match(mode,/hasPrimaryWorkspaceSplit\(\)[\s\S]*?关闭右侧分屏/);
});

test('docked companion route carries an explicit no-splash marker', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const splash = read('ui/injections/laolao-splash.js');
  const urlBuilder = between(launcher, 'private func chatURL(', 'private func trustedFrame');

  assert.match(urlBuilder, /URLQueryItem\(name: "session", value: sessionKey\)/);
  assert.match(urlBuilder, /URLQueryItem\(name: "laolao-dock", value: "1"\)/);
  assert.match(launcher, /data-laolao-workspace-dock/);
  // A dock joins an already open native App. It must not hide its second
  // workspace behind the first-entry video/splash controller.
  assert.match(splash, /laolao-dock/);
  assert.match(splash, /(?:const|let)\s+docked\s*=\s*url\.searchParams\.get\(['"]laolao-dock['"]\)\s*===\s*['"]1['"]/);
  assert.match(splash, /if \(docked\)[\s\S]{0,700}(?:splash\.remove\(\)|leave\(false\)|is-leaving)/);
});

test('split keeps the menu as an overlay and leaves real workspace controls visible', () => {
  const theme = read('ui/injections/laolao-ui-subtraction.css');
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  assert.match(theme, /data-laolao-workspace-split/);
  assert.match(theme, /data-laolao-workspace-dock/);
  assert.match(theme, /grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(theme, /\.sidebar \{[\s\S]*display: flex !important/);
  assert.match(theme, /\.sidebar \{[\s\S]*position: absolute !important/);
  assert.match(theme, /\.sidebar \{[\s\S]*z-index: 80 !important/);
  assert.match(theme, /\.sidebar\.sidebar--collapsed \{[\s\S]*display: none !important/);
  assert.match(theme, /\.shell-nav-backdrop \{[\s\S]*display: none !important[\s\S]*pointer-events: none !important/);
  assert.match(theme, /\.chat-workbench > \.chat-workspace-rail[\s\S]*display: flex !important/);
  assert.match(theme, /--laolao-window-rail-reserve: 44px !important/);
  assert.match(launcher, /sessionStorage\.setItem\('laolao-primary-workspace-split', '1'\)/);
  assert.match(launcher, /sessionStorage\.removeItem\('laolao-primary-workspace-split'\)/);
});

test('session navigation clears a stale mobile drawer in single and split windows', () => {
  const sidebar = read('ui/injections/laolao-sidebar.js');
  assert.match(sidebar, /function closeNavigationDrawer\(\)/);
  assert.match(sidebar, /host\.closeNavDrawer\(\{restoreFocus:false\}\)/);
  assert.match(sidebar, /shell\.navigate\('chat',\{search\}\)/);
  assert.match(sidebar, /\.shell\.shell--nav-drawer-open/);
  assert.match(sidebar, /closeNavigationDrawer\(\);\s*const current=new URL\(window\.location\.href\)/);
  assert.match(sidebar, /target\.closest\('\.shell-nav a\[href\*="session="\]'\)/);
  assert.match(sidebar, /pinkie:app-foreground',closeNavigationDrawer/);
});

test('native bridge always routes companion messages back to their source WKWebView', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const handler = between(
    launcher,
    'func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage)',
    'private var nativeDictationBridge'
  );

  assert.match(handler, /let sourceWebView = message\.webView/);
  assert.match(handler, /if message\.name == workspaceDockHandlerName/);
  assert.match(handler, /openWorkspaceDock\(\s*modeID:[\s\S]{0,160}requestedSessionKey:/);
  assert.match(handler, /openParty\(in: sourceWebView\)/);
  assert.match(handler, /openRoundtable\(in: sourceWebView\)/);
  assert.match(handler, /handleProjectFolderAction\(action, body: body, sourceWebView: sourceWebView\)/);
  assert.match(handler, /isCompanion\(sourceWebView\)/);
  assert.doesNotMatch(handler, /openParty\(nil\)|openRoundtable\(nil\)/);

  const folderBridge = between(launcher, 'private func handleProjectFolderAction(', 'func webView(_ webView: WKWebView, didFailProvisionalNavigation');
  assert.match(folderBridge, /sourceWebView: WKWebView/);
  assert.match(folderBridge, /sendProjectFolderResult\([\s\S]{0,220}to: sourceWebView/);
  assert.match(folderBridge, /private func sendProjectFolderResult\([\s\S]{0,180}to targetWebView: WKWebView/);
  assert.match(folderBridge, /targetWebView\.evaluateJavaScript/);
});

test('a failed companion navigation retries only the dock and never reloads the primary chat', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const failure = between(
    launcher,
    'func webView(_ webView: WKWebView, didFailProvisionalNavigation',
    'private var nativeDictationBridge'
  );
  const companionStart = failure.indexOf('if isCompanion(webView)');
  const primaryStart = failure.indexOf('guard retries < 8');

  assert.notEqual(companionStart, -1, 'companion failures need their own branch');
  assert.ok(primaryStart > companionStart, 'primary retry must happen after the companion branch');
  const companionRetry = failure.slice(companionStart, primaryStart);
  assert.match(companionRetry, /companionRetries/);
  assert.match(companionRetry, /webView\.load\(URLRequest\(url: self\.chatURL\(sessionKey:/);
  assert.match(companionRetry, /self\.companionWebView === webView/);
  assert.doesNotMatch(companionRetry, /loadDashboard\(\)/);
  assert.match(companionRetry, /return/);
  assert.match(failure.slice(primaryStart), /loadDashboard\(\)/);
});

test('foreground recovery reaches both primary and companion chat views', () => {
  const launcher = read('desktop/macos/Sources/Launcher.swift');
  const notifications = between(launcher, 'func applicationDidResignActive', 'private func isCompanion');

  assert.match(notifications, /applicationDidBecomeActive[\s\S]{0,260}notifyWebView\("pinkie:app-foreground"\)/);
  assert.match(notifications, /\[self\.webView, self\.companionWebView\]\.compactMap \{ \$0 \}\.forEach/);
  assert.match(notifications, /target\.evaluateJavaScript\(script/);
});

test('a split always keeps a reachable exit, even when the sidebar is hidden', () => {
  const mode = read('ui/injections/laolao-mode-switcher.js');
  const theme = read('ui/injections/laolao-theme.css');

  // The docked half must own an exit. The primary pane's dock picker is the
  // only other one, and it lives in the sidebar — which collapses to
  // display:none in a narrow split, so relying on it alone can strand the user.
  assert.match(mode, /const DOCK_EXIT_ID = "laolao-dock-exit"/);
  assert.match(mode, /const syncDockExitButton = \(\) =>/);
  assert.match(mode, /button\.id = DOCK_EXIT_ID/);

  // It has to be built before render() bails out on a missing sidebar.
  assert.match(
    mode,
    /syncDockExitButton\(\);\s*\n\s*const identity = document\.querySelector\("\.sidebar-brand__identity"\)/
  );

  // The docked half is allowed to actually request the close. Refusing it here
  // is what left a narrow split with no way back.
  const closeBody = between(mode, 'const closeWorkspaceDock = () =>', 'const DOCK_EXIT_ID');
  assert.match(closeBody, /bridge\.postMessage\(\{ action: "close" \}\)/);
  assert.doesNotMatch(closeBody, /isDockedWorkspace\(\)\) return/);

  // Only the docked half shows it, so it can never appear in a single window,
  // and it hides on the attribute alone even before the node is removed.
  assert.match(theme, /\.laolao-dock-exit \{ display: none !important; \}/);
  assert.match(theme, /html\[data-laolao-workspace-dock="1"\] \.laolao-dock-exit \{/);
  assert.match(theme, /html\[data-laolao-workspace-dock="1"\] \.laolao-dock-exit:focus-visible/);
});
