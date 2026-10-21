# Estado de continuidad

Actualizado: 2026-10-21.

## Estado actual

El 21/10/2026 se reorganizó Reportes en ocho cuadros principales con los nombres solicitados. TOTAL IVA muestra el IVA original de las FACT del período, independiente de abonos/retenciones; el reemplazo de IVA pendiente muestra la suma actual de retenciones pendientes de certificado. Las dos carteras se presentan juntas. Cada cuadro de cobro (cinco principales y tres individuales de retenciones) despliega sus OT positivas por número descendente, con cliente, descripción, importe, paginación y enlace. Se añadió consulta de detalle protegida y se unificaron filtros de categoría/documento con certificados; marcar un certificado actualiza también el total superior. El gráfico remoto usa agregados del servidor y los cuadros evitan sustituir la carga/error remoto por totales parciales locales. No se modificaron reglas de cobro, datos productivos ni la pantalla Cartera; no requiere SQL.

Archivos de este tramo: `src/pages/Reports.tsx`, `src/components/ReceivableKpi.tsx`, `src/components/ui.tsx`, `src/domain/receivables.ts`, `src/data/api.ts`, `src/pages/analytics.css`, `server/src/reports/{router,schemas,service}.ts`, `server/tests/reports_finance.test.ts`, `tests/{analytics.test,finance.spec,api-e2e.spec}.ts` y documentación de continuidad.

El 20/10/2026 se añadieron los cuadros **Total cartera REM** y **Total cartera FACT** en Reportes y Cartera para ADMINMASTER y ADMIN_GENERAL. Se usa el saldo pendiente al corte, descontando los abonos y conservando IVA/retenciones de FACT; se respetan filtros y órdenes de períodos anteriores. El servidor calcula los totales sin depender de la página consultada. No requiere SQL ni migraciones. Archivos de este tramo: `src/pages/Reports.tsx`, `src/pages/Portfolio.tsx`, `src/data/api.ts`, `server/src/reports/service.ts`, `tests/analytics.test.ts`, `tests/finance.spec.ts` y `server/tests/reports_finance.test.ts`.

El tramo de Corte Láser y borradores quedó publicado anteriormente en `main` mediante el commit `97472bf`. El usuario confirmó que `server/migrations/008_laser_drafts.sql` fue ejecutada en Supabase. El commit `d31d776` contiene la búsqueda por descripción y los controles de sesión.

El tramo del selector desplegable de clientes y la restauración del historial quedó implementado, verificado, versionado y enviado a `origin/main` el 30/09/2026.

El 01/10/2026 quedó implementada, verificada, versionada y enviada a `origin/main` la identificación del creador de la OT para Impresión y Taller. La lista operativa del servidor entrega exclusivamente el nombre y el rol del creador, sin abrir acceso al directorio de usuarios, correos ni datos administrativos. El detalle conserva esa identificación después de actualizar o avanzar una orden. No requiere SQL ni migración. El despliegue productivo posterior al `push` no se ha comprobado desde este entorno.

El 03/10/2026 el usuario confirmó que `server/migrations/009_printing_handoff.sql` fue ejecutada en Supabase. El registro obligatorio de quién recibe en Taller al finalizar Impresión quedó implementado, verificado, versionado en `eea5e25` y enviado a `origin/main`. Cubre actividades por producto, Corte Láser y OT heredadas. El despliegue productivo posterior al `push` no se ha comprobado desde este entorno.

El 03/10/2026 se preparó `server/maintenance/borrar_todos_los_datos_para_entrega_2026-10-03.sql` para dejar en cero todos los datos comerciales y operativos antes del inicio real. La consulta elimina clientes, OT, pagos, multiabonos, productos, materiales, actividades, eventos y borradores; conserva usuarios, sesiones, bloqueos e historial de migraciones, y deja la siguiente OT en 1. Es una utilidad manual, no una migración, y no se ejecutó desde este entorno.

El usuario ejecutó la limpieza total en Supabase y mostró los nueve contadores comerciales en cero, con 7 usuarios y 3 sesiones conservadas. El 05/10/2026 se corrigió la edición FACT → REM: el formulario y el adaptador API envían las tres retenciones en cero, y el servidor limpia también los certificados relacionados. La corrección quedó verificada localmente y enviada a `origin/main`; no requiere migración SQL.

