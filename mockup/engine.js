/* ============================================================
   ENGINE CODE — Do not modify
   ============================================================ */

const ENGINE_VERSION = '0.6';

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
  Object.entries(els).forEach(([key, elId]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (active && key === chosenVariant) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
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
}

// --- View Tabs ---
function initTabs() {
  const viewTabs = document.getElementById('mt-view-tabs');
  if (CONFIG.views.length <= 1) {
    viewTabs.classList.add('mt-tabs-hidden');
    return;
  }
  CONFIG.views.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'mt-tab' + (document.getElementById('view-' + v.id)?.classList.contains('active') ? ' active' : '');
    btn.textContent = v.label;
    btn.dataset.view = v.id;
    btn.addEventListener('click', () => switchView(v.id));
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
    const state = {
      active: [...this.activeOptions],
      notes: this.optionNotes,
      variants: this.optionVariants,
      panelWidth: this.panelWidth,
      panelCollapsed: this.panelCollapsed,
      panelMode: this.panelMode,
      guideStep: this.guideStep,
      guideDecisions: this.guideDecisions,
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
        <button class="panel-help-btn" title="Keyboard shortcuts (?)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/><text x="8" y="11.5" text-anchor="middle" fill="currentColor" font-size="9" font-weight="600" font-family="system-ui">?</text></svg>
        </button>
        <span class="engine-version">v${ENGINE_VERSION}</span>
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
            <div class="guide-generate-card">
              <div class="guide-generate-label">+ Generate more variants</div>
              <div class="guide-generate-hint">Describe what you want</div>
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
        <div class="help-overlay-header">
          <span class="help-overlay-title">Keyboard Shortcuts</span>
          <kbd class="help-overlay-dismiss">? to close</kbd>
        </div>
        <div class="help-overlay-body">
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

    /* --- Engine Version Tag --- */
    .engine-version {
      font-size: 9px;
      color: var(--c-text-faint);
      font-family: monospace;
      letter-spacing: 0.5px;
    }
    .panel.collapsed .engine-version { display: none; }

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
    .guide-skip-card { border: 2px dashed var(--c-border-mid); }
    .guide-skip-card:hover {
      border-color: var(--c-danger);
      background: var(--c-danger-light);
    }
    .guide-skip-card.selected {
      border-color: var(--c-danger);
      background: var(--c-danger-light);
      border-style: solid;
    }
    .guide-skip-card .guide-variant-label {
      color: var(--c-text-muted);
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

    /* --- Notes (in detail) --- */
    .notes-btn {
      font-size: var(--text-xs);
      padding: var(--sp-1) 10px;
      border: 1px solid var(--c-border-mid);
      border-radius: var(--r-sm);
      background: var(--c-surface);
      cursor: pointer;
      color: var(--c-text-faint);
      transition: all var(--t-fast);
    }
    .notes-btn:hover { border-color: var(--c-primary); color: var(--c-primary); }
    .notes-btn.has-notes {
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
      transform: translate(-50%, -50%);
      background: var(--c-surface);
      border-radius: var(--r-lg);
      padding: var(--sp-6);
      box-shadow: var(--shadow-float);
      min-width: 260px;
      max-width: 400px;
    }
    .help-overlay-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--sp-4);
    }
    .help-overlay-title {
      font-size: var(--text-lg);
      font-weight: 700;
      color: var(--c-text);
    }
    .help-overlay-dismiss {
      background: var(--c-surface-alt);
      border: 1px solid var(--c-border);
      border-radius: var(--r-sm);
      padding: 2px 8px;
      font-size: var(--text-xs);
      font-family: monospace;
      color: var(--c-text-faint);
    }
    .help-overlay-body {
      display: flex;
      flex-direction: column;
      gap: var(--sp-1);
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
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      :host(.mt-sheet-collapsed) {
        transform: translateY(calc(100% - 52px));
      }
      .panel { border-left: none; border-top: 1px solid var(--c-border); }
      .panel-resize-handle { display: none; }
      .panel-drag-handle { display: flex; }

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
        html += `<div class="group-label" data-group="${this.esc(tag)}">${this.esc(viewMap[tag] || tag)}</div>`;
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
        html += `<div class="toggle-row">`;
        html += `<span class="toggle-number">${opt.id}</span>`;
        html += `<span class="toggle-name">${this.esc(opt.name)}</span>`;
        if (isRecommended) html += `<span class="recommended-badge">Recommended</span>`;
        html += `<span class="notes-dot${hasNotes ? ' visible' : ''}" data-dot="${opt.id}"></span>`;
        html += `<label class="toggle-switch"><input type="checkbox" data-opt="${opt.id}" ${isActive ? 'checked' : ''}><span class="toggle-slider"></span></label>`;
        html += `</div>`;

        // Detail section (hidden unless active/expanded)
        html += `<div class="toggle-detail">`;
        html += `<div class="toggle-desc">${this.esc(opt.desc)}</div>`;
        html += `<div class="toggle-detail-actions">`;
        html += `<button class="notes-btn${hasNotes ? ' has-notes' : ''}" data-notes-btn="${opt.id}">${hasNotes ? 'Edit Note' : 'Add Note'}</button>`;
        html += `</div>`;
        html += `<textarea class="notes-textarea${hasNotes ? ' visible' : ''}" data-notes="${opt.id}" placeholder="Add notes for this option...">${this.esc(noteText)}</textarea>`;

        if (hasVariants) {
          html += `<div class="variant-row">`;
          Object.entries(opt.variants).forEach(([key, label]) => {
            const isRecVariant = isRecommended && opt.recommendedVariant === key;
            html += `<button class="variant-btn${currentVariant === key ? ' selected' : ''}${isRecVariant ? ' recommended' : ''}" data-variant-opt="${opt.id}" data-variant-key="${key}">${this.esc(label)}</button>`;
          });
          html += `</div>`;
        }

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

    // --- Mode Pill ---
    root.querySelectorAll('.mode-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
    });

    // --- List Mode Events ---
    if (body) {
      body.querySelectorAll('.toggle-row').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.toggle-switch')) return;
          row.closest('.toggle-item').classList.toggle('expanded');
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

      body.querySelectorAll('.notes-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const ta = body.querySelector(`textarea[data-notes="${btn.dataset.notesBtn}"]`);
          ta.classList.toggle('visible');
          if (ta.classList.contains('visible')) ta.focus();
        });
      });

      body.querySelectorAll('textarea[data-notes]').forEach(ta => {
        ta.addEventListener('input', () => {
          const id = ta.dataset.notes;
          const val = ta.value.trim();
          if (val) { this.optionNotes[id] = val; } else { delete this.optionNotes[id]; }
          const btn = body.querySelector(`[data-notes-btn="${id}"]`);
          if (btn) { btn.textContent = val ? 'Edit Note' : 'Add Note'; btn.classList.toggle('has-notes', !!val); }
          const dot = body.querySelector(`.notes-dot[data-dot="${id}"]`);
          if (dot) dot.classList.toggle('visible', !!val);
          this.saveState();
        });
      });

      body.querySelectorAll('.variant-btn').forEach(btn => {
        btn.addEventListener('click', () => {
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
          const preview = Object.assign({}, this.optionVariants);
          preview[optId] = key;
          this.startPreview(null, preview);
        });
        btn.addEventListener('mouseleave', () => this.endPreview());
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
    });

    backdrop.addEventListener('click', () => this.toggleHelpOverlay());
  }

  toggleHelpOverlay() {
    this.helpOverlayOpen = !this.helpOverlayOpen;
    const overlay = this.shadowRoot.querySelector('.help-overlay');
    overlay.style.display = this.helpOverlayOpen ? '' : 'none';
    // Dismiss the hint on first use
    if (this.helpOverlayOpen) this.dismissHint();
  }

  dismissHint() {
    const hint = this.shadowRoot.querySelector('.panel-hint');
    if (hint) hint.classList.add('hidden');
  }

  initAutoExpand() {
    let hoverTimer = null;
    this.addEventListener('mouseenter', () => {
      if (!this.panelCollapsed) return;
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
      });
    });
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
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy to Clipboard';
          copyBtn.classList.remove('copied');
        }, 1500);
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
    this.shadowRoot.querySelector('.copy-preview-overlay').style.display = 'none';
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
          const viewRect = view.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const panel = document.querySelector('mockup-options');
          const panelWidth = panel ? panel.offsetWidth : 0;
          const availableWidth = viewRect.width - panelWidth;
          const contentX = (elRect.left - viewRect.left - ws.panX) / ws.zoom;
          const contentY = (elRect.top - viewRect.top - ws.panY) / ws.zoom;
          const centerX = availableWidth / 2 - (contentX + elRect.width / (2 * ws.zoom)) * ws.zoom;
          const centerY = viewRect.height / 2 - (contentY + elRect.height / (2 * ws.zoom)) * ws.zoom;
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
        cardsHtml += `<div class="guide-variant-card${isSelected ? ' selected' : ''}${isRecVariant ? ' recommended' : ''}" data-gv-key="${key}"><div class="guide-variant-label">${this.esc(label)}</div>${isRecVariant ? '<div class="guide-variant-pick">Our pick</div>' : ''}</div>`;
      });
      // Append Skip card
      cardsHtml += `<div class="guide-skip-card${decision === 'no' ? ' selected' : ''}" data-gv-key="__skip__"><div class="guide-variant-label">Skip</div></div>`;
      cardsEl.innerHTML = cardsHtml;

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
      const skipCard = cardsEl.querySelector('.guide-skip-card');
      skipCard.addEventListener('click', () => {
        this.guideDecide('no');
      });
      skipCard.addEventListener('mouseenter', () => {
        const preview = new Set(this.activeOptions);
        preview.delete(opt.id);
        this.startPreview(preview, null);
      });
      skipCard.addEventListener('mouseleave', () => this.endPreview());
    } else {
      varSection.style.display = 'none';
    }

    // Generate more + notes — restore open state if option has notes
    const genCard = root.querySelector('.guide-generate-card');
    const notesSection = root.querySelector('.guide-notes-section');
    const notesTa = root.querySelector('.guide-notes-textarea');
    notesTa.value = this.optionNotes[opt.id] || '';
    const hasNotes = !!(this.optionNotes[opt.id] && this.optionNotes[opt.id].trim());
    genCard.classList.toggle('active', hasNotes);
    notesSection.style.display = hasNotes ? '' : 'none';

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
          const viewRect = view.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const isHidden = elRect.width === 0 && elRect.height === 0;
          // Skip panning to hidden elements (they have no meaningful position)
          if (isHidden) return;
          const contentX = (elRect.left - viewRect.left - ws.panX) / ws.zoom;
          const contentY = (elRect.top - viewRect.top - ws.panY) / ws.zoom;
          const centerX = viewRect.width / 2 - (contentX + elRect.width / (2 * ws.zoom)) * ws.zoom;
          const centerY = viewRect.height / 2 - (contentY + elRect.height / (2 * ws.zoom)) * ws.zoom;
          ws.setPan(centerX, centerY);
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
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
      text += `- **Option ${opt.id}: ${opt.name}** -- ${opt.desc}\n`;
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
      body.querySelectorAll('.notes-btn').forEach(btn => {
        btn.textContent = 'Add Note';
        btn.classList.remove('has-notes');
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
      return;
    }

    panel.classList.remove('collapsed');
    collapseBtn.innerHTML = this.panelCollapsed ? OptionsPanel.chevron('left') : OptionsPanel.chevron('right');
    this.style.width = this.panelWidth + 'px';
    // Keep body padding narrow when hover-expanded so content doesn't shift
    if (this.hoverExpanded) {
      document.body.style.paddingRight = '36px';
      if (viewTabs) viewTabs.style.paddingRight = '36px';
    } else {
      document.body.style.paddingRight = this.panelWidth + 'px';
      if (viewTabs) viewTabs.style.paddingRight = this.panelWidth + 'px';
    }
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
    this.fireOptionsChange();
  }

  endPreview() {
    if (this._previewActive === null && this._previewVariants === null) return;
    this._previewActive = null;
    this._previewVariants = null;
    this.fireOptionsChange();
  }

  // --- Utility ---
  esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

