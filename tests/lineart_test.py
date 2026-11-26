"""tools/lineart.py 的纯逻辑单测。

lineart.py 是一条从头跑到尾的脚本：一 import 就解析命令行、用 OpenCV 读图、用 scikit-image 求骨架。
CI 和本机都没装 cv2 / skimage，所以这里不 import 它，而是用 ast 只取出要测的那几段（函数定义、
或两行注释之间的一段顶层语句），放进自备的命名空间执行：图像、骨架、OpenCV 一律换成手搓的数据
和假对象，只验证几何与排序逻辑本身。需要 numpy 的几组在没有 numpy 时跳过。
"""
import ast
import math
import types
import unittest
from pathlib import Path

try:
    import numpy as np
except ImportError:  # CI 的 Python 不一定带 numpy
    np = None

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "lineart.py"
SOURCE = SCRIPT.read_text(encoding="utf-8")
LINES = SOURCE.splitlines()
TREE = ast.parse(SOURCE)
needs_numpy = unittest.skipUnless(np is not None, "需要 numpy")


def line_of(text):
    """源码里第一行以 text 开头（忽略缩进）的行号，从 1 数起。"""
    return next(i for i, line in enumerate(LINES, 1) if line.lstrip().startswith(text))


def run(nodes, env):
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), "exec"), env)
    return env


def segment(start, end, **env):
    """执行 start 那一行到 end 那一行之前的所有顶层语句。"""
    lo, hi = line_of(start), line_of(end)
    return run([node for node in TREE.body if lo <= node.lineno < hi], {"math": math, "np": np, **env})


def defs(*names, **env):
    """只取出指定名字的顶层函数 / 赋值（如 lambda）。"""
    def named(node):
        if isinstance(node, ast.FunctionDef):
            return node.name in names
        return isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets)
    picked = [node for node in TREE.body if named(node)]
    assert len(picked) == len(names), names
    return run(picked, {"math": math, "np": np, **env})


def line(y, x0, x1):
    return [(y, x) for x in range(x0, x1 + 1)]


class CommandLineTest(unittest.TestCase):
    def test_defaults_match_the_usage_line(self):
        env = segment("ap = argparse.ArgumentParser()", "a = ap.parse_args()", argparse=__import__("argparse"))
        a = env["ap"].parse_args(["in.png", "out.json"])
        self.assertEqual((a.src, a.out, a.size, a.svg, a.eps, a.image, a.image_px),
                         ("in.png", "out.json", 96, None, 1.4, None, 384))
        a = env["ap"].parse_args(["in.png", "out.json", "--size", "48", "--image-px", "128", "--svg", "p.svg"])
        self.assertEqual((a.size, a.image_px, a.svg), (48.0, 128, "p.svg"))


class FrameTest(unittest.TestCase):
    def test_viewbox_mapping(self):
        env = defs("tx", "ty", cx=50, cy=20, side=100, S=0.96)
        self.assertEqual(env["tx"](0), 0)
        self.assertAlmostEqual(env["tx"](100), 96)
        self.assertAlmostEqual(env["ty"](-30), 0)
        self.assertAlmostEqual(env["ty"](70), 96)

    @needs_numpy
    def test_drawing_is_centred_with_a_margin(self):
        ink = np.zeros((80, 120), np.uint8)
        ink[20:41, 10:61] = 1                     # 墨迹包围盒 x 10..60、y 20..40
        env = segment("ys, xs = np.nonzero(ink)", "# stroke width", ink=ink, a=types.SimpleNamespace(size=96))
        tx, ty = env["tx"], env["ty"]
        self.assertAlmostEqual(env["side"], 50 * 1.12)  # 长边留 12% 边
        self.assertAlmostEqual(tx(10) + tx(60), 96)     # 左右居中
        self.assertAlmostEqual(ty(20) + ty(40), 96)     # 上下居中
        self.assertAlmostEqual(tx(60) - tx(10), 96 / 1.12)


