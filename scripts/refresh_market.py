#!/usr/bin/env python3
"""Rate-limited public collectors with separate orders, statistics and Riven phases."""

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import os
from pathlib import Path
import sys
import threading
import time
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dashboard import server, features, public_data

ORDERS_INTERVAL = 3600
SLOW_INTERVAL = 6 * 3600


def recent(at, now, interval=SLOW_INTERVAL):
    try:
        age = now - dt.datetime.fromisoformat(at.replace('Z', '+00:00')).timestamp()
        return 0 <= age < interval
    except (ValueError, TypeError, AttributeError):
        return False


def orders_due(market, now):
    return (
        not recent(market.get('orders_at'), now, ORDERS_INTERVAL)
        or bool(market.get('orders_error'))
        or not isinstance(market.get('orders'), dict)
    )


def stats_due(market, now):
    yesterday = str(dt.datetime.fromtimestamp(now, dt.timezone.utc).date() - dt.timedelta(days=1))
    return (
        not recent(market.get('stats_at'), now)
        or bool(market.get('stats_error'))
        or not isinstance(market.get('stats', {}).get('history'), list)
        or market.get('stats', {}).get('end') != yesterday
    )


def refresh(mode='orders', due=False):
    status = public_data.read('refresh_status.json', {})
    sources = status.setdefault('sources', {})
    changed = False
    for phase in ('orders', 'stats', 'rivens') if mode == 'full' else (mode,):
        started = server.now()
        clock = time.time()
        failures = []
        completed = 0
        write_lock = threading.Lock()
        queries = []
        extra = {}

        def record(slug, url, summarize, cache):
            nonlocal completed
            try:
                value = summarize(server.market_get(url))
                with write_lock:
                    if phase == 'rivens':
                        value['at'] = server.now()
                        cache[slug] = value
                    else:
                        cache.setdefault(slug, {})[phase] = value
                        cache[slug][phase + '_at'] = server.now()
                        cache[slug].pop(phase + '_error', None)
            except Exception as error:
                with write_lock:
                    cache.setdefault(slug, {})[
                        'error' if phase == 'rivens' else phase + '_error'
                    ] = str(error)[:160]
                    failures.append({'slug': slug, 'source': phase, 'message': str(error)[:160]})
            with write_lock:
                completed += 1
                if completed % 25 == 0:
                    print(
                        f'{phase}: {completed}/{len(queries)} queries; {len(failures)} failures',
                        flush=True,
                    )
                    server.atomic_json(
                        features.RIVEN_FILE if phase == 'rivens' else server.CACHE_FILE, cache
                    )

        if phase == 'rivens':
            previous = sources.get(phase, {})
            if due and recent(previous.get('finished'), clock) and not previous.get('failures'):
                print('rivens: cached batch is less than 6 hours old; skipped', flush=True)
                continue
            weapons = sorted(features.WEAPON_INDEX)
            if not weapons:
                continue
            batch = int(clock // SLOW_INTERVAL) % math.ceil(len(weapons) / 20)
            scanned = weapons[batch * 20 : (batch + 1) * 20]
            candidates = sorted(
                [k for k in weapons if features.RIVENS.get(k, {}).get('reference') is not None],
                key=lambda k: features.RIVENS[k]['reference'],
                reverse=True,
            )[:30]
            slugs = sorted(set(candidates + features.CANDIDATES['slugs'][:10] + scanned))
            for slug in slugs:
                params = urlencode(
                    {
                        'type': 'riven',
                        'weapon_url_name': slug,
                        're_rolls_min': 0,
                        're_rolls_max': 0,
                        'sort_by': 'price_asc',
                        'platform': 'pc',
                    }
                )
                queries.append(
                    (
                        slug,
                        'https://api.warframe.market/v1/auctions/search?' + params,
                        lambda raw, slug=slug: features.riven_summary(raw, slug),
                        features.RIVENS,
                    )
                )
            extra = {'riven_batch': scanned, 'riven_candidates': candidates}
        else:
            for item in server.CATALOG:
                if not (
                    item.get('baro')
                    or item['kind'] == 'frame'
                    or 'prime' in item.get('tags', [])
                    and (item.get('ducats') or 0) > 0
                ):
                    continue
                slug = item['slug']
                if phase == 'orders' and due and not orders_due(server.CACHE.get(slug, {}), clock):
                    continue
                if phase == 'stats' and due and not stats_due(server.CACHE.get(slug, {}), clock):
                    continue
                url = (
                    f'https://api.warframe.market/v2/orders/item/{slug}'
                    if phase == 'orders'
                    else f'https://api.warframe.market/v1/items/{slug}/statistics'
                )
                queries.append(
                    (
                        slug,
                        url,
                        server.summarize_orders if phase == 'orders' else server.summarize_stats,
                        server.CACHE,
                    )
                )
        if not queries:
            print(f'{phase}: no queries due; skipped', flush=True)
            continue
        print(f'{phase}: starting {len(queries)} queries', flush=True)
        # Phases run separately so ordinary quotes can be published before slow data.
        # Existing global limits remain unchanged, including auction search limits.
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=1 if phase == 'rivens' else 6
        ) as pool:
            list(pool.map(lambda args: record(*args), queries))
        if len(failures) == len(queries):
            raise SystemExit(f'All {phase} requests failed; keep the previous deployment')
        server.atomic_json(
            features.RIVEN_FILE if phase == 'rivens' else server.CACHE_FILE,
            features.RIVENS if phase == 'rivens' else server.CACHE,
        )
        finished = server.now()
        sources[phase] = {
            'started': started,
            'finished': finished,
            'queries': completed,
            'failures': failures,
            **extra,
        }
        # Keep the legacy field tied to orders, never to a later Riven publication.
        if phase == 'orders':
            status['finished'] = finished
        status['queries'] = sum(x.get('queries', 0) for x in sources.values())
        status['failures'] = [f for x in sources.values() for f in x.get('failures', [])]
        status['covered_weapons'] = sum(bool(v.get('at')) for v in features.RIVENS.values())
        server.atomic_json(ROOT / 'data/refresh_status.json', status)
        print(json.dumps({'phase': phase, **sources[phase]}, ensure_ascii=False), flush=True)
        changed = True
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('orders', 'stats', 'rivens', 'full'), default='orders')
    parser.add_argument(
        '--due',
        action='store_true',
        help='Only query missing, failed or expired data (orders: 1 hour; slow data: 6 hours)',
    )
    args = parser.parse_args()
    changed = refresh(args.mode, args.due)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'updated={str(changed).lower()}\n')


if __name__ == '__main__':
    main()
