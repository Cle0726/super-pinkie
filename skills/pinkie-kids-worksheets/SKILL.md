---
disable-model-invocation: true
name: pinkie-kids-worksheets
description: 小学生练习纸：字帖（田字格 / 米字格 / 回宫格，带拼音、范字和描红）和口算题卡（加减乘除、进位退位、带答案页），出 A4 PDF 直接打印。先生要练字帖、生字本、描红本、口算题、计算题、每日练习时用。
---

# 字帖和口算题卡

同一个文件夹里的 `worksheets.py` 出 A4 PDF，旁边自动出第一页预览图。

## 1. 准备（第一次用）

用碧琪的专用 Python（`TOOLS.md` 里记着；Mac 一般是 `~/.openclaw/agent-env/bin/python3`）：

```
<python> -m pip install reportlab pypinyin pymupdf
```

字体：先用系统楷体（Windows 自带 KaiTi，Mac 有 Kaiti SC 就用）；都没有时脚本自己下载开源的霞鹜文楷（SIL OFL，约 25 MB），下好会打印路径——记进下载账本。

## 2. 字帖

```
<python> "<本文件夹>/worksheets.py" copybook --text "床前明月光疑是地上霜" --grid tian --trace 3 --pinyin --title "一年级上册 第5课" --out 字帖.pdf
```

- `--grid tian|mi|hui`：田字格（默认，低年级）/ 米字格（练结构）/ 回宫格（练布局）。
- `--trace 3`：每行第 1 格是黑色范字，后面 3 格灰色描红，再后面空格自己写。一年级可以 `--trace 5`。
- `--cols 8` 格子更大（低年级）；`--rows-per-char 2` 每个字练两行。
- `--pinyin` 在格子上方加四线三格拼音（声调用 pypinyin 自动标；多音字照课文核对，不对就把那个字单独出一份不带拼音的）。
- 先生给课文、生字表、照片时：先把要练的字认出来写进 `--text`，标点会自动跳过。

## 3. 口算题卡

```
<python> "<本文件夹>/worksheets.py" math --ops "+-" --max 20 --count 100 --carry yes --title "20 以内进位加减法" --out 口算.pdf
```

- `--ops`：`+-`、`x`（表内乘法）、`/`（表内除法，都能整除），可以组合，比如 `+-x`。
- `--max`：加减法的数和结果都不超过它（10、20、100）。`--carry yes|no|any`：只要进位退位 / 都不要 / 随便。
- `--count 100 --cols 4 --rows 25`：一页 100 题。最后自动带答案页；不要答案加 `--no-answers`。
- `--seed 7`：同一个数出同一套题（方便先生要「再来一份一样的」或对答案）。

## 4. 交付前

- 用 `read` 打开 `-第1页.png` 亲眼看：字在格子正中、没有方框（缺字）、拼音和字对得上、题没有负数或超范围。
- 告诉先生：A4、建议「实际大小」打印；答案在最后一页。
