# Intermedios Gestión

Frontend de gestión administrativa y producción, integrado a partir de las dos entregas visuales del cliente. Conserva la identidad naranja/slate y utiliza React, TypeScript, Vite y fuentes locales Manrope/Inter.

## Abrir el aplicativo

Requiere Node.js 22.12+ (comprobado con Node 24) y npm. Desde esta carpeta:

```powershell
npm install
npm run dev
```

Abrir **http://127.0.0.1:5173/**. Si las dependencias ya están instaladas, basta con `npm run dev`. Si ese puerto ya está ocupado por el mismo proyecto, abrir la dirección existente; no es necesario iniciar otro servidor.

En el login, **Ver accesos de revisión** permite seleccionar una cuenta y completar sus datos. Todas las cuentas locales usan la contraseña `Intermedios2026!`.

| Perfil | Correo de revisión |
|---|---|
| Adminmaster | adminmaster@intermedios.local |
| Administración general | administracion@intermedios.local |
| Diseño | diseno@intermedios.local |
| Impresión | impresion@intermedios.local |
| Taller | taller@intermedios.local |

Estos accesos son exclusivamente para revisar el frontend: **no son autenticación real ni credenciales productivas**.

## Pantallas integradas

| Módulo | Funcionalidad de interfaz |
|---|---|
| Inicio | Ventas, recaudo, cartera y operación actual |
| Órdenes | Listado, búsqueda, filtros, creación, edición previa a producción, detalle, pagos y ficha imprimible |
| Clientes | Directorio, creación/edición, ficha y órdenes asociadas |
| Operación | Seguimiento de revisión, impresión, taller e instalación |
| Bandejas | Trabajo visible y acciones según perfil de Diseño, Impresión o Taller |
| Cartera | Saldos al corte, deudas por cliente y registro de abonos |
| Reportes | Categorías comerciales, REM/FACT, día, mes y rangos |
| Materiales | Consumo de los cinco materiales en m² al finalizar impresión |
| Usuarios | Administración local de perfiles por Adminmaster |

Las mismas pantallas se adaptan a móvil. Los estados del trabajo y del pago son independientes: terminar o cerrar una OT no elimina su deuda.

## Datos y límites de esta etapa

- Incluye clientes, usuarios y órdenes ficticios. Los cambios se conservan en `localStorage` del navegador y la sesión local en `sessionStorage`.
- El adaptador actual se sustituirá por una API. No hay base de datos de servidor, respaldo central, autenticación segura ni sincronización entre equipos.
- Las comprobaciones por perfil solo sirven para validar el comportamiento del frontend. El servidor deberá exigir los mismos permisos y no entregar datos financieros a perfiles no autorizados.
- No ingresar información sensible ni usar esta versión para llevar la operación real del negocio.
- FACT es una clasificación interna. No emite facturas electrónicas ni realiza conexión con DIAN.
- No se añadieron urgencias, exportaciones, inventario, notificaciones, adjuntos ni cuentas de instaladores.
- Se conservan intactos los originales de Downloads.

La numeración automática y el tratamiento de retenciones ya fueron confirmados: el servidor asigna la OT desde 1 y las retenciones manuales de FACT se agregan al total cobrable. Las decisiones están en `docs/DECISIONES.md`.

## Comprobaciones

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` ejecuta las pruebas de dominio/analítica. `npm run test:e2e` ejecuta los recorridos del navegador en contextos aislados: no usa ni borra los datos del navegador habitual.

La descarga del navegador de Playwright falló por tiempo de espera en este equipo. Se verificaron las pruebas con Chromium ya instalado y la opción de configuración:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:/Users/juanitou/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe'
npm run test:e2e
```

Esa ruta es específica de este equipo; en otro, instalar Chromium con Playwright o indicar un ejecutable disponible. La variable es opcional y solo afecta las pruebas. `npm run preview` permite revisar la compilación generada en http://127.0.0.1:4173/ después de `npm run build`.

## Continuidad y estructura

Para retomar, leer primero **`docs/ESTADO.md`**, después `docs/CONTEXTO.md` y `docs/DECISIONES.md`. No reinicializar el proyecto.

- `src/pages/`: módulos y pantallas.
- `src/components/`: navegación, formularios, modales, filtros y componentes visuales.
- `src/domain/`: tipos, cálculos y reglas compartidas.
- `src/data/`: datos ficticios, persistencia local y operaciones de la aplicación.
- `src/styles.css` y CSS de módulos: identidad visual y responsive.
- `tests/`: comprobaciones automatizadas.
- `docs/AUDITORIA.md`: hallazgos de los originales y correcciones.
- `docs/GUIA_REVISION.md`: recorrido sugerido para revisar las pantallas.

La siguiente etapa prevista es implementar el backend por módulos, comenzando por Administración, una vez revisado este frontend y confirmadas las reglas pendientes.
