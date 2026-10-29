#!/usr/bin/env python3
"""Local Warframe market dashboard. Python standard library + system curl only."""

import argparse
import copy
import datetime as dt
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from . import assets, features, portable, public_data
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
PORT = 18765
BASE = f'http://127.0.0.1:{PORT}'
LOCK = threading.RLock()
CATALOG = json.loads((DATA / 'catalog.json').read_text())
for item in CATALOG:
    item['fallback_image'] = features.IMAGE_SOURCES.get(item['slug'])
INDEX = {**features.ALL_INDEX, **{x['slug']: x for x in CATALOG}}
INITIAL_SETTINGS = (
    json.loads((DATA / 'initial_holdings.json').read_text())
    if (DATA / 'initial_holdings.json').exists()
    else {'version': 2, 'items': {}}
)
CACHE_FILE = DATA / 'market.json'
CACHE = public_data.market_snapshot()
JOB = {
    'running': False,
    'done': 0,
    'total': 0,
    'errors': [],
    'current': '',
    'started': None,
}


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def atomic_json(path, data):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    tmp.replace(path)


def aggregate(days):
    volume = sum(x['volume'] for x in days)
    return {
        'price': round(sum(x['price'] * x['volume'] for x in days) / volume, 2) if volume else None,
        'volume': volume,
        'days': len(days),
    }


def summarize_stats(raw):
    rows = raw['payload']['statistics_closed']['90days']
    today = dt.datetime.now(dt.timezone.utc).date()
    history = []
    for x in rows:
        date = dt.date.fromisoformat(x['datetime'][:10])
        if x.get('mod_rank', 0) != 0 or date >= today:
            continue
        history.append({'date': str(date), 'price': x['wa_price'], 'volume': x['volume']})
    history.sort(key=lambda x: x['date'])
    # Actual calendar days, so an inactive item cannot look like a liquid one.
    start = today - dt.timedelta(days=7)
    previous = start - dt.timedelta(days=7)
    recent = aggregate([x for x in history if str(start) <= x['date'] < str(today)])
    prior = aggregate([x for x in history if str(previous) <= x['date'] < str(start)])
    change = (
        (recent['price'] / prior['price'] - 1) * 100
        if recent['price'] is not None and prior['price']
        else None
    )
    return {
        'history': history,
        'recent': recent,
        'prior': prior,
        'change': change,
        'start': str(start),
        'end': str(today - dt.timedelta(days=1)),
        'latest': history[-1]['date'] if history else None,
    }


def summarize_orders(raw):
    rows = [
        x
        for x in raw['data']
        if x.get('visible')
        and x.get('user', {}).get('status') in ('online', 'ingame')
        and x.get('rank', 0) == 0
    ]
    out = {}
    for side in ('sell', 'buy'):
        selected = sorted(
            [x for x in rows if x['type'] == side],
            key=lambda x: x['platinum'],
            reverse=(side == 'buy'),
        )
        out[side] = [{'price': x['platinum'], 'quantity': x['quantity']} for x in selected[:10]]
        out[side + '_count'] = len(selected)
    # Keep the display depth bounded, but retain enough identified sellers for
    # single-counterparty bulk purchases. Anonymous legacy depth is not proof
    # that six items can be bought in one trade.
    sellers = {}
    for row in rows:
        user = row.get('user', {})
        seller = user.get('id')
        if row.get('type') != 'sell' or not seller or row.get('perTrade', 1) != 1:
            continue
        if row.get('quantity', 0) <= 0 or row.get('platinum', 0) <= 0:
            continue
        offer = {
            'price': row['platinum'],
            'quantity': row['quantity'],
            'seller': seller,
            'name': user.get('ingameName', ''),
            'slug': user.get('slug', ''),
            'status': user.get('status'),
            'order': row.get('id', ''),
            'createdAt': row.get('createdAt'),
            'updatedAt': row.get('updatedAt'),
        }
        # One seller must not be counted twice for duplicate orders.
        if seller not in sellers or offer['price'] < sellers[seller]['price']:
            sellers[seller] = offer
    out['sell_offers'] = sorted(sellers.values(), key=lambda x: (x['price'], -x['quantity']))[:200]
    out['offer_schema'] = 1
    return out


LAST_REQUEST = 0.0
LAST_AUCTION_REQUEST = 0.0
REQUEST_RATE_LOCK = threading.Lock()
REQUEST_SLOTS = threading.Semaphore(6)


