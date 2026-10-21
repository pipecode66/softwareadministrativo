# Contexto del proyecto

## Objetivo

Intermedios Gestión centraliza clientes, ventas, cartera y producción publicitaria para una sola sede y hasta 15 usuarios. Los roles son ADMINMASTER, ADMIN_GENERAL, DISENO, IMPRESION y TALLER. Las fuentes de Downloads y el PDF son referencias de solo lectura; las instrucciones directas del usuario prevalecen.

## Flujo vigente

Apoyo Comercial es un rol independiente cuya única pantalla funcional es Nueva OT. Puede buscar clientes, crear uno nuevo dentro del formulario, asignar diseñadores y guardar borradores/OT. No consulta órdenes creadas, fichas o historial de clientes, bandejas, cartera, reportes, materiales, usuarios ni producción.

Administración y Diseño crean OT. El servidor asigna el consecutivo automáticamente. La creación actual usa una OT comercial principal y uno o más productos; cada producto genera actividades internas en Diseño, Impresión, Taller o Externo, sin crear ventas adicionales.

Una actividad de Diseño debe completarse antes de la actividad de Impresión del mismo producto. Si Administración incluye Diseño, debe seleccionar obligatoriamente un diseñador específico; no existen tareas libres para tomar. Si Diseño crea la OT, el servidor inserta Diseño como primera actividad de cada producto y la asigna al creador. En una OT creada por Administración con Diseño antes de Impresión normal, los materiales pueden quedar pendientes para que los complete el diseñador asignado; Diseño no puede finalizar hasta registrar por lo menos uno. Impresión normal sin Diseño continúa exigiendo material desde la creación, y una OT creada directamente por Diseño también debe incluirlo. Si Diseño ya está en proceso, Administración todavía puede corregir únicamente los materiales sin reiniciar la actividad; los demás cambios estructurales permanecen bloqueados. Administración puede operar cualquier área. La instalación es opcional.

Externo representa trabajo de terceros y puede convivir en el mismo producto con Diseño, Impresión y Taller. Cuando es la única actividad no solicita parámetros de impresión; si también existe Impresión, se aplican los datos propios de esa actividad.

Impresión puede ser normal o Corte Láser. La normal utiliza uno o varios materiales con medidas. Corte Láser no usa materiales y cobra $1.000 COP por cada minuto entero registrado antes de finalizar. El perfil de Impresión debe registrar el nombre de quien recibe el trabajo en Taller antes de poder finalizar; el dato queda ligado a esa actividad. Las OT heredadas conservan el mismo registro en su etapa general de Impresión.

ADMINMASTER y ADMIN_GENERAL pueden editar una OT en cualquier estado del flujo, incluso durante Diseño, Impresión, Taller, Externo, instalación y después del cierre administrativo. El guardado conserva el estado actual y las actividades ejecutadas. Administración registra pagos, certificados y multiabonos por sus controles propios. Diseño crea clientes y consulta su historial operativo, pero no recibe totales de órdenes, pagos, saldos, retenciones ni certificados. Impresión y Taller tampoco reciben importes comerciales. Al revisar una OT, Impresión y Taller pueden ver el nombre y rol de quien la registró, sin acceso al directorio de usuarios ni a sus correos.

La edición de una OT no reinicia etapas ni permite retirar áreas ya iniciadas, cambiar el diseñador o el tipo de impresión de una actividad existente, modificar materiales de productos que ya llegaron a Impresión, ni agregar o eliminar productos. En una OT `COMPLETED` o `INSTALLED` que no esté cerrada se pueden agregar áreas faltantes a productos existentes; al hacerlo vuelve a `IN_PRODUCTION` y esas áreas quedan pendientes. Después del cierre se mantienen bloqueados esos cambios de recorrido, pero sí se pueden corregir los demás datos de la OT.

Antes de finalizar una actividad de Taller, el perfil de Taller puede escribir observaciones opcionales. El texto queda guardado en la actividad y visible posteriormente en la OT; las órdenes del flujo heredado lo guardan directamente en la OT.

## Datos comerciales

- Cliente: nombre y celular obligatorios; identificación opcional para REM y requerida para FACT; indicador Especial para permitir OT sin abono inicial.
- ADMINMASTER y ADMIN_GENERAL pueden editar clientes y eliminar únicamente fichas que todavía no tengan órdenes. Los clientes con historial se conservan para no romper cartera, reportes ni trazabilidad.
- OT: valor base mayor que cero, REM/FACT, categoría SuperGiros, Carro Vallas, Proyecto u Otras, instalación opcional. Solo una FACT compuesta exclusivamente por Corte Láser puede iniciar con base cero y sin abono.
- Pago: fecha, valor y método Efectivo, Bancolombia o Davivienda.
- Multiabono: la administradora selecciona las OT; el servidor aplica el valor a sus saldos de menor a mayor.
- Productos: descripción, cantidad entera y valor unitario. No existen especificaciones ni dimensiones generales del producto.
- Materiales: Panaflex, V. Corte, V. Impresión y Banner, con largo, ancho y m². Impresión normal exige por lo menos uno, salvo que Administración envíe primero el producto a un diseñador asignado; en ese caso el diseñador debe registrarlo antes de finalizar Diseño. Corte Láser no utiliza materiales.
- Apoyo Comercial comparte la excepción de materiales diferidos únicamente cuando asigna Diseño antes de Impresión normal; el diseñador seleccionado debe completarlos antes de finalizar Diseño.
- El diseñador asignado puede abrir la preparación técnica desde su bandeja o desde el detalle de la OT. La actividad de Diseño recibe el indicador de que existe Impresión normal posterior aunque su consulta operativa no dependa de inspeccionar esa actividad.

