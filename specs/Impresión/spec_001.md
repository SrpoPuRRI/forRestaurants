# Sistemas de Impresión

## Necesidad del restaurante

La necesidad opcional se llama **Sistemas de Impresión** en toda interfaz nueva y se persiste como `printing_systems` en `restaurants.needs`. `receipts` y «Comprobantes» solo se conservan como nombres históricos para convertir datos y describir la tabla anterior; no son el nombre visible de la necesidad. La migración `202611130007_printing_systems.sql` convierte los valores antiguos sin borrar las otras necesidades. No añade roles ni espacios de trabajo por sí sola. Efectivo y el registro de pedidos siguen funcionando aunque no haya ningún punto de impresión configurado.

## Tres áreas de configuración

1. **Puntos de Impresión:** varios destinos por restaurante. En la web, el alta solo pide nombre e ID del dispositivo. El ID debe pertenecer ya al restaurante y el dispositivo solo puede enlazarse a un punto. Al abrir un punto se muestran nombre, ID, conexión USB/red, nombre de red e IP cuando correspondan, y estado activo/inactivo calculado a partir del heartbeat de BPrint. Estos datos son informativos y no se editan en la web.
2. **Flujos de impresión:** el administrador elige los eventos observados y una o más rutas por evento. Una ruta puede mandar el mismo pedido a cocina, barra, caja u otro punto, con formato y copias propios.
3. **Formatos de ticket:** colección de formatos del restaurante. Un flujo selecciona el formato aplicable para cada punto/ruta. La migración convierte el formato único anterior a `Formato predeterminado`.

Las tablas `printing_points`, `printing_flows`, `printing_flow_routes`, `printing_ticket_templates` y `printing_jobs` implementan la base de datos de esta arquitectura. Los cambios de configuración son de administrador. Las políticas mantienen acceso por restaurante aunque la necesidad esté desactivada; la necesidad controla visibilidad y ejecución del flujo. Los trabajos se crean mediante `enqueue_print_event`; una clave de evento y ruta no se duplica para el mismo `event_id`.

### Opciones de salida

- **Manual:** la modalidad se configura en el flujo/ruta, no al crear el punto. Falta completar el renderizador de formatos y la vista imprimible del navegador.
- **Automática:** crea trabajos y los entrega a un agente local o integración compatible. La arquitectura WPF de BPrint para múltiples impresoras, presencia por lotes, leases, reclamo y reporte de resultados está implementada; el usuario confirmó que la impresión de prueba está lista. BPrint queda cerrado como arquitectura, con protocolo de publicación pendiente de firma Authenticode mediante Velopack, verificación de paquetes/hashes y confirmación de Edge Function.

La impresión es independiente de SUNAT. Los puntos y flujos no guardan RUC, credenciales PSE/OSE ni configuración fiscal. Un comprobante aceptado puede producir un evento imprimible en uno o varios flujos, igual que cualquier otro evento de la app.

### Emisión de comprobantes electrónicos (SUNAT/PSE)

SUNAT no se implementa en esta etapa. Configuración muestra únicamente una tarjeta **Configuración SUNAT — Próximamente**, separada de **Sistemas de Impresión**. No hay formulario, credenciales, PSE ni emisión todavía. Cuando se implemente, pertenecerá al ciclo de movimientos y no será una propiedad de los puntos o flujos de impresión.

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

- Implementado en el código local: alta de punto con nombre e ID, validación de pertenencia al restaurante en UI y RPC, bloqueo de doble enlace, y vista de solo lectura con metadatos/estado de BPrint. SUNAT aparece como característica **Próximamente**, sin implementación funcional. También existen editores de flujos y formatos, cola idempotente, `printTicket()`, registro seguro de dispositivos, estados y monitor web.
- Requiere las migraciones de impresión 007–011, `202611150001_printing_devices_and_operations.sql` y `202611240001_printing_agent_leases.sql`, además de publicar el frontend. El usuario confirmó que aplicó la migración de leases; el estado remoto no se verificó desde este entorno.
- BPrint para Windows implementa el agente de escritorio multiimpresora y su impresión de prueba está lista, según confirmó el usuario. La arquitectura correspondiente a BPrint se da por completada; queda su protocolo de publicación: firmar con Authenticode mediante Velopack, generar los paquetes firmados, verificar firmas/hashes y confirmar la Edge Function desplegada. El certificado de firma aún no está disponible en el entorno.
- El trabajo pendiente de arquitectura está en Black&White web: completar la vista imprimible manual, validar eventos/reportes y terminar el recorrido web con el agente provisionado. La integración SUNAT/PSE queda aplazada y separada, no bloquea el flujo de puntos.
- `restaurant_receipt_templates` se conserva durante el despliegue como tabla heredada, de solo compatibilidad. Nuevas escrituras deben usar `printing_ticket_templates`.

### Compatibilidad de datos heredados

La tabla aún conserva columnas históricas `sunat_enabled` y `sunat_config`, y los RPC antiguos existen en migraciones pasadas. La interfaz ya no expone esos campos. La migración `202611250001_create_printing_point_from_restaurant_device.sql` revoca el RPC cliente antiguo y ofrece el alta nueva acotada a dispositivos del restaurante. No borrar columnas fiscales heredadas hasta diseñar una migración compatible con despliegues existentes.

### Cambios del 2026-11-25

- La tarjeta de punto abre una ficha informativa; no permite editar, pausar ni activar el punto.
- El alta verifica el UUID exacto en `printing_devices` bajo el restaurante activo y el RPC repite esa validación con bloqueo de fila para evitar carreras y enlaces cruzados.
- El RPC nuevo asigna valores internos compatibles para salida BPrint automática. El usuario no configura modo, transporte ni SUNAT desde el alta.
- Configuración SUNAT solo muestra **Próximamente**. No se ha implementado la emisión ni su arquitectura.
- `cpe_accepted` sigue siendo un evento propuesto; no está conectado a la cola.

