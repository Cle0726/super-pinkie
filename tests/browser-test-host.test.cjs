// The acceptance host must not be able to reach the installed app's services.
// These checks are textual on purpose: the guard lives inside Launcher.swift,
// and a typo in it would silently point a test run at live state.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const launcher = fs.readFileSync(path.join(root, 'desktop/macos/Sources/Launcher.swift'), 'utf8');
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

test('test-host mode is explicit and opt-in', () => {
  assert.match(launcher, /static let isTestHost = ProcessInfo\.processInfo\.environment\["PINKIE_TEST_HOST"\] == "1"/);
  assert.match(launcher, /PINKIE_STATE_ROOT/);
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
  assert.match(hostScript, /PINKIE_TEST_HOST=1/);
  // It must reuse the real sources rather than a re-implementation.
  assert.match(hostScript, /Sources\/BrowserControl\.swift/);
  assert.match(hostScript, /Sources\/Launcher\.swift/);
  // And must not touch the installed app or its state.
  assert.doesNotMatch(hostScript, /\/Applications\/超級碧琪\.app/);
  assert.doesNotMatch(hostScript, /open -a/);
});
