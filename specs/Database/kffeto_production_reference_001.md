# Referencia de producción: Kffe’to POS

**Estado:** referencia arquitectónica; no es el esquema aprobado para Black&White POS.  
**Origen:** snapshot de metadatos de la base de producción de Kffe’to, compartido por el usuario el 2026-11-07.  
**Uso:** consultar este documento antes de proponer tablas, restricciones, RLS o RPC operativas para Black&White. No volver a pedir la consulta del esquema para conocer esta referencia.

## Principio de uso

Kffe’to es un POS funcional de una cafetería concreta. Su base muestra decisiones operativas que ya funcionan en producción, pero Black&White será un producto multi-restaurante que adapta su operación a las necesidades de cada restaurante. Kffe’to es una inspiración y un caso probado; no se copia como diseño final ni se asume que sus reglas sirvan para todos los clientes.

El snapshot contiene estructura, columnas, restricciones, índices, políticas, firmas de funciones y triggers. No contiene filas de negocio ni cuerpos de funciones. Los comportamientos que se infieren del nombre de una función o trigger deben confirmarse con su código antes de implementarlos.

## Inventario del snapshot

- Esquemas de aplicación: `public` y `private`.
- 22 relaciones: 21 tablas en `public` y `private.staff_profile_history`.
- 40 funciones/procedimientos, 27 políticas RLS y 10 triggers.
- No se observaron tipos enum.
- RLS está habilitado en las 22 tablas; `FORCE ROW LEVEL SECURITY` no está habilitado en ellas.
- No aparece `restaurant_id` en este modelo: el esquema corresponde a una cafetería y sus sedes.

## Tablas y responsabilidades observadas

### Identidad, sedes y asistencia

- `staff_profiles`: perfil ligado 1:1 a `auth.users` por `auth_user_id`; guarda `username`, `username_normalized`, `display_name`, `role` y `location_id`. El rol está limitado a `admin` o `employee`; los empleados necesitan sede. El usuario normalizado es único.
- `locations`: sede con `id`, `name` y `created_at`; el nombre es único.
- `attendance_records`: marca por persona/fecha, sede, quién marcó, y snapshots de nombres para conservar el historial.
- `private.staff_profile_history`: versiones históricas del perfil con rol, sede y snapshot del nombre de sede, junto con `valid_from` y `valid_to`.
- `staff_account_deletion_claims`: solicitud temporal ligada a usuario objetivo y actor para el flujo de eliminación de cuenta.

### Catálogo

- `categories`, `tags`.
- `products`: nombre, descripción, categoría y `product_kind` (`standard`, `income`, `expense`); no es inventario.
- `variants`: producto, nombre y precio; precio no negativo y nombre único dentro del producto.
- `variant_locations`: disponibilidad de variante por sede.
- `addons`: nombre, precio y estado activo.
- `product_categories`, `product_tags`, `product_addons`: relaciones de catálogo.

Hay funciones `catalog_*_visible` para determinar si productos, variantes y complementos deben mostrarse. Un trigger diferible exige que los productos activos tengan variantes.

### Pedidos, cobros y correcciones

- `open_orders`: sede, creador/operador, snapshot del operador, nota, `items` JSONB, estado, `revision`, pedido pagado asociado y marcas de tiempo. Los estados admitidos son `open`, `cancelled` y `paid`; la revisión debe ser positiva y el pedido pagado tiene una relación coherente con `paid_order_id`.
- `orders`: sede, operador y su snapshot, nota, estado, montos `amount_yape`, `amount_cash`, `total`, `paid_at` y `created_at`.
- `order_items`: snapshots del nombre de producto/variante, tipo de línea, cantidad, precio unitario, total y desglose Yape/efectivo. La cantidad es positiva y el desglose debe sumar el total de línea.
- `order_item_addons`: snapshot del complemento, cantidad, precio y total de línea.
- `order_correction_events`: pedido, actor, snapshot del operador y fecha de corrección. Para B&W, la corrección no pide motivo; el contexto del empleado corresponde a sus notas.

