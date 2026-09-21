import { expect, test } from '@playwright/test';
import { LOCAL_REVIEW_PASSWORD, makeSeed } from '../src/data/seed';
import { today } from '../src/domain/utils';
import type { AppData, WorkOrder } from '../src/domain/types';

const DATA_KEY = 'intermedios.frontend.v1';
const createdAt = `${today()}T12:00:00-05:00`;
const makeOrder = (id: string, number: number, value: number, documentType: 'REM' | 'FACT' = 'REM'): WorkOrder => ({
  id, number, clientId: 'c-1', description: `Trabajo financiero ${number}`, value,
  documentType, category: 'SuperGiros', route: 'WORKSHOP_ONLY', requiresInstallation: false,
  status: 'NEW', createdBy: 'u-master', createdAt, updatedAt: createdAt, financialRule: 'NEW',
  reteFuente: documentType === 'FACT' ? 40_000 : 0,
  reteIva: documentType === 'FACT' ? 28_500 : 0,
  ica: documentType === 'FACT' ? 7_000 : 0,
  payments: [],
});

test.beforeEach(async ({ context }) => {
  const data = makeSeed();
  data.orders.push(makeOrder('finance-1', 9001, 100_000));
  data.orders.push(makeOrder('finance-2', 9002, 300_000));
  data.orders.push(makeOrder('finance-fact', 9003, 1_000_000, 'FACT'));
  await context.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: DATA_KEY, data });
});

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Usuario o correo').fill('adminmaster@intermedios.local');
  await page.getByLabel('Contraseña', { exact: true }).fill(LOCAL_REVIEW_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

test('reporte separa FACT e IVA y registra certificado sin modificar cartera', async ({ page }) => {
  await login(page);
  await page.goto('/reports');
  await expect(page.getByText('FACT · ventas sin IVA')).toBeVisible();
  await expect(page.getByText('IVA · ventas FACT')).toBeVisible();
  await expect(page.getByText('Cartera al corte sin IVA')).toBeVisible();
  const before = await page.evaluate(key => {
    const order = (JSON.parse(localStorage.getItem(key)!) as AppData).orders.find(item => item.id === 'finance-fact')!;
    return order.payments.length;
  }, DATA_KEY);
  await page.getByRole('checkbox', { name: 'Certificado RETEFUENTE recibido para OT #9003' }).check();
  await expect.poll(async () => page.evaluate(key => {
    const order = (JSON.parse(localStorage.getItem(key)!) as AppData).orders.find(item => item.id === 'finance-fact')!;
    return { received: order.certificates?.reteFuente, payments: order.payments.length };
  }, DATA_KEY)).toEqual({ received: true, payments: before });
});

test('cartera distribuye un pago grupal del menor saldo al mayor y guarda el medio', async ({ page }) => {
  await login(page);
  await page.goto('/portfolio');
  await expect(page.getByText('Cartera sin IVA')).toBeVisible();
  await page.locator('.analytics-debt-clients li').filter({ hasText: 'SuperGiros S.A.' }).getByRole('button', { name: 'Pago a varias OT' }).click();
  const dialog = page.getByRole('dialog');
  for (const checkbox of await dialog.locator('.analytics-bulk-row input').all()) if (await checkbox.isChecked()) await checkbox.uncheck();
  await dialog.locator('.analytics-bulk-row').filter({ hasText: 'OT #9001' }).getByRole('checkbox').check();
  await dialog.locator('.analytics-bulk-row').filter({ hasText: 'OT #9002' }).getByRole('checkbox').check();
  await dialog.getByLabel('Valor total recibido (COP)').fill('250000');
  await dialog.getByLabel('Medio de pago').selectOption('BANCOLOMBIA');
  await expect(dialog.locator('.analytics-bulk-preview')).toContainText('OT #9001');
  await expect(dialog.locator('.analytics-bulk-preview')).toContainText('OT #9002');
  await dialog.getByRole('button', { name: 'Registrar pago grupal' }).click();
  await expect(dialog).toHaveCount(0);
  const allocations = await page.evaluate(key => {
    const orders = (JSON.parse(localStorage.getItem(key)!) as AppData).orders;
    return ['finance-1', 'finance-2'].map(id => orders.find(order => order.id === id)!.payments.map(payment => ({ amount: payment.amount, method: payment.method })));
  }, DATA_KEY);
  expect(allocations).toEqual([[{ amount: 100_000, method: 'BANCOLOMBIA' }], [{ amount: 150_000, method: 'BANCOLOMBIA' }]]);
});

test('reportes y pago grupal caben en pantalla móvil estrecha', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await login(page);
  await page.goto('/reports');
  await expect(page.getByText('IVA · ventas FACT')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/portfolio');
  await page.locator('.analytics-debt-clients li').filter({ hasText: 'SuperGiros S.A.' }).getByRole('button', { name: 'Pago a varias OT' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
