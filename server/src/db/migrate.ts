import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Database } from './types.js';

const migrationsDir = new URL('../../migrations/', import.meta.url);

export async function migrate(db: Database): Promise<string[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name varchar(180) PRIMARY KEY, checksum varchar(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationsDir)).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  return db.transaction(async tx => {
    await tx.exec('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
    const applied = await tx.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
    const added: string[] = [];
    for (const name of files) {
      const sql = await readFile(new URL(name, migrationsDir), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.rows.find(row => row.name === name);
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Migración ya aplicada modificada: ${name}. Crea una nueva migración; no reinicies los datos.`);
        continue;
      }
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      added.push(name);
    }
    return added;
  });
}
