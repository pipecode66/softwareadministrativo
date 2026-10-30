import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type Page } from '@playwright/test';

const API = '/api/v1';
const ORIGIN = 'http://127.0.0.1:5174';
const TEMPORARY_PASSWORD = 'Clave temporal instalaciones E2E 2026!';
const PERSONAL_PASSWORD = 'Clave personal instalaciones E2E 2026!';
type Session = { request: APIRequestContext; headers: Record<string, string> };
type OrderFixture = { id: string; number: number; version: number; status: string };
type InstallationFixture = { id: string; version: number; status: string; orderId: string };

async function json(response: Pick<APIResponse, 'status' | 'text' | 'json'>, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function adminSession(page: Page): Promise<Session> {
  const body = await json(await page.request.post(`${API}/auth/login`, {
    headers: { Origin: ORIGIN },
    data: { email: 'api-e2e@example.test', password: 'Una clave E2E segura 2026!' },
  }));
  return { request: page.request, headers: { Origin: ORIGIN, 'X-CSRF-Token': body.csrfToken } };
}

async function newInstaller(session: Session) {
  const suffix = randomUUID();
  const name = `Instalador E2E ${suffix.slice(0, 8)}`;
  const email = `instalador-${suffix}@example.test`;
  const { user } = await json(await session.request.post(`${API}/users`, {
    headers: session.headers,
    data: { name, email, role: 'INSTALADOR', active: true, password: TEMPORARY_PASSWORD },
  }), 201);
  return { ...user, name, email } as { id: string; name: string; email: string };
}

async function installerSession(browser: Browser, email: string, throughInterface = false) {
  const context = await browser.newContext({
    baseURL: ORIGIN, viewport: { width: 390, height: 844 }, locale: 'es-CO', timezoneId: 'America/Bogota',
    geolocation: { latitude: 7.1193, longitude: -73.1227, accuracy: 12 }, permissions: ['geolocation'],
  });
  if (throughInterface) {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Usuario o correo').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(TEMPORARY_PASSWORD);
    await page.getByRole('button', { name: 'Ingresar al sistema', exact: true }).click();
    await expect(page).toHaveURL(/\/change-password$/);
    await page.getByLabel('Contraseña actual', { exact: true }).fill(TEMPORARY_PASSWORD);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(PERSONAL_PASSWORD);
    await page.getByLabel('Confirmar nueva contraseña', { exact: true }).fill(PERSONAL_PASSWORD);
    await page.getByRole('button', { name: 'Guardar nueva contraseña', exact: true }).click();
    await expect(page).toHaveURL(/\/installations$/);
    await expect(page.getByRole('heading', { name: 'Mis instalaciones', exact: true })).toBeVisible();
    const sessionBody = await json(await context.request.get(`${API}/auth/session`));
    const session: Session = { request: context.request, headers: { Origin: ORIGIN, 'X-CSRF-Token': sessionBody.csrfToken } };
    await page.close();
    return { context, session };
  }
  const login = await json(await context.request.post(`${API}/auth/login`, {
    headers: { Origin: ORIGIN }, data: { email, password: TEMPORARY_PASSWORD },
  }));
  const changed = await json(await context.request.post(`${API}/auth/password`, {
    headers: { Origin: ORIGIN, 'X-CSRF-Token': login.csrfToken },
    data: { currentPassword: TEMPORARY_PASSWORD, newPassword: PERSONAL_PASSWORD },
  }));
  const session: Session = { request: context.request, headers: { Origin: ORIGIN, 'X-CSRF-Token': changed.csrfToken } };
  return { context, session };
}

async function newOrder(session: Session, completed = true): Promise<OrderFixture> {
  const { client } = await json(await session.request.post(`${API}/clients`, {
    headers: session.headers, data: {
      name: `Cliente instalaciones ${randomUUID()}`, phone: '3001234567', specialPayment: true,
    },
  }), 201);
  const { order } = await json(await session.request.post(`${API}/orders`, {
    headers: session.headers, data: {
      requestId: randomUUID(), clientId: client.id, description: 'Aviso para instalación E2E sin conexión financiera',
      value: 125000, documentType: 'REM', category: 'Proyecto', route: 'WORKSHOP_ONLY', requiresInstallation: true,
      products: [{ description: 'Aviso terminado para fachada', quantity: 1, unitValue: 125000, materials: [], activities: [{ area: 'WORKSHOP' }] }],
    },
  }), 201);
  if (completed) {
    const work = await json(await session.request.get(`${API}/work/orders/${order.id}`));
    const activity = work.products[0].activities[0];
    await json(await session.request.post(`${API}/work/activities/${activity.id}/start`, { headers: session.headers, data: {} }));
    await json(await session.request.post(`${API}/work/activities/${activity.id}/complete`, {
      headers: session.headers, data: { workshopNotes: 'Pieza liberada para instalación de prueba aislada.' },
    }));
    const refreshed = await json(await session.request.get(`${API}/orders/${order.id}`));
    expect(refreshed.order.status).toBe('PENDING_INSTALLATION');
    return refreshed.order;
  }
  return order;
}

function installationInput(orderId: string, installerId?: string) {
  return {
    requestId: randomUUID(), orderId, ...(installerId ? { installerId } : {}),
    scheduledStartAt: new Date(Date.now() - 15 * 60_000).toISOString(),
    scheduledEndAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    address: 'Calle 35 # 10-20, Bucaramanga', contactName: 'Contacto de montaje', contactPhone: '3001234567',
    instructions: 'Instalar sobre el punto de anclaje acordado con el cliente.',
  };
}

async function newInstallation(session: Session, orderId: string, installerId?: string): Promise<InstallationFixture> {
  const body = await json(await session.request.post(`${API}/installations`, {
    headers: session.headers, data: installationInput(orderId, installerId),
  }), 201);
  return body.installation;
}

function location() {
  return { latitude: 7.1193, longitude: -73.1227, accuracy: 12, capturedAt: new Date().toISOString() };
}

function noFinancialFields(value: unknown) {
  const forbidden = /^(value|unitValue|lineTotal|financials|payments|balance|collectible|reteFuente|reteIva|ica|passwordHash|password_hash|documentType|identification)$/;
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    expect(key, `Campo no operativo expuesto en Instalaciones: ${key}`).not.toMatch(forbidden);
    noFinancialFields(child);
  }
}

