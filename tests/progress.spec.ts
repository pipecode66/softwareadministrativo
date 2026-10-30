import { expect, test, type Page } from '@playwright/test';
import { LOCAL_REVIEW_PASSWORD, makeSeed } from '../src/data/seed';
import { formatCOP } from '../src/domain/utils';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(seed => {
    if (!localStorage.getItem('intermedios.frontend.v1')) localStorage.setItem('intermedios.frontend.v1', JSON.stringify(seed));
  }, makeSeed());
});
async function login(page:Page) {
  await page.goto('/login');
  await page.getByLabel('Usuario o correo').fill('adminmaster@intermedios.local');
  await page.getByLabel('Contraseña', { exact:true }).fill(LOCAL_REVIEW_PASSWORD);
  await page.getByRole('button', { name:'Ingresar al sistema' }).click();
  await expect(page).toHaveURL(/\/$/);
}
const nav=(page:Page,name:string)=>page.locator('.app-sidebar').getByRole('link',{name,exact:true});

test('conserva OT incompleta, documento FACT y nuevo cliente al cambiar de sección',async({page})=>{
  await login(page);
  await page.getByRole('link',{name:'Crear nueva orden'}).click();
  const form=page.locator('[data-page-path="/orders/new"]');
  await form.getByRole('radio',{name:/FACT/}).check();
  await form.getByLabel('Descripción del producto *').fill('Trabajo sin guardar que debe conservarse');
  await form.getByRole('button',{name:'Nuevo cliente',exact:true}).click();
  await form.getByLabel('Nombre / razón social *').fill('Cliente todavía sin guardar');
  await form.getByLabel('Celular *').fill('3111234567');
  await nav(page,'Cartera').click();
  await expect(page.getByRole('heading',{name:'Cartera',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Crear nueva orden'}).click();
  await expect(form.getByRole('radio',{name:/FACT/})).toBeChecked();
  await expect(form.getByLabel('Descripción del producto *')).toHaveValue('Trabajo sin guardar que debe conservarse');
  await expect(form.getByLabel('Nombre / razón social *')).toHaveValue('Cliente todavía sin guardar');
  await expect(form.getByLabel('Celular *')).toHaveValue('3111234567');
});

test('conserva ventana de cliente y filtros sin mostrar ventanas ocultas en otra sección',async({page})=>{
  await login(page);
  await nav(page,'Clientes').click();
  await page.getByRole('button',{name:'Nuevo cliente',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Nombre o razón social *').fill('Cliente pendiente de registro');
  await dialog.getByLabel('Celular *').fill('3001112222');
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page,'Clientes').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Nombre o razón social *')).toHaveValue('Cliente pendiente de registro');
  await expect(dialog.getByLabel('Celular *')).toHaveValue('3001112222');
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await nav(page,'Órdenes').click();
  const search=page.getByRole('searchbox',{name:'Buscar órdenes'});
  await search.fill('SuperGiros');
  await nav(page,'Cartera').click();
  await nav(page,'Órdenes').click();
  await expect(search).toHaveValue('SuperGiros');
  await expect(page).toHaveURL(/q=SuperGiros/);
});

test('eliminar un borrador descarta también su pantalla conservada',async({page})=>{
  await login(page);
  await page.getByRole('link',{name:'Crear nueva orden'}).click();
  const form=page.locator('[data-page-path="/orders/new"]');
  await form.getByLabel('Descripción del producto *').fill('Borrador para descartar explícitamente');
  await nav(page,'Órdenes').click();
  await expect(page.getByRole('region',{name:'Borrador de orden'})).toBeVisible();
  await page.getByRole('button',{name:'Eliminar borrador',exact:true}).click();
  await expect(page.getByRole('region',{name:'Borrador de orden'})).toHaveCount(0);
  await page.getByRole('link',{name:'Crear nueva orden'}).click();
  await expect(form.getByLabel('Descripción del producto *')).toHaveValue('');
});

test('administración corrige un abono desde la OT y se recalcula el saldo',async({page})=>{
  const order=makeSeed().orders.find(item=>item.payments.length>0)!;
  const original=order.payments[0];
  await login(page);
  await page.goto(`/orders/${order.id}`);
  await page.getByRole('button',{name:`Corregir pago de ${formatCOP(original.amount)}`,exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Valor corregido (COP)').fill(String(original.amount/2));
  await dialog.getByLabel('Medio de pago corregido').selectOption('DAVIVIENDA');
  await dialog.getByRole('button',{name:'Guardar corrección',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const updated=await page.evaluate(id=>JSON.parse(localStorage.getItem('intermedios.frontend.v1')!).orders.find((item:{id:string})=>item.id===id),order.id);
  expect(updated.payments.find((item:{id:string})=>item.id===original.id)).toMatchObject({amount:original.amount/2,method:'DAVIVIENDA'});
});
