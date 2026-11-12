# 打法：认清电脑、补齐工具

要用的工具不在、或者不确定在不在时，读这份。原则：**缺工具是我该先解决的小任务，不是交差的理由。做这件活需要的东西不管多大都自己下载装好，不用先问；只有要管理员密码、改系统、花钱的才先问。下载的东西都记进下载账本，作品交付以后再问先生要不要删。**

## 零、先用工具箱（一条命令查清、装好、试过）

工作区 `playbooks` 文件夹里有 `toolbox.mjs`，用碧琪自带的 node 跑，Mac 和 Windows 一样，写完整路径：

```
node <工作区>/playbooks/toolbox.mjs check                 # 只查：这台电脑现在有什么
node <工作区>/playbooks/toolbox.mjs ensure screenshot video   # 缺的装好，装完真的试一次
```

| 能力 | 是什么 | 什么活要用 |
|---|---|---|
| `python` | Python + 一个独立环境 | 处理文件、数据、下面几样的基础 |
| `screenshot` | 无界面浏览器 | 做网页后截图自己看、点一遍 |
| `video` | ffmpeg | 剪辑、合成、抽帧、烧字幕 |
| `docs` | 读写 PPT / Word / Excel / PDF、处理图片的包 | 做文档、表格、看成品内容 |
| `office-view` | LibreOffice | 把 PPT / Word 转成图片亲眼看版式 |
| `fonts-cjk` | 中文字体文件的位置 | 视频字幕、图片排字不出方框 |
| `git` | 版本管理 | 改坏了能退回 |

- **要用哪种能力，动手前先 `ensure` 它。** 它会按顺序试本机已有的、国内镜像、官方源，装在用户空间，不要管理员密码，装完用一个最小的真实样例验证（真截一张图、真合成一秒视频、真转一页 PDF）。
- 每个能力输出一行结果，里面的 `path` 就是之后调用要用的完整路径；最后一行是大白话，可以直接转给用户。
- 它说 `ok: false` 时，读 `note` 写的原因，再照下面各节手动补；`needs-user` 表示这一步要用户点一下或同意，把 `note` 里的话告诉他，同时先用 `note` 里给的替代办法把活做下去。
- 工具箱没有覆盖的东西（模型权重、素材包、别的命令行工具）照下面各节做。

## 一、先认清这台电脑（每个新会话第一次要动手时做一次）

- 系统提示 Runtime 一行里有 `os=`（darwin = Mac，win32 = Windows，linux）和 `arch=`（arm64 / x64）。
- 再看 `TOOLS.md`：这台电脑已经核对过的工具和坑都记在那里，照它来。里面「这台电脑」那一段是检测脚本写的配置和档位；要干重活（渲染、本地模型、大批量处理）而这一段没有或超过 30 天，先按 `machine.md` 跑一次检测。
- 拿不准某个工具在不在、是哪个版本，就查一下，不凭印象：
  - Mac：`command -v python3 node git ffmpeg; python3 --version; node --version`
  - Windows PowerShell：`Get-Command py, python, node, git, ffmpeg -ErrorAction SilentlyContinue | Select-Object Name, Source; py -3 --version`
