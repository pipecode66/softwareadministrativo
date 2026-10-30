import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { dateOnly, formatCOP } from '../src/domain/utils';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Usuario o correo').fill('api-e2e@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('Una clave E2E segura 2026!');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function selectOrderClient(page: Page, query: string, optionName: string | RegExp) {
  const picker = page.getByRole('combobox', { name: 'Buscar y seleccionar cliente *' });
  await picker.fill(query);
  const results = page.getByRole('listbox', { name: 'Resultados de clientes' });
  await expect(results).toBeVisible();
  const option = results.getByRole('option', { name: optionName });
  await expect(option).toBeVisible();
  await option.click();
  await expect(results).toHaveCount(0);
}

async function createClient(page: Page, name: string, identification: string) {
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre o razón social *').fill(name);
  await dialog.getByLabel('NIT o identificación').fill(identification);
  await dialog.getByLabel('Celular *').fill('3001234567');
  const response = page.waitForResponse(item => item.url().endsWith('/api/v1/clients') && item.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Guardar cliente' }).click();
  expect((await response).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
}

test('sesión real carga reportes desde el servidor', async ({ page }) => {
  await login(page);

  const reportResponse = page.waitForResponse(response => response.url().includes('/api/v1/reports/sales') && response.request().method() === 'GET');
  await page.goto('/reports');
  await expect((await reportResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible();
  await expect(page.getByText('Ventas totales')).toBeVisible();
});

test('perfil muestra acciones de contraseña y salida, y permite revisar lo digitado', async ({ page }) => {
  await login(page);
  const actions = page.locator('.app-sidebar .sidebar-profile-actions');
  const passwordLink = actions.getByRole('link', { name: 'Cambiar contraseña' });
  const logoutButton = actions.getByRole('button', { name: 'Cerrar sesión' });
  await expect(passwordLink).toBeVisible();
  await expect(logoutButton).toBeVisible();
  await expect(passwordLink).toHaveCSS('background-color', 'rgb(194, 65, 12)');
  await expect(logoutButton).toHaveCSS('background-color', 'rgb(194, 65, 12)');
  await expect(passwordLink).toHaveCSS('border-top-color', 'rgb(17, 24, 39)');
  await expect(logoutButton).toHaveCSS('border-top-color', 'rgb(17, 24, 39)');
  await passwordLink.click();
  await expect(page).toHaveURL(/\/change-password$/);
  const currentPassword = page.getByLabel('Contraseña actual', { exact: true });
  await currentPassword.fill('Una clave E2E segura 2026!');
  await expect(currentPassword).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Mostrar contraseña actual' }).click();
  await expect(currentPassword).toHaveAttribute('type', 'text');
  await expect(currentPassword).toHaveValue('Una clave E2E segura 2026!');
  await page.getByRole('button', { name: 'Ocultar contraseña actual' }).click();
  await expect(currentPassword).toHaveAttribute('type', 'password');
});

test('sesión real crea cliente y OT compuesta con abono y cálculo FACT', async ({ page }) => {
  await login(page);
  await createClient(page, 'Cliente integración API', 'NIT-E2E-2026');

  await page.goto('/orders/new');
  await selectOrderClient(page, 'NIT-E2E-2026', /Cliente integración API/);
  await page.getByRole('radio', { name: /FACT/ }).check();
  const product = page.locator('.order-product-card').first();
  await product.getByLabel('Descripción del producto *').fill('Aviso compuesto de integración');
  await product.getByLabel('Valor unitario antes de IVA (COP) *').fill('600000');
  await product.getByRole('checkbox', { name: 'Diseño' }).check();
  await product.getByRole('checkbox', { name: 'Impresión' }).check();
  await product.getByRole('button', { name: 'Agregar material' }).click();
  await product.getByLabel('Largo (m)').fill('2');
  await product.getByLabel('Ancho (m)').fill('1.5');
  await page.getByLabel('Valor recibido (COP) *').fill('100000');
  await page.getByLabel('Medio de pago').selectOption('BANCOLOMBIA');
  const orderResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/orders') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Guardar orden de trabajo', exact: true }).click();
  const created = await orderResponse;
  expect(created.status()).toBe(201);
  const payload = await created.json();
  expect(payload.order).toMatchObject({ number: 1, status: 'IN_PRODUCTION', financialRule: 'NEW',
    reteFuente: 24000, reteIva: 17100, ica: 4200,
    payments: [{ amount: 100000, method: 'BANCOLOMBIA' }],
    financials: { base: 600000, iva: 114000, collectible: 668700, balance: 568700 },
  });
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: 'Productos y actividades' })).toBeVisible();
  await expect(page.getByText('Bancolombia', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1. Aviso compuesto de integración' })).toBeVisible();

  await page.getByRole('link', { name: 'Editar OT' }).click();
  await page.getByRole('radio', { name: 'REM', exact: true }).check();
  const editResponse = page.waitForResponse(response => response.url().includes('/api/v1/orders/') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  const edited = await editResponse;
  expect(edited.status()).toBe(200);
  expect((await edited.json()).order).toMatchObject({
    documentType: 'REM', reteFuente: 0, reteIva: 0, ica: 0,
    certificates: { reteFuente: false, reteIva: false, ica: false },
    financials: { iva: 0, retentions: 0, collectible: 600000, balance: 500000 },
  });
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
  await expect(page.getByText('REM', { exact: true }).first()).toBeVisible();
});

test('corte láser registra minutos, exige el tiempo y actualiza base e IVA', async ({ page }) => {
  await login(page);
  await createClient(page, 'Cliente corte láser API', 'NIT-LASER-E2E');
  await page.goto('/orders/new');
  await selectOrderClient(page, 'NIT-LASER-E2E', /Cliente corte láser API/);
  await page.getByRole('radio', { name: /FACT/ }).check();
  const product = page.locator('.order-product-card').first();
  await product.getByLabel('Descripción del producto *').fill('Corte láser de integración');
  await product.getByRole('checkbox', { name: 'Impresión' }).check();
  await product.getByRole('radio', { name: 'Corte láser' }).check();
  const orderResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/orders') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Guardar orden de trabajo', exact: true }).click();
  expect((await orderResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
  const activity = page.locator('.order-activity-row', { hasText: 'Corte láser' });
  await activity.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await activity.getByLabel('Minutos de corte láser').fill('5');
  await activity.getByRole('button', { name: 'Guardar minutos', exact: true }).click();
  await expect(activity.getByRole('button', { name: 'Finalizar', exact: true })).toBeEnabled();
  await activity.getByRole('button', { name: 'Finalizar', exact: true }).click();
  const finance = page.locator('.order-financial-list');
  await expect(finance).toContainText('Valor del trabajo$ 5.000');
  await expect(finance).toContainText('IVA 19 %+ $ 950');
  await expect(finance).toContainText('Total por cobrar$ 5.950');
});

test('carga de Diseño separa responsables y métricas sin desbordarse', async ({ page }) => {
  await login(page);
  await createClient(page, 'Cliente diseño API', 'NIT-DESIGN-E2E');
  await page.goto('/settings/users');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Diseñadora E2E');
  await dialog.getByLabel('Correo').fill('diseno-e2e@example.test');
  await dialog.getByLabel('Perfil').selectOption('DISENO');
  await dialog.getByLabel('Contraseña temporal').fill('Clave segura E2E 2026!');
  const userResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/users') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Guardar usuario' }).click();
  expect((await userResponse).status()).toBe(201);

  for (const width of [670, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const loadResponse = page.waitForResponse(response => response.url().includes('/api/v1/work/designers/load') && response.request().method() === 'GET');
    await page.goto('/operation');
    expect((await loadResponse).status()).toBe(200);
    const panel = page.locator('.ops-designer-load');
    const designer = panel.locator('.ops-designer-card', { hasText: 'Diseñadora E2E' });
    await expect(designer).toBeVisible();
    await expect(designer.getByText('Pendientes')).toBeVisible();
    await expect(designer.getByText('En proceso')).toBeVisible();
    expect(await designer.evaluate(element => getComputedStyle(element).display)).toBe('grid');
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  }

  await page.goto('/orders/new');
  await selectOrderClient(page, 'NIT-DESIGN-E2E', /Cliente diseño API/);
  const product = page.locator('.order-product-card').first();
  await product.getByLabel('Descripción del producto *').fill('Actividad de diseño responsive');
  await product.getByLabel('Valor unitario antes de IVA (COP) *').fill('100000');
  await product.getByRole('checkbox', { name: 'Diseño' }).check();
  await product.getByRole('checkbox', { name: 'Impresión' }).check();
  await product.getByLabel('Asignar diseñador').selectOption({ label: 'Diseñadora E2E' });
  await page.getByLabel('Valor recibido (COP) *').fill('10000');
  await page.getByRole('button', { name: 'Guardar orden de trabajo', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
  for (const width of [670, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/design');
    const card = page.locator('.ops-activity-card', { hasText: 'Actividad de diseño responsive' });
    await expect(card).toBeVisible();
    expect(await card.evaluate(element => getComputedStyle(element).display)).toBe('grid');
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, document: document.documentElement.scrollWidth }));
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.getByLabel('Usuario o correo').fill('diseno-e2e@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('Clave segura E2E 2026!');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Contraseña actual', { exact: true }).fill('Clave segura E2E 2026!');
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('Clave nueva E2E segura 2026!');
  await page.getByLabel('Confirmar nueva contraseña').fill('Clave nueva E2E segura 2026!');
  await page.getByRole('button', { name: 'Guardar nueva contraseña' }).click();
  await expect(page).toHaveURL(/\/design$/);
  const assigned = page.locator('.ops-activity-card', { hasText: 'Actividad de diseño responsive' });
  await assigned.getByRole('button', { name: 'Editar trabajo' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Editar información del trabajo' });
  await editDialog.getByLabel('Descripción del trabajo *').fill('Actividad de diseño corregida');
  await editDialog.getByRole('button', { name: 'Agregar material' }).click();
  await editDialog.getByLabel('Material 1', { exact: true }).selectOption('Banner');
  await editDialog.getByLabel('Largo (m)').fill('2');
  await editDialog.getByLabel('Ancho (m)').fill('1.5');
  await editDialog.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(editDialog).toHaveCount(0);
  const corrected = page.locator('.ops-activity-card', { hasText: 'Actividad de diseño corregida' });
  await expect(corrected).toContainText(/Banner · 2 × 1[,.]5 m · 3 m²/);
  await corrected.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await corrected.getByRole('button', { name: 'Finalizar', exact: true }).click();
  await expect(corrected).toContainText('Terminada');
});

test('reportes y desgloses consultan las OT reales aunque el listado local esté vacío', async ({ page }) => {
  let emptyOrderLists = 0;
  await page.route(url => url.pathname === '/api/v1/orders', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    emptyOrderLists++;
    await route.fulfill({ json: { items: [], clients: [], total: 0, page: 1, pageSize: 100 } });
  });
  await login(page);
  const sessionResponse = await page.request.get('/api/v1/auth/session');
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();
  const headers = { Origin: 'http://127.0.0.1:5174', 'X-CSRF-Token': session.csrfToken };
  const clientResponse = await page.request.post('/api/v1/clients', { headers, data: {
    name: 'Cliente reportes sin listado local', identification: `REPORT-${randomUUID()}`, phone: '3001234567',
  } });
  expect(clientResponse.status(), await clientResponse.text()).toBe(201);
  const { client } = await clientResponse.json();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let retainedFact: { id: string; number: number } | undefined;
  for (const [documentType, value, received] of [['FACT', 600000, 100000], ['FACT', 150000, 178500], ['REM', 200000, 50000]] as const) {
    const description = `Trabajo ${documentType} de ${value} para reporte remoto`;
    const created = await page.request.post('/api/v1/orders', { headers, data: {
      clientId: client.id, description, value, documentType, category: 'SuperGiros',
      route: 'WORKSHOP_ONLY', requiresInstallation: false, requestId: randomUUID(),
      products: [{ description, quantity: 1, unitValue: value, materials: [], activities: [{ area: 'WORKSHOP' }] }],
      initialPayment: { date: today, amount: received, method: 'EFECTIVO' },
    } });
    expect(created.status(), await created.text()).toBe(201);
    const result = await created.json();
    if (documentType === 'FACT' && value === 600000) retainedFact = result.order;
  }
  const initialReport = page.waitForResponse(response => response.url().includes('/api/v1/reports/sales') && response.status() === 200);
  await page.goto('/reports');
  await initialReport;
  const filteredReport = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/reports/sales' && url.searchParams.get('category') === 'SuperGiros' && !url.searchParams.has('documentType');
  });
  await page.getByLabel('Categoría', { exact: true }).selectOption('SuperGiros');
  const reportResponse = await filteredReport;
  expect(reportResponse.status()).toBe(200);
  const report = await reportResponse.json();
  expect(report.totals).toMatchObject({ base: 950000, iva: 142500, received: 328500, factGross: 892500, salesNet: 1047200,
    balanceRem: 150000, balanceFact: 568700, balanceWithIva: 718700,
    balanceWithoutIva: 604700, pendingRetentions: 45300, portfolioAtCutoff: 650000, portfolioAtCutoffWithIva: 764000 });
  const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
  const card = (label: string) => page.locator('.kpi-card').filter({ has: page.getByText(label, { exact: true }) });
  await expect(card('Total IVA').locator('.kpi-value')).toHaveText(money(report.totals.iva));
  await expect(card('Total IVA').locator('details')).toHaveCount(0);
  await expect(card('Ventas totales').locator('.kpi-value')).toHaveText(money(report.totals.salesNet));
  await expect(card('Ventas totales').locator('details')).toHaveCount(0);
  await expect(card('Pagos recibidos').locator('details')).toHaveCount(0);
  const factNet = Math.round((report.totals.factGross - report.totals.retentions) * 100) / 100;
  expect(factNet).toBe(847200);
  await expect(card('Total FACT').locator('.kpi-value')).toHaveText(money(factNet));
  await expect(card('Total FACT').locator('details')).toHaveCount(0);
  await expect(card('Total REM').locator('.kpi-value')).toHaveText(money(200000));
  expect(Math.round((200000 + factNet) * 100))
    .toBe(Math.round(report.totals.salesNet * 100));
  await expect(card('Total REM').locator('details')).toHaveCount(0);
  await expect(card('Total REM').locator('.kpi-meta')).toHaveCount(0);
  await expect(page.getByText('FACT · ventas sin IVA', { exact: true })).toHaveCount(0);
  await expect(card('Cartera al corte')).toHaveCount(0);
  await expect(page.locator('.kpi-card .kpi-meta')).toHaveCount(1);
  await expect(card('Ventas totales').locator('.kpi-meta')).toHaveText('3 órdenes creadas en el período');

  for (const [label, metric, key] of [
    ['Cartera al corte con IVA', 'portfolioAtCutoffWithIva', 'portfolioAtCutoffWithIva'],
    ['Cartera al corte sin IVA', 'portfolioAtCutoff', 'portfolioAtCutoff'],
    ['Retenciones totales pendientes por cobrar', 'retentions', 'pendingRetentions'],
  ] as const) {
    const selectedCard = card(label);
    await expect(selectedCard.locator('.kpi-value')).toHaveText(money(report.totals[key]));
    const detailsResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/reports/receivables' && url.searchParams.get('metric') === metric
        && url.searchParams.get('category') === 'SuperGiros' && url.searchParams.get('cutoff') === report.to;
    });
    await selectedCard.locator('summary').click();
    const fetched = await detailsResponse;
    expect(fetched.status()).toBe(200);
    const detail = await fetched.json();
    expect(detail.totalAmount).toBe(report.totals[key]);
    const rows = selectedCard.locator('ol.analytics-receivable-list > li');
    await expect(rows).toHaveCount(detail.items.length);
    expect(detail.items.map((item: { number: number }) => item.number))
      .toEqual(detail.items.map((item: { number: number }) => item.number).sort((a: number, b: number) => b - a));
    for (let index = 0; index < detail.items.length; index++) {
      const item = detail.items[index];
      await expect(rows.nth(index).getByRole('link')).toHaveText(`OT #${String(item.number).padStart(4, '0')}`);
      await expect(rows.nth(index).getByRole('link')).toHaveAttribute('href', `/orders/${item.orderId}`);
      await expect(rows.nth(index).locator('.analytics-receivable-amount strong')).toHaveText(money(item.amount));
    }
    expect(detail.items.reduce((sum: number, item: { amount: number }) => sum + item.amount, 0)).toBe(detail.totalAmount);
  }

  const remReport = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/reports/sales' && url.searchParams.get('documentType') === 'REM';
  });
  await page.getByLabel('Documento', { exact: true }).selectOption('REM');
  const remResponse = await remReport;
  expect(remResponse.status()).toBe(200);
  const rem = await remResponse.json();
  await expect(card('Total IVA').locator('.kpi-value')).toHaveText(money(rem.totals.iva));
  await expect(card('Total FACT').locator('.kpi-value')).toHaveText(money(0));
  await expect(card('Total FACT').locator('details')).toHaveCount(0);
  await expect(card('Total REM').locator('.kpi-value')).toHaveText(money(200000));
  await expect(card('Ventas totales').locator('.kpi-value')).toHaveText(money(200000));
  await expect(card('Cartera al corte con IVA').locator('.kpi-value')).toHaveText(money(150000));
  await expect(card('Cartera al corte sin IVA').locator('.kpi-value')).toHaveText(money(150000));

  const factReport = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/reports/sales' && url.searchParams.get('documentType') === 'FACT';
  });
  await page.getByLabel('Documento', { exact: true }).selectOption('FACT');
  const factResponse = await factReport;
  expect(factResponse.status()).toBe(200);
  const fact = await factResponse.json();
  await expect(card('Total IVA').locator('.kpi-value')).toHaveText(money(fact.totals.iva));
  await expect(card('Total FACT').locator('.kpi-value')).toHaveText(money(847200));
  await expect(card('Total REM').locator('.kpi-value')).toHaveText(money(0));
  await expect(card('Ventas totales').locator('.kpi-value')).toHaveText(money(847200));
  await expect(card('Cartera al corte con IVA').locator('.kpi-value')).toHaveText(money(614000));
  await expect(card('Cartera al corte sin IVA').locator('.kpi-value')).toHaveText(money(500000));
  await expect(card('Total REM').locator('details')).toHaveCount(0);
  await page.getByLabel('Documento', { exact: true }).selectOption('ALL');
  await expect(card('Total REM').locator('.kpi-value')).toHaveText(money(200000));
  const currentMonth = today.slice(0, 7);
  for (const offset of [-1, 1]) {
    const monthDate = new Date(`${currentMonth}-01T12:00:00Z`);
    monthDate.setUTCMonth(monthDate.getUTCMonth() + offset);
    const selectedMonth = monthDate.toISOString().slice(0, 7);
    const changedMonth = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/reports/sales' && url.searchParams.get('from') === `${selectedMonth}-01`
        && url.searchParams.get('category') === 'SuperGiros' && !url.searchParams.has('documentType');
    });
    await page.getByLabel('Mes del reporte', { exact: true }).fill(selectedMonth);
    const monthlyResponse = await changedMonth;
    expect(monthlyResponse.status()).toBe(200);
    const monthlyReport = await monthlyResponse.json();
    expect(monthlyReport.totals.base - monthlyReport.totals.factBase).toBe(0);
    await expect(card('Total REM').locator('.kpi-value')).toHaveText(money(0));
    if (offset > 0) {
      // Las ventas REM no se acumulan desde meses anteriores; su cartera sí conserva el saldo pendiente.
      await expect(card('Cartera al corte con IVA').locator('.kpi-value')).toHaveText(money(764000));
    }
  }
  await page.getByLabel('Mes del reporte', { exact: true }).fill(currentMonth);
  await expect(card('Total REM').locator('.kpi-value')).toHaveText(money(200000));
  await expect(card('Total REM').locator('details')).toHaveCount(0);
  // Un certificado recibido reduce pendientes, no vuelve a sumar retenciones a las ventas.
  const certificate = page.getByRole('checkbox', { name: `Certificado RETEFUENTE recibido para OT #${retainedFact!.number}`, exact: true });
  await certificate.click();
  await expect(certificate).toBeChecked();
  await expect(card('Retenciones totales pendientes por cobrar').locator('.kpi-value')).toHaveText(money(21300));
  await expect(card('Total FACT').locator('.kpi-value')).toHaveText(money(847200));
  await expect(card('Ventas totales').locator('.kpi-value')).toHaveText(money(1047200));
  // Un abono adicional sí reduce deuda, pero nunca el valor neto de la venta FACT.
  const payment = await page.request.post(`/api/v1/orders/${retainedFact!.id}/payments`, {
    headers, data: { date: today, amount: 10000, method: 'EFECTIVO', requestId: randomUUID() },
  });
  expect(payment.status(), await payment.text()).toBe(201);
  await page.reload();
  await page.getByLabel('Categoría', { exact: true }).selectOption('SuperGiros');
  await expect(card('Total REM').locator('.kpi-value')).toHaveText(money(200000));
  await expect(card('Total FACT').locator('.kpi-value')).toHaveText(money(847200));
  await expect(card('Ventas totales').locator('.kpi-value')).toHaveText(money(1047200));
  await expect(card('Pagos recibidos').locator('.kpi-value')).toHaveText(money(338500));
  await expect(card('Cartera al corte con IVA').locator('.kpi-value')).toHaveText(money(730000));
  await expect(card('Cartera al corte sin IVA').locator('.kpi-value')).toHaveText(money(616000));
  expect(emptyOrderLists).toBeGreaterThan(0);
});

