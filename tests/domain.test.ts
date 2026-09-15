import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, OrderInput, Role, User, WorkOrder, WorkStatus } from '../src/domain/types';
import { createWorkOrder, editWorkOrder, recordPayment, transitionWorkOrder, validateClient, validateInput } from '../src/domain/service';
import { areaOf, canCreate, canViewOrder, CATEGORIES, currentMonthRange, dateOnly, financials, formatDate, formatMeasure, formatPesosInput, inRange, isAdmin, isCalendarDate, isFinished, MATERIALS, normalize, roundMoney, today, visibleOrders } from '../src/domain/utils';

const NOW = '2026-09-14T15:00:00.000Z';
const roles: Role[] = ['ADMINMASTER', 'ADMIN_GENERAL', 'DISENO', 'IMPRESION', 'TALLER'];
const user = (role: Role = 'ADMIN_GENERAL', overrides: Partial<User> = {}): User => ({ id: `user-${role}`, name: role, email: `${role}@example.test`, role, active: true, ...overrides });
const input = (overrides: Partial<OrderInput> = {}): OrderInput => ({ number: 1, clientId: 'client-1', description: '  Trabajo publicitario  ', value: 100000, documentType: 'REM', category: 'Otras', route: 'PRINT_WORKSHOP', requiresInstallation: false, printing: { material: 'Panaflex', length: 2.5, width: 1.2 }, reteFuente: 0, reteIva: 0, ica: 0, ...overrides });
const order = (overrides: Partial<WorkOrder> = {}): WorkOrder => ({ ...input(), id: 'order-1', createdAt: '2026-01-15T18:00:00.000Z', updatedAt: '2026-01-15T18:00:00.000Z', createdBy: user('DISENO').id, payments: [], status: 'NEW', ...overrides });
const data = (orders: WorkOrder[] = []): AppData => ({ version: 1, users: roles.map(role => user(role)), clients: [{ id: 'client-1', name: 'Cliente de prueba', identification: '', phone: '', createdAt: '2026-01-01' }], orders });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); });

describe('Cálculos de dinero y cartera', () => {
  it('REM no incorpora IVA ni retenciones incluso si hay valores residuales', () => {
    expect(financials(order({ reteFuente: 100, reteIva: 200, ica: 300 }))).toEqual({ base: 100000, iva: 0, gross: 100000, retentions: 0, collectible: 100000, paid: 0, balance: 100000, paymentStatus: 'PENDING' });
  });
  it('FACT añade IVA y retenciones manuales al total cobrable', () => {
    expect(financials(order({ documentType: 'FACT', value: 100000, reteFuente: 2500, reteIva: 2850, ica: 700 }))).toEqual({ base: 100000, iva: 19000, gross: 119000, retentions: 6050, collectible: 125050, paid: 0, balance: 125050, paymentStatus: 'PENDING' });
  });
  it('resuelve de manera coherente la OT del diseño con dos abonos', () => {
    const result = financials(order({ documentType: 'FACT', value: 2850000, payments: [{ id: 'p1', date: '2026-09-01', amount: 1500000, recordedBy: 'admin' }, { id: 'p2', date: '2026-09-02', amount: 500000, recordedBy: 'admin' }] }));
    expect(result).toMatchObject({ iva: 541500, gross: 3391500, paid: 2000000, balance: 1391500, paymentStatus: 'PARTIAL' });
  });
  it('suma centavos sin residuos de coma flotante', () => {
    const result = financials(order({ value: 0.3, payments: [{ id: '1', amount: 0.1, date: '2026-09-01', recordedBy: 'admin' }, { id: '2', amount: 0.2, date: '2026-09-02', recordedBy: 'admin' }] }));
    expect(result).toMatchObject({ paid: 0.3, balance: 0, paymentStatus: 'PAID' });
  });
  it('redondea el IVA a centavos sobre la base monetaria normalizada', () => {
    expect(financials(order({ documentType: 'FACT', value: 1.005 }))).toMatchObject({ base: 1.01, iva: 0.19, gross: 1.2 });
    expect(roundMoney(1.005)).toBe(1.01);
  });
  it('cartera al corte incluye pagos anteriores y del día, no pagos posteriores', () => {
    const work = order({ payments: [{ id: '1', amount: 25000, date: '2026-01-31', recordedBy: 'admin' }, { id: '2', amount: 30000, date: '2026-02-01', recordedBy: 'admin' }, { id: '3', amount: 45000, date: '2026-02-02', recordedBy: 'admin' }] });
    expect(financials(work, '2026-01-30')).toMatchObject({ paid: 0, balance: 100000 });
    expect(financials(work, '2026-02-01')).toMatchObject({ paid: 55000, balance: 45000 });
    expect(financials(work)).toMatchObject({ paid: 100000, balance: 0 });
  });
  it.each(['COMPLETED', 'INSTALLED'] as WorkStatus[])('el estado %s no elimina deuda', status => {
    expect(financials(order({ status }))).toMatchObject({ balance: 100000, paymentStatus: 'PENDING' });
    expect(isFinished(order({ status }))).toBe(true);
  });
  it('suma retenciones aunque superen el valor base', () => {
    const result = createWorkOrder(data(), user(), input({ documentType: 'FACT', value: 100, reteFuente: 119 }));
    expect(financials(result)).toMatchObject({ collectible: 238, balance: 238, paymentStatus: 'PENDING' });
  });
});

