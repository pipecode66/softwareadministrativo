# Estado de continuidad

Actualizado: 2026-10-03.

## Estado actual

El tramo de Corte Láser y borradores quedó publicado anteriormente en `main` mediante el commit `97472bf`. El usuario confirmó que `server/migrations/008_laser_drafts.sql` fue ejecutada en Supabase. El commit `d31d776` contiene la búsqueda por descripción y los controles de sesión.

El tramo del selector desplegable de clientes y la restauración del historial quedó implementado, verificado, versionado y enviado a `origin/main` el 30/09/2026.

El 01/10/2026 quedó implementada, verificada, versionada y enviada a `origin/main` la identificación del creador de la OT para Impresión y Taller. La lista operativa del servidor entrega exclusivamente el nombre y el rol del creador, sin abrir acceso al directorio de usuarios, correos ni datos administrativos. El detalle conserva esa identificación después de actualizar o avanzar una orden. No requiere SQL ni migración. El despliegue productivo posterior al `push` no se ha comprobado desde este entorno.

El 03/10/2026 el usuario confirmó que `server/migrations/009_printing_handoff.sql` fue ejecutada en Supabase. El registro obligatorio de quién recibe en Taller al finalizar Impresión quedó implementado, verificado, versionado en `eea5e25` y enviado a `origin/main`. Cubre actividades por producto, Corte Láser y OT heredadas. El despliegue productivo posterior al `push` no se ha comprobado desde este entorno.

## Funcionalidades terminadas en este tramo

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
- `src/pages/Queues.tsx`
- `src/data/AppContext.tsx`
- `src/data/api.ts`
- `src/domain/types.ts`
- `src/domain/service.ts`
- `src/data/orderNotifications.ts`
- `src/components/AppShell.tsx`
- `src/pages/ChangePassword.tsx`
- `src/pages/NewOrderEditor.tsx`
- `src/pages/orders.css`
- `src/styles.css`
- `tests/order-notifications.test.ts`
- `tests/frontend.spec.ts`
- `tests/api-e2e.spec.ts`
- `server/src/orders/domain.ts`
- `server/src/orders/service.ts`
- `server/src/work/router.ts`
- `server/src/work/schemas.ts`
- `server/src/work/service.ts`
- `server/migrations/009_printing_handoff.sql`
- `server/tests/orders.test.ts`
- `server/tests/work.test.ts`
- `server/tests/laser_drafts.test.ts`

## Verificación local

- `npm run typecheck`: aprobado.
- `npm test`: 149/149 en 3 archivos.
- `npm run build`: aprobado.
- `npm --prefix server run typecheck`: aprobado.
- `npm --prefix server test`: 267/267 en 8 archivos.
- Pruebas dirigidas de órdenes, actividades y Corte Láser: 119/119.
- Pruebas E2E locales de Impresión, Taller y materiales: 3/3.
- Prueba E2E dirigida para Impresión y Taller: 2/2; ambos perfiles visualizan al creador en el detalle.
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
| Identidad del creador para producción del 01/10 | 1 | 0 |
| Entrega de Impresión a Taller del 02/10 | 1 | 1 |
| **Acumulado** | **36** | **18** |

Para la entrega del 30/09, los dos cambios significativos son el selector desplegable de clientes y la conservación de página/filtros del historial. Convertir los enlaces de clientes en botones se cuenta como un ajuste visual independiente, pero no significativo.

La identificación del creador solicitada el 01/10 se cuenta como un cambio menor de visibilidad operativa, no como un cambio significativo.

El registro obligatorio de entrega solicitado el 02/10 se considera significativo porque cambia la regla de finalización productiva, persiste un dato nuevo y requiere migración de base de datos.

## Pendiente para producción

1. Comprobar en producción una finalización de Impresión normal y una de Corte Láser con el receptor registrado.

## Comando para retomar

```powershell
git status --short --branch
git log -3 --oneline
npm run typecheck
npm test
npm --prefix server run typecheck
npm --prefix server test
```
