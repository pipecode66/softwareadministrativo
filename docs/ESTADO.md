# Estado de continuidad

Actualizado: 2026-09-22.

## Estado actual

El nuevo tramo solicitado quedó implementado y verificado localmente sobre `main`. Al cerrar esta sesión debe quedar en un commit local único; no se ha autorizado ni realizado `push`, despliegue o ejecución de la migración nueva en Supabase.

La base remota conocida tiene aplicadas manualmente las migraciones 004 a 007. Antes de publicar este tramo se debe ejecutar `server/migrations/008_laser_drafts.sql` en Supabase. La migración habilita RLS en `order_drafts`, por lo que debe elegirse la opción de ejecutar con RLS si el editor vuelve a consultarlo.

## Funcionalidades terminadas en este tramo

- Impresión se divide por actividad en Impresión normal o Corte Láser.
- Corte Láser usa una tarifa fija de $1.000 COP por minuto. Impresión y Administración pueden registrar minutos enteros; no se puede finalizar sin tiempo registrado.
- Al completar Corte Láser se recompone el valor de la OT sin duplicar cargos. En FACT se actualiza el IVA sobre la nueva base y se conservan intactas las retenciones originales.
- Una FACT formada únicamente por Corte Láser puede iniciar en $0 y sin abono; no se permite esa excepción para REM, Taller, Externo ni productos mixtos sin valor.
- Cada creador conserva como máximo un borrador de OT. Solo su propietario puede consultarlo o eliminarlo; aparece primero en Historial de órdenes y no consume consecutivo.
- El selector de clientes incorpora búsqueda por nombre, identificación o celular.
- Se retiraron especificaciones y largo/ancho generales del producto. Las medidas siguen existiendo únicamente en los materiales de Impresión.
- La cantidad de producto acepta enteros desde 1 y se presenta sin decimales falsos como `1,000`.
- Las OT creadas por Diseño reciben automáticamente una actividad de Diseño en primera posición, asignada al mismo creador; el diseñador ya no selecciona su propia área.
- El diseñador asignado puede editar la descripción del trabajo y los materiales/medidas destinados a Impresión antes de completar Diseño.
- Externo puede combinarse dentro del mismo producto con Diseño, Impresión y Taller.
- Administración puede iniciar y finalizar actividades de todas las áreas, respetando orden y requisitos productivos.
- Se corrigió el layout responsive de la carga de diseñadores y de las tarjetas de las bandejas independientes; los datos ya no quedan concatenados.

## Archivos principales

- `server/migrations/008_laser_drafts.sql`
- `server/src/orders/domain.ts`, `router.ts` y `service.ts`
- `server/src/work/schemas.ts`, `router.ts` y `service.ts`
- `server/tests/laser_drafts.test.ts` y `server/tests/work.test.ts`
- `src/pages/NewOrderEditor.tsx`, `Orders.tsx`, `Queues.tsx` y `OrderDetail.tsx`
- `src/data/orderDraft.ts`, `src/data/api.ts` y tipos del dominio
- `src/pages/orders.css` y `src/pages/operations.css`

## Verificación local

- `npm run typecheck`: aprobado.
- `npm test`: 146/146.
- `npm run build`: aprobado.
- `npm --prefix server run typecheck`: aprobado.
- `npm --prefix server test`: 267/267 en 8 archivos.
- `npm run test:e2e`: 31/31, incluidos 320, 390, 768, 1024 y 1440 px.
- `npm run test:e2e:api`: 4/4 con API y PGlite reales; cubre FACT, láser, carga responsive y edición técnica de Diseño.
- Migración histórica 001→008 comprobada sobre PGlite con backfill de actividades de Impresión y restricciones nuevas.
- `git diff --check`: sin errores al cierre.

Las pruebas usan PGlite aislado o el adaptador local; no escriben en PostgreSQL productivo.

## Cambios locales anteriores incluidos en el mismo cierre

- `server/maintenance/borrar_datos_prueba_antes_2026-09-21.sql`: limpieza manual con corte fijo al inicio del 21/09 en Colombia; conserva usuarios y sesiones. No se ha ejecutado remotamente.
- `src/pages/Operation.tsx` y estilos: Carga de Diseño separada en tarjetas legibles.
- Pruebas de la utilidad de limpieza y del layout responsive con API.

## Pendiente para producción

1. Tener respaldo verificable de Supabase y evitar escrituras durante la migración.
2. Ejecutar manualmente `server/migrations/008_laser_drafts.sql`; no usar `db:bootstrap`.
3. Publicar el commit únicamente cuando el usuario lo autorice mediante `push`.
4. Confirmar en producción creación/restauración/eliminación de borrador, Corte Láser y edición técnica de Diseño.
5. El SQL de limpieza es una operación separada y destructiva: solo debe ejecutarse manualmente con respaldo si aún se desea retirar los datos de prueba anteriores al 21/09.

## Comando para retomar

```powershell
git status --short --branch
git log -3 --oneline
npm run typecheck
npm test
npm --prefix server run typecheck
npm --prefix server test
```
