"""B95：打包版 exe 的隔离测试把网关挪开 18789，普通启动永远留在 18789。"""
import unittest
from unittest import mock

from app import windows_desktop as desktop


class GatewayPortTest(unittest.TestCase):
    def test_a_normal_start_stays_on_18789(self):
        self.assertEqual(18789, desktop.gateway_port([], {}))

    def test_the_flag_and_the_environment_move_it(self):
        self.assertEqual(28789, desktop.gateway_port(["--gateway-port=28789"], {}))
        self.assertEqual(28790, desktop.gateway_port(["--gateway-port", "28790"], {}))
        self.assertEqual(28791, desktop.gateway_port([], {"PINKIE_GATEWAY_PORT": "28791"}))

    def test_the_flag_wins_over_the_environment(self):
        self.assertEqual(28789, desktop.gateway_port(["--gateway-port=28789"], {"PINKIE_GATEWAY_PORT": "28791"}))

    def test_a_malformed_value_never_moves_a_users_gateway(self):
        for value in ("", "abc", "80", "99999", "1e4", " 28789", "28789/../x", "-1"):
            with self.subTest(value=value):
                self.assertEqual(18789, desktop.gateway_port([f"--gateway-port={value}"], {}))
                self.assertEqual(18789, desktop.gateway_port([], {"PINKIE_GATEWAY_PORT": value}))
        self.assertEqual(18789, desktop.gateway_port(["--gateway-port"], {}))

    def test_the_gateway_command_and_listener_follow_gateway_url(self):
        with mock.patch.object(desktop, "GATEWAY_URL", "http://127.0.0.1:28789/"):
            self.assertEqual(28789, desktop.GatewaySupervisor.port())
            with mock.patch.object(desktop, "gateway_listener_pid", return_value=None) as listener:
                desktop.GatewaySupervisor._listener()
            listener.assert_called_once_with(28789)
        self.assertEqual(18789, desktop.GatewaySupervisor.port())

    def test_the_built_in_splash_follows_a_moved_port(self):
        self.assertIn("http://127.0.0.1:18789/chat", desktop.startup_fallback_html())
        with mock.patch.object(desktop, "GATEWAY_URL", "http://127.0.0.1:28789/"):
            page = desktop.startup_fallback_html()
        self.assertIn("http://127.0.0.1:28789/chat", page)
        self.assertNotIn("18789", page)


if __name__ == "__main__":
    unittest.main()
