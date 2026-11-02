# Contrato de Instalaciones — 29/10/2026

Nuevo alcance autorizado: cuentas personales de instalador, planificación individual, varios instaladores y equipos reutilizables, ubicación puntual de llegada/salida, pausas y evidencia fotográfica privada. No añade seguimiento continuo ni un modo de trabajo sin conexión. Trabajo únicamente local: el usuario indicó no publicar en main.

## Acceso y respuestas

Base `/api/v1/installations`, misma cookie y CSRF existentes. Solo ADMINMASTER/ADMIN_GENERAL e INSTALADOR. Instalador únicamente sus instalaciones actuales; administración supervisa todas. Nunca se incluyen valores comerciales. Fechas ISO UTC; la interfaz presenta America/Bogota.

`GET /?page=1&pageSize=25&status=ASSIGNED&installerId=uuid&q=texto`:

```ts
{
  items: Installation[]; page: number; pageSize: number; total: number;
  metrics: Metrics;
  // Solo Administración:
  availableOrders?: {id:string; number:number; clientName:string; description:string}[];
  installers?: {id:string; name:string}[];
  performance?: ({installerId:string; name:string} & Metrics)[];
}
interface Metrics {
  completedThisMonth:number; inProgress:number; postponed:number;
  onTime:number; scheduledCompleted:number; netWorkMinutes:number;
}
interface Installation {
  id:string; orderId:string; orderNumber:number; clientName:string;
  description:string; status:'PENDING'|'ASSIGNED'|'IN_PROGRESS'|'PAUSED'|'POSTPONED'|'COMPLETED';
  personalStatus:'ASSIGNED'|'IN_PROGRESS'|'PAUSED'|'CHECKED_OUT'|'POSTPONED'|'COMPLETED'|null;
  installerId:string|null; installerName:string|null; version:number;
  teamId:string|null; teamName:string|null;
  members:{userId:string;name:string;isLead:boolean;status:'ASSIGNED'|'IN_PROGRESS'|'PAUSED'|'CHECKED_OUT';
    arrivedAt:string|null;checkedOutAt:string|null;netWorkMinutes:number}[];
  scheduledStartAt:string; scheduledEndAt:string; address:string;
  contactName:string; contactPhone:string; instructions:string;
  startedAt:string|null; completedAt:string|null; result:string|null;
  checklist:{mounted:boolean; electrical:'VERIFIED'|'NOT_APPLICABLE'}|null;
  locationException:boolean; locationExceptionReason:string|null;
  evidence:{id:string;url:string;createdAt:string}|null;
  createdAt:string; updatedAt:string; netWorkMinutes:number;
  productionReady:boolean;
  products:{id:string;description:string;quantity:number;
    materials:{id:string;material:string;length:number;width:number;areaM2:number}[]}[];
}
```

`GET /:id` → `{installation:Installation,events:Event[]}`. Eventos: `{id,action,actor:{id,name,role},occurredAt,fromStatus,toStatus,details}`; details contiene resumen, motivo/notas y ubicación puntual cuando corresponde. Ubicación solo se entrega dentro de este módulo autorizado, nunca en el historial general de OT.

Estado y filtros personales: `status` conserva siempre el estado general del trabajo. `personalStatus` es null para Administración; para el instalador representa su asistencia propia, salvo POSTPONED/COMPLETED generales que prevalecen. El filtro `GET ?status=` consulta ese estado personal para INSTALADOR y el general para Administración. Se admite CHECKED_OUT exclusivamente como filtro personal (jornada terminada mientras la instalación sigue abierta). Por ello una persona aún sin llegada sigue encontrando el trabajo en Por instalar aunque otro integrante haya comenzado, y una pausa individual no desaparece de En pausa mientras un compañero continúa trabajando. Cuando la instalación finaliza, pasa a Finalizadas para todos sus miembros; las métricas siguen sin atribuir una completada a quienes nunca llegaron.

## Escrituras

