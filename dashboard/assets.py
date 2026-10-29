"""Shared frontend entrypoints for the local server, Pages and HTML snapshots."""

from pathlib import Path

STATIC = Path(__file__).resolve().parents[1] / 'static'
STYLESHEET = 'css/style.css'
HOSTED = 'js/adapters/hosted.js'
PORTABLE = 'js/adapters/portable.js'
STATS = 'js/core/stats.js'
# Classic scripts share globals, so their dependency order is intentional.
SCRIPTS = (
    STATS,
    'js/core/desk-core.js',
    'js/app.js',
    'js/pages/frames.js',
    'js/ocr/reward-ocr-core.js',
    'js/ocr/reward-ocr-assets.js',
    'js/ocr/reward-ocr.js',
    'js/pages/extras.js',
    PORTABLE,
    'js/pages/inventory.js',
    'js/pages/quick-market.js',
    'js/pages/desk.js',
    'js/pages/welcome.js',
)


def scripts(hosted=False):
    return (HOSTED,) + tuple(p for p in SCRIPTS if p != PORTABLE) if hosted else SCRIPTS


def render_html(hosted=False):
    template = (STATIC / 'index.html').read_text(encoding='utf-8')
    return template.replace(
        '<!-- dashboard:styles -->', f'<link rel="stylesheet" href="/{STYLESHEET}">'
    ).replace(
        '<!-- dashboard:scripts -->',
        '\n'.join(f'<script src="/{path}"></script>' for path in scripts(hosted)),
    )


def local_files():
    """Explicit routes; do not expose arbitrary files under the repository."""
    return {'/' + path: STATIC / path for path in (STYLESHEET, *SCRIPTS)}