Los nombres y definiciones de trigger muestran protecciones de mutación y validación de totales; el snapshot no trae sus cuerpos, así que los detalles de implementación se deben confirmar antes de replicarlos. Las correcciones se modelan como eventos que conservan el historial financiero, sin exigir una explicación del empleado en el flujo B&W.

#### Productos especiales: código B&W actual y decisiones acordadas

La lectura de `order-flow.js`, `statistics.js` y las migraciones de Black&White describe el código local. La especificación de producto que prevalece para B&W es:

1. Todos los restaurantes deben crearse con exactamente un producto obligatorio **Ingreso** y uno **Egreso**, cada uno con variante de monto variable. No se crean desde el editor estándar del catálogo ni se pueden eliminar.
2. Al seleccionarlos en el flujo de pedidos, se abre un formulario que pide un importe positivo y permite un concepto opcional. La línea especial tiene cantidad uno y no admite agregados.
3. Ingreso suma y Egreso resta. Ambos pueden convivir con productos normales o formar un movimiento por sí solos.
4. El pago especial muestra en un modal los medios habilitados para ese restaurante; Efectivo siempre está disponible. Cada línea especial se asigna entera a un método.
5. Corregir un pago marca erróneo el movimiento original y lo conserva en el historial; no requiere explicación. Las notas del empleado guardan el contexto correspondiente. Si se acuerda representar una devolución con un producto, se registra como producto/concepto separado según el procedimiento interno del restaurante; no se confunde automáticamente con la corrección de un pedido.

La implementación se completa con `202611130001_required_special_products_and_payment_rules.sql`: la base siembra los productos y variantes requeridos en cada restaurante nuevo y en los ya existentes, protege su disponibilidad y borrado, obliga a mantener Efectivo habilitado y permite correcciones sin motivo. La interfaz obtiene los métodos manuales activos del restaurante para sus opciones de pago. El propietario confirmó el 13 de noviembre de 2026 que los últimos cambios se publicaron y funcionan en producción; comprueba el historial remoto si una tarea posterior depende de la migración.

### Impresión

- `print_queue`: cola con pedido pagado, solicitante, estado, payload JSONB y resultado.
- `printer_devices`: dispositivo asociado a cuenta Auth.
- `printer_templates`: configuración de formato JSONB.

Este flujo y sus plantillas pertenecen a Kffe’to. Black&White no debe adoptar su formato ni su flujo de impresión por defecto; solo considerar el patrón de cola si se decide un flujo asíncrono propio.

## Familias de funciones observadas

- **Identidad y permisos:** `is_kffeto_admin`, `current_staff_location`, `current_staff_role`, `normalize_username`.
- **Catálogo visible:** `catalog_product_visible`, `catalog_standard_product_visible`, `catalog_variant_visible`, `catalog_addon_visible`.
- **Cuentas e historial:** `get_admin_account_data_dates`, `get_admin_accounts_for_date`, `claim_staff_account_deletion`, `release_staff_account_deletion`.
- **Asistencia:** `mark_attendance`.
- **Pedidos abiertos:** `create_open_order`, `list_open_orders`, `update_open_order`, `cancel_open_order`, `pay_open_order`, `get_open_order_paid_today_count`, `cleanup_expired_open_orders`.
- **Cobros e historial:** `record_paid_order`, `correct_paid_order`, `get_correction_candidates`.
- **Impresión:** `create_print_request`, `get_pending_print_requests`, `complete_print_request`, `get_print_request_status`, `delete_print_request`, `get_my_printer_status`, `report_printer_device`, `get_printer_template`, `save_printer_template`.
- **Triggers/protecciones:** `capture_staff_profile_history`, `guard_order_mutation`, `reject_attendance_mutation`, `reject_correction_event_mutation`, `reject_financial_mutation`, `assert_order_payment_totals`, `assert_active_product_has_variant`, `rls_auto_enable`.

