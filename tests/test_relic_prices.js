'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
// Exercise the page through its controls with unequal means and missing quotes.
const nodes=new Map();
function node(id){
  if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:'',addEventListener(){},insertAdjacentHTML(){}});
  return nodes.get(id);
}
const relics=['lith','meso','neo','axi'].flatMap(era=>['cheap','dear','unknown'].map((kind,i)=>({
  id:era+'_'+kind,name:era+' '+kind,zh:era+' '+kind,vaulted:i===1,
  grades:Object.fromEntries(['intact','radiant'].map(grade=>[grade,[{name:kind,slug:kind,tradable:true,chance:grade==='intact'?10:20}]]))
})));
const sandbox={console,$:node,settings:{},tab:'relic-prices',state:{},
  document:{addEventListener(){},body:{classList:{contains:()=>false}}},
  request:async url=>url==='/api/relics'?{items:relics}:[{slug:'cheap',name:'cheap'},{slug:'dear',name:'dear'}],
  mrow:slug=>({mean:{cheap:10,dear:50}[slug],stats_at:slug==='unknown'?null:'fresh'}),ask:()=>1,
  MarketStats:{window:m=>({price:m.mean??null})},DeskCore:{fresh:at=>at==='fresh'},
  esc:String,number:x=>String(x),notify:message=>{throw Error(message);}};
sandbox.window=sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/extras.js'),'utf8'),sandbox);
const ids=()=>[...node('relic-advice-list').innerHTML.matchAll(/data-advice-relic="([^"]+)"/g)].map(m=>m[1]);
const change=(id,value)=>node(id).onchange({target:{value}});
(async()=>{
  await sandbox.Extras.activate('relic-prices');
  assert.equal(ids().length,12);
  assert.ok(ids().slice(0,4).every(id=>id.endsWith('_cheap')));
  assert.ok(ids().slice(-4).every(id=>id.endsWith('_unknown')));
  for(const era of ['lith','meso','neo','axi']){
    change('relic-advice-era',era);
    assert.deepEqual(ids(),[era+'_cheap',era+'_dear',era+'_unknown']);
  }
  change('relic-advice-order','desc');
  assert.deepEqual(ids(),['axi_dear','axi_cheap','axi_unknown']);
  change('relic-advice-sort','best');
  assert.deepEqual(ids(),['axi_dear','axi_cheap','axi_unknown']);
  change('relic-advice-sort','ev');
  change('relic-advice-grade','radiant');
  change('relic-advice-min','5');
  assert.deepEqual(ids(),['axi_dear']);
  change('relic-advice-vault','unvaulted');
  assert.deepEqual(ids(),[]);
  change('relic-advice-min','0');
  assert.deepEqual(ids(),['axi_cheap','axi_unknown']);
  console.log('Relic prices: separate page, era filters, both sort directions, missing prices last, refinement and vault filters passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
