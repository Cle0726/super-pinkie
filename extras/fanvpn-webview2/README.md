# FanVPN → Windows WebView2 接入方案

把 FanVPN 的节点能力喂给 Windows 客户端的 WebView2，并且让用户能自己选节点。

## 一句话结论

**路走得通，而且已经跑通真实链路。** 但有一个前提必须说清楚：
**在 Mac 上测通 ≠ 在 Windows 上能跑。** 这份代码专门针对 Windows 发行包的
真实环境做了改造，下面「Windows 专项」一节列出全部坑点。

## 架构：为什么必须用本地代理

`--proxy-server` 在 WebView2 环境创建时就固定了。用户换节点若走这条路，就得
重建整个 WebView2 环境 —— 页面全部重载、登录态和正在填的表单全丢。

所以：

```
WebView2 ──固定──> 127.0.0.1:10809 (本地代理) ──可变──> 节点A / 节点B / 节点C
```

用户点「日本节点」，只改本地代理的上游，WebView2 毫不知情，页面零刷新。

## 文件说明

| 文件 | 职责 |
| :--- | :--- |
| `purecrypto.py` | 纯标准库 RSA-OAEP(SHA-1) + AES-CBC 解密，**零第三方依赖** |
| `fanvpn_core.py` | 拉加密配置、解密、产出节点表；节点 TLS 探活 |
| `local_proxy.py` | 单端口可热切换上游的代理，含智能分流与 fail-open |
| `fanvpn_service.py` | 节点面板（HTML + REST），把「用户选节点」变成一次 HTTP 调用 |
| `demo.py` | 最小可运行示例，打印切换后的真实出口 IP |
| `plugin/FanVPN/` | 原扩展解包，仅供提取私钥与对照逻辑，运行时不依赖 |

## Windows 专项：在 Mac 上测不出来的四个坑

### 坑 1：发行包里没有 `cryptography`

`build-win.ps1` 的 pip 清单是：

```
pyinstaller pywebview pywin32 edge-tts aiohttp
```

**没有 `cryptography`**，仓库里也没有任何 requirements 约束它。PyInstaller 只
打包真正被 import 的包，所以线上 EXE 里不会有它 —— 依赖它必然 `ImportError`。
Mac 上能跑只是因为本机装了这个库。

**对策**：`purecrypto.py` 改用 `hashlib`（标准库，PyInstaller 永远带）+ 纯
Python 大数运算实现 RSA-OAEP，AES 用纯 Python 实现。已用 NIST SP 800-38A 官方向量
验证 AES-128/256，并与 `cryptography` 的解密结果做逐字节交叉比对，完全一致。

### 坑 2：`StreamWriter.start_tls()` 在 3.9/3.10 不存在

那个 API 是 Python 3.11 才加的。构建脚本提到 3.12，但打包机和目标机不一定一致。
**对策**：手动 `ctx.wrap_socket()` 后重建 StreamReader/Writer。全部文件已通过
`ast.parse(feature_version=(3,9))` 语法校验。

### 坑 3：阻塞调用卡死事件循环（最隐蔽）

`socket.create_connection` 和 `wrap_socket` 都是**阻塞**的。写在协程里会把事件循环
卡住整整一个超时时长 —— 期间所有其他连接（含正在传输的隧道）全部冻结。
Mac 上循环快、节点近，看不出来；Windows 上就是「浏览器假死」。

**对策**：「建连 + TLS 握手」整体丢进线程池（`run_in_executor`），设 6 秒硬超时。

### 坑 4：`--windowed` 下 stdout/stderr 是 None

PyInstaller `--windowed` 构建没有控制台，`sys.stderr` 可能是 `None`，
logging 的 lastResort handler 往里写会抛错。
**对策**：`_configure_logging()` 在无 handler 时补 `NullHandler`，且不覆盖宿主配置。

## 三行接入到现有客户端

在 `app/windows_desktop.py` 的 `run_desktop()` 里，创建窗口之前：

```python
from fanvpn_service import start_fanvpn, apply_to_webview2_env

service = start_fanvpn(KEY_PEM)      # 插件内置 RSA 私钥文本
apply_to_webview2_env(service)       # 必须在 create_window / webview.start 之前
```

然后给用户一个入口打开 `service.panel_url`。

## 面板 API

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/` | 节点选择界面 |
| GET | `/api/state` | 当前节点、模式、代理端口 |
| GET | `/api/nodes?force=1` | 重新拉配置 + 并发测速 |
| POST | `/api/select` | `{"server":"...","port":443}` 切换节点，立即生效 |
| POST | `/api/mode` | `{"mode":"smart"}` 或 `{"mode":"global"}` |

## 两种模式

- **smart（默认）**：国内域名直连，其余走节点。等价扩展的 `CN_BYPASS_LIST` 语义，
  含 `.cn` 全后缀、主流门户/电商/视频站、私有网段与 `<local>`。
- **global**：除本地环回外全部走节点。

## 实测记录（本机真实数据）

解密出 7 个节点，全部可达。完整回归（同时屏蔽 `cryptography` 模拟 Windows 环境）：

| 步骤 | 出口 IP | 归属 |
| :--- | :--- | :--- |
| 无 cryptography 解密 | 7 个节点 | — |
| 直连 | 167.253.97.191 | Bage Cloud LLC, US |
| 选「美国·01」 | 198.2.214.3 | PEG TECH INC, US |
| 切「日本(联通优化)」 | 14.137.237.91 | ALPHA-JP-SUB, JP |
| 选不可达节点 | 167.253.97.191 | fail-open 回退直连，**不断网** |
| 恢复后 | 198.2.214.3 | — |

`stats` 最终：`direct: 2, proxied: 3, failed: 1`，符合预期。

## 几个必须知道的设计取舍

1. **节点是 HTTPS 代理，不是 HTTP 代理。** 必须先和代理做 TLS，再在 TLS 里发
   `CONNECT`。明文 `CONNECT` 会被直接拒 —— 这是最初 `proxied: 0`、流量全部
   fail-open 悄悄退回直连的根因。

2. **fail-open 是刻意的，且 CONNECT 与明文 HTTP 两条路径都要有。**
   节点挂了退回直连，不让整机断网。早期只在 CONNECT 路径做了 fail-open，
   明文 `http://` 请求会直接断掉，在 Windows 上表现为「页面空白」。

3. **`--proxy-bypass-list="<-loopback>"` 是取消 Chromium 默认的环回豁免**，
   否则发往 `127.0.0.1` 的请求会绕开代理，本地服务全废。真正的国内域名分流
   由代理自己判断。

## 还没验证的部分（诚实说明）

以下需要真机 Windows 才能确认，本机无法代验：

- PyInstaller 打包后 `purecrypto` 是否被正确收进 `_internal`（纯 Python 模块，
  理论上会被 `--paths app` 自动收集，但建议打包后跑一次节点列表自检）
- WebView2 对本地 HTTP 代理的 `CONNECT` 行为在具体 Edge 版本上的差异
- 企业环境下的 Windows 防火墙 / 组策略对 loopback 代理端口的拦截

建议在 Windows 上加一个启动自检：服务起来后请求一次 `/api/nodes`，
失败就把错误写进 `logs/fanvpn.log`，而不是静默降级。