Las RPC financieras y administrativas aparecen mayormente como `SECURITY DEFINER`. Su firma no basta para replicarlas: antes de adaptar una, hay que revisar el cuerpo, quién puede ejecutarla, cómo valida el actor y qué tablas modifica.

## Lecciones que sí sirven como referencia

1. **Separar identidad y operación.** El usuario Auth se vincula a un perfil; el perfil determina rol y sede. Para B&W se agrega restaurante y rol configurable.
2. **Normalizar los nombres de usuario en la base.** La unicidad debe protegerse también ante escrituras que no pasen por el formulario.
3. **Conservar snapshots en transacciones.** Los nombres y precios de pedidos históricos no deberían cambiar cuando se edita el catálogo o el perfil de una persona.
4. **Tratar pedidos financieros como historial protegido.** Validar el reparto de pagos y registrar correcciones con actor y fecha, sin pedir motivo.
5. **Controlar concurrencia de pedidos abiertos.** `revision` y el argumento de revisión esperada evitan que una edición pise otra.
6. **Aplicar sede y rol en la base.** La visibilidad de catálogo y datos operativos no depende solo de ocultar controles en la UI.
7. **Mantener necesidades del cliente en modelo configurable.** Kffe’to usa roles fijos y montos específicos Yape/efectivo; B&W debe ofrecer roles y configuraciones según las necesidades seleccionadas, con métodos de pago configurables por restaurante.

## Propuestas para revisar en el modelo actual de B&W

Estas son ideas para discutir. **No están aprobadas y no se han añadido al SQL.**

1. **Roles globales y asignaciones múltiples en B&W.** Decisión del propietario (2026-11-10 y actualizaciones posteriores): `roles` será un catálogo global, sin `restaurant_id` ni referencia a cuentas. `restaurants` guarda arrays de roles habilitados según necesidades/configuración; `accounts` guarda uno o varios IDs asignados. No hay roles mixtos predefinidos; los permisos se acumulan asignando varios roles simples. El administrador puede editar necesidades después del alta; retirar una necesidad quita sus roles y accesos sin borrar datos. `Empleado` es universal y exclusivo: equivale a todos los permisos de roles disponibles en ese restaurante. El mapeo actual de necesidades/configuración a roles y espacios de trabajo está en `specs/Cuentas/spec_001.md`; aún falta resolver integridad/validación de arrays y el comportamiento de asignaciones de cuentas al deshabilitar y reactivar una necesidad.
2. **Historial de perfiles.** Evaluar una tabla de historial para cambios de nombre visible, rol, sede y estado. Almacenar snapshots cuando pedidos/asistencias dependan de nombres actuales.
3. **Asistencia.** Black&White aún no tiene tabla de marcas; solo persiste preferencias de asistencia en `restaurants`. Dirección acordada (2026-11-10): `attendance_objects` mantiene un objeto de historial por empleado, se crea al crear la cuenta aunque no existan marcas todavía, y la cuenta apunta a ese objeto. Una tabla común `attendance_records` guarda las marcas de todos los restaurantes; un objeto puede reunir cero o muchos registros. Sigue pendiente definir si se necesita una referencia inversa y qué columnas de restaurante/sede/actor/tiempo requiere cada marca. El esquema final aún no está aprobado.
   - `accounts.location_id`, `accounts.is_active` y `accounts.created_at` describen principalmente el estado actual y el alta; no reconstruyen por sí solos en qué sede trabajaba alguien ni si seguía activo en una fecha pasada.
   - Kffe’to sí tiene `private.staff_profile_history` con rol, sede, snapshot del nombre de sede y vigencias `valid_from`/`valid_to`, además de un trigger de historial en `staff_profiles`. Esto sugiere que conserva cambios de sede; hay que revisar el cuerpo de `capture_staff_profile_history` para confirmar si registra cada cambio y cómo define los límites de vigencia.
   - Para B&W, conservar la sede principal en la cuenta y modelar asignaciones temporales/históricas por vigencia o por turno. Así se puede asignar a alguien a otra sede un solo día y luego volver a su sede principal sin borrar el historial.
   - La tabla actual `account_schedules` tiene una fila por horario asignado y ya admite varios horarios por cuenta mediante varias filas; no ofrece horarios reutilizables. El propietario planteó reemplazar la referencia `auth_user_id` por una relación basada en IDs de horarios desde `accounts`. El formato final (columna con varios IDs u otra relación explícita) queda por resolver antes de migrar.
   - Cada asistencia debe guardar la sede real donde se marcó y la hora exacta. Para evaluar el mapa en una fecha pasada, debe poder relacionarse con la asignación y el horario vigentes ese día. `account_schedules` sin vigencia ni sede asignada no basta para reconstruirlo.
