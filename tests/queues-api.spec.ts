import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type Page } from '@playwright/test';

const API='/api/v1',ORIGIN='http://127.0.0.1:5174';
const TEMP='Clave temporal bandejas 2026!',PERSONAL='Clave personal bandejas 2026!';
type Session={request:APIRequestContext;headers:Record<string,string>};
type Product={description:string;quantity:number;unitValue:number;materials:{material:string;length:number;width:number}[];
  activities:{area:string;assignedUserId?:string}[]};
async function json(response:APIResponse,status=200) {
  expect(response.status(),await response.text()).toBe(status);return response.json();
}
async function adminSession(page:Page):Promise<Session> {
  const body=await json(await page.request.post(`${API}/auth/login`,{headers:{Origin:ORIGIN},
    data:{email:'api-e2e@example.test',password:'Una clave E2E segura 2026!'}}));
  return {request:page.request,headers:{Origin:ORIGIN,'X-CSRF-Token':body.csrfToken}};
}
async function createUser(admin:Session,role:string) {
  const email=`queue-${randomUUID()}@example.test`;
  const body=await json(await admin.request.post(`${API}/users`,{headers:admin.headers,
    data:{name:`Persona ${role}`,email,role,active:true,password:TEMP}}),201);
  return {...body.user,email};
}
async function roleSession(browser:Browser,email:string) {
  const context=await browser.newContext({baseURL:ORIGIN,viewport:{width:390,height:844},locale:'es-CO',timezoneId:'America/Bogota'});
  const login=await json(await context.request.post(`${API}/auth/login`,{headers:{Origin:ORIGIN},data:{email,password:TEMP}}));
  const changed=await json(await context.request.post(`${API}/auth/password`,{headers:{Origin:ORIGIN,'X-CSRF-Token':login.csrfToken},
    data:{currentPassword:TEMP,newPassword:PERSONAL}}));
  const page=await context.newPage();
  return {context,page,request:context.request,headers:{Origin:ORIGIN,'X-CSRF-Token':changed.csrfToken}};
}
async function createOrder(admin:Session,products:Product[],route:string) {
  const {client}=await json(await admin.request.post(`${API}/clients`,{headers:admin.headers,
    data:{name:`Cliente OT agrupada ${randomUUID()}`,phone:'3001234567',specialPayment:true}}),201);
  const {order}=await json(await admin.request.post(`${API}/orders`,{headers:admin.headers,data:{requestId:randomUUID(),
    clientId:client.id,description:products.map(product=>product.description).join('\n'),
    value:products.reduce((sum,product)=>sum+product.quantity*product.unitValue,0),
    documentType:'REM',category:'Proyecto',route,requiresInstallation:false,products}}),201);
  return order;
}
async function noOverflow(page:Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
function card(page:Page,id:string) {return page.locator(`.ops-activity-section .ops-activity-card[data-order-id="${id}"]`);}
function noCommercialFields(value:unknown) {
  if(Array.isArray(value)) {value.forEach(noCommercialFields);return;}
  if(!value||typeof value!=='object') return;
  for(const [key,item] of Object.entries(value)) {
    expect(['unitValue','lineTotal','financials','payments','value','reteFuente','reteIva','ica']).not.toContain(key);
    noCommercialFields(item);
  }
}

test('una sola tarjeta por OT conserva productos y acciones independientes en Diseño, Impresión y Taller',async({page,browser},testInfo)=>{
  test.setTimeout(150_000);
  const admin=await adminSession(page);
  const designer=await createUser(admin,'DISENO'),printer=await createUser(admin,'IMPRESION'),workshop=await createUser(admin,'TALLER');
  const order=await createOrder(admin,['Servicio de Carro Valla','Juego de lonas'].map(description=>({
    description,quantity:1,unitValue:50000,materials:[{material:'Panaflex',length:6,width:2}],
    activities:[{area:'DESIGN',assignedUserId:designer.id},{area:'PRINTING'},{area:'WORKSHOP'}],
  })),'PRINT_WORKSHOP');
  const design=await roleSession(browser,designer.email),print=await roleSession(browser,printer.email),shop=await roleSession(browser,workshop.email);
  try {
    await design.page.goto('/design');
    const designCard=card(design.page,order.id);
    await expect(designCard).toHaveCount(1);
    await expect(designCard.locator('.ops-product-activity')).toHaveCount(2);
    await expect(designCard.getByRole('link',{name:'Ver OT',exact:true})).toHaveCount(1);
    for(const width of [1440,768,390,320]) {
      await design.page.setViewportSize({width,height:900});await noOverflow(design.page);
    }
    await design.page.screenshot({path:testInfo.outputPath('diseno-320.png'),fullPage:true});
    const first=designCard.locator('.ops-product-activity').filter({hasText:'Servicio de Carro Valla'});
    const second=designCard.locator('.ops-product-activity').filter({hasText:'Juego de lonas'});
    await first.getByRole('button',{name:'Iniciar',exact:true}).click();
    await first.getByRole('button',{name:'Finalizar',exact:true}).click();
    await expect(designCard.locator('.ops-activity-top')).toContainText('En proceso');
    await expect(second.getByRole('button',{name:'Iniciar',exact:true})).toBeEnabled();
    await second.getByRole('button',{name:'Iniciar',exact:true}).click();
    await second.getByRole('button',{name:'Finalizar',exact:true}).click();
    await expect(designCard.locator('.ops-activity-top')).toContainText('Terminada');
    noCommercialFields(await json(await design.request.get(`${API}/work/queue?area=DESIGN`)));

    await print.page.goto('/printing');
    const printCard=card(print.page,order.id);await expect(printCard).toHaveCount(1);
    await expect(printCard.locator('.ops-product-activity')).toHaveCount(2);
    for(const description of ['Servicio de Carro Valla','Juego de lonas']) {
      const product=printCard.locator('.ops-product-activity').filter({hasText:description});
      await product.getByRole('button',{name:'Iniciar',exact:true}).click();
      await product.getByLabel('Quién recibe en Taller *',{exact:true}).fill('Responsable de Taller');
      await product.getByRole('button',{name:'Finalizar',exact:true}).click();
      if(description==='Servicio de Carro Valla') await expect(printCard.locator('.ops-activity-top')).toContainText('En proceso');
    }
    await expect(printCard.locator('.ops-activity-top')).toContainText('Terminada');await noOverflow(print.page);
    noCommercialFields(await json(await print.request.get(`${API}/work/queue?area=PRINTING`)));

    await shop.page.goto('/workshop');const shopCard=card(shop.page,order.id);await expect(shopCard).toHaveCount(1);
    for(const description of ['Servicio de Carro Valla','Juego de lonas']) {
      const product=shopCard.locator('.ops-product-activity').filter({hasText:description});
      await product.getByRole('button',{name:'Iniciar',exact:true}).click();
      await product.getByLabel('Observaciones de Taller',{exact:true}).fill(`Observación de ${description}`);
      await product.getByRole('button',{name:'Finalizar',exact:true}).click();
    }
    await expect(shopCard.locator('.ops-activity-top')).toContainText('Terminada');await noOverflow(shop.page);
    const result=await json(await admin.request.get(`${API}/orders/${order.id}`));
    expect(result.order).toMatchObject({id:order.id,number:order.number,value:100000,status:'COMPLETED'});
    await page.goto('/design');await page.setViewportSize({width:1440,height:1000});
    await expect(card(page,order.id)).toHaveCount(1);
    await page.screenshot({path:testInfo.outputPath('administracion-1440.png'),fullPage:true});
    await card(page,order.id).getByRole('link',{name:'Ver OT',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
    await expect(page.getByRole('heading',{name:'Productos y actividades',exact:true})).toBeVisible();
  } finally {await design.context.close();await print.context.close();await shop.context.close();}
});

test('la paginación cuenta OT y mantiene juntos más de doce productos de una misma orden',async({page},testInfo)=>{
  test.setTimeout(120_000);
  const admin=await adminSession(page);
  const product=(description:string):Product=>({description,quantity:1,unitValue:1000,materials:[],activities:[{area:'WORKSHOP'}]});
  const many=await createOrder(admin,Array.from({length:13},(_,index)=>product(`Producto agrupado ${index+1}`)),'WORKSHOP_ONLY');
  for(let index=0;index<12;index++) await createOrder(admin,[product(`OT separada ${index+1}`)],'WORKSHOP_ONLY');
  await page.goto('/workshop');
  const section=page.locator('.ops-activity-section');
  await expect(section.locator('.ops-activity-card')).toHaveCount(12);
  await expect(card(page,many.id)).toHaveCount(0);
  await section.getByRole('button',{name:'Página siguiente',exact:true}).click();
  const manyCard=card(page,many.id);await expect(manyCard).toHaveCount(1);
  await expect(manyCard.locator('.ops-product-activity')).toHaveCount(13);
  await expect(manyCard.getByText('Producto agrupado 13',{exact:true})).toBeVisible();
  await expect(manyCard.getByRole('link',{name:'Ver OT',exact:true})).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});await noOverflow(page);
  await page.screenshot({path:testInfo.outputPath('trece-productos-390.png'),fullPage:true});
  const grouped=await json(await admin.request.get(`${API}/work/queue?area=WORKSHOP&page=13&pageSize=1`));
  expect(grouped.items).toHaveLength(1);expect(grouped.items[0].orderId).toBe(many.id);
  expect(grouped.items[0].activities).toHaveLength(13);
});
