'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const core=require('../static/reward-ocr-core.js');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function setup(){
 const nodes=new Map(),events={},trackEvents={},timers=new Map();let stopped=0,terminated=0,closedFrames=0,nextTimer=1;
 const pendingShare=deferred(),pendingRecognize=deferred();
 const context={drawImage(){},fillRect(){},strokeRect(){},fillText(){},clearRect(){}};
 function node(id){if(!nodes.has(id))nodes.set(id,{value:{'ocr-left':'0','ocr-right':'100','ocr-top':'20','ocr-bottom':'65','ocr-count':'4','ocr-language':'eng'}[id]||'',hidden:false,disabled:false,innerHTML:'',textContent:'',addEventListener(){},prepend(){},getContext:()=>context});return nodes.get(id);}
 const track={stop(){stopped++;},addEventListener:(name,fn)=>{trackEvents[name]=fn;}};
 const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
 const worker={setParameters:async()=>{},recognize:()=>pendingRecognize.promise,terminate:async()=>{terminated++;}};
 const sandbox={URL,console,RewardOcrCore:core,document:{currentScript:{src:'http://localhost/reward-ocr.js'},getElementById:node,createElement:type=>type==='video'?{muted:false,playsInline:false,readyState:2,play:async()=>{},pause(){}}:node('created-'+type),addEventListener(){},head:{append(){}}},
 navigator:{mediaDevices:{getDisplayMedia:()=>pendingShare.promise}},createImageBitmap:async()=>({width:1920,height:1080,close(){closedFrames++;}}),
 setTimeout:fn=>{const id=nextTimer++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
 Tesseract:{createWorker:async()=>worker},DeskCore:{target:()=>({value:null,valid:false})},mrow:()=>({}),esc:x=>String(x),timeLabel:()=>'',tab:'relics'};
 sandbox.window=sandbox;sandbox.addEventListener=(name,fn)=>{events[name]=fn;};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../static/reward-ocr.js'),'utf8'),sandbox);
 sandbox.RewardOcr.mount([],{items:[]});
 return {sandbox,node,stream,pendingShare,pendingRecognize,trackEvents,timers,stopped:()=>stopped,terminated:()=>terminated,closedFrames:()=>closedFrames};
}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
(async()=>{
 // A chooser may resolve after the user navigates away. Never start capture then.
 let s=setup(),start=s.node('ocr-share').onclick();s.sandbox.RewardOcr.leave();s.pendingShare.resolve(s.stream);await start;
 assert.equal(s.stopped(),1);assert.equal(s.timers.size,0);
 // Cancel while a frame is being OCR'd: stop tracks, terminate worker, ignore late results.
 s=setup();start=s.node('ocr-share').onclick();s.pendingShare.resolve(s.stream);await flush();
 assert.equal(s.node('ocr-file').disabled,true);s.node('ocr-stop').onclick();
 s.pendingRecognize.resolve({data:{lines:[{text:'Forma Blueprint'}]}});await start;
 assert.equal(s.stopped(),1);assert.equal(s.terminated(),1);assert.equal(s.closedFrames(),1);
 assert.equal(s.node('ocr-results').innerHTML,'');assert.equal(s.timers.size,0);
 // Native browser Stop sharing follows the same cleanup path.
 s=setup();start=s.node('ocr-share').onclick();s.pendingShare.resolve(s.stream);await flush();s.trackEvents.ended();
 s.pendingRecognize.resolve({data:{lines:[]}});await start;
 assert.equal(s.stopped(),1);assert.match(s.node('ocr-status').textContent,/停止屏幕共享/);assert.equal(s.timers.size,0);
 console.log('OCR lifecycle: late permission, cancellation during recognition, browser stop and resource cleanup passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