async function noHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, root: document.documentElement.scrollWidth }));
  expect(width.body).toBeLessThanOrEqual(width.viewport + 1);
  expect(width.root).toBeLessThanOrEqual(width.viewport + 1);
}

async function action(session: Session, id: string, input: Record<string, unknown>) {
  const current = await json(await session.request.get(`${API}/installations/${id}`));
  return session.request.post(`${API}/installations/${id}/actions`, {
    headers: session.headers, data: { requestId: randomUUID(), version: current.installation.version, ...input },
  });
}

async function photoBase64(page: Page, format = 'image/jpeg') {
  return page.evaluate(type => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f97316';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#1e293b';
    context.fillRect(80, 80, 480, 240);
    return canvas.toDataURL(type, .8).split(',')[1];
  }, format);
}

test('API real: sólo se programan OT liberadas, sin duplicar instalaciones ni exponer datos comerciales', async ({ page, browser }) => {
  const admin = await adminSession(page);
  const owner = await newInstaller(admin);
  const other = await newInstaller(admin);
  const unfinished = await newOrder(admin, false);
  const unavailable = await admin.request.post(`${API}/installations`, {
    headers: admin.headers, data: installationInput(unfinished.id, owner.id),
  });
  expect(unavailable.status(), await unavailable.text()).toBe(409);

  const ready = await newOrder(admin);
  const input = installationInput(ready.id, owner.id);
  const created = await json(await admin.request.post(`${API}/installations`, { headers: admin.headers, data: input }), 201);
  expect(created.installation).toMatchObject({ orderId: ready.id, installerId: owner.id, status: 'ASSIGNED' });
  noFinancialFields(created);
  const replay = await json(await admin.request.post(`${API}/installations`, { headers: admin.headers, data: input }));
  expect(replay).toMatchObject({ replayed: true, installation: { id: created.installation.id } });
  const duplicate = await admin.request.post(`${API}/installations`, { headers: admin.headers, data: { ...input, requestId: randomUUID() } });
  expect(duplicate.status(), await duplicate.text()).toBe(409);

  const own = await installerSession(browser, owner.email);
  const foreign = await installerSession(browser, other.email);
  try {
    const list = await json(await own.session.request.get(`${API}/installations`));
    expect(list.items.map((item: InstallationFixture) => item.id)).toContain(created.installation.id);
    expect(list).not.toHaveProperty('availableOrders');
    expect(list).not.toHaveProperty('installers');
    expect(list).not.toHaveProperty('performance');
    noFinancialFields(list);
    const outsiders = await json(await foreign.session.request.get(`${API}/installations`));
    expect(outsiders.items).toHaveLength(0);
    const denied = await foreign.session.request.get(`${API}/installations/${created.installation.id}`);
    expect([403, 404]).toContain(denied.status());
    const deniedWrite = await foreign.session.request.post(`${API}/installations/${created.installation.id}/actions`, {
      headers: foreign.session.headers,
      data: { requestId: randomUUID(), version: created.installation.version, action: 'arrive', location: location() },
    });
    expect([403, 404]).toContain(deniedWrite.status());

    for (const path of ['/orders', '/clients', '/users', '/work/activities', '/history', '/reports/sales?from=2026-10-01&to=2026-10-31']) {
      const response = await own.session.request.get(`${API}${path}`);
      expect(response.status(), `Instalador no puede consultar ${path}: ${await response.text()}`).toBe(403);
    }

    const arrive = { requestId: randomUUID(), version: created.installation.version, action: 'arrive', location: location() };
    const arrived = await json(await own.session.request.post(`${API}/installations/${created.installation.id}/actions`, {
      headers: own.session.headers, data: arrive,
    }));
    expect(arrived.installation.status).toBe('IN_PROGRESS');
    const repeatedArrival = await json(await own.session.request.post(`${API}/installations/${created.installation.id}/actions`, {
      headers: own.session.headers, data: arrive,
    }));
    expect(repeatedArrival.replayed).toBe(true);
    expect(repeatedArrival.installation.version).toBe(arrived.installation.version);
    const stale = await own.session.request.post(`${API}/installations/${created.installation.id}/actions`, {
      headers: own.session.headers, data: { requestId: randomUUID(), version: created.installation.version, action: 'pause', kind: 'REST' },
    });
    expect(stale.status(), await stale.text()).toBe(409);
    expect((await stale.json()).error.code).toBe('INSTALLATION_CONFLICT');
    const detail = await json(await own.session.request.get(`${API}/installations/${created.installation.id}`));
    noFinancialFields(detail);
    expect(detail.events.filter((event: { action: string }) => event.action === 'arrive')).toHaveLength(1);

    const exceptionOrder = await newOrder(admin);
    const exceptionJob = await newInstallation(admin, exceptionOrder.id, owner.id);
    const noGps = await action(own.session, exceptionJob.id, { action: 'arrive' });
    expect(noGps.status(), await noGps.text()).toBe(400);
    expect((await noGps.json()).error.code).toBe('LOCATION_REQUIRED');
    expect((await action(own.session, exceptionJob.id, { action: 'authorize-location-exception', reason: 'El dispositivo no obtiene GPS.' })).status()).toBe(403);
    expect((await action(admin, exceptionJob.id, { action: 'authorize-location-exception', reason: '' })).status()).toBe(400);
    const authorized = await json(await action(admin, exceptionJob.id, {
      action: 'authorize-location-exception', reason: 'Administración confirmó telefónicamente el acceso al sitio sin cobertura GPS.',
    }));
    expect(authorized.installation.locationException).toBe(true);
    const exceptedArrival = await json(await action(own.session, exceptionJob.id, { action: 'arrive' }));
    expect(exceptedArrival.installation.status).toBe('IN_PROGRESS');
    const exceptionHistory = await json(await own.session.request.get(`${API}/installations/${exceptionJob.id}`));
    const arrivalWithoutGps = exceptionHistory.events.find((event: { action: string }) => event.action === 'arrive');
    expect(arrivalWithoutGps.details).toMatchObject({ locationException: true });
    expect(arrivalWithoutGps.details).not.toHaveProperty('location');
  } finally {
    await own.context.close();
    await foreign.context.close();
  }
});

