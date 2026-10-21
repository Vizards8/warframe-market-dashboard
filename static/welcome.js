'use strict';
// The landing page has no account or private inventory embedded in the public build.
window.Welcome=(()=>{
 let ready=false;
 function activate(){
  const home=tab==='home';document.body.classList.toggle('home-mode',home);$('welcome').hidden=!home;
  if(!ready){
   ready=true;
   document.querySelector('.brand').onclick=e=>{e.preventDefault();setTab('home');};
   $('welcome-skip').checked=!!settings.startInDesk;
   $('welcome-skip').onchange=e=>{settings.startInDesk=e.target.checked;queueSave();};
   $('welcome-refresh').onclick=()=>$('refresh').click();
   $('welcome-add').onclick=()=>{setTab('inventory');$('add-inventory').click();};
   document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>setTab(b.dataset.go));
  }
  const count=state.catalog.filter(held).length;
  $('welcome-holdings').textContent=count?`${count} 种持仓 · 查看观察线`:'录入第一份持仓 →';
  $('welcome-snapshot').textContent=`公开快照 ${timeLabel(state.server_time)} · ${state.catalog.length} 种目录商品`;
  const status=DeskCore.baro(state.baro);
  $('welcome-baro').textContent={active:'奸商在售 · 先核对本次货单',upcoming:'等待下一次到访 · 先做好计划',departed:'奸商已离场 · 回看补仓计划',unknown:'货单待核实 · 可手动核对'}[status];
 }
 function update(){if(ready)activate();}
 return {activate,update};
})();
if(typeof state!=='undefined'&&state&&typeof settings!=='undefined'&&settings)window.Welcome.activate();
