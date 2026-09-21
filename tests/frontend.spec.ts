import { test, expect, type Page } from '@playwright/test';
import { LOCAL_REVIEW_PASSWORD, makeSeed } from '../src/data/seed';
import { areaOf, dateOnly, financials, formatCOP, formatMeasure, formatNumber, today } from '../src/domain/utils';
import type { AppData, WorkOrder } from '../src/domain/types';

// Each test has an isolated browser context; no existing user browser data is changed.
const DATA_KEY = 'intermedios.frontend.v1';
test.beforeEach(async ({ context }) => {
  await context.addInitScript(({ key, data }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, { key: DATA_KEY, data: makeSeed() });
});

async function login(page: Page, email = 'adminmaster@intermedios.local') {
  await page.goto('/login');
  await page.getByLabel('Usuario o correo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(LOCAL_REVIEW_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page.locator('main h1')).toBeVisible();
}

async function storedOrders(page: Page): Promise<WorkOrder[]> {
  return page.evaluate(key => (JSON.parse(localStorage.getItem(key)!) as AppData).orders, DATA_KEY);
}

async function fillOrder(page: Page, _number = 101, route = 'PRINT_WORKSHOP') {
  await page.goto('/orders/new');
  await page.getByLabel('Cliente / Razón social *').selectOption('c-1');
  const product = page.locator('.order-product-card').first();
  await product.getByLabel('Descripción del producto *').fill('Aviso de prueba funcional con producción.');
  await product.getByLabel('Valor unitario antes de IVA (COP) *').fill('100000');
  if (route !== 'WORKSHOP_ONLY') {
    await product.getByRole('checkbox', { name: 'Impresión' }).check();
    await product.getByLabel('Largo (m)').fill('2.5');
    await product.getByLabel('Ancho (m)').fill('1.2');
  }
  if (route !== 'PRINT_ONLY') await product.getByRole('checkbox', { name: 'Taller' }).check();
  await page.getByLabel('Valor recibido (COP) *').fill('10000');
}

async function saveOrder(page: Page) {
  await page.getByRole('button', { name: 'Guardar orden de trabajo', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
  await expect(page.locator('h1')).toContainText('OT #');
}

async function advance(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function addPayment(page: Page, amount: string) {
  await page.getByRole('button', { name: 'Registrar abono o pago', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor del pago (COP) *').fill(amount);
  await dialog.getByRole('button', { name: 'Confirmar y registrar pago' }).click();
  await expect(dialog).toHaveCount(0);
}

test('acceso local: credenciales inválidas, sesión y protección sin sesión', async ({ page }) => {
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Usuario o correo').fill('adminmaster@intermedios.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Contraseña', { exact: true }).fill(LOCAL_REVIEW_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible();
});

test('creación FACT multiproducto: retenciones automáticas, varios materiales y área externa', async ({ page }) => {
  await login(page);
  await fillOrder(page);
  await page.getByRole('radio', { name: /FACT/ }).check();
  await page.locator('.order-product-card').first().getByLabel('Valor unitario antes de IVA (COP) *').fill('600000');
  await page.locator('.order-product-card').first().getByRole('checkbox', { name: 'Diseño' }).check();
  await page.locator('.order-product-card').first().getByRole('button', { name: 'Agregar material' }).click();
  await page.locator('.order-product-card').first().getByLabel('Material 2', { exact: true }).selectOption('Banner');
  await page.locator('.order-product-card').first().getByLabel('Largo (m)').last().fill('1');
  await page.locator('.order-product-card').first().getByLabel('Ancho (m)').last().fill('2');
  await page.getByRole('button', { name: 'Agregar otro producto' }).click();
  const external = page.locator('.order-product-card').last();
  await external.getByLabel('Descripción del producto *').fill('Servicio externo de montaje');
  await external.getByLabel('Valor unitario antes de IVA (COP) *').fill('200000');
  await external.getByRole('checkbox', { name: 'Externo' }).check();
  await expect(external.getByText('Materiales de impresión')).toHaveCount(0);
  await expect(external.getByLabel('Largo del producto (m)')).toHaveCount(0);
  await expect(external.getByLabel('Ancho del producto (m)')).toHaveCount(0);
  await external.getByLabel('Descripción del producto *').fill('');
  await page.getByRole('button', { name: 'Guardar orden de trabajo' }).click();
  await expect(page.getByRole('alert')).toContainText('Producto 2: escribe una descripción.');
  await external.getByLabel('Descripción del producto *').fill('Servicio externo de montaje');
  await saveOrder(page);
  const order = (await storedOrders(page)).at(-1)!;
  expect(order.status).toBe('IN_PRODUCTION');
  expect(order.route).toBe('MULTI_AREA');
  expect(order.products).toHaveLength(2);
  expect(order.products![0].materials).toHaveLength(2);
  expect(financials(order)).toMatchObject({ base: 800000, iva: 152000, retentions: 60400, collectible: 891600, balance: 881600 });
  await expect(page.locator('.order-balance-highlight')).toContainText(formatCOP(881600));
});

test('editor multiproducto y materiales se adapta a 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await login(page);
  await fillOrder(page);
  const first = page.locator('.order-product-card').first();
  await first.getByRole('button', { name: 'Agregar material' }).click();
  await first.getByLabel('Material 2', { exact: true }).selectOption('V. Impresión');
  await first.getByLabel('Largo (m)', { exact: true }).last().fill('1.25');
  await first.getByLabel('Ancho (m)', { exact: true }).last().fill('0.8');
  await page.getByRole('button', { name: 'Agregar otro producto' }).click();
  const second = page.locator('.order-product-card').last();
  await second.getByLabel('Descripción del producto *').fill('Servicio externo con una descripción extensa que debe ajustarse dentro de la tarjeta móvil.');
  await second.getByLabel('Valor unitario antes de IVA (COP) *').fill('250000');
  await second.getByRole('checkbox', { name: 'Externo' }).check();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('varios abonos persisten y no se acepta un pago superior al saldo', async ({ page }) => {
  await login(page);
  await fillOrder(page, 102, 'WORKSHOP_ONLY');
  await expect(page.locator('.order-product-card').getByText('Materiales de impresión')).toHaveCount(0);
  await saveOrder(page);
  await page.getByRole('button', { name: 'Registrar abono o pago', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Valor del pago (COP) *').fill('100.009');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar y registrar pago' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('máximo dos decimales');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await addPayment(page, '30000');
  await addPayment(page, '25000');
  await expect(page.locator('.order-balance-highlight')).toContainText(formatCOP(35000));
  await page.getByRole('button', { name: 'Registrar abono o pago', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor del pago (COP) *').fill('35001');
  await dialog.getByRole('button', { name: 'Confirmar y registrar pago' }).click();
  await expect(dialog.getByRole('alert')).toContainText('El pago no puede superar');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  await expect(page.locator('.order-balance-highlight')).toContainText(formatCOP(35000));
  const order = (await storedOrders(page)).at(-1)!;
  expect(order.payments.map(payment => payment.amount)).toEqual([10000, 30000, 25000]);
  expect(order.printing).toBeUndefined();
  expect(financials(order).iva).toBe(0);
  await addPayment(page, '35000');
  await expect(page.locator('.order-balance-highlight')).toContainText('Pagada');
  await expect(page.getByRole('button', { name: 'Registrar abono o pago', exact: true })).toHaveCount(0);
});

test('orden histórica: instalación y cierre conservan el estado del trabajo', async ({ page }) => {
  await login(page);
  await page.goto('/orders/ot-4');
  await page.getByRole('button', { name: 'Registrar instalación', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Observaciones de instalación', { exact: true }).fill('Instalada según revisión del cliente.');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await advance(page, 'Cerrar orden');
  const order = (await storedOrders(page)).find(item => item.id === 'ot-4')!;
  expect(order.status).toBe('INSTALLED');
  expect(order.closedAt).toBeTruthy();
});

test('ruta solo impresión crea una tarea sin paso por Taller', async ({ page }) => {
  await login(page);
  await fillOrder(page, 104, 'PRINT_ONLY');
  await saveOrder(page);
  const order = (await storedOrders(page)).at(-1)!;
  expect(order.route).toBe('PRINT_ONLY');
  expect(order.products?.[0].activities.map(activity => activity.area)).toEqual(['PRINTING']);
  expect(order.status).toBe('IN_PRODUCTION');
});

test('Diseño crea directamente y no accede a finanzas, impresión ni usuarios', async ({ page }) => {
  await login(page, 'diseno@intermedios.local');
  await expect(page).toHaveURL(/\/design$/);
  await fillOrder(page, 105, 'WORKSHOP_ONLY');
  await saveOrder(page);
  expect((await storedOrders(page)).at(-1)!.status).toBe('IN_PRODUCTION');
  await expect(page.getByRole('heading', { name: 'Control financiero' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enviar a producción' })).toHaveCount(0);
  for (const route of ['/reports', '/portfolio', '/printing', '/settings/users']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible();
  }
});

for (const [email, home, orderId, action, expectedStatus] of [
  ['impresion@intermedios.local', '/printing', 'ot-1', 'Finalizar impresión', 'IN_WORKSHOP'],
  ['taller@intermedios.local', '/workshop', 'ot-2', 'Iniciar taller', 'IN_WORKSHOP'],
] as const) {
  test(`${home}: permisos de operador y actualización de su etapa`, async ({ page }) => {
    await login(page, email);
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByRole('heading', { name: 'Control financiero' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Vista imprimible' })).toHaveCount(0);
    await advance(page, action);
    expect((await storedOrders(page)).find(item => item.id === orderId)!.status).toBe(expectedStatus);
    for (const route of ['/orders/new', '/reports', '/settings/users']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible();
    }
  });
}

test('Administración general no puede administrar usuarios', async ({ page }) => {
  await login(page, 'administracion@intermedios.local');
  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible();
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible();
});

test('directorio: nuevo cliente disponible al crear una OT', async ({ page }) => {
  await login(page);
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre o razón social').fill('Cliente e2e Café');
  await dialog.getByLabel('NIT o identificación').fill('TEST-101');
  await dialog.getByLabel('Celular *').fill('3000000000');
  await dialog.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/orders/new');
  await expect(page.getByLabel('Cliente / Razón social *').locator('option')).toContainText(['Cliente e2e Café · TEST-101']);
});

test('clientes: exige celular y conserva la condición Especial', async ({ page }) => {
  await login(page);
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre o razón social *').fill('Cliente Especial e2e');
  await dialog.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Celular *').fill('3102223344');
  await dialog.getByLabel('Cliente Especial: permite crear una OT sin abono inicial.').check();
  await dialog.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cliente Especial e2e' }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Cliente Especial e2e' }).first()).toBeVisible();
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).clients as Array<{name: string; phone: string; specialPayment?: boolean}>, DATA_KEY);
  expect(stored.find(client => client.name === 'Cliente Especial e2e')).toMatchObject({ phone: '3102223344', specialPayment: true });
});

test('Diseño consulta historial de clientes sin indicadores ni saldos de cobro', async ({ page }) => {
  await login(page, 'diseno@intermedios.local');
  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Directorio de clientes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Clientes', exact: true })).toBeVisible();
  await expect(page.getByText('Clientes con cartera')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Saldo pendiente' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Con saldo pendiente' })).toHaveCount(0);
  await page.goto('/clients/c-1');
  await expect(page.getByRole('heading', { name: 'Órdenes de trabajo' })).toBeVisible();
  await expect(page.getByText('Pagos recibidos')).toHaveCount(0);
  await expect(page.getByText('Órdenes registradas')).toHaveCount(0);
  await expect(page.getByText('Saldo pendiente')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Saldo' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Con saldo pendiente' })).toHaveCount(0);
});

test('reportes: filtros por categoría/documento y cuatro tipos de período', async ({ page }) => {
  await login(page);
  await page.goto('/reports');
  await page.getByLabel('Categoría', { exact: true }).selectOption('SuperGiros');
  await page.getByLabel('Documento', { exact: true }).selectOption('FACT');
  await page.getByRole('button', { name: 'Día', exact: true }).click();
  await page.getByLabel('Fecha del reporte').fill(today());
  const source = makeSeed().orders.filter(order => order.category === 'SuperGiros' && order.documentType === 'FACT' && order.createdAt.slice(0, 10) === today());
  const total = source.reduce((sum, order) => sum + order.value, 0);
  await expect(page.locator('.kpi-card').filter({ hasText: 'Ventas · valor base' })).toContainText(formatCOP(total));
  await page.getByRole('button', { name: 'Mes', exact: true }).click();
  await page.getByLabel('Mes del reporte').fill('2000-01');
  await expect(page.locator('.kpi-card').filter({ hasText: 'Ventas · valor base' })).toContainText(formatCOP(0));
  await page.getByRole('button', { name: 'Rango de fechas', exact: true }).click();
  await page.getByLabel('Hasta', { exact: true }).fill(today());
  await page.getByLabel('Desde', { exact: true }).fill('2000-01-01');
  await expect(page.locator('.kpi-card').filter({ hasText: 'Ventas · valor base' })).not.toContainText('0 órdenes');
  await page.getByRole('button', { name: 'Rango de meses', exact: true }).click();
  await expect(page.getByLabel('Desde', { exact: true })).toHaveAttribute('type', 'month');
  await page.getByLabel('Desde', { exact: true }).fill('2000-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2000-02');
  await expect(page.locator('.kpi-card').filter({ hasText: 'Ventas · valor base' })).toContainText(formatCOP(0));
});

test('ficha imprimible: contenido financiero coherente y sin navegación al imprimir', async ({ page }) => {
  await login(page);
  await page.goto('/orders/ot-1/print');
  const sheet = page.getByRole('article', { name: 'Ficha imprimible de orden 1' });
  await expect(sheet).toContainText(formatCOP(1391500));
  await expect(sheet).toContainText('No constituye una factura electrónica');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-sidebar')).toBeHidden();
  await expect(page.locator('.app-topbar')).toBeHidden();
  await expect(page.locator('.data-refresh-strip')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Imprimir orden' })).toBeHidden();
  await expect(sheet).toBeVisible();
});

test('búsqueda global consecutiva y filtros de trabajo/pago REM y FACT', async ({ page }) => {
  await login(page);
  await page.getByLabel('Buscar una orden', { exact: true }).fill('0001');
  await page.getByRole('button', { name: 'Realizar búsqueda' }).click();
  await expect(page.getByLabel('Buscar órdenes', { exact: true })).toHaveValue('0001');
  await expect(page.getByRole('link', { name: 'OT #0001', exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByLabel('Buscar una orden', { exact: true }).fill('0002');
  await page.getByRole('button', { name: 'Realizar búsqueda' }).click();
  await expect(page.getByLabel('Buscar órdenes', { exact: true })).toHaveValue('0002');
  await expect(page.getByRole('link', { name: 'OT #0002', exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
  await page.getByLabel('Estado del trabajo', { exact: true }).selectOption('PENDING_ADMIN_REVIEW');
  await page.getByLabel('Documento', { exact: true }).selectOption('FACT');
  await page.getByLabel('Estado de pago', { exact: true }).selectOption('PENDING');
  await expect(page.getByRole('link', { name: 'OT #0003', exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByLabel('Documento', { exact: true }).selectOption('REM');
  await expect(page.getByRole('link', { name: 'OT #0011', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'OT #0003', exact: true })).toHaveCount(0);
});

test('materiales: impresión en cola no suma; finalizar añade sus m² una sola vez', async ({ page }) => {
  await login(page);
  await page.goto('/materials');
  await page.getByRole('button', { name: 'Día', exact: true }).click();
  await page.getByLabel('Material', { exact: true }).selectOption('Panaflex');
  const before = makeSeed().orders.filter(order => order.printing?.material === 'Panaflex' && order.printingCompletedAt && dateOnly(order.printingCompletedAt) === today()).reduce((sum, order) => sum + areaOf(order.printing), 0);
  await expect(page.locator('.analytics-material-banner')).toContainText(`${formatMeasure(before)} m²`);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await login(page, 'impresion@intermedios.local');
  await page.goto('/orders/ot-1');
  await advance(page, 'Finalizar impresión');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await login(page);
  await page.goto('/materials');
  await page.getByRole('button', { name: 'Día', exact: true }).click();
  await page.getByLabel('Material', { exact: true }).selectOption('Panaflex');
  await expect(page.locator('.analytics-material-banner')).toContainText(`${formatMeasure(before + 3)} m²`);
  await page.reload();
  await page.getByRole('button', { name: 'Día', exact: true }).click();
  await page.getByLabel('Material', { exact: true }).selectOption('Panaflex');
  await expect(page.locator('.analytics-material-banner')).toContainText(`${formatMeasure(before + 3)} m²`);
});

test('usuarios: alta local, duplicado, cancelar y protección de la cuenta propia', async ({ page }) => {
  await login(page);
  await page.goto('/settings/users');
  await page.getByRole('button', { name: 'Nuevo usuario', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Operador e2e');
  await dialog.getByLabel('Correo', { exact: true }).fill('operador.e2e@intermedios.local');
  await dialog.getByLabel('Perfil', { exact: true }).selectOption('IMPRESION');
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.kpi-card').filter({ hasText: 'Usuarios activos' })).toContainText('6 / 15');
  await page.getByRole('button', { name: 'Nuevo usuario', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Duplicado');
  await dialog.getByLabel('Correo', { exact: true }).fill('operador.e2e@intermedios.local');
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('.kpi-card').filter({ hasText: 'Usuarios activos' })).toContainText('6 / 15');
  await page.getByRole('row').filter({ hasText: 'adminmaster@intermedios.local' }).getByRole('button', { name: 'Editar', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Usuario activo' }).uncheck();
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
});

test('menú móvil accesible: foco contenido, Escape y navegación', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const toggle = page.getByRole('button', { name: 'Abrir menú' });
  await toggle.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole('dialog').getByRole('link', { name: 'Cartera', exact: true }).click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Cartera', exact: true })).toBeVisible();
});

test('regresión móvil: nombre de cliente de 115 caracteres sin espacios no desborda', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/clients/c-1');
  await page.getByRole('button', { name: 'Editar cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const longName = 'ClienteConNombreExtenso'.repeat(5);
  expect(longName.length).toBe(115);
  await dialog.getByLabel('Nombre o razón social').fill(longName);
  await dialog.getByRole('button', { name: 'Guardar cliente', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible();
  for (const route of ['/clients/c-1', '/clients', '/orders/ot-1', '/orders/new', '/portfolio', '/operation', '/printing']) {
    await page.goto(route);
    await expect(page.locator('main h1')).toBeVisible();
    if (route === '/orders/new') await page.getByLabel('Cliente / Razón social *').selectOption('c-1');
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
    expect(dimensions.body, `${route}: nombre largo en body`).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.document, `${route}: nombre largo en documento`).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
});

test('límite de 15 usuarios activos y rechazo del acceso de una cuenta inactiva', async ({ page }) => {
  await login(page);
  await page.goto('/settings/users');
  for (let index = 1; index <= 10; index++) {
    await page.getByRole('button', { name: 'Nuevo usuario', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nombre', { exact: true }).fill(`Operador de prueba ${index}`);
    await dialog.getByLabel('Correo', { exact: true }).fill(`limite${index}@intermedios.local`);
    await dialog.getByLabel('Perfil', { exact: true }).selectOption('TALLER');
    await dialog.getByRole('button', { name: 'Guardar usuario', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.locator('.kpi-card').filter({ hasText: 'Usuarios activos' })).toContainText('15 / 15');
  await page.getByRole('button', { name: 'Nuevo usuario', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre', { exact: true }).fill('Usuario dieciséis');
  await dialog.getByLabel('Correo', { exact: true }).fill('limite16@intermedios.local');
  await dialog.getByRole('button', { name: 'Guardar usuario', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('15');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'limite10@intermedios.local' }).getByRole('button', { name: 'Editar', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Usuario activo' }).uncheck();
  await dialog.getByRole('button', { name: 'Guardar usuario', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.kpi-card').filter({ hasText: 'Usuarios activos' })).toContainText('14 / 15');
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Usuario o correo', { exact: true }).fill('limite10@intermedios.local');
  await page.getByLabel('Contraseña', { exact: true }).fill(LOCAL_REVIEW_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar al sistema', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Usuario o contraseña incorrectos');
  await expect(page).toHaveURL(/\/login$/);
});

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`responsive ${width}px: navegación y pantallas sin desbordamiento horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const routes = ['/', '/orders', '/orders/new', '/orders/ot-1', '/clients', '/clients/c-1', '/operation', '/portfolio', '/reports', '/materials', '/design', '/printing', '/workshop', '/settings/users'];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('main h1')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
      expect(dimensions.body, `${route}: body at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
      expect(dimensions.document, `${route}: document at ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
      await expect(page.getByText('No pudimos abrir esta pantalla', { exact: true })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
