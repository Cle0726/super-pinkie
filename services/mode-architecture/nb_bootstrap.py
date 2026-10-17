"""内核启动引导：让图形输出能在无头环境里回到 notebook。

为什么需要这个文件：
matplotlib 默认后端是 macosx（GUI），内核跑在后台、没有窗口时
plt.show() 不会产出任何图片数据，cell 输出里就只剩 <Figure> 文字。
只有强制 Agg（纯栅格、内存渲染）才能把 PNG 以 base64 塞回 outputs。

同时把常用数据分析库预先导入，减少每次第一次 cell 的等待。
"""

import os

# 必须在 pyplot 导入之前设置，否则后端已经锁定
os.environ.setdefault("MPLBACKEND", "Agg")

import matplotlib

matplotlib.use("Agg", force=True)

import matplotlib.pyplot as plt

# inline 模式下 plt.show() 会把图转成 base64 挂到 IPython 的 display 钩子上
try:
    from IPython import get_ipython

    ip = get_ipython()
    if ip is not None:
        ip.run_line_magic("matplotlib", "inline")
except Exception:  # 没有 IPython 时退化为普通 Agg 行为
    pass


def _show(*args, **kwargs):
    """在 Agg 下 show() 不会自动显示；这里转成 IPython display。"""
    try:
        from IPython.display import display
        from matplotlib.figure import Figure

        for num in plt.get_fignums():
            display(plt.figure(num))
        plt.close("all")
    except Exception:
        plt.close("all")


# 保存原始 show，PyplotBackend 下没有被 inline 接管时可以兜底
_ORIGINAL_SHOW = plt.show


def _patched_show(*args, **kwargs):
    ip = None
    try:
        from IPython import get_ipython

        ip = get_ipython()
    except Exception:
        ip = None
    if ip is not None:
        return _ORIGINAL_SHOW(*args, **kwargs)
    return _show(*args, **kwargs)


plt.show = _patched_show

# 让 DataFrame 显示更完整（学习场景常需要看全列）
try:
    import pandas as pd

    pd.set_option("display.max_columns", 40)
    pd.set_option("display.width", 160)
except Exception:
    pass

print("[nb] 图形后端:", matplotlib.get_backend())
