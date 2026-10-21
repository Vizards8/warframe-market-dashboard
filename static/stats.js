"use strict";
const MarketStats={
 window(m,n=30){
  const h=m?.stats?.history||[],end=m?.stats?.end;if(!end)return {price:null,volume:0,days:0,change:null};
  const day=86400000,e=Date.parse(end+'T00:00:00Z')+day,start=e-n*day,prev=start-n*day;
  const aggregate=rows=>{const volume=rows.reduce((a,x)=>a+x.volume,0);return {price:volume?rows.reduce((a,x)=>a+x.price*x.volume,0)/volume:null,volume,days:rows.length};};
  const current=aggregate(h.filter(x=>Date.parse(x.date)>=start&&Date.parse(x.date)<e));
  const prior=aggregate(h.filter(x=>Date.parse(x.date)>=prev&&Date.parse(x.date)<start));
  return {...current,start:new Date(start).toISOString().slice(0,10),end,change:n<=30&&current.price!=null&&prior.price?(current.price/prior.price-1)*100:null};
 },
 history(m,n=90){const end=m?.stats?.end;if(!end)return [];const e=Date.parse(end+'T00:00:00Z'),start=e-(n-1)*86400000;return (m.stats.history||[]).filter(x=>Date.parse(x.date)>=start&&Date.parse(x.date)<=e);}
};
if(typeof module!=='undefined')module.exports=MarketStats;
