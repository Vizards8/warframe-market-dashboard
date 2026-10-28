'use strict';
window.Frames = (() => {
  const pct = x => (x == null ? '—' : `${x >= 0 ? '+' : ''}${number(x, 1)}%`);
  const cache = new WeakMap();
  const signal = x => {
    const m = mrow(x.slug),
      now = Date.now(),
      saved = cache.get(m);
    if (saved?.tick === Math.floor(now / 1000)) return saved.value;
    const value = DeskCore.frameSignal(m, now);
    cache.set(m, { tick: Math.floor(now / 1000), value });
    return value;
  };
  const hit = x => targetHit(srow(x.slug), mrow(x.slug));
  function matches(x, value) {
    if (value === 'held') return held(x);
    if (value === 'watch') return watched(x);
    if (value === 'target') return hit(x);
    if (value === 'rising') return signal(x).rising;
    if (value === 'high') return signal(x).high;
    return true;
  }
  function compare(a, b, key) {
    const qa = signal(a),
      qb = signal(b);
    const value = (x, q) =>
      ({
        change: q.comparable ? q.week.change : null,
        premium: q.reliable ? q.premium : null,
        price: q.week.price,
        volume: q.week.price != null ? q.week.volume : null,
        target:
          srow(x.slug).target > 0 && targetQuote(mrow(x.slug)).valid
            ? targetQuote(mrow(x.slug)).value / srow(x.slug).target
            : null
      })[key] ?? -Infinity;
    return (
      (key === 'default'
        ? Number(hit(b)) - Number(hit(a)) || qb.rank - qa.rank
        : value(b, qb) - value(a, qa)) ||
      Number(qb.reliable) - Number(qa.reliable) ||
      (qb.premium ?? -Infinity) - (qa.premium ?? -Infinity) ||
      a.name.localeCompare(b.name)
    );
  }
  function controls() {
    const frames = tab === 'frames';
    $('market-section').classList.toggle('frame-view', frames);
    $('frame-guide').hidden = !frames;
    $('stats-window').closest('label').hidden = frames;
    const filters = frames
      ? [
          ['all', '全部战甲'],
          ['held', '只看持有'],
          ['watch', '持有 / 关注'],
          ['rising', '近期涨价'],
          ['high', '接近 90 天高位'],
          ['target', '已达目标']
        ]
      : [
          ['all', '所有品类'],
          ['weapon', '武器'],
          ['mod', 'MOD'],
          ['frame', 'P 甲'],
          ['component', '散件'],
          ['watch', '仅有库存 / 关注']
        ];
    const sorts = frames
      ? [
          ['default', '卖出参考优先'],
          ['change', '近 7 天环比 ↓'],
          ['premium', '7 天相对 30 天涨幅 ↓'],
          ['price', '7 天成交均价 ↓'],
          ['volume', '7 天成交量 ↓'],
          ['target', '目标进度 ↓']
        ]
      : [
          ['default', '默认排序'],
          ['price', '成交价 ↓'],
          ['value', '持仓估值 ↓'],
          ['volume', '成交量 ↓'],
          ['change', '窗口环比 ↓'],
          ['ducat', '每百杜卡德回款 ↓'],
          ['target', '目标进度 ↓']
        ];
    $('type-filter').innerHTML = filters
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join('');
    $('type-filter').setAttribute('aria-label', frames ? '战甲筛选' : '品类筛选');
    $('sort').innerHTML = sorts.map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    $('type-filter').value = filter;
    $('sort').value = sort;
    if (!frames) {
      const headers = [
        '商品 / 品类',
        '持有数量',
        statsDays() + ' 天成交均价',
        '在线卖 / 买',
        statsDays() + ' 天记录量',
        '目标售价',
        '持仓估值',
        ''
      ];
      document
        .querySelectorAll('#market-section thead th')
        .forEach((el, i) => (el.textContent = headers[i]));
    }
  }
  function targetCell(x) {
    const s = srow(x.slug),
      q = targetQuote(mrow(x.slug));
    return `<div class="target-wrap"><input class="number-input target-input" data-target="${esc(x.slug)}" type="number" min="1" max="1000000" step="1" value="${s.target ?? ''}" placeholder="设目标" aria-label="${esc(x.name)} 目标售价"><span class="unit">p</span></div><div class="target-status">${q.label} ${number(q.value, 1)}p${q.valid ? (s.target > 0 ? `<br>${hit(x) ? '✓ 已达目标' : `距目标 ${number(Math.max(0, s.target - q.value), 1)}p`}` : '<br>未设目标') : '<br>旧值 / 缺价，暂不判断'}</div>`;
  }
  function detail(x) {
    const q = signal(x),
      w = q.week;
    return `<section class="decision-card frame-decision"><h3>${q.label}</h3><p>7 天成交均价 ${number(w.price, 1)}p，较前 7 天 ${q.comparable ? pct(w.change) : q.reliable ? '前窗样本不足，暂不比较' : q.label + '，暂不比较'}；近 7 天 ${number(w.volume)} 条记录，${w.days} 天有成交。</p><p>30 天均价 ${number(q.month.price, 1)}p；7 天相对 30 天 ${pct(q.premium)}。近 90 天最高周均价 ${q.peak == null ? '历史覆盖不足' : number(q.peak, 1) + 'p'}。</p><p>${q.reliable ? '若有可卖库存，可结合自己的成本与目标价分批挂售。想立即卖，查看买单价格及数量；最低卖价只是别人要价。' : '近期数据不足或过期，以上历史值暂不用于卖出排序。'}入库 / 重生活动会增加供应，交易前再核对当前活动与 WFM 挂单。</p></section>`;
  }
  function table(rows) {
    const headers = [
      '战甲 / 持有',
      '7 天均价 / 周环比',
      '30 天均价',
      '90 天最高周均价',
      '7 天成交记录',
      '在线卖 / 买',
      '目标价判断',
      ''
    ];
    document
      .querySelectorAll('#market-section thead th')
      .forEach((el, i) => (el.textContent = headers[i]));
    $('frame-guide').innerHTML =
      `<p>先看涨价幅度，再看成交量和历史价位；有库存时再结合目标价决定是否分批卖。</p><details><summary>卖出参考怎么看？</summary><p>“近期涨价”：7 天成交均价比前 7 天上涨至少 10%，两个窗口均至少 4 天、20 条成交记录。“接近高位”：当前 7 天均价达到近 90 天最高滚动周均价的 90%；至少有 60 天成交数据、30 个有效周窗口才判断。高位不等于还在上涨。</p><p>默认先排已达个人目标，再排涨价且接近高位、近期涨价、接近高位；只看持有可筛出自己的战甲。旧数据和小样本不触发涨价 / 高位信号。数字是 WFM 用户标记成交记录，并非全服总成交量。</p><p>目标依据只改变目标价判断，不改变历史均价。30 天均价适合设参考线；最低卖价看挂售竞争，最高买价看即时求购。此处不预测未来价格，也未自动核验 Prime 重生返场。</p></details>`;
    $('rows').innerHTML =
      rows
        .map(x => {
          const m = mrow(x.slug),
            s = srow(x.slug),
            q = signal(x),
            w = q.week;
          const stateText = q.reliable ? (hit(x) ? '已达个人目标' : q.label) : q.label;
          return `<tr data-slug="${esc(x.slug)}"><td><div class="item-cell">${itemImage(x)}<div><button class="item-name" data-detail="${esc(x.slug)}">${esc(x.name)}${x.alias ? ` · ${esc(x.alias)}` : ''}</button><div class="subline">持有 ${s.quantity} 套${s.reserve ? ` · 自用保留 ${s.reserve}` : ''}</div><span class="frame-signal ${q.reliable && (hit(x) || q.rank > 0) ? 'frame-signal-active' : ''}">${stateText}</span></div></div></td><td><div class="price">${price(w.price)}</div><div class="subline ${q.comparable ? (w.change >= 0 ? 'positive' : 'negative') : ''}">${q.comparable ? pct(w.change) + ' 较前 7 天' : q.reliable ? '前 7 天样本不足' : q.label}</div></td><td><div class="price">${price(q.month.price)}</div><div class="subline">7 天相对 30 天 ${pct(q.premium)}</div></td><td><div class="price">${price(q.peak)}</div><div class="subline">${q.peak == null ? '历史覆盖不足' : `当前周均 / 高位 ${number((w.price / q.peak) * 100, 1)}%`}</div></td><td><div class="volume-num">${m.stats?.end ? number(w.volume) : '—'}</div><div class="subline">${w.days} 天有记录${w.volume < 20 ? ' · 样本少' : ''}</div></td><td><div class="order-pair"><span class="price">${price(ask(m))}</span><span class="slash">/</span><span class="buy">${number(bid(m))}</span></div><div class="subline">${DeskCore.fresh(m.orders_at, m.orders_error) ? timeLabel(m.orders_at) : '挂单过期 / 缺失'}</div></td><td>${targetCell(x)}</td><td><button class="detail-btn" data-detail="${esc(x.slug)}" aria-label="查看 ${esc(x.name)} 卖出依据">看走势 ↗</button>${!watched(x) ? `<button class="watch-btn" data-watch="${esc(x.slug)}">＋ 关注</button>` : ''}</td></tr>`;
        })
        .join('') ||
      '<tr><td colspan="8" class="empty">没有匹配的战甲。未记录库存可先选“全部战甲”；旧行情不判断涨价与高位。</td></tr>';
  }
  return { controls, matches, compare, table, detail, targetCell };
})();
