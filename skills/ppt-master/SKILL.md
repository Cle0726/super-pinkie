---
disable-model-invocation: true
name: ppt-master
description: 可编辑 PPT（.pptx）全流程：课件、汇报、路演，品牌模板、上万个图标、音效和动画。AI-driven presentation workflow for generating editable PPTX decks and slides, reconstructing page visuals, creating reusable Brand/Style/Layout/Deck workspaces, filling native PPTX templates, and enhancing finished PPTX files. Use when the user asks to create, generate, reconstruct, regenerate, bea
---

# ppt-master（第一次用时下载）

这个技能很大（约 40 MB、一万多个文件），不随安装包发。来源 https://github.com/hugohe3/ppt-master（MIT，版本 4a68cdd）。

1. 先看下载好了没有：运行
   `python3 "<本文件所在文件夹>/../pinkie-skill-library/fetch_skill.py" ppt-master`
   （Windows 上把 `python3` 换成 `python`）。它会下载到这台电脑上碧琪的状态目录（已经下过就直接返回），最后一行打印 `SKILL=<路径>`，前面一行是记进下载账本的命令，照着跑。下载要几分钟，可以放后台跑，等的时候先做不依赖它的事。
2. 读 `SKILL=` 后面那个 SKILL.md，照它做。之后这个会话再用就直接读那个路径。
3. 下载失败（网络不通）就告诉先生是哪个网址下不动，先用别的技能做出来。
