'use strict';
(() => {
  let cached;
  let forceStateReload = false;
  async function get(name, cache = 'default') {
    const r = await fetch('data/' + name + '.json', { cache });
    if (!r.ok) throw new Error('公开行情快照读取失败 ' + r.status);
    const report = typeof window.__voidLedgerLoadProgress === 'function' && name === 'state';
    if (!report || !r.body?.getReader) return r.json();
    const reader = r.body.getReader(),
      decoder = new TextDecoder(),
      compressed = !!r.headers.get('content-encoding'),
      total = compressed ? 0 : Number(r.headers.get('content-length')) || 0;
    let loaded = 0,
      text = '';
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      loaded += part.value.byteLength;
      text += decoder.decode(part.value, { stream: true });
      window.__voidLedgerLoadProgress({ loaded, total });
    }
    text += decoder.decode();
    window.__voidLedgerLoadProgress({ loaded, total, phase: 'parsing' });
    await new Promise(resolve => setTimeout(resolve, 0));
    return JSON.parse(text);
  }
  window.Hosted = {
    async request(path, body) {
      if (body !== undefined)
        throw new Error('在线版读取 GitHub 定时发布的行情，不能启动实时查询。');
      if (path === '/api/state') {
        cached = await get('state', forceStateReload ? 'no-store' : 'default');
        forceStateReload = false;
        return structuredClone(cached);
      }
      if (path === '/api/ducat-market') return get('ducat-market');
      if (path === '/api/items') return get('items');
      if (path === '/api/relics') return get('relics');
      throw new Error('在线版不支持该接口');
    },
    async reload() {
      try {
        forceStateReload = true;
        const before = state?.server_time,
          previousRefresh = JSON.stringify(state?.refresh_status);
        await loadState();
        notify(
          before === state.server_time
            ? '已检查：当前是最新发布版本。商品报价年龄见页面状态。'
            : previousRefresh === JSON.stringify(state.refresh_status)
              ? '网页版本已更新，行情抓取时间未变。'
              : '已读取新发布的快照；各商品是否更新请看查询时间和数据状态。',
          true
        );
      } catch (e) {
        notify(e.message);
      }
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    const note = document.createElement('div');
    note.className = 'portable-banner';
    note.id = 'hosted-status';
    note.innerHTML =
      '在线行情 · 挂单每小时更新，成交统计 / 紫卡每 6 小时检查更新；GitHub 调度可能延迟或漏跑。刷新按钮只读取已发布快照，网页发布不代表行情更新。<br>库存仅由当前浏览器保存，不上传 GitHub，也不自动跨设备同步。可用“备份库存 / 导入库存”迁移。';
    document.querySelector('header').after(note);
    $('help-dialog').innerHTML =
      '<div class="dialog-heading"><h2>在线行情 · GitHub Pages</h2><button id="close-help" class="close-button" aria-label="关闭说明">×</button></div><p>无需启动本机服务。挂单每小时抓取；成交统计和紫卡每 6 小时检查更新，缺失或失败的统计会补查。GitHub 调度可能延迟或漏跑。推送代码只发布网页，会沿用行情缓存；网页发布时间与挂单抓取完成时间分别显示，各商品以自身查询时间为准。</p><p>刷新按钮只读取已发布快照，不会发起即时 WFM 查询。需要手动抓取时，打开下方任务页面，点击 Run workflow，默认 orders 只刷挂单，预计 9～11 分钟；full 更新全部数据，预计 22～25 分钟；publish 仅发布缓存。以上为估算，网络失败重试会延长时间。挂单完成就先发布，成交统计和紫卡更新后再补发，不必等整个任务结束才刷新本页。</p><p>包含 Prime 套装与散件、奸商 MOD 和可交易武器，以及遗物掉落的公开在线报价。0 洗紫卡热门候选较频繁刷新，其余武器分批轮询；未查询不等于低价。挂单不等于成交。</p><p>库存、目标、参考成本、交易记录和核桃组合由当前浏览器自动保存，不会上传，也不会自动跨设备同步。从本地版迁移：先点“备份库存”，再在本页点“导入库存”。导入会更新同名商品，其余当前记录保留。</p><p>需要逐项实时刷新时，请运行本地服务；本地版的“刷新库存行情”会直接查询 WFM，并显示进度。</p><p><a class="link" href="https://github.com/Vizards8/warframe-market-dashboard/actions/workflows/pages.yml" target="_blank" rel="noopener">更新记录 / 手动抓取 ↗</a></p>';
    $('close-help').onclick = () => $('help-dialog').close();
    document.querySelector('.brand').href = './';
  });
})();
