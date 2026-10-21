// Self-contained, read-only bookmarklet. No token access, storage or third-party requests.
(()=>{
 'use strict';
 const API='https://api.warframe.market/v2';
 async function readAccount(fetcher,onStep=()=>{},pause=ms=>new Promise(r=>setTimeout(r,ms))){
  async function get(path,label){
   onStep(label+'：请求中');
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetcher(API+path,{method:'GET',credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal});
    onStep(label+'：HTTP '+response.status);
    if(!response.ok){const e=new Error(response.status===401?'官网会话未被接口接受，请先在当前浏览器登录 WFM，再重试。':response.status===403?'WFM 拒绝了请求，此书签暂不能接入当前会话。':response.status===429?'请求过于频繁，请稍后再试。':'WFM 返回 HTTP '+response.status);e.checked=true;throw e;}
    const raw=await response.json();
    if(!raw||raw.error||!Object.prototype.hasOwnProperty.call(raw,'data')){const e=new Error('WFM 响应格式不匹配，停止读取。');e.checked=true;throw e;}
    return raw.data;
   }catch(error){if(error.checked)throw error;throw new Error('浏览器无法读取响应（可能是跨域限制、超时或网络错误）；不能据此判断已登录或库存为空。');}
   finally{clearTimeout(timeout);}
  }
  const me=await get('/me','本人账号');
  if(!me||typeof me.ingameName!=='string'||!me.ingameName)throw new Error('未返回有效的本人账号，停止读取。');
  await pause(650);
  const orders=await get('/orders/my','本人挂单');
  if(!Array.isArray(orders)||orders.length>10000||orders.some(o=>!o||typeof o.itemId!=='string'||!['sell','buy'].includes(o.type)||typeof o.visible!=='boolean'||!Number.isInteger(o.platinum)||!Number.isInteger(o.quantity)))throw new Error('挂单格式不匹配，停止读取；不会当作空库存。');
  return {name:me.ingameName,orders:orders.map(o=>({itemId:o.itemId,type:o.type,visible:o.visible,platinum:o.platinum,quantity:o.quantity,rank:o.rank,perTrade:o.perTrade,subtype:o.subtype}))};
 }
 if(typeof module==='object'&&module.exports){module.exports={readAccount};return;}
 if(location.origin!=='https://warframe.market'){alert('请先打开 https://warframe.market/ 并登录，再点击「虚空账本」书签。');return;}
 const id='void-ledger-bookmark-panel';
 if(document.getElementById(id)){document.getElementById(id).scrollIntoView();return;}
 const host=document.createElement('div');host.id=id;
 host.style.cssText='all:initial!important;position:fixed!important;inset:20px 20px auto auto!important;z-index:2147483647!important;width:min(720px,calc(100vw - 40px))!important;display:block!important;';
 const root=host.attachShadow({mode:'open'});
 root.innerHTML='<style>:host{color-scheme:dark}*{box-sizing:border-box}section{font:14px/1.6 system-ui,sans-serif;color:#e8f4f2;background:#101d25;border:1px solid #3d7069;border-radius:16px;box-shadow:0 16px 80px #0009;padding:24px;max-height:calc(100vh - 40px);overflow:auto}header{display:flex;justify-content:space-between;align-items:center}h2{margin:0;font-size:22px}small,p{color:#b3c7cb}button,a{font:inherit}button{cursor:pointer;background:#83e5bb;color:#10251c;border:0;padding:9px 16px;border-radius:7px}button:disabled{opacity:.5;cursor:wait}a{color:#8fe6c5}header button{background:transparent;color:#fff;font-size:24px;padding:0 8px}.status{white-space:pre-line;border-left:3px solid #83e5bb;padding-left:12px;margin:18px 0}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;border-bottom:1px solid #ffffff20;padding:8px}td:first-child{overflow-wrap:anywhere}small{display:block}</style><section aria-label="虚空账本只读测试面板"><header><h2>◈ 虚空账本 · 只读测试</h2><button aria-label="关闭面板">×</button></header><p>使用当前 WFM 官网会话，只查询本人账号和挂单。不读取、保存或转发令牌；不会修改挂单。</p><div class="status" role="status">书签脚本已运行。点击下方按钮验证官网会话。</div><button id="read">读取我的挂单</button> <a href="/auth/signin" target="_blank" rel="noopener">在官网登录 ↗</a><div id="result"></div><small>这是兼容性试验：改价、数量修改、上下架尚未开放。挂单不等于游戏仓库；隐藏单和买单保留区别。关闭面板即移除本次展示。</small></section>';
 document.body.appendChild(host);
 root.querySelector('header button').onclick=()=>host.remove();
 const status=root.querySelector('.status'),button=root.querySelector('#read'),result=root.querySelector('#result');
 const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=String(value);return e;};
 button.onclick=async()=>{
  button.disabled=true;result.replaceChildren();const steps=['书签脚本：已运行'];
  try{
   const snapshot=await readAccount(window.fetch.bind(window),s=>{steps.push(s);status.textContent=steps.join('\n');});
   if(!host.isConnected)return;
   steps.push('只读接入成功：'+snapshot.name+' · '+snapshot.orders.length+' 条挂单');
   result.append(text('h3',snapshot.name+' 的挂单'));
   const table=document.createElement('table'),head=document.createElement('tr');
   ['物品 ID / 变体','方向 / 状态','每笔价格','数量'].forEach(x=>head.append(text('th',x)));table.append(head);
   snapshot.orders.forEach(o=>{const row=document.createElement('tr');[o.itemId+[o.rank!=null?' R'+o.rank:'',o.subtype?' '+o.subtype:''].join(''),(o.type==='sell'?'卖单':'买单')+' / '+(o.visible?'上架':'隐藏'),o.platinum+'p / '+(o.perTrade||1)+'份',o.quantity].forEach(v=>row.append(text('td',v)));table.append(row);});
   result.append(table);
   if(!snapshot.orders.length)result.append(text('p','接口已确认 0 条本人挂单；不代表游戏仓库为空。'));
  }catch(error){steps.push(error.message);}
  finally{status.textContent=steps.join('\n');button.disabled=false;}
 };
})();
