# T3-LICENSES：t3code 及其传递依赖的许可证清单（K8-0 · L106）

> 只读摸底，不改产品代码。2026-11-28 · linux2。
> 对象：`github.com/pingdotgg/t3code`，浅克隆到临时目录，选定提交
> `1cb7c46eac3a2914d613641f4b98c4669bef36b9`（2026-11-27，`apps/server` 包名 `t3`，版本 0.1.13）。
> 方法：只读 `package.json`、`pnpm-lock.yaml`、`Cargo.toml/Cargo.lock`、`build.gradle` 和仓库里的 LICENSE / NOTICE 文件；
> 依赖包自身的许可证只从本机已有的 pnpm 内容仓库（`~/.local/share/pnpm/store/v11`）和元数据缓存里读。
> **没有联网拉包、没有 install、没有运行 t3code 的任何脚本。** 读不到的一律记「未核实」，不按常识补成已核实。

## 0. 结论先行

| # | 内容 | 许可证 | 结论 |
|---|---|---|---|
| 1 | t3code 自有源码（`apps/*`、`packages/*`、`native/*`、`scripts/*` 等） | MIT，`Copyright (c) 2026 T3 Tools Inc.`（仓库根 `LICENSE`） | **能搬 / 能照着写**，搬代码必须带原版权行和 MIT 全文 |
| 2 | T3 品牌：名字 T3 Code / T3 Connect / T3 Tools、T3 字标、图标、`assets/`、`T3Wordmark` | 不在 MIT 内（`TRADEMARK.md`） | **不能搬**；界面里不出现 T3 名字和标志（与 11-22 用户口径一致） |
| 3 | `libatomic.so.1`（Linux 版 CLI 包里自带的 GCC 运行库，`scripts/build-cli-archive.ts:264-324`，许可证文本 `scripts/licenses/libatomic.LICENSE`） | GPL-3.0-or-later WITH GCC-exception-3.1 | **全仓唯一实打实的 GPL 件**。不搬进碧琪/cle-core；原样分发官方 Linux 包时它随包带许可证和源码出处，碧琪不得剥掉 `lib/libatomic.so.1.LICENSE` |
| 4 | 智能体 SDK `@anthropic-ai/claude-agent-sdk@0.3.321`（`apps/server` 直接依赖） | `SEE LICENSE IN README.md`（非 SPDX 开源许可，条款本机读不到） | **按「未声明开源许可」处理：不能搬、不能另行打包分发**；只能让用户自己装官方 CLI / SDK，Metre 调用 |
| 5 | `@cursor/sdk@1.5.0`、`@muse-code/sdk@1.4.6`（`apps/server` 直接依赖，均为外部运行时依赖） | 未核实 | **不能搬**，搬之前先拿到许可证文本 |
| 6 | `jszip@3.10.1`（web / client-runtime） | `(MIT OR GPL-3.0-or-later)` | 能用，**选 MIT 分支**并在 NOTICE 里写明所选分支 |
| 7 | `apps/server` 传递依赖（314 个包） | 已核实 158 个：MIT 146、ISC 11、BSD-2-Clause 1；**其余 156 个未核实** | 已核实部分没有 GPL/AGPL；未核实名单见附录 A，搬 server 侧代码前要补核 |
| 8 | 三个 Rust 小工具的 crate（`native/*-snap-shot`、`native/resource-monitor`） | 工具本身 MIT；206 个第三方 crate 的许可证**本机无 cargo 缓存，全部未核实** | 这三个工具与 Metre 无关，不搬 |
| 9 | 移动端 Android 依赖（ML Kit 语音识别、Firebase Messaging 等） | 非开源 SDK 条款，未核实 | 只在手机端，不搬 |

一句话：**能搬的是 t3code 自有的 MIT 源码（去掉品牌）；不能搬的是 libatomic（GPL）、品牌资产、以及三个智能体 SDK（许可证未声明或未核实）。** 已核实范围内没有发现 AGPL。

## 1. t3code 本体

