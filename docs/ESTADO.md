# Estado de continuidad

Actualizado: 2026-10-05.

## Estado actual

El tramo de Corte Láser y borradores quedó publicado anteriormente en `main` mediante el commit `97472bf`. El usuario confirmó que `server/migrations/008_laser_drafts.sql` fue ejecutada en Supabase. El commit `d31d776` contiene la búsqueda por descripción y los controles de sesión.

El tramo del selector desplegable de clientes y la restauración del historial quedó implementado, verificado, versionado y enviado a `origin/main` el 30/09/2026.

El 01/10/2026 quedó implementada, verificada, versionada y enviada a `origin/main` la identificación del creador de la OT para Impresión y Taller. La lista operativa del servidor entrega exclusivamente el nombre y el rol del creador, sin abrir acceso al directorio de usuarios, correos ni datos administrativos. El detalle conserva esa identificación después de actualizar o avanzar una orden. No requiere SQL ni migración. El despliegue productivo posterior al `push` no se ha comprobado desde este entorno.

El 03/10/2026 el usuario confirmó que `server/migrations/009_printing_handoff.sql` fue ejecutada en Supabase. El registro obligatorio de quién recibe en Taller al finalizar Impresión quedó implementado, verificado, versionado en `eea5e25` y enviado a `origin/main`. Cubre actividades por producto, Corte Láser y OT heredadas. El despliegue productivo posterior al `push` no se ha comprobado desde este entorno.

El 03/10/2026 se preparó `server/maintenance/borrar_todos_los_datos_para_entrega_2026-10-03.sql` para dejar en cero todos los datos comerciales y operativos antes del inicio real. La consulta elimina clientes, OT, pagos, multiabonos, productos, materiales, actividades, eventos y borradores; conserva usuarios, sesiones, bloqueos e historial de migraciones, y deja la siguiente OT en 1. Es una utilidad manual, no una migración, y no se ejecutó desde este entorno.

El usuario ejecutó la limpieza total en Supabase y mostró los nueve contadores comerciales en cero, con 7 usuarios y 3 sesiones conservadas. El 05/10/2026 se corrigió la edición FACT → REM: el formulario y el adaptador API envían las tres retenciones en cero, y el servidor limpia también los certificados relacionados. La corrección quedó verificada localmente y enviada a `origin/main`; no requiere migración SQL.

El 05/10/2026 se estableció que toda OT con Impresión normal debe incluir al menos un material desde su creación o edición, incluso cuando también tenga actividad de Diseño. La interfaz informa la obligación y bloquea el guardado; el servidor aplica la misma regla ante llamadas directas. Corte Láser continúa sin materiales. El cambio quedó verificado y enviado a `origin/main`; no requiere migración SQL.

## Funcionalidades terminadas en este tramo

- Impresión debe escribir quién recibe el trabajo en Taller antes de finalizar su actividad.
- Un intento vacío o compuesto solo por espacios se rechaza con `Por favor, digitar quien recibe en taller.`.
- El servidor exige el dato incluso ante llamadas directas y lo normaliza eliminando espacios al inicio y al final.
- El nombre queda guardado en la actividad correspondiente y se puede consultar después desde el detalle y desde Taller.
- El flujo también cubre OT antiguas que todavía utilizan la etapa general de Impresión.
- Al abrir una OT, los perfiles de Impresión y Taller ven quién la registró y el rol de esa persona.
- La identidad operativa se limita a nombre y rol; no se exponen correo, estado de cuenta, teléfono, NIT ni datos financieros.
- La referencia al creador se conserva en pantalla después de editar, registrar una acción o cambiar la etapa de la OT.
- El historial de órdenes busca por número de OT, cliente y descripción del trabajo.
- La búsqueda por descripción no distingue mayúsculas ni tildes; una consulta como `TALONARIOS` devuelve todas las OT visibles que contengan ese texto.
- La primera carga después de iniciar o restaurar una sesión se utiliza como línea base silenciosa: las OT históricas ya existentes no generan avisos repetidos.
- Los avisos de llegada continúan funcionando después de la línea base cuando una OT nueva o un cambio real de etapa llega a Administración, Impresión o Taller.
- El enlace textual de cambio de contraseña fue reemplazado por un botón naranja con icono de llave y borde oscuro.
- El botón de cerrar sesión quedó junto al de contraseña, con el mismo tratamiento visual.
- La pantalla de cambio permite mostrar u ocultar únicamente la contraseña actual que el usuario está escribiendo. La contraseña almacenada nunca se recupera ni se muestra porque el servidor conserva solo su hash Argon2id.
- Se conservó el flujo seguro existente: contraseña actual obligatoria, nueva contraseña de 12 a 128 caracteres, confirmación, rotación de sesión y revocación de las sesiones anteriores.
- En Nueva OT, el campo de cliente ahora es un buscador desplegable único: filtra en vivo por nombre, identificación o celular y permite seleccionar una coincidencia con clic o teclado.
- Al comenzar una búsqueda nueva se elimina la selección anterior para impedir que una OT se guarde accidentalmente con otro cliente.
- `Consultar clientes` y `Nuevo cliente` son botones diferenciados y ordenados; el desplegable se mantiene contenido en pantallas móviles.
- La página y todos los filtros del historial se representan en la URL. Al abrir una OT y usar Atrás del navegador se recupera la misma página y contexto.
- Entrar de nuevo a Órdenes desde el menú utiliza `/orders` sin parámetros y comienza limpiamente en la página 1.

