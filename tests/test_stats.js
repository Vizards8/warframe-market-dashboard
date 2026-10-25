'use strict';
const assert=require('node:assert/strict'),stats=require('../static/stats.js');
const m={stats:{end:'2026-10-20',history:[{date:'2026-10-01',price:20,volume:1},{date:'2026-10-02',price:40,volume:3},{date:'2026-10-14',price:100,volume:1},{date:'2026-10-20',price:10,volume:9},{date:'2026-10-21',price:9999,volume:9999}]}};
const w=stats.window(m,7);assert.equal(w.price,19);assert.equal(w.volume,10);assert.equal(w.days,2);assert.equal(w.start,'2026-10-14');assert.equal(w.change,null);
assert.equal(stats.window(m,30).price,330/14);assert.equal(stats.window(m,90).change,null);assert.equal(stats.history(m,7).length,2);assert.equal(stats.window({},30).price,null);
const sparse={stats:{end:'2026-10-20',history:[{date:'2026-10-07',price:10,volume:2},{date:'2026-10-14',price:20,volume:1}]}};
assert.equal(stats.window(sparse,7).change,100);assert.equal(stats.window(sparse,7).days,1);
console.log('统计窗口：量加权、日历边界、缺记录、快照截止日及前窗测试通过');
require('./test_desk.js');

// Keep public-build checks in the existing CI entrypoint.
require('./test_ocr.js');
require('./test_ocr_lifecycle.js');
require('./test_ocr_assets.js');
require('./test_relic_prices.js');
