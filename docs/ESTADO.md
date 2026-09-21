# Estado de continuidad

Actualizado: 2026-09-21.

## Resultado del tramo

La implementación solicitada el 20/09 quedó integrada localmente en la rama feature/solicitudes-septiembre-2026, iniciada en ccb3e94. Incluye frontend, endpoints, permisos, migraciones y pruebas; no se ha mezclado ni publicado en main desde esta sesión.

- Clientes: nombre y celular obligatorios; identificación opcional salvo FACT; modalidad Especial; alta e historial para Diseño con privacidad financiera.
- Pagos: abono inicial con Efectivo/Bancolombia/Davivienda, abonos posteriores y multiabono transaccional por OT seleccionadas, de menor a mayor saldo.
- Finanzas: nuevas FACT con IVA 19 % y retenciones automáticas descontadas cuando la base supera $524.000; edición administrativa; certificados independientes.
- Reportes: venta FACT sin IVA, tarjeta IVA, retenciones pendientes, cartera con y sin IVA y consumo por cuatro materiales.
- Producción: OT principal con varios productos, materiales y actividades internas sin duplicar ventas; Diseño, Impresión, Taller y Externo; instalación opcional.
- Diseño: asignación o toma de tareas y vista de carga por diseñador; Diseño precede a Impresión.
- Interfaz: Externo elimina medidas/materiales internos, navegación por rol corregida, textos de demostración retirados y responsive comprobado entre 320 y 1440 px.
- API: los perfiles de producción no reciben valores comerciales; edición, pagos, certificados y multiabono permanecen restringidos a Administración.

Archivos principales:

- server/migrations/004_finance.sql a 007_product_dimensions.sql
- server/src/orders/, server/src/reports/, server/src/clients/ y server/src/work/
- src/pages/NewOrderEditor.tsx, Clients.tsx, Portfolio.tsx, Reports.tsx, Queues.tsx y OrderDetail.tsx
- tests/finance.spec.ts, tests/api-e2e.spec.ts y pruebas del servidor

## Verificación final

- npm run typecheck: aprobado.
- npm test: 146/146.
- npm run build: aprobado.
- npm --prefix server run typecheck: aprobado.
- npm --prefix server test: 252/252 en 7 archivos.
- npm run test:e2e: 29/29, incluidos 320, 390, 768, 1024 y 1440 px.
- npm run test:e2e:api: 2/2; inicia sesión real, consulta reportes y crea cliente más OT FACT compuesta con abono.
- git diff --check: sin errores de espacios.

Las pruebas usan bases PGlite aisladas o el adaptador local; no escriben en PostgreSQL productivo.

## Limpieza anterior al 21/09/2026

Se implementó la utilidad segura en:

- server/src/maintenance/cleanup-test-data.ts
- server/src/cli/cleanup-test-data.ts
- server/tests/cleanup-test-data.test.ts
- docs/LIMPIEZA_DATOS_2026-09-21.md

La herramienta hace vista previa obligatoria, usa un token ligado al destino y a la instantánea, bloquea cambios concurrentes y elimina en una transacción OT, pagos, eventos, productos, materiales, actividades, lotes y clientes anteriores al corte. Conserva usuarios y sesiones. Si no queda ninguna OT, el siguiente consecutivo es 1; si quedan OT del día, continúa desde el máximo conservado + 1 sin renumerarlas.

No se ejecutó contra la base desplegada: en el equipo no hay DATABASE_URL ni sesión Vercel autenticada. La vista previa contra la PGlite local terminó de forma segura antes de escribir porque esa base antigua aún no tiene las migraciones 004–007. No se eliminó ningún dato local ni remoto.

## Paso productivo pendiente

Antes de considerar el cambio publicado:

1. Obtener un respaldo verificable de PostgreSQL/Supabase y detener escrituras.
2. Cargar de forma segura las variables reales, sin pegarlas en el chat ni en Git.
3. Ejecutar npm --prefix server run db:migrate.
4. Ejecutar la vista previa:

   npm run api:cleanup-tests -- --cutoff=2026-09-21

5. Verificar destino, cantidades y próximo número; ejecutar con el token mostrado.
6. Publicar la aplicación, comprobar login/OT/reportes y conservar el respaldo.

No publicar esta rama antes de aplicar las migraciones: el código nuevo depende de las tablas y columnas 004–007.

## Comando para retomar

git status --short --branch; npm run typecheck; npm test; npm --prefix server run typecheck; npm --prefix server test

Después, autenticar el entorno productivo o configurar DATABASE_URL de manera local y seguir docs/LIMPIEZA_DATOS_2026-09-21.md. No ejecutar db:bootstrap porque los usuarios existentes deben conservarse.
