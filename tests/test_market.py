import copy
import datetime as dt
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import features
import server


class MarketTests(unittest.TestCase):
    def offer(self, price, owner_id, **changes):
        out = {'platform': 'pc', 'visible': True, 'closed': False, 'private': False,
               'is_direct_sell': True, 'buyout_price': price, 'id': 'offer-' + str(price),
               'updated': dt.datetime.now(dt.timezone.utc).isoformat(),
               'owner': {'id': owner_id, 'status': 'offline'},
               'item': {'weapon_url_name': 'magistar', 're_rolls': 0, 'mod_rank': 8}}
        out.update(changes)
        return out

    def test_riven_zero_roll_is_not_zero_rank_and_sellers_are_distinct(self):
        offers = [self.offer(100, 'a'), self.offer(101, 'a'), self.offer(200, 'b'), self.offer(300, 'c')]
        result = features.riven_summary({'payload': {'auctions': offers}}, 'magistar')
        self.assertEqual(result['floor'], 100)
        self.assertEqual(result['reference'], 200)
        self.assertEqual(result['sellers'], 3)
        self.assertEqual(result['offers'][0]['rank'], 8)
        self.assertIsNone(result['online_floor'])

    def test_riven_excludes_wrong_weapon_rolls_old_private_bid_only_and_closed(self):
        good = self.offer(500, 'good', owner={'id': 'good', 'status': 'ingame'})
        wrong_roll = self.offer(1, 'roll'); wrong_roll['item']['re_rolls'] = 1
        wrong_weapon = self.offer(2, 'weapon'); wrong_weapon['item']['weapon_url_name'] = 'torid'
        old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=31)).isoformat()
        bad = [wrong_roll, wrong_weapon, self.offer(3, 'old', updated=old),
               self.offer(4, 'private', private=True), self.offer(5, 'bid', is_direct_sell=False),
               self.offer(6, 'closed', closed=True), self.offer(7, 'hidden', visible=False)]
        result = features.riven_summary({'payload': {'auctions': bad + [good]}}, 'magistar')
        self.assertEqual(result['floor'], 500)
        self.assertEqual(result['online_floor'], 500)
        self.assertEqual(result['reference_n'], 1)
        self.assertEqual(result['sellers'], 1)

    def test_no_riven_quote_stays_unknown_not_zero(self):
        result = features.riven_summary({'payload': {'auctions': []}}, 'torid')
        self.assertIsNone(result['floor'])
        self.assertIsNone(result['reference'])

    def test_every_relic_has_six_rewards_and_valid_probability_mass(self):
        for relic in features.RELICS['items']:
            for grade, rewards in relic['grades'].items():
                self.assertEqual(len(rewards), 6, (relic['id'], grade))
                self.assertAlmostEqual(sum(x['chance'] for x in rewards), 100, delta=.02)
                for reward in rewards:
                    if reward['tradable']:
                        self.assertIn(reward['slug'], features.ALL_INDEX)
                    else:
                        self.assertIn('Forma Blueprint', reward['name'])

    def test_online_r0_quote_filter(self):
        def order(price, rank=0, status='ingame', visible=True):
            return {'type': 'sell', 'platinum': price, 'quantity': 1, 'rank': rank,
                    'visible': visible, 'user': {'status': status}}
        result = server.summarize_orders({'data': [order(1, 8), order(2, status='offline'),
                                                   order(3, visible=False), order(40)]})
        self.assertEqual(result['sell'], [{'price': 40, 'quantity': 1}])
        self.assertEqual(result['buy'], [])


if __name__ == '__main__':
    unittest.main()
