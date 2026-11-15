# Sistemas de Impresión

## Necesidad del restaurante

La necesidad opcional se llama **Sistemas de Impresión** en toda interfaz nueva y se persiste como `printing_systems` en `restaurants.needs`. `receipts` y «Comprobantes» solo se conservan como nombres históricos para convertir datos y describir la tabla anterior; no son el nombre visible de la necesidad. La migración `202611130007_printing_systems.sql` convierte los valores antiguos sin borrar las otras necesidades. No añade roles ni espacios de trabajo por sí sola. Efectivo y el registro de pedidos siguen funcionando aunque no haya ningún punto de impresión configurado.

## Tres áreas de configuración

1. **Puntos de Impresión:** varios destinos por restaurante. Cada punto define nombre, si admite salida manual, automática o ambas, transporte/dispositivo y si emite comprobantes electrónicos SUNAT.
2. **Flujos de impresión:** el administrador elige los eventos observados y una o más rutas por evento. Una ruta puede mandar el mismo pedido a cocina, barra, caja u otro punto, con formato y copias propios.
3. **Formatos de ticket:** colección de formatos del restaurante. Un flujo selecciona el formato aplicable para cada punto/ruta. La migración convierte el formato único anterior a `Formato predeterminado`.

Las tablas `printing_points`, `printing_flows`, `printing_flow_routes`, `printing_ticket_templates` y `printing_jobs` implementan la base de datos de esta arquitectura. Los cambios de configuración son de administrador. Las políticas mantienen acceso por restaurante aunque la necesidad esté desactivada; la necesidad controla visibilidad y ejecución del flujo. Los trabajos se crean mediante `enqueue_print_event`; una clave de evento y ruta no se duplica para el mismo `event_id`.

### Opciones de salida

- **Manual:** el punto puede declararse compatible con impresión manual desde el dispositivo. Falta implementar el renderizador final de formatos y la vista imprimible.
- **Automática:** crear trabajos y entregarlos a un agente local o integración compatible. La cola, el registro de dispositivos, el ciclo de presencia/reclamo/resultado y los reportes están preparados en la base/app web; falta el programa/agente de impresión y su reintento operativo.
- **SUNAT:** es una integración de emisión electrónica, separada del transporte de papel. Cuando un punto active SUNAT, sus rutas se reservan para comprobantes electrónicos. La interfaz actual solo guarda el RUC y el proveedor declarado; no guarda credenciales ni emite. Falta elegir proveedor/OSE/PSE, guardar secretos en servidor, implementar emisión, cancelación/notas cuando correspondan y estados de aceptación/rechazo.

Google Apps Script puede orquestar servicios alojados en Google, pero por sí solo no es un puente universal a impresoras USB/locales. No se adopta como mecanismo directo de impresión automática hasta definir un agente local o integración concreta.

## Eventos iniciales propuestos

Lista inicial deliberadamente genérica, sujeta a revisión del producto:

| Clave | Cuándo se crea | Uso probable |
|---|---|---|
| `open_order_created` | Se guarda un pedido abierto nuevo | Comanda a cocina/barra |
| `open_order_updated` | Se modifica un pedido abierto | Comanda de cambios o actualización |
| `paid_order_created` | El pago se registra correctamente | Ticket de cliente/caja y/o comanda si el flujo lo pide |
| `payment_corrected` | Se corrige un movimiento pagado | Copia corregida para control; no cambia estadísticas |
| `kitchen_order_ready` | Cocina marca pedido/lista su preparación | Aviso o ticket de pase para salón |
| `salon_order_delivered` | Salón marca pedido entregado | Constancia operativa opcional |
| `manual_reprint` | Una persona solicita reimprimir desde un movimiento | Copia explícita; no crea otro movimiento financiero |

Los trabajos contienen un `payload` JSON con una instantánea del evento y una instantánea de ruta/formato para que cambios futuros de configuración no alteren trabajos ya encolados. La base limita la clave a esta lista inicial; añadir eventos requiere actualizar la lista de base y el emisor del evento.

## API de aplicación

`printTicket(event, options)` es el punto de entrada común. Forma de llamada:

```js
await printTicket({
  type: "paid_order_created",
  data: { order_id: paidOrderId },
});
```

La rutina llama `enqueue_print_event` y no sondea un supuesto estado de impresora indefinidamente. Una llamada con solo `orderId` se interpreta como `manual_reprint`. Los trabajos se crean en la cola, pero la aplicación no afirma que el papel ya se imprimió. El pago confirmado, pago corregido, pedido abierto creado/actualizado, cocina listo y salón entregado ya emiten los eventos correspondientes cuando la necesidad está activa. Si no hay un flujo para un evento automático, no se muestra un error al empleado.

## Impresoras térmicas y conectividad

La primera compatibilidad debe enfocarse en equipos térmicos de 58/80 mm que aceptan **ESC/POS**, pero la compatibilidad debe comprobarse por modelo y firmware: “ESC/POS” no garantiza que todas las marcas implementen cada comando igual. Para impresión automática en red suele usarse una impresora Ethernet/LAN con comandos ESC/POS; USB/Bluetooth requieren un puente local con permisos del sistema operativo. El navegador no ofrece una API universal para imprimir silenciosamente en cualquier impresora.

