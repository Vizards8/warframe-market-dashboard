#!/usr/bin/env python3
"""Rate-limited scheduled updates of public prices. Never publishes inventory."""
import datetime as dt
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
import features


def refresh():
    failures = []
    completed = 0
    def record(slug, source, url, summarize, cache):
        nonlocal completed
        try:
            cache.setdefault(slug, {})[source] = summarize(server.market_get(url))
            cache[slug][source + '_at'] = server.now()
            cache[slug].pop(source + '_error', None)
        except Exception as error:
            cache.setdefault(slug, {})[source + '_error'] = str(error)[:160]
            failures.append({'slug': slug, 'source': source, 'message': str(error)[:160]})
        completed += 1
        if completed % 25 == 0:
            print(f'{completed} queries completed; {len(failures)} failures', flush=True)
            server.atomic_json(ROOT / 'data/market.json', server.CACHE)

    for item in server.CATALOG:
        slug = item['slug']
        record(slug, 'orders', f'https://api.warframe.market/v2/orders/item/{slug}', server.summarize_orders, server.CACHE)
        record(slug, 'stats', f'https://api.warframe.market/v1/items/{slug}/statistics', server.summarize_stats, server.CACHE)
    # All distinct tradable relic rewards: orders only, shared rewards queried once.
    rewards = {r['slug'] for relic in features.RELICS['items'] for drops in relic['grades'].values()
               for r in drops if r.get('tradable') and r.get('slug')}
    for slug in sorted(rewards - {x['slug'] for x in server.CATALOG}):
        record(slug, 'orders', f'https://api.warframe.market/v2/orders/item/{slug}', server.summarize_orders, server.CACHE)
    server.atomic_json(ROOT / 'data/market.json', server.CACHE)
    for slug in features.CANDIDATES['slugs']:
        try:
            from urllib.parse import urlencode
            params = urlencode({'type': 'riven', 'weapon_url_name': slug, 're_rolls_min': 0,
                                're_rolls_max': 0, 'sort_by': 'price_asc', 'platform': 'pc'} )
            features.RIVENS[slug] = features.riven_summary(server.market_get('https://api.warframe.market/v1/auctions/search?' + params), slug)
            features.RIVENS[slug]['at'] = server.now()
        except Exception as error:
            features.RIVENS.setdefault(slug, {})['error'] = str(error)[:160]
            failures.append({'slug': slug, 'source': 'riven', 'message': str(error)[:160]})
        server.atomic_json(features.RIVEN_FILE, features.RIVENS)
    status = {'finished': server.now(), 'queries': completed + len(features.CANDIDATES['slugs']), 'failures': failures}
    server.atomic_json(ROOT / 'data/refresh_status.json', status)
    print(json.dumps(status, ensure_ascii=False), flush=True)
    # Do not publish an apparently fresh but wholly failed scheduled refresh.
    if len(failures) >= status['queries']:
        raise SystemExit('All market requests failed; keep the previous deployment')


if __name__ == '__main__':
    refresh()
