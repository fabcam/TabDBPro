import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { expandPath } from './db/tunnel.js';

function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const ENV_READONLY = process.env.READ_ONLY !== 'false';

function parseConnectionsFromEnv() {
  if (process.env.CONNECTIONS) {
    const parsed = JSON.parse(process.env.CONNECTIONS);
    return parsed.map((c) => ({
      ...c,
      type: c.type.toLowerCase(),
      port: c.port ? parseInt(c.port, 10) : (c.type === 'mysql' ? 3306 : 5432),
      password: c.password ?? '',
      readOnly: c.readOnly ?? ENV_READONLY,
    }));
  }
  if (!process.env.DB_NAME || !process.env.DB_USER) return [];
  const dbType = (process.env.DB_TYPE || 'postgres').toLowerCase();
  return [{
    name: 'Default',
    type: dbType,
    url: process.env.DATABASE_URL || null,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || (dbType === 'mysql' ? '3306' : '5432'), 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    readOnly: ENV_READONLY,
  }];
}

export const config = {
  port: parseInt(process.env.BRIDGE_PORT || '47321', 10),
  connections: [],
};

try {
  config.connections = parseConnectionsFromEnv();
} catch {
  // No env config — waiting for extension to push config via POST /configure
}

export function applyConfig({ connections }) {
  if (!Array.isArray(connections) || connections.length === 0)
    throw new Error('connections must be a non-empty array');
  config.connections = connections.map((c) => {
    const type = (c.type || '').toLowerCase();
    if (type !== 'postgres' && type !== 'mysql')
      throw new Error(`Connection "${c.name}" must have type "postgres" or "mysql"`);
    const ssh = c.ssh ? { ...c.ssh, privateKeyPath: expandPath(c.ssh.privateKeyPath) } : undefined;
    return { ...c, type, port: parseInt(c.port, 10) || (type === 'mysql' ? 3306 : 5432), password: c.password ?? '', readOnly: c.readOnly ?? false, ssh };
  });
}
