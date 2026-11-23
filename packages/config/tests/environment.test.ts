import { describe, expect, it } from 'vitest';
import { httpConfigSchema, portSchema } from '../src/index.js';

describe('runtime environment validation', () => {
  it('uses local-only binding and bounded shutdown defaults', () => {
    expect(httpConfigSchema.parse({})).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      HOST: '127.0.0.1',
      SHUTDOWN_TIMEOUT_MS: 10_000,
    });
  });

  it.each(['', '0', '-1', '65536', '4.5', 'invalid'])(
    'rejects invalid port %j',
    (port) => {
      expect(portSchema.safeParse(port).success).toBe(false);
    },
  );

  it('accepts a valid environment port without mutating the input', () => {
    const environment = { PORT: '4001' };
    expect(portSchema.parse(environment.PORT)).toBe(4001);
    expect(environment.PORT).toBe('4001');
  });

  it.each([
    { NODE_ENV: 'staging' },
    { LOG_LEVEL: 'verbose' },
    { SHUTDOWN_TIMEOUT_MS: '0' },
    { SHUTDOWN_TIMEOUT_MS: '60001' },
    { HOST: ' ' },
  ])('fails closed for invalid runtime values %j', (environment) => {
    expect(httpConfigSchema.safeParse(environment).success).toBe(false);
  });
});
