import { test, expect, type Page } from '@playwright/test';
import { DEMO_PASSWORD, makeSeed } from '../src/data/seed';
import { areaOf, dateOnly, financials, formatCOP, formatNumber, today } from '../src/domain/utils';
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
  await page.getByLabel('Contraseña', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.locator('main h1')).toBeVisible();
}

async function storedOrders(page: Page): Promise<WorkOrder[]> {
  return page.evaluate(key => (JSON.parse(localStorage.getItem(key)!) as AppData).orders, DATA_KEY);
}

async function fillOrder(page: Page, number = 101, route = 'PRINT_WORKSHOP') {
  await page.goto('/orders/new');
  await page.getByLabel('Número de OT *', { exact: true }).fill(String(number));
  await page.getByLabel('Cliente / Razón social *').selectOption('c-1');
  await page.getByLabel('Descripción del trabajo *').fill('Aviso de prueba funcional con impresión e instalación.');
  await page.getByLabel('Valor del trabajo antes de IVA (COP) *').fill('100000');
  await page.locator(`input[name="route"][value="${route}"]`).check();
  if (route !== 'WORKSHOP_ONLY') {
    await page.getByLabel('Largo (m) *').fill('2.5');
    await page.getByLabel('Ancho (m) *').fill('1.2');
  }
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
  await page.getByLabel('Contraseña', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible();
});

