'use strict';
// The landing page has no account or private inventory embedded in the public build.
window.Welcome=(()=>{
 let ready=false,preview=null,items=null,session=0,connectorWindow=null,connectorChannel=null,bridgeTimer=null;
 const dialog=document.createElement('dialog');dialog.id='wfm-dialog';document.body.append(dialog);
 function activate(){
  const home=tab==='home';document.body.classList.toggle('home-mode',home);$('welcome').hidden=!home;
  if(!ready){
   ready=true;$('wfm-open').disabled=false;
   document.querySelector('.brand').onclick=e=>{e.preventDefault();setTab('home');};
   $('welcome-skip').checked=!!settings.startInDesk;
   $('welcome-skip').onchange=e=>{settings.startInDesk=e.target.checked;queueSave();};
   $('welcome-refresh').onclick=()=>$('refresh').click();
   $('welcome-add').onclick=()=>{setTab('inventory');$('add-inventory').click();};
   $('wfm-open').onclick=openWfm;$('welcome-wfm').onclick=openWfm;
   document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>setTab(b.dataset.go));
  }
  const count=state.catalog.filter(held).length;
  $('welcome-holdings').textContent=count?`${count} 种持仓 · 查看观察线`:'录入第一份持仓 →';
  $('welcome-snapshot').textContent=`公开快照 ${timeLabel(state.server_time)} · ${state.catalog.length} 种目录商品`;
  const status=DeskCore.baro(state.baro);
  $('welcome-baro').textContent={active:'奸商在售 · 先核对本次货单',upcoming:'等待下一次到访 · 先做好计划',departed:'奸商已离场 · 回看补仓计划',unknown:'货单待核实 · 可手动核对'}[status];
 }
 function openWfm(){
  const version=++session;preview=null;
  dialog.innerHTML=`<div class="dialog-heading"><h2>连接 WFM · 同步与挂单管理</h2><button id="wfm-close" class="close-button" aria-label="关闭 WFM 核对">×</button></div><section class="wfm-connector-intro"><h3>试试免安装的书签面板</h3><p>在 WFM 官网点击书签，验证能否直接使用已登录会话。当前只读，不修改挂单；真实会话兼容性待验证。</p><a class="plain-button" href="https://vizards8.github.io/warframe-market-dashboard/wfm-bookmark.html" target="_blank" rel="noopener">设置书签 · 只读实验版 ↗</a></section><section class="wfm-connector-intro"><h3>直接同步、改价、上下架</h3><p>先双击项目里的「启动WFM连接器.command」，再打开本机连接窗口。会话在本机授权；价格与上下架在连接窗口预览提交，挂单会自动回传到本页供核对。</p><div class="desk-actions"><button id="wfm-connect-local" class="primary">打开本机连接窗口 ↗</button><a class="plain-button" href="https://github.com/Vizards8/warframe-market-dashboard/archive/refs/heads/main.zip" target="_blank" rel="noopener">下载 / 更新连接器 ↗</a></div><p id="wfm-bridge-status" role="status">尚未连接。只在本机窗口输入会话授权，不在此在线网页输入。</p></section><details><summary>免授权读取公开挂单 / 粘贴备用</summary><p>这里读取的是 WFM 可见挂单，不是游戏仓库。未挂售的库存和隐藏挂单无法从公开接口读取；买单也不算持有。</p><label class="wfm-field">WFM 用户名<input id="wfm-user" type="text" autocomplete="off" maxlength="64" placeholder="你的公开 WFM 用户名"></label><div class="desk-actions"><button id="wfm-source" class="plain-button">打开公开挂单数据 ↗</button>${!window.Hosted&&!window.Portable?'<button id="wfm-fetch" class="primary">读取公开挂单</button>':''}</div><p>${window.Hosted||window.Portable?'在线版暂不能直连 WFM：当前接口未返回允许本站跨域读取的响应头。点上方按钮，在新页复制完整 JSON，粘贴到下方。':'本地服务使用公开接口读取，不需要密码或令牌；也可以粘贴公开 JSON。'}</p><details class="wfm-paste" open><summary>粘贴公开挂单 JSON</summary><textarea id="wfm-json" aria-label="公开挂单 JSON" placeholder='{"apiVersion":"…","data":[…],"error":null}' spellcheck="false"></textarea><button id="wfm-preview" class="primary">预览数量差异</button></details></details><div id="wfm-result" aria-live="polite"></div><details class="wfm-boundary"><summary>自动设价、上下架可以做吗？</summary><p>WFM 接口支持创建 / 改价，以及 visible 控制显隐，均需要本人授权和已验证账号。官方公共 OAuth 尚未开放；在线页面不接收登录令牌，写入由你打开的本机连接窗口执行。</p><p>本机连接器已支持同步本人全部挂单、修改现有价格和数量、批量控制显隐。每次先预览再确认，写入后回读核实。当前不做无人值守追价和自动成交记账。</p><a class="link" href="https://docs.warframe.market/docs/api/orders/" target="_blank" rel="noopener">官方接口说明 ↗</a></details>`;
  $('wfm-connect-local').onclick=connectLocal;
  $('wfm-close').onclick=()=>dialog.close();
  dialog.onclose=()=>{session++;preview=null;};
  $('wfm-source').onclick=()=>{const slug=userSlug();if(slug)window.open('https://api.warframe.market/v2/orders/user/'+encodeURIComponent(slug),'_blank','noopener');};
  if($('wfm-fetch'))$('wfm-fetch').onclick=async()=>{
   const slug=userSlug();if(!slug)return;const b=$('wfm-fetch');b.disabled=true;
   $('wfm-result').textContent='正在读取公开挂单…';
   try{const raw=await request('/api/wfm-orders?user='+encodeURIComponent(slug));if(version===session)await showPreview(raw,version);}
   catch(e){if(version===session)$('wfm-result').textContent='读取失败：'+e.message;}finally{b.disabled=false;}
  };
  $('wfm-preview').onclick=async()=>{
   const b=$('wfm-preview');b.disabled=true;
   try{const value=$('wfm-json').value;if(value.length>2000000)throw new Error('数据过大，请只粘贴公开挂单响应');await showPreview(JSON.parse(value),version);}
   catch(e){preview=null;$('wfm-result').textContent='无法预览：'+(e instanceof SyntaxError?'请粘贴完整 JSON。':e.message);}finally{b.disabled=false;}
  };
  dialog.showModal();
 }
 function userSlug(){const value=$('wfm-user').value.trim().toLowerCase();if(!/^[a-z0-9_-]{1,64}$/.test(value)){$('wfm-result').textContent='请填写有效的公开用户名（不是邮箱）。';return null;}return value;}
 async function showPreview(raw,version,authenticated=false){
  // Clear the old selection before any parsing/network error can occur.
  preview=null;$('wfm-result').textContent='正在匹配商品目录…';
  items||=await request('/api/items');
  if(version!==session||!dialog.open)return;
  preview=DeskCore.wfmPreview(raw,items,state.catalog,{includeHidden:authenticated});
  const p=preview;
  $('wfm-result').innerHTML=`<h3>读取到 ${p.total} 条挂单</h3><p>${p.rows.length} 种可核对的${authenticated?'卖单（包含隐藏）':'可见卖单'} · ${p.buy} 条买单不计持仓 · ${p.skipped.length} 条变体 / 目录外 / 隐藏单跳过。</p>${!p.total?'<p>当前数据没有可见挂单。不会清空或减少你的任何库存。</p>':''}${p.rows.length?`<p>“挂售数量”可能只是持有的一部分。勾选你确认要覆盖的商品，将本地数量设为该值，不做累加；未勾选、缺失商品均保留。</p><div class="table-scroll"><table><thead><tr><th>选择 / 商品</th><th>本地持有 → 挂售数量</th><th>WFM 报价</th></tr></thead><tbody>${p.rows.map((r,i)=>`<tr><td><label><input type="checkbox" data-wfm-row="${i}"> ${esc(r.name)}</label></td><td>${srow(r.slug).quantity} → ${r.quantity}</td><td>${r.prices.map(x=>`${x.platinum}p / ${x.perTrade} 份`).join('、')}</td></tr>`).join('')}</tbody></table></div><button id="wfm-apply" class="primary">将勾选项设为挂售数量</button>`:''}${p.skipped.length?`<details><summary>查看跳过的挂单</summary><ul>${p.skipped.map(r=>`<li>${esc(r.name)}：${esc(r.reason)}</li>`).join('')}</ul></details>`:''}<p>这只是所提供数据的预览，不会修改 WFM；下架或挂单消失不等于卖出，不记为交易收入。${authenticated?'数据来自本机已授权会话。':'粘贴数据可能过期，请核对来源。'}</p>`;
  if($('wfm-apply'))$('wfm-apply').onclick=()=>{
   const selected=[...dialog.querySelectorAll('[data-wfm-row]:checked')].map(e=>p.rows[Number(e.dataset.wfmRow)]);
   if(!selected.length){$('wfm-apply').textContent='请先勾选要更新的商品';return;}
   const count=Desk.reconcile(selected);dialog.close();setTab('inventory');notify(`已校正 ${count} 种商品；其余库存保留，不记入交易收入。可撤销。`,true);
  };
 }
 function connectLocal(){
  if(!['https://vizards8.github.io','http://127.0.0.1:18866'].includes(location.origin)&&window.Hosted){$('wfm-bridge-status').textContent='请从正式行情站点打开连接；此预览来源尚未开放联动。';return;}
  connectorChannel=crypto.randomUUID();
  const base='http://127.0.0.1:18766';
  const url=base+'/wfm?origin='+encodeURIComponent(location.origin)+'#channel='+connectorChannel;
  connectorWindow=window.open(url,'void-ledger-wfm-'+connectorChannel);
  if(!connectorWindow){$('wfm-bridge-status').textContent='连接窗口被浏览器拦截，请允许本站弹出本机连接窗口。';return;}
  $('wfm-bridge-status').textContent='正在等待本机窗口。若无法访问，请先启动 / 更新连接器。';
  clearInterval(bridgeTimer);let tries=0;
  bridgeTimer=setInterval(()=>{if(!connectorWindow||connectorWindow.closed||++tries>120){clearInterval(bridgeTimer);return;}connectorWindow.postMessage({type:'VOID_LEDGER_WFM_HELLO',channel:connectorChannel},base);},1000);
 }
 window.addEventListener('message',async e=>{
  if(e.origin!=='http://127.0.0.1:18766'||e.source!==connectorWindow||!connectorChannel||e.data?.channel!==connectorChannel)return;
  const msg=e.data;if(!dialog.open)return;
  const status=$('wfm-bridge-status');if(!status)return;
  if(msg.type==='VOID_LEDGER_WFM_AUTH_REQUIRED'){status.textContent='本机已连通，请在连接窗口完成 WFM 会话授权。';return;}
  if(msg.type==='VOID_LEDGER_WFM_DISCONNECTED'){status.textContent='本机会话已断开或过期，请重新连接。';$('wfm-result').textContent='';return;}
  if(msg.type!=='VOID_LEDGER_WFM_SNAPSHOT'||!Array.isArray(msg.orders)||typeof msg.user?.ingameName!=='string')return;
  clearInterval(bridgeTimer);
  status.textContent=`已连接 ${msg.user.ingameName} · ${msg.orders.length} 条挂单（含隐藏） · 改价与上下架请在本机窗口操作。`;
  try{await showPreview({apiVersion:'0.25.0',data:msg.orders,error:null},session,true);}catch(error){$('wfm-result').textContent='挂单已接收，库存匹配失败：'+error.message;}
 });
 function update(){if(ready)activate();}
 return {activate,update};
})();
if(typeof state!=='undefined'&&state&&typeof settings!=='undefined'&&settings)window.Welcome.activate();
