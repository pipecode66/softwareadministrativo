import { readFile,readdir } from 'node:fs/promises';
import request from 'supertest';
import { afterAll,describe,expect,it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrapAdmin } from '../src/bootstrap.js';
import { readConfig } from '../src/config.js';
import { createPgliteDatabase } from '../src/db/database.js';
import type { Database } from '../src/db/types.js';

const API='/api/v1',ORIGIN='http://127.0.0.1:5173',PASSWORD='Clave de publicación segura 2026!';
let db:Database|undefined;
afterAll(async()=>{await db?.close();});

describe('Publicación de eliminar usuarios antes del SQL017',()=>{
  it('mantiene login, listado y edición antes de migrar y activa el borrado en la misma aplicación al aplicar017',async()=>{
    db=await createPgliteDatabase();
    const directory=new URL('../migrations/',import.meta.url);
    for(const file of (await readdir(directory)).filter(name=>/^\d+_[\w-]+\.sql$/.test(name)&&Number(name.slice(0,3))<=16).sort()) {
      await db.exec(await readFile(new URL(file,directory),'utf8'));
    }
    await bootstrapAdmin(db,{name:'Principal',email:'master-release@example.test',password:PASSWORD});
    const app=await createApp(db,readConfig({NODE_ENV:'test',APP_ORIGINS:ORIGIN}));
    const login=await request(app).post(`${API}/auth/login`).set('Origin',ORIGIN)
      .send({email:'master-release@example.test',password:PASSWORD});
    expect(login.status).toBe(200);
    const header=login.headers['set-cookie'];
    const cookie=(Array.isArray(header)?header:[header]).map(value=>value.split(';')[0]).join('; ');
    const csrf=login.body.csrfToken;
    const create=()=>request(app).post(`${API}/users`).set('Origin',ORIGIN).set('Cookie',cookie).set('X-CSRF-Token',csrf)
      .send({name:'Cuenta anterior al SQL',email:'previous-release@example.test',role:'TALLER',active:true,password:PASSWORD});
    const created=await create();expect(created.status).toBe(201);
    const listed=()=>request(app).get(`${API}/users`).set('Cookie',cookie);
    expect((await listed()).body.total).toBe(2);
    const edited=await request(app).patch(`${API}/users/${created.body.user.id}`).set('Origin',ORIGIN)
      .set('Cookie',cookie).set('X-CSRF-Token',csrf).send({name:'Nombre corregido',role:'IMPRESION'});
    expect(edited.status).toBe(200);
    const remove=()=>request(app).delete(`${API}/users/${created.body.user.id}`).set('Origin',ORIGIN)
      .set('Cookie',cookie).set('X-CSRF-Token',csrf).send({});
    const pending=await remove();expect(pending.status).toBe(503);
    expect(pending.body.error).toMatchObject({code:'USER_DELETION_SETUP_REQUIRED',message:expect.stringContaining('017')});
    expect((await listed()).body.total).toBe(2);
    expect((await request(app).post(`${API}/auth/login`).set('Origin',ORIGIN)
      .send({email:created.body.user.email,password:PASSWORD})).status).toBe(200);
    await db.exec(await readFile(new URL('017_user_deletion.sql',directory),'utf8'));
    expect((await remove()).status).toBe(204);
    expect((await listed()).body.total).toBe(1);
    const replacement=await create();expect(replacement.status).toBe(201);
    expect(replacement.body.user.id).not.toBe(created.body.user.id);
    const fresh=await request(app).post(`${API}/auth/login`).set('Origin',ORIGIN)
      .send({email:created.body.user.email,password:PASSWORD});
    expect(fresh.status).toBe(200);expect(fresh.body.user.id).toBe(replacement.body.user.id);
  });
});