describe('Validación y creación de órdenes', () => {
  it.each(['ADMINMASTER', 'ADMIN_GENERAL', 'DISENO'] as Role[])('%s puede crear; Diseño requiere revisión', role => {
    const result = createWorkOrder(data(), user(role), input());
    expect(result).toMatchObject({ number: 1, description: 'Trabajo publicitario', createdBy: user(role).id, createdAt: NOW, updatedAt: NOW, payments: [], status: role === 'DISENO' ? 'PENDING_ADMIN_REVIEW' : 'NEW' });
    expect(result.id).toBeTruthy();
  });
  it.each(['IMPRESION', 'TALLER'] as Role[])('%s no puede crear órdenes', role => {
    expect(() => createWorkOrder(data(), user(role), input())).toThrow(/permiso/);
  });
  it('no permite crear a una cuenta inactiva', () => {
    expect(() => createWorkOrder(data(), user('ADMINMASTER', { active: false }), input())).toThrow(/permiso/);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rechaza número OT inválido %s', number => {
    expect(() => validateInput(data(), input({ number }))).toThrow(/entero/);
  });
  it('requiere captura manual y única; no genera el siguiente número', () => {
    expect(() => createWorkOrder(data([order()]), user(), input())).toThrow(/Ya existe/);
    expect(createWorkOrder(data([order()]), user(), input({ number: 15 })).number).toBe(15);
  });
  it.each([0, -1, NaN, Infinity, 1000000000000, 0.001])('rechaza valor inválido o que redondea a cero: %s', value => {
    expect(() => validateInput(data(), input({ value }))).toThrow(/valor/);
  });
  it('requiere un cliente registrado y descripción no vacía', () => {
    expect(() => validateInput(data(), input({ clientId: 'missing' }))).toThrow(/cliente/);
    expect(() => validateInput(data(), input({ description: ' \n ' }))).toThrow(/descripción/);
  });
  it('rechaza documento, categoría o recorrido no admitidos', () => {
    expect(() => validateInput(data(), input({ documentType: 'OTHER' as OrderInput['documentType'] }))).toThrow(/REM o FACT/);
    expect(() => validateInput(data(), input({ category: 'Inventario' as OrderInput['category'] }))).toThrow(/categoría/);
    expect(() => validateInput(data(), input({ route: 'UNKNOWN' as OrderInput['route'] }))).toThrow(/recorrido/);
  });
  it.each([-1, NaN, Infinity])('rechaza retenciones inválidas %s', reteFuente => {
    expect(() => validateInput(data(), input({ documentType: 'FACT', reteFuente }))).toThrow(/retenciones/);
  });
  it('acepta retenciones redondeadas sin generar saldos negativos', () => {
    expect(() => validateInput(data(), input({ documentType: 'FACT', value: 1, reteFuente: 0.395, reteIva: 0.395, ica: 0.395 }))).not.toThrow();
    expect(() => validateInput(data(), input({ documentType: 'FACT', value: 1, reteFuente: 1.2 }))).not.toThrow();
  });
  it('limpia retenciones de REM y material de Solo Taller', () => {
    const result = createWorkOrder(data(), user(), input({ route: 'WORKSHOP_ONLY', reteFuente: 500, reteIva: 500, ica: 500 }));
    expect(result).toMatchObject({ reteFuente: 0, reteIva: 0, ica: 0, printing: undefined });
  });
  it('no exige material para Solo Taller', () => {
    expect(() => validateInput(data(), input({ route: 'WORKSHOP_ONLY', printing: undefined }))).not.toThrow();
  });
  it('exige material de la lista para cualquier ruta de impresión', () => {
    expect(() => validateInput(data(), input({ printing: undefined }))).toThrow(/material/);
    expect(() => validateInput(data(), input({ printing: { material: 'Papel' as 'Banner', length: 1, width: 1 } }))).toThrow(/material/);
  });
  it.each([0, -1, NaN, Infinity, 100001])('rechaza dimensiones inválidas %s', length => {
    expect(() => validateInput(data(), input({ printing: { material: 'Banner', length, width: 1 } }))).toThrow(/largo y ancho/);
  });
  it.each(MATERIALS)('admite el material %s', material => {
    expect(() => validateInput(data(), input({ printing: { material, length: 2, width: 1 } }))).not.toThrow();
  });
  it.each(CATEGORIES)('admite la categoría %s', category => {
    expect(() => validateInput(data(), input({ category }))).not.toThrow();
  });
});