class SmallHelpersTest(unittest.TestCase):
    def test_centroid_guards_against_empty_moments(self):
        moments = {}
        cv2 = types.SimpleNamespace(moments=lambda contour: moments[contour])
        cxy = defs("cxy", cv2=cv2)["cxy"]
        moments["ring"] = {"m00": 4.0, "m10": 8.0, "m01": 12.0}
        moments["flat"] = {"m00": 0.0, "m10": 5.0, "m01": 7.0}
        self.assertEqual(cxy("ring"), (2.0, 3.0))
        self.assertEqual(cxy("flat"), (5.0, 7.0))  # 面积为 0 时不除零

    def test_neighbours_and_spurs(self):
        pts = {(0, 0), (0, 1), (1, 1), (5, 5)}
        env = defs("OFF", "nb", "L", "is_spur", pts=pts, deg={(0, 0): 2, (1, 1): 2, (0, 1): 1, (9, 9): 1}, spur=3)
        self.assertEqual(sorted(env["nb"]((0, 0))), [(0, 1), (1, 1)])   # 8 邻域，含斜角
        self.assertEqual(env["nb"]((5, 5)), [])
        self.assertAlmostEqual(env["L"]([(0, 0), (0, 3), (4, 3)]), 7)
        is_spur = env["is_spur"]
        self.assertTrue(is_spur([(0, 0), (0, 1)]))                      # 短且有一头悬空
        self.assertFalse(is_spur([(0, 0), (1, 1)]))                     # 短但两头都连着
        self.assertFalse(is_spur([(0, 1), (0, 2), (0, 3), (9, 9)]))      # 悬空但够长


class HandOrderTest(unittest.TestCase):
    def order(self, strokes, spur=7):
        env = segment("strokes = [s for s in strokes if L(s) >= spur * 1.2]", "res = []",
                      strokes=strokes, spur=spur, **defs("L"))
        return env["out"]

    def test_longest_first_then_nearest_pen_down(self):
        a = line(0, 0, 30)                       # 最长，先画
        b = line(0, 31, 50)                      # 起点紧挨 a 的终点
        c = line(100, 0, 15)
        tiny = line(50, 0, 5)                    # 短于 spur * 1.2，丢掉
        self.assertEqual(self.order([c, tiny, b, a]), [a, b, c[::-1]])  # c 的尾巴离 b 的终点更近：倒着画

    def test_stroke_is_reversed_when_its_end_is_nearer(self):
        a = line(0, 0, 30)
        b = line(0, 31, 50)[::-1]                # 尾巴挨着 a 的终点
        self.assertEqual(self.order([a, b]), [a, b[::-1]])

    def test_nothing_left(self):
        self.assertEqual(self.order([line(0, 0, 3)]), [])


@needs_numpy
class SkeletonGraphTest(unittest.TestCase):
    def graph(self, points, shape=(48, 48), width=2.0, eye_mask=None):
        sk = np.zeros(shape, np.uint8)
        for p in points:
            sk[p] = 1
        eye_mask = np.zeros(shape, np.uint8) if eye_mask is None else eye_mask
        return segment("# skeleton graph", "# chain edges through junctions", sk=sk, width=width, eye_mask=eye_mask)

    def ends(self, edge):
        return {tuple(map(int, edge[0])), tuple(map(int, edge[-1]))}

    def test_straight_line_is_one_edge(self):
        env = self.graph(line(5, 0, 19))
        self.assertEqual(len(env["edges"]), 1)   # 从两头各走一遍，但只记一次
        self.assertEqual(self.ends(env["edges"][0]), {(5, 0), (5, 19)})
        self.assertEqual(len(env["edges"][0]), 20)

    def test_loop_without_junctions_is_closed(self):
        diamond = [(10, 12), (11, 11), (12, 10), (13, 11), (14, 12), (13, 13), (12, 14), (11, 13)]
        env = self.graph(diamond)
        self.assertEqual(env["nodes"], set())
        [loop] = env["edges"]
        self.assertEqual(loop[0], loop[-1])
        self.assertEqual(sorted(set(loop)), sorted(diamond))
        self.assertAlmostEqual(env["L"](loop), 8 * math.sqrt(2))

    def test_short_dangling_spur_is_dropped(self):
        env = self.graph(line(10, 0, 30) + [(11, 15), (12, 15)])
        kept = {p for e in env["edges"] for p in e}
        self.assertNotIn((12, 15), kept)         # 毛刺尖端没了
        self.assertIn((10, 0), kept)
        self.assertIn((10, 30), kept)

    def test_edges_inside_the_eye_ring_are_dropped(self):
        eye_mask = np.zeros((48, 48), np.uint8)
        eye_mask[30:35, :] = 1
        env = self.graph(line(5, 0, 19) + line(32, 0, 19), eye_mask=eye_mask)
        self.assertEqual([self.ends(e) for e in env["edges"]], [{(5, 0), (5, 19)}])


