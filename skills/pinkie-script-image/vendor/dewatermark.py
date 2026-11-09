#!/usr/bin/env python3
"""去掉 AI 视频角上的水印。通用版：任意输入视频、任意输出文件。

思路：机位基本固定的视频，水印那一小块直接用首帧原图的同一块补回去，
每帧按水印四周一圈的颜色做亮度/色彩匹配（光在变也跟得上），羽化贴回。
没有首帧、或者那块画面在动 → 用 inpainting 逐帧修补。

用法:
  python dewatermark.py 输入.mp4 输出.mp4 --ref 首帧.png            自动找水印位置 + 用首帧补
  python dewatermark.py 输入.mp4 输出.mp4 --box 600,1180,100,80 --mode inpaint
  python dewatermark.py 输入.mp4 输出.png --show                   只找水印，存一张标了框的图
"""
import argparse, json, subprocess, sys

import numpy as np


def probe(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", path,
    ])
    s = json.loads(out)["streams"][0]
    num, den = (s.get("r_frame_rate") or "30/1").split("/")
    return int(s["width"]), int(s["height"]), float(num) / float(den or 1)


def main():
    ap = argparse.ArgumentParser(description="去视频水印")
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--ref", help="首帧原图（有它就用它补水印块，最干净）")
    ap.add_argument("--box", help="手动指定水印框 x,y,w,h（按视频像素）")
    ap.add_argument("--mode", choices=["ref", "inpaint"], default=None)
    ap.add_argument("--pad", type=int, default=6, help="框外再多补几像素")
    ap.add_argument("--show", action="store_true", help="只找水印、存一张标框图")
    a = ap.parse_args()

    import cv2
    W, H, fps = probe(a.src)
    cap = cv2.VideoCapture(a.src)

    # 找水印位置：视频头几帧 vs 首帧原图，差异集中在哪个角
    box = None
    if a.box:
        x, y, w, h = (int(v) for v in a.box.split(","))
        box = (x, y, w, h)
    elif a.ref:
        ref = cv2.imread(a.ref)
        if ref is not None:
            ref = cv2.resize(ref, (W, H))
            diffs = []
            for _ in range(5):
                ok, fr = cap.read()
                if not ok:
                    break
                d = np.abs(fr.astype(np.int16) - ref.astype(np.int16)).mean(2)
                diffs.append(d)
            if diffs:
                d = np.mean(diffs, 0)
                # 按四个角分别求平均差异，差异最大的角就是水印所在
                cs = {"tl": d[: H // 4, : W // 3], "tr": d[: H // 4, -W // 3:],
                      "bl": d[-H // 4:, : W // 3], "br": d[-H // 4:, -W // 3:]}
                corner = max(cs, key=lambda k: cs[k].mean())
                if cs[corner].mean() > 3:
                    sub = cs[corner]
                    ys, xs = np.where(sub > max(8, sub.mean() * 2))
                    if len(ys):
                        oy = 0 if corner[0] == "t" else H - H // 4
                        ox = 0 if corner[1] == "l" else W - W // 3
                        pad = a.pad
                        box = (max(0, ox + xs.min() - pad), max(0, oy + ys.min() - pad),
                               int(xs.max() - xs.min() + 2 * pad), int(ys.max() - ys.min() + 2 * pad))
            cap.release()
            cap = cv2.VideoCapture(a.src)
    if box is None:
        print("没找到水印（需要 --box 手动指定，或给一张 --ref 首帧）", file=sys.stderr)
        return 2
    x, y, w, h = box
    print(f"水印框 {x},{y},{w},{h}", file=sys.stderr)

    if a.show:
        ok, fr = cap.read()
        if ok:
            cv2.rectangle(fr, (x, y), (x + w, y + h), (0, 0, 255), 2)
            cv2.imwrite(a.dst, fr)
            print(a.dst)
        cap.release()
        return 0

    mode = a.mode or ("ref" if a.ref else "inpaint")
    ref_img = cv2.resize(cv2.imread(a.ref), (W, H)) if (a.ref and mode == "ref") else None
    if mode == "ref" and ref_img is None:
        mode = "inpaint"

    tmp = a.dst + ".noaudio.mp4"
    writer = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))
    n = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        x0, y0, x1, y1 = x, y, x + w, y + h
        ring = 6
        if mode == "ref":
            patch = ref_img[y0:y1, x0:x1].astype(np.float32)
            target = fr[max(0, y0 - ring):min(H, y1 + ring), max(0, x0 - ring):min(W, x1 + ring)].astype(np.float32)
            refr = ref_img[max(0, y0 - ring):min(H, y1 + ring), max(0, x0 - ring):min(W, x1 + ring)].astype(np.float32)
            # 用外圈颜色把亮度/色彩对齐到当前帧
            gain = (target.mean() + 1e-3) / (refr.mean() + 1e-3)
            color_shift = target.reshape(-1, 3).mean(0) - refr.reshape(-1, 3).mean(0)
            patch = np.clip(patch * gain + color_shift * 0.5, 0, 255)
            blend = np.ones((y1 - y0, x1 - x0), np.float32)
            k = max(1, min(h, w) // 6)
            blend[:k, :] *= np.linspace(0, 1, k)[:, None]
            blend[-k:, :] *= np.linspace(1, 0, k)[:, None]
            blend[:, :k] *= np.linspace(0, 1, k)[None, :]
            blend[:, -k:] *= np.linspace(1, 0, k)[None, :]
            fr[y0:y1, x0:x1] = (patch * blend[..., None] + fr[y0:y1, x0:x1] * (1 - blend[..., None])).astype(np.uint8)
        else:
            mask = np.zeros((H, W), np.uint8)
            mask[y0:y1, x0:x1] = 255
            fr = cv2.inpaint(fr, mask, 5, cv2.INPAINT_TELEA)
        writer.write(fr)
        n += 1
    cap.release()
    writer.release()
    print(f"处理 {n} 帧，封装…", file=sys.stderr)

    # 把原音轨接回去
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp]
    has_audio = True
    try:
        probe_audio = subprocess.run([
            "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type",
            "-of", "csv=p=0", a.src], capture_output=True, text=True)
        has_audio = "audio" in probe_audio.stdout
    except Exception:
        has_audio = False
    if has_audio:
        cmd += ["-i", a.src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                "-c:a", "aac", "-map", "0:v:0", "-map", "1:a:0?", "-shortest", a.dst]
    else:
        cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", a.dst]
    subprocess.run(cmd, check=True)
    import os
    os.remove(tmp)
    print(a.dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())
