'use strict';
window.Desk = (() => {
  let initialized = false,
    undo = [],
    addSelection = null,
    baroMode = 'current',
    baroQuery = '',
    baroSort = 'hold',
    baroKind = 'all',
    baroMinWeek = 0,
    ducatMode = 'market',
    ducatView = 'bundles',
    ducatBundleQuery = '',
    ducatHideMarked = false,
    ducatKind = 'all',
    ducatMinYield = 150,
    ducatQuery = '',
    ducatLimit = 40,
    ducatBundleLimit = 10,
    ducatSelected = null,
    ducatTarget = null,
    ducatCopies = 1,
    ducatManual = null,
    ducatSort = 'ratio',
    ducatCalcOpen = false,
    customQuery = '',
    baseline = {};
  const labels = { sell: '在线最低卖价', buy: '在线最高买价', mean30: '30 天成交均价' };
  const sellerStatus = status =>
    status === 'ingame' ? '游戏中' : status === 'online' ? '在线' : '状态未知';
  const today = () => new Date().toISOString().slice(0, 10);
  const age = at => {
    if (!at || !Number.isFinite(Date.parse(at))) return '未查询';
    const h = Math.max(0, (Date.now() - Date.parse(at)) / 3600000);
    return h < 1
      ? Math.round(h * 60) + ' 分钟前'
      : h < 48
        ? Math.floor(h) + ' 小时前'
        : Math.floor(h / 24) + ' 天前';
  };
  const input = (key, label, value = '', extra = '') =>
    `<label>${label}<input name="${key}" aria-label="${label}" value="${esc(value ?? '')}" ${extra}></label>`;
  const linked = x =>
    `<a class="link" href="https://warframe.market/items/${encodeURIComponent(x.slug)}" target="_blank" rel="noopener">去 WFM 核价 ↗</a>`;
  const remember = () => {
    undo.push(structuredClone(settings));
    if (undo.length > 20) undo.shift();
    $('undo-change').hidden = false;
  };
  const entries = () => settings.transactions || (settings.transactions = []);
  const entry = x => ({ id: crypto.randomUUID(), date: today(), ...x });
  function opening(slug) {
    if (!entries().some(e => e.slug === slug) && srow(slug).quantity > 0)
      entries().push(
        entry({
          slug,
          type: 'opening',
          quantity: srow(slug).quantity,
          price: srow(slug).cost ?? null,
          note: '首次记账时的期初库存；日期不是原购买日'
        })
      );
  }
  function persist() {
    queueSave();
    renderMetrics();
    if (baseTabs.includes(tab)) renderTable();
    if (['ledger', 'sets', 'routes', 'ducats'].includes(tab)) activate();
  }
  function adjust(slug, value) {
    const old = srow(slug).quantity;
    if (value === old) return;
    if (!Number.isInteger(value) || value < 0 || value > 100000) return;
    remember();
    opening(slug);
    entries().push(
      entry({
        slug,
        type: 'adjust',
        quantity: value - old,
        price: null,
        note: '数量校正，差额不作为买卖收益'
      })
    );
    settings.items[slug] = {
      ...srow(slug),
      quantity: value,
      cost: DeskCore.ledger(entries()).holdingCosts[slug],
      reserve: Math.min(srow(slug).reserve || 0, value)
    };
    persist();
  }
  function init() {
    if (initialized || !settings) return;
    initialized = true;
    settings.transactions ||= [];
    settings.targetBasis ||= 'sell';
    settings.relicPresets ||= [];
    baseline = settings.seenMarket || {};
    const seen = {};
    for (const x of state.catalog) {
      const m = mrow(x.slug);
      if (m.orders_at) seen[x.slug] = { ask: ask(m), at: m.orders_at };
    }
    settings.seenMarket = seen;
    queueSave();
    $('add-inventory').disabled = false;
    $('add-inventory').onclick = openAdd;
    $('undo-change').onclick = () => {
      if (!undo.length) return;
      settings = undo.pop();
      $('stats-window').value = String(statsDays());
      $('target-basis').value = settings.targetBasis || 'sell';
      if (tab === 'relics') window.Extras?.activate('relics');
      $('undo-change').hidden = !undo.length;
      persist();
      if (selected) renderDrawer(selected);
      notify('已撤销上次库存或交易操作。', true);
    };
    const controls = document.createElement('label');
    controls.innerHTML = `目标观察依据 <select id="target-basis" aria-label="目标观察依据">${Object.entries(
      labels
    )
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join('')}</select>`;
    $('stats-controls').append(controls);
    const basisNote = document.createElement('span');
    basisNote.id = 'target-basis-note';
    basisNote.setAttribute('role', 'status');
    $('stats-controls').append(basisNote);
    $('target-basis').value = settings.targetBasis;
    $('target-basis').onchange = e => {
      settings.targetBasis = e.target.value;
      persist();
      if (selected && !$('drawer').hidden) renderDrawer(selected);
    };
    for (const id of ['add-dialog', 'trade-dialog']) {
      const d = document.createElement('dialog');
      d.id = id;
      document.body.append(d);
    }
    const health = document.createElement('div');
    health.id = 'data-health';
    health.className = 'data-health';
    document.querySelector('header').after(health);

    document.addEventListener('click', e => {
      const tx = e.target.closest('[data-trade]');
      if (tx) return trade(tx.dataset.trade);
      const detail = e.target.closest('[data-desk-detail]');
      if (detail) return openDrawer(detail.dataset.deskDetail);
      const close = e.target.closest('[data-close-dialog]');
      if (close) return $(close.dataset.closeDialog).close();
    });
    document.addEventListener('change', e => {
      if (e.target.dataset.reserve) {
        const q = Number(e.target.value),
          slug = e.target.dataset.reserve;
        if (!Number.isInteger(q) || q < 0 || q > srow(slug).quantity) {
          notify('自用保留数量必须在 0 与当前库存之间。');
          e.target.value = srow(slug).reserve || 0;
          return;
        }
        remember();
        settings.items[slug] = { ...srow(slug), reserve: q };
        persist();
      }
    });
    render();
  }
  function health() {
    const focus = state.catalog.filter(x => held(x) || srow(x.slug).watch);
    const scope = focus.length ? focus : state.catalog.filter(x => x.kind === 'frame' || x.baro);
    const good = scope.filter(x =>
      DeskCore.fresh(mrow(x.slug).orders_at, mrow(x.slug).orders_error)
    ).length;
    const unknown = scope.filter(x => !mrow(x.slug).orders_at).length,
      fail = scope.filter(x => mrow(x.slug).orders_error || mrow(x.slug).stats_error).length;
    const b = state.baro,
      statsGood = scope.filter(x => DeskCore.statsFresh(mrow(x.slug))).length,
      phases = state.refresh_status?.sources,
      statsTime = phases?.stats?.finished
        ? timeLabel(phases.stats.finished)
        : '批次时间未记录，见商品详情',
      rivenTime = phases?.rivens?.finished
        ? timeLabel(phases.rivens.finished)
        : '批次时间未记录，见商品详情';
    $('data-health').innerHTML =
      `<span>${snapshotLabel()}</span><details><summary>数据状态${fail ? ' · ' + fail + ' 项失败' : ''}</summary><p>${focus.length ? '持仓 / 关注' : '主要目录'}：${good}/${scope.length} 项报价在 2 小时内，${unknown} 项未查询，${fail} 项失败；${statsGood}/${scope.length} 项成交统计有效（8 小时内采集，统计截止日通过检查）。</p><p>成交统计最近抓取：${statsTime}；紫卡最近批次：${rivenTime}。挂单每小时更新，成交统计 / 紫卡每 6 小时检查更新。</p><p>网页发布不代表重新抓取行情；行情抓取完成也不代表所有商品查询成功。每项查询时间见商品详情，过期或缺价不按零计算。货单：${b?.at ? age(b.at) : '未查询'}${b?.error ? '，获取失败' : ''}。</p><a class="link" href="https://github.com/Vizards8/warframe-market-dashboard/actions/workflows/pages.yml" target="_blank" rel="noopener">更新记录 / 手动抓取 ↗</a></details>`;
  }
  function render() {
    if (!initialized) return;
    health();
    $('desk-overview').hidden = tab !== 'inventory';
    if (tab !== 'inventory') return;
    const items = state.catalog.filter(held),
      alerts = [];
    for (const x of items) {
      const s = srow(x.slug),
        m = mrow(x.slug),
        q = targetQuote(m);
      if (targetHit(s, m))
        alerts.push(
          `<button data-desk-detail="${esc(x.slug)}"><b>${esc(x.name)}</b><span>${q.label} ${number(q.value, 1)}p ≥ 观察线 ${s.target}p。先核价，再决定挂售。</span></button>`
        );
      const p = baseline[x.slug];
      if (
        p?.ask > 0 &&
        ask(m) != null &&
        p.at !== m.orders_at &&
        DeskCore.fresh(m.orders_at, m.orders_error) &&
        Math.abs(ask(m) / p.ask - 1) >= 0.1
      )
        alerts.push(
          `<button data-desk-detail="${esc(x.slug)}"><b>${esc(x.name)} 报价变化</b><span>上次访问 ${number(p.ask)}p → 本次 ${number(ask(m))}p，均为卖单快照。</span></button>`
        );
      if (
        DeskCore.baro(state.baro) === 'active' &&
        state.baro.inventory.some(r => r.slug === x.slug)
      )
        alerts.push(
          `<button data-desk-detail="${esc(x.slug)}"><b>${esc(x.name)} 本次在售</b><span>你持有 ${s.quantity} 份。供应增加，核对后再决定。</span></button>`
        );
    }
    const old = items.filter(
      x => !DeskCore.fresh(mrow(x.slug).orders_at, mrow(x.slug).orders_error)
    ).length;
    $('desk-overview').innerHTML =
      `<div class="desk-title"><h2>持仓观察</h2><span>${items.length} 种持仓 · ${state.catalog.filter(x => srow(x.slug).watch).length} 种关注</span></div><div class="alert-grid">${alerts.slice(0, 6).join('') || `<div class="empty-card">${items.length ? '暂无明确达到观察线或明显变化的持仓。' : '还没有库存，点右上角“添加库存”；已有备份可直接导入。'}</div>`}</div>${old ? `<p class="quality-warning">${old} 种持仓报价过期或缺失，暂不判断是否达到观察线。</p>` : ''}`;
  }
  function openAdd() {
    addSelection = null;
    const d = $('add-dialog');
    d.innerHTML = `<div class="dialog-heading"><h2>添加库存</h2><button data-close-dialog="add-dialog" class="close-button" aria-label="关闭添加库存">×</button></div><label>搜索商品<input id="add-search" type="search" aria-label="添加库存搜索" placeholder="中文 / 英文 / 简称，例如 棱晶、热病、Frost"></label><div id="add-results" class="add-results"></div><div id="add-fields"></div>`;
    $('add-search').oninput = addResults;
    d.showModal();
    addResults();
    $('add-search').focus();
  }
  function addResults() {
    const q = $('add-search').value.trim().toLowerCase();
    const matches = state.catalog
      .filter(
        x =>
          !q || [x.name, x.english, x.alias, x.slug].some(v => (v || '').toLowerCase().includes(q))
      )
      .slice(0, 12);
    $('add-results').innerHTML =
      matches
        .map(
          x =>
            `<button data-add-choice="${esc(x.slug)}">${itemImage(x)}<span><b>${esc(x.name)}</b><small>${esc(x.english)} · ${kindLabel[x.kind] || '商品'}${x.kind === 'mod' ? ' · R0' : ''}</small></span></button>`
        )
        .join('') ||
      '<p>目录暂未覆盖该商品。请确认普通 / Prime / 棱晶 / 破坏者版本；未找到不代表无法交易。</p>';
    $('add-results')
      .querySelectorAll('[data-add-choice]')
      .forEach(
        b =>
          (b.onclick = () => {
            addSelection = b.dataset.addChoice;
            const x = state.catalog.find(x => x.slug === addSelection);
            $('add-fields').innerHTML =
              `<form id="add-form"><h3>${esc(x.name)}${x.kind === 'mod' ? ' · R0' : ''}</h3><p>${x.kind === 'weapon' ? '武器须保持游戏允许交易的未使用状态，请自行核对。' : '按上方精确版本录入。'}</p><div class="form-grid">${input('quantity', '本次增加数量', 1, 'type="number" min="1" max="100000" step="1" required')}${input('cost', '单件白金成本（可选）', '', 'type="number" min="0" max="1000000" step="0.1"')}</div><button class="primary" type="submit">加入库存</button></form>`;
            $('add-form').onsubmit = e => {
              e.preventDefault();
              const f = new FormData(e.target),
                q = Number(f.get('quantity')),
                p = f.get('cost') === '' ? null : Number(f.get('cost'));
              if (q + srow(addSelection).quantity > 100000) return notify('总数量超过上限。');
              recordTrade(addSelection, 'buy', q, p, today(), '添加库存');
              dClose('add-dialog');
              notify('已加入库存；成本未知的部分不会虚算利润。', true);
            };
          })
      );
  }
  function dClose(id) {
    $(id).close();
  }
  function recordTrade(slug, type, q, p, date, note) {
    remember();
    opening(slug);
    entries().push(entry({ slug, type, quantity: q, price: p, date, note }));
    const old = srow(slug),
      n = old.quantity + (type === 'sell' ? -q : q);
    settings.items[slug] = {
      ...old,
      quantity: n,
      cost: DeskCore.ledger(entries()).holdingCosts[slug],
      watch: old.watch || false
    };
    persist();
  }
  function trade(slug) {
    const x = state.catalog.find(x => x.slug === slug),
      d = $('trade-dialog');
    d.innerHTML = `<div class="dialog-heading"><h2>${esc(x.name)} · 记录交易</h2><button class="close-button" data-close-dialog="trade-dialog" aria-label="关闭交易记录">×</button></div><p>持有 ${srow(slug).quantity}，自用保留 ${srow(slug).reserve || 0}；记录在本浏览器保存。</p><form id="trade-form"><div class="form-grid"><label>交易类型<select name="type" aria-label="交易类型"><option value="sell">卖出</option><option value="buy">买入 / 兑换</option></select></label>${input('quantity', '交易数量', 1, 'type="number" min="1" max="100000" step="1" required')}${input('price', '单件白金价格', '', 'type="number" min="0" max="1000000" step="0.1"')}${input('date', '交易日期', today(), 'type="date" required max="' + today() + '"')}${input('note', '交易备注（可写兑换资源）', '', 'maxlength="300"')}</div><p>卖出价格必填；兑换资源写在备注，白金成本未知时留空，不能把资源免费折算成利润。成本按已记录的先入先出计算。</p><div id="trade-error" class="negative" role="status"></div><button class="primary" type="submit">记录并更新库存</button></form>`;
    d.showModal();
    $('trade-form').onsubmit = e => {
      e.preventDefault();
      const f = new FormData(e.target),
        type = f.get('type'),
        q = Number(f.get('quantity')),
        p = f.get('price') === '' ? null : Number(f.get('price'));
      if (type === 'sell' && (q > DeskCore.available(srow(slug)) || p == null)) {
        $('trade-error').textContent = '请填写卖出价格，数量不得超过扣除自用保留后的库存。';
        return;
      }
      if (type === 'buy' && q + srow(slug).quantity > 100000) {
        $('trade-error').textContent = '库存超过上限。';
        return;
      }
      recordTrade(slug, type, q, p, String(f.get('date')), String(f.get('note')));
      d.close();
      if (selected === slug) renderDrawer(slug);
      notify('交易已记录，可用“撤销上次操作”恢复。', true);
    };
  }
  function holdingAge(slug) {
    let lots = [];
    for (const e of entries().filter(e => e.slug === slug)) {
      if (e.type === 'buy' || e.type === 'opening' || (e.type === 'adjust' && e.quantity > 0))
        lots.push({ q: e.quantity, date: e.type === 'buy' ? e.date : null });
      else {
        let left = Math.abs(e.quantity);
        while (left && lots.length) {
          const n = Math.min(left, lots[0].q);
          left -= n;
          lots[0].q -= n;
          if (!lots[0].q) lots.shift();
        }
      }
    }
    const known = lots
      .filter(l => l.date)
      .map(l => Math.max(0, Math.floor((Date.parse(today()) - Date.parse(l.date)) / 86400000)));
    return known.length
      ? `${Math.min(...known)}—${Math.max(...known)} 天（已记录买入批次）${lots.some(l => !l.date) ? '；另有购买日未知的期初 / 校正库存' : ''}`
      : '购买日未知；期初日期不作为购买日期';
  }
  function quoteDetail(slug) {
    const m = mrow(slug),
      s = srow(slug),
      q = targetQuote(m),
      v = DeskCore.depth(m.orders?.buy, DeskCore.available(s));
    return `<section class="decision-card"><h3>我的观察线 · ${labels[settings.targetBasis || 'sell']}</h3><p>${q.valid ? `${number(q.value, 1)}p · ${targetHit(s, m) ? '已达到观察线，去 WFM 核实' : '尚未达到观察线或未设置目标'}` : '该依据过期、缺价或查询失败，暂不判断。'}。图表窗口不会改变观察依据。</p><p>求购深度快照（最多前 10 单）：可覆盖 ${v.covered}/${DeskCore.available(s)} 份，合计 ${number(v.value)}p${v.left ? '；剩余未覆盖' : ''}。${DeskCore.fresh(m.orders_at, m.orders_error) ? '' : '报价已过期。'}需重新核价，不保证成交。</p><label>自用保留数量 <input type="number" min="0" max="${s.quantity}" step="1" value="${s.reserve || 0}" data-reserve="${esc(slug)}" aria-label="${esc(state.catalog.find(x => x.slug === slug).name)} 自用保留数量"></label><div class="desk-actions"><button class="primary" data-trade="${esc(slug)}">记录买入 / 卖出</button>${linked({ slug })}</div><p>持有时间：${holdingAge(slug)}</p></section>`;
  }
  function history(slug) {
    const h = state.history?.items?.[slug] || [];
    if (!h.length)
      return '<p class="drawer-muted">长期历史开始积累后在此显示；不补造过去价格。</p>';
    const all = h.map(x => x.price),
      span = Math.max(...all) - Math.min(...all) || 1,
      lo = Math.min(...all),
      start = Date.parse(h[0].date),
      end = Date.parse(h.at(-1).date);
    const points = h
      .map(
        x =>
          `${20 + ((Date.parse(x.date) - start) / (end - start || 1)) * 420},${80 - ((x.price - lo) / span) * 65}`
      )
      .join(' ');
    return `<details class="history-view"><summary>已积累历史 ${h[0].date} — ${h.at(-1).date} · ${h.length} 个有记录日</summary><svg viewBox="0 0 460 100" role="img" aria-label="已积累每日成交均价"><polyline points="${points}" fill="none" stroke="#438661" stroke-width="2"/></svg><p>WFM 标记成交日均价，缺日不补零。公开历史随每次成功部署保留，最多 730 天。</p></details>`;
  }
  function baroRows() {
    const snap = state.baro,
      status = DeskCore.baro(snap);
    return state.catalog
      .filter(x => x.baro)
      .map(x => {
        const live = status === 'active' ? snap.inventory.find(r => r.slug === x.slug) : null;
        const manual =
          (settings.baroBasket || []).includes(x.slug) &&
          DeskCore.manualCurrent(settings.baroConfirmedAt?.[x.slug]);
        return {
          ...x,
          current: !!live,
          manual,
          ducats: live?.ducats ?? settings.baroCosts?.[x.slug]?.ducats ?? x.ducats ?? null,
          credits: live?.credits ?? settings.baroCosts?.[x.slug]?.credits ?? x.credits ?? null
        };
      });
  }
  function baro() {
    const el = $('mod-panel');
    el.hidden = tab !== 'mods';
    if (tab !== 'mods') return;
    const plannerOpen = !!el.querySelector('.baro-planner')?.open;
    const status = DeskCore.baro(state.baro),
      rows = baroRows(),
      active = rows.filter(x => x.current),
      plan = settings.baroPlan || {},
      planned = rows.filter(x => plan[x.slug] > 0),
      tot = DeskCore.budget(rows, plan);
    const scope = rows.filter(
      x =>
        baroMode === 'all' ||
        (baroMode === 'plan' && plan[x.slug] > 0) ||
        (baroMode === 'current' && (status === 'active' ? x.current : x.manual))
    );
    const list = scope.filter(
      x =>
        (!baroMinWeek ||
          (DeskCore.liquidity(mrow(x.slug)).valid &&
            DeskCore.liquidity(mrow(x.slug)).week >= baroMinWeek)) &&
        (baroKind === 'all' || x.kind === baroKind) &&
        (!baroQuery ||
          [x.name, x.english, x.slug].some(v => (v || '').toLowerCase().includes(baroQuery)))
    );
    list.sort((a, b) => {
      const av = DeskCore.baroValue(a, mrow(a.slug), settings, Date.now(), state.baro),
        bv = DeskCore.baroValue(b, mrow(b.slug), settings, Date.now(), state.baro),
        key =
          baroSort === 'volume'
            ? 'volume'
            : baroSort === 'current'
              ? 'currentEfficiency'
              : 'highEfficiency';
      return (
        (baroSort === 'liquid'
          ? DeskCore.liquidity(mrow(b.slug)).tier - DeskCore.liquidity(mrow(a.slug)).tier
          : 0) ||
        (bv[key] ?? -Infinity) - (av[key] ?? -Infinity) ||
        a.name.localeCompare(b.name)
      );
    });
    const budget = settings.baroBudget || {},
      statusText = {
        active: '本次在售',
        upcoming: '尚未到访',
        departed: '已离场',
        unknown: '本次货单待核对'
      }[status],
      snapshotFresh = DeskCore.fresh(state.baro?.at, state.baro?.error);
    const modeText = {
      current: '',
      plan: '填写补货数量后，在这里汇总；实际购买后再录入库存。',
      all: '历史可交易商品，非本次货单。日期为人工核对记录。'
    }[baroMode];
    $('table-title').innerHTML =
      { current: '本次武器与 MOD', plan: '我的购买计划', all: '奸商历史目录' }[baroMode] +
      ' <span id="table-count">' +
      list.length +
      ' 种</span>';
    $('table-description').textContent = '';
    el.innerHTML = `<div class="mod-panel-head"><div><h3>${statusText}${status === 'active' ? ` · ${active.length} 种（武器 ${active.filter(x => x.kind === 'weapon').length} / MOD ${active.filter(x => x.kind === 'mod').length}）` : ''}</h3><p>${status === 'active' ? `${esc(state.baro.location)} · 离场 ${timeLabel(state.baro.expiry)}` : status === 'upcoming' ? `预计到访 ${timeLabel(state.baro.activation)}，尚无本次货单。` : status === 'departed' ? `已于 ${timeLabel(state.baro.expiry)} 离场，旧货单不再作为在售。` : '自动货单不可用，可在历史目录中手动核对游戏货单。'} ${state.baro?.at ? (state.baro.source === 'https://api.warframe.com/cdn/worldState.php' ? 'DE 官方货单 · ' : '备用货单 · ') + '查询 ' + timeLabel(state.baro.at) : ''} ${!snapshotFresh && status === 'active' ? '<span class="quality-warning">货单快照已超过 2 小时，购买前请核对游戏内货单</span>' : ''}</p></div><a class="link" href="https://wiki.warframe.com/w/Baro_Ki%27Teer/Current_PC_Items" target="_blank" rel="noopener">完整货单（含外观等）↗</a></div>
  <div class="desk-actions baro-tabs">${[
    ['current', '本次全部商品'],
    ['plan', '我的购买计划'],
    ['all', '历史目录']
  ]
    .map(
      ([k, v]) =>
        `<button data-baro-mode="${k}" aria-pressed="${k === baroMode}" class="plain-button ${k === baroMode ? 'selected' : ''}">${v}</button>`
    )
    .join('')}</div>
  ${modeText ? `<p class="baro-mode-help">${modeText}</p>` : ''}
  <div class="desk-actions baro-filters"><input id="baro-search" type="search" aria-label="补仓搜索" placeholder="搜索 MOD / 武器" value="${esc(baroQuery)}"><select id="baro-kind" aria-label="奸商品类筛选">${[
    ['all', '全部武器与 MOD'],
    ['weapon', '只看武器'],
    ['mod', '只看 MOD']
  ]
    .map(([k, v]) => `<option value="${k}" ${k === baroKind ? 'selected' : ''}>${v}</option>`)
    .join(
      ''
    )}</select><label>排序 <select id="baro-sort" aria-label="奸商商品排序"><option value="hold" ${baroSort === 'hold' ? 'selected' : ''}>综合判断 / 90% 回款 ↓</option><option value="current" ${baroSort === 'current' ? 'selected' : ''}>当前卖价 / 百杜卡德 ↓</option><option value="liquid" ${baroSort === 'liquid' ? 'selected' : ''}>长期日均成交 ↓</option><option value="volume" ${baroSort === 'volume' ? 'selected' : ''}>30 天成交量 ↓</option></select></label><label>近 7 天 <select id="baro-min-volume" aria-label="最低七天成交记录">${[
    [0, '不限成交量'],
    [14, '至少 14 条（约 2 条 / 天）'],
    [70, '至少 70 条（约 10 条 / 天）']
  ]
    .map(([k, v]) => `<option value="${k}" ${baroMinWeek === k ? 'selected' : ''}>${v}</option>`)
    .join(
      ''
    )}</select></label><span>显示 ${list.length} / ${scope.length} 种</span></div><div class="baro-ranking-note"><span>按“基准 90% 回款”排序；回款是历史情景，不是保证价。</span><button class="plain-button" data-open-ducats>杜卡德成本测算 ↗</button></div>
  ${state.baro.character?.startsWith('EvilBaro') || state.baro.inventory?.some(x => /^(Evil Baro |Eskhatos )/.test(x.name)) ? '<p class="quality-warning">本次为 Eskhatos 特别货单，供应可能更频繁；历史均价尚未充分反映本轮补货。</p>' : ''}
  <div class="baro-decision-note"><b>怎么看：</b>投入杜卡德 → 基准价的 90% 回款；再看恢复需要几天、长期每天能成交多少条。三项都好才显示“优先考虑”。</div>
  <div class="compare-scroll baro-full-list"><table class="compare-table baro-table"><thead><tr><th>商品</th><th>投入 → 预计回款</th><th>恢复时间</th><th>长期成交</th><th>综合判断</th><th>已有 / 计划补货</th></tr></thead><tbody>${
    list
      .map((x, i) => {
        const v = statsFor(mrow(x.slug), 30),
          value = DeskCore.baroValue(x, mrow(x.slug), settings, Date.now(), state.baro),
          liq = DeskCore.liquidity(mrow(x.slug));
        return `<tr data-baro-slug="${esc(x.slug)}"><td><div class="baro-product"><span class="baro-rank">${i + 1}</span>${itemImage(x)}<div><button data-desk-detail="${esc(x.slug)}">${esc(x.name)}</button><small>${kindLabel[x.kind]}${x.kind === 'mod' ? ' · R0' : ''} · ${x.current ? '本次在售' : x.manual ? '手动已核对' : '本次未确认在售'}</small></div></div>${!x.current ? `<label><input type="checkbox" data-baro-confirm="${esc(x.slug)}" ${x.manual ? 'checked' : ''}> 备用：按游戏货单核对在售</label>` : ''}<details class="row-details"><summary>返场记录</summary><small>${x.baro_date ? '最近常规 ' + x.baro_date : '历史返场未核实'}</small>${x.supply_note ? `<small>${esc(x.supply_note)}</small>` : ''}</details></td><td><strong class="baro-efficiency">${value.target90 == null ? '待查询' : value.volatilityValid ? number(value.target90, 1) + 'p' : '波动不足'}</strong><small>投入 ${x.ducats != null ? number(x.ducats) + 'D' : '成本未知'} · ${value.highEfficiency != null ? number(value.highEfficiency, 1) + 'p / 100D' : value.volatilityValid ? '效率待查询' : `90 天区间波动 ${number(value.rangePct, 1)}%`}</small>${value.baseline != null ? `<small>基准 ${number(value.baseline, 1)}p · ${value.peak90 != null ? '90 天高位 ' + number(value.peak90, 1) + 'p' : ''}</small>` : ''}</td><td><strong class="baro-recovery">${value.eventActive ? '活动中' : value.recoveryDays == null ? '未知' : value.recoveryDays === 0 ? '已达到' : value.recoveryDays + ' 天'}</strong><small>${value.recoveryDays == null ? value.decision.reason : '返场后滚动 7 天均价达到基准 90%'}</small></td><td><div class="baro-volume"><strong>${number(value.dailyVolume, 1)}</strong><span>条 / 天</span></div><span class="liquidity-badge liquidity-${liq.tier}">${liq.label}</span><small>近 7 天 ${number(liq.week)} 条 · 30 天 ${number(liq.month)} 条</small><small class="${value.statsValid ? '' : 'quality-warning'}">${value.statsValid ? '' : '成交统计过期 / 缺失'}</small>${linked(x)}</td><td><strong class="baro-decision baro-decision-${value.decision.tone}">${value.decision.label}</strong><small>${esc(value.decision.reason)}</small></td><td>${x.current ? `${number(x.ducats)} 杜卡德<small>+ ${number(x.credits)} 现金</small>` : `<label>杜卡德<input type="number" min="0" data-exchange="ducats" data-exchange-slug="${esc(x.slug)}" value="${x.ducats ?? ''}"></label><label>现金<input type="number" min="0" data-exchange="credits" data-exchange-slug="${esc(x.slug)}" value="${x.credits ?? ''}"></label>`}<small>已有 ${srow(x.slug).quantity} 份${srow(x.slug).quantity >= 10 ? ' · 持仓较多' : ''}</small><label class="baro-plan-label">计划补货<input class="plan-quantity" type="number" min="0" max="100000" step="1" data-baro-plan="${esc(x.slug)}" aria-label="${esc(x.name)} 补货数量" value="${plan[x.slug] || 0}" ${!x.manual && !x.current ? 'disabled' : ''}></label></td></tr>`;
      })
      .join('') ||
    `<tr><td colspan="6">${baroQuery || baroKind !== 'all' ? '没有匹配的商品，请清除搜索或切换品类。' : baroMode === 'plan' ? '还没有购买计划。回到“本次全部商品”，填写想买的数量即可。' : baroMode === 'current' ? '暂无已确认的本次商品。可检查货单更新；自动来源失败时，在历史目录中核对游戏货单。' : '暂无历史目录商品。'}</td></tr>`
  }</tbody></table></div>
  <details class="baro-planner" ${plannerOpen ? 'open' : ''}><summary>计划合计：${planned.reduce((n, x) => n + plan[x.slug], 0)} 份 · ${number(tot.ducats)} 杜卡德 + ${number(tot.credits)} 现金${tot.incomplete ? '（有成本未知项）' : ''} · 展开填写预算与机会成本（可选）</summary><div class="baro-budget"><div class="form-grid">${input('budgetD', '可用杜卡德', budget.ducats ?? '', 'type="number" min="0" data-budget="ducats"')}${input('budgetC', '可用现金', budget.credits ?? '', 'type="number" min="0" data-budget="credits"')}${input('ducat-cost', '每百杜卡德机会成本 / p', settings.ducatCost ?? '', 'type="number" min="0" step="0.1" data-cost="ducatCost"')}${input('credit-cost', '每百万现金机会成本 / p', settings.creditCost ?? '', 'type="number" min="0" step="0.1" data-cost="creditCost"')}</div><p class="${(budget.ducats != null && tot.ducats > budget.ducats) || (budget.credits != null && tot.credits > budget.credits) ? 'negative' : ''}">${tot.incomplete ? `${tot.incomplete} 份成本未知，合计不完整。` : ''}${budget.ducats != null ? '剩余 ' + number(budget.ducats - tot.ducats) + ' 杜卡德。' : ''}${budget.credits != null ? '剩余 ' + number(budget.credits - tot.credits) + ' 现金。' : ''}填写两项机会成本后，表内显示每份资源差额，未计交易税与交易耗时。</p></div></details>
  <details class="baro-guide"><summary>指标说明与货单来源</summary><p>基准价取本次奸商活动前的正常成交均价；预计回款取基准价的 90%，排除活动周末的成交记录。恢复时间是活动结束后，首次连续 7 天成交均价达到基准 90% 的日期；没有足够的返场后数据就显示未知。</p><p>综合判断只看三项：基准 90% 回款效率（≥ 8p / 100D 较好）、恢复时间（≤ 14 天较好）和长期日均成交（≥ 5 条较好）。三项分别计分，合计 5 分以上显示“优先考虑”，3—4 分显示“可以考虑”，其余显示“暂缓”。</p><p><b>本次全部商品：</b>自动货单匹配的可交易武器与 MOD。计划数量仍可填写；实际购买后再录入库存。历史目录用于补充查看旧货单，不代表本次在售。</p><p>成交记录来自 WFM 标记成交，不等于全服总量或独立买家数。行情过期、活动供应变化、交易税和出售占用的交易次数都没有被当成确定利润。</p><button id="baro-reset" class="plain-button">清空计划与手动核对（保留库存）</button></details>`;
    el.querySelector('[data-open-ducats]').onclick = () => setTab('ducats');
    $('baro-min-volume').onchange = e => {
      baroMinWeek = Number(e.target.value);
      baro();
    };
    $('baro-kind').onchange = e => {
      baroKind = e.target.value;
      baro();
    };
    $('baro-sort').onchange = e => {
      baroSort = e.target.value;
      baro();
    };
    el.querySelectorAll('[data-baro-mode]').forEach(
      b =>
        (b.onclick = () => {
          baroMode = b.dataset.baroMode;
          baroQuery = '';
          baroKind = 'all';
          baroMinWeek = 0;
          baro();
        })
    );
    $('baro-search').oninput = e => {
      baroQuery = e.target.value.toLowerCase();
      baro();
      const i = $('baro-search');
      i.focus();
      i.setSelectionRange(i.value.length, i.value.length);
    };
    el.querySelectorAll('input[type="number"]').forEach(
      i =>
        (i.onchange = () => {
          if (!i.checkValidity() || (i.value !== '' && !Number.isFinite(Number(i.value)))) return;
          const v = i.value === '' ? null : Number(i.value),
            d = i.dataset;
          if (d.budget) {
            settings.baroBudget ||= {};
            settings.baroBudget[d.budget] = v;
          }
          if (d.cost) settings[d.cost] = v;
          if (d.baroPlan) {
            settings.baroPlan ||= {};
            settings.baroPlan[d.baroPlan] = v || 0;
          }
          if (d.exchange) {
            settings.baroCosts ||= {};
            settings.baroCosts[d.exchangeSlug] ||= {};
            settings.baroCosts[d.exchangeSlug][d.exchange] = v;
          }
          queueSave();
          baro();
        })
    );
    el.querySelectorAll('[data-baro-confirm]').forEach(
      i =>
        (i.onchange = () => {
          const a = new Set(settings.baroBasket || []);
          settings.baroConfirmedAt ||= {};
          if (i.checked) {
            a.add(i.dataset.baroConfirm);
            settings.baroConfirmedAt[i.dataset.baroConfirm] = new Date().toISOString();
          } else {
            a.delete(i.dataset.baroConfirm);
            delete settings.baroConfirmedAt[i.dataset.baroConfirm];
          }
          settings.baroBasket = [...a];
          queueSave();
          baro();
        })
    );
    $('baro-reset').onclick = () => {
      remember();
      settings.baroBasket = [];
      settings.baroConfirmedAt = {};
      settings.baroPlan = {};
      settings.baroCosts = {};
      queueSave();
      baro();
      notify('已清空手动核对与本次计划，库存保留；可以撤销。', true);
    };
  }
  function ducatRows() {
    const parts = state.catalog
      .filter(x => DeskCore.ducatPart(x, {}).eligible)
      .map(x => ({ ...x, slots: 1, isSet: false }));
    const sets = (state.ducat_sets || [])
      .map(r => {
        const check = DeskCore.ducatSet(r, state.catalog),
          item = state.catalog.find(x => x.slug === r.slug);
        return check && item ? { ...item, ...check, recipe: r, isSet: true } : null;
      })
      .filter(Boolean);
    return [...parts, ...sets].map(x => {
      const m = mrow(x.slug),
        summary = statsFor(m, 30);
      return {
        ...x,
        market: m,
        quote: {
          ...DeskCore.ducatPart(
            { ...x, kind: 'component', tags: ['prime'] },
            m,
            srow(x.slug),
            ducatMode
          ),
          price: summary.price,
          volume: m.stats?.end ? summary.volume : null
        },
        route: DeskCore.ducatLot(x, m, x.slots, Date.now(), ducatMinYield)
      };
    });
  }
  function ducatProtection(x) {
    const matches = (state.prime_sets || []).filter(r => r.parts.some(p => p.slug === x.slug)),
      complete = matches.filter(r => DeskCore.sets(r, settings.items) > 0),
      close = matches.filter(
        r => r.parts.filter(p => DeskCore.available(srow(p.slug)) < p.quantity).length === 1
      );
    return complete.length
      ? '可凑整套，先比套装价'
      : close.length
        ? '接近凑套，先核对缺件'
        : '请保留自用 / 收藏所需';
  }
  function ducatCalculator(all) {
    const candidates = all.filter(x => x.route).sort((a, b) => a.route.per100 - b.route.per100);
    const part = candidates.find(x => x.slug === ducatSelected) || candidates[0];
    if (!part)
      return '<div class="ducat-calculator"><p>尚无已核实的整批报价，等待更新后测算。</p></div>';
    ducatSelected = part.slug;
    const targets = baroRows()
      .filter(x => x.current)
      .sort(
        (a, b) =>
          DeskCore.baroValue(b, mrow(b.slug), settings).efficiency -
          DeskCore.baroValue(a, mrow(a.slug), settings).efficiency
      );
    if (!targets.length)
      return '<div class="ducat-calculator"><p>本次奸商货单待更新，暂不测算囤货回款。</p></div>';
    const target =
      targets.find(x => x.slug === ducatTarget) ||
      targets.find(x => DeskCore.liquidity(mrow(x.slug)).tier === 2) ||
      targets[0];
    ducatTarget = target.slug;
    const result = DeskCore.ducatCycle(
        part,
        mrow(part.slug),
        target,
        mrow(target.slug),
        ducatCopies,
        ducatManual,
        settings.creditCost,
        Date.now(),
        part.route
      ),
      liq = DeskCore.liquidity(mrow(target.slug));
    if (!result) return '<p>兑换成本不完整，暂不测算。</p>';
    const gap = v => (v == null ? '无法测算' : (v > 0 ? '+' : '') + number(v, 1) + 'p'),
      priceGap = result.historicalNet ?? result.historicalGap;
    return `<section class="ducat-calculator"><h3>收货与囤货测算</h3><p><b>${esc(part.name)}</b> · ${part.isSet ? '每套' : '每件'} ${number(part.ducats)} 杜卡德。按 ${part.route.units} ${part.isSet ? '套' : '件'}一批收货，余下杜卡德保留。</p><div class="form-grid"><label>兑换目标<select id="ducat-target" aria-label="杜卡德兑换目标">${targets.map(x => `<option value="${esc(x.slug)}" ${x.slug === target.slug ? 'selected' : ''}>${esc(x.name)} · 7 天 ${number(DeskCore.liquidity(mrow(x.slug)).week)} 条</option>`).join('')}</select></label>${input('copies', '目标购买份数', ducatCopies, 'id="ducat-copies" type="number" min="1" max="10000" step="1"')}${input('negotiated', `实际谈妥${part.isSet ? '每套' : '单件'}价 / p（可选）`, ducatManual ?? '', 'id="ducat-manual" type="number" min="0.1" max="1000000" step="0.1" placeholder="留空用所列卖家的整批报价"')}${input('credits', '每百万现金机会成本 / p（可选）', settings.creditCost ?? '', 'id="ducat-credit" type="number" min="0" max="1000000" step="0.1" placeholder="留空则现金另列"')}</div><div class="ducat-flow"><div><small>收 ${part.isSet ? 'Prime 套装' : 'Prime 部件'}</small><b>${number(result.parts)} ${part.isSet ? '套' : '件'} / ${result.trades} 笔</b><span>${result.cost == null ? '该卖家数量不足 / 报价过期' : number(result.cost, 1) + 'p 支出'}</span></div><span>→</span><div><small>分解后兑换</small><b>${number(result.needed)} 杜卡德</b><span>余 ${number(result.remainder)} 杜卡德</span></div><span>→</span><div><small>奸商商品</small><b>${number(ducatCopies)} 份</b><span>另需 ${number(result.credits)} 现金</span></div></div><div class="ducat-scenarios"><article><small>按当前买单卖出</small><b class="${result.immediateGap > 0 ? 'positive' : 'negative'}">${gap(result.creditP != null ? result.immediateNet : result.immediateGap)}</b><p>买单覆盖 ${result.sellCovered}/${ducatCopies} 份 · 回款 ${number(result.immediate, 1)}p${result.creditP == null ? ' · 未扣现金' : ' · 已扣现金折价'}。</p></article><article><small>按历史参考价逐步卖出</small><b class="${priceGap > 0 ? 'positive' : 'negative'}">${gap(priceGap)}</b><p>7 / 30 天较低均价对应回款 ${number(result.historical, 1)}p${result.creditP == null ? ' · 未扣现金' : ' · 已扣现金折价'}。未来价格与卖出时间未知。</p></article></div><p>${result.manual ? '按手填谈妥价测算，数量和交易笔数需与卖家确认。' : `仅使用卖家 ${esc(part.route.offer.name || part.route.offer.slug)} 的报价 ${number(part.route.offer.price)}p / ${part.isSet ? '套' : '件'}，库存 ${part.route.stock}，覆盖 ${result.buyCovered}/${result.parts}。不足时不外推，也不拼接其他卖家的零散低价。`}</p><p>收货 ${result.trades} 笔，不含售出奸商商品的交易次数。${part.isSet ? `每套 ${part.slots} 个可交易部件，按每次 6 个物品槽计算；请购买未制作部件。` : ''}目标近 7 天 ${number(liq.week)} 条记录。差额已扣本次全部收货支出；税与耗时另计，剩余杜卡德不计回款。</p></section>`;
  }
  function ducatStatsCell(x) {
    const m = mrow(x.slug);
    return `<b>${x.quote.price == null ? '—' : number(x.quote.price, 1) + 'p'}</b><small>${m.stats?.end ? (x.quote.price == null ? '近 30 天无成交记录' : `30 天 ${number(x.quote.volume)} 条 · ${number((x.quote.price / x.ducats) * 100, 2)}p / 百杜卡德`) : m.stats_error ? '统计获取失败' : '成交统计尚未采集'}</small>${!x.quote.valid && m.stats?.end ? '<small class="quality-warning">统计过期 / 获取失败</small>' : ''}`;
  }
  const sellerMarkLabels = {
    contacted: '已联系，等回复',
    bought: '已买',
    skip: '不在线，不再问'
  };
  function sellerMarkStatus(seller) {
    const status = settings.ducatSellerMarks?.[seller]?.status;
    return status === 'offline' ? 'skip' : sellerMarkLabels[status] ? status : '';
  }
  function sellerMarkText(seller) {
    const status = sellerMarkStatus(seller);
    return status ? `<small class="seller-mark-label">${sellerMarkLabels[status]}</small>` : '';
  }
  function saveSellerMark(seller, status) {
    if (status && !sellerMarkLabels[status]) return;
    settings.ducatSellerMarks ||= {};
    if (status) settings.ducatSellerMarks[seller] = { status, at: new Date().toISOString() };
    else delete settings.ducatSellerMarks[seller];
    queueSave();
    activate();
  }
  function bindSellerMarks() {
    document.querySelectorAll('[data-seller-row]').forEach(row => {
      const cycle = () => {
        const seller = row.dataset.sellerRow,
          statuses = ['', ...Object.keys(sellerMarkLabels)],
          current = sellerMarkStatus(seller),
          next = statuses[(statuses.indexOf(current) + 1) % statuses.length];
        saveSellerMark(seller, next);
      };
      row.onclick = e => {
        if (
          e.defaultPrevented ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          e.shiftKey ||
          e.target.closest(
            'a, button, input, select, textarea, label, summary, [role="button"], [contenteditable]'
          ) ||
          window.getSelection()?.toString().trim()
        )
          return;
        cycle();
      };
      row.onkeydown = e => {
        if (e.target !== row || !['Enter', ' '].includes(e.key)) return;
        e.preventDefault();
        if (e.repeat) return;
        cycle();
        const nextRow = [...document.querySelectorAll('[data-seller-row]')].find(
          x => x.dataset.sellerRow === row.dataset.sellerRow
        );
        (nextRow || $('ducat-hide-marked'))?.focus({ preventScroll: true });
      };
    });
  }
  function orderTime(at) {
    if (!at || !Number.isFinite(Date.parse(at))) return '未采集';
    return new Date(at).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }
  function orderTimes(entry) {
    return `<small>挂单更新 ${orderTime(entry.updatedAt)}</small><small>挂单创建 ${orderTime(entry.createdAt)}</small>`;
  }
  function ducatBundlePanel(bundles) {
    const trash = DeskCore.ducatTrashReference(),
      query = ducatBundleQuery.trim().toLowerCase(),
      catalog = new Map(state.catalog.map(x => [x.slug, x])),
      visible = bundles.filter(
        b =>
          !(ducatHideMarked && settings.ducatSellerMarks?.[b.seller]) &&
          (!query ||
            [
              b.sellerName,
              ...b.entries.flatMap(e => [
                e.name,
                catalog.get(e.slug)?.english,
                e.slug,
                catalog.get(e.slug)?.alias
              ])
            ].some(v => (v || '').toLowerCase().includes(query)))
      );
    return `<section class="ducat-bundle-panel" aria-label="同卖家组合"><div class="desk-actions ducat-list-tools"><input id="ducat-bundle-search" type="search" aria-label="搜索同卖家组合" placeholder="搜卖家或组合内商品" value="${esc(ducatBundleQuery)}"><label><input id="ducat-hide-marked" type="checkbox" ${ducatHideMarked ? 'checked' : ''}> 隐藏已标记卖家</label><span>按每百杜卡德成本从低到高</span></div><p class="ducat-benchmark">频道参考：15D / 1p · 45D / 3p · 100D / 10p（铜银 ${number(trash.lowest, 2)}p / 100D）</p><div class="ducat-contact-legend" aria-label="联系标记颜色">点击行内空白处循环：${[['', '未标记'], ...Object.entries(sellerMarkLabels)].map(([k, v]) => `<span data-contact-state="${k}">${v}</span>`).join('<i aria-hidden="true">→</i>')}<span aria-hidden="true">↻</span></div><div class="compare-scroll ducat-results"><table class="compare-table ducat-bundle-table"><thead><tr><th>卖家 / 本机标记</th><th>一次买什么</th><th>每百杜卡德成本</th><th>本笔合计</th></tr></thead><tbody>${
      visible
        .slice(0, ducatBundleLimit)
        .map(b => {
          const oldest = b.entries.map(e => e.at).sort((a, b) => Date.parse(a) - Date.parse(b))[0],
            delta = b.trashGap;
          return `<tr data-seller-row="${esc(b.seller)}" data-contact-state="${esc(sellerMarkStatus(b.seller))}" tabindex="0" aria-label="${esc(b.sellerName)}，${sellerMarkLabels[sellerMarkStatus(b.seller)] || '未标记'}。按回车或空格切换标记" title="点击行内空白处循环切换标记"><td>${b.sellerSlug ? `<a class="link" href="https://warframe.market/profile/${encodeURIComponent(b.sellerSlug)}" target="_blank" rel="noopener">${esc(b.sellerName)} ↗</a>` : esc(b.sellerName)}<small>${sellerStatus(b.sellerStatus)} · 本次采集 ${timeLabel(oldest)}</small>${wfmBundleButton(b)}${sellerMarkText(b.seller)}</td><td>${b.entries.map(e => `<div>${esc(e.name)} × ${e.units}${e.isSet ? ' 套' : ' 件'}<small>${number(e.price)}p / ${e.isSet ? '套' : '件'} · 小计 ${number(e.ducats)}D</small>${orderTimes(e)}</div>`).join('')}</td><td><strong>${number(b.per100, 2)}p</strong><small>${Math.abs(delta) < 0.005 ? '与铜 / 银基准相当' : `${delta > 0 ? '低于' : '高于'}基准 ${number(Math.abs(delta), 2)}p / 100D`}</small></td><td><b>${number(b.ducats)}D / ${number(b.cost, 1)}p</b><small>${b.slots}/6 物品槽 · 1 笔交易</small></td></tr>`;
        })
        .join('') || '<tr><td colspan="4">暂无匹配的有效报价。可降低门槛或稍后刷新。</td></tr>'
    }</tbody></table></div><p class="ducat-list-status">显示 ${Math.min(ducatBundleLimit, visible.length)} / ${visible.length} 位卖家。${visible.length > ducatBundleLimit ? '<button id="ducat-bundle-more" class="plain-button">再显示 10 位</button>' : ''}</p><p class="ducat-list-status">标记仅保存在当前浏览器，按卖家保留，不随行情刷新清除；复制私聊不代表已经发送。挂单更新来自 WFM，不代表卖家最近上线。</p><details class="ducat-method"><summary>组合规则与频道参考</summary><p>同一卖家的整套和散件可组合，最多占 6 槽，不必填满。每位卖家保留每百杜卡德成本最低的达标组合。频道金垃圾参考为 ${number(trash.highest, 2)}p / 100D。</p><p>每笔 150D → 每天 4,950D，14 天 69,300D。每笔 200D → 每天 6,600D，14 天 92,400D。这里只是假设每天都收到目标数量，未把同一份挂单库存重复算成每日供应；后续卖出也需要交易次数。</p><p>上面的频道价是你提供的议价参考，不是自动采集的实时行情。组合报价来自 WFM 卖单快照，30 天成交均价可切换到“单商品报价”查看。</p></details></section>`;
  }
  function ducats() {
    const all = ducatRows(),
      parts = all.filter(x => !x.isSet);
    const marketPool = all.filter(x => ducatKind === 'all' || (ducatKind === 'sets') === x.isSet);
    const bundles =
      ducatMode === 'market' && ducatView === 'bundles'
        ? DeskCore.ducatBundles(marketPool, 6, ducatMinYield, Date.now())
        : [];
    const pool =
      ducatMode === 'market'
        ? all.filter(
            x =>
              x.route &&
              (ducatKind === 'all' || (ducatKind === 'sets') === x.isSet) &&
              x.route.ducats >= ducatMinYield
          )
        : ducatMode === 'owned'
          ? parts.filter(x => x.quote.available > 0)
          : parts;
    const list = pool.filter(
      x =>
        !ducatQuery ||
        [x.name, x.english, x.alias, x.slug].some(v => (v || '').toLowerCase().includes(ducatQuery))
    );
    const ratio = x =>
      ducatMode === 'market' ? x.route.per100 : x.quote.valid ? x.quote.per100 : Infinity;
    list.sort(
      (a, b) =>
        (ducatMode === 'market' ? 0 : Number(b.quote.valid) - Number(a.quote.valid)) ||
        (ducatSort === 'yield'
          ? ducatMode === 'market'
            ? b.route.ducats - a.route.ducats
            : b.ducats - a.ducats
          : ducatSort === 'price'
            ? ducatMode === 'market'
              ? a.route.cost - b.route.cost
              : (a.quote.price ?? Infinity) - (b.quote.price ?? Infinity)
            : ducatSort === 'volume'
              ? (b.quote.volume ?? -1) - (a.quote.volume ?? -1)
              : 0) ||
        ratio(a) - ratio(b) ||
        (b.route?.ducats ?? 0) - (a.route?.ducats ?? 0) ||
        a.name.localeCompare(b.name)
    );
    const collected = parts.filter(x => x.quote.valid).length;
    const header = `<div class="custom-intro ducat-intro"><div class="desk-title"><div class="ducat-tabs" aria-label="杜卡德用途">${[
      ['market', '买部件收杜卡德'],
      ['reference', '分解参考']
    ]
      .map(
        ([k, v]) =>
          `<button data-ducat-mode="${k}" aria-pressed="${k === 'market' ? ducatMode === k : ducatMode !== 'market'}">${v}</button>`
      )
      .join('')}</div><button id="ducat-to-baro" class="plain-button">奸商货单 ↗</button></div>${
      ducatMode === 'market'
        ? `<div class="desk-actions ducat-bulk-filters"><label>收货方式 <select id="ducat-kind" aria-label="杜卡德收货方式">${[
            ['all', '散件 + 整套'],
            ['parts', '只看散件'],
            ['sets', '整套购买']
          ]
            .map(
              ([k, v]) => `<option value="${k}" ${ducatKind === k ? 'selected' : ''}>${v}</option>`
            )
            .join(
              ''
            )}</select></label><label>每笔至少 <select id="ducat-min-yield" aria-label="每笔总杜卡德筛选">${[
            [0, '不限'],
            [50, '50D'],
            [100, '100D'],
            [150, '150D'],
            [200, '200D'],
            [270, '270D'],
            [390, '390D'],
            [600, '600D']
          ]
            .map(
              ([k, v]) =>
                `<option value="${k}" ${ducatMinYield === k ? 'selected' : ''}>${v}</option>`
            )
            .join('')}</select></label><span>每笔最多 6 个部件，门槛按总杜卡德计算。</span></div>`
        : '<p>按 30 天成交均价比较分解成本，优先看每百杜卡德价值低的部件。</p>'
    }</div>`;
    const views =
      ducatMode === 'market'
        ? `<div class="ducat-tabs ducat-view-tabs" aria-label="收货报价视图">${[
            ['bundles', '同卖家组合'],
            ['single', '单商品报价']
          ]
            .map(
              ([k, v]) =>
                `<button data-ducat-view="${k}" aria-pressed="${ducatView === k}">${v}</button>`
            )
            .join('')}</div>`
        : '';
    if (ducatMode === 'market' && ducatView === 'bundles')
      return `<div class="ducat-workspace">${header}${views}${ducatBundlePanel(bundles)}</div>`;
    const tools = `<div class="desk-actions ducat-list-tools"><input id="ducat-search" type="search" aria-label="搜索${ducatMode === 'market' ? '单商品报价' : '分解参考部件'}" placeholder="搜部件 / 套装，中英文均可" value="${esc(ducatQuery)}"><label>排序 <select id="ducat-sort" aria-label="${ducatMode === 'market' ? '单商品报价排序' : '分解参考排序'}">${[
      ['ratio', ducatMode === 'market' ? '每百杜卡德成本 ↑' : '30 天均价 / 百杜卡德 ↑'],
      ['yield', ducatMode === 'market' ? '每笔杜卡德 ↓' : '单件杜卡德 ↓'],
      ['price', ducatMode === 'market' ? '每笔白金支出 ↑' : '30 天均价 ↑'],
      ['volume', '30 天成交量 ↓']
    ]
      .map(([k, v]) => `<option value="${k}" ${ducatSort === k ? 'selected' : ''}>${v}</option>`)
      .join(
        ''
      )}</select></label>${ducatMode !== 'market' ? `<label class="ducat-owned-filter"><input id="ducat-owned-only" type="checkbox" ${ducatMode === 'owned' ? 'checked' : ''}> 只看账本持有（${parts.filter(x => x.quote.available > 0).length} 种）</label>` : ''}</div>`;
    return `<div class="ducat-workspace">${header}${views}<section class="ducat-single-panel" aria-label="${ducatMode === 'market' ? '单商品报价' : '分解参考'}">${tools}${ducatMode === 'market' ? `<p class="ducat-list-status">只显示行情快照中处于“在线”或“游戏中”的卖家；状态会变化，联系前请到 WFM 再确认。</p>` : `<p class="ducat-list-status">${ducatMode === 'owned' ? '只显示手动记入账本、扣除自用保留后仍可用的部件。' : `${parts.length} 种散件，${collected} 种有有效成交统计。`} 分解前请核对凑套和自用需求。</p>`}<div class="compare-scroll ducat-table-wrap"><table class="compare-table ducat-table"><thead><tr><th>商品</th><th>${ducatMode === 'market' ? '整批成本 / 百杜卡德' : '成交参考 / 百杜卡德'}</th><th>${ducatMode === 'market' ? '一次交易能收多少' : '单件杜卡德 / 可用数量'}</th><th>30 天成交均价</th><th>${ducatMode === 'market' ? '卖家 / 查询时间' : '持有与用途'}</th><th>操作</th></tr></thead><tbody>${
      list
        .slice(0, ducatLimit)
        .map(
          (x, i) =>
            `<tr><td><div class="baro-product"><span class="baro-rank">${i + 1}</span>${itemImage(x)}<div><button data-desk-detail="${esc(x.slug)}">${esc(x.name)}</button><small>${x.isSet ? '整套 · ' + x.slots + ' 件部件' : esc(x.english)}</small></div></div></td><td><strong class="baro-efficiency">${number(ratio(x), 2)}p</strong><small>${ducatMode === 'market' ? '同一卖家整批报价' : '30 天成交参考，非收货报价'}</small></td><td>${ducatMode === 'market' ? `<b class="ducat-trade-yield">${x.isSet ? `每套 ${number(x.ducats)}D · 本笔 ${number(x.route.ducats)}D` : `每件 ${number(x.ducats)}D · 本笔 ${number(x.route.ducats)}D`}</b><small>${x.route.units} ${x.isSet ? '套' : '件'} · ${number(x.route.cost)}p / 笔</small><small>${x.route.slots}/6 物品槽${x.isSet ? '，未制作部件' : ''}</small>` : `每件 ${x.ducats} 杜卡德${ducatMode === 'owned' ? `<small>持有 ${srow(x.slug).quantity} / 保留 ${srow(x.slug).reserve || 0}</small><small>可用 ${x.quote.available} 件 → ${number(x.quote.available * x.ducats)} 杜卡德</small>` : ''}`}</td><td>${ducatStatsCell(x)}</td><td>${ducatMode === 'market' ? `<a class="link" href="https://warframe.market/profile/${encodeURIComponent(x.route.offer.slug)}" target="_blank" rel="noopener">${esc(x.route.offer.name || x.route.offer.slug)}</a><small>${sellerStatus(x.route.offer.status)} · ${number(x.route.offer.price)}p / ${x.isSet ? '套' : '件'} · 挂有 ${x.route.stock} ${x.isSet ? '套' : '件'}</small><small>本次采集 ${timeLabel(mrow(x.slug).orders_at)}</small>${orderTimes(x.route.offer)}` : `${ducatProtection(x)}<small>${timeLabel(mrow(x.slug).stats_at)}</small>`}</td><td>${ducatMode === 'market' ? `${wfmTradeButton(x, x.route.offer, x.route.units)}${linked(x)}<button data-ducat-select="${esc(x.slug)}" class="plain-button">${ducatSelected === x.slug ? '已用于测算' : '测算'}</button>` : linked(x)}</td></tr>`
        )
        .join('') ||
      `<tr><td colspan="6">${ducatMode === 'owned' ? '账本中暂无匹配的可用部件。可取消“只看账本持有”，或到“我的库存”手动添加。' : ducatMode === 'market' ? '暂无匹配的有效报价，可降低每笔门槛或清空搜索。' : '暂无匹配部件，请换个名称搜索。'}</td></tr>`
    }</tbody></table></div><div class="ducat-list-footer">显示 ${Math.min(ducatLimit, list.length)} / ${list.length} 种${list.length > ducatLimit ? '<button id="ducat-more" class="plain-button">再显示 40 种</button>' : ''}</div></section>${ducatMode === 'market' ? `<details class="ducat-route-panel" ${ducatCalcOpen ? 'open' : ''}><summary>收货与囤货测算（可选）</summary>${ducatCalcOpen ? ducatCalculator(all) : ''}</details>` : ''}<details class="ducat-method"><summary>报价、套装与交易次数说明</summary><p>同一卖家供应 1—6 件散件，或一笔可放下的完整套装，达到所选杜卡德门槛即可；先比每百杜卡德成本，同价再多收，不为装满 6 槽选更贵的卖家。套装按已核对配方计算部件杜卡德总和；每件部件占一个交易槽，同一套的重复部件也计数。报价不保证卖家实际履约，购买前请到 WFM 确认。</p><p>例如一套由 100D、45D、15D 组成，就是 160D / 套；三部件套装的理论上限是 300D / 套；同一笔买两套才是 320D / 笔。单件和套装都不能突破“每个部件最多 100D”的规则。</p><p>30 天均价来自 WFM 标记成交的日成交量加权统计，不是在线最低价，也不是保证能买到的价格。记录量不等于全服总量。收货和后续卖出都会占交易次数。</p><p>当前核对 ${state.ducat_sets?.length || 0} 种套装；配方未核实、超过 6 个槽位的整套不参与。同卖家组合按卖家 ID 合并不同商品，最多占 6 个槽，所列每条报价须有效。每位卖家只保留一个最划算的达标组合，各卖家之间不拼单；单商品测算不把组合当作可重复购买的库存。</p></details></div>`;
  }
  function bindDucats() {
    const rerender = () => activate();
    bindSellerMarks();
    if ($('ducat-hide-marked'))
      $('ducat-hide-marked').onchange = e => {
        ducatHideMarked = e.target.checked;
        rerender();
      };
    const panel = document.querySelector('.ducat-route-panel');
    if (panel)
      panel.ontoggle = () => {
        if (!panel.isConnected || ducatCalcOpen === panel.open) return;
        ducatCalcOpen = panel.open;
        if (ducatCalcOpen) rerender();
      };
    $('ducat-to-baro').onclick = () => setTab('mods');
    document.querySelectorAll('[data-ducat-mode]').forEach(
      b =>
        (b.onclick = () => {
          ducatMode = b.dataset.ducatMode;
          ducatLimit = 40;
          ducatQuery = '';
          ducatSort = 'ratio';
          rerender();
        })
    );
    document.querySelectorAll('[data-ducat-view]').forEach(b => {
      b.onclick = () => {
        ducatView = b.dataset.ducatView;
        rerender();
      };
    });
    for (const id of ['ducat-search', 'ducat-bundle-search']) {
      if (!$(id)) continue;
      let composing = false;
      const applySearch = e => {
        // Re-rendering during an IME composition replaces the input node and
        // turns Chinese text into an unfinished Latin sequence. Wait for the
        // committed composition before filtering.
        if (composing || e.isComposing) return;
        const value = e.target.value,
          start = e.target.selectionStart,
          end = e.target.selectionEnd;
        if (id === 'ducat-bundle-search') {
          ducatBundleQuery = value;
          ducatBundleLimit = 10;
        } else {
          ducatQuery = value.toLowerCase();
          ducatLimit = 40;
        }
        rerender();
        $(id).focus({ preventScroll: true });
        $(id).setSelectionRange(start, end);
      };
      $(id).addEventListener('compositionstart', () => {
        composing = true;
      });
      $(id).addEventListener('compositionend', e => {
        composing = false;
        applySearch(e);
      });
      $(id).oninput = applySearch;
    }
    if ($('ducat-sort'))
      $('ducat-sort').onchange = e => {
        ducatSort = e.target.value;
        rerender();
      };
    if ($('ducat-owned-only'))
      $('ducat-owned-only').onchange = e => {
        ducatMode = e.target.checked ? 'owned' : 'reference';
        ducatLimit = 40;
        rerender();
      };
    if ($('ducat-kind'))
      $('ducat-kind').onchange = e => {
        ducatKind = e.target.value;
        ducatLimit = 40;
        ducatBundleLimit = 10;
        rerender();
      };
    if ($('ducat-min-yield'))
      $('ducat-min-yield').onchange = e => {
        ducatMinYield = Number(e.target.value);
        ducatLimit = 40;
        ducatBundleLimit = 10;
        rerender();
      };
    if ($('ducat-bundle-more'))
      $('ducat-bundle-more').onclick = () => {
        ducatBundleLimit += 10;
        rerender();
      };
    if ($('ducat-more'))
      $('ducat-more').onclick = () => {
        ducatLimit += 40;
        rerender();
      };
    document.querySelectorAll('[data-ducat-select]').forEach(
      b =>
        (b.onclick = () => {
          ducatSelected = b.dataset.ducatSelect;
          ducatManual = null;
          ducatCalcOpen = true;
          rerender();
          document
            .querySelector('.ducat-calculator')
            ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        })
    );
    if ($('ducat-target'))
      $('ducat-target').onchange = e => {
        ducatTarget = e.target.value;
        rerender();
      };
    for (const id of ['ducat-copies', 'ducat-manual', 'ducat-credit'])
      if ($(id))
        $(id).onchange = e => {
          if (!e.target.checkValidity() || (id === 'ducat-copies' && e.target.value === '')) return;
          const n = e.target.value === '' ? null : Number(e.target.value);
          if (id === 'ducat-copies') ducatCopies = n;
          if (id === 'ducat-manual') ducatManual = n;
          if (id === 'ducat-credit') {
            settings.creditCost = n;
            queueSave();
          }
          rerender();
        };
  }
  function ledger() {
    const all = entries(),
      r = DeskCore.ledger(all);
    return `<div class="custom-intro"><h2>我的交易记录</h2><p>已知成本的已实现白金差额（未扣交易税与耗时） <b>${number(r.realized, 1)}p</b> · ${r.unknown} 份卖出成本不明，未计利润 · 剩余已记录成本 ${number(r.remaining, 1)}p</p><p>从商品详情点“记录买入 / 卖出”。数量校正只调整账，不作为收入；成本按记录顺序先入先出。期初日期不是购买日期。</p></div><div class="table-scroll"><table><thead><tr><th>日期 / 商品</th><th>类型</th><th>数量 / 单价</th><th>已实现差额</th><th>备注</th></tr></thead><tbody>${
      [...all]
        .reverse()
        .map(e => {
          const x = state.catalog.find(x => x.slug === e.slug),
            sold = r.sold.get(e.id);
          return `<tr><td>${esc(e.date)}<br><button data-desk-detail="${esc(e.slug)}">${esc(x?.name || e.slug)}</button></td><td>${{ buy: '买入 / 兑换', sell: '卖出', adjust: '数量校正', opening: '期初库存' }[e.type]}</td><td>${e.quantity} / ${e.price == null ? '成本未知' : number(e.price, 1) + 'p'}</td><td>${sold ? (sold.known ? number(sold.revenue - sold.cost, 1) + 'p' : '成本未知，不计利润') : '—'}</td><td>${esc(e.note || '')}</td></tr>`;
        })
        .join('') ||
      '<tr><td colspan="5">尚无交易记录。原库存仍保留，首次记录时将建立期初库存。</td></tr>'
    }</tbody></table></div>`;
  }
  function sets() {
    const recipes = (state.prime_sets || []).filter(
      r =>
        !customQuery ||
        [
          r.name,
          r.slug,
          ...r.parts.map(p => state.catalog.find(x => x.slug === p.slug)?.name || '')
        ].some(x => x.toLowerCase().includes(customQuery))
    );
    return `<div class="custom-intro"><h2>Prime 战甲 · 散件凑套</h2><p>自用保留数量不参与凑套；只比较游戏允许交易的蓝图。散卖与整套均是报价情景，不保证成交。</p><input id="sets-search" type="search" aria-label="搜索凑套战甲" placeholder="搜索战甲 / 散件" value="${esc(customQuery)}"></div><div class="set-grid">${recipes
      .map(r => {
        const count = DeskCore.sets(r, settings.items),
          partial = r.parts.reduce(
            (n, p) => n + Math.min(DeskCore.available(srow(p.slug)), p.quantity),
            0
          ),
          all = r.parts.every(p => ask(mrow(p.slug)) != null),
          sum = all ? r.parts.reduce((n, p) => n + ask(mrow(p.slug)) * p.quantity, 0) : null,
          complete = r.parts.filter(p => DeskCore.available(srow(p.slug)) < p.quantity);
        return `<article class="set-card"><h3><button data-desk-detail="${esc(r.slug)}">${esc(r.name)}</button><span>${count} 套可凑</span></h3><p>整套卖单 ${number(ask(mrow(r.slug)))}p / 散卖合计 ${number(sum)}p · 报价需核实</p><p>整套近 30 天 ${number(statsFor(mrow(r.slug), 30).volume)} 条记录 · 整套交易 1 次 / 分件最多 ${r.parts.length} 次（取决于买家）</p>${r.parts
          .map(p => {
            const x = state.catalog.find(x => x.slug === p.slug);
            return `<button class="set-part" data-desk-detail="${esc(p.slug)}"><span>${esc(x?.name || p.slug)}</span><b>${srow(p.slug).quantity} 持有 / ${srow(p.slug).reserve || 0} 保留</b></button>`;
          })
          .join(
            ''
          )}<p>${partial ? (complete.length ? '凑下一套缺 ' + complete.map(p => esc(state.catalog.find(x => x.slug === p.slug)?.name)).join('、') : '下一套部件齐全') : '暂无散件；可用“添加库存”录入。'}</p></article>`;
      })
      .join('')}</div>`;
  }
  function routes() {
    const rows = settings.farmRuns || [];
    return `<div class="custom-intro"><h2>用自己的用时，比较赚钱效率</h2><p>分别记录报价折算和实际卖出。未卖掉的资源不计实际收入；下表不提供未经验证的全服 p/h 排名。</p><form id="farm-form"><div class="form-grid">${input('name', '路线名称', '', 'required maxlength="80" placeholder="仲裁 / 竞技场 / 开核桃"')}${input('minutes', '实际游玩分钟', '', 'type="number" min="1" max="10000" required')}${input('quoted', '产物按报价折算 / p', '', 'type="number" min="0" step="0.1" required')}${input('sold', '已实际卖出收入 / p', '', 'type="number" min="0" step="0.1" required')}${input('cost', '白金投入 / p', 0, 'type="number" min="0" step="0.1" required')}${input('note', '配置 / 增益 / 交易用时备注', '', 'maxlength="300"')}</div><button class="primary">记录一次路线</button></form></div><div class="table-scroll"><table><thead><tr><th>路线 / 日期</th><th>实际游玩</th><th>报价折算 p/h</th><th>实际收入 p/h</th><th>配置备注</th></tr></thead><tbody>${
      [...rows]
        .reverse()
        .map(
          x =>
            `<tr><td>${esc(x.name)}<br>${esc(x.date)}</td><td>${x.minutes} 分钟</td><td>${number(((x.quoted - x.cost) / x.minutes) * 60, 1)}</td><td>${number(((x.sold - x.cost) / x.minutes) * 60, 1)}</td><td>${esc(x.note)}</td></tr>`
        )
        .join('') ||
      '<tr><td colspan="5">记录你的配装、增益和实测用时后再比较。实际收入效率仅按游玩时间作分母，交易等待需看备注。</td></tr>'
    }</tbody></table></div>`;
  }
  function activate() {
    if (!initialized) return;
    const custom = ['ledger', 'sets', 'routes', 'ducats'].includes(tab);
    $('desk-custom').hidden = !custom;
    $('inventory-summary').hidden = tab !== 'inventory';
    $('reading-notes').hidden = tab !== 'inventory';
    $('desk-overview').hidden = tab !== 'inventory';
    $('refresh').hidden =
      (custom && !(tab === 'ducats' && window.Hosted)) ||
      ['relics', 'home'].includes(tab) ||
      (tab === 'relic-prices' && !window.Hosted);
    render();
    if (!custom) return;
    if (tab === 'ducats' && window.Hosted && !window.__voidLedgerDucatLoaded) {
      $('desk-custom').innerHTML =
        '<section class="loading-card"><h3>正在读取杜卡德市场明细</h3><p>首页已先加载基础行情；卖家与整批报价只在打开本页时读取。</p><div class="loading-line"><span></span></div></section>';
      window.ensureDucatMarket?.().then(() => {
        window.__voidLedgerDucatLoaded = true;
        if (tab === 'ducats') activate();
      }).catch(error => {
        $('desk-custom').innerHTML = `<section class="loading-card"><h3>杜卡德市场明细读取失败</h3><p>${esc(error.message)}</p><button class="plain-button" data-retry-ducat>重新读取</button></section>`;
        $('desk-custom').querySelector('[data-retry-ducat]').onclick = () => {
          window.ensureDucatMarket?.().then(() => {
            window.__voidLedgerDucatLoaded = true;
            activate();
          });
        };
      });
      return;
    }
    $('desk-custom').innerHTML =
      tab === 'ledger'
        ? ledger()
        : tab === 'sets'
          ? sets()
          : tab === 'ducats'
            ? ducats()
            : routes();
    if (tab === 'ducats') bindDucats();
    if (tab === 'sets')
      $('sets-search').oninput = e => {
        customQuery = e.target.value.toLowerCase();
        activate();
        const i = $('sets-search');
        i.focus();
        i.setSelectionRange(i.value.length, i.value.length);
      };
    if (tab === 'routes')
      $('farm-form').onsubmit = e => {
        e.preventDefault();
        remember();
        const f = new FormData(e.target);
        settings.farmRuns ||= [];
        settings.farmRuns.push({
          name: String(f.get('name')),
          date: today(),
          minutes: Number(f.get('minutes')),
          quoted: Number(f.get('quoted')),
          sold: Number(f.get('sold')),
          cost: Number(f.get('cost')),
          note: String(f.get('note'))
        });
        queueSave();
        activate();
      };
  }
  return {
    init,
    render,
    activate,
    adjust,
    baro,
    quoteDetail,
    history,
    trade,
    checkpoint: remember
  };
})();
if (typeof settings !== 'undefined' && settings) window.Desk.init();
