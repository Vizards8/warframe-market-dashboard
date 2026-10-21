import copy
import json
import unittest
from unittest.mock import patch

from wfm_connector import Connector, ConnectorError, revision

TOKEN = 'TEST_ONLY_SESSION_VALUE_1234567890'


class FakeWfm:
    def __init__(self):
        self.user = {'id': 'owner', 'slug': 'example', 'ingameName': 'Example', 'platform': 'pc', 'crossplay': True, 'verification': True}
        self.orders = {'one': {'id': 'one', 'itemId': 'item', 'type': 'sell', 'quantity': 3, 'platinum': 60, 'visible': False, 'rank': 0, 'updatedAt': 'before'},
                       'two': {'id': 'two', 'itemId': 'item', 'type': 'buy', 'quantity': 6, 'platinum': 20, 'visible': True, 'rank': 10, 'perTrade': 2, 'updatedAt': 'before'}}
        self.calls = []
        self.timeout_after_write = False
        self.reject = None

    def __call__(self, method, path, token, body=None):
        self.calls.append((method, path, copy.deepcopy(body)))
        if self.reject:
            raise self.reject
        if path == '/me':
            return copy.deepcopy(self.user)
        if path == '/orders/my':
            return copy.deepcopy(list(self.orders.values()))
        oid = path.rsplit('/', 1)[-1]
        if method == 'PATCH':
            self.orders[oid].update(body)
            self.orders[oid]['updatedAt'] = 'after'
            if self.timeout_after_write:
                raise ConnectorError('timeout', 502)
        return copy.deepcopy(self.orders[oid])


class ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeWfm()
        self.connector = Connector(self.fake)
        self.connector.connect('JWT ' + TOKEN)

    def change(self, oid='one', **patch):
        return {'id': oid, 'revision': revision(self.fake.orders[oid]), **patch}

    def test_private_snapshot_preserves_hidden_rank_buy_and_never_returns_token(self):
        snapshot = self.connector.snapshot()
        self.assertFalse(snapshot['orders'][0]['visible'])
        self.assertEqual(snapshot['orders'][1]['type'], 'buy')
        self.assertEqual(snapshot['orders'][1]['rank'], 10)
        self.assertNotIn(TOKEN, json.dumps(snapshot) + json.dumps(self.connector.status()))
        self.connector.disconnect()
        with self.assertRaises(ConnectorError):
            self.connector.snapshot()
        self.assertIsNone(self.connector.token)

    def test_single_jwt_cookie_value_becomes_legacy_authorization_not_cookie_header(self):
        self.connector.connect('JWT=' + TOKEN)
        self.assertEqual(self.connector.token, 'JWT ' + TOKEN)
        for value in ['JWT=' + TOKEN + '; tracking=example', 'curl --url https://api.warframe.market/v2/me', 'Cookie: JWT=' + TOKEN]:
            with self.assertRaises(ConnectorError):
                self.connector.connect(value)

    def test_previews_without_writing_then_only_patches_requested_fields(self):
        plan = self.connector.plan([self.change(platinum=75, visible=True)])
        self.assertFalse(any(method == 'PATCH' for method, _, _ in self.fake.calls))
        result = self.connector.apply(plan['planId'])
        self.assertEqual(result['results'][0]['state'], 'verified')
        self.assertEqual([body for method, _, body in self.fake.calls if method == 'PATCH'], [{'platinum': 75, 'visible': True}])
        self.assertEqual(self.fake.orders['one']['rank'], 0)
        with self.assertRaises(ConnectorError):
            self.connector.apply(plan['planId'])

    def test_external_change_conflicts_in_preview_and_before_submit(self):
        stale = self.change(platinum=70)
        self.fake.orders['one']['quantity'] = 2
        with self.assertRaises(ConnectorError):
            self.connector.plan([stale])
        plan = self.connector.plan([self.change(platinum=70)])
        self.fake.orders['one']['visible'] = True
        self.assertEqual(self.connector.apply(plan['planId'])['results'][0]['state'], 'conflict')
        self.assertFalse(any(method == 'PATCH' for method, _, _ in self.fake.calls))

    def test_timeout_reads_back_without_repeating_write(self):
        plan = self.connector.plan([self.change(platinum=70)])
        self.fake.timeout_after_write = True
        self.assertEqual(self.connector.apply(plan['planId'])['results'][0]['state'], 'verified')
        self.assertEqual(sum(method == 'PATCH' for method, _, _ in self.fake.calls), 1)

    def test_validation_ownership_bulk_quantity_and_verification(self):
        for change in [self.change(platinum=0), self.change(quantity=True), self.change(visible='yes'),
                       self.change('two', quantity=5), self.change(rank=10), {'id': 'stranger', 'revision': 'x', 'visible': True}]:
            with self.assertRaises(ConnectorError):
                self.connector.plan([change])
        self.connector.user['verification'] = False
        with self.assertRaises(ConnectorError):
            self.connector.plan([self.change(platinum=70)])

    def test_reauthorization_clears_plans_and_401_clears_session(self):
        plan = self.connector.plan([self.change(platinum=70)])
        self.connector.connect(TOKEN)
        with self.assertRaises(ConnectorError):
            self.connector.apply(plan['planId'])
        self.fake.reject = ConnectorError('expired', 401)
        with self.assertRaises(ConnectorError):
            self.connector.snapshot()
        self.assertFalse(self.connector.status()['connected'])

    def test_partial_batch_stops_after_rate_limit_and_reports_remaining(self):
        self.fake.orders['three'] = {**self.fake.orders['one'], 'id': 'three'}
        plan = self.connector.plan([self.change('one', platinum=71), self.change('two', platinum=72), self.change('three', platinum=73)])
        base = self.connector.transport
        def limited(method, path, token, body=None):
            if path == '/order/two' and method == 'PATCH':
                raise ConnectorError('rate limited', 429)
            return base(method, path, token, body)
        self.connector.transport = limited
        result = self.connector.apply(plan['planId'])['results']
        self.assertEqual([r['state'] for r in result], ['verified', 'unconfirmed', 'skipped'])
        self.assertEqual(self.fake.orders['three']['platinum'], 60)

    def test_plan_expiry(self):
        plan = self.connector.plan([self.change(platinum=70)])
        self.connector.plans[plan['planId']]['expires'] = 0
        with self.assertRaises(ConnectorError):
            self.connector.apply(plan['planId'])

    def test_curl_never_places_auth_in_argv_or_environment(self):
        connector = Connector()
        result = type('Result', (), {'returncode': 0, 'stdout': '{"data":[],"error":null}\n200'})()
        with patch('wfm_connector.subprocess.run', return_value=result) as run:
            connector._http('GET', '/orders/my', 'Bearer ' + TOKEN)
        args, kwargs = run.call_args
        self.assertNotIn(TOKEN, json.dumps(args))
        self.assertNotIn('env', kwargs)
        self.assertIn(TOKEN, kwargs['input'])


if __name__ == '__main__':
    unittest.main()
