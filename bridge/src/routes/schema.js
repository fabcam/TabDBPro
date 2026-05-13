import { getDatabases, getTables, getTableSchema, getTableIndexes } from '../db/schema.js';
import { switchDatabase, switchConnection, getCurrentDatabase, getCurrentConnectionName } from '../db/pool.js';
import { config } from '../config.js';

function validIdentifier(name) {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

export async function schemaRoutes(fastify) {
  // ── Connections ──
  fastify.get('/connections', async () => ({
    ok: true,
    connections: config.connections.map((c) => ({ name: c.name, type: c.type })),
    current: getCurrentConnectionName(),
  }));

  fastify.post('/connections/:name/use', async (req, reply) => {
    const { name } = req.params;
    try {
      await switchConnection(name);
      return { ok: true, current: name };
    } catch (err) {
      reply.status(400).send({ ok: false, error: err.message });
    }
  });

  // ── Databases ──
  fastify.get('/databases', async (req, reply) => {
    try {
      const databases = await getDatabases();
      return { ok: true, databases, current: getCurrentDatabase() };
    } catch (err) {
      reply.status(500).send({ ok: false, error: err.message });
    }
  });

  fastify.post('/databases/:name/use', async (req, reply) => {
    const { name } = req.params;
    if (!validIdentifier(name)) {
      return reply.status(400).send({ ok: false, error: 'Invalid database name' });
    }
    try {
      await switchDatabase(name);
      return { ok: true, current: name };
    } catch (err) {
      reply.status(500).send({ ok: false, error: err.message });
    }
  });

  // ── Tables ──
  fastify.get('/tables', async (req, reply) => {
    try {
      const tables = await getTables();
      return { ok: true, tables };
    } catch (err) {
      reply.status(500).send({ ok: false, error: err.message });
    }
  });

  fastify.get('/tables/:name', async (req, reply) => {
    try {
      const columns = await getTableSchema(req.params.name);
      return { ok: true, columns };
    } catch (err) {
      const status = err.message === 'Invalid table name' ? 400 : 500;
      reply.status(status).send({ ok: false, error: err.message });
    }
  });

  fastify.get('/tables/:name/indexes', async (req, reply) => {
    try {
      const indexes = await getTableIndexes(req.params.name);
      return { ok: true, indexes };
    } catch (err) {
      const status = err.message === 'Invalid table name' ? 400 : 500;
      reply.status(status).send({ ok: false, error: err.message });
    }
  });
}
