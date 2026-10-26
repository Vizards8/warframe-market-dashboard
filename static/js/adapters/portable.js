'use strict';
(() => {
  const marker = '__VOID_LEDGER_SNAPSHOT__';
  const safe = value =>
    JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  async function download(blank) {
    try {
      let p;
      if (window.Portable) {
        p = { ...window.Portable };
        delete p.request;
      } else {
        const r = await fetch('/portable.html');
        if (!r.ok) throw new Error('生成快照失败');
        const html = await r.text();
        p = JSON.parse(
          new DOMParser().parseFromString(html, 'text/html').getElementById('portable-data')
            .textContent
        );
      }
      p.id = crypto.randomUUID?.() || String(Date.now());
      p.exported = new Date().toISOString();
      p.state.initial_settings = blank
        ? {
            version: 2,
            items: {},
            relics: [null, null, null, null],
            relicSort: 'price',
            statsWindow: 30
          }
        : structuredClone(settings);
      const html = p.shell.replace(marker, safe(p)),
        blob = new Blob([html], { type: 'text/html;charset=utf-8' }),
        a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = blank ? '虚空账本-分享版.html' : '虚空账本-我的库存.html';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      notify(
        blank
          ? '已下载空白分享版，不含你的持仓、目标和遗物选择。'
          : '已下载当前库存与行情快照；换电脑时直接打开这份 HTML。',
        true
      );
    } catch (error) {
      notify('下载失败：' + error.message);
    }
  }
  $('portable-export').onclick = () => download(false);
  $('portable-share').onclick = () => download(true);
  if (window.Portable) {
    const banner = document.createElement('div');
    banner.className = 'portable-banner';
    banner.textContent = `便携快照 · 导出于 ${new Date(window.Portable.exported).toLocaleString('zh-CN')}。行情截止时间请看各商品；本文件不自动刷新。库存可编辑，换电脑前再次下载当前 HTML。图片需联网。`;
    document.querySelector('header').after(banner);
    document.querySelector('.brand').href = '#';
  }
})();
