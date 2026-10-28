"""Exercise collector phases and cache expiry without network or filesystem writes."""

import contextlib
import copy
import datetime as dt
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import refresh_market

NOW = dt.datetime(2026, 10, 28, 8, tzinfo=dt.timezone.utc).timestamp()
FRESH = '2026-10-28T07:00:00Z'
OLD = '2026-10-27T00:00:00Z'


class RefreshCoverageTests(unittest.TestCase):
    def test_cli_default_orders_and_github_update_output(self):
        for argv, expected, changed in [
            (['refresh_market.py'], ('orders', False), True),
            (['refresh_market.py', '--mode', 'stats', '--due'], ('stats', True), False),
            (['refresh_market.py', '--mode', 'full'], ('full', False), True),
        ]:
            with tempfile.TemporaryDirectory() as tmp:
                output = Path(tmp) / 'output'
                with patch.object(refresh_market.sys, 'argv', argv), patch.object(
                    refresh_market, 'refresh', return_value=changed
                ) as run, patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}):
                    refresh_market.main()
                run.assert_called_once_with(*expected)
                self.assertEqual(output.read_text(), f'updated={str(changed).lower()}\n')

    def run_refresh(
        self,
        fail_stats=False,
        mode='full',
        due=False,
        cache=None,
        status=None,
        rivens=None,
        fail_source=None,
    ):
        module = refresh_market
        catalog = [
            {'slug': 'part', 'kind': 'component', 'tags': ['prime'], 'ducats': 45},
            {'slug': 'set', 'kind': 'component', 'tags': ['prime', 'set'], 'ducats': 160},
            {'slug': 'resource', 'kind': 'component', 'tags': [], 'ducats': None},
        ]
        if cache is None:
            cache = {'part': {'stats': {'history': ['old']}, 'stats_at': OLD}}
        if status is None:
            status = {}
        if rivens is None:
            rivens = {}
        seen, writes = [], []

        def fetch(url):
            seen.append(url)
            if fail_stats and '/part/statistics' in url or fail_source and fail_source in url:
                raise RuntimeError('HTTP 429')
            return {}

        def save(path, value):
            writes.append((path.name, copy.deepcopy(value)))

        with contextlib.ExitStack() as stack:
            for owner, key, value in [
                (module.server, 'CATALOG', catalog),
                (module.server, 'CACHE', cache),
                (module.features, 'WEAPON_INDEX', {'weapon': {}}),
                (module.features, 'RIVENS', rivens),
                (module.features, 'CANDIDATES', {'slugs': []}),
            ]:
                stack.enter_context(patch.object(owner, key, value))
            stack.enter_context(patch.object(module.time, 'time', return_value=NOW))
            stack.enter_context(
                patch.object(module.server, 'now', return_value='2026-10-28T08:00:00Z')
            )
            stack.enter_context(patch.object(module.public_data, 'read', return_value=status))
            stack.enter_context(patch.object(module.server, 'market_get', side_effect=fetch))
            stack.enter_context(patch.object(module.server, 'atomic_json', side_effect=save))
            stack.enter_context(
                patch.object(module.server, 'summarize_orders', return_value={'offer_schema': 1})
            )
            stack.enter_context(
                patch.object(
                    module.server,
                    'summarize_stats',
                    return_value={'history': ['new'], 'end': '2026-10-27'},
                )
            )
            stack.enter_context(
                patch.object(
                    module.features, 'riven_summary', side_effect=lambda *a: {'reference': 30}
                )
            )
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            changed = module.refresh(mode, due)
        return cache, seen, status, changed, writes

    def test_parts_and_weapon_sets_collect_both_sources(self):
        cache, seen, status, changed, _ = self.run_refresh()
        for slug in ('part', 'set'):
            self.assertIn(f'https://api.warframe.market/v1/items/{slug}/statistics', seen)
            self.assertIn(f'https://api.warframe.market/v2/orders/item/{slug}', seen)
            self.assertEqual(cache[slug]['stats']['history'], ['new'])
            self.assertEqual(cache[slug]['orders']['offer_schema'], 1)
        self.assertFalse(any('/resource' in url for url in seen))
        self.assertTrue(changed)
        self.assertEqual(set(status['sources']), {'orders', 'stats', 'rivens'})

    def test_failed_component_stats_keep_original_timestamp(self):
        cache, _, status, _, _ = self.run_refresh(fail_stats=True)
        self.assertEqual(cache['part']['stats_at'], OLD)
        self.assertEqual(cache['part']['stats']['history'], ['old'])
        self.assertEqual(cache['part']['stats_error'], 'HTTP 429')
        self.assertEqual(cache['set']['stats']['history'], ['new'])
        self.assertEqual(len(status['sources']['stats']['failures']), 1)

    def test_orders_only_preserves_stats_rivens_and_phase_status(self):
        stats = {'finished': FRESH, 'queries': 2, 'failures': []}
        cache, seen, status, _, _ = self.run_refresh(
            mode='orders', status={'sources': {'stats': stats}}
        )
        self.assertEqual(len(seen), 2)
        self.assertTrue(all('/v2/orders/item/' in url for url in seen))
        self.assertEqual(cache['part']['stats_at'], OLD)
        self.assertEqual(status['sources']['stats'], stats)
        self.assertEqual(status['finished'], status['sources']['orders']['finished'])

    def test_due_statistics_skip_recent_success_and_refetch_missing_failed_or_old_cutoff(self):
        good = {'stats_at': FRESH, 'stats': {'end': '2026-10-27', 'history': ['keep']}}
        cache, seen, _, _, _ = self.run_refresh(
            mode='stats', due=True, cache={'part': copy.deepcopy(good)}
        )
        self.assertEqual(len(seen), 1)
        self.assertIn('/set/statistics', seen[0])
        self.assertEqual(cache['part']['stats']['history'], ['keep'])
        for changed in (
            {'stats_error': '429'},
            {'stats_at': OLD},
            {'stats': {'end': '2026-10-26'}},
            {'stats_at': '2026-10-29T00:00:00Z'},
        ):
            _, seen, _, _, _ = self.run_refresh(
                mode='stats', due=True, cache={'part': {**good, **changed}, 'set': good}
            )
            self.assertEqual(len(seen), 1)
            self.assertIn('/part/statistics', seen[0])

    def test_six_hour_boundary_and_utc_rollover(self):
        self.assertTrue(refresh_market.recent('2026-10-28T02:00:01Z', NOW))
        self.assertFalse(refresh_market.recent('2026-10-28T02:00:00Z', NOW))
        self.assertFalse(refresh_market.recent('invalid', NOW))
        self.assertTrue(
            refresh_market.stats_due({'stats_at': FRESH, 'stats': {'end': '2026-10-26'}}, NOW)
        )

    def test_nothing_due_does_not_change_status_or_persist(self):
        good = {'stats_at': FRESH, 'stats': {'end': '2026-10-27', 'history': []}}
        status = {'finished': OLD, 'sources': {'stats': {'finished': FRESH}}}
        _, seen, out, changed, writes = self.run_refresh(
            mode='stats', due=True, cache={'part': good, 'set': good}, status=status
        )
        self.assertEqual(seen, [])
        self.assertFalse(changed)
        self.assertEqual(writes, [])
        self.assertEqual(out['finished'], OLD)
        self.assertEqual(out['sources']['stats']['finished'], FRESH)

    def test_manual_stats_forces_recent_data_but_keeps_orders_timestamp(self):
        good = {'stats_at': FRESH, 'stats': {'end': '2026-10-27', 'history': []}}
        _, seen, status, _, _ = self.run_refresh(
            mode='stats', cache={'part': good, 'set': copy.deepcopy(good)}, status={'finished': OLD}
        )
        self.assertEqual(len(seen), 2)
        self.assertEqual(status['finished'], OLD)

    def test_riven_batch_cadence_force_and_failure_recovery(self):
        status = {'sources': {'rivens': {'finished': FRESH, 'failures': []}}}
        _, seen, _, changed, _ = self.run_refresh(
            mode='rivens', due=True, status=copy.deepcopy(status)
        )
        self.assertEqual(seen, [])
        self.assertFalse(changed)
        rivens = {'weapon': {'at': OLD, 'error': '429', 'reference': 20}}
        _, seen, _, changed, _ = self.run_refresh(
            mode='rivens', status=copy.deepcopy(status), rivens=rivens
        )
        self.assertEqual(len(seen), 1)
        self.assertTrue(changed)
        self.assertEqual(rivens['weapon']['reference'], 30)
        self.assertNotIn('error', rivens['weapon'])
        status['sources']['rivens']['failures'] = [{'source': 'rivens'}]
        _, seen, _, _, _ = self.run_refresh(mode='rivens', due=True, status=status)
        self.assertEqual(len(seen), 1)

    def test_total_phase_failure_stops_publication_without_success_timestamp(self):
        for mode, path in [
            ('orders', '/v2/orders/'),
            ('stats', '/statistics'),
            ('rivens', '/auctions/'),
        ]:
            status = {'finished': OLD, 'sources': {}}
            with self.assertRaisesRegex(SystemExit, f'All {mode} requests failed'):
                self.run_refresh(mode=mode, status=status, fail_source=path)
            self.assertEqual(status['finished'], OLD)
            self.assertNotIn(mode, status['sources'])
