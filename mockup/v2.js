/* ============================================================
   V2 INTERFACE — Compare Grid
   ============================================================ */

class CompareCanvas {
  constructor(cellEl, onZoomChange) {
    this.cell = cellEl;
    this.canvas = cellEl.querySelector('.mt-compare-cell-canvas');
    this.viewport = cellEl.querySelector('.mt-compare-cell-viewport');
    this.zoomDisplay = cellEl.querySelector('.mt-compare-cell-zoom');
    this.onZoomChange = onZoomChange;
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this._panning = false;
    this._lastX = 0;
    this._lastY = 0;
    this._syncing = false;

    this.canvas.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    this.canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
    this._onMouseMoveBound = this._onMouseMove.bind(this);
    this._onMouseUpBound = this._onMouseUp.bind(this);
  }

  setZoom(level, cx, cy) {
    const old = this.zoom;
    this.zoom = Math.max(0.25, Math.min(2.0, level));
    if (cx != null && cy != null) {
      const d = this.zoom / old;
      this.panX = cx - (cx - this.panX) * d;
      this.panY = cy - (cy - this.panY) * d;
    }
    this.updateTransform();
  }

  setPan(x, y) { this.panX = x; this.panY = y; this.updateTransform(); }

  updateTransform() {
    this.viewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    if (this.zoomDisplay) this.zoomDisplay.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  reset() { this.zoom = 1.0; this.panX = 0; this.panY = 0; this.updateTransform(); }

  _onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY > 0 ? -1 : 1;
      const rect = this.canvas.getBoundingClientRect();
      this.setZoom(this.zoom + delta * 0.1, e.clientX - rect.left, e.clientY - rect.top);
    } else {
      let dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
      this.setPan(this.panX - dx, this.panY - dy);
    }
    if (!this._syncing && this.onZoomChange) this.onZoomChange(this);
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this._panning = true;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    document.addEventListener('mousemove', this._onMouseMoveBound);
    document.addEventListener('mouseup', this._onMouseUpBound);
  }

  _onMouseMove(e) {
    if (!this._panning) return;
    this.setPan(this.panX + e.clientX - this._lastX, this.panY + e.clientY - this._lastY);
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    if (!this._syncing && this.onZoomChange) this.onZoomChange(this);
  }

  _onMouseUp() {
    this._panning = false;
    document.removeEventListener('mousemove', this._onMouseMoveBound);
    document.removeEventListener('mouseup', this._onMouseUpBound);
  }

  destroy() {
    this._onMouseUp();
  }
}

