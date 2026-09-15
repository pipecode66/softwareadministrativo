# Auditoría del frontend de referencia

Actualizado: 2026-09-14. Este documento separa los hallazgos de las fuentes originales, la revisión estática inicial y las verificaciones posteriores del frontend integrado. El último resultado de cada suite y los pendientes de continuidad se registran en `docs/ESTADO.md`.

## Fuentes y método

- Lectura estática de 18 archivos `code.html` de `FRONTEND 1RA PARTE` y `FRONTEND PARTE FINAL`, más `intermedios_precision/DESIGN.md`.
- Contraste con el alcance explícito del usuario y las decisiones guardadas en `docs/CONTEXTO.md` y `docs/DECISIONES.md`.
- Los originales en Downloads permanecen intactos. Los HTML y el PDF son referencias, no instrucciones de ejecución.
- Las cifras de ejemplo de las fuentes no representan datos reales ni una referencia fiable para las fórmulas.

## Hallazgos confirmados en las fuentes

| Área | Evidencia en referencia | Corrección requerida |
|---|---|---|
| Contenedor responsive | Las 14 pantallas operativas de la primera entrega fijan sidebar de 260 px, `pl-[260px]` y cabecera `left-[260px]` sin colapso móvil. | Contenedor compartido, navegación móvil y contenido que use el ancho disponible. El detalle móvil aislado no adapta las demás rutas. |
| Navegación | Cada pantalla operativa contiene entre 11 y 18 enlaces `href="#"`. No hay router ni datos compartidos. | Rutas reales, selección activa y navegación coherente entre listados, detalle y formularios. |
| Creación antigua | `crear_orden_de_trabajo_1` extrae IVA de $2.850.000 y obtiene base $2.394.958. Incluye retenciones prellenadas y materiales adicionales. | Tomar `_2` como referencia visual preferente: base $2.850.000 + IVA $541.500 = $3.391.500. No reutilizar los cálculos de `_1`. |
| Numeración | `crear_orden_de_trabajo_2/code.html:12`, `:18` y `:433` vuelven a mostrar AUTO y consecutivo incremental. | Captura manual de OT única desde 1 para esta revisión; confirmar con cliente antes del backend, según decisión documentada. |
| Formulario OT | `_2/code.html:87` no exige valor. Guardar solo cambia el texto mediante temporizador. Selección REM/FACT y rutas son divs sin interacción. | Validar datos, selectores accesibles y guardado real en el adaptador local. Valor y material condicional obligatorios. |
| Abonos | `detalle_de_orden_de_trabajo/code.html:535` usa saldo fijo 850000; `:600` liquida esa cifra, aunque pantalla muestra $1.391.500. Confirmar solo cierra modal. | Derivar saldo de la OT y todos sus pagos; validar monto y fecha; incorporar el pago al mismo registro compartido. |
| Retenciones | El detalle muestra importes de retención con una fórmula ambigua y además impone RETEFUENTE 2,5 %. | Entradas manuales opcionales; por decisión del usuario se agregan al total cobrable y no se asumen tasas tributarias. |
| Emisión electrónica | CUFE inventado en detalle `:374` y textos de validez tributaria en creación. | Mostrar REM/FACT como clasificación interna; no aparentar emisión legal ni integración DIAN. |
| Reportes | El script final de `reportes` cambia siete KPIs por cifras fijas, pero conserva gráficos, subtotales y categorías del mes original. No hay selección real de fechas. | Una agregación por período para todos los indicadores, controles reales de fecha/mes/rangos y separación de ventas, recaudo y cartera. |
| Materiales | El selector temporal solo cambia colores. La tabla administrativa incluye largo/ancho. El título dice “Procesada en Taller” y otro texto “semanas epidemiológicas”. | Cinco materiales exactos, estadísticas administrativas en m², cálculo compartido y textos del negocio. Separar superficie pendiente de consumo completado. |
| Datos incoherentes | OT #0048 es FACT de $3.391.500 en detalle pero REM de $1.450.000 en Cartera. La impresión fecha en 2023 y otros ejemplos en 2024. | Un único conjunto de datos ficticios coherentes para todas las pantallas. |
| Urgencias | `bandeja_de_taller/code.html:75` dice “1 urgente hoy”; imprimible `:152` dice “Prioridad: Alta”; Impresión muestra prioridad estándar. | Retirar todas las reglas, marcadores y textos de prioridad. |
| Funciones excluidas | Campana de notificaciones en cada cabecera; exportación en Clientes/Cartera/Materiales; archivos TIFF/AI/PDF, stock, cuadrillas, historial e inventario en otras vistas. | Retirar controles de exportación, notificaciones, adjuntos, inventario, maquinaria y asignación a instaladores. |
| Acceso | ADMINMASTER fijo incluso en bandejas operativas. Login hace POST a `#`; solo muestra/oculta contraseña. | Navegación y permisos de revisión local por perfil, sin afirmar autenticación productiva. |
| Modal y teclado | No hay `role="dialog"`, Escape ni gestión de foco en los modales. El de abonos del detalle se muestra desde la carga. | Modal compartido accesible, cerrado por defecto, contenido con desplazamiento en pantallas bajas. |
| Etiquetas | Creación `_2`: 10 labels y solo 3 asociados; cartera: 5/0; detalle abono: 3/0. Iconos sin nombre y selectores con divs. | Campos asociados con `htmlFor/id`, botones nativos, nombres accesibles y foco visible. |
| Contraste | Cálculo de luminancia: blanco sobre #F97316 = 2,80:1 y sobre #EA580C = 3,56:1; #C2410C = 5,18:1. | Oscurecer fondos de acciones con texto blanco pequeño o usar texto oscuro, conservando naranja brillante como acento. |
| Recursos | Tailwind por CDN, imágenes remotas y configuraciones duplicadas. Hay `data-alt` en vez de `alt` en imágenes de creación. | CSS y fuentes locales, componentes/tokens compartidos y alternativas de imagen reales. |
| Impresión | Hay formato Carta, pero dos columnas fijas y textos de 8,5–11 px sin control de contenido largo. | Vista imprimible de la misma OT, revisión con textos largos y saltos de página. |

