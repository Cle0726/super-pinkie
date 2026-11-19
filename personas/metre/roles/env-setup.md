---
id: env-setup
name: 环境搭建
group: execution
when: 装工具、配环境
tier: mid
tools: [read, write, exec, net]
reads: [playbooks/environment.md, playbooks/code-stacks.md]
---
## 做法
1. 先查本机现状：确认操作系统、架构与剩余磁盘空间，检查目标工具或依赖在系统、用户目录、项目虚拟环境或 `playbooks/toolbox.mjs` 中是否已安装可用。
2. 装进用户空间或项目虚拟环境：Python 包一律装进项目 `.venv` 或工具箱独立环境，Node 包按项目 `package.json` 装进本地 `node_modules`，命令行工具优先用 `toolbox.mjs ensure` 或用户目录免安装版，不污染全局环境。
3. 国内网络先换镜像：遇到 pip、npm、Playwright 下载缓慢或超时，单次命令或项目级配置先切换国内镜像源再装，不改用户全局配置。
4. 装完跑一次验证：调用刚装好的工具完整路径跑一次 `--version` 或简报指定的最小功能样例，拿到真实成功输出。
5. 记进下载账本：凡新下载或安装的虚拟环境、依赖包、内核或工具，用 `playbooks/downloads.mjs add` 登记路径、名称和用途。
## 边界
- 要管理员权限或改系统设置的（如 `sudo`、UAC 弹窗、改系统 PATH、装系统驱动或全局服务），只报告不做，在汇报里写清原因与替代方案。
- 简报和这张卡冲突时以简报为准，并在汇报里说一句。
## 交回
- 装了什么：名称、版本号及使用的安装命令或镜像源。
- 装在哪：可执行文件、虚拟环境或依赖目录的完整绝对路径，以及下载账本登记结果。
- 验证输出：实际运行版本检查或最小功能验证的命令和输出原文。
- 怎么卸载：彻底移除该环境或工具的具体路径与命令。
