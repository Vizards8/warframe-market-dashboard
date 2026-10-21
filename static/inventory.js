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
      const source=file.files?.[0];if(!source)return;if(source.size>500000)throw new Error('备份文件过大');
      const raw=JSON.parse(await source.text());
      if(![1,2].includes(raw.version)||!raw.items||typeof raw.items!=='object'||Array.isArray(raw.items))throw new Error('不是有效的库存备份');
      const items={};for(const [slug,s] of Object.entries(raw.items)){
        if(!state.catalog.some(x=>x.slug===slug))throw new Error('备份包含目录外商品：'+slug);
        if(!s||!Number.isInteger(s.quantity)||s.quantity<0||s.quantity>100000)throw new Error('持有数量不正确');
        for(const key of ['target','cost'])if(s[key]!=null&&(!Number.isFinite(s[key])||s[key]<0||s[key]>1000000))throw new Error('价格不正确');
        items[slug]={quantity:s.quantity,watch:!!s.watch,target:s.target??null,cost:s.cost??null,note:String(s.note||'').slice(0,1000)};
        if(/^\d{4}-\d{2}-\d{2}$/.test(s.baro_date||''))items[slug].baro_date=s.baro_date;
      }
      // Merge matching rows and preserve other current holdings.
      settings.items={...settings.items,...items};queueSave();renderMetrics();if(baseTabs.includes(tab))renderTable();
      notify(`已导入 ${Object.keys(items).length} 种商品；同名记录以备份为准，其余当前库存保留。`,true);
    }catch(error){notify('导入失败：'+error.message);}finally{file.value='';}
  };
})();
