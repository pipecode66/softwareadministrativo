# Guía de revisión del frontend

## Entrar y navegar

Ejecutar `npm run dev` y abrir http://127.0.0.1:5173/. En **Ver accesos de revisión**, seleccionar Adminmaster o Administración y pulsar **Ingresar al sistema**. En móvil, el botón superior izquierdo abre el menú. El cierre de sesión está junto al nombre del usuario, al pie del menú.

Los registros son ficticios. Se puede navegar, crear clientes/órdenes y probar pagos y producción; esos cambios se guardan únicamente en este navegador.

## Crear y tramitar una orden

1. En **Clientes**, registrar un cliente si no aparece en el directorio.
2. En **Nueva OT**, escribir un número único mayor que cero, seleccionar cliente y completar descripción y valor.
3. Elegir SuperGiros, Carro Vallas, Proyecto u Otras, y seleccionar REM o FACT. FACT añade IVA del 19 % al valor base. Las retenciones son importes COP manuales y opcionales que se agregan al total cobrable.
4. Seleccionar solo Impresión, solo Taller o Impresión → Taller. Para impresión, elegir material y dimensiones en metros. El área se calcula en m². Indicar instalación si corresponde.
5. Guardar y revisar el detalle. Administración puede aprobar y enviar. Una orden creada desde Diseño queda pendiente de revisión administrativa.
6. Completar las etapas desde el detalle, Operación o las bandejas autorizadas. Taller permite registrar la instalación cuando corresponde.

Los datos generales de la OT solo se editan por Administración antes de enviarla a producción. La producción no se adelanta ni se da por pagada automáticamente al guardar.

## Abonos y cartera

Desde el detalle administrativo, **Registrar abono o pago** permite introducir fecha y valor. Pueden registrarse varios pagos y consultar quién los registró. **Pagar saldo completo** rellena el importe pendiente, pero exige confirmación antes de guardar.

El pago no puede superar el saldo, ser cero ni tener una fecha anterior a la OT o posterior a hoy. Cada pago actualiza el saldo compartido de las pantallas.

En **Cartera**, la fecha de corte determina qué pagos se descuentan. Se incluyen órdenes anteriores a esa fecha, aunque hayan sido creadas antes del período comercial que se esté analizando. Una OT terminada, instalada o cerrada puede seguir en cartera.

## Consultar estadísticas

- **Reportes:** seleccionar día, mes, rango de fechas o rango de meses y filtrar por categoría y REM/FACT. Ventas corresponde a la creación de la OT; pagos recibidos corresponde a la fecha individual de cada abono.
- **Control REM / FACT:** permite distinguir base, IVA, total, retenciones y total cobrable. No representa emisión electrónica.
- **Materiales:** muestra Panaflex, Vinilo, V. Corte, V. Impresión y Banner. Una orden en la cola no suma consumo; se contabiliza al finalizar impresión, en la fecha de finalización.
- **Inicio:** resume indicadores del período y muestra por separado la operación actual, que no depende de ese período.
- Los gráficos también ofrecen valores escritos; no es necesario interpretar solo colores o formas.

## Revisar otros perfiles e impresión

Cerrar sesión e ingresar desde otra cuenta local. Diseño crea y sigue sus propias órdenes. Impresión y Taller solo ven sus trabajos activos y no tienen controles financieros ni creación de OT. Adminmaster administra los usuarios locales; Administración general no administra cuentas.

Desde el detalle administrativo, abrir **Vista imprimible** y usar **Imprimir orden**. Se configura papel Carta; la ficha utiliza los datos de la OT, no incluye el menú y puede ocupar más de una página cuando el contenido o los pagos lo requieran. La previsualización del navegador permite comprobarlo antes de imprimir físicamente.

## Qué falta para operar en producción

Conectar backend, autenticación y permisos de servidor, almacenamiento central y respaldos. También confirmar numeración de OT y tratamiento final de las retenciones. El frontend local no sustituye estos componentes.
