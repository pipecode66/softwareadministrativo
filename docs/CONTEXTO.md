# Contexto del proyecto

## Objetivo

Intermedios Gestión centraliza clientes, ventas, cartera y producción publicitaria para una sola sede y hasta 15 usuarios. Los roles son ADMINMASTER, ADMIN_GENERAL, DISENO, IMPRESION y TALLER. Las fuentes de Downloads y el PDF son referencias de solo lectura; las instrucciones directas del usuario prevalecen.

## Flujo vigente

Administración y Diseño crean OT. El servidor asigna el consecutivo automáticamente. La creación actual usa una OT comercial principal y uno o más productos; cada producto genera actividades internas en Diseño, Impresión, Taller o Externo, sin crear ventas adicionales.

Una actividad de Diseño debe completarse antes de la actividad de Impresión del mismo producto. Administración puede asignarla a un diseñador; los diseñadores también pueden tomar tareas disponibles. Impresión y Taller actualizan únicamente sus actividades. Externo representa trabajo de terceros y no solicita medidas ni materiales internos. La instalación es opcional.

Administración edita OT antes de iniciar actividades, registra pagos, certificados y multiabonos. Diseño crea clientes y consulta su historial operativo, pero no recibe totales de órdenes, pagos, saldos, retenciones ni certificados. Impresión y Taller tampoco reciben importes comerciales.

## Datos comerciales

- Cliente: nombre y celular obligatorios; identificación opcional para REM y requerida para FACT; indicador Especial para permitir OT sin abono inicial.
- OT: valor base mayor que cero, REM/FACT, categoría SuperGiros, Carro Vallas, Proyecto u Otras, instalación opcional.
- Pago: fecha, valor y método Efectivo, Bancolombia o Davivienda.
- Multiabono: la administradora selecciona las OT; el servidor aplica el valor a sus saldos de menor a mayor.
- Productos: descripción, cantidad, valor unitario, especificaciones y, cuando corresponda, dimensiones.
- Materiales: Panaflex, V. Corte, V. Impresión y Banner, con largo, ancho y m².

Para una FACT nueva se calcula IVA 19 % sobre el valor base. Si la base es estrictamente mayor a $524.000, se proponen automáticamente RETE FUENTE 4 %, RETE IVA 2,85 % e ICA 7/1000. Administración puede editar los importes permitidos. El cobrable nuevo es base + IVA − retenciones. Las OT anteriores a esta regla quedan marcadas LEGACY para no reescribir saldos históricos durante la migración.

## Reportes

Administración consulta ventas por fecha, mes o rango, filtradas por categoría y REM/FACT. FACT e IVA aparecen separados. Cartera muestra saldos al corte con IVA, sin IVA e IVA pendiente. Los certificados recibidos restan de la métrica pendiente de cada retención, no del efectivo ya cobrado. El consumo de materiales cuenta m² únicamente cuando finaliza Impresión.

## Fuera de alcance

No incluye urgencias, inventario, exportación Excel/CSV, contabilidad integral, emisión DIAN, pasarela de pagos, archivos adjuntos, GPS, firma digital, modo sin conexión, varias sedes ni cuentas independientes de instaladores.

## Estado técnico

Frontend React/TypeScript/Vite y backend Express/TypeScript con PostgreSQL productivo o PGlite en desarrollo. Autenticación por cookie HttpOnly, CSRF, Argon2, roles server-side, idempotencia en operaciones sensibles y control de versión de OT. Vercel utiliza el adaptador api/ y PostgreSQL externo.

La versión del 21/09/2026 está implementada y verificada localmente, pero esta sesión no comprobó ni modificó el despliegue o la base remota. Consultar docs/ESTADO.md para el punto exacto y docs/LIMPIEZA_DATOS_2026-09-21.md para la depuración autorizada.
