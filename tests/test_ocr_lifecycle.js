'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const core=require('../static/reward-ocr-core.js');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function setup({items=[],relics={items:[]},recognitions=null}={}){
 const nodes=new Map(),events={},trackEvents={},timers=new Map();let stopped=0,terminated=0,closedFrames=0,nextTimer=1,captured=0,recognized=0;
 const pendingShare=deferred(),pendingRecognize=deferred();
 const context={drawImage(){},fillRect(){},strokeRect(){},fillText(){},clearRect(){},getImageData(x,y,w,h){return {width:w,height:h,data:new Uint8ClampedArray(Math.max(1,w*h*4))};},putImageData(){},imageSmoothingEnabled:true};
 function node(id){if(!nodes.has(id))nodes.set(id,{value:{'ocr-left':'0','ocr-right':'100','ocr-top':'20','ocr-bottom':'65','ocr-count':'4','ocr-language':'eng'}[id]||'',hidden:false,disabled:false,innerHTML:'',textContent:'',addEventListener(){},prepend(){},getContext:()=>context});return nodes.get(id);}
 const track={stop(){stopped++;},addEventListener:(name,fn)=>{trackEvents[name]=fn;}};
 const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
 const worker={setParameters:async()=>{},recognize:()=>{const index=recognized++;return recognitions?Promise.resolve(recognitions[index%recognitions.length]):pendingRecognize.promise;},terminate:async()=>{terminated++;}};
 const sandbox={URL,console,AbortController,RewardOcrCore:core,RewardOcrAssets:{prepare:async()=>({langs:[],scriptURL:"",workerURL:"",coreURL:""})},document:{currentScript:{src:'http://localhost/reward-ocr.js'},getElementById:node,createElement:type=>type==='video'?{muted:false,playsInline:false,readyState:2,play:async()=>{},pause(){}}:node('created-'+type),addEventListener(){},head:{append(){}}},
 navigator:{mediaDevices:{getDisplayMedia:()=>pendingShare.promise}},createImageBitmap:async()=>{captured++;return {width:1920,height:1080,close(){closedFrames++;}};},
 setTimeout:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
 Tesseract:{createWorker:async()=>worker},DeskCore:{target:()=>({value:null,valid:false})},mrow:()=>({}),esc:x=>String(x),timeLabel:()=>'',tab:'relics'};
 sandbox.window=sandbox;sandbox.addEventListener=(name,fn)=>{events[name]=fn;};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../static/reward-ocr.js'),'utf8'),sandbox);
 sandbox.RewardOcr.mount(items,relics);
 return {sandbox,node,stream,pendingShare,pendingRecognize,trackEvents,timers,stopped:()=>stopped,terminated:()=>terminated,closedFrames:()=>closedFrames,captured:()=>captured,recognized:()=>recognized};
}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
(async()=>{
 // A chooser may resolve after the user navigates away. Never start capture then.
 let s=setup(),start=s.node('ocr-share').onclick();s.sandbox.RewardOcr.leave();s.pendingShare.resolve(s.stream);await start;
 assert.equal(s.stopped(),1);assert.equal(s.timers.size,0);
 // Cancel while a frame is being OCR'd: stop tracks, terminate worker, ignore late results.
 s=setup();start=s.node('ocr-share').onclick();s.pendingShare.resolve(s.stream);await start;
 const run=s.node('ocr-run').onclick();await flush();
 assert.equal(s.node('ocr-file').disabled,true);s.node('ocr-stop').onclick();
 s.pendingRecognize.resolve({data:{lines:[{text:'Forma Blueprint'}]}});await run;
 assert.equal(s.stopped(),1);assert.equal(s.terminated(),1);assert.equal(s.closedFrames(),1);
 assert.equal(s.node('ocr-results').innerHTML,'');assert.equal(s.timers.size,0);
 // Native browser Stop sharing follows the same cleanup path.
 s=setup();start=s.node('ocr-share').onclick();s.pendingShare.resolve(s.stream);await start;const interrupted=s.node('ocr-run').onclick();await flush();s.trackEvents.ended();
 s.pendingRecognize.resolve({data:{lines:[]}});await interrupted;
 assert.equal(s.stopped(),1);assert.match(s.node('ocr-status').textContent,/停止屏幕共享/);assert.equal(s.timers.size,0);
 // Sharing alone never extracts a frame or starts OCR. Each click is one four-slot batch.
 s=setup();start=s.node('ocr-share').onclick();s.pendingShare.resolve(s.stream);await start;await flush();
 assert.equal(s.captured(),0);assert.equal(s.recognized(),0);assert.equal(s.timers.size,0);
 assert.equal(s.node('ocr-run').disabled,false);
 const once=s.node('ocr-run').onclick();await flush();assert.equal(s.node('ocr-run').disabled,true);
 await s.node('ocr-run').onclick();assert.equal(s.captured(),1); // duplicate click ignored
 s.pendingRecognize.resolve({data:{lines:[{text:'Forma Blueprint'}]}});await once;
 assert.equal(s.recognized(),4);assert.equal(s.captured(),1);assert.equal(s.node('ocr-run').disabled,false);
 assert.equal(s.timers.size,0);await flush();assert.equal(s.recognized(),4);
 await s.node('ocr-run').onclick();assert.equal(s.recognized(),8);assert.equal(s.captured(),2);
 assert.equal(s.closedFrames(),1);assert.equal(s.timers.size,0);
 s.sandbox.RewardOcr.leave();assert.equal(s.stopped(),1);assert.equal(s.closedFrames(),2);
 // Cancelling model preparation aborts its network request and does not create an engine.
 s=setup();let downloadSignal,engines=0;
 s.sandbox.RewardOcrAssets.prepare=(_base,_language,options)=>new Promise((resolve,reject)=>{downloadSignal=options.signal;options.signal.addEventListener('abort',()=>reject(new Error('cancelled')));});
 s.sandbox.Tesseract.createWorker=async()=>{engines++;};
 const preparation=s.node('ocr-prepare').onclick();await flush();assert.equal(s.node('ocr-prepare').disabled,true);
 s.node('ocr-stop').onclick();await preparation;assert.equal(downloadSignal.aborted,true);assert.equal(engines,0);assert.equal(s.timers.size,0);assert.equal(s.node('ocr-prepare').disabled,false);
 // A failed preparation reports a string error and can be retried; switching languages recreates the worker.
 s=setup();const create=s.sandbox.Tesseract.createWorker;let attempts=0;
 s.sandbox.Tesseract.createWorker=async()=>{if(!attempts++)throw 'model failure';return create();};
 await s.node('ocr-prepare').onclick();assert.match(s.node('ocr-status').textContent,/model failure/);assert.equal(s.node('ocr-prepare').disabled,false);
 await s.node('ocr-prepare').onclick();assert.match(s.node('ocr-status').textContent,/已就绪/);
 s.node('ocr-language').value='chi_sim+eng';s.node('ocr-language').onchange();assert.equal(s.terminated(),1);
 await s.node('ocr-prepare').onclick();assert.equal(attempts,3);assert.equal(s.timers.size,0);
 // Zero recognized rewards keep the source preview visible and report captured pixels, not monitor size.
 s=setup();start=s.node('ocr-share').onclick();s.pendingShare.resolve(s.stream);await start;
 const empty=s.node('ocr-run').onclick();await flush();s.pendingRecognize.resolve({data:{text:'',lines:[]}});await empty;
 assert.equal(s.node('ocr-preview-details').open,true);assert.match(s.node('ocr-status').textContent,/1920 × 1080/);assert.match(s.node('ocr-status').textContent,/实际裁剪/);
 assert.match(s.node('ocr-frame-info').textContent,/屏幕共享/);
 s.node('ocr-ui-scale').value='80';s.node('ocr-ui-scale').onchange();assert.equal(s.node('ocr-area-mode').value,'auto');
 s.node('ocr-ui-scale').value='0';await s.node('ocr-run').onclick();assert.match(s.node('ocr-status').textContent,/60–150/);
 s.sandbox.RewardOcr.leave();assert.equal(s.node('ocr-frame-info').textContent,'');
 // Previously entered relics must not exclude correct OCR names or manual corrections.
 const catalog=[
  {slug:'dual_zoren_prime_handle',name:'佐伦双斧 Prime 握柄'},
  {slug:'bronco_prime_barrel',name:'野马 Prime 枪管'},
  {slug:'kompressa_prime_blueprint',name:'卡帕压力枪 Prime 蓝图'},
  {slug:'yareli_prime_chassis_blueprint',name:'Yareli Prime 机体 蓝图'}
 ];
 const raw=['佐伦双莽 Prime 握柄',...catalog.slice(1).map(x=>x.name)];
 s=setup({items:catalog,relics:{items:[{grades:{intact:catalog.map(x=>({...x,tradable:true}))}}]},recognitions:raw.map(text=>({data:{text}}))}); // text-only engine output is valid too.
 s.sandbox.RewardOcr.setCandidates([catalog[3]]);
 start=s.node('ocr-share').onclick();s.pendingShare.resolve(s.stream);await start;await s.node('ocr-run').onclick();
 for(const x of catalog)assert.ok(s.node('ocr-results').innerHTML.includes('<h3>'+x.name+'</h3>'),x.name);
 assert.match(s.node('ocr-results').innerHTML,/近似匹配，确认名称后再比较/);
 assert.match(s.node('ocr-results').innerHTML,/不在已填遗物/);
 assert.match(s.node('ocr-candidate-status').textContent,/仅作核对/);
 s.sandbox.RewardOcr.leave();s.node('ocr-text').value=catalog[1].name+'\n'+catalog[2].name;
 s.node('ocr-match-text').onclick();for(const x of catalog.slice(1,3))assert.ok(s.node('ocr-results').innerHTML.includes('<h3>'+x.name+'</h3>'));
 console.log('OCR lifecycle: late permission, cancellation during recognition, browser stop, manual-only single-frame batches and resource cleanup passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
