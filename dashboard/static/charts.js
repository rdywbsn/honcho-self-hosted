/**
 * Honcho Dashboard — Charts
 * Chart.js integration untuk visualisasi data Honcho.
 */
class DashboardCharts {
  constructor() {
    this.charts = {};
    this.colors = CONFIG.CHARTS.colorScheme;
  }

  /**
   * Line chart: pertumbuhan memory (conclusions per hari)
   */
  createMemoryGrowth(canvasId, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.charts[canvasId]) {
      this.charts[canvasId].destroy();
    }

    // Group conclusions by date
    const daily = {};
    data.forEach((c) => {
      const date = c.created_at ? c.created_at.split('T')[0] : 'unknown';
      daily[date] = (daily[date] || 0) + 1;
    });

    const dates = Object.keys(daily).sort();
    const counts = dates.map((d) => daily[d]);
    const cumulative = [];
    let sum = 0;
    counts.forEach((c) => {
      sum += c;
      cumulative.push(sum);
    });

    this.charts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [
          {
            label: 'Cumulative',
            data: cumulative,
            borderColor: this.colors.primary,
            backgroundColor: this.hexToRgba(this.colors.primary, 0.1),
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
          {
            label: 'Daily',
            data: counts,
            borderColor: this.colors.cyan,
            backgroundColor: this.hexToRgba(this.colors.cyan, 0.1),
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 4,
            yAxisID: 'y1',
          },
        ],
      },
      options: this._lineOptions('Conclusions Over Time'),
    });
  }

  /**
   * Bar chart: aktivitas session per hari
   */
  createSessionActivity(canvasId, sessions) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.charts[canvasId]) {
      this.charts[canvasId].destroy();
    }

    const daily = {};
    sessions.forEach((s) => {
      const date = s.created_at ? s.created_at.split('T')[0] : 'unknown';
      daily[date] = (daily[date] || 0) + 1;
    });

    const dates = Object.keys(daily).sort().slice(-30);
    const counts = dates.map((d) => daily[d]);

    this.charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dates,
        datasets: [
          {
            label: 'Sessions',
            data: counts,
            backgroundColor: this.hexToRgba(this.colors.primary, 0.7),
            borderColor: this.colors.primary,
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: this._barOptions('Session Activity (Last 30 Days)'),
    });
  }

  /**
   * Pie chart: distribusi workspace
   */
  createWorkspaceDistribution(canvasId, workspaces) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.charts[canvasId]) {
      this.charts[canvasId].destroy();
    }

    const labels = workspaces.map((w) => w.id || w.workspace_id || 'unknown');
    const values = workspaces.map((w) => w.session_count || w.peer_count || 1);
    const colors = [
      this.colors.primary,
      this.colors.green,
      this.colors.purple,
      this.colors.yellow,
      this.colors.pink,
      this.colors.cyan,
    ];

    this.charts[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors.slice(0, labels.length),
            borderColor: this.colors.primary,
            borderWidth: 2,
          },
        ],
      },
      options: this._pieOptions('Workspace Distribution'),
    });
  }

  /**
   * Bar chart: peer activity
   */
  createPeerActivity(canvasId, peers) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (this.charts[canvasId]) {
      this.charts[canvasId].destroy();
    }

    const labels = peers.map((p) => p.id || p.peer_id || 'unknown');
    const values = peers.map((p) => p.session_count || 0);

    this.charts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Sessions',
            data: values,
            backgroundColor: this.hexToRgba(this.colors.purple, 0.7),
            borderColor: this.colors.purple,
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: this._barOptions('Peer Activity'),
    });
  }

  // === Chart Options ===

  _lineOptions(title) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: {
          labels: { color: '#8b949e', font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: '#1c2128',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 6,
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(48, 54, 61, 0.5)' },
          ticks: { color: '#6e7681', maxTicksLimit: 15 },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(48, 54, 61, 0.5)' },
          ticks: { color: '#6e7681' },
        },
        y1: {
          beginAtZero: true,
          position: 'right',
          grid: { display: false },
          ticks: { color: '#6e7681' },
        },
      },
    };
  }

  _barOptions(title) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: '#1c2128',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 6,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#6e7681', maxRotation: 45 },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(48, 54, 61, 0.5)' },
          ticks: { color: '#6e7681', stepSize: 1 },
        },
      },
    };
  }

  _pieOptions(title) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8b949e',
            padding: 12,
            font: { size: 11 },
          },
        },
        tooltip: {
          backgroundColor: '#1c2128',
          titleColor: '#e6edf3',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 6,
        },
      },
      cutout: '60%',
    };
  }

  // === Helpers ===

  hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  destroyAll() {
    Object.values(this.charts).forEach((c) => c.destroy());
    this.charts = {};
  }
}
