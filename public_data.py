"""Public-only release metadata, Baro snapshot and durable daily market history."""
import datetime as dt
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
SITE = 'https://vizards8.github.io/warframe-market-dashboard/'
BARO_URL = 'https://api.warframestat.us/pc/voidTrader?language=en'


def read(name, default):
    p = ROOT / 'data' / name
    return json.loads(p.read_text()) if p.exists() else default


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def fetch(url):
    r = subprocess.run(['curl', '-sS', '--max-time', '18', '-w', '\n%{http_code}', url], capture_output=True, text=True, timeout=21)
    body, _, status = r.stdout.rpartition('\n')
    if r.returncode or status != '200':
        raise RuntimeError('HTTP ' + status if status else '连接失败')
    return json.loads(body)


def normalize_baro(raw, catalog, at):
    if not isinstance(raw, dict) or not raw.get('activation') or not raw.get('expiry') or not isinstance(raw.get('inventory'), list):
        raise ValueError('货单结构无法验证')
    # Exact English names only; fuzzy matches can confuse Prime and ordinary mods.
    names = {x['english'].lower(): x['slug'] for x in catalog}
    names.update({x['name'].lower(): x['slug'] for x in catalog})
    inventory = []
    for x in raw['inventory']:
        name = str(x.get('item', ''))
        d, c = x.get('ducats'), x.get('credits')
        if not name or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in (d, c)):
            continue
        inventory.append({'name': name, 'slug': names.get(name.lower()), 'ducats': d, 'credits': c})
    dt.datetime.fromisoformat(raw['activation'].replace('Z', '+00:00'))
    dt.datetime.fromisoformat(raw['expiry'].replace('Z', '+00:00'))
    return {'at': at, 'source': BARO_URL, 'activation': raw['activation'], 'expiry': raw['expiry'],
            'location': str(raw.get('location', '')), 'inventory': inventory}


def refresh_baro(catalog):
    previous = read('baro_current.json', {})
    try:
        value = normalize_baro(fetch(BARO_URL), catalog, now())
    except Exception as error:
        value = {**previous, 'source': BARO_URL, 'error': str(error)[:160], 'attempted_at': now()}
    (ROOT / 'data/baro_current.json').write_text(json.dumps(value, ensure_ascii=False))
    return value


def merge_history(catalog, market, previous):
    out = {'source': 'WFM marked closed trades; daily weighted averages', 'updated_at': now(), 'items': {}, 'stats_at': {}}
    allowed = {x['slug'] for x in catalog}
    cutoff = str(dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=730))
    for slug in allowed:
        days = {}
        old_rows = previous.get('items', {}).get(slug, [])
        new_rows = market.get(slug, {}).get('stats', {}).get('history', [])
        old_at = previous.get('stats_at', {}).get(slug, '')
        new_at = market.get(slug, {}).get('stats_at', '')
        # A quick code deployment can contain an older seed cache than the live site.
        # Preserve later corrections instead of overwriting them with that seed.
        rows = new_rows + old_rows if old_at and old_at > new_at else old_rows + new_rows
        for row in rows:
            try:
                date = str(dt.date.fromisoformat(row['date']))
                p, v = row['price'], row['volume']
                if date < cutoff or date >= str(dt.datetime.now(dt.timezone.utc).date()):
                    continue
                if any(isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or n < 0 for n in (p, v)):
                    continue
                days[date] = {'date': date, 'price': p, 'volume': v}
            except (KeyError, TypeError, ValueError):
                continue
        if days:
            out['items'][slug] = [days[k] for k in sorted(days)]
            out['stats_at'][slug] = max(old_at, new_at)
    return out


def prepare_release(catalog):
    """Carry history from the previous public deployment; never use private files."""
    previous = read('history.json', {'items': {}})
    remote = {}
    try:
        remote = fetch(SITE + 'data/history.json')
        if not isinstance(remote.get('items'), dict):
            raise ValueError('已发布历史结构不正确')
        remote_market = {slug: {'stats': {'history': rows}, 'stats_at': remote.get('stats_at', {}).get(slug, '')}
                         for slug, rows in remote['items'].items()}
        previous = merge_history(catalog, remote_market, previous)
    except RuntimeError as error:
        # A first deployment has no history yet. Other errors must not truncate it.
        if str(error) != 'HTTP 404':
            raise RuntimeError('无法保留已发布历史，停止发布：' + str(error))
    history = merge_history(catalog, read('market.json', {}), previous)
    history['refresh_status'] = read('refresh_status.json', remote.get('refresh_status', {}))
    (ROOT / 'data/history.json').write_text(json.dumps(history, ensure_ascii=False, separators=(',', ':')))
    refresh_baro(catalog)


def public_state():
    history = read('history.json', {'items': {}})
    return {'baro': read('baro_current.json', {}), 'refresh_status': read('refresh_status.json', history.get('refresh_status', {})),
            'prime_sets': read('prime_sets.json', {}).get('sets', []),
            'history': history}
