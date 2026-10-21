'use strict';
const assert=require('node:assert/strict');
const {readAccount}=require('../static/wfm-bookmark.js');
const account={ingameName:'Example'},order={itemId:'example-item',type:'sell',visible:false,platinum:60,quantity:3,rank:0};
function transport(responses){
 const calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});const next=responses.shift();if(next instanceof Error)throw next;return {ok:next.status===200,status:next.status,json:async()=>next.body};};
 return {calls,fetcher};
}
(async()=>{
 const fake=transport([{status:200,body:{data:account}},{status:200,body:{data:[order,{...order,type:'buy',rank:10,visible:true,perTrade:2}]}}]);
 const result=await readAccount(fake.fetcher,()=>{},async()=>{});
 assert.equal(result.name,'Example');assert.equal(result.orders[0].visible,false);assert.equal(result.orders[1].type,'buy');assert.equal(result.orders[1].rank,10);
 assert.deepEqual(fake.calls.map(c=>c.url),['https://api.warframe.market/v2/me','https://api.warframe.market/v2/orders/my']);
 for(const c of fake.calls){assert.equal(c.options.method,'GET');assert.equal(c.options.credentials,'include');assert.equal(c.options.redirect,'error');assert.equal(c.options.headers,undefined);assert.equal(c.options.body,undefined);}
 for(const status of [401,403,429,500]){
  const failed=transport([{status,body:{}}]);
  await assert.rejects(readAccount(failed.fetcher,()=>{},async()=>{}));assert.equal(failed.calls.length,1);
 }
 const broken=transport([new TypeError('blocked by CORS')]);
 await assert.rejects(readAccount(broken.fetcher,()=>{},async()=>{}),/不能据此判断/);
 const empty=transport([{status:200,body:{data:account}},{status:200,body:{data:[]}}]);
 assert.deepEqual((await readAccount(empty.fetcher,()=>{},async()=>{})).orders,[]);
 for(const value of [null,{ingameName:''},{user:'wrong response'}]){
  const failed=transport([{status:200,body:{data:value}}]);
  await assert.rejects(readAccount(failed.fetcher,()=>{},async()=>{}));assert.equal(failed.calls.length,1);
 }
 for(const value of [null,{},[{...order,visible:undefined}],[{...order,type:'unknown'}]]){
  const failed=transport([{status:200,body:{data:account}},{status:200,body:{data:value}}]);
  await assert.rejects(readAccount(failed.fetcher,()=>{},async()=>{}),/格式不匹配/);
 }
 console.log('WFM 书签只读探针：固定官方 GET、会话携带、隐藏/买单、401 停止、跨域错误与空列表区分通过');
})().catch(e=>{console.error(e);process.exitCode=1;});
