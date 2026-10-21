import { expect, test } from '@playwright/test';
import { LOCAL_REVIEW_PASSWORD, makeSeed } from '../src/data/seed';
import { formatCOP, today } from '../src/domain/utils';
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

async function login(page: import('@playwright/test').Page, email = 'adminmaster@intermedios.local') {
  await page.goto('/login');
  await page.getByLabel('Usuario o correo').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(LOCAL_REVIEW_PASSWORD);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

for (const account of ['adminmaster@intermedios.local', 'administracion@intermedios.local']) {
  test(`${account} distingue TOTAL FACT bruto de la cartera real con abonos`, async ({ page, context }) => {
    const data = makeSeed();
    const rem = makeOrder('debt-rem', 9101, 100_000);
    rem.payments = [{ id: 'rem-abono', date: today(), amount: 25_000, recordedBy: 'u-master', method: 'EFECTIVO' }];
    const fact = makeOrder('debt-fact', 9102, 1_000_000, 'FACT');
    fact.payments = [{ id: 'fact-abono', date: today(), amount: 100_000, recordedBy: 'u-master', method: 'BANCOLOMBIA' }];
    data.orders = [rem, fact];
    await context.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: DATA_KEY, data });
    await page.goto('/login');
    await page.getByLabel('Usuario o correo').fill(account);
    await page.getByLabel('Contraseña', { exact: true }).fill(LOCAL_REVIEW_PASSWORD);
    await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    for (const path of ['/reports', '/portfolio']) {
      await page.goto(path);
      const remCard = page.locator('.kpi-card').filter({ has: page.getByText(path === '/reports' ? 'Total REM' : 'Total cartera REM', { exact: true }) });
      const factCard = page.locator('.kpi-card').filter({ has: page.getByText(path === '/reports' ? 'Total FACT' : 'Total cartera FACT', { exact: true }) });
      await expect(remCard.locator('.kpi-value')).toHaveText(formatCOP(75_000));
      await expect(factCard.locator('.kpi-value')).toHaveText(formatCOP(path === '/reports' ? 1_190_000 : 1_014_500));
      if (path === '/reports') {
        const portfolioCard = page.locator('.kpi-card').filter({ has: page.getByText('Cartera al corte', { exact: true }) });
        await expect(portfolioCard.locator('.kpi-value')).toHaveText(formatCOP(975_000));
      }
      await page.getByLabel('Documento', { exact: true }).selectOption('FACT');
      await expect(remCard.locator('.kpi-value')).toHaveText(formatCOP(0));
      await expect(factCard.locator('.kpi-value')).toHaveText(formatCOP(path === '/reports' ? 1_190_000 : 1_014_500));
      if (path === '/reports') {
        const portfolioCard = page.locator('.kpi-card').filter({ has: page.getByText('Cartera al corte', { exact: true }) });
        await expect(portfolioCard.locator('.kpi-value')).toHaveText(formatCOP(900_000));
      }
    }
  });
}

