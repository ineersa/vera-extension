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

  var searchForm = document.getElementById('search-form');
  var queryInput = document.getElementById('query-input');
  var deepSearchInput = document.getElementById('deep-search');
  var docsScopeInput = document.getElementById('docs-scope');
  var searchButton = document.getElementById('search-button');
  var statusEl = document.getElementById('status');
  var errorEl = document.getElementById('error');
  var resultsEl = document.getElementById('results');
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));

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

  function setLoading(loading) {
    if (!searchButton) {
      return;
    }
    if (loading) {
      searchButton.setAttribute('disabled', 'true');
      searchButton.textContent = 'Searching...';
    } else {
      searchButton.removeAttribute('disabled');
      searchButton.textContent = 'Search';
    }
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
      var status = String(visible.length) + ' shown of ' + String(total) + ' ' + title.toLowerCase() + ' results';
      if (activeTab === 'all' && total > visible.length) {
        status += ' (grep capped to ' + String(getAllTabGrepLimit()) + ' in All tab)';
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
      var query = queryInput && typeof queryInput.value === 'string' ? queryInput.value.trim() : '';
      vscode.postMessage({
        type: 'search',
        query: query,
        deepSearch: readToggle(deepSearchInput),
        docsScope: readToggle(docsScopeInput),
      });
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
      state = message.state || state;
      if (queryInput && typeof state.query === 'string') {
        queryInput.value = state.query;
      }
      syncTogglesFromState();
      setLoading(Boolean(state.loading));
      render();
      return;
    }

    if (message.type === 'focusQuery' && queryInput) {
      queryInput.focus();
      queryInput.select();
    }
  });

  setLoading(Boolean(state.loading));
  syncTogglesFromState();
  setTab('all');
  if (queryInput) {
    queryInput.focus();
  }
})();