describe('Edición protegida de órdenes', () => {
  it('admin edita antes de producción sin cambiar fecha operativa ni duplicar su propio número', () => {
    const original = order();
    expect(editWorkOrder(data([original]), user(), original, input({ description: '  Editada  ' }))).toMatchObject({ description: 'Editada', updatedAt: original.updatedAt, id: original.id });
  });
  it.each(['DISENO', 'IMPRESION', 'TALLER'] as Role[])('%s no edita', role => {
    expect(() => editWorkOrder(data(), user(role), order(), input())).toThrow(/Administración/);
  });
  it.each(['IN_PRINTING', 'IN_WORKSHOP', 'PENDING_INSTALLATION', 'COMPLETED', 'INSTALLED'] as WorkStatus[])('protege los datos en %s', status => {
    expect(() => editWorkOrder(data(), user(), order({ status }), input())).toThrow(/protegidos/);
  });
  it('impide bajar el total por debajo de abonos existentes', () => {
    const original = order({ payments: [{ id: 'p1', date: '2026-09-01', amount: 50000, recordedBy: 'admin' }] });
    expect(() => editWorkOrder(data([original]), user(), original, input({ value: 49999 }))).toThrow(/inferior a los pagos/);
    expect(financials(editWorkOrder(data([original]), user(), original, input({ value: 50000 }))).balance).toBe(0);
  });
});

