# Sistemas de Impresión

## Necesidad del restaurante

La necesidad opcional se llama **Sistemas de Impresión** en toda interfaz nueva y se persiste como `printing_systems` en `restaurants.needs`. `receipts` y «Comprobantes» solo se conservan como nombres históricos para convertir datos y describir la tabla anterior; no son el nombre visible de la necesidad. La migración `202611130007_printing_systems.sql` convierte los valores antiguos sin borrar las otras necesidades. No añade roles ni espacios de trabajo por sí sola. Efectivo y el registro de pedidos siguen funcionando aunque no haya ningún punto de impresión configurado.

## Tres áreas de configuración

1. **Puntos de Impresión:** varios destinos por restaurante. En la web, el alta solo pide nombre e ID del dispositivo. El ID debe pertenecer ya al restaurante y el dispositivo solo puede enlazarse a un punto. Al abrir un punto se muestran nombre, ID, conexión USB/red, nombre de red e IP cuando correspondan, y estado activo/inactivo calculado a partir del heartbeat de BPrint. Si la fila del dispositivo se elimina, el punto conserva ese UUID y muestra **Deprecated**; su ficha permite enlazar otro dispositivo registrado sin perder las rutas.
2. **Flujos de impresión:** el administrador define eventos observados y, para cada evento, una impresora y una secuencia de tareas de impresión.
3. **Formatos de ticket:** colección de formatos del restaurante. Un flujo selecciona el formato aplicable para cada punto/ruta. La migración convierte el formato único anterior a `Formato predeterminado`.

Las tablas `printing_points`, `printing_flows`, `printing_flow_routes`, `printing_ticket_templates` y `printing_jobs` implementan la base de datos de esta arquitectura. Los cambios de configuración son de administrador. Las políticas mantienen acceso por restaurante aunque la necesidad esté desactivada; la necesidad controla visibilidad y ejecución del flujo. Los trabajos se crean mediante `enqueue_print_event`; una clave de evento y ruta no se duplica para el mismo `event_id`.

## Editor visual y motor único de flujos

Las imágenes de referencia del lienzo están en `Diseño Editor Flujos/1.png` a
`Diseño Editor Flujos/6.png`.

### Modelo del flujo configurado

- El administrador configura un flujo visual en un lienzo, le asigna nombre y
  guarda la definición para reutilizarla. El lienzo muestra una cadena lineal de
  nodos principales; no se admiten ramas paralelas.
- La cadena principal contiene los nodos de evento que el flujo escucha. Cada
  nodo `eventListener` representa un evento que, cuando sucede, inicia una
  ejecución de impresión.
- A cada `eventListener` se conecta exactamente un nodo de impresora/punto de
  impresión. Esa impresora recibe las tareas del evento; un evento no se divide
  entre varias impresoras.
- Después del punto se configura una secuencia ordenada de tareas. Cada tarea
  identifica el objeto/datos que se representarán, el formato de ticket, la
  información que se mostrará y el número de copias. Puede haber varias tareas
  bajo el mismo evento y la misma impresora. Se completan en orden: por ejemplo,
  una tarea de 3 comandas seguida por otra de 2 boletas produce 5 copias con sus
  respectivos formatos.
- El orden es semántico: se imprime primero la tarea anterior en la lista y
  después la siguiente. La estructura no debe interpretarse como un grafo que
  permite ejecución simultánea.
- El editor muestra esa estructura en un lienzo visual cuadriculado con nodos
  conectados: evento, impresora y tareas secuenciales. Los nodos son circulares
  y muestran iconos; el lienzo se puede desplazar arrastrándolo, ampliar,
  reducir y ajustar. Los eventos forman la cadena horizontal; debajo de cada
  evento se conectan su impresora y sus tareas en una rama vertical. Los
  grupos se pueden mover sobre el lienzo sin cambiar el orden lógico de eventos,
  y las conexiones se actualizan mientras se mueven.
- «Crear flujo» abre el editor con el botón **Crear**. Para crear un nodo hay
  que escoger primero un evento, un punto de impresión, la salida y su primera
  tarea completa (objeto de datos, formato y copias). No se deduce ninguna de
  esas elecciones. Los objetos disponibles dependen del evento; por ejemplo,
  `open_order_created` solo ofrece `open_order`, mientras `paid_order_created`
  ofrece `paid_order` y, cuando el pago procede de una orden abierta,
  `open_order`.
- Después de crear un nodo, se puede editar o eliminar. Editarlo permite dejar
  campos o tareas incompletos; esos nodos se conservan en `printing_flows.editor_nodes`,
  aparecen atenuados como inactivos y no generan rutas ni trabajos. El botón
  **Crear** o **Guardar** del flujo solo está habilitado cuando existe al menos
  un nodo completamente configurado. En un flujo existente, **Guardar** también
  requiere cambios pendientes.
