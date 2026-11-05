---
name: conference-poster
description: 把论文/项目(.tex/zip)转成学术海报的 Overleaf 工程,固定用 CUHK 海报模板(gemini + cuhk 主题),产出可直接上传 Overleaf 的 zip。何时使用——用户要「做 poster / 生成海报 / 把论文转成 poster」,无论是投会议、还是校内/组内 poster presentation、课程或学位展示。第一步会先确认是不是会议 poster:会议才抓会议主页元信息,非会议则跳过。何时不使用——只改已有海报内容用普通编辑;需要非 CUHK 机构模板则本 skill 不适用(模板已写死 CUHK)。本 skill 固化了:先问用途再问细节、必问参数、用 WebFetch 自动抓会议元信息、beamerposter 尺寸/列数公式、表格/图片排版坑、以及 LuaLaTeX 编译器这个必踩的坑。
metadata:
  author: zhengziyang.12
  type: workflow
allowed-tools: Bash Read Edit Write WebFetch AskUserQuestion SendUserFile
---

# 会议海报生成助手 (CUHK 模板)

把一个论文项目转成 **A0/自定义尺寸的 CUHK 风格海报**,输出一个可直接拖进 Overleaf 的 zip。模板固定:gemini theme + cuhk colortheme,logo 用 CUHK,编译器 **LuaLaTeX**。

模板资产已随 skill 打包在 `assets/`:
- `beamerthemegemini.sty`, `beamercolorthemecuhk.sty` — 主题(勿改)
- `logos/CUHK-Logo.{png,pdf}` — 机构 logo
- `poster_skeleton.tex` — 三栏骨架(含尺寸/列数公式注释,供起草参考)

---

## 步骤

### 1. 收集输入

**先问用途,再问细节。** 第一步必须确认这是不是 **会议(conference)poster**——很多时候是校内/组内 poster presentation、学位/课程展示、招聘或 open day 展板等,这类**没有会议主页**,footer 也不该写会议信息。用 `AskUserQuestion` 先问:

> 这张海报的场合是?① 学术会议(有会议主页/地点/日期) ② 校内/组内 presentation ③ 其他展示(课程/学位/open day 等)

**分支:**
- **① 会议** → 走完整流程,需要会议主页 URL(见步骤 4),footer 填会议名/地点/日期。
- **②③ 非会议** → **跳过步骤 4(不 WebFetch、不问会议 URL)**;footer 改放场合文字(用户给,如 "CUHK MoE Key Lab Open Day 2026" / "Dept. of CSE — Poster Session"),或留联系信息/项目链接即可。

确认用途后,其余用一次 `AskUserQuestion` 问(会议 URL / 场合文字让用户粘在 Other/备注里):

| # | 问 | 用途 | 默认/回退 |
|---|---|---|---|
| 1 | 论文/项目路径 (目录或 zip) | 抓标题/作者/公式/图/结果表 | 必填;zip 先解压 |
| 2 | 海报**尺寸 + 方向** | `beamerposter` 的 `size`/`orientation` | 默认 A0 portrait |
| 3 | **列数** (2/3/4) | `\sepwidth` / `\colwidth` | portrait→2, landscape→3 |
| 4 | 仅会议:**主页 URL**;非会议:**场合文字** | footer + 标题区 | 会议抓不到再手问;非会议可留空 |

可选(不填走默认,别追着问):联系 email、项目/GitHub 链接、是否要 QR 码、内容侧重、致谢/基金号。

### 2. 读论文/项目,自动抽取

