/* ============================================================
   V3 INTERFACE — Component Catalog
   ============================================================ */

const CatalogMode = {
  config: null,
  audit: null,
  components: [],
  filteredComponents: [],
  expandedId: null,
  searchQuery: '',
  activeCategories: new Set(),
  showIssuesOnly: false,
  sortBy: 'category',
  viewMode: 'grid',
  els: {},

  init(config) {
    this.config = config;
    this.audit = window.MOCKUP.audit || {};
    this.components = (this.audit.components || []).slice();
    this.activeCategories = new Set(this.components.map(c => c.category));
    this.filteredComponents = this.components.slice();
    this.build();
  },

  build() {
    // Hide default views container if present
    const views = document.getElementById('mt-views');
    if (views) views.style.display = 'none';
    const tabs = document.getElementById('mt-view-tabs');
    if (tabs) tabs.style.display = 'none';

    const root = document.createElement('div');
    root.className = 'mt-catalog';

    // --- Sidebar ---
    const sidebar = document.createElement('div');
    sidebar.className = 'mt-catalog-sidebar';

    // Header + search
    const sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'mt-catalog-sidebar-header';
    const title = document.createElement('div');
    title.className = 'mt-catalog-sidebar-title';
    title.textContent = this.config.title || 'Component Catalog';
    sidebarHeader.appendChild(title);

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'mt-catalog-search';
    search.placeholder = 'Search components\u2026';
    search.addEventListener('input', () => {
      this.searchQuery = search.value.toLowerCase();
      this.applyFilters();
    });
    sidebarHeader.appendChild(search);
    sidebar.appendChild(sidebarHeader);

    // Stats
    const stats = this.audit.stats || {};
    const statsEl = document.createElement('div');
    statsEl.className = 'mt-catalog-stats';
    [
      [stats.totalComponents || this.components.length, 'Components'],
      [stats.categories || new Set(this.components.map(c => c.category)).size, 'Categories'],
      [stats.inconsistencies || (this.audit.inconsistencies || []).length, 'Issues'],
    ].forEach(([val, label]) => {
      const stat = document.createElement('div');
      stat.className = 'mt-catalog-stat';
      const v = document.createElement('div');
      v.className = 'mt-catalog-stat-value';
      v.textContent = val;
      const l = document.createElement('div');
      l.className = 'mt-catalog-stat-label';
      l.textContent = label;
      stat.appendChild(v);
      stat.appendChild(l);
      statsEl.appendChild(stat);
    });
    sidebar.appendChild(statsEl);

    // Sort
    const sortEl = document.createElement('div');
    sortEl.className = 'mt-catalog-sort';
    const sortLabel = document.createElement('label');
    sortLabel.textContent = 'Sort';
    const sortSelect = document.createElement('select');
    [['category', 'Category'], ['name', 'Name'], ['usage', 'Most Used']].forEach(([val, text]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      if (val === this.sortBy) opt.selected = true;
      sortSelect.appendChild(opt);
    });
    sortSelect.addEventListener('change', () => {
      this.sortBy = sortSelect.value;
      this.applyFilters();
    });
    sortEl.appendChild(sortLabel);
    sortEl.appendChild(sortSelect);
    sidebar.appendChild(sortEl);

    // Category filters
    const filtersEl = document.createElement('div');
    filtersEl.className = 'mt-catalog-filters';

    const filterHeading = document.createElement('div');
    filterHeading.className = 'mt-catalog-filter-heading';
    filterHeading.textContent = 'Categories';
    filtersEl.appendChild(filterHeading);

    // Count per category
    const categoryCounts = {};
    this.components.forEach(c => {
      categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
    });
    const categories = Object.keys(categoryCounts).sort();
    categories.forEach(cat => {
      const item = document.createElement('label');
      item.className = 'mt-catalog-filter-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.activeCategories.has(cat);
      cb.addEventListener('change', () => {
        if (cb.checked) this.activeCategories.add(cat);
        else this.activeCategories.delete(cat);
        this.applyFilters();
      });
      const span = document.createElement('span');
      span.textContent = cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ');
      const count = document.createElement('span');
      count.className = 'mt-catalog-filter-count';
      count.textContent = categoryCounts[cat];
      item.appendChild(cb);
      item.appendChild(span);
      item.appendChild(count);
      filtersEl.appendChild(item);
    });

    // Issues filter
    const issueCount = (this.audit.inconsistencies || []).length;
    if (issueCount > 0) {
      const issueSection = document.createElement('div');
      issueSection.className = 'mt-catalog-filter-issues';
      const issueHeading = document.createElement('div');
      issueHeading.className = 'mt-catalog-filter-heading';
      issueHeading.textContent = 'Issues';
      issueSection.appendChild(issueHeading);

      const issueItem = document.createElement('label');
      issueItem.className = 'mt-catalog-filter-item';
      const issueCb = document.createElement('input');
      issueCb.type = 'checkbox';
      issueCb.checked = false;
      issueCb.addEventListener('change', () => {
        this.showIssuesOnly = issueCb.checked;
        this.applyFilters();
      });
      const issueSpan = document.createElement('span');
      issueSpan.textContent = 'Show issues only';
      const issueCountSpan = document.createElement('span');
      issueCountSpan.className = 'mt-catalog-filter-count';
      issueCountSpan.textContent = issueCount;
      issueItem.appendChild(issueCb);
      issueItem.appendChild(issueSpan);
      issueItem.appendChild(issueCountSpan);
      issueSection.appendChild(issueItem);
      filtersEl.appendChild(issueSection);
    }

    sidebar.appendChild(filtersEl);
    root.appendChild(sidebar);

    // --- Main content ---
    const main = document.createElement('div');
    main.className = 'mt-catalog-main';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'mt-catalog-toolbar';
    const resultCount = document.createElement('span');
    resultCount.className = 'mt-catalog-result-count';
    this.els.resultCount = resultCount;
    toolbar.appendChild(resultCount);

    const viewToggle = document.createElement('div');
    viewToggle.className = 'mt-catalog-view-toggle';
    const gridBtn = document.createElement('button');
    gridBtn.className = 'mt-catalog-view-btn active';
    gridBtn.textContent = 'Grid';
    const listBtn = document.createElement('button');
    listBtn.className = 'mt-catalog-view-btn';
    listBtn.textContent = 'List';
    gridBtn.addEventListener('click', () => {
      this.viewMode = 'grid';
      gridBtn.classList.add('active');
      listBtn.classList.remove('active');
      this.els.grid.classList.remove('mt-catalog-list-view');
    });
    listBtn.addEventListener('click', () => {
      this.viewMode = 'list';
      listBtn.classList.add('active');
      gridBtn.classList.remove('active');
      this.els.grid.classList.add('mt-catalog-list-view');
    });
    viewToggle.appendChild(gridBtn);
    viewToggle.appendChild(listBtn);
    toolbar.appendChild(viewToggle);
    main.appendChild(toolbar);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'mt-catalog-grid';
    this.els.grid = grid;
    main.appendChild(grid);

    root.appendChild(main);
    document.body.appendChild(root);

    // Parse catalog view HTML for component snippets
    this.parseViewHtml();
    this.applyFilters();
  },

  parseViewHtml() {
    const catalogHtml = (window.MOCKUP.views || {}).catalog || '';
    if (!catalogHtml) return;

    const container = document.createElement('div');
    // Catalog view HTML is developer-authored content from the same-origin data file (trusted)
    container.innerHTML = catalogHtml; // eslint-disable-line no-unsanitized/property

    this._snippets = {};
    container.querySelectorAll('[data-component-id]').forEach(el => {
      this._snippets[el.getAttribute('data-component-id')] = el;
    });
  },

  getComponentSnippet(id) {
    return this._snippets ? this._snippets[id] : null;
  },

  getComponentIssues(componentId) {
    return (this.audit.inconsistencies || []).filter(
      inc => (inc.components || []).includes(componentId)
    );
  },

  applyFilters() {
    let list = this.components.slice();

    // Category filter
    list = list.filter(c => this.activeCategories.has(c.category));

    // Search filter
    if (this.searchQuery) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(this.searchQuery) ||
        c.category.toLowerCase().includes(this.searchQuery) ||
        (c.filePath || '').toLowerCase().includes(this.searchQuery)
      );
    }

    // Issues filter
    if (this.showIssuesOnly) {
      const issueComponentIds = new Set();
      (this.audit.inconsistencies || []).forEach(inc => {
        (inc.components || []).forEach(id => issueComponentIds.add(id));
      });
      list = list.filter(c => issueComponentIds.has(c.id));
    }

    // Sort
    list.sort((a, b) => {
      if (this.sortBy === 'name') return a.name.localeCompare(b.name);
      if (this.sortBy === 'usage') return (b.usageCount || 0) - (a.usageCount || 0);
      // category (default)
      const catCmp = a.category.localeCompare(b.category);
      return catCmp !== 0 ? catCmp : a.name.localeCompare(b.name);
    });

    this.filteredComponents = list;
    this.renderGrid();
  },

  renderGrid() {
    const grid = this.els.grid;
    grid.innerHTML = ''; // eslint-disable-line no-unsanitized/property

    this.els.resultCount.textContent = `${this.filteredComponents.length} component${this.filteredComponents.length !== 1 ? 's' : ''}`;

    if (this.filteredComponents.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mt-catalog-empty';
      empty.textContent = this.searchQuery ? 'No components match your search.' : 'No components to display.';
      grid.appendChild(empty);
      return;
    }

    this.filteredComponents.forEach(comp => {
      const card = this.buildCard(comp);
      grid.appendChild(card);
    });
  },

  buildCard(comp) {
    const card = document.createElement('div');
    card.className = 'mt-catalog-card';
    const issues = this.getComponentIssues(comp.id);
    if (issues.length > 0) card.classList.add('mt-catalog-card-has-issues');

    if (this.expandedId === comp.id) {
      card.classList.add('mt-catalog-card-expanded');
    }

    // Preview
    const preview = document.createElement('div');
    preview.className = 'mt-catalog-card-preview';
    const snippet = this.getComponentSnippet(comp.id);
    if (snippet) {
      // Show the first variant as preview
      const firstVariant = snippet.querySelector('[data-variant]');
      if (firstVariant) {
        const clone = firstVariant.cloneNode(true);
        preview.appendChild(clone);
      } else {
        // No variants, use full snippet
        const clone = snippet.cloneNode(true);
        clone.style.display = '';
        preview.appendChild(clone);
      }
      this.autoScalePreview(preview);
    }
    card.appendChild(preview);

    // Body
    const body = document.createElement('div');
    body.className = 'mt-catalog-card-body';

    const name = document.createElement('div');
    name.className = 'mt-catalog-card-name';
    name.textContent = comp.name;
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'mt-catalog-card-meta';

    const badge = document.createElement('span');
    badge.className = 'mt-catalog-badge mt-catalog-badge-' + (comp.category || 'other').replace(/\s+/g, '-');
    badge.textContent = comp.category || 'other';
    meta.appendChild(badge);

    if (comp.usageCount != null) {
      const usage = document.createElement('span');
      usage.className = 'mt-catalog-usage';
      usage.textContent = comp.usageCount + ' use' + (comp.usageCount !== 1 ? 's' : '');
      meta.appendChild(usage);
    }

    if (comp.variants && comp.variants.length > 0) {
      const vCount = document.createElement('span');
      vCount.className = 'mt-catalog-usage';
      vCount.textContent = comp.variants.length + ' variant' + (comp.variants.length !== 1 ? 's' : '');
      meta.appendChild(vCount);
    }

    body.appendChild(meta);
    card.appendChild(body);

    // Expanded detail
    if (this.expandedId === comp.id) {
      const detail = this.buildDetail(comp, issues);
      card.appendChild(detail);
    }

    // Click to expand/collapse
    card.addEventListener('click', (e) => {
      if (e.target.closest('.mt-catalog-detail')) return;
      this.expandedId = this.expandedId === comp.id ? null : comp.id;
      this.renderGrid();
    });

    return card;
  },

  buildDetail(comp, issues) {
    const detail = document.createElement('div');
    detail.className = 'mt-catalog-detail';

    // Header
    const header = document.createElement('div');
    header.className = 'mt-catalog-detail-header';
    const titleEl = document.createElement('div');
    titleEl.className = 'mt-catalog-detail-title';
    titleEl.textContent = comp.name;
    header.appendChild(titleEl);

    if (comp.filePath) {
      const path = document.createElement('div');
      path.className = 'mt-catalog-detail-path';
      path.textContent = comp.filePath;
      header.appendChild(path);
    }
    detail.appendChild(header);

    // Props
    if (comp.props && comp.props.length > 0) {
      const propsEl = document.createElement('div');
      propsEl.className = 'mt-catalog-detail-props';
      comp.props.forEach(p => {
        const prop = document.createElement('span');
        prop.className = 'mt-catalog-detail-prop';
        prop.textContent = p;
        propsEl.appendChild(prop);
      });
      detail.appendChild(propsEl);
    }

    // Variant grid
    const snippet = this.getComponentSnippet(comp.id);
    if (snippet && comp.variants && comp.variants.length > 0) {
      const variantGrid = document.createElement('div');
      variantGrid.className = 'mt-catalog-variant-grid';

      comp.variants.forEach(v => {
        const cell = document.createElement('div');
        cell.className = 'mt-catalog-variant-cell';

        const label = document.createElement('div');
        label.className = 'mt-catalog-variant-label';
        label.textContent = v.label || v.key;
        cell.appendChild(label);

        const vPreview = document.createElement('div');
        vPreview.className = 'mt-catalog-variant-preview';
        const variantEl = snippet.querySelector(`[data-variant="${v.key}"]`);
        if (variantEl) {
          vPreview.appendChild(variantEl.cloneNode(true));
        }
        cell.appendChild(vPreview);
        variantGrid.appendChild(cell);
      });
      detail.appendChild(variantGrid);
    }

    // Inconsistencies
    issues.forEach(inc => {
      const warn = document.createElement('div');
      warn.className = 'mt-catalog-inconsistency';

      const icon = document.createElement('span');
      icon.className = 'mt-catalog-inconsistency-icon';
      icon.textContent = '\u26A0';
      warn.appendChild(icon);

      const textWrap = document.createElement('div');
      const msg = document.createElement('div');
      msg.className = 'mt-catalog-inconsistency-text';
      msg.textContent = inc.message;
      textWrap.appendChild(msg);

      if (inc.suggestion) {
        const sug = document.createElement('div');
        sug.className = 'mt-catalog-inconsistency-suggestion';
        sug.textContent = '\u2192 ' + inc.suggestion;
        textWrap.appendChild(sug);
      }
      warn.appendChild(textWrap);
      detail.appendChild(warn);
    });

    return detail;
  },

  autoScalePreview(previewEl) {
    requestAnimationFrame(() => {
      const child = previewEl.firstElementChild;
      if (!child) return;
      const pW = previewEl.clientWidth - 24; // padding
      const pH = previewEl.clientHeight - 24;
      const cW = child.scrollWidth;
      const cH = child.scrollHeight;
      if (cW > 0 && cH > 0 && (cW > pW || cH > pH)) {
        const scale = Math.min(pW / cW, pH / cH, 1);
        child.style.transform = `scale(${scale})`;
        child.style.transformOrigin = 'center center';
      }
    });
  },
};

// Register as engine interface
window._engineInterface = {
  init(config) {
    CatalogMode.init(config);
  },
  open() {},
  close() {},
  pick() {},
  get isOpen() { return true; },
  get optionId() { return null; },
};
