import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import portable

class PortableTests(unittest.TestCase):
    def test_self_contained_share_does_not_embed_holdings_and_scripts_are_safe(self):
        state={'server_time':'2026-10-21T00:00:00Z','initial_settings':{'items':{'private':{'quantity':9000}}},'market':{'name':'</script><script>bad()</script>'},'job':{'running':True}}
        html=portable.build(state,[],{'items':[]})
        payload=html.split('<script type="application/json" id="portable-data">',1)[1].split('</script>',1)[0]
        data=json.loads(payload)
        self.assertEqual(data['state']['initial_settings']['items'],{})
        self.assertFalse(data['state']['job']['running'])
        self.assertNotIn('private',html)
        self.assertNotIn('<script>bad()',html)
        self.assertNotIn('src="/app.js"',html)
        self.assertNotIn('href="/style.css"',html)
        self.assertIn(portable.MARKER,data['shell'])
        self.assertEqual(state['initial_settings']['items']['private']['quantity'],9000)
if __name__=='__main__':unittest.main()
