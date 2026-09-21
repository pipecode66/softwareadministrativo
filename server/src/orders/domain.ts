import { z } from 'zod';
import type { Role } from '../contracts.js';
import { productsSchema } from '../work/schemas.js';

export const categories = ['SuperGiros', 'Carro Vallas', 'Proyecto', 'Otras'] as const;
export const materials = ['Panaflex', 'V. Corte', 'V. Impresión', 'Banner'] as const;
export const statuses = ['NEW','PENDING_ADMIN_REVIEW','IN_PRINTING','IN_EXTERNAL','IN_WORKSHOP','IN_PRODUCTION','PENDING_INSTALLATION','COMPLETED','INSTALLED'] as const;
export const routes = ['PRINT_ONLY','EXTERNO','WORKSHOP_ONLY','PRINT_WORKSHOP','MULTI_AREA'] as const;
export const paymentMethods = ['EFECTIVO','BANCOLOMBIA','DAVIVIENDA'] as const;
export const paymentMethodSchema = z.enum(paymentMethods);
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
export const positivePaymentSchema = moneySchema.refine(n => n >= 0.01, 'El abono debe ser mayor que cero.');
const dimension = z.number().finite().min(0.001).max(100000)
  .refine(n => Number(n.toFixed(3)) === n, 'Utiliza máximo tres decimales.');
export const orderFields = {
  clientId: z.uuid(), description: z.string().trim().min(1).max(10000),
  value: moneySchema.refine(n => Number.isSafeInteger(n) && n >= 1, 'El valor es obligatorio y debe ser un peso entero desde $1.'),
  documentType: z.enum(['REM','FACT']), category: z.enum(categories), route: z.enum(routes),
  requiresInstallation: z.boolean(),
  printing: z.object({ material: z.enum(materials), length: dimension, width: dimension }).strict().optional(),
  products: productsSchema.optional(),
  reteFuente: moneySchema.optional(), reteIva: moneySchema.optional(), ica: moneySchema.optional(),
  initialPayment: z.object({ date: dateSchema, amount: positivePaymentSchema, method: paymentMethodSchema }).strict().optional(),
};
export const orderInputSchema = z.object(orderFields).strict().superRefine((value, ctx) => {
  if (value.products) {
    const areas = new Set(value.products.flatMap(product => product.activities.map(activity => activity.area)));
    if (value.products.some(product => !product.activities.length)) ctx.addIssue({ code: 'custom', path: ['products'], message: 'Cada producto requiere al menos una actividad de trabajo.' });
    const printing = areas.has('PRINTING'), workshop = areas.has('WORKSHOP'), external = areas.has('EXTERNAL');
    const expected = external && (printing || workshop) || !printing && !workshop && !external ? 'MULTI_AREA'
      : printing && workshop ? 'PRINT_WORKSHOP' : printing ? 'PRINT_ONLY' : workshop ? 'WORKSHOP_ONLY' : 'EXTERNO';
    if (value.route !== expected) ctx.addIssue({ code: 'custom', path: ['route'], message: 'La ruta debe corresponder a las actividades de los productos.' });
    if (value.printing) ctx.addIssue({ code: 'custom', path: ['printing'], message: 'Las medidas de una OT con productos se registran en cada producto.' });
  } else {
    if (value.route === 'MULTI_AREA') ctx.addIssue({ code: 'custom', path: ['products'], message: 'La ruta mixta requiere productos y actividades.' });
    if (!['WORKSHOP_ONLY','EXTERNO'].includes(value.route) && !value.printing) ctx.addIssue({ code: 'custom', path: ['printing'], message: 'Indica material, largo y ancho para impresión.' });
    if (['WORKSHOP_ONLY','EXTERNO'].includes(value.route) && value.printing) ctx.addIssue({ code: 'custom', path: ['printing'], message: 'Esta ruta no incluye impresión.' });
  }
  if (value.documentType === 'REM' && (value.reteFuente || value.reteIva || value.ica)) ctx.addIssue({ code: 'custom', message: 'Las retenciones corresponden únicamente a FACT.' });
});
export const createSchema = orderInputSchema.safeExtend({ requestId: z.uuid() });
export const editSchema = orderInputSchema.safeExtend({ expectedVersion: z.number().int().positive() });
export const paymentSchema = z.object({ date: dateSchema, amount: positivePaymentSchema, method: paymentMethodSchema, requestId: z.uuid() }).strict();
export const bulkPaymentSchema = z.object({
  clientId: z.uuid(), selectedOrderIds: z.array(z.uuid()).min(1).max(100), date: dateSchema,
  amount: positivePaymentSchema, method: paymentMethodSchema, requestId: z.uuid(),
}).strict().refine(input => new Set(input.selectedOrderIds).size === input.selectedOrderIds.length,
  { path:['selectedOrderIds'], message:'Cada OT puede seleccionarse una sola vez.' });
