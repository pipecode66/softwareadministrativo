import { test, expect } from '@playwright/test';

test('sesión real carga reportes desde el servidor', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Usuario o correo').fill('api-e2e@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('Una clave E2E segura 2026!');
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).toHaveURL(/\/$/);

  const reportResponse = page.waitForResponse(response => response.url().includes('/api/v1/reports/sales') && response.request().method() === 'GET');
  await page.goto('/reports');
  await expect((await reportResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Reportes de ventas' })).toBeVisible();
  await expect(page.getByText('Ventas · valor base')).toBeVisible();
});