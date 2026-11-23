import { createServer } from 'node:http';
import { createLogger } from '@roottracer/logger';
import { createApp } from './app.js';
import { loadConfig } from './config/index.js';

const logger = createLogger({ service: 'notification-service' });

try {
  const config = loadConfig();
  logger.level = config.LOG_LEVEL;
  let shuttingDown = false;
  const server = createServer(createApp(() => false));

  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down');

    const deadline = setTimeout(() => {
      logger.error('Graceful shutdown timed out');
      server.closeAllConnections();
      process.exitCode = 1;
    }, config.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();

    server.close((error) => {
      clearTimeout(deadline);
      if (error) {
        logger.error({ err: error }, 'Shutdown failed');
        process.exitCode = 1;
      } else {
        logger.info('Shutdown complete');
      }
    });
  }

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  server.once('error', (error) => {
    logger.fatal({ err: error }, 'HTTP listener failed');
    process.exitCode = 1;
  });

  server.listen(config.NOTIFICATION_HEALTH_PORT, config.HOST, () => {
    logger.info(
      { host: config.HOST, port: config.NOTIFICATION_HEALTH_PORT },
      'Worker scaffold running; notification consumer is not configured',
    );
  });
} catch (error: unknown) {
  logger.fatal({ err: error }, 'Service startup failed');
  process.exitCode = 1;
}