describe('Registro de abonos', () => {
  it('registra varios pagos inmutables con fecha, responsable e identificadores independientes', () => {
    const original = order();
    const first = recordPayment(user(), original, { date: '2026-09-01', amount: 40000 });
    const second = recordPayment(user('ADMINMASTER'), first, { date: '2026-09-14', amount: 60000 });
    expect(original.payments).toHaveLength(0);
    expect(first.payments).toHaveLength(1);
    expect(second.payments).toHaveLength(2);
    expect(second.payments[0]).toMatchObject({ date: '2026-09-01', amount: 40000, recordedBy: user().id });
    expect(second.payments[1].recordedBy).toBe(user('ADMINMASTER').id);
    expect(second.payments[0].id).not.toBe(second.payments[1].id);
    expect(second.updatedAt).toBe(original.updatedAt);
    expect(second.status).toBe(original.status);
    expect(financials(second)).toMatchObject({ paid: 100000, balance: 0, paymentStatus: 'PAID' });
  });
  it.each(['DISENO', 'IMPRESION', 'TALLER'] as Role[])('%s no registra pagos', role => {
    expect(() => recordPayment(user(role), order(), { date: '2026-09-14', amount: 1 })).toThrow(/Administración/);
  });
  it('cuenta administrativa inactiva no registra pagos', () => {
    expect(() => recordPayment(user('ADMIN_GENERAL', { active: false }), order(), { date: '2026-09-14', amount: 1 })).toThrow(/Administración/);
  });
  it.each(['', '2026-02-31', '2026-02-29', '2026-13-01', '2026-09-00', '2026-9-1', '2026-09-14T12:00:00Z'])('rechaza fecha inexistente o con formato inválido %s', date => {
    expect(() => recordPayment(user(), order(), { date, amount: 1 })).toThrow(/fecha/);
  });
  it.each(['2026-01-14', '2026-09-15'])('rechaza fecha fuera del intervalo %s', date => {
    expect(() => recordPayment(user(), order(), { date, amount: 1 })).toThrow(/entre/);
  });
  it.each(['2026-01-15', '2026-09-14'])('admite límites inclusivos %s', date => {
    expect(() => recordPayment(user(), order(), { date, amount: 1 })).not.toThrow();
  });
  it.each([0, -1, NaN, Infinity, 0.001])('rechaza importe no positivo o inválido %s', amount => {
    expect(() => recordPayment(user(), order(), { date: '2026-09-14', amount })).toThrow(/mayor que cero/);
  });
  it('impide abonos mayores al saldo incluso al redondear el importe', () => {
    expect(() => recordPayment(user(), order({ value: 1 }), { date: '2026-09-14', amount: 1.005 })).toThrow(/superar/);
    expect(() => recordPayment(user(), order(), { date: '2026-09-14', amount: 100000.01 })).toThrow(/superar/);
  });
  it('permite recaudar deuda después del cierre administrativo', () => {
    const closed = order({ status: 'COMPLETED', closedAt: '2026-09-01T12:00:00Z' });
    const updated = recordPayment(user(), closed, { date: '2026-09-14', amount: 100000 });
    expect(updated.closedAt).toBe(closed.closedAt);
    expect(financials(updated).balance).toBe(0);
  });
});

