import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { readConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import {
  CLEANUP_TIME_ZONE,
  cleanupConfirmationToken,
  executeTestDataCleanup,
  previewTestDataCleanup,
  type CleanupPlan,
} from '../maintenance/cleanup-test-data.js';

interface Arguments { cutoffDate: string; execute: boolean; confirmation?: string }

function argumentsOf(values: string[]): Arguments {
  let cutoffDate: string | undefined;
  let execute = false;
  let confirmation: string | undefined;
  for (const value of values) {
    if (value.startsWith('--cutoff=')) cutoffDate = value.slice('--cutoff='.length);
    else if (value === '--execute') execute = true;
    else if (value.startsWith('--confirm=')) confirmation = value.slice('--confirm='.length);
    else throw new Error(`Argumento no reconocido: ${value}`);
  }
  if (!cutoffDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
    throw new Error('Indica un corte explícito con --cutoff=AAAA-MM-DD. No se usa una fecha relativa.');
  }
  if (!execute && confirmation) throw new Error('--confirm solo se admite junto con --execute.');
  if (execute && !confirmation) throw new Error('La ejecución requiere el token exacto de la vista previa con --confirm=TOKEN.');
  return { cutoffDate, execute, confirmation };
}

function cutoffAtBogotaStart(date: string): Date {
  // Colombia currently uses UTC-05 year-round. The maintenance command still
  // records the named business zone in its output and plan.
  const cutoff = new Date(`${date}T00:00:00-05:00`);
  if (Number.isNaN(cutoff.getTime())) throw new Error('La fecha de corte no es válida.');
  const represented = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLEANUP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(cutoff);
  if (represented !== date) throw new Error('La fecha de corte no existe en el calendario.');
  return cutoff;
}

function safePostgresTarget(connectionString: string): string {
  const url = new URL(connectionString);
  const port = url.port || '5432';
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(sin nombre)';
  return `${url.hostname}:${port}/${database}`;
}

function targetOf(config: AppConfig): { label: string; signature: string } {
  const environment = config.production ? 'PRODUCCIÓN' : 'no producción';
  if (config.databaseMode === 'pglite') {
    const label = `PGlite ${environment}: ${config.dataDir}`;
    return { label, signature: `pglite|${environment}|${config.dataDir}` };
  }
  const safeTarget = safePostgresTarget(config.databaseUrl!);
  return {
    label: `PostgreSQL ${environment}: ${safeTarget}`,
    // Do not include, print or hash credentials/query parameters.
    signature: `postgres|${environment}|${safeTarget}`,
  };
}

function planLines(plan: CleanupPlan): string[] {
  return [
    `Corte inmutable: ${plan.cutoffDate} 00:00 (${CLEANUP_TIME_ZONE}) = ${plan.cutoff}`,
    `Eliminar: ${plan.delete.orders} OT, ${plan.delete.clients} clientes, ${plan.delete.payments} pagos, ${plan.delete.bulkPaymentBatches} lotes de multiabono.`,
    `Dependencias: ${plan.delete.orderProducts} productos, ${plan.delete.orderProductMaterials} materiales, ${plan.delete.orderActivities} actividades, ${plan.delete.orderEvents} eventos.`,
    `Conservar: ${plan.preserve.users} usuarios, ${plan.preserve.sessions} sesiones, ${plan.preserve.orders} OT, ${plan.preserve.clients} clientes.`,
    `Próximo número de OT: ${plan.nextOrderNumber}.`,
    ...(plan.preserve.clientsOlderThanCutoff > 0
      ? [`Aviso: se conservan ${plan.preserve.clientsOlderThanCutoff} clientes anteriores al corte porque tienen datos posteriores al corte.`]
      : []),
  ];
}

function redactedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Error desconocido.';
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]');
}

try {
  const args = argumentsOf(process.argv.slice(2));
  const config = readConfig();
  const target = targetOf(config);
  const cutoff = cutoffAtBogotaStart(args.cutoffDate);
  const db = await openDatabase(config);
  try {
    const plan = await previewTestDataCleanup(db, cutoff);
    const token = cleanupConfirmationToken(plan, target.signature);
    console.log(`Destino: ${target.label}`);
    for (const line of planLines(plan)) console.log(line);
    if (!args.execute) {
      console.log('MODO VISTA PREVIA: no se eliminó ni modificó ningún dato.');
      console.log(`Tras verificar respaldo, destino y cantidades, ejecuta de nuevo con --execute --confirm=${token}`);
    } else {
      if (args.confirmation !== token) {
        throw new Error('El token no corresponde a este destino y vista previa. No se eliminó nada.');
      }
      await executeTestDataCleanup(db, cutoff, plan);
      console.log('LIMPIEZA COMPLETADA dentro de una transacción. Usuarios y sesiones se conservaron.');
    }
  } finally {
    await db.close();
  }
} catch (error) {
  // A short opaque reference helps correlate logs without leaking a URL or values.
  const reference = createHash('sha256').update(redactedMessage(error)).digest('hex').slice(0, 8);
  console.error(`No se ejecutó la limpieza [${reference}]: ${redactedMessage(error)}`);
  process.exitCode = 1;
}
