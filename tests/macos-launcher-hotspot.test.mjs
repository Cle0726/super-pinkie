// HOTSPOTS（briefs/maintenance-1120/HOTSPOTS.md）第 17 名 Launcher.swift、第 24 名 desktop/macos/build.sh 的复发测试。
// Linux 上编不了 Swift，这里只对源码文本做静态断言：每条都对应一次近 60 天的修复提交，
// 只回退那次修复时它会变红。已被其它测试锁住的修复不在这里重复。
// M4 拆分后 Launcher.swift 的内容散在 Launcher*.swift，整体读取，不绑定某个文件的某一行
// （#216 正在改 Launcher.swift 的入口与 App 窗口部分，这里不对那几行做位置断言）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = path.join(root, 'desktop/macos/pinkie/Sources');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const launcher = () => fs.readdirSync(sources).filter(n => /^Launcher.*\.swift$/.test(n)).sort()
  .map(n => fs.readFileSync(path.join(sources, n), 'utf8')).join('\n');
const build = () => read('desktop/macos/build.sh');

// 取一个 Swift 方法体：从签名起，到下一个同级方法或类型 / 扩展的结束为止。
function body(text, signature) {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `缺少 ${signature}`);
  const rest = text.slice(start + signature.length);
  const next = rest.search(/\n    (?:@\w+ )*(?:private |fileprivate )?func |\n}\n/);
  return text.slice(start, next < 0 ? undefined : start + signature.length + next);
}

// 在整段文本里找某个写法第一次出现的位置，找不到直接报出是哪一条。
function at(text, needle, what) {
  const index = typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
  assert.ok(index >= 0, `缺少 ${what}`);
  return index;
}

test('d3490c35：内置浏览器的 alert / confirm / prompt 有原生回调，且只接管内置浏览器', () => {
  const text = launcher();
  // 没有 uiDelegate，下面三个回调永远不会被调用，WebKit 一律按「取消」处理。
  assert.match(text, /browser\.uiDelegate = self/);
  const alert = body(text, 'runJavaScriptAlertPanelWithMessage message: String');
  const confirm = body(text, 'runJavaScriptConfirmPanelWithMessage message: String');
  const prompt = body(text, 'runJavaScriptTextInputPanelWithPrompt prompt: String');
  // App 自己的界面不接管：不是内置浏览器的页面保持原来的默认行为。
  for (const [method, cancel, kind] of [[alert, 'completionHandler()', 'alert'], [confirm, 'completionHandler(false)', 'confirm'], [prompt, 'completionHandler(nil)', 'prompt']]) {
    assert.ok(method.includes(`guard webView === browserWebViewForDialogs else { ${cancel}; return }`), `${kind} 没有只限内置浏览器`);
    // 碧琪 / Metre 引起的对话框由 BrowserControl 按要求自动答，用户自己点出来的才弹系统对话框。
    assert.ok(method.includes(`browserControlForDialogs.answerDialog(kind: "${kind}"`), `${kind} 没有先问 BrowserControl`);
    assert.ok(at(method, 'answerDialog(', kind) < at(method, 'browserDialog(webView,', `${kind} 的系统对话框`));
  }
  // confirm 的「确定」必须真的回 true，prompt 必须把输入的文字交回页面。
  assert.match(confirm, /completionHandler\(answer\.accept\)/);
  assert.match(confirm, /\{ ok, _ in completionHandler\(ok\) \}/);
  assert.match(prompt, /completionHandler\(answer\.accept \? \(answer\.text \?\? defaultText \?\? ""\) : nil\)/);
  assert.match(prompt, /field: defaultText \?\? ""/);
  assert.match(prompt, /completionHandler\(ok \? \(text \?\? ""\) : nil\)/);
  const dialog = body(text, 'func browserDialog(');
  assert.match(dialog, /done\(response == \.alertFirstButtonReturn, input\?\.stringValue\)/);
  assert.match(dialog, /beginSheetModal\(for: window, completionHandler: finish\)/);
  // 页面还没挂到窗口上时也要给结果，不能让 completionHandler 永远不被调用。
  assert.match(dialog, /else \{ finish\(alert\.runModal\(\)\) \}/);
});

