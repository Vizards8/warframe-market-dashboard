"""Riven quotes and fast fissure reward comparisons; public market data only."""
import datetime as dt
import json
from pathlib import Path
import statistics
import threading
from urllib.parse import urlencode
import uuid

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
ASSET = 'https://warframe.market/static/assets/'
IMAGE_SOURCES = json.loads((DATA / 'image_sources.json').read_text())['images']
ALIASES = {'vauban': '工程师', 'limbo': '小明', 'nekros': '摸尸', 'chroma': '龙甲',
           'oberon': '奶爸', 'hydroid': '水男', 'citrine': '晶甲', 'nidus': '蛆甲',
           'khora': '猫甲', 'garuda': '血妈', 'octavia': 'DJ', 'frost': '冰男',
           'wukong': '悟空', 'saryn': '毒妈', 'volt': '电男', 'wisp': '花甲'}


def slim_item(x):
    loc = x['i18n'].get('zh-hans', x['i18n']['en'])
    thumb, icon = loc.get('thumb', ''), loc.get('icon', '')
    tags = x.get('tags', [])
    return {'slug': x['slug'], 'name': loc['name'], 'english': x['i18n']['en']['name'],
            'image': ASSET + thumb if thumb else None, 'icon': ASSET + icon if icon else None,
            'fallback_image': IMAGE_SOURCES.get(x['slug']),
            'kind': 'frame' if 'set' in tags and 'warframe' in tags else 'mod' if 'mod' in tags else 'component',
            'tags': tags, 'ducats': x.get('ducats'),
            'alias': next((v for k, v in ALIASES.items() if x['slug'].startswith(k + '_prime')), '')}


ITEMS = [slim_item(x) for x in json.loads((DATA / 'items.json').read_text())['data']]
ALL_INDEX = {x['slug']: x for x in ITEMS}
RELICS = json.loads((DATA / 'relics.json').read_text())
CANDIDATES = json.loads((DATA / 'riven_candidates.json').read_text())
WEAPONS = []
for x in json.loads((DATA / 'riven_weapons.json').read_text())['data']:
    row = slim_item(x)
    row.update(category=x.get('rivenType', x['group']), kind='riven', candidate=x['slug'] in CANDIDATES['slugs'])
    WEAPONS.append(row)
WEAPON_INDEX = {x['slug']: x for x in WEAPONS}
RIVEN_FILE = DATA / 'riven_market.json'
RIVENS = json.loads(RIVEN_FILE.read_text()) if RIVEN_FILE.exists() else {}
RIVEN_JOB = {'running': False, 'done': 0, 'total': 0, 'errors': [], 'current': ''}
COMPARE_JOB = {'running': False, 'done': 0, 'total': 0, 'errors': [], 'current': ''}
CONTEXT = {}


def configure(**kwargs):
    CONTEXT.update(kwargs)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def riven_summary(raw, slug):
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=30)
    valid = []
    for x in raw['payload']['auctions']:
        item = x.get('item', {})
        if (x.get('platform') != 'pc' or not x.get('visible') or x.get('closed') or x.get('private')
            or not x.get('is_direct_sell') or not isinstance(x.get('buyout_price'), (int, float))
            or x['buyout_price'] <= 0 or item.get('re_rolls') != 0 or item.get('weapon_url_name') != slug):
            continue
        try:
            updated = dt.datetime.fromisoformat(x['updated'].replace('Z', '+00:00'))
            if updated < cutoff:
                continue
        except (ValueError, KeyError):
            continue
        valid.append(x)
    unique = {}
    for x in sorted(valid, key=lambda x: x['buyout_price']):
        unique.setdefault(x['owner']['id'], x)
    rows = list(unique.values())
    online = [x for x in rows if x['owner'].get('status') in ('online', 'ingame')]
    low = [x['buyout_price'] for x in rows[:3]]
    return {'floor': rows[0]['buyout_price'] if rows else None,
            'online_floor': min((x['buyout_price'] for x in online), default=None),
            'reference': statistics.median(low) if low else None, 'reference_n': len(low),
            'sellers': len(rows), 'online_sellers': len(online), 'returned': len(raw['payload']['auctions']),
            'offers': [{'id': x['id'], 'price': x['buyout_price'], 'status': x['owner'].get('status'),
                        'rank': x['item'].get('mod_rank'), 'updated': x['updated'],
                        'attributes': x['item'].get('attributes', [])} for x in rows[:5]]}


