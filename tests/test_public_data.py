import datetime as dt
import unittest
from contextlib import ExitStack
from unittest.mock import patch
from dashboard import public_data


class PublicDataTests(unittest.TestCase):
    def test_checked_baro_quotes_survive_older_ci_cache_without_overwriting_newer_sources(
        self,
    ):
        old = {
            'orders': {'sell': []},
            'orders_at': '2026-10-23T12:00:00Z',
            'orders_error': 'HTTP 429',
            'stats': {'history': []},
            'stats_at': '2026-10-23T17:00:00Z',
            'stats_error': 'retry failed',
        }
        checked = {
            'orders': {'sell': [{'price': 45}]},
            'orders_at': '2026-10-23T16:00:00Z',
            'stats': {'history': [{'price': 100}]},
            'stats_at': '2026-10-23T16:00:00Z',
        }
        with patch.object(public_data, 'read', side_effect=[{'a': old}, {'a': checked}, {}]):
            out = public_data.market_snapshot()['a']
        self.assertEqual(out['orders'], checked['orders'])
        self.assertNotIn('orders_error', out)
        self.assertEqual(out['stats'], old['stats'])
        self.assertEqual(out['stats_error'], 'retry failed')
        self.assertIn('orders_error', old)

    def test_baro_does_not_fuzzy_match_prime_or_accept_invalid_cost(self):
        cat = [{'slug': 'primed_x', 'name': 'X Prime', 'english': 'Primed X'}]
        raw = {
            'activation': '2026-10-23T13:00:00Z',
            'expiry': '2026-10-25T13:00:00Z',
            'inventory': [
                {'item': 'Primed X', 'ducats': 100, 'credits': 20000},
                {'item': 'X', 'ducats': 50, 'credits': 10000},
                {'item': 'Primed X', 'ducats': -1, 'credits': 20000},
            ],
        }
        out = public_data.normalize_baro(raw, cat, '2026-10-21T00:00:00Z')
        self.assertEqual(out['inventory'][0]['slug'], 'primed_x')
        self.assertIsNone(out['inventory'][1]['slug'])
        self.assertEqual(len(out['inventory']), 2)
        with self.assertRaises(ValueError):
            public_data.normalize_baro({}, cat, 'now')

    def test_history_keeps_older_data_uses_new_corrections_and_excludes_private_keys(
        self,
    ):
        date = dt.datetime.now(dt.timezone.utc).date()
        old, new = str(date - dt.timedelta(days=120)), str(date - dt.timedelta(days=1))
        prior = {
            'items': {
                'a': [
                    {'date': old, 'price': 10, 'volume': 2},
                    {'date': new, 'price': 20, 'volume': 1},
                ],
                'private': [{'date': old, 'price': 9000, 'volume': 100}],
            }
        }
        market = {
            'a': {
                'stats': {
                    'history': [
                        {'date': new, 'price': 30, 'volume': 3},
                        {'date': str(date), 'price': 999, 'volume': 999},
                    ]
                }
            }
        }
        out = public_data.merge_history([{'slug': 'a'}], market, prior)
        self.assertEqual(
            out['items']['a'],
            [
                {'date': old, 'price': 10, 'volume': 2},
                {'date': new, 'price': 30, 'volume': 3},
            ],
        )
        self.assertNotIn('private', out['items'])

    def test_old_seed_cannot_overwrite_newer_published_corrections(self):
        day = str(dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1))
        prior = {
            'stats_at': {'a': '2026-10-21T12:00:00+00:00'},
            'items': {'a': [{'date': day, 'price': 30, 'volume': 5}]},
        }
        market = {
            'a': {
                'stats_at': '2026-10-20T12:00:00+00:00',
                'stats': {'history': [{'date': day, 'price': 10, 'volume': 2}]},
            }
        }
        out = public_data.merge_history([{'slug': 'a'}], market, prior)
        self.assertEqual(out['items']['a'][0]['price'], 30)
        self.assertEqual(out['stats_at']['a'], prior['stats_at']['a'])

    def test_failed_baro_keeps_original_timestamp_and_sets_error(self):
        old = {'at': '2026-10-20T00:00:00Z', 'inventory': []}
        with ExitStack() as stack:
            stack.enter_context(patch.object(public_data, 'read', return_value=old))
            stack.enter_context(
                patch.object(public_data, 'fetch', side_effect=RuntimeError('HTTP 403'))
            )
            stack.enter_context(patch.object(public_data.Path, 'write_text'))
            out = public_data.refresh_baro([])
        self.assertEqual(out['at'], old['at'])
        self.assertIn('HTTP 403', out['error'])

    def worldstate(self, manifest=None):
        return {
            'Time': 1792764000,
            'VoidTraders': [
                {
                    'Activation': {'$date': {'$numberLong': '1792760400000'}},
                    'Expiry': {'$date': {'$numberLong': '1792933200000'}},
                    'Character': 'EvilBaroWeek2',
                    'Node': 'EarthHUB',
                    'Manifest': manifest
                    if manifest is not None
                    else [
                        {
                            'ItemType': '/Lotus/StoreItems/Upgrades/Mods/Shotgun/Expert/WeaponDamageAmountModExpert',
                            'PrimePrice': 300,
                            'RegularPrice': 110000,
                        },
                        {
                            'ItemType': '/Lotus/StoreItems/UnmappedNewItem',
                            'PrimePrice': 10,
                            'RegularPrice': 100,
                        },
                    ],
                }
            ],
        }

    def test_official_worldstate_exact_mapping_costs_and_unknown_item(self):
        catalog = [
            {
                'slug': 'primed_point_blank',
                'english': 'Primed Point Blank',
                'name': '抵近射击 Prime',
            }
        ]
        out = public_data.normalize_worldstate(self.worldstate(), catalog, '2026-10-23T14:00:00Z')
        self.assertEqual(out['source'], public_data.WORLDSTATE_URL)
        self.assertEqual(out['inventory'][0]['slug'], 'primed_point_blank')
        self.assertEqual(out['inventory'][0]['ducats'], 300)
        self.assertEqual(out['inventory'][0]['credits'], 110000)
        self.assertIsNone(out['inventory'][1]['slug'])
        self.assertEqual(out['total_items'], 2)
        self.assertEqual(out['location'], '地球 · Strata 中继站')
        self.assertEqual(out['activation'], '2026-10-23T13:00:00+00:00')

    def test_official_rejects_stale_empty_active_and_invalid_costs(self):
        with self.assertRaises(ValueError):
            public_data.normalize_worldstate(self.worldstate(), [], '2026-10-24T14:00:00Z')
        with self.assertRaises(ValueError):
            public_data.normalize_worldstate(self.worldstate([]), [], '2026-10-23T14:00:00Z')
        bad = self.worldstate()
        bad['VoidTraders'][0]['Manifest'][0]['PrimePrice'] = True
        with self.assertRaises(ValueError):
            public_data.normalize_worldstate(bad, [], '2026-10-23T14:00:00Z')

    def test_official_active_trader_wins_over_upcoming(self):
        raw = self.worldstate()
        later = {
            **raw['VoidTraders'][0],
            'Activation': {'$date': {'$numberLong': '1793365200000'}},
            'Expiry': {'$date': {'$numberLong': '1793538000000'}},
            'Node': 'MercuryHUB',
        }
        raw['VoidTraders'].insert(0, later)
        out = public_data.normalize_worldstate(raw, [], '2026-10-23T14:00:00Z')
        self.assertEqual(out['location'], '地球 · Strata 中继站')

    def test_official_failure_uses_community_fallback(self):
        community = {
            'activation': '2026-10-23T13:00:00Z',
            'expiry': '2026-10-25T13:00:00Z',
            'inventory': [],
        }
        with ExitStack() as stack:
            stack.enter_context(
                patch.object(
                    public_data, 'fetch', side_effect=[RuntimeError('HTTP 404'), community]
                )
            )
            stack.enter_context(patch.object(public_data.Path, 'write_text'))
            out = public_data.refresh_baro([])
        self.assertEqual(out['source'], public_data.BARO_URL)
        self.assertNotIn('error', out)
        self.assertEqual(out['source_errors'], ['HTTP 404'])

    def test_community_internal_names_use_only_verified_explicit_aliases(self):
        catalog = [
            {
                'slug': 'primed_fulmination',
                'english': 'Primed Fulmination',
                'name': '猛烈爆发 Prime',
            },
            {
                'slug': 'primed_expel_the_murmur',
                'english': 'Primed Expel The Murmur',
                'name': '驱逐低语者 Prime',
            },
        ]
        raw = {
            'activation': '2026-10-23T13:00:00Z',
            'expiry': '2026-10-25T13:00:00Z',
            'inventory': [
                {'item': 'Prime Fulmination', 'ducats': 350, 'credits': 175000},
                {
                    'item': 'Weapon Pistol Faction Damage Murmurs Expert',
                    'ducats': 375,
                    'credits': 130000,
                },
                {'item': 'Fulmination', 'ducats': 300, 'credits': 100000},
            ],
        }
        out = public_data.normalize_baro(raw, catalog, '2026-10-23T14:00:00Z')
        self.assertEqual(
            [x['slug'] for x in out['inventory']],
            ['primed_fulmination', 'primed_expel_the_murmur', None],
        )
        self.assertEqual(out['inventory'][0]['name'], 'Primed Fulmination')


if __name__ == '__main__':
    unittest.main()
