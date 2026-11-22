# M4 独立复测报告（发版前独立复核）

## 接力卡（最后更新：2026-11-21 19:15 -08:00，Gemini-Win-3b7e @ Windows）

- 状态：进行中
- 分支和 PR：`maint/m2-m4-audit`，[PR #58](https://github.com/Cle0726/super-pinkie/pull/58)（草稿）
- 核对的 main 提交：`fa57fcc7da5e05e259e72d149c67235ebed750c2`
- 已完成：
  1. 完成 Python (`ast`) 与 JS (`acorn`) 语法树（AST）级全量函数体、类方法体与顶层常量一致性证明：
     - Python `app/windows_desktop.py` 拆分为 9 个模块：共 **195** 个真实函数/类方法、**8** 个类；**193/195** 个函数/方法 AST 完全一致，仅 `UpdateHealthReporter.__init__` 与 `WindowsUpdater.launch_replacer` 2 处将 `GATEWAY_URL` 改为 `getattr(_desktop(), 'GATEWAY_URL', GATEWAY_URL)`，另新增 49 个 `_desktop().<fn>(*args, **kwargs)` 转发桩。
     - JS `services/mode-architecture/index.mjs` 拆分为 8 个模块：共 **176** 个顶层函数、**10** 个类、**159** 个类方法、**133** 个顶层变量/常量；**176/176** 顶层函数、**10/10** 类、**159/159** 类方法、**133/133** 顶层变量 AST **100% 一致**；仅新增 1 个 1 行 setter `setAgentWorkspaceConfig(cfg)` 并在 `export default { register(api) }` 第 68 行将 `agentWorkspaceConfig = pluginConfig();` 替换为 `setAgentWorkspaceConfig(pluginConfig());`。
  2. 完成拆分特有问题专项排查，**发现 Python 拆分存在 4 类实质性缺陷（原自查漏检）**：
     - **缺陷 1（阻塞 / 8 处漏导入与漏转发桩导致运行时 `NameError`）**：
       1. `app/windows_runtime.py:146` (`DesktopControlNode._arguments`)：漏 `import urllib.parse`，调用即抛 `NameError: name 'urllib' is not defined`；
       2. `app/windows_runtime.py:184` (`DesktopControlNode.start`)：漏 `hidden_process_kwargs` 转发桩，调用即抛 `NameError: name 'hidden_process_kwargs' is not defined`（导致生产环境启动时 `computer.start()` 必崩并被 `except Exception` 吞进 `computer.log`）；
       3. `app/windows_update_guard.py:297` (`has_guard_receipt` 默认 `openclaw_state=None`)：漏 `openclaw_config_path` 转发桩，抛 `NameError: name 'openclaw_config_path' is not defined`；
       4. `app/windows_update_guard.py:370` (`lock_tampered_guard_counter`)：漏 `hidden_process_kwargs` 转发桩，Windows 下抛 `NameError: name 'hidden_process_kwargs' is not defined`；
       5. `app/windows_update_guard.py:455` (`process_guard_alerts` 默认 `app_state=None`)：漏 `state_root` 转发桩，正式签名版启动与每 1.2s 巡检必抛 `NameError: name 'state_root' is not defined`；
       6. `app/windows_bridge.py:851` (`NativeBridge._open_dock_window` 内 `dress`)：漏 `configure_native_glass` 与 `configure_native_corners` 转发桩（2 处），打开伴侣悬浮窗时 `before_show` 必抛 `NameError`；
       7. `app/windows_gateway.py:478` (`LocalServices._start` 异常分支)：漏 `import traceback`，本地服务异常时日志记录本身二次抛 `NameError: name 'traceback' is not defined`。
     - **缺陷 2（重要 / `importlib` 动态加载与初始化顺序失效）**：`tools/windows-smoke/update_probe.py:55` 通过 `spec_from_file_location("old_windows_desktop", source)` 加载 `app/windows_desktop.py` 时，`sys.modules` 中既无 `"windows_desktop"` 也无 `"app.windows_desktop"`，导致子模块 `_desktop()` 返回 `None`，调用 `module.WindowsUpdater(...)` 立即抛 `AttributeError: 'NoneType' object has no attribute 'app_version'`。
     - **缺陷 3（重要 / 全局状态裂变为多份且 monkeypatch 绕过 `_desktop()`）**：`GATEWAY_URL`、`PARTY_URL`、`ROUNDTABLE_URL`、`TTS_URL`、`UPDATE_API_URL`、`TRUSTED_UPDATE_HOSTS` 等 14 个全局常量在子模块中被复制成多份；覆写 `windows_desktop.GATEWAY_URL` 时，`windows_runtime.py`（第 58、146 行）与 `windows_gateway.py`（第 116、148、166、216、315、375 行）仍读各自模块内的 `'http://127.0.0.1:18789/'`；且 `windows_update_guard.py` 内部直接调用同模块的 `guard_release_build`、`release_update`、`verify_guard_counter` 等，导致针对 `windows_desktop.<fn>` 的 `mock.patch.object` 对模块内互调失效。
     - **缺陷 4（阻塞 / M4-4 ★ 冒烟测试实际未过）**：M4 执行记录引用的 GitHub Actions `windows-smoke.yml` Run `44936310560` 实际退出码为 `1`（`overall passed=False`，`[probe] metre-sidebar` 失败），不满足 `M4-4 ★`「Windows 冒烟测试通过」。
  3. 完成 **M4-1 ★**、**M4-2 ★**（全 15 个拆分提交 `--color-moved=zebra` 核查）、**M4-3 ★ / Z5 ★**（`inject-inventory.mjs` 18 条样例与 CLI `--verify-baseline` 逐字一致）、**M4-5**、**Z4 ★**。
- 正在做：准备执行 `v2.5.53 → 最新 main` 隔离升级验证、临时 venv 隔离 `build-win.ps1` 打包与 `Z1 ★` 全量门禁。
- 下一步：完成隔离升级、临时 venv 打包与全量门禁，写入完整证据并推送。
- 没推送的东西：无
- 环境：工作区 `C:\Users\34786\Projects\pinkie-wt\m2-m4-audit`；临时目录 `C:\Users\34786\AppData\Local\Temp\pinkie-m2-m4-audit-3b7e`；端口 5145–5149；后台进程：无
- 正在跑的长操作：无
- 踩过的坑：无
- 待用户决定：无
