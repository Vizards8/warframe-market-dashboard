import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_pages', ROOT / 'scripts/build_pages.py')
build_pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_pages)


class PagesTests(unittest.TestCase):
    def test_public_build_does_not_read_private_files_or_ship_them(self):
        original = Path.read_text
        def guarded(path, *args, **kwargs):
            if path.name in ('initial_holdings.json', 'settings.json'):
                raise AssertionError('public build tried to read private inventory')
            return original(path, *args, **kwargs)
        with tempfile.TemporaryDirectory() as tmp, patch.object(Path, 'read_text', guarded):
            out = Path(tmp)
            (out / 'wfm-bookmark.html').write_text('retired installer')
            state = build_pages.build(tmp)
            self.assertEqual(state['initial_settings']['items'], {})
            self.assertEqual(set(p.name for p in (out / 'data').iterdir()), {'state.json', 'items.json', 'relics.json', 'history.json'})
            self.assertFalse((out / 'data/initial_holdings.json').exists())
            html = (out / 'index.html').read_text()
            self.assertNotIn('src="/', html)
            self.assertNotIn('href="/', html)
            self.assertRegex(html, r'\./hosted\.[0-9a-f]{12}\.js')
            self.assertNotIn('portable.js', html)
            self.assertFalse((out / 'wfm-bookmark.html').exists())
            self.assertRegex(html, r'\./reward-ocr\.[0-9a-f]{12}\.js')
            for asset in json.loads((ROOT / 'static/ocr/v5/manifest.json').read_text()):
                import hashlib
                content = (out / 'ocr/v5' / asset['file']).read_bytes()
                self.assertEqual(hashlib.sha256(content).hexdigest(), asset['sha256'])
            self.assertNotIn('wfm-open', html)
            self.assertNotIn('welcome-wfm', html)
            self.assertIn('查看交易账本', html)
            import re
            for asset in re.findall(r'(?:src|href)="\./([^"]+\.(?:js|css))"', html):
                self.assertTrue((out / asset).exists(), asset)
            self.assertGreater(len(state['catalog']), 700)
            self.assertEqual(len(state['prime_sets']), 51)
            self.assertRegex(html, r'\./desk\.[0-9a-f]{12}\.js')
            self.assertRegex(html, r'\./desk-core\.[0-9a-f]{12}\.js')
            self.assertTrue(all(p['slug'] in {x['slug'] for x in state['catalog']} for r in state['prime_sets'] for p in r['parts']))


if __name__ == '__main__':
    unittest.main()
