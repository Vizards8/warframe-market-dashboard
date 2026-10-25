'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),zlib=require('node:zlib');
const path=require('node:path'),crypto=require('node:crypto').webcrypto;
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'static/reward-ocr-assets.js'),'utf8');
function setup({badMirror=false,allBad=false,cache=new Map()}={}){
 const requests=[],blobs=new Map();let id=0;
 const sandbox={module:{exports:{}},TextDecoder,Uint8Array,Map,URL:{createObjectURL:blob=>{const url='blob:test/'+(++id);blobs.set(url,blob);return url;}},Blob,Response,TransformStream,DecompressionStream,AbortController,crypto,setTimeout,clearTimeout,
 caches:{open:async()=>({match:async key=>cache.get(key)?.clone(),put:async(key,response)=>cache.set(key,response)})},
 fetch:async(url,options)=>{requests.push({url,options});if(allBad||badMirror&&url.startsWith('https://registry.'))return new Response('bad');const name=url.split('/').pop();return new Response(fs.readFileSync(path.join(root,'static/ocr/v5',name)));}};
 vm.runInNewContext(source,sandbox);
 return {api:sandbox.module.exports,requests,blobs,cache};
}
function tar(entries){
 return Buffer.concat([...entries.flatMap(([name,data])=>{const header=Buffer.alloc(512);header.write(name);header.write(data.length.toString(8).padStart(11,'0'),124);return [header,data,Buffer.alloc((512-data.length%512)%512)];}),Buffer.alloc(1024)]);
}
(async()=>{
 const s=setup({badMirror:true}),messages=[];
 const ready=await s.api.prepare('https://example.test/ocr/','eng',{source:'mirror',onProgress:x=>messages.push(x)});
 assert.equal(ready.langs,'eng');assert.equal(s.requests.length,8); // Every invalid mirror response falls back to a verified local file.
 assert.ok(s.requests.every(r=>r.options.credentials==='omit'&&r.options.referrerPolicy==='no-referrer'));
 assert.equal(s.cache.size,4);assert.ok(messages.some(x=>x.includes('切换来源')));
 await s.api.prepare('https://example.test/ocr/','eng',{source:'site'});assert.equal(s.requests.length,8);
 const cached=setup({cache:s.cache,allBad:true});await cached.api.prepare('https://example.test/ocr/','eng');assert.equal(cached.requests.length,0);
 await assert.rejects(setup({allBad:true}).api.prepare('https://example.test/ocr/','eng'),/校验失败/);
 const abort=new AbortController();abort.abort();const cancelled=setup();await assert.rejects(cancelled.api.prepare('https://example.test/ocr/','eng',{signal:abort.signal}),/取消/);assert.equal(cancelled.requests.length,0);
 // Model packages can be streamed with headers and data split over any network boundary.
 const body=Buffer.from('model '.repeat(3000)),packed=zlib.gzipSync(tar([['package/README',Buffer.from('skip')],['package/4.0.0_best_int/eng.traineddata.gz',body]]));
 for(const chunkSize of [1,37,1024]){
  let offset=0;const stream=new ReadableStream({pull(c){if(offset>=packed.length)c.close();else{c.enqueue(packed.subarray(offset,offset+chunkSize));offset+=chunkSize;}}});
  assert.deepEqual(Buffer.from(await s.api.tarFile(stream,'eng.traineddata.gz')),body);
 }
 await assert.rejects(s.api.tarFile(new Response(zlib.gzipSync(tar([['wrong',Buffer.from('no')]]))).body,'eng.traineddata.gz'),/没有所需文件/);
 assert.match(s.api.mirror('chi_sim.traineddata.gz'),/@tesseract.js-data\/chi_sim\/-\/chi_sim-1.0.0.tgz$/);
 // Replay the bootstrap alone: only downloaded model Blobs and embedded WASM are fetchable.
 const bootstrap=(await s.blobs.get(ready.workerURL).text()).split('\n')[0],fetched=[];
 const self={fetch:async(url)=>{fetched.push(url);return url;}};vm.runInNewContext(bootstrap,{self});
 await self.fetch('https://example.test/ocr/eng.traineddata.gz');assert.match(fetched[0],/^blob:test\//);
 await self.fetch('data:application/octet-stream;base64,AA==');assert.equal(fetched.length,2);
 assert.throws(()=>self.fetch('https://unconfigured.test/model'),/未配置/);
 console.log('OCR assets: verified fallback, cache reuse, cancellation, streamed tar and restricted worker resource loading passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