test('TOTAL FACT respeta el mes predeterminado y los períodos seleccionados sin descontar pagos ni retenciones', async ({ page, context }) => {
  const month = (offset: number) => {
    const date = new Date(`${today().slice(0, 7)}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date.toISOString().slice(0, 7);
  };
  const previousMonth = month(-1), currentMonth = month(0), nextMonth = month(1);
  const datedFact = (id: string, number: number, value: number, monthValue: string): WorkOrder => ({
    ...makeOrder(id, number, value, 'FACT'),
    createdAt: `${monthValue}-01T00:00:00-05:00`, updatedAt: `${monthValue}-01T00:00:00-05:00`,
    reteFuente: 0, reteIva: 0, ica: 0,
  });
  const previousFact = datedFact('previous-month-fact', 101, 100_000, previousMonth);
  previousFact.reteFuente = 5_000;
  const currentFact = datedFact('current-month-fact', 102, 200_000, currentMonth);
  currentFact.reteFuente = 10_000;
  currentFact.payments = [{ id: 'current-partial-payment', date: `${currentMonth}-01`, amount: 30_000, recordedBy: 'u-master' }];
  const paidFact = datedFact('current-month-paid-fact', 103, 150_000, currentMonth);
  paidFact.reteFuente = 1_000;
  paidFact.payments = [{ id: 'current-full-payment', date: `${currentMonth}-01`, amount: 177_500, recordedBy: 'u-master' }];
  const nextFact = datedFact('next-month-fact', 104, 400_000, nextMonth);
  const data = makeSeed();
  data.orders = [previousFact, currentFact, paidFact, nextFact];
  await context.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: DATA_KEY, data });
  await login(page);
  await page.goto('/reports');
  const card = (label: string) => page.locator('.kpi-card').filter({ has: page.getByText(label, { exact: true }) });
  const verifyPeriod = async (base: number, iva: number) => {
    await expect(card('Ventas · valor base').locator('.kpi-value')).toHaveText(formatCOP(base));
    await expect(card('Total IVA').locator('.kpi-value')).toHaveText(formatCOP(iva));
    await expect(card('Total FACT').locator('.kpi-value')).toHaveText(formatCOP(base + iva));
    await expect(card('Total FACT').locator('details')).toHaveCount(0);
  };
  await expect(page.getByLabel('Mes del reporte', { exact: true })).toHaveValue(currentMonth);
  await verifyPeriod(350_000, 66_500);

  await page.getByLabel('Mes del reporte', { exact: true }).fill(previousMonth);
  await verifyPeriod(100_000, 19_000);
  await page.getByLabel('Mes del reporte', { exact: true }).fill(nextMonth);
  await verifyPeriod(400_000, 76_000);

  await page.getByRole('button', { name: 'Rango de fechas', exact: true }).click();
  await page.getByLabel('Desde', { exact: true }).fill(`${previousMonth}-01`);
  await page.getByLabel('Hasta', { exact: true }).fill(`${currentMonth}-01`);
  await verifyPeriod(450_000, 85_500);

  await page.getByRole('button', { name: 'Rango de meses', exact: true }).click();
  await page.getByLabel('Hasta', { exact: true }).fill(nextMonth);
  await verifyPeriod(850_000, 161_500);
  await page.getByRole('button', { name: 'Mes', exact: true }).click();
  await verifyPeriod(350_000, 66_500);
});

test('reporte separa FACT e IVA y registra certificado sin modificar pagos', async ({ page }) => {
  await login(page);
  await page.goto('/reports');
  await expect(page.getByText('FACT · ventas sin IVA', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Total IVA', { exact: true })).toBeVisible();
  await expect(page.locator('.kpi-card').filter({ has: page.getByText('Cartera al corte', { exact: true }) })).toBeVisible();
  await expect(page.getByText('Cartera al corte con IVA', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cartera al corte sin IVA', { exact: true })).toHaveCount(0);
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

test('Administración consulta cartera sin IVA más retenciones y la actualiza al recibir certificados', async ({ page, context }, testInfo) => {
  const data = makeSeed();
  const rem = makeOrder('rem-50', 50, 100_000);
  rem.payments = [{ id: 'rem-abono', date: today(), amount: 25_000, recordedBy: 'u-master' }];
  const fact = { ...makeOrder('fact-49', 49, 150_000, 'FACT'), reteFuente: 6_000, reteIva: 4_275, ica: 1_050 };
  fact.payments = [{ id: 'fact-abono', date: today(), amount: 50_000, recordedBy: 'u-master' }];
  const paidFact = { ...makeOrder('paid-fact-9', 9, 150_000, 'FACT'), reteFuente: 3_000, reteIva: 0, ica: 0 };
  paidFact.payments = [{ id: 'fact-pagada', date: today(), amount: 175_500, recordedBy: 'u-master' }];
  data.orders = [paidFact, rem, fact];
  await context.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: DATA_KEY, data });
  await login(page, 'administracion@intermedios.local');
  await page.goto('/reports');
  const card = (label: string) => page.locator('.kpi-card').filter({ has: page.getByText(label, { exact: true }) });
  const totalIva = card('Total IVA');
  const retentions = card('Retenciones totales pendientes por cobrar');
  await expect(totalIva.locator('.kpi-value')).toHaveText(formatCOP(57_000));
  await expect(card('Total FACT').locator('.kpi-value')).toHaveText(formatCOP(357_000));
  await expect(retentions.locator('.kpi-value')).toHaveText(formatCOP(14_325));
  await expect(card('Cartera al corte')).toHaveCount(1);
  await expect(page.getByText('Cartera al corte con IVA', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cartera al corte sin IVA', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('reportes-desktop.png'), fullPage: true });
  for (const label of ['Ventas · valor base', 'Total IVA', 'Pagos recibidos', 'Total FACT']) {
    await expect(card(label).locator('details')).toHaveCount(0);
  }
  for (const [label, amount, numbers] of [
    ['Cartera al corte', 178_000, ['OT #0050', 'OT #0049', 'OT #0009']],
    ['Total REM', 75_000, ['OT #0050']],
    ['Retenciones totales pendientes por cobrar', 14_325, ['OT #0049', 'OT #0009']],
  ] as const) {
    const metric = card(label);
    await expect(metric.locator('.kpi-value')).toHaveText(formatCOP(amount));
    await metric.locator('summary').click();
    await expect(metric.locator('.analytics-receivable-list a')).toHaveText([...numbers]);
  }
  await expect(card('Cartera al corte').locator('.analytics-receivable-amount strong')).toHaveText([
    formatCOP(75_000), formatCOP(100_000), formatCOP(3_000),
  ]);
  await page.getByRole('checkbox', { name: 'Certificado RETEFUENTE recibido para OT #49', exact: true }).check();
  await expect(retentions.locator('.kpi-value')).toHaveText(formatCOP(8_325));
  await expect(totalIva.locator('.kpi-value')).toHaveText(formatCOP(57_000));
  await expect(card('Cartera al corte').locator('.kpi-value')).toHaveText(formatCOP(172_000));
  await page.getByLabel('Documento', { exact: true }).selectOption('REM');
  await expect(totalIva.locator('.kpi-value')).toHaveText(formatCOP(0));
  await expect(retentions.locator('.kpi-value')).toHaveText(formatCOP(0));
  await expect(card('Total FACT').locator('.kpi-value')).toHaveText(formatCOP(0));
  await expect(card('Total FACT').locator('details')).toHaveCount(0);
  await expect(card('Cartera al corte').locator('.kpi-value')).toHaveText(formatCOP(75_000));
  await page.getByLabel('Documento', { exact: true }).selectOption('FACT');
  await expect(card('Cartera al corte').locator('.kpi-value')).toHaveText(formatCOP(97_000));
  await card('Total REM').locator('summary').click();
  await expect(card('Total REM').getByText('No hay órdenes pendientes para este concepto.')).toBeVisible();
  await page.getByLabel('Documento', { exact: true }).selectOption('ALL');
  await page.setViewportSize({ width: 320, height: 760 });
  await card('Cartera al corte').locator('summary').click();
  await expect(card('Cartera al corte').getByRole('link', { name: 'OT #0049', exact: true })).toBeVisible();
  await expect(card('Total FACT').locator('.kpi-value')).toHaveText(formatCOP(357_000));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reportes-mobile.png'), fullPage: true });
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
  await expect(page.getByText('Total IVA', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/portfolio');
  await page.locator('.analytics-debt-clients li').filter({ hasText: 'SuperGiros S.A.' }).getByRole('button', { name: 'Pago a varias OT' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
