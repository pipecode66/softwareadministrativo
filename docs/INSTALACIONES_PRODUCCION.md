# Activar Instalaciones en producción — 09/11/2026

El usuario autorizó publicar el módulo completo y el rol Administrador de Instaladores en main para probar directamente en producción. Esta instrucción sustituye la restricción anterior de trabajar únicamente en local. El código fue validado con bases PGlite aisladas; no se ha ejecutado SQL ni creado cuentas en la base productiva desde este entorno.

## Migraciones requeridas

Vercel no ejecuta las migraciones al recibir un push. En el editor SQL de Supabase aplica las que estén pendientes, en este orden:

1. `server/migrations/015_installations.sql`: tablas de instalaciones, integrantes, equipos, eventos, solicitudes y evidencias privadas; rol Instalador y RLS habilitado.
2. `server/migrations/016_installation_admin_role.sql`: agrega Administrador de Instaladores a los roles permitidos.

No modifican clientes, OT, pagos, usuarios existentes ni consecutivos. Si ya se aplicó una, no la vuelvas a ejecutar. El módulo responde que requiere configuración mientras falten sus tablas; la edición de OT existentes continúa funcionando durante ese intervalo. El nuevo rol no puede guardarse en Usuarios hasta aplicar016.

La siguiente consulta de lectura permite revisar la instalación del esquema:

```sql
SELECT
  to_regclass('public.installations') IS NOT NULL AS instalaciones,
  to_regclass('public.installation_members') IS NOT NULL AS integrantes,
  to_regclass('public.installation_events') IS NOT NULL AS eventos,
  to_regclass('public.installation_evidence') IS NOT NULL AS evidencias,
  to_regclass('public.installation_requests') IS NOT NULL AS solicitudes,
  to_regclass('public.installation_teams') IS NOT NULL AS equipos,
  to_regclass('public.installation_team_members') IS NOT NULL AS integrantes_equipos,
  to_regclass('public.installation_team_events') IS NOT NULL AS eventos_equipos,
  to_regclass('public.installation_team_requests') IS NOT NULL AS solicitudes_equipos,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_role_check'
      AND pg_get_constraintdef(oid) LIKE '%ADMIN_INSTALADORES%'
  ) AS rol_administrador_instaladores;
```

Todos los valores deben ser true. Las tablas habilitan RLS sin políticas de acceso directo para anon/authenticated; se consultan por el servidor con sesión y permisos.

## Cuentas y recorrido

Desde la cuenta Adminmaster, entra en Usuarios y crea la cuenta con perfil **Administrador de Instaladores**. Crea también las cuentas personales con perfil **Instalador** que necesites. El usuario se encargará de estas altas; no se generan perfiles de demostración ni se copian datos locales al desplegar.

El nuevo administrador entra directamente a Instalaciones y únicamente gestiona ese módulo. Puede programar, asignar personas/equipos, reasignar, aplazar, reprogramar, corregir datos del lugar, autorizar excepciones GPS y consultar evidencia, historial y rendimiento. No recibe OT completas, clientes, finanzas, producción ni gestión de usuarios.

Las OT que requieren instalación aparecen disponibles cuando terminan todas sus áreas productivas. Cada instalador registra su propia llegada, pausas y salida; el principal guarda fotografía y resultado para finalizar. Al terminar, la OT queda Instalada. Las OT ya instaladas por el flujo anterior conservan su estado y no generan instalaciones duplicadas.

La prueba física en el celular debe verificar permisos de ubicación/cámara, captura de llegada/salida, descanso/almuerzo y evidencia. El despliegue debe utilizar HTTPS para geolocalización. Ante un fallo de ubicación, un perfil gestor autoriza la excepción con motivo; la acción la registra personalmente el instalador.

Los scripts `npm run api:installations` y `npm run dev:installations` continúan siendo exclusivamente locales. No se usan para ejecutar la aplicación de producción ni importan su base.
