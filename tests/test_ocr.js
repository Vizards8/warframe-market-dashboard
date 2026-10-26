'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const core=require('../static/reward-ocr-core.js');
const publicData=JSON.parse(cp.execFileSync('python3',['-c','import features,json;print(json.dumps({"items":features.ITEMS,"relics":features.RELICS},ensure_ascii=False))'],{cwd:require('node:path').resolve(__dirname,'..'),maxBuffer:8*1024*1024}));
const rows=core.catalog(publicData.items,publicData.relics);
for(const fixture of JSON.parse(fs.readFileSync(__dirname+'/fixtures/ocr-cases.json','utf8'))){
  const m=core.match(fixture.text,rows);assert.equal(m.status,fixture.status,fixture.text+': '+JSON.stringify(m.candidates.map(c=>[c.item.slug,c.score])));assert.equal(m.item?.slug??null,fixture.slug,fixture.text);
}
const zh=rows.find(r=>r.slug==='ash_prime_systems_blueprint');
assert.equal(core.match(zh.name,rows).item.slug,zh.slug);
assert.equal(core.slot(['选择奖励','Ash Prime','Systems Blueprint','玩家 1'],rows).item.slug,zh.slug);
assert.equal(core.slot(['Ash Prime Systems Blueprint','Burston Prime Barrel'],rows).status,'ambiguous');
assert.equal(core.slot([],rows).status,'unknown');
const twins=[{slug:'one',name:'Alpha Prime Barrel',english:'Alpha Prime Barrel'},{slug:'two',name:'Alphi Prime Barrel',english:'Alphi Prime Barrel'}];
assert.equal(core.match('Alphl Prime Barrel',twins).status,'ambiguous');
assert.equal(core.match('短',rows).status,'unknown');
assert.ok(rows.length>590);assert.ok(rows.every(x=>!x.tradable||x.slug));
console.log(`OCR: ${rows.length} 个奖励，中英文、换行、重复候选、不可交易和模糊名称验证通过`);
// Only exact/manual-confirmed names with fresh prices can win. Missing prices never become zero.
const item=(slug,tradable=true)=>({slug,tradable});
const comparison=core.compare([
 {status:'exact',item:item('fresh')},{status:'exact',item:item('old')},
 {status:'probable',item:item('fuzzy')},{status:'exact',item:item('missing')},
 {status:'exact',item:item('forma',false)},{status:'ambiguous'}
],slug=>({fresh:{value:12,valid:true},old:{value:100,valid:false},fuzzy:{value:200,valid:true},missing:{value:null,valid:false}}[slug]));
assert.deepEqual(comparison.map(x=>!!x.best),[true,false,false,false,false,false]);
assert.equal(comparison[3].display,'待查询');assert.equal(comparison[4].display,'不可交易');
assert.equal(core.compare([{status:'exact',item:item('none')}],()=>({value:null,valid:false}))[0].best,false);
assert.equal(core.compare([{status:'exact',item:item('zero')}],()=>({value:0,valid:true}))[0].display,'0p');
// Centered cards retain the same pixel width on ultrawide displays.
for(const count of [1,2,3,4]){
 const normal=core.rewardLayout(2560,1440,count),wide=core.rewardLayout(3440,1440,count);
 assert.ok(Math.abs(normal.left+normal.right-1)<1e-12);
 assert.ok(Math.abs((normal.right-normal.left)*2560-(wide.right-wide.left)*3440)<1e-9);
 assert.ok(Math.abs((normal.right-normal.left)/count-.126)<1e-12);
 assert.ok(normal.top>0&&normal.bottom<1&&normal.bottom>normal.top);
}
const colors={width:3,height:1,data:new Uint8ClampedArray([30,180,210,255,80,80,80,255,240,230,220,255])};
core.textMask(colors);assert.deepEqual([...colors.data],[0,0,0,255,255,255,255,255,255,255,255,255]);
// Whole blocks retain all rows, including touching rows; never concatenate pixels.
for(const count of [1,2,3,4]){
 const image={width:100,height:110,data:new Uint8ClampedArray(100*110*4).fill(255)};
 for(let i=0;i<count;i++)for(let y=5+i*22;y<19+i*22;y++)for(let x=20;x<75;x++)image.data[(y*100+x)*4]=0;
 image.data[(105*100+2)*4]=0;
 const block=core.titleBlock(image);assert.equal(block.y,5);assert.equal(block.height,14+(count-1)*22);assert.equal(block.width,55);
}
assert.equal(core.titleBlock({width:10,height:10,data:new Uint8ClampedArray(400).fill(255)}),null);
assert.equal(core.slot(['Ash','Prime','Systems','Blue','print'],rows).item.slug,zh.slug);
const ordered=core.readingLines({lines:[
 {text:'print',bbox:{x0:20,x1:50,y0:70,y1:80}},
 {text:'Prime',bbox:{x0:60,x1:90,y0:11,y1:21}},
 {text:'Blue',bbox:{x0:20,x1:50,y0:50,y1:60}},
 {text:'Ash',bbox:{x0:10,x1:40,y0:10,y1:20}},
 {text:'Systems',bbox:{x0:20,x1:90,y0:30,y1:40}}
]});assert.deepEqual(ordered,['Ash Prime','Systems','Blue','print']);
assert.equal(core.slot(ordered,rows).item.slug,zh.slug);
console.log('OCR preprocessing: centered layouts, whole multiline blocks, coordinate order and unrestricted row joining passed');

