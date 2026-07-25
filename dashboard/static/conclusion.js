/**
 * Honcho Dashboard — Conclusions Module
 */
(function() {
  'use strict';

  var pageState = { workspace: CONFIG.WORKSPACES[0], page: 1, search: '' };
  var workspaceCache = {};
  var loadingWorkspace = null;
  var esc = window._escapeHtml || function(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  function render() {
    var container = document.getElementById('conclusions-content');
    if (!container) return;

    if (!window.appData || !window.appData.conclusions || !window.appData.conclusions.items) {
      showSkeleton('conclusions-content', 'table');
      return;
    }
    var wsStats = (window.appData && window.appData.workspace_stats && window.appData.workspace_stats[pageState.workspace]) || {};
    var source = workspaceCache[pageState.workspace] || null;
    var conclusions = source ? [...source.items] : [...window.appData.conclusions.items].filter(function(c) { return !pageState.workspace || c.workspace_name === pageState.workspace; });
    var totalForWorkspace = source ? source.total : (wsStats.conclusions || conclusions.length);

    if (!source && pageState.workspace && conclusions.length === 0 && loadingWorkspace !== pageState.workspace) {
      loadWorkspace(pageState.workspace);
    }

    if (pageState.search) {
      var q = pageState.search.toLowerCase();
      conclusions = conclusions.filter(function(c) { return (c.content || '').toLowerCase().includes(q); });
    }

    var totalPages = Math.max(1, Math.ceil(conclusions.length / CONFIG.PAGE_SIZE));
    var page = Math.min(pageState.page, totalPages);
    var start = (page - 1) * CONFIG.PAGE_SIZE;
    var pageItems = conclusions.slice(start, start + CONFIG.PAGE_SIZE);

    container.innerHTML = [
      '<div class="flex-between mb-4">',
        '<div class="flex gap-2">',
          '<select id="conclusions-workspace-filter" class="btn" style="width:auto;">',
            CONFIG.WORKSPACES.map(function(w) { return '<option value="' + w + '" ' + (w === pageState.workspace ? 'selected' : '') + '>' + w + '</option>'; }).join(''),
          '</select>',
          '<button class="btn btn-sm" onclick="window._refreshData()">🔄 Refresh</button>',
        '</div>',
        '<span class="text-muted text-sm">' + conclusions.length + ' shown / ' + totalForWorkspace + ' workspace conclusions</span>',
      '</div>',

      '<div class="search-bar">',
        '<input type="text" id="conclusions-search" placeholder="Search conclusions..." value="' + esc(pageState.search) + '">',
        '<button class="btn btn-primary" id="conclusions-search-btn">Search</button>',
      '</div>',

      '<div class="table-container">',
        '<table>',
          '<thead><tr>',
            '<th>Content</th><th>Observer</th><th>Observed</th><th>Level</th><th>Created</th>',
          '</tr></thead>',
          '<tbody>',
            (loadingWorkspace === pageState.workspace ? '<tr><td colspan="5" class="empty-state"><div class="spinner"></div><p>Loading ' + esc(pageState.workspace) + ' conclusions...</p></td></tr>' : ''),
            (loadingWorkspace !== pageState.workspace && pageItems.length === 0 ? '<tr><td colspan="5" class="empty-state"><div class="empty-icon">🧠</div><p>No conclusions yet for workspace <strong>' + esc(pageState.workspace) + '</strong></p><p class="text-xs text-muted">Honcho API and database both report 0 conclusions for this workspace.</p></td></tr>' : ''),
            pageItems.map(function(c) { return [
              '<tr>',
                '<td><span class="text-sm">' + esc(c.content || '') + '</span></td>',
                '<td><code class="text-xs">' + esc(c.observer || '-') + '</code></td>',
                '<td><code class="text-xs">' + esc(c.observed || '-') + '</code></td>',
                '<td><span class="tag tag-purple">' + esc(c.level || '-') + '</span></td>',
                '<td class="text-xs text-muted">' + (c.created_at ? new Date(c.created_at).toLocaleString() : '-') + '</td>',
              '</tr>'
            ].join(''); }).join(''),
          '</tbody>',
        '</table>',
      '</div>',

      (totalPages > 1 ? '<div class="pagination">' +
        '<button ' + (page <= 1 ? 'disabled' : '') + ' onclick="window._conclusionsPage(' + (page - 1) + ')">← Prev</button>' +
        '<span class="page-info">Page ' + page + ' of ' + totalPages + '</span>' +
        '<button ' + (page >= totalPages ? 'disabled' : '') + ' onclick="window._conclusionsPage(' + (page + 1) + ')">Next →</button>' +
      '</div>' : ''),
    ].join('');

    document.getElementById('conclusions-workspace-filter').addEventListener('change', function(e) {
      pageState.workspace = e.target.value;
      pageState.page = 1;
      if (!workspaceCache[pageState.workspace]) {
        loadWorkspace(pageState.workspace);
      } else {
        render();
      }
    });

    document.getElementById('conclusions-search-btn').addEventListener('click', function() {
      pageState.search = document.getElementById('conclusions-search').value;
      pageState.page = 1;
      render();
    });

    document.getElementById('conclusions-search').addEventListener('keyup', function(e) {
      if (e.key === 'Enter') {
        pageState.search = e.target.value;
        pageState.page = 1;
        render();
      }
    });
  }

  function loadWorkspace(workspace) {
    loadingWorkspace = workspace;
    render();
    fetch('/api/conclusions?workspace=' + encodeURIComponent(workspace) + '&size=200')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        workspaceCache[workspace] = {
          items: data.items || [],
          total: data.total || 0,
          displayed: data.displayed || ((data.items || []).length)
        };
        loadingWorkspace = null;
        render();
      })
      .catch(function(err) {
        loadingWorkspace = null;
        showToast('Failed to load ' + workspace + ' conclusions: ' + (err.message || 'error'), 'error');
        render();
      });
  }

  window._conclusionsPage = function(page) {
    pageState.page = page;
    render();
  };

  window._renderConclusions = render;
  window._conclusionsPageState = pageState;
})();