- Al guardar, la cadena visual completa, incluidos borradores incompletos, se
  persiste aparte de las rutas ejecutables. Solo los nodos completos se
  registran en `captured_events` y `printing_flow_routes`. El payload contiene
  el objeto elegido con ese nombre; si un evento no entrega un objeto opcional
  seleccionado, su tarea termina como fallida con un mensaje explícito.
- El editor principal no muestra un checkbox de estado. «Editar lista» aparece
  en la ficha de acciones después de seleccionar un nodo. Abre la administración
  del flujo: ahí se cambia entre activo y pausado, se elimina el flujo y se
  reordena la lista global de cuentas motor/respaldo. Cambiar esa lista desde
  cualquier flujo la cambia para todo el restaurante.
- Reordenar y guardar la lista global actualiza el orden compartido por todos
  los flujos. Desde el mismo editor se puede activar/desactivar o eliminar el
  flujo actual. Los puntos `Deprecated` se muestran con aviso rojo para retirar
  o reemplazar ese destino dentro del flujo antes de volver a activarlo.

### Elección de la cuenta que ejecuta el algoritmo

Black&White necesita un único motor algorítmico por ejecución de flujo para
evitar que varias sesiones creen las mismas tareas de impresión. El motor es
una cuenta empleada del restaurante cuya sesión está activa. El restaurante
guarda una sola lista global de cuentas motor y respaldo en
`printing_flow_engine_accounts`. La lista se puede editar desde el editor de
cualquier flujo; al guardar, el mismo orden pasa a todos los flujos. El motor de
cada flujo recorre esa lista compartida y elige la siguiente cuenta si la actual
deja de poder escuchar o procesar.
La antigua columna `printing_flows.engine_account_order` queda únicamente como
espejo sincronizado para compatibilidad con el runtime ya desplegado; no se lee
ni se edita como configuración independiente de cada flujo.

Una cuenta puede ser motor de varias ejecuciones distintas del mismo flujo. La
identidad de una ejecución se determina por el flujo, el evento y los
identificadores de los objetos de negocio que originaron ese evento. Si ya hay
una ejecución activa con los mismos identificadores, se reconoce como duplicada
y no se vuelve a procesar. Si el mismo flujo recibe otro movimiento/pedido, crea
otra ejecución independiente y la agrega a la cola.

El objetivo es persistir el evento y su ejecución pendiente en la misma
transacción que confirma el movimiento que los originó. La implementación actual
crea una ejecución durable en `enqueue_print_event`, inmediatamente después de la
RPC comercial; esa parte ya no depende de que el motor esté abierto, aunque aún
existe una ventana entre la operación comercial y el alta del evento que debe
cerrarse en una etapa posterior.

### Cola y estados de ejecución

Cada restaurante tiene una fila de estado por flujo en `printing_flow_runtime`.
Esa fila identifica la cuenta motor actual y su lease; `printing_flow_runs`
conserva por separado varias ejecuciones simultáneas del mismo flujo para
movimientos distintos. Una cuenta puede procesar varias ejecuciones del flujo;
cada ejecución conserva su propio ID, evento, snapshot, estado de materialización
y cuenta que la publicó.

Los estados acordados son. `inactivo` describe el estado de configuración del
flujo; los demás describen el estado de una ejecución en la cola:

- `inactivo`: el flujo fue desactivado por el administrador; no se asigna ni
  escucha eventos.
- `noRunning{cuenta}`: la cuenta indicada es el motor asignado y escucha los
  eventos configurados; en ese momento no está procesando una ejecución.
- `searching{cuenta}`: se solicita asistencia a la cuenta indicada, por ejemplo
  porque el motor actual dejó de responder. Todas las cuentas leen el estado,
  pero solo la cuenta nombrada debe responder y reclamarlo si su sesión sigue
  activa. La respuesta cambia el estado a `noRunning{cuenta}` si queda asignada
  para escuchar, o a `Running{cuenta}` si toma una ejecución pendiente.
- `Running{cuenta}`: la cuenta indicada está procesando una ejecución concreta
  del flujo y generando sus tareas de impresión.

El estado `printing_flow_runtime` es por flujo y la lista global ordenada de
cuentas define el siguiente destino de `searching{cuenta}` para todos. Las ejecuciones del flujo
son independientes entre sí, aunque las coordine la misma cuenta motor. Las
demás sesiones no deben apropiarse de una solicitud dirigida a otra cuenta.

### Operaciones de base de datos y carga

Cuando una operación de base de datos crea/reconoce un evento, asigna o
transfiere un motor, cambia el avance de una ejecución o publica tareas, esa
misma operación debe actualizar también los estados correspondientes de la
cola de flujos del restaurante. Se realizará en una única operación atómica de
base de datos (RPC/transacción), en vez de emitir otra escritura o un sondeo
separado solo para recalcular estados. Esto reduce operaciones y trabajo
repetido del procesador, y evita que el estado de la cola quede desincronizado
de los eventos y trabajos que representa.

