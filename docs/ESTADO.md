# Estado de continuidad

Actualizado: 2026-09-30.

## Estado actual

El tramo de Corte Láser y borradores quedó publicado anteriormente en `main` mediante el commit `97472bf`. El usuario confirmó que `server/migrations/008_laser_drafts.sql` fue ejecutada en Supabase. El commit `d31d776` contiene la búsqueda por descripción y los controles de sesión.

El tramo del selector desplegable de clientes y la restauración del historial quedó implementado, verificado, versionado y enviado a `origin/main` el 30/09/2026. No requiere cambios de backend, SQL ni migraciones. No se ha comprobado todavía el despliegue productivo posterior al `push`.

## Funcionalidades terminadas en este tramo

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
- `src/data/AppContext.tsx`
- `src/data/orderNotifications.ts`
- `src/components/AppShell.tsx`
- `src/pages/ChangePassword.tsx`
- `src/pages/NewOrderEditor.tsx`
- `src/pages/orders.css`
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
- `npm run test:e2e`: los 32 casos funcionales aprobaron, incluidos el desplegable abierto en móvil y la restauración de la página 4. Dos recorridos completos cerraron 31/32 por incidencias transitorias del entorno de Playwright (un artefacto de traza y una espera de carga antes del login); ambos casos restantes aprobaron 1/1 al repetirlos aisladamente.
- `npm run test:e2e:api`: 5/5 con API y PGlite reales.
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
| **Acumulado** | **34** | **17** |

Para la entrega del 30/09, los dos cambios significativos son el selector desplegable de clientes y la conservación de página/filtros del historial. Convertir los enlaces de clientes en botones se cuenta como un ajuste visual independiente, pero no significativo.

## Pendiente para producción

1. Esperar el despliegue asociado y comprobar en producción la búsqueda por descripción, el inicio de sesión sin avisos históricos, los botones de cuenta, el selector desplegable de clientes y la restauración del historial.
2. No hay SQL ni migración nueva que ejecutar para este tramo.

## Comando para retomar

```powershell
git status --short --branch
git log -3 --oneline
npm run typecheck
npm test
npm --prefix server run typecheck
npm --prefix server test
```
