// Self-contained WFM manager; credentials remain in the browser's official session.
(()=>{
'use strict';
const API='https://api.warframe.market/v2',VERSION='0.2';
const FIELDS=['id','itemId','type','platinum','quantity','visible','perTrade','rank','charges','subtype','amberStars','cyanStars'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=(message,status=400)=>Object.assign(new Error(message),{status,checked:true});
const signature=(o,dated=true)=>JSON.stringify([...FIELDS,...(dated?['updatedAt']:[])].map(k=>o[k]??null));
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id);
function order(raw){
 if(!raw||!validId(raw.id)||!validId(raw.itemId)||!['sell','buy'].includes(raw.type)||typeof raw.visible!=='boolean'||!Number.isInteger(raw.platinum)||raw.platinum<1||raw.platinum>900000||!Number.isInteger(raw.quantity)||raw.quantity<1||raw.quantity>9999)throw fail('挂单格式不匹配，停止操作；不会当作空库存。',502);
 for(const k of ['perTrade','rank','charges','amberStars','cyanStars'])if(raw[k]!=null&&(!Number.isInteger(raw[k])||raw[k]<(k==='perTrade'?1:0)||raw[k]>(k==='perTrade'?6:100000)))throw fail('挂单变体字段无效。',502);
 if(raw.subtype!=null&&(typeof raw.subtype!=='string'||raw.subtype.length>100))throw fail('挂单子类型无效。',502);
 if(raw.updatedAt!=null&&(typeof raw.updatedAt!=='string'||raw.updatedAt.length>100))throw fail('挂单更新时间无效。',502);
 const row=Object.fromEntries([...FIELDS,'updatedAt'].filter(k=>own(raw,k)).map(k=>[k,raw[k]]));row.revision=signature(row);return row;
}
function createClient(fetcher,onStep=()=>{},pause=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now(),alive=()=>true){
 let queue=Promise.resolve(),snapshot=null,plans=new Map(),counter=0;
 function request(path,method='GET',body,localized=false){
  const task=async()=>{
   await pause(650);if(!alive())throw fail('面板已关闭，停止后续请求。',499);
   const single=/^\/order\/[a-zA-Z0-9_-]{1,100}$/.test(path);
   if(!(method==='GET'&&(['/me','/orders/my','/items'].includes(path)||single))&&!(method==='PATCH'&&single))throw fail('不允许的请求。');
   const options={method,credentials:path==='/items'?'omit':'include',cache:'no-store',redirect:'error'};
   if(method==='PATCH')Object.assign(options,{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   if(localized)options.headers={Language:'zh-hans'};
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);options.signal=controller.signal;
   try{
    onStep(method+' '+path+'：请求中');const response=await fetcher(API+path,options);onStep(method+' '+path+'：HTTP '+response.status);
    if(!response.ok)throw fail(response.status===401?'官网会话已过期，请重新登录并同步。':response.status===403?'WFM 拒绝操作（权限或 CSRF 校验），请在官网核实；不会绕过校验或自动重试。':response.status===429?'WFM 限速，已停止后续操作，请稍后同步。':'WFM 返回 HTTP '+response.status,response.status);
    const raw=await response.json();if(!raw||raw.error||!own(raw,'data'))throw fail('WFM 未确认成功，请重新同步核实。',502);return raw.data;
   }catch(error){if(error.checked)throw error;throw fail('浏览器无法读取响应（网络、跨域或超时）；不能据此判断库存为空。请重新同步核实，写入不会自动重试。',0);}
   finally{clearTimeout(timeout);}
  };
  const result=queue.then(task);queue=result.catch(()=>{});return result;
 }
 async function user(){const raw=await request('/me');if(!raw||!validId(raw.id)||typeof raw.ingameName!=='string'||!raw.ingameName)throw fail('未返回有效的本人账号，停止操作。',401);return {id:raw.id,name:raw.ingameName,verified:raw.verification===true};}
 async function readRaw(){
  const me=await user(),raw=await request('/orders/my');if(!Array.isArray(raw)||raw.length>10000)throw fail('挂单格式不匹配，停止操作；不会当作空库存。',502);
  const orders=raw.map(order);if(new Set(orders.map(o=>o.id)).size!==orders.length)throw fail('挂单重复，停止操作。',502);
  return {user:me,name:me.name,orders,at:now()};
 }
 async function read(){plans.clear();snapshot=null;snapshot=await readRaw();return snapshot;}
 async function items(){
  let raw;try{raw=await request('/items','GET',undefined,true);}catch(e){if(![0,400].includes(e.status))throw e;raw=await request('/items');}
  if(!Array.isArray(raw))throw fail('商品目录格式异常。',502);
  const label=v=>typeof v==='string'?v:'';
  return raw.filter(o=>o&&validId(o.id)).map(o=>({id:o.id,name:label(o.i18n?.['zh-hans']?.name)||label(o.i18n?.en?.name)||o.id,english:label(o.i18n?.en?.name)}));
 }
 async function prepare(changes){
  plans.clear();if(!snapshot)throw fail('请先同步本人挂单。',409);
  if(!Array.isArray(changes)||!changes.length||changes.length>100)throw fail('一次请选择 1–100 条挂单。');
  const fresh=await readRaw();if(fresh.user.id!==snapshot.user.id)throw fail('当前官网登录账号已变化，请重新同步。',409);
  if(!fresh.user.verified)throw fail('修改挂单需要已验证的 WFM 账号。',403);
  const rows=new Map(fresh.orders.map(o=>[o.id,o])),seen=new Set(),entries=[];
  for(const change of changes){
   if(!change||Object.keys(change).some(k=>!['id','revision','platinum','quantity','visible'].includes(k))||!validId(change.id)||seen.has(change.id)||!rows.has(change.id))throw fail('挂单不存在、重复或不属于当前账号，请重新同步。',409);
   seen.add(change.id);const before=rows.get(change.id);if(before.revision!==change.revision)throw fail('挂单已在官网变化，请重新同步后操作。',409);
   const patch=Object.fromEntries(['platinum','quantity','visible'].filter(k=>own(change,k)).map(k=>[k,change[k]]));
   if(own(patch,'platinum')&&(!Number.isInteger(patch.platinum)||patch.platinum<1||patch.platinum>900000))throw fail('价格必须为 1–900000 的整数。');
   if(own(patch,'quantity')&&(!Number.isInteger(patch.quantity)||patch.quantity<1||patch.quantity>9999||patch.quantity%(before.perTrade||1)))throw fail('数量必须为 1–9999 的整数，且符合每笔份数。');
   if(own(patch,'visible')&&typeof patch.visible!=='boolean')throw fail('显示状态必须为上架或隐藏。');
   for(const k of Object.keys(patch))if(patch[k]===before[k])delete patch[k];
   if(Object.keys(patch).length)entries.push({id:before.id,before,patch});
  }
  if(!entries.length)throw fail('没有需要提交的变化。');
  const plan={id:String(++counter),user:fresh.user,expires:now()+300000,entries};plans.set(plan.id,plan);return JSON.parse(JSON.stringify(plan));
 }
 async function apply(id){
  const plan=plans.get(id);plans.delete(id);if(!plan||now()>=plan.expires)throw fail('预览已过期或已提交，请重新预览。',409);
  const me=await user();if(me.id!==plan.user.id||!me.verified)throw fail('当前账号或验证状态已变化，未提交，请重新同步。',409);
  const results=[];
  for(const e of plan.entries){
   try{
    const current=order(await request('/order/'+e.id));
    if(current.revision!==e.before.revision){results.push({id:e.id,state:'conflict',message:'官网挂单已变化，未修改。'});continue;}
    let failure=null;try{await request('/order/'+e.id,'PATCH',e.patch);}catch(error){failure=error;}
    // A timeout is ambiguous: read back once and never repeat a write.
    const actual=order(await request('/order/'+e.id));const matched=signature(actual,false)===signature({...e.before,...e.patch},false);
    results.push({id:e.id,state:matched?'verified':'unconfirmed',message:matched?'已回读确认'+(failure?'；请求异常，已停止后续操作。':''):failure?failure.message:'回读与预期不同，请重新同步核实。'});
    if(failure||!matched)break;
   }catch(error){results.push({id:e.id,state:'unconfirmed',message:error.message});break;}
  }
  const attempted=new Set(results.map(r=>r.id));for(const e of plan.entries)if(!attempted.has(e.id))results.push({id:e.id,state:'skipped',message:'已停止后续操作，未提交。'});
  return results;
 }
 return {read,items,prepare,apply,cancel:()=>plans.clear()};
}
async function readAccount(fetcher,onStep,pause){return createClient(fetcher,onStep,pause).read();}
function mount(doc,fetcher){
 const id='void-ledger-bookmark-panel',old=doc.getElementById(id);if(old){old.scrollIntoView();return;}
 const host=doc.createElement('div');host.id=id;
 host.style.cssText='all:initial!important;position:fixed!important;inset:16px 16px auto auto!important;z-index:2147483647!important;width:min(1020px,calc(100vw - 32px))!important;display:block!important;';
 const root=host.attachShadow({mode:'open'});
 root.innerHTML=`<style>:host{color-scheme:dark}*{box-sizing:border-box}section{font:14px/1.6 system-ui,sans-serif;color:#e8f4f2;background:#101d25;border:1px solid #3d7069;border-radius:16px;box-shadow:0 16px 80px #0009;padding:24px;max-height:calc(100vh - 32px);overflow:auto}header,.tools{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}h2,h3{margin:0}h2{font-size:22px}small,p{color:#b3c7cb}button,input,select{font:inherit}button{cursor:pointer;background:#83e5bb;color:#10251c;border:0;padding:8px 12px;border-radius:7px}button:disabled,input:disabled,select:disabled{opacity:.5}button:disabled{cursor:wait}button.plain{background:#253c46;color:#d3ece7}a{color:#8fe6c5}header button{background:transparent;color:#fff;font-size:24px;padding:0 8px}input,select{background:#0a171f;border:1px solid #49636b;color:#fff;padding:7px;border-radius:6px}input[type=number]{width:90px}input[type=search]{flex:1;min-width:180px}input[type=checkbox]{accent-color:#83e5bb}small{display:block;font-size:11px}.notice{white-space:pre-line;border-left:3px solid #83e5bb;padding-left:12px;margin:16px 0}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;border-bottom:1px solid #ffffff20;padding:10px 7px;vertical-align:top}td:first-child{min-width:190px}td button{margin:2px;white-space:nowrap}.positive{color:#8fe6c5}.muted{color:#a9bac3}.tools{margin:12px 0}.results li{margin:8px 0}details{margin:16px 0}pre{font-size:11px;white-space:pre-wrap}dialog{color:#e8f4f2;background:#101d25;border:1px solid #81c2ac;border-radius:14px;width:min(800px,calc(100vw - 32px));max-height:85vh;padding:24px}dialog::backdrop{background:#0009}dialog table{margin:18px 0}dialog .tools{justify-content:flex-end}[hidden]{display:none!important}@media(max-width:600px){section{padding:16px}h2{font-size:18px}}</style>
 <section aria-label="虚空账本挂单管理面板"><header><h2>◈ 虚空账本 · WFM 挂单</h2><span>v${VERSION} · 写入待实测</span><button id="close" aria-label="关闭面板">×</button></header>
 <p>沿用当前官网会话。只修改已有挂单，每次先预览再确认；不读取 JWT，不删除或标记成交。新建挂单仍在官网操作。</p>
 <div class="tools"><button id="sync">↻ 同步我的挂单</button><a href="/auth/signin" target="_blank" rel="noopener">在官网登录 ↗</a><span id="account">尚未同步</span></div><div class="notice" role="status" id="notice">点击同步，读取本人账号与全部挂单。</div>
 <div id="workspace" hidden><div class="tools"><input type="search" id="search" aria-label="搜索挂单" placeholder="搜索中文、英文、物品 ID"><select id="type" aria-label="买卖筛选"><option value="all">全部买卖单</option><option value="sell">卖单</option><option value="buy">买单</option></select><select id="visibility" aria-label="状态筛选"><option value="all">全部状态</option><option value="visible">已上架</option><option value="hidden">已隐藏</option></select></div><div class="tools"><div><button class="plain" id="select">选择筛选结果</button> <button class="plain" id="clear">清空选择</button> <span id="selected">0 条已选</span></div><div><button class="plain" id="show">勾选项上架</button> <button class="plain" id="hide">勾选项下架</button></div></div><div class="scroll"><table><thead><tr><th>选择 / 商品与变体</th><th>方向 / 状态</th><th>每笔价格</th><th>挂单数量</th><th>操作</th></tr></thead><tbody id="orders"></tbody></table></div><small>上 / 下架只改变显示状态。价格、数量需点「预览修改」提交；每笔价格不是批量单价。挂单不等于游戏仓库。</small></div>
 <div id="results" class="results" aria-live="polite"></div><details><summary>请求状态 / 写入限制</summary><p>真人账号读取已由使用者反馈通过，写入仍待验证。若 WFM 拒绝权限或 CSRF 校验，会停止；不会绕过或重试写入。批量非原子操作，会逐条显示结果。执行前检查与提交之间仍有并发窗口。</p><pre id="log"></pre></details></section>
 <dialog id="review"><h2>确认修改 WFM 挂单</h2><div id="preview"></div><p>提交后直接改变官网挂单。预览 5 分钟内有效；执行前再次核对，提交后回读。首次建议只选一条。取消不会写入。</p><div class="tools"><button class="plain" id="cancel">取消</button><button id="commit">确认提交到 WFM</button></div></dialog>`;
 doc.body.append(host);
 const $=id=>root.getElementById(id),text=(tag,value)=>{const e=doc.createElement(tag);e.textContent=String(value);return e;};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let snapshot=null,catalog=new Map(),selected=new Set(),drafts=new Map(),plan=null,busy=false,logs=[];
 const client=createClient(fetcher,s=>{logs.push(s);logs=logs.slice(-40);$('log').textContent=logs.join('\n');},undefined,undefined,()=>host.isConnected);
 const name=o=>catalog.get(o.itemId)?.name||o.itemId;
 const variant=o=>[o.rank!=null?'R'+o.rank:'',o.subtype||'',o.charges!=null?'充能 '+o.charges:'',o.amberStars!=null?'琥珀星 '+o.amberStars:'',o.cyanStars!=null?'青蓝星 '+o.cyanStars:''].filter(Boolean).join(' · ');
 const notice=s=>$('notice').textContent=s;
 function lock(value){busy=value;root.querySelectorAll('button,input,select').forEach(e=>e.disabled=value);if(snapshot&&!snapshot.user.verified)root.querySelectorAll('#show,#hide,[data-save],[data-toggle]').forEach(e=>e.disabled=true);}
 function shown(){const q=$('search').value.toLowerCase().trim(),t=$('type').value,v=$('visibility').value;return (snapshot?.orders||[]).filter(o=>(t==='all'||o.type===t)&&(v==='all'||o.visible===(v==='visible'))&&(!q||[name(o),catalog.get(o.itemId)?.english||'',o.itemId].some(x=>x.toLowerCase().includes(q))));}
 function render(){
  $('workspace').hidden=!snapshot;if(!snapshot)return;
  const count=snapshot.orders.filter(o=>o.visible).length;$('account').textContent=`${snapshot.name} · ${snapshot.orders.length} 条 · ${count} 上架 / ${snapshot.orders.length-count} 隐藏${snapshot.user.verified?'':' · 未验证账号，只读'}`;
  $('selected').textContent=selected.size+' 条已选';
  $('orders').innerHTML=shown().map(o=>{const d=drafts.get(o.id)||{};return `<tr><td><label><input type="checkbox" data-select="${o.id}" ${selected.has(o.id)?'checked':''}> ${esc(name(o))}</label><small>${esc(variant(o)||'无等级 / 子类型')}</small><small>${esc(o.itemId)}</small></td><td>${o.type==='sell'?'卖单':'买单'}<br><span class="${o.visible?'positive':'muted'}">${o.visible?'已上架':'已隐藏'}</span></td><td><input type="number" data-edit="platinum" data-id="${o.id}" min="1" max="900000" step="1" value="${esc(d.platinum??o.platinum)}" aria-label="${esc(name(o))}价格"><small>${o.platinum}p / ${o.perTrade||1} 份（当前）</small></td><td><input type="number" data-edit="quantity" data-id="${o.id}" min="1" max="9999" step="${o.perTrade||1}" value="${esc(d.quantity??o.quantity)}" aria-label="${esc(name(o))}数量"></td><td><button data-save="${o.id}">预览修改</button><button class="plain" data-toggle="${o.id}">${o.visible?'下架':'上架'}</button></td></tr>`;}).join('')||'<tr><td colspan="5">没有符合筛选条件的挂单。</td></tr>';
  root.querySelectorAll('[data-select]').forEach(e=>e.onchange=()=>{e.checked?selected.add(e.dataset.select):selected.delete(e.dataset.select);$('selected').textContent=selected.size+' 条已选';});
  root.querySelectorAll('[data-edit]').forEach(e=>e.oninput=()=>drafts.set(e.dataset.id,{...drafts.get(e.dataset.id),[e.dataset.edit]:e.value===''?null:Number(e.value)}));
  root.querySelectorAll('[data-save]').forEach(e=>e.onclick=()=>review([change(e.dataset.save,drafts.get(e.dataset.save)||{})]));
  root.querySelectorAll('[data-toggle]').forEach(e=>e.onclick=()=>{const o=snapshot.orders.find(o=>o.id===e.dataset.toggle);review([change(o.id,{visible:!o.visible})]);});lock(busy);
 }
 function change(id,patch){const row=snapshot.orders.find(o=>o.id===id);return {id,revision:row.revision,...patch};}
 async function sync(){
  try{snapshot=await client.read();}catch(e){snapshot=null;$('account').textContent='同步失败，请重试';render();throw e;}
  drafts.clear();selected=new Set([...selected].filter(id=>snapshot.orders.some(o=>o.id===id)));render();let warning='';
  if(!catalog.size)try{catalog=new Map((await client.items()).map(o=>[o.id,o]));render();}catch(e){warning='\n商品名称读取失败，暂显示物品 ID；挂单读取仍然有效。';}
  notice(`已同步 ${snapshot.name} 的 ${snapshot.orders.length} 条挂单 · ${new Date(snapshot.at).toLocaleTimeString('zh-CN')}`+warning);
 }
 async function review(changes){
  if(busy)return;lock(true);
  try{plan=await client.prepare(changes);const label=(k,v)=>k==='visible'?(v?'上架':'隐藏'):(v+(k==='platinum'?'p':' 份'));
   $('preview').innerHTML=`<p>账号：<strong>${esc(plan.user.name)}</strong> · ${plan.entries.length} 条变化</p><div class="scroll"><table><thead><tr><th>商品 / 方向 / 变体</th><th>旧值 → 新值</th></tr></thead><tbody>${plan.entries.map(e=>`<tr><td>${esc(name(e.before))}<small>${e.before.type==='sell'?'卖单':'买单'} · ${esc(variant(e.before))}</small></td><td>${Object.entries(e.patch).map(([k,v])=>`${{platinum:'每笔价格',quantity:'挂单数量',visible:'显示状态'}[k]}：${esc(label(k,e.before[k]))} → <strong>${esc(label(k,v))}</strong>`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;$('review').showModal();
  }catch(e){notice(e.message);}finally{lock(false);}
 }
 function cancel(){client.cancel();plan=null;$('review').close();}
 $('cancel').onclick=cancel;$('review').oncancel=()=>{client.cancel();plan=null;};
 $('commit').onclick=async()=>{
  if(busy||!plan)return;const pid=plan.id;plan=null;$('review').close();lock(true);$('results').replaceChildren();notice('正在逐条提交并回读，请保留面板…');
  try{const results=await client.apply(pid);$('results').append(text('h3','本次提交结果'));const ul=doc.createElement('ul');results.forEach(r=>{const o=snapshot.orders.find(o=>o.id===r.id);ul.append(text('li',`${o?name(o):r.id}：${r.message}（${{verified:'已确认',conflict:'冲突',unconfirmed:'未确认',skipped:'未提交'}[r.state]}）`));});$('results').append(ul);await sync();}
  catch(e){notice(e.message+' 请重新同步核实，勿重复提交。');}finally{lock(false);}
 };
 $('sync').onclick=async()=>{if(busy)return;lock(true);try{await sync();}catch(e){notice(e.message);}finally{lock(false);}};
 $('close').onclick=()=>{if(!busy){client.cancel();host.remove();}};
 $('search').oninput=render;$('type').onchange=render;$('visibility').onchange=render;
 $('select').onclick=()=>{shown().forEach(o=>selected.add(o.id));render();};$('clear').onclick=()=>{selected.clear();render();};
 for(const id of ['show','hide'])$(id).onclick=()=>review([...selected].map(oid=>change(oid,{visible:id==='show'})));
 return host;
}
if(typeof module==='object'&&module.exports){module.exports={createClient,readAccount,signature,mount};return;}
if(location.origin!=='https://warframe.market'){alert('请先打开 https://warframe.market/ 并登录，再点击「虚空账本」书签。');return;}
mount(document,window.fetch.bind(window));
})();
