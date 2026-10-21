'use strict';
(()=>{
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let csrf='',snapshot=null,items=new Map(),selected=new Set(),drafts=new Map(),plan=null,busy=false,parentReady=false;
 const channel=new URLSearchParams(location.hash.slice(1)).get('channel');
 const parentOrigin=new URLSearchParams(location.search).get('origin');
 const allowedParent=['https://vizards8.github.io','http://127.0.0.1:18866','http://127.0.0.1:18765','http://localhost:18765','http://127.0.0.1:18766','http://localhost:18766'].includes(parentOrigin);
 const validChannel=typeof channel==='string'&&/^[a-zA-Z0-9_-]{20,80}$/.test(channel);
 const notice=(msg,success=false)=>{const e=$('connector-notice');e.textContent=msg;e.className='notice'+(success?' success':'');e.hidden=false;};
 async function api(path,body){
  const response=await fetch('/api/wfm/'+path,{cache:'no-store',method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-VoidLedger-CSRF':csrf},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await response.json();if(!response.ok){if(response.status===401){snapshot=null;renderAccount();send('VOID_LEDGER_WFM_DISCONNECTED');}throw new Error(raw.error||'本机服务请求失败');}return raw;
 }
 function name(o){return items.get(o.itemId)?.name||o.itemId||o.id;}
 function variant(o){return [o.rank!=null?'R'+o.rank:'',o.subtype||'',o.charges!=null?'充能 '+o.charges:'',o.amberStars!=null?'琥珀星 '+o.amberStars:'',o.cyanStars!=null?'青蓝星 '+o.cyanStars:''].filter(Boolean).join(' · ');}
 function send(type='VOID_LEDGER_WFM_SNAPSHOT'){
  if(!parentReady||!window.opener)return;
  const message={type,channel};
  if(type==='VOID_LEDGER_WFM_SNAPSHOT'&&snapshot)Object.assign(message,{user:snapshot.user,orders:snapshot.orders,at:snapshot.at});
  window.opener.postMessage(message,parentOrigin);
 }
 function renderAccount(){
  const connected=!!snapshot;$('connector-auth').hidden=connected;$('connector-workspace').hidden=!connected;
  $('connector-status').textContent=connected?'已连接 '+snapshot.user.ingameName+' · 授权仅保留在当前本机服务会话':'尚未授权 · 不会读取或修改账号挂单';
  if(!connected)return;
  $('connector-account').textContent=snapshot.user.ingameName+' 的 WFM 挂单';
  const orders=snapshot.orders,visible=orders.filter(o=>o.visible).length;
  $('connector-count').textContent=`${orders.length} 条 · ${visible} 条已上架 / ${orders.length-visible} 条已下架 · 同步 ${new Date(snapshot.at*1000).toLocaleTimeString('zh-CN')}${snapshot.user.verification!==true?' · 账号未验证，只读':''}`;
  $('connector-send').hidden=!parentReady;
 }
 function shown(){const q=$('connector-search').value.trim().toLowerCase(),f=$('connector-filter').value;return (snapshot?.orders||[]).filter(o=>(!q||[name(o),items.get(o.itemId)?.english,o.itemId].some(v=>(v||'').toLowerCase().includes(q)))&&(f==='all'||f==='visible'&&o.visible||f==='hidden'&&!o.visible||f===o.type));}
 function render(){
  renderAccount();const rows=shown();
  $('connector-orders').innerHTML=rows.map(o=>{const d=drafts.get(o.id)||{},p=d.platinum??o.platinum,q=d.quantity??o.quantity;return `<tr><td><label><input type="checkbox" data-select="${esc(o.id)}" ${selected.has(o.id)?'checked':''}> ${esc(name(o))}</label><small class="connector-variant">${esc(variant(o))||'无等级 / 子类型'} · ${esc(o.id)}</small></td><td>${o.type==='sell'?'卖单':'买单'}<br><span class="${o.visible?'positive':'neutral'}">${o.visible?'已上架':'已下架'}</span></td><td><input type="number" data-edit="platinum" data-id="${esc(o.id)}" min="1" max="900000" step="1" value="${p}" aria-label="${esc(name(o))} 白金价"></td><td><input type="number" data-edit="quantity" data-id="${esc(o.id)}" min="1" max="9999" step="${o.perTrade||1}" value="${q}" aria-label="${esc(name(o))} 挂单数量"><small class="connector-variant">每笔 ${o.perTrade||1} 份</small></td><td><button class="plain-button" data-save="${esc(o.id)}">预览改价 / 数量</button><button class="plain-button" data-toggle="${esc(o.id)}">${o.visible?'下架':'上架'}</button></td></tr>`;}).join('')||'<tr><td colspan="5" class="empty">没有符合条件的挂单。未挂售的物品不会出现在这里。</td></tr>';
  $('connector-selected').textContent=selected.size+' 条已选';
  $('connector-orders').querySelectorAll('[data-select]').forEach(e=>e.onchange=()=>{e.checked?selected.add(e.dataset.select):selected.delete(e.dataset.select);$('connector-selected').textContent=selected.size+' 条已选';});
  $('connector-orders').querySelectorAll('[data-edit]').forEach(e=>e.oninput=()=>{drafts.set(e.dataset.id,{...drafts.get(e.dataset.id),[e.dataset.edit]:e.value===''?null:Number(e.value)});});
  $('connector-orders').querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>review([change(b.dataset.save,drafts.get(b.dataset.save)||{})]));
  $('connector-orders').querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{const o=snapshot.orders.find(o=>o.id===b.dataset.toggle);review([change(o.id,{visible:!o.visible})]);});
 }
 function change(id,patch){const o=snapshot.orders.find(o=>o.id===id);return {id,revision:o.revision,...patch};}
 function setBusy(value){busy=value;document.querySelectorAll('button,input,select').forEach(e=>e.disabled=value);$('connector-progress').hidden=!value;}
 async function sync(){const next=await api('snapshot');snapshot=next;selected=new Set([...selected].filter(id=>next.orders.some(o=>o.id===id)));drafts.clear();render();send();}
 async function review(changes){
  if(busy)return;
  setBusy(true);
  try{
   plan=await api('plan',{changes});
   const label=(k,v)=>k==='visible'?v?'上架':'下架':`${v}${k==='platinum'?'p':' 份'}`;
   $('connector-review-content').innerHTML=`<p>账号：<strong>${esc(plan.user.ingameName)}</strong> · ${plan.entries.length} 条变化</p><ul class="connector-review-list">${plan.entries.map(e=>`<li><b>${esc(name(e.before))}</b> · ${e.before.type==='sell'?'卖单':'买单'} · ${esc(variant(e.before))}<br>${Object.entries(e.patch).map(([k,v])=>`${{platinum:'每笔价格',quantity:'挂单数量',visible:'显示状态'}[k]}：${esc(label(k,e.before[k]))} → <strong>${esc(label(k,v))}</strong>`).join('<br>')}</li>`).join('')}</ul>`;
   $('connector-review').showModal();
  }catch(e){notice(e.message);}finally{setBusy(false);}
 }
 $('connector-auth-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;let value=$('connector-token').value;$('connector-token').value='';setBusy(true);
  try{await api('connect',{token:value});value='';await sync();notice('已连接。核对账号名与挂单后即可操作。',true);}catch(e){notice(e.message);}finally{value='';setBusy(false);}
 };
 $('connector-sync').onclick=async()=>{if(busy)return;setBusy(true);try{await sync();notice('已重新同步 WFM，包括隐藏挂单。',true);}catch(e){notice(e.message);}finally{setBusy(false);}};
 $('connector-disconnect').onclick=async()=>{if(busy)return;setBusy(true);try{await api('disconnect',{});snapshot=null;plan=null;drafts.clear();selected.clear();$('connector-results').textContent='';renderAccount();send('VOID_LEDGER_WFM_DISCONNECTED');notice('已清除本机授权；没有退出 WFM 官网。',true);}catch(e){notice(e.message);}finally{setBusy(false);}};
 $('connector-search').oninput=render;$('connector-filter').onchange=render;
 $('connector-select').onclick=()=>{shown().forEach(o=>selected.add(o.id));render();};$('connector-clear').onclick=()=>{selected.clear();render();};
 for(const [id,visible] of [['connector-show',true],['connector-hide',false]])$(id).onclick=()=>review([...selected].map(oid=>change(oid,{visible})));
 const cancel=()=>{plan=null;$('connector-review').close();};$('connector-cancel').onclick=cancel;$('connector-review-close').onclick=cancel;
 $('connector-commit').onclick=async()=>{
  if(!plan||busy)return;const pid=plan.planId;plan=null;$('connector-review').close();setBusy(true);
  try{
   const result=await api('apply',{planId:pid});
   $('connector-results').innerHTML=`<h3>提交结果</h3><ul>${result.results.map(r=>`<li class="${r.state==='verified'?'positive':'negative'}">${esc(name(snapshot.orders.find(o=>o.id===r.id)||{id:r.id}))}：${esc(r.message)}</li>`).join('')}</ul>`;
   notice(`${result.results.filter(r=>r.state==='verified').length}/${result.results.length} 条已回读确认；其余请查看结果。`,result.results.every(r=>r.state==='verified'));
   await sync();
  }catch(e){notice('请求未获确认：'+e.message+' 请同步 WFM 核实，勿重复提交。');}finally{setBusy(false);}
 };
 $('connector-send').onclick=()=>send();
 window.addEventListener('message',e=>{
  if(!allowedParent||!validChannel||e.source!==window.opener||e.origin!==parentOrigin||e.data?.channel!==channel||e.data.type!=='VOID_LEDGER_WFM_HELLO')return;
  parentReady=true;$('connector-send').hidden=!snapshot;if(snapshot)send();else send('VOID_LEDGER_WFM_AUTH_REQUIRED');
 });
 (async()=>{
  try{
   const r=await api('status');csrf=r.csrf;
   const response=await fetch('/api/items',{cache:'no-store'});if(!response.ok)throw new Error('商品目录读取失败');items=new Map((await response.json()).map(x=>[x.id,x]));
   if(r.connected)await sync();else renderAccount();
  }catch(e){notice(e.message);renderAccount();}
 })();
})();