## Dispositivos, operación y reportes (revisión 2026-11-25)

La app de escritorio BPrint para Windows existe localmente; esta especificación y
el código WPF distinguen implementación local de despliegue Supabase. BPrint
administra varias colas USB/locales y de LAN desde un equipo del restaurante. No
se instala dentro del firmware de una impresora.

### Selección, identidad y seguridad

- `printing_devices.id` es el UUID que el restaurante enlaza en su punto de
  impresión. `hardware_key` se usa para provisión/reconocimiento local; su
  estabilidad física frente a cambios de equipo/puerto todavía debe probarse.
- Las selecciones de grupo rápido de BPrint son locales; no representan un grupo
  de propiedad cloud.
- BPrint solo envía al batch las impresoras del grupo activo que Windows detecta
  como conectadas/admitidas y que ya tienen dispositivo provisionado.
- La Edge Function `printing-device-provision` valida sesión de administrador y
  usa `service_role` solo en servidor. La app nunca debe recibir esa clave.
- Los tokens y sesión locales se protegen con DPAPI en
  `%LOCALAPPDATA%\BPrint\connection.dat`; el JSON plano de la versión antigua se
  migra y elimina al abrir la versión nueva.

### RPC batch y lease

La nueva migración `202611240001_printing_agent_leases.sql` define el contrato
actual `operate_printing_batch(p_devices, p_results, p_instance_id)`:

- presencia, resultados pendientes y reclamos se envían en una operación batch;
- cada dispositivo tiene lease independiente y la toma se serializa bloqueando
  su fila;
- la misma instancia mantiene el lease; si no hay propietario o `last_seen_at`
  tiene más de 20 segundos, una instancia autorizada puede tomarlo;
- dos instancias concurrentes no pueden ganar a la vez; la anterior recibe
  `ownership_lost` y BPrint deja de incluir esa impresora;
- cada trabajo `taken` registra `claimed_by_instance`; solo esa instancia puede
  informar resultado;
- resultados repetidos con mismo estado son idempotentes; reportar un resultado
  distinto se devuelve como conflicto;
- si vence el lease con un trabajo aún `taken`, se marca fallido como incierto y
  no se reclama de nuevo automáticamente, para prevenir tickets duplicados.

La migración revoca el acceso cliente a `operate_printing_device`, que eludiría
el fencing. Los ejecutables anteriores de BPrint deben actualizarse junto con la
migración. El usuario confirmó que aplicó esta migración en Supabase; no se
verificó el estado remoto desde este entorno.

Cadencias WPF: 10 segundos en reposo y 2 segundos cuando existe trabajo. La web
sondea cada 5 segundos y conserva sus umbrales de inactividad actuales: 7 s con
un trabajo `taken` y 15 s sin trabajos tomados. Si una impresora se desconecta,
BPrint deja de reportarla; si el agente se cierra, dejan de reportarse todos sus
dispositivos.

### Cola y resultados

- `printing_flow_runs` agrupa tareas de un evento; `printing_jobs` guarda el
  dispositivo, payload y snapshot de ruta/formato y usa `published`, `taken`,
  `failed`, `success`.
- El batch reclama como máximo un trabajo publicado por dispositivo en cada
  operación. No vuelve a entregar un trabajo `taken` a la misma instancia; el
  resultado fallido o exitoso se envía en el siguiente batch.
- Si falla la conexión al confirmar, el resultado queda pendiente en memoria y
  se reintenta sin volver a imprimir. Si BPrint se cierra, el lease vence y el
  trabajo se reporta como incierto/fallido. No se garantiza entrega física
  exactamente una vez.
- La web presenta un reporte cuando las tareas del run quedan terminales. Aceptar
  elimina las tareas de esa ejecución y conserva el resumen según el flujo actual.
- La salida manual desde el navegador sigue pendiente; no confundirla con el
  transporte automático BPrint.

## Estado y trabajo pendiente por lado

### BPrint — arquitectura implementada

- La app de escritorio WPF administra varias colas locales USB/LAN, ejecuta la
  impresión de prueba y opera heartbeat, reclamos y resultados en lotes con
  leases por dispositivo.
- El usuario confirmó que la impresión de prueba está lista. No se toma esto como
  certificación de compatibilidad con todos los modelos de impresora.
- La migración de leases fue reportada como aplicada por el usuario.
- Protocolo de publicación pendiente: firmar ejecutables y paquetes con
  Authenticode a través de Velopack, generar paquetes firmados, verificar
  firmas/hashes y confirmar el despliegue de `printing-device-provision`.

### Black&White web — arquitectura por completar

- Completar y revisar en la app web rutas, dispositivos, modo manual/automático
  por ruta y formatos. El alta y la consulta de puntos ya siguen el contrato
  nombre+ID y ficha de solo lectura.
- Completar la salida manual desde el navegador: renderizar el formato elegido y
  abrir/imprimir la vista adecuada desde el dispositivo.
- Verificar de extremo a extremo la emisión ya implementada de eventos de
  negocio a `enqueue_print_event`, los snapshots de evento/ruta/formato y la
  experiencia del reporte de un flujo.
- Mantener las columnas históricas `printing_points.sunat_enabled` y
  `sunat_config` fuera del flujo web activo; su retiro de base se decidirá con
  una migración compatible posterior.
- Confirmar que la Edge Function `printing-device-provision` y sus permisos
  estén desplegados en el proyecto destino y probar el contrato web–BPrint.

La cola y la RPC de la base ya están descritas e implementadas en migraciones;
el trabajo arquitectónico restante para completar el flujo recae en la app web.
