"""Exercise the scheduled collector; all network and persistence stay mocked."""
import contextlib
import io
import unittest
from unittest.mock import patch
from scripts import refresh_market


class RefreshCoverageTests(unittest.TestCase):
    def run_refresh(self, fail_stats=False):
        module = refresh_market
        catalog = [{'slug': 'part', 'kind': 'component', 'tags': ['prime'], 'ducats': 45},
                   {'slug': 'set', 'kind': 'component', 'tags': ['prime', 'set'], 'ducats': 160},
                   {'slug': 'resource', 'kind': 'component', 'tags': [], 'ducats': None}]
        cache = {'part': {'stats': {'history': ['old']}, 'stats_at': '2026-10-20T00:00:00Z'}}
        seen = []
        def fetch(url):
            seen.append(url)
            if fail_stats and '/part/statistics' in url:
                raise RuntimeError('HTTP 429')
            return {}
        with contextlib.ExitStack() as stack:
            for owner, key, value in [(module.server, 'CATALOG', catalog), (module.server, 'CACHE', cache),
                                      (module.features, 'WEAPON_INDEX', {'weapon': {}}),
                                      (module.features, 'RIVENS', {}),
                                      (module.features, 'CANDIDATES', {'slugs': []})]:
                stack.enter_context(patch.object(owner, key, value))
            stack.enter_context(patch.object(module.server, 'market_get', side_effect=fetch))
            stack.enter_context(patch.object(module.server, 'atomic_json'))
            stack.enter_context(patch.object(module.server, 'summarize_orders', return_value={'offer_schema': 1}))
            stack.enter_context(patch.object(module.server, 'summarize_stats', return_value={'history': ['new']}))
            stack.enter_context(patch.object(module.features, 'riven_summary', return_value={}))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            module.refresh()
        return cache, seen

    def test_parts_and_weapon_sets_collect_both_sources(self):
        cache, seen = self.run_refresh()
        for slug in ('part', 'set'):
            self.assertIn(f'https://api.warframe.market/v1/items/{slug}/statistics', seen)
            self.assertIn(f'https://api.warframe.market/v2/orders/item/{slug}', seen)
            self.assertEqual(cache[slug]['stats']['history'], ['new'])
            self.assertEqual(cache[slug]['orders']['offer_schema'], 1)
        self.assertFalse(any('/resource' in url for url in seen))

    def test_failed_component_stats_keep_original_timestamp(self):
        cache, _ = self.run_refresh(fail_stats=True)
        self.assertEqual(cache['part']['stats_at'], '2026-10-20T00:00:00Z')
        self.assertEqual(cache['part']['stats']['history'], ['old'])
        self.assertEqual(cache['part']['stats_error'], 'HTTP 429')
        self.assertEqual(cache['set']['stats']['history'], ['new'])