def market_get(url):
    global LAST_REQUEST, LAST_AUCTION_REQUEST
    for attempt in range(3):
        with REQUEST_SLOTS:
            with REQUEST_RATE_LOCK:
                # Keep searches below ten per minute and share the item API budget.
                auction = '/auctions/' in url
                delay = 0.6 - (time.monotonic() - LAST_REQUEST)
                if auction:
                    delay = max(delay, 6.1 - (time.monotonic() - LAST_AUCTION_REQUEST))
                time.sleep(max(0, delay))
                LAST_REQUEST = time.monotonic()
                if auction:
                    LAST_AUCTION_REQUEST = LAST_REQUEST
            response = subprocess.run(
                [
                    'curl',
                    '-sS',
                    '--max-time',
                    '18',
                    '-w',
                    '\n%{http_code}',
                    '-H',
                    'Platform: pc',
                    '-H',
                    'Crossplay: true',
                    '-H',
                    'Language: en',
                    '-A',
                    'VoidLedger/0.3 (+https://github.com/Vizards8/warframe-market-dashboard)',
                    url,
                ],
                capture_output=True,
                text=True,
                timeout=21,
            )
        if response.returncode:
            if attempt < 2:
                time.sleep(1)
                continue
            raise RuntimeError('行情服务暂时无法连接')
        body, _, status = response.stdout.rpartition('\n')
        if status in ('429', '502', '503', '504') and attempt < 2:
            time.sleep(8 + attempt * 6 if status == '429' else 2 + attempt * 2)
            continue
        if status != '200':
            raise RuntimeError('行情服务 HTTP ' + status)
        return json.loads(body)
    raise RuntimeError('请求失败')


def refresh(slugs):
    try:
        for slug in slugs:
            with LOCK:
                JOB['current'] = INDEX[slug]['name']
            for source, url, summarize in [
                (
                    'orders',
                    f'https://api.warframe.market/v2/orders/item/{slug}',
                    summarize_orders,
                ),
                (
                    'stats',
                    f'https://api.warframe.market/v1/items/{slug}/statistics',
                    summarize_stats,
                ),
            ]:
                with LOCK:
                    JOB['current'] = INDEX[slug]['name'] + (
                        ' · 在线挂单' if source == 'orders' else ' · 成交记录'
                    )
                try:
                    result = summarize(market_get(url))
                    with LOCK:
                        CACHE.setdefault(slug, {})[source] = result
                        CACHE[slug][source + '_at'] = now()
                        CACHE[slug].pop(source + '_error', None)
                except Exception as error:
                    with LOCK:
                        message = str(error)[:160]
                        CACHE.setdefault(slug, {})[source + '_error'] = message
                        JOB['errors'].append({'slug': slug, 'source': source, 'message': message})
                finally:
                    with LOCK:
                        JOB['done'] += 1
            with LOCK:
                JOB['completed_items'] += 1
                atomic_json(CACHE_FILE, CACHE)
    finally:
        with LOCK:
            JOB['running'] = False
            JOB['finished'] = now()
            JOB['current'] = ''


def validated_settings(raw):
    if (
        not isinstance(raw, dict)
        or raw.get('version') != 1
        or not isinstance(raw.get('items'), dict)
    ):
        raise ValueError('备份格式不正确')
    out = {'version': 1, 'items': {}}
    for slug, value in raw['items'].items():
        if slug not in INDEX or not isinstance(value, dict):
            raise ValueError('包含未知商品')
        row = {}
        q = value.get('quantity', 0)
        if (
            isinstance(q, bool)
            or not isinstance(q, (int, float))
            or not math.isfinite(q)
            or int(q) != q
            or not 0 <= q <= 100000
        ):
            raise ValueError('数量必须是 0–100000 的整数')
        row['quantity'] = int(q)
        for key in ('target', 'cost'):
            v = value.get(key)
            if v is not None and (
                isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1000000
            ):
                raise ValueError('价格必须是有效的非负数')
            row[key] = v
        row['watch'] = bool(value.get('watch', False))
        row['note'] = str(value.get('note', ''))[:1000]
        date = value.get('baro_date')
        if date:
            dt.date.fromisoformat(date)
            row['baro_date'] = date
        out['items'][slug] = row
    return out


