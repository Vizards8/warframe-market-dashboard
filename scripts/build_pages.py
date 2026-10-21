#!/usr/bin/env python3
"""Build an allowlisted public static site without loading private inventory."""
import argparse
import copy
import hashlib
import datetime as dt
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import features
import public_data


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def build(output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'data').mkdir(exist_ok=True)
    catalog = json.loads((ROOT / 'data/catalog.json').read_text())
    for item in catalog:
        item['fallback_image'] = features.IMAGE_SOURCES.get(item['slug'])
    cache = json.loads((ROOT / 'data/market.json').read_text())
    idle = {'running': False, 'done': 0, 'total': 0, 'errors': [], 'current': ''}
    state = {'catalog': catalog, 'market': cache, 'initial_settings': {'version': 2, 'items': {}},
             'job': copy.deepcopy(idle), 'riven_job': copy.deepcopy(idle), 'compare_job': copy.deepcopy(idle),
             'weapons': features.WEAPONS, 'rivens': features.RIVENS,
             **public_data.public_state(), 'server_time': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')}
    known = sorted([x for x in state['weapons'] if state['rivens'].get(x['slug'], {}).get('reference') is not None], key=lambda x: state['rivens'][x['slug']]['reference'], reverse=True)[:30]
    candidates = {x['slug'] for x in known}
    for x in state['weapons']:
        x['candidate'] = x['slug'] in candidates
    write_json(output / 'data/state.json', state)
    write_json(output / 'data/items.json', features.ITEMS)
    write_json(output / 'data/relics.json', features.RELICS)
    write_json(output / 'data/history.json', state['history'])
    html = (ROOT / 'static/index.html').read_text()
    html = html.replace('<script src="/portable.js"></script>', '')
    html = html.replace('<script src="/stats.js"></script>', '<script src="/hosted.js"></script>\n<script src="/stats.js"></script>')
    for name in ('style.css', 'hosted.js', 'stats.js', 'desk-core.js', 'app.js', 'extras.js', 'inventory.js', 'desk.js'):
        content = (ROOT / 'static' / name).read_bytes()
        asset = Path(name)
        versioned = asset.stem + '.' + hashlib.sha256(content).hexdigest()[:12] + asset.suffix
        html = html.replace('"/' + name + '"', '"./' + versioned + '"')
        (output / versioned).write_bytes(content)
    html = html.replace('href="/"', 'href="./"')
    (output / 'index.html').write_text(html)
    (output / '.nojekyll').touch()
    return state


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--output', default=str(ROOT / '_site'))
    args = p.parse_args()
    public_data.prepare_release(json.loads((ROOT / 'data/catalog.json').read_text()))
    state = build(args.output)
    print(f"Built public site: {len(state['catalog'])} catalog items; no personal inventory")
