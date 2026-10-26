'use strict';
const assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs');
const core = require('../static/js/ocr/reward-ocr-core.js');
function deferred() {
  let resolve;
  const promise = new Promise(r => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup({
  items = [],
  relics = { items: [] },
  recognitions = null,
  autoCounts = null
} = {}) {
  const nodes = new Map(),
    events = {},
    trackEvents = {},
    timers = new Map();
  let stopped = 0,
    terminated = 0,
    closedFrames = 0,
    nextTimer = 1,
    captured = 0,
    recognized = 0,
    activeCount = 0,
    captureRequest;
  const pendingShare = deferred(),
    pendingRecognize = deferred();
  const context = {
    drawImage() {},
    fillRect() {},
    strokeRect() {},
    fillText() {},
    clearRect() {},
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(Math.max(1, w * h * 4));
      if (autoCounts && w > 800) {
        const cell = w / 4;
        for (let i = 0; i < activeCount; i++) {
          const center = (w - activeCount * cell) / 2 + (i + 0.5) * cell;
          for (let yy = 10; yy < 30; yy++)
            for (let xx = Math.round(center - cell * 0.3); xx < center + cell * 0.3; xx++)
              if (xx % 9 < 6) {
                const at = (yy * w + xx) * 4;
                data[at] = 20;
                data[at + 1] = 180;
                data[at + 2] = 210;
                data[at + 3] = 255;
              }
        }
      }
      return { width: w, height: h, data };
    },
    putImageData() {},
    imageSmoothingEnabled: true
  };
  function node(id) {
    if (!nodes.has(id))
      nodes.set(id, {
        value:
          {
            'ocr-left': '0',
            'ocr-right': '100',
            'ocr-top': '20',
            'ocr-bottom': '65',
            'ocr-count': '4',
            'ocr-language': 'eng'
          }[id] || '',
        hidden: false,
        disabled: false,
        innerHTML: '',
        textContent: '',
        style: { setProperty() {} },
        addEventListener() {},
        prepend() {},
        getContext: () => context
      });
    return nodes.get(id);
  }
  const track = {
    getSettings: () => ({ width: 2560, height: 1440, displaySurface: 'monitor' }),
    stop() {
      stopped++;
    },
    addEventListener: (name, fn) => {
      trackEvents[name] = fn;
    }
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const worker = {
    setParameters: async () => {},
    recognize: () => {
      const index = recognized++;
      return recognitions
        ? Promise.resolve(recognitions[index % recognitions.length])
        : pendingRecognize.promise;
    },
    terminate: async () => {
      terminated++;
    }
  };
  const sandbox = {
    URL,
    console,
    AbortController,
    RewardOcrCore: core,
    RewardOcrAssets: {
      prepare: async () => ({ langs: [], scriptURL: '', workerURL: '', coreURL: '' })
    },
    document: {
      baseURI: 'http://localhost/',
      currentScript: { src: 'http://localhost/reward-ocr.js' },
      getElementById: node,
      createElement: type =>
        type === 'video'
          ? {
              muted: false,
              playsInline: false,
              readyState: 2,
              isVideo: true,
              videoWidth: 1920,
              videoHeight: 1080,
              play: async () => {},
              pause() {}
            }
          : node('created-' + type),
      addEventListener: (name, fn) => {
        events['document-' + name] = fn;
      },
      head: { append() {} }
    },
    navigator: {
      mediaDevices: {
        getDisplayMedia: options => {
          captureRequest = options;
          return pendingShare.promise;
        }
      }
    },
    createImageBitmap: async () => {
      activeCount = autoCounts?.[captured % autoCounts.length] || 0;
      captured++;
      return {
        width: 1920,
        height: 1080,
        close() {
          closedFrames++;
        }
      };
    },
    setTimeout: fn => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: id => timers.delete(id),
    Tesseract: { createWorker: async () => worker },
    DeskCore: { rewardQuote: () => ({ value: null, valid: false }) },
    mrow: () => ({}),
    esc: x => String(x),
    timeLabel: () => '',
    tab: 'relics'
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (name, fn) => {
    events[name] = fn;
  };
  vm.runInNewContext(
    fs.readFileSync(require('node:path').join(__dirname, '../static/js/ocr/reward-ocr.js'), 'utf8'),
    sandbox
  );
  sandbox.RewardOcr.mount(items, relics);
  return {
    sandbox,
    node,
    stream,
    pendingShare,
    pendingRecognize,
    trackEvents,
    timers,
    stopped: () => stopped,
    terminated: () => terminated,
    closedFrames: () => closedFrames,
    captured: () => captured,
    recognized: () => recognized,
    captureRequest: () => captureRequest,
    track,
    events
  };
}
function installPip(s, { resizeFails = false, width = 320 } = {}) {
  const nodes = new Map(),
    events = {},
    sizes = [],
    requests = [];
  let focused = 0;
  const get = id => {
    if (!nodes.has(id))
      nodes.set(id, {
        innerHTML: '',
        textContent: '',
        hidden: false,
        disabled: false,
        attributes: {},
        setAttribute(k, v) {
          this.attributes[k] = v;
        }
      });
    return nodes.get(id);
  };
  const pip = {
    closed: false,
    innerWidth: width,
    innerHeight: 96,
    document: {
      title: '',
      body: { innerHTML: '' },
      head: { append() {} },
      createElement: () => ({}),
      getElementById: get,
      addEventListener: (name, fn) => {
        events['doc-' + name] = fn;
      }
    },
    addEventListener: (name, fn) => {
      events[name] = fn;
    },
    resizeBy(w, h) {
      if (resizeFails) throw new Error('resize unavailable');
      pip.innerWidth += w;
      pip.innerHeight += h;
      sizes.push([pip.innerWidth, pip.innerHeight]);
    },
    close() {
      pip.closed = true;
      events.pagehide?.();
    },
    focus() {
      focused++;
    }
  };
  s.sandbox.documentPictureInPicture = {
    requestWindow: async options => {
      requests.push(options);
      return pip;
    }
  };
  return { pip, node: get, events, sizes, requests, focused: () => focused };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
};
(async () => {
  // Image paste works even after typing in a relic field; ordinary text paste is untouched.
  let pasteSetup = setup(),
    prevented = 0;
  pasteSetup.sandbox.document.activeElement = { matches: () => true };
  const imagePaste = {
    clipboardData: {
      items: [{ type: 'image/png', getAsFile: () => ({ type: 'image/png', size: 100 }) }]
    },
    preventDefault() {
      prevented++;
    }
  };
  pasteSetup.events['document-paste'](imagePaste);
  await flush();
  assert.equal(prevented, 1);
  assert.equal(pasteSetup.captured(), 1);
  assert.equal(pasteSetup.recognized(), 0);
  assert.equal(pasteSetup.node('ocr-run').disabled, false);
  assert.match(pasteSetup.node('ocr-status').textContent, /截图已载入/);
  pasteSetup.events['document-paste']({
    clipboardData: { items: [{ type: 'text/plain' }] },
    preventDefault() {
      prevented++;
    }
  });
  assert.equal(prevented, 1);
  assert.equal(pasteSetup.captured(), 1);
  pasteSetup.sandbox.tab = 'home';
  pasteSetup.events['document-paste'](imagePaste);
  await flush();
  assert.equal(prevented, 1);
  // A chooser may resolve after the user navigates away. Never start capture then.
  let s = setup(),
    start = s.node('ocr-share').onclick();
  s.sandbox.RewardOcr.leave();
  s.pendingShare.resolve(s.stream);
  await start;
  assert.equal(s.stopped(), 1);
  assert.equal(s.timers.size, 0);
  // Cancel while a frame is being OCR'd: stop tracks, terminate worker, ignore late results.
  s = setup();
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  const run = s.node('ocr-run').onclick();
  await flush();
  assert.equal(s.node('ocr-file').disabled, true);
  s.node('ocr-stop').onclick();
  s.pendingRecognize.resolve({ data: { lines: [{ text: 'Forma Blueprint' }] } });
  await run;
  assert.equal(s.stopped(), 1);
  assert.equal(s.terminated(), 1);
  assert.equal(s.closedFrames(), 1);
  assert.equal(s.node('ocr-results').innerHTML, '');
  assert.equal(s.timers.size, 0);
  // Native browser Stop sharing follows the same cleanup path.
  s = setup();
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  const interrupted = s.node('ocr-run').onclick();
  await flush();
  s.trackEvents.ended();
  s.pendingRecognize.resolve({ data: { lines: [] } });
  await interrupted;
  assert.equal(s.stopped(), 1);
  assert.match(s.node('ocr-status').textContent, /停止屏幕共享/);
  assert.equal(s.timers.size, 0);
  // Sharing alone never extracts a frame or starts OCR. Each click is one four-slot batch.
  s = setup({
    relics: { items: [{ grades: { intact: [{ name: 'Forma Blueprint', tradable: false }] } }] }
  });
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  await flush();
  assert.equal(s.captured(), 0);
  assert.equal(s.recognized(), 0);
  assert.equal(s.timers.size, 0);
  assert.equal(s.captureRequest().video.resizeMode, 'none');
  assert.equal(s.captureRequest().video.width.ideal, 3840);
  assert.equal(s.track.contentHint, 'detail');
  assert.match(s.node('ocr-capture-info').textContent, /整个屏幕.*2560 × 1440/);
  assert.equal(s.node('ocr-run').disabled, false);
  const once = s.node('ocr-run').onclick();
  await flush();
  assert.equal(s.node('ocr-run').disabled, true);
  await s.node('ocr-run').onclick();
  assert.equal(s.captured(), 1); // duplicate click ignored
  s.pendingRecognize.resolve({ data: { lines: [{ text: 'Forma Blueprint' }] } });
  await once;
  assert.equal(s.recognized(), 4);
  assert.equal(s.captured(), 1);
  assert.equal(s.node('ocr-run').disabled, false);
  assert.match(s.node('ocr-capture-info').textContent, /本次识别画面 1920 × 1080/);
  assert.equal(s.timers.size, 0);
  await flush();
  assert.equal(s.recognized(), 4);
  await s.node('ocr-run').onclick();
  assert.equal(s.recognized(), 8);
  assert.equal(s.captured(), 2);
  assert.equal(s.closedFrames(), 1);
  assert.equal(s.timers.size, 0);
  s.sandbox.RewardOcr.leave();
  assert.equal(s.stopped(), 1);
  assert.equal(s.closedFrames(), 2);
  // Auto count is recomputed for each captured frame; duplicate items stay in separate game slots.
  s = setup({
    autoCounts: [2, 3],
    relics: { items: [{ grades: { intact: [{ name: 'Forma Blueprint', tradable: false }] } }] },
    recognitions: [{ data: { text: 'Forma Blueprint' } }]
  });
  s.node('ocr-count').value = 'auto';
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  await s.node('ocr-run').onclick();
  assert.equal(s.recognized(), 2);
  assert.match(s.node('ocr-status').textContent, /自动检测到 2 个/);
  assert.equal((s.node('ocr-results').innerHTML.match(/<article/g) || []).length, 2);
  await s.node('ocr-run').onclick();
  assert.equal(s.recognized(), 5);
  assert.match(s.node('ocr-status').textContent, /自动检测到 3 个/);
  s.sandbox.RewardOcr.leave();
  s = setup({ autoCounts: [0] });
  s.node('ocr-count').value = 'auto';
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  await s.node('ocr-run').onclick();
  assert.equal(s.recognized(), 0);
  assert.match(s.node('ocr-status').textContent, /未能可靠判断奖励数/);
  assert.equal(s.node('ocr-preview-details').open, true);
  assert.equal(s.node('ocr-run').disabled, false);
  s.sandbox.RewardOcr.leave();
  // A bad crop gets at most one alternate preprocessing pass; exact crops are not rerun.
  s = setup({
    items: [{ slug: 'bronco_prime_barrel', name: '野马 Prime 枪管' }],
    relics: {
      items: [
        {
          grades: {
            intact: [{ slug: 'bronco_prime_barrel', name: 'Bronco Prime Barrel', tradable: true }]
          }
        }
      ]
    },
    recognitions: [{ data: { text: 'TRENE Prime &' } }, { data: { text: '野马 Prime 枪管' } }]
  });
  s.node('ocr-count').value = '1';
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  await s.node('ocr-run').onclick();
  assert.equal(s.recognized(), 2);
  assert.equal(s.captured(), 1);
  assert.match(s.node('ocr-results').innerHTML, /<h3>野马 Prime 枪管<\/h3>/);
  assert.match(s.node('ocr-results').innerHTML, /多行文本：TRENE Prime/);
  assert.match(s.node('ocr-results').innerHTML, /按坐标读取：野马/);
  s.sandbox.RewardOcr.leave();
  // PiP opens as a small manual control; changing view never captures or OCRs.
  s = setup({
    relics: { items: [{ grades: { intact: [{ name: 'Forma Blueprint', tradable: false }] } }] },
    recognitions: [{ data: { text: 'Forma Blueprint' } }]
  });
  let p = installPip(s);
  await s.node('ocr-pip').onclick();
  assert.equal(p.requests[0].width, 320);
  assert.equal(p.requests[0].height, 96);
  assert.equal(p.requests[0].preferInitialWindowPlacement, false);
  assert.equal(p.node('ocr-pip-results').hidden, true);
  assert.equal(p.node('ocr-pip-run').disabled, true);
  assert.equal(p.node('ocr-pip-toggle').textContent, '展开');
  p.node('ocr-pip-toggle').onclick();
  assert.equal(p.node('ocr-pip-results').hidden, false);
  assert.equal(p.sizes.at(-1)[0], 320);
  assert.equal(p.sizes.at(-1)[1], 440);
  p.node('ocr-pip-toggle').onclick();
  assert.equal(p.node('ocr-pip-results').hidden, true);
  assert.equal(p.sizes.at(-1)[0], 320);
  assert.equal(s.captured(), 0);
  assert.equal(s.recognized(), 0);
  assert.equal(s.timers.size, 0);
  await s.node('ocr-pip').onclick();
  assert.equal(p.requests.length, 1);
  assert.equal(p.focused(), 1);
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  assert.equal(p.node('ocr-pip-run').disabled, false);
  await p.node('ocr-pip-run').onclick();
  assert.equal(s.captured(), 1);
  assert.equal(s.recognized(), 4);
  assert.equal(p.node('ocr-pip-results').hidden, false);
  assert.match(p.node('ocr-pip-results').innerHTML, /第 1 格/);
  assert.match(p.node('ocr-pip-results').innerHTML, /Forma 蓝图/);
  p.node('ocr-pip-toggle').onclick();
  const sizes = p.sizes.length;
  s.sandbox.RewardOcr.update();
  assert.equal(p.node('ocr-pip-results').hidden, true);
  assert.equal(p.sizes.length, sizes);
  await s.node('ocr-run').onclick();
  assert.equal(p.node('ocr-pip-results').hidden, false);
  assert.equal(s.captured(), 2);
  s.sandbox.RewardOcr.leave();
  assert.equal(p.pip.closed, true);
  assert.equal(s.timers.size, 0);
  // Preserve a user-resized width through expand/collapse rather than shifting the right edge.
  s = setup();
  p = installPip(s, { width: 560 });
  await s.node('ocr-pip').onclick();
  p.node('ocr-pip-toggle').onclick();
  assert.deepEqual(p.sizes.at(-1), [560, 440]);
  p.node('ocr-pip-toggle').onclick();
  assert.deepEqual(p.sizes.at(-1), [560, 96]);
  assert.equal(s.captured(), 0);
  assert.equal(s.recognized(), 0);
  s.sandbox.RewardOcr.leave();
  // Collapse during recognition stays collapsed when results arrive; old data never expands it.
  s = setup();
  p = installPip(s);
  await s.node('ocr-pip').onclick();
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  const pipRun = p.node('ocr-pip-run').onclick();
  await flush();
  assert.equal(p.node('ocr-pip-run').disabled, true);
  p.node('ocr-pip-toggle').onclick();
  s.pendingRecognize.resolve({ data: { text: 'Forma Blueprint' } });
  await pipRun;
  assert.equal(p.node('ocr-pip-results').hidden, true);
  assert.equal(p.node('ocr-pip-run').disabled, false);
  assert.equal(s.timers.size, 0);
  p.pip.close();
  await s.node('ocr-run').onclick();
  assert.equal(s.captured(), 2);
  s.sandbox.RewardOcr.leave();
  // Older browsers can still switch content without resize support; PiP remains optional.
  s = setup();
  p = installPip(s, { resizeFails: true });
  await s.node('ocr-pip').onclick();
  p.node('ocr-pip-toggle').onclick();
  assert.equal(p.node('ocr-pip-results').hidden, false);
  assert.match(p.node('ocr-pip-state').textContent, /边框/);
  assert.equal(s.captured(), 0);
  s.sandbox.RewardOcr.leave();
  s = setup();
  await s.node('ocr-pip').onclick();
  assert.match(s.node('ocr-status').textContent, /不支持网页悬浮窗/);
  // Ctrl+Enter only handles focused webpage events; repeat and editable fields are ignored.
  s = setup({ recognitions: [{ data: { text: 'Forma Blueprint' } }] });
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  const key = { key: 'Enter', ctrlKey: true, preventDefault() {}, target: { closest: () => null } };
  s.events['document-keydown']({ ...key, repeat: true });
  s.events['document-keydown']({ ...key, target: { closest: () => ({}) } });
  assert.equal(s.captured(), 0);
  s.events['document-keydown'](key);
  await flush();
  assert.equal(s.captured(), 1);
  s.sandbox.RewardOcr.leave();
  // Cancelling model preparation aborts its network request and does not create an engine.
  s = setup();
  let downloadSignal,
    engines = 0;
  s.sandbox.RewardOcrAssets.prepare = (_base, _language, options) =>
    new Promise((resolve, reject) => {
      downloadSignal = options.signal;
      options.signal.addEventListener('abort', () => reject(new Error('cancelled')));
    });
  s.sandbox.Tesseract.createWorker = async () => {
    engines++;
  };
  const preparation = s.node('ocr-prepare').onclick();
  await flush();
  assert.equal(s.node('ocr-prepare').disabled, true);
  s.node('ocr-stop').onclick();
  await preparation;
  assert.equal(downloadSignal.aborted, true);
  assert.equal(engines, 0);
  assert.equal(s.timers.size, 0);
  assert.equal(s.node('ocr-prepare').disabled, false);
  // A failed preparation reports a string error and can be retried; switching languages recreates the worker.
  s = setup();
  const create = s.sandbox.Tesseract.createWorker;
  let attempts = 0;
  s.sandbox.Tesseract.createWorker = async () => {
    if (!attempts++) throw 'model failure';
    return create();
  };
  await s.node('ocr-prepare').onclick();
  assert.match(s.node('ocr-status').textContent, /model failure/);
  assert.equal(s.node('ocr-prepare').disabled, false);
  await s.node('ocr-prepare').onclick();
  assert.match(s.node('ocr-status').textContent, /已就绪/);
  s.node('ocr-language').value = 'chi_sim+eng';
  s.node('ocr-language').onchange();
  assert.equal(s.terminated(), 1);
  await s.node('ocr-prepare').onclick();
  assert.equal(attempts, 3);
  assert.equal(s.timers.size, 0);
  // Zero recognized rewards keep the source preview visible and report captured pixels, not monitor size.
  s = setup();
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  const empty = s.node('ocr-run').onclick();
  await flush();
  s.pendingRecognize.resolve({ data: { text: '', lines: [] } });
  await empty;
  assert.equal(s.node('ocr-preview-details').open, true);
  assert.match(s.node('ocr-status').textContent, /1920 × 1080/);
  assert.match(s.node('ocr-status').textContent, /识别详情/);
  assert.match(s.node('ocr-frame-info').textContent, /屏幕共享/);
  s.node('ocr-ui-scale').value = '80';
  s.node('ocr-ui-scale').onchange();
  assert.equal(s.node('ocr-area-mode').value, 'auto');
  s.node('ocr-ui-scale').value = '0';
  await s.node('ocr-run').onclick();
  assert.match(s.node('ocr-status').textContent, /60–150/);
  s.sandbox.RewardOcr.leave();
  assert.equal(s.node('ocr-frame-info').textContent, '');
  // Previously entered relics must not exclude correct OCR names or manual corrections.
  const catalog = [
    { slug: 'dual_zoren_prime_handle', name: '佐伦双斧 Prime 握柄' },
    { slug: 'bronco_prime_barrel', name: '野马 Prime 枪管' },
    { slug: 'kompressa_prime_blueprint', name: '卡帕压力枪 Prime 蓝图' },
    { slug: 'yareli_prime_chassis_blueprint', name: 'Yareli Prime 机体 蓝图' }
  ];
  const raw = ['佐伦双莽 Prime 握柄', ...catalog.slice(1).map(x => x.name)];
  s = setup({
    items: catalog,
    relics: { items: [{ grades: { intact: catalog.map(x => ({ ...x, tradable: true })) } }] },
    recognitions: [raw[0], ...raw].map(text => ({ data: { text } }))
  }); // text-only engine output is valid too.
  s.sandbox.RewardOcr.setCandidates([catalog[3]]);
  start = s.node('ocr-share').onclick();
  s.pendingShare.resolve(s.stream);
  await start;
  await s.node('ocr-run').onclick();
  for (const x of catalog)
    assert.ok(s.node('ocr-results').innerHTML.includes('<h3>' + x.name + '</h3>'), x.name);
  assert.match(s.node('ocr-results').innerHTML, /近似匹配，先确认名称/);
  assert.match(s.node('ocr-results').innerHTML, /不在已填遗物/);
  assert.match(s.node('ocr-candidate-status').textContent, /仅作核对/);
  s.sandbox.RewardOcr.leave();
  s.node('ocr-text').value = catalog[1].name + '\n' + catalog[2].name;
  s.node('ocr-match-text').onclick();
  for (const x of catalog.slice(1, 3))
    assert.ok(s.node('ocr-results').innerHTML.includes('<h3>' + x.name + '</h3>'));
  console.log(
    'OCR lifecycle: late permission, cancellation during recognition, browser stop, manual-only, compact PiP, resizing fallback, multiline batches, focused shortcuts and cleanup passed'
  );
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
