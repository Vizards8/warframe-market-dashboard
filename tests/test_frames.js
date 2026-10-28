'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
global.MarketStats = require('../static/js/core/stats.js');
const core = require('../static/js/core/desk-core.js');
const now = Date.parse('2026-10-28T02:00:00Z');
const history = Array.from({ length: 90 }, (_, i) => ({
  date: new Date(Date.parse('2026-07-30T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
  price: i >= 83 ? 150 : 100,
  volume: 30
}));
const market = {
  stats_at: '2026-10-28T01:30:00Z',
  stats: { end: '2026-10-27', history },
  orders_at: '2026-10-28T01:30:00Z',
  orders: { sell: [{ price: 160 }], buy: [{ price: 120 }] }
};
const q = core.frameSignal(market, now);
assert.equal(q.week.price, 150);
assert.equal(q.previous.price, 100);
assert.equal(q.week.change, 50);
assert.equal(q.peak, 150);
assert.equal(q.rising, true);
assert.equal(q.high, true);
assert.equal(q.rank, 3);
assert.equal(core.frameSignal({ ...market, stats_at: '2026-10-27T20:00:00Z' }, now).rank, 3);
const old = core.frameSignal({ ...market, stats_at: '2026-10-27T01:30:00Z' }, now);
assert.equal(old.rank, -1);
assert.equal(old.rising, false);
assert.equal(old.high, false);
assert.equal(core.frameSignal({ ...market, stats_error: '429' }, now).rank, -1);
assert.equal(core.frameSignal({}, now).rank, -1);
assert.equal(
  core.frameSignal({ ...market, stats: { end: '2026-10-20', history } }, now).reliable,
  false
);
assert.equal(
  core.frameSignal({ ...market, stats_at: '2026-10-29T01:30:00Z' }, now).reliable,
  false
);
const sparse = {
  ...market,
  stats: { ...market.stats, history: history.map(x => ({ ...x, volume: 1 })) }
};
assert.equal(core.frameSignal(sparse, now).rank, -1);
const short = core.frameSignal(
  { ...market, stats: { ...market.stats, history: history.slice(-14) } },
  now
);
assert.equal(short.rising, true);
assert.equal(short.peak, null);
assert.equal(short.high, false);
const falling = core.frameSignal(
  {
    ...market,
    stats: {
      ...market.stats,
      history: history.map((x, i) => ({ ...x, price: i >= 83 ? 95 : 100 }))
    }
  },
  now
);
assert.equal(falling.rising, false);
assert.equal(falling.high, true); // A high price is not evidence that it is rising.
const outlier = core.frameSignal(
  {
    ...market,
    stats: {
      ...market.stats,
      history: history.map((x, i) => ({
        ...x,
        price: i === 89 ? 1000 : 100,
        volume: i === 89 ? 1 : 100
      }))
    }
  },
  now
);
assert.equal(outlier.rising, false); // A tiny trade must not dominate the weighted weekly mean.
assert.equal(
  core.frameSignal({ ...market, stats: { ...market.stats, history: history.slice(-7) } }, now)
    .rising,
  false
);

const nodes = new Map();
function node(id) {
  if (!nodes.has(id))
    nodes.set(id, {
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      classList: { toggle() {} },
      setAttribute() {},
      closest() {
        return node(id + '-label');
      }
    });
  return nodes.get(id);
}
const items = [
  { slug: 'test_prime_set', name: 'Test Prime', kind: 'frame' },
  { slug: 'other_prime_set', name: 'Other Prime', kind: 'frame' }
];
const settings = { targetBasis: 'sell', items: { test_prime_set: { quantity: 1, target: 140 } } };
const srow = slug => settings.items[slug] || { quantity: 0, target: null };
const context = vm.createContext({
  window: {},
  tab: 'frames',
  filter: 'all',
  sort: 'default',
  Date: class extends Date {
    static now() {
      return now;
    }
  },
  $: node,
  document: { querySelectorAll: () => [] },
  settings,
  state: { catalog: items },
  DeskCore: core,
  MarketStats,
  esc: String,
  number: x => (x == null ? '—' : String(x)),
  price: x => String(x),
  mrow: () => market,
  srow,
  held: x => srow(x.slug).quantity > 0,
  watched: x => srow(x.slug).quantity > 0,
  targetQuote: m => core.target(m, settings.targetBasis, now),
  targetHit: (s, m) =>
    s.target > 0 &&
    core.target(m, settings.targetBasis, now).valid &&
    core.target(m, settings.targetBasis, now).value >= s.target,
  statsDays: () => 30,
  itemImage: () => '',
  timeLabel: String,
  ask: m => m.orders.sell[0].price,
  bid: m => m.orders.buy[0].price
});
vm.runInContext(fs.readFileSync('static/js/pages/frames.js', 'utf8'), context);
context.window.Frames.controls();
assert.equal(node('type-filter').innerHTML.includes('武器'), false);
assert.equal(node('type-filter').innerHTML.includes('MOD'), false);
assert.equal(node('type-filter').innerHTML.includes('只看持有'), true);
assert.equal(node('stats-window-label').hidden, true);
assert.equal(context.window.Frames.matches(items[1], 'held'), false);
assert.equal(context.window.Frames.matches(items[0], 'rising'), true);
assert.equal(context.window.Frames.matches(items[0], 'target'), true);
context.window.Frames.table(items);
assert.equal((node('rows').innerHTML.match(/data-target=/g) || []).length, 2); // Even unwatched frames can set targets.
assert.match(node('rows').innerHTML, /在线最低卖价 160p/);
assert.match(context.window.Frames.targetCell(items[0]), /已达目标/);
settings.targetBasis = 'buy';
assert.match(context.window.Frames.targetCell(items[0]), /在线最高买价 120p/);
assert.match(context.window.Frames.targetCell(items[0]), /距目标 20p/);
assert.equal(context.window.Frames.matches(items[0], 'target'), false);
settings.targetBasis = 'mean30';
assert.match(context.window.Frames.targetCell(items[0]), /30 天成交均价/);
context.tab = 'inventory';
context.window.Frames.controls();
assert.equal(node('type-filter').innerHTML.includes('武器'), true);
assert.equal(node('stats-window-label').hidden, false);

// Exercise the real basis change handler, including the missed drawer refresh.
let saved = 0,
  drawn = 0;
context.persist = () => saved++;
context.selected = 'test_prime_set';
context.renderDrawer = () => drawn++;
const desk = fs.readFileSync('static/js/pages/desk.js', 'utf8');
vm.runInContext(
  'handler = e => {' +
    desk.split("$('target-basis').onchange = e => {")[1].split('\n    };')[0] +
    '\n}',
  context
);
context.handler({ target: { value: 'buy' } });
assert.equal(settings.targetBasis, 'buy');
assert.equal(saved, 1);
assert.equal(drawn, 1);
node('drawer').hidden = true;
context.handler({ target: { value: 'sell' } });
assert.equal(drawn, 1);
console.log(
  'Prime frames: weighted trends, sample/freshness gates, high versus rising, scoped controls and immediate target/drawer updates passed'
);