- 仓库根 `LICENSE`：MIT，`Copyright (c) 2026 T3 Tools Inc.`。
- `TRADEMARK.md`：MIT **只覆盖源码**；名字、字标、logo、应用图标（含 `assets/`、`T3Wordmark`）、官方域名和商店条目都不在授权内。分发派生品必须用自己的品牌、明确写「非官方」。
- 工作区 50 个 `package.json`：只有 `apps/server`（包名 `t3`）写了 `"license": "MIT"`；其余 48 个都是 `"private": true`、**不写 license 字段**，按仓库根 `LICENSE` 统一覆盖（包级「未声明」，仓库级 MIT）。
  例外：`infra/task-cache/vendor/vite-plus-remote-cache-cloudflare` 是 VoidZero 的 MIT 代码（`Copyright (c) 2026-present, VoidZero Inc.`），自带 LICENSE。
- 官方发布包自带许可证清单：构建时由 `scripts/lib/third-party-licenses.ts`（Vite 插件，按 `apps/web/vite.config.ts:308-314` 汇总 web + server + desktop 三份清单）生成 `third-party-licenses.json`，界面入口「Settings → About → Legal → Open source licenses」（`docs/user/open-source-licenses.md`）。该生成器遇到 `UNLICENSED` / `proprietary` 或没有许可证文件会直接报错停构建，所以**官方发布包里的清单比本文更全**；本文是不跑构建的静态摸底。

与现有文档的关系：`briefs/metre-engines-1122/NOTICES-draft.md` 已写了「原样使用官方发布包 + MIT 全文」，对应的是 v0.1.11；本次读到的 main 已是 0.1.13，版权行一致（`2026 T3 Tools Inc.`）。

## 2. 仓库内直接带进来的第三方代码 / 资源（vendored）

来自 `third-party-licenses.config.json` 的 `customNotices` 与各目录自带的 LICENSE / NOTICE，全部逐个读过原文：

| 组件 | 位置 / 用途 | 许可证 | 能否搬 |
|---|---|---|---|
| opencode Office viewers | `apps/web/src/components/files/office/`，`LICENSE.opencode`（`Copyright (c) 2025 opencode`） | MIT | 能，带 opencode 版权行 |
| Ionic keyboard assist | web/desktop 键盘适配 | MIT（Drifty Co.） | 能，带版权行 |
| GitHub gemoji 别名数据 | emoji 数据 | MIT（GitHub, Inc.） | 能 |
| Apple Speech engine（改自 `@react-native-ai/apple`） | `native/apple-speech/*.swift` | MIT（Szymon Rybczak / Callstack） | 与 Metre 无关 |
| libghostty-vt | `native/libghostty-vt/`（修订 `3ff6d08f…`），web 终端 WASM + Android | MIT（Mitchell Hashimoto, Ghostty contributors） | 能，带版权行 |
| GhosttyKit | iOS 终端 | MIT | 手机端，不搬 |
| Symbols Nerd Font Mono | `apps/web/src/terminal/ghostty/fonts/` | MIT（Ryan L McIntyre） | 能 |
| MesloLGS NF | 手机端字体 | Apache-2.0 | 手机端，不搬 |
| KaTeX 数学字体 | web/desktop/mobile | OFL-1.1（保留字体名 KaTeX_*） | 能随软件带，**不能单独卖字体、改了不能沿用保留名** |
| micromark-extension-llm-math | 公式解析 | MIT | 能 |
| 提示音 ×4（freesound） | `notification-*.mp3`、`snap-shot-*.mp3` | CC0-1.0 | 能 |
| agent-device / expo-device-hub | 按需下载的设备工具 | MIT；expo-device-hub 为 MIT AND Apache-2.0 AND BSD-3-Clause | 与 Metre 无关 |
| react-native-uitextview、Expo 文本编辑器、wasm2c（Apache-2.0）、SIMDe（MIT）、RaTeX（MIT） | `apps/mobile/modules/*` | 如左 | 手机端，不搬 |
| `.repos/effect` | 参考用的 Effect 源码快照 | MIT（Effectful Technologies） | 开发参考，不随产品发 |
| `.repos/alchemy-effect` | 参考用的 Alchemy 源码快照 | Apache-2.0，带 `NOTICE` 与 `THIRD_PARTY_LICENSES.md`（含改自 Astro / SvelteKit 的 MIT 片段） | 开发参考；若搬须保留 NOTICE |
| `scripts/licenses/libatomic.LICENSE` | Linux CLI 包携带的 libatomic | **GPL-3.0-or-later WITH GCC-exception-3.1** | **不能搬**（见 §0 第 3 条） |

