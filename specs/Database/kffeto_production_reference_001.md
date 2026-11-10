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
- `order_correction_events`: pedido, actor, snapshot del operador, motivo y fecha de corrección.

Los nombres y definiciones de trigger muestran protecciones de mutación y validación de totales; el snapshot no trae sus cuerpos, así que los detalles de implementación se deben confirmar antes de replicarlos. Las correcciones aparecen modeladas como eventos con motivo, en vez de una edición libre evidente del historial financiero.

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
4. **Tratar pedidos financieros como historial protegido.** Validar el reparto de pagos y registrar correcciones con actor y motivo.
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
5. **Pedidos abiertos y pedidos pagados.** Black&White aún no implementa estas entidades. Diseñar ambas según el flujo de B&W. El pedido pagado deberá conservar el conjunto histórico que Kffe’to distribuye entre `orders`, `order_items` y `order_item_addons` (cabecera, líneas, agregados y snapshots), sin asumir que deba replicarse su estructura física. Evaluar revisión/versionado optimista para pedidos abiertos, transiciones explícitas y snapshots del operador.
6. **Cobros escalables.** En vez de columnas fijas para Yape y efectivo, evaluar líneas de pago con método, monto, estado y referencia externa, de modo que pagos manuales y automáticos puedan coexistir. Las reglas de suma deberían validarse en el servidor/DB en el punto de cierre.
7. **Historial financiero protegido.** Evaluar inmutabilidad de ventas cerradas y eventos de corrección auditables con motivo, autor y fecha.
8. **RLS multi-tenant.** Cada tabla operativa tendría que aplicar `restaurant_id`; las sedes y funciones de autorización deben validar pertenencia al restaurante. Dado que los roles globales no pertenecen a un restaurante, cada asignación debe validar que su ID esté incluido en la lista de roles habilitados del restaurante. La sede complementa el aislamiento por restaurante; no lo reemplaza.
9. **Impresión propia.** Si se crea una cola, diseñar sus estados y payload para B&W desde sus requisitos; no copiar `printer_templates` ni el formato de tickets de Kffe’to.

## Diferencias con el esquema local actual de B&W

Las migraciones aplicadas crean `restaurants`, `accounts`, `roles` asociados por `restaurant_id`, `locations`, `location_hours` y `account_schedules` enlazada mediante `auth_user_id`; también guardan preferencias de asistencia, pero no marcas. Un empleado puede tener varias filas de horario asignado. La migración `202611100001_restaurant_catalog.sql` añade el catálogo y los formatos de comprobante en el repositorio, pendiente de aplicación remota. Los pedidos abiertos, pedidos pagados y registros de asistencia siguen sin tablas. El esquema actual de roles y cuentas es anterior a la decisión global/multirrol del 2026-11-10 y todavía no implementa esa dirección. Kffe’to sugiere invariantes útiles, pero no justifica copiar su SQL ni su modelo de una sola cafetería.

Antes de implementar una RPC de pedidos/cobro/asistencia o de migrar producción, solicitar los cuerpos de las funciones relevantes del snapshot y contrastarlos con los requisitos de B&W. El export compartido no incluía esos cuerpos ni datos de negocio.
