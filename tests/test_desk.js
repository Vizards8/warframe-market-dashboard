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
// Ducat route: whole-item rounding, finite order depth, and separate historical/instant outcomes.
const part={kind:'component',tags:['prime','component'],ducats:45};
const target={ducats:100,credits:200000};
const pm={orders_at:m.orders_at,orders:{sell:[{price:2,quantity:2},{price:3,quantity:8}],buy:[{price:1,quantity:2}]}};
const tm={...baroMarket,orders:{sell:[{price:45,quantity:10}],buy:[{price:20,quantity:1},{price:18,quantity:1}]}};
const cycle=core.ducatCycle(part,pm,target,tm,2,null,10,now);
assert.equal(cycle.parts,5);assert.equal(cycle.remainder,25);assert.equal(cycle.cost,13);
assert.equal(cycle.immediate,38);assert.equal(cycle.immediateGap,25);assert.equal(cycle.immediateNet,21);
assert.equal(cycle.creditP,4);assert.equal(cycle.credits,400000);
assert.equal(core.ducatCycle(part,pm,target,tm,2,null,null,now).immediateNet,null);
assert.equal(core.ducatCycle(part,pm,target,tm,10,null,0,now).cost,null);
assert.equal(core.ducatCycle(part,pm,target,tm,10,null,0,now).immediate,null);
assert.equal(core.ducatCycle(part,{...pm,orders_error:'429'},target,tm,1,null,0,now).cost,null);
assert.equal(core.ducatCycle(part,pm,target,{...tm,orders_error:'429'},1,null,0,now).immediate,null);
assert.equal(core.ducatCycle(part,pm,target,{...tm,stats_error:'429'},1,null,0,now).historical,null);
assert.equal(core.ducatCycle(part,pm,target,tm,10,2,0,now).cost,46);
assert.equal(core.ducatCycle(part,pm,target,tm,0,null,0,now),null);
assert.equal(core.ducatCycle(part,pm,{ducats:100},tm,1,null,0,now),null);
assert.equal(core.ducatPart(part,pm,{quantity:7,reserve:2},'owned',now).available,5);
assert.equal(core.ducatPart(part,pm,{},'market',now).per100,null); // Orders never substitute for closed trades.
assert.equal(core.ducatPart(part,baroMarket,{},'market',now).price,90);
assert.equal(core.ducatPart({...part,tags:['prime','set']},pm,{},'market',now).eligible,false);
assert.equal(core.ducatPart({...part,ducats:0},pm,{},'market',now).valid,false);
assert.equal(core.ducatPart(part,{orders_at:m.orders_at,orders:{sell:[]}}, {},'market',now).price,null);
assert.equal(core.ducatPart(part,{...pm,orders_error:'429'}, {},'market',now).valid,false);
assert.equal(core.liquidity({},now).week,null);
assert.equal(core.liquidity(baroMarket,now).week,10);
assert.equal(core.liquidity(baroMarket,now).label,'成交偏少');
assert.equal(core.liquidity({...baroMarket,stats_error:'429'},now).tier,-1);
console.log('杜卡德路线：散件资格、保留库存、整件取整、逐档深度、现金与行情失效边界验证通过');

// One trade must use one identified seller, never the sum of unrelated offers.
const bulkMarket={...pm,orders:{...pm.orders,sell_offers:[
 {price:1,quantity:1,seller:'cheap',name:'A'},
 {price:3,quantity:6,seller:'bulk',name:'B'},
 {price:5,quantity:30,seller:'deep',name:'C'}]}};
const lot=core.ducatLot(part,bulkMarket,1,now);
assert.equal(lot.offer.seller,'bulk');assert.equal(lot.units,6);assert.equal(lot.ducats,270);assert.equal(lot.cost,18);
assert.equal(core.ducatLot(part,pm,1,now),null); // Legacy anonymous depth is insufficient evidence.
assert.equal(core.ducatLot(part,{...bulkMarket,orders_error:'429'},1,now),null);
assert.equal(core.ducatLot(part,{...bulkMarket,orders:{sell_offers:[{price:1,quantity:3,seller:'a'},{price:1,quantity:3,seller:'b'}]}},1,now),null);
const rounded=core.ducatCycle(part,bulkMarket,{ducats:280,credits:0},tm,1,null,null,now,lot);
assert.equal(rounded.parts,12);assert.equal(rounded.remainder,260);assert.equal(rounded.trades,2);assert.equal(rounded.cost,null); // Seller has only 6: do not extrapolate or borrow from others.
assert.equal(rounded.buyCovered,6);
const set={kind:'component',tags:['prime','set'],ducats:160};
const setMarket={...bulkMarket,orders:{sell_offers:[{price:20,quantity:2,seller:'set'}]}};
const setLot=core.ducatLot(set,setMarket,3,now);
assert.equal(setLot.units,2);assert.equal(setLot.slots,6);assert.equal(setLot.ducats,320);assert.equal(setLot.cost,40);
const setCycle=core.ducatCycle(set,setMarket,{ducats:300,credits:0},tm,1,null,null,now,setLot);
assert.equal(setCycle.parts,2);assert.equal(setCycle.trades,1);assert.equal(setCycle.cost,40);assert.equal(setCycle.remainder,20);
assert.equal(core.ducatLot(set,setMarket,7,now),null);
const recipe={ducats:160,slots:4,parts:[{slug:'a',quantity:2},{slug:'b',quantity:2}]};
assert.deepEqual(core.ducatSet(recipe,[{...part,slug:'a',ducats:65},{...part,slug:'b',ducats:15}]),{ducats:160,slots:4});
assert.equal(core.ducatSet(recipe,[{...part,slug:'a',ducats:65}]),null);
assert.equal(core.ducatSet({...recipe,ducats:500},[{...part,slug:'a',ducats:65},{...part,slug:'b',ducats:15}]),null);
const statPart={...pm,stats_at:m.stats_at,stats:{end:'2026-10-20',history:[{date:'2026-10-19',price:3,volume:10},{date:'2026-10-20',price:6,volume:30}]}};
assert.equal(core.ducatPart(part,statPart,{},'market',now).price,5.25);
assert.equal(core.ducatPart(part,{...statPart,stats_error:'429'},{},'owned',now).valid,false);
assert.equal(core.ducatPart(part,statPart,{},'owned',now).price,5.25); // Owned value uses the same statistical basis.
console.log('整批收货：独立卖家、6 槽、整套数量、库存不足、整批取整和成交参考分离验证通过');

assert.equal(core.ducatLot(set,{...setMarket,orders:{sell_offers:[{price:10,quantity:1,seller:'one'},{price:11,quantity:2,seller:'two'}]}},3,now).offer.seller,'two'); // Prefer two 3-part sets in a full trade.