## 3. npm 依赖（`pnpm-lock.yaml`）

### 3.1 规模与覆盖率

- 锁文件 `lockfileVersion: '9.0'`，45 个工作区 importer，2199 个包、2203 个快照。
- 生产依赖（`dependencies` + `optionalDependencies`，沿 `link:` 跟进工作区包）并集约 1562 个。
- 许可证来源：本机 pnpm 内容仓库里 **407 个包**（全部与锁文件 integrity 精确匹配，读的是包内 `package.json` 和 LICENSE/COPYING/NOTICE 原文）；另有 17 个从完整元数据缓存读到 `license` 字段。**其余约 1790 个包本机没有，记为未核实。**

按组件（只算生产闭包）：

| 组件 | 闭包包数 | 已核实 | 已核实的许可证分布 | 已核实里非常规宽松许可 |
|---|---|---|---|---|
| server（t3 引擎 CLI，`apps/server`） | 314 | 158 | MIT 146 / ISC 11 / BSD-2-Clause 1 | 无 |
| web 界面（`apps/web`） | 682 | 196 | MIT 178 / ISC 13 / BSD-3 2 / 0BSD 1 / 其他 2 | `jszip` (MIT OR GPL-3.0-or-later)、`pako` (MIT AND Zlib) |
| desktop（`apps/desktop`） | 368 | 137 | MIT 123 / ISC 8 / … | `argparse` Python-2.0、`jszip`、`pako` |
| mobile（`apps/mobile`） | 833 | 204 | MIT 175 / ISC 14 / BSD-2 7 / … | 同上 |
| marketing（`apps/marketing`） | 365 | 113 | MIT 98 / BSD-2 6 / … | `argparse`、`mdn-data@2.27.1` CC0-1.0 |
| infra（relay、task-cache） | 815 | 199 | MIT 176 / ISC 14 / … | `argparse`、`fast-sha256` Unlicense、`jszip`、`pako` |
| scripts / evals / lint | 295 | 93 | MIT 86 / ISC 3 / BlueOak-1.0.0 2 / … | `minipass`、`path-scurry` BlueOak-1.0.0 |

说明：
- `argparse@2.0.1` 的 LICENSE 里出现 “GNU General Public License” 字样，是 Python-2.0（PSF）许可证历史段落里的「与 GPL 兼容」说明，**许可证本身是宽松许可，不是 GPL**。
- `jszip` 是双许可，选 MIT 即可，无 GPL 义务。
- BlueOak-1.0.0、Unlicense、CC0-1.0、0BSD、Zlib 都是宽松许可，无传染义务。

### 3.2 `apps/server` 直接依赖（Metre 引擎服务的来源）

| 依赖 | 版本 | 许可证 | 备注 |
|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.321 | `SEE LICENSE IN README.md` | **非开源声明**，条款未读到（缓存里没有 README） |
| `@cursor/sdk` | 1.5.0 | 未核实 | 运行时外部依赖，带平台二进制包 `@cursor/sdk-*` |
| `@muse-code/sdk` | 1.4.6 | 未核实 | |
| `@effect/platform-node` / `-shared`、`effect` | 4.1.6 | 未核实（`.repos/effect` 快照为 MIT） | t3code 对 `effect`、`@effect/platform-node-shared` 打了补丁（`patches/`） |
| `@ff-labs/fff-node` | 0.11.0 | 未核实（config 里给 `dmtrKovalenko/fff` 记 MIT） | 原生二进制 `@ff-labs/fff-bin-*` |
| `node-pty` | 1.2.0-beta.15 | 未核实 | 原生预编译 |
| `ffi-rs` | 1.3.2 | 未核实（config 里 `@yuuang/ffi-rs-*` 记 MIT） | 原生 |
| `transcribe-cpp` | 0.4.1 | 未核实 | 原生语音转写，带 `@transcribe-cpp/*` |
| `playwright-core` | 1.64.1 | 未核实 | |
| `undici` 8.12.4、`zod` 4.6.7、`diff` 8.0.3、`stream-json` 3.7.0、`stream-chain` 4.2.5、`yauzl` 3.4.0 | | 未核实 | |
| `character-entities` 2.0.2、`character-entities-legacy` 3.0.0、`proper-lockfile` 4.1.2 | | MIT | 已核实 |
| `saxes` 6.0.0、`yaml` 2.9.0 | | ISC | 已核实 |
| 22 个 `@t3tools/*` 工作区包（provider-*、source-control-*、issue-tracker-*） | link | 仓库根 MIT | 自有代码 |

