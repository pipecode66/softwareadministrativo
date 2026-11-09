# Continuidad de Instalaciones — 09/11/2026

**La instrucción vigente cambió:** el usuario autorizó posteriormente publicar Instalaciones en main para probar en producción. Ya no rige la restricción de sólo-local que aparece en las notas históricas siguientes. Leer primero `docs/ESTADO.md` y `docs/INSTALACIONES_PRODUCCION.md`; aplicar las migraciones pendientes015 y016 para activar el módulo. No se han ejecutado en Supabase desde este entorno.

El módulo se retomó en la rama **local** `feature/instalaciones-local`, a partir del trabajo guardado en `ffe9a06`. Se integra main (`579d2ce`) HACIA esa rama local para conservar las correcciones administrativas y la memoria de secciones. No se hace push ni se ejecuta la migración015 en Supabase. El usuario reiteró el02/11 que debe probarse primero en local.

El09/11 se integra también main4129769 hacia esta rama y se añade el rol exclusivo «Administrador de Instaladores». Se conserva toda la funcionalidad local y los cambios productivos de agrupación de OT/eliminación de abonos. La migración nueva016 amplía roles sin modificar015 ni crear perfiles reales. No ejecutar015/016 en Supabase, no hacer push. Para probar el nuevo rol, reiniciar `npm run api:installations` y crear la cuenta local desde Usuarios/Adminmaster; el usuario creará su perfil cuando corresponda.

Actualización del04/11: el módulo ya se retomó y quedó guardado localmente en `332e20d` con main579d2ce integrado y pruebas aprobadas; su guía actual está en esa rama. Ahora main recibe por separado la corrección de bandejas agrupadas por OT. Antes de continuar Instalaciones, integrar este nuevo main HACIA la rama local; preservar el módulo, su contexto y sus pruebas. La decisión63 de main corresponde a la agrupación; conciliar la numeración coincidente de decisiones locales al fusionar.

El06/11 main incorpora además eliminación administrativa de abonos desde Corregir, con auditoría, recálculo y protección de reenvíos (decisión64). Conservarla al integrar main hacia la rama local. No habilita publicar el módulo de Instalaciones ni ejecutar015 en Supabase. Contador productivo actualizado62/35; el módulo local sigue sin contarse como entrega aceptada.

Antes de retomar:

1. Comprobar que el trabajo productivo está guardado y que el árbol está limpio.
2. Cambiar a `feature/instalaciones-local` y leer sus `docs/ESTADO.md`, `docs/INSTALACIONES_CONTRATO.md` y `docs/INSTALACIONES_LOCAL.md`.
3. Comprobar en git log la integración de main y leer el estado más reciente. Las decisiones productivas59–64 y locales65–71 están conciliadas; conservar ambos conjuntos.
4. Conservar `RememberedOutlet` en AppShell. Administración puede corregir la OT incluso con instalación vinculada; si deja de estar disponible, se aplaza el trabajo y se detienen los relojes, conservando historial. Agregar producción a una OT pendiente de instalación también reabre producción.
5. Mantener la migración de Instalaciones fuera de producción hasta validación expresa, y no reescribir una migración si entretanto se aplicó en algún entorno persistente.

Reglas confirmadas: uno/varios instaladores o equipos reutilizables; responsable principal; asistencia y tiempos propios; estado personal distinto del estado global; llegada/salida GPS puntuales; excepción de ubicación solo por Administración con motivo; fotos privadas y nuevas por visita; resultado y checklist; trazabilidad y versiones. Sin rastreo continuo, sin falsa cola offline, sin finanzas para instaladores.

Las pruebas automatizadas usaron PGlite y coordenadas emuladas; no comprueban GPS físico de un celular ni PostgreSQL remoto. Verificación del02/11 aprobada:204 pruebas frontend,340 servidor y16 recorridos distintos de navegador (12 API+4 locales), con repetición dirigida del selector corregido. Consultar `docs/ESTADO.md` para la evidencia exacta. Lo siguiente es la prueba manual aislada con `npm run api:installations` y `npm run dev:installations`; no hace falta ejecutar SQL en Supabase para probar.