export const transitionSchema = z.object({
  action: z.enum(['send','finishPrinting','finishExternal','startWorkshop','finishWorkshop','install','close']),
  expectedVersion: z.number().int().positive(), date: dateSchema.optional(), note: z.string().trim().max(2000).optional(),
}).strict();
export type OrderInput = z.infer<typeof orderInputSchema>;
export type OrderRow = {
  id: string; number: number; client_id: string; description: string; value: string; document_type: 'REM'|'FACT';
  category: typeof categories[number]; route: typeof routes[number] | 'IMPRENTA'; requires_installation: boolean;
  status: typeof statuses[number]; created_by: string; created_at: Date|string; updated_at: Date|string; version: number;
  material: typeof materials[number] | null; length: string|null; width: string|null;
  rete_fuente: string; rete_iva: string; ica: string;
  financial_rule: 'LEGACY'|'NEW'; special_payment?: boolean;
  has_visible_activity?: boolean;
  certificate_rete_fuente: boolean; certificate_rete_iva: boolean; certificate_ica: boolean;
  printing_completed_at: Date|string|null; workshop_started_at: Date|string|null; ready_for_installation_at: Date|string|null;
  installed_at: Date|string|null; installation_note: string|null; closed_at: Date|string|null; creation_key: string; creation_fingerprint: string;
};
export type PaymentRow = { id: string; order_id: string; date: string|Date; amount: string; method: typeof paymentMethods[number] | 'LEGACY'; recorded_by: string; request_key: string; bulk_batch_id?: string|null };
export const cents = (value: string|number) => Math.round(Number(value) * 100);
export function financials(order: Pick<OrderRow,'value'|'document_type'|'rete_fuente'|'rete_iva'|'ica'> & Partial<Pick<OrderRow,'financial_rule'|'special_payment'>>, payments: Pick<PaymentRow,'amount'>[]) {
  const base = cents(order.value);
  const iva = order.document_type === 'FACT' ? Math.round(base * 19 / 100) : 0;
  const retentions = order.document_type === 'FACT' ? cents(order.rete_fuente) + cents(order.rete_iva) + cents(order.ica) : 0;
  // Business interpretation from this continuation; final example confirmation recorded in docs.
  const collectible = base + iva + (order.financial_rule === 'NEW' ? -retentions : retentions);
  const paid = payments.reduce((total, p) => total + cents(p.amount), 0);
  return { base: base / 100, iva: iva / 100, gross: (base + iva) / 100, retentions: retentions / 100,
    collectible: collectible / 100, paid: paid / 100, balance: (collectible - paid) / 100,
    paymentStatus: collectible <= paid ? 'PAID' as const : order.special_payment ? 'SPECIAL' as const : paid ? 'PARTIAL' as const : 'PENDING' as const };
}
export function orderDto(row: OrderRow, payments: PaymentRow[], role: Role, designerCanSeeCommercial = true) {
  const operational = {
    id: row.id, number: row.number, clientId: row.client_id, description: row.description, documentType: row.document_type,
    category: row.category, route: row.route, requiresInstallation: row.requires_installation, status: row.status,
    financialRule: row.financial_rule, specialPayment: Boolean(row.special_payment),
    createdBy: row.created_by, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), version: row.version,
    ...(row.material ? { printing: { material: row.material, length: Number(row.length), width: Number(row.width) }, areaM2: Math.round(Number(row.length)*Number(row.width)*1000)/1000 } : {}),
    ...(row.printing_completed_at ? { printingCompletedAt: iso(row.printing_completed_at) } : {}),
    ...(row.workshop_started_at ? { workshopStartedAt: iso(row.workshop_started_at) } : {}),
    ...(row.installed_at ? { installedAt: iso(row.installed_at), installationNote: row.installation_note ?? '' } : {}),
    ...(row.closed_at ? { closedAt: iso(row.closed_at) } : {}),
  };
  if (!isAdmin(role)) return role === 'DISENO' && designerCanSeeCommercial ? { ...operational, value: Number(row.value) } : operational;
  return { ...operational, value: Number(row.value), reteFuente: Number(row.rete_fuente), reteIva: Number(row.rete_iva), ica: Number(row.ica),
    certificates: { reteFuente: row.certificate_rete_fuente, reteIva: row.certificate_rete_iva, ica: row.certificate_ica },
    payments: payments.map(p => ({ id: p.id, date: typeof p.date === 'string' ? p.date.slice(0,10) : p.date.toISOString().slice(0,10), amount: Number(p.amount), method: p.method, recordedBy: p.recorded_by })),
    financials: financials(row, payments),
  };
}
