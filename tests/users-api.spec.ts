import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type BrowserContext } from '@playwright/test';
import { dateOnly } from '../src/domain/utils';

const API = '/api/v1', ORIGIN = 'http://127.0.0.1:5174';
const TEMPORARY = 'Clave temporal usuarios E2E 2026!';
const PERSONAL = 'Clave personal usuarios E2E 2026!';
async function json(response: Pick<APIResponse, 'status' | 'text' | 'json'>, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}
async function signIn(context: BrowserContext, email: string, password: string) {
  const initial = await json(await context.request.post(`${API}/auth/login`, {
    headers: { Origin: ORIGIN }, data: { email, password },
  }));
  if (!initial.user.mustChangePassword) return { user: initial.user, headers: { Origin: ORIGIN, 'X-CSRF-Token': initial.csrfToken } };
  const changed = await json(await context.request.post(`${API}/auth/password`, {
    headers: { Origin: ORIGIN, 'X-CSRF-Token': initial.csrfToken },
    data: { currentPassword: password, newPassword: PERSONAL },
  }));
  return { user: changed.user, headers: { Origin: ORIGIN, 'X-CSRF-Token': changed.csrfToken } };
}

test('Adminmaster edita y elimina usuarios con confirmación, conserva su autoría y puede reutilizar el correo', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const master = await signIn(page.context(), 'api-e2e@example.test', 'Una clave E2E segura 2026!');
  const suffix = randomUUID();
  const oldEmail = `cuenta-original-${suffix}@example.test`;
  const newEmail = `cuenta-corregida-${suffix}@example.test`;
  async function createAccount(name: string, email: string) {
    return (await json(await page.request.post(`${API}/users`, {
      headers: master.headers, data: { name, email, role: 'ADMIN_GENERAL', active: true, password: TEMPORARY },
    }), 201)).user;
  }
  const target = await createAccount('Cuenta con datos originales', oldEmail);
  const limited = await createAccount('Administración sin permiso para eliminar', `limitada-${suffix}@example.test`);
  const targetContext = await browser.newContext({ baseURL: ORIGIN });
  const limitedContext = await browser.newContext({ baseURL: ORIGIN });
  try {
    const writer = await signIn(targetContext, oldEmail, TEMPORARY);
    const restricted = await signIn(limitedContext, limited.email, TEMPORARY);
    const forbidden = await limitedContext.request.delete(`${API}/users/${target.id}`, { headers: restricted.headers });
    expect(forbidden.status()).toBe(403);
    expect((await forbidden.json()).error.code).toBe('FORBIDDEN');
    expect((await page.request.delete(`${API}/users/${master.user.id}`, { headers: master.headers })).status()).toBe(409);
    const client = (await json(await page.request.post(`${API}/clients`, {
      headers: master.headers, data: { name: `Cliente autoría ${suffix}`, phone: '3001234567', specialPayment: true },
    }), 201)).client;
    const order = (await json(await targetContext.request.post(`${API}/orders`, {
      headers: writer.headers, data: { requestId: randomUUID(), clientId: client.id, description: 'Trabajo de cuenta que será eliminada',
        value: 100000, documentType: 'REM', category: 'Proyecto', route: 'WORKSHOP_ONLY', requiresInstallation: false,
        initialPayment: { date: dateOnly(), amount: 25000, method: 'BANCOLOMBIA' } },
    }), 201)).order;

    await page.goto('/settings/users');
    const ownRow = page.locator('tbody tr').filter({ hasText: master.user.email });
    await ownRow.getByRole('button', { name: 'Editar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Editar usuario', exact: true });
    await expect(dialog.getByRole('button', { name: 'Eliminar usuario', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await page.locator('tbody tr').filter({ hasText: oldEmail }).getByRole('button', { name: 'Editar', exact: true }).click();
    const updatedName = 'Diseñador con datos corregidos';
    await dialog.getByLabel('Nombre', { exact: true }).fill(updatedName);
    await dialog.getByLabel('Correo', { exact: true }).fill(newEmail);
    await dialog.getByLabel('Perfil', { exact: true }).selectOption('DISENO');
    const updateResponse = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(`/users/${target.id}`));
    await dialog.getByRole('button', { name: 'Guardar usuario', exact: true }).click();
    expect((await json(await updateResponse)).user).toMatchObject({ id: target.id, name: updatedName, email: newEmail, role: 'DISENO' });
    await expect(dialog).toHaveCount(0);
    expect((await targetContext.request.get(`${API}/auth/session`)).status()).toBe(401);
    expect((await targetContext.request.post(`${API}/auth/login`, {
      headers: { Origin: ORIGIN }, data: { email: oldEmail, password: PERSONAL },
    })).status()).toBe(401);
    expect((await signIn(targetContext, newEmail, PERSONAL)).user).toMatchObject({ id: target.id, role: 'DISENO', name: updatedName });

    let deleteRequests = 0;
    page.on('request', request => { if (request.method() === 'DELETE' && request.url().endsWith(`/users/${target.id}`)) deleteRequests++; });
    await page.locator('tbody tr').filter({ hasText: newEmail }).getByRole('button', { name: 'Editar', exact: true }).click();
    await dialog.getByRole('button', { name: 'Eliminar usuario', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Confirmar eliminación', exact: true })).toBeVisible();
    await expect(dialog).toContainText(updatedName);
    await expect(dialog).toContainText(newEmail);
    expect(deleteRequests).toBe(0);
    await dialog.getByRole('button', { name: 'Cancelar eliminación', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Confirmar eliminación', exact: true })).toHaveCount(0);
    expect((await json(await page.request.get(`${API}/users?q=${encodeURIComponent(newEmail)}`))).items)
      .toEqual([expect.objectContaining({ id: target.id })]);
    await dialog.getByRole('button', { name: 'Eliminar usuario', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('confirmar-eliminacion-usuario-390.png'), fullPage: false });
    const deletion = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/users/${target.id}`));
    await dialog.getByRole('button', { name: 'Confirmar eliminación', exact: true }).click();
    expect((await deletion).status()).toBe(204);
    await expect(dialog).toHaveCount(0);
    expect(deleteRequests).toBe(1);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(page.locator('tbody tr').filter({ hasText: newEmail })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('tbody tr').filter({ hasText: newEmail })).toHaveCount(0);
    expect((await json(await page.request.get(`${API}/users?q=${encodeURIComponent(newEmail)}`))).items).toEqual([]);
    expect((await targetContext.request.get(`${API}/auth/session`)).status()).toBe(401);
    expect((await targetContext.request.post(`${API}/auth/login`, {
      headers: { Origin: ORIGIN }, data: { email: newEmail, password: PERSONAL },
    })).status()).toBe(401);
    expect((await page.request.patch(`${API}/users/${target.id}`, { headers: master.headers, data: { active: true } })).status()).toBe(404);
    expect((await page.request.post(`${API}/users/${target.id}/password`, { headers: master.headers, data: { password: TEMPORARY } })).status()).toBe(404);

    const history = (await json(await page.request.get(`${API}/orders/${order.id}`))).order;
    expect(history).toMatchObject({ id: order.id, number: order.number, createdBy: target.id,
      financials: { paid: 25000, balance: 75000 },
      payments: [{ recordedBy: target.id, recordedByName: updatedName, amount: 25000 }] });
    const orders = await json(await page.request.get(`${API}/orders`));
    expect(orders.items.find((item: { id: string }) => item.id === order.id))
      .toMatchObject({ createdBy: target.id, creatorName: updatedName });
    const events = await json(await page.request.get(`${API}/history?orderId=${order.id}`));
    expect(events.items.find((event: { action: string }) => event.action === 'create').actor).toMatchObject({ id: target.id, name: updatedName });
    const replacement = await createAccount('Cuenta nueva con correo reutilizado', newEmail);
    expect(replacement.id).not.toBe(target.id);
    const replacementSession = await signIn(targetContext, newEmail, TEMPORARY);
    expect(replacementSession.user.id).toBe(replacement.id);
    await page.goto(`/orders/${order.id}`);
    await expect(page.locator('.order-payments-card')).toContainText(updatedName);
    await expect(page.locator('.order-payments-card')).not.toContainText('Usuario no disponible');
    expect((await page.request.delete(`${API}/users/${replacement.id}`, { headers: master.headers })).status()).toBe(204);
  } finally {
    await targetContext.close();
    await limitedContext.close();
    await json(await page.request.patch(`${API}/users/${limited.id}`, { headers: master.headers, data: { active: false } }));
  }
});