- 解压/进入项目目录,读 `top.tex`(或主 `.tex`)+ 各 `\input` 段:标题、作者、`\acmConference` 之类的会议信息、abstract、method 公式、实验表格。
- `ls figure/` 列全部图;挑最有信息量的:**动机图、框架/方法图、主结果图**(尺寸分级见"坑/约定")。表格默认**完整保留**，不因宽度或行数自动精简；若版面确实无法容纳，先向用户说明候选精简方案并获得明确确认后，才能删减 baseline、列或行。
- 作者邮箱在论文里常被注释掉 → 用可选输入或回退问。
- **别编造(grounding)**:数字/指标、图内容、消融结论、会议/基金/作者信息,凡论文里没有的一律不造。缺失就**标记为假设**(如 `% TODO: 确认` 或在正文回复里点出)并继续,不硬填。
- **可扫读性**:短标题、bullet 优先于段落、一条 bullet 一个点、结果带**单位 + baseline**、caption 要能脱离正文独立看懂。海报是"扫读"不是"精读"。

### 3. 产出内容大纲,**先让用户确认再生成海报**

抽取完不要直接写 `poster.tex`。先在正文回复里给一份**结构化内容大纲**,按下面 4 个核心 section 组织(每个下面用 sub-section / bullet),让用户过目、增删改后再进入组装:

1. **Takeaway** —— 一句话核心结论 + 2~3 条最强卖点(结果数字/相对提升)。放海报最显眼处。
2. **Background / Motivation** —— 问题是什么、为什么重要、现有方法的 gap(对应动机图)。
3. **Method** —— 核心思路、框架图、关键公式(通常对应 hero banner + exampleblock)。
4. **Experiment** —— 精简后的主结果表(top baselines + ours)、关键 ablation、一句话结论;列出打算用哪几张图/表。

每个 section 标注**打算配的图/表**(文件名)和**放在哪一栏**,并把 grounding 的假设/缺失项一并列出。**等用户确认后**再执行步骤 4~6。用户没特别要求时,section 顺序即海报阅读动线(Takeaway/Overview → Motivation → Method → Experiment → Conclusion)。

**列完结构后,主动询问用户 alertblock / exampleblock 的分配**:
- 模板有两种特殊标注:**红色(alertblock)** 和 **灰色(exampleblock)**,各 1~2 个即可(不宜多)。
- 给出推荐(如:motivation/challenge 用 alertblock,关键公式/核心 idea 用 exampleblock)并让用户确认或自定义。

**表格默认完整保留，不做精简。** 只有在完整表格确实无法适配版面时，才能提出精简建议；必须先向用户展示拟删除的 baseline、列或行并取得明确确认，绝不可自行决定删减。

**结果 / 表格 section**:只保留**简短 block 标题 + 表格本身**,不要在表格前后添加详细描述、导语、副标题、caption、实验设置、候选池大小、指标释义或总结段落。指标名、单位和方向直接写进表头即可。比如不要额外写 `Recall@1 / Recall@5 / Recall@10 (\%). Candidate pool: $N=...$`;改为 block 标题 `Retrieval Results`,然后直接放表格,在列名中写 `R@1 (\%)`、`R@5 (\%)`、`R@10 (\%)`。数字本身就是最有力的 evidence。

**多张表格集中放一个 block,不要每张表开一个新 block**:多个结果表(如 contrastive/predictive/ablation)统一放进同一个 `Experiment` / `Results` block 里,用一个简短 block 标题即可;每张表前面加一行**小标题**区分(如 `\textbf{\small Contrastive Retrieval}`、`\textbf{\small Predictive Tasks}`、`\textbf{\small Ablation}`),表之间用 `\vspace{1ex}` 隔开。不要为每张表单独开 `\begin{block}{...}`——block 标题栏本身较重,多个 block 连续堆叠会让版面碎、留白不均。**每张表的小标题要居中**,别让它跟着 block body 默认的 `\justifying` 变成左对齐(与下方居中的表格错位、观感不齐)。写法:把小标题放进 `\begin{center}...\end{center}`(和表格同一个 center 环境即可)或单独 `{\centering\textbf{\small ...}\par}`,例如:
```latex
\begin{center}
\textbf{\small Contrastive Retrieval}\\[0.3ex]
\tablestyle
\begin{tabular}{...}...\end{tabular}
\end{center}
```

**Takeaway / Problem 类首 section**:不要大段文字,用 bullet 快速列出关键点(3~5 条),一目了然。