Para una FACT nueva se calcula IVA 19 % sobre el valor base. Si la base es estrictamente mayor a $524.000, se aplican automáticamente RETE FUENTE 4 %, RETE IVA 2,85 % e ICA 7/1000; bajo el umbral son cero. Los importes no se capturan ni se editan antes de crear la OT ni durante producción. Si una FACT especial requiere retenciones distintas, solo Administración puede corregirlas mediante Editar OT en cualquier estado. El cobrable nuevo es base + IVA − retenciones. Las OT anteriores a esta regla quedan marcadas LEGACY para no reescribir saldos históricos durante la migración.

Al editar una OT de FACT a REM, las tres retenciones y sus certificados se eliminan automáticamente; el total y el saldo vuelven a calcularse únicamente sobre el valor base REM.

Administración puede registrar una referencia de facturación al editar una OT FACT, mediante la opción FACTURADO; el indicador de la lista muestra X cuando no tiene referencia y un chulo que revela el texto al pulsarlo cuando ya fue facturada. El campo no aparece para REM ni para perfiles no administrativos.

Cuando finaliza Corte Láser, sus minutos se suman a la base y el IVA se actualiza. Las retenciones guardadas no se recalculan ni vuelven a evaluar el umbral de $524.000.

Cada usuario de Administración o Diseño puede mantener un solo borrador incompleto de OT. El borrador pertenece exclusivamente al creador, no genera consecutivo y se elimina al crear la OT o mediante su icono en el historial. Al recuperar un borrador, el tipo de documento inicia en REM y se debe volver a seleccionar FACT explícitamente si corresponde.

El historial permite localizar todas las OT visibles por número, cliente o descripción del trabajo, sin distinguir mayúsculas ni tildes.

La selección de cliente en Nueva OT es un buscador desplegable por nombre, identificación o celular. El historial conserva página y filtros en su URL para que Atrás del navegador restaure la vista exacta; entrar nuevamente desde el menú abre una vista limpia.

Los avisos de llegada entre departamentos se activan solo después de completar la primera carga de la sesión. Las OT históricas no generan mensajes al ingresar; las llegadas y cambios de etapa posteriores sí lo hacen.

Cada OT muestra su trazabilidad a todos los perfiles autorizados para consultarla: responsable, rol, fecha, hora, acción y desglose disponible. Los importes, pagos, retenciones y certificados se filtran para Diseño, Impresión y Taller. El módulo global Historial, con acceso a todas las OT y enlaces directos, corresponde únicamente a ADMINMASTER y ADMIN_GENERAL.

## Reportes

Administración consulta ventas por fecha, mes o rango, filtradas por categoría y REM/FACT. En Reportes se conservan Ventas · valor base y Pagos recibidos. TOTAL IVA suma el IVA original (19 % de la base) de las FACT del período, independientemente de abonos, retenciones o pago completo de la OT; representa impuesto generado, no una transferencia comprobada a la DIAN. Se retira el cuadro FACT · ventas sin IVA. Cartera al corte con IVA y sin IVA se muestran juntas; el cálculo de cartera conserva la imputación de abonos primero al componente sin IVA. Los certificados recibidos restan de la métrica pendiente de cada retención, no del efectivo ya cobrado. El consumo de materiales cuenta m² únicamente cuando finaliza Impresión.

En Reportes, los cuadros se llaman Total REM y Total FACT; suman saldos pendientes al corte tras abonos y retenciones. El cuadro IVA pendiente de cobro fue reemplazado por Retenciones totales pendientes por cobrar, que suma RETEFUENTE, RETE IVA e ICA con certificado todavía pendiente, incluso de OT ya pagadas. Cada cuadro de cobro, incluidos los tres desgloses individuales de retenciones, permite desplegar las OT que aportan un importe positivo, ordenadas por número descendente, con cliente, descripción, valor y enlace a la OT. Totales y listas respetan los mismos filtros; registrar un certificado refresca también los cuadros superiores. Las pantallas y los desgloses son exclusivos de ADMINMASTER y ADMIN_GENERAL. Cartera conserva sus cuadros propios.

## Fuera de alcance

No incluye urgencias, inventario, exportación Excel/CSV, contabilidad integral, emisión DIAN, pasarela de pagos, archivos adjuntos, GPS, firma digital, modo sin conexión, varias sedes ni cuentas independientes de instaladores.

## Estado técnico

Frontend React/TypeScript/Vite y backend Express/TypeScript con PostgreSQL productivo o PGlite en desarrollo. Autenticación por cookie HttpOnly, CSRF, Argon2, roles server-side, idempotencia en operaciones sensibles y control de versión de OT. Vercel utiliza el adaptador api/ y PostgreSQL externo.

El usuario confirmó la aplicación de las migraciones 008 y 009 en Supabase y posteriormente ejecutó la limpieza total de entrega, obteniendo todos los contadores comerciales en cero. El cambio de entrega de Impresión a Taller y la corrección FACT → REM quedaron implementados, verificados y enviados a `origin/main`. El despliegue productivo posterior no se comprueba desde este entorno. Al cerrar cada entrega se hace commit y push salvo indicación expresa en contrario o una dependencia de producción que haga inseguro publicarla. Consultar docs/ESTADO.md para el punto exacto y el contador comercial acumulado.
