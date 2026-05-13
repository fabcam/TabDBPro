import { config } from '../config.js';
import { openTunnel } from './tunnel.js';

let pool = null;
let tunnel = null;
let currentConnectionIndex = 0;
let currentDatabaseOverride = null;

export function getCurrentConnectionName() {
  return config.connections[currentConnectionIndex]?.name;
}

export function getCurrentConnType() {
  return config.connections[currentConnectionIndex]?.type;
}

export function getCurrentReadOnly() {
  return config.connections[currentConnectionIndex]?.readOnly ?? true;
}

export function getCurrentDatabase() {
  return currentDatabaseOverride || config.connections[currentConnectionIndex]?.database || null;
}

export async function getPool() {
  if (pool) return pool;
  const conn = config.connections[currentConnectionIndex];
  pool = await _createPool(conn, currentDatabaseOverride);
  return pool;
}

export async function switchConnection(name) {
  const idx = config.connections.findIndex((c) => c.name === name);
  if (idx === -1) throw new Error(`Connection "${name}" not found`);
  await closePool();
  currentConnectionIndex = idx;
  currentDatabaseOverride = null;
  return getPool();
}

export async function switchDatabase(dbName) {
  await closePool();
  currentDatabaseOverride = dbName;
  return getPool();
}

export async function closePool() {
  if (pool) { try { await pool.end(); } catch {} pool = null; }
  if (tunnel) { try { tunnel.close(); } catch {} tunnel = null; }
}

export function resetConnectionIndex() {
  currentConnectionIndex = 0;
  currentDatabaseOverride = null;
}

async function _createPool(conn, dbOverride) {
  const database = dbOverride || conn.database;

  // Open SSH tunnel if configured; pool connects to the local forwarded port
  let host = conn.host;
  let port = conn.port;
  if (conn.ssh) {
    tunnel = await openTunnel(conn.ssh, conn.host, conn.port);
    host = '127.0.0.1';
    port = tunnel.localPort;
  }

  if (conn.type === 'postgres') {
    const { default: pg } = await import('pg');
    const { Pool } = pg;
    const connConfig = conn.url && !conn.ssh
      ? { connectionString: conn.url }
      : { host, port, database, user: conn.user, password: conn.password };
    const p = new Pool({ ...connConfig, max: 5, idleTimeoutMillis: 30000 });
    p.on('error', (err) => console.error('[pool] idle client error', err.message));
    return p;
  } else {
    const mysql = await import('mysql2/promise');
    const connConfig = conn.url && !conn.ssh
      ? { uri: conn.url }
      : { host, port, database, user: conn.user, password: conn.password };
    return mysql.createPool({ ...connConfig, connectionLimit: 5, waitForConnections: true });
  }
}