test('8ec72459：更新进度卡是重签过的可执行文件副本，被持有、常驻，并在旧 App 退出前就已启动', () => {
  const text = launcher();
  // NSApp.delegate 是 weak：不另外持有，进度卡出现前就被释放（修复前的现象：卡片一闪而过或根本不出现）。
  assert.match(text, /enum UpdateProgressHold \{\s*static var controller: UpdateProgressController\?/);
  assert.match(text, /UpdateProgressHold\.controller = controller/);
  assert.match(text, /app\.delegate = controller/);
  const cardStart = at(text, 'final class UpdateProgressController', '进度卡控制器');
  const cardEnd = text.indexOf('\n}\n', cardStart);
  const card = text.slice(cardStart, cardEnd < 0 ? undefined : cardEnd);
  // 旧 App 退出、焦点离开时卡片也不能自己藏起来。
  assert.match(card, /panel\.hidesOnDeactivate = false/);
  assert.match(card, /panel\.level = \.floating/);
  assert.match(card, /\.nonactivatingPanel/);
  // 读 updater 写的进度文件；完成后停 2 秒、失败停 8 秒再退出，失败信息要来得及看。
  assert.match(card, /Data\(contentsOf: file\)/);
  assert.match(card, /state == "done" \? 2 : 8/);
  assert.match(card, /NSApp\.terminate\(nil\)/);

  const spawn = body(text, 'private func spawnUpdateProgress(');
  // 不能直接跑 App 包里的那份：更新时 /Applications/超級碧琪.app 被删掉会把卡片一起带走。
  assert.match(spawn, /copyItem\(at: executable, to: staged\)/);
  assert.match(spawn, /posixPermissions: 0o755/);
  assert.match(spawn, /"\/usr\/bin\/codesign"[\s\S]*\["--force", "--sign", "-", staged\.path\]/);
  assert.match(spawn, /progress\.executableURL = staged/);
  assert.doesNotMatch(spawn, /progress\.executableURL = executable/);
  assert.match(spawn, /\["--update-progress", file\.path\]/);

  const launch = body(text, 'private func launchDetachedUpdate(');
  const initial = at(launch, /try initial\.write\(to: progressFile/, '初始进度文件');
  const spawned = at(launch, 'spawnUpdateProgress(executable: Bundle.main.executableURL, file: progressFile', '启动进度卡');
  const env = at(launch, 'environment["PINKIE_UPDATE_PROGRESS_FILE"] = progressFile.path', '把进度文件交给 updater');
  const run = at(launch, 'try task.run()', '启动 updater');
  const quit = at(launch, 'NSApp.terminate(nil)', '旧 App 退出');
  // 进度文件先写好、卡片先起来，旧 App 才退出；否则换包期间屏幕上什么都没有。
  assert.ok(initial < spawned && spawned < run && env < run && run < quit, '进度卡必须在旧 App 退出前启动');
});

test('86d04f2e：「用默认应用打开」先过文档白名单，脚本 / 安装包 / App 不交给 macOS 打开', () => {
  const text = launcher();
  const start = at(text, 'case "reveal", "open-default":', 'open-default 分支');
  const end = text.indexOf('\n        default:', start);
  const branch = text.slice(start, end < 0 ? undefined : end);
  const guard = at(branch, '!MaterialPreviewFileAccess.canOpenWithDefaultApp(file)', '默认应用白名单检查');
  const open = at(branch, 'NSWorkspace.shared.open(file)', '交给默认应用');
  assert.ok(guard < open, '白名单检查必须在 NSWorkspace.open 之前');
  assert.match(branch.slice(guard, open), /"ok": false[^\n]*为了安全，这类文件不直接打开/);
  // 路径来自模型输出，只有「显示在访达」不受白名单限制。
  assert.ok(at(branch, 'activateFileViewerSelecting([file])', '访达显示') < guard);

  const preview = read('desktop/macos/pinkie/Sources/MaterialPreview.swift');
  assert.match(preview, /defaultAppDocumentExtensions\.contains\(url\.pathExtension\.lowercased\(\)\)/);
  const list = preview.match(/static let defaultAppDocumentExtensions: Set<String> = \[([\s\S]*?)\]/);
  assert.ok(list, '缺少默认应用白名单');
  const allowed = new Set([...list[1].matchAll(/"([^"]+)"/g)].map(m => m[1]));
  for (const ext of ['pdf', 'docx', 'png', 'mp4']) assert.ok(allowed.has(ext), `白名单应包含 ${ext}`);
  for (const ext of ['sh', 'zsh', 'command', 'tool', 'app', 'pkg', 'mpkg', 'dmg', 'scpt', 'applescript', 'workflow', 'terminal', 'py', 'js', 'jar', 'html', 'htm', 'webloc', 'inetloc', 'fileloc']) {
    assert.ok(!allowed.has(ext), `默认应用白名单不得包含可执行类型 ${ext}`);
  }
});

test('aeff5aa6：build.sh 整目录带上 mode-architecture，并在签名前用 check_runtime.py 验包', () => {
  const sh = build();
  // check_runtime.py 的非零退出必须让打包失败。
  assert.match(sh, /^set -euo pipefail$/m);
  const shortlist = at(sh, 'for architecture_file in ', 'mode-architecture 旧清单');
  // setup.py 还会装 learning / workbench / vendor 等被 import 的模块，旧清单漏文件会让新装机起不来。
  const whole = at(sh, 'ditto --norsrc --noextattr "$REPO_ROOT/services/mode-architecture" "$CONTENTS/Resources/SuperPinkie/services/mode-architecture"', '整目录复制 mode-architecture');
  assert.ok(shortlist < whole);
  const check = at(sh, /"\$PYTHON_DRIVER" "\$REPO_ROOT\/tools\/macos-package\/check_runtime\.py" \\\n\s+--resource-root "\$CONTENTS\/Resources\/SuperPinkie" --node "\$RUNTIME_ROOT\/bin\/node"/, 'check_runtime.py 验包');
  assert.doesNotMatch(sh, /check_runtime\.py[^\n]*\|\| true/);
  const theme = at(sh, '/bin/bash "$REPO_ROOT/installer/macos/apply-theme.sh"', 'apply-theme.sh');
  const skills = at(sh, 'apply-pinkie-managed-skills.mjs', 'managed skills 补丁');
  const sign = at(sh, /codesign --force[^\n]*"\$APP_PATH"/, 'App 签名');
  // 验的是补丁打完后的最终内容，而且必须在签名之前（签名后再失败等于发出一个坏包的签名）。
  assert.ok(whole < check && theme < check && skills < check && check < sign, 'check_runtime.py 的位置不对');
});

test('ed92f571：内置技能每次都打进 bundled-skills，缺技能即失败，managed skills 补丁不带条件', () => {
  const sh = build();
  const loop = sh.match(/\nfor skill in deep-think pinkie-deep-research web-gpt-collab[^\n]*; do\n([\s\S]*?)\ndone\n/);
  assert.ok(loop, '缺少内置技能循环（且必须在顶层，不在品牌条件里）');
  assert.match(loop[1], /\[\[ -f "\$REPO_ROOT\/skills\/\$skill\/SKILL\.md" \]\] \|\| \{ echo "missing skill: \$skill" >&2; exit 1; \}/);
  assert.match(loop[1], /"\$CONTENTS\/Resources\/SuperPinkie\/bundled-skills\/\$skill"/);
  // 放进 Resources/SuperPinkie/skills/ 会被常规 setup 当成源，覆盖用户工作区里的版本。
  assert.doesNotMatch(sh, /Resources\/SuperPinkie\/skills\//);
  assert.match(sh, /^OPENCLAW_ROOT="\$RUNTIME_ROOT\/openclaw" "\$RUNTIME_ROOT\/bin\/node" "\$REPO_ROOT\/patch\/apply-pinkie-managed-skills\.mjs"$/m);
  assert.doesNotMatch(sh, /\]\] && OPENCLAW_ROOT=[^\n]*apply-pinkie-managed-skills|\]\] \|\| OPENCLAW_ROOT=[^\n]*apply-pinkie-managed-skills/);
});

