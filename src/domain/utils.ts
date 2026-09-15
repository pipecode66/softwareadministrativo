import type { Category, DateRange, Financials, Material, Printing, ProductionRoute, Role, User, WorkOrder, WorkStatus } from './types';

export const CATEGORIES: Category[] = ['SuperGiros', 'Carro Vallas', 'Proyecto', 'Otras'];
export const MATERIALS: Material[] = ['Panaflex', 'Vinilo', 'V. Corte', 'V. Impresión', 'Banner'];
export const ROLE_LABELS: Record<Role, string> = { ADMINMASTER: 'Adminmaster', ADMIN_GENERAL: 'Administración', DISENO: 'Diseño', IMPRESION: 'Impresión', TALLER: 'Taller' };
export const STATUS_LABELS: Record<WorkStatus, string> = { NEW: 'Nueva', PENDING_ADMIN_REVIEW: 'En revisión', IN_PRINTING: 'En impresión', IN_WORKSHOP: 'En taller', PENDING_INSTALLATION: 'Por instalar', COMPLETED: 'Terminada', INSTALLED: 'Instalada' };
export const ROUTE_LABELS: Record<ProductionRoute, string> = { PRINT_ONLY: 'Solo Impresión', WORKSHOP_ONLY: 'Solo Taller', PRINT_WORKSHOP: 'Impresión → Taller' };
export const isAdmin = (role?: Role) => role === 'ADMINMASTER' || role === 'ADMIN_GENERAL';
export const canCreate = (role?: Role) => isAdmin(role) || role === 'DISENO';
export const isFinished = (order: WorkOrder) => order.status === 'COMPLETED' || order.status === 'INSTALLED';
export const canViewOrder = (user: User | null, order: WorkOrder) => {
  if (!user || !user.active) return false;
  if (isAdmin(user.role)) return true;
  if (user.role === 'DISENO') return order.createdBy === user.id;
  if (user.role === 'IMPRESION') return order.route !== 'WORKSHOP_ONLY' && order.status === 'IN_PRINTING';
  return user.role === 'TALLER' && ((order.route !== 'PRINT_ONLY' && order.status === 'IN_WORKSHOP') || order.status === 'PENDING_INSTALLATION');
};
export const visibleOrders = (user: User | null, orders: WorkOrder[]) => orders.filter(order => canViewOrder(user, order));
export const formatCOP = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
export const formatNumber = (value: number, digits = 0) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
export const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export const dateOnly = (value: string | Date = new Date()): string => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return isCalendarDate(value) ? value : '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
export const today = () => dateOnly();
export const currentMonthRange = (): DateRange => {
  const month = today().slice(0, 7);
  const end = new Date(`${month}-01T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from: `${month}-01`, to: `${month}-${end.getUTCDate()}` };
};
export const inRange = (date: string, range: DateRange) => {
  const d = dateOnly(date);
  return Boolean(d) && (!range.from || d >= range.from) && (!range.to || d <= range.to);
};
export const formatDate = (value?: string, withTime = false): string => {
  if (!value || (value.length === 10 && !isCalendarDate(value))) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00-05:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } as const : {}), timeZone: 'America/Bogota' }).format(date);
};
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const areaOf = (printing?: Printing) => printing ? Math.round(printing.length * printing.width * 1000) / 1000 : 0;
type FinancialInput = Pick<WorkOrder, 'value' | 'documentType' | 'reteFuente' | 'reteIva' | 'ica' | 'payments'>;
export function financials(order: FinancialInput, cutoff?: string): Financials {
  const baseCents = Math.round(roundMoney(order.value) * 100);
  const ivaCents = order.documentType === 'FACT' ? Math.round(baseCents * 19 / 100) : 0;
  const retCents = order.documentType === 'FACT' ? [order.reteFuente, order.reteIva, order.ica].reduce((sum, v) => sum + Math.round(roundMoney(v) * 100), 0) : 0;
  const paidCents = order.payments.filter(p => !cutoff || dateOnly(p.date) <= cutoff).reduce((sum, p) => sum + Math.round(roundMoney(p.amount) * 100), 0);
  const balanceCents = baseCents + ivaCents + retCents - paidCents;
  return { base: baseCents / 100, iva: ivaCents / 100, gross: (baseCents + ivaCents) / 100, retentions: retCents / 100, collectible: (baseCents + ivaCents + retCents) / 100, paid: paidCents / 100, balance: balanceCents / 100, paymentStatus: balanceCents <= 0 ? 'PAID' : paidCents > 0 ? 'PARTIAL' : 'PENDING' };
}
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
export const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
