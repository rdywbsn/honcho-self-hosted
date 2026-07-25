/**
 * Honcho Dashboard — Shared Utilities
 * Skeleton loading, toast, offline detection, pagination helpers.
 */

function showSkeleton(containerId, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (type === 'table') {
    container.innerHTML = `
      <div class="skeleton-table">
        ${Array(5).fill('').map(() => `
          <div class="skeleton-row">
            <div class="skeleton skeleton-cell" style="width:30%"></div>
            <div class="skeleton skeleton-cell" style="width:20%"></div>
            <div class="skeleton skeleton-cell" style="width:10%"></div>
            <div class="skeleton skeleton-cell" style="width:15%"></div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (type === 'stats') {
    container.innerHTML = `
      <div class="stats-row">
        ${Array(6).fill('').map(() => `
          <div class="stat-card">
            <div class="skeleton skeleton-label"></div>
            <div class="skeleton skeleton-value"></div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="loading-overlay">
        <div class="spinner"></div>
        <p class="text-muted text-sm mt-2">Loading...</p>
      </div>
    `;
  }
}

function showToast(message, type) {
  type = type || 'info';
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

let isOnline = true;
let offlineBanner = null;

function setupOfflineDetection() {
  window.addEventListener('online', () => {
    isOnline = true;
    if (offlineBanner) { offlineBanner.remove(); offlineBanner = null; }
    showToast('Connection restored', 'success');
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    if (!offlineBanner) {
      offlineBanner = document.createElement('div');
      offlineBanner.className = 'offline-banner';
      offlineBanner.innerHTML = '🔌 You are offline — data may be stale';
      document.body.prepend(offlineBanner);
    }
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString();
}

function formatDateShort(dateStr) {
  if (!dateStr) return '-';
  var d = new Date(dateStr);
  var diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString();
}

function truncate(str, len) {
  len = len || 200;
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '…' : str;
}