test('c092fc4b：只打包产出可执行文件的那份原生源码，并在签名前核对共享 UI 清单', () => {
  const sh = build();
  assert.match(sh, /^ditto "\$NATIVE_SOURCE_DIR" "\$CONTENTS\/Resources\/SuperPinkie\/desktop\/macos\/pinkie\/Sources"$/m);
  // 旧的 desktop/macos/Sources 副本会让修复工具选到另一套源码。
  assert.doesNotMatch(sh, /SuperPinkie\/desktop\/macos\/Sources/);
  // 包里要带 bundle.py，装机时才能重装共享 UI。
  assert.match(sh, /cp "\$REPO_ROOT\/tools\/ui-parity\/bundle\.py" "\$CONTENTS\/Resources\/SuperPinkie\/tools\/ui-parity\/"/);
  const ui = at(sh, /"\$PYTHON_DRIVER" "\$REPO_ROOT\/tools\/ui-parity\/bundle\.py" check \\\n\s+--control-ui "\$RUNTIME_ROOT\/openclaw\/dist\/control-ui" --output "\$OUTPUT_ROOT\/macos-ui-manifest\.json"/, 'bundle.py check');
  assert.doesNotMatch(sh, /bundle\.py" check[^\n]*\|\| true/);
  const theme = at(sh, '/bin/bash "$REPO_ROOT/installer/macos/apply-theme.sh"', 'apply-theme.sh');
  const sign = at(sh, /codesign --force[^\n]*"\$APP_PATH"/, 'App 签名');
  // 共享 UI 由 apply-theme.sh 装进 control-ui；核对必须在它之后、签名之前。
  assert.ok(theme < ui && ui < sign, 'bundle.py check 的位置不对');
});
