import { readConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';

try {
  const db = await openDatabase(readConfig());
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'Base de datos actualizada; no se modificaron migraciones existentes.');
  } finally { await db.close(); }
} catch {
  console.error('No se pudieron aplicar las migraciones. Revisa configuración, conexión y el bloqueo local. Los datos no se reinicializan.');
  process.exitCode = 1;
}
