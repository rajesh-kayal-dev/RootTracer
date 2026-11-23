import { once } from 'node:events';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@roottracer/contracts';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';

describe('identity-service foundation', () => {
  let ready = false;
  const server = createServer(createApp(() => ready));
  let baseUrl: string;

  beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected TCP listener');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    ready = false;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it('serves liveness without exposing framework headers', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(response.headers.has('x-powered-by')).toBe(false);
    const body: unknown = await response.json();
    expect(healthResponseSchema.parse(body)).toEqual({
      service: 'identity-service',
      status: 'ok',
    });
  });

  it('does not claim readiness before dependencies are connected', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);
    const body: unknown = await response.json();
    expect(healthResponseSchema.parse(body).status).toBe('not_ready');
  });

  it('serves readiness only after the owning runtime reports ready', async () => {
    ready = true;
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(healthResponseSchema.parse(body).status).toBe('ok');
  });

  it('exposes no business endpoints', async () => {
    const response = await fetch(`${baseUrl}/api/v1/projects`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('validates its own port without exposing rejected environment values', () => {
    expect(loadConfig({}).IDENTITY_PORT).toBe(4001);
    expect(() =>
      loadConfig({ IDENTITY_PORT: 'private-invalid-value' }),
    ).toThrow('IDENTITY_PORT');
    expect(() =>
      loadConfig({ IDENTITY_PORT: 'private-invalid-value' }),
    ).not.toThrow('private-invalid-value');
  });
});
