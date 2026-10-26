'use strict';
(()=>{
  let built=false,rows=[],candidateRows=[],results=[],imageSource=null,worker=null,workerLanguage='',busy=false;
  let capture=null,video=null,generation=0,pip=null,resultAt=null,disposed=false,requesting=false;
  let loading=null;
  const byId=id=>document.getElementById(id),core=RewardOcrCore;
  const assets=new URL('ocr/v5/',window.Portable?'https://vizards8.github.io/warframe-market-dashboard/':document.currentScript?.src||location.href).href;
  const status=text=>{if(built)byId('ocr-status').textContent=text;};
  function layout(){
    if(byId('ocr-area-mode').value!=='manual'){
      const scale=Number(byId('ocr-ui-scale').value||100),offset=Number(byId('ocr-y-offset').value||0);
      if(!Number.isFinite(scale)||scale<60||scale>150||!Number.isFinite(offset)||Math.abs(offset)>15)throw new Error('卡位缩放范围为 60–150%，上下偏移范围为 -15–15%。');
      const v=core.rewardLayout(imageSource?.width||1920,imageSource?.height||1080,Number(byId('ocr-count').value),scale/100,offset/100);
      for(const n of ['left','top','right','bottom'])byId('ocr-'+n).value=(v[n]*100).toFixed(1);
      return v;
    }
    const names=['left','top','right','bottom'],v=Object.fromEntries(names.map(n=>[n,Number(byId('ocr-'+n).value)/100]));
    if(names.some(n=>!Number.isFinite(v[n])||v[n]<0||v[n]>1)||v.right-v.left<.05||v.bottom-v.top<.01)throw new Error('请调整识别区域，左右至少间隔 5%，上下至少间隔 1%。');
    return {...v,count:Number(byId('ocr-count').value)};
  }
  function syncControls(){
    if(!built)return;
    byId('ocr-run').disabled=busy||(!capture&&!imageSource);
    byId('ocr-run').textContent=busy?'识别中…':'识别一次';
    const pipRun=pip?.document.getElementById('ocr-pip-run');if(pipRun){pipRun.disabled=busy||(!capture&&!imageSource);pipRun.textContent=busy?'识别中…':'识别一次';}
    byId('ocr-file').disabled=busy||!!capture;
    byId('ocr-share').disabled=busy||!!capture||requesting;
    byId('ocr-stop').hidden=!capture&&!busy;
    byId('ocr-match-text').disabled=busy||!!capture;
    for(const name of ['left','right','top','bottom','count','language','area-mode','source','text-style','ui-scale','y-offset'])byId('ocr-'+name).disabled=busy;
    byId('ocr-prepare').disabled=busy;
  }
  function candidateStatus(){
    if(!candidateRows.length)return '识别会从全部奖励目录匹配，无需先填写遗物。';
    return `已填写遗物包含 ${candidateRows.length} 种掉落，仅作核对；识别和修正仍使用全部奖励目录。`;
  }
  function renderCandidateStatus(){const node=byId('ocr-candidate-status');if(node)node.textContent=candidateStatus();}
  function preview(){
    if(!imageSource)return;const c=byId('ocr-preview'),ctx=c.getContext('2d'),w=imageSource.width,h=imageSource.height;
    byId('ocr-frame-info').textContent=`实际画面 ${w} × ${h} · ${capture?'屏幕共享':'导入截图'} · ${byId('ocr-area-mode').value==='manual'?'手动区域':'卡位缩放 '+(byId('ocr-ui-scale').value||100)+'%'}。绿色框内应各有一个完整奖励名；全黑、空白或名称被截断时，请先调整区域。`;
    c.width=Math.min(w,1100);c.height=Math.round(h*c.width/w);ctx.drawImage(imageSource,0,0,c.width,c.height);const v=layout();
    ctx.fillStyle='#0008';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(imageSource,w*v.left,h*v.top,w*(v.right-v.left),h*(v.bottom-v.top),c.width*v.left,c.height*v.top,c.width*(v.right-v.left),c.height*(v.bottom-v.top));
    ctx.strokeStyle='#77f1bc';ctx.lineWidth=2;ctx.font='bold 18px sans-serif';
    for(let i=0;i<v.count;i++){const x=c.width*(v.left+(v.right-v.left)*i/v.count),y=c.height*v.top,sw=c.width*(v.right-v.left)/v.count,sh=c.height*(v.bottom-v.top);ctx.strokeRect(x,y,sw,sh);ctx.fillStyle='#77f1bc';ctx.fillText(String(i+1),x+8,y+23);}
  }
  function prepareCrop(source,x,y,w,h){
    const scale=byId('ocr-text-style').value==='light'?Math.min(3,3000/Math.max(w,h)):1;
    const c=document.createElement('canvas');c.width=Math.round(w*scale);c.height=Math.round(h*scale);
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,x,y,w,h,0,0,c.width,c.height);
    const pixels=ctx.getImageData(0,0,c.width,c.height),data=pixels.data;
    if(byId('ocr-text-style').value!=='light'){
      core.textMask(pixels);const lines=core.titleLines(pixels);ctx.putImageData(pixels,0,0);
      if(lines.length){
        // Join wrapped titles (e.g. 蓝 / 图) into one line, keep the glyphs at OCR-friendly size.
        const height=42,pad=12,width=Math.ceil(lines.reduce((sum,b)=>sum+b.width*height/b.height+8,0)+pad*2);
        const out=document.createElement('canvas');out.width=width;out.height=height+pad*2;
        const target=out.getContext('2d');target.fillStyle='#fff';target.fillRect(0,0,out.width,out.height);let offset=pad;
        for(const b of lines){const scaled=b.width*height/b.height;target.drawImage(c,b.x,b.y,b.width,b.height,offset,pad,scaled,height);offset+=scaled+8;}
        return out;
      }
      return c;
    }
    for(let i=0;i<data.length;i+=4){
      const luminance=data[i]*.299+data[i+1]*.587+data[i+2]*.114;
      const contrast=Math.max(0,Math.min(255,(luminance-55)*1.75+25));
      data[i]=data[i+1]=data[i+2]=contrast;
    }
    ctx.putImageData(pixels,0,0);return c;
  }
  async function acceptImage(file){
    if(busy||capture)return status('请先停止共享，再导入截图。');
    if(!file||!file.type.startsWith('image/'))return status('请选择截图图片。');
    if(file.size>20*1024*1024)return status('图片过大，请使用 20 MB 以内的截图。');
    try{const next=await createImageBitmap(file);if(next.width*next.height>40000000){next.close();throw new Error('图片分辨率过大，请使用普通游戏截图。');}imageSource?.close();imageSource=next;results=[];resultAt=null;render();byId('ocr-preview-details').hidden=false;byId('ocr-preview-details').open=true;preview();syncControls();status('截图已载入。检查绿色区域是否覆盖完整奖励名称，每格一个奖励，再点识别。');}catch(e){status('图片读取失败：'+e.message);}
  }
  function loadScript(url){return new Promise((resolve,reject)=>{
    if(window.Tesseract)return resolve();const s=document.createElement('script');
    const timeout=setTimeout(()=>{s.remove();reject(new Error('OCR 组件下载超时，请检查网络后重试'));},30000);
    s.src=url;
    s.onload=()=>{clearTimeout(timeout);resolve();};s.onerror=()=>{clearTimeout(timeout);s.remove();reject(new Error('OCR 组件下载失败，请检查网络后重试'));};document.head.append(s);
  });}
  async function engine(session){
    const language=byId('ocr-language').value;
    if(worker&&workerLanguage!==language){await worker.terminate().catch(()=>{});worker=null;workerLanguage='';}
    if(worker)return worker;
    loading=new AbortController();
    const ready=await RewardOcrAssets.prepare(assets,language,{source:byId('ocr-source').value,signal:loading.signal,onProgress:message=>{if(session===generation)status(message);}});
    if(session!==generation)throw new Error('识别已取消');await loadScript(ready.scriptURL);if(session!==generation)throw new Error('识别已取消');
    let timeout;const starting=Tesseract.createWorker(ready.langs,1,{workerPath:ready.workerURL,workerBlobURL:false,corePath:ready.coreURL,langPath:ready.langPath,cacheMethod:'none',errorHandler:()=>{},logger:m=>{if(session===generation&&busy&&m.status!=='recognizing text')status(`初始化 OCR：${m.status} ${Math.round((m.progress||0)*100)}%`);}});
    let next;try{next=await Promise.race([starting,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('OCR 模型加载超时，请检查网络或改用英文识别')),120000);})]);}catch(e){starting.then(w=>w.terminate()).catch(()=>{});throw e;}finally{clearTimeout(timeout);}
    if(session!==generation){await next.terminate();throw new Error('识别已取消');}
    worker=next;workerLanguage=language;await worker.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'});return worker;
  }
  async function prepareEngine(){
    if(busy)return;const session=generation;busy=true;syncControls();
    try{await engine(session);if(session===generation)status('OCR 已就绪。组件和模型已缓存；奖励出现后点击“识别一次”。');}
    catch(e){if(session===generation){if(worker)await worker.terminate().catch(()=>{});worker=null;workerLanguage='';status('OCR 准备失败：'+(e?.message||String(e)));}}
    finally{if(session===generation){busy=false;syncControls();}}
  }
  async function recognize(){
    if((!capture&&!imageSource)||busy)return false;let v;try{v=layout();}catch(e){status(e.message);return false;}
    const session=generation;busy=true;syncControls();byId('ocr-progress').hidden=false;byId('ocr-progress').value=0;
    // Never mix rewards from two captured frames while a new recognition is incomplete.
    results=[];resultAt=null;render();
    try{
      if(capture){
        if(!video||video.readyState<2)throw new Error('共享画面尚未准备好，请稍后再点识别一次');
        const source=await createImageBitmap(video);
        if(session!==generation){source.close();return false;}
        imageSource?.close();imageSource=source;
        byId('ocr-preview-details').hidden=false;preview();
      }
      const ocr=await engine(session);if(session!==generation)return false;
      await ocr.setParameters({tessedit_pageseg_mode:byId('ocr-text-style').value==='light'?'6':'7'});if(session!==generation)return false;
      v=layout();
      const w=imageSource.width,h=imageSource.height,next=[];
      for(let i=0;i<v.count;i++){
        if(session!==generation)return false;
        status(`正在本机识别第 ${i+1}/${v.count} 个奖励…`);
        const sw=w*(v.right-v.left)/v.count,sh=h*(v.bottom-v.top),c=prepareCrop(imageSource,w*v.left+i*sw,h*v.top,sw,sh);
        const r=await ocr.recognize(c);if(session!==generation)return false;
        const lines=(r.data.lines?.length?r.data.lines.map(x=>x.text):String(r.data.text||'').split(/\n/)).map(x=>x.trim()).filter(Boolean);next.push({...core.slot(lines,rows),rawText:r.data.text||lines.join('\n'),crop:c.toDataURL?.('image/png')||''});byId('ocr-progress').value=(i+1)/v.count*100;
      }
      results=next;resultAt=new Date();const matched=next.filter(r=>r.status==='exact'||r.status==='probable').length;byId('ocr-preview-details').open=matched===0;render();
      if(!matched){status(`本次未匹配到奖励。实际画面 ${w} × ${h}。请展开“识别原文 / 实际裁剪”，检查名称是否完整；绿色框偏位时调整卡位缩放或手动区域，黑白裁剪没有文字时检查游戏文字颜色。`);return true;}
      status(`识别完成；需要更新时再点“识别一次”。已按全部奖励目录匹配。保持游戏从左到右顺序；请核对名称。模糊结果需确认，缺价不代表 0p。`);return true;
    }catch(e){
      if(session===generation){if(worker)await worker.terminate().catch(()=>{});worker=null;workerLanguage='';status('识别失败：'+(e?.message||String(e))+'。可以重试或输入奖励名。');}return false;
    }finally{if(session===generation){busy=false;syncControls();renderPip();}}
  }
  function stopSharing(message='已停止共享和识别。'){
    generation++;
    loading?.abort();loading=null;
    const previous=capture;capture=null;previous?.getTracks().forEach(t=>t.stop());
    if(video){video.pause();video.srcObject=null;video=null;}
    if(worker){worker.terminate().catch(()=>{});worker=null;workerLanguage='';}
    busy=false;results=[];resultAt=null;imageSource?.close();imageSource=null;
    if(built){byId('ocr-preview').getContext('2d').clearRect(0,0,byId('ocr-preview').width,byId('ocr-preview').height);byId('ocr-progress').hidden=true;byId('ocr-frame-info').textContent='';render();syncControls();status(message);}
  }
  async function startSharing(){
    if(capture||busy||requesting)return;
    if(!navigator.mediaDevices?.getDisplayMedia)return status('此浏览器不支持屏幕共享。请用桌面 Chrome / Edge，或导入截图识别。');
    // Must run directly inside the click handler, before downloading any OCR resources.
    let local;const requested=generation;requesting=true;syncControls();
    try{
      local=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:1,max:2}},audio:false});
      if(disposed||requested!==generation){local.getTracks().forEach(t=>t.stop());return;}
      stopSharing('已授权共享，正在准备画面…');capture=local;const session=generation;
      video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=local;
      local.getVideoTracks()[0].addEventListener('ended',()=>{if(capture===local)stopSharing('你已停止屏幕共享，识别已结束。');});
      await video.play();if(session!==generation)return;
      syncControls();renderPip();status('已共享，等待你点击“识别一次”。奖励出现后再点按钮，每次只识别当前画面，不会自动重复。');
    }catch(e){local?.getTracks().forEach(t=>t.stop());if(capture===local)stopSharing();status(e.name==='NotAllowedError'?'未开启共享。你可以重新授权，或直接粘贴截图。':'无法共享画面：'+e.message);}finally{requesting=false;syncControls();}
  }
  async function openPip(){
    if(!window.documentPictureInPicture?.requestWindow)return status('当前浏览器不支持网页悬浮窗，请在副屏显示此页，或使用较新的 Chrome / Edge。');
    try{
      const session=generation,next=await documentPictureInPicture.requestWindow({width:850,height:320});
      if(session!==generation||disposed){next.close();return;}pip=next;
      pip.document.title='虚空账本 · 奖励价格';
      const style=pip.document.createElement('style');style.textContent='body{background:#14251e;color:#e0f2e5;font:14px system-ui;margin:14px}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.card{padding:12px;border:1px solid #406454;border-radius:6px}.best{border:2px solid #88e5a8}h3{font-size:14px;min-height:42px}strong{font-size:28px;color:#8de8b3}p,small{font-size:11px;line-height:1.6}';pip.document.head.append(style);
      pip.addEventListener('pagehide',()=>{pip=null;});renderPip();status('悬浮价格窗已打开；奖励出现后，可在窗内点击“识别一次”。独占全屏可能无法覆盖显示。');
    }catch(e){status('悬浮窗未打开：'+e.message+'。可在副屏查看网页。');}
  }
  function quotes(){return core.compare(results,slug=>DeskCore.target(mrow(slug),'sell'));}
  function renderPip(){
    if(!pip||pip.closed)return;const compared=quotes();
    pip.document.body.innerHTML=`<button id="ocr-pip-run" ${busy||(!capture&&!imageSource)?'disabled':''}>${busy?'识别中…':'识别一次'}</button><p>虚空账本 · ${resultAt?'画面识别 '+resultAt.toLocaleTimeString():'等待识别'} · 按游戏从左到右排列</p><div class="cards">${compared.map((r,i)=>`<article class="card ${r.best?'best':''}"><small>游戏第 ${i+1} 格</small><h3>${esc(r.item?.name||'未确认')}</h3><strong>${esc(r.display)}</strong><p>${esc(r.note)}</p><small>${r.item?.tradable?'报价 '+esc(timeLabel(mrow(r.item.slug).orders_at)):''}</small></article>`).join('')}</div><p>请核对名称。挂价非成交价；模糊匹配和旧价不参与最高价提示。${busy?'正在识别当前画面':capture?'共享已连接 · 点击按钮才识别':'当前未共享屏幕'}</p>`;
    pip.document.getElementById('ocr-pip-run').onclick=()=>recognize();
  }
  function render(){
    if(!built)return;
    byId('ocr-results').innerHTML=quotes().map((r,i)=>{
      const item=r.item,name=item?.name||(r.status==='ambiguous'?'请确认奖励':'未识别，请手动查找');
      // Exact matches need no unrelated fuzzy alternatives; search remains available for correction.
      const candidates=r.status==='exact'?[]:(r.candidates||[]).map(x=>x.item);
      return `<article class="ocr-result ${r.best?'ocr-best':''}"><span class="ocr-slot">游戏第 ${i+1} 格 ${r.best?'· 已确认奖励中挂价最高':''}</span><h3>${esc(name)}</h3><strong class="ocr-price">${esc(r.display)}</strong><p>${esc(r.note)}</p>${item&&candidateRows.length&&!candidateRows.some(x=>x.slug===item.slug)?'<p class="ocr-scope-note">不在已填遗物的掉落中，请核对遗物或名称。</p>':''}<small>${item?.tradable?'报价 '+esc(timeLabel(mrow(item.slug).orders_at)):''}</small><p class="ocr-match-state">${r.status==='probable'?'近似匹配，确认名称后再比较':r.status==='exact'?'名称已匹配；仍请对照游戏核对':'请选择候选或输入完整奖励名'}</p><input data-ocr-search="${i}" value="${esc(r.search||'')}" placeholder="手动修正 / 查找奖励" aria-label="第 ${i+1} 格奖励搜索"><div class="ocr-candidates">${candidates.map(x=>`<button data-ocr-slot="${i}" data-ocr-choice="${esc(x.slug)}">${esc(x.name)}</button>`).join('')}</div><details><summary>识别原文 / 实际裁剪</summary><p>${esc(r.rawText||r.text||'没有可用文字')}</p>${r.crop?`<img class="ocr-crop-image" src="${r.crop}" alt="第 ${i+1} 格实际送入 OCR 的图片">`:''}</details></article>`;
    }).join('');renderPip();
  }
  function mount(items,relics){
    rows=core.catalog(items,relics);candidateRows=[];if(built){renderCandidateStatus();return;}built=true;
    const panel=document.createElement('section');panel.className='ocr-panel';panel.id='reward-ocr-panel';
    panel.innerHTML=`<div class="ocr-heading"><div><h2>截图识别奖励</h2><p>共享游戏画面后，奖励出现时点击“识别一次”。只处理截图，不读取游戏内存。</p></div><button id="ocr-pip" class="plain-button">↗ 悬浮价格窗</button></div>
      <div class="ocr-share-controls"><button id="ocr-share" class="primary">共享游戏画面</button><button id="ocr-stop" class="plain-button" hidden>停止共享 / 取消识别</button><span>选择游戏窗口或游戏所在屏幕，不要选择本站标签页。</span></div>
      <details class="ocr-help"><summary>如何在游戏中查看？隐私与浏览器限制</summary><p>点击共享，手动选择游戏窗口或屏幕。共享后保持待命，不自动截图或运行 OCR。奖励出现后在网页或悬浮窗点击“识别一次”，才提取当前画面并识别；下次需要时再点。屏幕共享流在你停止共享前仍保持连接。Chrome / Edge 可尝试“悬浮价格窗”，也可把网页放在副屏。无边框模式较适合；独占全屏可能无法截取或显示悬浮窗。浏览器在后台可能限速，不能保证游戏内即时识别。</p><p>网页无法监听游戏里的全局快捷键，也不能绕过屏幕共享授权。关闭网页、切离开核桃页签或点击停止会结束共享。截图不上传、不写入库存，只在本机内存处理；首次联网下载固定版本组件与模型，支持国内镜像及本站，下载后缓存在浏览器，不安装客户端。</p><p>不方便共享时，可用 Windows 截图工具全屏截图，切回此页按 Ctrl + V。先校准绿色区域，让每格覆盖完整奖励名称。默认按居中奖励卡定位并提取蓝字。其他 UI 缩放或文字颜色可手动校准；近似结果仍需核对。</p></details>
      <div class="ocr-inputs"><label class="plain-button">选择奖励截图 <input id="ocr-file" type="file" accept="image/*"></label><span>或在此页面按 Ctrl + V 粘贴截图</span><button class="plain-button" id="ocr-text-mode">只输入奖励名称</button></div>
      <div id="ocr-image-area"><div class="ocr-layout"><label>下载来源 <select id="ocr-source"><option value="mirror">国内镜像优先</option><option value="site">本站优先</option></select></label><button id="ocr-prepare" class="plain-button">提前准备 OCR</button><label>识别区域 <select id="ocr-area-mode"><option value="auto">居中奖励卡</option><option value="manual">手动校准</option></select></label><label>游戏文字 <select id="ocr-text-style"><option value="cyan">蓝色文字</option><option value="light">其他颜色</option></select></label><label>奖励数 <select id="ocr-count">${[4,3,2,1].map(n=>`<option>${n}</option>`).join('')}</select></label><label>文字 <select id="ocr-language"><option value="chi_sim+eng">中文 + 英文</option><option value="eng">仅英文（加载更快）</option></select></label><button id="ocr-run" class="primary" disabled>识别一次</button><details class="ocr-crop-settings"><summary>调整识别区域</summary><div><label>卡位缩放 % <input id="ocr-ui-scale" type="number" min="60" max="150" value="100"></label><label>上下偏移 % <input id="ocr-y-offset" type="number" min="-15" max="15" value="0" step="0.5"></label><span>按绿色框校准；这里的百分比不等于 Windows 显示缩放。</span>${[['left','左',24.8],['right','右',75.2],['top','上',37.5],['bottom','下',44]].map(([key,name,value])=>`<label>${name}边 % <input id="ocr-${key}" type="number" min="0" max="100" value="${value}"></label>`).join('')}</div></details></div><p id="ocr-candidate-status" class="ocr-candidate-status">${candidateStatus()}</p><details id="ocr-preview-details" hidden><summary>预览 / 校准识别区域</summary><p id="ocr-frame-info"></p><canvas id="ocr-preview" aria-label="奖励识别区域预览"></canvas></details></div>
      <div id="ocr-text-area" hidden><p>每行一个奖励，顺序可以乱；最多四行。匹配后可用“快速查奖励”核对来源。</p><textarea id="ocr-text" rows="4" aria-label="四个奖励名称" placeholder="例如：Ash Prime Systems Blueprint"></textarea><button id="ocr-match-text" class="plain-button">匹配并查价</button></div><progress id="ocr-progress" max="100" value="0" hidden></progress><p id="ocr-status" role="status">价格使用本站公开行情快照；旧值和模糊结果不参与最高价提示。</p><div id="ocr-results" class="ocr-results"></div>`;
    byId('relic-section').prepend(panel);
    byId('ocr-prepare').onclick=prepareEngine;byId('ocr-file').onchange=e=>acceptImage(e.target.files[0]);byId('ocr-run').onclick=()=>recognize();byId('ocr-share').onclick=startSharing;byId('ocr-stop').onclick=()=>stopSharing();byId('ocr-pip').onclick=openPip;
    ['left','right','top','bottom','count','language','area-mode','source','text-style','ui-scale','y-offset'].forEach(k=>byId('ocr-'+k).onchange=()=>{try{if(['left','right','top','bottom'].includes(k))byId('ocr-area-mode').value='manual';if(['ui-scale','y-offset'].includes(k))byId('ocr-area-mode').value='auto';preview();results=[];resultAt=null;render();if(k==='language'&&worker){worker.terminate().catch(()=>{});worker=null;}status('参数已改变，下次识别按新区域和语言处理。');}catch(e){status(e.message);}});
    byId('ocr-text-mode').onclick=()=>{byId('ocr-text-area').hidden=!byId('ocr-text-area').hidden;};
    byId('ocr-match-text').onclick=()=>{results=byId('ocr-text').value.split(/\n/).map(x=>x.trim()).filter(Boolean).slice(0,4).map(text=>({...core.match(text,rows),text}));resultAt=new Date();render();status('已按输入顺序从全部奖励目录匹配；可在各格修正名称。');};
    panel.addEventListener('input',e=>{const i=e.target.dataset.ocrSearch;if(i===undefined)return;const r=results[Number(i)],q=core.normalize(e.target.value);r.search=e.target.value;const choices=q?rows.filter(x=>(x.ocrAliases||[]).some(a=>a.includes(q))).slice(0,8):[];e.target.nextElementSibling.innerHTML=choices.map(x=>`<button data-ocr-slot="${i}" data-ocr-choice="${esc(x.slug)}">${esc(x.name)}</button>`).join('');});
    panel.addEventListener('click',e=>{const b=e.target.closest('[data-ocr-choice]');if(!b)return;const r=results[Number(b.dataset.ocrSlot)];if(!r)return;r.item=rows.find(x=>x.slug===b.dataset.ocrChoice);r.status='exact';r.search='';render();});
    document.addEventListener('paste',e=>{if(tab!=='relics'||document.activeElement?.matches('input,textarea,select'))return;const file=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();acceptImage(file);}});
    syncControls();
  }
  function setCandidates(rewards){
    const values=new Set();
    for(const reward of rewards||[])for(const value of [reward?.slug,reward?.name,reward?.item?.slug,reward?.item?.name,...(reward?.item?.ocrNames||[])])if(value)values.add(core.normalize(value));
    candidateRows=values.size?rows.filter(item=>[item.slug,item.name,item.english,...(item.ocrNames||[])].filter(Boolean).some(value=>values.has(core.normalize(value)))):[];
    renderCandidateStatus();render();
  }
  window.RewardOcr={mount,update:render,setCandidates,leave:()=>{if(capture||busy)stopSharing('已离开开核桃页面，共享与识别已停止。');else generation++;if(pip){pip.close();pip=null;}}};
  window.addEventListener('pagehide',()=>{disposed=true;stopSharing();if(pip)pip.close();});
  window.addEventListener('pageshow',()=>{disposed=false;});
})();
