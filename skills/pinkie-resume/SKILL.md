---
disable-model-invocation: true
name: pinkie-resume
description: 简历：把先生的经历填进一份 YAML，用开源的 RenderCV（MIT）排出专业的 PDF 简历（另出 PNG 预览），几套主题可换，中英文都行。先生要写简历、改简历、做英文简历、求职材料时用。
---

# 简历（RenderCV）

开源的 [RenderCV](https://github.com/rendercv/rendercv)（MIT）：内容写在 YAML 里，排版交给它，出来的 PDF 对齐、字距、分页都是专业水准。

## 1. 准备（第一次用）

装进碧琪的专用 Python（`TOOLS.md` 里记着；Mac 一般是 `~/.openclaw/agent-env/bin/python3`）：

```
<python> -m pip install "rendercv[full]"
```

命令是同一个环境里的 `rendercv`（Mac `<环境>/bin/rendercv`，Windows `<环境>\Scripts\rendercv.exe`）。装好记进下载账本。

## 2. 起一份

在这件活的文件夹里：

```
rendercv new "张三" --theme classic
```

会生成 `张三_CV.yaml`。主题可选 `classic`（稳妥，默认）、`sb2nov`、`moderncv`、`engineeringresumes`、`engineeringclassic`；先生没指定就先用 classic，再出一版别的给他挑。

## 3. 填内容

- 打开 YAML，把示例内容全部换成先生的真实经历：`cv.name`、`headline`（一句话定位）、`email`、`phone`、`location`，`sections` 里按「教育 / 工作经历 / 项目 / 技能」填。
- 每条经历写成「做了什么 + 结果（尽量有数字）」。先生没给的数字、日期、公司名不要编：用【请补充】标出来，交付时列给他。
- 中文简历：在 `design:` 下面加

  ```yaml
  design:
    theme: classic
    page:
      size: a4
    typography:
      font_family: PingFang SC      # Mac；Windows 用 Microsoft YaHei
  ```

  渲染出来有方框（缺字）时：下载开源的思源黑体（Noto Sans SC，SIL OFL）放到 YAML 旁边的 `fonts/` 文件夹，`font_family: Noto Sans SC`，记进下载账本。
- 英文简历保持默认字体，`page: size:` 投美国用 `us-letter`，其他用 `a4`。

## 4. 出 PDF

```
rendercv render "张三_CV.yaml"
```

结果在 `rendercv_output/`：PDF、每页 PNG、Markdown、HTML。YAML 写错时它会指出哪一行，照提示改。

## 5. 交付前

- 用 `read` 打开 `rendercv_output/` 里第 1 页的 PNG 亲眼看：中文没有方框、没有一行就一两个字、一页能放下就放一页（放不下先删弱的条目，不要缩字号）。
- 交 PDF；顺手告诉先生要改内容只改 YAML 再跑一次 `render`，并列出所有【请补充】。
- 先生要简历网站：内容用这份 YAML，做法看 `design-taste-frontend` 技能。
