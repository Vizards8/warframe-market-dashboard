"""Public-only release metadata, Baro snapshot and durable daily market history."""
import datetime as dt
import copy
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
SITE = 'https://vizards8.github.io/warframe-market-dashboard/'
BARO_URL = 'https://api.warframestat.us/pc/voidTrader?language=en'
WORLDSTATE_URL = 'https://api.warframe.com/cdn/worldState.php'


def read(name, default):
    p = ROOT / 'data' / name
    return json.loads(p.read_text()) if p.exists() else default


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def market_snapshot():
    # CI restores a scheduled cache before a code deployment. Preserve explicitly
    # checked public quotes if that cache predates the trader's arrival.
    market = copy.deepcopy(read('market.json', {}))
    for slug, quote in read('baro_quotes.json', {}).items():
        for source in ('orders', 'stats'):
            at = quote.get(source + '_at')
            current = market.get(slug, {}).get(source + '_at')
            if at and source in quote and (not current or dt.datetime.fromisoformat(at.replace('Z', '+00:00')) > dt.datetime.fromisoformat(current.replace('Z', '+00:00'))):
                target = market.setdefault(slug, {})
                target.update({source: quote[source], source + '_at': at})
                target.pop(source + '_error', None)
    return market


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
    aliases = {k.lower(): v for k, v in read('baro_item_names.json', {}).get('aliases', {}).items()}
    inventory = []
    for x in raw['inventory']:
        name = str(x.get('item', ''))
        name = aliases.get(name.lower(), name)
        d, c = x.get('ducats'), x.get('credits')
        if not name or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in (d, c)):
            continue
        inventory.append({'name': name, 'slug': names.get(name.lower()), 'ducats': d, 'credits': c})
    dt.datetime.fromisoformat(raw['activation'].replace('Z', '+00:00'))
    dt.datetime.fromisoformat(raw['expiry'].replace('Z', '+00:00'))
    return {'at': at, 'source': BARO_URL, 'activation': raw['activation'], 'expiry': raw['expiry'],
            'location': str(raw.get('location', '')), 'inventory': inventory}


def normalize_worldstate(raw, catalog, at):
    """Read DE's public HTTP world state, never the game process or local files."""
    checked = dt.datetime.fromisoformat(at.replace('Z', '+00:00'))
    stamp = raw.get('Time')
    if isinstance(stamp, bool) or not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
        raise ValueError('官方世界状态缺少时间')
    generated = dt.datetime.fromtimestamp(stamp, dt.timezone.utc)
    if not 0 <= (checked - generated).total_seconds() < 6 * 3600:
        raise ValueError('官方世界状态已过期或时间异常')
    def date(value):
        millis = int(value['$date']['$numberLong'])
        return dt.datetime.fromtimestamp(millis / 1000, dt.timezone.utc)
    traders = []
    for trader in raw.get('VoidTraders', []):
        start, end = date(trader['Activation']), date(trader['Expiry'])
        if end <= start:
            raise ValueError('官方货单起止时间异常')
        traders.append((start, end, trader))
    if not traders:
        raise ValueError('官方世界状态没有奸商记录')
    active = [t for t in traders if t[0] <= checked < t[1]]
    upcoming = [t for t in traders if t[0] > checked]
    start, end, trader = (max(active, key=lambda t: t[0]) if active else
                          min(upcoming, key=lambda t: t[0]) if upcoming else max(traders, key=lambda t: t[1]))
    manifest = trader.get('Manifest', [])
    if not isinstance(manifest, list) or start <= checked < end and not manifest:
        raise ValueError('官方在售货单为空')
    item_names = read('baro_item_names.json', {}).get('items', {})
    inventory = []
    for item in manifest:
        path = item['ItemType']
        if not isinstance(path, str) or not path.startswith('/Lotus/StoreItems/'):
            raise ValueError('官方物品路径异常')
        key = path.replace('/Lotus/StoreItems/', '/Lotus/', 1)
        d, c = item.get('PrimePrice'), item.get('RegularPrice')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in (d, c)):
            raise ValueError('官方兑换成本异常')
        inventory.append({'item': item_names.get(key, key.rsplit('/', 1)[-1]), 'ducats': d, 'credits': c})
    locations = {'EarthHUB': '地球 · Strata 中继站', 'MercuryHUB': '水星 · Larunda 中继站',
                 'SaturnHUB': '土星 · Kronia 中继站', 'PlutoHUB': '冥王星 · Orcus 中继站'}
    result = normalize_baro({'activation': start.isoformat(), 'expiry': end.isoformat(),
                             'location': locations.get(trader.get('Node'), trader.get('Node', '')),
                             'inventory': inventory}, catalog, at)
    result.update(source=WORLDSTATE_URL, generated_at=generated.isoformat(),
                  character=trader.get('Character', ''), total_items=len(manifest))
    return result


def refresh_baro(catalog):
    previous = read('baro_current.json', {})
    errors = []
    try:
        value = normalize_worldstate(fetch(WORLDSTATE_URL), catalog, now())
    except Exception as official_error:
        errors.append(str(official_error))
        try:
            value = normalize_baro(fetch(BARO_URL), catalog, now())
            value['source_errors'] = errors
        except Exception as error:
            errors.append(str(error))
            value = {**previous, 'error': ' / '.join(errors)[:160], 'attempted_at': now()}
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
    history = merge_history(catalog, market_snapshot(), previous)
    history['refresh_status'] = read('refresh_status.json', remote.get('refresh_status', {}))
    (ROOT / 'data/history.json').write_text(json.dumps(history, ensure_ascii=False, separators=(',', ':')))
    refresh_baro(catalog)


def public_state():
    history = read('history.json', {'items': {}})
    return {'baro': read('baro_current.json', {}), 'refresh_status': read('refresh_status.json', history.get('refresh_status', {})),
            'prime_sets': read('prime_sets.json', {}).get('sets', []),
            'history': history}
