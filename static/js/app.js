'use strict';
let state,
  settings,
  tab = 'home',
  selected = null,
  query = '',
  filter = 'all',
  sort = 'default';
let pollTimer,
  wasRunning = false,
  lastJobStart = null;
const STORAGE_KEY = window.Hosted
  ? 'void-ledger:hosted:v1'
  : window.Portable
    ? 'void-ledger:portable:' + window.Portable.id
    : 'void-ledger:v2';
let chartWindow = 90;
const statsDays = () => Number(settings?.statsWindow) || 30;
const statsFor = (m, n = statsDays()) => MarketStats.window(m, n);
const baseTabs = ['inventory', 'watch', 'frames', 'mods'];
const $ = id => document.getElementById(id);
const esc = x =>
  String(x ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const number = (x, d = 0) =>
  x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('zh-CN', { maximumFractionDigits: d });
const price = x => (x == null ? '—' : `${number(x, 1)}<span class="unit">p</span>`);
const timeLabel = x =>
  x
    ? new Date(x).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    : '尚未更新';
const snapshotLabel = () =>
  window.Hosted
    ? `行情抓取完成 ${timeLabel(state.refresh_status?.finished)} · 网页发布 ${timeLabel(state.server_time)}`
    : '各商品报价时间见详情';
const kindLabel = { weapon: '可交易武器', mod: 'MOD', frame: 'P 甲套装', component: 'Prime 散件' };
const srow = slug =>
  settings.items[slug] || { quantity: 0, target: null, cost: null, watch: false, note: '' };
const mrow = slug => state.market[slug] || {};
const held = x => srow(x.slug).quantity > 0;
const watched = x => held(x) || srow(x.slug).watch;
const stale = at => !at || Date.now() - Date.parse(at) > 6 * 3600 * 1000;
const ask = m => m.orders?.sell?.[0]?.price ?? null;
const bid = m => m.orders?.buy?.[0]?.price ?? null;
const mean = m => statsFor(m).price;
const targetQuote = m => DeskCore.target(m, settings?.targetBasis || 'sell');
const targetHit = (s, m) =>
  s.target > 0 && targetQuote(m).valid && targetQuote(m).value >= s.target;
function notify(message, success = false) {
  $('notice').textContent = message;
  $('notice').className = 'notice' + (success ? ' success' : '');
  $('notice').hidden = false;
}
function wfmTradeButton(item, offer, quantity = 1, label = '复制私聊') {
  return wfmPurchaseButton([{ item, offer, quantity }], label);
}
function wfmPurchaseButton(purchases, label) {
  const rows = purchases.map(p => ({
      ...p,
      at: mrow(p.item.slug).orders_at,
      error: mrow(p.item.slug).orders_error
    })),
    message = DeskCore.purchaseWhisper(rows),
    selection = rows.map(p => ({
      slug: p.item.slug,
      seller: p.offer?.seller,
      quantity: p.quantity,
      price: p.offer?.price,
      at: p.at
    }));
  return message
    ? `<button type="button" class="plain-button trade-copy" data-copy-trade="${esc(JSON.stringify(selection))}" title="${esc(message)}" aria-label="${esc(label)} · ${esc(rows[0].offer.name)}">${esc(label)}</button>`
    : '';
}
function wfmBundleButton(bundle, label = '复制组合私聊') {
  const purchases = bundle.entries.map(e => {
    const item = state.catalog.find(x => x.slug === e.slug),
      offer = mrow(e.slug).orders?.sell_offers?.find(
        o => o.seller === bundle.seller && o.price === e.price
      );
    return { item, offer, quantity: e.units };
  });
  return purchases.every(p => p.item && p.offer) ? wfmPurchaseButton(purchases, label) : '';
}
function wfmPurchasePanel(item, market) {
  const offers = market.orders?.sell_offers || [];
  if (!DeskCore.fresh(market.orders_at, market.orders_error) || !offers.length) return '';
  return `<section class="purchase-offers"><h3>向卖家购买</h3><p class="drawer-muted">复制后粘贴到游戏聊天。按所列卖家的单件 / 单套报价，成交前确认仍有货。</p>${offers
    .slice(0, 5)
    .map(
      offer =>
        `<div class="purchase-offer"><div><b>${esc(offer.name || offer.slug)}</b><small>${number(offer.price)}p / ${item.slug.endsWith('_set') ? '套' : '份'} · 挂有 ${number(offer.quantity)}</small></div>${wfmTradeButton(item, offer)}</div>`
    )
    .join('')}</section>`;
}
function resolveTradeMessage(selection) {
  const rows = selection.map(p => {
    const item = state.catalog.find(x => x.slug === p.slug),
      market = mrow(p.slug),
      offer = market.orders?.sell_offers?.find(o => o.seller === p.seller && o.price === p.price);
    return {
      item,
      offer,
      quantity: p.quantity,
      at: market.orders_at === p.at ? market.orders_at : null,
      error: market.orders_error
    };
  });
  return DeskCore.purchaseWhisper(rows);
}
async function copyTradeText(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    let dialog = $('trade-copy-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'trade-copy-dialog';
      dialog.innerHTML =
        '<div class="dialog-heading"><h2>购买私聊</h2><button type="button" class="close-button" aria-label="关闭购买私聊">×</button></div><p>浏览器未允许复制，请选中后按 Ctrl+C。</p><textarea readonly aria-label="购买私聊内容"></textarea>';
      dialog.querySelector('button').onclick = () => dialog.close();
      document.body.append(dialog);
    }
    dialog.querySelector('textarea').value = text;
    dialog.showModal();
    dialog.querySelector('textarea').select();
    return false;
  }
}
async function request(path, body) {
  if (window.Hosted) return window.Hosted.request(path, body);
  if (window.Portable) return window.Portable.request(path, body);
  const r = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
  );
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error('本机服务响应异常');
  }
  if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
  return data;
}
function readBrowserSettings(seed) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw);
      if (value.version !== 2 || !value.items || typeof value.items !== 'object')
        throw new Error('库存格式不正确');
      return value;
    }
    const value = { ...seed, version: 2, relics: [null, null, null, null], relicSort: 'price' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return value;
  } catch (error) {
    notify('当前浏览器暂时无法记住修改；刷新页面可能丢失。' + error.message);
    return { ...seed, version: 2, relics: [null, null, null, null], relicSort: 'price' };
  }
}
function queueSave() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    $('save-status').textContent = '✓ 修改已记住';
    return true;
  } catch (error) {
    $('save-status').textContent = '暂时无法记住修改';
    notify('浏览器存储不可用，当前修改仅在本页保留。');
    return false;
  }
}
function itemImage(x, large = false) {
  const src =
    x.slug?.endsWith('_blueprint') && x.fallback_image
      ? x.fallback_image
      : large
        ? x.icon || x.image
        : x.image;
  return `<span class="item-art ${esc(x.kind || '')} ${x.slug?.endsWith('_blueprint') ? 'blueprint' : ''} ${large ? 'large' : ''}">${src ? `<img src="${esc(src)}" data-fallback="${esc(x.fallback_image || '')}" alt="${esc(x.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span>◇</span>'}</span>`;
}
function updateSetting(slug, key, value) {
  if (key === 'quantity' && window.Desk) {
    window.Desk.adjust(slug, value);
    return;
  }
  settings.items[slug] = { ...srow(slug), [key]: value };
  queueSave();
  renderMetrics();
}
function visibleItems() {
  let rows = state.catalog.filter(x =>
    tab === 'inventory'
      ? held(x)
      : tab === 'watch'
        ? srow(x.slug).watch
        : tab === 'frames'
          ? x.kind === 'frame'
          : !!x.baro
  );
  if (tab === 'frames') rows = rows.filter(x => window.Frames.matches(x, filter));
  else if (filter !== 'all')
    rows = rows.filter(x => (filter === 'watch' ? watched(x) : x.kind === filter));
  if (query)
    rows = rows.filter(x =>
      [x.name, x.english, x.alias, x.slug].some(v => (v || '').toLowerCase().includes(query))
    );
  const key = x => {
    const m = mrow(x.slug),
      s = srow(x.slug),
      p = mean(m);
    return (
      {
        price: p,
        value: p == null ? null : p * s.quantity,
        volume: statsFor(m).volume,
        change: statsFor(m).change,
        ducat: x.ducats ? (statsFor(m, 30).price / x.ducats) * 100 : null,
        target: s.target && targetQuote(m).valid ? targetQuote(m).value / s.target : null
      }[sort] ?? -Infinity
    );
  };
  if (tab === 'frames') rows.sort((a, b) => window.Frames.compare(a, b, sort));
  else if (sort !== 'default') rows.sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
  else if (tab !== 'inventory')
    rows.sort((a, b) => (mean(mrow(b.slug)) ?? -1) - (mean(mrow(a.slug)) ?? -1));
  else rows.sort((a, b) => Number(held(b)) - Number(held(a)));
  return rows;
}
function spark(history) {
  const points = (history || []).map(x => x.price);
  if (points.length < 2) return '<span class="spark"></span>';
  const lo = Math.min(...points),
    hi = Math.max(...points),
    span = hi - lo || 1;
  const coords = points
    .map(
      (v, i) =>
        `${((i / (points.length - 1)) * 62 + 1).toFixed(1)},${(21 - ((v - lo) / span) * 18).toFixed(1)}`
    )
    .join(' ');
  const color = points.at(-1) >= points[0] ? '#7eac95' : '#b8aba1';
  return `<svg class="spark" aria-label="90 天趋势简图" viewBox="0 0 64 24" aria-hidden="true"><polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}
function renderMetrics() {
  const items = state.catalog.filter(held),
    count = items.reduce((sum, x) => sum + srow(x.slug).quantity, 0);
  const priced = items.filter(x => mean(mrow(x.slug)) != null),
    value = priced.reduce((sum, x) => sum + srow(x.slug).quantity * mean(mrow(x.slug)), 0);
  const targets = items.filter(x => srow(x.slug).target > 0),
    hit = targets.filter(x => targetHit(srow(x.slug), mrow(x.slug)));
  $('metric-items').innerHTML = `${number(count)}<small>件 / 张</small>`;
  $('metric-items-note').textContent =
    `${items.length} 种商品 · ` +
    [
      ['weapon', '武器'],
      ['mod', 'MOD'],
      ['frame', 'P 甲']
    ]
      .map(([kind, label]) => [items.filter(x => x.kind === kind).length, label])
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} 种${label}`)
      .join(' / ');
  $('metric-value').innerHTML = priced.length ? `${number(value)}<small>p</small>` : '—';
  $('metric-value-note').textContent =
    `按 ${statsDays()} 天 · ${priced.length}/${items.length} 种有成交均价 · 估值不等于可立即变现`;
  $('metric-target').innerHTML = `${hit.length}<small>/ ${targets.length} 种已设目标</small>`;
  $('metric-target-note').textContent = targets.length
    ? targetQuote({}).label + '达到观察线；需回 WFM 核实'
    : '目标价留空，等你自己设定';
  $('inventory-count').textContent = state.catalog.filter(held).length;
  window.Desk?.render();
}
function renderTable() {
  if ($('target-basis-note'))
    $('target-basis-note').textContent =
      `按${targetQuote({}).label}判断目标；成交均价不随此项切换。`;
  $('mean-heading').textContent = statsDays() + ' 天成交均价';
  $('volume-heading').textContent = statsDays() + ' 天记录量';
  $('stats-note').textContent =
    tab === 'frames'
      ? '7 / 30 天均价按完整 UTC 日成交量加权；90 天高位比较滚动周均价，记录量不等于全服交易量。'
      : `WFM 用户标记成交的近 ${statsDays()} 个完整 UTC 日成交量加权均价；记录量不等于全服交易量。`;
  renderModPanel();
  if (tab === 'mods') return;
  const rows = visibleItems();
  $('table-count').textContent = `${rows.length} 种`;
  if (tab === 'frames') window.Frames.table(rows);
  else
    $('rows').innerHTML = rows.length
      ? rows
          .map(x => {
            const s = srow(x.slug),
              m = mrow(x.slug),
              p = mean(m),
              summary = statsFor(m),
              change = summary.change;
            const updateTitle = `成交数据查询：${timeLabel(m.stats_at)}\n挂单查询：${timeLabel(m.orders_at)}${m.stats_error ? '\n成交数据刷新失败' : ''}${m.orders_error ? '\n挂单刷新失败' : ''}`;
            const changeText =
              change == null
                ? '无等长前窗对比'
                : `${change >= 0 ? '+' : ''}${number(change, 1)}% 较前 ${statsDays()} 天`;
            const inventory = tab === 'inventory' || tab === 'watch' || watched(x);
            return `<tr data-slug="${esc(x.slug)}"><td><div class="item-cell">${itemImage(x)}<div><button class="item-name" data-detail="${esc(x.slug)}">${esc(x.name)}${x.alias ? ` <span class="neutral">· ${esc(x.alias)}</span>` : ''}</button><div class="item-meta"><span class="pill">${esc(kindLabel[x.kind] || '商品')}</span><span title="${esc(updateTitle)}">${stale(m.stats_at) || stale(m.orders_at) ? '<i class="stale-dot"></i> ' : ''}${m.stats_error || m.orders_error ? '刷新失败 · 保留旧值' : !m.orders_at ? '挂单待刷新' : timeLabel(m.orders_at)}</span></div></div></div></td>
    <td>${inventory ? `<div class="quantity-stepper"><button data-step="-1" data-item="${esc(x.slug)}" aria-label="减少 ${esc(x.name)} 持有数量" ${s.quantity <= 0 ? 'disabled' : ''}>−</button><input class="number-input" data-quantity="${esc(x.slug)}" type="number" min="0" max="100000" step="1" value="${s.quantity}" aria-label="${esc(x.name)} 持有数量"><button data-step="1" data-item="${esc(x.slug)}" aria-label="增加 ${esc(x.name)} 持有数量">＋</button></div>` : '<span class="neutral">—</span>'}</td>
    <td><div class="price">${price(p)}</div><div class="subline ${change == null ? '' : change >= 0 ? 'positive' : 'negative'}" title="相邻两个 ${statsDays()} 天窗口的成交量加权均价对比；低样本涨幅参考价值有限">${changeText}</div></td>
    <td title="${esc(updateTitle)}"><div class="order-pair"><span class="price">${price(ask(m))}</span><span class="slash">/</span><span class="buy">${number(bid(m))}</span></div><div class="subline">${m.orders ? `${m.orders.sell_count} 卖家 · ${m.orders.buy_count} 买家` : '尚未查询，请到 WFM 核价'}</div></td>
    <td><div class="volume-cell"><span class="volume-num">${m.stats?.end ? number(summary.volume) : '—'}</span>${spark(MarketStats.history(m, 90))}</div><div class="subline">${m.stats ? `${summary.days} 天有记录${summary.volume < 20 ? ' · 样本少' : ''}` : '暂无成交统计'}</div></td>
    <td>${inventory ? window.Frames.targetCell(x) : '<span class="neutral">—</span>'}</td>
    <td><div class="price">${s.quantity && p != null ? price(s.quantity * p) : '<span class="neutral">—</span>'}</div>${s.quantity && s.cost != null && p != null ? `<div class="subline ${p >= s.cost ? 'positive' : 'negative'}">账面差额 ${p >= s.cost ? '+' : ''}${number((p - s.cost) * s.quantity)}p</div>` : ''}</td>
    <td>${inventory ? `<button class="detail-btn" data-detail="${esc(x.slug)}" aria-label="查看 ${esc(x.name)} 详情">↗</button>` : `<button class="watch-btn" data-watch="${esc(x.slug)}">＋ 关注</button>`}</td></tr>`;
          })
          .join('')
      : '<tr><td colspan="8" class="empty">没有匹配的商品。试试英文名，或清除筛选。</td></tr>';
  const times = rows
    .map(x => mrow(x.slug).stats_at)
    .filter(Boolean)
    .sort();
  const staleCount = rows.filter(
    x => stale(mrow(x.slug).stats_at) || stale(mrow(x.slug).orders_at)
  ).length;
  $('freshness').textContent =
    `${times.length ? `成交数据查询 ${timeLabel(times[0])}${times[0] !== times.at(-1) ? ' — ' + timeLabel(times.at(-1)) : ''}` : '尚未获取行情'}${staleCount ? ` · ${staleCount} 种含旧值或待刷新` : ''}`;
}
function setTab(next) {
  if (!state || !settings) return;
  window.scrollTo(0, 0);
  tab = next;
  query = '';
  filter = 'all';
  sort = 'default';
  $('search').value = '';
  $('type-filter').value = 'all';
  $('sort').value = 'default';
  window.Frames?.controls();
  document
    .querySelectorAll('[data-tab]')
    .forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const standard = baseTabs.includes(tab);
  $('stats-controls').hidden = !standard || tab === 'mods';
  $('market-section').classList.toggle('baro-view', tab === 'mods');
  $('market-section').hidden = !standard;
  $('inventory-summary').hidden = !standard;
  $('reading-notes').hidden = !standard;
  $('riven-section').hidden = tab !== 'rivens';
  $('relic-section').hidden = tab !== 'relics';
  $('relic-prices-section').hidden = tab !== 'relic-prices';
  $('refresh').hidden = tab === 'relics';
  const content = {
    ducats: ['杜卡德兑换', '杜卡德兑换', '比较整批成本和每次交易能收到的杜卡德。'],
    home: ['首页', '首页', ''],
    watch: ['我的关注', '我的关注', '关注商品的价格与成交量。', '关注商品', '数量为零也可关注。'],
    ledger: ['交易记录', '交易记录', '按已记录成本计算买卖差额。'],
    sets: ['散件凑套', '散件凑套', '扣除自用保留，比较整套与散卖报价。'],
    routes: ['赚钱效率', '赚钱效率', '分别记录报价估值和实际卖出收入。'],
    inventory: [
      '我的库存',
      '我的库存',
      '查看数量、行情与目标售价。',
      '持仓明细',
      '点击商品查看走势。'
    ],
    frames: [
      'Prime 战甲',
      'Prime 战甲',
      '看近期涨幅、成交量和历史价位，再决定是否分批卖出。',
      '战甲套装',
      '按蓝图及组件蓝图整套统计。'
    ],
    mods: [
      '奸商货单',
      '奸商货单',
      '比较囤货效率与成交量，按需填写购买数量。',
      '本次武器与 MOD',
      'MOD 按 R0。'
    ],
    rivens: ['0 洗紫卡', '0 洗紫卡', '循环次数为 0 的公开直售挂价，非成交价。'],
    'relic-prices': ['核桃价格', '核桃价格', '按时代、精炼和掉落价值挑选遗物；支持从低到高开。'],
    relics: ['开核桃助手', '开核桃助手', '选择遗物查看掉落，或截图识别奖励。']
  }[tab];
  ['crumb', 'page-title', 'page-subtitle'].forEach((id, i) => ($(id).textContent = content[i]));
  if (standard) {
    $('table-title').innerHTML = esc(content[3]) + ' <span id="table-count"></span>';
    $('table-description').textContent = content[4];
    renderTable();
  }
  window.Extras?.activate(tab);
  renderJob();
  window.Desk?.activate();
  window.Welcome?.activate();
}
function renderJob() {
  const groups = [
    { key: 'market', job: state.job, label: '库存 / 普通商品' },
    { key: 'rivens', job: state.riven_job, label: '0 洗紫卡' },
    { key: 'compare', job: state.compare_job, label: '遗物掉落比价' }
  ].filter(x => x.job);
  const preferred = tab === 'rivens' ? 'rivens' : tab === 'relics' ? 'compare' : 'market';
  const active =
    groups.find(x => x.key === preferred && x.job.running) ||
    groups.find(x => x.job.running) ||
    groups.find(x => x.key === preferred && x.job.total > 0);
  const job = active?.job;
  $('job-panel').hidden = !job?.total;
  if (job?.total) {
    const percent = Math.min(100, Math.round((job.done / job.total) * 100));
    $('job-percent').textContent = percent + '%';
    $('job-count').textContent = `${job.done} / ${job.total} 项查询`;
    $('job-text').textContent = job.running
      ? `${active.label}：${job.current || '准备查询…'}`
      : `${active.label}已完成${job.errors?.length ? ` · ${job.errors.length} 项失败，保留旧值` : ''}`;
    $('job-progress').style.width = percent + '%';
    $('job-bar').setAttribute('aria-valuenow', String(percent));
    $('job-spinner').hidden = !job.running;
    $('job-panel').classList.toggle('complete', !job.running);
    $('job-panel').classList.toggle('has-errors', !!job.errors?.length);
    $('job-other').textContent = groups
      .filter(x => x !== active && x.job.running)
      .map(x => `${x.label} ${x.job.done}/${x.job.total}`)
      .join(' · ');
  }
  const current = preferred === 'rivens' ? state.riven_job : state.job,
    button = $('refresh');
  button.disabled = !!current?.running || !!window.Portable;
  const label =
    tab === 'inventory'
      ? '刷新库存行情'
      : tab === 'frames'
        ? '刷新本页 P 甲'
        : tab === 'mods'
          ? '刷新本页 MOD'
          : '刷新高价候选';
  button.querySelector('span').textContent = window.Hosted
    ? '检查行情更新'
    : window.Portable
      ? '快照版 · 行情不自动更新'
      : current?.running
        ? `更新中 ${Math.round((current.done / current.total) * 100)}%`
        : label;
  window.Extras?.renderProgress();
}
async function loadState(initial = false) {
  const latest = await request('/api/state');
  state = latest;
  if (initial) {
    settings = readBrowserSettings(latest.initial_settings);
    $('stats-window').value = String(statsDays());
  }
  renderMetrics();
  renderJob();
  if (!document.activeElement?.matches('input,textarea,select')) {
    if (baseTabs.includes(tab)) renderTable();
    if (selected && !$('drawer').hidden) renderDrawer(selected);
  }
  window.Extras?.update();
  window.Welcome?.update();
  if (tab === 'ducats') window.Desk?.activate();
  if (wasRunning && !state.job.running && lastJobStart === state.job.started) {
    const failures = state.job.errors.length;
    notify(
      failures
        ? `刷新结束；${failures} 个查询失败，相关商品保留旧值和原时间。可以稍后重试。`
        : `已更新 ${state.job.completed_items ?? state.job.item_count ?? 0} 种商品。成交均价与在线挂单均带独立时间戳。`,
      !failures
    );
  }
  wasRunning = state.job.running;
  lastJobStart = state.job.started;
  clearTimeout(pollTimer);
  if ([state.job, state.riven_job, state.compare_job].some(x => x?.running))
    pollTimer = setTimeout(() => loadState().catch(handlePollError), 1600);
}
function handlePollError(error) {
  notify('无法连接本机服务：' + error.message + '。重新双击「打开行情.command」可恢复。');
  pollTimer = setTimeout(() => loadState().catch(handlePollError), 5000);
}
async function refreshItems(slugs) {
  if (window.Hosted) return window.Hosted.reload();
  if (window.Portable) return notify('便携版保留导出时的行情；实时刷新请使用本地服务版。');
  if (!slugs.length) return notify('当前没有需要刷新的商品。');
  try {
    state.job = {
      running: true,
      done: 0,
      total: slugs.length * 2,
      current: '准备查询…',
      errors: [],
      item_count: slugs.length
    };
    renderJob();
    await request('/api/refresh', { slugs });
    $('notice').hidden = true;
    await loadState();
  } catch (error) {
    notify(error.message);
  }
}

