# Contexto del proyecto

## Solicitud actual (2026-09-14)

El usuario autorizó desarrollar backend por tramos comenzando por Administración, conservando el frontend y guardando continuidad. Después usó Cursor con Grok y solicitó revisar sus cambios y continuar el flujo hacia completar backend. Auditar lo existente, conservar avances útiles, verificar con pruebas y separar claramente revisión local, endpoints reales e integración comprobada. **Confirmó numeración automática de OT desde 1 en esta continuación.**

## Solicitud inicial (2026-09-12)

Revisar las dos entregas del frontend, contrastar el PDF, corregir diseño, responsive y comportamiento e implementar el frontend completo en este workspace. Guardar contexto durable para reanudar tras límites de sesión. No publicar externamente ni implementar todavía backend productivo.

Fuentes originales (no modificar):
- `C:/Users/juanitou/Downloads/FRONTEND 1RA PARTE` (15 pantallas HTML/PNG y DESIGN.md).
- `C:/Users/juanitou/Downloads/FRONTEND PARTE FINAL` (login, detalle móvil, impresión OT).
- `C:/Users/juanitou/Downloads/Documento_Tecnico_Intermedios_Gestion_v1.0.pdf` (20 páginas).

## Alcance actualizado del cliente

Aplicación web adaptable para una empresa/sede, hasta 15 usuarios. Roles ADMINMASTER, ADMIN_GENERAL, DISENO, IMPRESION y TALLER. Administración/Diseño crean OT, Diseño requiere revisión administrativa. Rutas solo impresión, solo taller, impresión→taller; instalación simple por Administración/Taller, sin usuarios instaladores. Estados productivos y de pago independientes.

OT con cliente, descripción, valor obligatorio, REM/FACT, categoría comercial, ruta, impresión cuando aplica. Sin urgencias. El usuario pidió retirar consecutivo automático e iniciar desde 1; no continuidad histórica. Varios pagos por OT con fecha y monto, cartera con saldo positivo incluso con trabajo terminado. FACT añade IVA 19%; retenciones RETE FUENTE, RETE IVA 15, ICA 7×1000 manuales/opcionales. Clasificación FACT no emite factura electrónica.

Reportes de ventas/cobros/cartera por fecha, mes, rango de fechas y rango de meses. Cuatro categorías: SuperGiros, Carro Vallas, Proyecto, Otras. Cinco materiales: Panaflex, Vinilo, V. Corte, V. Impresión, Banner. Largo×ancho mostrado también en m²; estadísticas solo m² por material para administración.

Incluye clientes, filtros de estado y pagos, vista imprimible, último cambio operativo, capacitación/manual/código y garantía posterior según contrato. No: exportación Excel/CSV, inventario, contabilidad, DIAN, pasarelas, notificaciones, maquinaria, adjuntos, GPS, firmas digitales, offline, migración histórica o varias sedes. Los controles de ejemplo que contradicen esto se retiran.

## Frontend entregable de esta etapa

React+TypeScript+Vite, navegación por roles, pantallas conectadas con datos de ejemplo locales, validaciones y acciones de interfaz, componentes compartidos, tablas→tarjetas móviles, impresión Carta. Repositorio de datos separado para futura API. El sistema productivo requiere backend y permisos server-side; el frontend local no sustituye esa etapa.