4. **Catálogo multi-restaurante y por sede.** La migración `202611100001_restaurant_catalog.sql` define productos, variantes, agregados y relaciones aisladas por `restaurant_id`, con disponibilidad por sede. B&W usa `is_active` como disponibilidad de venta y mantiene visibles los registros fuera de stock; no agrega inventario por cantidad. La migración está en el repositorio, pendiente de aplicar al proyecto remoto.
5. **Pedidos abiertos y pedidos pagados.** La migración `202611120003_paid_orders_and_statistics.sql` crea el esquema multi-restaurante `orders`, `order_items`, `order_item_addons`, `order_correction_events` y `open_orders`, con snapshots históricos de hasta diez importes/métodos/modos de pago, correcciones auditadas e invariantes de sede/restaurante. También implementa las RPC que invocan Estadísticas y Flujo de pedidos. Según la verificación reportada el 2026-11-13, está aplicada en producción. La migración `202611130001_required_special_products_and_payment_rules.sql` añade Ingreso/Egreso obligatorios, Efectivo siempre habilitado y correcciones sin motivo. El propietario confirmó que el último despliegue funciona; las decisiones de flujo restantes siguen indicadas en `specs/Flujo de pedidos/spec_001.md`.
6. **Cobros escalables.** La migración registra hasta diez importes y arrays paralelos con método/modalidad histórica. La RPC valida métodos configurados y la suma del pedido. La interfaz actual aún está limitada principalmente a Yape y efectivo; integrar los otros métodos y pagos parciales queda pendiente.
7. **Historial financiero protegido.** Las filas pagadas y sus líneas/agregados son inmutables; las correcciones se guardan como eventos con cuenta y hora, y cambian el estado de Correcto a Erróneo sin borrar importes. B&W no pide un motivo para corregir.
8. **RLS multi-tenant.** Cada tabla operativa tendría que aplicar `restaurant_id`; las sedes y funciones de autorización deben validar pertenencia al restaurante. Dado que los roles globales no pertenecen a un restaurante, cada asignación debe validar que su ID esté incluido en la lista de roles habilitados del restaurante. La sede complementa el aislamiento por restaurante; no lo reemplaza.
9. **Impresión propia.** Si se crea una cola, diseñar sus estados y payload para B&W desde sus requisitos; no copiar `printer_templates` ni el formato de tickets de Kffe’to.

## Diferencias con el esquema local actual de B&W

El esquema vigente de Black&White ya implementa roles globales/múltiples, sedes, horarios reutilizables, objetos y registros de asistencia, catálogo multi-restaurante, pedidos abiertos/pagados y estadísticas con snapshots financieros. Las migraciones de roles/asistencia (`202611120001`), sedes (`202611120002`), pedidos (`202611120003`) y productos especiales/medios (`202611130001`) están en el repositorio; el propietario reporta que el despliegue más reciente funciona. Kffe’to sigue siendo referencia de patrones operativos, no autorización para copiar su esquema de una sola cafetería.

Antes de implementar una RPC de pedidos/cobro/asistencia o de migrar producción, solicitar los cuerpos de las funciones relevantes del snapshot y contrastarlos con los requisitos de B&W. El export compartido no incluía esos cuerpos ni datos de negocio.
