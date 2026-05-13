import { getPool, getCurrentConnType, getCurrentConnectionName, getCurrentReadOnly } from '../db/pool.js';
import { config } from '../config.js';

export async function healthRoutes(fastify) {
  fastify.get('/health', async (req, reply) => {
    if (config.connections.length === 0) {
      return {
        ok: true,
        status: 'unconfigured',
        db: { type: null, status: 'unconfigured' },
        connection: null,
        multipleConnections: false,
        readOnly: true,
        version: '0.1.0',
      };
    }

    const type = getCurrentConnType();
    let dbStatus = 'unknown';
    let dbError = null;
    try {
      const pool = await getPool();
      if (type === 'postgres') await pool.query('SELECT 1');
      else await pool.execute('SELECT 1');
      dbStatus = 'connected';
    } catch (err) {
      dbStatus = 'error';
      dbError = err.message;
    }

    const healthy = dbStatus === 'connected';
    reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'error',
      db: { type, status: dbStatus, error: dbError },
      connection: getCurrentConnectionName(),
      multipleConnections: config.connections.length > 1,
      readOnly: getCurrentReadOnly(),
      version: '0.1.0',
    });
  });
}
