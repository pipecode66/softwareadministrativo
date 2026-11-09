# Probar Instalaciones sin tocar producción

Esta guía describe únicamente el entorno de desarrollo aislado. El09/11 el usuario autorizó publicar el módulo y el rol gestor en main para realizar pruebas en producción. Esa autorización sustituye la restricción histórica de no publicar; para la activación productiva seguir `docs/INSTALACIONES_PRODUCCION.md`. Los comandos de esta guía siguen usando exclusivamente la base local.

Estado: módulo validado en entorno aislado y publicación en main autorizada para pruebas productivas. Esta guía conserva los comandos para probar en local; la activación en Supabase requiere aplicar las migraciones pendientes015 y016, en ese orden, según la guía de producción.

El09/11 se añade la migración016 y el rol «Administrador de Instaladores». Reinicia `npm run api:installations` para que aplique la migración en la base local existente. Desde Usuarios, con tu Adminmaster, selecciona ese nuevo perfil al crear la cuenta. Su menú sólo muestra Instalaciones y puede gestionarlas sin ver clientes, OT completas, finanzas, producción o usuarios. Comprueba que tampoco abre esas rutas directamente. No se ha creado ninguna cuenta real ni se ha ejecutado015/016 en Supabase.

Verificación del09/11 aprobada:215 pruebas frontend,357 servidor y5 recorridos de navegador con API real/PGlite; incluyen creación del perfil desde Usuarios y bloqueo de otros módulos, junto con regresiones de Instalaciones y los últimos cambios de producción integrados. Capturas1440/390px revisadas. El GPS físico sigue pendiente de la prueba manual anterior; este nuevo rol sólo supervisa y no captura asistencia en nombre de otras personas.

Verificado el02/11:204 pruebas frontend,340 servidor,12 recorridos API distintos y4 locales. Incluye asignaciones, equipos, privacidad, GPS emulado, fotos, cierre móvil, correcciones y reapertura de producción; escritorio/móvil entre320 y1440px. Falta confirmar el comportamiento en el celular real y la aceptación del flujo. No hay servidores de prueba persistentes abiertos al terminar esta revisión.

## Abrir el entorno separado

Desde la raíz del proyecto, abre dos terminales:

```powershell
# Terminal 1: servidor y base exclusiva local
npm run api:installations
```

```powershell
# Terminal 2: interfaz conectada a ese servidor local
npm run dev:installations
```

Entra a http://127.0.0.1:5175. La API escucha únicamente en127.0.0.1:3002 y usa PGlite en `server/.data/installations-local`. Este comando no lee `server/.env`, no utiliza `DATABASE_URL`, no abre PostgreSQL remoto y no importa datos de la empresa. La configuración de esta interfaz fuerza API real local; no utiliza el adaptador de revisión del navegador.

La primera ejecución crea una cuenta Adminmaster local: `admin.instalaciones@example.test`. La terminal del servidor muestra su contraseña inicial aleatoria una sola vez; guárdala y cámbiala desde la cuenta. En siguientes ejecuciones se conservan usuarios, clientes, OT, equipos y evidencias locales: no se restablecen contraseñas ni datos automáticamente. No reutilices contraseñas reales para estas pruebas.

Si el puerto está ocupado o aparece un archivo de bloqueo, revisa primero si ya hay otra instancia abierta. No borres la base ni el bloqueo sin verificar el proceso. Para detenerlo normalmente usa Ctrl+C en cada terminal.

## Recorrido sugerido