CLI 包的运行时外部依赖（不打进单文件、原样放进 `node_modules`）按 `scripts/lib/cli-external-packages.ts`：
`@cursor/sdk`、`playwright-core`、`node-pty`、`ffi-rs`、`@yuuang/*`、`@ff-labs/*`、`transcribe-cpp`、`@transcribe-cpp/*`、`koffi`、`@koromix/*`、`@napi-rs/keyring`、`@clerk/electron-passkeys`、`node-gyp-build`、`node-addon-api`、`bufferutil`、`utf-8-validate`，以及 Cursor 运行时用到的 `@bufbuild/protobuf`、`@connectrpc/*`、`@statsig/*`、`zod`、`undici`、`@fastify/busboy`。
其中 config 已写明的：`@bufbuild/protobuf` Apache-2.0 + BSD-3-Clause、`@connectrpc/connect(-web)` Apache-2.0、`@yuuang/ffi-rs-*` MIT。其余未核实。

### 3.3 按名字需要复核的包（本机未核实，**以下许可证只是待查方向，不是结论**）

这些包本机读不到许可证文本，但按包名属于常见的「非纯 MIT」类，搬对应代码或随包分发前必须先拿原文核对：

| 包 | 出现在 | 需要查的点 |
|---|---|---|
| `@img/sharp-libvips-*` 1.3.4、`sharp` 0.35.5 | marketing、infra、scripts（**不在 server / web 闭包**） | libvips 二进制是否为 LGPL 系 |
| `node-forge` 1.4.3 | mobile、infra | 是否为 BSD / GPL 双许可，选哪支 |
| `dompurify` 3.4.17 | web | 是否为 MPL / Apache 双许可 |
| `caniuse-lite`、`mdn-data@2.0.x` | mobile、web、marketing | 数据类许可（CC 系）署名要求 |
| `electron` 44.10.1 | desktop | Electron 自身之外随带 Chromium 的大量第三方许可 |
| `@anthropic-ai/claude-agent-sdk`、`@cursor/sdk`、`@muse-code/sdk` | server | 见 §3.2，先拿条款 |

## 4. 非 npm 依赖

- **Rust**（`native/hyprland-snap-shot` 70 个 crate、`native/kde-snap-shot` 97 个、`native/resource-monitor` 39 个）：三个工具的 `Cargo.toml` 都写 MIT；第三方 crate 本机没有 `~/.cargo/registry`，**许可证全部未核实**（crate 名单在 `Cargo.lock`，可复查）。三者分别是 Hyprland / KDE 截图和资源监控，与 Metre 无关。
- **Android Gradle**（`apps/mobile/modules/*/android/build.gradle`）：`androidx.*`、`com.squareup.okhttp3:okhttp:4.12.0`、`com.google.firebase:firebase-messaging:25.0.1`、`com.google.mlkit:genai-speech-recognition:1.0.0-alpha2`、`com.facebook.react:react-android`。未核实；Firebase / ML Kit 是 Google 的 SDK 条款，非开源许可。只在手机端。
- **Swift / C**：`native/apple-speech`（MIT，见 §2）、`native/browser-secret/main.c`（自有，仓库 MIT）。

## 5. 对 K8 搬运的约束（给 L105 T3-MAP 用）

