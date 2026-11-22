# M4 返工 · 恢复拆分前的 Windows 运行时行为 · 执行记录

## 接力卡（最后更新：2026-11-22 00:36 -08:00，Gemini-Win-7c4e @ Windows）

- 状态：进行中（已完成基线复现、六大类系统排查、修复前两类红灯测试编写与实测，正在实施单命名空间共享加载修复）
- 分支和 PR：`maint/m4-fix-runtime`，草稿 PR 创建中
- 已完成：
  1. 自 `origin/main`（`1bbe9214780488097310fd336fcf0312fb90416d`）建立独立工作区 `C:\Users\34786\Projects\pinkie-wt\m4-rework-exec`，记录 Z2 开工只读快照，核对 PR #54 文件清单（16 个文件，含 `.github/workflows/ci.yml`，全程不碰）。
  2. 复制协调者证据脚本至隔离临时目录并独立复现：
     - `undef.py v2.5.53 3cd2ac6f 1bbe9214`：`v2.5.53` 0 处、`3cd2ac6f` 0 处、`1bbe9214` 8 处未定义全局名。
     - `call.py` 在 `1bbe9214` 工作树上复现 3 处 `NameError`（`urllib`、`openclaw_config_path`、`state_root`）。
  3. 完成六大类同类问题系统排查（未定义名字、常量/可变状态分裂、monkeypatch 失效、`__file__` 相对路径、循环导入、动态加载），以及 `3cd2ac6f` vs `1bbe9214` 全量 AST 对照（66 函数 / 8 类 / 30 顶层赋值，14 个常量被复制为 2–4 份）。
  4. 编写两类新测试并在 `1bbe9214` 上确认全部失败：
     - `tests/app_undefined_names_test.py`：退出码 `1`，捕获全部 8 处未定义全局名；
     - `tests/windows_desktop_split_runtime_test.py`：退出码 `1`，9/9 项全部失败（`failures=4, errors=5`）。
- 正在做：在 `app/windows_desktop.py` 与 8 个拆分子模块上恢复拆分前单命名空间语义与全部漏导入/转发桩，并验证 PyInstaller 冻结发现与独立导入兼容。
- 下一步：
  1. 落实 `app/windows_*.py` 修复，提交修复与两类新测试并确认全绿、`undef.py` 0 处、`call.py` 全过、六大类复测全过；
  2. 修正 `briefs/maintenance-1120/progress/M4.md` 与 `briefs/maintenance-1120/PROGRESS.md` 总表中不成立的「过」；
  3. 隔离环境执行 Python 全量测试与全量门禁（对照同环境 `origin/main`），确保新增失败为 0；
  4. 推送并盯紧 CI 四项全绿，在本分支真实触发 `windows-smoke.yml` 验证结论为 `success`（若有与 `v2.5.53` 共同失败项，则跑同一工作流 `v2.5.53` 对照）；
  5. 收工快照、清理本会话临时文件、更新接力卡并汇报（不合并、不改 ready）。
- 没推送的东西：未暂存的两类新测试文件（将在下个提交随修复一并推送）
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m4-rework-exec`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m4-rework-7c4e`；端口 `5140–5144`；C 盘剩余 `16.07 GB`；后台进程：无
- 正在跑的长操作：无
- 踩过的坑：
  - `tests/material_preview_test.py` 与 `tools/windows-smoke/update_probe.py` 均通过 `importlib.util.spec_from_file_location` 动态加载 `app/windows_desktop.py` 且不写入 `sys.modules`；若仅靠子模块内的全局单例 `_DESKTOP` 指针，同一进程中加载第二份 `windows_desktop.py` 会劫持前一份的 `_desktop()`。采用将 8 个拆分子模块按原序执行到当前 `windows_desktop` 模块自身 `globals()`（并在子模块内用 `if "_PINKIE_DESKTOP_PART" not in globals():` 保留独立导入与静态符号表完整性），可同时满足单份常量/状态、全量 monkeypatch 等价、动态加载完全隔离、`symtable` 零未定义名与 PyInstaller 静态打包。
  - PyInstaller 6.22.3 实测验证：`PyiModuleGraph` 可发现 `if _PYINSTALLER_DISCOVERY:` 下的静态导入及其传递依赖（如 `zipfile`），冻结后由 `PyiFrozenLoader.get_code()` 从 `PYZ.pyz` 直接读取字节码，不读散落 `.py`。
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

### 2.1 协调者证据脚本独立复现

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
2. `python C:\Users\34786\AppData\Local\Temp\pinkie-m4-rework-7c4e\evidence\call.py C:\Users\34786\Projects\pinkie-wt\m4-rework-exec`（退出码 `0`）：
   ```text
     FAIL DesktopControlNode._arguments: NameError: name 'urllib' is not defined
     FAIL has_guard_receipt (default path): NameError: name 'openclaw_config_path' is not defined
     FAIL process_guard_alerts (as the app calls it): NameError: name 'state_root' is not defined
   ```

### 2.2 修复前新增测试红灯复现（在 `1bbe9214` 上）

1. `python -m unittest -v tests/app_undefined_names_test.py`（退出码 `1`）：
   ```text
   test_no_undefined_global_names_in_app_python_files ... FAIL
   AssertionError: ... Undefined global names found in app/**/*.py:
   app/windows_bridge.py:[851] undefined configure_native_corners
   app/windows_bridge.py:[851] undefined configure_native_glass
   app/windows_gateway.py:[478] undefined traceback
   app/windows_runtime.py:[184] undefined hidden_process_kwargs
   app/windows_runtime.py:[146] undefined urllib
   app/windows_update_guard.py:[370] undefined hidden_process_kwargs
   app/windows_update_guard.py:[297] undefined openclaw_config_path
   app/windows_update_guard.py:[455] undefined state_root
   Ran 3 tests in 1.365s
   FAILED (failures=1)
   ```
2. `python -m unittest -v tests/windows_desktop_split_runtime_test.py`（退出码 `1`）：
   ```text
   Ran 9 tests in 3.628s
   FAILED (failures=4, errors=5)
   ```
   - `test_process_guard_alerts_release_build_default_app_state_and_tamper_receipt`: `NameError: name 'state_root' is not defined`
   - `test_has_guard_receipt_default_openclaw_state_resolves_openclaw_config_path`: `NameError: name 'openclaw_config_path' is not defined`
   - `test_lock_tampered_guard_counter_uses_hidden_process_kwargs_on_windows`: `NameError: name 'hidden_process_kwargs' is not defined`
   - `test_desktop_control_node_arguments_and_start_with_fake_popen`: `NameError: name 'urllib' is not defined`
   - `test_dock_window_before_show_calls_native_glass_and_corners_without_error`: `NameError: name 'configure_native_glass' is not defined`
   - `test_local_services_exception_branch_logs_traceback_without_secondary_error`: 线程内 `NameError: name 'traceback' is not defined`，未记录 traceback
   - `test_constants_mutable_state_and_intra_module_monkeypatching_use_single_namespace`: `AssertionError: 'http://127.0.0.1:18789/' != 'https://127.0.0.1:5140/'`
   - `test_dynamic_spec_from_file_location_works_without_sys_modules_and_stays_isolated`: `AttributeError: 'NoneType' object has no attribute 'app_version'`
   - `test_standalone_submodule_imports_have_no_circular_import_or_none_desktop`: `NameError: name 'openclaw_config_path' is not defined`