`POST /` exclusivo Administración: `{requestId:uuid,orderId:uuid,installerId?:uuid,installerIds?:uuid[],teamId?:uuid,scheduledStartAt:ISO,scheduledEndAt:ISO,address:string,contactName?:string,contactPhone?:string,instructions?:string}` → `{installation,replayed}`. Una instalación por OT, únicamente si producción terminó y requiere instalación. Sin instalador inicia PENDING; con instalador activo inicia ASSIGNED. No crea cuentas ficticias. `installerId` es el principal, debe pertenecer a `installerIds` si se envía la lista. Sin principal se utiliza el del equipo o el primero de la lista. Solo `teamId` copia su responsable y miembros actuales; una lista explícita permite ajustar el conjunto para esa instalación sin modificar el equipo. El nombre del equipo y los miembros se guardan como fotografía de la asignación.

Todas las acciones: `POST /:id/actions` → `{installation,replayed}`. Cuerpo común `{requestId:uuid,version:number,action:...}`. Campos por acción:

| Acción | Campos adicionales | Permiso |
|---|---|---|
| assign | `installerId?:uuid,installerIds?:uuid[],teamId?:uuid,reason:string` | Administración; nunca en ejecución/pausa/finalizada |
| reschedule | `scheduledStartAt:ISO,scheduledEndAt:ISO,reason:string` | Administración; nunca en ejecución/pausa/finalizada |
| arrive | `location?:Location` | Instalador asignado; desde ASSIGNED |
| pause | `kind:'REST'|'LUNCH',note?:string` | Instalador asignado; desde IN_PROGRESS |
| resume | sin campos extra | Instalador asignado; desde PAUSED |
| checkout | `location?:Location,note?:string` | Cada miembro que llegó, desde su estado IN_PROGRESS/PAUSED |
| postpone | `reason:string` | Solo Administración; no finalizada |
| complete | `location?:Location,result:string,checklist:{mounted:true,electrical:'VERIFIED'|'NOT_APPLICABLE'},photoId:uuid,absentMembersReason?:string` | Solo principal, desde su estado IN_PROGRESS/CHECKED_OUT |
| note | `note:string` | Administración o instalador asignado; no finalizada |
| edit-details | `address:string,contactName:string,contactPhone:string,instructions:string,reason:string` | Administración; no finalizada, también aplazada/no disponible |
| authorize-location-exception | `reason:string` | Administración; no finalizada |

`Location = {latitude:number,longitude:number,accuracy:number,capturedAt:ISO}`. Captura reciente (máximo 5 minutos), sin fecha futura >60s y precisión <=250m. Es obligatorio capturar ubicación en llegada y cierre salvo excepción expresa por instalación autorizada por Administración con motivo. El reloj de los eventos siempre es el del servidor. La ubicación del navegador no demuestra por sí sola que el dispositivo sea imposible de manipular.

Cada miembro registra su propia llegada, pausa, reanudación y salida; nunca en nombre de otra persona. El estado general permanece En ejecución mientras cualquiera trabaja y pasa a Pausada cuando nadie tiene reloj activo pero existe asistencia. El aplazamiento administrativo detiene todos los relojes activos. Reprogramar una aplazada la devuelve a ASSIGNED (o PENDING si no tiene responsable); las asistencias de la nueva visita comienzan pendientes, conservando eventos y tiempo anterior. Para cambiar responsables durante ejecución primero se aplaza. Administración no suplanta al instalador para registrar llegada o cierre. Solo el principal cierra la instalación: exige montaje verificado, prueba eléctrica o no aplica, resultado, última fotografía guardada y salida de todos los demás que llegaron. Si un asignado nunca llegó, `absentMembersReason` es obligatorio; el cierre registra su identidad y motivo, y no le atribuye trabajo completado ni tiempo. El principal puede cerrar desde En ejecución, registrando su salida GPS en ese mismo paso, o después de registrar su salida individual. Cierre cambia también la OT a INSTALLED atómicamente.

`POST /:id/evidence`: `{requestId:uuid,version:number,imageBase64:string}`. Solo principal después de su llegada y mientras la instalación esté IN_PROGRESS o PAUSED. JPEG optimizado, máximo160KiB decodificados y4096×4096píxeles (16Mp); validación estructural JPEG y almacenamiento privado de BD (no disco efímero). Respuesta `{installation,evidence:{id,url,createdAt},replayed}`. Cada nueva carga conserva la versión previa inmutable, con máximo10por visita; el detalle enseña la última posterior a la llegada del principal actual y solo esta puede usarse para cerrar. Aplazar, reprogramar o reasignar deja `evidence=null` hasta una nueva llegada y fotografía de esa visita; las anteriores siguen conservadas. La llegada se mantiene con precisión del reloj de PostgreSQL para evitar confundir visitas dentro del mismo milisegundo. La URL requiere sesión. `GET /:id/evidence/:evidenceId` entrega image/jpeg, no-store, exclusivamente a Administración y miembros actuales del trabajo. No hay URLs públicas.