- Windows 上的差别要记住：路径用 `\`、有中文或空格要加引号；PowerShell 的命令和 Mac 的 shell 不一样（`Remove-Item` 不是 `rm -rf`，环境变量是 `$env:NAME`）；中文系统默认编码 GBK，读写文件一律写明 UTF-8。

## 二、装在哪里：用户空间优先

| 东西 | 首选（不用管理员） | 备选 |
|---|---|---|
| Python 包 | 项目自己的虚拟环境：`python -m venv .venv`（或 `uv venv .venv`），再 `.venv` 里的 python `-m pip install 包名`；碧琪有专用环境的（看 `TOOLS.md`）就装进专用环境 | 不往系统 Python 里装，不用 `sudo pip` |
| Python 本身 | Mac：`uv python install 3.12`（有 uv 的话）；Windows：`winget install -e --id Python.Python.3.12 --scope user`（装在用户目录，不用管理员；这个参数不被支持时去掉再试） | 官网安装包，让用户双击（勾选「Add to PATH」） |
| Node 包 | 装进项目：`npm install 包名`（开发用的加 `-D`）；临时用 `npx 包名` | 不用 `npm install -g`，除非 `TOOLS.md` 说这台电脑就这么配的 |
| Node 本身 | Windows：`winget install -e --id OpenJS.NodeJS.LTS`；Mac：有 Homebrew 用 `brew install node`，没有就用官网的安装包或 nvm | |
| 命令行工具（ffmpeg、git、ImageMagick…） | Mac：`brew install 名字`；Windows：`winget install -e --id 包ID`（ffmpeg 是 `Gyan.FFmpeg`，git 是 `Git.Git`，ImageMagick 是 `ImageMagick.ImageMagick`） | 官方的免安装压缩包，解压到项目的 `.tools/` 目录，用完整路径调用 |
| 浏览器自动化 / 截图 | Python 的 `playwright` 包，优先接电脑上已有的 Chrome / Edge（`channel="chrome"` / `"msedge"`） | 都没有时 `python -m playwright install chromium`（几百 MB，直接装） |

**下载和安装不用问：** 这件活需要的依赖、工具、浏览器内核、字体、模板包、素材包、模型权重、音色，**不管多大都直接下载装好**，不先问先生，也不停下来说「要下载几个 G，可以吗」。下之前看一眼硬盘：剩下的空间不够，先清碧琪自己的缓存和账本里先生说过可以删的东西；还不够，才告诉先生卡在硬盘上。每样下载都记进下载账本（第七节）。

**仍要先问的只有这几种：** 要输入管理员密码，或者会弹出 Windows「是否允许更改」窗口的安装（包括装 Homebrew 本身）；改系统设置；装驱动或开机常驻的后台服务；要花钱，或者要新开付费账号、密钥、订阅。问的时候说清楚：装什么、为什么要装、装在哪。能换成不要权限的装法（装进用户目录、免安装版），就换了直接装，不去问。

## 三、模型、创作资产与能力补齐

工具存在不等于能做成作品。凡任务需要模型权重、LoRA、音色、字体、模板、素材包或其他可复现资产，先检查：**来源与授权、版本、下载体积、硬盘余量、内存/显存、芯片兼容性、缓存位置和实际调用方法**。重活同时按 `machine.md` 先测机器。

| 缺什么 | 默认动作 | 补齐验收 |
|---|---|---|
| 小型依赖、字体、插件、工具资源 | 直接装进项目或用户空间 | 跑版本号或最小样例 |
| 模型权重、音色库、素材包、模板包，**多大都一样** | 先按 `machine.md` 看这台电脑带不带得动（内存、显存、硬盘），带得动就直接下载到用户缓存，注明来源，记进下载账本 | 做一次真实的最小推理或样片，记下速度 |
| 这台电脑带不动的（内存或显存不够） | 不硬下；换更轻的同类，或者用已经配好的云端能力；交付时说清取舍 | 同上 |
| 驱动或开机常驻的服务 | 先问用户确认 | 确认后安装并跑样例 |
| 云端模型/API | 优先复用已配置能力；新增付费账户、密钥或订阅才问 | 用最小真实请求验证 |

**批量创作前先试样。** AI 短剧、连续角色、配音、3D、游戏资产等任务，先做一张角色定妆图、一句配音、一个场景或 3 秒样片。只有确认质量、角色/风格一致性、生成速度和机器负载都合格后，才能开始整集、整套或整批生产；不以“已下载”代替可用。

每次补齐后，把来源、版本、许可证要点、缓存路径、调用命令、实测速率和已知限制写入 `TOOLS.md`。模型或资产不适配这台机器时，优先寻找更轻的同类能力或现有云端能力；交付时明确说明质量、速度或成本取舍。

Windows 刚装完的工具，当前终端可能还找不到（PATH 没刷新）：用完整路径调用，或者让后续命令在新的终端里跑。

## 四、国内网络：先换源，再说失败

- pip：`pip install -i https://pypi.tuna.tsinghua.edu.cn/simple 包名`；不行换 `https://mirrors.aliyun.com/pypi/simple/`。uv 用 `--index-url 同样的地址`。
- npm：单次 `npm install --registry=https://registry.npmmirror.com`；一个项目长期用就在项目里放 `.npmrc`（写一行 `registry=https://registry.npmmirror.com`），不去改用户全局的 npm 设置。
- Playwright 下载浏览器慢：先试设置环境变量 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` 再装；还不行就改用电脑上已有的 Chrome / Edge。
- GitHub 下载慢：先找同一个软件的官方其他渠道（包管理器、官网镜像）。
- 一个源超时就换下一个，不在一个下载上干等；同一个源失败两次就换。

## 五、绝不拿差的东西顶替

- 要截图验证 → 真的截图（装 Playwright 或用已有浏览器），不用「代码看起来没问题」代替。
- 要做视频 → 真的渲染出来并抽帧看，不交一份「分镜脚本」说「你可以用剪映做」。
- 要图片 → 用 `image_generate` 生成真图，不用 SVG 或代码画图顶替（用户要的是图表、流程图时除外）。
- 要读 PDF / Word / Excel → 装对应的库读出来，不说「我看不了这个格式」。
- 所有路都试过还是不行，才交降级版，并且**第一句**就说清：差在哪、为什么、要什么条件才能做成完整版。

## 六、装好的东西记下来

每装好、核对过一个工具，就在 `TOOLS.md` 里补一行：叫什么、装在哪（完整路径）、怎么调用、有什么坑（比如「中文字幕要指定字体」）。`TOOLS.md` 是这台电脑自己的说明，更新碧琪不会覆盖它。下次直接照着用，不用重新摸索。

## 七、下载账本：做完再问要不要删

为了做活下载或安装的、占地方的东西（虚拟环境、浏览器内核、字体、模板包、素材包、模型、音色、免安装工具、大的 npm / pip 依赖），装好就登记一条。账本是工作区 `playbooks` 文件夹里的 `downloads.mjs`，用碧琪自带的 node 跑，写完整路径：

```
node <工作区>/playbooks/downloads.mjs add --path "<装在哪>" --what "<是什么，先生看得懂的名字>" --for "<为了哪件活>"
```

- **中途不问。** 做活的过程中只管下载和登记，不为了下载停下来问先生。
- **作品交付以后再问。** 交付成品的那条回复最后，跑一次 `node <工作区>/playbooks/downloads.mjs ask --for "<这件活>"`：它有输出，就把这句话原样附在最后（会列出下了什么、各多大）；没有输出就什么都不说。同一件活只问一次。
- **先生说删：** 跑 `remove <编号>` 或 `remove pending`，东西会进废纸篓或回收站，再用一句话报腾出了多少。**先生说留：** 跑 `keep <编号>` 或 `keep all`，以后不再问这几样。先生没回答就先留着，下次交付时只问新下载的。
- 只登记碧琪自己下载的东西；先生自己的文件、工作区、桌面、文稿这些位置，账本会拒绝登记，也绝不删。好几件活共用的东西（比如 ffmpeg、浏览器内核），问的时候说一句「以后做视频 / 截图都要用到，建议留着」。

## 八、示范

**Windows，用户要把一个视频剪成 30 秒并加中文字幕：**
1. `Get-Command ffmpeg -ErrorAction SilentlyContinue` 没有结果。
2. `winget install -e --id Gyan.FFmpeg`，装完当前终端找不到 → 先看 `$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe`，没有就在 `$env:LOCALAPPDATA\Microsoft\WinGet\Packages\` 下找 `ffmpeg.exe`，用完整路径调用。
3. 剪辑、烧字幕时指定中文字体：`subtitles=字幕.srt:force_style='FontName=Microsoft YaHei'`。
4. 抽 6 帧拼成一张图，用 `read` 亲眼看字幕清楚、没有方框乱码。
5. 交付成品；`TOOLS.md` 记一行「ffmpeg：winget 装的，路径……；中文字幕用 Microsoft YaHei」。

**Mac，用户要把一堆 Word 转成 PDF，电脑上没有 Office：**
1. 先看 `TOOLS.md` 和 `command -v soffice`：没有 LibreOffice。
2. 转 PDF 最稳的是 LibreOffice（接近 1GB）：不问，直接装（Mac：`brew install --cask libreoffice`；Windows：`winget install -e --id TheDocumentFoundation.LibreOffice`），装完用 `downloads.mjs add` 登记。只有弹出要管理员密码的窗口时，才停下来请先生输入。
3. 转成 PDF 后打开几页看排版对不对，再交付；交付回复最后附上 `downloads.mjs ask` 给出的那句话，比如「这次为了转 PDF 装了 LibreOffice（1.1 GB），以后转 Word / PPT 都用得上，建议留着；要删掉吗？」。

## 九、推送来的工具和技能在这台电脑用不了时

碧琪的工具（`look-page`、`look-doc`、`look-video`、检测脚本）、打法里的命令和 `skills/` 里的技能，多半是在 Mac 上写好、推送给所有人的。别人的电脑可能是 Windows、Intel 芯片、内存小、没装 Python / ffmpeg / Node、网络慢，照搬会报错。这是我的活，**不让用户自己去修**：

1. **先看现状。** 跑一次检测（Mac：`bash playbooks/machine-check.sh`；Windows：`powershell -ExecutionPolicy Bypass -File playbooks\machine-check.ps1`），把报错原文读完。
2. **判断是哪一类。**
   - 缺依赖（`command not found`、`No module named`、「不是内部或外部命令」）→ 按第二节装进用户空间或碧琪自己的环境（`TOOLS.md` 里写的专用环境），不动系统。
   - 路径或编码（写死了 `/opt/homebrew`、`~/Library`、`/System/Library/Fonts/…`、`qlmanage`、`open`、`pbcopy`、zsh 写法；中文路径乱码）→ 换成这台电脑的写法：Windows 字体在 `C:\Windows\Fonts\`（中文用 `msyh.ttc`），打开文件用 `start ""`，读写文件写明 UTF-8。
   - 芯片或系统版本（arm64 / x64 的程序、太老的系统）→ 换对应的版本，或改用纯 Python / 纯 Node 的等价库。
   - 网络（下载超时、GitHub 打不开）→ 按第四节换国内源或换渠道。
3. **能修就修，修不了就换。** 先改用法（加参数、换路径、换字体）；再换等价工具——没有 `look-page` 用 `web-and-ui.md` 里的截图脚本，没有 `look-doc` 按 `documents-and-slides.md` 导出 PDF 再转图，没有 `look-video` 用 ffmpeg 抽帧；都不行就做一个能用的小版本，并在**第一句**说清差在哪。
4. **记下来。** 改好的用法写进本机 `TOOLS.md`：哪个工具或技能、这台电脑上怎么调用、为什么跟原来的写法不一样。技能文件本身不改（更新会覆盖它），`TOOLS.md` 不会被覆盖，下次直接照着用。
