# Estado de continuidad

Actualizado: 2026-09-15. **Frontend y backend preparados para desplegarse juntos en Vercel con Supabase; regla de retenciones unificada.**

## Punto de control 2026-09-15

- `AppContext` carga usuarios, clientes y OT desde la API cuando `VITE_USE_API` está activo; creación, edición, pagos y transiciones de OT usan los endpoints del servidor con idempotencia y control de versión.
- El servidor publica `/api/v1/reports/sales`, `/api/v1/reports/portfolio` y `/api/v1/reports/materials`, restringidos a Administración y protegidos por sesión real.
- Comprobado: `npm run typecheck`, `npm --prefix server run typecheck` y `npm --prefix server test` (222 pruebas aprobadas).
- Regla confirmada por el usuario: las retenciones son valores agregados al total cobrable. FACT calcula base + IVA 19 % + retenciones; REM no incorpora retenciones.
- Las pruebas locales tenían expectativas históricas de descuento y se actualizaron para coincidir con el backend.
- `Reports`, `Dashboard`, `Portfolio` y `Materials` consultan reportes server-side en sesiones API; el modo local conserva los datos ficticios para revisión.
- `npm run test:e2e:api` levanta migraciones, Adminmaster ficticio, API PGlite aislada y Vite con `VITE_USE_API=true`; login real y `/api/v1/reports/sales` respondieron correctamente (1 prueba aprobada).
- `api/[...path].ts` adapta Express al runtime serverless de Vercel, reutilizando el pool PostgreSQL entre invocaciones; `vercel.json` mantiene el fallback SPA sin interceptar `/api/*`.
- Las dependencias runtime del backend están también en el `package.json` raíz porque Vercel instala y empaqueta el proyecto desde esa carpeta.
- PostgreSQL local está instalado, el servicio `postgresql-x64-17` está activo y el puerto 5432 responde. No existe `DATABASE_URL` en el workspace y no se proporcionaron credenciales, por lo que todavía no se verificó una conexión autenticada ni se ejecutaron migraciones sobre esa base.

### Comando para continuar

Configurar en Vercel `DATABASE_MODE=postgres`, `DATABASE_URL` de Supabase y `APP_ORIGINS`; ejecutar las migraciones de Supabase antes del primer despliegue y ampliar la E2E API con creación de cliente y OT.

## Punto de control actual — backend

- Existe `server/`: Express/TypeScript, migración de usuarios/sesiones, Argon2, cookies HttpOnly, CSRF, permisos de cuentas y pruebas de acceso. Todavía se están verificando en esta continuación.
- Se encontraron `server/src/app.ts`, `main.ts`, adaptador `src/data/api.ts`, scripts `api:*` y proxy Vite. Sin historial Git no se puede atribuir con certeza cada línea a Cursor o a la sesión previa.
- Defecto detectado: autenticación/usuarios por API mezclados con OT/clientes/pagos en localStorage. Login no aguardaba la promesa y mostraba accesos ficticios también en modo servidor. Corrección en curso; no usar este estado intermedio para operación real.
- **Confirmación del usuario recibida en esta continuación: OT automática desde 1.** Servidor asignará el número, no el navegador. Sustituye la captura manual provisional.
- Regla confirmada: las retenciones manuales se agregan al total cobrable de FACT.
- Trabajo en paralelo: auditoría acceso/arranque, módulo Clientes, separación del frontend de revisión y sesión real. Root continúa órdenes y documentación.
- No se ha desplegado ni comprobado PostgreSQL externo. Pruebas aisladas con PGlite en memoria, nunca contra datos del cliente.

### Retomar si se interrumpe esta continuación

Leer AGENTS y los tres documentos de contexto; inspeccionar archivos reales antes de repetir tareas. `npm --prefix server run typecheck`, `npm run api:test`, `npm run typecheck`, `npm test`. No ejecutar bootstrap con claves ficticias ni reinicializar bases existentes. Revisar nuevos módulos y actualizar este checkpoint al finalizar las comprobaciones.

## Ya realizado
- Workspace inicialmente vacío, sin AGENTS.md heredado.
- Inventario de 18 HTML/PNG y lectura de las 20 páginas del PDF.
- Detectados shell fijo sin responsive, enlaces `#`, cifras inconsistentes, IVA incorrecto en formulario _1 y acciones excluidas.
- Contexto y decisiones documentados; proyecto React/TypeScript/Vite iniciado.

