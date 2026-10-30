# Probar Instalaciones sin tocar producción

Estado: desarrollo y validación local. No ejecutar015 en Supabase ni publicar esta rama hasta aprobar las pruebas. La rama de trabajo es `feature/instalaciones-local`; no se hace push.

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
8. Al finalizar, la OT debe quedar Instalada sin modificar sus pagos, valores, saldos o consecutivo. Administración consulta historial y evidencia. Si agrega nuevas actividades productivas a una OT instalada no cerrada, el nuevo ciclo queda bloqueado hasta completar producción nuevamente y exige evidencia nueva, conservando la anterior.
9. Prueba dos sesiones haciendo cambios a la misma instalación: el segundo guardado desactualizado debe pedir recargar. Desconecta el navegador: no debe informar éxito ni enviar cambios automáticamente al reconectar; los formularios pendientes permanecen abiertos para reintentar.

## Ubicación y fotos

La ubicación se pide únicamente al registrar llegada, salida o cierre, nunca de forma continua. El navegador debe tener permiso y entregar una captura reciente con su precisión. La hora oficial de registro es la del servidor; las vistas utilizan Bogotá. Una ubicación de navegador no es una prueba de presencia imposible de manipular.

El usuario confirmó que Administración puede autorizar una excepción si el permiso fue denegado, el GPS no funciona o no hay señal suficiente. Es obligatorio escribir el motivo y queda visible en el historial. El instalador no puede otorgarse esa excepción y el sistema no inventa coordenadas.

En el computador, localhost permite probar el permiso y el flujo. Las pruebas automatizadas simulan coordenadas explícitamente y no demuestran funcionamiento del GPS físico. La comprobación en un celular real requiere un acceso HTTPS seguro; abrir la IP local del computador por HTTP no basta para validar geolocalización. Ese acceso físico debe prepararse y aprobarse aparte; este entorno se limita intencionalmente al computador local. Referencia: [documentación de geolocalización de MDN](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition).

Las fotos se optimizan a JPEG de hasta160KiB antes de enviarse y se guardan privadamente en la base, no en disco efímero ni en enlaces públicos. Solo Administración y los integrantes actuales autorizados pueden consultarlas. Cada nueva fotografía conserva la anterior como evidencia histórica; el cierre exige la vigente. Son datos que ocupan espacio de base y deben incluirse en la planificación de respaldo, capacidad y conservación antes de producción. No se han definido borrados automáticos.

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
