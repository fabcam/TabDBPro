import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { queryRoutes } from './routes/query.js';
import { schemaRoutes } from './routes/schema.js';
import { configureRoutes } from './routes/configure.js';
import { testRoutes } from './routes/test.js';
import { checkLocalhost } from './security/guard.js';
import { closePool } from './db/pool.js';

const fastify = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { colorize: true } },
    level: 'info',
  },
  // Bind only to localhost — no external interfaces
  host: '127.0.0.1',
});

// CORS: only allow Chrome DevTools and chrome-extension origins
await fastify.register(cors, {
  origin: (origin, cb) => {
    if (!origin || origin.startsWith('devtools://') || origin.startsWith('chrome-extension://')) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'), false);
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
});

// Enforce localhost on every request (belt-and-suspenders with host binding)
fastify.addHook('onRequest', async (req, reply) => {
  try {
    checkLocalhost(req);
  } catch (err) {
    reply.status(403).send({ ok: false, error: err.message });
  }
});

await fastify.register(healthRoutes);
await fastify.register(configureRoutes);
await fastify.register(testRoutes);
await fastify.register(queryRoutes);
await fastify.register(schemaRoutes);

const shutdown = async () => {
  fastify.log.info('Shutting down bridge...');
  await fastify.close();
  await closePool();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await fastify.listen({ port: config.port, host: '127.0.0.1' });
  const connSummary = config.connections.length === 1
    ? `DB: ${config.connections[0].type.padEnd(10)} Read-only: ${config.readOnly}`
    : `Connections: ${config.connections.length}    Read-only: ${config.readOnly}`;
  fastify.log.info(`
┌─────────────────────────────────────────────┐
│  TabDB Pro bridge running                   │
│  http://localhost:${config.port}                  │
│  ${connSummary.padEnd(43)}│
└─────────────────────────────────────────────┘
  `);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
