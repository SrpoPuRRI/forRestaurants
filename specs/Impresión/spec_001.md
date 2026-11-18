# Sistemas de Impresión

## Necesidad del restaurante

La necesidad opcional se llama **Sistemas de Impresión** en toda interfaz nueva y se persiste como `printing_systems` en `restaurants.needs`. `receipts` y «Comprobantes» solo se conservan como nombres históricos para convertir datos y describir la tabla anterior; no son el nombre visible de la necesidad. La migración `202611130007_printing_systems.sql` convierte los valores antiguos sin borrar las otras necesidades. No añade roles ni espacios de trabajo por sí sola. Efectivo y el registro de pedidos siguen funcionando aunque no haya ningún punto de impresión configurado.

## Tres áreas de configuración

1. **Puntos de Impresión:** varios destinos por restaurante. Cada punto define nombre, si admite salida manual, automática o ambas, transporte/dispositivo y formato. Un punto de impresión no configura, valida ni emite comprobantes SUNAT.
2. **Flujos de impresión:** el administrador elige los eventos observados y una o más rutas por evento. Una ruta puede mandar el mismo pedido a cocina, barra, caja u otro punto, con formato y copias propios.
3. **Formatos de ticket:** colección de formatos del restaurante. Un flujo selecciona el formato aplicable para cada punto/ruta. La migración convierte el formato único anterior a `Formato predeterminado`.

Las tablas `printing_points`, `printing_flows`, `printing_flow_routes`, `printing_ticket_templates` y `printing_jobs` implementan la base de datos de esta arquitectura. Los cambios de configuración son de administrador. Las políticas mantienen acceso por restaurante aunque la necesidad esté desactivada; la necesidad controla visibilidad y ejecución del flujo. Los trabajos se crean mediante `enqueue_print_event`; una clave de evento y ruta no se duplica para el mismo `event_id`.

### Opciones de salida

- **Manual:** el punto puede declararse compatible con impresión manual desde el dispositivo. Falta implementar el renderizador final de formatos y la vista imprimible.
- **Automática:** crear trabajos y entregarlos a un agente local o integración compatible. La cola, el registro de dispositivos, el ciclo de presencia/reclamo/resultado y los reportes están preparados en la base/app web; falta el programa/agente de impresión y su reintento operativo.

La impresión es independiente de SUNAT. Los puntos y flujos no guardan RUC, credenciales PSE/OSE ni configuración fiscal. Un comprobante aceptado puede producir un evento imprimible en uno o varios flujos, igual que cualquier otro evento de la app.

### Emisión de comprobantes electrónicos (SUNAT/PSE)

La conexión tributaria es una configuración propia del administrador, separada de **Sistemas de Impresión**. Esta sección se muestra como integración/configuración administrativa, no como propiedad de un punto de impresión. Antes de habilitar emisión se deben completar los datos fiscales y las arquitecturas requeridas por la modalidad elegida.

- El restaurante configura y autoriza un PSE (o, en una etapa futura, otra modalidad SEE compatible). La integración transmite la solicitud de emisión y recibe el resultado; el estado del documento y su referencia quedan asociados al movimiento que lo originó.
- Los movimientos deben distinguir al menos `not_sent`, `sent`, `accepted` y `rejected`, junto con identificadores, timestamps, respuesta/constancia y documento electrónico necesarios para trazabilidad. El rechazo no convierte la impresión en fallida: es un resultado tributario del movimiento y debe informarse al usuario.
- El evento de negocio de aceptación —por ejemplo `cpe_accepted`— puede configurarse en **Flujos de impresión** para producir una representación impresa. Rechazo puede generar notificación/estado visible; no debe imprimirse como comprobante válido.
- La impresión de una representación no es evidencia de aceptación tributaria. A la inversa, la aceptación por SUNAT/PSE no prueba que la impresora produjo papel ni que el cliente lo recogió.
- `printTicket(event, options)` sigue siendo el punto de entrada de impresión. Debe recibir un evento de emisión ya ocurrido o confirmado; no es responsable de emitir, validar ni consultar el PSE.

