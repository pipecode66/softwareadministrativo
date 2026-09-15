import { z } from 'zod';
import type { Role } from '../contracts.js';

export const categories = ['SuperGiros', 'Carro Vallas', 'Proyecto', 'Otras'] as const;
export const materials = ['Panaflex', 'Vinilo', 'V. Corte', 'V. Impresión', 'Banner'] as const;
export const statuses = ['NEW','PENDING_ADMIN_REVIEW','IN_PRINTING','IN_WORKSHOP','PENDING_INSTALLATION','COMPLETED','INSTALLED'] as const;
export const routes = ['PRINT_ONLY','WORKSHOP_ONLY','PRINT_WORKSHOP'] as const;
export const isAdmin = (role: Role) => role === 'ADMINMASTER' || role === 'ADMIN_GENERAL';
export const iso = (value: Date | string) => new Date(value).toISOString();
export function dateOnly(value: Date | string = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const dateSchema = z.string().refine(calendarDate, 'La fecha no es válida.');
export const moneySchema = z.number().finite().min(0).max(999999999999.99)
  .refine(n => Number(n.toFixed(2)) === n, 'Utiliza máximo dos decimales.');
const dimension = z.number().finite().min(0.001).max(100000)
  .refine(n => Number(n.toFixed(3)) === n, 'Utiliza máximo tres decimales.');
export const orderFields = {
  clientId: z.uuid(), description: z.string().trim().min(1).max(10000),
  value: moneySchema.refine(n => n >= 0.01, 'El valor es obligatorio y debe ser mayor que cero.'),
  documentType: z.enum(['REM','FACT']), category: z.enum(categories), route: z.enum(routes),
  requiresInstallation: z.boolean(),
  printing: z.object({ material: z.enum(materials), length: dimension, width: dimension }).strict().optional(),
  reteFuente: moneySchema.default(0), reteIva: moneySchema.default(0), ica: moneySchema.default(0),
};
export const orderInputSchema = z.object(orderFields).strict().superRefine((value, ctx) => {
  if (value.route !== 'WORKSHOP_ONLY' && !value.printing) ctx.addIssue({ code: 'custom', path: ['printing'], message: 'Indica material, largo y ancho para impresión.' });
  if (value.route === 'WORKSHOP_ONLY' && value.printing) ctx.addIssue({ code: 'custom', path: ['printing'], message: 'Esta ruta no incluye impresión.' });
  if (value.documentType === 'REM' && (value.reteFuente || value.reteIva || value.ica)) ctx.addIssue({ code: 'custom', message: 'Las retenciones corresponden únicamente a FACT.' });
});
export const createSchema = orderInputSchema.safeExtend({ requestId: z.uuid() });
export const editSchema = orderInputSchema.safeExtend({ expectedVersion: z.number().int().positive() });
export const paymentSchema = z.object({ date: dateSchema, amount: moneySchema.refine(n => n >= 0.01, 'El abono debe ser mayor que cero.'), requestId: z.uuid() }).strict();
export const transitionSchema = z.object({
  action: z.enum(['send','finishPrinting','startWorkshop','finishWorkshop','install','close']),
  expectedVersion: z.number().int().positive(), date: dateSchema.optional(), note: z.string().trim().max(2000).optional(),
}).strict();
export type OrderInput = z.infer<typeof orderInputSchema>;
export type OrderRow = {
  id: string; number: number; client_id: string; description: string; value: string; document_type: 'REM'|'FACT';
  category: typeof categories[number]; route: typeof routes[number]; requires_installation: boolean;
  status: typeof statuses[number]; created_by: string; created_at: Date|string; updated_at: Date|string; version: number;
  material: typeof materials[number] | null; length: string|null; width: string|null;
  rete_fuente: string; rete_iva: string; ica: string;
  printing_completed_at: Date|string|null; workshop_started_at: Date|string|null; ready_for_installation_at: Date|string|null;
  installed_at: Date|string|null; installation_note: string|null; closed_at: Date|string|null; creation_key: string; creation_fingerprint: string;
};
export type PaymentRow = { id: string; order_id: string; date: string|Date; amount: string; recorded_by: string; request_key: string };
export const cents = (value: string|number) => Math.round(Number(value) * 100);
export function financials(order: Pick<OrderRow,'value'|'document_type'|'rete_fuente'|'rete_iva'|'ica'>, payments: Pick<PaymentRow,'amount'>[]) {
  const base = cents(order.value);
  const iva = order.document_type === 'FACT' ? Math.round(base * 19 / 100) : 0;
  const retentions = order.document_type === 'FACT' ? cents(order.rete_fuente) + cents(order.rete_iva) + cents(order.ica) : 0;
  // Business interpretation from this continuation; final example confirmation recorded in docs.
  const collectible = base + iva + retentions;
  const paid = payments.reduce((total, p) => total + cents(p.amount), 0);
  return { base: base / 100, iva: iva / 100, gross: (base + iva) / 100, retentions: retentions / 100,
    collectible: collectible / 100, paid: paid / 100, balance: (collectible - paid) / 100,
    paymentStatus: collectible <= paid ? 'PAID' as const : paid ? 'PARTIAL' as const : 'PENDING' as const };
}
export function orderDto(row: OrderRow, payments: PaymentRow[], role: Role) {
  const operational = {
    id: row.id, number: row.number, clientId: row.client_id, description: row.description, documentType: row.document_type,
    category: row.category, route: row.route, requiresInstallation: row.requires_installation, status: row.status,
    createdBy: row.created_by, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), version: row.version,
    ...(row.material ? { printing: { material: row.material, length: Number(row.length), width: Number(row.width) }, areaM2: Math.round(Number(row.length)*Number(row.width)*1000)/1000 } : {}),
    ...(row.printing_completed_at ? { printingCompletedAt: iso(row.printing_completed_at) } : {}),
    ...(row.workshop_started_at ? { workshopStartedAt: iso(row.workshop_started_at) } : {}),
    ...(row.installed_at ? { installedAt: iso(row.installed_at), installationNote: row.installation_note ?? '' } : {}),
    ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}),
  };
  if (!isAdmin(role)) return role === 'DISENO' ? { ...operational, value: Number(row.value) } : operational;
  return { ...operational, value: Number(row.value), reteFuente: Number(row.rete_fuente), reteIva: Number(row.rete_iva), ica: Number(row.ica),
    payments: payments.map(p => ({ id: p.id, date: typeof p.date === 'string' ? p.date.slice(0,10) : p.date.toISOString().slice(0,10), amount: Number(p.amount), recordedBy: p.recorded_by })),
    financials: financials(row, payments),
  };
}
