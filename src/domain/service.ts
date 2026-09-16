import type { AppData, Client, OrderAction, OrderInput, User, WorkOrder } from './types';
import { CATEGORIES, MATERIALS, canCreate, canViewOrder, dateOnly, financials, isAdmin, isCalendarDate, isFinished, roundMoney, today } from './utils';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function validateInput(data: AppData, input: OrderInput, exceptId?: string) {
  assert(Number.isSafeInteger(input.number) && input.number > 0, 'El número de OT debe ser un entero mayor que cero.');
  assert(!data.orders.some(o => o.number === input.number && o.id !== exceptId), 'Ya existe una orden con ese número de OT.');
  assert(data.clients.some(c => c.id === input.clientId), 'Selecciona un cliente registrado.');
  assert(input.description.trim().length > 0, 'La descripción del trabajo es obligatoria.');
  assert(Number.isFinite(input.value) && roundMoney(input.value) > 0 && input.value <= 999999999999, 'El valor del trabajo es obligatorio y debe ser mayor que cero.');
  assert(['REM','FACT'].includes(input.documentType), 'Selecciona REM o FACT.');
  assert(CATEGORIES.includes(input.category), 'Selecciona una categoría comercial.');
  assert(['PRINT_ONLY','IMPRENTA','WORKSHOP_ONLY','PRINT_WORKSHOP'].includes(input.route), 'Selecciona un recorrido válido.');
  const retentions = [input.reteFuente,input.reteIva,input.ica];
  assert(retentions.every(v => Number.isFinite(v) && v >= 0), 'Las retenciones deben ser importes positivos o cero.');
  assert(retentions.every(v => v <= 999999999999), 'Las retenciones superan el importe máximo permitido.');
  if (input.route !== 'WORKSHOP_ONLY') {
    assert(input.printing && MATERIALS.includes(input.printing.material), 'Selecciona el material de impresión.');
    assert([input.printing.length,input.printing.width].every(n => Number.isFinite(n) && n > 0 && n <= 100000), 'Registra largo y ancho válidos, mayores que cero, en metros.');
  }
}
function cleanInput(input: OrderInput): OrderInput { return { ...input, description: input.description.trim(), value: roundMoney(input.value), reteFuente: input.documentType === 'FACT' ? roundMoney(input.reteFuente) : 0, reteIva: input.documentType === 'FACT' ? roundMoney(input.reteIva) : 0, ica: input.documentType === 'FACT' ? roundMoney(input.ica) : 0, printing: input.route === 'WORKSHOP_ONLY' ? undefined : input.printing }; }
export function createWorkOrder(data: AppData, user: User, input: OrderInput): WorkOrder {
  assert(user.active && canCreate(user.role), 'No tienes permiso para crear órdenes.');
  validateInput(data, input);
  const now = new Date().toISOString();
  return { ...cleanInput(input), id: crypto.randomUUID(), createdAt: now, updatedAt: now, createdBy: user.id, payments: [], status: user.role === 'DISENO' ? 'PENDING_ADMIN_REVIEW' : 'NEW' };
}
export function editWorkOrder(data: AppData, user: User, order: WorkOrder, input: OrderInput): WorkOrder {
  assert(user.active && isAdmin(user.role), 'Solo Administración puede editar esta orden.');
  assert(['NEW','PENDING_ADMIN_REVIEW'].includes(order.status) && !order.closedAt, 'La orden ya está en producción y sus datos están protegidos.');
  validateInput(data,input,order.id);
  const updated = { ...order, ...cleanInput(input) };
  assert(financials(updated).balance >= 0, 'El total de la orden no puede ser inferior a los pagos registrados.');
  return updated;
}
export function recordPayment(user: User, order: WorkOrder, payment: { date: string; amount: number }): WorkOrder {
  assert(user.active && isAdmin(user.role), 'Solo Administración puede registrar pagos.');
  assert(isCalendarDate(payment.date), 'La fecha del pago debe ser válida.');
  assert(payment.date >= dateOnly(order.createdAt) && payment.date <= today(), 'La fecha debe estar entre la creación de la orden y hoy.');
  assert(Number.isFinite(payment.amount) && roundMoney(payment.amount) > 0, 'El abono debe ser mayor que cero.');
  const balance = financials(order).balance;
  assert(Math.round(roundMoney(payment.amount) * 100) <= Math.round(balance * 100), 'El abono no puede superar el saldo pendiente.');
  return { ...order, payments: [...order.payments, { id: crypto.randomUUID(), date: payment.date, amount: roundMoney(payment.amount), recordedBy: user.id }] };
}
export function transitionWorkOrder(user: User, order: WorkOrder, action: OrderAction, details?: { date?: string; note?: string }): WorkOrder {
  assert(user.active && canViewOrder(user, order), 'No tienes permiso para modificar esta orden.');
  const admin = isAdmin(user.role);
  const now = new Date().toISOString();
  const next = { ...order };
  if (action === 'close') {
    assert(admin && isFinished(order) && !order.closedAt, 'Solo Administración puede cerrar un trabajo terminado o instalado.');
    return { ...order, closedAt: now };
  }
  assert(!order.closedAt, 'La orden está cerrada administrativamente.');
  if (action === 'send') {
    assert(admin && ['NEW','PENDING_ADMIN_REVIEW'].includes(order.status), 'La orden no está pendiente de revisión o envío.');
    next.status = order.route === 'WORKSHOP_ONLY' ? 'IN_WORKSHOP' : 'IN_PRINTING';
  } else if (action === 'finishPrinting') {
    assert(user.role === 'IMPRESION' && order.status === 'IN_PRINTING', 'Solo Impresión puede finalizar esta fase.');
    next.printingCompletedAt = now;
    next.status = order.route === 'PRINT_WORKSHOP' ? 'IN_WORKSHOP' : order.requiresInstallation ? 'PENDING_INSTALLATION' : 'COMPLETED';
  } else if (action === 'startWorkshop') {
    assert(user.role === 'TALLER' && order.status === 'IN_WORKSHOP' && !order.workshopStartedAt, 'Solo Taller puede iniciar esta fase.');
    next.workshopStartedAt = now;
  } else if (action === 'finishWorkshop') {
    assert(user.role === 'TALLER' && order.status === 'IN_WORKSHOP', 'Solo Taller puede finalizar esta fase.');
    next.status = order.requiresInstallation ? 'PENDING_INSTALLATION' : 'COMPLETED';
  } else if (action === 'install') {
    assert((admin || user.role === 'TALLER') && order.status === 'PENDING_INSTALLATION' && order.requiresInstallation, 'La orden no está pendiente de instalación.');
    assert(details?.date && isCalendarDate(details.date) && details.date >= dateOnly(order.readyForInstallationAt || order.updatedAt) && details.date <= today(), 'La fecha de instalación debe estar entre el fin de producción y hoy.');
    next.installedAt = `${details.date}T12:00:00-05:00`;
    next.installationNote = details.note?.trim() || '';
    next.status = 'INSTALLED';
  } else { throw new Error('Acción no válida.'); }
  if (next.status === 'PENDING_INSTALLATION' && order.status !== 'PENDING_INSTALLATION') next.readyForInstallationAt = now;
  next.updatedAt = now;
  return next;
}
export function validateClient(input: Pick<Client,'name'|'identification'|'phone'>) { assert(input.name.trim().length > 0, 'El nombre del cliente es obligatorio.'); }