Una arquitectura segura propuesta es POS web → cola autenticada → agente local enlazado al restaurante/punto → impresora de LAN/USB. No exponer puerto raw de impresora (frecuentemente 9100) a Internet; mantener dispositivos en LAN confiable. Las marcas/modelos mencionados por vendedores locales sirven para una matriz de pruebas, no como estadística nacional de uso.

Referencias técnicas: [guía Epson TM-T20III](https://files.support.epson.com/pdf/pos/bulk/tm-t20iii_trg_en_reva.pdf), [ESC/POS de Epson Perú](https://epson.com.pe/innovative-technologies-point-of-sale), [alerta de seguridad Epson para impresoras de red](https://epson.com.pe/Support/wa00977), [web apps de Apps Script](https://developers.google.com/apps-script/guides/web).

## Estado de implementación

- Implementado en el código local: nombre **Sistemas de Impresión**; editores CRUD; rutas múltiples; `save_printing_flow`; cola idempotente; `printTicket()`; registro seguro de dispositivos por servidor; puntos enlazados a impresoras; estados y ciclo de ejecución; monitor web y reportes.
- Requiere las migraciones de impresión 007–011 y `202611150001_printing_devices_and_operations.sql`, además de publicar el frontend.
- Pendiente: agente/programa físico, protocolo de impresión ESC/POS, renderizador y vista manual, reintentos/idempotencia física, integración SUNAT, retención histórica de ejecuciones y validar eventos con restaurantes.
- `restaurant_receipt_templates` se conserva durante el despliegue como tabla heredada, de solo compatibilidad. Nuevas escrituras deben usar `printing_ticket_templates`.

## Dispositivos, operación y reportes (diseño actualizado 2026-11-15)

La base y la app web preparan el ciclo operativo de impresoras de red; todavía no existe el programa que correrá dentro de la impresora.

- `printing_devices` identifica un dispositivo físico por `hardware_key` inmutable, tiene un UUID que se copia desde la app, modelo, restaurante enlazado, hash de token y último latido. El secreto nunca se devuelve al cliente web. El alta inicial queda reservada a un servicio de servidor con `service_role`; el dispositivo no se autorregistra con credenciales anónimas.
- Un punto que admite salida automática requiere un ID de dispositivo enlazado, y cada dispositivo puede pertenecer a un solo punto. El admin pega el ID exacto al crear/editar el punto. La UI muestra si está disponible y permite guardar o editar flujos aunque el dispositivo esté inactivo. Un punto solo manual no requiere dispositivo.
- `printing_flow_runs` agrupa todas las tareas que produce un evento en un flujo. `printing_jobs` contiene por destino el `flow_run_id`, dispositivo, payload y snapshot de formato/ruta. Sus estados son `published`, `taken`, `failed` y `success`.
- `operate_printing_device` es una operación coordinada: autentica el dispositivo, actualiza su latido y, cuando corresponde, reclama una tarea publicada o informa el resultado de una tarea. Sin tareas usa intervalo sugerido de 10 s; al tener una tarea de trabajo o esperar el cierre de un reporte, 2 s. El reclamo usa bloqueo concurrente para no asignar una tarea a dos dispositivos.
- La app ejecuta `operate_printing_web` cada 5 s. Si existe una tarea `taken`, considera inactivo un dispositivo cuyo último latido supera 7 s; sin tareas `taken`, usa 15 s. Si se vence el plazo, marca como fallidas las tareas publicadas/tomadas de ese dispositivo. Las ejecuciones automáticas continúan aunque falle la impresión.
- Al quedar terminales todas las tareas de una ejecución, la app presenta un reporte. Si todas terminan en `success`, presenta el mensaje de éxito; si hay fallas, presenta el detalle por destino. Aceptar el reporte borra únicamente las filas de trabajo de esa ejecución. El registro resumido de la ejecución se conserva y el dispositivo vuelve a estado ocioso en su siguiente operación.
- Para una reimpresión iniciada manualmente, el servidor rechaza iniciar el flujo si alguno de los destinos aplicables está pausado o no disponible. Para eventos automáticos, los destinos no disponibles quedan registrados como tarea fallida y no bloquean el pedido ni el pago.
- La salida manual desde la app todavía no tiene pantalla imprimible. Hasta implementarla, esa ruta termina en el reporte con `manual_printing_view_pending`; la cola automática solo publica tareas de impresión automática.
- Los trabajos anteriores a esta migración se agrupan en ejecuciones; los que no estén enlazados a una impresora quedan como fallidos con `printing_device_not_linked`, para que no queden colas huérfanas.

`register_printing_device` está protegido para `service_role` y espera que un servicio futuro presente `hardware_key`, modelo y un token aleatorio. La app web solo acepta el UUID, no registra hardware. La instalación, el protocolo/firmware, la recuperación tras corte de energía, los reintentos físicos y la garantía contra impresión duplicada todavía requieren diseñar y probar el agente del dispositivo. SUNAT también sigue sin integración real: por ahora sus tareas terminan con `sunat_integration_pending`.