La lectura persistente de la cola por las sesiones web tampoco tendrá su propio
temporizador ni una consulta independiente. El POS ya ejecuta
`operate_printing_web_runtime()` desde `printing-runtime.js` cada 5 segundos.
Esta llamada combina el heartbeat de dispositivos, presencia de la cuenta,
estado del motor, cola de ejecuciones, tareas publicadas/tomadas y reportes.
No hay un temporizador aparte para el editor o el motor.

El motor único amplía esa misma operación para que lea los estados relevantes
para la sesión/cuenta actual, registre su presencia, atienda únicamente una
solicitud `searching{esaCuenta}` dirigida a ella y devuelva las ejecuciones que
esa cuenta debe procesar o los reportes que debe mostrar. El navegador publica
los runs devueltos llamando a `publish_printing_flow_run`, que los reclama y
materializa de forma idempotente. No se añade otro `setInterval` ni RPC
periódico para mirar la cola.

El sondeo web conserva su cadencia actual de 5 segundos y se ejecuta solo
mientras la sesión POS está activa y la necesidad de impresión está habilitada.
La respuesta se limita al restaurante y a la cuenta autenticados; cada ejecución
se reclama de forma atómica e idempotente para impedir que dos pestañas o
cuentas publiquen los mismos trabajos. Las operaciones que originan eventos y
las operaciones del motor actualizan la cola en la transacción que ya realizan,
así la lectura periódica sirve para coordinar/reanudar y no para reconstruir o
recalcular toda la cola en cada vuelta.

Esta llamada web no sustituye la reconciliación de Supabase: cuando no hay
ninguna sesión POS activa no existe cliente que pueda hacer el sondeo de 5
segundos. Cron sigue siendo responsable de expirar leases y avanzar una sola
pasada de búsqueda; la siguiente llamada combinada de la sesión web despierta y
procesa el trabajo cuando una cuenta vuelva a estar activa. El heartbeat de
BPrint es distinto: reporta dispositivos y atiende trabajos de impresión ya
publicados, pero no ejecuta ni coordina el algoritmo de flujos del POS.

El cierre de todas las sesiones no puede ser detectado por otra app web. Supabase
debe reconciliar esos estados mediante un proceso programado en la propia base
(Supabase Cron/`pg_cron`) que revise heartbeats/leases vencidos y actualice las
entradas de cola en la misma transacción de reconciliación. No se espera una
notificación instantánea al cerrar la ventana: el cambio sucede cuando vence el
lease del motor y corre la siguiente reconciliación.

- Si un motor `Running{cuenta}` o `noRunning{cuenta}` deja de reportar heartbeat,
  la reconciliación expira su lease y pasa la ejecución a `searching{cuenta}`
  para solicitar el siguiente respaldo de la lista.
- Si se recorren las cuentas y ninguna tiene una sesión activa, la ejecución se
  conserva pendiente en estado `waitingForAccount`. No se cancela ni se publica
  como completada. `searching` recorre la lista de
  respaldo completa una sola vez por ciclo; cada cuenta se solicita como máximo
  una vez en esa pasada. Si nadie responde, no se vuelve a iniciar otra pasada
  solo porque corra Cron.
- Una nueva pasada solo se habilita cuando Supabase detecta que una cuenta del
  restaurante inició sesión y pasó a estar activa. La operación que registra
  esa presencia despierta los flujos `waitingForAccount` y comienza
  un solo ciclo nuevo de búsqueda, respetando el orden configurado. Debe ser
  idempotente si llegan varias señales de presencia de la misma sesión.
- La reconciliación es idempotente, procesa solo leases vencidos y
  serializa la transferencia del motor para evitar ciclos de búsqueda
  repetidos sin inicios de sesión y que dos cuentas reclamen la misma ejecución.
  Cron se programa cada minuto cuando `pg_cron` está disponible; el lease del
  motor es de 15 segundos y es independiente del lease de 20 segundos de BPrint.
- Cron solo mantiene la cola y sus estados. No sustituye la sesión web que
  ejecuta el algoritmo del flujo, construye los trabajos y los publica en la
  cola de impresión. Si no queda ninguna sesión activa, la impresión nueva
  espera; BPrint aún puede terminar trabajos que ya estaban publicados.

