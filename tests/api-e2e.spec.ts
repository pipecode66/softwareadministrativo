import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Usuario o correo').fill('api-e2e@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('Una clave E2E segura 2026!');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('sesión real carga reportes desde el servidor', async ({ page }) => {
  await login(page);

  const reportResponse = page.waitForResponse(response => response.url().includes('/api/v1/reports/sales') && response.request().method() === 'GET');
  await page.goto('/reports');
  await expect((await reportResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible();
  await expect(page.getByText('Ventas · valor base')).toBeVisible();
});

test('sesión real crea cliente y OT compuesta con abono y cálculo FACT', async ({ page }) => {
  await login(page);
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
  const clientDialog = page.getByRole('dialog');
  await clientDialog.getByLabel('Nombre o razón social *').fill('Cliente integración API');
  await clientDialog.getByLabel('NIT o identificación').fill('NIT-E2E-2026');
  await clientDialog.getByLabel('Celular *').fill('3001234567');
  const clientResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/clients') && response.request().method() === 'POST');
  await clientDialog.getByRole('button', { name: 'Guardar cliente' }).click();
  expect((await clientResponse).status()).toBe(201);
  await expect(clientDialog).toHaveCount(0);

  await page.goto('/orders/new');
  await page.getByLabel('Cliente / razón social *').selectOption({ label: 'Cliente integración API · NIT-E2E-2026' });
  await page.getByRole('radio', { name: /FACT/ }).check();
  const product = page.locator('.order-product-card').first();
  await product.getByLabel('Descripción del producto *').fill('Aviso compuesto de integración');
  await product.getByLabel('Valor unitario antes de IVA (COP) *').fill('600000');
  await product.getByRole('checkbox', { name: 'Diseño' }).check();
  await product.getByRole('checkbox', { name: 'Impresión' }).check();
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
});
