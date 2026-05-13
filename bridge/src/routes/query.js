import { executeQuery } from '../db/query.js';

const bodySchema = {
  type: 'object',
  required: ['sql'],
  properties: {
    sql: { type: 'string', minLength: 1, maxLength: 50000 },
    params: { type: 'array', default: [] },
  },
};

export async function queryRoutes(fastify) {
  fastify.post('/query', { schema: { body: bodySchema } }, async (req, reply) => {
    const { sql, params } = req.body;
    try {
      const result = await executeQuery(sql, params);
      return { ok: true, ...result };
    } catch (err) {
      const status = err.code === 'READONLY' || err.code === 'DANGEROUS' ? 403 : 400;
      reply.status(status).send({ ok: false, error: err.message, code: err.code || 'QUERY_ERROR' });
    }
  });
}
