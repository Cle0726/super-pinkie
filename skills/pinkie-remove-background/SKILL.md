---
disable-model-invocation: true
name: pinkie-remove-background
description: 抠图去背景：人像、商品、宠物、logo 一键抠成透明 PNG，换纯色或换背景图，整个文件夹批量处理（rembg，MIT，本地运行，不上传图片）。先生要抠图、去背景、换背景、白底图、透明底时用。
---

# 抠图 / 去背景（rembg）

开源的 [rembg](https://github.com/danielgatis/rembg)（MIT），在这台电脑上跑，图片不上传。

## 1. 准备（第一次用）

装进碧琪的专用 Python（`TOOLS.md` 里记着；Mac 一般是 `~/.openclaw/agent-env/bin/python3`）：

```
<python> -m pip install "rembg[cpu,cli]"
```

装好后命令是同一个环境里的 `rembg`（Mac：`<环境>/bin/rembg`，Windows：`<环境>\Scripts\rembg.exe`）。第一次抠图会自动下载模型到 `~/.u2net/`（一百多 MB），下好记进下载账本。可以放后台装，等的时候先准备要换的背景。

## 2. 抠一张

```
rembg i -m isnet-general-use 输入.jpg 输出.png
```

- 模型怎么挑：通用和商品 `isnet-general-use`（默认用它）；人像 `u2net_human_seg`；动漫图 `isnet-anime`；边缘要求很高（头发丝、毛绒）用 `birefnet-general`（更大更慢，约 900 MB）。
- 头发丝、半透明边缘：加 `-a`（alpha matting），必要时 `-ae 15` 调边缘腐蚀。
- 只要遮罩（黑白图）：加 `-om`。

## 3. 换纯色底 / 换背景图

rembg 只负责抠。合成用 Pillow（专用环境里一般已经有）：

```python
from PIL import Image
fg = Image.open("输出.png").convert("RGBA")
bg = Image.new("RGBA", fg.size, "#FFFFFF")          # 纯色；换背景图就 Image.open(...).resize(fg.size)
bg.alpha_composite(fg); bg.convert("RGB").save("白底.jpg", quality=95)
```

电商白底图：主体居中、四周留白 5–10%、画布 800×800 或 1000×1000（平台有规定就照规定）。

## 4. 批量

```
rembg p -m isnet-general-use 输入文件夹 输出文件夹
```

## 5. 交付前

- 抠好的图放到**深色和浅色两种底**上各看一次（用 Pillow 拼一张对比图，`read` 打开看）：边缘有没有白边、缺块、头发被吃掉。
- 不满意先换模型或加 `-a` 再抠，不要把有白边的交出去。
- 证件照（换底 + 标准尺寸 + 排版冲印）用 `pinkie-id-photo`，比这里更合适。
