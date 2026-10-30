'use strict';
const MARKET_FRESH_MS = 2 * 3600000;
const STATS_FRESH_MS = 8 * 3600000;
const DeskCore = {
  fresh(at, error, now = Date.now()) {
    return (
      !!at &&
      !error &&
      Number.isFinite(Date.parse(at)) &&
      now >= Date.parse(at) &&
      now - Date.parse(at) < MARKET_FRESH_MS
    );
  },
  statsFresh(m, now = Date.now()) {
    const at = Date.parse(m?.stats_at),
      end = Date.parse(m?.stats?.end + 'T00:00:00Z') + 86400000;
    // Daily closed trades refresh every six hours, with two hours of grace.
    // A newly fetched response with an old or unfinished cutoff is still invalid.
    return (
      !m?.stats_error &&
      Number.isFinite(at) &&
      now >= at &&
      now - at < STATS_FRESH_MS &&
      Number.isFinite(end) &&
      now >= end &&
      now - end < 3 * 86400000
    );
  },
  target(m, basis = 'sell', now = Date.now()) {
    const source = basis === 'mean30' ? 'stats' : 'orders';
    const value =
      basis === 'mean30'
        ? MarketStats.window(m, 30).price
        : basis === 'buy'
          ? m?.orders?.buy?.[0]?.price
          : m?.orders?.sell?.[0]?.price;
    return {
      value: value ?? null,
      valid:
        (source === 'stats'
          ? this.statsFresh(m, now)
          : this.fresh(m?.orders_at, m?.orders_error, now)) && value != null,
      label:
        { sell: '在线最低卖价', buy: '在线最高买价', mean30: '30 天成交均价' }[basis] ||
        '在线最低卖价'
    };
  },
  // Shared by relic drops and screenshot rewards. Never label an order as a mean.
  rewardQuote(m, now = Date.now()) {
    const mean = this.target(m, 'mean30', now),
      ask = this.target(m, 'sell', now);
    const q = mean.valid
      ? { ...mean, basis: 'mean30', at: m.stats_at }
      : ask.valid
        ? { ...ask, basis: 'ask', at: m.orders_at }
        : mean.value != null
          ? { ...mean, basis: 'mean30', at: m?.stats_at }
          : { ...ask, basis: 'ask', at: m?.orders_at };
    return q;
  },
  frameSignal(m, now = Date.now()) {
    const week = MarketStats.window(m, 7),
      month = MarketStats.window(m, 30),
      history = MarketStats.history(m, 90),
      end = Date.parse(m?.stats?.end + 'T00:00:00Z'),
      previous = MarketStats.window(
        {
          stats: {
            ...m?.stats,
            end: new Date((Number.isFinite(end) ? end : 0) - 7 * 86400000)
              .toISOString()
              .slice(0, 10)
          }
        },
        7
      ),
      enough = x => x.price > 0 && x.days >= 4 && x.volume >= 20,
      fresh = this.statsFresh(m, now),
      recent =
        Number.isFinite(end) &&
        now - (end + 86400000) >= 0 &&
        now - (end + 86400000) < 3 * 86400000,
      reliable = fresh && recent && enough(week),
      comparable = reliable && enough(previous),
      premium = week.price != null && month.price > 0 ? (week.price / month.price - 1) * 100 : null;
    // Compare like with like: rolling weekly means, not a single day's outlier.
    const rolling = history
        .map(row => MarketStats.window({ stats: { history, end: row.date } }, 7))
        .filter(enough),
      peak =
        history.length >= 60 && rolling.length >= 30
          ? Math.max(...rolling.map(x => x.price))
          : null,
      rising = comparable && week.change >= 10,
      high = reliable && peak != null && week.price >= peak * 0.9,
      rank = !reliable ? -1 : rising && high ? 3 : rising ? 2 : high ? 1 : 0;
    return {
      week,
      month,
      previous,
      premium,
      peak,
      rising,
      high,
      reliable,
      comparable,
      rank,
      label: !fresh
        ? '行情过期 / 缺失'
        : !recent
          ? '近期成交缺失'
          : !enough(week)
            ? '近 7 天样本少'
            : rising && high
              ? '涨价且接近高位'
              : rising
                ? '近期涨价'
                : high
                  ? '接近 90 天高位'
                  : '暂无明显信号'
    };
  },
  manualCurrent(at, now = Date.now()) {
    const n = Date.parse(at);
    return Number.isFinite(n) && now >= n && now - n < 48 * 3600000;
  },
  depth(rows, quantity) {
    let left = quantity,
      value = 0,
      covered = 0;
    for (const r of rows || []) {
      const n = Math.min(left, r.quantity);
      value += n * r.price;
      covered += n;
      left -= n;
      if (left <= 0) break;
    }
    return { value, covered, left };
  },
  available(s) {
    return Math.max(0, (s?.quantity || 0) - (s?.reserve || 0));
  },
  sets(recipe, items) {
    return Math.min(
      ...recipe.parts.map(p => Math.floor(this.available(items[p.slug]) / p.quantity))
    );
  },
  ledger(entries) {
    let realized = 0,
      unknown = 0;
    const lots = {};
    const sold = new Map();
    for (const e of entries) {
      const list = lots[e.slug] || (lots[e.slug] = []);
      if (e.type === 'buy' || e.type === 'opening')
        list.push({ quantity: e.quantity, price: e.price, date: e.date });
      if (e.type === 'adjust') {
        if (e.quantity > 0) list.push({ quantity: e.quantity, price: null, date: e.date });
        else {
          let n = -e.quantity;
          while (n > 0 && list.length) {
            const used = Math.min(n, list[0].quantity);
            list[0].quantity -= used;
            n -= used;
            if (!list[0].quantity) list.shift();
          }
        }
      }
      if (e.type === 'sell') {
        let left = e.quantity,
          cost = 0,
          known = true;
        while (left > 0 && list.length) {
          const lot = list[0],
            n = Math.min(left, lot.quantity);
          if (lot.price == null) known = false;
          else cost += n * lot.price;
          left -= n;
          lot.quantity -= n;
          if (!lot.quantity) list.shift();
        }
        if (left) known = false;
        if (known) realized += e.quantity * e.price - cost;
        else unknown += e.quantity;
        sold.set(e.id, { known, cost: known ? cost : null, revenue: e.quantity * e.price });
      }
    }
    const holdingCosts = {};
    for (const [slug, list] of Object.entries(lots)) {
      const q = list.reduce((n, l) => n + l.quantity, 0);
      holdingCosts[slug] =
        q && list.every(l => l.price != null)
          ? list.reduce((n, l) => n + l.quantity * l.price, 0) / q
          : null;
    }
    let remaining = 0,
      unpriced = 0;
    for (const l of Object.values(lots).flat())
      if (l.price == null) unpriced += l.quantity;
      else remaining += l.quantity * l.price;
    return { realized, unknown, remaining, unpriced, sold, holdingCosts };
  },
  baro(snapshot, now = Date.now()) {
    const a = Date.parse(snapshot?.activation),
      e = Date.parse(snapshot?.expiry);
    // The activation/expiry window is authoritative for whether this visit is
    // current.  A GitHub Pages snapshot can be older than the six-hour market
    // refresh window while the same Baro visit is still active; hiding the
    // entire inventory in that case made the current tab look empty.
    if (!Number.isFinite(a) || !Number.isFinite(e)) return 'unknown';
    return now < a ? 'upcoming' : now < e ? 'active' : 'departed';
  },
  baroValue(item, market, settings = {}, now = Date.now(), event = {}) {
    const month = MarketStats.window(market, 30),
      week = MarketStats.window(market, 7),
      statsValid = this.statsFresh(market, now);
    // This is a historical resale scenario, not a forecast or an immediately executable price.
    const history =
      month.price != null && week.price != null ? Math.min(month.price, week.price) : null;
    const current = market?.orders?.sell?.[0]?.price ?? null;
    const valid =
      this.statsFresh(market, now) && this.fresh(market?.orders_at, market?.orders_error, now);
    const efficiency = history != null && item.ducats > 0 ? (history / item.ducats) * 100 : null;
    const currentEfficiency =
      current != null && item.ducats > 0 ? (current / item.ducats) * 100 : null;
    const net =
      history != null &&
      item.ducats != null &&
      item.credits != null &&
      settings.ducatCost != null &&
      settings.creditCost != null
        ? history -
          (item.ducats / 100) * settings.ducatCost -
          (item.credits / 1e6) * settings.creditCost
        : null;
    const rows = MarketStats.history(market, 90),
      day = 86400000,
      dateOnly = value => {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
      },
      activation = dateOnly(event.activation),
      expiry = dateOnly(event.expiry),
      eventDates = new Set();
    if (activation && expiry) {
      for (
        let cursor = Date.parse(activation + 'T00:00:00Z');
        cursor < Date.parse(expiry + 'T00:00:00Z');
        cursor += day
      )
        eventDates.add(new Date(cursor).toISOString().slice(0, 10));
    }
    const normalRows = rows.filter(row => !eventDates.has(row.date)),
      aggregate = list => {
        const volume = list.reduce((sum, row) => sum + (Number(row.volume) || 0), 0);
        return {
          price: volume ? list.reduce((sum, row) => sum + row.price * row.volume, 0) / volume : null,
          volume,
          days: list.length
        };
      },
      rolling = list =>
        list
          .map(row => {
            const end = Date.parse(row.date + 'T00:00:00Z'),
              start = end - 6 * day,
              window = list.filter(x => {
                const at = Date.parse(x.date + 'T00:00:00Z');
                return at >= start && at <= end;
              });
            return { ...aggregate(window), date: row.date };
          })
          .filter(x => x.price != null && x.days >= 4 && x.volume >= 20),
      peaks = rolling(normalRows),
      peak90 = peaks.length ? Math.max(...peaks.map(x => x.price)) : null,
      before = activation
        ? normalRows.filter(row => row.date < activation).slice(-30)
        : normalRows.slice(-30),
      baseline = aggregate(before).price ?? peak90,
      target90 = baseline == null ? null : baseline * 0.9,
      eventEnd = expiry ? Date.parse(expiry + 'T00:00:00Z') : NaN,
      recoverySeries = Number.isFinite(eventEnd)
        ? rolling(normalRows.filter(row => Date.parse(row.date + 'T00:00:00Z') >= eventEnd))
        : [],
      recovery =
        target90 == null
          ? null
          : recoverySeries.find(x => x.price >= target90)?.date || null,
      recoveryDays =
        recovery && Number.isFinite(eventEnd)
          ? Math.round((Date.parse(recovery + 'T00:00:00Z') - eventEnd) / day)
          : null,
      first = rows.length ? Date.parse(rows[0].date + 'T00:00:00Z') : NaN,
      last = rows.length ? Date.parse(rows.at(-1).date + 'T00:00:00Z') : NaN,
      eventDaysInRange = [...eventDates].filter(date => {
        const at = Date.parse(date + 'T00:00:00Z');
        return Number.isFinite(first) && Number.isFinite(last) && at >= first && at <= last;
      }).length,
      observedDays =
        Number.isFinite(first) && Number.isFinite(last)
          ? Math.max(1, Math.round((last - first) / day) + 1 - eventDaysInRange)
          : 0,
      normalVolume = normalRows.reduce((sum, row) => sum + (Number(row.volume) || 0), 0),
      dailyVolume = observedDays ? normalVolume / observedDays : null,
      highEfficiency = target90 != null && item.ducats > 0 ? (target90 / item.ducats) * 100 : null,
      highNet =
        target90 != null &&
        item.ducats != null &&
        item.credits != null &&
        settings.ducatCost != null &&
        settings.creditCost != null
          ? target90 -
            (item.ducats / 100) * settings.ducatCost -
            (item.credits / 1e6) * settings.creditCost
          : null,
      decision = (() => {
        if (!statsValid)
          return { label: '数据待更新', tone: 'muted', reason: '成交统计已过期或获取失败' };
        if (target90 == null || highEfficiency == null || dailyVolume == null)
          return { label: '数据不足', tone: 'muted', reason: '缺少历史价格或成交量' };
        if (recoveryDays == null)
          return {
            label: '等待返场后判断',
            tone: 'muted',
            reason: '返场后的恢复天数还没有足够记录'
          };
        const priceScore = highEfficiency >= 8 ? 2 : highEfficiency >= 5 ? 1 : 0,
          timeScore = recoveryDays <= 14 ? 2 : recoveryDays <= 30 ? 1 : 0,
          volumeScore = dailyVolume >= 5 ? 2 : dailyVolume >= 1 ? 1 : 0,
          score = priceScore + timeScore + volumeScore;
        return score >= 5
          ? { label: '优先考虑', tone: 'good', reason: '回款、恢复速度和成交量都较好' }
          : score >= 3
            ? { label: '可以考虑', tone: 'mid', reason: '三项指标中有一项偏弱' }
            : { label: '暂缓', tone: 'bad', reason: '回款、恢复速度或成交量偏弱' };
      })();
    return {
      history,
      current,
      efficiency,
      currentEfficiency,
      net,
      volume: month.volume,
      weekVolume: week.volume,
      baseline,
      target90,
      peak90,
      highEfficiency,
      highNet,
      recoveryDays,
      dailyVolume,
      normalVolume,
      statsValid,
      eventActive:
        Number.isFinite(Date.parse(event.activation)) &&
        Number.isFinite(Date.parse(event.expiry)) &&
        now >= Date.parse(event.activation) &&
        now < Date.parse(event.expiry),
      decision,
      valid,
      eligible: valid && efficiency != null && month.volume >= 30 && week.volume >= 5
    };
  },
  liquidity(m, now = Date.now()) {
    const known = !!m?.stats?.end,
      week = MarketStats.window(m, 7),
      month = MarketStats.window(m, 30);
    const valid = known && this.statsFresh(m, now);
    const tier = !valid ? -1 : week.volume >= 70 ? 2 : week.volume >= 14 ? 1 : 0;
    return {
      week: known ? week.volume : null,
      month: known ? month.volume : null,
      daily: known ? week.volume / 7 : null,
      valid,
      tier,
      label: !valid
        ? '成交数据待更新'
        : tier === 2
          ? '近期活跃'
          : tier === 1
            ? '成交一般'
            : '成交偏少'
    };
  },
  ducatPart(item, m, holding = {}, mode = 'market', now = Date.now()) {
    const eligible =
      item?.kind === 'component' &&
      item.ducats > 0 &&
      item.tags?.includes('prime') &&
      !item.tags.includes('set');
    const summary = MarketStats.window(m, 30),
      price = summary.price;
    const valid = eligible && Number.isFinite(price) && price > 0 && this.statsFresh(m, now);
    return {
      eligible,
      valid,
      price,
      per100: price > 0 && eligible ? (price / item.ducats) * 100 : null,
      volume: m?.stats?.end ? summary.volume : null,
      available: this.available(holding),
      depth: (m?.orders?.[mode === 'owned' ? 'buy' : 'sell'] || []).reduce(
        (n, r) => n + r.quantity,
        0
      )
    };
  },
  // The public collector records WFM's status on each identified seller.
  // Anonymous or stale orders cannot be used for a purchase recommendation.
  activeSellOffer(offer) {
    return offer?.status === 'online' || offer?.status === 'ingame';
  },
  ducatLot(item, m, slots = 1, now = Date.now(), minYield = 150) {
    if (
      !(item?.ducats > 0) ||
      !Number.isInteger(slots) ||
      slots < 1 ||
      slots > 6 ||
      !Number.isFinite(minYield) ||
      minYield < 0
    )
      return null;
    const capacity = Math.floor(6 / slots),
      offers = m?.orders?.sell_offers || [];
    if (!this.fresh(m?.orders_at, m?.orders_error, now)) return null;
    const seen = new Set();
    const lots = offers
      .filter(o => {
        if (
          !o.seller ||
          !this.activeSellOffer(o) ||
          seen.has(o.seller) ||
          !Number.isFinite(o.price) ||
          o.price <= 0 ||
          !Number.isInteger(o.quantity) ||
          o.quantity < 1
        )
          return false;
        seen.add(o.seller);
        return true;
      })
      .map(offer => {
        const units = Math.min(capacity, offer.quantity),
          ducats = units * item.ducats,
          cost = units * offer.price;
        return {
          offer,
          units,
          slots: units * slots,
          ducats,
          cost,
          per100: (cost / ducats) * 100,
          stock: offer.quantity
        };
      })
      .filter(lot => lot.ducats >= minYield);
    lots.sort((a, b) => a.per100 - b.per100 || b.ducats - a.ducats || b.stock - a.stock);
    return lots[0] || null;
  },
  ducatTrashReference() {
    const tiers = [
      { name: '铜垃圾', ducats: 15, price: 1 },
      { name: '银垃圾', ducats: 45, price: 3 },
      { name: '金垃圾', ducats: 100, price: 10 }
    ].map(x => ({ ...x, per100: (x.price / x.ducats) * 100 }));
    return {
      tiers,
      lowest: Math.min(...tiers.map(x => x.per100)),
      highest: Math.max(...tiers.map(x => x.per100))
    };
  },
  ducatBundles(rows, slots = 6, minYield = 150, now = Date.now()) {
    if (
      !Array.isArray(rows) ||
      !Number.isInteger(slots) ||
      slots < 1 ||
      slots > 6 ||
      !Number.isFinite(minYield) ||
      minYield < 0
    )
      return [];
    const sellers = new Map();
    for (const row of rows) {
      if (
        !(row?.ducats > 0) ||
        !Number.isInteger(row.slots) ||
        row.slots < 1 ||
        row.slots > slots ||
        !this.fresh(row.market?.orders_at, row.market?.orders_error, now)
      )
        continue;
      for (const offer of row.market?.orders?.sell_offers || []) {
        if (
          !offer?.seller ||
          !this.activeSellOffer(offer) ||
          !Number.isFinite(offer.price) ||
          offer.price <= 0 ||
          !Number.isInteger(offer.quantity) ||
          offer.quantity < 1
        )
          continue;
        const seller = sellers.get(offer.seller) || {
          seller: offer.seller,
          name: offer.name || offer.slug || offer.seller,
          slug: offer.slug,
          status: offer.status,
          items: new Map()
        };
        const old = seller.items.get(row.slug);
        if (!old || offer.price < old.offer.price) seller.items.set(row.slug, { row, offer });
        sellers.set(offer.seller, seller);
      }
    }
    const compare = (a, b) =>
      a.cost * b.ducats - b.cost * a.ducats || b.ducats - a.ducats || b.slots - a.slots;
    const trash = this.ducatTrashReference();
    const keep = (list, candidate) => {
      const dominates = (a, b) => a.cost <= b.cost && a.ducats >= b.ducats;
      if (list.some(x => dominates(x, candidate))) return;
      list.splice(0, list.length, ...list.filter(x => !dominates(candidate, x)), candidate);
    };
    const output = [];
    for (const seller of sellers.values()) {
      const choices = [...seller.items.values()];
      const parent = choices.map((_, i) => i);
      const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const union = (a, b) => {
        const ra = find(a),
          rb = find(b);
        if (ra !== rb) parent[rb] = ra;
      };
      const conflicts = (a, b) => {
        const ap = a.recipe?.parts || [],
          bp = b.recipe?.parts || [];
        return (
          ap.some(p => p.slug === b.slug) ||
          bp.some(p => p.slug === a.slug) ||
          ap.some(p => bp.some(q => p.slug === q.slug))
        );
      };
      for (let i = 0; i < choices.length; i++)
        for (let j = i + 1; j < choices.length; j++)
          if (conflicts(choices[i].row, choices[j].row)) union(i, j);
      const groups = new Map();
      choices.forEach((choice, i) => {
        const key = find(i);
        groups.set(key, [...(groups.get(key) || []), choice]);
      });
      let states = Array.from({ length: slots + 1 }, () => []);
      states[0] = [{ slots: 0, cost: 0, ducats: 0, entries: [] }];
      for (const group of groups.values()) {
        // Enumerate compatible purchases within each related set/component group.
        // Distinct components may coexist even when they both overlap one set listing.
        const options = Array.from({ length: slots + 1 }, () => []);
        const visit = (start, purchase, chosen) => {
          keep(options[purchase.slots], purchase);
          for (let i = start; i < group.length; i++) {
            const { row, offer } = group[i];
            if (chosen.some(other => conflicts(row, other))) continue;
            const max = Math.min(offer.quantity, Math.floor((slots - purchase.slots) / row.slots));
            for (let units = 1; units <= max; units++) {
              const entry = {
                slug: row.slug,
                name: row.name,
                units,
                slots: units * row.slots,
                ducats: units * row.ducats,
                cost: units * offer.price,
                price: offer.price,
                isSet: !!row.isSet,
                at: row.market.orders_at,
                createdAt: offer.createdAt,
                updatedAt: offer.updatedAt
              };
              visit(
                i + 1,
                {
                  slots: purchase.slots + entry.slots,
                  cost: purchase.cost + entry.cost,
                  ducats: purchase.ducats + entry.ducats,
                  entries: [...purchase.entries, entry]
                },
                [...chosen, row]
              );
            }
          }
        };
        visit(0, { slots: 0, cost: 0, ducats: 0, entries: [] }, []);
        const next = Array.from({ length: slots + 1 }, () => []);
        for (let used = 0; used <= slots; used++) {
          for (const state of states[used]) {
            for (let added = 0; added <= slots - used; added++) {
              for (const option of options[added]) {
                keep(next[used + added], {
                  slots: used + added,
                  cost: state.cost + option.cost,
                  ducats: state.ducats + option.ducats,
                  entries: [...state.entries, ...option.entries]
                });
              }
            }
          }
        }
        states = next;
      }
      const bundles = states
        .flat()
        .filter(x => x.ducats > 0 && x.ducats >= minYield)
        .map(x => ({
          ...x,
          seller: seller.seller,
          sellerName: seller.name,
          sellerSlug: seller.slug,
          sellerStatus: seller.status,
          per100: (x.cost / x.ducats) * 100,
          trashGap: trash.lowest - (x.cost / x.ducats) * 100
        }));
      if (bundles.length) {
        bundles.sort(compare);
        output.push(bundles[0]);
      }
    }
    output.sort(compare);
    return output;
  },
  ducatSet(recipe, catalog) {
    const index = new Map(catalog.map(x => [x.slug, x]));
    let ducats = 0,
      slots = 0;
    for (const part of recipe?.parts || []) {
      const x = index.get(part.slug);
      if (
        !x ||
        !this.ducatPart(x, {}).eligible ||
        !Number.isInteger(part.quantity) ||
        part.quantity < 1
      )
        return null;
      ducats += x.ducats * part.quantity;
      slots += part.quantity;
    }
    if (!slots || slots > 6 || ducats !== recipe.ducats || slots !== recipe.slots) return null;
    return { ducats, slots };
  },
  purchaseWhisper(purchases, now = Date.now()) {
    if (!Array.isArray(purchases) || !purchases.length) return null;
    const first = purchases[0]?.offer;
    // The profile slug may differ from the in-game name used by /w.
    if (!first?.seller || !/^[\p{L}\p{N}_.-]+$/u.test(first.name || '')) return null;
    let total = 0;
    const labels = [],
      seen = new Set();
    for (const p of purchases) {
      const { item, offer, quantity, at, error } = p || {};
      if (
        !item?.slug ||
        seen.has(item.slug) ||
        typeof item.english !== 'string' ||
        !item.english.trim() ||
        /["\x00-\x1f\x7f]/.test(item.english) ||
        !offer ||
        offer.seller !== first.seller ||
        offer.name !== first.name ||
        !Number.isInteger(offer.price) ||
        offer.price <= 0 ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        !Number.isInteger(offer.quantity) ||
        quantity > offer.quantity ||
        (offer.rank != null && offer.rank !== 0) ||
        !this.fresh(at, error, now)
      )
        return null;
      seen.add(item.slug);
      total += offer.price * quantity;
      const name = item.english.trim() + (item.kind === 'mod' ? ' (rank 0)' : '');
      labels.push(
        `${quantity > 1 ? quantity + ' x ' : ''}"${name}"${purchases.length > 1 ? ` (${offer.price} platinum each)` : ''}`
      );
    }
    if (!Number.isSafeInteger(total)) return null;
    return `/w ${first.name} Hi! I want to buy: ${labels.join(', ')} for ${total} platinum${purchases.length > 1 ? ' total' : ''}. (warframe.market)`;
  },
  ducatCycle(
    part,
    partMarket,
    target,
    targetMarket,
    copies = 1,
    manualPrice = null,
    creditCost = null,
    now = Date.now(),
    purchase = null
  ) {
    if (
      !(part?.ducats > 0) ||
      !(target?.ducats > 0) ||
      !Number.isInteger(copies) ||
      copies < 1 ||
      !Number.isFinite(target.credits) ||
      target.credits < 0
    )
      return null;
    const needed = target.ducats * copies,
      batch = purchase?.units || 1,
      parts = Math.ceil(needed / part.ducats / batch) * batch,
      remainder = parts * part.ducats - needed;
    const manual = Number.isFinite(manualPrice) && manualPrice > 0;
    const seller = purchase?.offer,
      stock = seller
        ? [{ price: seller.price, quantity: seller.quantity }]
        : purchase
          ? []
          : partMarket?.orders?.sell;
    const buyDepth = this.depth(stock, parts),
      sellDepth = this.depth(targetMarket?.orders?.buy, copies);
    const trades = purchase ? Math.ceil(parts / batch) : null;
    const buyValid =
      manual ||
      (this.fresh(partMarket?.orders_at, partMarket?.orders_error, now) && buyDepth.left === 0);
    const cost = buyValid ? (manual ? manualPrice * parts : buyDepth.value) : null;
    const sellValid =
      this.fresh(targetMarket?.orders_at, targetMarket?.orders_error, now) && sellDepth.left === 0;
    const history = this.baroValue(target, targetMarket, {}, now).history;
    const historyValid = this.statsFresh(targetMarket, now) && history != null;
    const credits = target.credits * copies,
      creditP =
        Number.isFinite(creditCost) && creditCost >= 0 ? (credits / 1e6) * creditCost : null;
    const immediate = sellValid ? sellDepth.value : null,
      historical = historyValid ? history * copies : null;
    return {
      parts,
      remainder,
      needed,
      credits,
      creditP,
      cost,
      manual,
      trades,
      buyCovered: buyDepth.covered,
      sellCovered: sellDepth.covered,
      immediate,
      historical,
      immediateGap: cost != null && immediate != null ? immediate - cost : null,
      historicalGap: cost != null && historical != null ? historical - cost : null,
      immediateNet:
        cost != null && immediate != null && creditP != null ? immediate - cost - creditP : null,
      historicalNet:
        cost != null && historical != null && creditP != null ? historical - cost - creditP : null
    };
  },
  budget(rows, plan) {
    let ducats = 0,
      credits = 0,
      incomplete = 0;
    for (const r of rows) {
      const q = plan[r.slug] || 0;
      if (!q) continue;
      if (r.ducats == null || r.credits == null) incomplete += q;
      if (r.ducats != null) ducats += q * r.ducats;
      if (r.credits != null) credits += q * r.credits;
    }
    return { ducats, credits, incomplete };
  },
  backup(raw, catalog) {
    if (
      ![1, 2].includes(raw?.version) ||
      !raw.items ||
      typeof raw.items !== 'object' ||
      Array.isArray(raw.items)
    )
      throw new Error('不是有效的库存备份');
    const allowed = new Set(catalog.map(x => x.slug)),
      items = {},
      out = {};
    const finite = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
    for (const [slug, s] of Object.entries(raw.items)) {
      if (!allowed.has(slug)) throw new Error('目录外商品：' + slug);
      if (!s || !Number.isInteger(s.quantity) || !finite(s.quantity, 100000))
        throw new Error('持有数量不正确');
      for (const k of ['target', 'cost'])
        if (s[k] != null && !finite(s[k], 1000000)) throw new Error('价格不正确');
      if (s.reserve != null && (!Number.isInteger(s.reserve) || !finite(s.reserve, s.quantity)))
        throw new Error('保留数量不正确');
      items[slug] = {
        quantity: s.quantity,
        reserve: s.reserve || 0,
        target: s.target ?? null,
        cost: s.cost ?? null,
        watch: !!s.watch,
        note: String(s.note || '').slice(0, 1000)
      };
      if (/^\d{4}-\d{2}-\d{2}$/.test(s.baro_date || '')) items[slug].baro_date = s.baro_date;
    }
    if (raw.transactions != null) {
      if (!Array.isArray(raw.transactions) || raw.transactions.length > 50000)
        throw new Error('交易记录格式不正确');
      out.transactions = raw.transactions.map(e => {
        if (
          !Object.hasOwn(items, e.slug) ||
          !['buy', 'sell', 'opening', 'adjust'].includes(e.type) ||
          !Number.isInteger(e.quantity) ||
          Math.abs(e.quantity) > 100000 ||
          e.quantity === 0 ||
          (e.type !== 'adjust' && e.quantity < 0) ||
          (e.type === 'sell' && e.price == null) ||
          (e.price != null && !finite(e.price, 1000000)) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(e.date) ||
          typeof e.id !== 'string'
        )
          throw new Error('交易记录内容不正确');
        return {
          id: e.id.slice(0, 100),
          slug: e.slug,
          type: e.type,
          quantity: e.quantity,
          price: e.price ?? null,
          date: e.date,
          note: String(e.note || '').slice(0, 1000)
        };
      });
      if (new Set(out.transactions.map(x => x.id)).size !== out.transactions.length)
        throw new Error('交易记录 ID 重复');
    }
    if (out.transactions) {
      const balances = {};
      for (const e of out.transactions) {
        balances[e.slug] = (balances[e.slug] || 0) + (e.type === 'sell' ? -e.quantity : e.quantity);
        if (balances[e.slug] < 0) throw new Error('交易记录数量不足');
      }
      for (const [slug, q] of Object.entries(balances))
        if (q !== items[slug].quantity) throw new Error('交易记录与库存数量不一致');
    }
    if (raw.baroConfirmedAt && typeof raw.baroConfirmedAt === 'object')
      out.baroConfirmedAt = Object.fromEntries(
        Object.entries(raw.baroConfirmedAt).filter(
          ([k, v]) => allowed.has(k) && typeof v === 'string' && Number.isFinite(Date.parse(v))
        )
      );
    if (typeof raw.startInDesk === 'boolean') out.startInDesk = raw.startInDesk;
    if (['sell', 'buy', 'mean30'].includes(raw.targetBasis)) out.targetBasis = raw.targetBasis;
    if ([7, 30, 90].includes(raw.statsWindow)) out.statsWindow = raw.statsWindow;
    if (Array.isArray(raw.farmRuns))
      out.farmRuns = raw.farmRuns
        .filter(
          x =>
            typeof x.name === 'string' &&
            finite(x.minutes, 10000) &&
            x.minutes > 0 &&
            ['quoted', 'sold', 'cost'].every(k => finite(x[k], 1000000))
        )
        .slice(-5000)
        .map(x => ({
          ...x,
          name: x.name.slice(0, 80),
          note: String(x.note || '').slice(0, 300),
          date: String(x.date || '').slice(0, 10)
        }));
    const relicChoice = x =>
      x === null
        ? null
        : x &&
            typeof x.id === 'string' &&
            /^[a-z]+_[a-z][0-9]+$/.test(x.id) &&
            ['intact', 'exceptional', 'flawless', 'radiant'].includes(x.grade)
          ? { id: x.id, grade: x.grade }
          : null;
    if (Array.isArray(raw.relics) && raw.relics.length === 4)
      out.relics = raw.relics.map(relicChoice);
    if (['price', 'rarity'].includes(raw.relicSort)) out.relicSort = raw.relicSort;
    if (Array.isArray(raw.relicPresets))
      out.relicPresets = raw.relicPresets
        .filter(p => typeof p.name === 'string' && Array.isArray(p.relics) && p.relics.length === 4)
        .slice(0, 12)
        .map(p => ({ name: p.name.slice(0, 40), relics: p.relics.map(relicChoice) }));
    for (const key of ['ducatCost', 'creditCost'])
      if (raw[key] == null || finite(raw[key], 1000000)) out[key] = raw[key] ?? null;
    if (Array.isArray(raw.baroBasket)) out.baroBasket = raw.baroBasket.filter(k => allowed.has(k));
    if (raw.baroPlan && typeof raw.baroPlan === 'object')
      out.baroPlan = Object.fromEntries(
        Object.entries(raw.baroPlan).filter(
          ([k, v]) => allowed.has(k) && Number.isInteger(v) && finite(v, 100000)
        )
      );
    if (raw.baroBudget && typeof raw.baroBudget === 'object')
      out.baroBudget = Object.fromEntries(
        Object.entries(raw.baroBudget).filter(
          ([k, v]) => ['ducats', 'credits'].includes(k) && finite(v, 1000000000000)
        )
      );
    if (raw.baroCosts && typeof raw.baroCosts === 'object')
      out.baroCosts = Object.fromEntries(
        Object.entries(raw.baroCosts)
          .filter(([k, v]) => allowed.has(k) && v && typeof v === 'object')
          .map(([k, v]) => [
            k,
            Object.fromEntries(
              Object.entries(v).filter(
                ([k, n]) => ['ducats', 'credits'].includes(k) && finite(n, 1000000000)
              )
            )
          ])
      );
    return { items, ...out };
  }
};
if (typeof module !== 'undefined') module.exports = DeskCore;
