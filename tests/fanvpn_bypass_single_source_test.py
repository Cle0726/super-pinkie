"""FanVPN 直连域名表只维护一份：win_sysproxy 的 PAC 后缀直接用 local_proxy 的表。

以前两份各抄 99 条，注释写着「同源」却没有任何东西保证同步，改一边忘另一边就会
出现「本地代理直连、PAC 却让浏览器走代理」（或反过来）的分流不一致。

合并前后同输入同输出：PAC 文本的哈希、表内容的哈希都是合并前在 origin/main@2d249524
上记下的值。
"""

from __future__ import annotations

import hashlib
import sys
import unittest
from pathlib import Path

FANVPN = Path(__file__).resolve().parents[1] / "app" / "fanvpn"
if str(FANVPN) not in sys.path:
    sys.path.append(str(FANVPN))

import local_proxy  # noqa: E402
import win_sysproxy  # noqa: E402

# 合并前（两份各写一遍时）记下的值。
PAC_SHA256 = "ed00a4f84fa29148d26bb0702779cf70876d72c1d2bd3913de50d4555bbf6e47"
PAC_LENGTH = 2121
LIST_SHA256 = "7d6b0afe277f5e1e90c44aa044525ab37a51505b42200b466326f99b4dc41822"


class BypassSingleSourceTest(unittest.TestCase):
    def test_pac_suffixes_are_the_local_proxy_list_itself(self):
        # 同一个对象，而不只是内容碰巧相等：以后只改 local_proxy 一处就两边一起生效。
        self.assertIs(win_sysproxy.BYPASS_SUFFIXES, local_proxy.DEFAULT_BYPASS)

    def test_list_content_unchanged(self):
        joined = "|".join(win_sysproxy.BYPASS_SUFFIXES)
        self.assertEqual(hashlib.sha256(joined.encode()).hexdigest(), LIST_SHA256)
        self.assertEqual(len(win_sysproxy.BYPASS_SUFFIXES), 99)
        self.assertTrue(all(s.startswith(".") for s in win_sysproxy.BYPASS_SUFFIXES))

    def test_default_pac_output_unchanged(self):
        pac = win_sysproxy.build_pac("127.0.0.1:10809")
        self.assertEqual(len(pac), PAC_LENGTH)
        self.assertEqual(hashlib.sha256(pac.encode()).hexdigest(), PAC_SHA256)

    def test_bypass_decisions_unchanged(self):
        cases = {
            "www.baidu.com": True, "baidu.com": True, "x.gov.cn": True,
            "127.0.0.1": True, "example.com": False, "github.com": False,
        }
        for host, expected in cases.items():
            with self.subTest(host=host):
                self.assertIs(local_proxy.should_bypass(host), expected)


if __name__ == "__main__":
    unittest.main()