1. Desde Usuarios, crea al menos dos cuentas con perfil Instalador. Cada una cambia su contraseña temporal al ingresar por primera vez. Usa sesiones separadas o perfiles distintos del navegador para probar usuarios simultáneos.
2. Registra un cliente y una OT de prueba con instalación requerida. Completa las áreas productivas que tenga esa OT. Mientras quede una actividad sin finalizar, no debe aparecer disponible para programar instalación.
3. En Instalaciones, crea la programación: OT, dirección, contacto, indicaciones y horario de Colombia. Prueba dejarla sin asignar y luego asignarla; también prueba asignación individual, varias personas con responsable principal y un equipo guardado.
4. En Equipos de instalación, registra un nombre, sus integrantes y el responsable. Modificar o desactivar ese equipo después no debe cambiar automáticamente los trabajos ya asignados.
5. Ingresa como instalador: solo debe aparecer lo asignado a esa persona, sin cartera, reportes financieros, valores comerciales ni directorio de clientes. Cada integrante registra su propia llegada, descanso/almuerzo, regreso y salida. El avance de un compañero no debe cambiar las pestañas personales de los demás.
6. Para aplazar o reemplazar integrantes durante la ejecución, Administración aplaza con motivo. Después puede reasignar y reprogramar; el historial conserva responsables, acciones y tiempos anteriores. Una persona retirada pierde acceso al trabajo, sin transferir sus tiempos a otra.
7. El responsable principal guarda una fotografía del resultado, verifica el montaje y señala prueba eléctrica realizada o no aplicable, describe el resultado y finaliza. Quienes llegaron deben registrar su salida antes del cierre; los asignados que nunca llegaron requieren una justificación del responsable y no reciben rendimiento por trabajo no realizado.
8. Al finalizar, la OT debe quedar Instalada sin modificar sus pagos, valores, saldos o consecutivo. Administración consulta historial y evidencia. Si agrega nuevas actividades productivas a una OT ya disponible para instalar o instalada (incluso cerrada), la producción se reabre, la instalación se aplaza y los relojes se detienen; exige reprogramar y guardar evidencia nueva al terminar producción. Retirar la opción de instalación requerida también aplaza la existente sin eliminar su historial; volver a marcarla recupera ese mismo registro.
9. Desde el detalle, Administración puede corregir dirección, contacto, teléfono e indicaciones con motivo registrado. El instalador ve los productos, cantidades y medidas de materiales de la OT sin valores comerciales. El responsable principal puede registrar su salida antes de cerrar el trabajo, igual que los demás integrantes.
10. Prueba dos sesiones haciendo cambios a la misma instalación: el segundo guardado desactualizado debe pedir recargar. Desconecta el navegador: no debe informar éxito ni enviar cambios automáticamente al reconectar; los formularios pendientes permanecen abiertos para reintentar. Salir de Instalaciones desde el menú y volver debe conservar la programación o el equipo que estabas diligenciando.

## Ubicación y fotos

La ubicación se pide únicamente al registrar llegada, salida o cierre, nunca de forma continua. El navegador debe tener permiso y entregar una captura reciente con su precisión. La hora oficial de registro es la del servidor; las vistas utilizan Bogotá. Una ubicación de navegador no es una prueba de presencia imposible de manipular.

El usuario confirmó que Administración puede autorizar una excepción si el permiso fue denegado, el GPS no funciona o no hay señal suficiente. Es obligatorio escribir el motivo y queda visible en el historial. El instalador no puede otorgarse esa excepción y el sistema no inventa coordenadas.

En el computador, localhost permite probar el permiso y el flujo. Las pruebas automatizadas simulan coordenadas explícitamente y no demuestran funcionamiento del GPS físico. La comprobación en un celular real requiere un acceso HTTPS seguro; abrir la IP local del computador por HTTP no basta para validar geolocalización. Ese acceso físico debe prepararse y aprobarse aparte; este entorno se limita intencionalmente al computador local. Referencia: [documentación de geolocalización de MDN](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition).

Las fotos se optimizan a JPEG de hasta160KiB antes de enviarse y se guardan privadamente en la base, no en disco efímero ni en enlaces públicos. Solo Administración y los integrantes actuales autorizados pueden consultarlas. Cada nueva fotografía conserva la anterior como evidencia histórica; el cierre exige la vigente. Son datos que ocupan espacio de base y deben incluirse en la planificación de respaldo, capacidad y conservación antes de producción. No se han definido borrados automáticos.

Dentro del historial del trabajo, cada registro con fotografía permite abrirla con «Ver fotografía de este registro». Una reapertura conserva resultado, verificaciones y foto de la visita anterior; las acciones sin coordenadas se identifican expresamente como realizadas con excepción autorizada, sin aparentar una captura GPS.

## Comprobaciones automáticas

```powershell
npm run typecheck
npm --prefix server run typecheck
npm test
npm --prefix server test
npm run build
npm --prefix server run build
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = Join-Path $env:LOCALAPPDATA 'ms-playwright\chromium-1217\chrome-win64\chrome.exe'
npx playwright test --config playwright.api.config.ts tests/installations-api.spec.ts --output=test-results/instalaciones-api
```

Playwright usa puertos3001/5174 y una base PGlite efímera distinta a la de pruebas manuales. No reutiliza procesos existentes ni conexiones productivas. No ejecutes dos runners API simultáneamente. Las pruebas necesitan el Chromium indicado o uno instalado para Playwright.

Los SQL históricos de reinicio total son anteriores a Instalaciones. El de entrega del03/10 rechaza intencionalmente las nuevas dependencias y no las borra: no se ha ampliado esa autorización destructiva. No usarlo para este módulo ni añadir CASCADE. Este desarrollo no limpia, renumera ni reinicia datos productivos.
