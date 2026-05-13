import { openTunnel, testSsh, expandPath } from '../db/tunnel.js';

export async function testRoutes(fastify) {
  // POST /test/ssh — verify SSH connectivity only (no DB)
  fastify.post('/test/ssh', async (req) => {
    const { ssh } = req.body ?? {};
    if (!ssh?.host || !ssh?.user || !ssh?.privateKeyPath)
      return { ok: false, error: 'ssh.host, ssh.user and ssh.privateKeyPath are required' };
    try {
      await testSsh({ ...ssh, privateKeyPath: expandPath(ssh.privateKeyPath) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // POST /test/db — full connection test (with optional SSH tunnel)
  fastify.post('/test/db', async (req) => {
    const conn = req.body?.connection;
    if (!conn) return { ok: false, error: 'connection is required' };

    let tunnel = null;
    let client = null;
    try {
      const type = (conn.type || '').toLowerCase();
      let host = conn.host || 'localhost';
      let port = parseInt(conn.port, 10) || (type === 'mysql' ? 3306 : 5432);

      if (conn.ssh?.host) {
        const sshCfg = { ...conn.ssh, privateKeyPath: expandPath(conn.ssh.privateKeyPath) };
        tunnel = await openTunnel(sshCfg, host, port);
        host = '127.0.0.1';
        port = tunnel.localPort;
      }

      if (type === 'postgres') {
        const { default: pg } = await import('pg');
        client = new pg.Client({
          host, port,
          database: conn.database || 'postgres',
          user: conn.user,
          password: conn.password ?? '',
          connectionTimeoutMillis: 8000,
        });
        await client.connect();
        await client.query('SELECT 1');
      } else {
        const mysql = await import('mysql2/promise');
        client = await mysql.createConnection({
          host, port,
          database: conn.database || undefined,
          user: conn.user,
          password: conn.password ?? '',
          connectTimeout: 8000,
        });
        await client.query('SELECT 1');
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      if (client) try { await client.end(); } catch {}
      if (tunnel)  try { tunnel.close();   } catch {}
    }
  });
}