## Integrado
- Componentes compartidos, shell, navegación por perfil, login local y usuarios.
- Adaptador AppContext/repository con persistencia local y modelos/cálculos compartidos.
- Clientes, operación, bandejas, dashboard, cartera, reportes y materiales.
- Órdenes: listado, formulario, edición previa a producción, detalle, pagos y ficha impresa Carta.
- Estilos globales y responsive, navegación móvil, tablas convertidas en tarjetas.
- README y guía de revisión con accesos locales, comandos, módulos y límites.

## Resultado final de comprobaciones
- `npm test`: **141 pruebas aprobadas** en dos archivos (dominio y analítica).
- `npm run test:e2e`: **23 pruebas aprobadas** en Chromium, última ejecución 55,9 s. Incluye pagos, precisión decimal, rutas productivas, instalación/cierre, roles, búsquedas, filtros, usuarios y menú por teclado.
- `npm run build` y `npm run typecheck`: correctos con todos los cambios finales.
- Prueba de apertura de la compilación con `npm run preview`: login, Inicio, Reportes, Materiales, creación de OT y ficha impresa, sin errores JavaScript capturados.
- Responsive: 14 rutas en 320, 390, 768, 1024 y 1440 px, sin desbordamientos ni errores JavaScript en ese recorrido.
- Capturas reales de pantallas de escritorio/móvil inspeccionadas. Revisión adicional encontró y corrigió desbordamiento de nombres largos en detalle y Cartera; regresión con nombre sin espacios de 115 caracteres aprobada en siete rutas.
- Menú y modal de pago a 320 px: dentro del ancho; foco atrapado en modal y restaurado con Escape.
- PDF Carta de ejemplo: una página de 612 × 792 puntos; con descripción extensa y 40 pagos se generan tres páginas y se conserva el contenido.
- Corregida carrera de redirección al entrar a una ruta protegida desde login.
- Correcciones de fechas inexistentes, redondeos y período inicial de mes calendario completo comprobadas. Se añadieron pruebas de febrero normal/bisiesto, diciembre y cambio de día en Bogotá.
- Máximo de 15 usuarios activos, rechazo de usuario inactivo y protección de la cuenta propia comprobados en navegador.
- Se corrigió una expectativa errónea del test de longitud de nombre (115 caracteres, no 110); la suite completa se volvió a ejecutar satisfactoriamente.

## Archivos de referencia para continuar
- `README.md`: instalación, acceso, alcance, estructura y comandos de pruebas.
- `docs/GUIA_REVISION.md`: recorrido de las pantallas, pagos y reportes.
- `docs/AUDITORIA.md`: problemas de las referencias, correcciones y límites de la evidencia.
- `tests/domain.test.ts`, `tests/analytics.test.ts`, `tests/frontend.spec.ts`: pruebas reproducibles.
- `vitest.config.ts` separa pruebas unitarias de e2e; `playwright.config.ts` configura el navegador aislado.

## Pendientes históricos al cerrar frontend (sustituidos por checkpoint superior)
1. Revisar estas pantallas con el usuario y recoger ajustes de presentación o del flujo real.
2. Continuar la integración server-side de reportes y ampliar pruebas del frontend con sesión real.
3. Acordar e implementar el backend por módulos, comenzando por Administración: autenticación, autorización server-side, API, persistencia central y respaldos. Mantener componentes y reglas comprobadas, sustituyendo el adaptador local.
4. Al conectar servidor, probar errores de red, concurrencia, actualización entre equipos y permisos reales. Ampliar pruebas a navegadores/dispositivos acordados; esta revisión fue en Chromium.

El frontend de revisión quedó integrado; esto no equivale a backend completo ni a aplicativo listo para producción. El desarrollo de servidor empezó después de ese cierre.

## Entorno de pruebas
- Servidor local: http://127.0.0.1:5173/ (`npm run dev`). No desplegado externamente.
- Playwright MCP no arrancó Chrome; la descarga de Chromium actual agotó tiempo. Se usó Chromium instalado con `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, comando completo en README.
- Herramientas/capturas de inspección en `.local/` son artefactos ignorados, no datos de clientes. Las pruebas usan navegadores aislados.
- Las fuentes originales en Downloads no se modificaron.

## Retomar
Leer AGENTS.md, CONTEXTO.md, DECISIONES.md y este documento. Inspeccionar archivos existentes. Ejecutar `npm install` si falta node_modules, `npm run typecheck`, `npm test`, `npm run dev`. No reiniciar desde cero ni modificar fuentes de Downloads.
