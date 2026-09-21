# Intermedios Gestión

Aplicación web administrativa y de producción para Intermedios Precision. El frontend está construido con React, TypeScript y Vite; el backend usa Express, PostgreSQL/PGlite y control de acceso por sesión. La interfaz conserva la identidad naranja/slate, Manrope/Inter y se adapta desde 320 px hasta escritorio.

## Funcionalidad

- OT con consecutivo automático asignado por el servidor.
- Clientes con nombre y celular obligatorios, identificación opcional para REM y obligatoria para FACT, y modalidad de pago Especial.
- Abono inicial al crear la OT, métodos Efectivo, Bancolombia y Davivienda, abonos posteriores y multiabono distribuido entre las OT seleccionadas de menor a mayor saldo.
- Órdenes REM/FACT, categorías SuperGiros, Carro Vallas, Proyecto y Otras.
- FACT con IVA del 19 % y retenciones automáticas sobre el valor base cuando supera $524.000: RETE FUENTE 4 %, RETE IVA 2,85 % e ICA 7/1000. Las nuevas OT descuentan estas retenciones del cobrable.
- Reportes separados de venta base FACT, IVA, retenciones pendientes de certificado y cartera al corte con/sin IVA.
- Varios productos por OT, sin duplicar la venta, cada uno con cantidad, valor, especificaciones, medidas, materiales y actividades internas.
- Áreas Diseño, Impresión, Taller y Externo; Diseño precede a Impresión. Las tareas pueden asignarse o ser tomadas por diseñadores y Administración consulta su carga.
- Múltiples materiales de impresión por producto: Panaflex, V. Corte, V. Impresión y Banner. El consumo en m² se registra al terminar la actividad de impresión.
- Instalación opcional y seguimiento digital de responsable, estado y avance.
- Diseño crea clientes y OT, y consulta el historial operativo del cliente sin totales, pagos ni saldos. Solo Administración edita la OT y opera las finanzas.

FACT es una clasificación administrativa: la aplicación no emite factura electrónica ni se integra con DIAN. Tampoco incluye urgencias, inventario, exportaciones, adjuntos, GPS, cuentas de instaladores ni varias sedes.

## Desarrollo local

Requiere Node.js 22.12 o posterior y npm:

~~~powershell
npm install
npm run dev
~~~

El frontend abre en http://127.0.0.1:5173. Para usar la API local:

~~~powershell
npm run api:migrate
npm run api
~~~

VITE_USE_API=true conecta el frontend al servidor; sin esa variable se activa únicamente el adaptador local usado por las pruebas de interfaz. Las fuentes originales de Downloads son referencias de solo lectura.

## Comprobaciones

~~~powershell
npm run typecheck
npm test
npm run build
npm --prefix server run typecheck
npm --prefix server test
npm run test:e2e
npm run test:e2e:api
~~~

La última verificación aprobó 146 pruebas de frontend, 252 de backend, 29 recorridos de navegador y 2 recorridos con frontend y API reales. En este equipo Playwright puede usar Microsoft Edge:

~~~powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:e2e
~~~

## Backend y despliegue

Las migraciones están en server/migrations/. Las migraciones 004–007 agregan finanzas, multiabonos, productos, materiales, actividades y medidas sin reescribir las 001–003. En producción deben aplicarse sobre un respaldo verificable antes de publicar el nuevo frontend/backend:

~~~powershell
$env:NODE_ENV = 'production'
$env:DATABASE_MODE = 'postgres'
$env:DATABASE_URL = 'CONFIGURAR_EN_UN_ENTORNO_SEGURO'
npm --prefix server run db:migrate
~~~

El adaptador api/ publica Express en Vercel bajo /api/v1. Las variables privadas requeridas son NODE_ENV=production, DATABASE_MODE=postgres, DATABASE_URL, APP_ORIGINS, SESSION_HOURS, TRUST_PROXY_HOPS y LOGIN_RATE_LIMIT. Nunca guardar credenciales en el repositorio.

## Limpieza solicitada el 21/09/2026

Existe una utilidad transaccional para eliminar OT, pagos, productos, actividades, lotes de multiabono y clientes creados antes del 21/09/2026, conservando usuarios y reiniciando el consecutivo en 1 solamente si no queda ninguna OT:

~~~powershell
npm run api:cleanup-tests -- --cutoff=2026-09-21
~~~

La primera ejecución es siempre una vista previa. La operación real requiere el token devuelto y una conexión verificada a la base desplegada. El procedimiento completo está en docs/LIMPIEZA_DATOS_2026-09-21.md. No se ejecuta automáticamente al migrar ni al desplegar.

## Continuidad

Antes de continuar, leer AGENTS.md, docs/ESTADO.md, docs/CONTEXTO.md y docs/DECISIONES.md. docs/CAMBIOS_2026-09-20.md contiene la trazabilidad funcional y docs/LIMPIEZA_DATOS_2026-09-21.md el procedimiento de depuración.