describe('Permisos de visualización', () => {
  it.each(roles)('define capacidad administrativa y de creación para %s', role => {
    expect(isAdmin(role)).toBe(role.startsWith('ADMIN'));
    expect(canCreate(role)).toBe(role.startsWith('ADMIN') || role === 'DISENO');
  });
  it('anónimos e inactivos no ven órdenes', () => {
    expect(canViewOrder(null, order())).toBe(false);
    expect(canViewOrder(user('ADMINMASTER', { active: false }), order())).toBe(false);
  });
  it.each(['ADMINMASTER', 'ADMIN_GENERAL'] as Role[])('%s ve órdenes de todos los estados', role => {
    const statuses: WorkStatus[] = ['NEW', 'PENDING_ADMIN_REVIEW', 'IN_PRINTING', 'IN_WORKSHOP', 'PENDING_INSTALLATION', 'COMPLETED', 'INSTALLED'];
    expect(statuses.every(status => canViewOrder(user(role), order({ status })))).toBe(true);
  });
  it('Diseño ve únicamente sus órdenes, incluidas terminadas', () => {
    expect(canViewOrder(user('DISENO'), order({ status: 'COMPLETED' }))).toBe(true);
    expect(canViewOrder(user('DISENO', { id: 'another-designer' }), order())).toBe(false);
  });
  it('Impresión solo ve órdenes actualmente en su cola y con ruta de impresión', () => {
    expect(canViewOrder(user('IMPRESION'), order({ status: 'IN_PRINTING' }))).toBe(true);
    expect(canViewOrder(user('IMPRESION'), order({ status: 'IN_WORKSHOP' }))).toBe(false);
    expect(canViewOrder(user('IMPRESION'), order({ status: 'IN_PRINTING', route: 'WORKSHOP_ONLY' }))).toBe(false);
  });
  it('Taller ve su cola e instalación, incluida instalación después de Solo Impresión', () => {
    expect(canViewOrder(user('TALLER'), order({ status: 'IN_WORKSHOP' }))).toBe(true);
    expect(canViewOrder(user('TALLER'), order({ status: 'IN_WORKSHOP', route: 'PRINT_ONLY' }))).toBe(false);
    expect(canViewOrder(user('TALLER'), order({ status: 'PENDING_INSTALLATION', route: 'PRINT_ONLY' }))).toBe(true);
    expect(canViewOrder(user('TALLER'), order({ status: 'COMPLETED' }))).toBe(false);
  });
  it('filtra la colección sin modificarla y deniega perfiles desconocidos', () => {
    const orders = [order({ id: 'p', status: 'IN_PRINTING' }), order({ id: 't', status: 'IN_WORKSHOP' })];
    expect(visibleOrders(user('IMPRESION'), orders).map(item => item.id)).toEqual(['p']);
    expect(orders).toHaveLength(2);
    expect(canViewOrder(user('UNKNOWN' as Role), orders[1])).toBe(false);
  });
});

