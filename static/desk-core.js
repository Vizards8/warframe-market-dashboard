'use strict';
const DeskCore={
 fresh(at,error,now=Date.now()){return !!at&&!error&&Number.isFinite(Date.parse(at))&&now>=Date.parse(at)&&now-Date.parse(at)<6*3600000;},
 target(m,basis='sell',now=Date.now()){
  const source=basis==='mean30'?'stats':'orders';
  const value=basis==='mean30'?MarketStats.window(m,30).price:basis==='buy'?m?.orders?.buy?.[0]?.price:m?.orders?.sell?.[0]?.price;
  return {value:value??null,valid:this.fresh(m?.[source+'_at'],m?.[source+'_error'],now)&&value!=null,label:{sell:'在线最低卖价',buy:'在线最高买价',mean30:'30 天成交均价'}[basis]||'在线最低卖价'};
 },
 manualCurrent(at,now=Date.now()){const n=Date.parse(at);return Number.isFinite(n)&&now>=n&&now-n<48*3600000;},
 depth(rows,quantity){let left=quantity,value=0,covered=0;for(const r of rows||[]){const n=Math.min(left,r.quantity);value+=n*r.price;covered+=n;left-=n;if(left<=0)break;}return {value,covered,left};},
 available(s){return Math.max(0,(s?.quantity||0)-(s?.reserve||0));},
 sets(recipe,items){return Math.min(...recipe.parts.map(p=>Math.floor(this.available(items[p.slug])/p.quantity)));},
 ledger(entries){let realized=0,unknown=0;const lots={};const sold=new Map();
  for(const e of entries){
   const list=lots[e.slug]||(lots[e.slug]=[]);
   if(e.type==='buy'||e.type==='opening')list.push({quantity:e.quantity,price:e.price,date:e.date});
   if(e.type==='adjust'){if(e.quantity>0)list.push({quantity:e.quantity,price:null,date:e.date});else{let n=-e.quantity;while(n>0&&list.length){const used=Math.min(n,list[0].quantity);list[0].quantity-=used;n-=used;if(!list[0].quantity)list.shift();}}}
   if(e.type==='sell'){let left=e.quantity,cost=0,known=true;while(left>0&&list.length){const lot=list[0],n=Math.min(left,lot.quantity);if(lot.price==null)known=false;else cost+=n*lot.price;left-=n;lot.quantity-=n;if(!lot.quantity)list.shift();}if(left)known=false;if(known)realized+=e.quantity*e.price-cost;else unknown+=e.quantity;sold.set(e.id,{known,cost:known?cost:null,revenue:e.quantity*e.price});}
  }
  const holdingCosts={};for(const [slug,list] of Object.entries(lots)){const q=list.reduce((n,l)=>n+l.quantity,0);holdingCosts[slug]=q&&list.every(l=>l.price!=null)?list.reduce((n,l)=>n+l.quantity*l.price,0)/q:null;}
  let remaining=0,unpriced=0;for(const l of Object.values(lots).flat())if(l.price==null)unpriced+=l.quantity;else remaining+=l.quantity*l.price;
  return {realized,unknown,remaining,unpriced,sold,holdingCosts};
 },
 baro(snapshot,now=Date.now()){
  const a=Date.parse(snapshot?.activation),e=Date.parse(snapshot?.expiry);
  if(!Number.isFinite(a)||!Number.isFinite(e)||!this.fresh(snapshot.at,snapshot.error,now))return 'unknown';
  return now<a?'upcoming':now<e?'active':'departed';
 },
 budget(rows,plan){let ducats=0,credits=0,incomplete=0;for(const r of rows){const q=plan[r.slug]||0;if(!q)continue;if(r.ducats==null||r.credits==null)incomplete+=q;if(r.ducats!=null)ducats+=q*r.ducats;if(r.credits!=null)credits+=q*r.credits;}return {ducats,credits,incomplete};},
 wfmPreview(raw,items,catalog){
  if(!raw||typeof raw!=='object'||typeof raw.apiVersion!=='string'||raw.error!=null||!Array.isArray(raw.data)||raw.data.length>10000)throw new Error('不是有效的 WFM v2 公开挂单响应');
  const index=new Map(items.filter(x=>typeof x.id==='string').map(x=>[x.id,x]));
  const supported=new Map(catalog.map(x=>[x.slug,x])),seen=new Set(),rows=new Map(),skipped=[];
  let buy=0;
  for(const order of raw.data){
   if(!order||typeof order.id!=='string'||seen.has(order.id)||!['buy','sell'].includes(order.type)||typeof order.visible!=='boolean'||!Number.isInteger(order.quantity)||order.quantity<1||order.quantity>9999||!Number.isInteger(order.platinum)||order.platinum<1||order.platinum>900000||typeof order.itemId!=='string')throw new Error('挂单字段不完整、重复或无效');
   seen.add(order.id);
   if(order.type==='buy'){buy++;continue;}
   const x=index.get(order.itemId),c=supported.get(x?.slug),name=x?.name||order.itemId;
   let reason=!order.visible?'隐藏单，不作为公开持有依据':!c?'当前库存目录未收录':null;
   if(!reason&&(c.kind==='mod'?order.rank!==0:order.rank!=null&&order.rank!==0))reason='非 R0 或等级不明确；避免混合变体';
   if(!reason&&['subtype','charges','amberStars','cyanStars'].some(k=>order[k]!=null))reason='带有子类型 / 充能 / 星数，当前库存不能区分';
   const perTrade=order.perTrade??1;
   if(!reason&&(!Number.isInteger(perTrade)||perTrade<1||perTrade>6||order.quantity%perTrade!==0))reason='批量交易规格无效';
   if(reason){skipped.push({name,reason});continue;}
   const row=rows.get(x.slug)||{slug:x.slug,name:c.name,quantity:0,prices:[]};
   row.quantity+=order.quantity;
   if(row.quantity>100000)throw new Error('合计数量超过库存上限');
   if(!row.prices.some(p=>p.platinum===order.platinum&&p.perTrade===perTrade))row.prices.push({platinum:order.platinum,perTrade});
   rows.set(x.slug,row);
  }
  return {total:raw.data.length,buy,rows:[...rows.values()],skipped};
 },
 backup(raw,catalog){
  if(![1,2].includes(raw?.version)||!raw.items||typeof raw.items!=='object'||Array.isArray(raw.items))throw new Error('不是有效的库存备份');
  const allowed=new Set(catalog.map(x=>x.slug)),items={},out={};
  const finite=(v,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
  for(const [slug,s] of Object.entries(raw.items)){
   if(!allowed.has(slug))throw new Error('目录外商品：'+slug);
   if(!s||!Number.isInteger(s.quantity)||!finite(s.quantity,100000))throw new Error('持有数量不正确');
   for(const k of ['target','cost'])if(s[k]!=null&&!finite(s[k],1000000))throw new Error('价格不正确');
   if(s.reserve!=null&&(!Number.isInteger(s.reserve)||!finite(s.reserve,s.quantity)))throw new Error('保留数量不正确');
   items[slug]={quantity:s.quantity,reserve:s.reserve||0,target:s.target??null,cost:s.cost??null,watch:!!s.watch,note:String(s.note||'').slice(0,1000)};
   if(/^\d{4}-\d{2}-\d{2}$/.test(s.baro_date||''))items[slug].baro_date=s.baro_date;
  }
  if(raw.transactions!=null){
   if(!Array.isArray(raw.transactions)||raw.transactions.length>50000)throw new Error('交易记录格式不正确');
   out.transactions=raw.transactions.map(e=>{
    if(!Object.hasOwn(items,e.slug)||!['buy','sell','opening','adjust'].includes(e.type)||!Number.isInteger(e.quantity)||Math.abs(e.quantity)>100000||e.quantity===0||e.type!=='adjust'&&e.quantity<0||e.type==='sell'&&e.price==null||e.price!=null&&!finite(e.price,1000000)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||typeof e.id!=='string')throw new Error('交易记录内容不正确');
    return {id:e.id.slice(0,100),slug:e.slug,type:e.type,quantity:e.quantity,price:e.price??null,date:e.date,note:String(e.note||'').slice(0,1000)};
   });
   if(new Set(out.transactions.map(x=>x.id)).size!==out.transactions.length)throw new Error('交易记录 ID 重复');
  }
  if(out.transactions){const balances={};for(const e of out.transactions){balances[e.slug]=(balances[e.slug]||0)+(e.type==='sell'?-e.quantity:e.quantity);if(balances[e.slug]<0)throw new Error('交易记录数量不足');}for(const [slug,q] of Object.entries(balances))if(q!==items[slug].quantity)throw new Error('交易记录与库存数量不一致');}
  if(raw.baroConfirmedAt&&typeof raw.baroConfirmedAt==='object')out.baroConfirmedAt=Object.fromEntries(Object.entries(raw.baroConfirmedAt).filter(([k,v])=>allowed.has(k)&&typeof v==='string'&&Number.isFinite(Date.parse(v))));
  if(typeof raw.startInDesk==='boolean')out.startInDesk=raw.startInDesk;
  if(['sell','buy','mean30'].includes(raw.targetBasis))out.targetBasis=raw.targetBasis;
  if([7,30,90].includes(raw.statsWindow))out.statsWindow=raw.statsWindow;
  if(Array.isArray(raw.farmRuns))out.farmRuns=raw.farmRuns.filter(x=>typeof x.name==='string'&&finite(x.minutes,10000)&&x.minutes>0&&['quoted','sold','cost'].every(k=>finite(x[k],1000000))).slice(-5000).map(x=>({...x,name:x.name.slice(0,80),note:String(x.note||'').slice(0,300),date:String(x.date||'').slice(0,10)}));
  const relicChoice=x=>x===null?null:x&&typeof x.id==='string'&&/^[a-z]+_[a-z][0-9]+$/.test(x.id)&&['intact','exceptional','flawless','radiant'].includes(x.grade)?{id:x.id,grade:x.grade}:null;
  if(Array.isArray(raw.relics)&&raw.relics.length===4)out.relics=raw.relics.map(relicChoice);
  if(['price','rarity'].includes(raw.relicSort))out.relicSort=raw.relicSort;
  if(Array.isArray(raw.relicPresets))out.relicPresets=raw.relicPresets.filter(p=>typeof p.name==='string'&&Array.isArray(p.relics)&&p.relics.length===4).slice(0,12).map(p=>({name:p.name.slice(0,40),relics:p.relics.map(relicChoice)}));
  for(const key of ['ducatCost','creditCost'])if(raw[key]==null||finite(raw[key],1000000))out[key]=raw[key]??null;
  if(Array.isArray(raw.baroBasket))out.baroBasket=raw.baroBasket.filter(k=>allowed.has(k));
  if(raw.baroPlan&&typeof raw.baroPlan==='object')out.baroPlan=Object.fromEntries(Object.entries(raw.baroPlan).filter(([k,v])=>allowed.has(k)&&Number.isInteger(v)&&finite(v,100000)));
  if(raw.baroBudget&&typeof raw.baroBudget==='object')out.baroBudget=Object.fromEntries(Object.entries(raw.baroBudget).filter(([k,v])=>['ducats','credits'].includes(k)&&finite(v,1000000000000)));
  if(raw.baroCosts&&typeof raw.baroCosts==='object')out.baroCosts=Object.fromEntries(Object.entries(raw.baroCosts).filter(([k,v])=>allowed.has(k)&&v&&typeof v==='object').map(([k,v])=>[k,Object.fromEntries(Object.entries(v).filter(([k,n])=>['ducats','credits'].includes(k)&&finite(n,1000000000)))]));
  return {items,...out};
 },
};
if(typeof module!=='undefined')module.exports=DeskCore;
