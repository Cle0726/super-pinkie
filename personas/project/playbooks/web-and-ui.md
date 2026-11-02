# 打法：做网页、界面和小工具

做任何「用户要打开来用、或者要看效果」的东西之前，完整读这份。它解决三件事：**选什么技术**、**怎么交给零基础的人还能用**、**怎么证明它真的好用、好看**。

## 一、技术怎么选（不问用户，按这张表定）

| 用户想要的 | 默认做法 | 为什么 |
|---|---|---|
| 一个页面给人看（介绍、作品、活动、海报式网页） | 单个 `index.html`（样式和脚本写在同一个文件里），双击就能打开 | 零基础的人只需要双击；不用装任何东西 |
| 自己用的小工具（记账、待办、计算器、抽签） | 单个 `index.html` + 浏览器本地存储（localStorage），加「导出 / 导入备份」按钮 | 不用服务器、不用数据库；导出按钮防止换浏览器或清缓存丢数据 |
| 多人一起用、手机电脑同步、要登录 | 先做单机版给用户看效果，同时说清楚多人版要一个服务器；用户确认要再做（Node 或 Python 小后端 + SQLite） | 多人版要部署、要花心思维护，先让用户确认值得 |
| 处理电脑里的文件（整理下载文件夹、批量改名、表格合并、转格式） | Python 脚本 + 一个双击启动的文件（见第三节） | Python 处理文件最稳，库最全 |
| 定时自动做的事 | Python 脚本；定时用系统自带的（Mac 的 launchd、Windows 的任务计划程序），**设置定时前先问用户** | 定时任务属于改系统，要用户点头 |
| 数据整理、报表、图表 | Python（pandas / openpyxl / matplotlib），结果输出成 Excel 或图片 | 小白最熟 Excel，交 Excel 比交代码有用 |
| 手机上用的 | 做成适配手机的网页（可以加到主屏幕），不做原生 App | 原生 App 要开发者账号、要打包上架，零基础用户走不通 |
| 用户已经有项目 | 沿用项目现有的语言、框架和风格，一样都不换 | 换技术栈是用户没要求的大改动 |

前端默认不用构建工具（不用 Vite、Webpack、React）——除非项目已经在用，或者页面复杂到不用就写不好（多页面、大量状态）。真要用框架时选最主流的（React + Vite），并且交付时把「怎么启动」做成双击的。

## 二、文件怎么放

新项目统一放在一个用户能找到的文件夹里（用户指定的位置，没指定就在工作区建一个名字说得清的文件夹，比如 `记账小工具/`），结构：

```
记账小工具/
  index.html        ← 主文件
  启动.command       ← Mac 双击启动（需要本地服务器时才有）
  启动.bat           ← Windows 双击启动（同上）
  使用说明.md         ← 三五行：怎么打开、数据存在哪、怎么备份
  tests/            ← 自动化测试（有逻辑的工具才需要）
```

新项目一开始就 `git init`，每完成一个里程碑提交一次（只在本地，不推送）。这样改坏了能退回，也方便自己回看改了什么。用户已有的、没有 git 的文件夹，大改之前先复制一份备份。

## 三、交给零基础的人：双击就能用

- **能双击 `index.html` 就打开的，别让用户敲命令。** 页面里用了 `fetch` 读本地文件、或者用了 `<script type="module">` 引用其他本地文件时，直接双击会因为浏览器安全限制打不开，这时要么把内容内联进一个文件，要么配一个启动文件开本地服务器：
  - Windows `启动.bat`：
    ```bat
    @echo off
    chcp 65001 >nul
    cd /d "%~dp0"
    start "" http://localhost:8765
    python -m http.server 8765
    ```
  - Mac `启动.command`（写完要 `chmod +x 启动.command`）：
    ```bash
    #!/bin/bash
    cd "$(dirname "$0")"
    open http://localhost:8765
    python3 -m http.server 8765
    ```
  - 用户电脑可能没有 Python：先检查，没有就换成内联的单文件做法，或者按 `environment.md` 装上。
