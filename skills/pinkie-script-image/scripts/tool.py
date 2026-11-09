#!/usr/bin/env python3
"""本地加工脚本的统一入口：把短名字翻译成 vendor/ 里的真实脚本，并统一 UTF-8 输出。

用法:
  python scripts/tool.py cutout 图1.png 图2.jpg --out 加工/抠图
  python scripts/tool.py sticker 贴纸表.png 猫脸 --out 加工/贴纸
  python scripts/tool.py sheet 出图目录 --out 加工/对比表.jpg --cols 3
  python scripts/tool.py depth 场景.jpg --out 加工/深度
  python scripts/tool.py silhouette 输出.json 猫=剪影.png
  python scripts/tool.py dewatermark 输入.mp4 输出.mp4 --ref 首帧.png
  python scripts/tool.py --list          看有哪些工具
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(os.path.dirname(HERE), "vendor")

TOOLS = {
    "cutout": "cutout.py",           # 抠图：透明底 + 纸贴纸版
    "sticker": "sticker.py",         # 贴纸表切成一张张透明 PNG
    "sheet": "contact_sheet.py",     # 候选图拼对比表
    "depth": "depth.py",             # 深度图（2.5D 视差用）
    "silhouette": "silhouette.py",   # 黑色剪影转矢量路径
    "dewatermark": "dewatermark.py", # 去视频角上的水印
}


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("--list", "-l"):
        print("可用工具：")
        for k, v in TOOLS.items():
            print(f"  {k:<12} {v}")
        return 0

    name, rest = args[0], args[1:]
    if name not in TOOLS:
        print(f"没有 {name}。可用：{', '.join(TOOLS)}", file=sys.stderr)
        return 1

    script = os.path.join(VENDOR, TOOLS[name])
    if not os.path.exists(script):
        print(f"脚本不在：{script}（先跑 node scripts/install.mjs）", file=sys.stderr)
        return 1

    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    # 用当前解释器跑，确依赖都在同一个环境里
    return subprocess.call([sys.executable, script, *rest], env=env)


if __name__ == "__main__":
    sys.exit(main())
