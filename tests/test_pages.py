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
            self.assertEqual(set(p.name for p in (out / 'data').iterdir()), {'state.json', 'items.json', 'relics.json'})
            self.assertFalse((out / 'data/initial_holdings.json').exists())
            html = (out / 'index.html').read_text()
            self.assertNotIn('src="/', html)
            self.assertNotIn('href="/', html)
            self.assertIn('./hosted.js', html)
            self.assertNotIn('portable.js', html)
            self.assertEqual(len(json.loads((out / 'data/state.json').read_text())['catalog']), 143)


if __name__ == '__main__':
    unittest.main()