test('creación FACT: IVA adicional, retenciones manuales, área y validaciones', async ({ page }) => {
  await login(page);
  await fillOrder(page);
  await page.getByRole('radio', { name: /Facturación/ }).check();
  await page.getByLabel('RETE FUENTE', { exact: true }).fill('1000');
  await page.getByLabel('RETE IVA 15', { exact: true }).fill('200');
  await page.getByLabel('ICA 7 × 1000', { exact: true }).fill('300');
  await page.getByLabel('Valor del trabajo antes de IVA (COP) *').fill('');
  await page.getByRole('button', { name: 'Guardar orden de trabajo' }).click();
  await expect(page.getByText('El valor es obligatorio y debe ser mayor que cero.', { exact: true })).toBeVisible();
  await page.getByLabel('Valor del trabajo antes de IVA (COP) *').fill('0');
  await page.getByRole('button', { name: 'Guardar orden de trabajo' }).click();
  await expect(page.getByText('El valor es obligatorio y debe ser mayor que cero.', { exact: true })).toBeVisible();
  await page.getByLabel('Valor del trabajo antes de IVA (COP) *').fill('100000');
  await page.getByLabel('Número de OT *', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Guardar orden de trabajo' }).click();
  await expect(page.getByText('Este número de OT ya está registrado.', { exact: true })).toBeVisible();
  await page.getByLabel('Número de OT *', { exact: true }).fill('101');
  await expect(page.locator('.order-area-result')).toContainText('3,000 m²');
  await saveOrder(page);
  const order = (await storedOrders(page)).find(item => item.number === 101)!;
  expect(order.status).toBe('NEW');
  expect(order.printing).toEqual({ material: 'Panaflex', length: 2.5, width: 1.2 });
  expect(financials(order)).toMatchObject({ iva: 19000, gross: 119000, retentions: 1500, collectible: 117500 });
  await expect(page.locator('.order-balance-highlight')).toContainText(formatCOP(117500));
});

test('varios abonos persisten y no se acepta un pago superior al saldo', async ({ page }) => {
  await login(page);
  await fillOrder(page, 102, 'WORKSHOP_ONLY');
  await expect(page.getByLabel('Largo (m) *')).toHaveCount(0);
  await saveOrder(page);
  await page.getByRole('button', { name: 'Registrar abono o pago', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Valor del pago (COP) *').fill('100.009');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar y registrar pago' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('máximo dos decimales');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await addPayment(page, '30000');
  await addPayment(page, '25000');
  await expect(page.locator('.order-balance-highlight')).toContainText(formatCOP(45000));
  await page.getByRole('button', { name: 'Registrar abono o pago', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Valor del pago (COP) *').fill('45001');
  await dialog.getByRole('button', { name: 'Confirmar y registrar pago' }).click();
  await expect(dialog.getByRole('alert')).toContainText('El pago no puede superar');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.reload();
  await expect(page.locator('.order-balance-highlight')).toContainText(formatCOP(45000));
  const order = (await storedOrders(page)).find(item => item.number === 102)!;
  expect(order.payments.map(payment => payment.amount)).toEqual([30000, 25000]);
  expect(order.printing).toBeUndefined();
  expect(financials(order).iva).toBe(0);
  await addPayment(page, '45000');
  await expect(page.locator('.order-balance-highlight')).toContainText('Pagada');
  await expect(page.getByRole('button', { name: 'Registrar abono o pago', exact: true })).toHaveCount(0);
});

test('flujo impresión, taller, instalación y cierre conserva la cartera pendiente', async ({ page }) => {
  await login(page);
  await fillOrder(page, 103);
  await page.getByRole('checkbox', { name: /requiere instalación/ }).check();
  await saveOrder(page);
  await advance(page, 'Aprobar y enviar');
  expect((await storedOrders(page)).find(item => item.number === 103)!.status).toBe('IN_PRINTING');
  await advance(page, 'Finalizar impresión');
  expect((await storedOrders(page)).find(item => item.number === 103)!.printingCompletedAt).toBeTruthy();
  await advance(page, 'Iniciar taller');
  await advance(page, 'Finalizar taller');
  expect((await storedOrders(page)).find(item => item.number === 103)!.status).toBe('PENDING_INSTALLATION');
  await page.getByRole('button', { name: 'Registrar instalación', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Observaciones de instalación', { exact: true }).fill('Instalada según revisión del cliente.');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await advance(page, 'Cerrar orden');
  const order = (await storedOrders(page)).find(item => item.number === 103)!;
  expect(order.status).toBe('INSTALLED');
  expect(order.closedAt).toBeTruthy();
  expect(financials(order).balance).toBe(100000);
  await page.goto('/portfolio');
  await page.getByRole('searchbox').fill('0103');
  await expect(page.getByRole('link', { name: 'OT #0103', exact: true }).filter({ visible: true })).toBeVisible();
});

test('ruta solo impresión finaliza sin pasar por taller', async ({ page }) => {
  await login(page);
  await fillOrder(page, 104, 'PRINT_ONLY');
  await saveOrder(page);
  await advance(page, 'Aprobar y enviar');
  await advance(page, 'Finalizar impresión');
  expect((await storedOrders(page)).find(item => item.number === 104)!.status).toBe('COMPLETED');
  await expect(page.getByRole('button', { name: 'Iniciar taller' })).toHaveCount(0);
});

test('Diseño crea para revisión y no accede a finanzas, impresión ni usuarios', async ({ page }) => {
  await login(page, 'diseno@intermedios.local');
  await expect(page).toHaveURL(/\/design$/);
  await fillOrder(page, 105, 'WORKSHOP_ONLY');
  await saveOrder(page);
  expect((await storedOrders(page)).find(item => item.number === 105)!.status).toBe('PENDING_ADMIN_REVIEW');
  await expect(page.getByRole('heading', { name: 'Control financiero' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aprobar y enviar' })).toHaveCount(0);
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
  await dialog.getByLabel('Teléfono', { exact: true }).fill('3000000000');
  await dialog.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/orders/new');
  await expect(page.getByLabel('Cliente / Razón social *').locator('option')).toContainText(['Cliente e2e Café · TEST-101']);
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
  await expect(page.locator('.demo-strip')).toBeHidden();
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
  await expect(page.locator('.analytics-material-banner')).toContainText(`${formatNumber(before, 3)} m²`);
  await page.goto('/orders/ot-1');
  await advance(page, 'Finalizar impresión');
  await page.goto('/materials');
  await page.getByRole('button', { name: 'Día', exact: true }).click();
  await page.getByLabel('Material', { exact: true }).selectOption('Panaflex');
  await expect(page.locator('.analytics-material-banner')).toContainText(`${formatNumber(before + 3, 3)} m²`);
  await page.reload();
  await page.getByRole('button', { name: 'Día', exact: true }).click();
  await page.getByLabel('Material', { exact: true }).selectOption('Panaflex');
  await expect(page.locator('.analytics-material-banner')).toContainText(`${formatNumber(before + 3, 3)} m²`);
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
  await page.getByLabel('Contraseña', { exact: true }).fill(DEMO_PASSWORD);
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
