/**
 * Honcho Dashboard — Sessions Module
 */
(function() {
  'use strict';

  let pageState = { workspace: CONFIG.WORKSPACES[0], page: 1, search: '' };
  var workspaceCache = {};
  var loadingWorkspace = null;
  const esc = window._escapeHtml || function(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  function render() {
    const container = document.getElementById('sessions-content');
    if (!container) return;

    if (!window.appData || !window.appData.sessions || !window.appData.sessions.items) {
      showSkeleton('sessions-content', 'table');
      return;
    }
    var source = workspaceCache[pageState.workspace] || null;
    let sessions = source ? [...source.items] : [...window.appData.sessions.items].filter(function(s) { return !pageState.workspace || s.workspace_name === pageState.workspace; });
    var totalForWorkspace = source ? source.total : sessions.length;

    if (!source && pageState.workspace && sessions.length === 0 && loadingWorkspace !== pageState.workspace) {
      loadWorkspace(pageState.workspace);
    }

    if (pageState.search) {
      const q = pageState.search.toLowerCase();
      sessions = sessions.filter(function(s) { return s.id.toLowerCase().includes(q); });
    }

    const totalPages = Math.max(1, Math.ceil(sessions.length / CONFIG.PAGE_SIZE));
    const page = Math.min(pageState.page, totalPages);
    const start = (page - 1) * CONFIG.PAGE_SIZE;
    const pageItems = sessions.slice(start, start + CONFIG.PAGE_SIZE);

    container.innerHTML = `
      <div class="flex-between mb-4">
        <div class="flex gap-2">
          <select id="sessions-workspace-filter" class="btn" style="width:auto;">
            ${CONFIG.WORKSPACES.map(function(w) { return '<option value="' + w + '" ' + (w === pageState.workspace ? 'selected' : '') + '>' + w + '</option>'; }).join('')}
          </select>
          <button class="btn btn-sm" onclick="window._refreshData()">🔄 Refresh</button>
        </div>
        <span class="text-muted text-sm">${sessions.length} shown / ${totalForWorkspace} workspace sessions</span>
      </div>

      <div class="search-bar">
        <input type="text" id="sessions-search" placeholder="Search by session ID..." value="${pageState.search}">
        <button class="btn btn-primary" id="sessions-search-btn">Search</button>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Created</th>
              <th>Active</th>
              <th>Messages</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${loadingWorkspace === pageState.workspace ? '<tr><td colspan="5" class="empty-state"><div class="spinner"></div><p>Loading ' + esc(pageState.workspace) + ' sessions...</p></td></tr>' : ''}
            ${loadingWorkspace !== pageState.workspace && pageItems.length === 0 ? '<tr><td colspan="5" class="empty-state">No sessions found for workspace <strong>' + esc(pageState.workspace) + '</strong></td></tr>' : ''}
            ${pageItems.map(function(s) { return `
              <tr>
                <td><code class="text-xs">${esc(s.id)}</code></td>
                <td class="text-sm text-muted">${new Date(s.created_at).toLocaleString()}</td>
                <td><span class="tag ${s.is_active ? 'tag-green' : 'tag-red'}">${s.is_active ? 'Active' : 'Inactive'}</span></td>
                <td class="text-xs text-muted">${s.message_count || 0}</td>
                <td>
                  <button class="btn btn-sm" onclick="window._viewSession('${s.id}')">View</button>
                </td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      </div>

      ${totalPages > 1 ? '<div class="pagination">' +
        '<button ' + (page <= 1 ? 'disabled' : '') + ' onclick="window._sessionsPage(' + (page - 1) + ')">← Prev</button>' +
        '<span class="page-info">Page ' + page + ' of ' + totalPages + '</span>' +
        '<button ' + (page >= totalPages ? 'disabled' : '') + ' onclick="window._sessionsPage(' + (page + 1) + ')">Next →</button>' +
      '</div>' : ''}

      <div id="session-detail"></div>
    `;

    document.getElementById('sessions-workspace-filter').addEventListener('change', function(e) {
      pageState.workspace = e.target.value;
      pageState.page = 1;
      if (!workspaceCache[pageState.workspace]) {
        loadWorkspace(pageState.workspace);
      } else {
        render();
      }
    });

    document.getElementById('sessions-search-btn').addEventListener('click', function() {
      pageState.search = document.getElementById('sessions-search').value;
      pageState.page = 1;
      render();
    });

    document.getElementById('sessions-search').addEventListener('keyup', function(e) {
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
    fetch('/api/sessions?workspace=' + encodeURIComponent(workspace) + '&size=200')
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
        showToast('Failed to load ' + workspace + ' sessions: ' + (err.message || 'error'), 'error');
        render();
      });
  }

  window._sessionsPage = function(page) {
    pageState.page = page;
    render();
  };

  window._viewSession = async function(sessionId) {
    const container = document.getElementById('session-detail');
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
      const [sessionRes, messagesRes] = await Promise.all([
        fetch('/api/session/' + sessionId).then(function(r) { return r.json(); }),
        fetch('/api/session/' + sessionId + '/messages').then(function(r) { return r.json(); }),
      ]);

      const session = sessionRes && !sessionRes.error ? sessionRes : null;
      const msgItems = messagesRes && messagesRes.items ? messagesRes.items : [];

      container.innerHTML = `
        <div class="detail-panel mt-4">
          <div class="detail-panel-header">
            <strong>Session: <code>${esc(sessionId)}</code></strong>
            <span class="tag tag-cyan">${esc(session ? session.workspace_name : 'hermes')}</span>
          </div>
          <div class="detail-panel-body">
            <div class="detail-row">
              <span class="detail-label">Created</span>
              <span class="detail-value">${session ? new Date(session.created_at).toLocaleString() : 'N/A'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Active</span>
              <span class="detail-value"><span class="tag ${session && session.is_active ? 'tag-green' : 'tag-red'}">${session && session.is_active ? 'Yes' : 'No'}</span></span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Name</span>
              <span class="detail-value"><code class="text-xs">${esc(session ? session.name : '-')}</code></span>
            </div>

            <h4 class="mt-4 mb-2" style="color:var(--accent-blue)">Messages (${msgItems.length})</h4>
            ${msgItems.length === 0 ? '<p class="text-muted text-sm">No messages</p>' : ''}
            ${msgItems.map(function(m) { return `
              <div class="detail-row">
                <span class="detail-label text-xs mono" style="width:80px;">${esc(m.peer_name || '?')}</span>
                <span class="detail-value text-sm truncate">${esc((m.content || '').substring(0, 300))}</span>
              </div>
            `; }).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      container.innerHTML = '<div class="error-state"><h3>Error</h3><p>' + err.message + '</p></div>';
    }
  };

  // Register for navigation
  window._renderSessions = render;
  window._sessionsPageState = pageState;
})();
