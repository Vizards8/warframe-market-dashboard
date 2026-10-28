'use strict';
(() => {
  let built = false,
    rows = [],
    candidateRows = [],
    results = [],
    imageSource = null,
    worker = null,
    workerLanguage = '',
    busy = false;
  let capture = null,
    video = null,
    generation = 0,
    pip = null,
    resultAt = null,
    disposed = false,
    requesting = false;
  let loading = null,
    detectedLayout = null,
    pipExpanded = false;
  const byId = id => document.getElementById(id),
    core = RewardOcrCore;
  const assets = new URL(
    'ocr/v5/',
    window.Portable
      ? 'https://vizards8.github.io/warframe-market-dashboard/'
      : document.baseURI || location.href
  ).href;
  const status = text => {
    if (built) {
      byId('ocr-status').textContent = text;
      byId('ocr-status').hidden = !text;
    }
  };
  function baseLayout(
    width = imageSource?.width || video?.videoWidth || 1920,
    height = imageSource?.height || video?.videoHeight || 1080
  ) {
    const count = Number(byId('ocr-count').value) || 4;
    if (byId('ocr-area-mode').value !== 'manual') {
      const scale = Number(byId('ocr-ui-scale').value || 100),
        offset = Number(byId('ocr-y-offset').value || 0);
      if (
        !Number.isFinite(scale) ||
        scale < 60 ||
        scale > 150 ||
        !Number.isFinite(offset) ||
        Math.abs(offset) > 15
      )
        throw new Error('卡位缩放范围为 60–150%，上下偏移范围为 -15–15%。');
      const v = core.rewardLayout(width, height, count, scale / 100, offset / 100);
      for (const n of ['left', 'top', 'right', 'bottom'])
        byId('ocr-' + n).value = (v[n] * 100).toFixed(1);
      return v;
    }
    const names = ['left', 'top', 'right', 'bottom'],
      v = Object.fromEntries(names.map(n => [n, Number(byId('ocr-' + n).value) / 100]));
    if (
      names.some(n => !Number.isFinite(v[n]) || v[n] < 0 || v[n] > 1) ||
      v.right - v.left < 0.05 ||
      v.bottom - v.top < 0.01
    )
      throw new Error('请调整识别区域，左右至少间隔 5%，上下至少间隔 1%。');
    return { ...v, count };
  }
  function layout() {
    return detectedLayout || baseLayout();
  }
  function detectLayout() {
    detectedLayout = null;
    if (!imageSource || byId('ocr-count').value !== 'auto') return;
    if (byId('ocr-text-style').value === 'light') return;
    const v = baseLayout(),
      w = imageSource.width,
      h = imageSource.height,
      c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * (v.right - v.left)));
    c.height = Math.max(1, Math.round(h * (v.bottom - v.top)));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(
      imageSource,
      w * v.left,
      h * v.top,
      w * (v.right - v.left),
      h * (v.bottom - v.top),
      0,
      0,
      c.width,
      c.height
    );
    const cell =
      byId('ocr-area-mode').value === 'manual'
        ? (Math.min(w, (h * 16) / 9) * 0.126 * Number(byId('ocr-ui-scale').value || 100)) / 100
        : c.width / 4;
    const found = core.detectCount(core.textMask(ctx.getImageData(0, 0, c.width, c.height)), cell);
    if (found)
      detectedLayout = {
        ...v,
        count: found.count,
        left: v.left + (v.right - v.left) * found.left,
        right: v.left + (v.right - v.left) * found.right
      };
  }
  function countHint() {
    return byId('ocr-count').value === 'auto'
      ? detectedLayout
        ? `自动检测到 ${detectedLayout.count} 个奖励`
        : '奖励数未确定；请检查区域或手动选择奖励数'
      : `手动 ${byId('ocr-count').value} 个奖励`;
  }
  function captureInfo() {
    const node = byId('ocr-capture-info');
    if (!node) return;
    const track = capture?.getVideoTracks()[0],
      settings = track?.getSettings?.() || {};
    node.hidden = !capture;
    if (!capture) {
      node.textContent = '';
      return;
    }
    const surface =
      { monitor: '整个屏幕', window: '窗口', browser: '浏览器标签页' }[settings.displaySurface] ||
      '共享画面';
    const size = imageSource
      ? `${imageSource.width} × ${imageSource.height}`
      : settings.width && settings.height
        ? `${settings.width} × ${settings.height}`
        : '等待取帧';
    node.textContent = `${surface} · ${imageSource ? '本次识别画面' : '共享流'} ${size}`;
  }
  function syncControls() {
    if (!built) return;
    captureInfo();
    byId('ocr-run').disabled = busy || (!capture && !imageSource);
    byId('ocr-run').textContent = busy ? '识别中…' : '识别一次';
    renderPip();
    byId('ocr-file').disabled = busy || !!capture;
    byId('ocr-share').disabled = busy || !!capture || requesting;
    byId('ocr-share').hidden = !!capture;
    byId('ocr-stop').hidden = !capture && !busy;
    byId('ocr-stop').textContent = capture ? '停止共享' : '取消识别';
    byId('ocr-match-text').disabled = busy || !!capture;
    for (const name of [
      'left',
      'right',
      'top',
      'bottom',
      'count',
      'language',
      'area-mode',
      'source',
      'text-style',
      'ui-scale',
      'y-offset'
    ])
      byId('ocr-' + name).disabled = busy;
    byId('ocr-prepare').disabled = busy;
  }
  function candidateStatus() {
    if (!candidateRows.length) return '匹配全部奖励，无需先填遗物。';
    return `已填遗物含 ${candidateRows.length} 种掉落，仅作核对；匹配仍使用全部奖励。`;
  }
  function renderCandidateStatus() {
    const node = byId('ocr-candidate-status');
    if (node) node.textContent = candidateStatus();
  }
  function preview() {
    if (!imageSource) return;
    const c = byId('ocr-preview'),
      ctx = c.getContext('2d'),
      w = imageSource.width,
      h = imageSource.height;
    byId('ocr-frame-info').textContent =
      `实际画面 ${w} × ${h} · ${capture ? '屏幕共享' : '导入截图'} · ${countHint()} · ${byId('ocr-area-mode').value === 'manual' ? '手动区域' : '卡位缩放 ' + (byId('ocr-ui-scale').value || 100) + '%'}。绿色框内应各有一个完整奖励名；全黑、空白或名称被截断时，请先调整区域。`;
    c.width = Math.min(w, 1100);
    c.height = Math.round((h * c.width) / w);
    ctx.drawImage(imageSource, 0, 0, c.width, c.height);
    const v = layout();
    ctx.fillStyle = '#0008';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(
      imageSource,
      w * v.left,
      h * v.top,
      w * (v.right - v.left),
      h * (v.bottom - v.top),
      c.width * v.left,
      c.height * v.top,
      c.width * (v.right - v.left),
      c.height * (v.bottom - v.top)
    );
    ctx.strokeStyle = '#77f1bc';
    ctx.lineWidth = 2;
    ctx.font = 'bold 18px sans-serif';
    for (let i = 0; i < v.count; i++) {
      const x = c.width * (v.left + ((v.right - v.left) * i) / v.count),
        y = c.height * v.top,
        sw = (c.width * (v.right - v.left)) / v.count,
        sh = c.height * (v.bottom - v.top);
      ctx.strokeRect(x, y, sw, sh);
      ctx.fillStyle = '#77f1bc';
      ctx.fillText(String(i + 1), x + 8, y + 23);
    }
  }
  function prepareCrop(source, x, y, w, h, clean = false) {
    const scale = byId('ocr-text-style').value === 'light' ? Math.min(3, 3000 / Math.max(w, h)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, x, y, w, h, 0, 0, c.width, c.height);
    const pixels = ctx.getImageData(0, 0, c.width, c.height),
      data = pixels.data;
    if (byId('ocr-text-style').value !== 'light') {
      core.textMask(pixels);
      const block = core.titleBlock(pixels);
      if (clean)
        for (let i = 0; i < data.length; i += 4)
          data[i] = data[i + 1] = data[i + 2] = data[i] < 128 ? 0 : 255;
      ctx.putImageData(pixels, 0, 0);
      if (block) {
        const zoom =
            block.glyphHeight >= 32 && block.glyphHeight <= 52 && !clean
              ? 1
              : Math.max(0.75, Math.min(4, (clean ? 48 : 42) / block.glyphHeight)),
          pad = 12;
        block.x = Math.max(0, block.x - 2);
        block.y = Math.max(0, block.y - 2);
        block.width = Math.min(c.width - block.x, block.width + 4);
        block.height = Math.min(c.height - block.y, block.height + 4);
        const out = document.createElement('canvas');
        out.width = Math.ceil(block.width * zoom) + pad * 2;
        out.height = Math.ceil(block.height * zoom) + pad * 2;
        const target = out.getContext('2d');
        target.fillStyle = '#fff';
        target.fillRect(0, 0, out.width, out.height);
        target.drawImage(
          c,
          block.x,
          block.y,
          block.width,
          block.height,
          pad,
          pad,
          block.width * zoom,
          block.height * zoom
        );
        return out;
      }
      return c;
    }
    for (let i = 0; i < data.length; i += 4) {
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const contrast = Math.max(0, Math.min(255, (luminance - 55) * 1.75 + 25));
      data[i] = data[i + 1] = data[i + 2] = contrast;
    }
    ctx.putImageData(pixels, 0, 0);
    return c;
  }
  async function acceptImage(file) {
    if (busy || capture) return status('请先停止共享，再导入截图。');
    if (!file || !file.type.startsWith('image/')) return status('请选择截图图片。');
    if (file.size > 20 * 1024 * 1024) return status('图片过大，请使用 20 MB 以内的截图。');
    try {
      const next = await createImageBitmap(file);
      if (next.width * next.height > 40000000) {
        next.close();
        throw new Error('图片分辨率过大，请使用普通游戏截图。');
      }
      imageSource?.close();
      imageSource = next;
      detectLayout();
      results = [];
      resultAt = null;
      render();
      byId('ocr-preview-details').hidden = false;
      byId('ocr-preview-details').open = false;
      preview();
      syncControls();
      status('截图已载入，点击识别。');
    } catch (e) {
      status('图片读取失败：' + e.message);
    }
  }
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve();
      const s = document.createElement('script');
      const timeout = setTimeout(() => {
        s.remove();
        reject(new Error('OCR 组件下载超时，请检查网络后重试'));
      }, 30000);
      s.src = url;
      s.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      s.onerror = () => {
        clearTimeout(timeout);
        s.remove();
        reject(new Error('OCR 组件下载失败，请检查网络后重试'));
      };
      document.head.append(s);
    });
  }
  async function engine(session) {
    const language = byId('ocr-language').value;
    if (worker && workerLanguage !== language) {
      await worker.terminate().catch(() => {});
      worker = null;
      workerLanguage = '';
    }
    if (worker) return worker;
    loading = new AbortController();
    const ready = await RewardOcrAssets.prepare(assets, language, {
      source: byId('ocr-source').value,
      signal: loading.signal,
      onProgress: message => {
        if (session === generation) status(message);
      }
    });
    if (session !== generation) throw new Error('识别已取消');
    await loadScript(ready.scriptURL);
    if (session !== generation) throw new Error('识别已取消');
    let timeout;
    const starting = Tesseract.createWorker(ready.langs, 1, {
      workerPath: ready.workerURL,
      workerBlobURL: false,
      corePath: ready.coreURL,
      langPath: ready.langPath,
      cacheMethod: 'none',
      errorHandler: () => {},
      logger: m => {
        if (session === generation && busy && m.status !== 'recognizing text')
          status(`初始化 OCR：${m.status} ${Math.round((m.progress || 0) * 100)}%`);
      }
    });
    let next;
    try {
      next = await Promise.race([
        starting,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('OCR 模型加载超时，请检查网络或改用英文识别')),
            120000
          );
        })
      ]);
    } catch (e) {
      starting.then(w => w.terminate()).catch(() => {});
      throw e;
    } finally {
      clearTimeout(timeout);
    }
    if (session !== generation) {
      await next.terminate();
      throw new Error('识别已取消');
    }
    worker = next;
    workerLanguage = language;
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return worker;
  }
  async function prepareEngine() {
    if (busy) return;
    const session = generation;
    busy = true;
    syncControls();
    try {
      await engine(session);
      if (session === generation) status('OCR 已就绪。');
    } catch (e) {
      if (session === generation) {
        if (worker) await worker.terminate().catch(() => {});
        worker = null;
        workerLanguage = '';
        status('OCR 准备失败：' + (e?.message || String(e)));
      }
    } finally {
      if (session === generation) {
        busy = false;
        syncControls();
      }
    }
  }
  async function recognize() {
    if ((!capture && !imageSource) || busy) return false;
    let v;
    try {
      v = baseLayout();
    } catch (e) {
      status(e.message);
      return false;
    }
    if (pip && !pip.closed) setPipExpanded(true);
    const session = generation;
    busy = true;
    syncControls();
    byId('ocr-progress').hidden = false;
    byId('ocr-progress').value = 0;
    // Never mix rewards from two captured frames while a new recognition is incomplete.
    results = [];
    resultAt = null;
    render();
    try {
      if (capture) {
        if (!video || video.readyState < 2)
          throw new Error('共享画面尚未准备好，请稍后再点识别一次');
        const source = await createImageBitmap(video);
        if (session !== generation) {
          source.close();
          return false;
        }
        imageSource?.close();
        imageSource = source;
        byId('ocr-preview-details').hidden = false;
      }
      detectLayout();
      preview();
      if (byId('ocr-count').value === 'auto' && !detectedLayout) {
        byId('ocr-preview-details').open = true;
        status(
          byId('ocr-text-style').value === 'light'
            ? '当前自动数奖励适用于蓝色名称；其他颜色请手动选 1–4 个奖励，再点击识别。'
            : '未能可靠判断奖励数。请检查绿色区域，调整缩放 / 上下偏移，或手动选 1–4 个奖励后再识别；不会用成功匹配的商品数推断奖励数。'
        );
        return false;
      }
      const ocr = await engine(session);
      if (session !== generation) return false;
      v = layout();
      const w = imageSource.width,
        h = imageSource.height,
        next = [];
      for (let i = 0; i < v.count; i++) {
        if (session !== generation) return false;
        status(`正在本机识别第 ${i + 1}/${v.count} 个奖励…`);
        const sw = (w * (v.right - v.left)) / v.count,
          sh = h * (v.bottom - v.top),
          c = prepareCrop(imageSource, w * v.left + i * sw, h * v.top, sw, sh);
        await ocr.setParameters({ tessedit_pageseg_mode: '6' });
        if (session !== generation) return false;
        const r = await ocr.recognize(c);
        if (session !== generation) return false;
        const parse = r => {
          const lines = core.readingLines(r.data);
          return { ...core.slot(lines, rows), rawText: r.data.text || lines.join('\n') };
        };
        let match = parse(r),
          used = c,
          attempts = [{ ...match, crop: c.toDataURL?.('image/png') || '', method: '多行文本' }];
        if (match.status !== 'exact' && byId('ocr-text-style').value !== 'light') {
          status(`正在复核第 ${i + 1}/${v.count} 个奖励的多行文字…`);
          await ocr.setParameters({ tessedit_pageseg_mode: '11' });
          if (session !== generation) return false;
          const retryCrop = prepareCrop(imageSource, w * v.left + i * sw, h * v.top, sw, sh, true),
            retry = parse(await ocr.recognize(retryCrop));
          if (session !== generation) return false;
          attempts.push({
            ...retry,
            crop: retryCrop.toDataURL?.('image/png') || '',
            method: '去除淡背景 / 按坐标读取'
          });
          const chosen = core.chooseAttempt(match, retry);
          if (chosen === retry) used = retryCrop;
          match = chosen;
        }
        next.push({ ...match, attempts, crop: used.toDataURL?.('image/png') || '' });
        byId('ocr-progress').value = ((i + 1) / v.count) * 100;
      }
      results = next;
      resultAt = new Date();
      const matched = next.filter(r => r.status === 'exact' || r.status === 'probable').length;
      byId('ocr-preview-details').open = matched === 0;
      render();
      if (!matched) {
        status(
          `${countHint()}，本次未匹配到奖励。实际画面 ${w} × ${h}。请展开“识别详情”，检查名称是否完整；绿色框偏位时调整卡位缩放或手动区域，黑白裁剪没有文字时检查游戏文字颜色。`
        );
        return true;
      }
      status(
        `${countHint()} · ${next.filter(r => r.status === 'exact').length} 格已匹配${next.some(r => r.status !== 'exact') ? '，其余请确认名称' : ''}`
      );
      return true;
    } catch (e) {
      if (session === generation) {
        if (worker) await worker.terminate().catch(() => {});
        worker = null;
        workerLanguage = '';
        status('识别失败：' + (e?.message || String(e)) + '。可以重试或输入奖励名。');
      }
      return false;
    } finally {
      if (session === generation) {
        busy = false;
        byId('ocr-progress').hidden = true;
        syncControls();
        renderPip();
      }
    }
  }
  function stopSharing(message = '已停止共享和识别。') {
    generation++;
    loading?.abort();
    loading = null;
    const previous = capture;
    capture = null;
    previous?.getTracks().forEach(t => t.stop());
    if (video) {
      video.pause();
      video.srcObject = null;
      video = null;
    }
    if (worker) {
      worker.terminate().catch(() => {});
      worker = null;
      workerLanguage = '';
    }
    busy = false;
    results = [];
    resultAt = null;
    imageSource?.close();
    imageSource = null;
    detectedLayout = null;
    if (built) {
      byId('ocr-preview')
        .getContext('2d')
        .clearRect(0, 0, byId('ocr-preview').width, byId('ocr-preview').height);
      byId('ocr-progress').hidden = true;
      byId('ocr-frame-info').textContent = '';
      render();
      syncControls();
      status(message);
    }
  }
  async function startSharing() {
    if (capture || busy || requesting) return;
    if (!navigator.mediaDevices?.getDisplayMedia)
      return status('此浏览器不支持屏幕共享。请用桌面 Chrome / Edge，或导入截图识别。');
    // Must run directly inside the click handler, before downloading any OCR resources.
    let local;
    const requested = generation;
    requesting = true;
    syncControls();
    try {
      local = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          resizeMode: 'none',
          frameRate: { ideal: 5, max: 10 }
        },
        audio: false
      });
      if (disposed || requested !== generation) {
        local.getTracks().forEach(t => t.stop());
        return;
      }
      stopSharing('已授权共享，正在准备画面…');
      capture = local;
      const session = generation;
      // Ask the browser to preserve fine text; unsupported hints are harmless.
      const track = local.getVideoTracks()[0];
      try {
        track.contentHint = 'detail';
      } catch (_) {}
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = local;
      local.getVideoTracks()[0].addEventListener('ended', () => {
        if (capture === local) stopSharing('你已停止屏幕共享，识别已结束。');
      });
      await video.play();
      if (session !== generation) return;
      syncControls();
      renderPip();
      status('已共享，奖励出现后点击识别。');
    } catch (e) {
      local?.getTracks().forEach(t => t.stop());
      if (capture === local) stopSharing();
      status(
        e.name === 'NotAllowedError'
          ? '未开启共享。你可以重新授权，或直接粘贴截图。'
          : '无法共享画面：' + e.message
      );
    } finally {
      requesting = false;
      syncControls();
    }
  }
  function shortcut(e) {
    if (
      tab !== 'relics' ||
      e.repeat ||
      !e.ctrlKey ||
      e.key !== 'Enter' ||
      e.altKey ||
      e.metaKey ||
      e.shiftKey ||
      e.target?.closest?.('input,textarea,select,[contenteditable="true"]')
    )
      return;
    e.preventDefault();
    recognize();
  }
  const pipStyle = `
    :root{color-scheme:dark;font:13px system-ui,sans-serif;background:#20252c;color:#eef0f3}
    *{box-sizing:border-box}body{margin:0;padding:8px}button{font:inherit;border:1px solid #4a535e;border-radius:4px;background:#303842;color:inherit;padding:6px 10px;cursor:pointer;white-space:nowrap}
    button:disabled{opacity:.5;cursor:wait}button:focus-visible{outline:2px solid #9cd7b7;outline-offset:2px}button.primary{background:#365f4d;border-color:#538269}
    .toolbar{display:flex;align-items:center;gap:8px}.brand{font-size:12px;color:#c2c9d0;flex:1;white-space:nowrap}.state{margin:6px 0 0;color:#b4bdc8;font-size:11px;line-height:1.5;overflow-wrap:anywhere}
    .cards{display:grid;grid-template-columns:repeat(var(--count,4),minmax(0,1fr));gap:7px;margin-top:9px}.card{min-width:0;border:1px solid #4c5560;border-radius:4px;padding:9px}.card.best{border:2px solid #98d4af;padding:8px}
    .slot{font-size:10px;color:#c0c9d3}.card h3{font-size:12px;line-height:1.5;margin:6px 0;min-height:36px;overflow-wrap:anywhere}.price{font-size:24px;line-height:1.2;color:#a4dfba}.note{font-size:10px;color:#bbc4cf;line-height:1.5;margin:5px 0 0}.empty{padding:10px 0;color:#bbc4cf;font-size:12px}
    [hidden]{display:none!important}@media(max-width:480px){.cards{grid-template-columns:repeat(min(2,var(--count,4)),minmax(0,1fr))}}`;
  function setPipExpanded(expanded) {
    if (!pip || pip.closed) return;
    const changed = pipExpanded !== expanded;
    pipExpanded = expanded;
    renderPip();
    // Keep the current width so the right-side toggle stays at the same horizontal position.
    // PiP forbids moving the window; only resize vertically during a user action.
    if (changed)
      try {
        pip.resizeBy(0, (expanded ? 440 : 96) - pip.innerHeight);
      } catch (_) {
        pip.document.getElementById('ocr-pip-state').textContent += ' · 可拖动窗口边框调整大小';
      }
  }
  async function openPip() {
    if (!window.documentPictureInPicture?.requestWindow)
      return status('当前浏览器不支持网页悬浮窗，请在副屏显示此页，或使用较新的 Chrome / Edge。');
    if (pip && !pip.closed) {
      pip.focus();
      return;
    }
    try {
      const session = generation,
        next = await documentPictureInPicture.requestWindow({
          width: 320,
          height: 96,
          preferInitialWindowPlacement: false
        });
      if (session !== generation || disposed) {
        next.close();
        return;
      }
      pip = next;
      pipExpanded = false;
      pip.document.title = '虚空账本 · 奖励价格';
      const style = pip.document.createElement('style');
      style.textContent = pipStyle;
      pip.document.head.append(style);
      pip.document.body.innerHTML =
        '<div class="toolbar"><span class="brand">虚空账本</span><button id="ocr-pip-run" class="primary">识别一次</button><button id="ocr-pip-toggle" aria-expanded="false">展开</button></div><p id="ocr-pip-state" class="state" role="status"></p><div id="ocr-pip-results" hidden></div>';
      pip.document.getElementById('ocr-pip-run').onclick = () => recognize();
      pip.document.getElementById('ocr-pip-toggle').onclick = () => setPipExpanded(!pipExpanded);
      pip.document.addEventListener('keydown', shortcut);
      pip.addEventListener('pagehide', () => {
        if (pip === next) pip = null;
      });
      renderPip();
      status('悬浮窗已打开，可拖到角落并收起。');
    } catch (e) {
      status('悬浮窗未打开：' + e.message + '。可在副屏查看网页。');
    }
  }
  function quotes() {
    return core.compare(results, slug => DeskCore.rewardQuote(mrow(slug)));
  }
  function renderPip() {
    if (!pip || pip.closed) return;
    const doc = pip.document,
      run = doc.getElementById('ocr-pip-run');
    if (!run) return;
    run.disabled = busy || (!capture && !imageSource);
    run.textContent = busy ? '识别中…' : '识别一次';
    const toggle = doc.getElementById('ocr-pip-toggle');
    toggle.textContent = pipExpanded ? '收起' : '展开';
    toggle.setAttribute('aria-expanded', String(pipExpanded));
    doc.getElementById('ocr-pip-state').textContent = busy
      ? '正在识别本次画面…'
      : resultAt
        ? `上次 ${resultAt.toLocaleTimeString()} · ${capture ? '共享已连接' : imageSource ? '导入截图' : '未共享'} · 手动识别`
        : capture
          ? '共享已连接 · 点击才识别'
          : imageSource
            ? '截图已载入 · 点击识别'
            : '请先回网页共享游戏画面或导入截图';
    const area = doc.getElementById('ocr-pip-results');
    area.hidden = !pipExpanded;
    if (!pipExpanded) return;
    const compared = quotes();
    area.innerHTML = compared.length
      ? `<div class="cards" style="--count:${compared.length}">${compared
          .map((r, i) => {
            const note = !r.item ? '未匹配' : r.status !== 'exact' ? '待确认 · ' + r.note : r.note;
            return `<article class="card ${r.best ? 'best' : ''}"><span class="slot">第 ${i + 1} 格${r.best ? ' · 最高确认价' : ''}</span><h3>${esc(r.item?.name || '未确认')}</h3><strong class="price">${esc(r.display)}</strong><p class="note" title="${esc(r.item?.tradable ? '更新 ' + timeLabel(r.q?.at) : '')}">${esc(note)}</p></article>`;
          })
          .join('')}</div>`
      : `<p class="empty">${busy ? '正在读取奖励名称…' : '奖励出现后点击“识别一次”。按游戏从左到右排列。'}</p>`;
  }
  function render() {
    if (!built) return;
    const compared = quotes();
    byId('ocr-results').style.setProperty('--ocr-count', Math.max(1, compared.length));
    byId('ocr-results').innerHTML = compared
      .map((r, i) => {
        const item = r.item,
          name = item?.name || (r.status === 'ambiguous' ? '请确认奖励' : '未识别，请手动查找');
        // Exact matches need no unrelated fuzzy alternatives; search remains available for correction.
        const candidates = r.status === 'exact' ? [] : (r.candidates || []).map(x => x.item);
        const correction = `<input data-ocr-search="${i}" value="${esc(r.search || '')}" placeholder="搜索奖励名" aria-label="第 ${i + 1} 格奖励搜索"><div class="ocr-candidates">${candidates.map(x => `<button data-ocr-slot="${i}" data-ocr-choice="${esc(x.slug)}">${esc(x.name)}</button>`).join('')}</div>`;
        return `<article class="ocr-result ${r.best ? 'ocr-best' : ''}"><span class="ocr-slot">第 ${i + 1} 格 ${r.best ? '· 最高确认价' : ''}</span><h3>${esc(name)}</h3>${r.status === 'probable' ? '<p class="ocr-match-state">近似匹配，先确认名称</p>' : ''}<strong class="ocr-price">${esc(r.display)}</strong><p>${esc(r.note)}</p>${item && candidateRows.length && !candidateRows.some(x => x.slug === item.slug) ? '<p class="ocr-scope-note">不在已填遗物中，请核对。</p>' : ''}<small>${item?.tradable ? '更新 ' + esc(timeLabel(r.q?.at)) : ''}</small>${r.status === 'exact' ? `<details class="ocr-correction"><summary>修正名称</summary>${correction}</details>` : correction}<details><summary>识别详情</summary>${(r.attempts || [{ rawText: r.rawText || r.text, crop: r.crop }]).map(a => `<p>${a.method ? esc(a.method) + '：' : ''}${esc(a.rawText || '没有可用文字')}</p>${a.crop ? `<img class="ocr-crop-image" src="${a.crop}" alt="第 ${i + 1} 格${esc(a.method || '')}实际送入 OCR 的图片">` : ''}`).join('')}</details></article>`;
      })
      .join('');
    renderPip();
  }
  function mount(items, relics) {
    rows = core.catalog(items, relics);
    candidateRows = [];
    if (built) {
      renderCandidateStatus();
      return;
    }
    built = true;
    const panel = document.createElement('section');
    panel.className = 'ocr-panel';
    panel.id = 'reward-ocr-panel';
    panel.innerHTML = `<div class="ocr-heading"><div><h2>截图识别</h2><p>仅手动识别，截图不上传。</p></div></div>
      <div class="ocr-actions"><button id="ocr-share" class="plain-button">共享画面</button><button id="ocr-stop" class="plain-button" hidden>停止共享</button><button id="ocr-run" class="primary" disabled>识别一次</button><label class="plain-button ocr-file-button">导入截图<input id="ocr-file" type="file" accept="image/*" aria-label="导入奖励截图"></label><button id="ocr-pip" class="plain-button">悬浮窗</button></div>
      <div class="ocr-paste-area" tabindex="0" role="group" aria-label="截图粘贴区域">在此页面按 <kbd>Ctrl + V</kbd> 粘贴截图<span>也可先点击这里，再粘贴</span></div>
      <details id="ocr-settings" class="ocr-settings"><summary>设置与帮助</summary>
        <div class="ocr-layout"><label>奖励数 <select id="ocr-count"><option value="auto">自动检测</option>${[4, 3, 2, 1].map(n => `<option>${n}</option>`).join('')}</select></label><label>识别语言 <select id="ocr-language"><option value="chi_sim+eng">中文 + 英文</option><option value="eng">仅英文</option></select></label><label>名称颜色 <select id="ocr-text-style"><option value="cyan">蓝色文字</option><option value="light">其他颜色</option></select></label><label>下载来源 <select id="ocr-source"><option value="mirror">国内镜像优先</option><option value="site">本站优先</option></select></label><button id="ocr-prepare" class="plain-button">提前加载 OCR</button></div>
        <div class="ocr-crop-settings"><h3>区域校准</h3><div><label>定位 <select id="ocr-area-mode"><option value="auto">居中奖励卡</option><option value="manual">手动区域</option></select></label><label>卡位缩放 % <input id="ocr-ui-scale" type="number" min="60" max="150" value="100"></label><label>上下偏移 % <input id="ocr-y-offset" type="number" min="-15" max="15" value="0" step="0.5"></label>${[
          ['left', '左', 24.8],
          ['right', '右', 75.2],
          ['top', '上', 36],
          ['bottom', '下', 49]
        ]
          .map(
            ([key, name, value]) =>
              `<label>${name}边 % <input id="ocr-${key}" type="number" min="0" max="100" value="${value}"></label>`
          )
          .join('')}</div></div>
        <p id="ocr-capture-info" class="ocr-capture-info" hidden></p><p id="ocr-candidate-status" class="ocr-candidate-status">${candidateStatus()}</p>
        <details id="ocr-text-area" class="ocr-text-entry"><summary>按奖励名称查价</summary><textarea id="ocr-text" rows="4" aria-label="四个奖励名称" placeholder="每行一个奖励，最多四个"></textarea><button id="ocr-match-text" class="plain-button">查价</button></details>
        <div class="ocr-help"><p>共享时选择游戏窗口或游戏所在屏幕，不选本站标签页。点击按钮或网页获得焦点时按 Ctrl + Enter 才取一帧；不读取游戏内存。切换到其他网页功能时共享会保持，点击“停止共享”、关闭网页或浏览器结束共享。悬浮窗可收起，位置需手动拖动；独占全屏可能无法覆盖。</p><p>首次识别会下载模型，也可提前加载。默认自动判断奖励数；其他文字颜色需手选数量。框偏位或名称被截断时，展开预览后校准。</p><p>价格优先用 30 天成交均价，无有效均价时标明挂价；旧价和未确认名称不参与最高价提示。</p></div>
      </details><div id="ocr-image-area"><details id="ocr-preview-details" hidden><summary>截图预览与校准</summary><p id="ocr-frame-info"></p><canvas id="ocr-preview" aria-label="奖励识别区域预览"></canvas></details></div><progress id="ocr-progress" max="100" value="0" hidden></progress><p id="ocr-status" role="status" hidden></p><div id="ocr-results" class="ocr-results"></div>`;
    byId('relic-section').prepend(panel);
    document.addEventListener('keydown', shortcut);
    byId('ocr-prepare').onclick = prepareEngine;
    byId('ocr-file').onchange = e => acceptImage(e.target.files[0]);
    byId('ocr-run').onclick = () => recognize();
    byId('ocr-share').onclick = startSharing;
    byId('ocr-stop').onclick = () => stopSharing();
    byId('ocr-pip').onclick = openPip;
    [
      'left',
      'right',
      'top',
      'bottom',
      'count',
      'language',
      'area-mode',
      'source',
      'text-style',
      'ui-scale',
      'y-offset'
    ].forEach(
      k =>
        (byId('ocr-' + k).onchange = () => {
          try {
            if (['left', 'right', 'top', 'bottom'].includes(k))
              byId('ocr-area-mode').value = 'manual';
            if (['ui-scale', 'y-offset'].includes(k)) byId('ocr-area-mode').value = 'auto';
            detectLayout();
            preview();
            results = [];
            resultAt = null;
            render();
            if (k === 'language' && worker) {
              worker.terminate().catch(() => {});
              worker = null;
            }
            syncControls();
            renderPip();
            status('参数已改变，下次识别按新区域和语言处理。');
          } catch (e) {
            status(e.message);
          }
        })
    );
    byId('ocr-match-text').onclick = () => {
      results = byId('ocr-text')
        .value.split(/\n/)
        .map(x => x.trim())
        .filter(Boolean)
        .slice(0, 4)
        .map(text => ({ ...core.match(text, rows), text }));
      resultAt = new Date();
      render();
      status('已按输入顺序查价。');
    };
    panel.addEventListener('input', e => {
      const i = e.target.dataset.ocrSearch;
      if (i === undefined) return;
      const r = results[Number(i)],
        q = core.normalize(e.target.value);
      r.search = e.target.value;
      const choices = q
        ? rows.filter(x => (x.ocrAliases || []).some(a => a.includes(q))).slice(0, 8)
        : [];
      e.target.nextElementSibling.innerHTML = choices
        .map(
          x =>
            `<button data-ocr-slot="${i}" data-ocr-choice="${esc(x.slug)}">${esc(x.name)}</button>`
        )
        .join('');
    });
    panel.addEventListener('click', e => {
      const b = e.target.closest('[data-ocr-choice]');
      if (!b) return;
      const r = results[Number(b.dataset.ocrSlot)];
      if (!r) return;
      r.item = rows.find(x => x.slug === b.dataset.ocrChoice);
      r.status = 'exact';
      r.search = '';
      render();
    });
    document.addEventListener('paste', e => {
      if (tab !== 'relics') return;
      const file = [...(e.clipboardData?.items || [])]
        .find(x => x.type.startsWith('image/'))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        acceptImage(file);
      }
    });
    syncControls();
  }
  function setCandidates(rewards) {
    const values = new Set();
    for (const reward of rewards || [])
      for (const value of [
        reward?.slug,
        reward?.name,
        reward?.item?.slug,
        reward?.item?.name,
        ...(reward?.item?.ocrNames || [])
      ])
        if (value) values.add(core.normalize(value));
    candidateRows = values.size
      ? rows.filter(item =>
          [item.slug, item.name, item.english, ...(item.ocrNames || [])]
            .filter(Boolean)
            .some(value => values.has(core.normalize(value)))
        )
      : [];
    renderCandidateStatus();
    render();
  }
  window.RewardOcr = {
    mount,
    update: render,
    setCandidates,
    leave: () => {
      if (capture || busy) stopSharing('已离开开核桃页面，共享与识别已停止。');
      else generation++;
      if (pip) {
        pip.close();
        pip = null;
      }
    }
  };
  window.addEventListener('pagehide', () => {
    disposed = true;
    stopSharing();
    if (pip) pip.close();
  });
  window.addEventListener('pageshow', () => {
    disposed = false;
  });
})();