**内容多少按海报尺寸/列数定**——大纲阶段就要据此提炼或展开,别不分尺寸地照搬论文:

**先算 section 总量再规划内容**:每栏固定 **2~3 个 section(block)**,不能多也不能少——多了溢出看不见,少了留白太空。据此算总 section 数(不含顶部 hero teaser):
- **2 栏**:2×(2~3) = **4~6 个 section**
- **3 栏**:3×(2~3) = **6~9 个 section**
- **4 栏**:4×(2~3) = **8~12 个 section**

在大纲里明确列出每栏放哪几个 section,按上限规划;内容不够就扩展,内容多就合并/砍。

- **纵向 2 列(如 A0 portrait 2-col)**:总共才 4~6 section,内容**偏少**,要狠提炼——每个 section 留 1 张最关键图/表,bullet 精简到最强的几条,公式只留核心。
- **横向 3 列(如 landscape 3-col)**:6~9 section,可放**更多细节**——多一张图、多一行 baseline、加 ablation/分析小节。
- 原则:先按尺寸估"能放几个 block",再决定每个 section 的详略;**宁可少而清楚,不要塞满**。

### 4. WebFetch 抓会议元信息 + **海报规格** —— 仅 ①会议 分支执行

非会议 poster 直接跳过本步。对会议 URL 调 WebFetch:

1. **会议元信息**:full name、acronym、届数(如 63rd)、exact dates、city、venue、year → 填 `\title` 区下方和 `\footercontent`。
2. **海报规格(务必抓)**:会议官网几乎都有 poster / speaker-resource / author guidelines 页,规定**展板尺寸、方向、最小字号、logo 摆放**。首页常没有,要顺链接进 `speaker resource center` / `poster guidelines` / `PhD forum` 等子页(可多抓几个)。DAC 2026 实测在 `/2026/speaker-resource-center/engineering-track-posters-guidelines`,规定:**A0 纵向;正文字母 ≥1cm(1–2m 可读);标题字母 ≥8–10cm;图表 ≥25×30cm;右下角放会议 logo**。
3. **会议 logo(抓下来固定放右上角)**:CUHK logo 固定在**左上角**(`\logoleft`),会议 logo 固定放**右上角**(`\logoright`);即使会议官网另有位置建议,本模板仍统一采用左右对称的标题栏布局,不要把会议 logo 放到页面右下角或 footer。用 WebFetch 拿会议首页,让它返回 header/site logo 的图片 URL(png 优先,webp 也行),再 `curl -sL` 下到 `logos/`。DAC 2026 实测 logo:`https://confcats-siteplex.s3.amazonaws.com/dac/images/dac26-logo-lr_simple.png`。抓不到就留 `\logoright` 注释行 + 提醒用户手动放入 `logos/`。
4. **规格覆盖用户默认**:若官网规格与步骤 1 用户选的尺寸/方向冲突,以官网为准并告知用户。抓不到规格再回退用用户选项。

### 5. 定尺寸、列数、**字号**(套公式 + 按物理尺寸定字号)

`beamerposter` 选项:
- A 系列:`[orientation=portrait,size=a0,scale=<S>]`
- 自定义英寸:`size=custom,width=<cm>,height=<cm>`,**cm = inch×2.54**(48in→121.92, 36in→91.44)。

**字号按海报真实物理尺寸定,别用默认。** gemini 主题字号是相对的(`\Huge/\Large/...`),随 `beamerposter` 的 `scale` 整体缩放——`scale` 就是字号总闸:
- 经验:A0 下 `scale=1.0` 正文字母才 ~0.6cm,**偏小**(实测被吐槽)。要达到"正文字母 ≥1cm、1–2m 可读"这类会议要求,A0 用 **`scale≈1.35~1.45`**(正文≈1cm);海报越大 `scale` 越大。
- 有官网最小字号要求时按要求反推 `scale`;没有就默认让正文 ≥1cm。
- 放大字号后内容可能溢出 → 正文要更精炼(海报本就该少字);别靠缩小字号塞内容。
- **标题栏别跟着整体等比放大**:gemini 的 headline title 是 `\Huge`,`scale` 调大后标题会过大、挤占版面(实测被吐槽)。正文要大、标题不要跟着大 → 在 `\usetheme` 后**单独压小标题栏字号**,正文 `scale` 不动:
  ```latex
  \setbeamerfont{headline title}{size=\LARGE,series=\bfseries}
  \setbeamerfont{headline author}{size=\large}
  \setbeamerfont{headline institute}{size=\normalsize}
  ```
  logo 也别太高(撑高紫色栏):`\logoleft`/`\logoright` 用 `height=5~6cm`。