1. **服务端驱动外部智能体的模块**（`packages/provider-*`、`apps/server` 的 provider 层）：自有代码是 MIT，可搬可照着写；但它们包着的三个 SDK（§3.2）**不能随碧琪/cle-core 分发**。照着写时由用户机器上已装的官方 CLI / SDK 提供能力，碧琪只调用。
2. **事件协议 / 契约**（`packages/contracts`）：自有 MIT，依赖只有 `effect`（未核实，快照为 MIT）。可照着写。
3. **网页端会话 / 线程 / 差异审阅组件**（`apps/web`）：自有 MIT；差异审阅依赖 `@pierre/diffs@1.7.0-beta.4`（元数据为 `apache-2.0`，t3code 对它打了补丁），搬时要带 Apache-2.0 全文并注明修改。Office 预览来自 opencode（MIT）。
4. **终端**：libghostty-vt（MIT）可用，带版权行。
5. **一律不搬**：品牌资产（§1）、libatomic（GPL）、`.repos/*` 快照、手机端模块、Rust 截图工具。
6. **搬任何一段代码**都在 cle-core 的 NOTICE 里加：t3code 提交号、原文件路径、`Copyright (c) 2026 T3 Tools Inc.` + MIT 全文；若段落里本身含 vendored 代码，再加对应原作者版权行。
7. 原样使用官方发布包（PLAN 当前做法）不需要额外操作：官方包自带 `third-party-licenses.json`；碧琪只需保留 `NOTICES-draft.md` 里的 T3 MIT 说明，且不能删改包内许可证文件（含 Linux 包的 `lib/libatomic.so.1.LICENSE`）。

## 6. 未覆盖 / 后续

- 约 1790 个 npm 包、全部 Rust crate、全部 Gradle 依赖的许可证未核实（本机无缓存，按规矩不联网拉包）。补核最省事的办法：在一次性隔离环境里跑一次官方构建，直接取它生成的 `third-party-licenses.json`；或下载官方发布包读里面的清单。这两条都要在隔离环境做，不在本机做。
- 三个智能体 SDK 的条款原文未读到。
- 本文只看了一个提交；t3code 每天在动，搬之前按搬的那个提交重核 §3.2。

## 附录 A：`apps/server` 生产闭包里未核实的 156 个包

