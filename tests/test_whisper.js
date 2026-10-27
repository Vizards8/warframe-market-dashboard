'use strict';
const assert = require('node:assert/strict');
const core = require('../static/js/core/desk-core.js');
const now = Date.parse('2026-10-28T02:00:00Z');
const at = '2026-10-28T01:30:00Z';
const mod = { slug: 'galvanized_shot', english: 'Galvanized Shot', kind: 'mod' };
const set = { slug: 'orthos_prime_set', english: 'Orthos Prime Set', kind: 'component' };
const offer = {
  seller: 'seller-id',
  name: 'AmdGTS',
  slug: 'different-profile-slug',
  price: 7,
  quantity: 6
};
const purchase = { item: mod, offer, quantity: 1, at };

// Single items use the supplied WFM template exactly, with the in-game name.
assert.equal(
  core.purchaseWhisper([purchase], now),
  '/w AmdGTS Hi! I want to buy: "Galvanized Shot (rank 0)" for 7 platinum. (warframe.market)'
);
assert.equal(
  core.purchaseWhisper([{ ...purchase, item: set }], now),
  '/w AmdGTS Hi! I want to buy: "Orthos Prime Set" for 7 platinum. (warframe.market)'
);
assert.equal(
  core.purchaseWhisper([{ ...purchase, quantity: 6 }], now),
  '/w AmdGTS Hi! I want to buy: 6 x "Galvanized Shot (rank 0)" for 42 platinum. (warframe.market)'
);
const second = { ...purchase, item: set, quantity: 2, offer: { ...offer, price: 12 } };
const combo = core.purchaseWhisper([purchase, second], now);
assert.equal(
  combo,
  '/w AmdGTS Hi! I want to buy: "Galvanized Shot (rank 0)" (7 platinum each), 2 x "Orthos Prime Set" (12 platinum each) for 31 platinum total. (warframe.market)'
);
assert.equal((combo.match(/\/w /g) || []).length, 1);
assert.equal(combo.includes('\n'), false);

// Never create an incomplete basket or fall back to a web profile handle.
for (const change of [
  { at: '2026-10-27T01:00:00Z' },
  { at: '2026-10-29T01:00:00Z' },
  { error: 'network' },
  { quantity: 7 },
  { quantity: 0 },
  { quantity: 1.5 },
  { item: { ...mod, english: '' } },
  { item: { ...mod, english: 'Name\n/w other' } },
  { offer: { ...offer, name: '' } },
  { offer: { ...offer, name: 'Name\n/w other' } },
  { offer: { ...offer, price: 0 } },
  { offer: { ...offer, rank: 10 } }
])
  assert.equal(core.purchaseWhisper([{ ...purchase, ...change }], now), null);
assert.equal(
  core.purchaseWhisper([purchase, { ...second, offer: { ...offer, seller: 'another' } }], now),
  null
);
assert.equal(core.purchaseWhisper([purchase, purchase], now), null);
assert.equal(core.purchaseWhisper([purchase, { ...second, error: 'network' }], now), null);
assert.equal(core.purchaseWhisper([], now), null);
console.log(
  'Purchase whispers: exact WFM template, ranks, quantities, basket totals, in-game names and expired quotes passed'
);

// Exercise the actual page helpers: a rendered button must resolve the same
// seller/price/quantity and stop working when that snapshot changes.
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('static/js/app.js', 'utf8');
const market = { orders_at: at, orders: { sell_offers: [offer] } };
const state = { catalog: [mod, set], market: { [mod.slug]: market, [set.slug]: market } };
const writes = [];
const area = {
  value: '',
  select() {
    this.selected = true;
  }
};
const dialog = {
  querySelector(selector) {
    return selector === 'textarea' ? area : {};
  },
  showModal() {
    this.open = true;
  }
};
const context = vm.createContext({
  state,
  DeskCore: {
    ...core,
    purchaseWhisper: rows => core.purchaseWhisper(rows, now),
    fresh: (a, e) => core.fresh(a, e, now)
  },
  mrow: slug => state.market[slug] || {},
  esc: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
  navigator: { clipboard: { writeText: async value => writes.push(value) } },
  $: () => dialog,
  number: String
});
vm.runInContext(
  app.slice(app.indexOf('function wfmTradeButton('), app.indexOf('async function request(')),
  context
);
const html = vm.runInContext(
  'wfmTradeButton(state.catalog[0], state.market.galvanized_shot.orders.sell_offers[0], 6)',
  context
);
const selection = JSON.parse(
  html
    .match(/data-copy-trade="([^"]+)"/)[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
);
context.selection = selection;
assert.equal(
  vm.runInContext('resolveTradeMessage(selection)', context),
  core.purchaseWhisper([{ ...purchase, quantity: 6 }], now)
);
market.orders_at = '2026-10-28T01:31:00Z';
assert.equal(vm.runInContext('resolveTradeMessage(selection)', context), null);
market.orders_at = at;
market.orders.sell_offers = [{ ...offer, price: 8 }];
assert.equal(vm.runInContext('resolveTradeMessage(selection)', context), null);
market.orders.sell_offers = [offer];

(async () => {
  assert.equal(await vm.runInContext('copyTradeText("/w test Hi!")', context), true);
  assert.deepEqual(writes, ['/w test Hi!']);
  context.navigator.clipboard.writeText = async () => {
    throw new Error('denied');
  };
  assert.equal(await vm.runInContext('copyTradeText("/w test fallback")', context), false);
  assert.equal(area.value, '/w test fallback');
  assert.equal(area.selected, true);
  assert.equal(dialog.open, true);
  console.log(
    'Purchase copy UI: selected quantity, changed snapshot/price, clipboard success and manual fallback passed'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
