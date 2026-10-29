'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');

let saved = 0,
  rendered = 0,
  selection = '';
const settings = { ducatSellerMarks: { other: { status: 'bought', at: 'kept' } } };
const row = {
  dataset: { sellerRow: 'seller-a' },
  focus() {
    this.focused = true;
  }
};
const control = {};
const context = vm.createContext({
  settings,
  window: { getSelection: () => ({ toString: () => selection }) },
  document: {
    querySelectorAll: selector => {
      assert.equal(selector, '[data-seller-row]');
      return [row];
    }
  },
  queueSave: () => saved++,
  activate: () => rendered++,
  $: () => null
});
const source = fs.readFileSync('static/js/pages/desk.js', 'utf8');
vm.runInContext(
  source.slice(
    source.indexOf('  const sellerMarkLabels ='),
    source.indexOf('  function orderTime(')
  ),
  context
);
vm.runInContext('bindSellerMarks()', context);
const click = (extra = {}) => row.onclick({ target: { closest: () => null }, ...extra });
const status = () => settings.ducatSellerMarks['seller-a']?.status || '';

// A full cycle persists each state and clears the mark when returning to white.
for (const expected of ['contacted', 'bought', 'skip', '']) {
  click();
  assert.equal(status(), expected);
}
assert.equal(saved, 4);
assert.equal(rendered, 4);
assert.deepEqual(settings.ducatSellerMarks.other, { status: 'bought', at: 'kept' });

// Links, copy buttons, selects, text selection and modified clicks must not mark a seller.
for (const interactive of ['a', 'button', 'select', 'label']) {
  click({
    target: {
      closest: selector => {
        assert.ok(selector.includes(interactive));
        return {};
      }
    }
  });
}
for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'defaultPrevented'])
  click({ [key]: true });
selection = 'selected item name';
click();
selection = '';
assert.equal(saved, 4);

// Old offline and skip marks both render as the merged gray state, then clear on click.
for (const legacy of ['offline', 'skip']) {
  settings.ducatSellerMarks['seller-a'] = { status: legacy, at: 'kept' };
  assert.equal(vm.runInContext("sellerMarkStatus('seller-a')", context), 'skip');
  const text = vm.runInContext("sellerMarkText('seller-a')", context);
  assert.ok(text.includes('不在线，不再问'));
  assert.ok(!text.includes('<select'));
  click();
  assert.equal(status(), '');
}

// Keyboard activation keeps focus and prevents scrolling; nested controls stay native.
let prevented = 0;
const key = (extra = {}) =>
  row.onkeydown({ target: row, key: ' ', preventDefault: () => prevented++, ...extra });
key();
assert.equal(status(), 'contacted');
assert.ok(Number.isFinite(Date.parse(settings.ducatSellerMarks['seller-a'].at)));
assert.equal(row.focused, true);
key({ repeat: true });
key({ target: control });
assert.equal(status(), 'contacted');
key({ key: 'Enter' });
assert.equal(status(), 'bought');
assert.equal(prevented, 3);
console.log(
  'Seller marks: four-state cycle, legacy mark compatibility, seller isolation, interactive/selection guards and keyboard focus passed'
);
