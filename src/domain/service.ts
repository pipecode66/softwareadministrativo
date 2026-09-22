import type { AppData, Client, OrderAction, OrderInput, PaymentMethod, User, WorkOrder } from './types';
import { CATEGORIES, MATERIALS, canCreate, canViewOrder, dateOnly, financials, isAdmin, isCalendarDate, isFinished, roundMoney, today } from './utils';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function validateInput(data: AppData, input: OrderInput, exceptId?: string) {
  assert(Number.isSafeInteger(input.number) && (input.number > 0 || Boolean(input.products) && !exceptId && input.number === 0), 'El número de OT debe ser un entero mayor que cero.');
  assert(input.number === 0 || !data.orders.some(o => o.number === input.number && o.id !== exceptId), 'Ya existe una orden con ese número de OT.');
  const client = data.clients.find(c => c.id === input.clientId);
  assert(client, 'Selecciona un cliente registrado.');
  if (input.documentType === 'FACT') assert(client.identification.trim(), 'El cliente de una FACT necesita identificación.');
  assert(input.description.trim().length > 0, 'La descripción del trabajo es obligatoria.');
  const deferredLaserValue = input.documentType === 'FACT' && Boolean(input.products?.length) && input.value === 0 && input.products!.every(product => {
    const activities = product.activities;
    return activities.some(activity => activity.area === 'PRINTING' && activity.printingType === 'LASER')
      && activities.every(activity => activity.area === 'DESIGN' || activity.area === 'PRINTING');
  });
  assert(Number.isFinite(input.value) && (roundMoney(input.value) > 0 || deferredLaserValue) && input.value <= 999999999999, 'El valor del trabajo es obligatorio y debe ser mayor que cero, salvo cuando todo el cobro corresponda al corte láser.');
  assert(['REM','FACT'].includes(input.documentType), 'Selecciona REM o FACT.');
  assert(CATEGORIES.includes(input.category), 'Selecciona una categoría comercial.');
  assert(['PRINT_ONLY','IMPRENTA','EXTERNO','WORKSHOP_ONLY','PRINT_WORKSHOP','MULTI_AREA'].includes(input.route), 'Selecciona un recorrido válido.');
  const retentions = [input.reteFuente,input.reteIva,input.ica];
  assert(retentions.every(v => Number.isFinite(v) && v >= 0), 'Las retenciones deben ser importes positivos o cero.');
  assert(retentions.every(v => v <= 999999999999), 'Las retenciones superan el importe máximo permitido.');
  if (input.products) {
    assert(input.products.length > 0 && input.products.every(product => product.description.trim() && Number.isSafeInteger(product.quantity) && product.quantity > 0 && product.unitValue >= 0 && product.activities.length), 'Cada producto necesita descripción, cantidad entera, valor y actividades.');
    assert(Math.round(input.products.reduce((sum, product) => sum + roundMoney(product.quantity * product.unitValue), 0) * 100) === Math.round(input.value * 100), 'La suma de productos debe coincidir con el valor de la OT.');
    assert(!input.printing, 'Las medidas de impresión se registran en cada producto.');
    assert(input.products.every(product => {
      const printing = product.activities.find(activity => activity.area === 'PRINTING');
      if (!printing) return product.materials.length === 0;
      if ((printing.printingType ?? 'PRINT') === 'LASER') return product.materials.length === 0;
      return product.materials.length > 0 || product.activities.some(activity => activity.area === 'DESIGN');
    }), 'Los materiales corresponden únicamente a Impresión; el corte láser no los requiere.');
    if (!client.specialPayment && !exceptId && input.value > 0) assert(input.initialPayment, 'Este cliente requiere un abono inicial.');
    if (input.initialPayment) assert(input.initialPayment.amount > 0 && ['EFECTIVO','BANCOLOMBIA','DAVIVIENDA'].includes(input.initialPayment.method), 'Indica el valor y medio del abono inicial.');
  } else if (!['WORKSHOP_ONLY','EXTERNO'].includes(input.route)) {
    assert(input.printing && MATERIALS.includes(input.printing.material), 'Selecciona el material de impresión.');
    assert([input.printing.length,input.printing.width].every(n => Number.isFinite(n) && n > 0 && n <= 100000), 'Registra largo y ancho válidos, mayores que cero, en metros.');
  } else assert(!input.printing, 'Este recorrido no lleva parámetros de impresión.');
}
function cleanInput(input: OrderInput, onCreate = false): OrderInput {
  const automatic = onCreate && input.products && input.documentType === 'FACT' && input.value > 524000;
  return { ...input, description: input.description.trim(), value: roundMoney(input.value),
    reteFuente: input.documentType === 'FACT' ? automatic ? roundMoney(input.value * .04) : roundMoney(input.reteFuente) : 0,
    reteIva: input.documentType === 'FACT' ? automatic ? roundMoney(input.value * .0285) : roundMoney(input.reteIva) : 0,
    ica: input.documentType === 'FACT' ? automatic ? roundMoney(input.value * .007) : roundMoney(input.ica) : 0,
    printing: input.products || ['WORKSHOP_ONLY','EXTERNO','MULTI_AREA'].includes(input.route) ? undefined : input.printing };
}
export function createWorkOrder(data: AppData, user: User, input: OrderInput): WorkOrder {
  assert(user.active && canCreate(user.role), 'No tienes permiso para crear órdenes.');
  validateInput(data, input);
  const now = new Date().toISOString();
  const number = input.number || Math.max(0, ...data.orders.map(order => order.number)) + 1;
  const payments = input.initialPayment ? [{ id: crypto.randomUUID(), date: input.initialPayment.date,
    amount: input.initialPayment.amount, method: input.initialPayment.method, recordedBy: user.id }] : [];
  const order: WorkOrder = { ...cleanInput(input, true), number, id: crypto.randomUUID(), createdAt: now, updatedAt: now,
    createdBy: user.id, payments, status: input.products ? 'IN_PRODUCTION' : 'NEW',
    financialRule: input.products ? 'NEW' : 'LEGACY', specialPayment: data.clients.find(client => client.id === input.clientId)?.specialPayment };
  assert(financials(order).balance >= 0, 'El abono inicial supera el total a cobrar.');
  return order;
}
export function editWorkOrder(data: AppData, user: User, order: WorkOrder, input: OrderInput): WorkOrder {
  assert(user.active && isAdmin(user.role), 'Solo Administración puede editar esta orden.');
  assert((['NEW','PENDING_ADMIN_REVIEW'].includes(order.status) || order.status === 'IN_PRODUCTION' && Boolean(order.products?.every(product => product.activities.every(activity => !activity.status || activity.status === 'PENDING')))) && !order.closedAt, 'La orden ya está en producción y sus datos están protegidos.');
  validateInput(data,input,order.id);
  const updated = { ...order, ...cleanInput(input) };
  assert(financials(updated).balance >= 0, 'El total de la orden no puede ser inferior a los pagos registrados.');
  return updated;
}
export function recordPayment(user: User, order: WorkOrder, payment: { date: string; amount: number; method?: Exclude<PaymentMethod, 'LEGACY'> }): WorkOrder {
  assert(user.active && isAdmin(user.role), 'Solo Administración puede registrar pagos.');
  assert(isCalendarDate(payment.date), 'La fecha del pago debe ser válida.');
  assert(payment.date >= dateOnly(order.createdAt) && payment.date <= today(), 'La fecha debe estar entre la creación de la orden y hoy.');
  assert(Number.isFinite(payment.amount) && roundMoney(payment.amount) > 0, 'El abono debe ser mayor que cero.');
  const balance = financials(order).balance;
  assert(Math.round(roundMoney(payment.amount) * 100) <= Math.round(balance * 100), 'El abono no puede superar el saldo pendiente.');
  assert(!payment.method || ['EFECTIVO', 'BANCOLOMBIA', 'DAVIVIENDA'].includes(payment.method), 'Selecciona un medio de pago válido.');
  return { ...order, payments: [...order.payments, { id: crypto.randomUUID(), date: payment.date, amount: roundMoney(payment.amount), method: payment.method ?? 'EFECTIVO', recordedBy: user.id }] };
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
    next.status = order.route === 'WORKSHOP_ONLY' ? 'IN_WORKSHOP' : order.route === 'EXTERNO' ? 'IN_EXTERNAL' : 'IN_PRINTING';
  } else if (action === 'finishPrinting') {
    assert(user.role === 'IMPRESION' && order.status === 'IN_PRINTING', 'Solo Impresión puede finalizar esta fase.');
    next.printingCompletedAt = now;
    next.status = order.route === 'PRINT_WORKSHOP' ? 'IN_WORKSHOP' : order.requiresInstallation ? 'PENDING_INSTALLATION' : 'COMPLETED';
  } else if (action === 'finishExternal') {
    assert(admin && order.status === 'IN_EXTERNAL', 'Solo Administración puede finalizar el trabajo Externo.');
    next.status = order.requiresInstallation ? 'PENDING_INSTALLATION' : 'COMPLETED';
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
export function validateClient(input: Pick<Client,'name'|'identification'|'phone'>) {
  assert(input.name.trim().length > 0, 'El nombre del cliente es obligatorio.');
  assert(input.phone.trim().length > 0, 'El número de celular es obligatorio.');
}
