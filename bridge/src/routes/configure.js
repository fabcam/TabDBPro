import { applyConfig } from '../config.js';
import { closePool, resetConnectionIndex } from '../db/pool.js';

export async function configureRoutes(fastify) {
  fastify.post('/configure', async (req, reply) => {
    const { connections } = req.body ?? {};
    try {
      applyConfig({ connections });
      await closePool();
      resetConnectionIndex();
      return { ok: true };
    } catch (err) {
      reply.status(400).send({ ok: false, error: err.message });
    }
  });
}