test('correcciones administrativas conservan progreso y actualizan consumo y saldo en una OT cerrada',async({page})=>{
  await login(page);
  const suffix=randomUUID().slice(0,8),name=`Cliente correcciones ${suffix}`,identification=`CORR-${suffix}`;
  await createClient(page,name,identification);
  await page.goto('/orders/new');
  await selectOrderClient(page,identification,name);
  const product=page.locator('[data-page-path="/orders/new"] .order-product-card');
  await product.getByLabel('Descripción del producto *').fill('Aviso con consumo corregible');
  await product.getByLabel('Valor unitario antes de IVA (COP) *').fill('100000');
  await product.getByRole('checkbox',{name:'Impresión',exact:true}).check();
  await product.getByRole('checkbox',{name:'Taller',exact:true}).check();
  await product.getByRole('button',{name:'Agregar material',exact:true}).click();
  await product.getByLabel('Material 1',{exact:true}).selectOption('Panaflex');
  await product.getByLabel('Largo (m)').fill('2');
  await product.getByLabel('Ancho (m)').fill('4');
  await page.getByLabel('Valor recibido (COP) *').fill('20000');
  const createdResponse=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/api/v1/orders'));
  await page.getByRole('button',{name:'Guardar orden de trabajo',exact:true}).click();
  const created=await createdResponse;expect(created.status(),await created.text()).toBe(201);
  const order=(await created.json()).order;
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
  const session=await (await page.request.get('/api/v1/auth/session')).json();
  const headers={'Origin':'http://127.0.0.1:5174','X-CSRF-Token':session.csrfToken};
  const activities=(await (await page.request.get(`/api/v1/work/activities?orderId=${order.id}`)).json()).items;
  for(const activity of activities){
    const started=await page.request.post(`/api/v1/work/activities/${activity.id}/start`,{headers,data:{}});
    expect(started.status(),await started.text()).toBe(200);
    const finished=await page.request.post(`/api/v1/work/activities/${activity.id}/complete`,{headers,data:activity.area==='PRINTING'?{receivedByWorkshop:'Recepción de prueba'}:{}});
    expect(finished.status(),await finished.text()).toBe(200);
  }
  const completed=(await (await page.request.get(`/api/v1/orders/${order.id}`)).json()).order;
  const closedResponse=await page.request.post(`/api/v1/orders/${order.id}/transitions`,{headers,data:{action:'close',expectedVersion:completed.version}});
  expect(closedResponse.status()).toBe(200);const closed=(await closedResponse.json()).order;
  const day=dateOnly();
  const reportPath=`/api/v1/reports/materials?from=${day}&to=${day}`;
  const before=await (await page.request.get(reportPath)).json();
  const m2=(report:{materials:Array<{material:string;m2:number}>},material:string)=>report.materials.find(item=>item.material===material)!.m2;
  await page.reload();
  await page.getByRole('link',{name:'Editar OT',exact:true}).click();
  const editor=page.locator(`[data-page-path="/orders/${order.id}/edit"]`);
  await editor.getByLabel('Material 1',{exact:true}).selectOption('V. Impresión');
  await page.locator('.app-sidebar').getByRole('link',{name:'Reportes',exact:true}).click();
  await page.locator('.app-sidebar').getByRole('link',{name:'Órdenes',exact:true}).click();
  await page.getByRole('link',{name:`Ver orden ${order.number}`,exact:true}).click();
  await page.getByRole('link',{name:'Editar OT',exact:true}).click();
  await expect(editor.getByLabel('Material 1',{exact:true})).toHaveValue('V. Impresión');
  const savedResponse=page.waitForResponse(response=>response.request().method()==='PATCH'&&response.url().endsWith(`/api/v1/orders/${order.id}`));
  await editor.getByRole('button',{name:'Guardar cambios',exact:true}).click();
  const saved=await savedResponse;expect(saved.status(),await saved.text()).toBe(200);
  const after=await (await page.request.get(reportPath)).json();
  expect(m2(after,'Panaflex')).toBe(m2(before,'Panaflex')-8);
  expect(m2(after,'V. Impresión')).toBe(m2(before,'V. Impresión')+8);
  await page.getByRole('button',{name:`Corregir pago de ${formatCOP(20000)}`,exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Valor corregido (COP)').fill('35000');
  await dialog.getByLabel('Medio de pago corregido').selectOption('DAVIVIENDA');
  await dialog.getByRole('button',{name:'Guardar corrección',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.order-balance-highlight')).toContainText(formatCOP(65000));
  const actual=(await (await page.request.get(`/api/v1/orders/${order.id}`)).json()).order;
  expect(actual).toMatchObject({status:'COMPLETED',closedAt:closed.closedAt,isComposite:true,financials:{balance:65000,paid:35000}});
  await page.getByRole('link',{name:'Editar OT',exact:true}).click();
  await expect(editor.getByLabel('Descripción del producto *')).toBeVisible();
});
