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
import { syncInstallationAfterOrderEdit } from '../src/installations/service.js';

const API='/api/v1',ORIGIN='http://127.0.0.1:5173',PASSWORD='Clave de instalaciones segura 2026!';
const config=readConfig({NODE_ENV:'test',APP_ORIGINS:ORIGIN,LOGIN_RATE_LIMIT:'100'});
type Session={cookie:string;csrf:string;user:PublicUser};
type Installation={id:string;orderId:string;status:string;version:number;installerId:string|null;
  evidence:{id:string;url:string}|null;netWorkMinutes:number;productionReady:boolean};
let db:Database,app:Express,admin:Session,installer:Session,other:Session,clientId:string;
const sessionOf=(response:Response):Session=>{
  const headers=response.headers['set-cookie'];
  const cookies=!headers?[]:Array.isArray(headers)?headers:[headers];
  return {cookie:cookies.map(item=>item.split(';')[0]).join('; '),csrf:response.body.csrfToken,user:response.body.user};
};
async function login(email:string) {
  const response=await request(app).post(`${API}/auth/login`).set('Origin',ORIGIN).send({email,password:PASSWORD});
  expect(response.status).toBe(200);return sessionOf(response);
}
async function actor(role:Role,name=role) {
  const id=randomUUID(),email=`${id}@example.test`;
  await db.query(`INSERT INTO users(id,name,email,role,password_hash,must_change_password)
    SELECT $1,$2,$3,$4,password_hash,false FROM users WHERE id=$5`,[id,name,email,role,admin.user.id]);
  return login(email);
}
function post(path:string,body:object,session=admin) {
  return request(app).post(`${API}${path}`).set('Origin',ORIGIN).set('Cookie',session.cookie)
    .set('X-CSRF-Token',session.csrf).send(body);
}
function get(path:string,session=admin) {return request(app).get(`${API}${path}`).set('Cookie',session.cookie);}
function location(overrides:Record<string,unknown>={}) {
  return {latitude:7.119,longitude:-73.122,accuracy:12,capturedAt:new Date().toISOString(),...overrides};
}
async function readyOrder(ready=true) {
  const response=await post('/orders',{clientId,description:'Aviso que será instalado',value:100000,
    documentType:'REM',category:'Proyecto',route:'WORKSHOP_ONLY',requiresInstallation:true,requestId:randomUUID(),
    products:[{description:'Letrero',quantity:1,unitValue:100000,materials:[],activities:[{area:'WORKSHOP'}]}]});
  expect(response.status,JSON.stringify(response.body)).toBe(201);
  const order=response.body.order;
  if(ready) {
    const activity=(await get(`/work/activities?orderId=${order.id}`)).body.items[0];
    expect((await post(`/work/activities/${activity.id}/start`,{})).status).toBe(200);
    expect((await post(`/work/activities/${activity.id}/complete`,{})).status).toBe(200);
  }
  return order as {id:string;number:number;version:number};
}
function schedule(orderId:string,overrides:Record<string,unknown>={}) {
  return {requestId:randomUUID(),orderId,installerId:installer.user.id,
    scheduledStartAt:new Date(Date.now()-3600000).toISOString(),scheduledEndAt:new Date(Date.now()+3600000).toISOString(),
    address:'Calle 20 # 10-30',contactName:'Persona de contacto',contactPhone:'3001234567',instructions:'Instalar el letrero.',...overrides};
}
async function create(overrides:Record<string,unknown>={}):Promise<Installation> {
  const order=await readyOrder();const response=await post('/installations',schedule(order.id,overrides));
  expect(response.status).toBe(201);return response.body.installation;
}
async function action(row:Installation,name:string,details:Record<string,unknown>={},session=installer) {
  return post(`/installations/${row.id}/actions`,{requestId:randomUUID(),version:row.version,action:name,...details},session);
}
async function start(row:Installation) {
  const response=await action(row,'arrive',{location:location()});expect(response.status).toBe(200);return response.body.installation as Installation;
}
// Bounded structural JPEG fixture: SOF0(1x1,1 component), SOS, entropy, EOI.
const JPEG=Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,1,0,1,1,1,0x11,0,
  0xff,0xda,0,8,1,1,0,0,63,0,0,0xff,0xd9]);