- **标题栏收紧**:放大 `scale` 后紫色栏易显空旷/松散。除压小标题字号外,还可在**交付副本的 `beamerthemegemini.sty`** 里收紧 headline 竖向留白(logo 列 `\vskip5ex→3ex`、标题 `\vskip3ex→2ex`、栏底 `\vspace5ex→2ex`);institute 多行时行距给到 `\\[0.6ex]` 免得挤成一坨。(改的是打包进 zip 的那份 `.sty`,不是 skill 里的原始资产。)
- **footer 保持单行**:会议全名太长会折行,把 email 挤到第二行显乱。footer 用**短版**、三段 `\hfill` 均分:`项目链接 \hfill <ACRONYM 'YY> --- <日期> --- <城市> \hfill email`,别塞会议全称。
- **标题被挤到换行(单词孤立起一行)**:gemini 主题给两侧 logo 各预留 `logowidth+10ex`,并且**左右对称**按 `\maxlogowidth`(两者最大)预留 → 中间标题列被挤窄,长标题就折行(如 "TRACE: Learning to Compute on Circuit Graphs" 的 `Graphs` 孤立换行)。修法:在 `\logoleft/\logoright` 之后**手动收窄 `\maxlogowidth`** 让中间列变宽,同时评估 logo 宽度别被切掉:
  ```latex
  \logoleft{\includegraphics[height=6cm]{logos/CUHK-Logo.png}}
  \logoright{\includegraphics[height=4.5cm]{logos/dac-logo.png}}
  \setlength{\maxlogowidth}{0.15~0.18\paperwidth}  % 按 logo 实际宽度取值
  ```
  宽 logo(如 DAC 的 707×260)优先**压 logo 高度**再收 `\maxlogowidth`,反复权衡。
- **会议 logo 可能超出海报右边界**:`\logoright` 只用 `height=` 约束时,若原图很宽(如 707×260 这种横向 logo),按等比缩放后的实际宽度可能超过 `\maxlogowidth` 减去 `\hspace{10ex}` 留白,导致 logo 右侧被切出纸张边界或压线(尤其是收窄 `\maxlogowidth` 之后更容易触发,两处改动必须一起核对)。修法:**同时用 `height` 和 `width` 双重约束 + `keepaspectratio`**,把 `width` 设为比 `\maxlogowidth` 略小的绝对值(留出 `\hspace{10ex}` 的边距),取两者中更小的缩放结果,不要只写 `height`:
  ```latex
  \logoright{\includegraphics[height=4.5cm,width=0.13\paperwidth,keepaspectratio]{logos/dac-logo.png}}
  ```
  给定 `\maxlogowidth`(如 `0.16\paperwidth`)时,`width` 应明显小于它(留够 `10ex` 页边距),按 logo 实际宽高比反推:若 `height` 已经让宽度超标,就换算等效的 `width` 值反过来定 `height`。收尾前建议用 `\includegraphics` 的 `bb`/实际像素宽高比手算一遍缩放后宽度,确认 ≤ `\maxlogowidth - 10ex`,避免只凭肉眼判断在本地又无法编译验证。

列宽公式:`(N+1)*sepwidth + N*colwidth = paperwidth`
- 2 栏:`sep=0.025, col=0.45`
- 3 栏:`sep=0.01, col=0.32`
- 4 栏:`sep=0.008, col=0.242`