## Archivos principales

- `src/pages/Orders.tsx`
- `src/pages/OrderDetail.tsx`
- `src/pages/Queues.tsx`
- `src/data/AppContext.tsx`
- `src/data/api.ts`
- `src/domain/types.ts`
- `src/domain/service.ts`
- `src/data/orderNotifications.ts`
- `src/components/AppShell.tsx`
- `src/pages/ChangePassword.tsx`
- `src/pages/NewOrderEditor.tsx`
- `src/pages/orders.css`
- `src/styles.css`
- `tests/order-notifications.test.ts`
- `tests/frontend.spec.ts`
- `tests/api-e2e.spec.ts`
- `server/src/orders/domain.ts`
- `server/src/orders/service.ts`
- `server/src/work/router.ts`
- `server/src/work/schemas.ts`
- `server/src/work/service.ts`
- `server/migrations/009_printing_handoff.sql`
- `server/migrations/010_audit_history.sql`
- `server/migrations/011_order_deletion_workshop_notes.sql`
- `server/migrations/012_disable_order_deletion.sql`
- `server/src/history/router.ts`
- `server/src/history/service.ts`
- `server/maintenance/borrar_todos_los_datos_para_entrega_2026-10-03.sql`
- `server/tests/cleanup-test-data.test.ts`
- `server/tests/orders.test.ts`
- `server/tests/work.test.ts`
- `server/tests/laser_drafts.test.ts`
- `server/tests/history.test.ts`

## Verificación local

- `npm run typecheck`: aprobado.
- `npm test`: 151/151 en 3 archivos.
- `npm run build`: aprobado.
- `npm --prefix server run typecheck`: aprobado.
- `npm --prefix server test`: 272/272 en 9 archivos.
- La prueba de limpieza total confirma las nueve tablas comerciales vacías, usuarios/sesiones/configuración conservados y la siguiente OT en 1.
- La regresión FACT → REM confirma documento REM, IVA y retenciones en cero, certificados desmarcados y saldo recalculado.
- Las pruebas confirman que Impresión normal sin materiales se rechaza tanto con Diseño como sin Diseño, mientras Corte Láser sigue admitiendo cero materiales.
- Nueva OT exige un diseñador específico cuando Administración selecciona Diseño; si la OT la crea Diseño, el servidor conserva la autoasignación al creador.
- Se retiró la acción `Tomar tarea` de la interfaz y del servidor, por lo que ninguna actividad nueva de Diseño puede quedar libre para ser reclamada.
- Administración puede corregir materiales de Impresión mientras Diseño está en proceso. La corrección conserva el identificador, responsable y estado de la actividad de Diseño; productos, valores, áreas y responsables siguen protegidos, y cualquier avance posterior mantiene el bloqueo completo.
- La regresión de edición confirma que esa corrección conserva la actividad `IN_PROGRESS`, mientras un cambio tardío en la descripción comercial continúa rechazándose.
- Cada detalle de OT incorpora un historial visible para sus perfiles autorizados con responsable, rol, fecha, hora, acción y cambios operativos; los datos financieros se eliminan de la respuesta para Diseño, Impresión y Taller.
- Se añadió el módulo administrativo `Historial`, con todos los eventos, expansión del cambio y enlace directo a la OT. La migración `010_audit_history.sql` agrega el detalle JSON estructurado a `order_events` sin alterar registros previos.
- Se retiró por decisión del cliente la eliminación de OT: no existe botón, contrato frontend ni endpoint de servidor para borrar órdenes. La migración compensatoria `012_disable_order_deletion.sql` devuelve el consecutivo a `GENERATED ALWAYS`.
- Taller puede guardar observaciones opcionales al finalizar, tanto en actividades por producto como en el flujo heredado; el dato permanece visible en la OT terminada.
- ADMINMASTER puede corregir una OT terminada o instalada que todavía no esté cerrada. Al agregar áreas omitidas conserva las actividades finalizadas, crea solo las faltantes como pendientes y devuelve la OT a producción; ADMIN_GENERAL y los demás perfiles permanecen bloqueados.
- Pruebas dirigidas de órdenes, actividades y Corte Láser: 120/120.
- Pruebas E2E locales de Impresión, Taller y materiales: 3/3.
- Prueba E2E dirigida para Impresión y Taller: 2/2; ambos perfiles visualizan al creador en el detalle.
- `npm run test:e2e`: los 32 casos funcionales aprobaron, incluidos el desplegable abierto en móvil y la restauración de la página 4. Dos recorridos completos cerraron 31/32 por incidencias transitorias del entorno de Playwright (un artefacto de traza y una espera de carga antes del login); ambos casos restantes aprobaron 1/1 al repetirlos aisladamente.
- `npm run test:e2e:api`: 5/5 con API y PGlite reales.
- El nuevo recorrido E2E FACT → REM quedó añadido; no pudo repetirse en este cierre porque faltaba el binario local de Chromium y su descarga agotó el tiempo de red. La misma regla sí quedó cubierta por la prueba de integración del servidor y los 269 casos aprobaron.
- La prueba del servidor confirma varias coincidencias por descripción con `TALONARIOS`.
- La prueba de sesión confirma que la carga inicial es silenciosa y que los avisos posteriores continúan activos.
- La prueba de navegación confirma página 4 → detalle de OT → Atrás → página 4, y luego menú Órdenes → página 1 sin filtros heredados.
- Las pruebas local y API seleccionan clientes mediante búsqueda y clic; la regresión móvil conserva el desplegable sin desbordamiento horizontal.
- `git diff --check`: sin errores al cierre.

