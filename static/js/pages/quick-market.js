'use strict';
window.QuickMarket = (() => {
  let items = null,
    pending = null,
    query = '',
    kind = 'all',
    order = 'relevance',
    limit = 60;
  const item = slug => items?.find(x => x.slug === slug);
  async function ensureItems() {
    if (items) return;
    pending ||= request('/api/items')
      .then(all => {
        const index = new Map(
          all.map(x => [
            x.slug,
            x.tags?.includes('weapon') && !x.tags.includes('component')
              ? { ...x, kind: 'weapon' }
              : x
          ])
        );
        for (const x of state.catalog) index.set(x.slug, x);
        items = [...index.values()];
      })
      .finally(() => {
        pending = null;
      });
    await pending;
  }
  function matches(x) {
    if (kind !== 'all' && x.kind !== kind) return false;
    return (
      !query ||
      [x.name, x.english, x.alias, x.slug].some(v => (v || '').toLowerCase().includes(query))
    );
  }
  function render() {
    if (!items || tab !== 'quick-market') return;
    const rows = items.filter(matches);
    const hasQuote = x => !!(mrow(x.slug).orders_at || mrow(x.slug).stats_at);
    rows.sort((a, b) => {
      const ma = mrow(a.slug),
        mb = mrow(b.slug);
      if (order === 'price')
        return (ask(ma) ?? Infinity) - (ask(mb) ?? Infinity) || a.name.localeCompare(b.name);
      if (order === 'volume')
        return (
          (statsFor(mb, 30).volume || 0) - (statsFor(ma, 30).volume || 0) ||
          a.name.localeCompare(b.name)
        );
      return Number(hasQuote(b)) - Number(hasQuote(a)) || a.name.localeCompare(b.name);
    });
    $('quick-market-count').textContent =
      `${rows.length} 种匹配 · ${rows.filter(hasQuote).length} 种有已采集行情`;
    $('quick-market-rows').innerHTML =
      rows
        .slice(0, limit)
        .map(x => {
          const m = mrow(x.slug),
            stats = statsFor(m, 30);
          const statsState = DeskCore.statsFresh(m)
            ? ''
            : m.stats_at
              ? '统计过期 / 读取失败'
              : '成交统计未采集';
          const orderState = DeskCore.fresh(m.orders_at, m.orders_error)
            ? ''
            : m.orders_at
              ? '挂单过期 / 读取失败'
              : '挂单未采集';
          return `<tr><td><div class="item-cell">${itemImage(x)}<div><button class="item-name" data-desk-detail="${esc(x.slug)}">${esc(x.name)}</button><small>${esc(x.english)}</small></div></div></td><td><b>${number(stats.price, 1)}p</b><small>${stats.price == null ? '无成交价格' : `30 天 ${number(stats.volume)} 条`}</small>${statsState ? `<small class="quality-warning">${statsState}</small>` : ''}</td><td>${number(ask(m), 1)} / ${number(bid(m), 1)}p${orderState ? `<small class="quality-warning">${orderState}</small>` : ''}</td><td><small>挂单采集 ${timeLabel(m.orders_at)}</small><small>统计采集 ${timeLabel(m.stats_at)}</small></td><td><button class="plain-button" data-desk-detail="${esc(x.slug)}">报价 / 走势</button></td></tr>`;
        })
        .join('') || '<tr><td colspan="5">没有匹配商品，试试英文名或部位名称。</td></tr>';
    $('quick-market-more').hidden = rows.length <= limit;
  }
  async function activate() {
    const section = $('quick-market-section');
    if (tab !== 'quick-market') {
      if (section) section.hidden = true;
      return;
    }
    if (!section) {
      const panel = document.createElement('section');
      panel.id = 'quick-market-section';
      panel.className = 'quick-market-section';
      panel.innerHTML = `<div class="desk-actions quick-market-tools"><input id="quick-market-search" type="search" placeholder="搜索商品：中文 / English / 别名" aria-label="搜索全部商品"><label>品类 <select id="quick-market-kind"><option value="all">全部</option><option value="frame">战甲套装</option><option value="mod">MOD</option><option value="weapon">武器</option><option value="component">其他 / 部件</option></select></label><label>排序 <select id="quick-market-sort"><option value="relevance">有行情优先</option><option value="price">最低卖价 ↑</option><option value="volume">30 天成交量 ↓</option></select></label></div><p>只查已发布快照，不需要打开 WFM。目录有收录不代表已经采集行情；MOD 按 R0，旧价会标出。</p><p id="quick-market-count" role="status">正在读取商品目录…</p><div class="quick-market-table"><table class="compare-table"><thead><tr><th>商品</th><th>30 天成交均价</th><th>在线卖 / 买</th><th>采集时间</th><th></th></tr></thead><tbody id="quick-market-rows"></tbody></table></div><button id="quick-market-more" class="plain-button" hidden>再显示 60 种</button>`;
      $('market-section').after(panel);
      $('quick-market-search').oninput = e => {
        query = e.target.value.trim().toLowerCase();
        limit = 60;
        render();
      };
      $('quick-market-kind').onchange = e => {
        kind = e.target.value;
        limit = 60;
        render();
      };
      $('quick-market-sort').onchange = e => {
        order = e.target.value;
        limit = 60;
        render();
      };
      $('quick-market-more').onclick = () => {
        limit += 60;
        render();
      };
    }
    $('quick-market-section').hidden = false;
    try {
      await ensureItems();
      render();
    } catch (error) {
      $('quick-market-count').textContent = '目录读取失败，重新点击“行情速查”重试。';
      notify(error.message);
    }
  }
  return { activate, update: render, item };
})();
