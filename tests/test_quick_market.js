'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', hidden: false, after() {} });
  return nodes.get(id);
};
let requests = 0,
  fail = true;
const all = [
  { slug: 'a', name: '甲部件', english: 'Alpha Prime', kind: 'component' },
  { slug: 'b', name: '乙卡', english: 'Beta', kind: 'mod' },
  { slug: 'c', name: '丙部件', english: 'Gamma', kind: 'component' },
  {
    slug: 'd',
    name: '集团武器',
    english: 'Delta',
    kind: 'component',
    tags: ['weapon', 'syndicate']
  }
];
const context = {
  window: {},
  tab: 'quick-market',
  $: id => nodes.get(id) || null,
  state: { catalog: [{ ...all[0], alias: '别名' }] },
  document: {
    createElement: () => {
      node('quick-market-section');
      return {
        set innerHTML(v) {
          for (const id of v.matchAll(/id="([^"]+)"/g)) node(id[1]);
        }
      };
    }
  },
  request: async () => {
    requests++;
    if (fail) throw Error('network');
    return all;
  },
  mrow: slug => (slug === 'c' ? {} : { orders_at: 'collected', stats_at: 'stats', slug }),
  statsFor: m => ({
    price: m.slug === 'a' ? 20 : m.slug === 'b' ? 10 : null,
    volume: m.slug === 'a' ? 40 : 15
  }),
  ask: m => (m.slug === 'a' ? 4 : m.slug === 'b' ? 2 : null),
  bid: () => null,
  DeskCore: { fresh: () => true, statsFresh: () => true },
  esc: String,
  number: x => (x == null ? '—' : String(x)),
  itemImage: () => '',
  timeLabel: String,
  notify() {}
};
node('market-section');
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/pages/quick-market.js', 'utf8'), context);
(async () => {
  await context.window.QuickMarket.activate();
  assert.match(node('quick-market-count').textContent, /读取失败/);
  fail = false;
  await context.window.QuickMarket.activate();
  assert.equal(requests, 2); // Retry failed directory fetch, cache success.
  assert.match(node('quick-market-count').textContent, /4 种匹配 · 3 种有已采集行情/);
  assert.match(node('quick-market-rows').innerHTML, /尚未|无成交价格/);
  node('quick-market-search').oninput({ target: { value: 'bEtA' } });
  assert.match(node('quick-market-rows').innerHTML, /乙卡/);
  assert.doesNotMatch(node('quick-market-rows').innerHTML, /甲部件/);
  node('quick-market-search').oninput({ target: { value: '别名' } });
  assert.match(node('quick-market-rows').innerHTML, /甲部件/);
  node('quick-market-search').oninput({ target: { value: '' } });
  node('quick-market-sort').onchange({ target: { value: 'price' } });
  const html = node('quick-market-rows').innerHTML;
  assert.ok(html.indexOf('乙卡') < html.indexOf('甲部件'));
  assert.ok(html.indexOf('丙部件') > html.indexOf('甲部件')); // No price stays last.
  node('quick-market-kind').onchange({ target: { value: 'mod' } });
  assert.match(node('quick-market-count').textContent, /1 种匹配/);
  node('quick-market-kind').onchange({ target: { value: 'weapon' } });
  assert.match(node('quick-market-rows').innerHTML, /集团武器/);
  assert.doesNotMatch(node('quick-market-rows').innerHTML, /丙部件/);
  assert.equal(context.window.QuickMarket.item('c').name, '丙部件');
  context.tab = 'relics';
  await context.window.QuickMarket.activate();
  assert.equal(node('quick-market-section').hidden, true);
  context.tab = 'quick-market';
  await context.window.QuickMarket.activate();
  assert.equal(requests, 2);
  console.log(
    'Quick market: retry, cached directory, Chinese/English/alias search, prices, missing data and tab lifecycle passed'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
