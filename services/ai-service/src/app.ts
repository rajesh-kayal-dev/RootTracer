import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import type { HealthResponse } from '@roottracer/contracts';

export function createApp(isReady: () => boolean = () => false): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health/live', (_request, response) => {
    const body: HealthResponse = { service: 'ai-service', status: 'ok' };
    response.json(body);
  });

  app.get('/health/ready', (_request, response) => {
    const ready = isReady();
    const body: HealthResponse = {
      service: 'ai-service',
      status: ready ? 'ok' : 'not_ready',
    };
    response.status(ready ? 200 : 503).json(body);
  });

  app.use((_request, response) => {
    const requestId = randomUUID();
    response.setHeader('X-Request-ID', requestId);
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        request_id: requestId,
      },
    });
  });

  return app;
}
