'use strict';
const assert = require('node:assert/strict');
global.MarketStats = require('../static/js/core/stats.js');
const core = require('../static/js/core/desk-core.js');
const now = Date.parse('2026-10-28T00:00:00Z');
const at = '2026-10-27T23:00:00Z';
const row = (slug, ducats, price, quantity = 1, extra = {}) => ({
  slug,
  name: slug,
  ducats,
  slots: 1,
  market: {
    orders_at: at,
    orders: {
      sell_offers: [
        { seller: 'same', status: 'ingame', name: 'Same', slug: 'same', price, quantity }
      ]
    }
  },
  ...extra
});

// Several small orders from different sellers cannot become one trade.
assert.deepEqual(
  core.ducatBundles(
    [
      row('a', 45, 3, 3),
      row('b', 15, 1, 1, {
        market: {
          orders_at: at,
          orders: { sell_offers: [{ seller: 'other', status: 'ingame', price: 1, quantity: 1 }] }
        }
      })
    ],
    6,
    150,
    now
  ),
  []
);
const small = row('a', 45, 3, 4);
assert.equal(core.ducatLot(small, small.market, 1, now, 150).units, 4);
small.market.orders.sell_offers[0].createdAt = '2024-01-01T00:00:00Z';
small.market.orders.sell_offers[0].updatedAt = '2026-10-27T18:00:00Z';
const dated = core.ducatBundles([small], 6, 150, now)[0].entries[0];
assert.equal(dated.createdAt, '2024-01-01T00:00:00Z');
assert.equal(dated.updatedAt, '2026-10-27T18:00:00Z');
assert.equal(dated.at, at); // WFM timestamps must not replace our collection time.
assert.equal(core.ducatLot(small, small.market, 1, now, 200), null);
assert.equal(core.ducatLot(row('c', 15, 1), small.market, 1, now, 0).ducats, 60);
const offline = {
  ...small,
  market: {
    ...small.market,
    orders: {
      sell_offers: [{ ...small.market.orders.sell_offers[0], status: 'offline' }]
    }
  }
};
assert.equal(core.ducatLot(offline, offline.market, 1, now, 0), null);
assert.deepEqual(core.ducatBundles([offline], 6, 0, now), []);
assert.deepEqual(core.ducatBundles([], 6, 0, now), []);
assert.deepEqual(core.ducatBundles([small], 7, 0, now), []);
assert.deepEqual(core.ducatBundles([small], 6, -1, now), []);
for (const market of [
  { ...small.market, orders_error: '429' },
  { ...small.market, orders_at: '2026-10-27T00:00:00Z' },
  { ...small.market, orders_at: '2026-10-29T00:00:00Z' },
  { orders_at: at, orders: { sell: [{ price: 1, quantity: 100 }] } }
])
  assert.deepEqual(core.ducatBundles([{ ...small, market }], 6, 0, now), []);

// A set and its own component cannot reuse the same advertised stock.
const set = row('set', 160, 2, 1, {
  slots: 3,
  isSet: true,
  recipe: { parts: [{ slug: 'part' }, { slug: 'x' }, { slug: 'y' }] }
});
const otherSet = row('other-set', 150, 3, 1, {
  slots: 3,
  isSet: true,
  recipe: { parts: [{ slug: 'z' }, { slug: 'v' }, { slug: 'w' }] }
});
const part = row('part', 100, 0.5, 3);
assert.deepEqual(core.ducatBundles([set, part], 6, 400, now), []);
const twoComponents = [set, row('part', 100, 1, 1), row('x', 45, 1, 2)];
const componentBasket = core.ducatBundles(twoComponents, 6, 180, now)[0];
assert.equal(componentBasket.cost, 3);
assert.equal(componentBasket.ducats, 190);
assert.deepEqual(componentBasket.entries.map(e => e.slug).sort(), ['part', 'x']);
// Keep a costlier alternative when the cheap set blocks a later component.
for (const choices of [
  [set, otherSet, part],
  [part, set, otherSet],
  [otherSet, part, set]
]) {
  const best = core.ducatBundles(choices, 6, 400, now)[0];
  assert.equal(best.ducats, 450);
  assert.equal(best.cost, 4.5);
  assert.equal(best.slots, 6);
  assert.deepEqual(best.entries.map(e => e.slug).sort(), ['other-set', 'part']);
  assert.doesNotThrow(() => JSON.stringify(best));
}

// Compare the optimizer with an exhaustive independent search on small inventories.
function overlaps(a, b) {
  const ap = a.recipe?.parts || [],
    bp = b.recipe?.parts || [];
  return (
    ap.some(p => p.slug === b.slug) ||
    bp.some(p => p.slug === a.slug) ||
    ap.some(p => bp.some(q => p.slug === q.slug))
  );
}
function exhaustive(rows, minYield) {
  let best = null;
  const visit = (i, entries, slots, ducats, cost) => {
    if (i === rows.length) {
      if (!ducats || ducats < minYield) return;
      const delta = best ? cost * best.ducats - best.cost * ducats : -1;
      if (!best || delta < 0 || (!delta && ducats > best.ducats)) best = { cost, ducats };
      return;
    }
    const r = rows[i],
      offer = r.market.orders.sell_offers[0];
    visit(i + 1, entries, slots, ducats, cost);
    if (entries.some(e => overlaps(r, e))) return;
    for (let n = 1; n <= offer.quantity && slots + n * r.slots <= 6; n++)
      visit(
        i + 1,
        [...entries, r],
        slots + n * r.slots,
        ducats + n * r.ducats,
        cost + n * offer.price
      );
  };
  visit(0, [], 0, 0, 0);
  return best;
}
for (let seed = 1; seed <= 30; seed++) {
  const choices = [
    set,
    otherSet,
    part,
    row('x', 45, 1, 2),
    row('filler', 45, (seed % 5) + 1, 3)
  ].map((r, i) => ({
    ...r,
    market: {
      orders_at: at,
      orders: {
        sell_offers: [
          {
            seller: 'same',
            status: 'ingame',
            price: ((seed * (i + 3)) % 11) + 1,
            quantity: ((seed + i) % 3) + 1
          }
        ]
      }
    }
  }));
  for (const threshold of [0, 150, 200, 400, 600]) {
    const expected = exhaustive(choices, threshold),
      actual = core.ducatBundles(choices, 6, threshold, now)[0];
    assert.equal(
      actual?.ducats ?? null,
      expected?.ducats ?? null,
      `seed=${seed}, min=${threshold}`
    );
    assert.equal(actual?.cost ?? null, expected?.cost ?? null, `seed=${seed}, min=${threshold}`);
  }
}
console.log(
  'Ducat bundles: seller isolation, stale quotes, stock conflicts, slot caps and exhaustive optimization passed'
);
