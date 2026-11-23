import { z } from 'zod';

export const portSchema = z.coerce.number().int().min(1).max(65_535);

export const runtimeConfigSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1)
    .max(60_000)
    .default(10_000),
});

export const httpConfigSchema = runtimeConfigSchema.extend({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
});
