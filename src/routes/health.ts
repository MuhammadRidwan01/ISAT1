import type { FastifyInstance } from 'fastify';
import { instanceId, processStart } from '../lib/runtime.js';
import { getPool } from '../db/pool.js';
import { config } from '../config.js';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return {
      status: 'ok',
      instanceId,
      startedAt: processStart.toISOString(),
      uptimeSeconds: Math.round((Date.now() - processStart.getTime()) / 1000),
      version: config.appVersion,
    };
  });

  app.get('/health/db', async (req, reply) => {
    const base = {
      status: 'ok',
      instanceId,
      startedAt: processStart.toISOString(),
      uptimeSeconds: Math.round((Date.now() - processStart.getTime()) / 1000),
      version: config.appVersion,
    };
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      return { ...base, db: 'ok' };
    } catch (e) {
      reply.status(503);
      return { ...base, db: 'error' };
    }
  });
}