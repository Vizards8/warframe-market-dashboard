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
  $('welcome-holdings').textContent=count?`${count} 种商品持有中`:'尚未添加库存';
  $('welcome-snapshot').textContent=`行情更新 ${timeLabel(state.server_time)} · ${state.catalog.length} 种商品`;
  const status=DeskCore.baro(state.baro);
  $('welcome-baro').textContent={active:'本次在售',upcoming:'等待下次到访',departed:'本次已离场',unknown:'货单待更新'}[status];
 }
 function update(){if(ready)activate();}
 return {activate,update};
})();
if(typeof state!=='undefined'&&state&&typeof settings!=='undefined'&&settings)window.Welcome.activate();
