/* ============================================================
   V1 INTERFACE — Canvas Workspace
   ============================================================ */

class CanvasWorkspace {
  constructor(container, config = {}) {
    this.container = container;
    this.viewport = container.querySelector('.mt-canvas-viewport');
    this.content = container.querySelector('.mt-canvas-content');
    if (!this.viewport || !this.content) {
      console.error('[engine] Canvas workspace requires .mt-canvas-viewport and .mt-canvas-content elements');
      return;
    }
    this.config = {
      minZoom: config.minZoom || 0.25,
      maxZoom: config.maxZoom || 2.0,
      zoomStep: config.zoomStep || 0.1,
      fineZoomStep: config.fineZoomStep || 0.02,
      storageKey: config.storageKey || 'mockup-canvas-state'
    };
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.isSpaceHeld = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this._pinchStartDist = 0;
    this._pinchStartZoom = 1;
    this._pinchCenter = null;
    this._touchPanning = false;
    this._lastTouchX = 0;
    this._lastTouchY = 0;
    this.attachEventListeners();
    if (!this.loadState()) {
      this.centerContent();
    }
    this.updateTransform();
    this.updateZoomUI();
  }

  setZoom(level, centerX = null, centerY = null) {
    const oldZoom = this.zoom;
    this.zoom = Math.max(this.config.minZoom, Math.min(this.config.maxZoom, level));
    if (centerX !== null && centerY !== null) {
      const zoomDelta = this.zoom / oldZoom;
      this.panX = centerX - (centerX - this.panX) * zoomDelta;
      this.panY = centerY - (centerY - this.panY) * zoomDelta;
    }
    this.updateTransform();
    this.updateZoomUI();
    this.saveState();
  }

  zoomIn() {
    const r = this.container.getBoundingClientRect();
    this.setZoom(this.zoom + this.config.zoomStep, r.width / 2, r.height / 2);
  }
  zoomOut() {
    const r = this.container.getBoundingClientRect();
    this.setZoom(this.zoom - this.config.zoomStep, r.width / 2, r.height / 2);
  }

  centerContent() {
    const vRect = this.container.getBoundingClientRect();
    const cw = this.content.scrollWidth;
    const ch = this.content.scrollHeight;
    this.panX = (vRect.width - cw * this.zoom) / 2;
    this.panY = (vRect.height - ch * this.zoom) / 2;
  }

  reset() {
    const r = this.container.getBoundingClientRect();
    const oldZoom = this.zoom;
    this.zoom = 1.0;
    if (oldZoom !== 1.0) {
      const zoomDelta = this.zoom / oldZoom;
      const centerX = r.width / 2;
      const centerY = r.height / 2;
      this.panX = centerX - (centerX - this.panX) * zoomDelta;
      this.panY = centerY - (centerY - this.panY) * zoomDelta;
    }
    this.container.scrollTop = 0;
    this.container.scrollLeft = 0;
    this.updateTransform();
    this.updateZoomUI();
    this.saveState();
  }

  setPan(x, y) {
    const vw = this.container.clientWidth;
    const vh = this.container.clientHeight;
    const cw = this.content.scrollWidth * this.zoom;
    const ch = this.content.scrollHeight * this.zoom;
    const margin = 0.1;
    this.panX = Math.max(-cw * (1 - margin), Math.min(vw * (1 - margin), x));
    this.panY = Math.max(-ch * (1 - margin), Math.min(vh * (1 - margin), y));
    this.updateTransform();
    this.saveState();
  }

  updateTransform() {
    if (this.viewport) {
      this.viewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }
  }

  updateZoomUI() {
    const zoomLevel = this.container.querySelector('.mt-zoom-level');
    if (zoomLevel) zoomLevel.textContent = `${Math.round(this.zoom * 100)}%`;
    const zoomInBtn = this.container.querySelector('[data-zoom-in]');
    const zoomOutBtn = this.container.querySelector('[data-zoom-out]');
    if (zoomInBtn) zoomInBtn.disabled = this.zoom >= this.config.maxZoom;
    if (zoomOutBtn) zoomOutBtn.disabled = this.zoom <= this.config.minZoom;
  }

  saveState() {
    try {
      localStorage.setItem(this.config.storageKey, JSON.stringify({
        zoom: this.zoom, panX: this.panX, panY: this.panY
      }));
    } catch (e) { /* quota exceeded */ }
  }

  loadState() {
    try {
      const saved = localStorage.getItem(this.config.storageKey);
      if (saved) {
        const state = JSON.parse(saved);
        this.zoom = state.zoom || 1.0;
        this.panX = state.panX !== undefined ? state.panX : 0;
        this.panY = state.panY !== undefined ? state.panY : 0;
        return true;
      }
    } catch (e) { /* corrupted data */ }
    return false;
  }

