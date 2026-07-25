/**
 * Honcho Dashboard — Configuration
 * 
 * Ubah API_BASE_URL kalo pindah environment.
 * Workspace IDs bisa ditambah/dikurangi sesuai kebutuhan.
 */
const CONFIG = {
  // Base URL untuk Honcho API (via Caddy proxy)
  API_BASE_URL: '/honcho-api',

  // Workspaces yang akan dimonitor
  WORKSPACES: ['hermes', 'household', 'esb'],

  // Auto-refresh interval dalam milidetik
  REFRESH_INTERVAL: 15000,
  REFRESH_INTERVAL_INACTIVE: 60000,

  // Pagination defaults
  PAGE_SIZE: 20,

  // Chart.js config
  CHARTS: {
    colorScheme: {
      primary: '#58a6ff',
      secondary: '#3fb950',
      accent: '#d29922',
      danger: '#f85149',
      purple: '#bc8cff',
      pink: '#db61a2',
      cyan: '#39d2c0',
    },
  },
};