El 05/10/2026 se estableció que toda OT con Impresión normal debe incluir al menos un material desde su creación o edición, incluso cuando también tenga actividad de Diseño. La interfaz informa la obligación y bloquea el guardado; el servidor aplica la misma regla ante llamadas directas. Corte Láser continúa sin materiales. El cambio quedó verificado y enviado a `origin/main`; no requiere migración SQL.

El 11/10/2026 quedó implementada la edición manual de retenciones en la interfaz de creación, pero esta regla fue reemplazada el 14/10/2026 por instrucción del usuario: toda FACT nueva calcula retenciones automáticamente, y solo Administración las puede cambiar después mediante Editar OT. No requiere migración.

El 14/10/2026 se retiró la captura manual de retenciones al crear y se impuso el cálculo automático en servidor y adaptador local, incluso si una solicitud de creación incluye importes. Los borradores ya no restauran el tipo de documento; se reabren como REM con aviso para confirmar o seleccionar FACT. La edición de OT permanece reservada a ADMINMASTER y ADMIN_GENERAL, con controles de ruta, interfaz y servidor. Sin migración SQL. Verificación: `npm run typecheck`, `npm --prefix server run typecheck`, `npm test` (154 pruebas), `npm --prefix server test` (274 pruebas), `npm run build`, `npm --prefix server run build`, dos pruebas e2e dirigidas y `git diff --check`, todo aprobado. Las pruebas Playwright usaron el Chromium 1217 ya disponible localmente.

El 14/10/2026 se amplió a ADMINMASTER y ADMIN_GENERAL la edición de OT `COMPLETED` e `INSTALLED` sin cierre administrativo. Se preserva el trabajo terminado; las áreas omitidas agregadas reabren la OT en producción, y continúan bloqueadas la retirada de áreas, la alteración de responsables/tipos ya ejecutados, los materiales consumidos y las OT con cierre administrativo. Sin migración SQL. Verificado localmente.

El 14/10/2026 se implementó un indicador FACTURADO en la lista administrativa, con X para FACT sin facturar y chulo interactivo que revela la referencia, además del campo FACTURADO en Editar OT FACT tanto en el editor compuesto como en el editor legado. La migración es `013_facturation_reference.sql`. No se puede ingresar al crear ni aparece para REM. Verificado: 158 pruebas frontend, 275 pruebas servidor, ambos typecheck/builds, E2E del flujo compuesto y legado, y `git diff --check`. Sin evidencia de ejecución en Supabase: aplicar la migración manualmente antes de desplegar el backend.

El 14/10/2026, ante el reporte de que Administración no veía Editar OT #003, se centralizó la autorización de edición para que ADMINMASTER y ADMIN_GENERAL utilicen la misma regla de rol, estado y cierre administrativo tanto en el detalle como al abrir el editor. Prueba E2E con ADMIN_GENERAL: OT #003 muestra el botón y abre la edición; también se conserva la cobertura de OT terminadas, instaladas y cerradas. `npm run typecheck`, `npm test` (158), E2E dirigido (1/1) y `git diff --check` aprobados. La validación usa el adaptador local; no confirma estado de la cuenta ni despliegue productivo.

El 14/10/2026, por instrucción expresa del usuario, se amplió Editar OT a todos los estados, incluidos actividades en producción e instalación y órdenes cerradas administrativamente. Las ediciones conservan el estado y las actividades existentes; los materiales se pueden corregir mientras la actividad de Impresión siga pendiente y no se hayan consumido, y quedan bloqueados cuando Impresión inicia o se consume material. No se pueden quitar actividades/productos ni cambiar responsables o tipo de impresión ya existentes. Se conserva la reapertura de OT terminadas no cerradas al agregar áreas faltantes; una OT cerrada admite correcciones, pero no reabrir su recorrido. Verificación: `npm test` (158), `npm --prefix server test` (276), typechecks y builds de frontend/servidor, E2E de Administración editando durante producción y una OT cerrada (1/1), y `git diff --check`, todo aprobado. No requiere migración SQL.