function modDecision(x, m) {
  const a = statsFor(m, 7),
    b = statsFor(m, 30),
    c = statsFor(m, 90),
    h = MarketStats.history(m, 90),
    prices = h.map(r => r.price);
  const low = prices.length ? Math.min(...prices) : null,
    high = prices.length ? Math.max(...prices) : null;
  const opportunity = settings.ducatCost,
    credits = settings.creditCost;
  const net =
    b.price == null || opportunity == null || opportunity === ''
      ? null
      : b.price -
        (x.ducats / 100) * Number(opportunity) -
        ((x.credits || 0) / 1e6) * Number(credits || 0);
  return `<div class="decision-card"><h3>卖出观察 / 补仓测算</h3><p>90 天每日均价范围：<b>${number(low, 1)} — ${number(high, 1)}p</b>；7 天相对 30 天：<b>${a.price != null && b.price ? number((a.price / b.price - 1) * 100, 1) + '%' : '—'}</b>。近 30 天 WFM 记录 ${number(b.volume)} 张，持有 ${srow(x.slug).quantity} 张。</p><p>${srow(x.slug).target ? `你的目标 ${srow(x.slug).target}p，${targetHit(srow(x.slug), m) ? targetQuote(m).label + '达到观察线，去 WFM 核价。' : '当前观察依据未达线或已过期。'}` : '先参考 90 天走势设目标；到价后可先挂 1–3 张，观察实际成交。'}挂价明显高于成交均价时，不能直接按挂价估算收益。</p><p>按 30 天均价的毛回款：<b>${x.ducats && b.price != null ? number((b.price / x.ducats) * 100, 1) + 'p / 100 杜卡德' : '待查询'}</b>。${net == null ? '在奸商补仓页填杜卡德机会成本后计算净差。' : `扣除所填兑换资源机会成本：<b>${number(net, 1)}p / 张</b>。`}此为历史售价情景，不是未来利润承诺。</p><p>${x.supply_note ? esc(x.supply_note) + '。' : ''}先核对本次实际货单、成交量和资源成本；长期未返场不保证继续上涨。</p></div>`;
}
function renderModPanel() {
  window.Desk?.baro();
}
$('stats-window').onchange = e => {
  settings.statsWindow = Number(e.target.value);
  queueSave();
  renderMetrics();
  renderTable();
  if (selected) renderDrawer(selected);
};

