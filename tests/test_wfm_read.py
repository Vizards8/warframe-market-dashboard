"""The local connector can only read the fixed public WFM endpoint."""
import unittest
import io
import json
from unittest.mock import Mock, patch

import server


class WfmReadTests(unittest.TestCase):
    def handler(self, path, origin=None):
        handler = object.__new__(server.Handler)
        handler.path = path
        handler.headers = {'Host': f'127.0.0.1:{server.PORT}'}
        if origin:
            handler.headers['Origin'] = origin
        handler.respond = Mock()
        return handler

    def test_read_normalizes_public_slug_and_does_not_persist(self):
        handler = self.handler('/api/wfm-orders?user=Example_User')
        value = {'apiVersion': '0.25.0', 'data': [], 'error': None}
        with patch.object(server, 'market_get', return_value=value) as get:
            handler.do_GET()
        get.assert_called_once_with('https://api.warframe.market/v2/orders/user/example_user')
        handler.respond.assert_called_once_with(value)

    def test_rejects_arbitrary_url_and_foreign_origin(self):
        for path, origin, status in [('/api/wfm-orders?user=https%3A%2F%2Fevil.example', None, 400),
                                      ('/api/wfm-orders?user=example', 'https://evil.example', 403)]:
            handler = self.handler(path, origin)
            with patch.object(server, 'market_get') as get:
                handler.do_GET()
            get.assert_not_called()
            self.assertEqual(handler.respond.call_args.args[1], status)

    def test_private_write_requires_csrf_and_local_origin(self):
        for origin, csrf in [(None, ''), ('https://evil.example', server.WFM_CONNECTOR.csrf)]:
            handler = self.handler('/api/wfm/connect', origin)
            payload = json.dumps({'token': 'TEST_ONLY_SESSION_VALUE_1234567890'}).encode()
            handler.rfile = io.BytesIO(payload)
            handler.headers.update({'Content-Length': str(len(payload)), 'X-VoidLedger-CSRF': csrf})
            with patch.object(server.WFM_CONNECTOR, 'connect') as connect:
                handler.do_POST()
            connect.assert_not_called()
            self.assertEqual(handler.respond.call_args.args[1], 403)

    def test_private_write_dispatches_with_csrf_without_returning_auth(self):
        handler = self.handler('/api/wfm/disconnect', server.BASE)
        handler.rfile = io.BytesIO(b'{}')
        handler.headers.update({'Content-Length': '2', 'X-VoidLedger-CSRF': server.WFM_CONNECTOR.csrf})
        with patch.object(server.WFM_CONNECTOR, 'disconnect', return_value={'connected': False}) as disconnect:
            handler.do_POST()
        disconnect.assert_called_once_with()
        handler.respond.assert_called_once_with({'connected': False})

    def test_api_failure_is_explicit_not_an_empty_inventory(self):
        handler = self.handler('/api/wfm-orders?user=example')
        with patch.object(server, 'market_get', side_effect=RuntimeError('行情服务 HTTP 404')):
            handler.do_GET()
        self.assertEqual(handler.respond.call_args.args[1], 502)
        self.assertIn('error', handler.respond.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
