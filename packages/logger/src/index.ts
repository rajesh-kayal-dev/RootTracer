import {
  pino,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
} from 'pino';

interface LoggerOptions {
  readonly service: string;
  readonly level?: LevelWithSilent;
}

export function createLogger(
  options: LoggerOptions,
  destination?: DestinationStream,
): Logger {
  const config = {
    name: options.service,
    level: options.level ?? 'info',
    redact: {
      paths: [
        'password',
        'token',
        'apiKey',
        'api_key',
        'authorization',
        'cookie',
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        '*.password',
        '*.token',
        '*.apiKey',
        '*.api_key',
      ],
      censor: '[REDACTED]',
    },
  };

  return destination === undefined ? pino(config) : pino(config, destination);
}