Las pruebas usan PGlite aislado o el adaptador local; no escriben en PostgreSQL productivo.

## Contador comercial de cambios

Se cuentan solicitudes funcionales agrupando como un solo cambio cada petición del cliente, aunque internamente afecte varios archivos. La clasificación significativa evita cobrar aparte correcciones visuales, textos, validaciones menores y ajustes responsive.

| Entrega | Cambios totales | Significativos |
|---|---:|---:|
| Cierre funcional del 20/09 | 17 | 10 |
| Corte Láser, borradores y ajustes productivos del 22/09 | 11 | 4 |
| Búsqueda, avisos y controles de cuenta del 27/09 | 3 | 1 |
| Selector de clientes y contexto del historial del 30/09 | 3 | 2 |
| Identidad del creador para producción del 01/10 | 1 | 0 |
| Entrega de Impresión a Taller del 02/10 | 1 | 1 |
| Material obligatorio al crear Impresión normal del 05/10 | 1 | 1 |
| Diseñador obligatorio al seleccionar Diseño del 05/10 | 1 | 1 |
| Historial detallado y auditoría de OT del 05/10 | 1 | 1 |
| Borrado administrativo con renumeración del 06/10 | 1 | 1 |
| Observaciones al finalizar Taller del 06/10 | 1 | 1 |
| Retiro del borrado de OT del 07/10 | 1 | 1 |
| Reapertura correctiva exclusiva de ADMINMASTER del 07/10 | 1 | 1 |
| **Acumulado** | **43** | **25** |

Para la entrega del 30/09, los dos cambios significativos son el selector desplegable de clientes y la conservación de página/filtros del historial. Convertir los enlaces de clientes en botones se cuenta como un ajuste visual independiente, pero no significativo.

La identificación del creador solicitada el 01/10 se cuenta como un cambio menor de visibilidad operativa, no como un cambio significativo.

El registro obligatorio de entrega solicitado el 02/10 se considera significativo porque cambia la regla de finalización productiva, persiste un dato nuevo y requiere migración de base de datos.

La obligación de registrar materiales desde la creación se considera significativa porque cambia la responsabilidad dentro del flujo productivo y bloquea la creación o edición de la OT si falta la información técnica.

La asignación obligatoria de Diseño se considera significativa porque elimina las tareas libres, bloquea la creación o edición sin responsable y modifica la distribución del trabajo entre diseñadores.

El historial se considera significativo porque incorpora persistencia estructurada de auditoría, una ruta protegida, un módulo administrativo y trazabilidad dentro de cada OT con filtrado por perfil.

El borrado se considera significativo porque elimina de forma transaccional toda la información de una OT, renumera los registros posteriores y reajusta el consecutivo automático sin duplicados.

El retiro del borrado se considera significativo porque revierte por completo ese flujo, elimina su endpoint y devuelve la protección del consecutivo en la base de datos.

La reapertura correctiva se considera significativa porque modifica las reglas de edición y el ciclo productivo de una OT terminada, preservando trabajo histórico y generando únicamente las actividades faltantes.

Las observaciones de Taller se consideran significativas porque añaden persistencia nueva al cierre productivo, modifican el contrato del servidor y requieren migración de base de datos.

## Pendiente para producción

1. Ejecutar manualmente `server/migrations/012_disable_order_deletion.sql` en Supabase antes de publicar este código.
2. Confirmar en producción que ninguna OT presenta una acción de eliminación.
3. Comprobar en producción una finalización de Taller con observaciones y otra sin observaciones.

## Comando para retomar

```powershell
git status --short --branch
git log -3 --oneline
npm run typecheck
npm test
npm --prefix server run typecheck
npm --prefix server test
```
