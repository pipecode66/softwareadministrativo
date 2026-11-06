import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { dateOnly, formatCOP } from '../src/domain/utils';

const API='/api/v1',ORIGIN='http://127.0.0.1:5174';
async function json(response:Pick<APIResponse,'status'|'text'|'json'>,status=200) {
  expect(response.status(),await response.text()).toBe(status);return response.json();
}
async function adminSession(page:Page) {
  const login=await json(await page.request.post(`${API}/auth/login`,{headers:{Origin:ORIGIN},
    data:{email:'api-e2e@example.test',password:'Una clave E2E segura 2026!'}}));
  const headers={Origin:ORIGIN,'X-CSRF-Token':login.csrfToken};
  return {headers,actor:login.user};
}
async function fixture(page:Page,headers:Record<string,string>,clientId?:string) {
  if(!clientId) clientId=(await json(await page.request.post(`${API}/clients`,{headers,
    data:{name:`Cliente borrar abono ${randomUUID()}`,phone:'3001234567',specialPayment:true}}),201)).client.id;
  const {order}=await json(await page.request.post(`${API}/orders`,{headers,data:{requestId:randomUUID(),clientId,
    description:'Trabajo con pagos corregibles',value:100000,documentType:'REM',category:'Proyecto',
    route:'WORKSHOP_ONLY',requiresInstallation:false,
    products:[{description:'Trabajo con pagos corregibles',quantity:1,unitValue:100000,materials:[],activities:[{area:'WORKSHOP'}]}]}}),201);
  return order;
}

test('eliminar abono desde Corregir exige confirmación y actualiza saldo, cartera, reportes e historial en una OT cerrada',async({page},testInfo)=>{
  test.setTimeout(120_000);
  const {headers,actor}=await adminSession(page);
  let order=await fixture(page,headers);
  const day=dateOnly();
  const firstRequest={requestId:randomUUID(),date:day,amount:25000,method:'BANCOLOMBIA'};
  order=(await json(await page.request.post(`${API}/orders/${order.id}/payments`,{headers,data:firstRequest}),201)).order;
  const target=order.payments[0];
  order=(await json(await page.request.post(`${API}/orders/${order.id}/payments`,{headers,
    data:{requestId:randomUUID(),date:day,amount:15000,method:'EFECTIVO'}}),201)).order;
  const other=order.payments.find((payment:{id:string})=>payment.id!==target.id);
  const activity=(await json(await page.request.get(`${API}/work/activities?orderId=${order.id}`))).items[0];
  await json(await page.request.post(`${API}/work/activities/${activity.id}/start`,{headers,data:{}}));
  await json(await page.request.post(`${API}/work/activities/${activity.id}/complete`,{headers,data:{}}));
  order=(await json(await page.request.get(`${API}/orders/${order.id}`))).order;
  order=(await json(await page.request.post(`${API}/orders/${order.id}/transitions`,{headers,data:{expectedVersion:order.version,action:'close'}}))).order;
  const salesPath=`${API}/reports/sales?from=${day}&to=${day}`;
  const portfolioPath=`${API}/reports/portfolio?cutoff=${day}`;
  const beforeSales=await json(await page.request.get(salesPath));
  const beforePortfolio=await json(await page.request.get(portfolioPath));
  await page.goto(`/orders/${order.id}`);
  const openCorrection=()=>page.getByRole('button',{name:`Corregir pago de ${formatCOP(target.amount)}`,exact:true}).click();
  await openCorrection();
  const dialog=page.getByRole('dialog',{name:'Corregir pago',exact:true});
  await dialog.getByLabel('Valor corregido (COP)',{exact:true}).fill('1');
  await dialog.getByRole('checkbox',{name:'Eliminar abono',exact:true}).check();
  await expect(dialog.getByRole('button',{name:'Eliminar abono',exact:true})).toBeEnabled();
  await expect(dialog.getByLabel('Valor corregido (COP)',{exact:true})).not.toBeVisible();
  await expect(dialog).toContainText(formatCOP(25000));
  expect((await json(await page.request.get(`${API}/orders/${order.id}`))).order.payments).toHaveLength(2);
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await openCorrection();await dialog.getByRole('checkbox',{name:'Eliminar abono',exact:true}).check();
  await page.setViewportSize({width:320,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('eliminar-abono-320.png'),fullPage:false});
  const deletionResponse=page.waitForResponse(response=>response.request().method()==='DELETE'&&response.url().endsWith(`/payments/${target.id}`));
  await dialog.getByRole('button',{name:'Eliminar abono',exact:true}).click();
  const deleted=(await json(await deletionResponse)).order;
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.order-balance-highlight')).toContainText(formatCOP(85000));
  expect(deleted).toMatchObject({id:order.id,number:order.number,status:'COMPLETED',closedAt:order.closedAt,isComposite:true,
    financials:{paid:15000,balance:85000},payments:[{id:other.id,amount:15000}]});
  expect(deleted.version).toBe(order.version+1);
  const afterSales=await json(await page.request.get(salesPath));
  expect(afterSales.totals.received).toBe(beforeSales.totals.received-25000);
  expect(afterSales.totals.base).toBe(beforeSales.totals.base);
  const afterPortfolio=await json(await page.request.get(portfolioPath));
  expect(afterPortfolio.totalBalance).toBe(beforePortfolio.totalBalance+25000);
  const history=await json(await page.request.get(`${API}/history?orderId=${order.id}`));
  const event=history.items.find((item:{action:string})=>item.action==='paymentDeletion');
  expect(event.actor.id).toBe(actor.id);expect(new Date(event.occurredAt).getTime()).toBeGreaterThan(Date.now()-30000);
  await expect(page.getByText(event.details.summary,{exact:true})).toBeVisible();
  const repeated=await json(await page.request.delete(`${API}/orders/${order.id}/payments/${target.id}`,{headers,data:{expectedVersion:order.version}}));
  expect(repeated.order.version).toBe(deleted.version);
  expect((await page.request.post(`${API}/orders/${order.id}/payments`,{headers,data:firstRequest})).status()).toBe(409);
});