  attachEventListeners() {
    this.container.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
    this.container.addEventListener('dblclick', this.handleDoubleClick.bind(this));
    this.container.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.container.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    this.container.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    this.container.addEventListener('touchend', this.handleTouchEnd.bind(this));
    document.addEventListener('mousemove', this.handleMouseMove.bind(this));
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.isSpaceHeld) {
        this.isSpaceHeld = false;
        this.container.classList.remove('mt-space-held');
      }
    });
    const zoomInBtn = this.container.querySelector('[data-zoom-in]');
    const zoomOutBtn = this.container.querySelector('[data-zoom-out]');
    const resetBtn = this.container.querySelector('[data-zoom-reset]');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomIn());
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomOut());
    if (resetBtn) resetBtn.addEventListener('click', () => this.reset());
  }

  handleWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY > 0 ? -1 : 1;
      const step = e.altKey ? this.config.fineZoomStep : this.config.zoomStep;
      const rect = this.container.getBoundingClientRect();
      this.setZoom(this.zoom + (delta * step), e.clientX - rect.left, e.clientY - rect.top);
    } else {
      let dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
      else if (e.deltaMode === 2) { dx *= 100; dy *= 100; }
      this.setPan(this.panX - dx, this.panY - dy);
    }
  }

  handleDoubleClick(e) {
    if (e.target === this.container || e.target === this.viewport || e.target === this.content) {
      this.reset();
    }
  }

  handleMouseDown(e) {
    const isEmptySpace = e.target === this.container || e.target === this.viewport || e.target === this.content;
    if (e.button === 1 || (e.button === 0 && (isEmptySpace || this.isSpaceHeld))) {
      e.preventDefault();
      this.isPanning = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.container.classList.add('mt-panning');
    }
  }

  handleMouseMove(e) {
    if (this.isPanning) {
      this.setPan(this.panX + e.clientX - this.lastMouseX, this.panY + e.clientY - this.lastMouseY);
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }
  }

  handleMouseUp() {
    if (this.isPanning) {
      this.isPanning = false;
      this.container.classList.remove('mt-panning');
    }
  }

  handleKeyDown(e) {
    if (!this.container.classList.contains('active')) return;
    if (e.code === 'Space' && !this.isSpaceHeld && !this.isInputFocused()) {
      e.preventDefault();
      this.isSpaceHeld = true;
      this.container.classList.add('mt-space-held');
    }
    if ((e.ctrlKey || e.metaKey) && !this.isInputFocused()) {
      if (e.key === '=' || e.key === '+') { e.preventDefault(); this.zoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); this.zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); this.reset(); }
      else if (e.key === '1') {
        e.preventDefault();
        const r = this.container.getBoundingClientRect();
        this.setZoom(1.0, r.width / 2, r.height / 2);
      }
      else if (e.key === '9') {
        e.preventDefault();
        const r = this.container.getBoundingClientRect();
        this.setZoom(this.config.maxZoom, r.width / 2, r.height / 2);
      }
    }
  }

  handleKeyUp(e) {
    if (e.code === 'Space' && this.isSpaceHeld) {
      this.isSpaceHeld = false;
      this.container.classList.remove('mt-space-held');
    }
  }

  handleTouchStart(e) {
    const touches = e.touches;
    if (touches.length === 2) {
      e.preventDefault();
      this._pinchStartDist = this._getTouchDistance(touches);
      this._pinchStartZoom = this.zoom;
      this._pinchCenter = this._getTouchCenter(touches);
    } else if (touches.length === 1) {
      const t = touches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY);
      const isCanvas = target && (target === this.container || target.closest('.mt-view') === this.container);
      if (isCanvas) {
        e.preventDefault();
        this._touchPanning = true;
        this._lastTouchX = t.clientX;
        this._lastTouchY = t.clientY;
      }
    }
  }

  handleTouchMove(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = this._getTouchDistance(e.touches);
      const scale = dist / this._pinchStartDist;
      const newZoom = this._pinchStartZoom * scale;
      const center = this._getTouchCenter(e.touches);
      const rect = this.container.getBoundingClientRect();
      this.setZoom(newZoom, center.x - rect.left, center.y - rect.top);
    } else if (this._touchPanning && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      this.setPan(
        this.panX + t.clientX - this._lastTouchX,
        this.panY + t.clientY - this._lastTouchY
      );
      this._lastTouchX = t.clientX;
      this._lastTouchY = t.clientY;
    }
  }

  handleTouchEnd(e) {
    if (e.touches.length < 2) {
      this._pinchStartDist = 0;
    }
    if (e.touches.length === 0) {
      this._touchPanning = false;
    }
  }

  _getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _getTouchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  isInputFocused() { return isInputFocused(); }
}

// Register as engine interface
window._engineInterface = {
  init(config) {
    // Canvas DOM structure already set up by engine.js initCanvasViews()
    // Add zoom controls and CanvasWorkspace interactivity
    const canvasCfg = config.canvas || {};
    document.querySelectorAll('.mt-view').forEach(viewEl => {
      const viewId = viewEl.id.replace('view-', '');
      // Inject zoom controls
      const controls = document.createElement('div');
      controls.className = 'mt-zoom-controls';
      controls.textContent = '';
      const zoomOutBtn = document.createElement('button');
      zoomOutBtn.setAttribute('data-zoom-out', '');
      zoomOutBtn.setAttribute('aria-label', 'Zoom out');
      zoomOutBtn.textContent = '\u2212';
      const zoomLevel = document.createElement('div');
      zoomLevel.className = 'mt-zoom-level';
      zoomLevel.textContent = '100%';
      const zoomInBtn = document.createElement('button');
      zoomInBtn.setAttribute('data-zoom-in', '');
      zoomInBtn.setAttribute('aria-label', 'Zoom in');
      zoomInBtn.textContent = '+';
      const resetBtn = document.createElement('button');
      resetBtn.setAttribute('data-zoom-reset', '');
      resetBtn.setAttribute('aria-label', 'Reset zoom');
      resetBtn.textContent = '\u27F2';
      controls.appendChild(zoomOutBtn);
      controls.appendChild(zoomLevel);
      controls.appendChild(zoomInBtn);
      controls.appendChild(resetBtn);
      viewEl.appendChild(controls);

      // Instantiate workspace
      const storageKey = `${config.storageKey}-canvas-${viewId}`;
      const workspace = new CanvasWorkspace(viewEl, {
        ...canvasCfg,
        storageKey
      });
      viewEl._canvasWorkspace = workspace;
    });
  },
  open() {},
  close() {},
  pick() {},
  get isOpen() { return false; },
  get optionId() { return null; },
};