function chart(m) {
  const days = MarketStats.history(m, chartWindow);
  if (days.length < 2)
    return '<div class="chart-empty">成交记录不足，暂不绘制走势。缺记录不等于价格为 0。</div>';
  const e = Date.parse(m.stats.end + 'T00:00:00Z'),
    start = e - (chartWindow - 1) * 86400000;
  const lo = Math.min(...days.map(x => x.price)),
    hi = Math.max(...days.map(x => x.price)),
    span = hi - lo || 1;
  const coordinates = days.map(x => [
    40 + ((Date.parse(x.date) - start) / (e - start)) * 408,
    120 - ((x.price - lo) / span) * 93
  ]);
  const points = coordinates.map(x => x.map(v => v.toFixed(1)).join(',')).join(' ');
  return `<svg class="chart" viewBox="0 0 465 155" role="img" aria-label="${chartWindow} 天每日成交均价走势"><line x1="40" y1="27" x2="448" y2="27" stroke="#e1e9e3"/><line x1="40" y1="120" x2="448" y2="120" stroke="#e1e9e3"/><text x="1" y="30" fill="#82978a" font-size="9">${number(hi, 1)}p</text><text x="1" y="123" fill="#82978a" font-size="9">${number(lo, 1)}p</text><polyline points="${points}" fill="none" stroke="#438661" stroke-width="2" stroke-linejoin="round"/>${days.map((x, i) => `<circle cx="${coordinates[i][0]}" cy="${coordinates[i][1]}" r="2.4" fill="#438661"><title>${esc(x.date)} · ${number(x.price, 2)}p · ${x.volume} 件记录</title></circle>`).join('')}</svg><div class="chart-legend"><span>${new Date(start).toISOString().slice(0, 10)}</span><span>按真实日历定位 · 缺记录不补零</span><span>${m.stats.end}</span></div>`;
}

