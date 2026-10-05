import { test, expect, type Page } from '@playwright/test';

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
  await expect(page.getByText('Ventas · valor base')).toBeVisible();
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
