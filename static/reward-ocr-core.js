'use strict';
// Only relic rewards are candidates. UI labels and unrelated market items cannot become rewards.
const RewardOcrCore=(()=>{
  function normalize(text){return String(text||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\p{Script=Han}]/gu,'');}
  function aliases(item){
    const names=[item.name,item.english,...(item.ocrNames||[])].filter(Boolean),result=new Set();
    for(const name of names){result.add(normalize(name));
      // The game sometimes omits Blueprint on a specific frame component, never on the main blueprint.
      if(/(?:chassis|systems|neuroptics) blueprint$|(?:机体|系统|头部神经光元)\s*蓝图$/i.test(name))result.add(normalize(name.replace(/\s*blueprint$|\s*蓝图$/i,'')));
    }
    return [...result];
  }
  function distance(a,b){let prev=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}return prev[b.length];}
  function catalog(items,relics){
    const known=new Map(items.map(x=>[x.slug,x])),rows=new Map();
    for(const r of relics.items)for(const drop of r.grades.intact){
      const slug=drop.slug||(/^2[x×]/i.test(drop.name)?'forma_blueprint_x2':'forma_blueprint');
      if(rows.has(slug))continue;
      const item=known.get(slug)||{slug,name:slug.endsWith('_x2')?'Forma 蓝图 ×2':'Forma 蓝图',english:drop.name};
      rows.set(slug,{...item,tradable:!!drop.tradable,ocrNames:[drop.name,...(!drop.tradable&&!slug.endsWith('_x2')?['福马 蓝图','Forma Blueprint']:[])]});
    }
    return [...rows.values()].map(x=>({...x,ocrAliases:aliases(x)}));
  }
  function match(text,rows){
    const input=normalize(text);if(input.length<4)return {status:'unknown',candidates:[]};
    const ranked=rows.map(item=>({item,score:Math.max(...(item.ocrAliases||aliases(item)).map(a=>1-distance(input,a)/Math.max(input.length,a.length)))})).filter(x=>x.score>=.65).sort((a,b)=>b.score-a.score||a.item.slug.localeCompare(b.item.slug));
    const best=ranked[0],second=ranked[1];
    const exact=best?.score===1&&second?.score!==1;
    const confident=best?.score>=.86&&(!second||best.score-second.score>=.08)&&input.length>=7;
    return {status:exact?'exact':confident?'probable':best?'ambiguous':'unknown',item:exact||confident?best.item:null,score:best?.score||0,candidates:ranked.slice(0,4)};
  }
  function slot(lines,rows){
    // Keep spatial order supplied by OCR. Try wrapped titles up to three lines.
    const texts=lines.map(x=>typeof x==='string'?x:x.text).filter(Boolean).slice(0,45),results=[];
    for(let i=0;i<texts.length;i++)for(let n=1;n<=3&&i+n<=texts.length;n++){
      const text=texts.slice(i,i+n).join(' '),m=match(text,rows);results.push({...m,text});
    }
    results.sort((a,b)=>({exact:3,probable:2,ambiguous:1,unknown:0}[b.status]-{exact:3,probable:2,ambiguous:1,unknown:0}[a.status])||b.score-a.score);
    // More than one exact reward in one crop indicates a bad crop; never choose by price.
    const exacts=new Set(results.filter(x=>x.status==='exact').map(x=>x.item.slug));
    if(exacts.size>1)return {status:'ambiguous',text:texts.join(' '),candidates:[...exacts].map(slug=>({item:rows.find(x=>x.slug===slug),score:1})).slice(0,4)};
    return results[0]||{status:'unknown',text:'',candidates:[]};
  }
  function compare(results,quote){
    const compared=results.map(r=>{const q=r.item?.tradable?quote(r.item.slug):null;return {...r,q,display:!r.item?'—':!r.item.tradable?'不可交易':q?.value==null?'待查询':`${q.value}p`,note:!r.item?'未自动选定商品':!r.item.tradable?'不折算白金':q?.value==null?'无报价，不代表零价值':!q.valid?'旧值 / 刷新失败，不参与推荐':r.status!=='exact'?'近似匹配，先确认名称':'在线最低卖价 · 非成交价'};});
    const eligible=compared.filter(r=>r.item?.tradable&&r.status==='exact'&&r.q?.valid&&r.q.value!=null),max=eligible.length?Math.max(...eligible.map(r=>r.q.value)):null;
    return compared.map(r=>({...r,best:max!=null&&r.item?.tradable&&r.status==='exact'&&r.q?.valid&&r.q.value===max}));
  }
  return {normalize,aliases,catalog,match,slot,compare};
})();
if(typeof module!=='undefined')module.exports=RewardOcrCore;