El 14/10/2026 se corrigió la ruta de edición de OT compuestas en `IN_PRODUCTION`: se usa la actualización que conserva actividades y materiales en vez de intentar reemplazar productos, lo que causaba el error “No se pueden cambiar los productos cuando una etapa posterior a Diseño ya comenzó o se consumió material”. Administración puede corregir los datos de productos existentes; no puede agregar/eliminar productos o actividades nuevas tras iniciar producción ni alterar materiales una vez iniciada Impresión o consumidos. Verificación: `server/tests/work.test.ts` (13/13), `npm --prefix server test` (277), typecheck, build y `git diff --check` aprobados. Sin migración SQL.

El 15/10/2026 se habilitó a ADMINMASTER y ADMIN_GENERAL para eliminar clientes sin órdenes, tanto desde el directorio como desde la ficha. El servidor impide eliminar fichas con historial para conservar cartera, reportes y trazabilidad; Diseño no recibe permiso de eliminación. La edición administrativa ya existía y se conserva. No requiere migración SQL.

El reporte de la OT #0036 se reprodujo y corrigió: la preparación técnica de Diseño intentaba inferir la necesidad de materiales buscando la actividad posterior de Impresión en una respuesta operativa, por lo que podía ocultar el editor. El servidor ahora entrega un indicador explícito `requiresPrintMaterials` y el diseñador asignado puede abrir “Completar información técnica” desde su bandeja o desde el detalle de la OT antes de finalizar Diseño. Verificación completa: frontend 158/158, servidor 277/277, ambos typecheck y builds, además de `git diff --check`. No requiere migración SQL.

El 17/10/2026 se implementó el rol `APOYO_COMERCIAL` (“Apoyo Comercial”). Su única pantalla funcional es Nueva OT: puede consultar el selector de clientes, registrar clientes dentro del formulario, obtener nombres de diseñadores activos, asignarlos, guardar un borrador y crear la orden. El servidor rechaza consulta/edición de OT, fichas e historial de clientes, pagos, acciones productivas y módulos administrativos. La migración pendiente `014_commercial_support_role.sql` amplía el control de roles de `users`; debe ejecutarse en Supabase antes de publicar el código. Verificación local: frontend 162/162, servidor 281/281, ambos typecheck y builds aprobados.

## Funcionalidades terminadas en este tramo