La reconciliación se agenda cada minuto si la extensión `pg_cron` está instalada.
En el proyecto de producción debe confirmarse que ese job quedó creado; la
función se puede invocar desde Supabase Cron si la extensión no estaba habilitada
al aplicar la migración. Consulte la [documentación oficial de Supabase Cron](https://supabase.com/docs/guides/cron).

### Implementación actual del editor y el motor

- El editor visual guarda una lista ordenada de eventos; cada evento tiene un
  solo punto de impresión y una lista ordenada de tareas con objeto de datos,
  formato y copias. Se guardan el estado del flujo y la lista global compartida
  de cuentas motor/respaldo. Cambiar esa lista desde cualquier editor actualiza
  todos los flujos. Los eventos y tareas se pueden reordenar y eliminar.
- `save_printing_flow_editor` valida la lista global de cuentas activas,
  eventos, puntos, formatos, modos de salida, tareas y la regla de un único
  punto por evento. Guarda la lista global y sincroniza su representación de
  compatibilidad para todos los flujos dentro de la misma transacción. Los
  formatos y objetos se validan en servidor, además de la validación visual.
- `enqueue_print_event` guarda primero una ejecución durable en
  `printing_flow_runs`, con payload del evento y snapshot de las rutas/tareas.
  La inserción es idempotente por `(flow_id,event_id)`. Los IDs de pedidos,
  revisiones y entradas de cola producen claves estables cuando representan un
  evento de negocio repetible; reimpresión manual conserva un ID nuevo.
  La ejecución y su snapshot se escriben atómicamente dentro de esta RPC. Hoy
  el POS la invoca después de completar la RPC del movimiento/pedido; el evento
  aún no comparte la misma transacción que la operación de negocio original.
- La cuenta elegida como motor recoge solo las ejecuciones de su flujo y llama
  `publish_printing_flow_run`. Esta operación bloquea la fila de ejecución,
  materializa todas sus tareas en orden y marca el run como materializado dentro
  de una transacción. Dos pestañas o cuentas no publican dos veces la misma
  tarea. El snapshot conserva formato, copias, destino y objeto aunque luego se
  edite la ruta.
- El trigger aplica el selector de objeto y el orden guardados en el snapshot.
  Las tareas de un run comparten timestamp y `operate_printing_batch` las
  reclama en `task_order`, de modo que un punto procesa primero una tarea y
  luego la siguiente.
- La emisión del evento actualiza `printing_flow_runtime` en la misma operación
  cuando ya hay un motor con lease vigente. La publicación de tareas actualiza
  el estado en esa transacción; un trigger de sentencia mantiene el estado al
  cambiar las impresoras cada trabajo. La sesión web recibe una única llamada
  cada cinco segundos y, si es el motor, materializa la lista de runs que le
  corresponde.
- Los runs no materializados cuentan como trabajo pendiente: no se puede
  eliminar el flujo mientras existan. Pausar un flujo impide eventos nuevos y
  asignaciones nuevas, pero no invalida un evento que ya fue capturado; su
  snapshot puede completarse cuando vuelva una sesión motor.
- Los eventos de pago y reimpresión cargan pedido, productos, complementos y
  sede desde las tablas. Los eventos de pedido abierto usan el snapshot guardado
  por `create_open_order`/`update_open_order`; los eventos de cocina/salón
  conservan el objeto de cola, la entrada de origen y los productos que ya
  acompañan esos eventos.
- La modalidad automática crea tareas para BPrint. La vista de impresión
  manual del navegador sigue pendiente; mientras no se implemente, las rutas
  manuales fallan con un estado explícito en el reporte y no se presentan como
  impresas.

### Opciones de salida

- **Manual:** la modalidad se configura en el flujo/ruta, no al crear el punto. Falta completar el renderizador de formatos y la vista imprimible del navegador.
- **Automática:** crea trabajos y los entrega a un agente local o integración compatible. La arquitectura WPF de BPrint para múltiples impresoras, presencia por lotes, leases, reclamo y reporte de resultados está implementada; el usuario confirmó que la impresión de prueba está lista. BPrint queda cerrado como arquitectura, con protocolo de publicación pendiente de firma Authenticode mediante Velopack, verificación de paquetes/hashes y confirmación de Edge Function.

La impresión es un módulo desacoplado de SUNAT. Los puntos, formatos, flujos y la cola no guardan RUC, credenciales PSE/OSE ni configuración fiscal. El módulo SUNAT/PSE del POS es responsable de construir el comprobante, verificar su validez y autenticidad, y decidir si se acepta o rechaza antes de emitir el evento de negocio correspondiente.

El contrato es unidireccional: una vez que un evento de impresión recibe un QR, valor resumen o contenido marcado por el POS como aprobado, el subsistema de impresión lo representa e imprime tal como fue recibido. No vuelve a consultar SUNAT/PSE, no inspecciona criptográficamente el QR ni cuestiona el estado fiscal recibido. BPrint solo valida que el JSON tenga estructura, valores de representación y geometría imprimibles; esa validación técnica no afirma ni comprueba legalidad tributaria. Tampoco se bloquea la creación de un QR o de su formato por no haber configurado SUNAT.

### Emisión de comprobantes electrónicos (SUNAT/PSE)

SUNAT no se implementa en esta etapa. Configuración muestra únicamente una tarjeta **Configuración SUNAT — Próximamente**, separada de **Sistemas de Impresión**. No hay formulario, credenciales, PSE ni emisión todavía. Cuando se implemente, pertenecerá al ciclo de movimientos y no será una propiedad de los puntos o flujos de impresión.

- El restaurante configura y autoriza un PSE (o, en una etapa futura, otra modalidad SEE compatible). La integración transmite la solicitud de emisión y recibe el resultado; el estado del documento y su referencia quedan asociados al movimiento que lo originó.
- Los movimientos deben distinguir al menos `not_sent`, `sent`, `accepted` y `rejected`, junto con identificadores, timestamps, respuesta/constancia y documento electrónico necesarios para trazabilidad. El rechazo no convierte la impresión en fallida: es un resultado tributario del movimiento y debe informarse al usuario.
- El evento de negocio de aceptación —por ejemplo `cpe_accepted`— lo emite el módulo fiscal solo después de obtener la aceptación; puede configurarse en **Flujos de impresión** para producir una representación impresa. Rechazo puede generar notificación/estado visible; no se emite como evento de comprobante aceptado. La responsabilidad de esta decisión está en el módulo fiscal, no en BPrint.
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
- El trabajo pendiente de Black&White web es completar la vista imprimible manual y validar el recorrido integrado de eventos/reportes con el agente provisionado. La integración SUNAT/PSE queda aplazada y separada, no bloquea el flujo automático.
- `restaurant_receipt_templates` se conserva durante el despliegue como tabla heredada, de solo compatibilidad. Nuevas escrituras deben usar `printing_ticket_templates`.

### Compatibilidad de datos heredados

La tabla aún conserva columnas históricas `sunat_enabled` y `sunat_config`, y los RPC antiguos existen en migraciones pasadas. La interfaz ya no expone esos campos. La migración `202611250001_create_printing_point_from_restaurant_device.sql` revoca el RPC cliente antiguo y ofrece el alta nueva acotada a dispositivos del restaurante. No borrar columnas fiscales heredadas hasta diseñar una migración compatible con despliegues existentes.

### Cambios del 2026-11-25

- La tarjeta de punto abre una ficha informativa; no permite editar, pausar ni activar el punto.
- El alta verifica el UUID exacto en `printing_devices` bajo el restaurante activo y el RPC repite esa validación con bloqueo de fila para evitar carreras y enlaces cruzados.
- Cuando Setter elimina un dispositivo inactivo, los puntos conservan el UUID anterior y los flujos que los usan se guardan inactivos. POS muestra el punto como **Deprecated** y el flujo como **Necesita actualizarse**; no permite reactivar o guardar activo ese flujo hasta sustituir/eliminar sus destinos. Al reemplazar la impresora del punto, las rutas y formatos se conservan y el admin puede reactivar el flujo.
- `printing_points.device_id` ya no tiene una clave foránea hacia `printing_devices`: se conserva como referencia para reconocer una impresora eliminada. El alta y el RPC `replace_printing_point_device` verifican que el dispositivo exista y pertenezca al mismo restaurante; un índice único sigue impidiendo enlazarlo a más de un punto.
- POS consulta puntos y dispositivos por separado y los relaciona por UUID; no depende de una unión PostgREST respaldada por la clave foránea retirada.
- `printing_devices.network_name` representa la red donde la propia ticketera está configurada para operar (por ejemplo, el SSID configurado en la ticketera o en su utilidad oficial). BPrint debe leer el valor de la ticketera o del software del fabricante y publicarlo; no debe usar el perfil de Windows del PC ni inferirlo mediante rutas/IP. Si aún no hay una fuente compatible, deja el valor sin informar. El simulador puede publicar `Red de ejemplo (simulada)`, claramente marcado como ilustrativo. `connection_type` conserva por separado `Red` o `USB`; nunca pongas `LAN` en `network_name`.
- El RPC nuevo asigna valores internos compatibles para salida BPrint automática. El usuario no configura modo, transporte ni SUNAT desde el alta.
- Configuración SUNAT solo muestra **Próximamente**. No se ha implementado la emisión ni su arquitectura.
- `cpe_accepted` sigue siendo un evento propuesto; no está conectado a la cola.

## Editor completo de formatos de ticket — especificación pendiente de implementar

### Aclaración del comportamiento actual

La interfaz web guarda nombre, ancho de papel, encabezado, pie y opciones de
visibilidad en `printing_ticket_templates.format` (JSONB): sede, empleado,
nota, desglose de pago, mesa cuando Salón está activo, fecha/hora y RUC de
referencia. El JSON se incluye como snapshot en cada tarea de impresión.
El JSON no es un estándar de impresión. BPrint carga el snapshot de la tarea y
su `TicketRenderer` actualmente decide valores fijos: ancho aproximado de
caracteres, título BLACK&WHITE POS, orden de bloques, alimentación y corte. El
usuario aclaró que esos valores no deben quedar implícitos en BPrint: el editor
web debe tener valores predeterminados definidos y guardar esos valores de
forma explícita dentro del JSON. BPrint debe interpretar la configuración y
traducirla a comandos para el dispositivo, sin escoger el diseño por su cuenta.

### Lista de formatos

- Quitar las etiquetas «Activo» y los botones «Editar» y «Pausar».
- Cada tarjeta es interactiva; al pulsarla abre el editor del formato.
- Si el formato está referenciado por al menos una ruta de impresión, mostrar
  «Enlazado». Si no se usa, no hace falta mostrar una etiqueta de estado.
- El formato se elimina, no se pausa. La acción de eliminación va en el editor;
  los botones al pie aparecen en este orden: **Cancelar**, **Eliminar**,
  **Guardar**.
- El editor presenta a la izquierda un panel de configuración con scroll y a la
  derecha una vista previa del ticket. La vista previa incluye un botón «+»
  para insertar imagen, QR o valor resumen.
- «Guardar» comienza desactivado y solo se activa cuando el estado del formato
  cambia respecto al momento de apertura. Si se revierten todos los cambios,
  vuelve a quedar desactivado.
- La vista previa se actualiza mientras se editan encabezado, pie, ancho,
  márgenes, altura mínima, tipografía, tamaño y espaciado de texto, densidad,
  profundidad, avances y opciones de contenido. El modo de corte no requiere
  una representación visual.
- `layout.line_spacing` controla el interlineado del texto y de los espacios
  entre bloques vacíos: `compact` (1.1), `normal` (1.35) o `wide` (1.75). No
  cambia márgenes ni el avance físico del papel.
- **Ajuste de secciones** es un panel colapsable. Solo enumera secciones activas;
  permite reordenarlas con drag and drop (y controles accesibles de subir/bajar)
  y configura de cero a cinco saltos de línea después de cada sección. Los saltos
  son líneas vacías cuyo alto sigue `layout.line_spacing`.
- Las secciones disponibles son identidad de la app, encabezado, título del
  evento, sede, fecha y hora, empleado, mesa, estado, RUC de referencia, nota,
  desglose del pedido, desglose de pago, total y pie. Encabezado y pie solo están
  activos si contienen texto; las opciones de contenido dependen de sus switches
  (mesa requiere Salón). Total y desglose de pago también se pueden ordenar.
- Identidad de la app y título del pedido son opcionales mediante switches del
  panel. Al desactivarlos desaparecen de la lista y del JSON de secciones; el
  resto del formato y el desglose de productos continúan disponibles.
- El desglose del pedido permite configurar por separado de cero a cinco saltos
  entre cada producto. Cada grupo de producto incluye sus variantes y añadidos;
  los saltos se aplican entre grupos, no entre las líneas internas de un grupo.
- El contrato JSON v3 guarda `layout.section_order` (secciones activas en orden),
  `layout.section_breaks` (saltos después de cada sección),
  `layout.item_line_breaks`, `body.show_status` y `body.show_total`. BPrint debe
  renderizar esas secciones en ese orden, emitir saltos explícitos y conservar
  compatibilidad con snapshots v1/v2 usando su orden histórico.

### Editor y objetos visuales

El editor conserva los controles básicos actuales: nombre, ancho del papel,
encabezado, pie y opciones para mostrar sede, empleado, nota y desglose de pago.
Si la necesidad Salón está activa, también permite mostrar la mesa. Puede
mostrar la fecha y hora del evento en formato `dd/mm/yyyy hh:mm:ss`, sin
fracciones de segundo y expresada en hora de Lima. Para pedidos pagados usa
`order.paid_at`; para los demás eventos usa `payload.occurred_at`. La web
preserva `table_label` al pagar un pedido de mesa, y BPrint solo la imprime
cuando `body.show_table` es verdadero. Puede mostrar un RUC de referencia mientras la
configuración SUNAT aún no esté disponible; el valor de prueba es
`00000000000 (PRUEBA)`, nunca se presenta como dato fiscal validado. Cuando
SUNAT esté implementado, el renderizador usará el RUC que entregue esa
configuración fiscal.
Debajo incluye un desplegable **Mostrar opciones avanzadas**. Cada control
avanzado explica cómo dejar el valor vacío para aceptar el valor predeterminado;
las listas presentan también la opción explícita «… (por defecto)».

Al guardar, la web normaliza el documento y materializa en el JSON un valor para
cada propiedad, incluyendo los valores predeterminados. No se deja la decisión
visual a inferencias de BPrint. El nombre del formato y el contenido dinámico
del evento siguen siendo datos separados del diseño.

La vista previa funciona como un canvas con elementos redimensionables. Los
objetos no se arrastran directamente: solo se desplazan al añadir y ajustar sus
márgenes. Los nuevos objetos empiezan en la esquina superior izquierda.

- **Imagen:** al agregarla se abre un selector propio con arrastrar/soltar,
  exploración de archivos, Cancelar, Aceptar, resolución recomendada y límite
  de peso visibles. Se admite una imagen por acción; el formato conserva una
  referencia al recurso almacenado.
- **QR:** elemento gráfico que BPrint renderiza con el contenido entregado por
  el evento. Su configuración de tamaño y posición pertenece al formato. BPrint
  no determina si el contenido del QR es fiscalmente legítimo.
- **Valor resumen:** elemento gráfico del comprobante electrónico, distinto del
  QR, que el módulo fiscal genera y entrega; impresión conserva y representa el
  valor recibido sin volver a validarlo.
- **Márgenes:** elementos de espacio del canvas, redimensionables. Cada margen
  se ancla a su objeto y se redimensiona en un solo eje. Permite desplazar el
  objeto sobre ese eje; sin margen lateral no se puede mover horizontalmente y
  sin margen superior/inferior no se puede mover verticalmente. Se dibujan con
  borde punteado transparente, sin relleno ni texto. Cada objeto admite como
  máximo un margen por lado y los márgenes solo ofrecen eliminar en su menú.
  Un `MutationObserver` observa los cambios de tamaño o posición del objeto y
  ajusta sus dimensiones dependientes en el mismo ciclo de renderizado.
  Los objetos no se arrastran directamente: se posicionan ajustando sus
  márgenes. Un objeto recién insertado empieza en la esquina superior izquierda.
- Al hacer clic en un objeto se selecciona y se puede mover o redimensionar.
  En escritorio, doble clic abre sus opciones; en táctil, mantener presionado
  abre el menú. Las opciones de un objeto son eliminar, agregar margen arriba,
  izquierda, derecha o abajo, y centrar. Los lados con margen existente no se
  ofrecen de nuevo. Centrar ajusta los márgenes laterales existentes y crea
  solo los que falten.

### Contrato de formato JSON

Se mantiene `printing_ticket_templates.format` como JSONB; la estructura es un
contrato propio, versionado para Black&White y BPrint, no un estándar que la
impresora lea directamente. El esquema futuro debe representar como mínimo:

- versión de esquema y ancho de papel;
- orden explícito de bloques, dimensiones y posición/tamaño en unidades
  definidas (preferentemente mm en el JSON, convertidas por BPrint a puntos del
  dispositivo);
- márgenes, espaciado/avance, altura mínima si se requiere, y corte/alimentación
  final;
- tipografía admitida, escala/tamaño, alineación, negrita y profundidad de
  texto;
- densidad/calidad cuando el dispositivo la soporte;
- imágenes como referencias a archivos, con ancho, alineación y tratamiento de
  rasterización;
- QR y valor resumen como elementos dinámicos con tamaño y ubicación;
- todas las propiedades con un valor final explícito, tanto las elegidas por
  el usuario como los defaults materializados por la web.

Las opciones que un dispositivo no soporte deben detectarse mediante el perfil
de capacidades/modelo y reportarse claramente; no se deben sustituir en
silencio por decisiones inventadas por BPrint. La conversión de mm a puntos y
de una imagen vectorial a raster/ESC/POS es traducción del formato al hardware,
no elección de diseño.

### Contrato con la cola y BPrint

Crear o editar un formato solo escribe la fila de plantilla; no crea una tarea.
La tarea sigue naciendo cuando un evento coincide con un flujo. La fila de
`printing_jobs` combina el payload del evento con un snapshot del formato y de
la ruta. BPrint interpreta ese JSON completo, obtiene las imágenes referenciadas,
compone el ticket en bitmap monocromo y lo envía a la cola Windows de la impresora.
La interpretación fiscal del payload ocurrió antes, en el módulo fiscal del POS.
La app no guarda plantillas en los archivos locales de BPrint: cada tarea trae
su snapshot de formato. El selector de impresión de prueba puede consultar
formatos de Supabase para generar una prueba, pero no los persiste localmente.

En la etapa de prueba, QR y valor resumen son **objetos gráficos de referencia**:
el canvas permite agregarlos, moverlos y dimensionarlos sin datos tributarios
reales ni SUNAT configurado. Al implementar SUNAT, el módulo fiscal entregará el
contenido aprobado a los eventos; esos mismos tipos de elemento lo representarán
sin validar ni alterar su significado fiscal. No se debe bloquear ahora su
inserción por falta de configuración SUNAT.

### Pendientes de datos, base e infraestructura

- **No hace falta una tabla nueva para las propiedades del diseño:** `format`
  ya es JSONB abierto. Sí se debe acordar y validar su esquema/versiones en
  aplicación y BPrint; hoy la base solo exige que sea un objeto JSON.
- **Eliminar formatos:** `printing_flow_routes.template_id` y
  `printing_jobs.template_id` tienen FK `ON DELETE RESTRICT`. La migración nueva
  permite borrar solo si no está enlazado a una ruta con eventos (aunque el flujo
  esté pausado); libera referencias de rutas retiradas y de jobs históricos,
  manteniendo el snapshot de impresión. El estado `is_active` heredado ya no se
  muestra en la interfaz y no condiciona la selección en flujos.
- La migración `202611250002_ticket_canvas_assets_and_template_delete.sql`
  crea el bucket privado `ticket-assets`, agrega borrado administrativo que
  rechaza formatos enlazados a rutas activas, libera referencias de rutas ya
  retiradas y de jobs históricos manteniendo su snapshot, y deja de exigir el
  flag `is_active` para guardar rutas. La fila y su JSON desaparecen al borrar;
  las referencias de imagen históricas se conservan para no romper trabajos ya
  encolados.
- **Imágenes:** el editor convierte PNG/JPG/WebP/SVG a PNG, limita el archivo
  original a 5 MB y lo guarda en el bucket privado `ticket-assets`, bajo la ruta
  del restaurante y formato. La política permite leer dentro del restaurante y
  solo al admin cargar o eliminar. El JSON guarda una ruta estable, no una URL
  firmada. Al guardar una edición, los recursos que dejaron de estar incluidos
  en el formato se eliminan del bucket y sus referencias salen del JSON.
- **Cola:** definir cómo el payload conserva los datos de CPE necesarios y el
  `DigestValue` correspondiente para generar QR/valor resumen de forma estable.
  Hoy SUNAT no está implementada y `cpe_accepted` no está conectado.
- **BPrint:** ampliar el renderer para márgenes, bloques, texto enriquecido,
  alimentación/corte explícitos, QR y gráficos rasterizados; dejar de fijar por
  código el título y las decisiones visuales. Definir perfiles de capacidades
  y comprobarlos con impresoras/emuladores ESC/POS.
- La versión web implementa canvas visual, redimensionamiento/movimiento,
  márgenes, elemento QR y valor resumen de prueba, carga de imagen convertida a
  PNG en Storage privado, guardado JSON v2 y borrado protegido. La impresión
  física de esos elementos avanzados requiere completar la traducción en BPrint;
  el renderer actual todavía no consume todo el esquema v2.
- **Defaults v2 iniciales:** ancho 80 mm; márgenes 0 mm; altura mínima 0 mm;
  tipografía nativa del dispositivo, 12 pt, espaciado normal, densidad normal,
  profundidad estándar, avance inicial 0 mm, avance final 3 mm y corte parcial.
  La web los guarda explícitamente en el JSON cuando el campo numérico se deja
  vacío o se elige la opción predeterminada.
- Por ahora el QR es un patrón gráfico ficticio y el valor resumen es texto
  ficticio de referencia; ninguno codifica datos tributarios. SUNAT proveerá
  contenido real solo cuando se implemente esa configuración.

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

### Black&White web — estado actual

- El alta y la consulta de puntos siguen el contrato nombre+ID y ficha de solo
  lectura. El editor visual de flujos persiste borradores de nodos separados de
  sus rutas ejecutables; requiere la migración `202611270011` además del motor
  implementado en las migraciones `202611270005` a `202611270010`.
- Falta completar la salida manual desde el navegador: renderizar el formato
  elegido y abrir/imprimir la vista adecuada desde el dispositivo.
- En una etapa posterior, mover la captura de cada evento dentro de la misma
  RPC que confirma el pedido, pago o cambio de estado. La cola ya es durable
  desde `enqueue_print_event`, pero una pérdida de sesión en el pequeño
  intervalo entre la operación comercial y esta llamada puede dejar el cambio
  comercial sin su evento de impresión.
- Revisar en entorno de pruebas el ciclo de evento, selección del motor,
  materialización en orden, reclamo BPrint, reporte y aceptación. La revisión
  estática del código no sustituye esa prueba integrada.
- Mantener las columnas históricas `printing_points.sunat_enabled` y
  `sunat_config` fuera del flujo web activo; su retiro de base se decidirá con
  una migración compatible posterior.
- Confirmar que la Edge Function `printing-device-provision` y sus permisos
  estén desplegados en el proyecto destino y probar el contrato web–BPrint.

La arquitectura del editor y del motor ya está descrita e implementada en la
base y en la app web. Antes de ofrecerlo a clientes, falta probar el recorrido
integrado en Supabase con BPrint y completar la modalidad manual del navegador.
