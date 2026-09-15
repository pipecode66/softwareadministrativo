import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { readConfig, type AppConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';
import type { Database } from './db/types.js';

/** Owns the supplied connection from startup through graceful shutdown. */
export async function startServer(config: AppConfig, db: Database): Promise<{
  server: Server;
  close: () => Promise<void>;
}> {
  let server: Server;
  try {
    await migrate(db);
    const app = await createApp(db, config);
    server = createServer(app);
    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    await new Promise<void>((ready, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        ready();
      });
    });
  } catch (error) {
    // Failed migrations, app initialization or a busy port must release PGlite's lock.
    await db.close();
    throw error;
  }

  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      try {
        await new Promise<void>((done, reject) => {
          const grace = setTimeout(() => server.closeAllConnections(), 15_000);
          grace.unref();
          server.close(error => {
            clearTimeout(grace);
            if (error) reject(error);
            else done();
          });
        });
      } finally {
        // HTTP requests finish before the underlying database is closed.
        await db.close();
      }
    })();
    return closing;
  }
  return { server, close };
}

async function main(): Promise<void> {
  try {
    const config = readConfig();
    const runtime = await startServer(config, await openDatabase(config));
    console.log(`API Intermedios en http://${config.host}:${config.port}`);

    const shutdown = () => {
      void runtime.close().catch(() => {
        console.error('API: no se pudo cerrar correctamente. Revisa el proceso antes de reiniciar.');
        process.exitCode = 1;
      }).finally(() => {
        process.off('SIGINT', shutdown);
        process.off('SIGTERM', shutdown);
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch {
    // Raw driver/parser errors can contain credentials or connection strings.
    console.error('API: no se pudo iniciar. Revisa configuración, migraciones, puerto y bloqueo de datos.');
    process.exitCode = 1;
  }
}

// Imports in tests do not open a database or start a listener.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main();
}
