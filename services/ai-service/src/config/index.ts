import { httpConfigSchema, portSchema } from '@roottracer/config';

const configSchema = httpConfigSchema.extend({
  AI_PORT: portSchema.default(4004),
});

export type ServiceConfig = ReturnType<typeof configSchema.parse>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    const fields = result.error.issues.map(
      (issue) => `${issue.path.join('.')} (${issue.code})`,
    );
    throw new Error(`Invalid ai-service configuration: ${fields.join(', ')}`);
  }
  return result.data;
}
