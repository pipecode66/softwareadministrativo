import { readConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { bootstrapAdmin } from '../bootstrap.js';

try {
  const { BOOTSTRAP_ADMIN_NAME: name, BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: password } = process.env;
  if (!name || !email || !password) throw new Error('Faltan datos de la cuenta inicial.');
  const db = await openDatabase(readConfig());
  try {
    await bootstrapAdmin(db, { name, email, password });
    console.log('Adminmaster creado. La contraseña no se imprime ni se conserva en texto plano en la base. Retírala del entorno de aprovisionamiento.');
  } finally { await db.close(); }
} catch {
  console.error('No se creó la cuenta. Comprueba migraciones, base vacía, bloqueo y variables BOOTSTRAP_ADMIN_* (clave de 12 a 128 caracteres). No se sobrescriben cuentas existentes.');
  process.exitCode = 1;
}
