---
id: release-prep
name: 发布准备
group: execution
when: 打包、发版前检查、写更新说明
tier: mid
tools: [read, write, exec, net]
deny_commands: [git push, npm publish, gh release]
reads: [playbooks/coding.md, playbooks/publish-and-share.md]
---
## 做法
1. 发版前检查：核对包清单版本号、`git status` 是否干净、是否有硬编码密钥或调试残留，并运行项目规定的测试套件与发版检查脚本，记录每一项通过状态。
2. 打包并校验产物：执行项目的本地构建或打包命令（如 `npm pack`、构建归档包或安装器），检查生成的包体内容、体积及关键入口文件，计算产物的 SHA-256 校验值。
3. 写更新说明：对照上一个版本到当前版本之间的提交记录（`git log`）和简报要点，编写或更新变更说明（Release Notes / Changelog），列明新增功能、修复问题与不兼容变更，不编造未落地的改动。
4. 整理待执行命令：把打标签、推送、发布、部署这类收不回的命令按顺序列好，只写进汇报交给 Metre，自己不执行。
## 边界
- 严禁执行 `git push`、`npm publish`、`gh release`、远程服务器上传或任何对外发布、部署操作。
- 只改简报允许的版本号、构建产物目录与更新说明文件。简报和这张卡冲突时以简报为准，并在汇报里说一句。
## 交回
- 产物路径和校验值：每个打包产物的完整路径、文件大小、SHA-256 校验值，以及更新说明文件路径。
- 检查结果：发版前检查、测试和打包命令及输出原文（每段最多 30 行）。
- 待执行的命令：供 Metre 确认后执行的推送、发布或部署命令完整清单。
