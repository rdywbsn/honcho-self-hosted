/**
 * Honcho Dashboard — API Client
 * 
 * Semua komunikasi dengan Honcho API via Caddy proxy.
 * Handle error, loading state, dan retry logic.
 */
class HonchoAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async _request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    const start = performance.now();
    const response = await fetch(url, options);
    const latency = Math.round(performance.now() - start);

    if (!response.ok) {
      const text = await response.text();
      throw new APIError(
        `HTTP ${response.status}: ${text}`,
        response.status,
        latency
      );
    }

    const data = await response.json();
    return { data, latency };
  }

  async _get(path) {
    return this._request('GET', path);
  }

  async _post(path, body = {}) {
    return this._request('POST', path, body);
  }

  // === Health ===
  async health() {
    return this._get('/health');
  }

  // === Workspaces ===
  async listWorkspaces() {
    return this._post('/v3/workspaces/list', {});
  }

  async getWorkspace(id) {
    return this._get(`/v3/workspaces/${id}`);
  }

  // === Peers ===
  async listPeers(workspaceId) {
    return this._post(`/v3/workspaces/${workspaceId}/peers/list`, {});
  }

  async getPeerCard(workspaceId, peerId) {
    return this._get(`/v3/workspaces/${workspaceId}/peers/${peerId}/card`);
  }

  async getPeerContext(workspaceId, peerId) {
    return this._get(`/v3/workspaces/${workspaceId}/peers/${peerId}/context`);
  }

  async getPeerSessions(workspaceId, peerId) {
    return this._post(`/v3/workspaces/${workspaceId}/peers/${peerId}/sessions`, {});
  }

  async getPeerRepresentation(workspaceId, peerId) {
    return this._post(`/v3/workspaces/${workspaceId}/peers/${peerId}/representation`, {});
  }

  // === Sessions ===
  async listSessions(workspaceId, page = 1, size = 50) {
    return this._post(`/v3/workspaces/${workspaceId}/sessions/list`, {
      page,
      size,
    });
  }

  async getSession(workspaceId, sessionId) {
    return this._get(`/v3/workspaces/${workspaceId}/sessions/${sessionId}`);
  }

  async getSessionSummaries(workspaceId, sessionId) {
    return this._get(
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/summaries`
    );
  }

  async getSessionMessages(workspaceId, sessionId, page = 1, size = 50) {
    return this._post(
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/messages/list`,
      { page, size }
    );
  }

  async getSessionPeers(workspaceId, sessionId) {
    return this._get(
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/peers`
    );
  }

  // === Conclusions ===
  async listConclusions(workspaceId, page = 1, size = 50) {
    return this._post(`/v3/workspaces/${workspaceId}/conclusions/list`, {
      page,
      size,
    });
  }

  async queryConclusions(workspaceId, query, page = 1, size = 50) {
    return this._post(`/v3/workspaces/${workspaceId}/conclusions/query`, {
      query,
      page,
      size,
    });
  }

  // === Search ===
  async searchWorkspace(workspaceId, query, page = 1, size = 50) {
    return this._post(`/v3/workspaces/${workspaceId}/search`, {
      query,
      page,
      size,
    });
  }

  async searchSession(workspaceId, sessionId, query) {
    return this._post(
      `/v3/workspaces/${workspaceId}/sessions/${sessionId}/search`,
      { query }
    );
  }

  async searchPeer(workspaceId, peerId, query) {
    return this._post(
      `/v3/workspaces/${workspaceId}/peers/${peerId}/search`,
      { query }
    );
  }
}

class APIError extends Error {
  constructor(message, status, latency) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.latency = latency;
  }
}
