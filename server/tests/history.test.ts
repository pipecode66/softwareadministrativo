import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/bootstrap.js';
import { readConfig } from '../src/config.js';
import type { PublicUser, Role } from '../src/contracts.js';
import { createPgliteDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import type { Database } from '../src/db/types.js';

const API='/api/v1', ORIGIN='http://127.0.0.1:5173', PASSWORD='Una clave ficticia para auditoría 2026!';
const config=readConfig({NODE_ENV:'test',APP_ORIGINS:ORIGIN,LOGIN_RATE_LIMIT:'100'});
type Session={cookie:string;csrf:string;user:PublicUser};
let db:Database,app:Express,admin:Session,printer:Session,clientId:string;
function sessionOf(response:Response):Session{const raw=response.headers['set-cookie'] as string[]|string|undefined;const values=!raw?[]:Array.isArray(raw)?raw:[raw];return{cookie:values.map(v=>v.split(';')[0]).join('; '),csrf:response.body.csrfToken,user:response.body.user};}
async function login(email:string){return sessionOf(await request(app).post(`${API}/auth/login`).set('Origin',ORIGIN).send({email,password:PASSWORD}));}
async function actor(role:Role){const id=randomUUID(),email=`${role.toLowerCase()}-${id}@example.test`;await db.query(`INSERT INTO users(id,name,email,role,password_hash,must_change_password) SELECT $1,$2,$3,$4,password_hash,false FROM users WHERE id=$5`,[id,`Usuario ${role}`,email,role,admin.user.id]);return login(email);}
function get(path:string,session=admin){return request(app).get(`${API}${path}`).set('Cookie',session.cookie);}
function post(path:string,payload:object,session=admin){return request(app).post(`${API}${path}`).set('Origin',ORIGIN).set('Cookie',session.cookie).set('X-CSRF-Token',session.csrf).send(payload);}
function patch(path:string,payload:object,session=admin){return request(app).patch(`${API}${path}`).set('Origin',ORIGIN).set('Cookie',session.cookie).set('X-CSRF-Token',session.csrf).send(payload);}

beforeAll(async()=>{db=await createPgliteDatabase();await migrate(db);});
beforeEach(async()=>{await db.exec('TRUNCATE order_events,payments,orders,clients,users RESTART IDENTITY CASCADE');await bootstrapAdmin(db,{name:'Admin auditoría',email:'audit@example.test',password:PASSWORD});app=await createApp(db,config);admin=await login('audit@example.test');printer=await actor('IMPRESION');clientId=randomUUID();await db.query(`INSERT INTO clients(id,name,identification,phone,special_payment) VALUES($1,'Cliente auditoría','NIT-1','3000000000',true)`,[clientId]);});
afterAll(async()=>db.close());

describe('Historial de OT',()=>{
  it('muestra responsable, fecha, OT y detalle; limita el módulo global a Administración',async()=>{
    const product={description:'Banner inicial',quantity:1,unitValue:1000,materials:[{material:'Banner',length:1,width:1}],activities:[{area:'PRINTING',printingType:'PRINT'}]};
    const created=await post('/orders',{clientId,description:'1. Banner inicial',value:1000,documentType:'REM',category:'Proyecto',route:'PRINT_ONLY',requiresInstallation:false,products:[product],requestId:randomUUID()});
    expect(created.status).toBe(201);
    const order=created.body.order;
    const edited=await patch(`/orders/${order.id}`,{clientId,description:'1. Banner corregido',value:2000,documentType:'REM',category:'Proyecto',route:'PRINT_ONLY',requiresInstallation:false,products:[{...product,description:'Banner corregido',unitValue:2000}],expectedVersion:order.version});
    expect(edited.status).toBe(200);
    const global=await get('/history');
    expect(global.status).toBe(200);
    expect(global.body.items[0]).toMatchObject({orderId:order.id,orderNumber:1,action:'edit',actor:{name:'Admin auditoría',role:'ADMINMASTER'},details:{summary:'Editó la orden de trabajo.'}});
    expect(global.body.items[0].occurredAt).toBeTruthy();
    expect(global.body.items[0].details.changes).toEqual(expect.arrayContaining([expect.objectContaining({label:'Valor base',before:'1000.00',after:'2000.00'})]));
    expect((await get('/history',printer)).status).toBe(403);
    const inside=await get(`/history?orderId=${order.id}`,printer);
    expect(inside.status).toBe(200);
    expect(inside.body.items[0].actor.name).toBe('Admin auditoría');
    expect(inside.body.items[0].details.changes.some((change:{label:string})=>change.label==='Valor base')).toBe(false);
  });
});
