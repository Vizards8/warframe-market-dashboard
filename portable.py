"""Self-contained editable snapshots; no third-party proxy or local API required."""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MARKER = '__VOID_LEDGER_SNAPSHOT__'


def json_script(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def build(state, items, relics):
    shell = (ROOT / 'static/index.html').read_text()
    shell = shell.replace('<link rel="stylesheet" href="/style.css">', '<style>' + (ROOT / 'static/style.css').read_text() + '</style>')
    boot = '''<script type="application/json" id="portable-data">''' + MARKER + '''</script><script>
(()=>{const p=JSON.parse(document.getElementById('portable-data').textContent);window.Portable={...p,async request(path,body){if(body!==undefined)throw new Error('便携快照不支持刷新；请使用本地服务版，或打开 WFM 查询。');if(path==='/api/state')return structuredClone(p.state);if(path==='/api/items')return p.items;if(path==='/api/relics')return p.relics;throw new Error('快照中没有该数据');}};})();
</script>'''
    shell = shell.replace('<script src="/stats.js"></script>', boot + '<script src="/stats.js"></script>')
    for name in ('stats.js', 'desk-core.js', 'app.js', 'extras.js', 'portable.js', 'inventory.js', 'desk.js'):
        script = (ROOT / 'static' / name).read_text().replace('</script', '<\\/script')
        shell = shell.replace('<script src="/' + name + '"></script>', '<script>' + script + '</script>')
    snapshot = copy.deepcopy(state)
    snapshot['initial_settings'] = {'version': 2, 'items': {}}
    for key in ('job', 'riven_job', 'compare_job'):
        snapshot[key] = {'running': False, 'done': 0, 'total': 0, 'errors': [], 'current': ''}
    payload = {'id': uuid.uuid4().hex, 'exported': state['server_time'], 'state': snapshot, 'items': items, 'relics': relics, 'shell': shell}
    return shell.replace(MARKER, json_script(payload), 1)
