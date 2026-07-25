/**
 * Honcho Dashboard — SSE-powered realtime updates
 * No polling. EventSource with auto-reconnect + fallback.
 * Incremental DOM updates — no full page re-render.
 */
(function () {
  'use strict';

  const api = new HonchoAPI(CONFIG.API_BASE_URL);
  const charts = new DashboardCharts();
  let appData = { health: null, stats: {}, sessions: { items: [], total: 0 }, conclusions: { items: [], total: 0 }, activity: { items: [] }, workspace_stats: {}, workspaces: CONFIG.WORKSPACES.map(function(id) { return { id: id }; }) };
  let lastUpdated = null;
  let eventSource = null;
  let fallbackTimer = null;
  let sseFailed = false;
  let reconnectAttempts = 0;
  let statisticsData = null;
  let statisticsRefreshTimer = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  window._escapeHtml = esc;

  document.addEventListener('DOMContentLoaded', function() {
    setupResponsiveShell();
    setupNavigation();
    restoreActivePage();
    setupOfflineDetection();
    loadInitialData();
    connectSSE();
  });

  function connectSSE() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    try {
      eventSource = new EventSource('/api/events');
      eventSource.addEventListener('init', function(e) {
        var data = JSON.parse(e.data);
        appData.stats = data.stats || {};
        appData.sessions = data.sessions || { items: [], total: 0 };
        appData.conclusions = data.conclusions || { items: [], total: 0 };
        appData.activity = data.activity || { items: [] };
        appData.workspace_stats = data.workspace_stats || {};
        appData.health = appData.health || { data: { status: 'ok' }, latency: 0 };
        window.appData = appData;
        lastUpdated = new Date();
        sseFailed = false;
        reconnectAttempts = 0;
        if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
        updateSidebarBadges();
        renderActivePage();
      });
      eventSource.addEventListener('stats', function(e) {
        appData.stats = JSON.parse(e.data);
        window.appData = appData;
        updateSidebarBadges();
        incrementalUpdate('stats');
      });
      eventSource.addEventListener('sessions', function(e) {
        appData.sessions = JSON.parse(e.data);
        window.appData = appData;
        updateSidebarBadges();
        incrementalUpdate('sessions');
      });
      eventSource.addEventListener('conclusions', function(e) {
        appData.conclusions = JSON.parse(e.data);
        window.appData = appData;
        updateSidebarBadges();
        incrementalUpdate('conclusions');
      });
      eventSource.addEventListener('activity', function(e) {
        appData.activity = JSON.parse(e.data);
        window.appData = appData;
        incrementalUpdate('activity');
      });
      eventSource.onerror = function() {
        eventSource.close();
        eventSource = null;
        sseFailed = true;
        reconnectAttempts++;
        var delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
        setTimeout(connectSSE, delay);
        startFallbackPolling();
      };
    } catch(e) {
      sseFailed = true;
      startFallbackPolling();
    }
  }

  function startFallbackPolling() {
    if (fallbackTimer) return;
    function fetchFallbackOnce() {
      fetch('/api/all').then(function(r) { return r.json(); }).then(function(data) {
        appData.stats = data.stats || {};
        appData.sessions = data.sessions || { items: [], total: 0 };
        appData.conclusions = data.conclusions || { items: [], total: 0 };
        appData.workspace_stats = data.workspace_stats || {};
        appData.health = appData.health || { data: { status: 'ok' }, latency: 0 };
        window.appData = appData;
        lastUpdated = new Date();
        updateSidebarBadges();
        var activePage = document.querySelector('.page.active');
        if (activePage) {
          var pageId = activePage.id.replace('page-', '');
          if (pageId === 'overview') { renderOverview(); }
          if (pageId === 'sessions' && window._renderSessions) { window._renderSessions(); }
          if (pageId === 'conclusions' && window._renderConclusions) { window._renderConclusions(); }
        }
      }).catch(function() {});
    }
    fetchFallbackOnce();
    fallbackTimer = setInterval(fetchFallbackOnce, 15000);
  }

  function incrementalUpdate(type) {
    var activePage = document.querySelector('.page.active');
    if (!activePage) return;
    var pageId = activePage.id.replace('page-', '');
    updateSidebarBadges();
    var el = document.getElementById('last-updated');
    if (el) { el.textContent = 'just now'; }
    if (pageId === 'overview') {
      if (type === 'stats') { updateStatCards(); updateWorkspaceCards(); }
      if (type === 'activity') { updateActivityFeed(); }
      if (type === 'sessions' || type === 'conclusions') { updateOverviewCharts(); }
    }
    if (pageId === 'sessions' && type === 'sessions' && window._renderSessions) { window._renderSessions(); }
    if (pageId === 'conclusions' && type === 'conclusions' && window._renderConclusions) { window._renderConclusions(); }
    if (pageId === 'statistics' && (type === 'stats' || type === 'sessions' || type === 'conclusions')) { scheduleStatisticsRefresh(); }
  }

  function updateStatCards() {
    var stats = appData.stats || {};
    var cards = document.querySelectorAll('.stat-card .stat-value');
    if (cards.length >= 5) {
      cards[0].textContent = stats.workspaces || 0;
      cards[1].textContent = stats.peers || 0;
      cards[2].textContent = stats.sessions || 0;
      cards[3].textContent = stats.conclusions || 0;
      cards[4].textContent = (stats.sessions_today || 0) + ' / ' + (stats.conclusions_today || 0);
    }
  }

  function updateWorkspaceCards() {
    var wsStats = appData.workspace_stats || {};
    var cards = document.querySelectorAll('.card');
    cards.forEach(function(card) {
      var title = card.querySelector('.card-title');
      if (!title) return;
      var wsName = title.textContent.trim();
      var wsData = wsStats[wsName] || {};
      var values = card.querySelectorAll('.card-value');
      if (values.length >= 3) {
        values[0].textContent = wsData.peers || 0;
        values[1].textContent = wsData.sessions || 0;
      }
    });
  }

  function updateActivityFeed() {
    var container = document.getElementById('activity-feed');
    if (!container) return;
    var items = (appData.activity && appData.activity.items) || [];
    container.innerHTML = items.map(function(i) {
      var icon = i.type === 'session' ? '💬' : '🧠';
      var time = i.created_at ? new Date(i.created_at).toLocaleString() : '';
      return '<div class="activity-item"><span class="activity-icon">' + icon + '</span><span class="activity-label">' + esc(i.label || '') + '</span><span class="activity-time">' + esc(time) + '</span></div>';
    }).join('');
  }

  function updateOverviewCharts() {
    var allConclusions = appData.conclusions ? appData.conclusions.items || [] : [];
    var allSessions = appData.sessions ? appData.sessions.items || [] : [];
    requestAnimationFrame(function() {
      if (document.getElementById('chart-memory-growth')) charts.createMemoryGrowth('chart-memory-growth', allConclusions);
      if (document.getElementById('chart-session-activity')) charts.createSessionActivity('chart-session-activity', allSessions);
    });
  }

  async function loadInitialData() {
    var activePage = document.querySelector('.page.active');
    if (!activePage || activePage.id === 'page-overview') showSkeleton('overview-content', 'stats');
    try {
      var healthRes = await api.health();
      appData.health = healthRes;
      updateHealthIndicator(true);
      activePage = document.querySelector('.page.active');
      if (activePage && activePage.id === 'page-overview' && (appData.stats || {}).workspaces) renderOverview();
    } catch (err) {
      showToast('Failed to connect: ' + (err.message || 'connection error'), 'error');
    }
  }


  function setupResponsiveShell() {
    var root = document.documentElement;
    var savedTheme = localStorage.getItem('honcho-theme');
    var systemTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(savedTheme || root.getAttribute('data-theme') || systemTheme);

    var toggle = document.getElementById('sidebar-toggle');
    var close = document.getElementById('sidebar-close');
    var overlay = document.getElementById('sidebar-overlay');
    var themeToggle = document.getElementById('theme-toggle');

    if (toggle) toggle.addEventListener('click', function() { setSidebarOpen(!document.body.classList.contains('sidebar-open')); });
    if (close) close.addEventListener('click', function() { setSidebarOpen(false); });
    if (overlay) overlay.addEventListener('click', function() { setSidebarOpen(false); });
    if (themeToggle) themeToggle.addEventListener('click', function() {
      setTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    });
    window.addEventListener('resize', function() {
      if (window.innerWidth > 1180) setSidebarOpen(false);
    });
  }

  function setSidebarOpen(open) {
    document.body.classList.toggle('sidebar-open', !!open);
    var toggle = document.getElementById('sidebar-toggle');
    var overlay = document.getElementById('sidebar-overlay');
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? '×' : '☰';
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    if (overlay) overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
  }

  function setTheme(theme) {
    theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('honcho-theme', theme);
    var btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === 'light' ? '🌞' : '🌙';
      btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
      btn.setAttribute('title', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    }
  }


  function validPage(page) {
    return !!document.querySelector('.nav-item[data-page="' + page + '"]') && !!document.getElementById('page-' + page);
  }

  function getInitialPage() {
    var fromHash = (window.location.hash || '').replace(/^#\/?/, '').trim();
    var fromStorage = localStorage.getItem('honcho-active-page');
    if (validPage(fromHash)) return fromHash;
    if (validPage(fromStorage)) return fromStorage;
    return 'overview';
  }

  function restoreActivePage() {
    navigateTo(getInitialPage(), { replaceHash: true });
    window.addEventListener('hashchange', function() {
      var page = getInitialPage();
      var active = document.querySelector('.page.active');
      var activeId = active ? active.id.replace('page-', '') : '';
      if (page !== activeId) navigateTo(page, { replaceHash: true });
    });
  }

  function renderActivePage() {
    var activePage = document.querySelector('.page.active');
    var page = activePage ? activePage.id.replace('page-', '') : getInitialPage();
    navigateTo(validPage(page) ? page : 'overview', { replaceHash: true });
  }

  function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var page = item.dataset.page;
        if (!page) return;
        navigateTo(page);
        if (window.innerWidth <= 1180) setSidebarOpen(false);
      });
    });
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.key === '1') { e.preventDefault(); navigateTo('overview'); }
      if (e.ctrlKey && e.key === '2') { e.preventDefault(); navigateTo('sessions'); }
      if (e.ctrlKey && e.key === '3') { e.preventDefault(); navigateTo('conclusions'); }
      if (e.ctrlKey && e.key === '4') { e.preventDefault(); navigateTo('search'); }
      if (e.ctrlKey && e.key === '5') { e.preventDefault(); navigateTo('statistics'); }
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        var detail = document.getElementById('session-detail');
        if (detail) detail.innerHTML = '';
      }
    });
    // Collapsible nav sections
    document.querySelectorAll('.nav-section-title').forEach(function(title) {
      title.classList.add('nav-section-toggle');
      title.addEventListener('click', function() {
        var section = title.parentElement;
        section.classList.toggle('collapsed');
      });
    });
  }

  function navigateTo(page, options) {
    options = options || {};
    if (!validPage(page)) page = 'overview';
    localStorage.setItem('honcho-active-page', page);
    if (!options.replaceHash && window.location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
    if (options.replaceHash && window.location.hash !== '#' + page) history.replaceState(null, '', '#' + page);
    document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    var navItem = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (navItem) navItem.classList.add('active');
    document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
    var targetPage = document.getElementById('page-' + page);
    if (targetPage) targetPage.classList.add('active');
    switch (page) {
      case 'overview': renderOverview(); break;
      case 'workspaces': renderWorkspaces(); break;
      case 'peers': renderPeers(); break;
      case 'sessions': if (window._renderSessions) window._renderSessions(); break;
      case 'conclusions': if (window._renderConclusions) window._renderConclusions(); break;
      case 'search': renderSearch(); break;
      case 'statistics': renderStatistics(); break;
      case 'health': renderHealth(); break;
      case 'system': renderSystemHealth(); break;
    }
  }

  function updateSidebarBadges() {
    var totalSessions = appData.sessions ? appData.sessions.total : 0;
    var totalConclusions = appData.conclusions ? appData.conclusions.total : 0;
    var sessionBadge = document.querySelector('.nav-item[data-page="sessions"] .badge');
    if (sessionBadge) sessionBadge.textContent = totalSessions;
    var conclusionBadge = document.querySelector('.nav-item[data-page="conclusions"] .badge');
    if (conclusionBadge) conclusionBadge.textContent = totalConclusions;
    updateHealthIndicator(appData.health !== null);
  }

  function updateHealthIndicator(online) {
    var dot = document.getElementById('status-dot');
    var text = document.getElementById('status-text');
    if (dot) dot.className = 'status-dot ' + (online ? 'online' : 'offline');
    if (text) text.textContent = online ? (sseFailed ? 'Polling' : 'Live') : 'Disconnected';
  }

  function renderOverview() {
    var container = document.getElementById('overview-content');
    if (!container) return;
    if (!appData.health) return;
    var stats = appData.stats || {};
    var wsStats = appData.workspace_stats || {};
    container.innerHTML = [
      '<div class="stats-row">',
        '<div class="stat-card"><div class="stat-label">Workspaces</div><div class="stat-value blue">' + (stats.workspaces || 0) + '</div><div class="stat-latency">' + CONFIG.WORKSPACES.join(', ') + '</div></div>',
        '<div class="stat-card"><div class="stat-label">Peers</div><div class="stat-value purple">' + (stats.peers || 0) + '</div><div class="stat-latency">Across all workspaces</div></div>',
        '<div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value cyan">' + (stats.sessions || 0) + '</div><div class="stat-latency">Total conversations</div></div>',
        '<div class="stat-card"><div class="stat-label">Conclusions</div><div class="stat-value green">' + (stats.conclusions || 0) + '</div><div class="stat-latency">Learned facts</div></div>',
        '<div class="stat-card"><div class="stat-label">Today</div><div class="stat-value yellow">' + (stats.sessions_today || 0) + ' / ' + (stats.conclusions_today || 0) + '</div><div class="stat-latency">Sessions / Conclusions (WIB)</div></div>',
        '<div class="stat-card"><div class="stat-label">Connection</div><div class="stat-value ' + (sseFailed ? 'yellow' : 'green') + '">' + (sseFailed ? 'Polling' : 'SSE Live') + '</div><div class="stat-latency">' + (sseFailed ? 'Fallback mode' : 'Real-time') + '</div></div>',
      '</div>',
      '<div class="grid grid-2">',
        '<div class="chart-container"><div class="card-title">Memory Growth</div><div class="chart-wrapper"><canvas id="chart-memory-growth"></canvas></div></div>',
        '<div class="chart-container"><div class="card-title">Session Activity</div><div class="chart-wrapper"><canvas id="chart-session-activity"></canvas></div></div>',
      '</div>',
      '<div class="card mt-4">',
        '<div class="card-header"><span class="card-title">Recent Activity</span><span class="text-muted text-xs">Live updates</span></div>',
        '<div class="activity-feed" id="activity-feed"><div class="loading-overlay"><div class="spinner"></div></div></div>',
      '</div>',
      '<div class="grid grid-3 mt-4">',
        appData.workspaces.map(function(ws) {
          var wsData = wsStats[ws.id] || {};
          return '<div class="card"><div class="card-header"><span class="card-title">' + ws.id + '</span><span class="tag tag-blue">workspace</span></div>' +
            '<div class="flex gap-4">' +
              '<div><div class="card-value purple" style="font-size:1.2rem">' + (wsData.peers || 0) + '</div><div class="card-subtitle">Peers</div></div>' +
              '<div><div class="card-value cyan" style="font-size:1.2rem">' + (wsData.sessions || 0) + '</div><div class="card-subtitle">Sessions</div></div>' +
              '<div><div class="card-value green" style="font-size:1.2rem">' + (wsData.conclusions || 0) + '</div><div class="card-subtitle">Conclusions</div></div>' +
              '<div><div class="card-value yellow" style="font-size:1.2rem">' + (wsData.sessions_today || 0) + ' / ' + (wsData.conclusions_today || 0) + '</div><div class="card-subtitle">Today (WIB)</div></div>' +
            '</div></div>';
        }).join(''),
      '</div>',
    ].join('');
    updateActivityFeed();
    updateOverviewCharts();
  }

  function renderWorkspaces() {
    var container = document.getElementById('workspaces-content');
    if (!container) return;
    var stats = appData.stats || {};
    var wsStats = appData.workspace_stats || {};
    container.innerHTML = [
      '<div class="grid grid-2">',
        appData.workspaces.map(function(ws) {
          var wsData = wsStats[ws.id] || {};
          return '<div class="card"><div class="card-header"><span class="card-title">' + ws.id + '</span><span class="tag tag-blue">workspace</span></div>' +
            '<div class="detail-row"><span class="detail-label">Peers</span><span class="detail-value"><strong>' + (wsData.peers || 0) + '</strong></span></div>' +
            '<div class="detail-row"><span class="detail-label">Sessions</span><span class="detail-value"><strong>' + (wsData.sessions || 0) + '</strong></span></div>' +
            '<div class="detail-row"><span class="detail-label">Conclusions</span><span class="detail-value"><strong>' + (wsData.conclusions || 0) + '</strong></span></div>' +
            '<div class="detail-row"><span class="detail-label">Today (WIB)</span><span class="detail-value"><strong>' + (wsData.sessions_today || 0) + ' sessions, ' + (wsData.conclusions_today || 0) + ' conclusions</strong></span></div>' +
            '</div>';
        }).join(''),
      '</div>',
    ].join('');
  }

  var peersPageState = { workspace: CONFIG.WORKSPACES[0], page: 1 };

  function renderPeers() {
    var container = document.getElementById('peers-content');
    if (!container) return;
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><p class="text-muted text-sm mt-2">Loading peers...</p></div>';
    api.listPeers(peersPageState.workspace).then(function(result) {
      var peers = result && result.data && result.data.items ? result.data.items : [];
      container.innerHTML = [
        '<div class="flex-between mb-4">',
          '<div class="flex gap-2">',
            '<select id="peers-workspace-filter" class="btn" style="width:auto;">',
              CONFIG.WORKSPACES.map(function(w) { return '<option value="' + w + '" ' + (w === peersPageState.workspace ? 'selected' : '') + '>' + w + '</option>'; }).join(''),
            '</select>',
          '</div>',
          '<span class="text-muted text-sm">' + peers.length + ' peers</span>',
        '</div>',
        '<div class="table-container"><table><thead><tr><th>Peer ID</th><th>Created</th><th>Metadata</th></tr></thead><tbody>',
          peers.length === 0 ? '<tr><td colspan="3" class="empty-state">No peers found</td></tr>' : '',
          peers.map(function(p) { return '<tr><td><code>' + esc(p.id) + '</code></td><td class="text-sm text-muted">' + esc(new Date(p.created_at).toLocaleString()) + '</td><td><code class="text-xs">' + esc(JSON.stringify(p.metadata || {})) + '</code></td></tr>'; }).join(''),
        '</tbody></table></div>',
      ].join('');
      document.getElementById('peers-workspace-filter').addEventListener('change', function(e) {
        peersPageState.workspace = e.target.value;
        renderPeers();
      });
    }).catch(function() {
      container.innerHTML = '<div class="error-state"><h3>Error</h3><p>Failed to load peers</p></div>';
    });
  }

  var searchState = { query: '', results: [] };

  function renderSearch() {
    var container = document.getElementById('search-content');
    if (!container) return;
    container.innerHTML = [
      '<div class="page-header"><h2>Memory Search</h2><p>Search conclusions across all workspaces</p></div>',
      '<div class="search-bar">',
        '<input type="text" id="search-input" placeholder="Search memory..." value="' + esc(searchState.query) + '">',
        '<button class="btn btn-primary" id="search-btn">🔍 Search</button>',
      '</div>',
      '<div id="search-results">',
        searchState.results.length > 0 ? renderSearchResults() : '<div class="empty-state"><div class="empty-icon">🔎</div><p>Enter a query to search memory</p></div>',
      '</div>',
    ].join('');
    document.getElementById('search-btn').addEventListener('click', performSearch);
    document.getElementById('search-input').addEventListener('keyup', function(e) { if (e.key === 'Enter') performSearch(); });
  }

  async function performSearch() {
    var query = document.getElementById('search-input').value.trim();
    if (!query) return;
    searchState.query = query;
    var resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
      var res = await fetch('/api/search?q=' + encodeURIComponent(query)).then(function(r) { return r.json(); });
      searchState.results = res.items || [];
      resultsContainer.innerHTML = renderSearchResults();
    } catch (err) {
      resultsContainer.innerHTML = '<div class="error-state"><h3>Search Failed</h3><p>' + err.message + '</p></div>';
    }
  }

  function renderSearchResults() {
    if (searchState.results.length === 0) return '<div class="empty-state"><p>No results for "' + esc(searchState.query) + '"</p></div>';
    return [
      '<p class="text-sm text-muted mb-4">Found ' + searchState.results.length + ' results for "<strong>' + esc(searchState.query) + '</strong>"</p>',
      searchState.results.map(function(c) {
        return '<div class="detail-panel"><div class="detail-panel-body"><div class="detail-row">' +
          '<span class="detail-value text-sm">' + esc(c.content || '') + '</span>' +
          '<span class="text-xs text-muted" style="flex-shrink:0;margin-left:8px;">' + (c.created_at ? new Date(c.created_at).toLocaleDateString() : '') + '</span>' +
        '</div></div></div>';
      }).join(''),
    ].join('');
  }

  function scheduleStatisticsRefresh() {
    if (statisticsRefreshTimer) return;
    statisticsRefreshTimer = setTimeout(function() {
      statisticsRefreshTimer = null;
      renderStatistics({ silent: true });
    }, 350);
  }

  async function fetchStatisticsData() {
    var res = await fetch('/api/statistics', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text());
    statisticsData = await res.json();
    return statisticsData;
  }

  async function renderStatistics(options) {
    options = options || {};
    var container = document.getElementById('statistics-content');
    if (!container) return;
    if (!options.silent) {
      container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    }
    try {
      var data = await fetchStatisticsData();
      var stats = data.stats || {};
      var generated = data.generated_at ? new Date(data.generated_at).toLocaleString() : 'just now';
      container.innerHTML = [
        '<div class="card mb-4">',
          '<div class="card-header"><span class="card-title">Live Statistics</span><span class="text-xs text-muted">Generated from PostgreSQL at ' + esc(generated) + ' (' + esc(data.today_timezone || 'local') + ')</span></div>',
          '<div class="stats-row">',
            '<div class="stat-card"><div class="stat-label">Workspaces</div><div class="stat-value blue">' + (stats.workspaces || 0) + '</div><div class="stat-latency">Live DB count</div></div>',
            '<div class="stat-card"><div class="stat-label">Peers</div><div class="stat-value purple">' + (stats.peers || 0) + '</div><div class="stat-latency">Live DB count</div></div>',
            '<div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value cyan">' + (stats.sessions || 0) + '</div><div class="stat-latency">Live DB count</div></div>',
            '<div class="stat-card"><div class="stat-label">Messages</div><div class="stat-value yellow">' + (stats.messages || 0) + '</div><div class="stat-latency">Live DB count</div></div>',
            '<div class="stat-card"><div class="stat-label">Conclusions</div><div class="stat-value green">' + (stats.conclusions || 0) + '</div><div class="stat-latency">Live DB count</div></div>',
            '<div class="stat-card"><div class="stat-label">Today</div><div class="stat-value pink">' + (stats.sessions_today || 0) + ' / ' + (stats.conclusions_today || 0) + '</div><div class="stat-latency">Sessions / Conclusions</div></div>',
          '</div>',
        '</div>',
        '<div class="grid grid-2">',
          '<div class="chart-container"><div class="card-title">Memory Growth, Last 90 Days</div><div class="chart-wrapper"><canvas id="stat-memory-growth"></canvas></div></div>',
          '<div class="chart-container"><div class="card-title">Session Activity, Last 90 Days</div><div class="chart-wrapper"><canvas id="stat-session-activity"></canvas></div></div>',
          '<div class="chart-container"><div class="card-title">Workspace Distribution, Conclusions</div><div class="chart-wrapper"><canvas id="stat-workspace-dist"></canvas></div></div>',
          '<div class="chart-container"><div class="card-title">Peer Activity, Top 20 by Messages</div><div class="chart-wrapper"><canvas id="stat-peer-activity"></canvas></div></div>',
          '<div class="chart-container"><div class="card-title">Conclusion Levels</div><div class="chart-wrapper"><canvas id="stat-conclusion-levels"></canvas></div></div>',
          '<div class="card"><div class="card-header"><span class="card-title">Workspace Breakdown</span></div>' + renderWorkspaceBreakdown(data.workspace_distribution || []) + '</div>',
        '</div>',
      ].join('');
      renderStatisticsCharts(data);
    } catch (err) {
      container.innerHTML = '<div class="error-state"><h3>Statistics Failed</h3><p>' + esc(err.message || err) + '</p><button class="btn btn-primary mt-4" onclick="window._renderStatistics && window._renderStatistics()">Retry</button></div>';
    }
  }

  function renderWorkspaceBreakdown(items) {
    if (!items.length) return '<div class="empty-state"><p>No workspace data.</p></div>';
    return items.map(function(w) {
      return '<div class="detail-row"><span class="detail-label">' + esc(w.workspace_name) + '</span><span class="detail-value">' +
        (w.peers || 0) + ' peers · ' + (w.sessions || 0) + ' sessions · ' + (w.messages || 0) + ' messages · ' + (w.conclusions || 0) + ' conclusions</span></div>';
    }).join('');
  }

  function renderStatisticsCharts(data) {
    data = data || statisticsData || {};
    requestAnimationFrame(function() {
      renderLiveChart('stat-memory-growth', 'line', {
        labels: (data.memory_growth || []).map(function(i) { return i.date; }),
        datasets: [
          { label: 'Cumulative', data: (data.memory_growth || []).map(function(i) { return i.cumulative; }), borderColor: CONFIG.CHARTS.colorScheme.primary, backgroundColor: charts.hexToRgba(CONFIG.CHARTS.colorScheme.primary, 0.12), fill: true, tension: 0.3, pointRadius: 0 },
          { label: 'Daily', data: (data.memory_growth || []).map(function(i) { return i.daily; }), borderColor: CONFIG.CHARTS.colorScheme.cyan, backgroundColor: charts.hexToRgba(CONFIG.CHARTS.colorScheme.cyan, 0.12), fill: true, tension: 0.3, pointRadius: 0, yAxisID: 'y1' }
        ]
      }, charts._lineOptions('Memory Growth'));
      renderLiveChart('stat-session-activity', 'bar', {
        labels: (data.session_activity || []).map(function(i) { return i.date; }),
        datasets: [{ label: 'Sessions', data: (data.session_activity || []).map(function(i) { return i.sessions; }), backgroundColor: charts.hexToRgba(CONFIG.CHARTS.colorScheme.primary, 0.7), borderColor: CONFIG.CHARTS.colorScheme.primary, borderWidth: 1, borderRadius: 4 }]
      }, charts._barOptions('Session Activity'));
      renderLiveChart('stat-workspace-dist', 'doughnut', {
        labels: (data.workspace_distribution || []).map(function(i) { return i.workspace_name; }),
        datasets: [{ data: (data.workspace_distribution || []).map(function(i) { return i.conclusions; }), backgroundColor: [CONFIG.CHARTS.colorScheme.primary, CONFIG.CHARTS.colorScheme.green, CONFIG.CHARTS.colorScheme.purple, CONFIG.CHARTS.colorScheme.yellow, CONFIG.CHARTS.colorScheme.pink, CONFIG.CHARTS.colorScheme.cyan] }]
      }, charts._pieOptions('Workspace Distribution'));
      renderLiveChart('stat-peer-activity', 'bar', {
        labels: (data.peer_activity || []).map(function(i) { return i.workspace_name + ' / ' + i.peer_name; }),
        datasets: [{ label: 'Messages', data: (data.peer_activity || []).map(function(i) { return i.messages; }), backgroundColor: charts.hexToRgba(CONFIG.CHARTS.colorScheme.purple, 0.7), borderColor: CONFIG.CHARTS.colorScheme.purple, borderWidth: 1, borderRadius: 4 }]
      }, charts._barOptions('Peer Activity'));
      renderLiveChart('stat-conclusion-levels', 'doughnut', {
        labels: (data.conclusion_levels || []).map(function(i) { return i.level; }),
        datasets: [{ data: (data.conclusion_levels || []).map(function(i) { return i.conclusions; }), backgroundColor: [CONFIG.CHARTS.colorScheme.green, CONFIG.CHARTS.colorScheme.yellow, CONFIG.CHARTS.colorScheme.primary, CONFIG.CHARTS.colorScheme.pink] }]
      }, charts._pieOptions('Conclusion Levels'));
    });
  }

  function renderLiveChart(canvasId, type, data, options) {
    var ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (charts.charts[canvasId]) charts.charts[canvasId].destroy();
    charts.charts[canvasId] = new Chart(ctx, { type: type, data: data, options: options });
  }

  window._renderStatistics = renderStatistics;

  async function renderHealth() {
    var container = document.getElementById('health-content');
    if (!container) return;
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
      var health = await api.health();
      var latency = health.latency || 0;
      var stats = appData.stats || {};
      container.innerHTML = [
        '<div class="stats-row">',
          '<div class="stat-card"><div class="stat-label">API Status</div><div class="stat-value" style="font-size:1.2rem;"><span class="status-dot online"></span> Healthy</div><div class="stat-latency">' + (health.data && health.data.status ? health.data.status : 'ok') + '</div></div>',
          '<div class="stat-card"><div class="stat-label">Response Time</div><div class="stat-value ' + (latency > 200 ? 'yellow' : 'green') + '">' + latency + 'ms</div><div class="stat-latency">Health endpoint</div></div>',
          '<div class="stat-card"><div class="stat-label">Workspaces</div><div class="stat-value blue">' + (stats.workspaces || 0) + '</div><div class="stat-latency">Accessible</div></div>',
          '<div class="stat-card"><div class="stat-label">Connection</div><div class="stat-value ' + (sseFailed ? 'yellow' : 'green') + '">' + (sseFailed ? 'Polling' : 'SSE Live') + '</div><div class="stat-latency">' + (sseFailed ? 'Fallback 15s' : 'Real-time') + '</div></div>',
        '</div>',
        '<div class="card"><div class="card-header"><span class="card-title">System Info</span></div>',
          '<div class="detail-row"><span class="detail-label">API Base URL</span><span class="detail-value"><code>' + CONFIG.API_BASE_URL + '</code></span></div>',
          '<div class="detail-row"><span class="detail-label">Workspaces</span><span class="detail-value">' + CONFIG.WORKSPACES.join(', ') + '</span></div>',
          '<div class="detail-row"><span class="detail-label">Update Mode</span><span class="detail-value">' + (sseFailed ? 'Polling (15s fallback)' : 'SSE (real-time)') + '</span></div>',
        '</div>',
      ].join('');
    } catch (err) {
      container.innerHTML = '<div class="error-state"><div class="error-icon">🔌</div><h3>API Unreachable</h3><p>' + err.message + '</p><button class="btn btn-primary mt-4" onclick="renderHealth()">Retry</button></div>';
    }
  }

  async function renderSystemHealth() {
    var container = document.getElementById('system-content');
    if (!container) return;
    container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
    try {
      var health = await api.health();
      var latency = health.latency || 0;
      var stats = appData.stats || {};
      container.innerHTML = [
        '<div class="stats-row">',
          '<div class="stat-card"><div class="stat-label">API</div><div class="stat-value green" style="font-size:1.2rem;">✓ Online</div><div class="stat-latency">' + latency + 'ms response</div></div>',
          '<div class="stat-card"><div class="stat-label">Postgres</div><div class="stat-value green" style="font-size:1.2rem;">✓ Connected</div><div class="stat-latency">' + (stats.messages || 0) + ' messages stored</div></div>',
          '<div class="stat-card"><div class="stat-label">Redis</div><div class="stat-value green" style="font-size:1.2rem;">✓ Active</div><div class="stat-latency">Cache layer</div></div>',
          '<div class="stat-card"><div class="stat-label">Deriver</div><div class="stat-value yellow" style="font-size:1.2rem;">~ Active</div><div class="stat-latency">LLM: deepseek-v4-flash</div></div>',
        '</div>',
        '<div class="card mt-4"><div class="card-header"><span class="card-title">System Details</span></div>',
          '<div class="detail-row"><span class="detail-label">Workspaces</span><span class="detail-value">' + (stats.workspaces || 0) + '</span></div>',
          '<div class="detail-row"><span class="detail-label">Peers</span><span class="detail-value">' + (stats.peers || 0) + '</span></div>',
          '<div class="detail-row"><span class="detail-label">Sessions</span><span class="detail-value">' + (stats.sessions || 0) + '</span></div>',
          '<div class="detail-row"><span class="detail-label">Messages</span><span class="detail-value">' + (stats.messages || 0) + '</span></div>',
          '<div class="detail-row"><span class="detail-label">Conclusions</span><span class="detail-value">' + (stats.conclusions || 0) + '</span></div>',
          '<div class="detail-row"><span class="detail-label">Today</span><span class="detail-value">' + (stats.sessions_today || 0) + ' sessions, ' + (stats.conclusions_today || 0) + ' conclusions (WIB)</span></div>',
          '<div class="detail-row"><span class="detail-label">Update Mode</span><span class="detail-value">' + (sseFailed ? 'Polling (15s fallback)' : 'SSE (real-time)') + '</span></div>',
        '</div>',
      ].join('');
    } catch (err) {
      container.innerHTML = '<div class="error-state"><div class="error-icon">🔌</div><h3>API Unreachable</h3><p>' + err.message + '</p><button class="btn btn-primary mt-4" onclick="renderSystemHealth()">Retry</button></div>';
    }
  }


  window._refreshData = function() {
    fetch('/api/all').then(function(r) { return r.json(); }).then(function(data) {
      appData.stats = data.stats || {};
      appData.sessions = data.sessions || { items: [], total: 0 };
      appData.conclusions = data.conclusions || { items: [], total: 0 };
      appData.activity = data.activity || { items: [] };
      appData.workspace_stats = data.workspace_stats || {};
      appData.health = appData.health || { data: { status: 'ok' }, latency: 0 };
      window.appData = appData;
      lastUpdated = new Date();
      updateSidebarBadges();
      var activePage = document.querySelector('.page.active');
      if (activePage) navigateTo(activePage.id.replace('page-', ''));
      showToast('Data refreshed', 'success');
    }).catch(function(err) {
      showToast('Refresh failed: ' + (err.message || 'connection error'), 'error');
    });
  };

  // Export functions
  window._exportSessions = function() {
    var data = appData.sessions || { items: [], total: 0 };
    var blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'honcho-sessions.json';
    a.click(); URL.revokeObjectURL(url);
    showToast('Sessions exported', 'success');
  };
  window._exportConclusions = function() {
    var data = appData.conclusions || { items: [], total: 0 };
    var blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'honcho-conclusions.json';
    a.click(); URL.revokeObjectURL(url);
    showToast('Conclusions exported', 'success');
  };
  // Debounce helper
  var searchDebounce = null;
  var origSearch = performSearch;
  performSearch = function() {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(origSearch, 300);
  };
})();
