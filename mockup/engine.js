/* ============================================================
   ENGINE CODE — Do not modify
   ============================================================ */

const ENGINE_VERSION = '0.12';

// --- Dynamic interface loader ---
const _scriptBase = document.currentScript.src.replace(/\/[^/]+$/, '/');

function loadInterface(version) {
  // Load CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = _scriptBase + version + '.css';
  document.head.appendChild(link);
  // Load JS (returns promise)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = _scriptBase + version + '.js';
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
}

// --- Light DOM helpers for applyOptions ---
function toggle(elementId, show) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (show) {
    el.classList.remove('mt-hidden');
  } else {
    el.classList.add('mt-hidden');
  }
}

function toggleVariant(els, active, chosenVariant) {
  const isPreview = window._isPreview;
  Object.entries(els).forEach(([key, elId]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (isPreview) {
      // Crossfade mode: stack variants absolutely, fade with opacity
      const parent = el.parentElement;
      if (parent && !parent._mtCrossfadeSetup) {
        parent.style.position = 'relative';
        parent._mtCrossfadeSetup = true;
      }
      el.style.display = '';
      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.left = '0';
      el.style.width = '100%';
      el.style.transition = 'opacity 200ms ease';
      if (active && key === chosenVariant) {
        el.style.opacity = '1';
        el.style.pointerEvents = '';
      } else {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
    } else {
      // Normal mode: display toggle, clean up crossfade styles
      if (el._mtWasCrossfade) {
        el.style.position = '';
        el.style.top = '';
        el.style.left = '';
        el.style.width = '';
        el.style.transition = '';
        el.style.opacity = '';
        el.style.pointerEvents = '';
        el._mtWasCrossfade = false;
        if (el.parentElement && el.parentElement._mtCrossfadeSetup) {
          el.parentElement.style.position = '';
          el.parentElement._mtCrossfadeSetup = false;
        }
      }
      if (active && key === chosenVariant) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    }
    if (isPreview) el._mtWasCrossfade = true;
  });
}

function clearHighlight() {
  const el = document.querySelector('.mt-highlight');
  if (el) el.classList.remove('mt-highlight');
}

function isInputFocused() {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return true;
  const shadowActive = active?.shadowRoot?.activeElement;
  if (shadowActive && (shadowActive.tagName === 'INPUT' || shadowActive.tagName === 'TEXTAREA')) return true;
  return false;
}

// --- View switching ---
function switchView(viewId) {
  document.querySelectorAll('.mt-view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.mt-tab').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');
  const tab = document.getElementById('mt-view-tabs').querySelector(`[data-view="${viewId}"]`);
  if (tab) tab.classList.add('active');
  if (target && target._canvasWorkspace) target._canvasWorkspace.updateTransform();
  // Persist active view
  const panel = document.querySelector('options-panel');
  if (panel) panel.saveState();
}

// --- View Tabs ---
function initTabs() {
  const viewTabs = document.getElementById('mt-view-tabs');
  if (CONFIG.views.length <= 1 || CONFIG._originalCompareOnly) {
    viewTabs.classList.add('mt-tabs-hidden');
    if (CONFIG._originalCompareOnly) return;
  }
  CONFIG.views.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'mt-tab' + (document.getElementById('view-' + v.id)?.classList.contains('active') ? ' active' : '');
    btn.textContent = v.label;
    btn.dataset.view = v.id;
    btn.addEventListener('click', () => {
      switchView(v.id);
      if (CONFIG.compareOnly) {
        const firstOpt = CONFIG.options.find(o => o.target && o.target.view === v.id);
        if (firstOpt && window._engineInterface) window._engineInterface.open(firstOpt.id);
      }
    });
    viewTabs.appendChild(btn);
  });
}


/* ============================================================
   WEB COMPONENT: <options-panel>
   ============================================================ */
class OptionsPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.activeOptions = new Set();
    this.optionNotes = {};
    this.optionVariants = {};
    this.panelWidth = 340;
    this.panelCollapsed = false;
    this.panelMode = 'guide';
    this.guideStep = 0;
    this.guideDecisions = {};
    this.helpOverlayOpen = false;
    this.hoverExpanded = false;
    this._previewActive = null;    // Set or null
    this._previewVariants = null;  // Object or null
    this._isMobile = window.matchMedia('(max-width: 768px)').matches;
    this._sheetExpanded = true;
    this._copyPreviewOpen = false;
  }

  connectedCallback() {
    this.loadState();
    this.initDefaultVariants();
    this.render();
    this.bindEvents();
    this.applyPanelLayout();
    // Defer initial fire so boot code can attach listener first
    queueMicrotask(() => this.fireOptionsChange());
    // Auto-dismiss hint after 8 seconds
    setTimeout(() => this.dismissHint(), 8000);
  }

  // --- State Persistence ---
  saveState() {
    // Capture collapsed groups from DOM
    const collapsedGroups = [];
    if (this.shadowRoot) {
      this.shadowRoot.querySelectorAll('.group-label.collapsed').forEach(el => {
        collapsedGroups.push(el.dataset.group);
      });
    }
    // Capture active view tab
    const activeViewEl = document.querySelector('.mt-view.active');
    const activeView = activeViewEl ? activeViewEl.id.replace('view-', '') : null;
    const state = {
      active: [...this.activeOptions],
      notes: this.optionNotes,
      variants: this.optionVariants,
      panelWidth: this.panelWidth,
      panelCollapsed: this.panelCollapsed,
      panelMode: this.panelMode,
      guideStep: this.guideStep,
      guideDecisions: this.guideDecisions,
      collapsedGroups,
      activeView,
    };
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(state));
    } catch (e) { /* quota exceeded */ }
  }

  loadState() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state.active) this.activeOptions = new Set(state.active);
      if (state.notes) this.optionNotes = state.notes;
      if (state.variants) this.optionVariants = state.variants;
      if (state.panelWidth) this.panelWidth = state.panelWidth;
      if (typeof state.panelCollapsed === 'boolean') this.panelCollapsed = state.panelCollapsed;
      if (state.panelMode) this.panelMode = state.panelMode;
      if (typeof state.guideStep === 'number') this.guideStep = state.guideStep;
      if (state.guideDecisions) this.guideDecisions = state.guideDecisions;
      if (state.collapsedGroups) this._pendingCollapsedGroups = state.collapsedGroups;
      if (state.activeView) this._pendingActiveView = state.activeView;
    } catch (e) { /* corrupted data */ }
  }

  initDefaultVariants() {
    CONFIG.options.forEach(opt => {
      if (opt.variants && !this.optionVariants[opt.id]) {
        this.optionVariants[opt.id] = opt.defaultVariant || Object.keys(opt.variants)[0];
      }
    });
  }

  // --- SVG icons ---
  static chevron(dir) {
    const d = dir === 'left' ? 'M10 3l-5 5 5 5' : 'M6 3l5 5-5 5';
    return `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // --- Rendering ---
  render() {
    this.shadowRoot.innerHTML = `<style>${this.getStyles()}</style>
    <div class="panel">
      <div class="panel-drag-handle"><div class="handle-bar"></div></div>
      <div class="panel-resize-handle"></div>
      <div class="panel-toolbar">
        <button class="panel-collapse-btn" title="Collapse panel">${OptionsPanel.chevron('right')}</button>
        <div class="mode-pill">
          <button class="mode-pill-btn${this.panelMode === 'guide' ? ' active' : ''}" data-mode="guide">Guide</button>
          <button class="mode-pill-btn${this.panelMode === 'list' ? ' active' : ''}" data-mode="list">List</button>
        </div>
        <button class="panel-help-btn" title="Help & About">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><text x="8" y="11.5" text-anchor="middle" fill="currentColor" font-size="9" font-weight="600" font-family="system-ui">?</text></svg>
        </button>
      </div>
      <div class="panel-header">
        <h2><span class="panel-title">${this.esc(CONFIG.title)}</span> <span class="active-count">${this.activeOptions.size}</span></h2>
        <div class="panel-hint">Press <kbd>?</kbd> for shortcuts</div>
      </div>
      <div class="guide-view" style="${this.panelMode === 'guide' ? '' : 'display:none'}">
        <div class="guide-progress">
          <div class="guide-progress-bar"><div class="guide-progress-fill"></div></div>
          <div class="guide-progress-text"></div>
        </div>
        <div class="guide-card">
          <div class="guide-step-label"></div>
          <div class="guide-option-name-row">
            <span class="guide-option-name"></span>
            <span class="guide-recommended-badge" style="display:none">Recommended</span>
          </div>
          <div class="guide-option-desc"></div>
          <div class="guide-variants-section">
            <div class="guide-section-label">Choose style</div>
            <div class="guide-variant-cards"></div>
            <div class="guide-generate-card" tabindex="0" role="button">
              <div class="guide-generate-label">+ Generate more variants</div>
              <div class="guide-generate-hint">Describe what you want</div>
            </div>
            <div class="guide-skip-card" tabindex="0" role="button" data-gv-key="__skip__">
              <div class="guide-variant-label">Don\u2019t include</div>
            </div>
          </div>
          <div class="guide-notes-section" style="display:none">
            <textarea class="guide-notes-textarea" placeholder="Describe the variants you want generated..."></textarea>
          </div>
        </div>
        <div class="guide-summary" style="display:none">
          <div class="guide-summary-heading">All done!</div>
          <div class="guide-summary-sub">Here's a summary of your choices.</div>
          <div class="guide-summary-list"></div>
        </div>
      </div>
      <div class="guide-footer" style="${this.panelMode === 'guide' ? '' : 'display:none'}">
        <div class="guide-nav">
          <button class="guide-nav-back">&#8592; Back</button>
          <button class="guide-nav-next">Next &#8594;</button>
        </div>
      </div>
      <div class="list-view" style="${this.panelMode === 'list' ? '' : 'display:none'}">
        <div class="panel-body">
          ${this.renderCombos()}
          ${this.renderOptions()}
        </div>
      </div>
      <div class="copy-footer" style="${this.panelMode === 'list' ? '' : 'display:none'}">
        <button class="btn-copy">Copy Prompt</button>
        <button class="btn-reset">Reset</button>
      </div>
    </div>
    <div class="help-overlay" style="display:none">
      <div class="help-overlay-backdrop"></div>
      <div class="help-overlay-modal">
        <div class="help-modal-sidebar">
          <button class="help-tab active" data-tab="shortcuts">
            <svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M160-200q-33 0-56.5-23.5T80-280v-400q0-33 23.5-56.5T160-760h640q33 0 56.5 23.5T880-680v400q0 33-23.5 56.5T800-200H160Zm0-80h640v-400H160v400Zm160-40h320v-80H320v80ZM200-440h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80ZM200-560h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80ZM160-280v-400 400Z"/></svg>
            <span>Shortcuts</span>
          </button>
          <button class="help-tab" data-tab="settings">
            <svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></svg>
            <span>Settings</span>
          </button>
          <button class="help-tab" data-tab="about">
            <svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-280h80v-240h-80v240Zm68.5-331.5Q520-623 520-640t-11.5-28.5Q497-680 480-680t-28.5 11.5Q440-657 440-640t11.5 28.5Q463-600 480-600t28.5-11.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>
            <span>About</span>
          </button>
        </div>
        <div class="help-modal-content">
          <div class="help-modal-header">
            <span class="help-modal-title">Shortcuts</span>
            <button class="help-settings-reset" title="Reset canvas settings to defaults" style="display:none">
              <svg xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor"><path d="M480-400q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0 280q-139 0-241-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Z"/></svg>
            </button>
            <button class="help-modal-dismiss"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg></button>
          </div>
          <div class="help-tab-panel active" data-panel="shortcuts">
            <div class="help-overlay-row">
              <span class="help-overlay-action">Show/hide this help</span>
              <kbd class="help-overlay-key">?</kbd>
            </div>
            <div class="help-overlay-row">
              <span class="help-overlay-action">Close overlay/modal</span>
              <kbd class="help-overlay-key">Esc</kbd>
            </div>
            <div class="help-overlay-row">
              <span class="help-overlay-action">Pan mode (hold)</span>
              <kbd class="help-overlay-key">Space</kbd>
            </div>
            <div class="help-overlay-row">
              <span class="help-overlay-action">Zoom in</span>
              <kbd class="help-overlay-key">Ctrl/Cmd + =</kbd>
            </div>
            <div class="help-overlay-row">
              <span class="help-overlay-action">Zoom out</span>
              <kbd class="help-overlay-key">Ctrl/Cmd + -</kbd>
            </div>
            <div class="help-overlay-row">
              <span class="help-overlay-action">Reset zoom & pan</span>
              <kbd class="help-overlay-key">Ctrl/Cmd + 0</kbd>
            </div>
            <div class="help-overlay-row">
              <span class="help-overlay-action">Zoom to 100%</span>
              <kbd class="help-overlay-key">Ctrl/Cmd + 1</kbd>
            </div>
            <div class="help-overlay-row">
              <span class="help-overlay-action">Zoom to maximum</span>
              <kbd class="help-overlay-key">Ctrl/Cmd + 9</kbd>
            </div>
            <div class="help-overlay-row">
              <span class="help-overlay-action">Reset zoom & pan</span>
              <kbd class="help-overlay-key">Double-click</kbd>
            </div>
          </div>
          <div class="help-tab-panel" data-panel="settings">
            <div class="help-info-grid">
              <div class="help-info-item">
                <div class="help-info-label">Background Color</div>
                <div class="help-info-value">
                  <div class="help-bg-color-row">
                    <input type="color" class="help-bg-color-input" value="#f3f4f6">
                    <button class="help-bg-color-reset">Reset</button>
                  </div>
                </div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Pattern</div>
                <div class="help-info-value">
                  <div class="help-bg-picker">
                    <button data-bg="checker">Checker</button>
                    <button data-bg="grid">Grid</button>
                    <button data-bg="dots">Dots</button>
                    <button data-bg="none">None</button>
                  </div>
                </div>
              </div>
              <div class="help-info-item help-bg-pattern-row">
                <div class="help-info-label">Pattern Size</div>
                <div class="help-info-value">
                  <div class="help-bg-picker help-bg-size-picker">
                    <button data-bg-size="sm">S</button>
                    <button data-bg-size="md">M</button>
                    <button data-bg-size="lg">L</button>
                    <button data-bg-size="xl">XL</button>
                  </div>
                </div>
              </div>
              <div class="help-info-item help-bg-pattern-row">
                <div class="help-info-label">Pattern Opacity</div>
                <div class="help-info-value">
                  <input type="range" class="help-bg-opacity" min="0" max="0.5" step="0.05" value="0.1">
                </div>
              </div>
              <div class="help-info-item help-bg-pattern-row">
                <div class="help-info-label">Blend Mode</div>
                <div class="help-info-value">
                  <select class="help-bg-blend-select">
                    <option value="normal">Normal</option>
                    <option value="multiply">Multiply</option>
                    <option value="screen">Screen</option>
                    <option value="overlay">Overlay</option>
                    <option value="darken">Darken</option>
                    <option value="lighten">Lighten</option>
                    <option value="color-dodge">Color Dodge</option>
                    <option value="color-burn">Color Burn</option>
                    <option value="hard-light">Hard Light</option>
                    <option value="soft-light">Soft Light</option>
                    <option value="difference">Difference</option>
                    <option value="exclusion">Exclusion</option>
                    <option value="hue">Hue</option>
                    <option value="saturation">Saturation</option>
                    <option value="color">Color</option>
                    <option value="luminosity">Luminosity</option>
                  </select>
                </div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Interface</div>
                <div class="help-info-value">
                  <select class="help-interface-select">
                    <option value="v1">v1 — Canvas</option>
                    <option value="v2">v2 — Compare Grid</option>
                  </select>
                </div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Saved State</div>
                <div class="help-info-value help-diagnostic-storage"></div>
              </div>
            </div>
            <button class="help-reset-btn">Reset All State</button>
          </div>
          <div class="help-tab-panel" data-panel="about">
            <div class="help-info-grid">
              <div class="help-info-item">
                <div class="help-info-label">Engine Version</div>
                <div class="help-info-value">v${ENGINE_VERSION}</div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Mockup Title</div>
                <div class="help-info-value">${this.esc(CONFIG.title)}</div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">File Path</div>
                <div class="help-info-value help-info-filepath"></div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Storage Key</div>
                <div class="help-info-value">${CONFIG.storageKey}</div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Total Options</div>
                <div class="help-info-value">${CONFIG.options.length}</div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Active Options</div>
                <div class="help-info-value help-info-active-count"></div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Browser</div>
                <div class="help-info-value help-diagnostic-browser"></div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Viewport</div>
                <div class="help-info-value help-diagnostic-viewport"></div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Device Type</div>
                <div class="help-info-value help-diagnostic-device"></div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Canvas Zoom</div>
                <div class="help-info-value help-diagnostic-zoom"></div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">Repository</div>
                <div class="help-info-value"><a href="https://github.com/moongopher/ui-studio" target="_blank" rel="noopener">moongopher/ui-studio</a></div>
              </div>
              <div class="help-info-item">
                <div class="help-info-label">CDN</div>
                <div class="help-info-value"><a href="https://github.com/moongopher/ui-studio-cdn" target="_blank" rel="noopener">moongopher/ui-studio-cdn</a></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="copy-preview-overlay" style="display:none">
      <div class="copy-preview-backdrop"></div>
      <div class="copy-preview-modal">
        <div class="copy-preview-header">
          <span style="font-size:var(--text-lg);font-weight:700;">Prompt Preview</span>
          <button class="copy-preview-close-btn">Close</button>
        </div>
        <div class="copy-preview-body"><pre class="copy-preview-text"></pre></div>
        <div class="copy-preview-footer">
          <button class="copy-preview-copy-btn">Copy to Clipboard</button>
        </div>
      </div>
    </div>`;

  }

  getStyles() {
    return `
    :host {
      --icon-recommended: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M360-240h220q17 0 31.5-8.5T632-272l84-196q2-5 3-10t1-10v-32q0-17-11.5-28.5T680-560H496l24-136q2-10-1-19t-10-16l-29-29-184 200q-8 8-12 18t-4 22v200q0 33 23.5 56.5T360-240ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z'/%3E%3C/svg%3E");
      display: block;
      position: fixed;
      top: 0;
      right: 0;
      height: 100vh;
      width: 340px;
      z-index: 100;
      overflow: hidden;
      transition: width var(--t-slide);
    }
    .panel {
      width: 100%;
      height: 100%;
      background: var(--c-surface);
      border-left: 1px solid var(--c-border);
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-panel);
      transition: transform var(--t-normal), box-shadow var(--t-normal);
      overflow: hidden;
      position: relative;
    }
    .panel.collapsed {
      /* width controlled by :host transition */
    }
    .panel.collapsed .panel-header,
    .panel.collapsed .guide-view,
    .panel.collapsed .list-view,
    .panel.collapsed .guide-footer,
    .panel.collapsed .panel-body,
    .panel.collapsed .copy-footer {
      opacity: 0; pointer-events: none; transition: opacity 0.1s ease;
    }
    .panel.collapsed .guide-view,
    .panel.collapsed .list-view,
    .panel.collapsed .panel-body {
      overflow: hidden;
    }

    /* --- Resize: Left edge --- */
    .panel-resize-handle {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 5px;
      cursor: col-resize;
      background: transparent;
      z-index: 10;
      transition: background var(--t-fast);
    }
    .panel-resize-handle:hover,
    .panel-resize-handle.dragging {
      background: var(--c-primary);
    }
    .panel.collapsed .panel-resize-handle {
      display: none;
    }

    /* --- Panel Toolbar (collapse button row) --- */
    .panel-toolbar {
      display: flex;
      align-items: center;
      padding: var(--sp-1) var(--sp-2);
      border-bottom: 1px solid var(--c-border-light);
      flex-shrink: 0;
      transition: opacity 0.15s ease 0.1s;
    }
    .panel.collapsed .panel-toolbar {
      justify-content: center;
      padding: var(--sp-1);
    }

    /* --- Toolbar Buttons (shared base) --- */
    .panel-collapse-btn,
    .panel-help-btn {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: var(--r-sm);
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--c-text-muted);
      transition: all var(--t-fast);
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
    }
    .panel-collapse-btn:hover,
    .panel-help-btn:hover {
      background: var(--c-surface-alt-hover);
      color: var(--c-text);
    }
    .panel-collapse-btn svg,
    .panel-help-btn svg { display: block; }
    .panel-help-btn { margin-left: var(--sp-1); }
    .panel.collapsed .panel-help-btn { display: none; }

    /* --- Header Hint --- */
    .panel-hint {
      font-size: var(--text-xs);
      color: var(--c-text-faint);
      margin-top: 2px;
      transition: opacity 0.3s ease;
    }
    .panel-hint kbd {
      background: var(--c-surface-alt);
      border: 1px solid var(--c-border);
      border-radius: 2px;
      padding: 0 3px;
      font-size: 9px;
      font-family: monospace;
    }
    .panel-hint.hidden {
      opacity: 0;
      pointer-events: none;
    }

    /* --- Panel Header --- */
    .panel-header {
      padding: var(--sp-1) var(--sp-4) var(--sp-3) var(--sp-4);
      border-bottom: 1px solid var(--c-border-light);
      cursor: grab;
      user-select: none;
      flex-shrink: 0;
      transition: opacity 0.15s ease 0.1s;
    }
    .panel-header:active { cursor: grabbing; }
    .panel-header h2 {
      font-size: var(--text-lg);
      font-weight: 700;
      color: var(--c-text);
      display: flex;
      align-items: center;
      gap: var(--sp-2);
    }
    .active-count {
      background: var(--c-primary);
      color: var(--c-surface);
      font-size: var(--text-xs);
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 10px;
      min-width: var(--sp-5);
      text-align: center;
    }

    /* --- Mode Pill (toolbar) --- */
    .mode-pill {
      display: flex;
      background: var(--c-surface-alt);
      border-radius: var(--r-md);
      padding: 2px;
      margin-left: auto;
    }
    .panel.collapsed .mode-pill { display: none; }
    .mode-pill-btn {
      padding: 3px 10px;
      font-size: var(--text-xs);
      font-weight: 600;
      border: none;
      background: none;
      border-radius: calc(var(--r-md) - 2px);
      cursor: pointer;
      color: var(--c-text-muted);
      transition: all var(--t-fast);
      font-family: inherit;
      line-height: 1.4;
    }
    .mode-pill-btn:hover { color: var(--c-text-2); }
    .mode-pill-btn.active {
      background: var(--c-surface);
      color: var(--c-primary);
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    /* --- Guide View --- */
    .guide-view {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .guide-progress {
      padding: var(--sp-3) var(--sp-4);
      border-bottom: 1px solid var(--c-border-light);
      flex-shrink: 0;
    }
    .guide-progress-bar {
      height: 6px;
      background: var(--c-border);
      border-radius: var(--r-pill);
      overflow: hidden;
    }
    .guide-progress-fill {
      height: 100%;
      background: var(--c-primary);
      border-radius: var(--r-pill);
      transition: width var(--t-normal);
    }
    .guide-progress-text {
      text-align: center;
      font-size: var(--text-xs);
      color: var(--c-text-muted);
      margin-top: var(--sp-1);
    }
    .guide-card {
      flex: 1;
      padding: var(--sp-4);
      display: flex;
      flex-direction: column;
    }
    .guide-step-label {
      font-size: var(--text-xs);
      font-weight: 600;
      color: var(--c-text-disabled);
      margin-bottom: var(--sp-1);
    }
    .guide-option-name {
      font-size: var(--text-lg);
      font-weight: 700;
      color: var(--c-text);
      line-height: 1.3;
    }
    .guide-option-desc {
      font-size: var(--text-sm);
      color: var(--c-text-muted);
      line-height: 1.5;
      margin-bottom: var(--sp-4);
    }
    .guide-section-label {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--c-text-disabled);
      margin-bottom: var(--sp-2);
    }
    .guide-variants-section { margin-bottom: var(--sp-4); }
    .guide-variant-cards {
      display: flex;
      gap: var(--sp-2);
      flex-wrap: wrap;
      margin-bottom: var(--sp-2);
    }
    .guide-variant-card,
    .guide-skip-card {
      flex: 1;
      min-width: 80px;
      padding: var(--sp-3);
      border-radius: var(--r-lg);
      text-align: center;
      cursor: pointer;
      transition: all var(--t-fast);
      background: var(--c-surface);
    }
    .guide-variant-card { border: 2px solid var(--c-border); }
    .guide-variant-card:hover { border-color: var(--c-primary); }
    .guide-variant-card.selected {
      border-color: var(--c-primary);
      background: var(--c-primary-lighter);
    }
    .guide-variant-label {
      font-size: var(--text-sm);
      font-weight: 600;
      color: var(--c-text-2);
    }
    .guide-variant-card.selected .guide-variant-label { color: var(--c-primary); }
    .guide-generate-card {
      padding: var(--sp-3);
      border: 2px dashed var(--c-border-mid);
      border-radius: var(--r-lg);
      text-align: center;
      cursor: pointer;
      transition: all var(--t-fast);
    }
    .guide-generate-card:hover { border-color: var(--c-primary); }
    .guide-generate-card.active {
      border-color: var(--c-primary);
      background: var(--c-primary-lighter);
    }
    .guide-generate-label { font-size: var(--text-sm); font-weight: 600; color: var(--c-text-muted); }
    .guide-generate-hint { font-size: 9px; color: var(--c-text-faint); margin-top: 2px; }
    .guide-notes-section { margin-bottom: var(--sp-3); }
    .guide-notes-textarea,
    .notes-textarea {
      width: 100%;
      padding: var(--sp-2);
      font-size: var(--text-sm);
      border: 1px solid var(--c-border-mid);
      border-radius: var(--r-sm);
      resize: vertical;
      min-height: var(--sp-12);
      font-family: inherit;
    }
    .guide-notes-textarea { box-sizing: border-box; }

    /* --- Guide Summary --- */
    .guide-summary { flex: 1; padding: var(--sp-4); }
    .guide-summary-heading { font-size: var(--text-md); font-weight: 700; color: var(--c-text); margin-bottom: var(--sp-1); }
    .guide-summary-sub { font-size: var(--text-sm); color: var(--c-text-muted); margin-bottom: var(--sp-3); }
    .guide-summary-list { display: flex; flex-direction: column; }
    .guide-summary-item {
      display: flex; align-items: center; gap: var(--sp-2);
      padding: var(--sp-2) 0;
      border-bottom: 1px solid var(--c-border);
      font-size: var(--text-sm);
      cursor: pointer;
    }
    .guide-summary-item:last-child { border-bottom: none; }
    .guide-summary-item:hover { background: var(--c-surface-alt); margin: 0 calc(-1 * var(--sp-3)); padding-left: var(--sp-3); padding-right: var(--sp-3); border-radius: var(--r-sm); }
    .guide-summary-check {
      width: 18px; height: 18px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; flex-shrink: 0; line-height: 1;
    }
    .guide-summary-check.on { background: var(--c-recommended-bg); color: var(--c-success); border: 1px solid var(--c-recommended-border); }
    .guide-summary-check.off { background: #f3f4f6; color: #9ca3af; border: 1px solid #e5e7eb; }
    .guide-summary-name { color: var(--c-text); font-weight: 500; flex: 1; }
    .guide-summary-name.off { color: var(--c-text-muted); }
    .guide-summary-variant { font-size: 11px; color: var(--c-primary); background: #eff6ff; padding: 1px 6px; border-radius: 999px; }
    .guide-summary-edit { font-size: 11px; color: var(--c-primary); opacity: 0; transition: opacity var(--t-fast); }
    .guide-summary-item:hover .guide-summary-edit { opacity: 1; }

    /* --- Guide Footer --- */
    .guide-footer {
      border-top: 1px solid var(--c-border-light);
      flex-shrink: 0;
      transition: opacity 0.15s ease 0.1s;
    }
    .guide-nav {
      display: flex;
      gap: var(--sp-2);
      padding: var(--sp-3) var(--sp-4);
    }
    .guide-nav-back {
      padding: var(--sp-2) var(--sp-4);
      border: 1px solid var(--c-border-mid);
      border-radius: var(--r-md);
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--c-text-muted);
      cursor: pointer;
      background: var(--c-surface);
      transition: all var(--t-fast);
      font-family: inherit;
    }
    .guide-nav-back:hover { border-color: var(--c-text-muted); color: var(--c-text-2); }
    .guide-nav-back:disabled { opacity: 0.4; cursor: not-allowed; }
    .guide-nav-back:disabled:hover { border-color: var(--c-border-mid); color: var(--c-text-muted); }
    .guide-nav-next {
      flex: 1;
      padding: var(--sp-2) var(--sp-4);
      border: none;
      border-radius: var(--r-md);
      background: var(--c-primary);
      color: #fff;
      font-size: var(--text-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--t-fast);
      font-family: inherit;
    }
    .guide-nav-next:hover { background: var(--c-primary-hover); }
    /* --- Guide Skip Card --- */
    .guide-skip-card {
      border: 2px solid var(--c-border);
      background: transparent;
      margin-top: var(--sp-2);
    }
    .guide-skip-card:hover {
      border-color: var(--c-danger);
    }
    .guide-skip-card.selected {
      border-color: var(--c-danger);
      background: var(--c-danger-light);
    }
    .guide-skip-card.selected .guide-variant-label {
      color: var(--c-danger);
    }

    /* --- List View --- */
    .list-view {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* --- Panel Body --- */
    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: var(--sp-2) 0;
      transition: opacity 0.15s ease 0.1s;
    }

    /* --- Combos Section --- */
    .combos-section {
      padding: var(--sp-2) var(--sp-4) var(--sp-3);
      border-bottom: 1px solid var(--c-border-light);
    }
    .combos-section.hidden { display: none; }
    .combos-section h3 {
      font-size: var(--text-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--c-text-disabled);
      margin-bottom: var(--sp-2);
    }
    .combo-btn {
      display: inline-block;
      padding: var(--sp-1) var(--sp-3);
      margin: 0 var(--sp-2) var(--sp-2) 0;
      font-size: var(--text-sm);
      border: 1px solid var(--c-border-mid);
      border-radius: 16px;
      background: var(--c-surface);
      cursor: pointer;
      color: #444;
      transition: all var(--t-fast);
    }
    .combo-btn:hover { border-color: var(--c-primary); color: var(--c-primary); }

    /* --- Group Label --- */
    .group-label {
      padding: var(--sp-1) var(--sp-4);
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--c-text-disabled);
      background: var(--c-surface-alt);
      border-bottom: 1px solid var(--c-border-light);
    }

    /* --- Toggle Item (compact) --- */
    .toggle-item {
      padding: var(--sp-1) var(--sp-4);
      border-bottom: 1px solid #f5f5f5;
      transition: background var(--t-fast);
    }
    .toggle-item.active {
      background: var(--c-primary-lighter);
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      cursor: pointer;
      min-height: 28px;
    }
    .toggle-number {
      font-size: var(--text-xs);
      font-weight: 700;
      color: var(--c-text-disabled);
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }
    .toggle-item.active .toggle-number { color: var(--c-primary); }

    /* --- Toggle Switch (compact) --- */
    .toggle-switch {
      position: relative;
      width: 28px;
      height: 16px;
      flex-shrink: 0;
    }
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .toggle-slider {
      position: absolute;
      inset: 0;
      background: var(--c-toggle-off);
      border-radius: 16px;
      cursor: pointer;
      transition: background var(--t-normal);
    }
    .toggle-slider::before {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      left: 2px;
      bottom: 2px;
      background: var(--c-surface);
      border-radius: 50%;
      transition: transform var(--t-normal);
    }
    .toggle-switch input:checked + .toggle-slider {
      background: var(--c-primary);
    }
    .toggle-switch input:checked + .toggle-slider::before {
      transform: translateX(12px);
    }

    /* --- Toggle Name (compact row) --- */
    .toggle-name {
      flex: 1;
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--c-text-2);
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* --- Recommended Badge (compact row) --- */
    .recommended-badge {
      font-size: 9px;
      font-weight: 600;
      padding: 0 var(--sp-1);
      border-radius: var(--r-pill);
      background: var(--c-recommended-bg);
      color: var(--c-recommended);
      border: 1px solid var(--c-recommended-border);
      flex-shrink: 0;
    }

    /* --- Recommended Row Indicators --- */
    .toggle-item.recommended {
      border-left: 3px solid var(--c-recommended);
      background: var(--c-recommended-bg);
    }
    .toggle-item.recommended.active {
      background: var(--c-recommended-bg);
    }

    /* --- Recommended Variant Button --- */
    .variant-btn.recommended {
      border-color: var(--c-recommended-border);
    }
    /* --- Recommended Icon (shared mask) --- */
    .variant-btn.recommended::after,
    .guide-recommended-badge::before,
    .combo-btn.recommended::before {
      content: '';
      display: inline-block;
      background: var(--c-recommended);
      -webkit-mask: var(--icon-recommended) center/contain no-repeat;
      mask: var(--icon-recommended) center/contain no-repeat;
    }
    .variant-btn.recommended::after { width: 11px; height: 11px; margin-left: 4px; vertical-align: -1px; }
    .guide-recommended-badge::before { width: 10px; height: 10px; flex-shrink: 0; }
    .combo-btn.recommended::before { width: 12px; height: 12px; margin-right: 4px; vertical-align: -2px; }

    /* --- Guide Recommended Badge (inline) --- */
    .guide-option-name-row {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      margin-bottom: var(--sp-2);
      flex-wrap: wrap;
    }
    .guide-recommended-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 9px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: var(--r-pill);
      background: var(--c-recommended-bg);
      color: var(--c-recommended);
      border: 1px solid var(--c-recommended-border);
      white-space: nowrap;
    }

    /* --- Guide Variant Thumbnails --- */
    .guide-variant-thumb {
      width: 100%;
      aspect-ratio: 1 / 1;
      overflow: hidden;
      border-radius: var(--r-sm);
      background: var(--c-surface-alt);
      margin-bottom: var(--sp-1);
      position: relative;
    }
    .guide-variant-thumb-inner {
      position: absolute;
      transform-origin: top left;
      pointer-events: none;
      background: #fff;
    }

    /* --- Guide Variant "Our Pick" Label --- */
    .guide-variant-card.recommended .guide-variant-pick {
      font-size: 9px;
      color: var(--c-recommended);
      margin-top: 2px;
      font-weight: 500;
    }

    /* --- Recommended Combo Preset --- */
    .combo-btn.recommended {
      border-color: var(--c-recommended-border);
      background: var(--c-recommended-bg);
      color: var(--c-recommended);
    }

    /* --- Notes Dot (compact indicator) --- */
    .notes-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--c-primary);
      flex-shrink: 0;
      display: none;
    }
    .notes-dot.visible { display: block; }

    /* --- Toggle Detail (expandable) --- */
    .toggle-detail {
      display: none;
      padding: var(--sp-1) var(--sp-4) var(--sp-1) 24px;
    }
    .toggle-item.expanded .toggle-detail {
      display: block;
    }
    .toggle-desc {
      font-size: var(--text-xs);
      color: var(--c-text-faint);
      line-height: 1.3;
    }
    .toggle-detail-actions {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      margin-top: var(--sp-1);
    }

    /* --- Generate Card (in list detail) --- */
    .list-generate-card {
      font-size: var(--text-xs);
      font-weight: 600;
      padding: var(--sp-2);
      border: 2px dashed var(--c-border-mid);
      border-radius: var(--r-sm);
      background: transparent;
      cursor: pointer;
      color: var(--c-text-muted);
      text-align: center;
      transition: all var(--t-fast);
    }
    .list-generate-card:hover { border-color: var(--c-primary); color: var(--c-primary); }
    .list-generate-card.active {
      border-color: var(--c-primary);
      color: var(--c-primary);
      background: var(--c-primary-lighter);
    }
    .notes-textarea { display: none; margin-top: var(--sp-2); }
    .notes-textarea.visible { display: block; }

    /* --- Variant Buttons (in detail) --- */
    .variant-row {
      display: flex;
      gap: var(--sp-1);
      margin-top: var(--sp-2);
      flex-wrap: wrap;
    }
    .variant-btn {
      font-size: var(--text-xs);
      padding: var(--sp-1) 10px;
      border: 1px solid var(--c-border-mid);
      border-radius: var(--r-sm);
      background: var(--c-surface);
      cursor: pointer;
      color: var(--c-text-muted);
      transition: all var(--t-fast);
    }
    .variant-btn:hover { border-color: var(--c-primary); color: var(--c-primary); }
    .variant-btn.selected {
      background: var(--c-primary);
      border-color: var(--c-primary);
      color: var(--c-surface);
    }

    /* --- Compare Button --- */
    .compare-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-1);
      margin-top: var(--sp-2);
      padding: var(--sp-1) 10px;
      font-size: var(--text-xs);
      font-weight: 500;
      border: 1px dashed var(--c-border-mid);
      border-radius: var(--r-sm);
      background: var(--c-surface);
      color: var(--c-text-faint);
      cursor: pointer;
      transition: all var(--t-fast);
    }
    .compare-btn:hover {
      border-color: var(--c-primary);
      border-style: solid;
      color: var(--c-primary);
      background: var(--c-primary-lighter);
    }
    .guide-compare-btn {
      display: block;
      margin-top: var(--sp-3);
      padding: var(--sp-2) var(--sp-4);
      font-size: var(--text-sm);
      font-weight: 500;
      border: 1px dashed var(--c-border-mid);
      border-radius: var(--r-md);
      background: var(--c-surface);
      color: var(--c-text-faint);
      cursor: pointer;
      transition: all var(--t-fast);
      text-align: center;
      width: 100%;
    }
    .guide-compare-btn:hover {
      border-color: var(--c-primary);
      border-style: solid;
      color: var(--c-primary);
      background: var(--c-primary-lighter);
    }

    /* --- Copy Footer --- */
    .copy-footer {
      padding: var(--sp-3) var(--sp-4);
      border-top: 1px solid var(--c-border-light);
      display: flex;
      gap: var(--sp-2);
      flex-shrink: 0;
      transition: opacity 0.15s ease 0.1s;
    }
    .btn-copy, .btn-reset {
      flex: 1;
      padding: var(--sp-2) var(--sp-3);
      font-size: var(--text-base);
      font-weight: 600;
      border: none;
      border-radius: var(--r-md);
      cursor: pointer;
      transition: all var(--t-fast);
    }
    .btn-copy {
      background: var(--c-primary);
      color: var(--c-surface);
    }
    .btn-copy:hover { background: var(--c-primary-hover); }
    .btn-copy.copied {
      background: var(--c-success);
    }
    .btn-reset {
      background: var(--c-surface-alt);
      color: var(--c-text-muted);
    }
    .btn-reset:hover { background: var(--c-surface-alt-hover); color: var(--c-text-2); }

    /* --- Help Overlay --- */
    .help-overlay {
      position: fixed;
      inset: 0;
      z-index: 200;
    }
    .help-overlay-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
    }
    .help-overlay-modal {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      background: var(--c-surface);
      border-radius: var(--r-lg);
      box-shadow: var(--shadow-float);
      display: grid;
      grid-template-columns: 160px 1fr;
      min-width: 560px;
      max-width: 680px;
      max-height: 80vh;
      overflow: hidden;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .help-overlay.active .help-overlay-modal {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    .help-modal-sidebar {
      background: var(--c-bg);
      border-right: 1px solid var(--c-border);
      padding: var(--sp-4);
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
    }
    .help-tab {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      padding: var(--sp-2) var(--sp-3);
      background: none;
      border: none;
      border-radius: var(--r-md);
      cursor: pointer;
      color: var(--c-text-muted);
      font-size: var(--text-sm);
      font-weight: 500;
      text-align: left;
      transition: all 0.15s;
    }
    .help-tab:hover {
      background: var(--c-surface);
      color: var(--c-text);
    }
    .help-tab.active {
      background: var(--c-primary);
      color: white;
    }
    .help-tab svg {
      flex-shrink: 0;
      opacity: 0.8;
    }
    .help-tab.active svg {
      opacity: 1;
    }
    .help-modal-content {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .help-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--sp-4) var(--sp-6);
      border-bottom: 1px solid var(--c-border);
      flex-shrink: 0;
    }
    .help-settings-reset {
      background: none;
      border: 1px solid var(--c-border);
      border-radius: var(--r-sm);
      color: var(--c-text-secondary);
      cursor: pointer;
      padding: var(--sp-1);
      line-height: 0;
      transition: all var(--t-fast);
      margin-left: auto;
      margin-right: var(--sp-3);
    }
    .help-settings-reset:hover {
      color: var(--c-text);
      border-color: var(--c-text-secondary);
    }
    .help-modal-title {
      font-size: var(--text-lg);
      font-weight: 700;
      color: var(--c-text);
    }
    .help-modal-dismiss {
      background: none;
      border: none;
      padding: var(--sp-1);
      color: var(--c-text-muted);
      cursor: pointer;
      line-height: 0;
      border-radius: var(--r-sm);
      transition: all var(--t-fast);
    }
    .help-modal-dismiss:hover {
      color: var(--c-text);
      background: var(--c-surface-alt);
    }
    .help-tab-panel {
      display: none;
      flex-direction: column;
      gap: var(--sp-1);
      padding: var(--sp-6);
      overflow-y: auto;
    }
    .help-tab-panel.active {
      display: flex;
    }
    .help-overlay-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--sp-1) 0;
    }
    .help-overlay-action {
      font-size: var(--text-sm);
      color: var(--c-text-muted);
    }
    .help-overlay-key {
      background: var(--c-surface-alt);
      border: 1px solid var(--c-border);
      border-radius: var(--r-sm);
      padding: 1px 6px;
      font-size: var(--text-xs);
      font-family: monospace;
      color: var(--c-text-2);
      box-shadow: 0 1px 0 var(--c-border);
    }
    .help-info-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--sp-4);
    }
    .help-info-item {
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
    }
    .help-info-label {
      font-size: var(--text-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--c-text-faint);
    }
    .help-info-value {
      font-size: var(--text-sm);
      color: var(--c-text);
      word-break: break-all;
    }
    .help-info-value a {
      color: var(--c-primary);
      text-decoration: none;
    }
    .help-info-value a:hover {
      text-decoration: underline;
    }
    .help-reset-btn {
      margin-top: var(--sp-4);
      padding: var(--sp-2) var(--sp-4);
      background: var(--c-danger-light);
      color: var(--c-danger);
      border: 1px solid var(--c-danger);
      border-radius: var(--r-md);
      font-size: var(--text-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--t-fast);
    }
    .help-reset-btn:hover {
      background: var(--c-danger);
      color: white;
    }
    .help-bg-picker {
      display: flex;
      gap: 0;
      border: 1px solid var(--c-border);
      border-radius: var(--r-md);
      overflow: hidden;
    }
    .help-bg-picker button {
      flex: 1;
      padding: var(--sp-1) var(--sp-2);
      border: none;
      background: var(--c-surface);
      color: var(--c-text-secondary);
      font-size: var(--text-xs);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--t-fast);
      border-right: 1px solid var(--c-border);
    }
    .help-bg-picker button:last-child {
      border-right: none;
    }
    .help-bg-picker button:hover {
      background: var(--c-bg-hover);
    }
    .help-bg-picker button.active {
      background: var(--c-primary);
      color: white;
    }
    .help-bg-opacity {
      width: 100%;
      accent-color: var(--c-primary);
      cursor: pointer;
    }
    .help-bg-color-row {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
    }
    .help-bg-color-input {
      width: 36px;
      height: 28px;
      border: 1px solid var(--c-border);
      border-radius: var(--r-sm);
      padding: 2px;
      cursor: pointer;
      background: none;
    }
    .help-bg-color-reset {
      padding: var(--sp-1) var(--sp-2);
      border: 1px solid var(--c-border);
      border-radius: var(--r-sm);
      background: var(--c-surface);
      color: var(--c-text-secondary);
      font-size: var(--text-xs);
      cursor: pointer;
      transition: all var(--t-fast);
    }
    .help-bg-color-reset:hover {
      background: var(--c-bg-hover);
    }
    .help-bg-blend-select {
      width: 100%;
      padding: var(--sp-1) var(--sp-2);
      border: 1px solid var(--c-border);
      border-radius: var(--r-sm);
      background: var(--c-surface);
      color: var(--c-text);
      font-size: var(--text-xs);
      cursor: pointer;
    }
    .help-interface-select {
      padding: var(--sp-1) var(--sp-2);
      border: 1px solid var(--c-border);
      border-radius: var(--r-sm);
      font-size: var(--text-xs);
      background: var(--c-surface);
      color: var(--c-text);
      cursor: pointer;
    }

    /* --- Drag Handle (mobile bottom sheet) --- */
    .panel-drag-handle {
      display: none;
      justify-content: center;
      padding: var(--sp-2) 0;
      cursor: grab;
      flex-shrink: 0;
    }
    .panel-drag-handle:active { cursor: grabbing; }
    .panel-drag-handle .handle-bar {
      width: 36px;
      height: 4px;
      background: var(--c-border-mid);
      border-radius: 2px;
    }

    /* --- Collapsible Groups --- */
    .group-label {
      cursor: pointer;
      user-select: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .group-label::after {
      content: '\\25BC';
      font-size: 9px;
      color: var(--c-text-faint);
      transition: transform var(--t-fast);
    }
    .group-label.collapsed::after {
      transform: rotate(-90deg);
    }
    .group-options.collapsed {
      display: none;
    }

    /* --- Copy Preview Modal --- */
    .copy-preview-overlay {
      position: fixed;
      inset: 0;
      z-index: 300;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--sp-4);
      opacity: 1;
      transition: opacity 300ms ease;
    }
    .copy-preview-overlay.fading {
      opacity: 0;
    }
    .copy-preview-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
    }
    .copy-preview-modal {
      position: relative;
      background: var(--c-surface);
      border-radius: var(--r-lg);
      box-shadow: var(--shadow-float);
      max-width: 600px;
      width: 100%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
    }
    .copy-preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--sp-4);
      border-bottom: 1px solid var(--c-border-light);
      flex-shrink: 0;
    }
    .copy-preview-body {
      flex: 1;
      overflow-y: auto;
      padding: var(--sp-4);
    }
    .copy-preview-body pre {
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: var(--text-sm);
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--c-text-2);
      line-height: 1.5;
      margin: 0;
    }
    .copy-preview-footer {
      display: flex;
      gap: var(--sp-2);
      padding: var(--sp-3) var(--sp-4);
      border-top: 1px solid var(--c-border-light);
      flex-shrink: 0;
    }
    .copy-preview-copy-btn {
      flex: 1;
      padding: var(--sp-3);
      background: var(--c-primary);
      color: #fff;
      border: none;
      border-radius: var(--r-md);
      font-size: var(--text-base);
      font-weight: 600;
      cursor: pointer;
      min-height: 48px;
    }
    .copy-preview-copy-btn:hover { background: var(--c-primary-hover); }
    .copy-preview-copy-btn.copied { background: var(--c-success); }
    .copy-preview-close-btn {
      padding: var(--sp-3) var(--sp-4);
      background: var(--c-surface-alt);
      color: var(--c-text-muted);
      border: none;
      border-radius: var(--r-md);
      font-size: var(--text-base);
      cursor: pointer;
      min-height: 48px;
    }
    .copy-preview-close-btn:hover { background: var(--c-surface-alt-hover); }

    /* --- Mobile: Container Query + Bottom Sheet --- */
    :host {
      container-type: inline-size;
      container-name: panel;
    }

    @media (max-width: 768px) {
      :host {
        top: auto;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100% !important;
        height: auto;
        max-height: 70vh;
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.12);
        transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      :host(.mt-sheet-collapsed) {
        transform: translateY(calc(100% - 52px));
      }
      .panel { border-left: none; border-top: 1px solid var(--c-border); }
      .panel-resize-handle { display: none; }
      .panel-drag-handle { display: flex; }
      .panel-collapse-btn { display: none; }

      /* Touch targets (48px Material) */
      .toggle-row { min-height: 48px; }
      .toggle-switch { width: 44px; height: 24px; }
      .toggle-slider::before { width: 20px; height: 20px; }
      .toggle-switch input:checked + .toggle-slider::before { transform: translateX(20px); }
      .toggle-name { font-size: var(--text-base); }
      .variant-btn {
        min-height: 48px;
        padding: var(--sp-2) var(--sp-3);
        font-size: var(--text-sm);
      }
      .combo-btn {
        min-height: 44px;
        padding: var(--sp-2) var(--sp-4);
        font-size: var(--text-sm);
      }
      .guide-variant-card, .guide-skip-card {
        min-height: 48px;
        padding: var(--sp-3) var(--sp-2);
      }
      .btn-copy, .btn-reset {
        min-height: 48px;
        font-size: var(--text-md);
      }
      .guide-nav-back, .guide-nav-next {
        min-height: 48px;
        font-size: var(--text-base);
      }

      /* Full-width stacked cards */
      .toggle-item { padding: var(--sp-2) var(--sp-4); }
      .toggle-detail { padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-6); }

      /* Grid variant picker */
      .variant-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--sp-2);
      }
      .guide-variant-cards {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--sp-2);
      }

      /* Chip row combos (scrollable) */
      .combos-section {
        overflow-x: auto;
        white-space: nowrap;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .combos-section::-webkit-scrollbar { display: none; }
      .combo-btn {
        display: inline-flex;
        white-space: nowrap;
        margin-bottom: 0;
      }
    }

    /* --- Adaptive Orientation (landscape wider panel) --- */
    @media (max-width: 768px) and (orientation: landscape) {
      :host {
        max-height: 85vh;
      }
      :host(.mt-sheet-collapsed) {
        transform: translateY(calc(100% - 52px));
      }
    }

    /* --- Reduced Motion --- */
    /* --- Focus styles for keyboard navigation --- */
    [role="button"]:focus-visible,
    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible {
      outline: 2px solid var(--c-primary);
      outline-offset: 2px;
    }
    .toggle-row:focus-visible {
      outline-offset: -2px;
      border-radius: var(--r-sm);
    }

    @media (prefers-reduced-motion: reduce) {
      :host, .panel, .panel-header, .panel-body, .copy-footer, .collapse-label, .panel-collapse-btn {
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    }
    `;
  }

  renderCombos() {
    if (!CONFIG.combos || CONFIG.combos.length === 0) return '';
    let html = '<div class="combos-section"><h3>Presets</h3>';
    CONFIG.combos.forEach((combo, i) => {
      const recClass = combo.recommended ? ' recommended' : '';
      html += `<button class="combo-btn${recClass}" data-combo="${i}" title="${this.esc(combo.desc)}">${this.esc(combo.name)}</button>`;
    });
    html += '</div>';
    return html;
  }

  renderOptions() {
    // Build groups from tags
    const viewMap = {};
    CONFIG.views.forEach(v => { viewMap[v.id] = v.label; });
    const groups = {};
    const groupOrder = [];
    CONFIG.options.forEach(opt => {
      const tag = (opt.tags && opt.tags[0]) || '_other';
      if (!groups[tag]) { groups[tag] = []; groupOrder.push(tag); }
      groups[tag].push(opt);
    });
    const showGroups = groupOrder.length > 1;

    let html = '';
    groupOrder.forEach(tag => {
      if (showGroups) {
        html += `<div class="group-label" tabindex="0" role="button" data-group="${this.esc(tag)}">${this.esc(viewMap[tag] || tag)}</div>`;
        html += `<div class="group-options" data-group-options="${this.esc(tag)}">`;
      }
      groups[tag].forEach(opt => {
        const isActive = this.activeOptions.has(opt.id);
        const hasVariants = opt.variants && Object.keys(opt.variants).length > 0;
        const currentVariant = this.optionVariants[opt.id];
        const noteText = this.optionNotes[opt.id] || '';
        const hasNotes = noteText.trim().length > 0;
        const isRecommended = !!opt.recommended;

        html += `<div class="toggle-item${isActive ? ' active expanded' : ''}${isRecommended ? ' recommended' : ''}" data-opt-id="${opt.id}">`;
        html += `<div class="toggle-row" tabindex="0" role="button">`;
        html += `<span class="toggle-number">${opt.id}</span>`;
        html += `<span class="toggle-name">${this.esc(opt.name)}</span>`;
        if (isRecommended) html += `<span class="recommended-badge">Recommended</span>`;
        html += `<span class="notes-dot${hasNotes ? ' visible' : ''}" data-dot="${opt.id}"></span>`;
        html += `<label class="toggle-switch"><input type="checkbox" data-opt="${opt.id}" ${isActive ? 'checked' : ''}><span class="toggle-slider"></span></label>`;
        html += `</div>`;

        // Detail section (hidden unless active/expanded)
        html += `<div class="toggle-detail">`;
        html += `<div class="toggle-desc">${this.esc(opt.desc)}</div>`;

        if (hasVariants) {
          html += `<div class="variant-row">`;
          Object.entries(opt.variants).forEach(([key, label]) => {
            const isRecVariant = isRecommended && opt.recommendedVariant === key;
            html += `<button class="variant-btn${currentVariant === key ? ' selected' : ''}${isRecVariant ? ' recommended' : ''}" data-variant-opt="${opt.id}" data-variant-key="${key}">${this.esc(label)}</button>`;
          });
          html += `</div>`;
          if (!CONFIG.compareOnly) html += `<button class="compare-btn" data-compare-opt="${opt.id}">&#8862; Compare</button>`;
        }

        html += `<div class="toggle-detail-actions">`;
        html += `<div class="list-generate-card${hasNotes ? ' active' : ''}" tabindex="0" role="button" data-generate-card="${opt.id}">+ Generate more variants</div>`;
        html += `</div>`;
        html += `<textarea class="notes-textarea${hasNotes ? ' visible' : ''}" data-notes="${opt.id}" placeholder="Describe the variants you want generated...">${this.esc(noteText)}</textarea>`;

        html += `</div>`; // end toggle-detail
        html += `</div>`; // end toggle-item
      });
      if (showGroups) {
        html += `</div>`; // end group-options
      }
    });
    return html;
  }

  // --- Interactions ---
  bindEvents() {
    const root = this.shadowRoot;
    const body = root.querySelector('.panel-body');

    // --- Keyboard a11y: Enter/Space triggers click on role="button" divs ---
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const el = e.target;
        if (el.getAttribute('role') === 'button' && el.tagName !== 'BUTTON') {
          e.preventDefault();
          el.click();
        }
      }
    });

    // --- Mode Pill ---
    root.querySelectorAll('.mode-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
    });

    // --- List Mode Events ---
    if (body) {
      body.querySelectorAll('.toggle-item').forEach(item => {
        // Hover: switch to option's view and update compare display (only if active)
        item.addEventListener('mouseover', (e) => {
          // Skip if hovering over interactive elements
          if (e.target.closest('.variant-btn, .compare-btn, .list-generate-card, .notes-textarea, button, input, textarea')) return;
          const optId = parseInt(item.dataset.optId);
          if (!optId) return;
          const opt = CONFIG.options.find(o => o.id === optId);
          if (opt && opt.target && opt.target.view) {
            switchView(opt.target.view);
            // Only update compare display if option is already active
            if (this.activeOptions.has(optId) && window._engineInterface) {
              window._engineInterface.open(optId);
            }
          }
        });

        // Click: expand detail, activate option, and keep view
        item.addEventListener('click', (e) => {
          // Ignore clicks on interactive elements
          if (e.target.closest('.toggle-switch, .variant-btn, .compare-btn, .list-generate-card, .notes-textarea, button, input, textarea')) return;

          const optId = parseInt(item.dataset.optId);
          if (!optId) return;

          // Toggle expanded state
          item.classList.toggle('expanded');

          // Activate the option and keep view
          const opt = CONFIG.options.find(o => o.id === optId);
          if (opt) {
            this.activeOptions.add(optId);
            if (opt.target && opt.target.view) switchView(opt.target.view);
            this.syncToggles();
            this.saveState();
            this.fireOptionsChange();
          }

          // Open compare if expanded
          if (item.classList.contains('expanded')) {
            if (window._engineInterface) window._engineInterface.open(optId);
          }
        });
      });

      body.querySelectorAll('input[data-opt]').forEach(cb => {
        cb.addEventListener('change', () => {
          const id = parseInt(cb.dataset.opt);
          const item = cb.closest('.toggle-item');
          if (cb.checked) {
            this.activeOptions.add(id);
            item.classList.add('expanded');
            this.scrollToTarget(id);
          } else {
            this.activeOptions.delete(id);
            item.classList.remove('expanded');
          }
          this.syncToggles();
          this.saveState();
          this.fireOptionsChange();
        });
      });

      body.querySelectorAll('.combo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const combo = CONFIG.combos[parseInt(btn.dataset.combo)];
          const allActive = combo.ids.every(id => this.activeOptions.has(id));
          combo.ids.forEach(id => {
            if (allActive) { this.activeOptions.delete(id); } else { this.activeOptions.add(id); }
          });
          this.syncToggles();
          this.saveState();
          this.fireOptionsChange();
        });
      });

      body.querySelectorAll('.list-generate-card').forEach(card => {
        card.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent toggle-item click
          const ta = body.querySelector(`textarea[data-notes="${card.dataset.generateCard}"]`);
          ta.classList.toggle('visible');
          if (ta.classList.contains('visible')) ta.focus();
        });
      });

      body.querySelectorAll('textarea[data-notes]').forEach(ta => {
        ta.addEventListener('input', () => {
          const id = ta.dataset.notes;
          const val = ta.value.trim();
          if (val) { this.optionNotes[id] = val; } else { delete this.optionNotes[id]; }
          const card = body.querySelector(`[data-generate-card="${id}"]`);
          if (card) { card.classList.toggle('active', !!val); }
          const dot = body.querySelector(`.notes-dot[data-dot="${id}"]`);
          if (dot) dot.classList.toggle('visible', !!val);
          this.saveState();
        });
      });

      body.querySelectorAll('.variant-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent toggle-item click
          const optId = parseInt(btn.dataset.variantOpt);
          const key = btn.dataset.variantKey;
          this.optionVariants[optId] = key;
          body.querySelectorAll(`[data-variant-opt="${optId}"]`).forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          this.saveState();
          this.fireOptionsChange();
        });
        btn.addEventListener('mouseenter', () => {
          const optId = parseInt(btn.dataset.variantOpt);
          const key = btn.dataset.variantKey;
          // Preview the variant
          const preview = Object.assign({}, this.optionVariants);
          preview[optId] = key;
          this.startPreview(null, preview);
        });
        btn.addEventListener('mouseleave', () => this.endPreview());
      });

      body.querySelectorAll('.compare-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window._engineInterface) window._engineInterface.open(parseInt(btn.dataset.compareOpt));
        });
      });
    }

    // --- Guide Mode Events ---
    root.querySelector('.guide-nav-back').addEventListener('click', () => this.guidePrev());
    root.querySelector('.guide-nav-next').addEventListener('click', () => this.guideNext());
    root.querySelector('.guide-generate-card').addEventListener('click', () => this.guideToggleGenerate());
    root.querySelector('.guide-notes-textarea').addEventListener('input', (e) => {
      const opt = CONFIG.options[this.guideStep];
      if (!opt) return;
      const val = e.target.value.trim();
      if (val) { this.optionNotes[opt.id] = val; } else { delete this.optionNotes[opt.id]; }
      this.saveState();
    });

    // --- Shared Events ---
    root.querySelector('.panel-help-btn').addEventListener('click', () => this.toggleHelpOverlay());
    root.querySelector('.btn-copy').addEventListener('click', () => this.copyPrompt());
    root.querySelector('.btn-reset').addEventListener('click', () => this.resetAll());
    root.querySelector('.panel-collapse-btn').addEventListener('click', () => {
      this.panelCollapsed = !this.panelCollapsed;
      this.hoverExpanded = false;
      this.applyPanelLayout();
      this.saveState();
    });

    this.initResize();
    this.initKeyboard();
    this.initAutoExpand();
    this.initMobileQuery();
    this.initBottomSheet();
    this.initCollapsibleGroups();
    this.initCopyPreview();

    // Initialize guide view if in guide mode
    if (this.panelMode === 'guide') this.updateGuide();
  }

  initKeyboard() {
    const overlay = this.shadowRoot.querySelector('.help-overlay');
    const backdrop = this.shadowRoot.querySelector('.help-overlay-backdrop');

    document.addEventListener('keydown', (e) => {
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (isInputFocused()) return;
        e.preventDefault();
        this.toggleHelpOverlay();
        return;
      }

      if (e.key === 'Escape' && this.helpOverlayOpen) {
        e.preventDefault();
        this.toggleHelpOverlay();
        return;
      }

      if (e.key === 'Escape' && window._engineInterface && window._engineInterface.isOpen) {
        if (CONFIG.compareOnly) return;
        e.preventDefault();
        window._engineInterface.close();
        return;
      }
    });

    backdrop.addEventListener('click', () => this.toggleHelpOverlay());
    this.shadowRoot.querySelector('.help-modal-dismiss').addEventListener('click', () => this.toggleHelpOverlay());

    // Tab switching
    this.shadowRoot.querySelectorAll('.help-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        // Update active tab
        this.shadowRoot.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Update active panel
        this.shadowRoot.querySelectorAll('.help-tab-panel').forEach(p => p.classList.remove('active'));
        const panel = this.shadowRoot.querySelector(`[data-panel="${tabId}"]`);
        if (panel) panel.classList.add('active');
        // Update title
        const title = this.shadowRoot.querySelector('.help-modal-title');
        if (title) title.textContent = tab.querySelector('span').textContent;
        // Show reset button only on settings tab
        const resetIcon = this.shadowRoot.querySelector('.help-settings-reset');
        if (resetIcon) resetIcon.style.display = tabId === 'settings' ? '' : 'none';
      });
    });

    // Reset state button
    const resetBtn = this.shadowRoot.querySelector('.help-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        const prefix = CONFIG.storageKey;
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith(prefix)) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
        resetBtn.textContent = `Cleared ${keys.length} key${keys.length !== 1 ? 's' : ''}!`;
        setTimeout(() => { resetBtn.textContent = 'Reset All State'; }, 1500);
        // Update storage count display
        const storageEl = this.shadowRoot.querySelector('.help-diagnostic-storage');
        if (storageEl) storageEl.textContent = '0 keys';
      });
    }

    // Canvas background picker
    // Helper: apply bg classes to all canvas bg targets (views + compare cells)
    const bgTargets = () => document.querySelectorAll('.mt-view, .mt-compare-cell-canvas');
    const applyBgClasses = (bg, size) => {
      bgTargets().forEach(el => {
        el.classList.remove('mt-bg-checker', 'mt-bg-grid', 'mt-bg-dots', 'mt-bg-none', 'mt-bg-sm', 'mt-bg-md', 'mt-bg-lg', 'mt-bg-xl');
        el.classList.add('mt-bg-' + bg);
        if (bg !== 'none') el.classList.add('mt-bg-' + size);
      });
    };

    const patternRows = this.shadowRoot.querySelectorAll('.help-bg-pattern-row');
    this.shadowRoot.querySelectorAll('.help-bg-picker:not(.help-bg-size-picker) button').forEach(btn => {
      btn.addEventListener('click', () => {
        const bg = btn.dataset.bg;
        this.shadowRoot.querySelectorAll('.help-bg-picker:not(.help-bg-size-picker) button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const savedSize = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-size') || 'md';
        applyBgClasses(bg, savedSize);
        localStorage.setItem(CONFIG.storageKey + '-canvas-bg', bg);
        patternRows.forEach(r => r.style.display = bg === 'none' ? 'none' : '');
      });
    });

    // Pattern size picker
    this.shadowRoot.querySelectorAll('.help-bg-size-picker button').forEach(btn => {
      btn.addEventListener('click', () => {
        const size = btn.dataset.bgSize;
        this.shadowRoot.querySelectorAll('.help-bg-size-picker button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const savedBg = localStorage.getItem(CONFIG.storageKey + '-canvas-bg') || 'checker';
        applyBgClasses(savedBg, size);
        localStorage.setItem(CONFIG.storageKey + '-canvas-bg-size', size);
      });
    });

    // Pattern opacity slider
    const opacitySlider = this.shadowRoot.querySelector('.help-bg-opacity');
    if (opacitySlider) {
      opacitySlider.addEventListener('input', () => {
        const val = opacitySlider.value;
        bgTargets().forEach(el => {
          el.style.setProperty('--bg-opacity', val);
        });
        localStorage.setItem(CONFIG.storageKey + '-canvas-bg-opacity', val);
      });
    }

    // Background color picker
    const colorInput = this.shadowRoot.querySelector('.help-bg-color-input');
    if (colorInput) {
      colorInput.addEventListener('input', () => {
        const val = colorInput.value;
        bgTargets().forEach(el => {
          el.style.setProperty('--bg-color', val);
        });
        localStorage.setItem(CONFIG.storageKey + '-canvas-bg-color', val);
      });
    }
    const colorReset = this.shadowRoot.querySelector('.help-bg-color-reset');
    if (colorReset) {
      colorReset.addEventListener('click', () => {
        const def = '#f3f4f6';
        if (colorInput) colorInput.value = def;
        bgTargets().forEach(el => {
          el.style.setProperty('--bg-color', def);
        });
        localStorage.removeItem(CONFIG.storageKey + '-canvas-bg-color');
      });
    }

    // Blend mode select
    const blendSelect = this.shadowRoot.querySelector('.help-bg-blend-select');
    if (blendSelect) {
      blendSelect.addEventListener('change', () => {
        const blend = blendSelect.value;
        bgTargets().forEach(el => {
          el.style.setProperty('--bg-blend', blend);
        });
        localStorage.setItem(CONFIG.storageKey + '-canvas-bg-blend', blend);
      });
    }

    // Settings reset button
    const settingsReset = this.shadowRoot.querySelector('.help-settings-reset');
    if (settingsReset) {
      settingsReset.addEventListener('click', () => {
        const prefix = CONFIG.storageKey;
        ['canvas-bg', 'canvas-bg-size', 'canvas-bg-opacity', 'canvas-bg-color', 'canvas-bg-blend'].forEach(k => {
          localStorage.removeItem(prefix + '-' + k);
        });
        const canvasCfg = CONFIG.canvas || {};
        const defaultBg = canvasCfg.grid === false ? 'none' : 'checker';
        applyBgClasses(defaultBg, 'md');
        bgTargets().forEach(el => {
          el.style.removeProperty('--bg-color');
          el.style.setProperty('--bg-opacity', '0.1');
          el.style.removeProperty('--bg-blend');
        });
        this.populateHelpDiagnostics();
      });
    }

    // Interface selector (v1, v2, ...)
    const interfaceSelect = this.shadowRoot.querySelector('.help-interface-select');
    if (interfaceSelect) {
      interfaceSelect.value = CONFIG.compareOnly ? 'v2' : 'v1';
      interfaceSelect.addEventListener('change', () => {
        localStorage.setItem(CONFIG.storageKey + '-interface', interfaceSelect.value);
        location.reload();
      });
    }
  }

  toggleHelpOverlay() {
    this.helpOverlayOpen = !this.helpOverlayOpen;
    const overlay = this.shadowRoot.querySelector('.help-overlay');

    if (this.helpOverlayOpen) {
      // Show overlay (display first, then animate)
      overlay.style.display = '';
      requestAnimationFrame(() => {
        overlay.classList.add('active');
      });
      // Populate dynamic values
      this.populateHelpDiagnostics();
      // Dismiss the hint on first use
      this.dismissHint();
    } else {
      // Hide overlay (animate out, then hide)
      overlay.classList.remove('active');
      setTimeout(() => {
        if (!this.helpOverlayOpen) overlay.style.display = 'none';
      }, 200); // Match transition duration
    }
  }

  populateHelpDiagnostics() {
    const root = this.shadowRoot;
    // Browser info
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
    const browserEl = root.querySelector('.help-diagnostic-browser');
    if (browserEl) browserEl.textContent = browser;

    // Viewport
    const viewportEl = root.querySelector('.help-diagnostic-viewport');
    if (viewportEl) viewportEl.textContent = `${window.innerWidth} × ${window.innerHeight}px`;

    // Device type
    const deviceEl = root.querySelector('.help-diagnostic-device');
    if (deviceEl) deviceEl.textContent = this._isMobile ? 'Mobile' : 'Desktop';

    // Canvas zoom - get from first canvas workspace
    const workspace = document.querySelector('mt-canvas-workspace');
    const zoomEl = root.querySelector('.help-diagnostic-zoom');
    if (zoomEl && workspace) {
      const zoom = workspace._zoom || 1.0;
      zoomEl.textContent = `${Math.round(zoom * 100)}%`;
    } else if (zoomEl) {
      zoomEl.textContent = 'N/A';
    }

    // Storage count
    const storageEl = root.querySelector('.help-diagnostic-storage');
    if (storageEl) {
      const prefix = CONFIG.storageKey;
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i).startsWith(prefix)) count++;
      }
      storageEl.textContent = `${count} key${count !== 1 ? 's' : ''}`;
    }

    // Canvas background picker active state
    const currentBg = localStorage.getItem(CONFIG.storageKey + '-canvas-bg') || 'checker';
    root.querySelectorAll('.help-bg-picker:not(.help-bg-size-picker) button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bg === currentBg);
    });

    // Pattern size picker active state
    const currentSize = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-size') || 'md';
    root.querySelectorAll('.help-bg-size-picker button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bgSize === currentSize);
    });
    const isNone = currentBg === 'none';
    root.querySelectorAll('.help-bg-pattern-row').forEach(r => r.style.display = isNone ? 'none' : '');

    // Opacity slider
    const opacitySlider = root.querySelector('.help-bg-opacity');
    if (opacitySlider) opacitySlider.value = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-opacity') || '0.1';

    // Color input
    const colorInput = root.querySelector('.help-bg-color-input');
    if (colorInput) colorInput.value = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-color') || '#f3f4f6';

    // Blend mode select
    const blendSelect = root.querySelector('.help-bg-blend-select');
    if (blendSelect) blendSelect.value = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-blend') || 'normal';

    // Interface selector
    const interfaceSelect = root.querySelector('.help-interface-select');
    if (interfaceSelect) {
      interfaceSelect.value = CONFIG.compareOnly ? 'v2' : 'v1';
    }

    // File path
    const filePathEl = root.querySelector('.help-info-filepath');
    if (filePathEl) filePathEl.textContent = CONFIG.filePath || window.location.href;

    // Active count
    const activeCountEl = root.querySelector('.help-info-active-count');
    if (activeCountEl) activeCountEl.textContent = this.activeOptions.size.toString();
  }

  dismissHint() {
    const hint = this.shadowRoot.querySelector('.panel-hint');
    if (hint) hint.classList.add('hidden');
  }

  initAutoExpand() {
    let hoverTimer = null;
    this.addEventListener('mouseenter', (e) => {
      if (!this.panelCollapsed) return;
      // Don't auto-expand when hovering the toolbar (collapse button area)
      const toolbar = this.shadowRoot.querySelector('.panel-toolbar');
      if (toolbar) {
        const tbRect = toolbar.getBoundingClientRect();
        if (e.clientY <= tbRect.bottom) return;
      }
      hoverTimer = setTimeout(() => {
        this.hoverExpanded = true;
        this.applyPanelLayout();
      }, 300);
    });
    this.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      if (!this.hoverExpanded) return;
      this.hoverExpanded = false;
      this.applyPanelLayout();
    });
  }

  initMobileQuery() {
    this._mobileQuery = window.matchMedia('(max-width: 768px)');
    this._mobileQuery.addEventListener('change', (e) => {
      this._isMobile = e.matches;
      this.applyPanelLayout();
    });
  }

  initBottomSheet() {
    const handle = this.shadowRoot.querySelector('.panel-drag-handle');
    const toolbar = this.shadowRoot.querySelector('.panel-toolbar');
    const setupDrag = (el) => {
      let startY = 0;
      let dragging = false;
      el.addEventListener('touchstart', (e) => {
        if (!this._isMobile) return;
        startY = e.touches[0].clientY;
        dragging = true;
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (!dragging || !this._isMobile) return;
        const dy = e.touches[0].clientY - startY;
        if (this._sheetExpanded && dy > 80) {
          this._sheetExpanded = false;
          this.classList.add('mt-sheet-collapsed');
          dragging = false;
        } else if (!this._sheetExpanded && dy < -40) {
          this._sheetExpanded = true;
          this.classList.remove('mt-sheet-collapsed');
          dragging = false;
        }
      }, { passive: true });
      el.addEventListener('touchend', () => { dragging = false; }, { passive: true });
    };
    setupDrag(handle);
    setupDrag(toolbar);
    // Tap drag handle toggles
    handle.addEventListener('click', () => {
      if (!this._isMobile) return;
      this._sheetExpanded = !this._sheetExpanded;
      this.classList.toggle('mt-sheet-collapsed', !this._sheetExpanded);
    });
  }

  initCollapsibleGroups() {
    const body = this.shadowRoot.querySelector('.panel-body');
    if (!body) return;
    body.querySelectorAll('.group-label').forEach(label => {
      label.addEventListener('click', () => {
        label.classList.toggle('collapsed');
        const options = body.querySelector(`[data-group-options="${label.dataset.group}"]`);
        if (options) options.classList.toggle('collapsed');
        this.saveState();
      });
    });
    // Restore collapsed groups from saved state
    if (this._pendingCollapsedGroups) {
      this._pendingCollapsedGroups.forEach(group => {
        const label = body.querySelector(`.group-label[data-group="${group}"]`);
        const options = body.querySelector(`[data-group-options="${group}"]`);
        if (label) label.classList.add('collapsed');
        if (options) options.classList.add('collapsed');
      });
      this._pendingCollapsedGroups = null;
    }
  }

  initCopyPreview() {
    const root = this.shadowRoot;
    const overlay = root.querySelector('.copy-preview-overlay');
    const backdrop = root.querySelector('.copy-preview-backdrop');
    const copyBtn = root.querySelector('.copy-preview-copy-btn');
    const closeBtn = root.querySelector('.copy-preview-close-btn');

    backdrop.addEventListener('click', () => this.closeCopyPreview());
    closeBtn.addEventListener('click', () => this.closeCopyPreview());
    copyBtn.addEventListener('click', () => {
      const text = root.querySelector('.copy-preview-text').textContent;
      navigator.clipboard.writeText(text).then(() => {
        this.clearAllNotes();
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => this.closeCopyPreview(), 1000);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._copyPreviewOpen) {
        e.preventDefault();
        this.closeCopyPreview();
      }
    });
  }

  showCopyPreview(text) {
    const root = this.shadowRoot;
    root.querySelector('.copy-preview-text').textContent = text;
    root.querySelector('.copy-preview-overlay').style.display = '';
    const copyBtn = root.querySelector('.copy-preview-copy-btn');
    copyBtn.textContent = 'Copy to Clipboard';
    copyBtn.classList.remove('copied');
    this._copyPreviewOpen = true;
  }

  closeCopyPreview() {
    const overlay = this.shadowRoot.querySelector('.copy-preview-overlay');
    overlay.classList.add('fading');
    overlay.addEventListener('transitionend', () => {
      overlay.style.display = 'none';
      overlay.classList.remove('fading');
    }, { once: true });
    this._copyPreviewOpen = false;
  }

  initResize() {
    const handle = this.shadowRoot.querySelector('.panel-resize-handle');
    handle.addEventListener('mousedown', (e) => {
      if (this.panelCollapsed) return;
      e.preventDefault();
      handle.classList.add('dragging');
      const anchorRight = window.innerWidth;

      const onMove = (ev) => {
        this.panelWidth = Math.max(240, Math.min(anchorRight - ev.clientX, window.innerWidth * 0.5));
        this.applyPanelLayout();
      };
      const onEnd = () => {
        handle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        this.saveState();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
    });
  }

  // --- State sync ---
  syncToggles() {
    const body = this.shadowRoot.querySelector('.panel-body');
    body.querySelectorAll('.toggle-item').forEach(item => {
      const id = parseInt(item.dataset.optId);
      const cb = item.querySelector('input[type="checkbox"]');
      const isActive = this.activeOptions.has(id);
      cb.checked = isActive;
      item.classList.toggle('active', isActive);
      item.classList.toggle('expanded', isActive);
    });
    // Update notes dots
    body.querySelectorAll('.notes-dot').forEach(dot => {
      const id = dot.dataset.dot;
      const hasNotes = this.optionNotes[id] && this.optionNotes[id].trim();
      dot.classList.toggle('visible', !!hasNotes);
    });
    this.updateActiveCount();
  }

  updateActiveCount() {
    const el = this.shadowRoot.querySelector('.active-count');
    if (el) el.textContent = this.activeOptions.size;
  }

  scrollToTarget(optId) {
    const opt = CONFIG.options.find(o => o.id === optId);
    if (!opt || !opt.target) return;
    if (opt.target.view) switchView(opt.target.view);
    if (opt.target.el) {
      setTimeout(() => {
        const el = document.getElementById(opt.target.el);
        if (!el) return;
        const view = el.closest('.mt-view');
        const ws = view && view._canvasWorkspace;
        if (ws) {
          // Calculate element position in content-space using offsets
          let contentX = 0, contentY = 0, node = el;
          while (node && node !== ws.content) {
            contentX += node.offsetLeft;
            contentY += node.offsetTop;
            node = node.offsetParent;
          }
          const viewRect = view.getBoundingClientRect();
          const panel = document.querySelector('mockup-options');
          const panelWidth = panel ? panel.offsetWidth : 0;
          const availableWidth = viewRect.width - panelWidth;
          const centerX = availableWidth / 2 - (contentX + el.offsetWidth / 2) * ws.zoom;
          const centerY = viewRect.height / 2 - (contentY + el.offsetHeight / 2) * ws.zoom;
          ws.setPan(centerX, centerY);
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }

  // --- Guide Mode ---
  switchMode(mode) {
    if (mode === this.panelMode) return;
    this.panelMode = mode;
    const root = this.shadowRoot;
    const isGuide = mode === 'guide';

    // Toggle visibility
    root.querySelector('.guide-view').style.display = isGuide ? '' : 'none';
    root.querySelector('.guide-footer').style.display = isGuide ? '' : 'none';
    root.querySelector('.list-view').style.display = isGuide ? 'none' : '';
    root.querySelector('.copy-footer').style.display = isGuide ? 'none' : '';

    // Update tabs
    root.querySelectorAll('.mode-pill-btn').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));

    if (isGuide) {
      this.updateGuide();
    } else {
      // Revert auto-yes for current step if undecided
      const opt = CONFIG.options[this.guideStep];
      if (opt && this.guideDecisions[opt.id] == null) {
        this.activeOptions.delete(opt.id);
      }
      clearHighlight();
      // Sync list toggles from shared state
      this.syncToggles();
      this.fireOptionsChange();
    }
    this.saveState();
  }

  updateGuide() {
    const root = this.shadowRoot;
    const total = CONFIG.options.length;
    const guideCard = root.querySelector('.guide-card');
    const guideSummary = root.querySelector('.guide-summary');
    const progressFill = root.querySelector('.guide-progress-fill');
    const progressText = root.querySelector('.guide-progress-text');
    const backBtn = root.querySelector('.guide-nav-back');
    const nextBtn = root.querySelector('.guide-nav-next');

    // Summary step — guideStep === total
    if (this.guideStep >= total) {
      this.guideStep = total; // clamp
      guideCard.style.display = 'none';
      guideSummary.style.display = '';
      // Progress bar: 100%, green
      progressFill.style.width = '100%';
      progressFill.style.background = 'var(--c-success)';
      progressText.textContent = 'Summary';
      // Build checklist
      this.renderSummaryList();
      // Nav: Back enabled, Next = "Copy Prompt"
      backBtn.disabled = false;
      nextBtn.textContent = 'Copy Prompt';
      // Fire options change to show all active in mockup
      clearHighlight();
      this.fireOptionsChange();
      return;
    }

    // Normal step — restore from summary
    guideCard.style.display = '';
    guideSummary.style.display = 'none';
    progressFill.style.background = '';

    const opt = CONFIG.options[this.guideStep];
    if (!opt) return;
    const hasVariants = opt.variants && Object.keys(opt.variants).length > 0;

    // Progress
    const pct = ((this.guideStep + 1) / total) * 100;
    progressFill.style.width = pct + '%';
    progressText.textContent = `${this.guideStep + 1} of ${total}`;

    // Card content
    root.querySelector('.guide-step-label').textContent = `OPTION ${opt.id}`;
    root.querySelector('.guide-option-name').textContent = opt.name;
    root.querySelector('.guide-recommended-badge').style.display = opt.recommended ? '' : 'none';
    root.querySelector('.guide-option-desc').textContent = opt.desc;

    // Auto-yes for undecided: temporarily activate so the element is visible
    if (this.guideDecisions[opt.id] == null && !this.activeOptions.has(opt.id)) {
      this.activeOptions.add(opt.id);
      this.fireOptionsChange();
    }

    // Variants section — always show (with Skip card)
    const varSection = root.querySelector('.guide-variants-section');
    const cardsEl = root.querySelector('.guide-variant-cards');
    const decision = this.guideDecisions[opt.id];
    const currentVariant = this.optionVariants[opt.id];

    if (hasVariants) {
      varSection.style.display = '';
      let cardsHtml = '';
      Object.entries(opt.variants).forEach(([key, label]) => {
        const isRecVariant = opt.recommended && opt.recommendedVariant === key;
        const isSelected = decision === 'yes' && currentVariant === key;
        cardsHtml += `<div class="guide-variant-card${isSelected ? ' selected' : ''}${isRecVariant ? ' recommended' : ''}" tabindex="0" role="button" data-gv-key="${key}"><div class="guide-variant-thumb"></div><div class="guide-variant-label">${this.esc(label)}</div>${isRecVariant ? '<div class="guide-variant-pick">Our pick</div>' : ''}</div>`;
      });
      cardsEl.innerHTML = cardsHtml; // eslint-disable-line -- trusted template from CONFIG keys
      this._renderThumbs(opt, cardsEl);

      // Update skip card state
      const skipCard = root.querySelector('.guide-variants-section > .guide-skip-card');
      skipCard.classList.toggle('selected', decision === 'no');

      // Bind variant card clicks and hover preview
      cardsEl.querySelectorAll('.guide-variant-card').forEach(card => {
        card.addEventListener('click', () => {
          this.optionVariants[opt.id] = card.dataset.gvKey;
          this.guideDecide('yes');
        });
        card.addEventListener('mouseenter', () => {
          const preview = Object.assign({}, this.optionVariants);
          preview[opt.id] = card.dataset.gvKey;
          const activePreview = new Set(this.activeOptions);
          activePreview.add(opt.id);
          this.startPreview(activePreview, preview);
        });
        card.addEventListener('mouseleave', () => this.endPreview());
      });

      // Bind Skip card click and hover
      skipCard.addEventListener('click', () => {
        this.guideDecide('no');
      });
      skipCard.addEventListener('mouseenter', () => {
        const preview = new Set(this.activeOptions);
        preview.delete(opt.id);
        this.startPreview(preview, null);
      });
      skipCard.addEventListener('mouseleave', () => this.endPreview());

      // Compare button in guide view
      if (!CONFIG.compareOnly) {
        let guideCompareBtn = cardsEl.parentElement.querySelector('.guide-compare-btn');
        if (!guideCompareBtn) {
          guideCompareBtn = document.createElement('button');
          guideCompareBtn.className = 'guide-compare-btn';
          guideCompareBtn.textContent = '\u22A2 Compare';
          cardsEl.parentElement.appendChild(guideCompareBtn);
        }
        guideCompareBtn.onclick = (e) => { e.stopPropagation(); if (window._engineInterface) window._engineInterface.open(opt.id); };
      }
    } else {
      varSection.style.display = 'none';
      const existingBtn = root.querySelector('.guide-compare-btn');
      if (existingBtn) existingBtn.remove();
    }

    // Generate more + notes — restore open state if option has notes
    const genCard = root.querySelector('.guide-generate-card');
    const notesSection = root.querySelector('.guide-notes-section');
    const notesTa = root.querySelector('.guide-notes-textarea');
    notesTa.value = this.optionNotes[opt.id] || '';
    const hasNotes = !!(this.optionNotes[opt.id] && this.optionNotes[opt.id].trim());
    const isSkipped = decision === 'no';
    genCard.classList.toggle('active', hasNotes && !isSkipped);
    genCard.style.display = isSkipped ? 'none' : '';
    notesSection.style.display = (hasNotes && !isSkipped) ? '' : 'none';

    // Nav
    backBtn.disabled = this.guideStep === 0;
    nextBtn.innerHTML = 'Next &#8594;';

    // Preview highlight — pan canvas to target element and add pulsing outline
    clearHighlight();
    if (opt.target && opt.target.view) switchView(opt.target.view);
    if (opt.target && opt.target.el) {
      setTimeout(() => {
        const el = document.getElementById(opt.target.el);
        if (!el) return;
        el.classList.add('mt-highlight');
        const view = el.closest('.mt-view');
        const ws = view && view._canvasWorkspace;
        if (ws) {
          const elRect = el.getBoundingClientRect();
          const isHidden = elRect.width === 0 && elRect.height === 0;
          // Skip panning to hidden elements (they have no meaningful position)
          if (isHidden) return;
          let contentX = 0, contentY = 0, node = el;
          while (node && node !== ws.content) {
            contentX += node.offsetLeft;
            contentY += node.offsetTop;
            node = node.offsetParent;
          }
          const viewRect = view.getBoundingClientRect();
          const centerX = viewRect.width / 2 - (contentX + el.offsetWidth / 2) * ws.zoom;
          const centerY = viewRect.height / 2 - (contentY + el.offsetHeight / 2) * ws.zoom;
          ws.setPan(centerX, centerY);
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }

    // compareOnly: auto-switch compare grid to current guide option
    if (CONFIG.compareOnly && opt.variants && window._engineInterface && window._engineInterface.optionId !== opt.id) {
      window._engineInterface.open(opt.id);
    }

    this.updateActiveCount();
  }

  renderSummaryList() {
    const root = this.shadowRoot;
    const listEl = root.querySelector('.guide-summary-list');
    let html = '';
    CONFIG.options.forEach((opt, idx) => {
      const isActive = this.activeOptions.has(opt.id);
      const variantLabel = (isActive && opt.variants && this.optionVariants[opt.id])
        ? (opt.variants[this.optionVariants[opt.id]] || '') : '';
      html += `<div class="guide-summary-item" data-summary-step="${idx}">`;
      html += `<span class="guide-summary-check ${isActive ? 'on' : 'off'}">${isActive ? '&#10003;' : '&#10007;'}</span>`;
      html += `<span class="guide-summary-name${isActive ? '' : ' off'}">${this.esc(opt.name)}</span>`;
      if (variantLabel) html += `<span class="guide-summary-variant">${this.esc(variantLabel)}</span>`;
      html += `<span class="guide-summary-edit">Edit</span>`;
      html += `</div>`;
    });
    listEl.innerHTML = html;
    // Bind jump-to-step clicks
    listEl.querySelectorAll('.guide-summary-item').forEach(item => {
      item.addEventListener('click', () => {
        this.guideStep = parseInt(item.dataset.summaryStep);
        this.saveState();
        this.updateGuide();
      });
    });
  }

  guideDecide(decision) {
    const opt = CONFIG.options[this.guideStep];
    if (!opt) return;
    this.guideDecisions[opt.id] = decision;
    if (decision === 'yes') {
      this.activeOptions.add(opt.id);
    } else {
      this.activeOptions.delete(opt.id);
    }
    this.syncToggles();
    this.saveState();
    this.fireOptionsChange();
    this.updateGuide();
  }

  guideRevertAutoYes() {
    const opt = CONFIG.options[this.guideStep];
    if (opt && this.guideDecisions[opt.id] == null) {
      this.activeOptions.delete(opt.id);
      this.fireOptionsChange();
    }
    clearHighlight();
  }

  guideNext() {
    this.guideRevertAutoYes();
    if (this.guideStep >= CONFIG.options.length) {
      // Already on summary — copy prompt
      this.copyPrompt();
      return;
    }
    this.guideStep++;
    this.saveState();
    this.updateGuide();
  }

  guidePrev() {
    if (this.guideStep <= 0) return;
    this.guideRevertAutoYes();
    this.guideStep--;
    this.saveState();
    this.updateGuide();
  }

  guideToggleGenerate() {
    const root = this.shadowRoot;
    const genCard = root.querySelector('.guide-generate-card');
    const notesSection = root.querySelector('.guide-notes-section');
    const isActive = genCard.classList.toggle('active');
    notesSection.style.display = isActive ? '' : 'none';
    if (isActive) root.querySelector('.guide-notes-textarea').focus();
  }

  // --- Actions ---
  copyPrompt() {
    const hasAnyNotes = Object.values(this.optionNotes).some(n => n && n.trim());
    const mode = hasAnyNotes ? CONFIG.prompt.withNotes : CONFIG.prompt.withoutNotes;
    const selected = CONFIG.options.filter(o => this.activeOptions.has(o.id));
    const rejected = CONFIG.options.filter(o => !this.activeOptions.has(o.id));

    let text = '';
    if (hasAnyNotes) {
      text += `${mode.preamble} (\`${CONFIG.filePath}\`):\n\n`;
    } else {
      text += `${mode.preamble}\n\n`;
    }

    text += `## ${mode.selectedHeading}${hasAnyNotes ? ' ' + selected.length + ' options' : ''}\n`;
    selected.forEach(opt => {
      text += `- **Option ${opt.id}: ${opt.name}**\n`;
      if (opt.variants && this.optionVariants[opt.id]) {
        const label = opt.variants[this.optionVariants[opt.id]] || this.optionVariants[opt.id];
        text += `  - Chosen variant: ${label}\n`;
      }
      if (hasAnyNotes && this.optionNotes[opt.id]) {
        text += `  - Notes: ${this.optionNotes[opt.id]}\n`;
      }
    });

    text += `\n## ${mode.rejectedHeading}${hasAnyNotes ? ' ' + rejected.length + ' options' : ''}\n`;
    rejected.forEach(opt => {
      text += `- Option ${opt.id}: ${opt.name}\n`;
    });

    if (mode.footer) {
      text += `\n---\n${mode.footer}\n`;
    }

    this.showCopyPreview(text);
  }

  clearAllNotes() {
    this.optionNotes = {};

    const root = this.shadowRoot;
    const body = root.querySelector('.panel-body');
    if (body) {
      body.querySelectorAll('.notes-textarea').forEach(ta => {
        ta.value = '';
        ta.classList.remove('visible');
      });
      body.querySelectorAll('.list-generate-card').forEach(card => {
        card.classList.remove('active');
      });
      body.querySelectorAll('.notes-dot').forEach(dot => {
        dot.classList.remove('visible');
      });
    }

    const guideNotes = root.querySelector('.guide-notes-textarea');
    if (guideNotes) guideNotes.value = '';
    const guideNotesSection = root.querySelector('.guide-notes-section');
    if (guideNotesSection) guideNotesSection.style.display = 'none';
    const guideGenerateCard = root.querySelector('.guide-generate-card');
    if (guideGenerateCard) guideGenerateCard.classList.remove('active');

    if (this.panelMode === 'guide') this.updateGuide();
    this.saveState();
  }

  resetAll() {
    if (!confirm('Reset all selections and notes?')) return;
    this.activeOptions.clear();
    this.optionNotes = {};
    this.optionVariants = {};
    this.guideStep = 0;
    this.guideDecisions = {};
    this.initDefaultVariants();
    clearHighlight();

    const body = this.shadowRoot.querySelector('.panel-body');
    if (body) {
      this.syncToggles();
      body.querySelectorAll('.notes-textarea').forEach(ta => {
        ta.value = '';
        ta.classList.remove('visible');
      });
      body.querySelectorAll('.list-generate-card').forEach(card => {
        card.classList.remove('active');
      });
      body.querySelectorAll('.variant-btn').forEach(btn => {
        const optId = parseInt(btn.dataset.variantOpt);
        const key = btn.dataset.variantKey;
        btn.classList.toggle('selected', this.optionVariants[optId] === key);
      });
      body.querySelectorAll('.toggle-item.expanded').forEach(item => item.classList.remove('expanded'));
      body.querySelectorAll('.notes-dot').forEach(dot => dot.classList.remove('visible'));
    }

    if (this.panelMode === 'guide') this.updateGuide();
    this.saveState();
    this.fireOptionsChange();
  }

  // --- Panel Layout ---
  applyPanelLayout() {
    const panel = this.shadowRoot.querySelector('.panel');
    const collapseBtn = this.shadowRoot.querySelector('.panel-collapse-btn');
    const viewTabs = document.getElementById('mt-view-tabs');

    if (this._isMobile) {
      document.body.style.paddingRight = '0px';
      if (viewTabs) viewTabs.style.paddingRight = '0';
      panel.classList.remove('collapsed');
      document.documentElement.style.setProperty('--panel-width', '0px');
      if (this._sheetExpanded) {
        this.classList.remove('mt-sheet-collapsed');
      } else {
        this.classList.add('mt-sheet-collapsed');
      }
      return;
    }

    if (this.panelCollapsed && !this.hoverExpanded) {
      panel.classList.add('collapsed');
      this.style.width = '36px';
      collapseBtn.innerHTML = OptionsPanel.chevron('left');
      document.body.style.paddingRight = '36px';
      if (viewTabs) viewTabs.style.paddingRight = '36px';
      document.documentElement.style.setProperty('--panel-width', '36px');
      return;
    }

    panel.classList.remove('collapsed');
    collapseBtn.innerHTML = this.panelCollapsed ? OptionsPanel.chevron('left') : OptionsPanel.chevron('right');
    this.style.width = this.panelWidth + 'px';
    // Keep body padding narrow when hover-expanded so content doesn't shift
    const pw = (this.panelCollapsed && !this.hoverExpanded) ? 36 : this.panelWidth;
    if (this.hoverExpanded) {
      document.body.style.paddingRight = '36px';
      if (viewTabs) viewTabs.style.paddingRight = '36px';
    } else {
      document.body.style.paddingRight = pw + 'px';
      if (viewTabs) viewTabs.style.paddingRight = pw + 'px';
    }

    // Expose panel width as CSS custom property for compare overlay
    document.documentElement.style.setProperty('--panel-width', pw + 'px');
  }

  // --- Events ---
  fireOptionsChange() {
    this.dispatchEvent(new CustomEvent('options-change', {
      bubbles: true,
      composed: true,
      detail: {
        active: this._previewActive ?? this.activeOptions,
        variants: this._previewVariants ?? this.optionVariants,
      },
    }));
  }

  startPreview(activeOverride, variantsOverride) {
    this._previewActive = activeOverride;
    this._previewVariants = variantsOverride;
    window._isPreview = true;
    // Add pulsing border indicator
    const activeView = document.querySelector('.mt-view.active');
    if (activeView) activeView.classList.add('mt-preview-active');
    this.fireOptionsChange();
  }

  endPreview() {
    if (this._previewActive === null && this._previewVariants === null) return;
    this._previewActive = null;
    this._previewVariants = null;
    window._isPreview = false;
    // Remove pulsing border indicator
    const previewView = document.querySelector('.mt-preview-active');
    if (previewView) previewView.classList.remove('mt-preview-active');
    this.fireOptionsChange();
  }

  // --- Utility ---
  /* --- Variant Thumbnail Rendering --- */

  _renderThumbs(opt, cardsEl) {
    if (!opt.target || !opt.target.el || !opt.variants) return;
    const targetEl = document.getElementById(opt.target.el);
    if (!targetEl) return;

    // Target may be inside a hidden view/container — temporarily reveal for measurement
    const view = targetEl.closest('.mt-view');
    const viewsContainer = view ? view.parentElement : null;
    const restore = [];
    // Reveal #mt-views container if hidden
    if (viewsContainer && getComputedStyle(viewsContainer).display === 'none') {
      restore.push({ el: viewsContainer, props: { display: viewsContainer.style.display, position: viewsContainer.style.position, visibility: viewsContainer.style.visibility, pointerEvents: viewsContainer.style.pointerEvents } });
      viewsContainer.style.display = 'block';
      viewsContainer.style.position = 'absolute';
      viewsContainer.style.visibility = 'hidden';
      viewsContainer.style.pointerEvents = 'none';
    }
    // Reveal the view itself if hidden
    if (view && getComputedStyle(view).display === 'none') {
      restore.push({ el: view, props: { display: view.style.display, position: view.style.position, visibility: view.style.visibility, pointerEvents: view.style.pointerEvents } });
      view.style.display = 'block';
      view.style.position = 'absolute';
      view.style.visibility = 'hidden';
      view.style.pointerEvents = 'none';
    }

    // Temporarily show the active variant for each card to get correct measurements
    // First, ensure target el itself is visible
    const targetWasHidden = targetEl.classList.contains('mt-hidden');
    if (targetWasHidden) targetEl.classList.remove('mt-hidden');

    cardsEl.querySelectorAll('.guide-variant-card').forEach(card => {
      const key = card.dataset.gvKey;
      const thumbDiv = card.querySelector('.guide-variant-thumb');
      if (!thumbDiv || !key) return;

      // Clone just the variant element for a tighter crop
      const variantElId = `${opt.target.el}-${key}`;
      const variantEl = document.getElementById(variantElId);
      if (!variantEl) return;

      // Temporarily show this variant for cloning
      const prevDisplay = variantEl.style.display;
      variantEl.style.display = '';
      variantEl.offsetHeight; // force reflow so scrollWidth/scrollHeight are correct

      const clone = variantEl.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      // Strip crossfade inline styles that toggleVariant may have left on the element
      clone.style.opacity = '';
      clone.style.position = '';
      clone.style.top = '';
      clone.style.left = '';
      clone.style.width = '';
      clone.style.transition = '';
      clone.style.pointerEvents = '';
      clone.style.display = '';

      variantEl.style.display = prevDisplay;

      // Adopt light DOM stylesheets into shadow root (once) so clone renders correctly
      this._adoptPageStyles();

      // Insert clone into thumb, measure its natural size, then scale to fit
      const pad = 8;
      const inner = document.createElement('div');
      inner.className = 'guide-variant-thumb-inner';
      inner.appendChild(clone);
      thumbDiv.appendChild(inner);

      const cloneW = inner.scrollWidth;
      const cloneH = inner.scrollHeight;
      if (!cloneW || !cloneH) return;

      const thumbW = thumbDiv.offsetWidth || 120;
      const thumbH = thumbDiv.offsetHeight || 120;
      const scaleX = (thumbW - pad * 2) / cloneW;
      const scaleY = (thumbH - pad * 2) / cloneH;
      const scale = Math.min(scaleX, scaleY, 1);

      // Center the scaled content within the thumbnail
      const scaledW = cloneW * scale;
      const scaledH = cloneH * scale;
      const offsetX = (thumbW - scaledW) / 2;
      const offsetY = (thumbH - scaledH) / 2;

      inner.style.transform = `scale(${scale})`;
      inner.style.width = cloneW + 'px';
      inner.style.left = offsetX + 'px';
      inner.style.top = offsetY + 'px';
    });

    // Restore hidden state
    if (targetWasHidden) targetEl.classList.add('mt-hidden');
    restore.forEach(r => {
      Object.entries(r.props).forEach(([k, v]) => r.el.style[k] = v);
    });
  }

  _adoptPageStyles() {
    if (this._pageStylesAdopted) return;
    this._pageStylesAdopted = true;
    const sheets = [];
    for (const sheet of document.styleSheets) {
      try {
        const clone = new CSSStyleSheet();
        let rules = '';
        for (const rule of sheet.cssRules) rules += rule.cssText + '\n';
        clone.replaceSync(rules);
        sheets.push(clone);
      } catch (e) { /* cross-origin */ }
    }
    this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, ...sheets];
  }

  esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

/* ============================================================
   CANVAS VIEW SETUP (shared DOM wrapping — used by v1 and v2)
   ============================================================ */
function initCanvasViews() {
  const canvasCfg = CONFIG.canvas || {};
  const defaultBg = canvasCfg.grid === false ? 'none' : 'checker';
  const savedBg = localStorage.getItem(CONFIG.storageKey + '-canvas-bg') || defaultBg;
  const savedSize = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-size') || 'md';
  const savedColor = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-color') || '';
  const savedOpacity = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-opacity') || '0.1';
  const savedBlend = localStorage.getItem(CONFIG.storageKey + '-canvas-bg-blend') || '';
  document.querySelectorAll('.mt-view').forEach(viewEl => {
    // Apply background settings to view element
    viewEl.classList.add('mt-bg-' + savedBg);
    if (savedBg !== 'none') viewEl.classList.add('mt-bg-' + savedSize);
    if (savedColor) viewEl.style.setProperty('--bg-color', savedColor);
    viewEl.style.setProperty('--bg-opacity', savedOpacity);
    if (savedBlend) viewEl.style.setProperty('--bg-blend', savedBlend);
    // Wrap existing children in canvas structure
    const viewport = document.createElement('div');
    viewport.className = 'mt-canvas-viewport';
    const content = document.createElement('div');
    content.className = 'mt-canvas-content';
    const item = document.createElement('div');
    item.className = 'mt-canvas-surface';
    while (viewEl.firstChild) item.appendChild(viewEl.firstChild);
    content.appendChild(item);
    viewport.appendChild(content);
    viewEl.appendChild(viewport);
  });
}

// --- DOM Bootstrap from window.MOCKUP ---
function bootstrapFromMockup() {
  if (!window.MOCKUP) return;
  const { config, views } = window.MOCKUP;
  if (!config || !views) return;

  // Create view tabs container
  if (!document.getElementById('mt-view-tabs')) {
    const tabs = document.createElement('div');
    tabs.id = 'mt-view-tabs';
    document.body.insertBefore(tabs, document.body.firstChild);
  }

  // Create views container with view elements
  if (!document.getElementById('mt-views')) {
    const container = document.createElement('div');
    container.id = 'mt-views';
    const viewIds = config.views || [];
    viewIds.forEach((v, i) => {
      const div = document.createElement('div');
      div.id = 'view-' + v.id;
      div.className = 'mt-view' + (i === 0 ? ' active' : '');
      // Views contain developer-authored HTML from the .mockup.js data file (same-origin, trusted)
      div.innerHTML = views[v.id] || ''; // eslint-disable-line no-unsanitized/property
      container.appendChild(div);
    });
    document.body.insertBefore(container, document.querySelector('options-panel') || document.body.lastChild);
  }

  // Create options-panel element
  if (!document.querySelector('options-panel')) {
    const panel = document.createElement('options-panel');
    document.body.appendChild(panel);
  }

  console.log('[engine] Bootstrapped DOM from window.MOCKUP');
}

// --- Config Loading ---
function loadConfig() {
  // window.MOCKUP data file format (two-file architecture)
  if (window.MOCKUP && window.MOCKUP.config) {
    console.log('[engine] Loaded config from window.MOCKUP');
    return window.MOCKUP.config;
  }
  // Inline JSON config (single-file legacy)
  const jsonTag = document.querySelector('#mockup-config');
  if (jsonTag) {
    try {
      const config = JSON.parse(jsonTag.textContent);
      console.log('[engine] Loaded config from <script id="mockup-config">');
      return config;
    } catch (e) {
      console.error('[engine] Failed to parse #mockup-config JSON:', e);
    }
  }
  if (window.CONFIG) {
    console.log('[engine] Loaded config from window.CONFIG (legacy mode)');
    return window.CONFIG;
  }
  throw new Error('[engine] No CONFIG found. Use window.MOCKUP, <script id="mockup-config">, or window.CONFIG.');
}

function validateConfig(config) {
  if (!config.options) return;
  config.options.forEach(opt => {
    const count = opt.variants ? Object.keys(opt.variants).length : 0;
    if (count < 4) {
      console.warn(`[engine] Option ${opt.id} "${opt.name}" has ${count} variant(s) — minimum 4 recommended.`);
    }
  });
}

function generateApplyOptions(config) {
  console.log('[engine] Auto-generated applyOptions from config');
  return function applyOptions(active, variants) {
    config.options.forEach(opt => {
      if (opt.target && opt.target.el) {
        toggle(opt.target.el, active.has(opt.id));
      }
      if (opt.variants) {
        const els = {};
        Object.keys(opt.variants).forEach(key => {
          els[key] = opt.target.el + '-' + key;
        });
        toggleVariant(els, active.has(opt.id), variants[opt.id]);
      }
    });
  };
}

// --- Auto-populate placeholder photos ---
function populatePhotos(root, storageKey) {
  const rotations = JSON.parse(localStorage.getItem(storageKey + '-photo-rotations') || '{}');
  root.querySelectorAll('img[data-mt-photo]').forEach((img, i) => {
    const w = img.getAttribute('width') || 600;
    const h = img.getAttribute('height') || 400;
    const baseSeed = img.alt ? img.alt.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') : `photo-${i}`;
    const rot = rotations[baseSeed] || 0;
    const seed = rot > 0 ? `${baseSeed}-${rot}` : baseSeed;
    img.src = `https://picsum.photos/seed/${seed}/${w}/${h}`;
    img.dataset.mtPhotoSeed = baseSeed;

    // Wrap in container for rotate button if not already wrapped
    if (!img.parentElement.classList.contains('mt-photo-wrap')) {
      const wrap = document.createElement('span');
      wrap.className = 'mt-photo-wrap';
      img.parentNode.insertBefore(wrap, img);
      wrap.appendChild(img);
      const btn = document.createElement('button');
      btn.className = 'mt-photo-rotate';
      btn.type = 'button';
      btn.title = 'Show different photo';
      btn.textContent = '\u21BB';
      wrap.appendChild(btn);
    }
  });
}

// Delegate rotate-button clicks (works in main view and compare clones)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.mt-photo-rotate');
  if (!btn) return;
  const wrap = btn.closest('.mt-photo-wrap');
  const img = wrap && wrap.querySelector('img[data-mt-photo]');
  if (!img || !window.CONFIG) return;
  const key = window.CONFIG.storageKey + '-photo-rotations';
  const rotations = JSON.parse(localStorage.getItem(key) || '{}');
  const baseSeed = img.dataset.mtPhotoSeed;
  rotations[baseSeed] = (rotations[baseSeed] || 0) + 1;
  localStorage.setItem(key, JSON.stringify(rotations));
  const w = img.getAttribute('width') || 600;
  const h = img.getAttribute('height') || 400;
  const seed = `${baseSeed}-${rotations[baseSeed]}`;
  img.src = `https://picsum.photos/seed/${seed}/${w}/${h}`;
  wrap.classList.add('mt-photo-loading');
  btn.disabled = true;
  img.onload = img.onerror = () => {
    wrap.classList.remove('mt-photo-loading');
    btn.disabled = false;
  };
  e.stopPropagation();
});

// --- Boot ---
bootstrapFromMockup();
const CONFIG = loadConfig();

// Apply defaults for omitted fields (reduces agent output tokens)
if (!CONFIG.prompt) {
  CONFIG.prompt = {
    withNotes: {
      preamble: "Here are my selections from the mockup",
      selectedHeading: "I want these options",
      rejectedHeading: "I reject these options",
      footer: "Update mockup with my notes. For each note create multiple variations for me to choose from."
    },
    withoutNotes: {
      preamble: "Implement this:",
      selectedHeading: "Selected",
      rejectedHeading: "Rejected",
      footer: ""
    }
  };
}
if (CONFIG.combos === undefined) CONFIG.combos = [];
if (CONFIG.compareOnly === undefined) CONFIG.compareOnly = true;
CONFIG._originalCompareOnly = CONFIG.compareOnly;

// Migrate old localStorage key to new interface key
const _oldCompareKey = localStorage.getItem(CONFIG.storageKey + '-compare-only');
if (_oldCompareKey !== null && localStorage.getItem(CONFIG.storageKey + '-interface') === null) {
  localStorage.setItem(CONFIG.storageKey + '-interface', _oldCompareKey === '1' ? 'v2' : 'v1');
  localStorage.removeItem(CONFIG.storageKey + '-compare-only');
}

// Resolve interface version: localStorage override > CONFIG.compareOnly mapping
const _savedInterface = localStorage.getItem(CONFIG.storageKey + '-interface');
if (_savedInterface) {
  CONFIG.compareOnly = _savedInterface === 'v2';
} else {
  // No saved preference — use CONFIG default
}

validateConfig(CONFIG);
window.CONFIG = CONFIG;

// Populate placeholder photos now that views are in DOM
populatePhotos(document, CONFIG.storageKey);

customElements.define('options-panel', OptionsPanel);

const applyFn = (typeof window.applyOptions === 'function')
  ? window.applyOptions
  : generateApplyOptions(CONFIG);
initTabs();
initCanvasViews();

// Restore active view from saved state
const _panel = document.querySelector('options-panel');
if (_panel && _panel._pendingActiveView) {
  switchView(_panel._pendingActiveView);
  _panel._pendingActiveView = null;
}

// Attach options-change listener synchronously (before microtask fires initial event)
document.querySelector('options-panel').addEventListener('options-change', e => {
  applyFn(e.detail.active, e.detail.variants);
});

// Dynamically load interface version and boot
const _interfaceVersion = CONFIG.compareOnly ? 'v2' : 'v1';
(async () => {
  try {
    await loadInterface(_interfaceVersion);
    console.log(`[engine] Loaded interface ${_interfaceVersion}`);
  } catch (e) {
    console.error(`[engine] Failed to load interface ${_interfaceVersion}:`, e);
  }

  // Interface module registers window._engineInterface — call init
  if (window._engineInterface) {
    window._engineInterface.init(CONFIG);
  }
})();