def riven_worker(slugs):
    lock = CONTEXT['lock']
    try:
        for slug in slugs:
            with lock:
                RIVEN_JOB['current'] = WEAPON_INDEX[slug]['name']
            try:
                query = urlencode({'type': 'riven', 'weapon_url_name': slug, 're_rolls_min': 0,
                                   're_rolls_max': 0, 'sort_by': 'price_asc', 'platform': 'pc'})
                summary = riven_summary(CONTEXT['get']('https://api.warframe.market/v1/auctions/search?' + query), slug)
                with lock:
                    RIVENS[slug] = {**summary, 'at': now()}
            except Exception as error:
                with lock:
                    RIVENS.setdefault(slug, {})['error'] = str(error)[:160]
                    RIVEN_JOB['errors'].append({'slug': slug, 'message': str(error)[:160]})
            with lock:
                RIVEN_JOB['done'] += 1
                CONTEXT['save'](RIVEN_FILE, RIVENS)
    finally:
        with lock:
            RIVEN_JOB.update(running=False, current='', finished=now())


def compare_worker(slugs, force):
    lock, cache = CONTEXT['lock'], CONTEXT['cache']
    try:
        for slug in slugs:
            with lock:
                COMPARE_JOB['current'] = ALL_INDEX[slug]['name']
                old = cache.get(slug, {}).get('orders_at')
            fresh = old and (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(old)).total_seconds() < 120
            try:
                if force or not fresh:
                    summary = CONTEXT['orders'](CONTEXT['get']('https://api.warframe.market/v2/orders/item/' + slug))
                    with lock:
                        cache.setdefault(slug, {}).update(orders=summary, orders_at=now())
                        cache[slug].pop('orders_error', None)
            except Exception as error:
                with lock:
                    cache.setdefault(slug, {})['orders_error'] = str(error)[:160]
                    COMPARE_JOB['errors'].append({'slug': slug, 'message': str(error)[:160]})
            with lock:
                COMPARE_JOB['done'] += 1
                CONTEXT['save'](DATA / 'market.json', cache)
    finally:
        with lock:
            COMPARE_JOB.update(running=False, current='', finished=now())


def start_job(kind, body):
    if not isinstance(body, dict) or not isinstance(body.get('slugs'), list):
        raise ValueError('商品列表不正确')
    raw = body['slugs']
    if any(not isinstance(x, str) for x in raw):
        raise ValueError('商品名称格式不正确')
    slugs = list(dict.fromkeys(raw))
    index, job, worker, limit = ((WEAPON_INDEX, RIVEN_JOB, riven_worker, len(WEAPONS)) if kind == 'rivens'
                                  else (ALL_INDEX, COMPARE_JOB, compare_worker, 24))
    if not 0 < len(slugs) <= limit or any(s not in index for s in slugs):
        raise ValueError('请选择有效商品')
    with CONTEXT['lock']:
        if job['running']:
            return {'error': '此类查询正在进行，请等待进度完成'}, 409
        job.update(id=uuid.uuid4().hex, running=True, done=0, total=len(slugs), errors=[],
                   current='', started=now(), finished=None, slugs=slugs)
        args = (slugs,) if kind == 'rivens' else (slugs, bool(body.get('force', False)))
        threading.Thread(target=worker, args=args, daemon=True).start()
        return {'ok': True, 'id': job['id']}, 202