### 6. 组装工程

新建输出目录,拷入 `assets/` 的两个 `.sty` 和 `logos/`,拷入选中的 `figure/*`,写:
- `poster.tex` — 参照 `poster_skeleton.tex`,按"动机(alertblock)→方法(block + exampleblock 放核心公式)→结果(精简表 + 图)→结论 → References"填充。共同一作用 `\textsuperscript{$\dagger$}`,通讯用 `$*$`。**Logo 位置固定:CUHK 用 `\logoleft` 放左上角,会议 logo 用 `\logoright` 放右上角(步骤 4 抓下来的 `logos/<conf>-logo.png`)。会议 logo 常是宽图,优先压到 `height=4.5~5.5cm`;禁止用 overlay 放到右下角或塞进 footer。**抓不到就留注释行 + 提醒用户放入 `logos/`。
- `poster.bib` — 从论文 `reference.bib` 挑几条关键引用即可(References block 用 `\nocite{*}` + `plain`)。

顶部务必留注释:**Overleaf 需把 Compiler 设为 LuaLaTeX**(gemini theme 载 fontspec,pdfLaTeX 会报 `cannot-use-pdftex` 直接失败)。

### 7. 打包并交付

**打包前先自检**(逐条过):problem→result 叙事是否连贯 · 主图是否一眼可辨(hero banner) · 每个数字都能追溯到论文 · 有明确 takeaway · 有联系方式/项目链接(可选 QR) · 表格没被 `\resizebox` 撑大 · 标题栏没跟着 `scale` 过大。

```bash
cd <输出父目录> && rm -f <NAME>.zip && zip -r -q <NAME>.zip <NAME>/ && unzip -l <NAME>.zip
```
用 `SendUserFile` 把 zip 发给用户,caption 提醒:**上传 Overleaf 后把编译器切成 LuaLaTeX**。

> ⚠️ **交付后必须在正文回复里显式提醒用户**(不能只放 caption):
> 上传 Overleaf 后,打开 **File → Settings → Compiler**,把编译器从默认的 pdfLaTeX 切成 **XeLaTeX 或 LuaLaTeX**(推荐 LuaLaTeX,与模板 Makefile 一致),再 Recompile。否则 gemini 主题加载 fontspec 会直接报错编不出来。

---

## 坑 / 约定

- **编译器**:本地大概率没有 lualatex,不要尝试本地编译验证;靠正确书写 + Overleaf 编译。这是最容易被用户踩的坑,交付时一定显式提醒。
- **表格字体统一用 TeX Gyre Termes**:表格局部使用与 Times New Roman 外观接近、且 Overleaf/LuaLaTeX 默认可用的 `TeX Gyre Termes`;不要改变 gemini 的标题或正文主字体。导言区声明 `\newfontfamily\tablefont{TeX Gyre Termes}`，并在统一表格样式中应用。
- **表格别用 `\resizebox{\linewidth}{!}`**:窄表(4~5 列)会被拉伸撑满整栏,字体连带放大、和正文不匹配——实测被吐槽的头号问题。改用固定字号 + 自然宽度居中,推荐统一样式复用:
  ```latex
  \newfontfamily\tablefont{TeX Gyre Termes}
  \newcommand{\tablestyle}{\tablefont\small\setlength{\tabcolsep}{6pt}\renewcommand{\arraystretch}{1.15}}
  % 用: \begin{center}\tablestyle \begin{tabular}{...}...\end{tabular}\end{center}
  ```
  论文主表常 9~10 列 → 先砍成 3~5 列(代表性 baseline + ours),配一句文字点结论。