async function photo(row:Installation,imageBase64=JPEG.toString('base64')) {
  return post(`/installations/${row.id}/evidence`,{requestId:randomUUID(),version:row.version,imageBase64},installer);
}

beforeAll(async()=>{db=await createPgliteDatabase();await migrate(db);});
beforeEach(async()=>{
  await db.exec('TRUNCATE orders, clients, users RESTART IDENTITY CASCADE');
  await bootstrapAdmin(db,{name:'Administración de prueba',email:'installation-master@example.test',password:PASSWORD});
  app=await createApp(db,config);admin=await login('installation-master@example.test');
  installer=await actor('INSTALADOR','Instalador Uno');other=await actor('INSTALADOR','Instalador Dos');
  clientId=randomUUID();
  await db.query('INSERT INTO clients(id,name,identification,phone,special_payment) VALUES($1,$2,$3,$4,true)',
    [clientId,'Cliente de instalación','NIT prueba','3001234567']);
});
afterAll(async()=>{await db?.close();});

describe('Instalaciones: integridad y privacidad',()=>{
  it('sólo ofrece producción liberada y crea exactamente una instalación por OT',async()=>{
    const pending=await readyOrder(false),ready=await readyOrder();
    const list=await get('/installations');expect(list.status).toBe(200);
    expect(list.body.availableOrders.map((row:{id:string})=>row.id)).toEqual([ready.id]);
    expect((await post('/installations',schedule(pending.id))).status).toBe(409);
    const payload=schedule(ready.id),created=await post('/installations',payload);
    expect(created.status).toBe(201);expect(created.body.installation.status).toBe('ASSIGNED');
    const replay=await post('/installations',payload);expect(replay.status).toBe(200);expect(replay.body.replayed).toBe(true);
    expect((await post('/installations',schedule(ready.id))).status).toBe(409);
    expect((await db.query('SELECT id FROM installations')).rows).toHaveLength(1);
    expect((await db.query('SELECT number FROM orders ORDER BY number')).rows).toEqual([{number:1},{number:2}]);
  });
  it('instaladores ven sólo lo propio y nunca directorios, datos comerciales o trabajos ajenos',async()=>{
    const mine=await create(),theirs=await create({installerId:other.user.id});
    const list=await get('/installations',installer);expect(list.status).toBe(200);
    expect(list.body.items.map((row:{id:string})=>row.id)).toEqual([mine.id]);
    expect(list.body).not.toHaveProperty('installers');expect(list.body).not.toHaveProperty('availableOrders');
    expect(JSON.stringify(list.body)).not.toMatch(/unitValue|lineTotal|collectible|reteFuente|identification|password/);
    expect((await get(`/installations/${theirs.id}`,installer)).status).toBe(404);
    expect((await action(theirs,'arrive',{location:location()})).status).toBe(404);
    for(const path of ['/orders','/work/activities','/clients','/reports/sales','/history','/users']) {
      expect((await get(path,installer)).status,path).toBe(403);
    }
    const designer=await actor('DISENO');expect((await get('/installations',designer)).status).toBe(403);
    expect((await post('/installations',schedule((await readyOrder()).id),installer)).status).toBe(403);
  });
  it('registra asignación y reasignación con motivo, y el anterior responsable pierde acceso',async()=>{
    const row=await create({installerId:undefined});expect(row.status).toBe('PENDING');
    expect((await action(row,'assign',{installerId:installer.user.id,reason:''},admin)).status).toBe(400);
    const assigned=await action(row,'assign',{installerId:installer.user.id,reason:'Asignación inicial'},admin);
    expect(assigned.status).toBe(200);
    const changed=await action(assigned.body.installation,'assign',{installerId:other.user.id,reason:'Cambio de responsable'},admin);
    expect(changed.status).toBe(200);expect((await get(`/installations/${row.id}`,installer)).status).toBe(404);
    const detail=await get(`/installations/${row.id}`);
    expect(detail.body.events[0].details).toMatchObject({reason:'Cambio de responsable',previousInstallerId:installer.user.id});
  });
  it('rechaza versiones viejas, y un reenvío exacto no duplica eventos ni acepta datos cambiados',async()=>{
    const row=await create();
    const payload={requestId:randomUUID(),version:row.version,action:'arrive',location:location()};
    expect((await post(`/installations/${row.id}/actions`,payload,installer)).status).toBe(200);
    const replay=await post(`/installations/${row.id}/actions`,payload,installer);
    expect(replay.status).toBe(200);expect(replay.body.replayed).toBe(true);
    expect((await post(`/installations/${row.id}/actions`,{...payload,location:location({latitude:0})},installer)).status).toBe(409);
    expect((await action(row,'note',{note:'Versión desactualizada'})).status).toBe(409);
    expect((await db.query("SELECT id FROM installation_events WHERE action='arrive'")).rows).toHaveLength(1);
  });
  it('llegada exige captura reciente precisa salvo excepción administrativa justificada',async()=>{
    const row=await create();
    expect((await action(row,'arrive')).body.error.code).toBe('LOCATION_REQUIRED');
    expect((await action(row,'arrive',{location:location({capturedAt:new Date(Date.now()-301000).toISOString()})})).body.error.code).toBe('LOCATION_STALE');
    expect((await action(row,'arrive',{location:location({accuracy:1000})})).body.error.code).toBe('LOCATION_INACCURATE');
    expect((await action(row,'authorize-location-exception',{reason:'Sin señal'})).status).toBe(403);
    const exception=await action(row,'authorize-location-exception',{reason:'El teléfono no obtiene posición; se verificó por llamada.'},admin);
    expect(exception.status).toBe(200);
    const arrived=await action(exception.body.installation,'arrive');expect(arrived.status).toBe(200);
    const detail=await get(`/installations/${row.id}`);expect(detail.body.events[0].details.locationException).toBe(true);
    expect(new Date(detail.body.events[0].occurredAt).getTime()).toBeGreaterThan(Date.now()-10000);
  });
  it('administración no puede suplantar llegada ni salida del instalador',async()=>{
    const row=await create();expect((await action(row,'arrive',{location:location()},admin)).status).toBe(403);
    expect((await action(row,'resume')).status).toBe(409);
    const active=await start(row);
    expect((await action(active,'complete',{location:location(),result:'Listo',checklist:{mounted:true,electrical:'VERIFIED'},photoId:randomUUID()},admin)).status).toBe(403);
    expect((await action(active,'assign',{installerId:other.user.id,reason:'Cambiar en ejecución'},admin)).status).toBe(409);
  });
  it('pausas, almuerzo y aplazamiento detienen el reloj, requieren reprogramar para continuar',async()=>{
    let row=await start(await create());
    await db.query("UPDATE installation_members SET active_since=clock_timestamp()-interval '10 minutes' WHERE installation_id=$1 AND user_id=$2",[row.id,installer.user.id]);
    const paused=await action(row,'pause',{kind:'LUNCH',note:'Almuerzo'});expect(paused.status).toBe(200);
    row=paused.body.installation;expect(row.status).toBe('PAUSED');expect(row.netWorkMinutes).toBeGreaterThanOrEqual(10);
    const resumed=await action(row,'resume');expect(resumed.status).toBe(200);row=resumed.body.installation;
    const postponed=await action(row,'postpone',{reason:'Por orden de administración'},admin);
    expect(postponed.status).toBe(200);expect(postponed.body.installation.status).toBe('POSTPONED');
    expect((await action(postponed.body.installation,'arrive',{location:location()})).status).toBe(409);
    const scheduled=await action(postponed.body.installation,'reschedule',{
      reason:'Nueva cita confirmada',scheduledStartAt:new Date().toISOString(),scheduledEndAt:new Date(Date.now()+7200000).toISOString()},admin);
    expect(scheduled.status).toBe(200);expect(scheduled.body.installation.status).toBe('ASSIGNED');
    expect(scheduled.body.installation.netWorkMinutes).toBeGreaterThanOrEqual(10);
  });
  it('cierre exige checklist, resultado, foto de la propia instalación y registra salida+OT atómicamente',async()=>{
    let row=await start(await create());
    const complete={location:location(),result:'Instalación terminada, montaje verificado.',checklist:{mounted:true,electrical:'NOT_APPLICABLE'},photoId:randomUUID()};
    expect((await action(row,'complete',{...complete,result:''})).status).toBe(400);
    expect((await action(row,'complete',{...complete,checklist:{mounted:false,electrical:'VERIFIED'}})).status).toBe(400);
    expect((await action(row,'complete',complete)).body.error.code).toBe('EVIDENCE_REQUIRED');
    const saved=await photo(row);expect(saved.status).toBe(201);row=saved.body.installation;
    const done=await action(row,'complete',{...complete,photoId:saved.body.evidence.id});
    expect(done.status).toBe(200);expect(done.body.installation.status).toBe('COMPLETED');
    const ot=(await db.query<{status:string;installed_at:Date|string}>('SELECT status,installed_at FROM orders WHERE id=$1',[row.orderId])).rows[0];
    expect(ot.status).toBe('INSTALLED');expect(new Date(ot.installed_at).getTime()).toBeGreaterThan(Date.now()-10000);
    const events=(await get(`/installations/${row.id}`)).body.events;
    expect(events[0].details).toMatchObject({location:{latitude:7.119},result:complete.result,photoId:saved.body.evidence.id});
    const global=(await db.query<{details:unknown}>('SELECT details FROM order_events WHERE order_id=$1',[row.orderId])).rows;
    expect(JSON.stringify(global)).not.toMatch(/latitude|longitude|imageBase64|Calle 20/);
    const metrics=(await get('/installations',installer)).body.metrics;
    expect(metrics.completedThisMonth).toBe(1);expect(metrics.onTime).toBe(1);
  });
  it('fotografías son privadas, versionadas y se rechaza basura o imágenes de dimensiones excesivas',async()=>{
    const row=await start(await create());
    expect((await photo(row,Buffer.from('not an image').toString('base64'))).status).toBe(400);
    expect((await photo(row,Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64'))).status).toBe(400);
    const giant=Buffer.from(JPEG);giant.writeUInt16BE(5000,9);
    expect((await photo(row,giant.toString('base64'))).status).toBe(400);
    const saved=await photo(row);expect(saved.status).toBe(201);
    expect(saved.body.installation.version).toBe(row.version+1);expect(saved.body).not.toHaveProperty('imageBase64');
    const evidence=await get(saved.body.evidence.url.replace(API,''),installer);
    expect(evidence.status).toBe(200);expect(evidence.headers['content-type']).toContain('image/jpeg');
    expect(evidence.headers['cache-control']).toBe('no-store');expect(Buffer.from(evidence.body)).toEqual(JPEG);
    expect((await get(saved.body.evidence.url.replace(API,''),other)).status).toBe(404);
    expect((await request(app).get(saved.body.evidence.url)).status).toBe(401);
    const noBytes=await get(`/installations/${row.id}`,installer);
    expect(JSON.stringify(noBytes.body)).not.toContain(JPEG.toString('base64'));
  });
  it('evidencia admite fotos mayores de32KB sin ampliar el límite de otras rutas',async()=>{
    const row=await start(await create());
    const large=Buffer.concat([JPEG.subarray(0,-2),Buffer.alloc(40000),Buffer.from([0xff,0xd9])]);
    expect((await photo(row,large.toString('base64'))).status).toBe(201);
    expect((await post(`/installations/${row.id}/actions`,{requestId:randomUUID(),version:2,action:'note',note:'x'.repeat(40000)},installer)).status).toBe(413);
  });
  it('no permite avanzar si la producción cambia ni usar sesiones revocadas',async()=>{
    const row=await create();
    await db.query("UPDATE orders SET status='IN_PRODUCTION' WHERE id=$1",[row.orderId]);
    expect((await action(row,'arrive',{location:location()})).status).toBe(409);
    const detail=await get(`/installations/${row.id}`);expect(detail.body.installation.productionReady).toBe(false);
    await db.query('UPDATE users SET is_active=false WHERE id=$1',[installer.user.id]);
    expect((await get('/installations',installer)).status).toBe(401);
  });
  it('la reapertura conserva cierre/evidencia previos pero exige un nuevo ciclo y nueva fotografía',async()=>{
    let row=await start(await create());const saved=await photo(row);row=saved.body.installation;
    const closed=await action(row,'complete',{location:location(),result:'Primer cierre',
      checklist:{mounted:true,electrical:'VERIFIED'},photoId:saved.body.evidence.id});
    expect(closed.status).toBe(200);
    await db.transaction(async tx=>{
      await tx.query("UPDATE orders SET status='IN_PRODUCTION',installed_at=NULL WHERE id=$1",[row.orderId]);
      await syncInstallationAfterOrderEdit(tx,admin.user,row.orderId,'INSTALLED','IN_PRODUCTION');
    });
    const reopened=await get(`/installations/${row.id}`);row=reopened.body.installation;
    expect(row.status).toBe('POSTPONED');expect(row.productionReady).toBe(false);expect(row.evidence).toBe(null);
    expect(reopened.body.events[0].details).toMatchObject({previousResult:'Primer cierre',previousPhotoId:saved.body.evidence.id});
    expect((await get(saved.body.evidence.url.replace(API,''))).status).toBe(200);
    await db.query("UPDATE orders SET status='PENDING_INSTALLATION' WHERE id=$1",[row.orderId]);
    const rescheduled=await action(row,'reschedule',{reason:'Segunda instalación',scheduledStartAt:new Date().toISOString(),
      scheduledEndAt:new Date(Date.now()+3600000).toISOString()},admin);
    expect(rescheduled.status).toBe(200);row=await start(rescheduled.body.installation);
    expect((await action(row,'complete',{location:location(),result:'Segundo cierre',checklist:{mounted:true,electrical:'VERIFIED'},
      photoId:saved.body.evidence.id})).body.error.code).toBe('EVIDENCE_REQUIRED');
  });
  it('las cuatro tablas nuevas tienen RLS habilitado sin políticas públicas',async()=>{
    const rows=(await db.query<{relname:string;relrowsecurity:boolean}>(`SELECT relname,relrowsecurity FROM pg_class
      WHERE relname IN ('installations','installation_events','installation_evidence','installation_requests') ORDER BY relname`)).rows;
    expect(rows).toHaveLength(4);expect(rows.every(row=>row.relrowsecurity)).toBe(true);
    expect((await db.query("SELECT policyname FROM pg_policies WHERE tablename LIKE 'installation%'")).rows).toHaveLength(0);
  });
  it('varios instaladores controlan su propio reloj y sólo el principal cierra cuando los otros salieron',async()=>{
    let row=await create({installerIds:[installer.user.id,other.user.id]});
    const third=await actor('INSTALADOR','Sin asignar');
    expect((await get(`/installations/${row.id}`,other)).status).toBe(200);
    expect((await get(`/installations/${row.id}`,third)).status).toBe(404);
    row=await start(row);
    const arrivedOther=await action(row,'arrive',{location:location()},other);
    expect(arrivedOther.status).toBe(200);row=arrivedOther.body.installation;
    await db.query("UPDATE installation_members SET active_since=clock_timestamp()-interval '5 minutes' WHERE installation_id=$1 AND user_id=$2",[row.id,installer.user.id]);
    await db.query("UPDATE installation_members SET active_since=clock_timestamp()-interval '3 minutes' WHERE installation_id=$1 AND user_id=$2",[row.id,other.user.id]);
    const paused=await action(row,'pause',{kind:'REST'});expect(paused.status).toBe(200);row=paused.body.installation;
    expect(row.status).toBe('IN_PROGRESS');
    const resumed=await action(row,'resume');expect(resumed.status).toBe(200);row=resumed.body.installation;
    const saved=await photo(row);expect(saved.status).toBe(201);row=saved.body.installation;
    const closing={location:location(),result:'Instalación conjunta terminada',checklist:{mounted:true,electrical:'VERIFIED'},photoId:saved.body.evidence.id};
    expect((await action(row,'complete',closing)).body.error.code).toBe('MEMBERS_STILL_WORKING');
    expect((await action(row,'complete',closing,other)).status).toBe(403);
    const exited=await action(row,'checkout',{location:location(),note:'Trabajo finalizado'},other);
    expect(exited.status).toBe(200);row=exited.body.installation;
    const complete=await action(row,'complete',closing);expect(complete.status).toBe(200);
    const leadMetrics=(await get('/installations',installer)).body.metrics;
    const memberMetrics=(await get('/installations',other)).body.metrics;
    expect(leadMetrics.completedThisMonth).toBe(1);expect(memberMetrics.completedThisMonth).toBe(1);
    expect(leadMetrics.netWorkMinutes).toBeGreaterThanOrEqual(5);expect(leadMetrics.netWorkMinutes).toBeLessThan(6);
    expect(memberMetrics.netWorkMinutes).toBeGreaterThanOrEqual(3);expect(memberMetrics.netWorkMinutes).toBeLessThan(4);
    const events=(await get(`/installations/${row.id}`)).body.events;
    expect(events.find((event:{action:string})=>event.action==='checkout').actor.id).toBe(other.user.id);
  });
  it('conserva tiempo personal tras reasignar y no lo transfiere al nuevo responsable',async()=>{
    let row=await start(await create());
    await db.query("UPDATE installation_members SET active_since=clock_timestamp()-interval '5 minutes' WHERE installation_id=$1 AND user_id=$2",[row.id,installer.user.id]);
    const postponed=await action(row,'postpone',{reason:'Cambio de cuadrilla'},admin);
    expect(postponed.status).toBe(200);row=postponed.body.installation;
    const reassigned=await action(row,'assign',{installerId:other.user.id,reason:'Otro responsable continuará'},admin);
    expect(reassigned.status).toBe(200);
    expect((await get(`/installations/${row.id}`,installer)).status).toBe(404);
    expect((await get('/installations',installer)).body.metrics.netWorkMinutes).toBeGreaterThanOrEqual(5);
    expect((await get('/installations',other)).body.metrics.netWorkMinutes).toBe(0);
    const performance=(await get('/installations')).body.performance;
    expect(performance.find((person:{installerId:string})=>person.installerId===installer.user.id).netWorkMinutes).toBeGreaterThanOrEqual(5);
    expect(performance.find((person:{installerId:string})=>person.installerId===other.user.id).netWorkMinutes).toBe(0);
  });
  it('el principal debe justificar ausentes y no les atribuye instalación completada',async()=>{
    let row=await start(await create({installerIds:[installer.user.id,other.user.id]}));
    const saved=await photo(row);row=saved.body.installation;
    const closing={location:location(),result:'Terminada por responsable principal',
      checklist:{mounted:true,electrical:'NOT_APPLICABLE'},photoId:saved.body.evidence.id};
    expect((await action(row,'complete',closing)).body.error.code).toBe('ABSENT_MEMBERS_REASON_REQUIRED');
    const complete=await action(row,'complete',{...closing,absentMembersReason:'El segundo instalador fue destinado a otro trabajo.'});
    expect(complete.status).toBe(200);
    expect((await get('/installations',other)).body.metrics.completedThisMonth).toBe(0);
    expect((await get('/installations',other)).body.metrics.netWorkMinutes).toBe(0);
    const event=(await get(`/installations/${row.id}`)).body.events[0];
    expect(event.details.absentMembers).toEqual([{userId:other.user.id,name:other.user.name}]);
    expect(event.details.absentMembersReason).toContain('otro trabajo');
  });
  it('equipos reutilizables tienen versión e idempotencia y cada instalación conserva su snapshot',async()=>{
    const third=await actor('INSTALADOR','Instalador Tres');
    const teamInput={requestId:randomUUID(),name:'Equipo Norte',leaderId:installer.user.id,
      memberIds:[installer.user.id,other.user.id],active:true};
    const created=await post('/installations/teams',teamInput);expect(created.status).toBe(201);
    const team=created.body.team;
    expect((await post('/installations/teams',teamInput)).body.replayed).toBe(true);
    expect((await get('/installations/teams',installer)).status).toBe(403);
    expect((await post('/installations/teams',{...teamInput,requestId:randomUUID(),name:'equipo norte'})).status).toBe(409);
    const row=await create({installerId:undefined,teamId:team.id});
    const patch=(payload:object)=>request(app).patch(`${API}/installations/teams/${team.id}`).set('Origin',ORIGIN)
      .set('Cookie',admin.cookie).set('X-CSRF-Token',admin.csrf).send(payload);
    const changed=await patch({requestId:randomUUID(),version:team.version,name:'Equipo Centro',memberIds:[installer.user.id,third.user.id]});
    expect(changed.status).toBe(200);
    expect((await patch({requestId:randomUUID(),version:team.version,active:false})).status).toBe(409);
    const detail=(await get(`/installations/${row.id}`)).body.installation;
    expect(detail.teamName).toBe('Equipo Norte');
    expect(detail.members.map((member:{userId:string})=>member.userId).sort()).toEqual([installer.user.id,other.user.id].sort());
    expect((await get(`/installations/${row.id}`,third)).status).toBe(404);
    expect((await db.query('SELECT id FROM installation_team_events WHERE team_id=$1',[team.id])).rows).toHaveLength(2);
    const disabled=await patch({requestId:randomUUID(),version:changed.body.team.version,active:false});expect(disabled.status).toBe(200);
    const another=await readyOrder();expect((await post('/installations',schedule(another.id,{installerId:undefined,teamId:team.id}))).body.error.code).toBe('TEAM_UNAVAILABLE');
    const rls=(await db.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('installation_members','installation_teams','installation_team_members','installation_team_events','installation_team_requests')")).rows;
    expect(rls).toHaveLength(5);expect(rls.every(row=>row.relrowsecurity)).toBe(true);
  });
  it('reemplazar evidencia conserva bytes previos y el cierre exige la fotografía más reciente',async()=>{
    let row=await start(await create());
    const first=await photo(row);row=first.body.installation;
    const replacement=Buffer.from(JPEG);replacement[24]=1;
    const second=await photo(row,replacement.toString('base64'));expect(second.status).toBe(201);row=second.body.installation;
    expect(second.body.evidence.id).not.toBe(first.body.evidence.id);
    expect(Buffer.from((await get(first.body.evidence.url.replace(API,''))).body)).toEqual(JPEG);
    expect(Buffer.from((await get(second.body.evidence.url.replace(API,''))).body)).toEqual(replacement);
    const closing={location:location(),result:'Terminada',checklist:{mounted:true,electrical:'VERIFIED'}};
    expect((await action(row,'complete',{...closing,photoId:first.body.evidence.id})).body.error.code).toBe('EVIDENCE_REQUIRED');
    expect((await action(row,'complete',{...closing,photoId:second.body.evidence.id})).status).toBe(200);
  });
  it('filtra la bandeja por estado personal sin ocultar pendientes o pausas cuando un compañero trabaja',async()=>{
    let row=await start(await create({installerIds:[installer.user.id,other.user.id]}));
    const waiting=await get('/installations?status=ASSIGNED',other);
    expect(waiting.body.items).toHaveLength(1);
    expect(waiting.body.items[0]).toMatchObject({id:row.id,status:'IN_PROGRESS',personalStatus:'ASSIGNED'});
    expect((await get('/installations?status=IN_PROGRESS',other)).body.items).toHaveLength(0);
    const adminView=await get('/installations?status=IN_PROGRESS');
    expect(adminView.body.items).toHaveLength(1);expect(adminView.body.items[0].personalStatus).toBe(null);
    const arrived=await action(row,'arrive',{location:location()},other);expect(arrived.status).toBe(200);row=arrived.body.installation;
    const paused=await action(row,'pause',{kind:'LUNCH'},other);expect(paused.status).toBe(200);row=paused.body.installation;
    expect(row.status).toBe('IN_PROGRESS');expect(paused.body.installation.personalStatus).toBe('PAUSED');
    expect((await get('/installations?status=PAUSED',other)).body.items).toHaveLength(1);
    expect((await get('/installations?status=IN_PROGRESS',installer)).body.items).toHaveLength(1);
    const resumed=await action(row,'resume',{},other);expect(resumed.status).toBe(200);row=resumed.body.installation;
    const exited=await action(row,'checkout',{location:location()},other);expect(exited.status).toBe(200);row=exited.body.installation;
    expect(exited.body.installation.personalStatus).toBe('CHECKED_OUT');
    expect((await get('/installations?status=CHECKED_OUT',other)).body.items).toHaveLength(1);
    expect((await get('/installations?status=CHECKED_OUT')).status).toBe(400);
    const saved=await photo(row);expect(saved.status).toBe(201);row=saved.body.installation;
    const completed=await action(row,'complete',{location:location(),result:'Trabajo grupal finalizado',
      checklist:{mounted:true,electrical:'VERIFIED'},photoId:saved.body.evidence.id});expect(completed.status).toBe(200);
    const final=await get('/installations?status=COMPLETED',other);expect(final.body.items).toHaveLength(1);
    expect(final.body.items[0].personalStatus).toBe('COMPLETED');
    expect((await get('/installations?status=CHECKED_OUT',other)).body.items).toHaveLength(0);
  });
  it('una nueva visita o un nuevo principal exige una foto posterior a su llegada sin borrar las anteriores',async()=>{
    let row=await start(await create());const first=await photo(row);row=first.body.installation;
    const postpone=async()=>{
      const response=await action(row,'postpone',{reason:'Nueva visita requerida'},admin);
      expect(response.status).toBe(200);row=response.body.installation;expect(row.evidence).toBe(null);
    };
    const reprogram=async()=>{
      const response=await action(row,'reschedule',{reason:'Visita confirmada',scheduledStartAt:new Date().toISOString(),
        scheduledEndAt:new Date(Date.now()+3600000).toISOString()},admin);
      expect(response.status).toBe(200);row=response.body.installation;expect(row.evidence).toBe(null);
    };
    const closing={location:location(),result:'Resultado de la nueva visita',checklist:{mounted:true,electrical:'VERIFIED'}};
    await postpone();await reprogram();
    expect((await photo(row)).status).toBe(409);
    row=await start(row);expect(row.evidence).toBe(null);
    expect((await action(row,'complete',{...closing,photoId:first.body.evidence.id})).body.error.code).toBe('EVIDENCE_REQUIRED');
    const second=await photo(row);expect(second.status).toBe(201);row=second.body.installation;
    await postpone();
    const reassigned=await action(row,'assign',{installerId:other.user.id,reason:'Nuevo principal'},admin);
    expect(reassigned.status).toBe(200);row=reassigned.body.installation;await reprogram();
    const arrival=await action(row,'arrive',{location:location()},other);expect(arrival.status).toBe(200);row=arrival.body.installation;
    expect(row.evidence).toBe(null);
    expect((await action(row,'complete',{...closing,photoId:second.body.evidence.id},other)).body.error.code).toBe('EVIDENCE_REQUIRED');
    const third=await post(`/installations/${row.id}/evidence`,{requestId:randomUUID(),version:row.version,imageBase64:JPEG.toString('base64')},other);
    expect(third.status).toBe(201);row=third.body.installation;
    expect((await action(row,'complete',{...closing,photoId:third.body.evidence.id},other)).status).toBe(200);
    expect((await db.query('SELECT id FROM installation_evidence WHERE installation_id=$1',[row.id])).rows).toHaveLength(3);
    expect((await get(first.body.evidence.url.replace(API,''))).status).toBe(200);
    expect((await get(second.body.evidence.url.replace(API,''))).status).toBe(200);
  });
  it('los equipos archivados admiten instaladores inactivos pero nunca integrantes de otros roles',async()=>{
    const designer=await actor('DISENO','Diseñador de prueba');
    const invalid=await post('/installations/teams',{requestId:randomUUID(),name:'Equipo inválido',active:false,
      leaderId:designer.user.id,memberIds:[designer.user.id]});
    expect(invalid.status).toBe(400);expect(invalid.body.error.code).toBe('INSTALLER_UNAVAILABLE');
    const created=await post('/installations/teams',{requestId:randomUUID(),name:'Equipo archivado',active:false,
      leaderId:installer.user.id,memberIds:[installer.user.id]});expect(created.status).toBe(201);
    await db.query('UPDATE users SET is_active=false WHERE id=$1',[installer.user.id]);
    const patch=(payload:object)=>request(app).patch(`${API}/installations/teams/${created.body.team.id}`).set('Origin',ORIGIN)
      .set('Cookie',admin.cookie).set('X-CSRF-Token',admin.csrf).send(payload);
    const renamed=await patch({requestId:randomUUID(),version:created.body.team.version,name:'Archivo conservado'});
    expect(renamed.status).toBe(200);
    expect((await patch({requestId:randomUUID(),version:renamed.body.team.version,active:true})).status).toBe(400);
    expect((await patch({requestId:randomUUID(),version:renamed.body.team.version,
      leaderId:designer.user.id,memberIds:[designer.user.id]})).status).toBe(400);
    expect((await get('/installations/teams')).body.items[0].memberIds).toEqual([installer.user.id]);
  });
});
