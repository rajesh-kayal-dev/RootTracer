import { PassThrough } from 'node:stream';
import { expect, it } from 'vitest';
import { createLogger } from '../src/index.js';

it('redacts supported credential fields while retaining service context', () => {
  const destination = new PassThrough();
  const logger = createLogger({ service: 'test-service' }, destination);
  logger.info(
    {
      password: 'password-secret',
      apiKey: 'key-secret',
      req: {
        headers: { authorization: 'bearer-secret', cookie: 'cookie-secret' },
      },
      user: { token: 'token-secret' },
    },
    'Request failed',
  );

  const output: unknown = destination.read();
  expect(Buffer.isBuffer(output)).toBe(true);
  if (!Buffer.isBuffer(output))
    throw new Error('Expected structured log output');
  const text = output.toString('utf8');
  expect(text).toContain('test-service');
  expect(text).toContain('[REDACTED]');
  for (const secret of [
    'password-secret',
    'key-secret',
    'bearer-secret',
    'cookie-secret',
    'token-secret',
  ]) {
    expect(text).not.toContain(secret);
  }
  destination.destroy();
});