test('eliminar asignaciones de un multiabono conserva otros pagos y el reenvío original no los recrea',async({page})=>{
  const {headers}=await adminSession(page);
  const first=await fixture(page,headers),second=await fixture(page,headers,first.clientId);
  const payload={requestId:randomUUID(),clientId:first.clientId,selectedOrderIds:[first.id,second.id],date:dateOnly(),amount:150000,method:'DAVIVIENDA'};
  const batch=await json(await page.request.post(`${API}/orders/bulk-payments`,{headers,data:payload}),201);
  const firstBefore=(await json(await page.request.get(`${API}/orders/${first.id}`))).order;
  await json(await page.request.delete(`${API}/orders/${first.id}/payments/${firstBefore.payments[0].id}`,{headers,data:{expectedVersion:firstBefore.version}}));
  const secondBefore=(await json(await page.request.get(`${API}/orders/${second.id}`))).order;
  expect(secondBefore.financials).toMatchObject({paid:50000,balance:50000});
  const replay=await json(await page.request.post(`${API}/orders/bulk-payments`,{headers,data:payload}));
  expect(replay).toMatchObject({batchId:batch.batchId,amount:50000,replayed:true,allocations:[{orderId:second.id,amount:50000}]});
  await json(await page.request.delete(`${API}/orders/${second.id}/payments/${secondBefore.payments[0].id}`,{headers,data:{expectedVersion:secondBefore.version}}));
  const empty=await json(await page.request.post(`${API}/orders/bulk-payments`,{headers,data:payload}));
  expect(empty).toMatchObject({batchId:batch.batchId,amount:0,replayed:true,allocations:[]});
  for(const item of [first,second]) expect((await json(await page.request.get(`${API}/orders/${item.id}`))).order.financials).toMatchObject({paid:0,balance:100000});
});