// Calibration follows the pixel transform around screen center, independently of monitor resolution.
for(const scale of [.8,1.25]){
 const base=core.rewardLayout(2560,1440,4),adjusted=core.rewardLayout(2560,1440,4,scale,40/1440);
 assert.ok(Math.abs(adjusted.left-(.5+(base.left-.5)*scale))<1e-12);
 assert.ok(Math.abs(adjusted.top-(.5+(base.top-.5)*scale+40/1440))<1e-12);
}

// Two order books would rank these the other way: recommendation must use the shared mean.
global.MarketStats=require('../static/stats.js');
const desk=require('../static/desk-core.js'),now=Date.now(),at=new Date(now).toISOString();
const market={a:{stats_at:at,stats:{end:'2026-10-20',history:[{date:'2026-10-20',price:12.3456,volume:3}]},orders_at:at,orders:{sell:[{price:99}]}},b:{stats_at:at,stats:{end:'2026-10-20',history:[{date:'2026-10-20',price:20,volume:1}]},orders_at:at,orders:{sell:[{price:1}]}}};
const means=core.compare(['a','b'].map(slug=>({status:'exact',item:item(slug)})),slug=>desk.rewardQuote(market[slug],now));
assert.deepEqual(means.map(r=>r.best),[false,true]);assert.equal(means[0].display,'12.3p');
assert.equal(means[0].note,'30 天成交均价');assert.equal(means[0].q.at,at);
const fallback=core.compare([{status:'exact',item:item('a')}],()=>desk.rewardQuote({...market.a,stats:{}},now))[0];
assert.match(fallback.note,/在线最低卖价.*无有效均价/);

function titleMask(count,{width=400,height=70,omit=-1,shift=0}={}){
 const data=new Uint8ClampedArray(width*height*4).fill(255),cell=width/4;
 // Synthetic glyphs with variable title widths and two lines; no screenshot or account data stored.
 for(let i=0;i<count;i++)if(i!==omit){
  const center=(width-cell*count)/2+(i+.5)*cell+shift,span=cell*(i%2?.54:.76);
  for(let line=0;line<2;line++)for(let y=12+line*22;y<26+line*22;y++)for(let x=Math.round(center-span/2);x<center+span/2;x++){
   if(x>=0&&x<width&&(x%9)<6)data[(y*width+x)*4]=0;
  }
 }
 return {width,height,data};
}
for(const width of [240,400,646,1290])for(const count of [1,2,3,4])assert.equal(core.detectCount(titleMask(count,{width}))?.count,count,`${width}px / ${count} rewards`);
assert.equal(core.detectCount(titleMask(0)),null);
assert.equal(core.detectCount(titleMask(3,{omit:1})),null); // Never shift two separated outer slots into a two-card result.
assert.equal(core.detectCount(titleMask(4,{shift:35})),null); // Misaligned boundaries should prompt calibration.
console.log('OCR rewards: shared 30-day means, explicit fallback, 1–4 layout detection, blank and ambiguous layouts passed');


// Captured title lines can touch after resampling: broad first line, short wrapped 图 below.
const touching={width:360,height:94,data:new Uint8ClampedArray(360*94*4).fill(255)};
for(let y=15;y<=77;y++){
 const ink=y<46?200:y===46?32:y===47?17:31,left=y<46?20:157;
 for(let x=left;x<left+ink;x++)touching.data[(y*360+x)*4]=0;
}
assert.deepEqual([core.titleBlock(touching).y,core.titleBlock(touching).height],[15,63]);
const primary={status:'unknown',score:0},retry={status:'exact',score:1,item:item('correct')};
assert.equal(core.chooseAttempt(primary,retry),retry);
assert.equal(core.chooseAttempt(retry,primary),retry);
assert.equal(core.chooseAttempt({status:'probable',score:.9,item:item('correct')},primary).item.slug,'correct');
assert.equal(core.chooseAttempt({status:'probable',score:.9,item:item('other')},retry).status,'ambiguous');
assert.equal(core.chooseAttempt(retry,{...retry,item:item('other')}).status,'ambiguous');
console.log('OCR shared frames: touching wrapped lines, bounded retry, preserved good matches and conflicting-name confirmation passed');

// Stable frames trigger once; layout changes and OCR failures never cause a loop.
const signature=core.frameSignature(titleMask(4)),sample={count:4,signature};
assert.equal(core.frameDistance(signature,signature),0);
const gate=core.rewardGate();
assert.equal(gate.observe(sample,100),false);assert.equal(gate.observe(sample,1100),false);assert.equal(gate.observe(sample,2100),true);
for(const time of [3100,5100,10000])assert.equal(gate.observe(sample,time),false);
assert.equal(gate.observe(null,11000),false);assert.equal(gate.observe(sample,13000),false); // Brief disappearance is not a new reward.
for(const time of [14000,17000,19000])gate.observe(null,time);
assert.equal(gate.observe(sample,20000),false);assert.equal(gate.observe(sample,22000),true);
gate.reset();gate.observe(sample,100);gate.observe({...sample,count:3},1100);assert.equal(gate.observe(sample,2100),false);
gate.reset();gate.latch();assert.equal(gate.observe(sample,10000),false);
// Gradual fading must settle against the initial frame, not just the preceding frame.
gate.reset();const fade=n=>({count:4,signature:new Uint8Array(48*16).fill(n)});
for(let n=0;n<30;n+=5)assert.equal(gate.observe(fade(n),100+n*200),false);
console.log('OCR automatic gate: stable trigger, no repeated batch, absence rearm, manual latch and fading passed');
