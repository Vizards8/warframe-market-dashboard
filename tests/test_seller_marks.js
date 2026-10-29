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
const control = { dataset: { sellerMark: 'seller-a' }, value: '' };
const context = vm.createContext({
  settings,
  window: { getSelection: () => ({ toString: () => selection }) },
  document: {
    querySelectorAll: selector => (selector === '[data-seller-row]' ? [row] : [control])
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
for (const expected of ['contacted', 'bought', 'offline', 'skip', '']) {
  click();
  assert.equal(status(), expected);
}
assert.equal(saved, 5);
assert.equal(rendered, 5);
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
assert.equal(saved, 5);

// Direct selection and row clicks share one mark; clearing leaves no hidden state.
control.value = 'offline';
control.onchange();
assert.equal(status(), 'offline');
assert.ok(Number.isFinite(Date.parse(settings.ducatSellerMarks['seller-a'].at)));
click();
assert.equal(status(), 'skip');
control.value = '';
control.onchange();
assert.equal(status(), '');

// Keyboard activation keeps focus and prevents scrolling; nested controls stay native.
let prevented = 0;
const key = (extra = {}) =>
  row.onkeydown({ target: row, key: ' ', preventDefault: () => prevented++, ...extra });
key();
assert.equal(status(), 'contacted');
assert.equal(row.focused, true);
key({ repeat: true });
key({ target: control });
assert.equal(status(), 'contacted');
key({ key: 'Enter' });
assert.equal(status(), 'bought');
assert.equal(prevented, 3);
console.log(
  'Seller marks: full cycle, persistence, seller isolation, direct selection, interactive/selection guards and keyboard focus passed'
);
