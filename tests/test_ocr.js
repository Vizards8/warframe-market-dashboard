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
