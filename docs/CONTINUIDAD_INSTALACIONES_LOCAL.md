# Continuidad de Instalaciones — 02/11/2026

El módulo se retomó en la rama **local** `feature/instalaciones-local`, a partir del trabajo guardado en `ffe9a06`. Se integra main (`579d2ce`) HACIA esa rama local para conservar las correcciones administrativas y la memoria de secciones. No se hace push ni se ejecuta la migración015 en Supabase. El usuario reiteró el02/11 que debe probarse primero en local.

Para retomar:

1. Comprobar que el trabajo productivo está guardado y que el árbol está limpio.
2. Cambiar a `feature/instalaciones-local` y leer sus `docs/ESTADO.md`, `docs/INSTALACIONES_CONTRATO.md` y `docs/INSTALACIONES_LOCAL.md`.
3. Comprobar en git log la integración de main y leer el estado más reciente. Las decisiones de Instalaciones están conciliadas como63–66; las59–62 productivas permanecen conservadas.
4. Conservar `RememberedOutlet` en AppShell. Administración puede corregir la OT incluso con instalación vinculada; si deja de estar disponible, se aplaza el trabajo y se detienen los relojes, conservando historial. Agregar producción a una OT pendiente de instalación también reabre producción.
5. Mantener la migración de Instalaciones fuera de producción hasta validación expresa, y no reescribir una migración si entretanto se aplicó en algún entorno persistente.

Reglas confirmadas: uno/varios instaladores o equipos reutilizables; responsable principal; asistencia y tiempos propios; estado personal distinto del estado global; llegada/salida GPS puntuales; excepción de ubicación solo por Administración con motivo; fotos privadas y nuevas por visita; resultado y checklist; trazabilidad y versiones. Sin rastreo continuo, sin falsa cola offline, sin finanzas para instaladores.

Las pruebas automatizadas usaron PGlite y coordenadas emuladas; no comprueban GPS físico de un celular ni PostgreSQL remoto. Verificación del02/11 aprobada:204 pruebas frontend,340 servidor y16 recorridos distintos de navegador (12 API+4 locales), con repetición dirigida del selector corregido. Consultar `docs/ESTADO.md` para la evidencia exacta. Lo siguiente es la prueba manual aislada con `npm run api:installations` y `npm run dev:installations`; no hace falta ejecutar SQL en Supabase para probar.
