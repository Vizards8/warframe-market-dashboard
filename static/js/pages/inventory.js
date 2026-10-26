'use strict';
// Backups are downloaded/read in the browser. They never go to the server.
(()=>{
  const out=$('portable-export'),inputButton=$('portable-share');
  out.textContent='备份库存';inputButton.textContent='导入库存';
  out.onclick=()=>{
    if(!settings)return;
    const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(settings,null,2)],{type:'application/json'}));
    a.href=url;a.download='warframe-inventory.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify('库存备份已下载；可在另一台电脑或在线版点“导入库存”。',true);
  };
  const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;file.id='inventory-import-file';document.body.append(file);
  inputButton.onclick=()=>{if(settings)file.click();};
  file.onchange=async()=>{
    try{
      const source=file.files?.[0];if(!source)return;if(source.size>5000000)throw new Error('备份文件过大');
      const raw=JSON.parse(await source.text());
      const checked=DeskCore.backup(raw,state.catalog),items=checked.items;
      // Replace imported item ledgers as a group; preserve records for other holdings.
      window.Desk?.checkpoint();
      settings.items={...settings.items,...items};
      settings.transactions=[...(settings.transactions||[]).filter(e=>!Object.hasOwn(items,e.slug)),...(checked.transactions||[])];
      for(const [key,value] of Object.entries(checked))if(!['items','transactions'].includes(key))settings[key]=value;
      queueSave();$('stats-window').value=String(statsDays());if($('target-basis'))$('target-basis').value=settings.targetBasis||'sell';renderMetrics();if(baseTabs.includes(tab))renderTable();window.Desk?.activate();if(tab==='relics')window.Extras?.activate('relics');
      notify(`已导入 ${Object.keys(items).length} 种商品；同名记录以备份为准，其余当前库存保留。`,true);
    }catch(error){notify('导入失败：'+error.message);}finally{file.value='';}
  };
})();
