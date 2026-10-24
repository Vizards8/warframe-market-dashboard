'use strict';
(()=>{
  let rivenQuery='',rivenScope='all',rivenCategory='all',rivenSort='reference';
  let relicData=null,itemData=null,relicIndex=new Map(),itemIndex=new Map(),relicLoading=null;
  let rivenBuilt=false,relicBuilt=false,detailRiven=null,relicRewardQuery='';
  let relicAdviceQuery='',relicAdviceGrade='radiant',relicAdviceSort='ev',relicAdviceMin=0,relicAdviceBestMin=0,relicAdviceVault='all',relicAdviceLimit=60;
  const selectedDrops=new Map();
  const grades=[['intact','完整'],['exceptional','优良'],['flawless','无暇'],['radiant','光辉']];
  const eras=[['','不限定'],['lith','古纪'],['meso','前纪'],['neo','中纪'],['axi','后纪']];
  const categories={rifle:'步枪',shotgun:'霰弹枪',pistol:'手枪',melee:'近战',archgun:'空战枪械',sentinel:'同伴武器',kitgun:'组合枪',zaw:'Zaw'};
  const weapon=slug=>state.weapons.find(x=>x.slug===slug);
  const rquote=slug=>state.rivens?.[slug]||{};
  const focusInput=()=>document.activeElement?.matches('input,textarea,select');
  function rivenRows(){
    return state.weapons.filter(x=>(rivenScope==='all'||x.candidate)&&(!rivenQuery||[x.name,x.english,x.slug].some(v=>v.toLowerCase().includes(rivenQuery)))&&(rivenCategory==='all'||x.category===rivenCategory)).sort((a,b)=>(rquote(b.slug)[rivenSort]??-1)-(rquote(a.slug)[rivenSort]??-1));
  }
  function buildRivens(){
    if(rivenBuilt)return;rivenBuilt=true;
    $('riven-section').innerHTML=`<div class="feature-intro"><div><h2>零洗紫卡查价 <span class="pill">按武器家族</span></h2><p>未查询不代表低价。高价候选仅供筛选，未覆盖全市场。${window.Hosted?'切到全部武器可跳转 WFM 查询。':'切到全部武器可逐个查。'}</p></div></div><div class="riven-notes"><span>0 洗 ≠ 0 级，升级过但未循环的卡也在内。</span><span>只看 PC 公开直售、近 30 天更新的挂单。</span></div><div class="toolbar"><label class="search"><span>⌕</span><input id="riven-search" type="search" aria-label="搜索紫卡武器" placeholder="搜索中文 / 英文武器名…"></label><div class="toolbar-filters"><select id="riven-scope" aria-label="紫卡范围"><option value="all">全部武器</option><option value="candidates">已覆盖高价候选</option></select><select id="riven-category" aria-label="紫卡武器类型"><option value="all">所有武器类型</option>${Object.entries(categories).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><select id="riven-sort" aria-label="紫卡排序"><option value="reference">低价参考 ↓</option><option value="online_floor">在线最低 ↓</option><option value="floor">最低挂价 ↓</option></select></div></div><div class="table-scroll"><table><thead><tr><th>武器</th><th>低价卖家参考</th><th>最低挂价</th><th>在线最低</th><th>返回样本</th><th>查询时间</th><th></th></tr></thead><tbody id="riven-rows"></tbody></table></div><div class="feature-foot"><span id="riven-count"></span><span>参考 = 不同卖家最低三份的中位数 · 非成交价</span></div>`;
    $('riven-search').oninput=e=>{rivenQuery=e.target.value.trim().toLowerCase();renderRivens();};
    $('riven-scope').value=rivenScope;
    $('riven-scope').onchange=e=>{rivenScope=e.target.value;renderRivens();};
    $('riven-category').onchange=e=>{rivenCategory=e.target.value;renderRivens();};
    $('riven-sort').onchange=e=>{rivenSort=e.target.value;renderRivens();};
    $('riven-section').addEventListener('click',e=>{
      const info=e.target.closest('[data-riven-detail]');if(info)return openRiven(info.dataset.rivenDetail);
      const refresh=e.target.closest('[data-riven-refresh]');if(refresh)refreshRivens([refresh.dataset.rivenRefresh]);
    });
  }
  function renderRivens(){
    if(!rivenBuilt||tab!=='rivens')return;
    const rows=rivenRows();$('riven-count').textContent=`${rows.length} 种武器 · ${rows.filter(x=>rquote(x.slug).at).length} 种有查询记录`;
    $('riven-rows').innerHTML=rows.length?rows.map(x=>{
      const q=rquote(x.slug),url=`https://warframe.market/auctions/search?type=riven&weapon_url_name=${encodeURIComponent(x.slug)}&re_rolls_min=0&re_rolls_max=0&sort_by=price_asc`;
      return `<tr><td><div class="item-cell">${itemImage(x)}<div><button class="item-name" data-riven-detail="${esc(x.slug)}">${esc(x.name)}</button><div class="item-meta">${esc(x.english)} · ${esc(categories[x.category]||x.category)}</div></div></div></td><td><span class="price purple">${price(q.reference)}</span><div class="subline">${q.reference_n?`最低 ${q.reference_n} 位卖家`:q.error?'查询失败，保留旧值':q.at?'无合格挂单':'未查询，不代表低价'}</div></td><td><span class="price">${price(q.floor)}</span></td><td><span class="price">${price(q.online_floor)}</span><div class="subline">${q.at?`${q.online_sellers} 位在线卖家`:'待查询'}</div></td><td><span>${q.sellers??'—'} 位卖家</span><div class="subline">${q.at?`从 ${q.returned} 份返回结果筛选${q.sellers<3?' · 样本少':''}`:'尚未覆盖'}</div></td><td><div class="subline ${q.error?'negative':stale(q.at)?'':'positive'}">${q.error?'刷新失败 · 旧值':stale(q.at)?'● '+timeLabel(q.at):timeLabel(q.at)}</div></td><td><a class="market-link" href="${esc(url)}" target="_blank" rel="noopener">WFM ↗</a><button class="detail-btn" data-riven-refresh="${esc(x.slug)}" aria-label="刷新 ${esc(x.name)} 0 洗行情" ${state.riven_job?.running||window.Portable||window.Hosted?'disabled':''}>↻</button></td></tr>`;
    }).join(''):'<tr><td colspan="7" class="empty">没有匹配的武器；可以切换“全部武器”搜索。</td></tr>';
    renderProgress();
  }
  async function refreshRivens(slugs){
    if(window.Hosted)return notify('在线版只显示最近发布的候选挂单；逐个实时查价请点 WFM。');if(window.Portable)return notify('便携版保留挂单快照；可点 WFM 查看最新报价。');
    const selected=slugs||rivenRows().map(x=>x.slug);if(!selected.length)return notify('先选择要查询的武器。');
    try{state.riven_job={running:true,done:0,total:selected.length,current:'准备查询…',errors:[]};renderJob();await request('/api/rivens/refresh',{slugs:selected});$('notice').hidden=true;await loadState();}catch(error){notify(error.message);await loadState().catch(()=>{});}
  }
  function openRiven(slug){
    detailRiven=slug;selected=null;const x=weapon(slug),q=rquote(slug);if(!x)return;
    $('drawer-content').innerHTML=`<div class="drawer-label purple">0 洗紫卡 · ${esc(categories[x.category]||x.category)}</div><div class="drawer-art">${itemImage(x,true)}</div><h2>${esc(x.name)}</h2><p class="english">${esc(x.english)} · 循环次数为 0，不限制 MOD 等级</p><div class="detail-metrics"><div><small>低价卖家参考</small><strong>${price(q.reference)}</strong></div><div><small>最低挂价</small><strong>${price(q.floor)}</strong></div><div><small>在线最低</small><strong>${price(q.online_floor)}</strong></div></div><p class="drawer-muted">参考取不同卖家的最低 ${q.reference_n||3} 份中位数；仅包含近 30 天更新的公开直售单。${q.sellers??0} 位合格卖家来自本次返回的 ${q.returned??0} 份样本，并非全市场总量。</p><h3>最低的五位卖家</h3><div class="riven-offers">${q.offers?.length?q.offers.map((o,i)=>`<a href="https://warframe.market/auction/${encodeURIComponent(o.id)}" target="_blank" rel="noopener"><span class="offer-number">${i+1}</span><strong>${number(o.price)}p</strong><span>${o.status==='ingame'?'游戏中':o.status==='online'?'在线':'离线'} · MOD 等级 ${o.rank??'—'}</span><b>↗</b></a>`).join(''):'<div class="chart-empty">暂无合格挂单，点击页面刷新后再看。</div>'}</div><p class="drawer-muted">这里只比较武器的 0 洗卡底价；具体词条与强弱请打开原挂单查看。挂价不等于成交价。</p><div class="drawer-time">查询 ${timeLabel(q.at)}${q.error?' · 最近刷新失败，保留旧值':''}</div>`;
    $('drawer').hidden=false;$('drawer-overlay').hidden=false;document.body.style.overflow='hidden';$('close-drawer').focus();
  }
  async function ensureRelics(){
    if(relicData&&itemData)return;
    if(!relicLoading)relicLoading=(async()=>{
      const results=await Promise.allSettled([request('/api/relics'),request('/api/items')]);
      if(results[0].status==='rejected')throw results[0].reason;if(results[1].status==='rejected')throw results[1].reason;
      relicData=results[0].value;itemData=results[1].value;relicIndex=new Map(relicData.items.map(x=>[x.id,x]));itemIndex=new Map(itemData.map(x=>[x.slug,x]));
    })().catch(error=>{relicLoading=null;throw error;});
    await relicLoading;
  }
  function normalized(value){return value.toLowerCase().replace(/古纪/g,'lith').replace(/前纪/g,'meso').replace(/中纪/g,'neo').replace(/后纪/g,'axi').replace(/遗物|relic|[\s_\-]/g,'');}
  function selections(){return [0,1,2,3].map(i=>settings.relics?.[i]||null);}
  function chosenRewards(i){
    const choice=selections()[i],relic=choice&&relicIndex.get(choice.id);if(!relic)return [];
    return (relic.grades[choice.grade||'intact']||[]).map(r=>{
      const base=relic.grades.intact.find(x=>x.name===r.name);
      const rarity=base.chance<5?'gold':base.chance<20?'silver':'bronze';
      return {...r,rarity,item:r.slug?itemIndex.get(r.slug):null};
    });
  }
  function quoteInfo(r){
    if(!r.slug)return null;
    const m=mrow(r.slug),current=ask(m);
    const average=MarketStats.window(m,30).price;
    if(average!=null&&DeskCore.fresh(m.stats_at,m.stats_error))return {value:average,basis:'mean30'};
    if(current!=null&&DeskCore.fresh(m.orders_at,m.orders_error))return {value:current,basis:'ask'};
    return null;
  }
  function quote(r){return quoteInfo(r)?.value??null;}
  function allRewards(){return [0,1,2,3].flatMap(chosenRewards);}
  function relicState(relic){return relic.vaulted===true?'入库':relic.vaulted===false?'出库':'状态未知';}
  function relicStateHint(relic){return relic.vaulted===true?'已入库，当前通常不会从新掉落表获得':relic.vaulted===false?'出库中，当前仍可能从掉落表获得':'状态未标注，先核对来源';}
  function adviceRows(){
    const q=normalized(relicAdviceQuery),grade=relicAdviceGrade;
    return relicData.items.map(relic=>{
      const drops=(relic.grades[grade]||relic.grades.intact||[]).map(drop=>{const item=drop.slug&&itemIndex.get(drop.slug),quote=quoteInfo(drop);return {...drop,item,price:quote?.value??null,priceBasis:quote?.basis};});
      const tradable=drops.filter(drop=>drop.tradable),priced=tradable.filter(drop=>Number.isFinite(drop.price));
      const ev=priced.length?priced.reduce((sum,drop)=>sum+drop.price*drop.chance/100,0):null;
      const best=priced.length?Math.max(...priced.map(drop=>drop.price)):null;
      const matches=!q||[relic.id,relic.name,relic.zh,...drops.flatMap(drop=>[drop.name,drop.item?.name,drop.item?.english])].filter(Boolean).some(value=>normalized(value).includes(q));
      return {...relic,drops,tradable,priced,ev,best,coverage:tradable.length?priced.length/tradable.length:1,matches};
    }).filter(relic=>relic.matches&&(relicAdviceVault==='all'||relicAdviceVault===(relic.vaulted?'vaulted':'unvaulted'))&&(relic.ev==null?relicAdviceMin===0:relic.ev>=relicAdviceMin)&&(relic.best==null?relicAdviceBestMin===0:relic.best>=relicAdviceBestMin)).sort((a,b)=>{
      const av=relicAdviceSort==='best'?a.best??-Infinity:a.ev??-Infinity,bv=relicAdviceSort==='best'?b.best??-Infinity:b.ev??-Infinity;
      return bv-av||Number(b.coverage)-Number(a.coverage)||a.name.localeCompare(b.name,undefined,{numeric:true});
    });
  }
  function useAdviceRelic(id){
    const relic=relicIndex.get(id),i=selections().findIndex(choice=>!choice);if(!relic)return;
    if(i<0)return notify('四个遗物栏已填满；先清空一个栏位再填入。');
    settings.relics[i]={id,grade:$('relic-grade-'+i).value||'intact'};syncRelicFields();persistRelics();document.querySelector('[data-slot-card="'+i+'"]')?.scrollIntoView({block:'center',behavior:'smooth'});
  }
  function renderRelicAdvice(){
    const box=$('relic-advice-list'),summary=$('relic-advice-summary');if(!box||!relicData)return;
    const rows=adviceRows(),known=rows.filter(row=>row.ev!=null),display=rows.slice(0,relicAdviceLimit);
    summary.textContent=`${rows.length} 个遗物 · ${known.length} 个有可用报价 · 期望价值按 30 天成交均价计算；没有成交数据时才回退在线最低卖价 · 缺价不按 0p 处理。`;
    box.innerHTML=display.length?display.map((relic,index)=>{
      const priced=[...relic.priced].sort((a,b)=>(b.price??-1)-(a.price??-1));
      const rewards=priced.slice(0,3).map(drop=>`<span class="relic-advice-drop" title="${drop.priceBasis==='mean30'?'30 天成交均价':'没有成交数据，使用当前在线最低卖单'}"><b>${esc(drop.item?.name||drop.name)}</b><strong>${number(drop.price)}p</strong><small>${drop.priceBasis==='mean30'?'30天均价':number(drop.chance,2)+'%'}</small></span>`).join('');
      const unknown=relic.tradable.length-relic.priced.length;
      return `<article class="relic-advice-card"><div class="relic-advice-title"><span class="relic-advice-rank">${index+1}</span><div><h4>${esc(relic.zh||relic.name)}</h4><small>${esc(relic.name)} · <b class="relic-vault-${relic.vaulted?'in':'out'}">${relicState(relic)}</b> · ${esc(relicStateHint(relic))}</small></div><button class="plain-button" data-relic-use="${esc(relic.id)}">填入下一空位</button></div><div class="relic-advice-metrics"><span><b>${relic.ev==null?'—':number(relic.ev,1)+'p'}</b><small>期望价值</small></span><span><b>${relic.best==null?'—':number(relic.best,1)+'p'}</b><small>最高掉落</small></span><span><b>${relic.priced.length}/${relic.tradable.length}</b><small>报价覆盖</small></span></div><div class="relic-advice-drops">${rewards||'<span class="relic-advice-empty">暂无可用报价</span>'}</div>${unknown?`<small class="relic-advice-warning">还有 ${unknown} 个可交易掉落缺少最新报价</small>`:''}</article>`;
    }).join(''):'<p class="relic-advice-empty">没有符合条件的遗物。降低最低期望价值，或清除搜索 / 状态筛选。</p>';
    if(rows.length>relicAdviceLimit)box.insertAdjacentHTML('beforeend','<button id="relic-advice-more" class="plain-button relic-advice-more">再显示 60 个</button>');
    $('relic-advice-more')?.addEventListener('click',()=>{relicAdviceLimit+=60;renderRelicAdvice();});
  }
  function persistRelics(){queueSave();renderRelicBodies();}
  function buildRelics(){
    if(relicBuilt)return;relicBuilt=true;
    $('relic-section').innerHTML=`<div class="relic-controls"><div><h2>遗物掉落</h2><p>可输入编号、遗物名称或内部件名称；也可以在下方目录直接填入四个栏位。</p></div><div class="relic-buttons"><button id="relic-example" class="plain-button">载入示例</button><button id="relic-clear" class="plain-button">清空</button><button id="relic-focus" class="plain-button">⛶ 战斗视图</button><button id="relic-query" class="primary">查询掉落价格</button></div></div><div class="relic-combinations"><label>裂缝时代 <select id="relic-era" aria-label="四个遗物统一裂缝时代">${eras.map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><button id="relic-same" class="plain-button">四人同第一个遗物</button><label>统一精炼 <select id="relic-all-grade" aria-label="统一精炼等级"><option value="">分别设置</option>${grades.map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><select id="relic-presets" aria-label="已保存遗物组合"><option value="">选择常用组合</option></select><input id="relic-preset-name" aria-label="遗物组合名称" maxlength="40" placeholder="例如：本周四人光辉"><button id="relic-save-preset" class="plain-button">保存组合</button><button id="relic-delete-preset" class="plain-button">删除组合</button></div><div class="relic-options"><div class="segmented" aria-label="掉落排序"><button data-relic-sort="price" class="active">按白金价格 ↓</button><button data-relic-sort="rarity">按金银铜顺序</button></div><span id="relic-status">先选裂缝时代，再输入遗物编号。</span></div><div class="relic-selection-tools"><span id="relic-selection-status" role="status">点击奖励选中，每栏一个，方便对照。</span><button id="relic-clear-selected" class="plain-button" disabled>清除选中</button></div><div class="relic-reward-search"><label for="relic-reward-query">快速查奖励</label><input id="relic-reward-query" type="search" placeholder="输入奖励名，例如：伯斯顿 Prime 蓝图" aria-label="快速查奖励"><span id="relic-reward-hint">输入奖励名后，直接显示它来自哪一栏。</span><div id="relic-reward-results" role="status" hidden></div></div><div id="relic-columns" class="relic-columns">${[0,1,2,3].map(i=>`<article class="relic-card" data-slot-card="${i}"><div class="relic-card-head"><span class="slot-number">${i+1}</span><div class="relic-select"><label for="relic-input-${i}">第 ${i+1} 个遗物</label><input id="relic-input-${i}" data-relic-input="${i}" type="text" autocomplete="off" placeholder="输入编号 / 部件名" aria-label="第 ${i+1} 个遗物" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="relic-menu-${i}"><div id="relic-menu-${i}" class="relic-menu" role="listbox" hidden></div></div><button data-clear-relic="${i}" class="clear-relic" aria-label="清除第 ${i+1} 个遗物">×</button></div><div class="relic-grade"><select id="relic-grade-${i}" data-relic-grade="${i}" aria-label="第 ${i+1} 个遗物精炼等级">${grades.map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><span id="relic-estimate-${i}"></span></div><div id="relic-drops-${i}" class="relic-drops"></div></article>`).join('')}</div><section class="relic-advice"><div class="relic-advice-head"><div><h3>开核桃建议</h3><p>按当前成交均价估算遗物内部掉落价值，点击“填入下一空位”就能加入上面的四个栏位。出库 = 当前仍可能掉落；入库 = 已进入 Vault，通常只能消耗已有库存。</p></div></div><div class="relic-advice-controls"><input id="relic-advice-search" type="search" placeholder="搜遗物编号、名称或部件，例如：伯斯顿 Prime" aria-label="搜索遗物或内部件"><select id="relic-advice-grade" aria-label="建议使用的精炼等级">${grades.map(([key,label])=>`<option value="${key}" ${key===relicAdviceGrade?'selected':''}>${label}</option>`).join('')}</select><select id="relic-advice-sort" aria-label="遗物建议排序"><option value="ev">期望白金 ↓</option><option value="best">最高掉落 ↓</option></select><select id="relic-advice-min" aria-label="最低期望价值">${[[0,'不限期望价值'],[5,'期望至少 5p'],[10,'期望至少 10p'],[20,'期望至少 20p'],[50,'期望至少 50p'],[100,'期望至少 100p']].map(([value,label])=>`<option value="${value}" ${Number(value)===relicAdviceMin?'selected':''}>${label}</option>`).join('')}</select><select id="relic-advice-best-min" aria-label="最高掉落最低价值">${[[0,'不限最高掉落'],[10,'最高掉落至少 10p'],[20,'最高掉落至少 20p'],[50,'最高掉落至少 50p'],[100,'最高掉落至少 100p']].map(([value,label])=>`<option value="${value}" ${Number(value)===relicAdviceBestMin?'selected':''}>${label}</option>`).join('')}</select><select id="relic-advice-vault" aria-label="遗物出库入库状态"><option value="all">全部状态</option><option value="unvaulted">出库（当前掉落）</option><option value="vaulted">入库（已入 Vault）</option></select></div><p id="relic-advice-summary" class="relic-advice-summary"></p><div id="relic-advice-list" class="relic-advice-list"></div></section><div class="relic-footer"><span id="relic-source">掉落表 WFCD / Warframe Items</span><span>期望价值按 30 天成交均价；没有成交数据时才回退在线最低卖价</span></div>`;
    const panel=$('relic-section');
    panel.addEventListener('input',e=>{
      if(e.target.id==='relic-reward-query'){relicRewardQuery=e.target.value;renderRelicBodies();return;}
      if(e.target.dataset.relicInput===undefined)return;
      const i=Number(e.target.dataset.relicInput);
      const existing=selections()[i],r=existing&&relicIndex.get(existing.id);
      if(r&&e.target.value!==r.zh){settings.relics[i]=null;queueSave();renderRelicBodies();}
      suggestions(i,e.target.value);
    });
    panel.addEventListener('focusin',e=>{if(e.target.dataset.relicInput!==undefined)suggestions(Number(e.target.dataset.relicInput),e.target.value);});
    panel.addEventListener('focusout',e=>{if(e.target.dataset.relicInput!==undefined)setTimeout(()=>{const i=Number(e.target.dataset.relicInput),menu=$('relic-menu-'+i);if(!menu.contains(document.activeElement)){menu.hidden=true;e.target.setAttribute('aria-expanded','false');}},150);});
    panel.addEventListener('keydown',e=>{
      const i=e.target.dataset.relicInput;if(i===undefined)return;
      if(e.key==='Enter'||e.key==='ArrowDown'){
        const button=$('relic-menu-'+i).querySelector('[data-relic-choice]');if(button){e.preventDefault();if(e.key==='Enter')chooseRelic(Number(i),button.dataset.relicChoice);else button.focus();}
      }
      if(e.key==='Escape')$('relic-menu-'+i).hidden=true;
    });
    panel.addEventListener('click',e=>{
      const advice=e.target.closest('[data-relic-use]');
      if(advice)return useAdviceRelic(advice.dataset.relicUse);
      const result=e.target.closest('[data-reward-slot]');
      if(result){
        const i=Number(result.dataset.rewardSlot),name=result.dataset.rewardName;
        const target=[...($('relic-drops-'+i)?.querySelectorAll('[data-drop-name]')||[])].find(x=>x.dataset.dropName===name);
        target?.scrollIntoView({block:'center',behavior:'smooth'});target?.focus({preventScroll:true});return;
      }
      const drop=e.target.closest('[data-drop-slot]');if(drop){const i=Number(drop.dataset.dropSlot),current=selectedDrops.get(i);if(current?.name===drop.dataset.dropName)selectedDrops.delete(i);else selectedDrops.set(i,{id:selections()[i].id,name:drop.dataset.dropName});renderRelicBodies();$('relic-drops-'+i).querySelectorAll('[data-drop-name]').forEach(b=>{if(b.dataset.dropName===drop.dataset.dropName)b.focus({preventScroll:true});});return;}
      const choice=e.target.closest('[data-relic-choice]');if(choice)return chooseRelic(Number(choice.dataset.chooseSlot),choice.dataset.relicChoice);
      const clear=e.target.closest('[data-clear-relic]');if(clear){const i=Number(clear.dataset.clearRelic);settings.relics[i]=null;$('relic-input-'+i).value='';persistRelics();return;}
      const sortButton=e.target.closest('[data-relic-sort]');if(sortButton){settings.relicSort=sortButton.dataset.relicSort;persistRelics();}
    });
    panel.addEventListener('change',e=>{if(e.target.dataset.relicGrade!==undefined){const i=Number(e.target.dataset.relicGrade);if(selections()[i]){settings.relics[i].grade=e.target.value;persistRelics();}}});
    $('relic-same').onclick=()=>{const first=selections()[0];if(!first)return notify('先选择第一个遗物。');settings.relics=Array.from({length:4},()=>({...first}));syncRelicFields();persistRelics();};
    $('relic-all-grade').onchange=e=>{if(!e.target.value)return;for(const choice of selections())if(choice)choice.grade=e.target.value;syncRelicFields();persistRelics();};
    const presets=()=>{$('relic-presets').innerHTML='<option value="">选择常用组合</option>'+(settings.relicPresets||[]).map((p,i)=>`<option value="${i}">${esc(p.name)}</option>`).join('');};presets();
    $('relic-save-preset').onclick=()=>{if(!selections().some(Boolean))return notify('先选择至少一个遗物。');const name=$('relic-preset-name').value.trim();if(!name)return notify('请为组合起一个名称。');settings.relicPresets||=[];const old=settings.relicPresets.findIndex(p=>p.name===name),row={name,relics:structuredClone(selections())};if(old>=0)settings.relicPresets[old]=row;else settings.relicPresets.unshift(row);settings.relicPresets=settings.relicPresets.slice(0,12);queueSave();presets();notify('组合已记住，同名组合会更新。',true);};
    $('relic-presets').onchange=e=>{const p=settings.relicPresets?.[Number(e.target.value)];if(e.target.value===''||!p)return;settings.relics=structuredClone(p.relics);$('relic-preset-name').value=p.name;syncRelicFields();persistRelics();};
    $('relic-delete-preset').onclick=()=>{const v=$('relic-presets').value;if(v==='')return notify('先选择需要删除的组合。');settings.relicPresets.splice(Number(v),1);queueSave();presets();notify('组合已删除；当前四个遗物保持不变。',true);};
    $('relic-advice-search').oninput=e=>{relicAdviceQuery=e.target.value.trim();relicAdviceLimit=60;renderRelicAdvice();};
    $('relic-advice-grade').onchange=e=>{relicAdviceGrade=e.target.value;relicAdviceLimit=60;renderRelicAdvice();};
    $('relic-advice-sort').onchange=e=>{relicAdviceSort=e.target.value;relicAdviceLimit=60;renderRelicAdvice();};
    $('relic-advice-min').onchange=e=>{relicAdviceMin=Number(e.target.value);relicAdviceLimit=60;renderRelicAdvice();};
    $('relic-advice-best-min').onchange=e=>{relicAdviceBestMin=Number(e.target.value);relicAdviceLimit=60;renderRelicAdvice();};
    $('relic-advice-vault').onchange=e=>{relicAdviceVault=e.target.value;relicAdviceLimit=60;renderRelicAdvice();};
    $('relic-clear-selected').onclick=()=>{selectedDrops.clear();renderRelicBodies();};
    $('relic-query').onclick=()=>queryRelics(true);
    $('relic-focus').onclick=toggleFocus;
    $('relic-era').onchange=e=>{
      const next=e.target.value,previous=settings.relicEra||'';settings.relicEra=next;
      if(previous!==next&&selections().some(Boolean)){settings.relics=[null,null,null,null];syncRelicFields();notify('裂缝时代已切换，已清空旧遗物，请直接输入新的编号。',true);}
      queueSave();renderRelicBodies();
    };
    $('relic-clear').onclick=()=>{settings.relics=[null,null,null,null];[0,1,2,3].forEach(i=>{$('relic-input-'+i).value='';$('relic-menu-'+i).hidden=true;});persistRelics();};
    $('relic-example').onclick=()=>{
      const era=settings.relicEra||'lith',keys=Array.from({length:4},()=>`${era}_a1`);settings.relics=keys.map(id=>relicIndex.has(id)?{id,grade:'radiant'}:null);syncRelicFields();persistRelics();notify(`已载入 ${era.toUpperCase()} A1 演示遗物，可以直接修改编号。`,true);queryRelics(false);
    };
  }
  function suggestions(i,text){
    if(!relicData)return;
    const value=normalized(text),era=settings.relicEra||'';
    const matches=relicData.items.map(x=>{const reward=[...(x.grades.intact||[])].find(drop=>[drop.name,itemIndex.get(drop.slug)?.name,itemIndex.get(drop.slug)?.english].filter(Boolean).some(name=>normalized(name).includes(value)));return {relic:x,reward};}).filter(({relic,reward})=>(!era||relic.id.startsWith(era+'_'))&&(!value||normalized(relic.name).includes(value)||normalized(relic.zh).includes(value)||normalized(relic.id).includes(value)||reward)).sort((a,b)=>Number(normalized(b.relic.name)===value)-Number(normalized(a.relic.name)===value)||a.relic.name.localeCompare(b.relic.name,undefined,{numeric:true})).slice(0,12);
    const menu=$('relic-menu-'+i);menu.hidden=false;$('relic-input-'+i).setAttribute('aria-expanded','true');
    menu.innerHTML=matches.length?matches.map(({relic,reward})=>`<button type="button" role="option" data-relic-choice="${esc(relic.id)}" data-choose-slot="${i}"><b>${esc(relic.zh)}</b><small>${esc(relic.name)}${relicState(relic)}${reward?' · 含 '+esc(itemIndex.get(reward.slug)?.name||reward.name):''}</small></button>`).join(''):'<div class="no-suggestion">没有找到。可以输入遗物编号、中文名或内部件名，也可以用下方目录搜索。</div>';
  }
  function chooseRelic(i,id){
    const r=relicIndex.get(id);if(!r)return;
    if(settings.relicEra&&!id.startsWith(`${settings.relicEra}_`))return notify('这个遗物不属于当前选择的裂缝时代。');
    if(!Array.isArray(settings.relics))settings.relics=[null,null,null,null];
    settings.relics[i]={id,grade:$('relic-grade-'+i).value};$('relic-input-'+i).value=r.zh;$('relic-menu-'+i).hidden=true;$('relic-input-'+i).setAttribute('aria-expanded','false');persistRelics();
    if(i<3&&!selections()[i+1])$('relic-input-'+(i+1)).focus();
  }
  function syncRelicFields(){
    const presetValue=$('relic-presets').value;
    $('relic-presets').innerHTML='<option value="">选择常用组合</option>'+(settings.relicPresets||[]).map((p,i)=>`<option value="${i}">${esc(p.name)}</option>`).join('');
    $('relic-presets').value=presetValue;
    $('relic-era').value=settings.relicEra||'';
    [0,1,2,3].forEach(i=>{const s=selections()[i],r=s&&relicIndex.get(s.id);$('relic-input-'+i).value=r?.zh||'';$('relic-grade-'+i).value=s?.grade||'intact';});
  }
  function renderRelicBodies(){
    if(!relicBuilt||!relicData||tab!=='relics')return;
    for(const [i,choice] of selectedDrops)if(selections()[i]?.id!==choice.id||!chosenRewards(i).some(r=>r.name===choice.name))selectedDrops.delete(i);
    const all=allRewards(),known=all.filter(r=>r.tradable&&quote(r)!=null),max=known.length?Math.max(...known.map(quote)):null;
    window.RewardOcr?.setCandidates(all);
    const unique=new Set(all.filter(r=>r.tradable).map(r=>r.slug)),knownUnique=new Set(known.map(r=>r.slug));
    $('relic-status').textContent=unique.size?`已查到 ${knownUnique.size}/${unique.size} 种可交易掉落${all.some(r=>r.tradable&&stale(mrow(r.slug).orders_at))?' · 部分价格待刷新':''}`:'先输入遗物，回车选择候选。';
    document.querySelectorAll('[data-relic-sort]').forEach(b=>b.classList.toggle('active',(settings.relicSort||'price')===b.dataset.relicSort));
    [0,1,2,3].forEach(i=>{
      const rows=chosenRewards(i),container=$('relic-drops-'+i),estimate=$('relic-estimate-'+i);
      if(!rows.length){container.innerHTML='<div class="relic-empty"><span>◈</span><p>输入遗物名称<br>六种掉落将在这里展开</p></div>';estimate.textContent='';return;}
      const priced=rows.filter(r=>r.tradable&&quote(r)!=null),total=rows.reduce((a,r)=>a+r.chance,0);
      const ev=priced.reduce((a,r)=>a+quote(r)*r.chance/total,0),complete=rows.every(r=>!r.tradable||quote(r)!=null);
      estimate.innerHTML=priced.length?`<span>${complete?'挂价期望':'已知部分'} <b>${number(ev,1)}p</b></span>`:'<span>挂价期望 · 待查询</span>';
      estimate.title='按掉落概率和 30 天成交均价估算，不是保证收益；没有成交数据时才回退在线最低卖价；不可交易的 Forma 不计白金。缺价时只计算已知部分。';
      const rarityOrder={gold:0,silver:1,bronze:2};
      const sorted=[...rows].sort((a,b)=>(settings.relicSort||'price')==='price'?(quote(b)??-1)-(quote(a)??-1)||rarityOrder[a.rarity]-rarityOrder[b.rarity]:rarityOrder[a.rarity]-rarityOrder[b.rarity]);
      container.innerHTML=sorted.map(r=>{
        const p=quote(r),item=r.item||{name:r.name.startsWith('2X')?'Forma 蓝图 ×2':'Forma 蓝图',kind:'forma'},rarity=r.rarity;
        const display=item.name,isTop=p!=null&&p===max,isSelected=selectedDrops.get(i)?.name===r.name;
        return `<button type="button" class="drop-row ${rarity} ${isTop?'best-drop':''} ${isSelected?'selected-drop':''}" data-drop-slot="${i}" data-drop-name="${esc(r.name)}" aria-pressed="${isSelected}" aria-label="第 ${i+1} 栏：${esc(display)}" title="${esc(item.name)}${r.slug?' · 查询 '+timeLabel(mrow(r.slug).orders_at):' · 不可交易'}"><span class="drop-rarity"></span>${itemImage(item)}<span class="drop-name"><span>${esc(display)}</span><small>${number(r.chance,2)}%${item.ducats?' · '+number(item.ducats)+' 杜卡德':''}</small></span><span class="drop-price">${r.tradable?(p==null?'<span class="missing-price">待查询</span>':`<strong>${number(p)}</strong><small>p</small>`):'<span class="not-tradable">不可交易</span>'}${r.tradable&&p!=null?`<span class="drop-buy">${DeskCore.fresh(mrow(r.slug).orders_at,mrow(r.slug).orders_error)?'快照 '+timeLabel(mrow(r.slug).orders_at):'旧价 / 查询失败 · '+timeLabel(mrow(r.slug).orders_at)}</span>`:''}</span><span class="drop-selected-mark" aria-hidden="true">✓</span></button>`;
      }).join('');
    });
    const picked=[...selectedDrops].sort(([a],[b])=>a-b).map(([i,c])=>{const r=chosenRewards(i).find(r=>r.name===c.name),p=quote(r);return `${i+1} 栏 ${r.item?.name||'Forma 蓝图'} · ${r.tradable?(p==null?'待查询':number(p)+'p'):'不可交易'}`;});
    $('relic-selection-status').textContent=picked.length?picked.join('　/　'):'点击奖励选中，每栏一个，方便对照。';
    $('relic-clear-selected').disabled=!picked.length;
    $('relic-source').textContent=`掉落表 ${relicData.as_of} · WFCD / Warframe Items · 期望价值按 30 天成交均价`;
    renderRewardSearch(all);
    renderRelicAdvice();
    renderProgress();
  }
  function renderRewardSearch(all){
    const input=$('relic-reward-query'),box=$('relic-reward-results'),hint=$('relic-reward-hint');
    if(!input||!box)return;
    input.value=relicRewardQuery;
    const q=normalized(relicRewardQuery);
    if(!q){box.hidden=true;box.innerHTML='';hint.textContent='输入奖励名后，直接显示它来自哪一栏；四个遗物可按任意顺序填写。';return;}
    const matches=[];
    selections().forEach((choice,i)=>chosenRewards(i).forEach(r=>{
      const item=r.item,hay=[r.name,item?.name,item?.english,r.slug].filter(Boolean).map(normalized);
      if(hay.some(x=>x.includes(q)))matches.push({r,item,i,price:quote(r)});
    }));
    box.hidden=false;
    hint.textContent=matches.length?`找到 ${matches.length} 个结果；“第 N 栏”只是你输入的来源栏，不代表最终结算画面顺序。`:'没有匹配的奖励，试试中文名、英文名或武器名。';
    box.innerHTML=matches.length?matches.map(({r,item,i,price})=>`<button type="button" class="relic-reward-result" data-reward-slot="${i}" data-reward-name="${esc(r.name)}"><span class="reward-result-art">${itemImage(item||{name:r.name,kind:'forma'})}</span><span class="reward-result-name"><b>${esc(item?.name||r.name)}</b><small>第 ${i+1} 栏 · ${esc(r.rarity==='gold'?'金':r.rarity==='silver'?'银':'铜')} · ${number(r.chance,2)}%</small></span><strong>${r.tradable?(price==null?'待查询':number(price)+'p'):'不可交易'}</strong></button>`).join(''):'<p class="relic-reward-empty">没有匹配的奖励。</p>';
  }
  async function queryRelics(force){
    if(window.Hosted){if(force)await window.Hosted.reload();return;}
    if(window.Portable){if(force)notify('便携版只包含已查询的掉落报价；最新价格请使用本地服务版。');return;}
    const slugs=[...new Set(allRewards().filter(r=>r.tradable&&r.slug).map(r=>r.slug))];if(!slugs.length)return notify('请先从候选列表选择至少一个遗物。');
    try{state.compare_job={running:true,done:0,total:slugs.length,errors:[],current:'准备查询掉落价格…'};renderJob();await request('/api/compare',{slugs,force});$('notice').hidden=true;await loadState();}catch(error){notify(error.message);await loadState().catch(()=>{});}
  }
  function toggleFocus(){
    const enabled=document.body.classList.toggle('relic-focus');$('relic-focus').textContent=enabled?'⛶ 返回准备':'⛶ 战斗视图';
    if(enabled){settings.relicSortBeforeBattle=settings.relicSort||'price';settings.relicSort='rarity';}else settings.relicSort=settings.relicSortBeforeBattle||'price';renderRelicBodies();
    window.scrollTo(0,0);
  }
  function renderProgress(){
    if(tab==='rivens'&&rivenBuilt){const job=state.riven_job;const count=rivenRows().length;$('refresh').querySelector('span').textContent=window.Hosted?'获取最新已发布行情':window.Portable?'快照版 · 可点 WFM 查价':job?.running?`更新中 ${Math.round(job.done/job.total*100)}%`:`刷新当前列表（${count}）`;}
    if(tab==='relics'&&relicBuilt){const job=state.compare_job,button=$('relic-query');button.disabled=!!job?.running||!!window.Portable;button.textContent=window.Hosted?'检查掉落行情更新':window.Portable?'行情快照':job?.running?`查询中 ${Math.round(job.done/job.total*100)}%`:'查询掉落价格';}
  }
  async function activate(next){
    if(next!=='relics'){window.RewardOcr?.leave();if(document.body.classList.contains('relic-focus'))toggleFocus();}
    if(next==='rivens'){buildRivens();renderRivens();}
    if(next==='relics'){
      if(!Array.isArray(settings.relics))settings.relics=[null,null,null,null];
      buildRelics();$('relic-status').textContent='正在加载遗物与物品目录…';
      try{await ensureRelics();window.RewardOcr?.mount(itemData,relicData);syncRelicFields();renderRelicBodies();}catch(error){notify('遗物目录加载失败：'+error.message+'。重新点击开核桃助手可重试。');}
    }
  }
  function update(){
    if(tab==='rivens')renderRivens();
    if(tab==='relics'&&relicData){renderRelicBodies();window.RewardOcr?.update();}
  }
  window.Extras={activate,update,refreshRivens,renderProgress,ready:()=>{}};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('relic-focus'))toggleFocus();});
})();
