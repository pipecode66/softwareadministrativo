import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/bootstrap.js';
import { readConfig } from '../src/config.js';
import { createPgliteDatabase } from '../src/db/database.js';
import type { Database } from '../src/db/types.js';

const API='/api/v1',ORIGIN='http://127.0.0.1:5173';
let db:Database|undefined;
afterAll(async()=>{await db?.close();});

describe('Publicación de Instalaciones antes de aplicar SQL',()=>{
  it('conserva la edición de OT y activa el módulo en la misma app al completar las migraciones',async()=>{
    // Fresh isolated database: reproduce manual Supabase SQL without running the CLI migrator.
    db=await createPgliteDatabase();
    const directory=new URL('../migrations/',import.meta.url);
    const files=(await readdir(directory)).filter(name=>/^\d+_[\w-]+\.sql$/.test(name)).sort();
    for(const name of files.filter(name=>Number(name.slice(0,3))<=14)) {
      await db.exec(await readFile(new URL(name,directory),'utf8'));
    }
    const email='release-master@example.test',password='Clave privada de publicación 2026!';
    await bootstrapAdmin(db,{name:'Administración',email,password});
    const app=await createApp(db,readConfig({NODE_ENV:'test',APP_ORIGINS:ORIGIN}));
    const login=await request(app).post(`${API}/auth/login`).set('Origin',ORIGIN).send({email,password});
    expect(login.status).toBe(200);
    const header=login.headers['set-cookie'];
    const cookie=(Array.isArray(header)?header:[header]).map(value=>value.split(';')[0]).join('; ');
    const csrf=login.body.csrfToken;
    const clientId=randomUUID();
    await db.query('INSERT INTO clients(id,name,phone,special_payment) VALUES($1,$2,$3,true)',
      [clientId,'Cliente de entrega','3001234567']);
    const input={clientId,description:'Trabajo existente',value:100000,documentType:'REM',
      category:'Proyecto',route:'WORKSHOP_ONLY',requiresInstallation:false};
    const created=await request(app).post(`${API}/orders`).set('Origin',ORIGIN).set('Cookie',cookie)
      .set('X-CSRF-Token',csrf).send({...input,requestId:randomUUID()});
    expect(created.status,JSON.stringify(created.body)).toBe(201);
    const edit=(description:string,version:number)=>request(app).patch(`${API}/orders/${created.body.order.id}`)
      .set('Origin',ORIGIN).set('Cookie',cookie).set('X-CSRF-Token',csrf)
      .send({...input,description,expectedVersion:version});
    const edited=await edit('Corrección previa al SQL',created.body.order.version);
    expect(edited.status,JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.order.description).toBe('Corrección previa al SQL');
    const pending=await request(app).get(`${API}/installations`).set('Cookie',cookie);
    expect(pending.status).toBe(503);
    expect(pending.body.error.code).toBe('INSTALLATIONS_SETUP_REQUIRED');
    expect(pending.body.error.message).toContain('015 y 016');
    // Authorization precedes schema details, including while installation SQL is pending.
    expect((await request(app).get(`${API}/installations`)).status).toBe(401);

    for(const name of files.filter(name=>[15,16].includes(Number(name.slice(0,3))))) {
      await db.exec(await readFile(new URL(name,directory),'utf8'));
    }
    const activated=await request(app).get(`${API}/installations`).set('Cookie',cookie);
    expect(activated.status,JSON.stringify(activated.body)).toBe(200);
    expect(activated.body.items).toBeInstanceOf(Array);
    const activeEdit=await edit('Corrección con Instalaciones activo',edited.body.order.version);
    expect(activeEdit.status).toBe(200);

    // A partial setup must not break existing OT edits or leak low-level missing-table errors.
    await db.exec('ALTER TABLE installation_team_requests RENAME TO installation_team_requests_pending');
    const partial=await request(app).get(`${API}/installations`).set('Cookie',cookie);
    expect(partial.status).toBe(503);
    expect(partial.body.error.code).toBe('INSTALLATIONS_SETUP_REQUIRED');
    expect((await edit('Corrección durante configuración incompleta',activeEdit.body.order.version)).status).toBe(200);
    await db.exec('ALTER TABLE installation_team_requests_pending RENAME TO installation_team_requests');
    expect((await request(app).get(`${API}/installations`).set('Cookie',cookie)).status).toBe(200);
  });
});