function depth(rows, side) {
  if (!rows?.length) return '<p class="drawer-muted">暂无在线挂单</p>';
  const max = Math.max(...rows.slice(0, 5).map(x => x.quantity));
  return rows
    .slice(0, 5)
    .map(
      x =>
        `<div class="depth-row ${side}" style="--depth:${Math.max(8, (x.quantity / max) * 100)}%"><span>${number(x.price)}p</span><span>× ${number(x.quantity)}</span></div>`
    )
    .join('');
}
function renderDrawer(slug) {
  const x = state.catalog.find(x => x.slug === slug),
    s = srow(slug),
    m = mrow(slug);
  if (!x) return;
  const baro = s.baro_date || x.baro_date,
    summary = statsFor(m);
  $('drawer-content').innerHTML =
    `<div class="drawer-label">${esc(kindLabel[x.kind] || '商品')} · ${x.kind === 'mod' ? 'R0' : 'PC'}</div><div class="drawer-art">${itemImage(x, true)}</div><h2>${esc(x.name)}</h2><div class="english">${esc(x.english)}${x.alias ? ' · ' + esc(x.alias) : ''}</div><a class="link" href="https://warframe.market/items/${encodeURIComponent(slug)}/statistics" target="_blank" rel="noopener">在 Warframe Market 查看 ↗</a>
  <div class="detail-metrics"><div><small>${statsDays()} 天成交均价</small><strong>${price(mean(m))}</strong></div><div><small>在线最低卖价</small><strong>${price(ask(m))}</strong></div><div><small>在线最高买价</small><strong>${price(bid(m))}</strong></div></div>
  ${wfmPurchasePanel(x, m)}<h3>成交均价走势 <select id="chart-window" aria-label="走势窗口">${[7, 30, 90].map(n => `<option value="${n}" ${n === chartWindow ? 'selected' : ''}>${n} 天</option>`).join('')}</select></h3>${chart(m)}${window.Desk?.history(slug) || ''}
  <div class="detail-metrics">${[7, 30, 90]
    .map(n => {
      const v = statsFor(m, n);
      return `<div><small>${n} 天均价 / 记录量</small><strong>${price(v.price)}</strong><small>${number(v.volume)} 件 · ${v.days} 天有记录</small></div>`;
    })
    .join('')}</div>
  <p class="drawer-muted">${m.stats ? `行情快照窗口 ${summary.start} — ${summary.end}（UTC）；最多获取 WFM 近 90 天。最新成交记录：${esc(m.stats.latest || '无')}。` : '成交统计尚未获取。'}不足 20 件记录时参考性低；90 天前窗不足，不显示环比。</p>
  ${x.kind === 'frame' ? window.Frames.detail(x) : ''}${x.baro ? modDecision(x, m) : ''}${window.Desk?.quoteDetail(slug) || ''}
  <h3>当前在线挂单 · 前 5 档</h3><div class="depth"><div><div class="depth-title">卖单 ${m.orders?.sell_count ?? '—'} 个卖家</div>${depth(m.orders?.sell, 'sell')}</div><div><div class="depth-title">买单 ${m.orders?.buy_count ?? '—'} 个买家</div>${depth(m.orders?.buy, 'buy')}</div></div><div class="drawer-time">成交数据查询 ${timeLabel(m.stats_at)} / 挂单查询 ${timeLabel(m.orders_at)}</div>${m.stats_error || m.orders_error ? '<p class="drawer-muted negative">最近查询失败；以上可能是旧数据。</p>' : ''}
  ${x.baro ? `<div class="drawer-baro">常规返场：${baro ? esc(baro) : '未录入'}${s.baro_date ? ' · 手动记录' : x.baro_verified ? ' · ' + esc(x.baro_verified) + ' 核对' : ''}<br>日期不自动更新；2026 年 7 月 TennoCon 全货活动也补过供应。<br><a class="link" href="https://wiki.warframe.com/w/Baro_Ki%27Teer/Trades" target="_blank" rel="noopener">核对历史货单 ↗</a>${x.ducats ? ` · 兑换 ${number(x.ducats)} 杜卡德 + ${number(x.credits)} 现金` : ''}</div>` : ''}
  <p class="drawer-muted">参考成本用于期初录入与估值；已有交易账本的收益按实际记录计算，改参考成本不改历史买入记录。</p><h3>我的持有计划 <small class="auto-label">修改自动记住</small></h3><form id="item-form" class="drawer-form"><label>持有数量<input name="quantity" type="number" min="0" max="100000" step="1" value="${s.quantity}" required></label><label>目标售价 / p<input name="target" type="number" min="1" max="1000000" step="1" value="${s.target ?? ''}" placeholder="留空，自行决定"></label><label>参考单件成本 / p<input name="cost" type="number" min="0" max="1000000" step="0.1" value="${s.cost ?? ''}" placeholder="可选，不猜测成本"></label>${x.baro ? `<label>最近常规返场<input name="baro_date" type="date" value="${esc(baro || '')}"></label>` : '<span></span>'}<label class="full">持有笔记<textarea name="note" aria-label="持有笔记" maxlength="1000" placeholder="例如：等成交均价到目标，再分批挂售。">${esc(s.note)}</textarea></label></form><button class="remove-watch" id="toggle-watch">${srow(slug).watch ? '取消关注（库存保留）' : '加入我的关注'}</button>`;
  $('chart-window').onchange = e => {
    chartWindow = Number(e.target.value);
    renderDrawer(slug);
  };
  const form = $('item-form');
  form.addEventListener('submit', e => e.preventDefault());
  const remember = () => {
    if (!form.checkValidity()) return;
    const f = new FormData(form);
    if (window.Desk && Number(f.get('quantity')) !== srow(slug).quantity)
      window.Desk.adjust(slug, Number(f.get('quantity')));
    settings.items[slug] = {
      ...srow(slug),
      quantity: Number(f.get('quantity')),
      target: f.get('target') === '' ? null : Number(f.get('target')),
      cost: f.get('cost') === '' ? null : Number(f.get('cost')),
      note: String(f.get('note') || ''),
      watch: srow(slug).watch
    };
    if (f.get('baro_date') && f.get('baro_date') !== x.baro_date)
      settings.items[slug].baro_date = String(f.get('baro_date'));
    else delete settings.items[slug].baro_date;
    queueSave();
    renderMetrics();
    if (baseTabs.includes(tab)) renderTable();
  };
  form.addEventListener('input', e => {
    if (e.target.name !== 'quantity') remember();
  });
  form.addEventListener('change', remember);
  $('toggle-watch').onclick = () => {
    updateSetting(slug, 'watch', !srow(slug).watch);
    renderTable();
    renderDrawer(slug);
  };
}
function openDrawer(slug) {
  selected = slug;
  renderDrawer(slug);
  $('drawer').hidden = false;
  $('drawer-overlay').hidden = false;
  document.body.style.overflow = 'hidden';
  $('close-drawer').focus();
}
function closeDrawer() {
  selected = null;
  $('drawer').hidden = true;
  $('drawer-overlay').hidden = true;
  document.body.style.overflow = '';
}
$('rows').addEventListener('click', e => {
  const step = e.target.closest('[data-step]');
  if (step) {
    const slug = step.dataset.item;
    updateSetting(
      slug,
      'quantity',
      Math.min(100000, Math.max(0, srow(slug).quantity + Number(step.dataset.step)))
    );
    renderTable();
    return;
  }
  const detail = e.target.closest('[data-detail]');
  if (detail) return openDrawer(detail.dataset.detail);
  const watch = e.target.closest('[data-watch]');
  if (watch) {
    updateSetting(watch.dataset.watch, 'watch', true);
    renderTable();
  }
});
$('rows').addEventListener('input', e => {
  const input = e.target,
    slug = input.dataset.quantity || input.dataset.target;
  if (input.dataset.quantity) return;
  if (!slug || !input.checkValidity() || (input.dataset.quantity && input.value === '')) return;
  updateSetting(
    slug,
    input.dataset.quantity ? 'quantity' : 'target',
    input.value === '' ? null : Number(input.value)
  );
});
$('rows').addEventListener('change', e => {
  const input = e.target,
    slug = input.dataset.quantity || input.dataset.target;
  if (!slug) return;
  if (!input.reportValidity()) {
    renderTable();
    return;
  }
  if (input.dataset.quantity) {
    if (input.value === '') {
      input.value = srow(slug).quantity;
      return;
    }
    updateSetting(slug, 'quantity', Number(input.value));
  } else updateSetting(slug, 'target', input.value === '' ? null : Number(input.value));
  renderTable();
});
$('search').addEventListener('input', e => {
  query = e.target.value.trim().toLowerCase();
  renderTable();
});
$('type-filter').addEventListener('change', e => {
  filter = e.target.value;
  renderTable();
});
$('sort').addEventListener('change', e => {
  sort = e.target.value;
  renderTable();
});
document.querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => setTab(b.dataset.tab)));
$('refresh').onclick = () =>
  window.Hosted
    ? window.Hosted.reload()
    : tab === 'rivens'
      ? window.Extras?.refreshRivens()
      : refreshItems(visibleItems().map(x => x.slug));