- **Python 脚本也配双击启动文件**，里面先进脚本所在目录、激活虚拟环境、再运行；运行完 `pause`（Windows）或 `read -n 1`（Mac），让窗口别一闪就关、用户能看到结果。
- **交付时告诉用户的只有三件事：** 文件在哪（给完整路径）、怎么打开（双击哪个）、数据存在哪/怎么备份。再附上截图。

## 四、做得像样：每个界面都要过的关

- **真实内容。** 用贴近真实的示例数据（真实感的名字、金额、日期），不用 lorem ipsum、「测试 1」「测试 2」。
- **所有状态都要有样子：** 空的时候（第一次打开，一条数据都没有：给一句引导和一个按钮）、加载中、出错（用大白话说出了什么问题、怎么办）、内容超长（长名字、长句子不撑破布局）、很多条数据（100 条时还好用吗）。
- **手机能用。** `<meta name="viewport" content="width=device-width, initial-scale=1">` 必须有；手机宽度下没有横向滚动；按钮和可点的地方至少 44×44 像素；输入框字号 ≥16px（iPhone 上小于 16px 会自动放大页面）。
- **中文字体写全，两个系统都好看：**
  `font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;`
  Windows 上微软雅黑小字发糊：中文正文不小于 14px，不用 300 以下的细字重。
- **键盘和无障碍：** 表单有 label，按回车能提交，图片有 alt，颜色对比够（正文和背景对比 ≥ 4.5:1），不只靠颜色区分状态。
- **数据安全：** 本地存储的工具要有「导出备份 / 导入备份」；删除要能撤销或先确认。
- **不留调试残渣：** 没有 console 报错、没有 `console.log` 刷屏、没有写死的测试数据。

## 五、亲眼验证：截图脚本（Mac / Windows 都能用）

有 `look-page` 就用它。没有就用下面这个 Python 脚本（需要 `playwright`，装法见 `environment.md`），桌面和手机各截一张，同时抓控制台报错：

```python
# shot.py —— 用法：python shot.py index.html  （也可以是网址）
import sys, pathlib
from playwright.sync_api import sync_playwright

target = sys.argv[1]
url = target if target.startswith("http") else pathlib.Path(target).resolve().as_uri()
errors = []
with sync_playwright() as p:
    browser = None
    for channel in ("chrome", "msedge", None):  # 先用电脑上已装的 Chrome / Edge
        try:
            browser = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
            break
        except Exception:
            continue
    if browser is None:
        sys.exit("没有可用的浏览器：按 environment.md 装 Playwright 自带的 Chromium")
    for name, opts in {
        "desktop": dict(viewport={"width": 1440, "height": 900}),
        "mobile": dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True),
    }.items():
        page = browser.new_context(**opts).new_page()
        page.on("console", lambda m, n=name: errors.append(f"[{n}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e, n=name: errors.append(f"[{n}] {e}"))
        page.goto(url, wait_until="networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path=f"shot-{name}.png", full_page=True)
    browser.close()
print("截图：shot-desktop.png  shot-mobile.png")
print("控制台报错：" + ("\n".join(errors) if errors else "无"))
```

截完用 `read` 打开两张 PNG **亲眼看**，按 `design-review.md` 的清单挑问题。要验证交互（点按钮、填表单、刷新后数据还在），在同一个脚本里用 `page.click()`、`page.fill()`、`page.reload()` 走一遍，再截图。只看「文件生成了」「没报错」不算验证。

## 六、有逻辑就要有测试

- 计算、数据处理、增删改查这类逻辑，写自动化测试：纯 JS 的逻辑抽成函数，用 Node 自带的 `node --test` 跑；Python 用 `pytest`（没有就用 `unittest`）；界面流程用上面的 Playwright 脚本走一遍。
- 测试要能失败：先确认它在逻辑写错时会变红，再确认它现在是绿的。不为了变绿去改测试。
- 交付时说清：跑了哪些测试、几个通过。

## 七、用户问「能不能放到网上让别人看」

这是对外操作，先问。用户同意后给最省事的路：静态页面用免费的静态托管（比如 GitHub Pages、Cloudflare Pages、Netlify），需要用户自己登录账号的步骤分批给、每步写清点哪里。不替用户注册账号、不输入用户的密码。
