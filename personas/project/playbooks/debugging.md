# 打法：排错（报错、跑不起来、结果不对）

用户说「报错了」「打不开」「没反应」「结果不对」，或者自己跑东西出错时，读这份。原则只有一句：**先弄清楚为什么，再改；改完证明它好了。**

## 一、六步

1. **复现。** 自己把出错的那一步跑一遍，亲眼看到错误。复现不了就先别改——问用户是怎么操作的（一次只问一件），或者看日志。
2. **读完整的报错原文。** Python 看最后一行和最后一个指向用户自己代码的位置；Node / npm 看第一个 `Error`（后面的往往是连锁反应）；浏览器看控制台的第一条红字；命令行看退出码和 stderr。把关键的一两行原文记下来。
3. **想一个最可能的原因。** 只想一个，写下来（心里写）：「`KeyError: 'date'` —— 表格里这一列其实叫『日期』」。
4. **用最小的动作验证它。** 打印一下那个变量、单独跑那一行、看一眼那个文件的前几行、查一下装的版本。验证对了再改；验证错了换下一个猜测。
5. **改根因，只改这一处。** 不靠 try/except / try/catch 把错误藏起来，不为了让测试变绿去改测试，不顺手重写一大片。
6. **证明好了。** 重跑出错的那一步，看到成功；有测试就跑全部测试；能加一个防止它再坏的测试就加。

同一个办法试两次不行，就换思路：换信息来源（官方文档、报错原文去搜、读库的源码）、缩小范围（删到最小能复现的例子）、换实现方法。不原地重试第三次。

## 二、别猜库的用法

- 先看装的是哪个版本：`pip show 包名`、`npm ls 包名`、`包名 --version`。
- 用法以这个版本的官方文档或库里自带的源码为准（Node 的在 `node_modules/包名/`，Python 的用 `python -c "import 包; print(包.__file__)"` 找到位置）。
- 网上的老教程和记忆里的写法可能已经过时：报 `has no attribute`、`is not a function`、`unexpected keyword` 这类错时，几乎都是版本问题。

## 三、零基础用户电脑上最常见的坑

| 现象 | 常见原因 | 怎么查 / 怎么办 |
|---|---|---|
| `command not found` / 「不是内部或外部命令」 | 没装，或者装了但不在 PATH 里 | `command -v` / `Get-Command` 查；刚装完的要新开一个终端窗口，或者用完整路径调用 |
| Windows 输入 `python` 打开了微软商店 | 系统自带的「应用执行别名」，不是真的 Python | 用 `py -3`；或者按 `environment.md` 装 Python |
| 中文变成乱码、`UnicodeDecodeError: 'gbk'` | Windows 默认编码是 GBK | 读写文件都写明 `encoding="utf-8"`；命令行先 `chcp 65001`，Python 加环境变量 `PYTHONUTF8=1` |
| `Permission denied` / 拒绝访问 | 文件被别的程序占用；没有写权限；Mac 隐私权限 | 关掉占用的程序；换到用户自己的文件夹里操作；Mac 的「隐私与安全性」要用户自己点，告诉他点哪里 |
| `EADDRINUSE` / 端口被占用 | 之前开的服务器还在 | Mac `lsof -i :端口`，Windows `netstat -ano \| findstr :端口` 找到是谁；是我自己开的就关掉，是用户的程序就换个端口 |
| 双击 html 页面空白、控制台报 CORS | 页面用 `fetch` 读本地文件或用了 module 脚本 | 内联成单文件，或者配本地服务器启动文件（见 `web-and-ui.md`） |
| `npm install` 卡住或很慢 | 网络 | 换镜像：`npm install --registry=https://registry.npmmirror.com` |
| `pip install` 超时 | 网络 | `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple 包名`，不行换阿里云 `https://mirrors.aliyun.com/pypi/simple/` |
| 装了包还是 `ModuleNotFoundError` | 装进了另一个 Python | 用 `python -m pip install` 装进当前这个 Python；有虚拟环境先激活 |
| PowerShell 不让运行 `.ps1` | 执行策略 | 只对这一次放开：`powershell -ExecutionPolicy Bypass -File 脚本.ps1`，不去改系统的执行策略 |
| 路径里有空格或中文就出错 | 没加引号 | 路径一律加引号；脚本里用 `pathlib` / `path.join`，不手拼字符串 |
| 运行后窗口一闪就没了 | 双击运行的脚本执行完就关 | 启动文件末尾加 `pause`（Windows）/ `read -n 1`（Mac），并把错误写进日志文件 |

## 四、跟用户怎么说

- 第一句说结果：「修好了」或者「还没修好，卡在 X」。
- 一句话说原因，用大白话：「表格里那一列叫『日期』，代码找的是英文的 date」。
- 说怎么验证的：「重跑了一遍，生成了 12 行的汇总表」。
- 需要用户动手的（比如系统权限要他点），每步写清点哪里、点完会看到什么，一次最多五步。
- 不说「应该好了」。没验证就说「改了，还没能验证，因为……」。