Las obligaciones técnicas dependen de la modalidad SEE y del proveedor. La app no debe presentar un comprobante como aceptado hasta recibir el resultado de la integración. Las credenciales y certificados se guardan en infraestructura de servidor segura, nunca en puntos de impresión ni en el cliente web.

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
| `cpe_accepted` (propuesto; requiere implementación) | El PSE/SUNAT confirma la aceptación del comprobante asociado al movimiento | Imprimir la representación aprobada, si existe una ruta configurada |

Los trabajos contienen un `payload` JSON con una instantánea del evento y una instantánea de ruta/formato para que cambios futuros de configuración no alteren trabajos ya encolados. La base limita la clave a los eventos implementados; habilitar `cpe_accepted` requiere actualizar la validación en base, el emisor y el manejo del documento aprobado. Esta clave es una decisión de producto documentada, no un evento ya soportado.

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
- Pendiente: agente/programa físico, protocolo de impresión ESC/POS, renderizador y vista manual, reintentos/idempotencia física, retención histórica de ejecuciones y validar eventos con restaurantes. La integración SUNAT/PSE pertenece a Configuración del administrador y al ciclo de movimientos, no al módulo de impresión.
- `restaurant_receipt_templates` se conserva durante el despliegue como tabla heredada, de solo compatibilidad. Nuevas escrituras deben usar `printing_ticket_templates`.

### Divergencia pendiente de implementación

El código actual todavía contiene `printing_points.sunat_enabled` y adapta la selección de formato/ruta según ese valor. Esto contradice la decisión vigente: retirar SUNAT de puntos y flujos de impresión. La futura migración/cambio de código deberá dejar esos datos antiguos solo para migrarlos o ignorarlos de forma compatible, y mover la configuración fiscal a Configuración del administrador. No considerar esta separación implementada hasta completar los cambios de frontend, base y despliegue.

## Dispositivos, operación y reportes (diseño actualizado 2026-11-15)

La base y la app web preparan el ciclo operativo de impresoras de red; todavía no existe el programa que correrá dentro de la impresora.

### Actualización de arquitectura: agente BPrint multiimpresora

Una instancia de BPrint corre en un dispositivo del restaurante y administra las impresoras que se le asignen, por USB al anfitrión o por la LAN. BPrint verifica cada impresora individualmente en la red/localmente, pero reporta estados y opera la cola en una sola llamada por lote a la base.

- Cada impresora conserva estado y `last_seen_at` propio. BPrint incluye en el lote solo las impresoras que logró comprobar; si una impresora cae, deja de actualizarse su fila y la web la marca inactiva sin afectar a las demás.
- No hay un grupo persistente por instancia. Cada impresora tiene propiedad temporal individual, determinada por su `last_seen_at`; una instancia BPrint puede operar cualquier conjunto de impresoras que logre reclamar.
- Si el timestamp de una impresora vence el umbral configurado, cualquier instancia autorizada puede tomarla. El claim de cada impresora es atómico para que dos instancias no ganen a la vez; el batch puede reclamar las impresoras libres aunque otras sigan activas en otra instancia.
- La base entrega un token/generación de lease por impresora. Cada lote usa ese token; al cambiar el propietario, el anterior queda cercado y su siguiente operación devuelve `ownership_lost`. La instancia anterior deja de reportar esa impresora, pero continúa con las demás que conserve.
- Si se cae BPrint o pierde conexión con Supabase, deja de actualizar las filas de todas las impresoras enlazadas a esa instancia; la web las marca inactivas por sus timestamps vencidos.
- Un lote reduce el número de llamadas a Supabase, pero la base aún debe actualizar el estado de cada impresora viva. No se debe describir como una sola escritura total.
- La credencial de BPrint debe autorizar solo las impresoras enlazadas a esa instalación. No usar `service_role` dentro de la app.
- Se podrá elevar el intervalo ocioso luego de medir el costo y la rapidez de detección. El intervalo con tareas activas y los umbrales web quedan coordinados con los estados individuales.
- Falta definir el umbral exacto para una nueva toma, si un cierre normal libera inmediatamente, y cómo se recuperan trabajos `taken` para impedir duplicados y resultados tardíos del propietario anterior.

