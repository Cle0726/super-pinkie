"""小学生练习纸：字帖（田字格 / 米字格 / 回宫格，带拼音和描红）和口算题卡（带答案页）。出 A4 PDF + 第一页预览图。

  python3 worksheets.py copybook --text "春眠不觉晓" --grid tian --trace 3 --pinyin --out 字帖.pdf
  python3 worksheets.py math --ops "+-" --max 20 --count 100 --carry any --out 口算.pdf

依赖：reportlab、pypinyin、pymupdf（缺了用 pip 装进碧琪的专用 Python 环境）。字体：先找系统楷体
（Windows 的 KaiTi，Mac 的 Kaiti SC），没有就下载开源的霞鹜文楷（SIL OFL）到用户缓存，只下一次。
"""
import argparse, os, pathlib, random, sys, urllib.request

KAITI = [
    "C:/Windows/Fonts/simkai.ttf", "C:/Windows/Fonts/STKAITI.TTF",
    "/System/Library/Fonts/Supplemental/Kaiti.ttc", "/Library/Fonts/Kaiti.ttc",
    "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/*/AssetData/Kaiti.ttc",
    "/usr/share/fonts/truetype/arphic/ukai.ttc",
]
WENKAI_URL = "https://github.com/lxgw/LxgwWenKai/releases/download/v1.522/LXGWWenKai-Regular.ttf"
LATIN = ["C:/Windows/Fonts/arial.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"]


def cache_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/Library/Caches") if sys.platform != "linux" else os.path.expanduser("~/.cache")
    path = pathlib.Path(base) / "pinkie-worksheets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def find_font():
    import glob
    for pattern in KAITI:
        for hit in glob.glob(pattern):
            return hit
    target = cache_dir() / "LXGWWenKai-Regular.ttf"
    if not target.exists() or target.stat().st_size < 1_000_000:
        print(f"没有系统楷体，下载开源字体霞鹜文楷：{WENKAI_URL}", flush=True)
        tmp = target.with_suffix(".part")
        with urllib.request.urlopen(urllib.request.Request(WENKAI_URL, headers={"User-Agent": "pinkie-worksheets"}), timeout=300) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
        tmp.replace(target)
        print(f"字体在 {target}（记进下载账本）", flush=True)
    return str(target)


def register(path):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    try:
        pdfmetrics.registerFont(TTFont("Kai", path, subfontIndex=0))
    except TypeError:
        pdfmetrics.registerFont(TTFont("Kai", path))
    latin = next((p for p in LATIN if os.path.exists(p)), None)
    if latin:
        pdfmetrics.registerFont(TTFont("Latin", latin))
        return "Kai", "Latin"
    return "Kai", "Kai"


def header(c, title, font, w, h, mm):
    c.setFont(font, 20)
    c.setFillColorRGB(0.12, 0.12, 0.12)
    c.drawCentredString(w / 2, h - 20 * mm, title)
    c.setFont(font, 11)
    c.setFillColorRGB(0.35, 0.35, 0.35)
    c.drawString(18 * mm, h - 30 * mm, "姓名：____________    班级：________    日期：________")


def grid_cell(c, x, y, s, kind, mm):
    c.setStrokeColorRGB(0.85, 0.25, 0.25)
    c.setLineWidth(0.9)
    c.rect(x, y, s, s)
    c.setLineWidth(0.4)
    c.setDash(2, 2)
    c.line(x, y + s / 2, x + s, y + s / 2)
    c.line(x + s / 2, y, x + s / 2, y + s)
    if kind == "mi":
        c.line(x, y, x + s, y + s)
        c.line(x, y + s, x + s, y)
    c.setDash()
    if kind == "hui":
        inner = s * 0.618
        c.setLineWidth(0.5)
        c.rect(x + (s - inner) / 2, y + (s - inner) / 2, inner, inner)


def copybook(args):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    from pypinyin import Style, pinyin
    font, latin = register(args.font or find_font())
    chars = [ch for ch in args.text if not ch.isspace() and ch not in "，。、！？；：,.!?;:“”\"'（）()"]
    if not chars:
        sys.exit("没有要练的字")
    w, h = A4
    cols, s = args.cols, (w - 36 * mm) / args.cols
    py_h = 7 * mm if args.pinyin else 0
    row_h = s + py_h + 3 * mm
    c = canvas.Canvas(args.out, pagesize=A4)
    c.setTitle(args.title)
    top = h - 40 * mm
    y = top
    for index, ch in enumerate(chars):
        for _ in range(args.rows_per_char):
            if y - row_h < 15 * mm or y == top:
                if y != top:
                    c.showPage()
                header(c, args.title, font, w, h, mm)
                y = top
            sound = pinyin(ch, style=Style.TONE)[0][0] if args.pinyin else ""
            for col in range(cols):
                x = 18 * mm + col * s
                cell_y = y - py_h - s
                if args.pinyin:
                    c.setStrokeColorRGB(0.55, 0.7, 0.9)
                    c.setLineWidth(0.4)
                    for k in range(4):
                        c.line(x, y - k * py_h / 3, x + s, y - k * py_h / 3)
                grid_cell(c, x, cell_y, s, args.grid, mm)
                if col <= args.trace:
                    gray = 0.1 if col == 0 else 0.78
                    c.setFillColorRGB(gray, gray, gray)
                    c.setFont(font, s * 0.78)
                    c.drawCentredString(x + s / 2, cell_y + s * 0.2, ch)
                    if args.pinyin and sound:
                        c.setFont(latin, py_h * 0.72)
                        c.drawCentredString(x + s / 2, y - py_h * 0.82, sound)
            y -= row_h
    c.save()
    print(f"字帖：{args.out}（{len(chars)} 个字）")


