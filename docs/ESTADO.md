# Estado de continuidad

Actualizado: 2026-09-27.

## Estado actual

El tramo de Corte Láser y borradores quedó publicado anteriormente en `main` mediante el commit `97472bf`. El usuario confirmó que `server/migrations/008_laser_drafts.sql` fue ejecutada en Supabase.

El tramo actual quedó implementado y verificado localmente sobre `main`. No requiere migraciones de base de datos. Al cerrar debe quedar en un commit local; el usuario todavía no ha autorizado el `push` de este nuevo commit ni se ha comprobado un despliegue productivo.

## Funcionalidades terminadas en este tramo

- El historial de órdenes busca por número de OT, cliente y descripción del trabajo.
- La búsqueda por descripción no distingue mayúsculas ni tildes; una consulta como `TALONARIOS` devuelve todas las OT visibles que contengan ese texto.
- La primera carga después de iniciar o restaurar una sesión se utiliza como línea base silenciosa: las OT históricas ya existentes no generan avisos repetidos.
- Los avisos de llegada continúan funcionando después de la línea base cuando una OT nueva o un cambio real de etapa llega a Administración, Impresión o Taller.
- El enlace textual de cambio de contraseña fue reemplazado por un botón naranja con icono de llave y borde oscuro.
- El botón de cerrar sesión quedó junto al de contraseña, con el mismo tratamiento visual.
- La pantalla de cambio permite mostrar u ocultar únicamente la contraseña actual que el usuario está escribiendo. La contraseña almacenada nunca se recupera ni se muestra porque el servidor conserva solo su hash Argon2id.
- Se conservó el flujo seguro existente: contraseña actual obligatoria, nueva contraseña de 12 a 128 caracteres, confirmación, rotación de sesión y revocación de las sesiones anteriores.

## Archivos principales

- `src/pages/Orders.tsx`
- `src/data/AppContext.tsx`
- `src/data/orderNotifications.ts`
- `src/components/AppShell.tsx`
- `src/pages/ChangePassword.tsx`
- `src/styles.css`
- `tests/order-notifications.test.ts`
- `tests/frontend.spec.ts`
- `tests/api-e2e.spec.ts`
- `server/tests/orders.test.ts`

## Verificación local

- `npm run typecheck`: aprobado.
- `npm test`: 149/149 en 3 archivos.
- `npm run build`: aprobado.
- `npm --prefix server run typecheck`: aprobado.
- `npm --prefix server test`: 267/267 en 8 archivos.
- `npm run test:e2e`: 31/31, incluidos 320, 390, 768, 1024 y 1440 px.
- `npm run test:e2e:api`: 5/5 con API y PGlite reales.
- La prueba del servidor confirma varias coincidencias por descripción con `TALONARIOS`.
- La prueba de sesión confirma que la carga inicial es silenciosa y que los avisos posteriores continúan activos.
- `git diff --check`: sin errores al cierre.

Las pruebas usan PGlite aislado o el adaptador local; no escriben en PostgreSQL productivo.

## Pendiente para producción

1. Subir el nuevo commit únicamente cuando el usuario autorice el `push`.
2. Esperar el despliegue asociado y comprobar en producción la búsqueda por descripción, el inicio de sesión sin avisos históricos y los botones de cuenta.
3. No hay SQL ni migración nueva que ejecutar para este tramo.

## Comando para retomar

```powershell
git status --short --branch
git log -3 --oneline
npm run typecheck
npm test
npm --prefix server run typecheck
npm --prefix server test
```
