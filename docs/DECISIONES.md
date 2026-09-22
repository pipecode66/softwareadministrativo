# Decisiones vigentes

1. Las instrucciones directas del usuario prevalecen sobre el PDF, los HTML originales y decisiones históricas.
2. El servidor asigna el número de OT automáticamente desde 1. Nunca se captura desde el cliente HTTP ni se reinicia con OT conservadas.
3. Una OT nueva de un cliente normal exige abono inicial. Un cliente marcado Especial puede iniciar sin abono; el estado Especial permanece mientras tenga saldo y deja de aplicar al quedar pagada.
4. Los medios admitidos son Efectivo, Bancolombia y Davivienda. Los pagos históricos sin clasificación permanecen como LEGACY.
5. Para nuevas FACT: IVA = 19 % de la base; si base > $524.000, RETE FUENTE = 4 %, RETE IVA = 2,85 % e ICA = 7/1000. Cobrable = base + IVA − retenciones. Debajo del umbral los valores automáticos son cero, pero Administración puede registrar valores manuales.
6. Las OT ya existentes conservan financial_rule=LEGACY para evitar alterar saldos al aplicar migraciones. La limpieza autorizada puede retirarlas después de respaldo y verificación.
7. Los certificados de RETE FUENTE, RETE IVA e ICA se registran por separado. Marcar un certificado reduce su métrica pendiente, no vuelve a modificar el saldo de caja.
8. La cartera con y sin IVA imputa los pagos primero al componente sin IVA; el IVA pendiente es la diferencia entre ambos saldos.
9. El multiabono opera solo sobre las OT elegidas por Administración y distribuye de menor a mayor saldo, con desempate determinista. No reparte sobre OT ajenas al cliente ni permite exceder la deuda seleccionada.
10. La OT principal conserva toda la información comercial. Productos y actividades internas no tienen un segundo valor de venta y no duplican reportes ni cartera.
11. Las áreas vigentes son Diseño, Impresión, Taller y Externo. Externo sustituye a Imprenta para nuevas OT y puede convivir en el mismo producto con las demás áreas; por sí solo no utiliza medidas ni materiales de Impresión.
12. Diseño debe anteceder a Impresión dentro del mismo producto. Administración asigna diseñadores y un diseñador puede tomar una tarea libre.
13. Los materiales vigentes son Panaflex, V. Corte, V. Impresión y Banner. Se permiten varios por producto y su consumo se contabiliza al completar Impresión.
14. Diseño crea clientes y OT y puede indicar su abono inicial. En el historial de un cliente ve todas las OT operativas, pero no totales, pagos, saldos, retenciones ni certificados.
15. Solo Administración edita la información comercial y opera pagos, multiabonos, certificados y reportes. Impresión y Taller reciben exclusivamente información operativa.
16. La instalación es opcional. Si no se requiere, la OT finaliza al completar todas sus actividades; si se requiere, queda pendiente hasta registrar la instalación.
17. Las fechas de negocio usan America/Bogota. Los importes se calculan en centavos y las áreas en m² con hasta tres decimales.
18. La depuración del 21/09/2026 elimina únicamente datos comerciales anteriores a 2026-09-21 00:00 America/Bogota, preserva usuarios y no se ejecuta automáticamente en migraciones o despliegues.
19. No se afirma despliegue, migración o limpieza de PostgreSQL remoto sin evidencia de conexión, respaldo y resultado.
20. Impresión se clasifica por actividad como PRINT o LASER. LASER cuesta exactamente $1.000 COP por minuto entero y exige minutos antes de completarse.
21. Completar LASER recompone la base desde subtotales comerciales más cargos láser completados. En FACT se actualiza el IVA y las retenciones almacenadas permanecen sin cambios ni nueva evaluación del umbral.
22. El valor inicial cero se admite únicamente en una FACT cuyos productos sean exclusivamente Corte Láser, con Diseño previo opcional. No exige abono inicial mientras el cobrable sea cero.
23. Cada creador admite un único borrador privado. El borrador no es una OT, no reserva consecutivo y solo su propietario puede leerlo o borrarlo.
24. La cantidad de producto es un entero mayor o igual a 1. Especificaciones y largo/ancho generales quedan fuera del contrato; las dimensiones pertenecen únicamente a materiales.
25. Diseño creador recibe automáticamente una actividad DESIGN inicial asignada a sí mismo. El diseñador asignado puede editar descripción y materiales antes de finalizar su actividad.
26. Externo puede coexistir dentro del mismo producto con Diseño, Impresión y Taller; ya no excluye producción interna.
27. Administración puede operar actividades de cualquier área, conservando las precedencias y requisitos de finalización.

## Decisiones sustituidas

- La regla del 15/09 que sumaba retenciones al cobrable fue sustituida por la solicitud del 20/09 para nuevas FACT. Solo se conserva como LEGACY para datos previos.
- El modelo de un material por OT fue sustituido por varios productos y materiales.
- El paso obligatorio de Diseño por aprobación administrativa fue sustituido por creación directa y actividades internas; Administración conserva edición y control.
- Imprenta quedó como valor técnico legado para poder leer registros antiguos, pero no se ofrece para nuevas OT ni se muestra como opción vigente.
- Vinilo fue retirado del catálogo de materiales; puede aparecer libremente en una descripción escrita por el usuario, pero no en métricas o selectores.