```
@anthropic-ai/claude-agent-sdk@0.3.321 @anthropic-ai/sdk@0.93.0 @bufbuild/protobuf@1.10.0
@connectrpc/connect-web@1.7.0 @connectrpc/connect@1.7.0
@cursor/sdk@1.5.0 @cursor/sdk-{darwin-arm64,darwin-x64,linux-arm64,linux-x64,win32-x64}@1.5.0
@effect/platform-node-shared@4.1.6 @effect/platform-node@4.1.6 effect@4.1.6
@ff-labs/fff-node@0.11.0 @ff-labs/fff-bin-{android-arm64,darwin-arm64,darwin-x64,linux-arm64-gnu,linux-arm64-musl,linux-x64-gnu,linux-x64-musl,win32-arm64,win32-x64}@0.11.0
@generaltranslation/api@0.5.6 @generaltranslation/format@0.1.9 @generaltranslation/icu@0.1.2 generaltranslation@9.5.9 gt-i18n@1.0.40
@hono/node-server@2.1.6 hono@4.13.17
koffi@3.3.6 @koromix/koffi-{android-arm64,android-x64,darwin-arm64,darwin-x64,freebsd-arm64,freebsd-ia32,freebsd-x64,linux-arm64,linux-arm,linux-ia32,linux-loong64,linux-ppc64,linux-riscv64,linux-x64,openbsd-arm64,openbsd-ia32,openbsd-x64,win32-arm64,win32-ia32,win32-x64}@3.3.6
@modelcontextprotocol/sdk@1.32.2 @muse-code/sdk@1.4.6
@noble/curves@1.9.1 @noble/hashes@1.8.0 @noble/hashes@2.4.0
@opencode-ai/sdk@1.15.13 @opencode/client@2.0.28 @opencode/protocol@2.0.28 @opencode/schema@2.0.28
redis@6.2.1 @redis/{bloom,client,json,search,time-series}@6.2.1 cluster-key-slot@1.1.2
@statsig/client-core@3.31.0 @statsig/js-client@3.31.0
transcribe-cpp@0.4.1 @transcribe-cpp/{darwin-arm64-metal,darwin-x64-cpu,linux-arm64-cpu-vulkan,linux-x64-cpu-vulkan,win32-x64-cpu-vulkan}@0.4.1
@types/hast@3.0.5 @types/node@24.12.4 @types/ws@8.18.2 undici-types@7.16.0
@ungap/structured-clone@1.3.1
ffi-rs@1.3.2 @yuuang/ffi-rs-{android-arm64,darwin-arm64,darwin-x64,linux-arm-gnueabihf,linux-arm64-gnu,linux-arm64-musl,linux-x64-gnu,linux-x64-musl,win32-arm64-msvc,win32-ia32-msvc,win32-x64-msvc}@1.3.2
body-parser@2.4.0 content-type@2.1.0 express-rate-limit@8.7.3 path-to-regexp@8.4.2 proxy-addr@2.0.8 qs@6.17.1 range-parser@1.2.1
bufferutil@4.1.0 utf-8-validate@6.0.6 ws@8.22.0 node-addon-api@7.1.1 node-pty@1.2.0-beta.15
diff@8.0.3 entities@6.0.1 escape-string-regexp@5.0.0 fast-uri@3.1.9 iconv-lite@0.7.3 ip-address@10.7.6 jose@6.2.2
hast-util-from-parse5@8.0.3 hast-util-parse-selector@4.0.0 hast-util-raw@9.1.0 hast-util-sanitize@5.0.2 hast-util-to-parse5@8.0.1 hastscript@9.0.1
markdown-table@3.0.4 mdast-util-directive@3.1.0 mdast-util-find-and-replace@3.0.2 mdast-util-gfm@3.1.0
mdast-util-gfm-{autolink-literal@2.0.1,footnote@2.1.0,strikethrough@2.0.0,table@2.0.0,task-list-item@2.0.0}
mdast-util-math@3.0.0 mdast-util-newline-to-break@2.0.0
micromark-extension-directive@4.0.0 micromark-extension-gfm@3.0.0
micromark-extension-gfm-{autolink-literal@2.1.0,footnote@2.1.0,strikethrough@2.1.0,table@2.1.1,tagfilter@2.0.0,task-list-item@2.1.0}
micromark-extension-math@(npm:micromark-extension-llm-math@3.1.0)
parse5@7.3.0 pend@1.2.0 playwright-core@1.64.1
rehype-raw@7.0.0 rehype-sanitize@6.0.0 remark-breaks@4.0.0 remark-gfm@4.0.1 remark-math@6.0.0 remark-stringify@11.0.0
stream-chain@4.2.5 stream-json@3.7.0 supports-color@8.1.1 undici@8.12.4
unist-util-remove-position@5.0.0 vfile-location@5.0.3 web-namespaces@2.0.1 yauzl@3.4.0 zod@4.6.7
```

其中 config 里已有手写许可声明、可作为线索的：`@bufbuild/protobuf`（Apache-2.0 + BSD-3-Clause）、`@connectrpc/*`（Apache-2.0）、`@yuuang/ffi-rs-*`（MIT）、`@opencode-ai/sdk` 与 `anomalyco/opencode` 仓库（MIT）、`fff` 仓库（MIT）、`remark-math`（MIT）、`micromark-extension-llm-math`（MIT）。这些仍按「未核实」计，直到读到包内原文。

## 附录 B：复现方式

1. `git clone --depth 1 https://github.com/pingdotgg/t3code.git <临时目录>`，确认 `git log -1` 为上面的提交号。
2. 只用 `git show HEAD:<路径>` 读 `pnpm-lock.yaml`、各 `package.json`、`Cargo.lock`、`build.gradle`、LICENSE / NOTICE。
3. 依赖许可证只从本机已有的 pnpm 仓库索引（`store/v11/index.db`，只读打开）按锁文件 integrity 精确匹配读取包内 `package.json` 与许可证文件。
4. 分析脚本放在与克隆目录分开的临时目录，用 `python3 -I` 运行；不进本仓库。