@needs_numpy
class ChainTest(unittest.TestCase):
    def chain(self, edges):
        return segment("# chain edges through junctions", "# simplify + smooth", edges=edges, **defs("L"))["strokes"]

    def test_tangent_points_away_from_each_end(self):
        tangent = segment("# chain edges through junctions", "used = [False]")["tangent"]
        e = line(0, 0, 9)                         # (y, x)，x 递增
        self.assertEqual(tangent(e, True).tolist(), [1.0, 0.0])
        self.assertEqual(tangent(e, False).tolist(), [-1.0, 0.0])
        self.assertEqual(tangent([(3, 3), (3, 3)], True).tolist(), [0.0, 0.0])  # 零长度不除零

    def test_edges_meeting_head_on_become_one_stroke(self):
        left, right = line(5, 0, 20), line(5, 20, 30)
        [stroke] = self.chain([right, left[::-1]])
        # 从最长的一段（x 20→0）起笔，再往它的起点那头接上 right：整笔是 x 30→0。
        self.assertEqual(stroke, line(5, 0, 30)[::-1])

    def test_sharp_turn_is_not_chained(self):
        across = line(5, 0, 20)
        back = [(5 + k, 20 - k) for k in range(0, 8)]  # 在终点折回 135°
        strokes = self.chain([across, back])
        self.assertEqual(sorted(map(len, strokes)), [8, 21])

    def test_crossing_goes_straight_through(self):
        # 十字路口：横线接横线、竖线接竖线，而不是在路口拐弯。
        edges = [line(20, 0, 20), line(20, 20, 40), [(y, 20) for y in range(0, 21)], [(y, 20) for y in range(20, 41)]]
        strokes = self.chain(edges)
        self.assertEqual(sorted({s[0], s[-1]} == {(20, 0), (20, 40)} or {s[0], s[-1]} == {(0, 20), (40, 20)}
                                for s in strokes), [True, True])


@needs_numpy
class PathTest(unittest.TestCase):
    def to_d(self, points, S=2.0):
        calls = []

        def approx(curve, eps, closed):
            calls.append((round(eps, 6), closed))
            return curve                          # 假的 RDP：一个点都不删

        env = defs("to_d", cv2=types.SimpleNamespace(approxPolyDP=approx), a=types.SimpleNamespace(eps=1.4),
                   S=S, tx=lambda x: x, ty=lambda y: y)
        return env["to_d"](points), calls

    def test_two_points_become_one_catmull_rom_cubic(self):
        (d, length), calls = self.to_d([(0, 0), (0, 6)])
        self.assertEqual(d, "M0.00 0.00C1.00 0.00 5.00 0.00 6.00 0.00")
        self.assertAlmostEqual(length, 6)
        self.assertEqual(calls, [(2.8, False)])  # 容差按 eps * S 放大到画布坐标

    def test_points_are_y_x_and_mapped_to_x_y(self):
        (d, _), _ = self.to_d([(3, 1), (7, 4)])
        self.assertTrue(d.startswith("M1.00 3.00C"))
        self.assertTrue(d.endswith(" 4.00 7.00"))

    def test_closed_loop_returns_to_its_start(self):
        square = line(0, 0, 9)[::3] + [(3, 9), (6, 9), (9, 9), (9, 6), (9, 3), (9, 0), (6, 0), (3, 0), (1, 0)]
        self.assertGreater(len(square), 10)
        (d, length), calls = self.to_d(square)
        self.assertEqual(calls[0][1], True)
        self.assertEqual(d.count("C"), len(square))  # 补了一段回到起点
        self.assertTrue(d.endswith(" 0.00 0.00"))
        self.assertAlmostEqual(length, 36)

    def test_short_paths_are_never_closed(self):
        (_, _), calls = self.to_d([(0, 0), (0, 1), (1, 1), (0, 0)])
        self.assertEqual(calls[0][1], False)      # 不足 11 个点

    def test_single_point_gives_nothing(self):
        (d, length), _ = self.to_d([(5, 5)])
        self.assertIsNone(d)
        self.assertEqual(length, 0)


if __name__ == "__main__":
    unittest.main()
