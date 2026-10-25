# OCR third-party assets

These unmodified files are loaded only when the user prepares or starts OCR.
They are hosted with the dashboard. The downloader can also fetch the same pinned
versions from registry.npmmirror.com, verifies their SHA-256 against the bundled
manifest values before execution, and caches verified dependencies in the browser.
Model packages are streamed to extract only 4.0.0_best_int; their model bytes are
unchanged. The Worker bootstrap is project code, not a modification of these
third-party files. Screenshots and recognized text are never sent to either source.

- Tesseract.js 5.1.1: https://github.com/naptha/tesseract.js, Apache-2.0.
- tesseract.js-core 5.1.1: https://github.com/naptha/tesseract.js-core, Apache-2.0.
  Only the LSTM-only core (SIMD and non-SIMD) is included.
- @tesseract.js-data/eng 1.0.0 and @tesseract.js-data/chi_sim 1.0.0:
  https://github.com/naptha/tessdata. The npm packages declare MIT; their package
  metadata and README are retained. The underlying Tesseract trained data comes
  from the Apache-2.0 Tesseract tessdata project; only 4.0.0_best_int is included.
- Bundled dependency notices are retained next to the corresponding minified JS.

The Apache-2.0 license texts are in v5/LICENSE-Tesseract.txt and
v5/LICENSE-core.txt. v5/manifest.json records pinned npm sources, original
archive SHA-512 integrity and per-file SHA-256 checksums. These assets retain
their original licenses; they are not relicensed under this project's MIT.
