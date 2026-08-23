  // ── Editor Zoom & Wrap ──────────────────────────────────
  const wrapBtn = document.getElementById('editor-wrap-btn');
  const zoomInBtn = document.getElementById('editor-zoom-in-btn');
  const zoomOutBtn = document.getElementById('editor-zoom-out-btn');
  const replHost = document.querySelector('.repl-host');
  let currentFontSize = 14;

  if (wrapBtn && replHost) {
    wrapBtn.addEventListener('click', () => {
      replHost.classList.toggle('wrap-text');
      wrapBtn.classList.toggle('active');
    });
  }
  if (zoomInBtn && replHost) {
    zoomInBtn.addEventListener('click', () => {
      currentFontSize = Math.min(32, currentFontSize + 2);
      document.documentElement.style.setProperty('--editor-font-size', \\px\);
    });
  }
  if (zoomOutBtn && replHost) {
    zoomOutBtn.addEventListener('click', () => {
      currentFontSize = Math.max(8, currentFontSize - 2);
      document.documentElement.style.setProperty('--editor-font-size', \\px\);
    });
  }
