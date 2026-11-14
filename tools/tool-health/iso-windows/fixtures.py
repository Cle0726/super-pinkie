"""准备实测题用的夹具（全是现造的假数据，不碰用户文件）。

  python -I -X utf8 tools/tool-health/iso-windows/fixtures.py

- 题 3：%TEMP%\\th-test\\ 下 3 张带中文字的 PNG（用 Windows 自带的 System.Drawing 画）；
- 题 4：<ROOT>\\fixtures\\scan-book.pdf，30 页「扫描版」（每页一张带噪点的大 JPEG），> 25 MB，
  第 2–3 页是目录；
- 题 6：<ROOT>\\fixtures\\site\\index.html，1.5 秒后才出现「开始」按钮；
- 题 8：<ROOT>\\fixtures\\proj\\ 小项目，4 个文件调用 send_order()，其中一个漏了 await。
"""
import os, subprocess, tempfile
from pathlib import Path

REAL_HOME = Path(os.environ.get('USERPROFILE') or Path.home())
ROOT = Path(os.environ.get('TH_ISO_ROOT') or REAL_HOME / '碧琪实测' / 'iso-th')
FIX = ROOT / 'fixtures'
TEMP_DIR = Path(os.environ.get('LOCALAPPDATA', REAL_HOME / 'AppData/Local')) / 'Temp' / 'th-test'

DRAW = r'''
param([string]$Out, [string]$Text, [int]$W, [int]$H, [int]$Noise, [string]$Kind)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(250, 248, 240))
$rand = New-Object System.Random 7
if ($Noise -gt 0) { for ($i = 0; $i -lt $Noise; $i++) { $c = $rand.Next(150, 255); $bmp.SetPixel($rand.Next($W), $rand.Next($H), [System.Drawing.Color]::FromArgb($c, $c, $c - 20)) } }
$size = [Math]::Max(18, [int]($W / 28))
$font = New-Object System.Drawing.Font "Microsoft YaHei", $size
$g.DrawString($Text, $font, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF 40, 40, ($W - 80), ($H - 80)))
if ($Kind -eq 'jpg') {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $p = New-Object System.Drawing.Imaging.EncoderParameters 1
  $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 98L
  $bmp.Save($Out, $codec, $p)
} else { $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png) }
'''


def draw(out, text, w, h, noise=0, kind='png'):
    script = Path(tempfile.gettempdir()) / 'th-draw.ps1'
    script.write_text(DRAW, encoding='utf-8-sig')
    subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script),
                    '-Out', str(out), '-Text', text, '-W', str(w), '-H', str(h), '-Noise', str(noise), '-Kind', kind],
                   check=True, capture_output=True)


def jpeg_size(data):
    i = 2
    while i < len(data):
        marker, length = data[i + 1], int.from_bytes(data[i + 2:i + 4], 'big')
        if marker in (0xC0, 0xC1, 0xC2):
            return int.from_bytes(data[i + 7:i + 9], 'big'), int.from_bytes(data[i + 5:i + 7], 'big')
        i += 2 + length
    raise ValueError('not a jpeg')


def write_pdf(path, jpegs):
    objs, pages = [], []
    def add(body):
        objs.append(body)
        return len(objs)
    catalog = add(None)
    pages_id = add(None)
    for data in jpegs:
        w, h = jpeg_size(data)
        img = add(b'<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceRGB /BitsPerComponent 8 '
                  b'/Filter /DCTDecode /Length %d >>\nstream\n' % (w, h, len(data)) + data + b'\nendstream')
        content = b'q 595 0 0 842 0 0 cm /Im0 Do Q'
        cid = add(b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream')
        pages.append(add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 %d 0 R >> >> '
                         b'/Contents %d 0 R >>' % (pages_id, img, cid)))
    objs[catalog - 1] = b'<< /Type /Catalog /Pages %d 0 R >>' % pages_id
    objs[pages_id - 1] = b'<< /Type /Pages /Kids [%s] /Count %d >>' % (b' '.join(b'%d 0 R' % p for p in pages), len(pages))
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for n, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b'%d 0 obj\n' % n + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offsets)
    out += b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, catalog, xref)
    path.write_bytes(bytes(out))


def main():
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    for i, text in enumerate(['发票号码 TH-2026-0381　金额 ¥ 486.00', '会议室 B302　周四 14:00 产品评审',
                              '取件码 7-3-1906　请在 18:00 前取走'], 1):
        draw(TEMP_DIR / f'note-{i}.png', text, 900, 300)

    FIX.mkdir(parents=True, exist_ok=True)
    pdf = FIX / 'scan-book.pdf'
    if not pdf.exists() or pdf.stat().st_size < 25 * 1024 * 1024:
        work = FIX / 'pages'
        work.mkdir(exist_ok=True)
        toc = ('目录\n第一章　数控机床概述 …… 1\n第二章　工件装夹 …… 23\n第三章　刀具与切削用量 …… 47\n'
               '第四章　数控编程基础 …… 71\n第五章　加工中心操作 …… 102\n第六章　综合实训 …… 130')
        jpegs = []
        for n in range(1, 31):
            text = '数控加工技术（第二版）\n\n扫描版' if n == 1 else toc if n in (2, 3) else f'第 {n} 页\n正文内容……'
            out = work / f'p{n:02d}.jpg'
            if not out.exists():
                draw(out, text, 2480, 3508, noise=40000, kind='jpg')
            jpegs.append(out.read_bytes())
        write_pdf(pdf, jpegs)
    print('pdf MB', round(pdf.stat().st_size / 1024 / 1024, 1))

    site = FIX / 'site'
    site.mkdir(exist_ok=True)
    (site / 'index.html').write_text(
        '<!doctype html><meta charset="utf-8"><title>实测页</title><h1>实测页</h1><p id="msg">还没点</p>'
        '<script>setTimeout(()=>{const b=document.createElement("button");b.id="go";b.name="go";b.textContent="开始";'
        'b.onclick=()=>{document.getElementById("msg").textContent="点到了"};document.body.appendChild(b)},1500)</script>',
        encoding='utf-8')

    proj = FIX / 'proj'
    proj.mkdir(exist_ok=True)
    (proj / 'api.js').write_text('export async function send_order(order) {\n  return {ok: true, id: order.id};\n}\n', encoding='utf-8')
    (proj / 'cart.js').write_text("import {send_order} from './api.js';\nexport async function checkout(cart) {\n"
                                  "  const r = await send_order({id: cart.id});\n  return r.ok;\n}\n", encoding='utf-8')
    (proj / 'retry.js').write_text("import {send_order} from './api.js';\nexport async function retry(o) {\n"
                                   "  for (let i = 0; i < 3; i++) {\n    const r = await send_order(o);\n    if (r.ok) return r;\n  }\n}\n", encoding='utf-8')
    (proj / 'admin.js').write_text("import {send_order} from './api.js';\nexport function forceSend(o) {\n"
                                   "  const r = send_order(o);\n  if (r.ok) console.log('sent', r.id);\n  return r;\n}\n", encoding='utf-8')
    (proj / 'batch.js').write_text("import {send_order} from './api.js';\nexport async function sendAll(list) {\n"
                                   "  return Promise.all(list.map(o => send_order(o)));\n}\n", encoding='utf-8')
    (proj / 'README.md').write_text('# 小商店\n下单走 api.js 的 send_order。\n', encoding='utf-8')
    print('fixtures ok', TEMP_DIR, FIX)


if __name__ == '__main__':
    main()