test('interfaz real: Administración asigna y el instalador registra llegada, pausas, fotografía y finalización desde el celular', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const admin = await adminSession(page);
  const owner = await newInstaller(admin);
  const order = await newOrder(admin);
  const installation = await newInstallation(admin, order.id);
  const code = `OT #${String(order.number).padStart(4, '0')}`;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/installations');
  await expect(page.getByRole('heading', { name: 'Gestión de Instalaciones', exact: true })).toBeVisible();
  const open = page.getByRole('button', { name: `Abrir instalación ${code}`, exact: true }).filter({ visible: true });
  await expect(open).toBeVisible();
  for (const width of [1440, 1200, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`administracion-listado-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open.click();
  const adminDialog = page.getByRole('dialog', { name: `${code} · Instalación`, exact: true });
  await adminDialog.getByRole('button', { name: 'Asignar responsable', exact: true }).click();
  await adminDialog.getByLabel('Instalador responsable', { exact: true }).selectOption(owner.id);
  await adminDialog.getByLabel('Motivo del cambio', { exact: true }).fill('Asignación inicial al instalador disponible para el montaje.');
  const assignedResponse = page.waitForResponse(response => response.url().endsWith(`/installations/${installation.id}/actions`) && response.request().method() === 'POST');
  await adminDialog.getByRole('button', { name: 'Guardar cambio', exact: true }).click();
  const assigned = await json(await assignedResponse);
  expect(assigned.installation).toMatchObject({ installerId: owner.id, status: 'ASSIGNED' });
  await expect(adminDialog.getByRole('button', { name: 'Reasignar responsable', exact: true })).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noHorizontalOverflow(page);
    const box = await adminDialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(901);
    await page.screenshot({ path: testInfo.outputPath(`administracion-detalle-${width}.png`), fullPage: false });
  }
  await adminDialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(adminDialog).toHaveCount(0);

  const own = await installerSession(browser, owner.email, true);
  try {
    const mobile = await own.context.newPage();
    await mobile.goto('/installations');
    await expect(mobile.getByRole('heading', { name: 'Mis instalaciones', exact: true })).toBeVisible();
    await expect(mobile.getByRole('link', { name: 'Reportes', exact: true })).toHaveCount(0);
    await expect(mobile.getByRole('link', { name: 'Cartera', exact: true })).toHaveCount(0);
    for (const width of [390, 320]) {
      await mobile.setViewportSize({ width, height: 844 });
      await noHorizontalOverflow(mobile);
      await mobile.screenshot({ path: testInfo.outputPath(`instalador-listado-${width}.png`), fullPage: true });
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.getByRole('button', { name: `Abrir instalación ${code}`, exact: true }).filter({ visible: true }).click();
    const dialog = mobile.getByRole('dialog', { name: `${code} · Instalación`, exact: true });
    await expect(dialog.getByText('No hay seguimiento continuo.', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Abrir OT completa', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'Abrir Maps', exact: true })).toHaveAttribute('href', /google\.com\/maps\/search/);
    await noHorizontalOverflow(mobile);
    await mobile.screenshot({ path: testInfo.outputPath('instalador-mobile-asignada.png'), fullPage: false });

    await own.context.setOffline(true);
    await expect(dialog.getByRole('button', { name: 'Registrar llegada', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText(/No hay conexión/);
    expect((await json(await admin.request.get(`${API}/installations/${installation.id}`))).installation.status).toBe('ASSIGNED');
    await own.context.setOffline(false);
    await expect(dialog.getByRole('button', { name: 'Registrar llegada', exact: true })).toBeEnabled();

    const arrivedResponse = mobile.waitForResponse(response => response.url().endsWith(`/installations/${installation.id}/actions`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Registrar llegada', exact: true }).click();
    expect((await json(await arrivedResponse)).installation.status).toBe('IN_PROGRESS');
    await expect(dialog.getByRole('button', { name: 'Iniciar descanso', exact: true })).toBeVisible();

    for (const pause of ['Iniciar descanso', 'Iniciar almuerzo']) {
      const pausedResponse = mobile.waitForResponse(response => response.url().endsWith(`/installations/${installation.id}/actions`) && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: pause, exact: true }).click();
      await json(await pausedResponse);
      await expect(dialog.getByRole('button', { name: 'Reanudar trabajo', exact: true })).toBeVisible();
      const resumedResponse = mobile.waitForResponse(response => response.url().endsWith(`/installations/${installation.id}/actions`) && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Reanudar trabajo', exact: true }).click();
      await json(await resumedResponse);
      await expect(dialog.getByRole('button', { name: 'Finalizar instalación', exact: true })).toBeVisible();
    }

    await dialog.getByRole('button', { name: 'Finalizar instalación', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Montaje fijado y nivelado', exact: true }).check();
    await dialog.getByLabel('Conexión eléctrica', { exact: true }).selectOption('NOT_APPLICABLE');
    await dialog.getByLabel('Resultado de la instalación', { exact: true }).fill('Aviso instalado, nivelado y revisado con el cliente. No requiere conexión eléctrica.');
    await dialog.getByRole('button', { name: 'Confirmar finalización', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(/fotografía/i);
    const png = await photoBase64(mobile, 'image/png');
    await dialog.getByLabel('Evidencia fotográfica', { exact: true }).setInputFiles({ name: 'montaje.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(dialog.getByRole('button', { name: 'Guardar fotografía', exact: true })).toBeVisible();
    const evidenceResponse = mobile.waitForResponse(response => response.url().endsWith(`/installations/${installation.id}/evidence`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Guardar fotografía', exact: true }).click();
    const evidence = await json(await evidenceResponse, 201);
    expect(evidence.evidence.id).toBeTruthy();
    await expect(dialog.getByText('La instalación tiene una fotografía guardada.', { exact: true })).toBeVisible();
    await noHorizontalOverflow(mobile);
    await mobile.screenshot({ path: testInfo.outputPath('instalador-mobile-cierre.png'), fullPage: false });

    const completedResponse = mobile.waitForResponse(response => response.url().endsWith(`/installations/${installation.id}/actions`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Confirmar finalización', exact: true }).click();
    const completed = await json(await completedResponse);
    expect(completed.installation).toMatchObject({ status: 'COMPLETED', checklist: { mounted: true, electrical: 'NOT_APPLICABLE' } });
    await expect(dialog.getByRole('heading', { name: 'Resultado de la instalación', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Registrar llegada', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Ver fotografía', exact: true }).click();
    const image = dialog.getByAltText(`Evidencia de instalación de ${code}`, { exact: true });
    await expect(image).toBeVisible();
    expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await noHorizontalOverflow(mobile);
    await mobile.screenshot({ path: testInfo.outputPath('instalador-mobile-finalizada.png'), fullPage: false });

    const detail = await json(await own.session.request.get(`${API}/installations/${installation.id}`));
    noFinancialFields(detail);
    const actions = detail.events.map((event: { action: string }) => event.action);
    expect(actions.filter((name: string) => name === 'arrive')).toHaveLength(1);
    expect(actions.filter((name: string) => name === 'pause')).toHaveLength(2);
    expect(actions.filter((name: string) => name === 'resume')).toHaveLength(2);
    expect(actions.filter((name: string) => name === 'complete')).toHaveLength(1);
    expect(detail.events.filter((event: { action: string }) => ['arrive', 'complete'].includes(event.action)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ details: expect.objectContaining({ location: expect.objectContaining({ latitude: 7.1193, longitude: -73.1227, accuracy: 12 }) }) })]));
    expect((await json(await admin.request.get(`${API}/orders/${order.id}`))).order.status).toBe('INSTALLED');
    const privatePhoto = await own.session.request.get(`${API}/installations/${installation.id}/evidence/${evidence.evidence.id}`);
    expect(privatePhoto.status()).toBe(200);
    expect(privatePhoto.headers()['content-type']).toMatch(/^image\/jpeg/);
    expect(privatePhoto.headers()['cache-control']).toContain('no-store');
  } finally { await own.context.close(); }
});

test('equipos: dos instaladores comparten el trabajo y registran su jornada sin otorgar acceso a terceros al editar el equipo', async ({ page, browser }, testInfo) => {
  test.setTimeout(210_000);
  const admin = await adminSession(page);
  const leader = await newInstaller(admin);
  const member = await newInstaller(admin);
  const outsider = await newInstaller(admin);
  const order = await newOrder(admin);
  const teamName = `Equipo de montaje E2E ${randomUUID().slice(0, 8)}`;
  const createdTeam = await json(await admin.request.post(`${API}/installations/teams`, {
    headers: admin.headers, data: { requestId: randomUUID(), name: teamName, memberIds: [leader.id, member.id], leaderId: leader.id, active: true },
  }), 201);
  const created = await json(await admin.request.post(`${API}/installations`, {
    headers: admin.headers, data: { ...installationInput(order.id), teamId: createdTeam.team.id },
  }), 201);
  const id = created.installation.id;
  expect(created.installation.installerId).toBe(leader.id);
  expect(created.installation.members.map((person: { userId: string }) => person.userId).sort()).toEqual([leader.id, member.id].sort());

  await json(await admin.request.patch(`${API}/installations/teams/${createdTeam.team.id}`, {
    headers: admin.headers, data: { requestId: randomUUID(), version: createdTeam.team.version, name: `${teamName} editado`, memberIds: [leader.id, outsider.id], leaderId: leader.id },
  }));
  const snapshot = await json(await admin.request.get(`${API}/installations/${id}`));
  expect(snapshot.installation.members.map((person: { userId: string }) => person.userId).sort()).toEqual([leader.id, member.id].sort());

  const own = await installerSession(browser, leader.email);
  const colleague = await installerSession(browser, member.email);
  const foreign = await installerSession(browser, outsider.email);
  try {
    for (const current of [own.session, colleague.session]) {
      const list = await json(await current.request.get(`${API}/installations`));
      expect(list.items.map((item: InstallationFixture) => item.id)).toContain(id);
      noFinancialFields(list);
    }
    expect((await foreign.session.request.get(`${API}/installations/${id}`)).status()).toBe(404);
    expect((await json(await foreign.session.request.get(`${API}/installations`))).items).toHaveLength(0);
    const mobile = await colleague.context.newPage();
    await mobile.goto(`/installations?installation=${id}`);
    const code = `OT #${String(order.number).padStart(4, '0')}`;
    const dialog = mobile.getByRole('dialog', { name: `${code} · Instalación`, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Registrar llegada', exact: true })).toBeVisible();
    await noHorizontalOverflow(mobile);
    await mobile.screenshot({ path: testInfo.outputPath('equipo-mobile-asignado.png'), fullPage: false });

    await json(await action(own.session, id, { action: 'arrive', location: location() }));
    const memberPending = await json(await colleague.session.request.get(`${API}/installations?status=ASSIGNED`));
    expect(memberPending.items.map((item: InstallationFixture) => item.id)).toContain(id);
    const leaderPending = await json(await own.session.request.get(`${API}/installations?status=ASSIGNED`));
    expect(leaderPending.items.map((item: InstallationFixture) => item.id)).not.toContain(id);
    await mobile.goto('/installations?status=ASSIGNED');
    await expect(mobile.getByRole('button', { name: `Abrir instalación ${code}`, exact: true }).filter({ visible: true })).toBeVisible();
    await json(await action(colleague.session, id, { action: 'arrive', location: location() }));
    const paused = await json(await action(own.session, id, { action: 'pause', kind: 'REST' }));
    expect(paused.installation.members.find((person: { userId: string }) => person.userId === leader.id).status).toBe('PAUSED');
    expect(paused.installation.members.find((person: { userId: string }) => person.userId === member.id).status).toBe('IN_PROGRESS');
    await json(await action(own.session, id, { action: 'resume' }));
    const memberPause = await json(await action(colleague.session, id, { action: 'pause', kind: 'LUNCH' }));
    expect(memberPause.installation.status).toBe('IN_PROGRESS');
    const memberPaused = await json(await colleague.session.request.get(`${API}/installations?status=PAUSED`));
    expect(memberPaused.items.map((item: InstallationFixture) => item.id)).toContain(id);
    const leaderPaused = await json(await own.session.request.get(`${API}/installations?status=PAUSED`));
    expect(leaderPaused.items.map((item: InstallationFixture) => item.id)).not.toContain(id);
    await mobile.goto('/installations?status=PAUSED');
    await expect(mobile.getByRole('button', { name: `Abrir instalación ${code}`, exact: true }).filter({ visible: true })).toBeVisible();
    await json(await action(colleague.session, id, { action: 'resume' }));

    const current = await json(await own.session.request.get(`${API}/installations/${id}`));
    const photo = await json(await own.session.request.post(`${API}/installations/${id}/evidence`, {
      headers: own.session.headers, data: { requestId: randomUUID(), version: current.installation.version, imageBase64: await photoBase64(page) },
    }), 201);
    const complete = { action: 'complete', result: 'Trabajo en equipo terminado y verificado.', checklist: { mounted: true, electrical: 'NOT_APPLICABLE' }, photoId: photo.evidence.id, location: location() };
    const premature = await action(own.session, id, complete);
    expect(premature.status(), await premature.text()).toBe(409);
    const notLeader = await action(colleague.session, id, complete);
    expect(notLeader.status(), await notLeader.text()).toBe(403);

    const checkout = await json(await action(colleague.session, id, { action: 'checkout', location: location() }));
    expect(checkout.installation.members.find((person: { userId: string }) => person.userId === member.id).status).toBe('CHECKED_OUT');
    const ownDeparture = await json(await colleague.session.request.get(`${API}/installations?status=CHECKED_OUT`));
    expect(ownDeparture.items.map((item: InstallationFixture) => item.id)).toContain(id);
    const leaderDeparture = await json(await own.session.request.get(`${API}/installations?status=CHECKED_OUT`));
    expect(leaderDeparture.items.map((item: InstallationFixture) => item.id)).not.toContain(id);
    await mobile.goto(`/installations?status=CHECKED_OUT&installation=${id}`);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Tu salida ya está guardada.', { exact: false })).toBeVisible();
    const completed = await json(await action(own.session, id, { ...complete, location: location() }));
    expect(completed.installation.status).toBe('COMPLETED');
    expect(completed.installation.members.every((person: { status: string }) => person.status === 'CHECKED_OUT')).toBe(true);
    expect((await json(await admin.request.get(`${API}/orders/${order.id}`))).order.status).toBe('INSTALLED');
    expect((await foreign.session.request.get(`${API}/installations/${id}/evidence/${photo.evidence.id}`)).status()).toBe(404);
    const detail = await json(await own.session.request.get(`${API}/installations/${id}`));
    noFinancialFields(detail);
    const arrivalActors = detail.events.filter((event: { action: string }) => event.action === 'arrive').map((event: { actor: { id: string } }) => event.actor.id).sort();
    expect(arrivalActors).toEqual([leader.id, member.id].sort());
    const checkoutEvent = detail.events.find((event: { action: string }) => event.action === 'checkout');
    expect(checkoutEvent.actor.id).toBe(member.id);
    expect(checkoutEvent.details.location).toMatchObject({ latitude: 7.1193, longitude: -73.1227, accuracy: 12 });
    for (const currentSession of [own.session, colleague.session]) {
      expect((await json(await currentSession.request.get(`${API}/installations`))).metrics.completedThisMonth).toBe(1);
    }
    await mobile.reload();
    await expect(dialog.getByRole('heading', { name: 'Resultado de la instalación', exact: true })).toBeVisible();
    await noHorizontalOverflow(mobile);
    await mobile.screenshot({ path: testInfo.outputPath('equipo-mobile-finalizado.png'), fullPage: false });
  } finally {
    await own.context.close();
    await colleague.context.close();
    await foreign.context.close();
  }
});

// All data belongs to the ephemeral PGlite server configured by playwright.api.config.ts.
// No existing production accounts, orders, photographs or locations are accessed.
