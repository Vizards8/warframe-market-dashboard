"""Exercise local asset routing after moving the frontend source files."""

from http.server import ThreadingHTTPServer
from contextlib import ExitStack, redirect_stdout
import io
import re
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

from dashboard import assets, server


class QuietHandler(server.Handler):
    def log_message(self, *args):
        pass


class ServerAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.port = cls.http.server_port
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()

    def request(self, path):
        with patch.object(server, 'PORT', self.port):
            return urlopen(f'http://127.0.0.1:{self.port}{path}', timeout=5)

    def test_local_html_assets_resolve_and_source_files_stay_private(self):
        with self.request('/') as response:
            html = response.read().decode()
        paths = re.findall(r'(?:src|href)="(/[^\"]+\.(?:js|css))"', html)
        self.assertEqual(set(paths), set(assets.local_files()))
        for path in paths:
            with self.request(path) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), assets.local_files()[path].read_bytes())
        for path in (
            '/data/settings.json',
            '/dashboard/server.py',
            '/js/../index.html',
        ):
            with self.assertRaises(HTTPError) as error:
                self.request(path)
            self.assertEqual(error.exception.code, 404)

    def test_local_portable_route_inlines_the_shared_assets(self):
        with self.request('/portable.html') as response:
            html = response.read().decode()
        self.assertIn('portable-data', html)
        self.assertNotIn('<script src=', html)
        self.assertNotIn('<!-- dashboard:', html)

    def test_empty_market_cache_does_not_require_an_old_raw_capture(self):
        code = """
from unittest.mock import patch
from dashboard import public_data
with patch.object(public_data, 'market_snapshot', return_value={}):
    from dashboard import server
    assert server.CACHE == {}
"""
        subprocess.run([sys.executable, '-c', code], cwd=server.ROOT, check=True)

    def test_launch_entrypoint_uses_custom_port_for_host_validation(self):
        with ExitStack() as stack:
            stack.enter_context(
                patch.object(sys, 'argv', ['server.py', '--serve', '--port', '19001'])
            )
            stack.enter_context(patch.object(server, 'PORT', server.PORT))
            stack.enter_context(patch.object(server, 'BASE', server.BASE))
            http = stack.enter_context(patch.object(server, 'ThreadingHTTPServer'))
            stack.enter_context(redirect_stdout(io.StringIO()))
            server.main()
            self.assertEqual(server.PORT, 19001)
            self.assertEqual(server.BASE, 'http://127.0.0.1:19001')
            http.assert_called_once_with(('127.0.0.1', 19001), server.Handler)
