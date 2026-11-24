# M4 返工 · 恢复拆分前的 Windows 运行时行为 · 执行记录

## 接力卡（最后更新：2026-11-24 08:45 UTC，Claude Code 接手执行者 @ Windows）

- 状态：**已合并**（[PR #62](https://github.com/Cle0726/super-pinkie/pull/62)，合并提交 `44639398`）
- 分支和 PR：`maint/m4-fix-runtime`（已变基到 `origin/main` `815c0f78`），[PR #62](https://github.com/Cle0726/super-pinkie/pull/62)
- 已完成（第 2 轮）：
  1. 变基到最新 origin/main，补上 `app.` 兜底导入；修好 Linux 上 lock_tampered 测试的 WindowsPath 报错。
  2. verifyAfterCommand 偶发失败：main 上同样出现，根因是 statKey 在同大小、同 mtime 时跳过检查，和 #64 的 EBUSY 不是同一件事（#64 已合入 main）。
  3. 6 个函数的字节码差异来自 Python 3.13 类体 `__firstlineno__` 常量，属于编译差异；冻结包 PYZ 实测 11 个模块全走 `get_code`，没有 NameError。
  4. 测试不再弹窗：单独提交（原 7af633bd，变基后 9c671274），只改 `tests/windows_portable_update_integration_test.py`，产品代码没动。
  5. 同环境全量对照：门禁两边各 61 条、Python 两边各 6 条，失败集合相同，新增 0。
  6. Z1 逐文件单独重跑（07:58–08:10 UTC，持 gate.lock）：便携更新测试两边失败的是同样 4 条；`windows_update_leftovers_test` 本分支 8/8 过，main 侧导入失败（`No module named release_notes`，正是本 PR 修的问题）。新增 0；我方目录弹窗 0；弹窗守护对我方目录 0 次动作。
  7. Z2 收工快照已填并逐行判定（见第一节）；工作区里的 `%SystemDrive%` 缓存目录（4 个 shell 缓存 .db）已删。
  8. 变基后新头 `84b5cd4f`：CI 45354088826 四项全绿；windows-smoke 45354095909（package=build）success，`[probe] metre-sidebar` passed，`overall passed=True`。
- 证据：PR #62 评论 https://github.com/Cle0726/super-pinkie/pull/62#issuecomment-7121337486；本机 `F:\Projects\super-pinkie\build\quick-run\m4\`（`full/sets-br3.json`、`full/sets-main3.json`、`full/z1b-*-r1.txt`、`watch-z1b.log`、`z2-close.txt`、`z2-explain.txt`、`smoke-45354095909-84b5cd4f.log`）。
- 下一步：协调者复验后合并。
- 没推送的东西：无
- 待用户决定：无

---

## 一、正式环境只读现场快照（Z2 ★）

| 现场项 | 开工（`2026-11-22 00:35 -08:00`） | 收工（`2026-11-24T06:05:25Z`） | 一致性 |
|---|---|---|---|
| `%USERPROFILE%\.openclaw\openclaw.json`（UTC） | `2026-11-22T05:54:19.7689912Z` | `2026-11-22T05:54:19.7689912Z` | 一致 |
| `%LOCALAPPDATA%\Programs\SuperPinkie`（UTC） | `2026-11-22T05:52:01.5063045Z` | `2026-11-22T11:43:02.2791553Z` | 有变化，已解释，不是本线测试：已安装 App 自己升级替换了安装目录（同一时刻 App 自己的 `updates\progress-da19e055….json.shown` 出现于 `11:42:54Z`），时间落在第 1 轮收工（约 `11-22 09:06Z`）与第 2 轮开工（`11-24 00:23Z`）之间，M4 当时没在跑 |
| `%LOCALAPPDATA%\SuperPinkie`（UTC） | `2026-11-22T06:13:57.8543828Z` | `2026-11-23T06:54:31.2455938Z` | 有变化，已解释，不是本线测试：App 关闭时写入的 `gateway-closed-by-app`（`11-23T06:54:32Z`），同样在两轮之间；第 2 轮期间该目录与 `updates` 无任何写入 |
| `18789` 端口监听进程 | `127.0.0.1:18789 Listen PID 32388`（开工前已存在） | 无监听 | 有变化，已解释：用户在 `11-23 06:54Z` 关闭了 App（见上一行关闭标记）；本线测试全部用隔离端口，不碰 18789 |
| C 盘剩余空间 | `16.07 GB`（> 8 GB） | `12.11 GB`（> 8 GB） | 通过：M4 自身约 0.5 GB（工作区 432 MB、临时目录 87 MB），其余来自其他线新建的工作区与临时目录 |

收工快照只读元数据（修改时间、名字、PID、可用空间），证据：`F:\Projects\super-pinkie\build\quick-run\m4\z2-close.txt`、`z2-explain.txt`。结论：**Z2 ★ 过**（唯一被我们写过的正式文件 0 个；三处变化都来自用户使用已安装 App，且都发生在本线两轮之间的空窗）。

---

## 二、基线复现与修复前红灯证据（`origin/main` `1bbe9214`）

### 2.1 协调者证据脚本独立复现（修复前）

1. `python C:\Users\34786\AppData\Local\Temp\pinkie-m4-rework-7c4e\evidence\undef.py v2.5.53 3cd2ac6f 1bbe9214`（退出码 `0`）：
   ```text
   == v2.5.53: 20 files, 0 undefined
   == 3cd2ac6f: 20 files, 0 undefined
   1bbe9214       app/windows_bridge.py:[851] undefined configure_native_corners
   1bbe9214       app/windows_bridge.py:[851] undefined configure_native_glass
   1bbe9214       app/windows_gateway.py:[478] undefined traceback
   1bbe9214       app/windows_runtime.py:[184] undefined hidden_process_kwargs
   1bbe9214       app/windows_runtime.py:[146] undefined urllib
   1bbe9214       app/windows_update_guard.py:[370] undefined hidden_process_kwargs
   1bbe9214       app/windows_update_guard.py:[297] undefined openclaw_config_path
   1bbe9214       app/windows_update_guard.py:[455] undefined state_root
   == 1bbe9214: 28 files, 8 undefined
   ```
2. `python C:\Users\34786\AppData\Local\Temp\pinkie-m4-rework-7c4e\evidence\call.py C:\Users\34786\Projects\pinkie-wt\m4-rework-exec`（修复前 `1bbe9214`，退出码 `0`）：
   ```text
     FAIL DesktopControlNode._arguments: NameError: name 'urllib' is not defined
     FAIL has_guard_receipt (default path): NameError: name 'openclaw_config_path' is not defined
     FAIL process_guard_alerts (as the app calls it): NameError: name 'state_root' is not defined
   ```

### 2.2 修复前两类新增测试在 `1bbe9214` 上红灯复现（最终测试版本）

1. `python -m unittest -v tests/app_undefined_names_test.py`（于 `1bbe9214` 归档 `app/`，退出码 `1`）：
   ```text
   AssertionError: ... Undefined global names found in app/**/*.py:
   app/windows_bridge.py:[851] undefined configure_native_corners
   app/windows_bridge.py:[851] undefined configure_native_glass
   app/windows_gateway.py:[478] undefined traceback
   app/windows_runtime.py:[184] undefined hidden_process_kwargs
   app/windows_runtime.py:[146] undefined urllib
   app/windows_update_guard.py:[370] undefined hidden_process_kwargs
   app/windows_update_guard.py:[297] undefined openclaw_config_path
   app/windows_update_guard.py:[455] undefined state_root
   Ran 3 tests in 0.685s
   FAILED (failures=1)
   ```
2. `python -m unittest -v tests/windows_desktop_split_runtime_test.py`（于 `1bbe9214` 归档 `app/`，退出码 `1`）：
   ```text
   Ran 9 tests in 1.065s
   FAILED (failures=4, errors=5)
   ```
   - `test_process_guard_alerts_release_build_default_app_state_and_tamper_receipt`：`NameError: name 'state_root' is not defined`
   - `test_has_guard_receipt_default_openclaw_state_resolves_openclaw_config_path`：`NameError: name 'openclaw_config_path' is not defined`
   - `test_lock_tampered_guard_counter_uses_hidden_process_kwargs_on_windows`：`NameError: name 'hidden_process_kwargs' is not defined`
   - `test_desktop_control_node_arguments_and_start_with_fake_popen`：`NameError: name 'urllib' is not defined`
   - `test_dock_window_before_show_calls_native_glass_and_corners_without_error`：`NameError: name 'configure_native_glass' is not defined`
   - `test_local_services_exception_branch_logs_traceback_without_secondary_error`：线程内 `NameError: name 'traceback' is not defined`，未输出 traceback
   - `test_constants_mutable_state_and_intra_module_monkeypatching_use_single_namespace`：`AssertionError: 'http://127.0.0.1:18789/' != 'https://127.0.0.1:5140/'`
   - `test_dynamic_spec_from_file_location_works_without_sys_modules_and_stays_isolated`：`AttributeError: 'NoneType' object has no attribute 'app_version'`
   - `test_standalone_submodule_imports_have_no_circular_import_or_none_desktop`：`NameError: name 'openclaw_config_path' is not defined`

---

## 三、六大类同类问题系统排查（修复前后命令与输出）

排查脚本：`C:\Users\34786\AppData\Local\Temp\pinkie-m4-rework-7c4e\evidence\sys_audit.py` 与 `ast_compare.py`（命令：`python <script> C:\Users\34786\Projects\pinkie-wt\m4-rework-exec`，退出码均为 `0`）。

| 类别 | 检查方法 | 修复前（`1bbe9214`）输出摘要 | 修复后（本分支）输出摘要 |
|---|---|---|---|
| 1. 未定义名字 | `symtable` + `ast` 扫描 `app/**/*.py` 全部 28 个文件（无业务白名单） | `Total app/**/*.py scanned: 28, undefined: 8`（`configure_native_corners`, `configure_native_glass`, `traceback`, `hidden_process_kwargs`×2, `urllib`, `openclaw_config_path`, `state_root`） | `Total app/**/*.py scanned: 28, undefined: 0`；`tests/app_undefined_names_test.py` 3/3 过（退出码 `0`） |
| 2. 常量和可变状态分裂 | 对照 `3cd2ac6f:app/windows_desktop.py` 全部 30 个顶层赋值在 9 个文件中的份数 | 14 个常量/可变集合被复制为 2–4 份（`GATEWAY_URL`×4、`PARTY_URL`×3、`ROUNDTABLE_URL`×3、`TRUSTED_UPDATE_HOSTS`×3、`UPDATE_API_URL`×3、`UPDATE_MANIFEST_NAME`×3、`UPDATE_RELEASES_URL`×3、`DEFAULT_APP_DOCUMENT_EXTENSIONS`×2、`DEFAULT_UPDATE_PROXIES`×2、`GUARD_UPDATE_REFUSED`×2、`RELAY_SERVICE`×2、`TTS_URL`×2、`UPDATE_ASSET_PREFIX`×2、`UPDATE_RELEASE_API_PROXY_HOSTS`×2） | 全部 30/30 个顶层赋值均 `SINGLE`（0 分裂、0 值差异），加载到 `windows_desktop.__dict__` 单份共享；`TRUSTED_UPDATE_HOSTS.add(...)` 等可变状态就地生效 |
| 3. monkeypatch 失效 | 静态分析跨/同模块直接引用 + 运行时真实 `mock.patch.object(windows_desktop, ...)` 测试 | `windows_update_guard.py` 有 23 处同模块直调绕过 `_desktop()`，`windows_runtime.py`/`windows_gateway.py`/`windows_bridge.py`/`windows_updater.py` 覆写 `GATEWAY_URL`/`PARTY_URL`/`ROUNDTABLE_URL`/`UPDATE_MANIFEST_NAME` 均失效 | 66/66 函数与 8/8 类全部绑定到 `windows_desktop.__dict__`，AST 与 `3cd2ac6f` 100% 一致（0 差异）；跨模块与模块内 `mock.patch.object(windows_desktop, ...)` 全部生效 |
| 4. `__file__` 相对路径 | 检索全 `app/**/*.py` 的 `__file__` / `__name__` / `__package__` / `sys.modules` | 仅 `app/windows_gateway.py:432` 使用 `Path(__file__).resolve().parent / "super_pinkie.py"`（与 `windows_desktop.py` 同在 `app/` 同层，深度不变）；6 个子模块硬编码查 `sys.modules.get("app.windows_desktop") or sys.modules.get("windows_desktop")` | `app/windows_gateway.py:441` 与 `app/windows_desktop.py:150` 均解析到同层 `app/`；非冻结按同目录 `.py` 解析，冻结态强制走 `find_spec().loader.get_code()` 不读散落 `.py` |
| 5. 循环导入 | 独立子进程分别按 `flat`（`sys.path=[app]`）和 `pkg`（`sys.path=[repo]`）逐一导入 9 个 `windows_*.py` 并调用关键入口 | `flat` 9/9 可导入但调用 `windows_update_guard.has_guard_receipt` / `windows_updater.WindowsUpdater` 崩于 `NameError` / `NoneType`；`pkg` 模式下 `release_notes` / `browser_vpn_subscription` 依赖 `app/` 在 `sys.path`（与拆分前 `3cd2ac6f` 一致，`app/` 非 Python 包） | `flat` 9/9 导入与独立调用全部通过（退出码 `0`），无循环导入；子模块独立调用时 `_desktop()` 惰性导入 `windows_desktop` 且遵守 `windows_frozen_imports_test.py` 冻结守卫 |
| 6. 动态加载 | 模拟 `tools/windows-smoke/update_probe.py:55` 与 `tests/material_preview_test.py:11` 用 `spec_from_file_location("old_windows_desktop", ...)` 在干净进程加载，以及同进程双份隔离加载与 `sys.frozen=True` 模拟加载 | `loaded: old_windows_desktop in sys.modules? False False` → `WindowsUpdater(...)` 立即抛 `AttributeError: 'NoneType' object has no attribute 'app_version'` | `old_windows_desktop` 全部属性 `__module__ == 'old_windows_desktop'`，`WindowsUpdater` / `DesktopControlNode._arguments` / `has_guard_receipt` / `process_guard_alerts` 全部正常；同进程加载两份互不污染；`sys.frozen=True` 路径输出 `FROZEN_OK` |

---

## 四、修复后针对性验证证据

1. `tests/app_undefined_names_test.py`：`Ran 3 tests in 0.396s — OK`（退出码 `0`）。
2. `tests/windows_desktop_split_runtime_test.py`：`Ran 9 tests in 1.992s — OK`（退出码 `0`）。
3. 协调者证据脚本 `call.py`（退出码 `0`）：
   ```text
     ok   DesktopControlNode._arguments: ['C:\Users\34786\AppData\Local\Temp\pinkie-m4-rework-7c4e\tmp\...']
     ok   has_guard_receipt (default path): False
     ok   process_guard_alerts (as the app calls it): (False, False)
   ```
4. `tests/windows_frozen_imports_test.py`：`Ran 2 tests in 0.029s — OK`（退出码 `0`）。
5. `node --test tests/code-health-ratchet.test.mjs`：`pass 3 / fail 0`（退出码 `0`）；全部 9 个 `app/windows_*.py` 均 ≤ 1500 行（最高 `windows_updater.py` 1461 行，`windows_desktop.py` 1082 行）。
6. PyInstaller 6.22.3 `PyiModuleGraph` 扫描 `app/super_pinkie.py`（退出码 `0`）：
   ```text
   Missing from PyInstaller graph: []
   Found in PyInstaller graph: ['inapp_browser', 'release_notes', 'windows_bridge', 'windows_bridge_scripts', 'windows_desktop', 'windows_elevated', 'windows_gateway', 'windows_native', 'windows_ps_templates', 'windows_runtime', 'windows_update_guard', 'windows_updater', 'zipfile']
   ```

---

## 五、全量测试、门禁对照、CI 与 `windows-smoke.yml`（第 2 轮，头 `7af633bd`）

| 项 | 本分支 | 同环境 main | 新增失败 |
|---|---|---|---|
| 全量门禁 `node tools/release-gate/run-tests.mjs` | `284 test files, 61 failing tests, 2 known` | `284 test files, 61 failing tests, 2 known` | 0（集合逐条相同） |
| Python `python -m unittest discover -s tests -p '*_test.py'` | `Ran 552 tests` `FAILED (failures=6, skipped=15)` | `Ran 539 tests` `FAILED (failures=6, skipped=15)` | 0（同 6 条；多出的 13 个是本 PR 新增测试，全部通过） |
| CI（4 项） | 45316807530：windows-checks / portable-checks / macos-check / windows-build 全部 success | — | — |
| windows-smoke（package=build） | 45305393950 failure：`metre-sidebar` 探针超时 | 45317443287 failure：失败行逐字相同；v2.5.53 的 45299544643 也挂在 `metre-sidebar` | 不是本 PR 引起的 |
| 测试弹窗 | 全量期间真进度窗口 0 个、带标题窗口 0 个（`watch-full3.log`） | 同（main 一侧临时加了同一份测试替身，未提交） | — |

逐条证据见 PR #62 评论 https://github.com/Cle0726/super-pinkie/pull/62#issuecomment-7121337486。

### 5.1 补充（变基到 `815c0f78` 之后，头 `84b5cd4f`）

| 项 | 本分支 | 同环境 main | 新增失败 |
|---|---|---|---|
| Z1 逐文件单独重跑 `windows_portable_update_integration_test` | `FAILED (failures=4)` | `FAILED (failures=4)` | 0（同 4 条：reappearing_old_gateway / rollback_copies / slow_first_start / unpacked_files_held_open） |
| Z1 逐文件单独重跑 `windows_update_leftovers_test` | `Ran 8 tests` `OK` | `ImportError: No module named 'release_notes'`（本 PR 修的缺陷，记为 main 侧失败） | 0 |
| CI（4 项） | 45354088826：portable-checks / windows-checks / macos-check / windows-build 全部 success | — | — |
| windows-smoke（package=build，old_tag=v2.5.16） | 45354095909 success：`[probe] metre-sidebar: passed True`，升级后六模式 ok，`overall passed=True` | — | — |
