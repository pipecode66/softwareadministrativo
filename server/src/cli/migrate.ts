import { readConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';

try {
  const db = await openDatabase(readConfig());
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'Base de datos actualizada; no se modificaron migraciones existentes.');
  } finally { await db.close(); }
} catch (error) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? ` [${String(error.code)}]` : '';
  const message = error instanceof Error ? error.message : 'Error desconocido.';
  console.error(`No se pudieron aplicar las migraciones${code}: ${message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]')}`);
  process.exitCode = 1;
}
