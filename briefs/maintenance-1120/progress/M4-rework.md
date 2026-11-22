# M4 返工 · 恢复拆分前的 Windows 运行时行为 · 执行记录

## 接力卡（最后更新：2026-11-22 00:49 -08:00，Gemini-Win-7c4e @ Windows）

- 状态：进行中（核心修复与两类新测试已实现并推送，正在跑本地隔离全量 Python / 全量门禁对照及云端 CI + `windows-smoke.yml`）
- 分支和 PR：`maint/m4-fix-runtime`，[PR #62](https://github.com/Cle0726/super-pinkie/pull/62)（草稿）
- 已完成：
  1. 自 `origin/main`（`1bbe9214780488097310fd336fcf0312fb90416d`）建立独立工作区 `C:\Users\34786\Projects\pinkie-wt\m4-rework-exec`，记录 Z2 开工只读快照，核对 PR #54 文件清单（16 个文件，含 `.github/workflows/ci.yml`，全程零触碰），初始化接力卡并开草稿 PR #62（提交 `8a1520ce`）。
  2. 复制协调者证据脚本独立复现 `1bbe9214` 的 8 处未定义名与 3 处真实调用 `NameError`（`v2.5.53` 与 `3cd2ac6f` 均为 0 处）。
  3. 完成六大类系统排查（未定义名字、常量/可变状态分裂、monkeypatch 失效、`__file__` 相对路径、循环导入、动态加载），以及 `3cd2ac6f` vs `1bbe9214` 全量 AST 对照（66 函数 / 8 类 / 30 顶层赋值）。
  4. 编写两类新测试并在 `1bbe9214` 归档源码上确认全部失败：
     - `tests/app_undefined_names_test.py`：退出码 `1`，零白名单捕获全部 8 处未定义全局名；
     - `tests/windows_desktop_split_runtime_test.py`：退出码 `1`，9/9 项全部失败（`failures=4, errors=5`）。
  5. 实施单命名空间共享加载修复（`app/windows_desktop.py` + 6 个含运行逻辑的拆分子模块）：
     - 8 个拆分子模块在 `windows_desktop.py` 加载时经 `_load_desktop_part()` 执行进 `windows_desktop` 的唯一全局命名空间（非冻结读同目录 `.py`，冻结读 `spec.loader.get_code()`）；`if _PYINSTALLER_DISCOVERY:` 保留静态导入供 PyInstaller `PyiModuleGraph` 与 `symtable` 发现；
     - 子模块保留 `if "_PINKIE_DESKTOP_PART" not in globals():` 独立导入守卫、补齐 8 处漏导入/转发桩与 `_desktop()` 惰性导入回退；恢复 `windows_updater.py` 2 处 `GATEWAY_URL` 为原样（66/66 函数、8/8 类与 `3cd2ac6f` 100% AST 一致，30/30 顶层赋值全为单份）；
     - 复测：`tests/app_undefined_names_test.py` 3/3 过、`tests/windows_desktop_split_runtime_test.py` 9/9 过、`call.py` 3/3 过、`undef.py` 0 处、`windows_frozen_imports_test.py` 2/2 过、`code-health-ratchet.test.mjs` 3/3 过、PyInstaller `PyiModuleGraph` 实测 `Missing: []`。
  6. 改正 `briefs/maintenance-1120/progress/M4.md` 与 `briefs/maintenance-1120/PROGRESS.md` 总表中不成立的「过」。
- 正在做：推送修复提交并触发 GitHub Actions CI（4 项）与 `windows-smoke.yml`；本地串行重跑无 `PINKIE_STATE_ROOT` 污染的隔离全量 Python 套件，随后做同环境 `origin/main` 全量门禁对照（一次只跑一个重任务）。
- 下一步：
  1. 等本地隔离全量 Python 套件完成（0 失败），记录退出码与计数；
  2. 在隔离环境对本分支和同环境 `origin/main` 跑全量门禁 `node tools/release-gate/run-tests.mjs`（串行，不同时跑），确认新增失败为 0；
  3. 收集 PR #62 四项 CI 运行编号与全绿结论；
  4. 收集本分支 `windows-smoke.yml` 运行编号与结论（若出现与 `v2.5.53` 共同失败项，则补跑 `v2.5.53` 同一工作流对照）；
  5. 核对 Z2 收工快照、清理本会话临时文件与进程、最终更新 `M4-rework.md` 并推送（保持草稿 PR，不合并）。
- 没推送的东西：无（本提交将一并推送）
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m4-rework-exec`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m4-rework-7c4e`；端口 `5140–5144`；C 盘剩余 `16.07 GB`；后台进程：无
- 正在跑的长操作：即将触发 GitHub Actions CI + `windows-smoke.yml`（云端），并启动本地全量 Python 测试（约 6–7 分钟，结果写入 `C:\Users\34786\AppData\Local\Temp\pinkie-m4-rework-7c4e\evidence\full_python_clean.log`）
- 踩过的坑：
  - 外层壳提前设置 `PINKIE_STATE_ROOT` 会覆盖 `context_budget_test.py` 与 `party_usage_test.py` 内部每用例的 `self.home` 隔离，导致 `mkdir(parents=True)` 报 `FileExistsError` 与跨用例累计脏值；改为仅隔离 `HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/`TEMP`/`TMP`/`npm_config_prefix` 且不预置 `PINKIE_STATE_ROOT` 后，上述 22/22 全部通过。
  - PowerShell 管道 `git archive | tar` 会破坏二进制流，改用 `git archive --format=zip --output=...` + `Expand-Archive` 正常提取。
- 待用户决定：无

---

## 一、正式环境只读现场快照（Z2 ★）

| 现场项 | 开工（`2026-11-22 00:35 -08:00`） | 收工 | 一致性 |
|---|---|---|---|
| `%USERPROFILE%\.openclaw\openclaw.json`（UTC） | `2026-11-22T05:54:19.7689912Z` | 待收工 | — |
| `%LOCALAPPDATA%\Programs\SuperPinkie`（UTC） | `2026-11-22T05:52:01.5063045Z` | 待收工 | — |
| `%LOCALAPPDATA%\SuperPinkie`（UTC） | `2026-11-22T06:13:57.8543828Z` | 待收工 | — |
| `18789` 端口监听进程 | `127.0.0.1:18789 Listen PID 32388`（开工前已存在） | 待收工 | — |
| C 盘剩余空间 | `16.07 GB`（> 8 GB） | 待收工 | — |

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

## 五、全量测试、门禁对照、CI 与 `windows-smoke.yml`（进行中）

待本轮运行完成后逐项补齐命令、退出码、输出原文与 CI 运行编号。