- **图片分级,别一律 `\linewidth`**:否则细节多的主图和简单示意图一样大,主图看不清(实测被吐槽第二名)。分三档:
  - **Hero/teaser(方法/框架主图)**:布局严格按方向决定。**仅纵向（portrait）海报**在顶部做全宽 overview——单独一个 `columns` 环境,列宽 `\dimexpr\paperwidth-2\sepwidth\relax`。主图区必须**只放图片本身**:不要包在 block 里,不要 section 标题、横线、caption、takeaway、数字、说明文字或图片前后的任何文字。唯一内容应为 `\centering\includegraphics[width=0.85\paperwidth]{...}`。**横向（landscape）海报禁止顶部 overview/hero banner**；将 overview 对应的框架图放入 Method 相关 block 内，配合方法说明与公式，宽度按该栏可读性设为 `0.8~1.0\linewidth`。主图相关解释统一放在其对应的 Method 正文 block。
  - **Teaser/动机图**:`width=\linewidth`。 **示意图**:`0.6~0.75\linewidth`,别和 hero 抢。
  - 优先 pdf 矢量图;曲线类 png 也可。
- **block 内图片后面别紧跟 `\justifying`**:`\centering\includegraphics{...}` 之后如果紧接 `\justifying`(通常是为了让后面的正文段落两端对齐),会把图片本身的居中也一并覆盖掉,导致图片偏左(实测确认)。正确写法是**给图片单独一个 `{\centering\includegraphics{...}\par}` 分组**,或者把 `\justifying` 放在图片之前、只作用于图片前的文字段落,不要让它跨过 `\includegraphics` 影响到图片的对齐方式。
- **Section 标题简短**:如 "Results"、"Method"、"Ablation"。**不要** "Results — contrastive retrieval (Recall@1, %) & prediction (MAE ↓)" 这种长描述式标题(实测被吐槽)。
- **内容溢出页面(最常见问题)**:beamerposter 单 frame 不分页,超出的内容直接看不见。强行装下一页的手段(按优先级):
  1. **收紧 block 间距**:交付副本 `.sty` 里 block end 的 `\vspace*{2ex}→0.8ex`、title `dp=2ex→1.2ex`。
  2. **精简文字**:Takeaway/Problem 用 bullet;Results 只放表格不写段落;caption 一句话够了。
  3. **缩减低优先级 block**:砍 References(或只留 2~3 条)、Conclusion 压到 2 bullet。
  4. **局部用 `\small`**:对特定溢出 block 的 body 加 `{\small ...}`。
  5. **最终兜底**:降 `scale`(如 1.4→1.3),但会影响全局字号——仅在以上手段不够时用。
- **下方留空(填不满 A0)**:① 主图做全宽吃高度;② 图整体放大;③ 栏内容量配平(把偏短栏用小表/小图收尾);④ 最后杠杆:提 `scale`(如 1.3→1.4)等比放大填高。
- **禁止 `multicol` 分栏**:`\usepackage{multicol}` + `\begin{multicols}{N}` 与 beamer 的 block/alertblock/exampleblock **完全不兼容**——blocks 内部用 `beamercolorbox` 做布局,和 multicol 的分栏逻辑冲突,导致 block 重叠、内容被截断、排版彻底崩溃(实测确认)。**唯一可靠的多栏方案是 beamer 的 `columns` 环境**,内容需手动分配到各 column,不支持自动流式换栏。
- **避免 block 内嵌套 `columns`**:正文外层用 `columns` 划分海报主栏即可;单个 `block` / `alertblock` / `exampleblock` 内尽量不要再嵌套 `columns`。视觉风格优先采用**上下 row 排布**:文字一行/一段,图片放在其上方或下方并居中;不要默认做“左文字 + 右图片”或“左表格 + 右图片”的并排布局。只有用户明确要求并排对照,或横向空间确实是信息表达所必需时才例外。
- **多个顶层 `columns` 环境**:一个 `frame` 里可放多个顶层 `\begin{columns}`(banner 一个、正文主栏一个),gemini 支持,中间 `\vspace{1em}` 隔开;这里不代表鼓励在 block 内继续嵌套。
- **`\ourmethod` + `\xspace`**:骨架里 `\ourmethod` 用了 `\xspace`,确保 `\usepackage{xspace}` 在。
- 只支持 CUHK 品牌;若用户要别的机构 logo/配色,本 skill 不覆盖,需另做。
