'use strict';
// Download only fixed OCR dependencies. No screenshots, account data or tokens are sent.
const RewardOcrAssets=(()=>{
  const files={"tesseract.min.js": {"hash": "a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8", "package": "tesseract.js@5.1.1"}, "worker.min.js": {"hash": "aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc", "package": "tesseract.js@5.1.1"}, "tesseract-core-lstm.wasm.js": {"hash": "8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa", "package": "tesseract.js-core@5.1.1"}, "eng.traineddata.gz": {"hash": "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91", "package": "@tesseract.js-data/eng@1.0.0"}, "chi_sim.traineddata.gz": {"hash": "b8a23f10c7de500891eb458a8adc9cc58ab7f242f08b7d149f5e9aea4ad5db7c", "package": "@tesseract.js-data/chi_sim@1.0.0"}};
  const memory=new Map(),decoder=new TextDecoder();
  const cancelled=signal=>{if(signal?.aborted)throw new Error('加载已取消');};
  function mirror(name){
    const pkg=files[name].package,at=pkg.lastIndexOf('@'),key=pkg.slice(0,at),version=pkg.slice(at+1);
    return name.endsWith('.gz')?`https://registry.npmmirror.com/${key}/-/${key.split('/').pop()}-${version}.tgz`:`https://registry.npmmirror.com/${key}/${version}/files/${key==='tesseract.js'?'dist/':''}${name}`;
  }
  async function verify(bytes,name){
    const sum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if(sum!==files[name].hash)throw new Error(name+' 校验失败，未使用下载内容');
    return bytes;
  }
  // The requested best_int model is the first entry. Stop after it instead of downloading the legacy model too.
  async function tarFile(stream,name){
    const reader=stream.pipeThrough(new DecompressionStream('gzip')).getReader();
    let pending=new Uint8Array(),skip=0,target=false,size=0,total=0;
    try{while(true){
      const {value,done}=await reader.read();if(done)break;
      total+=value.length;if(total>128*1024*1024)throw new Error('模型包超出大小限制');
      const joined=new Uint8Array(pending.length+value.length);joined.set(pending);joined.set(value,pending.length);pending=joined;
      while(true){
        if(target){if(pending.length>=size)return pending.slice(0,size);break;}
        if(skip){const take=Math.min(skip,pending.length);skip-=take;pending=pending.slice(take);if(skip||!pending.length)break;}
        if(pending.length<512)break;
        const filename=decoder.decode(pending.subarray(0,100)).replace(/\0.*$/s,'');
        size=parseInt(decoder.decode(pending.subarray(124,136)).replace(/\0.*$/s,'').trim(),8)||0;
        if(!filename)throw new Error('镜像模型包中没有所需文件');
        target=filename==='package/4.0.0_best_int/'+name;
        skip=Math.ceil(size/512)*512;pending=pending.slice(512);
        if(target){if(pending.length>=size)return pending.slice(0,size);break;}
      }
    }}finally{await reader.cancel().catch(()=>{});}
    throw new Error('镜像模型包不完整');
  }
  async function download(url,name,{signal,onProgress},archive){
    cancelled(signal);const control=new AbortController();let timer;
    const abort=()=>control.abort();signal?.addEventListener('abort',abort,{once:true});
    const reset=()=>{clearTimeout(timer);timer=setTimeout(abort,15000);};reset();
    try{
      const response=await fetch(url,{signal:control.signal,credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok||!response.body)throw new Error('HTTP '+response.status);
      const length=Number(response.headers.get('content-length'))||0;let loaded=0;
      const stream=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
        reset();loaded+=chunk.length;if(loaded>64*1024*1024)throw new Error('下载资源过大');
        onProgress?.(`${url.startsWith('https://registry.npmmirror.com/')?'国内镜像':'本站'} · ${name} ${(loaded/1048576).toFixed(1)}${length?'/'+(length/1048576).toFixed(1):''} MB`);controller.enqueue(chunk);
      }}));
      return await verify(archive?await tarFile(stream,name):new Uint8Array(await new Response(stream).arrayBuffer()),name);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);control.abort();}
  }
  async function asset(base,name,options){
    cancelled(options.signal);if(memory.has(name))return memory.get(name);
    const key=base+name+'?sha256='+files[name].hash;
    let cache;try{cache=await caches.open('void-ocr-assets-v1');const hit=await cache.match(key);if(hit){const bytes=await verify(new Uint8Array(await hit.arrayBuffer()),name);memory.set(name,bytes);return bytes;}}catch{ /* Cache is optional in private mode. */ }
    const sources=options.source==='mirror'?['mirror','site']:['site','mirror'];let bytes,error;
    for(const source of sources){
      cancelled(options.signal);
      try{options.onProgress?.(`正在下载 ${name}（${source==='site'?'本站':'国内镜像'}）…`);bytes=await download(source==='site'?base+name:mirror(name),name,options,source==='mirror'&&name.endsWith('.gz'));break;}
      catch(e){cancelled(options.signal);error=e;options.onProgress?.(`${name} 下载失败，正在切换来源…`);}
    }
    if(!bytes)throw new Error(name+' 下载失败：'+error.message+'；可切换下载来源重试');
    cancelled(options.signal);memory.set(name,bytes);try{await cache?.put(key,new Response(bytes));}catch{ /* Keep the in-memory copy when persistent storage is unavailable. */ }
    return bytes;
  }
  const urls=new Map();
  async function prepare(base,language,options={}){
    const names=['tesseract.min.js','worker.min.js','tesseract-core-lstm.wasm.js',...language.split('+').map(code=>code+'.traineddata.gz')];
    const data={};for(let i=0;i<names.length;i++){const name=names[i];data[name]=await asset(base,name,{...options,onProgress:message=>options.onProgress?.(`准备 OCR ${i+1}/${names.length} · ${message}`)});}
    cancelled(options.signal);
    const url=name=>{if(!urls.has(name))urls.set(name,URL.createObjectURL(new Blob([data[name]],{type:name.endsWith('.gz')?'application/gzip':'text/javascript'}))+'#'+name);return urls.get(name);};
    const modelURLs=Object.fromEntries(language.split('+').map(code=>[base+code+'.traineddata.gz',url(code+'.traineddata.gz')]));
    const workerKey=base+language;
    if(!urls.has(workerKey)){
      // Give the engine downloaded model Blobs, so its worker never falls back to an external CDN.
      const bootstrap=`{const models=${JSON.stringify(modelURLs)},fetchModel=self.fetch.bind(self);self.fetch=(input,options)=>{const url=typeof input==='string'?input:input.url;if(url.startsWith('data:application/octet-stream;base64,'))return fetchModel(url,options);if(!models[url])throw new Error('OCR 请求了未配置的资源');return fetchModel(models[url],options);};}\n`;
      urls.set(workerKey,URL.createObjectURL(new Blob([bootstrap,data['worker.min.js']],{type:'text/javascript'})));
    }
    return {scriptURL:url('tesseract.min.js'),workerURL:urls.get(workerKey),coreURL:url('tesseract-core-lstm.wasm.js'),langs:language,langPath:base};
  }
  return {prepare,tarFile,mirror};
})();
if(typeof module!=='undefined')module.exports=RewardOcrAssets;