def problems(args, rng):
    out, seen = [], set()
    ops = [op for op in args.ops if op in "+-x×*/÷"]
    tries = 0
    while len(out) < args.count and tries < args.count * 200:
        tries += 1
        op = rng.choice(ops)
        if op == "+":
            a, b = rng.randint(args.min, args.max), rng.randint(args.min, args.max)
            if a + b > args.max:
                continue
            carry = (a % 10 + b % 10) >= 10
            if (args.carry == "yes" and not carry) or (args.carry == "no" and carry):
                continue
            q, ans = f"{a} + {b} =", a + b
        elif op == "-":
            a, b = rng.randint(args.min, args.max), rng.randint(args.min, args.max)
            if b > a:
                a, b = b, a
            borrow = a % 10 < b % 10
            if (args.carry == "yes" and not borrow) or (args.carry == "no" and borrow):
                continue
            q, ans = f"{a} − {b} =", a - b
        elif op in "x×*":
            a, b = rng.randint(1, min(9, args.max)), rng.randint(1, min(9, args.max))
            q, ans = f"{a} × {b} =", a * b
        else:
            b, ans = rng.randint(1, 9), rng.randint(1, 9)
            q = f"{b * ans} ÷ {b} ="
        if q in seen and len(seen) < args.count:
            continue
        seen.add(q)
        out.append((q, ans))
    return out


def math_sheet(args):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    font, latin = register(args.font or find_font())
    rng = random.Random(args.seed)
    items = problems(args, rng)
    w, h = A4
    c = canvas.Canvas(args.out, pagesize=A4)
    c.setTitle(args.title)
    per_page = args.cols * args.rows
    for page_items, answers in ((items, False), (items, True)) if args.answers else ((items, False),):
        for start in range(0, len(page_items), per_page):
            header(c, args.title + ("（答案）" if answers else ""), font, w, h, mm)
            if not answers:
                c.setFont(font, 11)
                c.drawRightString(w - 18 * mm, h - 30 * mm, "用时：______    对了：____ 题")
            col_w = (w - 36 * mm) / args.cols
            row_h = (h - 60 * mm) / args.rows
            for i, (q, ans) in enumerate(page_items[start:start + per_page]):
                col, row = i % args.cols, i // args.cols
                x = 18 * mm + col * col_w
                y = h - 45 * mm - row * row_h
                c.setFillColorRGB(0.12, 0.12, 0.12)
                c.setFont(latin, 15)
                c.drawString(x, y, q)
                if answers:
                    c.setFillColorRGB(0.8, 0.2, 0.2)
                    c.drawString(x + c.stringWidth(q, latin, 15) + 3 * mm, y, str(ans))
                else:
                    c.setStrokeColorRGB(0.6, 0.6, 0.6)
                    c.setLineWidth(0.6)
                    gap = c.stringWidth(q, latin, 15) + 2 * mm
                    c.line(x + gap, y - 1.5 * mm, x + gap + 14 * mm, y - 1.5 * mm)
            c.showPage()
    c.save()
    print(f"口算题卡：{args.out}（{len(items)} 题{'，最后是答案页' if args.answers else ''}）")


def preview(pdf):
    try:
        import fitz
    except ImportError:
        print("没装 pymupdf，跳过预览图（pip install pymupdf 后重跑可以出预览）")
        return
    doc = fitz.open(pdf)
    out = str(pathlib.Path(pdf).with_suffix("")) + "-第1页.png"
    doc[0].get_pixmap(dpi=110).save(out)
    print(f"预览：{out}（用 read 打开亲眼看）")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    cb = sub.add_parser("copybook", help="字帖")
    cb.add_argument("--text", required=True, help="要练的字，可以是一首诗")
    cb.add_argument("--grid", choices=["tian", "mi", "hui"], default="tian", help="田字格 / 米字格 / 回宫格")
    cb.add_argument("--cols", type=int, default=10, help="每行几格（低年级 8，高年级 10–12）")
    cb.add_argument("--trace", type=int, default=3, help="范字后面几格描红")
    cb.add_argument("--rows-per-char", type=int, default=1, help="每个字练几行")
    cb.add_argument("--pinyin", action="store_true", help="上面加拼音格")
    cb.add_argument("--title", default="练字本")
    m = sub.add_parser("math", help="口算题卡")
    m.add_argument("--ops", default="+-", help="+ - × ÷ 任意组合，比如 +-× ")
    m.add_argument("--min", type=int, default=0)
    m.add_argument("--max", type=int, default=20, help="加减法的结果和数都不超过它")
    m.add_argument("--count", type=int, default=100)
    m.add_argument("--carry", choices=["any", "yes", "no"], default="any", help="加减法要不要进位 / 退位")
    m.add_argument("--cols", type=int, default=4)
    m.add_argument("--rows", type=int, default=25)
    m.add_argument("--seed", type=int, default=None, help="同一个数出同一套题")
    m.add_argument("--no-answers", dest="answers", action="store_false")
    m.add_argument("--title", default="口算练习")
    for p in (cb, m):
        p.add_argument("--out", required=True)
        p.add_argument("--font", help="指定字体文件（.ttf / .ttc）")
    args = parser.parse_args()
    (copybook if args.cmd == "copybook" else math_sheet)(args)
    preview(args.out)


if __name__ == "__main__":
    main()