- Reportes resume sus cuadros principales; Total IVA conserva únicamente el IVA original de las FACT seleccionadas y Retenciones totales pendientes por cobrar suma los certificados pendientes de RETEFUENTE, RETE IVA e ICA.
- Los cuadros de cobro despliegan sus OT por número descendente con importe y enlace; se incluyen únicamente las que aportan saldo a ese concepto, incluso FACT pagadas con retenciones pendientes de certificado.
- Categoría/documento/corte coinciden entre cuadros, listas y certificados. El registro de certificados refresca los totales sin alterar el IVA facturado ni el saldo en efectivo.
- Total cartera REM y Total cartera FACT disponibles en Reportes y Cartera para ambos perfiles administrativos, respetando fecha de corte, abonos y filtros.
- Adminmaster puede crear cuentas con el nuevo perfil Apoyo Comercial.
- Apoyo Comercial entra directamente a Nueva OT y no recibe otros módulos ni buscador global de órdenes.
- Puede buscar clientes existentes y crear clientes nuevos dentro del formulario, sin abrir el directorio o sus fichas.
- Puede seleccionar y asignar un diseñador activo, sin consultar métricas de carga del área.
- Puede crear OT y mantener su único borrador, pero no consultar, editar ni operar la orden una vez guardada.
- ADMINMASTER y ADMIN_GENERAL pueden editar clientes y eliminar los que no tengan órdenes registradas.
- Si el cliente tiene al menos una OT, su eliminación se rechaza para preservar toda la información relacionada.
- Diseño puede completar descripción y materiales de Impresión normal desde su bandeja o al abrir el detalle de la OT asignada.
- La obligación de materiales se detecta mediante un indicador explícito del servidor, corrigiendo el bloqueo reportado en la OT #0036.
- Al crear una FACT, el formulario no permite ingresar retenciones; siempre se calculan automáticamente, también ante una solicitud directa al servidor.
- Solo ADMINMASTER y ADMIN_GENERAL pueden acceder a Editar OT; el servidor también rechaza modificaciones realizadas desde Diseño.
- Ambos perfiles administrativos pueden abrir y corregir OT en cualquier estado, incluso durante producción, instaladas y cerradas administrativamente.
- La edición conserva etapas existentes; el recorrido de una OT cerrada no se reabre. Administración puede corregir datos de los productos existentes durante producción, sin agregar/eliminar productos o nuevas actividades tras iniciar el recorrido ni modificar materiales de Impresión iniciada o consumidos.
- Las OT FACT incluyen en la lista administrativa el estado FACTURADO; el chulo permite revelar la referencia escrita y una X indica que falta.
- La referencia (por ejemplo `FE#2394`) se gestiona desde Editar OT FACT. La casilla no aparece durante creación, para REM ni para perfiles ajenos a Administración.
- Para FACT especiales, Administración ajusta las retenciones después de crear la OT desde Editar OT en cualquier estado.
- Al recuperar un borrador de Nueva OT, el tipo vuelve a REM para evitar que un FACT antiguo se seleccione silenciosamente; la pantalla solicita confirmar o escoger el documento correcto.
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
- `src/domain/utils.ts` (autorización compartida para editar OT)
- `src/pages/OrderForm.tsx`
- `src/pages/Orders.tsx`
- `src/pages/Queues.tsx`
- `src/pages/Clients.tsx`
- `src/data/AppContext.tsx`
- `src/data/api.ts`
- `src/data/orderDraft.ts`
- `src/data/api.ts`
- `src/domain/types.ts`
- `src/domain/service.ts`
- `src/data/orderNotifications.ts`
- `src/components/AppShell.tsx`
- `src/pages/ChangePassword.tsx`
- `src/pages/NewOrderEditor.tsx`
- `src/pages/orders.css`
- `server/migrations/013_facturation_reference.sql`
- `server/migrations/014_commercial_support_role.sql`
- `server/src/clients/service.ts`
- `server/src/work/service.ts`
- `src/styles.css`
- `tests/order-notifications.test.ts`
- `tests/domain.test.ts`
- `tests/frontend.spec.ts` (incluye ADMIN_GENERAL editando la OT #003, cerradas/terminadas/instaladas, creación FACT y FACTURADO en ambos editores)
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

- Tramo 21/10: frontend 168/168 y backend 288/288; pruebas financieras dirigidas 11/11. Ambos typecheck y builds aprobados. Se verifican IVA de 2 FACT × $150.000 = $57.000, conciliación de cada detalle con su cuadro, certificados parciales/recibidos, reglas NEW/LEGACY, corte, filtros y 53 OT paginadas por número descendente.
- Tramo 21/10: seis casos E2E financieros locales aprobados (cuatro en el recorrido inicial y dos repetidos tras colisión de archivos de traza entre runners concurrentes). Se verificaron Administración/Adminmaster, ausencia de desplegables en ventas/pagos/IVA, actualización de retenciones sin alterar cobros, filtros, cuadro vacío, carteras juntas y móvil 320 px. Capturas locales revisadas.
- Tramo 21/10: prueba E2E dirigida API real 1/1 con PGlite efímero: aun con la caché de órdenes vacía, los cinco cuadros principales de cobro y sus desgloses concuerdan con respuestas del servidor; se comprueban importes, enlaces, orden y filtros. Sin consultas a producción ni evidencia del despliegue posterior al push.
- Tramo 20/10: `npm test -- --run tests/analytics.test.ts` 17/17 y `npm --prefix server test -- tests/reports_finance.test.ts` 6/6. Confirman REM/FACT, IVA, retenciones, pagos al corte, órdenes históricas, filtros, ceros y permisos de ambos administradores; los otros roles reciben 403.
- Tramo 20/10: E2E de importes y filtro REM/FACT en Reportes/Cartera para ADMINMASTER y ADMIN_GENERAL, y regresión móvil 320 px: 3/3. `npm run typecheck`, `npm --prefix server run typecheck`, ambos builds y `git diff --check` aprobados. Sin consulta ni modificación de datos productivos; despliegue posterior al push no comprobado.
- `npm run typecheck`: aprobado.
- `npm test`: 157/157 en 3 archivos.
- `npm test`: 158/158 en 3 archivos (incluye persistencia de referencia FACT en adaptador local).
- `npm run build`: aprobado.
- `npm --prefix server run typecheck`: aprobado.
- `npm --prefix server test`: 274/274 en 9 archivos.
- `npm --prefix server test`: 275/275 en 9 archivos (incluye persistencia, consulta y limpieza de referencia de facturación).
- La regresión del dominio permite editar como ambos administradores una OT COMPLETED o INSTALLED no cerrada (137/137 pruebas de dominio).
- La regresión vigente de `server/tests/work.test.ts` confirma edición ADMIN_GENERAL de OT terminadas, instaladas, activas y cerradas; conserva estado y actividades, y rechaza alteraciones a materiales de Impresión durante la etapa productiva.
- La prueba Playwright de ADMIN_GENERAL en OT terminadas/instaladas y cierre bloqueado aprobó (1/1) con Chromium 1217 local.
- `npm --prefix server run build`: aprobado.
- La corrección de retenciones del 14/10 pasó pruebas dirigidas de creación FACT y restauración de borrador REM (2/2) con Chromium 1217 local.
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
- ADMINMASTER y ADMIN_GENERAL pueden editar OT en cualquier estado, incluidas las etapas activas y el cierre administrativo. Se conservan las actividades ya ejecutadas y el estado; los cambios de recorrido/productos que puedan borrar trazabilidad continúan restringidos.
- Administración puede enviar Diseño → Impresión normal sin definir todavía materiales. El diseñador asignado los completa desde su edición técnica y el servidor bloquea la finalización de Diseño mientras no exista al menos uno; Impresión sin Diseño y las OT creadas por Diseño mantienen la obligación desde el registro inicial.
- Pruebas dirigidas de órdenes, actividades y Corte Láser: 120/120.
- Pruebas E2E locales de Impresión, Taller y materiales: 3/3.
- Prueba E2E dirigida para Impresión y Taller: 2/2; ambos perfiles visualizan al creador en el detalle.
- `npm run test:e2e`: los 32 casos funcionales aprobaron, incluidos el desplegable abierto en móvil y la restauración de la página 4. Dos recorridos completos cerraron 31/32 por incidencias transitorias del entorno de Playwright (un artefacto de traza y una espera de carga antes del login); ambos casos restantes aprobaron 1/1 al repetirlos aisladamente.
- `npm run test:e2e:api`: 5/5 con API y PGlite reales.
- Las dos pruebas E2E dirigidas confirman retenciones automáticas al crear FACT, ausencia de captura manual durante creación y borrador recuperado como REM; además comprueban que la edición manual se ofrece solo en edición administrativa.
- E2E de FACTURADO: 1/1; edición registra `FE#2394`, la lista muestra y revela la referencia al pulsar el chulo, FACT sin referencia muestra X y REM no muestra el indicador ni el control al editar.
- El E2E de FACTURADO también verifica el editor legado en una FACT existente, incluyendo persistencia de la referencia.
- La migración 013 se aplica automáticamente en PGlite durante las pruebas. No se ha ejecutado en Supabase.
- Las pruebas para edición de OT terminadas/instaladas pasaron: dominio 137/137, servidor `work.test.ts` 11/11 y E2E de ADMIN_GENERAL 1/1; se verifican actividades conservadas y el bloqueo de cierre administrativo.
- Tras el cambio de edición de OT terminadas/instaladas, `npm test` aprobó 157/157, `npm --prefix server test` 274/274, ambos typecheck y ambos builds finalizaron correctamente.
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
| Materiales diferidos de Administración a Diseño del 07/10 | 1 | 1 |
| Edición manual optativa de retenciones FACT del 11/10 | 1 | 1 |
| Corrección de retenciones FACT automáticas y edición exclusiva posterior de Administración del 14/10 | 1 | 1 |
| Edición administrativa de OT instaladas y terminadas del 14/10 | 1 | 1 |
| Gestión administrativa de clientes del 15/10 | 1 | 1 |
| Corrección de preparación técnica para Diseño del 15/10 | 1 | 0 |
| Rol Apoyo Comercial del 17/10 | 1 | 1 |
| Desglose de cartera REM y FACT del 20/10 | 1 | 0 |
| Resumen y nombres de cuadros de Reportes del 21/10 | 1 | 0 |
| Desplegables de OT por concepto de cobro del 21/10 | 1 | 1 |
| **Acumulado** | **53** | **32** |

Para la entrega del 30/09, los dos cambios significativos son el selector desplegable de clientes y la conservación de página/filtros del historial. Convertir los enlaces de clientes en botones se cuenta como un ajuste visual independiente, pero no significativo.

La identificación del creador solicitada el 01/10 se cuenta como un cambio menor de visibilidad operativa, no como un cambio significativo.

El registro obligatorio de entrega solicitado el 02/10 se considera significativo porque cambia la regla de finalización productiva, persiste un dato nuevo y requiere migración de base de datos.

La obligación de registrar materiales desde la creación se considera significativa porque cambia la responsabilidad dentro del flujo productivo y bloquea la creación o edición de la OT si falta la información técnica.

La asignación obligatoria de Diseño se considera significativa porque elimina las tareas libres, bloquea la creación o edición sin responsable y modifica la distribución del trabajo entre diseñadores.

El historial se considera significativo porque incorpora persistencia estructurada de auditoría, una ruta protegida, un módulo administrativo y trazabilidad dentro de cada OT con filtrado por perfil.

El borrado se considera significativo porque elimina de forma transaccional toda la información de una OT, renumera los registros posteriores y reajusta el consecutivo automático sin duplicados.

El retiro del borrado se considera significativo porque revierte por completo ese flujo, elimina su endpoint y devuelve la protección del consecutivo en la base de datos.

La reapertura correctiva se considera significativa porque modifica las reglas de edición y el ciclo productivo de una OT terminada, preservando trabajo histórico y generando únicamente las actividades faltantes.

Los materiales diferidos se consideran significativos porque trasladan la responsabilidad técnica de Administración al diseñador asignado y cambian las validaciones de creación y finalización del flujo Diseño → Impresión.

Las observaciones de Taller se consideran significativas porque añaden persistencia nueva al cierre productivo, modifican el contrato del servidor y requieren migración de base de datos.

La gestión de clientes se considera significativa porque añade eliminación protegida por rol y reglas de integridad; la corrección de la OT #0036 no se considera significativa porque restablece el flujo de materiales diferidos ya entregado.

El rol Apoyo Comercial se considera significativo porque incorpora un perfil persistente nuevo, permisos propios en servidor, navegación exclusiva, creación de clientes/OT y una migración de base de datos.

Los cuadros de cartera REM y FACT se consideran un cambio menor: desglosan un saldo ya existente sin modificar reglas de cobro, permisos ni flujo productivo.

El resumen de cuadros del 21/10 es un cambio menor de presentación y agregación existente. El detalle de OT por concepto sí se considera significativo porque añade una consulta financiera paginada y protegida, filtros compartidos, seguimiento por OT y acceso directo desde cada cuadro. Las correcciones de coherencia y actualización de certificados forman parte de esa entrega y no se cuentan aparte.

## Pendiente para producción

1. Ejecutar manualmente `server/migrations/012_disable_order_deletion.sql` en Supabase antes de publicar este código.
2. Ejecutar manualmente `server/migrations/013_facturation_reference.sql` en Supabase antes de desplegar el backend con el nuevo campo FACTURADO.
3. Confirmar en producción que ninguna OT presenta una acción de eliminación.
4. Comprobar en producción una finalización de Taller con observaciones y otra sin observaciones.
5. Verificar en la instalación productiva la edición manual de retenciones y la referencia FACTURADO; el despliegue no se comprobó desde aquí.
6. Ejecutar manualmente `server/migrations/014_commercial_support_role.sql` en Supabase antes de publicar el código del rol Apoyo Comercial.

## Comando para retomar

```powershell
git status --short --branch
git log -3 --oneline
npm run typecheck
npm test
npm --prefix server run typecheck
npm --prefix server test
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = Join-Path $env:LOCALAPPDATA 'ms-playwright\chromium-1217\chrome-win64\chrome.exe'
npx playwright test tests/finance.spec.ts --output=test-results/finance-report21
npx playwright test --config playwright.api.config.ts --grep 'reportes y desgloses' --output=test-results/api-report21
```
