# Sistemas de Impresión

## Necesidad del restaurante

La necesidad opcional se llama **Sistemas de Impresión** y se persiste como `printing_systems` en `restaurants.needs`. La migración `202611130007_printing_systems.sql` convierte los valores antiguos `receipts` sin borrar las otras necesidades. No añade roles ni espacios de trabajo por sí sola. Efectivo y el registro de pedidos siguen funcionando aunque no haya ningún punto de impresión configurado.

## Tres áreas de configuración

1. **Puntos de Impresión:** varios destinos por restaurante. Cada punto define nombre, salida manual o automática, transporte/dispositivo y si emite comprobantes electrónicos SUNAT.
2. **Flujos de impresión:** el administrador elige los eventos observados y una o más rutas por evento. Una ruta puede mandar el mismo pedido a cocina, barra, caja u otro punto, con formato y copias propios.
3. **Formatos de ticket:** colección de formatos del restaurante. Un flujo selecciona el formato aplicable para cada punto/ruta. La migración convierte el formato único anterior a `Formato predeterminado`.

Las tablas `printing_points`, `printing_flows`, `printing_flow_routes`, `printing_ticket_templates` y `printing_jobs` implementan la base de datos de esta arquitectura. Los cambios de configuración son de administrador. Los trabajos se crean mediante `enqueue_print_event`; una clave de evento y ruta no se duplica para el mismo `event_id`.

### Opciones de salida

- **Manual:** mostrar una vista lista para imprimir y permitir que la persona use el diálogo/impresora del dispositivo. Falta implementar el renderizador final de formatos y la pantalla de impresión.
- **Automática:** crear trabajos y entregarlos a un agente local o integración compatible. La cola de base de datos existe; faltan el agente, registro/identidad de dispositivos, reclamación/confirmación de trabajos y reintentos operativos.
- **SUNAT:** es una integración de emisión electrónica, separada del transporte de papel. Cuando un punto active SUNAT, sus rutas deberán producir solo comprobantes electrónicos válidos. Las credenciales nunca deben guardarse en `connection_config`/`sunat_config` ni exponerse al navegador; falta elegir proveedor/OSE/PSE, implementar secretos en servidor, emisión, cancelación/notas cuando correspondan y estados de aceptación/rechazo. No se declara emisión SUNAT implementada.

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

Las llamadas antiguas `printTicket(orderId, { paymentJustRegistered: true })` se mantienen temporalmente compatibles y se convierten en `paid_order_created`; una llamada con solo `orderId` se interpreta como `manual_reprint`. La rutina llama `enqueue_print_event` y no sondea un supuesto estado de impresora indefinidamente. En este momento crea trabajos en la cola, pero no afirma que el papel ya se imprimió.

## Impresoras térmicas y conectividad

La primera compatibilidad debe enfocarse en equipos térmicos de 58/80 mm que aceptan **ESC/POS**, pero la compatibilidad debe comprobarse por modelo y firmware: “ESC/POS” no garantiza que todas las marcas implementen cada comando igual. Para impresión automática en red suele usarse una impresora Ethernet/LAN con comandos ESC/POS; USB/Bluetooth requieren un puente local con permisos del sistema operativo. El navegador no ofrece una API universal para imprimir silenciosamente en cualquier impresora.

Una arquitectura segura propuesta es POS web → cola autenticada → agente local enlazado al restaurante/punto → impresora de LAN/USB. No exponer puerto raw de impresora (frecuentemente 9100) a Internet; mantener dispositivos en LAN confiable. Las marcas/modelos mencionados por vendedores locales sirven para una matriz de pruebas, no como estadística nacional de uso.

Referencias técnicas: [guía Epson TM-T20III](https://files.support.epson.com/pdf/pos/bulk/tm-t20iii_trg_en_reva.pdf), [ESC/POS de Epson Perú](https://epson.com.pe/innovative-technologies-point-of-sale), [alerta de seguridad Epson para impresoras de red](https://epson.com.pe/Support/wa00977), [web apps de Apps Script](https://developers.google.com/apps-script/guides/web).

## Estado de implementación

- Implementado: rename de la necesidad y migración compatible; tablas base; RLS; encolado idempotente por ruta; método común `printTicket()`; eliminación del polling infinito de las RPC antiguas no presentes en las migraciones de B&W.
- Pendiente: editores CRUD de las tres áreas en Configuración; diseñador/renderizador de tickets; agente local y ciclo de vida de dispositivo; automatización manual/automática real; proveedor y flujos SUNAT; políticas de retención, cancelación y reintentos; confirmar la lista inicial de eventos.
- `restaurant_receipt_templates` se conserva durante el despliegue como tabla heredada, de solo compatibilidad. Nuevas escrituras deben usar `printing_ticket_templates`.
