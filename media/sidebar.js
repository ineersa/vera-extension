(function () {
  var vscode = acquireVsCodeApi();
  var bootstrapNode = document.getElementById('vera-bootstrap');
  if (!bootstrapNode) {
    return;
  }

  var bootstrap = JSON.parse(bootstrapNode.textContent || '{}');
  var state = bootstrap.state || {};
  var tabTitles = bootstrap.tabTitles || {
    all: 'All',
    search: 'Search',
    grep: 'Grep',
    classes: 'Classes',
    methods: 'Methods',
  };
  var activeTab = 'all';
  var configPanelOpen = false;
  var configDrafts = {};

  var searchForm = document.getElementById('search-form');
  var queryInput = document.getElementById('query-input');
  var deepSearchInput = document.getElementById('deep-search');
  var docsScopeInput = document.getElementById('docs-scope');
  var searchButton = document.getElementById('search-button');
  var indexButton = document.getElementById('index-button');
  var configButton = document.getElementById('config-button');
  var configPanel = document.getElementById('config-panel');
  var configRefreshButton = document.getElementById('config-refresh');
  var configStatusEl = document.getElementById('config-status');
  var configErrorEl = document.getElementById('config-error');
  var configListEl = document.getElementById('config-list');
  var statusEl = document.getElementById('status');
  var errorEl = document.getElementById('error');
  var resultsEl = document.getElementById('results');
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttribute(text) {
    return escapeHtml(text);
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function getAllTabGrepLimit() {
    var value = Number(state.allTabGrepLimit);
    if (!Number.isFinite(value) || value < 1) {
      return 20;
    }
    return Math.floor(value);
  }

  function readToggle(input) {
    return Boolean(input && input.checked);
  }

  function syncTogglesFromState() {
    if (deepSearchInput && typeof state.deepSearch === 'boolean') {
      deepSearchInput.checked = state.deepSearch;
    }
    if (docsScopeInput && typeof state.docsScope === 'boolean') {
      docsScopeInput.checked = state.docsScope;
    }
  }

  function matchesTab(item, tab) {
    if (tab === 'all') {
      return true;
    }
    if (tab === 'search') {
      return item.source === 'search' || item.source === 'both';
    }
    if (tab === 'grep') {
      return item.source === 'grep' || item.source === 'both';
    }
    if (tab === 'classes') {
      return item.symbolGroup === 'class';
    }
    if (tab === 'methods') {
      return item.symbolGroup === 'method';
    }
    return true;
  }

  function updateActionButtons() {
    var loading = Boolean(state.loading);
    var indexing = Boolean(state.indexing);
    var configLoading = Boolean(state.configLoading);
    var configSaving = typeof state.configSavingKey === 'string' && state.configSavingKey.length > 0;

    if (searchButton) {
      if (loading || indexing) {
        searchButton.setAttribute('disabled', 'true');
      } else {
        searchButton.removeAttribute('disabled');
      }
      searchButton.textContent = loading ? 'Searching...' : 'Search';
    }

    if (indexButton) {
      if (loading || indexing) {
        indexButton.setAttribute('disabled', 'true');
      } else {
        indexButton.removeAttribute('disabled');
      }
      indexButton.textContent = indexing ? 'Indexing...' : 'Index';
    }

    if (configButton) {
      configButton.classList.toggle('active', configPanelOpen);
      configButton.textContent = configPanelOpen ? 'Close Config' : 'Config';
      if (configLoading || configSaving) {
        configButton.classList.add('busy');
      } else {
        configButton.classList.remove('busy');
      }
    }
  }

  function syncDraftsWithEntries(entries) {
    var nextDrafts = {};
    for (var i = 0; i < entries.length; i += 1) {
      var key = entries[i].key;
      if (hasOwn(configDrafts, key)) {
        nextDrafts[key] = configDrafts[key];
      }
    }
    configDrafts = nextDrafts;
  }

  function getDraftValue(entry) {
    if (hasOwn(configDrafts, entry.key)) {
      return String(configDrafts[entry.key]);
    }
    return typeof entry.value === 'string' ? entry.value : '';
  }

  function renderConfigPanel() {
    if (!configPanel) {
      return;
    }

    if (!configPanelOpen) {
      configPanel.setAttribute('hidden', 'hidden');
      return;
    }

    configPanel.removeAttribute('hidden');

    var configLoading = Boolean(state.configLoading);
    var savingKey = typeof state.configSavingKey === 'string' ? state.configSavingKey : '';
    var configBusy = configLoading || savingKey.length > 0;
    var statusText = '';

    if (configLoading) {
      statusText = 'Loading Vera config...';
    } else if (savingKey.length > 0) {
      statusText = 'Saving ' + savingKey + '...';
    } else if (typeof state.configStatus === 'string') {
      statusText = state.configStatus;
    }

    if (configStatusEl) {
      configStatusEl.textContent = statusText;
      configStatusEl.style.display = statusText ? 'block' : 'none';
    }

    var configErrorText = typeof state.configError === 'string' ? state.configError : '';
    if (configErrorEl) {
      configErrorEl.textContent = configErrorText;
      configErrorEl.style.display = configErrorText ? 'block' : 'none';
    }

    if (configRefreshButton) {
      if (configBusy) {
        configRefreshButton.setAttribute('disabled', 'true');
      } else {
        configRefreshButton.removeAttribute('disabled');
      }
      configRefreshButton.textContent = configLoading ? 'Loading...' : 'Refresh';
    }

    if (!configListEl) {
      return;
    }

    var entries = Array.isArray(state.configEntries) ? state.configEntries : [];
    syncDraftsWithEntries(entries);

    if (configLoading && entries.length === 0) {
      configListEl.innerHTML = '<div class="config-empty">Loading config values...</div>';
      return;
    }

    if (entries.length === 0) {
      configListEl.innerHTML = '<div class="config-empty">No config values loaded yet. Press Refresh.</div>';
      return;
    }

    var grouped = {};
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      var section = typeof entry.section === 'string' && entry.section ? entry.section : 'general';
      if (!Array.isArray(grouped[section])) {
        grouped[section] = [];
      }
      grouped[section].push(entry);
    }

    var sectionNames = Object.keys(grouped).sort(function (a, b) {
      return a.localeCompare(b);
    });

    var html = '';
    for (var sectionIndex = 0; sectionIndex < sectionNames.length; sectionIndex += 1) {
      var sectionName = sectionNames[sectionIndex];
      var rows = grouped[sectionName];

      html +=
        '<section class="config-group">' +
        '<div class="config-group-title">' +
        escapeHtml(sectionName) +
        '</div>';

      for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        var row = rows[rowIndex];
        var key = typeof row.key === 'string' ? row.key : '';
        var valueType = typeof row.valueType === 'string' ? row.valueType : 'string';
        var draftValue = getDraftValue(row);
        var editorDisabled = configBusy ? ' disabled' : '';
        var saveDisabled = configBusy ? ' disabled' : '';
        var saveLabel = savingKey === key ? 'Saving...' : 'Save';

        var editorHtml;
        if (valueType === 'json') {
          editorHtml =
            '<textarea class="config-input config-json-input" data-config-input-key="' +
            escapeAttribute(key) +
            '"' +
            editorDisabled +
            '>' +
            escapeHtml(draftValue) +
            '</textarea>';
        } else {
          editorHtml =
            '<input class="config-input" type="text" data-config-input-key="' +
            escapeAttribute(key) +
            '" value="' +
            escapeAttribute(draftValue) +
            '"' +
            editorDisabled +
            ' />';
        }

        html +=
          '<div class="config-row" data-config-row-key="' +
          escapeAttribute(key) +
          '">' +
          '<div class="config-row-head">' +
          '<div class="config-key">' +
          escapeHtml(key) +
          '</div>' +
          '<div class="config-row-tags">' +
          '<span class="config-pill">' +
          escapeHtml(valueType) +
          '</span>' +
          '</div>' +
          '</div>' +
          '<div class="config-row-editor">' +
          editorHtml +
          '<button class="config-save-btn" type="button" data-config-save-key="' +
          escapeAttribute(key) +
          '"' +
          saveDisabled +
          '>' +
          saveLabel +
          '</button>' +
          '</div>' +
          '</div>';
      }

      html += '</section>';
    }

    configListEl.innerHTML = html;
  }

  function updateTabCounts() {
    var counts = state.counts || {};
    for (var i = 0; i < tabButtons.length; i += 1) {
      var button = tabButtons[i];
      var tab = button.getAttribute('data-tab') || 'all';
      var countValue = typeof counts[tab] === 'number' ? counts[tab] : 0;
      var countEl = button.querySelector('.tab-count');
      if (countEl) {
        countEl.textContent = String(countValue);
      }
    }
  }

  function render() {
    updateTabCounts();
    renderConfigPanel();

    var all = Array.isArray(state.results) ? state.results : [];
    var visible;
    if (activeTab === 'all') {
      var allTabGrepLimit = getAllTabGrepLimit();
      var grepShown = 0;
      visible = [];
      for (var i = 0; i < all.length; i += 1) {
        var candidate = all[i];
        if (candidate.source === 'grep') {
          if (grepShown < allTabGrepLimit) {
            visible.push(candidate);
            grepShown += 1;
          }
          continue;
        }
        visible.push(candidate);
      }
    } else {
      visible = all.filter(function (item) {
        return matchesTab(item, activeTab);
      });
    }

    var counts = state.counts || {};
    var total = typeof counts[activeTab] === 'number' ? counts[activeTab] : 0;
    var title = tabTitles[activeTab] || 'All';

    if (statusEl) {
      var status;
      if (state.indexing) {
        status = 'Indexing workspace with Vera...';
      } else {
        status = String(visible.length) + ' shown of ' + String(total) + ' ' + title.toLowerCase() + ' results';
        if (activeTab === 'all' && total > visible.length) {
          status += ' (grep capped to ' + String(getAllTabGrepLimit()) + ' in All tab)';
        }
      }
      statusEl.textContent = status;
    }

    if (errorEl) {
      if (state.error) {
        errorEl.style.display = 'block';
        errorEl.textContent = state.error;
      } else {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }
    }

    if (!resultsEl) {
      return;
    }

    if (visible.length === 0) {
      resultsEl.innerHTML = '<div class="empty">No results for this tab yet. Run a query or switch tabs.</div>';
      return;
    }

    var groups = {
      exact: [],
      partial: [],
      other: [],
    };

    for (var i = 0; i < visible.length; i += 1) {
      var item = visible[i];
      if (item.bucket === 'exact') {
        groups.exact.push(item.html);
      } else if (item.bucket === 'partial') {
        groups.partial.push(item.html);
      } else {
        groups.other.push(item.html);
      }
    }

    var html = '';
    if (groups.exact.length > 0) {
      html +=
        '<section class="group"><div class="group-title">Exact symbol matches</div>' +
        groups.exact.join('') +
        '</section>';
    }
    if (groups.partial.length > 0) {
      html +=
        '<section class="group"><div class="group-title">Partial symbol matches</div>' +
        groups.partial.join('') +
        '</section>';
    }
    if (groups.other.length > 0) {
      html +=
        '<section class="group"><div class="group-title">Other matches</div>' +
        groups.other.join('') +
        '</section>';
    }

    resultsEl.innerHTML = html;
  }

  function setTab(tab) {
    activeTab = tab;
    for (var i = 0; i < tabButtons.length; i += 1) {
      var button = tabButtons[i];
      button.classList.toggle('active', button.getAttribute('data-tab') === tab);
    }
    render();
  }

  for (var i = 0; i < tabButtons.length; i += 1) {
    (function (button) {
      button.addEventListener('click', function () {
        var tab = button.getAttribute('data-tab') || 'all';
        setTab(tab);
      });
    })(tabButtons[i]);
  }

  if (searchForm) {
    searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (state.loading || state.indexing) {
        return;
      }
      var query = queryInput && typeof queryInput.value === 'string' ? queryInput.value.trim() : '';
      vscode.postMessage({
        type: 'search',
        query: query,
        deepSearch: readToggle(deepSearchInput),
        docsScope: readToggle(docsScopeInput),
      });
    });
  }

  if (indexButton) {
    indexButton.addEventListener('click', function () {
      if (state.loading || state.indexing) {
        return;
      }
      vscode.postMessage({ type: 'index' });
    });
  }

  if (configButton) {
    configButton.addEventListener('click', function () {
      configPanelOpen = !configPanelOpen;

      var entries = Array.isArray(state.configEntries) ? state.configEntries : [];
      if (configPanelOpen && entries.length === 0 && !state.configLoading) {
        vscode.postMessage({ type: 'loadConfig' });
      }

      updateActionButtons();
      renderConfigPanel();
    });
  }

  if (configRefreshButton) {
    configRefreshButton.addEventListener('click', function () {
      if (state.configLoading || state.configSavingKey) {
        return;
      }
      vscode.postMessage({ type: 'loadConfig' });
    });
  }

  if (configListEl) {
    configListEl.addEventListener('input', function (event) {
      var target = event.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
        return;
      }

      var key = target.getAttribute('data-config-input-key');
      if (!key) {
        return;
      }

      configDrafts[key] = target.value;
    });

    configListEl.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      var saveButton = target.closest('.config-save-btn');
      if (!saveButton) {
        return;
      }

      if (state.configLoading || state.configSavingKey) {
        return;
      }

      var key = saveButton.getAttribute('data-config-save-key');
      if (!key) {
        return;
      }

      var row = saveButton.closest('.config-row');
      if (!row) {
        return;
      }

      var input = row.querySelector('[data-config-input-key]');
      if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
        return;
      }

      configDrafts[key] = input.value;
      vscode.postMessage({ type: 'saveConfig', key: key, value: input.value });
    });
  }

  if (resultsEl) {
    resultsEl.addEventListener('click', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      var card = target.closest('.result-card');
      if (!card) {
        return;
      }

      var file = card.getAttribute('data-file');
      var line = Number(card.getAttribute('data-line'));
      if (!file || !Number.isFinite(line)) {
        return;
      }

      vscode.postMessage({ type: 'openFile', file: file, line: line });
    });
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'state') {
      var previousSavingKey = typeof state.configSavingKey === 'string' ? state.configSavingKey : '';
      state = message.state || state;

      var nextSavingKey = typeof state.configSavingKey === 'string' ? state.configSavingKey : '';
      var statusText = typeof state.configStatus === 'string' ? state.configStatus : '';
      if (
        previousSavingKey &&
        !nextSavingKey &&
        statusText.indexOf('Saved ' + previousSavingKey + '.') === 0
      ) {
        delete configDrafts[previousSavingKey];
      }

      if (queryInput && typeof state.query === 'string') {
        queryInput.value = state.query;
      }
      syncTogglesFromState();
      updateActionButtons();
      render();
      return;
    }

    if (message.type === 'focusQuery' && queryInput) {
      queryInput.focus();
      queryInput.select();
    }
  });

  updateActionButtons();
  syncTogglesFromState();
  renderConfigPanel();
  setTab('all');
  if (queryInput) {
    queryInput.focus();
  }
})();
