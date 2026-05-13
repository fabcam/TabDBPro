export class BridgeClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async _fetch(path, options = {}) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
    } catch {
      throw new Error('Cannot reach bridge at ' + this.baseUrl + '. Is it running?');
    }
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  health()              { return this._fetch('/health'); }
  configure(cfg)        { return this._fetch('/configure', { method: 'POST', body: JSON.stringify(cfg) }); }
  testSsh(ssh)          { return this._fetch('/test/ssh', { method: 'POST', body: JSON.stringify({ ssh }) }); }
  testDb(connection)    { return this._fetch('/test/db',  { method: 'POST', body: JSON.stringify({ connection }) }); }

  query(sql, params = []) {
    return this._fetch('/query', {
      method: 'POST',
      body: JSON.stringify({ sql, params }),
    });
  }

  connections() { return this._fetch('/connections'); }
  useConnection(name) {
    return this._fetch(`/connections/${encodeURIComponent(name)}/use`, { method: 'POST', body: '{}' });
  }

  databases() { return this._fetch('/databases'); }
  useDatabase(name) {
    return this._fetch(`/databases/${encodeURIComponent(name)}/use`, {
      method: 'POST',
      body: '{}',
    });
  }

  tables() { return this._fetch('/tables'); }
  tableSchema(name) { return this._fetch(`/tables/${encodeURIComponent(name)}`); }
  tableIndexes(name) { return this._fetch(`/tables/${encodeURIComponent(name)}/indexes`); }
}
