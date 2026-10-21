'use strict';
const assert=require('node:assert/strict');
const {createClient,readAccount,signature}=require('../static/wfm-bookmark.js');
const clone=v=>JSON.parse(JSON.stringify(v));
const account={id:'owner',ingameName:'Example',verification:true};
const initial=[{id:'one',itemId:'item-a',type:'sell',visible:false,platinum:60,quantity:3,rank:0,updatedAt:'before'},{id:'two',itemId:'item-b',type:'buy',visible:true,platinum:20,quantity:6,rank:10,perTrade:2,subtype:'regular',charges:3,amberStars:1,cyanStars:2,updatedAt:'before'}];
const response=(status,data)=>({ok:status===200,status,json:async()=>({data,error:null})});
class Fake{
 constructor(){this.user=clone(account);this.orders=clone(initial);this.calls=[];this.patchFailure=null;this.mutateBeforeFailure=false;this.readFailure=null;this.clock=1000;this.closed=false;this.catalogueFails=false;}
 fetch=async(url,options)=>{
  this.calls.push({url,options:clone({...options,signal:undefined})});assert.ok(url.startsWith('https://api.warframe.market/v2/'));
  const path=url.slice('https://api.warframe.market/v2'.length);
  if(this.readFailure)return response(this.readFailure,null);
  if(path==='/me')return response(200,clone(this.user));
  if(path==='/orders/my')return response(200,clone(this.orders));
  if(path==='/items'){
   if(this.catalogueFails&&options.headers)throw new TypeError('CORS');
   return response(200,[{id:'item-a',i18n:{en:{name:'Example Mod'},'zh-hans':{name:'示例 MOD'}}}]);
  }
  const o=this.orders.find(o=>o.id===path.split('/').pop());assert.ok(o);
  if(options.method==='PATCH'){
   if(!this.patchFailure||this.mutateBeforeFailure){Object.assign(o,JSON.parse(options.body));o.updatedAt='after';}
   if(this.patchFailure instanceof Error)throw this.patchFailure;
   if(this.patchFailure)return response(this.patchFailure,null);
  }
  return response(200,clone(o));
 };
 client(){return createClient(this.fetch,()=>{},async()=>{},()=>this.clock,()=>!this.closed);}
 patches(){return this.calls.filter(c=>c.options.method==='PATCH');}
}
async function setup(){const fake=new Fake(),client=fake.client(),snapshot=await client.read();return {fake,client,snapshot,change:(id,patch)=>({id,revision:snapshot.orders.find(o=>o.id===id).revision,...patch})};}
(async()=>{
 const base=await setup();assert.equal(base.snapshot.name,'Example');assert.equal(base.snapshot.orders[0].visible,false);assert.equal(base.snapshot.orders[1].type,'buy');assert.equal(base.snapshot.orders[1].rank,10);
 for(const c of base.fake.calls){assert.equal(c.options.method,'GET');assert.equal(c.options.credentials,'include');assert.equal(c.options.redirect,'error');assert.equal(c.options.headers,undefined);assert.equal(c.options.body,undefined);}
 const names=await base.client.items();assert.equal(names[0].name,'示例 MOD');assert.equal(base.fake.calls.at(-1).options.credentials,'omit');
 base.fake.catalogueFails=true;assert.equal((await base.client.items())[0].english,'Example Mod');assert.equal(base.fake.calls.at(-1).options.headers,undefined);
 for(const status of [401,403,429,500]){const fake=new Fake();fake.readFailure=status;await assert.rejects(readAccount(fake.fetch,()=>{},async()=>{}));assert.equal(fake.calls.length,1);}
 const fakeEmpty=new Fake();fakeEmpty.orders=[];assert.deepEqual((await readAccount(fakeEmpty.fetch,()=>{},async()=>{})).orders,[]);
 for(const invalid of [null,{},[{...initial[0],visible:undefined}],[{...initial[0],type:'other'}],[initial[0],initial[0]]]){const fake=new Fake();fake.orders=invalid;await assert.rejects(readAccount(fake.fetch,()=>{},async()=>{}));}
 for(const user of [null,{ingameName:'Example'}, {...account,id:'x/../other'}]){const fake=new Fake();fake.user=user;await assert.rejects(readAccount(fake.fetch,()=>{},async()=>{}));assert.equal(fake.calls.length,1);}
 const p=await base.client.prepare([base.change('one',{platinum:75,quantity:2})]);assert.equal(base.fake.patches().length,0);
 p.entries[0].patch.rank=10; // Caller cannot enlarge the stored, reviewed plan.
 const committed=await base.client.apply(p.id);assert.equal(committed[0].state,'verified');assert.deepEqual(JSON.parse(base.fake.patches()[0].options.body),{platinum:75,quantity:2});
 assert.equal(base.fake.patches()[0].options.credentials,'include');assert.deepEqual(base.fake.patches()[0].options.headers,{'Content-Type':'application/json'});assert.equal(base.fake.orders[0].rank,0);
 await assert.rejects(base.client.apply(p.id));
 for(const patch of [{platinum:0},{platinum:true},{platinum:900001},{quantity:0},{quantity:true},{quantity:5},{rank:0},{visible:'true'}]){const s=await setup();await assert.rejects(s.client.prepare([s.change('two',patch)]));assert.equal(s.fake.patches().length,0);}
 {
  const s=await setup();await assert.rejects(s.client.prepare([{id:'stranger',revision:'x',visible:true}]));await assert.rejects(s.client.prepare([s.change('one',{visible:true}),s.change('one',{visible:true})]));
  s.fake.user.verification=false;await assert.rejects(s.client.prepare([s.change('one',{visible:true})]));assert.equal(s.fake.patches().length,0);
 }
 {
  const s=await setup();s.fake.orders[0].quantity=1;await assert.rejects(s.client.prepare([s.change('one',{platinum:70})]),/官网变化/);
 }
 {
  const s=await setup(),plan=await s.client.prepare([s.change('one',{visible:true})]);s.fake.orders[0].quantity=1;
  assert.equal((await s.client.apply(plan.id))[0].state,'conflict');assert.equal(s.fake.patches().length,0);
 }
 for(const mode of ['expire','cancel','switch','sync','close']){
  const s=await setup(),plan=await s.client.prepare([s.change('one',{visible:true})]);
  if(mode==='expire')s.fake.clock+=300001;if(mode==='cancel')s.client.cancel();if(mode==='switch')s.fake.user.id='other';if(mode==='sync')await s.client.read();if(mode==='close')s.fake.closed=true;
  await assert.rejects(s.client.apply(plan.id));assert.equal(s.fake.patches().length,0);
 }
 for(const status of [401,403,429,new TypeError('timeout')]){
  const s=await setup(),plan=await s.client.prepare([s.change('one',{platinum:70}),s.change('two',{visible:false})]);s.fake.patchFailure=status;
  const results=await s.client.apply(plan.id);assert.equal(results[0].state,'unconfirmed');assert.equal(results[1].state,'skipped');assert.equal(s.fake.patches().length,1);
 }
 {
  const s=await setup(),plan=await s.client.prepare([s.change('one',{visible:true}),s.change('two',{visible:false})]);s.fake.patchFailure=new TypeError('timeout');s.fake.mutateBeforeFailure=true;
  const results=await s.client.apply(plan.id);assert.equal(results[0].state,'verified');assert.equal(results[1].state,'skipped');assert.equal(s.fake.patches().length,1);
 }
 {
  const s=await setup(),plan=await s.client.prepare([s.change('one',{visible:true}),s.change('two',{visible:false})]);
  const results=await s.client.apply(plan.id);assert.deepEqual(results.map(r=>r.state),['verified','verified']);assert.deepEqual(s.fake.orders.map(o=>o.visible),[true,false]);
  assert.equal(signature(s.fake.orders[1],false),signature({...initial[1],visible:false},false));
 }
 const source=require('node:fs').readFileSync(require.resolve('../static/wfm-bookmark.js'),'utf8');
 assert.doesNotMatch(source,/document\.cookie|localStorage|sessionStorage|Authorization\s*:/);assert.doesNotMatch(source,/method:\s*['"](?:DELETE|POST)['"]/);
 console.log('WFM 书签管理：本人全量读取、目录中文、预览不写、精确 PATCH、变体保留、账号切换/冲突、过期/重放、权限/限速中止、超时回读不重写通过');
})().catch(e=>{console.error(e);process.exitCode=1;});