describe('Producción, instalación y cierre', () => {
  it.each(['NEW', 'PENDING_ADMIN_REVIEW'] as WorkStatus[])('Administración envía %s a impresión o directamente a taller', status => {
    expect(transitionWorkOrder(user(), order({ status }), 'send')).toMatchObject({ status: 'IN_PRINTING', updatedAt: NOW });
    expect(transitionWorkOrder(user(), order({ status, route: 'WORKSHOP_ONLY' }), 'send').status).toBe('IN_WORKSHOP');
  });
  it('Diseño no puede saltarse la revisión administrativa', () => {
    expect(() => transitionWorkOrder(user('DISENO'), order({ status: 'PENDING_ADMIN_REVIEW' }), 'send')).toThrow(/revisión/);
  });
  it('no deja saltar estados ni ejecutar una acción ajena al perfil', () => {
    expect(() => transitionWorkOrder(user(), order(), 'finishPrinting')).toThrow(/Impresión/);
    expect(() => transitionWorkOrder(user(), order({ status: 'IN_PRINTING' }), 'finishWorkshop')).toThrow(/Taller/);
    expect(() => transitionWorkOrder(user('TALLER'), order({ status: 'IN_PRINTING' }), 'finishPrinting')).toThrow(/permiso/);
    expect(() => transitionWorkOrder(user('IMPRESION'), order({ status: 'IN_PRINTING' }), 'close')).toThrow(/Administración/);
  });
  it.each([
    { route: 'PRINT_ONLY', requiresInstallation: false, expected: 'COMPLETED' },
    { route: 'PRINT_ONLY', requiresInstallation: true, expected: 'PENDING_INSTALLATION' },
    { route: 'PRINT_WORKSHOP', requiresInstallation: false, expected: 'IN_WORKSHOP' },
    { route: 'PRINT_WORKSHOP', requiresInstallation: true, expected: 'IN_WORKSHOP' },
  ] as const)('finalizar impresión resuelve $route / instalación $requiresInstallation', ({ route, requiresInstallation, expected }) => {
    const original = order({ status: 'IN_PRINTING', route, requiresInstallation });
    expect(original.printingCompletedAt).toBeUndefined();
    const result = transitionWorkOrder(user('IMPRESION'), original, 'finishPrinting');
    expect(result).toMatchObject({ status: expected, printingCompletedAt: NOW, updatedAt: NOW });
    expect(original.printingCompletedAt).toBeUndefined();
    expect(() => transitionWorkOrder(user(), result, 'finishPrinting')).toThrow();
  });
  it('consumo queda disponible solo después de completar impresión, en m²', () => {
    const queued = order({ status: 'IN_PRINTING' });
    const done = transitionWorkOrder(user('IMPRESION'), queued, 'finishPrinting');
    const consumption = (works: WorkOrder[]) => works.filter(work => work.printingCompletedAt && inRange(work.printingCompletedAt, { from: '2026-09-01', to: '2026-09-30' })).reduce((sum, work) => sum + areaOf(work.printing), 0);
    expect(consumption([queued])).toBe(0);
    expect(consumption([done])).toBe(3);
  });
  it('iniciar Taller conserva el estado y registra una única marca operativa', () => {
    const started = transitionWorkOrder(user('TALLER'), order({ status: 'IN_WORKSHOP' }), 'startWorkshop');
    expect(started).toMatchObject({ status: 'IN_WORKSHOP', workshopStartedAt: NOW, updatedAt: NOW });
    expect(() => transitionWorkOrder(user('TALLER'), started, 'startWorkshop')).toThrow(/iniciar/);
  });
  it.each([false, true])('Taller finaliza con instalación requerida: %s', requiresInstallation => {
    const finished = transitionWorkOrder(user('TALLER'), order({ status: 'IN_WORKSHOP', requiresInstallation }), 'finishWorkshop');
    expect(finished.status).toBe(requiresInstallation ? 'PENDING_INSTALLATION' : 'COMPLETED');
    expect(financials(finished).balance).toBe(100000);
  });
  it('registra instalación con fecha y nota, sin convertirla en pago', () => {
    const original = order({ status: 'PENDING_INSTALLATION', requiresInstallation: true, updatedAt: '2026-09-01T18:00:00Z' });
    const result = transitionWorkOrder(user('TALLER'), original, 'install', { date: '2026-09-10', note: '  Instalado en fachada.  ' });
    expect(result).toMatchObject({ status: 'INSTALLED', installedAt: '2026-09-10T12:00:00-05:00', installationNote: 'Instalado en fachada.', updatedAt: NOW });
    expect(financials(result).balance).toBe(100000);
  });
  it.each(['', '2026-02-31', '2026-02-29', '2026-01-14', '2026-09-15'])('no instala con fecha inválida o fuera del intervalo: %s', date => {
    expect(() => transitionWorkOrder(user(), order({ status: 'PENDING_INSTALLATION', requiresInstallation: true }), 'install', { date })).toThrow(/fecha/);
  });
  it('no permite instalar un trabajo que no requiere instalación', () => {
    expect(() => transitionWorkOrder(user(), order({ status: 'PENDING_INSTALLATION', requiresInstallation: false }), 'install', { date: '2026-09-14' })).toThrow(/pendiente de instalación/);
  });
  it('cierre solo administrativo después del fin, independiente del saldo', () => {
    const completed = order({ status: 'COMPLETED' });
    const closed = transitionWorkOrder(user(), completed, 'close');
    expect(closed).toMatchObject({ status: 'COMPLETED', closedAt: NOW, updatedAt: completed.updatedAt });
    expect(financials(closed).balance).toBe(100000);
    expect(() => transitionWorkOrder(user(), closed, 'close')).toThrow(/cerrar/);
    expect(() => transitionWorkOrder(user(), closed, 'send')).toThrow(/cerrada/);
    expect(() => transitionWorkOrder(user(), order(), 'close')).toThrow(/terminado/);
  });
  it('recorre Diseño → Administración → Impresión → Taller → Instalación → Cierre', () => {
    let work = createWorkOrder(data(), user('DISENO'), input({ requiresInstallation: true }));
    work = transitionWorkOrder(user(), work, 'send');
    work = transitionWorkOrder(user('IMPRESION'), work, 'finishPrinting');
    work = transitionWorkOrder(user('TALLER'), work, 'startWorkshop');
    work = transitionWorkOrder(user('TALLER'), work, 'finishWorkshop');
    work = transitionWorkOrder(user('TALLER'), work, 'install', { date: today() });
    work = transitionWorkOrder(user(), work, 'close');
    work = recordPayment(user(), work, { date: today(), amount: 100000 });
    expect(work).toMatchObject({ status: 'INSTALLED', printingCompletedAt: NOW, workshopStartedAt: NOW, closedAt: NOW });
    expect(financials(work).paymentStatus).toBe('PAID');
  });
});

