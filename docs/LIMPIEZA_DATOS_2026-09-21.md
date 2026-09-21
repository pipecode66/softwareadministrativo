# Limpieza controlada de datos de prueba — corte 2026-09-21

Esta utilidad atiende la solicitud de eliminar datos comerciales creados **antes del 21 de septiembre de 2026 a las 00:00 en `America/Bogota`**, conservando usuarios, sesiones y datos creados desde el corte. No se ejecuta automáticamente al desplegar ni al migrar.

## Alcance

Se eliminan, dentro de una sola transacción:

- OT anteriores al corte y sus pagos, eventos, productos, materiales y actividades internas;
- lotes de multiabono anteriores al corte que no estén vinculados a datos conservados;
- clientes anteriores al corte que ya no estén referenciados por OT o lotes conservados.

No se eliminan usuarios, sesiones, bloqueos del sistema ni historial de migraciones. Un cliente anterior al corte se conserva si una OT o un multiabono posterior depende de él. Las OT conservadas nunca se renumeran: si no queda ninguna OT, el siguiente consecutivo será 1; si queda alguna, será `máximo conservado + 1`.

## Procedimiento de operación

1. Detener temporalmente escrituras de usuarios y tomar un respaldo verificable de PostgreSQL desde el proveedor.
2. Confirmar que las migraciones de esta versión ya fueron aplicadas.
3. Configurar el mismo entorno seguro que usa la API (`DATABASE_MODE`, `DATABASE_URL` y `NODE_ENV`), sin pegar credenciales en comandos, capturas o tickets.
4. Ejecutar solo la vista previa:

   `npm run api:cleanup-tests -- --cutoff=2026-09-21`

5. Verificar en la salida el destino saneado (`host:puerto/base`, nunca usuario ni contraseña), que esté marcado como `PRODUCCIÓN`, el corte UTC equivalente, las cantidades a eliminar/conservar y el próximo número de OT.
6. Copiar el token emitido por esa vista previa y ejecutar:

   `npm run api:cleanup-tests -- --cutoff=2026-09-21 --execute --confirm=TOKEN_EMITIDO`

El token depende del destino, de todas las cantidades y de una huella opaca de los registros de la vista previa. Si cambia el conjunto de datos entre ambos comandos, la herramienta rechaza la ejecución y revierte la transacción; debe generarse otra vista previa. No existe opción de forzado.

## Validación posterior

- comprobar que las cuentas aún pueden iniciar sesión;
- revisar que las listas de clientes y OT coincidan con las cantidades conservadas;
- crear una OT de control y confirmar su consecutivo esperado;
- conservar el respaldo hasta completar la validación funcional.

La implementación y sus pruebas están en `server/src/maintenance/cleanup-test-data.ts`, `server/src/cli/cleanup-test-data.ts` y `server/tests/cleanup-test-data.test.ts`. Las pruebas usan PGlite en memoria; no abren ni alteran la base desplegada.
