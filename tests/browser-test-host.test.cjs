// The acceptance host must not be able to reach the installed app's services.
// These checks are textual on purpose: the guard lives inside Launcher.swift,
// and a typo in it would silently point a test run at live state.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const launcher = fs.readFileSync(path.join(root, 'desktop/macos/Sources/Launcher.swift'), 'utf8');
const control = fs.readFileSync(path.join(root, 'desktop/macos/Sources/BrowserControl.swift'), 'utf8');
const build = fs.readFileSync(path.join(root, 'desktop/macos/build.sh'), 'utf8');
const hostScript = fs.readFileSync(path.join(root, 'desktop/macos/browser-test-host.sh'), 'utf8');

test('the browser controller is actually compiled into the app', () => {
  // Regression: BrowserControl.swift existed but build.sh compiled only two
  // files, so every native browser symbol was missing at link time and the
  // shipped app could not fall back to its own browser.
  assert.match(build, /Sources\/BrowserControl\.swift/, 'build.sh must compile BrowserControl.swift');
  assert.match(build, /Sources\/Launcher\.swift/);
  assert.match(build, /Sources\/MaterialPreview\.swift/);
});

test('test-host mode is compiled into the acceptance binary, not only injected', () => {
  // A previously shipped host was only safe through the shell wrapper: opening
  // the .app from Finder/CUA fell through to the production path (live config,
  // live state, 18789). Isolation must be a property of the binary.
  assert.match(launcher, /#if CLE_BROWSER_TEST_HOST/);
  assert.match(launcher, /static let isTestHost: Bool = \{/);
  assert.match(hostScript, /-D CLE_BROWSER_TEST_HOST/, 'the test build defines the flag');
  assert.match(launcher, /CLE_BROWSER_TEST_HOST_ALWAYS=1/);
  assert.match(launcher, /--browser-test-self-check/);
});

test('test host defaults derive from the build, before any environment', () => {
  const start = launcher.indexOf('static let stateRoot');
  const stateBlock = launcher.slice(start, launcher.indexOf('private static let values', start));
  assert.match(stateBlock, /isTestHost \? base\.appendingPathComponent\("browser-test"/, 'default state root is isolated');

  const gwStart = launcher.indexOf('static let gatewayURL');
  const gwBlock = launcher.slice(gwStart, launcher.indexOf('static let speechURL', gwStart));
  assert.match(gwBlock, /isTestHost \? "http:\/\/127\.0\.0\.1:19789\/" : "http:\/\/127\.0\.0\.1:18789\/"/);

  const cfg = launcher.slice(launcher.indexOf('private static let values'), launcher.indexOf('private static func string('));
  assert.match(cfg, /else if isTestHost \{/, 'config path branches on the compiled flag');
  assert.doesNotMatch(cfg, /^\s*if isTestHost, ProcessInfo/, 'no longer requires an env var to skip live config');
});

test('test host refuses the live gateway port and non-loopback hosts', () => {
  const start = launcher.indexOf('static let gatewayURL');
  const end = launcher.indexOf('static let speechURL', start);
  const block = launcher.slice(start, end);
  assert.match(block, /isTestHost/);
  assert.match(block, /url\.port == 18789/);
  assert.match(block, /localhost/);
  assert.match(block, /127\.0\.0\.1:19789/, 'falls back to the test gateway, never live');
});

test('test host never spawns, signals or replaces a gateway', () => {
  const start = launcher.indexOf('static func start()');
  const end = launcher.indexOf('static func ready(', start);
  const block = launcher.slice(start, end);
  assert.match(block, /guard !RuntimeConfig\.isTestHost else/, 'start() must bail out in test mode');

  const repair = launcher.slice(launcher.indexOf('static func repair()'), launcher.indexOf('private final class DesktopControlService'));
  assert.match(repair, /guard !RuntimeConfig\.isTestHost else \{ return \}/);

  // Attachment path must be read-only: poll readiness, nothing else.
  const attach = launcher.slice(launcher.indexOf('static func attachToExisting'), start);
  assert.match(attach, /isReady/);
  assert.doesNotMatch(attach, /\.terminate\(\)/, 'attach must never terminate a listener');
  assert.doesNotMatch(attach, /Darwin\.kill/, 'attach must never signal a listener');
  assert.doesNotMatch(attach, /start\(\)/, 'attach must never start a gateway');
});

test('test host does not start the desktop driver or the bundled installer', () => {
  const desktop = launcher.slice(launcher.indexOf('private final class DesktopControlService'));
  const startFn = desktop.slice(desktop.indexOf('func start()'), desktop.indexOf('private func startDriver()'));
  assert.match(startFn, /guard !RuntimeConfig\.isTestHost else \{ return \}/);

  // A call site appears before the declaration, so search for the definition
  // ("private func ...") rather than the first mention.
  const services = launcher.indexOf('private func startBundledServices()');
  assert.ok(services > 0, 'bundled service path exists');
  assert.ok(launcher.includes('private func startTestHostServices()'), 'a test-only service path exists');
  const testStart = launcher.indexOf('private func startTestHostServices()');
  const testEnd = services;
  assert.ok(testStart > 0 && testEnd > testStart, 'test-host service function is delimited');
  const body = launcher.slice(testStart, testEnd);
  assert.match(body, /configureBrowserControl\(\)/);
  assert.match(body, /attachToExisting/, 'attaches to the running test gateway');
  assert.doesNotMatch(body, /desktopControl\.start\(\)/, 'no CUA driver in the test host');
  assert.doesNotMatch(body, /tts\.ready|party\.ready|roundtable\.ready/, 'no live media services');
  assert.doesNotMatch(body, /BundledSetup\.apply\(\)/, 'never run the installer');
});

test('test host launch script targets 19789 with an isolated bundle id and state', () => {
  assert.match(hostScript, /CLE_TEST_PORT:-19789/);
  assert.match(hostScript, /com\.cle0726\.super-pinkie\.browser-test/);
  assert.match(hostScript, /SuperPinkie\/browser-test/);
  // It must reuse the real sources rather than a re-implementation.
  assert.match(hostScript, /Sources\/BrowserControl\.swift/);
  assert.match(hostScript, /Sources\/Launcher\.swift/);
  // And must not touch the installed app or its state.
  assert.doesNotMatch(hostScript, /\/Applications\/超級碧琪\.app/);
  assert.doesNotMatch(hostScript, /open -a/);
});

test('native chrome uses the real tokens, not a third hand-mixed palette', () => {
  const control = fs.readFileSync(path.join(root, 'desktop/macos/Sources/BrowserControl.swift'), 'utf8');
  const tokens = fs.readFileSync(path.join(root, 'services/cle-studio/src/styles/tokens.css'), 'utf8');
  // Light + dark values that must match the stylesheet exactly.
  assert.match(tokens, /--cle-paper: #F4EFE4/);
  assert.match(tokens, /--cle-paper: #0A0D16/);
  assert.match(tokens, /--cle-surface: #111522/);
  assert.match(tokens, /--cle-gaze: #5AA8FF/);
  assert.match(control, /--paper:#F4EFE4/);
  assert.match(control, /--paper:#0A0D16/);
  assert.match(control, /--surface:#111522/);
  assert.match(control, /--gaze:#5AA8FF/);
  // The warm-brown night palette that drifted away from the tokens is gone.
  assert.doesNotMatch(control, /#161412/);
  assert.doesNotMatch(control, /#1f1c19/);
});

test('startup and start pages never fall back to the old brand', () => {  assert.doesNotMatch(launcher, /◷/, 'no unicode clock standing in for the brand mark');
  assert.doesNotMatch(launcher, /background:#efcbd3/, 'no pink startup fallback');
  assert.doesNotMatch(launcher, /超級碧琪正在准备/);
  assert.match(launcher, /CleWordmark\.html\(pointSize:/, 'uses the app wordmark');
  // The re-assembled pen-outline glyph read as a heavy block on screen; the
  // wordmark must stay text, not a new SVG lettering.
  assert.doesNotMatch(launcher, /CleWordmark\.startPageSVG/);
  assert.doesNotMatch(control, /startPageSVG/);
  assert.doesNotMatch(control, /M55 25C53 17 44 13 34 16/, 'no hand-reassembled signature path');
  // Must match the app's own `.cle-brandmark` styling (italic serif, -.015em).
  const wordmark = control.slice(control.indexOf('enum CleWordmark'), control.indexOf('final class BrowserActivityIndicator'));
  assert.match(wordmark, /italic /);
  assert.match(wordmark, /letter-spacing:-\.015em/);
  assert.match(wordmark, /C\.le\./);
  // The original 超級碧琪 build keeps its opening art; the test host and the C.le. app
  // (Info.plist CLEBrand = cle) open on the C.le. placeholder instead.
  assert.match(launcher, /if RuntimeConfig\.isTestHost \|\| RuntimeConfig\.isCleBrand \{\s*\n\s*webView\?\.loadHTMLString\(startupPlaceholderHTML/);
});

test('native window chrome and voice entry no longer use the old pink identity', () => {
  // The outer window hairline was hard-coded to the pink (217,89,143) used by
  // the previous skin, so the whole acceptance window still read as pink.
  assert.doesNotMatch(launcher, /217\.0 \/ 255\.0,?\s*\n?\s*green: 89\.0/, 'pink window border removed');
  const border = launcher.slice(launcher.indexOf('contentView.layer?.borderWidth = 1'));
  assert.match(border.slice(0, 400), /CleBrowserPalette\.line\(nightAppearance\)/, 'border follows the token line');
  assert.doesNotMatch(launcher, /NSColor\.systemPink/);

  // Visible voice-entry copy is 碧琪 now. macOS permission strings keep the
  // bundle's real name on purpose: renaming them would send the user looking for
  // a switch that does not exist in System Settings.
  assert.doesNotMatch(launcher, /"碧琪听着呢"/);
  assert.match(launcher, /"碧琪听着呢"/);
  assert.doesNotMatch(launcher, /碧琪还没有麦克风权限/);
  assert.match(launcher, /碧琪还没有麦克风权限/);
  // Those permission strings must still name the app bundle the OS shows.
  assert.match(launcher, /允许超級碧琪使用麦克风/);
});

test('the test host can bind its browser endpoint to an already-running gateway', () => {
  // The host never spawns a gateway, so the running 19789 process never received
  // PINKIE_APP_BROWSER_ENDPOINT and was never an allowedPeer root. Without this
  // path the real model simply cannot reach the native browser.
  assert.match(launcher, /Gateway\.attachToExisting/);
  assert.match(launcher, /adoptTestGatewayForBrowserControl\(\)/);
  assert.match(launcher, /BrowserControlEndpoint\.adoptExistingGateway\(/);
  assert.match(control, /static func adoptExistingGateway\(_ pid: pid_t\)/);
  // The adopted gateway may ask for the credential it was never handed...
  assert.match(control, /body\["op"\] as\? String == "handshake"/);
  // ...but only after the ordinary peer checks, and only with its own proof.
  const serve = control.slice(control.indexOf('private func serve(_ client: Int32'));
  const handshakeAt = serve.indexOf('op"] as? String == "handshake"');
  const allowedAt = serve.indexOf('Self.allowedPeer(peer)');
  assert.ok(allowedAt > 0 && handshakeAt > allowedAt, 'peer check still precedes the handshake');
  assert.match(serve, /Self\.adoptedPeerIsVerifiedGateway\(peer\)/);
  // And the token still gates every real action.
  assert.match(serve, /candidate == token/);
});

test('adoption refuses anything that is not the 19789 profile', () => {
  // Port pinning: never the installed app's gateway.
  assert.match(launcher, /guard port == 19789 else \{ return \.refuse/);
  // Provenance by live state ownership, not by process name.
  assert.match(launcher, /Gateway\.listenerOwnsState\(listener\.pid, stateRoot: expectedState\)/);
  assert.match(launcher, /state\/openclaw\.sqlite/);
  assert.match(launcher, /\.openclaw-cle/);
  // Exact path equality: a prefix match would accept a lookalike directory.
  assert.match(launcher, /canonicalActual == canonicalExpected/);
  assert.doesNotMatch(launcher, /hasPrefix\(canonicalExpected\)/);
  // Adoption must never spawn, signal or restart a gateway.
  const adopt = launcher.slice(launcher.indexOf('private func adoptTestGatewayForBrowserControl'));
  const body = adopt.slice(0, adopt.indexOf('enum TestGatewayDecision'));
  assert.doesNotMatch(body, /Gateway\.start\(\)/);
  assert.doesNotMatch(body, /\.terminate\(\)/);
  assert.doesNotMatch(body, /Darwin\.kill/);
});

test('the endpoint descriptor stays private and is removed on quit', () => {
  const publish = launcher.slice(launcher.indexOf('private func publishTestEndpointDescriptor'));
  const body = publish.slice(0, publish.indexOf('func publishEndpointDescriptorForCheck'));
  // Owner-only directory and file, and the file must not outlive the endpoint.
  assert.match(body, /posixPermissions: 0o700/);
  assert.match(body, /posixPermissions: 0o600/);
  assert.match(launcher, /try\? FileManager\.default\.removeItem\(at: descriptor\)/);
  // It is written only in the isolated host and only under browser-test.
  assert.match(body, /guard RuntimeConfig\.isTestHost/);
  assert.match(launcher, /browser-test/);
  // The token must never be logged or printed.
  assert.doesNotMatch(launcher, /print\([^)]*token/i);
  assert.doesNotMatch(launcher, /NSLog\([^)]*endpoint[^)]*encoded/i);
});
