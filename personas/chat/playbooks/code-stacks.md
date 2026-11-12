# 打法：各种技术的速查卡（装、跑、测、查、常见的坑）

写代码时拿不准某种技术的命令和坑，读对应的那一张卡。做事的整体方法在 `coding.md`。**项目自己写明的命令优先于这里的命令**；这里的命令是项目没写时的默认做法。Windows 上的命令写在括号里。

## Python

- **认出来：** `pyproject.toml`、`requirements.txt`、`.py` 文件。
- **环境：** 每个项目一个虚拟环境，不往系统 Python 里装。`python3 -m venv .venv`（Windows `py -3 -m venv .venv`），之后一律用 `.venv/bin/python`（Windows `.venv\Scripts\python.exe`）调用，不依赖「激活」。有 `uv` 就用 `uv venv`、`uv pip install`，快很多。
- **装依赖：** `.venv/bin/python -m pip install -r requirements.txt`；国内慢就加 `-i https://pypi.tuna.tsinghua.edu.cn/simple`。
- **跑：** `.venv/bin/python 文件.py`；包里的模块用 `python -m 包.模块`。
- **测：** 有 `pytest` 用 `python -m pytest -q`；没有就用自带的 `python -m unittest -v`。
- **查：** 语法 `python -m py_compile 文件.py`；有 `ruff` 就 `ruff check .`。
- **坑：** 读写文件一律写 `encoding="utf-8"`（Windows 默认是 GBK）；路径用 `pathlib.Path`；Windows 上 `python` 可能打开微软商店，用 `py -3`；不要写 `except: pass`；可变的默认参数（`def f(x=[])`）会在多次调用之间共用。

## Node.js / TypeScript

- **认出来：** `package.json`。看 `scripts` 段有哪些命令，看有没有 `pnpm-lock.yaml`（用 pnpm）、`yarn.lock`（用 yarn）、`package-lock.json`（用 npm）——用项目已经在用的那个，不混用。
- **装依赖：** `npm install`；国内慢就 `npm install --registry=https://registry.npmmirror.com`。
- **跑：** 照 `scripts`：`npm run dev`、`npm start`。单个文件 `node 文件.mjs`。
- **测：** `npm test`（先确认 `scripts` 里真有 `test`）；自带的测试器 `node --test`。
- **查：** 语法 `node --check 文件.js`；TypeScript `npx tsc --noEmit`；有 lint 脚本就 `npm run lint`。
- **坑：** `import` 和 `require` 不能随便混，看 `package.json` 的 `"type"`；`.mjs` 里没有 `__dirname`，用 `import.meta.url`；异步函数忘了 `await` 不会报错只会拿到一个 Promise；TypeScript 报类型错时改代码，不用 `any` 和 `@ts-ignore` 盖过去；开发服务器是常驻进程，放后台跑，别让它卡住这一轮。

## 纯网页（HTML / CSS / JS）

- **认出来：** 只有 `.html`、`.css`、`.js`，没有包清单。
- **跑：** 双击 `index.html` 就能开的最好。用了 `fetch` 读本地文件、ES 模块时，双击会被浏览器拦住，要起一个本地服务器：`python3 -m http.server 8000`（Windows `py -3 -m http.server 8000`），放后台。
- **测和查：** 用截图工具打开页面截图亲眼看，同时读浏览器控制台有没有红字；交互要真的点一遍。
- **坑：** 给零基础用户的小工具尽量做成一个文件、不依赖外网（库下到本地，不引 CDN）；数据存 `localStorage` 时告诉用户「换浏览器或清缓存会丢」，重要数据提供导出；手机宽度也要看一眼。

## React / Vue 等前端框架

- **认出来：** `package.json` 的依赖里有 `react`、`vue`、`next`、`vite`、`nuxt`。
- **规矩：** 项目用哪个框架、哪种写法（函数组件还是类、组合式还是选项式、用什么状态库和样式方案）就跟着用；新组件照旁边的组件写。
- **跑和测：** 照 `scripts`。改了界面要启动开发服务器，打开那一页截图看。
- **坑：** React 里不直接改 state 对象（要给一个新对象）；`useEffect` 的依赖数组写全；列表的 `key` 用稳定的 id 不用下标；Vue 里解构响应式对象会丢失响应。新建项目用 `npm create vite@latest`，不用已经停止维护的脚手架。

## 命令行：Shell 和 PowerShell

- **先看在哪种系统上**（系统提示里的 `os=`）。Mac / Linux 写 bash 或 zsh 能跑的，Windows 写 PowerShell 能跑的。
- **对照：** 查命令在不在 `command -v 名字`（`Get-Command 名字`）；环境变量 `export A=1`（`$env:A = "1"`）；连着跑 `a && b`（Windows PowerShell 5 不认 `&&`，分两条或写 `a; if ($?) { b }`）；找文件 `find . -name "*.py"`（`Get-ChildItem -Recurse -Filter *.py`）；看端口 `lsof -i :8000`（`netstat -ano | findstr :8000`）。
- **坑：** 路径里有空格或中文一定加引号；Windows 的 `.ps1` 文件带中文要存成带 BOM 的 UTF-8；脚本开头写 `set -euo pipefail`（PowerShell 写 `$ErrorActionPreference = "Stop"`），出错就停，不带着错往下跑；删除和覆盖的命令先打印出要动哪些文件，看过再执行。

## 数据库：SQLite / SQL

- **选哪个：** 一个人用的小工具用 SQLite（一个文件，不用装服务）。Python 自带 `sqlite3`。
- **规矩：** 值一律用参数传（`?` 占位），不把用户输入拼进 SQL 字符串；改表结构之前先备份那个数据库文件；多步写入放在一个事务里。
- **查：** 改完用一条 `SELECT` 把数据读回来看；用 `EXPLAIN QUERY PLAN` 看慢查询有没有走索引。
- **坑：** SQLite 的日期是字符串，统一存 `YYYY-MM-DD HH:MM:SS`；默认不检查外键，要 `PRAGMA foreign_keys = ON`。

## Git

- **日常：** `git status` 看现状；`git diff` 看改了什么；`git add 具体文件` 加这次的文件（不用 `git add -A`，会把不相干的也带进去）；`git commit -m "做了什么"`。
- **退回：** 丢掉某个文件没提交的改动 `git restore 文件`；看历史 `git log --oneline -10`；回到某个提交看一眼 `git stash` 之后 `git checkout 提交号`（看完 `git checkout -` 再 `git stash pop`）。
- **不做的事（除非用户明说）：** 推送、强制推送、改已有的历史（`rebase`、`reset --hard`、`commit --amend` 已推送的提交）、删分支、改 git 配置。
- **坑：** 提交前看一眼 `git status`，别把密钥、`node_modules`、`.venv`、大文件提交进去；先建 `.gitignore`。

## 桌面软件、小程序、手机 App

这几类先读 `apps-games-ai.md`，它讲了各自怎么选技术、怎么在用户电脑上跑起来、怎么验证。

## 没列在这里的技术

先读项目的 `README` 和包清单找命令；找不到就查这门技术的官方「快速开始」。查到并验证过能用的命令，记进 `TOOLS.md`，下次不用再查。
