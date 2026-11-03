# 打法：认清电脑、补齐工具

要用的工具不在、或者不确定在不在时，读这份。原则：**缺工具是我该先解决的小任务，不是交差的理由；能装在用户空间的直接装，要管理员密码或改系统的先问。**

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
| 浏览器自动化 / 截图 | Python 的 `playwright` 包，优先接电脑上已有的 Chrome / Edge（`channel="chrome"` / `"msedge"`） | 都没有时 `python -m playwright install chromium`（几百 MB，网络慢时先说一声） |

**要先问用户的：** 需要输入管理员密码或弹出 Windows 的「是否允许更改」窗口的安装、装 Homebrew 本身、改系统设置、装驱动或常驻后台的服务、要花钱、体积几个 G 的。问的时候说清楚：装什么、为什么要装、大概多大、装在哪。

## 三、模型、创作资产与能力补齐

工具存在不等于能做成作品。凡任务需要模型权重、LoRA、音色、字体、模板、素材包或其他可复现资产，先检查：**来源与授权、版本、下载体积、硬盘余量、内存/显存、芯片兼容性、缓存位置和实际调用方法**。重活同时按 `machine.md` 先测机器。

| 缺什么 | 默认动作 | 补齐验收 |
|---|---|---|
| 小型依赖、字体、插件、工具资源 | 直接装进项目或用户空间 | 跑版本号或最小样例 |
| 小于约 1GB 的模型/权重，且硬盘和内存足够 | 直接下载到项目缓存或用户缓存，并注明来源 | 做一次真实最小推理 |
| 1–5GB 的模型、音色库或素材包 | 先测硬盘、机器和下载代价；不需权限且机器能带动时告知后下载 | 跑样片并记录速度、缓存位置 |
| 超过 5GB、本地大模型、训练权重、驱动或常驻服务 | 先问用户确认 | 确认后安装并跑样例 |
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

## 四、绝不拿差的东西顶替

- 要截图验证 → 真的截图（装 Playwright 或用已有浏览器），不用「代码看起来没问题」代替。
- 要做视频 → 真的渲染出来并抽帧看，不交一份「分镜脚本」说「你可以用剪映做」。
- 要图片 → 用 `image_generate` 生成真图，不用 SVG 或代码画图顶替（用户要的是图表、流程图时除外）。
- 要读 PDF / Word / Excel → 装对应的库读出来，不说「我看不了这个格式」。
- 所有路都试过还是不行，才交降级版，并且**第一句**就说清：差在哪、为什么、要什么条件才能做成完整版。

## 五、装好的东西记下来

每装好、核对过一个工具，就在 `TOOLS.md` 里补一行：叫什么、装在哪（完整路径）、怎么调用、有什么坑（比如「中文字幕要指定字体」）。`TOOLS.md` 是这台电脑自己的说明，更新碧琪不会覆盖它。下次直接照着用，不用重新摸索。

## 六、示范

**Windows，用户要把一个视频剪成 30 秒并加中文字幕：**
1. `Get-Command ffmpeg -ErrorAction SilentlyContinue` 没有结果。
2. `winget install -e --id Gyan.FFmpeg`，装完当前终端找不到 → 先看 `$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe`，没有就在 `$env:LOCALAPPDATA\Microsoft\WinGet\Packages\` 下找 `ffmpeg.exe`，用完整路径调用。
3. 剪辑、烧字幕时指定中文字体：`subtitles=字幕.srt:force_style='FontName=Microsoft YaHei'`。
4. 抽 6 帧拼成一张图，用 `read` 亲眼看字幕清楚、没有方框乱码。
5. 交付成品；`TOOLS.md` 记一行「ffmpeg：winget 装的，路径……；中文字幕用 Microsoft YaHei」。

**Mac，用户要把一堆 Word 转成 PDF，电脑上没有 Office：**
1. 先看 `TOOLS.md` 和 `command -v soffice`：没有 LibreOffice。
2. 体积大 → 先说一声：「转 PDF 最稳的是装 LibreOffice，装好接近 1GB，装在应用程序里，要装吗？不装的话我用 python-docx 读文字再排成 PDF，但原来的排版会丢。」——这是体积大、要用户点头的情况，并且把降级的代价说在前面。

## 七、推送来的工具和技能在这台电脑用不了时

碧琪的工具（`look-page`、`look-doc`、`look-video`、检测脚本）、打法里的命令和 `skills/` 里的技能，多半是在 Mac 上写好、推送给所有人的。别人的电脑可能是 Windows、Intel 芯片、内存小、没装 Python / ffmpeg / Node、网络慢，照搬会报错。这是我的活，**不让用户自己去修**：

1. **先看现状。** 跑一次检测（Mac：`bash playbooks/machine-check.sh`；Windows：`powershell -ExecutionPolicy Bypass -File playbooks\machine-check.ps1`），把报错原文读完。
2. **判断是哪一类。**
   - 缺依赖（`command not found`、`No module named`、「不是内部或外部命令」）→ 按第二节装进用户空间或碧琪自己的环境（`TOOLS.md` 里写的专用环境），不动系统。
   - 路径或编码（写死了 `/opt/homebrew`、`~/Library`、`/System/Library/Fonts/…`、`qlmanage`、`open`、`pbcopy`、zsh 写法；中文路径乱码）→ 换成这台电脑的写法：Windows 字体在 `C:\Windows\Fonts\`（中文用 `msyh.ttc`），打开文件用 `start ""`，读写文件写明 UTF-8。
   - 芯片或系统版本（arm64 / x64 的程序、太老的系统）→ 换对应的版本，或改用纯 Python / 纯 Node 的等价库。
   - 网络（下载超时、GitHub 打不开）→ 按第三节换国内源或换渠道。
3. **能修就修，修不了就换。** 先改用法（加参数、换路径、换字体）；再换等价工具——没有 `look-page` 用 `web-and-ui.md` 里的截图脚本，没有 `look-doc` 按 `documents-and-slides.md` 导出 PDF 再转图，没有 `look-video` 用 ffmpeg 抽帧；都不行就做一个能用的小版本，并在**第一句**说清差在哪。
4. **记下来。** 改好的用法写进本机 `TOOLS.md`：哪个工具或技能、这台电脑上怎么调用、为什么跟原来的写法不一样。技能文件本身不改（更新会覆盖它），`TOOLS.md` 不会被覆盖，下次直接照着用。