/* ============================================================
   CANVAS WORKSPACE
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
    this.zoom = 1.0;
    this.centerContent();
    // Clear any scroll offset caused by scrollIntoView
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
    const margin = 0.1; // 10% of content must stay visible
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
      // Pinch-to-zoom (trackpad) or Ctrl+wheel (mouse)
      const delta = e.deltaY > 0 ? -1 : 1;
      const step = e.altKey ? this.config.fineZoomStep : this.config.zoomStep;
      const rect = this.container.getBoundingClientRect();
      this.setZoom(this.zoom + (delta * step), e.clientX - rect.left, e.clientY - rect.top);
    } else {
      // Two-finger scroll (trackpad) or mouse wheel without modifier → pan
      let dx = e.deltaX, dy = e.deltaY;
      if (e.deltaMode === 1) { dx *= 16; dy *= 16; }       // LINE mode
      else if (e.deltaMode === 2) { dx *= 100; dy *= 100; } // PAGE mode
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

function initCanvasViews() {
  const canvasCfg = CONFIG.canvas || {};
  const showGrid = canvasCfg.grid !== false;
  document.querySelectorAll('.mt-view').forEach(viewEl => {
    const viewId = viewEl.id.replace('view-', '');
    // Wrap existing children in canvas structure
    const viewport = document.createElement('div');
    viewport.className = 'mt-canvas-viewport';
    const content = document.createElement('div');
    content.className = 'mt-canvas-content' + (showGrid ? ' mt-grid' : '');
    while (viewEl.firstChild) content.appendChild(viewEl.firstChild);
    viewport.appendChild(content);
    viewEl.appendChild(viewport);

    // Inject zoom controls
    const controls = document.createElement('div');
    controls.className = 'mt-zoom-controls';
    controls.innerHTML = '<button data-zoom-out aria-label="Zoom out">\u2212</button><div class="mt-zoom-level">100%</div><button data-zoom-in aria-label="Zoom in">+</button><button data-zoom-reset aria-label="Reset zoom">\u27F2</button>';
    viewEl.appendChild(controls);

    // Instantiate workspace
    const storageKey = `${CONFIG.storageKey}-canvas-${viewId}`;
    const workspace = new CanvasWorkspace(viewEl, {
      ...canvasCfg,
      storageKey
    });
    viewEl._canvasWorkspace = workspace;
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

// --- Boot ---
bootstrapFromMockup();
const CONFIG = loadConfig();
validateConfig(CONFIG);
window.CONFIG = CONFIG;

customElements.define('options-panel', OptionsPanel);

const applyFn = (typeof window.applyOptions === 'function')
  ? window.applyOptions
  : generateApplyOptions(CONFIG);
initTabs();
initCanvasViews();
document.querySelector('options-panel').addEventListener('options-change', e => {
  applyFn(e.detail.active, e.detail.variants);
});