const CompareMode = {
  isOpen: false,
  optionId: null,
  option: null,
  syncZoom: true,
  cells: [],
  overlayEl: null,
  _escHandler: null,
  _layoutSteps: [],
  _layoutIndex: 0,

  buildLayoutSteps(totalVariants) {
    const panelW = window.innerWidth - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-width')) || 340);
    const panelH = window.innerHeight - 48;
    const isLandscape = panelW >= panelH;
    const seen = new Set();
    const steps = [];

    for (let n = 1; n <= totalVariants; n++) {
      let bestCols = 1, bestScore = -Infinity;
      for (let c = 1; c <= n; c++) {
        const r = Math.ceil(n / c);
        const cellW = panelW / c;
        const cellH = panelH / r;
        const cellAspect = cellW / cellH;
        const score = -Math.abs(Math.log(cellAspect / (4 / 3)));
        const bias = isLandscape ? 0.1 * c : -0.1 * c;
        if (score + bias > bestScore) { bestScore = score + bias; bestCols = c; }
      }
      const r = Math.ceil(n / bestCols);
      const key = bestCols + 'x' + r;
      if (!seen.has(key)) {
        seen.add(key);
        steps.push({ cols: bestCols, rows: r, visible: n });
      }
    }
    return steps;
  },

  loadLayoutIndex(optId) {
    const saved = localStorage.getItem(CONFIG.storageKey + '-compare-layout-' + optId);
    return saved !== null ? parseInt(saved, 10) : null;
  },

  saveLayoutIndex() {
    localStorage.setItem(CONFIG.storageKey + '-compare-layout-' + this.optionId, this._layoutIndex);
  },

  autoPickLayout(grid) {
    if (!this.cells.length) return;
    const firstContent = this.cells[0].element.querySelector('.mt-compare-cell-content');
    if (!firstContent) return;
    const clone = firstContent.firstElementChild;
    let contentW = 400, contentH = 300;
    if (clone) {
      const prevMinW = clone.style.minWidth;
      const prevMinH = clone.style.minHeight;
      clone.style.minWidth = '0';
      clone.style.minHeight = '0';
      const intrinsicW = clone.scrollWidth;
      const intrinsicH = clone.scrollHeight;
      clone.style.minWidth = prevMinW;
      clone.style.minHeight = prevMinH;
      if (intrinsicW > 0) contentW = intrinsicW;
      if (intrinsicH > 0) contentH = intrinsicH;
    }

    const toolbar = document.querySelector('.mt-compare-toolbar');
    const toolbarH = toolbar ? toolbar.offsetHeight : 53;
    const panelW = window.innerWidth - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-width')) || 340);
    const totalH = window.innerHeight - toolbarH;
    const padV = 24;
    const gapSize = 12;
    const cellBorder = 2;
    const headerH = 32;

    let bestIdx = 0;
    let bestFitAt100 = -1;
    let bestSubScale = 0;
    let bestSubIdx = 0;
    for (let i = 0; i < this._layoutSteps.length; i++) {
      const step = this._layoutSteps[i];
      const cellW = (panelW - gapSize * (step.cols - 1) - 24) / step.cols;
      const availCellH = (totalH - padV - gapSize * (step.rows - 1) - cellBorder * step.rows) / step.rows - headerH;
      const scaleX = cellW / contentW;
      const scaleY = availCellH / contentH;
      const fitScale = Math.min(scaleX, scaleY);
      if (fitScale >= 1.0) {
        bestFitAt100 = i;
      } else if (fitScale > bestSubScale) {
        bestSubScale = fitScale;
        bestSubIdx = i;
      }
    }
    bestIdx = bestFitAt100 >= 0 ? bestFitAt100 : bestSubIdx;
    this._layoutIndex = bestIdx;
    this.applyLayout(grid);
    this.updateLayoutDisplay();
  },

  applyLayout(grid) {
    const step = this._layoutSteps[this._layoutIndex];
    grid.style.gridTemplateColumns = `repeat(${step.cols}, 1fr)`;
    const toolbar = document.querySelector('.mt-compare-toolbar');
    const toolbarH = toolbar ? toolbar.offsetHeight : 53;
    const padV = 24;
    const gap = 12;
    const cellBorder = 2;
    const availH = window.innerHeight - toolbarH - padV - (gap * (step.rows - 1)) - (cellBorder * step.rows);
    const rowH = Math.floor(availH / step.rows);
    grid.style.gridAutoRows = rowH + 'px';
  },

  updateLayoutDisplay() {
    if (this._colCountDisplay) {
      const step = this._layoutSteps[this._layoutIndex];
      this._colCountDisplay.textContent = step.cols * step.rows;
    }
  },

  open(optId) {
    if (this.isOpen) {
      if (CONFIG.compareOnly) {
        this.destroyGrid();
        document.body.classList.remove('mt-compare-open');
        if (this._escHandler) {
          document.removeEventListener('keydown', this._escHandler);
          this._escHandler = null;
        }
        this.isOpen = false;
      } else {
        this.close();
      }
    }
    const opt = CONFIG.options.find(o => o.id === optId);
    if (!opt || !opt.variants) return;
    this.optionId = optId;
    this.option = opt;
    this.isOpen = true;

    const panel = document.querySelector('options-panel');
    if (panel && !panel.activeOptions.has(optId)) {
      panel.activeOptions.add(optId);
      panel.syncToggles();
      panel.saveState();
      panel.fireOptionsChange();
    }

    if (opt.target && opt.target.view) switchView(opt.target.view);

    this.buildGrid();

    document.body.classList.add('mt-compare-open');

    this._optionsHandler = (e) => {
      const key = e.detail.variants[this.optionId];
      if (key && this.cells) {
        this.cells.forEach(c => {
          const picked = c.key === key;
          c.element.classList.toggle('mt-compare-picked', picked);
          if (picked) c.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    };
    document.querySelector('options-panel').addEventListener('options-change', this._optionsHandler);

    this._escHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    };
    document.addEventListener('keydown', this._escHandler);
  },

  close() {
    if (CONFIG.compareOnly) return;
    if (!this.isOpen) return;
    this.destroyGrid();
    document.body.classList.remove('mt-compare-open');
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    if (this._optionsHandler) {
      const panel = document.querySelector('options-panel');
      if (panel) panel.removeEventListener('options-change', this._optionsHandler);
      this._optionsHandler = null;
    }
    this.isOpen = false;
    this.optionId = null;
    this.option = null;
    this.cells = [];
    this._focusedCell = null;
    this._colCountDisplay = null;
  },

  pick(key) {
    const panel = document.querySelector('options-panel');
    if (panel) {
      panel.optionVariants[this.optionId] = key;
      if (panel.panelMode === 'guide') {
        panel.activeOptions.add(this.optionId);
        panel.guideDecisions[this.optionId] = 'yes';
        panel.syncToggles();
      }
      const body = panel.shadowRoot.querySelector('.panel-body');
      if (body) {
        body.querySelectorAll(`[data-variant-opt="${this.optionId}"]`).forEach(b => {
          b.classList.toggle('selected', b.dataset.variantKey === key);
        });
      }
      panel.saveState();
      panel.fireOptionsChange();
      if (panel.panelMode === 'guide') panel.updateGuide();
    }
    if (CONFIG.compareOnly) {
      this.cells.forEach(c => c.element.classList.toggle('mt-compare-picked', c.key === key));
      return;
    }
    this.close();
  },

  buildGrid() {
    const opt = this.option;
    const variantKeys = Object.keys(opt.variants);
    const targetView = opt.target && opt.target.view
      ? document.getElementById('view-' + opt.target.view)
      : document.querySelector('.mt-view.active');
    const sourceContent = targetView ? targetView.querySelector('.mt-canvas-content') : null;

    const overlay = document.createElement('div');
    overlay.className = 'mt-compare-overlay';

    const toolbar = document.createElement('div');
    toolbar.className = 'mt-compare-toolbar';

    const title = document.createElement('span');
    title.className = 'mt-compare-title';
    title.textContent = opt.name;
    toolbar.appendChild(title);

    const syncLabel = document.createElement('label');
    syncLabel.className = 'mt-compare-sync-label';
    const syncCb = document.createElement('input');
    syncCb.type = 'checkbox';
    syncCb.checked = this.syncZoom;
    syncLabel.appendChild(syncCb);
    syncLabel.appendChild(document.createTextNode('Sync zoom'));
    toolbar.appendChild(syncLabel);

    const zoomControls = document.createElement('div');
    zoomControls.className = 'mt-compare-zoom-controls';
    const zoomOut = document.createElement('button');
    zoomOut.className = 'mt-compare-col-btn';
    zoomOut.textContent = '\u2212';
    zoomOut.title = 'Zoom out';
    const zoomDisplay = document.createElement('span');
    zoomDisplay.className = 'mt-compare-zoom-display';
    zoomDisplay.textContent = '100%';
    const zoomIn = document.createElement('button');
    zoomIn.className = 'mt-compare-col-btn';
    zoomIn.textContent = '+';
    zoomIn.title = 'Zoom in';
    const zoomReset = document.createElement('button');
    zoomReset.className = 'mt-compare-col-btn';
    zoomReset.textContent = '\u27F2';
    zoomReset.title = 'Reset zoom';
    zoomControls.appendChild(zoomOut);
    zoomControls.appendChild(zoomDisplay);
    zoomControls.appendChild(zoomIn);
    zoomControls.appendChild(zoomReset);
    toolbar.appendChild(zoomControls);

    const colControls = document.createElement('div');
    colControls.className = 'mt-compare-col-controls';
    const minusBtn = document.createElement('button');
    minusBtn.className = 'mt-compare-col-btn';
    minusBtn.textContent = '\u2212';
    minusBtn.title = 'Show fewer';
    const colDisplay = document.createElement('span');
    colDisplay.className = 'mt-compare-col-display';
    this._colCountDisplay = colDisplay;
    const plusBtn = document.createElement('button');
    plusBtn.className = 'mt-compare-col-btn';
    plusBtn.textContent = '+';
    plusBtn.title = 'Show more';
    colControls.appendChild(minusBtn);
    colControls.appendChild(colDisplay);
    colControls.appendChild(plusBtn);
    toolbar.appendChild(colControls);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'mt-compare-close-btn';
    closeBtn.textContent = 'Close';
    if (CONFIG.compareOnly) closeBtn.style.display = 'none';
    toolbar.appendChild(closeBtn);

    overlay.appendChild(toolbar);

    syncCb.addEventListener('change', (e) => {
      this.syncZoom = e.target.checked;
      if (this.syncZoom && this.cells.length > 0) {
        this.syncZoomToAll(this.cells[0].canvas);
        zoomDisplay.textContent = `${Math.round(this.cells[0].canvas.zoom * 100)}%`;
      }
    });
    closeBtn.addEventListener('click', () => this.close());

    const applyZoomAction = (fn) => {
      if (this.syncZoom) {
        this.cells.forEach(c => fn(c.canvas));
      } else {
        const target = this._focusedCell || this.cells[0];
        if (target) fn(target.canvas);
      }
      const displayCell = this.syncZoom ? this.cells[0] : (this._focusedCell || this.cells[0]);
      if (displayCell) {
        zoomDisplay.textContent = `${Math.round(displayCell.canvas.zoom * 100)}%`;
      }
    };
    zoomOut.addEventListener('click', () => {
      applyZoomAction(c => c.setZoom(c.zoom - 0.1));
    });
    zoomIn.addEventListener('click', () => {
      applyZoomAction(c => c.setZoom(c.zoom + 0.1));
    });
    zoomReset.addEventListener('click', () => {
      applyZoomAction(c => c.reset());
    });

    this._layoutSteps = this.buildLayoutSteps(variantKeys.length);
    const savedIdx = this.loadLayoutIndex(this.optionId);
    this._autoLayout = (savedIdx === null);
    if (savedIdx !== null && savedIdx >= 0 && savedIdx < this._layoutSteps.length) {
      this._layoutIndex = savedIdx;
    } else {
      this._layoutIndex = this._layoutSteps.length - 1;
    }

    minusBtn.addEventListener('click', () => {
      if (this._layoutIndex <= 0) return;
      this._layoutIndex--; this.saveLayoutIndex(); this.applyLayout(grid); this.updateLayoutDisplay();
    });
    plusBtn.addEventListener('click', () => {
      if (this._layoutIndex >= this._layoutSteps.length - 1) return;
      this._layoutIndex++; this.saveLayoutIndex(); this.applyLayout(grid); this.updateLayoutDisplay();
    });

    const grid = document.createElement('div');
    grid.className = 'mt-compare-grid';
    this.applyLayout(grid);
    this.updateLayoutDisplay();
    this._resizeHandler = () => {
      const oldVisible = this._layoutSteps[this._layoutIndex].visible;
      this._layoutSteps = this.buildLayoutSteps(variantKeys.length);
      this._layoutIndex = this._layoutSteps.findIndex(s => s.visible >= oldVisible);
      if (this._layoutIndex < 0) this._layoutIndex = this._layoutSteps.length - 1;
      this.applyLayout(grid);
      this.updateLayoutDisplay();
    };
    window.addEventListener('resize', this._resizeHandler);
    overlay.appendChild(grid);

    this.cells = [];
    variantKeys.forEach(key => {
      const label = opt.variants[key];
      const cell = document.createElement('div');
      cell.className = 'mt-compare-cell';

      const header = document.createElement('div');
      header.className = 'mt-compare-cell-header';

      const cellLabel = document.createElement('span');
      cellLabel.className = 'mt-compare-cell-label';
      cellLabel.textContent = label;
      header.appendChild(cellLabel);

      const zoomDisp = document.createElement('span');
      zoomDisp.className = 'mt-compare-cell-zoom';
      zoomDisp.textContent = '100%';
      header.appendChild(zoomDisp);

      cell.appendChild(header);

      let downX, downY;
      cell.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
      cell.addEventListener('pointerup', (e) => {
        if (Math.abs(e.clientX - downX) < 5 && Math.abs(e.clientY - downY) < 5) this.pick(key);
      });

      const canvasArea = document.createElement('div');
      const _savedBg = localStorage.getItem(CONFIG.storageKey + '-canvas-bg') || ((CONFIG.canvas || {}).grid === false ? 'none' : 'checker');
      const _savedSize = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-size') || 'md';
      const _savedColor = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-color');
      const _savedOpacity = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-opacity');
      const _savedBlend = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-blend');
      canvasArea.className = 'mt-compare-cell-canvas mt-bg-' + _savedBg + (_savedBg !== 'none' ? ' mt-bg-' + _savedSize : '');
      if (_savedColor) canvasArea.style.setProperty('--bg-color', _savedColor);
      canvasArea.style.setProperty('--bg-opacity', _savedOpacity || '0.1');
      if (_savedBlend) canvasArea.style.setProperty('--bg-blend', _savedBlend);
      const viewport = document.createElement('div');
      viewport.className = 'mt-compare-cell-viewport';
      const content = document.createElement('div');
      content.className = 'mt-compare-cell-content';

      if (sourceContent) {
        const freshClone = sourceContent.cloneNode(true);
        const targetEl = opt.target && opt.target.el;

        if (targetEl) {
          CONFIG.options.forEach(other => {
            if (other.target && other.target.el && other.target.el !== targetEl) {
              const otherEl = freshClone.querySelector(`#${CSS.escape(other.target.el)}`);
              if (otherEl) otherEl.classList.add('mt-hidden');
            }
          });

          const targetInClone = freshClone.querySelector(`#${CSS.escape(targetEl)}`);
          if (targetInClone) targetInClone.classList.remove('mt-hidden');

          variantKeys.forEach(vk => {
            const varEl = freshClone.querySelector(`#${CSS.escape(targetEl + '-' + vk)}`);
            if (varEl) varEl.style.display = (vk === key) ? '' : 'none';
          });

          // baseHtml: wrap variant content in shared layout
          // Note: baseHtml is developer-authored content from the same-origin mockup config (trusted)
          if (opt.baseHtml) {
            const baseContainer = document.createElement('div');
            baseContainer.innerHTML = opt.baseHtml; // eslint-disable-line no-unsanitized/property -- trusted developer content from CONFIG
            const slot = baseContainer.querySelector('[data-variant]');
            if (slot) {
              const visibleVariant = freshClone.querySelector(`#${CSS.escape(targetEl + '-' + key)}`);
              if (visibleVariant) {
                while (visibleVariant.firstChild) slot.appendChild(visibleVariant.firstChild);
                slot.removeAttribute('data-variant');
              }
            }
            const targetInClone2 = freshClone.querySelector(`#${CSS.escape(targetEl)}`);
            if (targetInClone2) {
              targetInClone2.textContent = '';
              while (baseContainer.firstChild) targetInClone2.appendChild(baseContainer.firstChild);
            }
          }
        }

        freshClone.querySelectorAll(':scope > h1, :scope > h2, :scope > p').forEach(el => {
          if (!el.querySelector('[id]')) el.remove();
        });

        freshClone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        freshClone.removeAttribute('id');

        content.appendChild(freshClone);
      }

      viewport.appendChild(content);
      canvasArea.appendChild(viewport);
      cell.appendChild(canvasArea);
      grid.appendChild(cell);

      const cellObj = { key, label, canvas: null, element: cell };
      const cc = new CompareCanvas(cell, (source) => {
        this._focusedCell = cellObj;
        if (this.syncZoom) this.syncZoomToAll(source);
        zoomDisplay.textContent = `${Math.round(source.zoom * 100)}%`;
      });
      cellObj.canvas = cc;
      this.cells.push(cellObj);
    });

    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    if (this._autoLayout) {
      this.autoPickLayout(grid);
    }
  },

  destroyGrid() {
    this.cells.forEach(c => c.canvas.destroy());
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  },

  syncZoomToAll(source) {
    this.cells.forEach(c => {
      if (c.canvas === source || c.canvas._syncing) return;
      c.canvas._syncing = true;
      c.canvas.zoom = source.zoom;
      c.canvas.panX = source.panX;
      c.canvas.panY = source.panY;
      c.canvas.updateTransform();
      c.canvas._syncing = false;
    });
  },
};

// Register as engine interface
window._engineInterface = {
  init(config) {
    // Canvas DOM structure already set up by engine.js initCanvasViews()
    // Auto-open compare mode on boot — use guide step if available
    if (config.options.length > 0) {
      const panel = document.querySelector('options-panel');
      const guideStep = panel ? panel.guideStep : 0;
      const opt = config.options[guideStep] || config.options[0];
      if (opt) CompareMode.open(opt.id);
    }
  },
  open(optId) { CompareMode.open(optId); },
  close() { CompareMode.close(); },
  pick(key) { CompareMode.pick(key); },
  get isOpen() { return CompareMode.isOpen; },
  get optionId() { return CompareMode.optionId; },
};