## Decisiones de interpretación

- La versión visual `_2` corrige aspectos tributarios respecto de `_1`, pero ninguna constituye una implementación funcional suficiente.
- Se conservan las cuatro categorías comerciales y cinco materiales enumerados por el usuario.
- Amarillo corresponde a revisión/Diseño, rojo a Impresión, azul a Taller/Instalación y verde a finalización; estados operativos y financieros permanecen separados.
- Los operarios de Impresión y Taller consultan sus trabajos activos. No se muestran pestañas “Terminadas” ni contadores históricos a estos perfiles porque `canViewOrder` no les concede ese acceso. Administración conserva consulta de terminadas en las bandejas; Diseño conserva sus propias órdenes.
- Las medidas se capturan en metros y el área se presenta con tres decimales según `DECISIONES.md`; el consumo se registra al finalizar Impresión, no al ver o guardar la orden.
- Fecha de instalación permitida entre fin de producción y fecha actual. La interfaz y el servicio local deben utilizar la misma restricción.

## Revisión estática inicial — 2026-09-13

Esta sección conserva el registro inicial de Clientes, Operación y Bandejas; no limita el alcance de las pantallas integradas posteriormente.

### Clientes — `src/pages/Clients.tsx`

- Listado y ficha de cliente, búsqueda sin sensibilidad a tildes, filtros por cartera/trabajos activos y paginación.
- Formularios de creación/edición conectados a `saveClient`, con campos etiquetados y mensajes de error del adaptador.
- Detalle de órdenes asociado al cliente, con estados operativos/financieros y saldos derivados mediante `financials`.
- Enlaces internos reales `/clients/:id` y `/orders/:id`; contactos telefónicos.
- Vista de tarjeta declarada para móvil mediante `DataTable.renderCard`.
- Acceso restringido en página a usuarios activos de Administración.

### Operación — `src/pages/Operation.tsx`

