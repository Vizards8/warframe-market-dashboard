'use strict';
const assert=require('node:assert/strict');
global.MarketStats=require('../static/stats.js');
const core=require('../static/desk-core.js');
const now=Date.parse('2026-10-21T08:00:00Z');
const m={orders_at:'2026-10-21T07:00:00Z',orders:{sell:[{price:50,quantity:1}],buy:[{price:40,quantity:1},{price:30,quantity:2}]},stats_at:'2026-10-21T07:00:00Z',stats:{end:'2026-10-20',history:[{date:'2026-10-20',price:100,volume:1}]}};
assert.equal(core.target(m,'sell',now).value,50);assert.equal(core.target(m,'mean30',now).value,100);
assert.equal(core.target(m,'buy',now).value,40);assert.equal(core.target(m,'sell',now).valid,true);
assert.equal(core.target({...m,orders_error:'network'},'sell',now).valid,false);
assert.equal(core.target({...m,orders_at:'2026-10-20T07:00:00Z'},'sell',now).valid,false);
assert.equal(core.target({},'sell',now).value,null);
assert.deepEqual(core.depth(m.orders.buy,5),{value:100,covered:3,left:2});
assert.equal(core.sets({parts:[{slug:'a',quantity:2},{slug:'b',quantity:1}]},{a:{quantity:7,reserve:2},b:{quantity:4,reserve:1}}),2);
const events=[{id:'1',slug:'a',type:'buy',quantity:2,price:10},{id:'2',slug:'a',type:'buy',quantity:3,price:20},{id:'3',slug:'a',type:'sell',quantity:3,price:50}];
const l=core.ledger(events);assert.equal(l.realized,110);assert.equal(l.remaining,40);assert.equal(l.holdingCosts.a,20);
assert.equal(core.ledger(events.slice(0,2)).remaining,80); // Undoing sale restores lots.
const unknown=core.ledger([{id:'1',slug:'a',type:'opening',quantity:2,price:null},{id:'2',slug:'a',type:'sell',quantity:1,price:50}]);
assert.equal(unknown.realized,0);assert.equal(unknown.unknown,1);assert.equal(unknown.unpriced,1);
const corrected=core.ledger([{id:'1',slug:'a',type:'buy',quantity:2,price:10},{id:'2',slug:'a',type:'adjust',quantity:-1},{id:'3',slug:'a',type:'sell',quantity:1,price:20}]);assert.equal(corrected.realized,10);
const snapshot={at:'2026-10-21T07:00:00Z',activation:'2026-10-21T06:00:00Z',expiry:'2026-10-21T10:00:00Z'};
assert.equal(core.baro(snapshot,now),'active');assert.equal(core.baro({...snapshot,error:'403'},now),'unknown');assert.equal(core.baro({...snapshot,expiry:'2026-10-21T07:30:00Z'},now),'departed');
assert.deepEqual(core.budget([{slug:'a',ducats:100,credits:5000},{slug:'b',ducats:null,credits:null}],{a:2,b:1}),{ducats:200,credits:10000,incomplete:1});
const raw={version:2,items:{a:{quantity:3,reserve:1,cost:20,target:50,note:'hello'}},transactions:[{id:'1',slug:'a',type:'buy',quantity:3,price:20,date:'2026-10-21'}],relicPresets:[{name:'Test',relics:[{id:'lith_a1',grade:'radiant'},null,null,null]}],baroBudget:{ducats:2000},targetBasis:'buy'};
const copy=core.backup(raw,[{slug:'a'}]);assert.equal(copy.items.a.reserve,1);assert.equal(copy.transactions[0].price,20);assert.equal(copy.relicPresets[0].relics[0].grade,'radiant');assert.equal(copy.targetBasis,'buy');
assert.throws(()=>core.backup({...raw,items:{a:{quantity:3,reserve:4}}},[{slug:'a'}]));
assert.throws(()=>core.backup({...raw,transactions:[{...raw.transactions[0],price:-1}]},[{slug:'a'}]));
assert.throws(()=>core.backup({...raw,items:{unknown:{quantity:1}}},[{slug:'a'}]));
console.log('玩家决策：报价时效、有限买单深度、自用凑套、FIFO/未知成本、货单时效、预算及备份验证通过');

assert.equal(core.manualCurrent('2026-10-20T08:00:00Z',now),true);
assert.equal(core.manualCurrent('2026-10-18T08:00:00Z',now),false);
assert.equal(core.manualCurrent(undefined,now),false);
assert.equal(core.fresh('2026-10-22T08:00:00Z',null,now),false);
assert.throws(()=>core.backup({...raw,items:{a:{quantity:4}}},[{slug:'a'}]));
assert.throws(()=>core.backup({...raw,transactions:[{...raw.transactions[0],slug:'b'}]},[{slug:'a'},{slug:'b'}]));
assert.throws(()=>core.backup({...raw,transactions:[{...raw.transactions[0],type:'sell'}]},[{slug:'a'}]));

assert.deepEqual(core.budget([{slug:'a',ducats:100,credits:null}],{a:2}),{ducats:200,credits:0,incomplete:2});

// A returned trader's older high average must not be advertised as an executable profit.
const baroMarket={...m,stats:{end:'2026-10-20',history:[{date:'2026-10-01',price:100,volume:30},{date:'2026-10-20',price:60,volume:10}]}};
const baroItem={ducats:300,credits:150000};
const value=core.baroValue(baroItem,baroMarket,{ducatCost:5,creditCost:10},now);
assert.equal(value.history,60); // min(7d,30d), not the inflated older mean.
assert.equal(value.current,50); // Live asking price remains visibly separate.
assert.equal(value.efficiency,20);
assert.ok(Math.abs(value.currentEfficiency-50/3)<1e-10);
assert.equal(value.net,43.5);
assert.equal(value.eligible,true);
assert.equal(core.baroValue(baroItem,baroMarket,{ducatCost:5},now).net,null);
assert.equal(core.baroValue(baroItem,{...baroMarket,orders_error:'HTTP 429'},{},now).eligible,false);
assert.equal(core.baroValue(baroItem,{...baroMarket,stats_at:'2026-10-20T07:00:00Z'},{},now).eligible,false);
assert.equal(core.baroValue(baroItem,{...baroMarket,stats:{end:'2026-10-20',history:[{date:'2026-10-20',price:60,volume:2}]}},{},now).eligible,false);
assert.equal(core.baroValue({ducats:null},baroMarket,{},now).efficiency,null);
console.log('奸商购买参考：历史/挂价分离、双资源成本、报价过期与低记录量不推荐');