## Equipos reutilizables

Solo Administración: `GET /teams` → `{items:Team[]}`; `POST /teams` → `{team,replayed}`, cuerpo `{requestId,name,leaderId,memberIds,active?:boolean}` (activo por defecto). `PATCH /teams/:id` → `{team,replayed}`, cuerpo `{requestId,version,name?,leaderId?,memberIds?,active?}`. `Team={id,name,leaderId,memberIds,active,version,createdAt,updatedAt}`. Nombre único sin distinguir mayúsculas; responsable dentro del equipo; como máximo15miembros activos y sin duplicados. Desactivar no elimina el historial. Mutaciones idempotentes, control de versión y auditoría antes/después. Editar/desactivar un equipo no cambia instalaciones previamente asignadas: su snapshot permanece independiente; la reasignación explícita de una instalación exige motivo administrativo.

Conflicto de versión:409 `INSTALLATION_CONFLICT`, recargar antes de reintentar. Reutilizar requestId únicamente para reenviar exactamente la misma operación tras fallo de conexión; contenido distinto con la misma clave devuelve409. Todas las escrituras revalidan cuenta, responsable y producción en servidor. La interfaz no debe informar éxito ni sincronización hasta recibir confirmación.

## Correcciones y recorrido

Las respuestas incluyen los productos de la OT, su descripción, cantidad y materiales con largo, ancho y m². Esa proyección técnica excluye precios, valores unitarios, pagos e importes fiscales. Dirección, contacto e indicaciones se corrigen mediante `edit-details`, con motivo, control de versión y auditoría de antes/después; no se modifica el tiempo de asistencia. No se permite esa corrección cuando la instalación ya está finalizada.

Una corrección administrativa de OT puede retirar la instalación requerida o añadir producción aun cuando ya se hubiera programado/iniciado/terminado la instalación. Si deja de estar disponible se aplaza automáticamente, se detienen los relojes y se preservan tiempos, responsables, eventos y fotos. Una OT pendiente de instalación también vuelve a producción al agregar trabajo. Al terminar producción, Administración debe reprogramar antes de otra llegada y guardar una foto de la nueva visita. Una instalación finalizada que se reabre conserva el ciclo anterior e inicia otro; no se crea una segunda instalación para la misma OT.

## Métricas

Completadas del mes y puntualidad usan fecha de finalización y mes actual Bogotá; onTime cuenta finalización <= fin programado, scheduledCompleted es denominador de finalizadas del mes. En curso personal depende del estado de asistencia propio, no del reloj de un compañero. Minutos netos acumula únicamente tiempo activo propio (excluye pausa/aplazamiento) y conserva ese trabajo tras reasignar; no se transfiere al principal nuevo. El total del trabajo suma minutos-persona, por lo que dos personas que trabajaron10minutos representan20minutos-persona, no duración de reloj20minutos. No se cuentan completadas a miembros ausentes. No inventar métricas de garantía sin registros. Filtros de lista no alteran el resumen global autorizado.

## Excepción de ubicación confirmada — 29/10/2026

El usuario confirmó la excepción de ubicación autorizada por Administración con motivo obligatorio. Si se rechaza el permiso GPS o el dispositivo no obtiene una ubicación adecuada, no se registra éxito ni una posición ficticia: el instalador debe solicitar esa autorización para el trabajo. La excepción y su motivo quedan auditados; cada llegada o salida realizada sin coordenadas registra que utilizó esa autorización. No habilita seguimiento continuo ni permite que Administración suplante al instalador.

## Activación

Aplicar `server/migrations/015_installations.sql` antes de desplegar. RLS habilitado sin acceso directo anon/authenticated; acceso por servidor autenticado. No se alteran consecutivos, usuarios existentes ni datos comerciales. Evidencias y coordenadas son datos privados operativos: acceso por autorización y no enlaces públicos. Las OT ya instaladas por el flujo anterior conservan su historial y no se duplican.
