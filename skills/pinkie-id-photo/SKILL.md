---
disable-model-invocation: true
name: pinkie-id-photo
description: 证件照：用一张普通自拍做标准证件照（一寸、二寸、护照、签证、考试报名各种尺寸），换白 / 蓝 / 红底，出六寸排版冲印图（HivisionIDPhotos，Apache-2.0，本地运行，不上传照片）。先生要证件照、换底色、一寸照、简历照时用。
---

# 证件照（HivisionIDPhotos）

开源的 [HivisionIDPhotos](https://github.com/Zeyi-Lin/HivisionIDPhotos)（Apache-2.0）。照片只在这台电脑上处理。

## 1. 准备（第一次用，约 500 MB，放后台）

装到碧琪的工具目录（Mac `~/.openclaw/pinkie-tools/`，Windows `%LOCALAPPDATA%\pinkie-tools\`），**用它自己的独立环境**：它锁死 `numpy<=1.26.4`，装进碧琪共用的专用 Python 会把 rembg、scipy 这些弄坏（11-04 实测）。

```
git clone --depth 1 https://github.com/Zeyi-Lin/HivisionIDPhotos.git <工具目录>/HivisionIDPhotos
cd <工具目录>/HivisionIDPhotos
<专用 Python> -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements-app.txt pillow
.venv/bin/python scripts/download_model.py --models hivision_modnet
```

Windows 把 `.venv/bin/python` 换成 `.venv\Scripts\python.exe`。两个 requirements 都要装（README 也是这么写的）：只装第一个会缺 Pillow 和 gradio，一跑就报 `No module named`。

没有 git：从 `https://codeload.github.com/Zeyi-Lin/HivisionIDPhotos/zip/refs/heads/master` 下载压缩包解开。模型下不动时直接下这个文件放进 `hivision/creator/weights/`：
`https://github.com/Zeyi-Lin/HivisionIDPhotos/releases/download/pretrained-model/hivision_modnet.onnx`（25 MB）。装好记进下载账本。

## 2. 出证件照（在 HivisionIDPhotos 文件夹里跑，`<py>` = `.venv/bin/python`）

```
<py> inference.py -i 自拍.jpg -o 证件照.png --height 413 --width 295 --matting_model hivision_modnet
<py> inference.py -t add_background -i 证件照.png -o 证件照_蓝底.jpg -c 438edb -k 300
<py> inference.py -t generate_layout_photos -i 证件照_蓝底.jpg -o 六寸排版.jpg --height 413 --width 295 -k 800
```

- `--matting_model hivision_modnet` 每次都要带：不带时它默认找另一个没下载的模型，报 `NoneType ... copy`。
- 第一步会同时出标准版 `证件照.png` 和高清版 `证件照_hd.png`（透明底）。
- 换底和排版一定要带 `-k`（单位 KB，不是 dpi）：不带时它把透明 PNG 存成 `.jpg` 名字（冲印机可能不认），排版那步直接报 `could not broadcast ... (413,295,4)`。报名网站限制大小就填它的上限（比如 `-k 200`）；`--dpi 300` 是默认值。

常用尺寸（像素，300 dpi，`--height` × `--width`）：

| 用途 | 高 × 宽 |
|---|---|
| 一寸（25×35 mm） | 413 × 295 |
| 小一寸（22×32 mm，驾照等） | 378 × 260 |
| 大一寸（33×48 mm） | 567 × 390 |
| 二寸（35×49 mm） | 579 × 413 |
| 小二寸 / 护照（33×48 mm） | 567 × 390 |
| 美国签证（51×51 mm） | 600 × 600 |

底色 `-c`：白 `ffffff`、蓝 `438edb`、红 `ff0000`。考试报名、单位、签证常有自己的尺寸、底色、文件大小要求：先生给了就照它（大小用 `-k` 多少 KB）。

## 3. 交付前

- 用 `read` 打开成品亲眼看：脸在正中、头顶留空正常、头发边缘干净没有残留背景、肩膀没被切歪。
- 自拍要求（不满足就告诉先生重拍哪里）：正脸、光线均匀、背景不要太乱、别戴帽子、头发别挡眉眼。
- 检测不到人脸时会报错：换一张更清楚的正脸照，或加 `--face_detect_model retinaface-resnet50`（要先 `scripts/download_model.py --models retinaface-resnet50`）。
- 交付时说清：哪个文件用于网上报名（单张），哪个拿去冲印（六寸排版，选「原尺寸」不要裁剪）。
