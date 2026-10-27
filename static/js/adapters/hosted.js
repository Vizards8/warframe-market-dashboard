'use strict';
(() => {
  let cached;
  async function get(name) {
    const r = await fetch('data/' + name + '.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('公开行情快照读取失败 ' + r.status);
    return r.json();
  }
  window.Hosted = {
    async request(path, body) {
      if (body !== undefined)
        throw new Error('在线版读取 GitHub 定时发布的行情，不能启动实时查询。');
      if (path === '/api/state') {
        cached = await get('state');
        return structuredClone(cached);
      }
      if (path === '/api/items') return get('items');
      if (path === '/api/relics') return get('relics');
      throw new Error('在线版不支持该接口');
    },
    async reload() {
      try {
        const before = state?.server_time;
        await loadState();
        notify(
          before === state.server_time
            ? '已检查：当前是最新发布版本。商品报价年龄见页面状态。'
            : '已获取最新发布行情。',
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
      '在线行情 · 通常每小时自动更新。刷新按钮获取已发布的版本，商品显示各自查询时间。<br>库存仅由当前浏览器保存，不上传 GitHub，也不自动跨设备同步。可用“备份库存 / 导入库存”迁移。';
    document.querySelector('header').after(note);
    $('help-dialog').innerHTML =
      '<div class="dialog-heading"><h2>在线行情 · GitHub Pages</h2><button id="close-help" class="close-button" aria-label="关闭说明">×</button></div><p>无需启动本机服务。GitHub Actions 通常每小时刷新公共行情并重新发布；刷新按钮只读取最近已发布的版本，不会发起即时 WFM 查询。GitHub 调度可能延迟或暂停，请以每个商品的查询时间为准。</p><p>包含 Prime 套装与散件、奸商 MOD 和可交易武器，以及遗物掉落的公开在线报价。0 洗紫卡热门候选较频繁刷新，其余武器分批轮询；未查询不等于低价。挂单不等于成交。</p><p>库存、目标、参考成本、交易记录和核桃组合由当前浏览器自动保存，不会上传，也不会自动跨设备同步。从本地版迁移：先点“备份库存”，再在本页点“导入库存”。导入会更新同名商品，其余当前记录保留。</p><p>需要逐项实时刷新时，请运行本地服务；本地版的“刷新库存行情”会直接查询 WFM，并显示进度。</p><p><a class="link" href="https://github.com/Vizards8/warframe-market-dashboard/actions" target="_blank" rel="noopener">查看自动更新状态 ↗</a></p>';
    $('close-help').onclick = () => $('help-dialog').close();
    document.querySelector('.brand').href = './';
  });
})();