features.configure(
    get=market_get, lock=LOCK, cache=CACHE, save=atomic_json, orders=summarize_orders
)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def respond(self, body, status=200, content_type='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        self.wfile.write(body)

    def trusted(self):
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        return host in (f'127.0.0.1:{PORT}', f'localhost:{PORT}') and (
            not origin or origin in (BASE, f'http://localhost:{PORT}')
        )

    def do_GET(self):
        if not self.trusted():
            return self.respond({'error': '只接受本机页面请求'}, 403)
        path = urlparse(self.path).path
        if path == '/api/ping':
            return self.respond(
                {'app': 'warframe-market-dashboard', 'version': 3, 'pid': os.getpid()}
            )
        if path in ('/api/state', '/portable.html'):
            with LOCK:
                state = copy.deepcopy(
                    {
                        'catalog': CATALOG,
                        'market': CACHE,
                        'initial_settings': INITIAL_SETTINGS,
                        'job': JOB,
                        'riven_job': features.RIVEN_JOB,
                        'compare_job': features.COMPARE_JOB,
                        **public_data.public_state(),
                        'weapons': features.WEAPONS,
                        'rivens': features.RIVENS,
                        'server_time': now(),
                    }
                )
            if path == '/portable.html':
                return self.respond(
                    portable.build(state, features.ITEMS, features.RELICS).encode(),
                    content_type='text/html; charset=utf-8',
                )
            return self.respond(state)
        if path == '/api/items':
            return self.respond(features.ITEMS)
        if path == '/api/relics':
            return self.respond(features.RELICS)
        if path == '/':
            return self.respond(
                assets.render_html().encode('utf-8'),
                content_type='text/html; charset=utf-8',
            )
        files = assets.local_files()
        if path.startswith('/ocr/'):
            # Serve only checked-in OCR assets, with no path traversal or directory listing.
            ocr_assets = ROOT / 'static/ocr'
            known = {
                '/ocr/' + p.relative_to(ocr_assets).as_posix(): p
                for p in ocr_assets.rglob('*')
                if p.is_file()
            }
            file = known.get(path)
            if file:
                mime = (
                    'text/javascript'
                    if file.suffix == '.js'
                    else 'application/gzip'
                    if file.suffix == '.gz'
                    else 'text/plain; charset=utf-8'
                )
                return self.respond(file.read_bytes(), content_type=mime)
        if path in files:
            file = files[path]
            mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}[file.suffix]
            return self.respond(file.read_bytes(), content_type=mime + '; charset=utf-8')
        return self.respond({'error': '页面不存在'}, 404)

    def do_POST(self):
        if not self.trusted():
            return self.respond({'error': '只接受本机页面请求'}, 403)
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size < 250000:
                raise ValueError('请求大小不正确')
            body = json.loads(self.rfile.read(size))
            if self.path == '/api/settings':
                return self.respond({'error': '库存已改为浏览器自动记住，无需上传保存'}, 410)
            if self.path in ('/api/rivens/refresh', '/api/compare'):
                result, status = features.start_job(
                    'rivens' if self.path == '/api/rivens/refresh' else 'compare', body
                )
                return self.respond(result, status)
            if self.path == '/api/refresh':
                if not isinstance(body, dict) or not isinstance(body.get('slugs'), list):
                    raise ValueError('商品列表不正确')
                if any(not isinstance(s, str) for s in body['slugs']):
                    raise ValueError('商品名称格式不正确')
                slugs = list(dict.fromkeys(body['slugs']))
                if not slugs or any(s not in INDEX for s in slugs):
                    raise ValueError('商品列表不正确')
                with LOCK:
                    if JOB['running']:
                        return self.respond({'error': '已有刷新任务进行中'}, 409)
                    JOB.update(
                        running=True,
                        done=0,
                        total=len(slugs) * 2,
                        item_count=len(slugs),
                        completed_items=0,
                        errors=[],
                        current='',
                        started=now(),
                        finished=None,
                    )
                    threading.Thread(target=refresh, args=(slugs,), daemon=True).start()
                return self.respond({'ok': True}, 202)
            return self.respond({'error': '接口不存在'}, 404)
        except (ValueError, TypeError, KeyError) as error:
            return self.respond({'error': str(error)}, 400)


def launch(view='/'):
    try:
        with urllib.request.urlopen(BASE + '/api/ping', timeout=1) as result:
            if json.load(result).get('app') != 'warframe-market-dashboard':
                raise RuntimeError('端口已被其他程序占用')
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        with (DATA / 'server.log').open('a') as log:
            subprocess.Popen(
                [
                    sys.executable,
                    str(ROOT / 'server.py'),
                    '--serve',
                    '--port',
                    str(PORT),
                ],
                cwd=ROOT,
                stdout=log,
                stderr=log,
                start_new_session=True,
                stdin=subprocess.DEVNULL,
            )
        for _ in range(40):
            try:
                with urllib.request.urlopen(BASE + '/api/ping', timeout=0.5) as result:
                    if json.load(result).get('app') == 'warframe-market-dashboard':
                        break
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                time.sleep(0.15)
        else:
            raise RuntimeError('启动失败，请查看 data/server.log')
    webbrowser.open(BASE + view)
    print('行情页已打开：' + BASE + '。可以关闭此终端窗口。')


def main():
    global PORT, BASE
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    PORT = args.port or 18765
    BASE = f'http://127.0.0.1:{PORT}'
    if args.serve:
        print('Warframe dashboard listening on ' + BASE, flush=True)
        ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
    else:
        launch()
