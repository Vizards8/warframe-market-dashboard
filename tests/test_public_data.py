import datetime as dt
import unittest
from unittest.mock import patch
import public_data


class PublicDataTests(unittest.TestCase):
    def test_baro_does_not_fuzzy_match_prime_or_accept_invalid_cost(self):
        cat = [{'slug': 'primed_x', 'name': 'X Prime', 'english': 'Primed X'}]
        raw = {'activation': '2026-10-23T13:00:00Z', 'expiry': '2026-10-25T13:00:00Z',
               'inventory': [{'item': 'Primed X', 'ducats': 100, 'credits': 20000},
                             {'item': 'X', 'ducats': 50, 'credits': 10000},
                             {'item': 'Primed X', 'ducats': -1, 'credits': 20000}]}
        out = public_data.normalize_baro(raw, cat, '2026-10-21T00:00:00Z')
        self.assertEqual(out['inventory'][0]['slug'], 'primed_x')
        self.assertIsNone(out['inventory'][1]['slug'])
        self.assertEqual(len(out['inventory']), 2)
        with self.assertRaises(ValueError):
            public_data.normalize_baro({}, cat, 'now')

    def test_history_keeps_older_data_uses_new_corrections_and_excludes_private_keys(self):
        date = dt.datetime.now(dt.timezone.utc).date()
        old, new = str(date-dt.timedelta(days=120)), str(date-dt.timedelta(days=1))
        prior = {'items': {'a': [{'date': old, 'price': 10, 'volume': 2}, {'date': new, 'price': 20, 'volume': 1}],
                           'private': [{'date': old, 'price': 9000, 'volume': 100}]}}
        market = {'a': {'stats': {'history': [{'date': new, 'price': 30, 'volume': 3}, {'date': str(date), 'price': 999, 'volume': 999}]}}}
        out = public_data.merge_history([{'slug': 'a'}], market, prior)
        self.assertEqual(out['items']['a'], [{'date': old, 'price': 10, 'volume': 2}, {'date': new, 'price': 30, 'volume': 3}])
        self.assertNotIn('private', out['items'])

    def test_old_seed_cannot_overwrite_newer_published_corrections(self):
        day = str(dt.datetime.now(dt.timezone.utc).date()-dt.timedelta(days=1))
        prior = {'stats_at': {'a': '2026-10-21T12:00:00+00:00'},
                 'items': {'a': [{'date': day, 'price': 30, 'volume': 5}]}}
        market = {'a': {'stats_at': '2026-10-20T12:00:00+00:00',
                        'stats': {'history': [{'date': day, 'price': 10, 'volume': 2}]}}}
        out = public_data.merge_history([{'slug': 'a'}], market, prior)
        self.assertEqual(out['items']['a'][0]['price'], 30)
        self.assertEqual(out['stats_at']['a'], prior['stats_at']['a'])

    def test_failed_baro_keeps_original_timestamp_and_sets_error(self):
        old = {'at': '2026-10-20T00:00:00Z', 'inventory': []}
        with patch.object(public_data, 'read', return_value=old), patch.object(public_data, 'fetch', side_effect=RuntimeError('HTTP 403')), patch.object(public_data.Path, 'write_text'):
            out = public_data.refresh_baro([])
        self.assertEqual(out['at'], old['at'])
        self.assertEqual(out['error'], 'HTTP 403')


if __name__ == '__main__':
    unittest.main()