describe('Fechas, medidas y búsqueda', () => {
  it.each([
    ['2026-09-14T15:00:00Z', '2026-09-01', '2026-09-30'],
    ['2026-12-31T15:00:00Z', '2026-12-01', '2026-12-31'],
    ['2024-02-15T15:00:00Z', '2024-02-01', '2024-02-29'],
    ['2026-03-01T02:00:00Z', '2026-02-01', '2026-02-28'],
  ])('el mes calendario inicial incluye su último día: %s', (now, from, to) => {
    vi.setSystemTime(new Date(now));
    expect(currentMonthRange()).toEqual({ from, to });
  });
  it('maneja fechas de Bogotá y no desplaza las fechas sin hora', () => {
    expect(dateOnly('2026-09-14T02:00:00Z')).toBe('2026-09-13');
    expect(dateOnly('2026-09-14')).toBe('2026-09-14');
    expect(today()).toBe('2026-09-14');
    expect(dateOnly('invalid')).toBe('');
  });
  it('distingue años bisiestos y fechas inexistentes', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(dateOnly('2026-02-31')).toBe('');
    expect(formatDate('2026-02-31')).toBe('—');
  });
  it('rango inclusivo considera el día de Bogotá y excluye fechas inválidas', () => {
    const range = { from: '2026-09-01', to: '2026-09-14' };
    expect(inRange('2026-09-01', range)).toBe(true);
    expect(inRange('2026-09-14', range)).toBe(true);
    expect(inRange('2026-09-15T02:00:00Z', range)).toBe(true);
    expect(inRange('2026-09-15T10:00:00Z', range)).toBe(false);
    expect(inRange('2026-02-31', { from: '2026-01-01', to: '2026-12-31' })).toBe(false);
  });
  it('multiplica dimensiones y presenta área a tres decimales', () => {
    expect(areaOf({ material: 'Banner', length: 2.5, width: 1.2 })).toBe(3);
    expect(areaOf({ material: 'Vinilo', length: 1.2345, width: 1 })).toBe(1.235);
    expect(areaOf()).toBe(0);
    expect(MATERIALS).toHaveLength(5);
    expect(CATEGORIES).toHaveLength(4);
  });
  it('formatea medidas sin ceros forzados ni separadores de miles', () => {
    expect(formatMeasure(25)).toBe('25');
    expect(formatMeasure(3.4)).toBe('3.4');
    expect(formatMeasure(85)).toBe('85');
  });
  it('formatea pesos enteros con puntos de miles', () => {
    expect(formatPesosInput('25')).toBe('25');
    expect(formatPesosInput('1000')).toBe('1.000');
    expect(formatPesosInput('15000000')).toBe('15.000.000');
  });
  it('normaliza tildes y mayúsculas sin quitar el número OT', () => {
    expect(normalize('IMPRESIÓN ÁÉÍÓÚ 0001')).toBe('impresion aeiou 0001');
  });
  it('valida nombre de cliente sin exigir contacto opcional', () => {
    expect(() => validateClient({ name: ' ', identification: '', phone: '' })).toThrow(/nombre/);
    expect(() => validateClient({ name: 'Cliente', identification: '', phone: '' })).not.toThrow();
  });
});
