import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { bootstrapAdmin } from '../bootstrap.js';
import { readConfig } from '../config.js';
import { createPgliteDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { startServer } from '../main.js';

/** An explicit local-only entry point. Does not read server/.env or DATABASE_URL. */
export function localInstallationsConfig() {
  return readConfig({
    NODE_ENV: 'development', API_HOST: '127.0.0.1', API_PORT: '3002',
    APP_ORIGINS: 'http://127.0.0.1:5175,http://localhost:5175',
    DATABASE_MODE: 'pglite',
    PGLITE_DATA_DIR: fileURLToPath(new URL('../../.data/installations-local', import.meta.url)),
  });
}

async function main() {
  const config = localInstallationsConfig();
  const db = await createPgliteDatabase(config.dataDir);
  let handedToServer = false;
  try {
    await migrate(db);
    const users = await db.query('SELECT id FROM users LIMIT 1');
    if (!users.rows.length) {
      const password = `Instalaciones-${randomBytes(18).toString('base64url')}!`;
      await bootstrapAdmin(db, {
        name: 'Administración local', email: 'admin.instalaciones@example.test', password,
      });
      console.log('Cuenta EXCLUSIVA de este entorno local: admin.instalaciones@example.test');
      console.log(`Contraseña inicial local (guárdala ahora): ${password}`);
      console.log('Crea las cuentas de instaladores desde Usuarios. No se copiaron usuarios ni OT de producción.');
    }
    // startServer owns the connection, including cleanup if startup fails.
    handedToServer = true;
    const runtime = await startServer(config, db);
    console.log('API LOCAL de Instalaciones: http://127.0.0.1:3002');
    console.log('Abre otra terminal: npm run dev:installations');
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void runtime.close().catch(() => { process.exitCode = 1; }).finally(() => {
        process.off('SIGINT', shutdown); process.off('SIGTERM', shutdown);
      });
    };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch {
    if (!handedToServer) await db.close();
    console.error('No se pudo iniciar el entorno local. Revisa que el puerto 3002 y su base local no estén ocupados. No se conectó a producción.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(() => {
    console.error('No se pudo abrir la base local de Instalaciones. Revisa el bloqueo de otro proceso; no borres los datos.');
    process.exitCode = 1;
  });
}
