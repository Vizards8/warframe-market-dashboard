#!/usr/bin/env python3
"""Build an allowlisted public static site without loading private inventory."""

import argparse
import copy
import hashlib
import datetime as dt
import json
from pathlib import Path
import sys
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dashboard import assets, features
from dashboard import public_data


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


def _build(output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'data').mkdir(exist_ok=True)
    catalog = json.loads((ROOT / 'data/catalog.json').read_text())
    for item in catalog:
        item['fallback_image'] = features.IMAGE_SOURCES.get(item['slug'])
    # Keep the initial document small.  Detailed Ducat seller offers and the
    # long quote history are fetched only when that page is opened.
    cache = public_data.market_snapshot(include_ducat=False)
    ducat_cache = public_data.ducat_snapshot()
    idle = {'running': False, 'done': 0, 'total': 0, 'errors': [], 'current': ''}
    state = {
        'catalog': catalog,
        'market': cache,
        'initial_settings': {'version': 2, 'items': {}},
        'job': copy.deepcopy(idle),
        'riven_job': copy.deepcopy(idle),
        'compare_job': copy.deepcopy(idle),
        'weapons': features.WEAPONS,
        'rivens': features.RIVENS,
        **public_data.public_state(),
        'server_time': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
    }
    known = sorted(
        [
            x
            for x in state['weapons']
            if state['rivens'].get(x['slug'], {}).get('reference') is not None
        ],
        key=lambda x: state['rivens'][x['slug']]['reference'],
        reverse=True,
    )[:30]
    candidates = {x['slug'] for x in known}
    for x in state['weapons']:
        x['candidate'] = x['slug'] in candidates
    write_json(output / 'data/state.json', state)
    write_json(output / 'data/ducat-market.json', ducat_cache)
    write_json(output / 'data/items.json', features.ITEMS)
    write_json(output / 'data/relics.json', features.RELICS)
    write_json(output / 'data/history.json', state['history'])
    html = assets.render_html(hosted=True)
    for name in (assets.STYLESHEET, *assets.scripts(hosted=True)):
        content = (ROOT / 'static' / name).read_bytes()
        asset = Path(name)
        versioned = asset.stem + '.' + hashlib.sha256(content).hexdigest()[:12] + asset.suffix
        html = html.replace('"/' + name + '"', '"./' + versioned + '"')
        (output / versioned).write_bytes(content)
    html = html.replace('href="/"', 'href="./"')
    (output / 'index.html').write_text(html)
    ocr_root = ROOT / 'static/ocr'
    ocr_out = output / 'ocr/v5'
    ocr_out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ocr_root / 'v5/manifest.json').read_text())
    for name in [x['file'] for x in manifest] + ['manifest.json']:
        if Path(name).name != name:
            raise ValueError('invalid OCR asset name')
        shutil.copyfile(ocr_root / 'v5' / name, ocr_out / name)
    shutil.copyfile(ocr_root / 'NOTICE.md', output / 'ocr/NOTICE.md')
    (output / '.nojekyll').touch()
    return state


def build(output):
    """Replace a previous site only after the complete new build succeeds."""
    output = Path(output)
    if output.is_symlink():
        raise ValueError('Build output must not be a symlink')
    output = output.resolve()
    if (
        output == ROOT
        or output in ROOT.parents
        or (ROOT in output.parents and output != ROOT / '_site')
    ):
        raise ValueError('Use _site or an output directory outside the source repository')
    if output.exists() and any(output.iterdir()):
        index = output / 'index.html'
        if (
            not (output / '.nojekyll').is_file()
            or not index.is_file()
            or '虚空账本' not in index.read_text(encoding='utf-8')
        ):
            raise ValueError('Refusing to replace a directory that is not a dashboard build')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.void-build-', dir=output.parent) as tmp:
        stage = Path(tmp) / 'new'
        state = _build(stage)
        previous = Path(tmp) / 'previous'
        if output.exists():
            output.rename(previous)
        try:
            stage.rename(output)
        except OSError:
            if previous.exists():
                previous.rename(output)
            raise
    return state


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--output', default=str(ROOT / '_site'))
    args = p.parse_args()
    public_data.prepare_release(json.loads((ROOT / 'data/catalog.json').read_text()))
    state = build(args.output)
    print(f'Built public site: {len(state["catalog"])} catalog items; no personal inventory')
