'use strict';
// Only relic rewards are candidates. UI labels and unrelated market items cannot become rewards.
const RewardOcrCore=(()=>{
  function rewardLayout(width,height,count,scale=1,offset=0){
    // Reward cards are centered and sized against the 16:9 safe area, not the full monitor width.
    const safe=Math.min(width,height*16/9),span=safe*.126*count*scale;
    return {left:Math.max(0,(width-span)/2/width),right:Math.min(1,(width+span)/2/width),top:Math.max(0,.5+(.36-.5)*scale+offset),bottom:Math.min(1,.5+(.49-.5)*scale+offset),count};
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
  function titleBlock(pixels){
    // Keep the original two-dimensional layout. Connected ink filters tiny specks;
    // it does not guess line breaks, split tall bands, or join rows into a strip.
    const {width:w,height:h,data:d}=pixels,seen=new Uint8Array(w*h),parts=[];
    for(let i=0;i<w*h;i++){
      if(seen[i]||d[i*4]>=128)continue;
      const queue=[i];seen[i]=1;let left=w,right=0,top=h,bottom=0;
      for(let k=0;k<queue.length;k++){
        const at=queue[k],x=at%w,y=Math.floor(at/w);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++){
          const next=yy*w+xx;if(!seen[next]&&d[next*4]<128){seen[next]=1;queue.push(next);}
        }
      }
      if(queue.length>=Math.max(3,w*h*.00008)&&bottom-top>=2)parts.push({left,right,top,bottom,ink:queue.length});
    }
    if(!parts.length)return null;
    const left=Math.min(...parts.map(b=>b.left)),right=Math.max(...parts.map(b=>b.right)),top=Math.min(...parts.map(b=>b.top)),bottom=Math.max(...parts.map(b=>b.bottom));
    const heights=parts.map(b=>b.bottom-b.top+1).sort((a,b)=>a-b);
    return {x:left,y:top,width:right-left+1,height:bottom-top+1,glyphHeight:heights[Math.floor(heights.length*.7)]};
  }
  function readingLines(data){
    const lines=(data.lines?.length?data.lines:String(data.text||'').split(/\n/).map(text=>({text}))).filter(l=>String(l.text||'').trim());
    // PSM 11 can return blocks out of order. Rebuild rows from overlapping boxes,
    // then read left to right; preserve duplicate lines and an arbitrary row count.
    if(!lines.every(l=>l.bbox&&['x0','x1','y0','y1'].every(k=>Number.isFinite(l.bbox[k]))))return lines.map(l=>l.text.trim());
    const groups=[];
    for(const line of [...lines].sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0)){
      const b=line.bbox,g=groups.find(g=>Math.min(g.bottom,b.y1)-Math.max(g.top,b.y0)>Math.min(g.bottom-g.top,b.y1-b.y0)*.5);
      if(g){g.lines.push(line);g.top=Math.min(g.top,b.y0);g.bottom=Math.max(g.bottom,b.y1);}else groups.push({top:b.y0,bottom:b.y1,lines:[line]});
    }
    return groups.sort((a,b)=>a.top-b.top).map(g=>g.lines.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(l=>l.text.trim()).join(' '));
  }
  function frameSignature(pixels,columns=48,rows=16){
    const {width:w,height:h,data:d}=pixels,values=new Uint8Array(columns*rows);
    for(let gy=0;gy<rows;gy++)for(let gx=0;gx<columns;gx++){
      const x0=Math.floor(gx*w/columns),x1=Math.min(w,Math.max(x0+1,Math.floor((gx+1)*w/columns))),y0=Math.floor(gy*h/rows),y1=Math.min(h,Math.max(y0+1,Math.floor((gy+1)*h/rows)));let ink=0;
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(d[(y*w+x)*4]<128)ink++;
      values[gy*columns+gx]=Math.round(ink/((x1-x0)*(y1-y0))*255);
    }
    return values;
  }
  function frameDistance(a,b){return !a||!b||a.length!==b.length?1:a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0)/(a.length*255);}
  function rewardGate(){
    let fired=false,previous=null,stable=0,absent=0;
    return {reset(){fired=false;previous=null;stable=0;absent=0;},observe(sample,now){
      if(!sample){previous=null;stable=0;if(!absent)absent=now;if(now-absent>=5000)fired=false;return false;}
      absent=0;
      if(fired)return false;
      const same=previous&&previous.count===sample.count&&frameDistance(previous.signature,sample.signature)<.025;
      if(!same){stable=now;previous=sample;}
      if(same&&now-stable>=1800){fired=true;return true;}return false;
    },latch(){fired=true;previous=null;stable=0;},get waiting(){return !fired;}};
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
    // Combine all OCR rows in spatial order; no fixed one/two/three-line cases.
    const texts=lines.map(x=>typeof x==='string'?x:x.text).filter(Boolean).slice(0,45),results=[];
    const maxLength=Math.max(0,...rows.flatMap(r=>(r.ocrAliases||aliases(r)).map(a=>a.length)))*1.6;
    for(let i=0;i<texts.length;i++)for(let n=1;i+n<=texts.length;n++){
      const text=texts.slice(i,i+n).join(' ');if(normalize(text).length>maxLength)break;
      const m=match(text,rows);results.push({...m,text});
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
  return {rewardLayout,textMask,titleBlock,readingLines,frameSignature,frameDistance,rewardGate,detectCount,normalize,aliases,catalog,match,slot,chooseAttempt,compare};
})();
if(typeof module!=='undefined')module.exports=RewardOcrCore;