- Cuatro columnas con agrupación derivada de estados reales: revisión, impresión, taller e instalación.
- Búsqueda por OT/cliente/trabajo y filtro por recorrido.
- Botones de aprobación y avance según etapa, con confirmación compartida conectada a `transitionOrder`.
- Referencia al detalle de cada OT y a las bandejas respectivas.
- No se muestran urgencias, stock, historial inventado, maquinaria o cuadrillas.

### Bandejas — `src/pages/Queues.tsx`

- Acceso por departamento y visibilidad derivada de `visibleOrders`.
- Diseño: seguimiento de las órdenes propias y creación mediante ruta `/orders/new`.
- Impresión: materiales, largo × ancho y área en m²; finalización de la etapa.
- Taller: inicio/finalización y registro simple de instalación con fecha y observación opcional.
- Búsqueda, filtros, paginación y tarjetas móviles declaradas.
- Sin datos financieros en Impresión/Taller. Las confirmaciones no cambian los pagos.
- Reinicio del estado de filtros al cambiar de departamento para evitar filtros heredados de otra bandeja.

### Estilo — `src/pages/operations.css`

- Estilos específicos bajo prefijo `ops-`, sin modificar los tokens compartidos.
- Tablero de cuatro columnas que se reorganiza a dos y una según el ancho.
- Encabezados y filtros flexibles; textos largos con quiebre; botones con foco visible.
- Naranja oscuro para texto blanco pequeño y azules coherentes para instalación.

Estas comprobaciones confirman contenido y conexiones declaradas en código. No prueban por sí solas el comportamiento en navegador. Se revisaron los contratos de `AppContext`, `components/ui.tsx`, `domain/types.ts`, `domain/utils.ts` y `domain/service.ts` contra las páginas de este tramo.

Comprobaciones ejecutadas el 2026-09-13:

- Transpilación sintáctica con TypeScript de `Clients.tsx`, `Operation.tsx` y `Queues.tsx`: cero errores.
- `npm run typecheck`: finalizó correctamente, código de salida 0, con los módulos compartidos presentes en ese momento.
- En esa fecha todavía no se habían ejecutado las pruebas de navegador de estas páginas. Las verificaciones posteriores se detallan a continuación.

## Verificaciones del frontend integrado — 2026-09-14

### Pantallas y datos compartidos

- Integrados login, shell de navegación, dashboard, órdenes, clientes, operación, las tres bandejas, cartera, reportes, materiales y gestión local de usuarios.
- Listado, formulario, detalle, ficha impresa y cartera consultan las mismas órdenes y pagos. La creación y edición usan el cálculo financiero compartido; no conservan los saldos fijos de los HTML originales.
- La clasificación FACT muestra IVA adicional y retenciones manuales opcionales agregadas al total cobrable, sin CUFE ni afirmaciones de emisión electrónica. La regla está documentada en `docs/DECISIONES.md`.
- Las acciones de interfaz utilizan el adaptador local: creación, edición permitida, abonos múltiples, avance de producción, instalación y cierre. El cierre no liquida ni elimina el saldo pendiente.
- Navegación y elementos visibles se ajustan al perfil de revisión. Se corrigió una carrera de redirección al entrar desde login a una ruta protegida.

### Responsive, interacción y revisión visual

- Recorrido de 14 rutas en cinco anchos: 320, 390, 768, 1024 y 1440 px. Con los datos habituales de revisión no se encontraron desbordamientos horizontales globales ni errores JavaScript en ese recorrido.
- Se inspeccionaron capturas reales de escritorio y móvil. La barra lateral se reemplaza por menú móvil; formularios, indicadores y columnas se reorganizan; las tablas disponen de tarjetas en pantallas estrechas.
- Una comprobación adicional con un nombre de cliente de 115 caracteres sin espacios detectó desbordamientos en detalle y Cartera. Se corrigió el quiebre de contenido largo y se aprobó su regresión en la suite e2e.
- Menú móvil y modal de abonos revisados a 320 px. Se corrigió el ancho mínimo del menú; se comprobó la contención del foco con Tab y su restauración al cerrar con Escape.
- Las gráficas utilizan los datos filtrados y no animan su entrada, para evitar transiciones y capturas con series parcialmente dibujadas. Su detalle textual permite consultar las cifras sin depender exclusivamente del gráfico.
- Capturas y herramientas temporales de revisión se guardan en `.local/`, ignorado por el repositorio. No sustituyen la validación del cliente sobre sus datos y procesos reales.