Esta decisión sustituye la expectativa de que cada impresora física mantenga su propio canal directo a Supabase. El contrato SQL actual `operate_printing_device` es por impresora y todavía requiere una futura arquitectura/RPC por lote, con migración posterior.

- `printing_devices` identifica un dispositivo físico por `hardware_key` inmutable, tiene un UUID que se copia desde la app, modelo, restaurante enlazado, hash de token y último latido. El secreto nunca se devuelve al cliente web. El alta inicial queda reservada a un servicio de servidor con `service_role`; el dispositivo no se autorregistra con credenciales anónimas.
- Un punto que admite salida automática requiere un ID de dispositivo enlazado, y cada dispositivo puede pertenecer a un solo punto. El admin pega el ID exacto al crear/editar el punto. La UI muestra si está disponible y permite guardar o editar flujos aunque el dispositivo esté inactivo. Un punto solo manual no requiere dispositivo.
- `printing_flow_runs` agrupa todas las tareas que produce un evento en un flujo. `printing_jobs` contiene por destino el `flow_run_id`, dispositivo, payload y snapshot de formato/ruta. Sus estados son `published`, `taken`, `failed` y `success`.
- El contrato actual `operate_printing_device` es una operación coordinada por impresora. BPrint pasará a usar una futura operación autenticada por instalación que reporte varias impresoras y coordine sus tareas en un lote. Los intervalos heredados de 10 s ocioso/2 s activo son referencia pendiente de recalibrar para el lote; no se fija aún el nuevo intervalo ocioso.
- La app ejecuta `operate_printing_web` cada 5 s. Si existe una tarea `taken`, considera inactivo un dispositivo cuyo último latido supera 7 s; sin tareas `taken`, usa 15 s. Si se vence el plazo, marca como fallidas las tareas publicadas/tomadas de ese dispositivo. Las ejecuciones automáticas continúan aunque falle la impresión.
- Al quedar terminales todas las tareas de una ejecución, la app presenta un reporte. Si todas terminan en `success`, presenta el mensaje de éxito; si hay fallas, presenta el detalle por destino. Aceptar el reporte borra únicamente las filas de trabajo de esa ejecución. El registro resumido de la ejecución se conserva y el dispositivo vuelve a estado ocioso en su siguiente operación.
- Para una reimpresión iniciada manualmente, el servidor rechaza iniciar el flujo si alguno de los destinos aplicables está pausado o no disponible. Para eventos automáticos, los destinos no disponibles quedan registrados como tarea fallida y no bloquean el pedido ni el pago.
- La salida manual desde la app todavía no tiene pantalla imprimible. Hasta implementarla, esa ruta termina en el reporte con `manual_printing_view_pending`; la cola automática solo publica tareas de impresión automática.
- Los trabajos anteriores a esta migración se agrupan en ejecuciones; los que no estén enlazados a una impresora quedan como fallidos con `printing_device_not_linked`, para que no queden colas huérfanas.

`register_printing_device` está protegido para `service_role` y espera que un servicio futuro presente `hardware_key`, modelo y un token aleatorio. La app web solo acepta el UUID, no registra hardware. La instalación, el protocolo/firmware, la recuperación tras corte de energía, los reintentos físicos y la garantía contra impresión duplicada todavía requieren diseñar y probar el agente del dispositivo. No existe integración SUNAT/PSE implementada; su diseño y estados pertenecen a la configuración fiscal y a los movimientos. No crear tareas de impresión como sustituto del estado de emisión.
