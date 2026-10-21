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
            state = build_pages.build(tmp)
            out = Path(tmp)
            self.assertEqual(state['initial_settings']['items'], {})
            self.assertEqual(set(p.name for p in (out / 'data').iterdir()), {'state.json', 'items.json', 'relics.json', 'history.json'})
            self.assertFalse((out / 'data/initial_holdings.json').exists())
            html = (out / 'index.html').read_text()
            self.assertNotIn('src="/', html)
            self.assertNotIn('href="/', html)
            self.assertRegex(html, r'\./hosted\.[0-9a-f]{12}\.js')
            self.assertNotIn('portable.js', html)
            from html.parser import HTMLParser
            from urllib.parse import unquote
            class BookmarkParser(HTMLParser):
                href = None
                def handle_starttag(self, tag, attrs):
                    fields = dict(attrs)
                    if tag == 'a' and fields.get('class') == 'bookmark':
                        self.href = fields['href']
            installer = (out / 'wfm-bookmark.html').read_text()
            parser = BookmarkParser()
            parser.feed(installer)
            self.assertTrue(parser.href.startswith('javascript:void '))
            self.assertEqual(unquote(parser.href[len('javascript:void '):]), (ROOT / 'static/wfm-bookmark.js').read_text())
            self.assertNotIn('__BOOKMARKLET__', installer)
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