### Impresión Carta

- La ficha usa los datos de la OT consultada y omite navegación y controles de pantalla durante la impresión.
- Se generó e inspeccionó un PDF estándar de una página Carta: 612 × 792 puntos.
- Con descripción extensa y 40 pagos, la ficha se distribuyó en tres páginas y conservó el contenido. El formato no impone que cualquier OT, independientemente de su longitud, quepa en una sola hoja.

### Cálculos, fechas y recorridos automatizados

- `tests/domain.test.ts` comprueba valor obligatorio y positivo, número OT manual único, REM/FACT, retenciones, centavos, pagos múltiples, saldo al corte, visibilidad por rol, transiciones, instalación y cierre independiente del cobro.
- Se reforzó la validación de fechas de calendario —incluidos días inexistentes y años bisiestos— y de cantidades cuyo redondeo monetario resultaba en cero. Se comprueba coherencia entre importes normalizados, total cobrable y saldo.
- `tests/analytics.test.ts` verifica ventas por creación, abonos por su fecha individual, cartera histórica, categorías/documentos, totales monetarios, límites inclusivos de períodos y consumo de material por finalización de impresión. Incluye pagos de órdenes antiguas en períodos sin ventas y rangos largos sin recorte silencioso.
- `tests/frontend.spec.ts` recorre acceso local, creación FACT, pagos y persistencia, rutas de producción, instalación y cierre, restricciones de interfaz por perfil, clientes, búsquedas, filtros, reportes, materiales, usuarios, menú por teclado y responsive.
- La suite incorpora regresiones aprobadas para textos largos, límite de 15 usuarios activos y rechazo de cuentas inactivas. El resultado final de la suite completa está en `docs/ESTADO.md`.
- Se ejecutaron satisfactoriamente pruebas unitarias, pruebas e2e y compilación de producción durante la integración. Los resultados finales tras los últimos ajustes, con sus recuentos, se mantienen en `docs/ESTADO.md` para evitar registros divergentes.

### Entorno y alcance de la evidencia

- Las verificaciones de navegador se realizaron con Chromium headless ya instalado. Playwright MCP no pudo iniciar Chrome y la descarga de la revisión actual de Chromium agotó el tiempo; se utilizó el ejecutable disponible de la revisión 1217 mediante `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. El comando reproducible está en `README.md`.
- Las pruebas automatizadas usan contextos aislados: no requieren borrar ni reutilizar los datos del navegador habitual del usuario.
- El recorrido responsive y las pruebas de teclado son comprobaciones concretas, no una certificación completa de accesibilidad ni de compatibilidad con Safari, Firefox o todos los dispositivos físicos.
- No se ha verificado aquí la concurrencia de usuarios en distintos equipos, ni permisos de servidor, autenticación productiva, respaldo central o emisión tributaria. Esas funciones no existen en el adaptador local de esta etapa.

## Pendientes para la siguiente etapa

1. Revisar el frontend con el usuario y confirmar numeración y tratamiento de retenciones antes de implementar reglas definitivas de backend.
2. Implementar la API por módulos, comenzando por Administración: autenticación, permisos del servidor, persistencia central y controles de concurrencia deben sustituir las comprobaciones locales.
3. Repetir las pruebas al conectar cada módulo al backend, incluyendo cambios simultáneos, errores de red y actualización de saldos/estados entre equipos.
4. Ampliar la comprobación a navegadores y dispositivos reales acordados para la entrega, zoom y tecnologías de asistencia. No confundir la revisión actual de Chromium con cobertura universal.

No declarar autenticación real, sincronización multiusuario, despliegue productivo ni backend a partir de estas pruebas del frontend local.
