import type { AppData, WorkOrder, WorkStatus } from '../domain/types';
import { CATEGORIES, MATERIALS, financials, today } from '../domain/utils';

export const LOCAL_REVIEW_PASSWORD = 'Intermedios2026!';
export function makeSeed(): AppData {
  const date = today();
  const day = Number(date.slice(-2));
  const at = (ago: number) => {
    const d = new Date(`${date}T12:00:00-05:00`);
    d.setUTCDate(d.getUTCDate() - ago);
    return d.toISOString();
  };
  const users: AppData['users'] = [
    { id: 'u-master', name: 'Carlos Mendoza', email: 'adminmaster@intermedios.local', role: 'ADMINMASTER', active: true },
    { id: 'u-admin', name: 'Laura Ramírez', email: 'administracion@intermedios.local', role: 'ADMIN_GENERAL', active: true },
    { id: 'u-design', name: 'Sofía López', email: 'diseno@intermedios.local', role: 'DISENO', active: true },
    { id: 'u-print', name: 'Juan Pérez', email: 'impresion@intermedios.local', role: 'IMPRESION', active: true },
    { id: 'u-workshop', name: 'Andrés Torres', email: 'taller@intermedios.local', role: 'TALLER', active: true },
  ];
  const clients: AppData['clients'] = [
    { id: 'c-1', name: 'SuperGiros S.A.', identification: '900.123.001-1', phone: '300 555 0101', createdAt: at(90) },
    { id: 'c-2', name: 'Constructora Horizonte', identification: '900.123.002-2', phone: '300 555 0102', createdAt: at(75) },
    { id: 'c-3', name: 'Café Origen', identification: '900.123.003-3', phone: '300 555 0103', createdAt: at(60) },
    { id: 'c-4', name: 'Centro Comercial Alameda', identification: '900.123.004-4', phone: '300 555 0104', createdAt: at(45) },
    { id: 'c-5', name: 'Droguería Bienestar', identification: '900.123.005-5', phone: '300 555 0105', createdAt: at(30) },
    { id: 'c-6', name: 'Estudio Norte', identification: '', phone: '', createdAt: at(5) },
  ];
  const descriptions = ['Aviso luminoso para fachada principal · sede Centro', 'Señalización interior y directorio de oficinas', 'Rotulación de vitrinas y acceso principal', 'Carro valla para campaña de lanzamiento', 'Pendones publicitarios para punto de venta', 'Letras corpóreas para recepción', 'Campaña de apertura · impresión de vinilo', 'Señalética de parqueaderos', 'Banner de gran formato para fachada', 'Renovación de imagen del local', 'Vinilo de corte para ventanas', 'Aviso para nueva sucursal', 'Estructura publicitaria de acceso', 'Material promocional de temporada'];
  const statuses: WorkStatus[] = ['IN_PRINTING','IN_WORKSHOP','PENDING_ADMIN_REVIEW','PENDING_INSTALLATION','COMPLETED','NEW','IN_PRINTING','INSTALLED','IN_WORKSHOP','COMPLETED','PENDING_ADMIN_REVIEW','COMPLETED','INSTALLED','COMPLETED'];
  const orders: WorkOrder[] = descriptions.map((description, i) => {
    const route = i % 4 === 1 ? 'WORKSHOP_ONLY' : i % 4 === 2 ? 'PRINT_ONLY' : 'PRINT_WORKSHOP';
    const status = statuses[i];
    const age = i < 9 ? Math.min(i, Math.max(day - 1, 0)) : 30 + i * 3;
    const createdAt = at(age);
    const order: WorkOrder = {
      id: `ot-${i + 1}`, number: i + 1, clientId: clients[i % 5].id, description,
      value: [2850000,1450000,540000,6800000,960000,2150000,3250000,4200000,1850000,780000,1200000,5600000,3100000,450000][i],
      documentType: i % 3 === 1 ? 'REM' : 'FACT', category: CATEGORIES[i % 4], route,
      requiresInstallation: ['PENDING_INSTALLATION','INSTALLED'].includes(status) || i === 0,
      status, createdBy: i % 2 === 0 ? 'u-design' : 'u-admin', createdAt, updatedAt: at(Math.max(age - 1, 0)),
      printing: route === 'WORKSHOP_ONLY' ? undefined : { material: MATERIALS[i % MATERIALS.length], length: [2.5,4,1.2,4,1,2][i % 6], width: [1.2,2,0.8,2,0.7][i % 5] },
      reteFuente: 0, reteIva: 0, ica: 0, payments: [],
    };
    if (order.printing && ['IN_WORKSHOP','PENDING_INSTALLATION','COMPLETED','INSTALLED'].includes(status)) order.printingCompletedAt = at(Math.max(age - 1, 0));
    if (status === 'INSTALLED') { order.installedAt = at(Math.max(age - 1, 0)); order.installationNote = 'Instalación finalizada en el punto acordado.'; }
    const total = financials(order).collectible;
    if (i === 0) order.payments = [{ id: 'p-1', date: createdAt.slice(0,10), amount: 1500000, recordedBy: 'u-admin' }, { id: 'p-2', date, amount: 500000, recordedBy: 'u-admin' }];
    else if (i % 4 !== 2 && status !== 'NEW') order.payments = [{ id: `p-${i + 3}`, date: at(Math.max(age - 1, 0)).slice(0,10), amount: i % 4 === 3 ? total : Math.round(total * .4), recordedBy: 'u-admin' }];
    if (i === 7) order.closedAt = order.updatedAt;
    return order;
  });
  return { version: 1, users, clients, orders };
}
