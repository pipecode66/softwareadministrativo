import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { AuthSession, Role } from '../contracts.js';
import type { Database, SqlConnection } from '../db/types.js';
import { ApiError } from '../errors.js';
import { requireCurrentActor } from '../security/actor.js';
import { createInstallationSchema, installationActionSchema, installationEvidenceSchema,
  installationListSchema, createTeamSchema, updateTeamSchema, type InstallationActionInput, type locationSchema } from './schemas.js';

type Status = 'PENDING'|'ASSIGNED'|'IN_PROGRESS'|'PAUSED'|'POSTPONED'|'COMPLETED';
interface InstallationRow {
  id:string; order_id:string; installer_id:string|null; status:Status; version:number; cycle:number;
  scheduled_start_at:Date|string; scheduled_end_at:Date|string;
  address:string; contact_name:string; contact_phone:string; instructions:string;
  started_at:Date|string|null; completed_at:Date|string|null; active_since:Date|string|null;
  work_seconds:string|number; result:string|null;
  checklist:{mounted:boolean;electrical:'VERIFIED'|'NOT_APPLICABLE'}|null;
  location_exception:boolean; location_exception_reason:string|null;
  created_at:Date|string; updated_at:Date|string;
  order_number:number; client_name:string; description:string; installer_name:string|null;
  order_status:string; production_ready:boolean; evidence_id:string|null; evidence_created_at:Date|string|null;
  team_id:string|null;team_name:string|null;members:MemberRow[];products:TechnicalProductRow[];
}
interface TechnicalProductRow {
  id:string;description:string;quantity:number|string;
  materials:{id:string;material:string;length:number|string;width:number|string}[];
}
interface MemberRow {
  user_id:string;name:string;status:'ASSIGNED'|'IN_PROGRESS'|'PAUSED'|'CHECKED_OUT';
  arrived_at:Date|string|null;checked_out_at:Date|string|null;active_since:Date|string|null;work_seconds:string|number;
}
interface Metrics {
  completedThisMonth:number; inProgress:number; postponed:number;
  onTime:number; scheduledCompleted:number; netWorkMinutes:number;
}
// This manager role is scoped to Installations, never the application's financial administration.
const admins:Role[] = ['ADMINMASTER','ADMIN_GENERAL','ADMIN_INSTALADORES'];
const readers:Role[] = [...admins, 'INSTALADOR'];
const admin = (role:Role) => admins.includes(role);
const missing = () => new ApiError(404,'INSTALLATION_NOT_FOUND','No encontramos esta instalación o no está disponible para tu perfil.');
const conflict = (message:string) => new ApiError(409,'INSTALLATION_CONFLICT',message);
const iso = (value:Date|string|null) => value ? new Date(value).toISOString() : null;
const fingerprint = (data:unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const readySql = `o.requires_installation AND o.status='PENDING_INSTALLATION' AND o.closed_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM order_activities a WHERE a.order_id=o.id AND a.status<>'COMPLETED')`;
const selectInstallation = `SELECT i.*,o.number AS order_number,o.description,o.status AS order_status,
  c.name AS client_name,u.name AS installer_name,(${readySql}) AS production_ready,
  e.id AS evidence_id,e.created_at AS evidence_created_at,
  coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',mu.name,'status',m.status,
    'arrived_at',m.arrived_at,'checked_out_at',m.checked_out_at,'active_since',m.active_since,'work_seconds',m.work_seconds)
    ORDER BY mu.name,m.user_id) FROM installation_members m JOIN users mu ON mu.id=m.user_id
    WHERE m.installation_id=i.id AND m.cycle=i.cycle AND m.is_current),'[]'::jsonb) AS members,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'description',p.description,'quantity',p.quantity,
    'materials',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pm.id,'material',pm.material,
      'length',pm.length,'width',pm.width) ORDER BY pm.position,pm.id)
      FROM order_product_materials pm WHERE pm.product_id=p.id),'[]'::jsonb)) ORDER BY p.position,p.id)
    FROM order_products p WHERE p.order_id=o.id),'[]'::jsonb) AS products
  FROM installations i JOIN orders o ON o.id=i.order_id JOIN clients c ON c.id=o.client_id
  LEFT JOIN users u ON u.id=i.installer_id
  LEFT JOIN installation_evidence e ON e.id=(SELECT latest.id FROM installation_evidence latest
    WHERE latest.installation_id=i.id AND latest.cycle=i.cycle AND i.status<>'POSTPONED'
      AND latest.created_at >= (SELECT lead.arrived_at FROM installation_members lead
        WHERE lead.installation_id=i.id AND lead.cycle=i.cycle AND lead.is_current AND lead.user_id=i.installer_id)
    ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)`;

function minutes(row:InstallationRow, now=Date.now()):number {
  const seconds = Number(row.work_seconds) + row.members.reduce((sum,member)=>sum+(member.active_since?
    Math.max(0,(now-new Date(member.active_since).getTime())/1000):0),0);
  return Math.round(seconds/6)/10;
}
function evidenceDto(row:InstallationRow) {
  return row.evidence_id ? {id:row.evidence_id,
    url:`/api/v1/installations/${row.id}/evidence/${row.evidence_id}`,
    createdAt:iso(row.evidence_created_at)!} : null;
}
function personalStatus(row:InstallationRow,userId:string) {
  if(row.status==='COMPLETED'||row.status==='POSTPONED') return row.status;
  return row.members.find(member=>member.user_id===userId)?.status??null;
}
function dto(row:InstallationRow,actor?:{id:string;role:Role}) {
  return {id:row.id,orderId:row.order_id,orderNumber:Number(row.order_number),clientName:row.client_name,
    description:row.description,status:row.status,personalStatus:actor?.role==='INSTALADOR'?personalStatus(row,actor.id):null,
    products:row.products.map(product=>({id:product.id,description:product.description,quantity:Number(product.quantity),
      materials:product.materials.map(material=>({id:material.id,material:material.material,
        length:Number(material.length),width:Number(material.width),
        areaM2:Math.round(Number(material.length)*Number(material.width)*1000)/1000}))})),
    installerId:row.installer_id,installerName:row.installer_name,
    version:row.version,scheduledStartAt:iso(row.scheduled_start_at)!,scheduledEndAt:iso(row.scheduled_end_at)!,
    teamId:row.team_id,teamName:row.team_name,members:row.members.map(member=>({
      userId:member.user_id,name:member.name,isLead:member.user_id===row.installer_id,status:member.status,
      arrivedAt:iso(member.arrived_at),checkedOutAt:iso(member.checked_out_at),
      netWorkMinutes:Math.round((Number(member.work_seconds)+(member.active_since?
        Math.max(0,(Date.now()-new Date(member.active_since).getTime())/1000):0))/6)/10})),
    address:row.address,contactName:row.contact_name,contactPhone:row.contact_phone,instructions:row.instructions,
    startedAt:iso(row.started_at),completedAt:iso(row.completed_at),result:row.result,checklist:row.checklist,
    locationException:row.location_exception,locationExceptionReason:row.location_exception_reason,
    evidence:evidenceDto(row),createdAt:iso(row.created_at)!,updatedAt:iso(row.updated_at)!,
    netWorkMinutes:minutes(row),productionReady:row.production_ready || row.status==='COMPLETED' && row.order_status==='INSTALLED'};
}
function checkOwner(actor:{id:string;role:Role}, row:InstallationRow) {
  if (!admin(actor.role) && !row.members.some(member=>member.user_id===actor.id)) throw missing();
}
function requireAdmin(actor:{role:Role}) {
  if (!admin(actor.role)) throw new ApiError(403,'FORBIDDEN','Esta acción corresponde a Administración.');
}
function requireInstaller(actor:{id:string;role:Role}, row:InstallationRow) {
  if (actor.role!=='INSTALADOR' || !row.members.some(member=>member.user_id===actor.id)) {
    throw new ApiError(403,'FORBIDDEN','Solo el instalador asignado puede registrar esta acción en terreno.');
  }
}
function requireLeader(actor:{id:string;role:Role},row:InstallationRow) {
  requireInstaller(actor,row);
  if(row.installer_id!==actor.id) throw new ApiError(403,'FORBIDDEN','Solo el responsable principal puede guardar la evidencia final y cerrar la instalación.');
}
async function rowOf(tx:SqlConnection,id:string):Promise<InstallationRow> {
  const row=(await tx.query<InstallationRow>(`${selectInstallation} WHERE i.id=$1`,[id])).rows[0];
  if(!row) throw missing();
  return row;
}
async function lockInstallation(tx:SqlConnection,id:string):Promise<InstallationRow> {
  const target=(await tx.query<{order_id:string}>('SELECT order_id FROM installations WHERE id=$1',[id])).rows[0];
  if(!target) throw missing();
  // Same ordering as OT edits and production: actor -> OT -> dependent record.
  await tx.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[target.order_id]);
  await tx.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[id]);
  return rowOf(tx,id);
}
async function assertInstaller(tx:SqlConnection,id:string) {
  const installer=(await tx.query<{id:string}>(
    "SELECT id FROM users WHERE id=$1 AND role='INSTALADOR' AND is_active=true FOR SHARE",[id])).rows[0];
  if(!installer) throw new ApiError(400,'INSTALLER_UNAVAILABLE','Selecciona un instalador activo.','installerId');
}
async function assertTeamMember(tx:SqlConnection,id:string,activeRequired:boolean) {
  const member=(await tx.query<{id:string}>(`SELECT id FROM users WHERE id=$1 AND role='INSTALADOR'
    AND ($2::boolean=false OR is_active=true) FOR SHARE`,[id,activeRequired])).rows[0];
  if(!member) throw new ApiError(400,'INSTALLER_UNAVAILABLE',activeRequired?'Selecciona únicamente instaladores activos para activar el equipo.':
    'Los integrantes de un equipo deben existir y tener perfil de Instalador.','memberIds');
}
async function resolveAssignment(tx:SqlConnection,input:{installerId?:string;installerIds?:string[];teamId?:string},required=false) {
  let leader=input.installerId,ids=input.installerIds??[],teamId:string|null=null,teamName:string|null=null;
  if(input.teamId) {
    const team=(await tx.query<{id:string;name:string;leader_id:string;is_active:boolean}>(
      'SELECT id,name,leader_id,is_active FROM installation_teams WHERE id=$1 FOR SHARE',[input.teamId])).rows[0];
    if(!team?.is_active) throw new ApiError(400,'TEAM_UNAVAILABLE','Selecciona un equipo activo.','teamId');
    const teamMembers=(await tx.query<{user_id:string}>('SELECT user_id FROM installation_team_members WHERE team_id=$1',[team.id])).rows;
    teamId=team.id;teamName=team.name;leader??=team.leader_id;
    ids=input.installerIds??teamMembers.map(member=>member.user_id);
  }
  if(!leader && ids.length) leader=ids[0];
  if(leader && !ids.length) ids=[leader];
  if(leader && !ids.includes(leader)) throw new ApiError(400,'LEADER_NOT_MEMBER','El responsable principal debe estar entre los instaladores seleccionados.','installerId');
  if(required && !leader) throw new ApiError(400,'INSTALLER_REQUIRED','Selecciona uno o varios instaladores, o un equipo.','installerId');
  for(const id of [...ids].sort()) await assertInstaller(tx,id);
  return {leader:leader??null,ids,teamId,teamName};
}
async function replaceMembers(tx:SqlConnection,row:Pick<InstallationRow,'id'|'cycle'>,ids:string[]) {
  await tx.query('UPDATE installation_members SET is_current=false WHERE installation_id=$1 AND cycle=$2',[row.id,row.cycle]);
  for(const id of ids) await tx.query(`INSERT INTO installation_members (installation_id,cycle,user_id)
    VALUES ($1,$2,$3) ON CONFLICT (installation_id,cycle,user_id) DO UPDATE SET is_current=true,status='ASSIGNED',
      arrived_at=NULL,checked_out_at=NULL,active_since=NULL`,[row.id,row.cycle,id]);
}
async function requestReplay(tx:SqlConnection,actorId:string,requestId:string,hash:string) {
  const prior=(await tx.query<{installation_id:string;fingerprint:string}>(
    'SELECT installation_id,fingerprint FROM installation_requests WHERE actor_id=$1 AND request_id=$2',[actorId,requestId])).rows[0];
  if(prior && prior.fingerprint!==hash) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Esta solicitud ya se usó con otros datos. Recarga antes de continuar.');
  return prior;
}
async function saveRequest(tx:SqlConnection,actorId:string,requestId:string,id:string,hash:string) {
  await tx.query('INSERT INTO installation_requests (actor_id,request_id,installation_id,fingerprint) VALUES ($1,$2,$3,$4)',
    [actorId,requestId,id,hash]);
}
async function writeEvent(tx:SqlConnection,row:InstallationRow,actorId:string,action:string,previous:Status|null,
  summary:string,details:Record<string,unknown>={},previousOrderStatus=row.order_status) {
  const stamp=(await tx.query<{at:Date|string}>('SELECT clock_timestamp() AS at')).rows[0].at;
  await tx.query(`INSERT INTO installation_events
    (id,installation_id,actor_id,action,from_status,to_status,details,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
  [randomUUID(),row.id,actorId,action,previous,row.status,JSON.stringify({summary,...details}),stamp]);
  // Public operational OT history receives no GPS, contact data or image bytes.
  await tx.query(`INSERT INTO order_events (id,order_id,actor_id,action,from_status,to_status,details,occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
  [randomUUID(),row.order_id,actorId,'installation',previousOrderStatus,row.order_status,
    JSON.stringify({summary,changes:[{label:'Instalación',before:previous,after:row.status}]}),stamp]);
}
async function serverNow(tx:SqlConnection) {
  return new Date((await tx.query<{at:Date|string}>('SELECT clock_timestamp() AS at')).rows[0].at);
}
function validateLocation(location:z.infer<typeof locationSchema>|undefined,row:InstallationRow,now:Date) {
  if(!location) {
    if(row.location_exception) return {locationException:true,reason:row.location_exception_reason};
    throw new ApiError(400,'LOCATION_REQUIRED','Activa la ubicación para registrar llegada o salida. Si no está disponible, solicita una excepción a Administración.','location');
  }
  const age=now.getTime()-new Date(location.capturedAt).getTime();
  if(age>300000 || age < -60000) throw new ApiError(400,'LOCATION_STALE','La ubicación está desactualizada. Obtén una nueva antes de guardar.','location');
  if(location.accuracy>250) throw new ApiError(400,'LOCATION_INACCURATE','La ubicación necesita una precisión de 250 metros o mejor. Inténtalo de nuevo o solicita una excepción a Administración.','location');
  return {location};
}
function metrics(rows:InstallationRow[],now:Date,netSeconds?:number):Metrics {
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit'}).format(now);
  const completed=rows.filter(row=>row.status==='COMPLETED' && row.completed_at &&
    new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit'}).format(new Date(row.completed_at))===month);
  return {completedThisMonth:completed.length,
    inProgress:rows.filter(row=>['IN_PROGRESS','PAUSED'].includes(row.status)).length,
    postponed:rows.filter(row=>row.status==='POSTPONED').length,
    onTime:completed.filter(row=>new Date(row.completed_at!)<=new Date(row.scheduled_end_at)).length,
    scheduledCompleted:completed.length,
    netWorkMinutes:netSeconds===undefined?Math.round(rows.reduce((sum,row)=>sum+minutes(row,now.getTime()),0)*10)/10
      : Math.round(netSeconds/6)/10};
}

export async function listInstallations(db:Database,auth:AuthSession,query:z.input<typeof installationListSchema>) {
  const input=installationListSchema.parse(query);
  return db.transaction(async tx=>{
    const actor=await requireCurrentActor(tx,auth,readers);
    const all=(await tx.query<InstallationRow>(`${selectInstallation}${admin(actor.role)?'':` WHERE EXISTS
      (SELECT 1 FROM installation_members own WHERE own.installation_id=i.id AND own.cycle=i.cycle AND own.is_current AND own.user_id=$1)`}
      ORDER BY i.scheduled_start_at,i.id`,admin(actor.role)?[]:[actor.id])).rows;
    if(!admin(actor.role) && input.installerId && input.installerId!==actor.id) {
      throw new ApiError(403,'FORBIDDEN','Solo puedes consultar tus propias instalaciones.');
    }
    if(admin(actor.role)&&input.status==='CHECKED_OUT') throw new ApiError(400,'STATUS_FILTER_INVALID',
      'La salida personal no es un estado general de instalación.','status');
    const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const search=normalize(input.q);
    const filtered=all.filter(row=>(!input.status||(admin(actor.role)?row.status:personalStatus(row,actor.id))===input.status) &&
      (!input.installerId||row.members.some(member=>member.user_id===input.installerId)) &&
      (!search||normalize(`${row.order_number} ${String(row.order_number).padStart(4,'0')} ${row.client_name} ${row.description} ${row.address}`).includes(search)));
    const now=await serverNow(tx);
    // Work belongs to the person who executed each segment, even after reassignment.
    const segments=(await tx.query<{installer_id:string;seconds:string}>(`SELECT user_id AS installer_id,sum(work_seconds) AS seconds
      FROM installation_members WHERE ($1::uuid IS NULL OR user_id=$1::uuid) GROUP BY user_id`,[admin(actor.role)?null:actor.id])).rows;
    const workByInstaller=new Map(segments.map(row=>[row.installer_id,Number(row.seconds)]));
    for(const row of all) for(const member of row.members) if(member.active_since && (admin(actor.role)||member.user_id===actor.id)) {
      workByInstaller.set(member.user_id,(workByInstaller.get(member.user_id)??0)+
        Math.max(0,(now.getTime()-new Date(member.active_since).getTime())/1000));
    }
    const personRows=(userId:string)=>all.filter(row=>row.members.some(member=>member.user_id===userId)).map(row=>{
      const person=row.members.find(member=>member.user_id===userId)!;
      const status:Status=row.status==='COMPLETED' && (!person.arrived_at||person.status!=='CHECKED_OUT')?'ASSIGNED':
        ['IN_PROGRESS','PAUSED'].includes(row.status)?person.status==='IN_PROGRESS'?'IN_PROGRESS':person.status==='PAUSED'?'PAUSED':'ASSIGNED':row.status;
      return {...row,status};
    });
    const response={items:filtered.slice((input.page-1)*input.pageSize,input.page*input.pageSize).map(row=>dto(row,actor)),
      total:filtered.length,page:input.page,pageSize:input.pageSize,
      metrics:metrics(admin(actor.role)?all:personRows(actor.id),now,Array.from(workByInstaller.values()).reduce((sum,seconds)=>sum+seconds,0))};
    if(!admin(actor.role)) return response;
    const installers=(await tx.query<{id:string;name:string}>(
      "SELECT id,name FROM users WHERE role='INSTALADOR' AND is_active=true ORDER BY lower(name),id")).rows;
    const available=(await tx.query<{id:string;number:number;client_name:string;description:string}>(`
      SELECT o.id,o.number,c.name AS client_name,o.description FROM orders o JOIN clients c ON c.id=o.client_id
      WHERE ${readySql} AND NOT EXISTS (SELECT 1 FROM installations i WHERE i.order_id=o.id)
      ORDER BY o.number DESC`)).rows;
    const historicalIds=[...new Set([...all.flatMap(row=>row.members.map(member=>member.user_id)),...workByInstaller.keys()])];
    const historical=historicalIds.length?(await tx.query<{id:string;name:string}>(
      'SELECT id,name FROM users WHERE id=ANY($1::uuid[]) ORDER BY lower(name),id',[historicalIds])).rows:[];
    const performanceUsers=[...installers,...historical.filter(user=>!installers.some(active=>active.id===user.id))];
    return {...response,availableOrders:available.map(row=>({id:row.id,number:Number(row.number),clientName:row.client_name,description:row.description})),
      installers,performance:performanceUsers.map(user=>({installerId:user.id,name:user.name,
        ...metrics(personRows(user.id),now,workByInstaller.get(user.id)??0)}))};
  });
}

export async function getInstallation(db:Database,auth:AuthSession,id:string) {
  return db.transaction(async tx=>{
    const actor=await requireCurrentActor(tx,auth,readers);
    const row=await rowOf(tx,id);checkOwner(actor,row);
    const events=(await tx.query<{id:string;action:string;actor_id:string;actor_name:string;actor_role:Role;
      occurred_at:Date|string;from_status:Status|null;to_status:Status;details:Record<string,unknown>}>(`
      SELECT e.id,e.action,e.actor_id,u.name AS actor_name,u.role AS actor_role,e.occurred_at,e.from_status,e.to_status,e.details
      FROM installation_events e JOIN users u ON u.id=e.actor_id WHERE e.installation_id=$1
      ORDER BY e.occurred_at DESC,e.id DESC`,[id])).rows;
    return {installation:dto(row,actor),events:events.map(event=>({id:event.id,action:event.action,
      actor:{id:event.actor_id,name:event.actor_name,role:event.actor_role},occurredAt:iso(event.occurred_at)!,
      fromStatus:event.from_status,toStatus:event.to_status,details:event.details}))};
  });
}

export async function createInstallation(db:Database,auth:AuthSession,input:z.input<typeof createInstallationSchema>) {
  const parsed=createInstallationSchema.parse(input);
  return db.transaction(async tx=>{
    const actor=await requireCurrentActor(tx,auth,admins);
    const hash=fingerprint({operation:'create',...parsed});
    const previous=await requestReplay(tx,actor.id,parsed.requestId,hash);
    if(previous) return {installation:dto(await rowOf(tx,previous.installation_id),actor),replayed:true};
    const parent=(await tx.query<{id:string;ready:boolean}>(
      `SELECT o.id,(${readySql}) AS ready FROM orders o WHERE o.id=$1 FOR UPDATE`,[parsed.orderId])).rows[0];
    if(!parent) throw new ApiError(404,'ORDER_NOT_FOUND','No encontramos la OT.');
    if(!parent.ready) throw conflict('La OT debe requerir instalación y tener toda su producción finalizada antes de programarla.');
    const duplicate=(await tx.query<{id:string}>('SELECT id FROM installations WHERE order_id=$1',[parsed.orderId])).rows[0];
    if(duplicate) throw new ApiError(409,'INSTALLATION_EXISTS','Esta OT ya tiene una instalación. Abre la existente para administrarla.');
    const assignment=await resolveAssignment(tx,parsed);
    const id=randomUUID();
    await tx.query(`INSERT INTO installations
      (id,order_id,installer_id,status,scheduled_start_at,scheduled_end_at,address,contact_name,contact_phone,instructions,created_by,team_id,team_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id,parsed.orderId,assignment.leader,assignment.leader?'ASSIGNED':'PENDING',parsed.scheduledStartAt,
      parsed.scheduledEndAt,parsed.address,parsed.contactName,parsed.contactPhone,parsed.instructions,actor.id,assignment.teamId,assignment.teamName]);
    await replaceMembers(tx,{id,cycle:1},assignment.ids);
    const row=await rowOf(tx,id);
    await writeEvent(tx,row,actor.id,'create',null,'Programó la instalación.',{
      installerId:row.installer_id,installerName:row.installer_name,members:row.members.map(member=>({userId:member.user_id,name:member.name})),
      teamId:row.team_id,teamName:row.team_name,scheduledStartAt:iso(row.scheduled_start_at),scheduledEndAt:iso(row.scheduled_end_at)});
    await saveRequest(tx,actor.id,parsed.requestId,id,hash);
    return {installation:dto(row,actor),replayed:false};
  });
}

export async function changeInstallation(db:Database,auth:AuthSession,id:string,input:InstallationActionInput) {
  const parsed=installationActionSchema.parse(input);
  return db.transaction(async tx=>{
    const actor=await requireCurrentActor(tx,auth,readers);
    const row=await lockInstallation(tx,id);checkOwner(actor,row);
    const hash=fingerprint({operation:'action',id,...parsed});
    if(await requestReplay(tx,actor.id,parsed.requestId,hash)) return {installation:dto(row,actor),replayed:true};
    if(row.version!==parsed.version) throw conflict('Otra persona actualizó esta instalación. Recarga sus datos antes de continuar.');
    if(row.status==='COMPLETED') throw conflict('La instalación ya está finalizada.');
    if(parsed.action==='edit-details') {
      requireAdmin(actor);
      const fields=[['address','address','Dirección'],['contact_name','contactName','Contacto'],
        ['contact_phone','contactPhone','Teléfono de contacto'],['instructions','instructions','Indicaciones']] as const;
      const changes=fields.flatMap(([column,field,label])=>row[column]===parsed[field]?[]:
        [{label,before:row[column],after:parsed[field]}]);
      // Correcting logistics must not restart, pause or replace anyone's attendance.
      // It remains available while production is being corrected or the visit is postponed.
      await tx.query(`UPDATE installations SET address=$2,contact_name=$3,contact_phone=$4,instructions=$5,
        updated_at=clock_timestamp(),version=version+1 WHERE id=$1`,
      [id,parsed.address,parsed.contactName,parsed.contactPhone,parsed.instructions]);
      const updated=await rowOf(tx,id);
      await writeEvent(tx,updated,actor.id,parsed.action,row.status,'Corrigió los datos del lugar de instalación.',
        {reason:parsed.reason,changes});
      await saveRequest(tx,actor.id,parsed.requestId,id,hash);
      return {installation:dto(updated,actor),replayed:false};
    }
    if(!row.production_ready) throw conflict('La OT todavía no está disponible para instalación o su recorrido cambió. Administración debe revisar la producción.');
    const now=await serverNow(tx);
    let status:Status=row.status;
    let installerId=row.installer_id;
    let start=iso(row.scheduled_start_at)!,end=iso(row.scheduled_end_at)!;
    let startedAt=iso(row.started_at),completedAt:string|null=null;
    let result=row.result,checklist=row.checklist,teamId=row.team_id,teamName=row.team_name;
    let exception=row.location_exception,exceptionReason=row.location_exception_reason;
    let summary='',details:Record<string,unknown>={};
    const segments:Array<{workedById:string;elapsedSeconds:number}>=[];
    const person=row.members.find(member=>member.user_id===actor.id);
    const requireState=(...states:Status[])=>{if(!states.includes(row.status)) throw conflict('El estado actual de la instalación no permite esta acción.');};
    const requirePersonState=(...states:MemberRow['status'][])=>{
      requireInstaller(actor,row);
      if(!person||!states.includes(person.status)) throw conflict('Tu estado personal no permite esta acción. Recarga la instalación.');
    };
    const savePerson=async(member:MemberRow,arrival=false)=>{
      await tx.query(`UPDATE installation_members SET status=$4,
        arrived_at=CASE WHEN $8 THEN clock_timestamp() ELSE arrived_at END,checked_out_at=$5,
        active_since=CASE WHEN $8 THEN clock_timestamp() ELSE $6::timestamptz END,work_seconds=$7
        WHERE installation_id=$1 AND cycle=$2 AND user_id=$3`,
      [id,row.cycle,member.user_id,member.status,iso(member.checked_out_at),iso(member.active_since),Number(member.work_seconds),arrival]);
    };
    const stopPerson=(member:MemberRow)=>{
      if(member.active_since) {
        const elapsedSeconds=Math.max(0,(now.getTime()-new Date(member.active_since).getTime())/1000);
        member.work_seconds=Number(member.work_seconds)+elapsedSeconds;segments.push({workedById:member.user_id,elapsedSeconds});
      }
      member.active_since=null;
    };
    switch(parsed.action) {
      case 'assign':
        requireAdmin(actor);requireState('PENDING','ASSIGNED','POSTPONED');
        const assignment=await resolveAssignment(tx,parsed,true);
        if(row.installer_id===assignment.leader && row.members.length===assignment.ids.length &&
          row.members.every(member=>assignment.ids.includes(member.user_id)) && row.team_id===assignment.teamId) throw conflict('Esta asignación ya está registrada.');
        installerId=assignment.leader;teamId=assignment.teamId;teamName=assignment.teamName;
        await replaceMembers(tx,row,assignment.ids);
        status=row.status==='POSTPONED'?'POSTPONED':'ASSIGNED';
        summary=row.installer_id?'Reasignó la instalación.':'Asignó la instalación.';
        details={reason:parsed.reason,previousInstallerId:row.installer_id,previousInstallerName:row.installer_name,
          previousMemberIds:row.members.map(member=>member.user_id),installerId,memberIds:assignment.ids,teamId,teamName};break;
      case 'reschedule':
        requireAdmin(actor);requireState('PENDING','ASSIGNED','POSTPONED');
        if(new Date(parsed.scheduledEndAt)<=new Date(parsed.scheduledStartAt)) throw new ApiError(400,'SCHEDULE_INVALID','La finalización programada debe ser posterior al inicio.','scheduledEndAt');
        start=parsed.scheduledStartAt;end=parsed.scheduledEndAt;status=installerId?'ASSIGNED':'PENDING';
        if(row.status==='POSTPONED') await tx.query(`UPDATE installation_members SET status='ASSIGNED',
          arrived_at=NULL,checked_out_at=NULL,active_since=NULL WHERE installation_id=$1 AND cycle=$2 AND is_current`,[id,row.cycle]);
        summary='Reprogramó la instalación.';details={reason:parsed.reason,previousStartAt:iso(row.scheduled_start_at),
          previousEndAt:iso(row.scheduled_end_at),scheduledStartAt:start,scheduledEndAt:end};break;
      case 'arrive':
        requireState('ASSIGNED','IN_PROGRESS','PAUSED');requirePersonState('ASSIGNED');
        details=validateLocation(parsed.location,row,now);status='IN_PROGRESS';
        person!.status='IN_PROGRESS';person!.active_since=now;person!.arrived_at=now;person!.checked_out_at=null;
        await savePerson(person!,true);
        startedAt??=now.toISOString();summary='Registró su llegada e inició la instalación.';break;
      case 'pause':
        requireState('IN_PROGRESS','PAUSED');requirePersonState('IN_PROGRESS');stopPerson(person!);person!.status='PAUSED';await savePerson(person!);
        summary=parsed.kind==='LUNCH'?'Inició una pausa de almuerzo.':'Inició una pausa de descanso.';
        details={kind:parsed.kind,...(parsed.note?{note:parsed.note}:{})};break;
      case 'resume':
        requireState('IN_PROGRESS','PAUSED');requirePersonState('PAUSED');person!.status='IN_PROGRESS';person!.active_since=now;
        await savePerson(person!);status='IN_PROGRESS';
        summary='Finalizó la pausa y reanudó la instalación.';break;
      case 'checkout':
        requireState('IN_PROGRESS','PAUSED');requirePersonState('IN_PROGRESS','PAUSED');
        details=validateLocation(parsed.location,row,now);stopPerson(person!);person!.status='CHECKED_OUT';person!.checked_out_at=now;
        await savePerson(person!);summary='Registró su salida de la instalación.';
        details={...details,...(parsed.note?{note:parsed.note}:{})};break;
      case 'postpone':
        requireAdmin(actor);requireState('PENDING','ASSIGNED','IN_PROGRESS','PAUSED');
        for(const member of row.members) if(member.status==='IN_PROGRESS') {
          stopPerson(member);member.status='PAUSED';await savePerson(member);
        }
        status='POSTPONED';summary='Aplazó la instalación por instrucción administrativa.';details={reason:parsed.reason};break;
      case 'complete': {
        requireLeader(actor,row);requireState('IN_PROGRESS','PAUSED');requirePersonState('IN_PROGRESS','CHECKED_OUT');
        const stillWorking=row.members.filter(member=>member.user_id!==actor.id && ['IN_PROGRESS','PAUSED'].includes(member.status));
        if(stillWorking.length) throw new ApiError(409,'MEMBERS_STILL_WORKING','Los demás instaladores que llegaron deben registrar su salida antes del cierre.');
        const absent=row.members.filter(member=>member.user_id!==actor.id && !member.arrived_at);
        if(absent.length&&!parsed.absentMembersReason) throw new ApiError(400,'ABSENT_MEMBERS_REASON_REQUIRED',
          'Explica por qué los instaladores que no llegaron no participaron antes de cerrar.','absentMembersReason');
        details=validateLocation(parsed.location,row,now);
        const photo=(await tx.query<{id:string}>(`SELECT id FROM installation_evidence
          WHERE id=$1 AND installation_id=$2 AND cycle=$3`,[parsed.photoId,id,row.cycle])).rows[0];
        if(!photo||photo.id!==row.evidence_id) throw new ApiError(400,'EVIDENCE_REQUIRED','Guarda una fotografía vigente de esta instalación antes de finalizar.','photoId');
        stopPerson(person!);person!.status='CHECKED_OUT';person!.checked_out_at??=now;await savePerson(person!);
        status='COMPLETED';completedAt=now.toISOString();result=parsed.result;checklist=parsed.checklist;
        summary='Finalizó la instalación.';details={...details,result,checklist,photoId:parsed.photoId,
          ...(absent.length?{absentMembers:absent.map(member=>({userId:member.user_id,name:member.name})),absentMembersReason:parsed.absentMembersReason}:{})};
        await tx.query(`UPDATE orders SET status='INSTALLED',installed_at=$2,installation_note=$3,
          updated_at=$2,version=version+1 WHERE id=$1`,[row.order_id,now.toISOString(),result.slice(0,2000)]);
        break;
      }
      case 'note':
        summary='Añadió una observación de instalación.';details={note:parsed.note};break;
      case 'authorize-location-exception':
        requireAdmin(actor);exception=true;exceptionReason=parsed.reason;
        summary='Autorizó una excepción de ubicación para esta instalación.';details={reason:parsed.reason};break;
    }
    const current=(await tx.query<{status:MemberRow['status'];active_since:Date|string|null;arrived_at:Date|string|null}>(
      'SELECT status,active_since,arrived_at FROM installation_members WHERE installation_id=$1 AND cycle=$2 AND is_current',[id,row.cycle])).rows;
    if(!['POSTPONED','COMPLETED','PENDING'].includes(status)) {
      if(current.some(member=>member.status==='IN_PROGRESS')) status='IN_PROGRESS';
      else if(current.some(member=>member.status==='PAUSED'||member.arrived_at)) status='PAUSED';
      else status='ASSIGNED';
    }
    const activeSince=status==='IN_PROGRESS'?current.filter(member=>member.active_since).map(member=>iso(member.active_since)!).sort()[0]:null;
    const seconds=Number((await tx.query<{seconds:string}>(
      'SELECT coalesce(sum(work_seconds),0) AS seconds FROM installation_members WHERE installation_id=$1',[id])).rows[0].seconds);
    await tx.query(`UPDATE installations SET status=$2,installer_id=$3,scheduled_start_at=$4,scheduled_end_at=$5,
      active_since=$6,started_at=$7,completed_at=$8,work_seconds=$9,result=$10,checklist=$11::jsonb,
      location_exception=$12,location_exception_reason=$13,updated_at=$14,team_id=$15,team_name=$16,version=version+1 WHERE id=$1`,
    [id,status,installerId,start,end,activeSince,startedAt,completedAt,seconds,result,checklist?JSON.stringify(checklist):null,
      exception,exceptionReason,now.toISOString(),teamId,teamName]);
    const updated=await rowOf(tx,id);
    if(parsed.action==='assign') details={...details,installerName:updated.installer_name,
      members:updated.members.map(member=>({userId:member.user_id,name:member.name})),
      previousMembers:row.members.map(member=>({userId:member.user_id,name:member.name}))};
    await writeEvent(tx,updated,actor.id,parsed.action,row.status,summary,{...details,
      ...(segments.length?{workSegments:segments}:{})},row.order_status);
    await saveRequest(tx,actor.id,parsed.requestId,id,hash);
    return {installation:dto(updated,actor),replayed:false};
  });
}

function jpegBytes(base64:string):Buffer {
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length%4!==0) {
    throw new ApiError(400,'EVIDENCE_INVALID','Envía una fotografía JPEG válida.','imageBase64');
  }
  const bytes=Buffer.from(base64,'base64');
  if(bytes.length>163840) throw new ApiError(413,'EVIDENCE_TOO_LARGE','La fotografía supera 160 KiB. Redúcela antes de guardarla.','imageBase64');
  if(bytes.length<4 || bytes[0]!==0xff || bytes[1]!==0xd8 || bytes[2]!==0xff ||
    bytes[bytes.length-2]!==0xff || bytes[bytes.length-1]!==0xd9) {
    throw new ApiError(400,'EVIDENCE_INVALID','La evidencia debe ser una fotografía JPEG.','imageBase64');
  }
  // Inspect bounded JPEG segments before the entropy stream. A JPEG signature
  // alone is not evidence of a usable image and could conceal huge dimensions.
  let offset=2,sawFrame=false,sawScan=false;
  const invalid=()=>new ApiError(400,'EVIDENCE_INVALID','La fotografía JPEG no es válida o supera 4096 × 4096 píxeles.','imageBase64');
  while(offset<bytes.length-2) {
    if(bytes[offset++]!==0xff) throw invalid();
    while(bytes[offset]===0xff) offset++;
    const marker=bytes[offset++];
    if(marker===undefined || marker===0x00 || marker===0xd8 || marker===0xd9) throw invalid();
    if(marker===0x01 || marker>=0xd0 && marker<=0xd7) continue;
    if(offset+2>bytes.length-2) throw invalid();
    const size=bytes.readUInt16BE(offset);
    if(size<2 || offset+size>bytes.length-2) throw invalid();
    const frame=marker>=0xc0 && marker<=0xcf && ![0xc4,0xc8,0xcc].includes(marker);
    if(frame) {
      if(size<8) throw invalid();
      const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5),components=bytes[offset+7];
      if(!height || !width || height>4096 || width>4096 || height*width>16000000 ||
        ![1,3,4].includes(components) || size!==8+3*components || bytes[offset+2]!==8) throw invalid();
      sawFrame=true;
    }
    if(marker===0xda) {
      if(!sawFrame || size<6) throw invalid();
      sawScan=true;break;
    }
    offset+=size;
  }
  if(!sawFrame || !sawScan) throw invalid();
  return bytes;
}
export async function saveInstallationEvidence(db:Database,auth:AuthSession,id:string,input:z.input<typeof installationEvidenceSchema>) {
  const parsed=installationEvidenceSchema.parse(input),bytes=jpegBytes(parsed.imageBase64);
  return db.transaction(async tx=>{
    const actor=await requireCurrentActor(tx,auth,['INSTALADOR']);
    const row=await lockInstallation(tx,id);checkOwner(actor,row);requireLeader(actor,row);
    const hash=fingerprint({operation:'evidence',id,...parsed,imageBase64:createHash('sha256').update(bytes).digest('hex')});
    if(await requestReplay(tx,actor.id,parsed.requestId,hash)) return {installation:dto(row,actor),evidence:evidenceDto(row),replayed:true};
    if(row.version!==parsed.version) throw conflict('Otra persona actualizó esta instalación. Recarga antes de guardar la fotografía.');
    const person=row.members.find(member=>member.user_id===actor.id);
    if(!['IN_PROGRESS','PAUSED'].includes(row.status) || !person?.arrived_at || !row.production_ready) throw conflict('La fotografía solo se guarda después de tu llegada durante una instalación activa y disponible.');
    const count=Number((await tx.query<{count:string}>(`SELECT count(*) AS count FROM installation_evidence
      WHERE installation_id=$1 AND cycle=$2 AND created_at>=(SELECT arrived_at FROM installation_members
        WHERE installation_id=$1 AND cycle=$2 AND user_id=$3 AND is_current)`,[id,row.cycle,actor.id])).rows[0].count);
    if(count>=10) throw new ApiError(409,'EVIDENCE_LIMIT','Esta visita ya tiene 10 versiones de evidencia. Usa la última fotografía guardada.');
    await tx.query(`INSERT INTO installation_evidence (id,installation_id,cycle,uploaded_by,image)
      VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(),id,row.cycle,actor.id,bytes]);
    await tx.query('UPDATE installations SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',[id]);
    const updated=await rowOf(tx,id);
    await writeEvent(tx,updated,actor.id,'evidence',row.status,'Guardó la evidencia fotográfica de instalación.',{photoId:updated.evidence_id});
    await saveRequest(tx,actor.id,parsed.requestId,id,hash);
    return {installation:dto(updated,actor),evidence:evidenceDto(updated),replayed:false};
  });
}
export async function getInstallationEvidence(db:Database,auth:AuthSession,id:string,evidenceId:string) {
  return db.transaction(async tx=>{
    const actor=await requireCurrentActor(tx,auth,readers);
    const row=await rowOf(tx,id);checkOwner(actor,row);
    const evidence=(await tx.query<{image:Uint8Array|Buffer}>(
      'SELECT image FROM installation_evidence WHERE id=$1 AND installation_id=$2',[evidenceId,id])).rows[0];
    if(!evidence) throw new ApiError(404,'EVIDENCE_NOT_FOUND','No encontramos esta evidencia.');
    return Buffer.from(evidence.image);
  });
}

interface TeamRow {id:string;name:string;leader_id:string;is_active:boolean;version:number;
  created_at:Date|string;updated_at:Date|string;member_ids:string[]}
const teamSelect=`SELECT t.*,coalesce((SELECT array_agg(m.user_id ORDER BY m.user_id)
  FROM installation_team_members m WHERE m.team_id=t.id),'{}'::uuid[]) AS member_ids FROM installation_teams t`;
const teamDto=(team:TeamRow)=>({id:team.id,name:team.name,leaderId:team.leader_id,memberIds:team.member_ids,
  active:team.is_active,version:team.version,createdAt:iso(team.created_at)!,updatedAt:iso(team.updated_at)!});
async function teamOf(tx:SqlConnection,id:string) {
  const team=(await tx.query<TeamRow>(`${teamSelect} WHERE t.id=$1`,[id])).rows[0];
  if(!team) throw new ApiError(404,'TEAM_NOT_FOUND','No encontramos este equipo.');
  return team;
}
export async function listInstallationTeams(db:Database,auth:AuthSession) {
  return db.transaction(async tx=>{
    await requireCurrentActor(tx,auth,admins);
    const rows=(await tx.query<TeamRow>(`${teamSelect} ORDER BY t.is_active DESC,lower(t.name),t.id`)).rows;
    return {items:rows.map(teamDto)};
  });
}
export async function saveInstallationTeam(db:Database,auth:AuthSession,id:string|null,input:z.input<typeof createTeamSchema>|z.input<typeof updateTeamSchema>) {
  const parsed=id?updateTeamSchema.parse(input):createTeamSchema.parse(input);
  try {
    return await db.transaction(async tx=>{
      const actor=await requireCurrentActor(tx,auth,admins);
      const hash=fingerprint({operation:id?'update-team':'create-team',id,...parsed});
      const previous=(await tx.query<{team_id:string;fingerprint:string}>(
        'SELECT team_id,fingerprint FROM installation_team_requests WHERE actor_id=$1 AND request_id=$2',[actor.id,parsed.requestId])).rows[0];
      if(previous) {
        if(previous.fingerprint!==hash) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Esta solicitud de equipo ya se usó con otros datos.');
        return {team:teamDto(await teamOf(tx,previous.team_id)),replayed:true};
      }
      let old:TeamRow|null=null;
      if(id) {
        await tx.query('SELECT id FROM installation_teams WHERE id=$1 FOR UPDATE',[id]);old=await teamOf(tx,id);
        if(!('version' in parsed)||parsed.version!==old.version) throw new ApiError(409,'TEAM_CONFLICT','Otra persona modificó el equipo. Recarga antes de guardar.');
      }
      const name=parsed.name??old!.name,leaderId=parsed.leaderId??old!.leader_id;
      const ids=parsed.memberIds??old!.member_ids,active=parsed.active??old!.is_active;
      if(!ids.includes(leaderId)) throw new ApiError(400,'LEADER_NOT_MEMBER','El responsable debe pertenecer al equipo.','leaderId');
      for(const memberId of [...ids].sort()) await assertTeamMember(tx,memberId,active);
      const teamId=id??randomUUID();
      if(id) await tx.query(`UPDATE installation_teams SET name=$2,leader_id=$3,is_active=$4,
        version=version+1,updated_at=clock_timestamp() WHERE id=$1`,[id,name,leaderId,active]);
      else await tx.query('INSERT INTO installation_teams (id,name,leader_id,is_active) VALUES ($1,$2,$3,$4)',[teamId,name,leaderId,active]);
      // Templates are editable; each real installation keeps its independent snapshot.
      await tx.query('DELETE FROM installation_team_members WHERE team_id=$1',[teamId]);
      for(const memberId of ids) await tx.query('INSERT INTO installation_team_members (team_id,user_id) VALUES ($1,$2)',[teamId,memberId]);
      const team=await teamOf(tx,teamId);
      await tx.query('INSERT INTO installation_team_events (id,team_id,actor_id,details) VALUES ($1,$2,$3,$4::jsonb)',
        [randomUUID(),teamId,actor.id,JSON.stringify({summary:id?'Actualizó el equipo de instalación.':'Creó el equipo de instalación.',
          before:old?teamDto(old):null,after:teamDto(team)})]);
      await tx.query('INSERT INTO installation_team_requests (actor_id,request_id,team_id,fingerprint) VALUES ($1,$2,$3,$4)',
        [actor.id,parsed.requestId,teamId,hash]);
      return {team:teamDto(team),replayed:false};
    });
  } catch(error) {
    if(typeof error==='object'&&error!==null&&'code' in error&&error.code==='23505') {
      throw new ApiError(409,'TEAM_NAME_IN_USE','Ya existe un equipo con ese nombre.','name');
    }
    throw error;
  }
}

/** Caller already holds actor and OT locks. OT corrections must not leave field clocks running on unavailable work. */
export async function syncInstallationAfterOrderEdit(tx:SqlConnection,actor:{id:string},orderId:string,previousStatus:string,nextStatus:string) {
  const existing=(await tx.query<{id:string}>(
    'SELECT id FROM installations WHERE order_id=$1 FOR UPDATE',[orderId])).rows[0];
  if(!existing) return;
  const old=await rowOf(tx,existing.id);
  if(old.status==='COMPLETED' && nextStatus==='INSTALLED' || old.status!=='COMPLETED' && old.production_ready) return;
  if(old.status==='POSTPONED') return;
  const now=await serverNow(tx);
  const segments:Array<{workedById:string;elapsedSeconds:number}>=[];
  for(const member of old.members) if(member.active_since) {
    const elapsedSeconds=Math.max(0,(now.getTime()-new Date(member.active_since).getTime())/1000);
    segments.push({workedById:member.user_id,elapsedSeconds});
    await tx.query(`UPDATE installation_members SET status='PAUSED',active_since=NULL,work_seconds=work_seconds+$4
      WHERE installation_id=$1 AND cycle=$2 AND user_id=$3`,[old.id,old.cycle,member.user_id,elapsedSeconds]);
  }
  const nextCycle=old.status==='COMPLETED'?old.cycle+1:old.cycle;
  await tx.query(`UPDATE installations SET status='POSTPONED',completed_at=NULL,started_at=NULL,
    active_since=NULL,result=NULL,checklist=NULL,location_exception=false,location_exception_reason=NULL,
    work_seconds=(SELECT coalesce(sum(work_seconds),0) FROM installation_members WHERE installation_id=$1),
    cycle=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1`,[existing.id,nextCycle]);
  if(nextCycle!==old.cycle) await replaceMembers(tx,{id:existing.id,cycle:nextCycle},old.members.map(member=>member.user_id));
  const updated=await rowOf(tx,existing.id);
  await writeEvent(tx,updated,actor.id,'production-reopened',old.status,
    'Aplazó la instalación al cambiar la disponibilidad de la OT.',{
      reason:nextStatus==='IN_PRODUCTION'?'Administración añadió actividades de producción a la OT.':
        'La OT dejó de estar disponible para instalar tras una corrección administrativa.',
      previousCompletedAt:iso(old.completed_at),previousResult:old.result,previousChecklist:old.checklist,
      previousPhotoId:old.evidence_id,...(segments.length?{workSegments:segments}:{})},previousStatus);
}