$('drawer-overlay').onclick = closeDrawer;
$('close-drawer').onclick = closeDrawer;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDrawer();
});
document.addEventListener('click', e => {
  const button = e.target.closest('[data-copy-trade]');
  if (!button) return;
  const original = button.textContent;
  let message;
  try {
    message = resolveTradeMessage(JSON.parse(button.dataset.copyTrade));
  } catch {}
  if (!message) return notify('这笔报价已过期或发生变化，请检查行情更新后重试。');
  copyTradeText(message)
    .then(copied => {
      if (copied === false) return;
      button.textContent = '已复制';
      notify('WFM 私聊模板已复制，可以直接粘贴到游戏聊天。', true);
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = original;
      }, 1600);
    })
    .catch(error => notify('复制失败：' + error.message));
});
$('help').onclick = () => $('help-dialog').showModal();
$('close-help').onclick = () => $('help-dialog').close();
window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try {
      settings = JSON.parse(e.newValue);
      renderMetrics();
      if (baseTabs.includes(tab)) renderTable();
      window.Extras?.update();
      if (tab === 'ducats') window.Desk?.activate();
    } catch {}
  }
});
document.addEventListener(
  'error',
  e => {
    if (e.target.tagName === 'IMG' && e.target.closest('.item-art')) {
      const fallback = e.target.dataset.fallback;
      if (fallback) {
        delete e.target.dataset.fallback;
        e.target.src = fallback;
        return;
      }
      e.target.hidden = true;
      e.target.closest('.item-art').classList.add('image-failed');
    }
  },
  true
);
document
  .querySelectorAll('[data-tab],#refresh,#stats-window,#portable-export,#portable-share')
  .forEach(b => (b.disabled = true));
(async () => {
  try {
    await loadState(true);
    document
      .querySelectorAll('[data-tab],#stats-window,#portable-export,#portable-share')
      .forEach(b => (b.disabled = false));
    window.Desk?.init();
    setTab(
      settings.startInDesk
        ? 'inventory'
        : Object.values(settings.items).some(x => x.quantity > 0)
          ? 'inventory'
          : 'home'
    );
    window.Extras?.ready();
    if (!window.Hosted && !window.Portable && !state.job.running) {
      const old = state.catalog
        .filter(watched)
        .filter(x => stale(mrow(x.slug).orders_at) || stale(mrow(x.slug).stats_at));
      if (old.length) await refreshItems(old.map(x => x.slug));
    }
  } catch (error) {
    $('rows').innerHTML =
      '<tr><td colspan="8" class="empty">行情暂时无法读取，请稍后重试。</td></tr>';
    $('welcome-snapshot').textContent = '行情读取失败；请刷新页面重试。';
    notify(error.message);
  }
})();
