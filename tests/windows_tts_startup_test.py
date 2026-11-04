import importlib.util
import os
from pathlib import Path
import runpy
import sys
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / 'services/tts/edge_tts_server.py'


class WindowsTtsStartupTests(unittest.TestCase):
    def load_embedded(self, argument, configured_port=None):
        spec = importlib.util.spec_from_file_location('pinkie_embedded_tts_test', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch.object(sys, 'argv', ['pinkie.exe', argument]):
            os.environ.pop('PINKIE_TTS_PORT', None)
            if configured_port is not None:
                os.environ['PINKIE_TTS_PORT'] = configured_port
            spec.loader.exec_module(module)
        return module

    def test_embedded_service_ignores_desktop_only_arguments(self):
        for argument in ('--preserve-existing-profile', '--update-health-token=' + 'a' * 32):
            with self.subTest(argument=argument):
                self.assertEqual(self.load_embedded(argument).PORT, 18888)

    def test_embedded_service_honours_explicit_port_environment(self):
        self.assertEqual(self.load_embedded('--preserve-existing-profile', '19990').PORT, 19990)

    def test_standalone_cli_still_uses_its_numeric_port_argument(self):
        server = mock.Mock(server_port=19991)
        with mock.patch.dict(os.environ, {}, clear=False), \
             mock.patch.object(sys, 'argv', [str(SCRIPT), '19991']), \
             mock.patch('http.server.ThreadingHTTPServer', return_value=server) as create, \
             mock.patch('builtins.print'):
            os.environ.pop('PINKIE_TTS_PORT', None)
            os.environ['PINKIE_TTS_HOST'] = '127.0.0.1'
            runpy.run_path(str(SCRIPT), run_name='__main__')
        self.assertEqual(create.call_args.args[0], ('127.0.0.1', 19991))
        server.serve_forever.assert_called_once()
        server.server_close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
