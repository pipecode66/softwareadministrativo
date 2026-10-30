# Instalaciones pausado — 29/10/2026

El módulo está conservado en la rama **local** `feature/instalaciones-local`, commit `ffe9a06`. No se hizo push de esa rama ni se ejecutó su migración015 en Supabase. La solicitud posterior del usuario de publicar dos cambios en main **no autoriza publicar Instalaciones**.

Antes de retomar:

1. Comprobar que el trabajo productivo está guardado y que el árbol está limpio.
2. Cambiar a `feature/instalaciones-local` y leer sus `docs/ESTADO.md`, `docs/INSTALACIONES_CONTRATO.md` y `docs/INSTALACIONES_LOCAL.md`.
3. Integrar main en esa rama local, resolviendo los conflictos de documentos/servicios sin perder las nuevas correcciones administrativas ni la memoria de páginas. La numeración de decisiones puede coincidir entre ramas: conciliarla, no borrar contexto.
4. Conservar `RememberedOutlet` en AppShell; el módulo Instalaciones no debe restaurar la versión anterior que desmontaba cada pantalla. Su guardia al editar una OT con instalación vinculada deberá revisarse con la autorización nueva de edición integral.
5. Mantener la migración de Instalaciones fuera de producción hasta validación expresa, y no reescribir una migración si entretanto se aplicó en algún entorno persistente.

Reglas confirmadas: uno/varios instaladores o equipos reutilizables; responsable principal; asistencia y tiempos propios; estado personal distinto del estado global; llegada/salida GPS puntuales; excepción de ubicación solo por Administración con motivo; fotos privadas y nuevas por visita; resultado y checklist; trazabilidad y versiones. Sin rastreo continuo, sin falsa cola offline, sin finanzas para instaladores.

Las pruebas automatizadas usaron PGlite y coordenadas emuladas; no comprueban GPS físico de un celular ni PostgreSQL remoto. La última prueba API registrada antes de pausar estaba aprobada. Consultar el estado en la rama para el detalle y pendientes de validación manual.
