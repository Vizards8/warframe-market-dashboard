'use strict';
// Only relic rewards are candidates. UI labels and unrelated market items cannot become rewards.
const RewardOcrCore=(()=>{
  function rewardLayout(width,height,count,scale=1,offset=0){
    // Reward cards are centered and sized against the 16:9 safe area, not the full monitor width.
    const safe=Math.min(width,height*16/9),span=safe*.126*count*scale;
    return {left:Math.max(0,(width-span)/2/width),right:Math.min(1,(width+span)/2/width),top:Math.max(0,.5+(.375-.5)*scale+offset),bottom:Math.min(1,.5+(.44-.5)*scale+offset),count};
  }
  function textMask(pixels){
    const d=pixels.data;
    for(let i=0;i<d.length;i+=4){
      const strength=Math.min(d[i+1]-d[i],d[i+2]-d[i]);
      const value=255-Math.max(0,Math.min(255,(strength-15)*4));
      d[i]=d[i+1]=d[i+2]=value;d[i+3]=255;
    }
    return pixels;
  }
  function titleLines(pixels){
    const {width:w,height:h,data:d}=pixels,bands=[],hits=new Uint32Array(h);
    for(let y=0;y<h;y++){
      let count=0;for(let x=0;x<w;x++)if(d[(y*w+x)*4]<128)count++;
      hits[y]=count;if(count<Math.max(5,w*.035))continue;
      const last=bands[bands.length-1];if(!last||y-last.bottom>1)bands.push({top:y,bottom:y});else last.bottom=y;
    }
    // A short wrapped line can touch the previous line after capture resampling.
    // Split only a tall band with a deep ink valley followed by a narrower line.
    const separated=bands.flatMap(b=>{
      if(b.bottom-b.top<h*.48)return [b];
      const min=Math.max(6,Math.round(h*.16));let cut=-1,lowest=Infinity;
      for(let y=b.top+min;y<=b.bottom-min;y++)if(hits[y]<lowest){cut=y;lowest=hits[y];}
      if(cut<0)return [b];
      const before=Math.max(...hits.slice(b.top,cut)),after=Math.max(...hits.slice(cut+1,b.bottom+1));
      return lowest<before*.18&&after>lowest*1.4&&after<before*.4?[{top:b.top,bottom:cut},{top:cut+1,bottom:b.bottom}]:[b];
    });
    return separated.filter(b=>b.bottom-b.top>=Math.max(5,h*.06)).slice(0,3).map(b=>{
      let left=w,right=0;for(let y=b.top;y<=b.bottom;y++)for(let x=0;x<w;x++)if(d[(y*w+x)*4]<128){left=Math.min(left,x);right=Math.max(right,x);}
      return {x:left,y:b.top,width:right-left+1,height:b.bottom-b.top+1};
    }).filter(b=>b.width>0);
  }
  function detectCount(pixels,cellWidth=pixels.width/4){
    // Compare centered 1–4 card layouts against title ink, independently of OCR spelling.
    // Reject a layout if it leaves text outside, cuts through a title, or has an empty card.
    const {width:w,height:h,data:d}=pixels,cell=cellWidth,columns=new Float64Array(w);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(d[(y*w+x)*4]<128)columns[x]++;
    for(let x=0;x<w;x++)if(columns[x]<Math.max(2,h*.03))columns[x]=0;
    const total=columns.reduce((sum,n)=>sum+n,0),candidates=[];
    if(total<Math.max(40,cell*h*.01)||total>w*h*.4)return null;
    for(let count=1;count<=4;count++){
      if(cell*count>w+1)continue;
      const left=Math.max(0,(w-cell*count)/2);let inside=0,cuts=0,ok=true;
      for(let i=0;i<count;i++){
        const start=Math.round(left+i*cell),end=Math.min(w,Math.round(left+(i+1)*cell));let ink=0,moment=0,active=0;
        for(let x=start;x<end;x++){ink+=columns[x];moment+=columns[x]*(x+.5);if(columns[x])active++;}
        inside+=ink;
        if(ink<Math.max(30,cell*h*.008)||active<cell*.10||Math.abs(moment/ink-(start+end)/2)>cell*.20)ok=false;
        if(i){const pad=Math.max(1,Math.round(cell*.012));for(let x=Math.max(0,start-pad);x<Math.min(w,start+pad);x++)cuts+=columns[x];}
      }
      if(ok&&inside/total>=.96&&cuts/total<=.008)candidates.push({count,left:left/w,right:Math.min(1,(left+cell*count)/w)});
    }
    return candidates.length===1?candidates[0]:null;
  }
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
  function chooseAttempt(primary,retry){
    const a=primary.item?.slug,b=retry.item?.slug;
    // Two attempts naming different rewards must never silently replace one another.
    if(a&&b&&a!==b)return {status:'ambiguous',text:retry.text,candidates:[{item:primary.item,score:primary.score},{item:retry.item,score:retry.score}]};
    const rank={exact:3,probable:2,ambiguous:1,unknown:0};
    return rank[retry.status]>rank[primary.status]||rank[retry.status]===rank[primary.status]&&(retry.score||0)>(primary.score||0)?retry:primary;
  }
  function compare(results,quote){
    const compared=results.map(r=>{
      const q=r.item?.tradable?quote(r.item.slug):null,basis=q?.basis==='mean30'?'30 天成交均价':'在线最低卖价';
      const note=!r.item?'未自动选定商品':!r.item.tradable?'不折算白金':q?.value==null?'无报价，不代表零价值':
        !q.valid?`${basis} · 旧值 / 刷新失败，不参与推荐`:r.status!=='exact'?`${basis} · 近似匹配，先确认名称`:
        q.basis==='mean30'?basis:`${basis} · 无有效均价，挂价仅供参考`;
      return {...r,q,display:!r.item?'—':!r.item.tradable?'不可交易':q?.value==null?'待查询':`${Number(q.value.toFixed(1))}p`,note};
    });
    const eligible=compared.filter(r=>r.item?.tradable&&r.status==='exact'&&r.q?.valid&&r.q.value!=null),max=eligible.length?Math.max(...eligible.map(r=>r.q.value)):null;
    return compared.map(r=>({...r,best:max!=null&&r.item?.tradable&&r.status==='exact'&&r.q?.valid&&r.q.value===max}));
  }
  return {rewardLayout,textMask,titleLines,detectCount,normalize,aliases,catalog,match,slot,chooseAttempt,compare};
})();
if(typeof module!=='undefined')module.exports=RewardOcrCore;
