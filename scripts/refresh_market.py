#!/usr/bin/env python3
"""Rate-limited scheduled updates of public prices. Never publishes inventory."""
import concurrent.futures
import threading
import datetime as dt
import json
from pathlib import Path
import sys
import time
import math

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
import features


def refresh():
    failures = []
    completed = 0
    write_lock = threading.Lock()
    def record(slug, source, url, summarize, cache):
        nonlocal completed
        try:
            value = summarize(server.market_get(url))
            with write_lock:
                cache.setdefault(slug, {})[source] = value
                cache[slug][source + '_at'] = server.now()
                cache[slug].pop(source + '_error', None)
        except Exception as error:
            with write_lock:
                cache.setdefault(slug, {})[source + '_error'] = str(error)[:160]
                failures.append({'slug': slug, 'source': source, 'message': str(error)[:160]})
        with write_lock:
            completed += 1
            if completed % 25 == 0:
                print(f'{completed} queries completed; {len(failures)} failures', flush=True)
                server.atomic_json(ROOT / 'data/market.json', server.CACHE)

    # Every item shown in the market/ducat tables needs both sources. The old
    # rewards-only orders pass left every Prime component without trade history.
    primary = [x for x in server.CATALOG if x.get('baro') or x['kind'] == 'frame'
               or 'prime' in x.get('tags', []) and (x.get('ducats') or 0) > 0]
    queries = []
    for item in primary:
        slug = item['slug']
        queries.extend([(slug, 'orders', f'https://api.warframe.market/v2/orders/item/{slug}', server.summarize_orders, server.CACHE),
                        (slug, 'stats', f'https://api.warframe.market/v1/items/{slug}/statistics', server.summarize_stats, server.CACHE)])
    # Requests overlap network latency but share market_get's global .6s limiter.
    # This keeps the expanded component coverage inside the workflow time limit.
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda args: record(*args), queries))
    server.atomic_json(ROOT / 'data/market.json', server.CACHE)
    # Rotate the full weapon pool in bounded batches; keep high-price candidates frequent.
    weapons = sorted(features.WEAPON_INDEX)
    batch = int(time.time() // 21600) % math.ceil(len(weapons) / 20)
    scanned = weapons[batch * 20:(batch + 1) * 20]
    candidates = sorted([k for k in weapons if features.RIVENS.get(k, {}).get('reference') is not None], key=lambda k: features.RIVENS[k]['reference'], reverse=True)[:30]
    riven_slugs = sorted(set(candidates + features.CANDIDATES['slugs'][:10] + scanned))
    for slug in riven_slugs:
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
    status = {'finished': server.now(), 'queries': completed + len(riven_slugs), 'failures': failures, 'riven_batch': scanned, 'riven_candidates': candidates, 'covered_weapons': sum(bool(features.RIVENS.get(k, {}).get('at')) for k in weapons)}
    server.atomic_json(ROOT / 'data/refresh_status.json', status)
    print(json.dumps(status, ensure_ascii=False), flush=True)
    # Do not publish an apparently fresh but wholly failed scheduled refresh.
    if len(failures) >= status['queries']:
        raise SystemExit('All market requests failed; keep the previous deployment')


if __name__ == '__main__':
    refresh()
