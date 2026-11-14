# Black&White POS — Flujo de pedidos 001

**Estado:** Borrador inicial  
**Tipo:** Sección fija para todos los restaurantes.

## Propósito

Registrar pedidos de todos los canales del restaurante y conducirlos desde su creación hasta su entrega y cobro.

## Decisión de disponibilidad

Flujo de pedidos siempre está disponible. Las necesidades opcionales pueden cambiar el flujo, los canales y las integraciones disponibles, pero no quitan la sección. Sus propios comportamientos configurables se administran desde Configuración.

## Alcance por especificar

- Pedido en salón, mostrador, para llevar, recojo y delivery.
- Varios pedidos abiertos, notas, productos, variantes, agregados, combos y descuentos.
- División y combinación de cuentas y pagos.
- Estados del pedido, tiempos, canal de origen y cancelaciones autorizadas.
- Integración con Salón, Cocina y Pagos cuando esos módulos estén activos.

## Decisiones compartidas

- El flujo debe respetar funciones activas, rol, restaurante y sede.
- Las capacidades de cocina y mesas pueden activarse independientemente.
- El flujo de impresión de Kffe’to POS no se adopta como diseño predeterminado.
- Las opciones llamadas antes «importe mínimo/máximo» no limitan el pago. Son indicadores de pedido de menor/mayor importe en Estadísticas y no pueden bloquear ni rechazar un cobro.

## Referencia investigada: Ingreso y Egreso en Kffe’to POS

Esta sección resume el comportamiento observado en el código y las migraciones locales de Kffe’to POS (solo lectura; no se modificó ese proyecto). Es una referencia para decidir el flujo de Black&White, no una aprobación para copiar su esquema de una sola cafetería.

- El catálogo distingue productos normales de los productos especiales `income` (**Ingreso**) y `expense` (**Egreso**). Kffe’to crea un producto de cada tipo y una variante `Monto variable` con precio cero. El importe se introduce al añadir el movimiento; por eso no se trata como inventario ni como un precio fijo de catálogo.
- En el pedido, los especiales aparecen primero en el menú sin filtros. Al seleccionar uno, se abre un formulario propio. Cada movimiento usa cantidad uno, no admite agregados y requiere un importe manual mayor que cero, con hasta dos decimales. El concepto es opcional y se conserva como snapshot.
- Ingreso se guarda con importe positivo. Egreso se guarda con importe negativo. Ambos se pueden incluir junto con productos normales o en un pedido compuesto solo por movimientos. Su línea conserva el nombre del producto, variante, concepto, importe firmado y medio de pago.
- En el pago, las líneas normales se pueden asignar a un solo medio global o dividir mediante porcentaje entre Yape y efectivo. Cada línea especial se asigna completa a Yape o a efectivo; no se reparte. Una opción de sincronización propaga el medio global a los especiales, y cada especial puede cambiarse individualmente.
- La base vuelve a calcular precios de productos y agregados desde el catálogo, valida la cantidad, el tipo de producto, el importe manual y el método de pago, y registra cabecera y líneas en una transacción. La suma de asignaciones Yape/efectivo de todas las líneas debe coincidir con la cabecera. Los detalles pagados son inmutables.
- Egreso tiene además un camino de corrección. Si se inicia en un pedido vacío y se deja el importe en cero/vacío, la interfaz muestra pagos Correctos de hoy y ayer para la sede permitida. Elegir uno no registra un nuevo egreso: la RPC marca Erróneo el pedido original e inserta un evento con autor, snapshot del nombre, motivo y hora. El importe original permanece en el historial y se excluye de métricas limpias. Si se introduce un importe mayor que cero, el formulario vuelve al egreso normal.
- La lista de candidatos y la corrección están protegidas por usuario, rol y sede en la RPC. La ventana de corrección de producción permite hoy y ayer; el flujo antiguo limitado a hoy fue reemplazado por la migración de ventana de corrección.

### Estado de la implementación en Black&White

Las decisiones propias de B&W para los productos especiales son:

- Cada restaurante nace con exactamente un producto **Ingreso** y uno **Egreso**, cada uno con su variante de monto variable. Son productos obligatorios: no se crean desde el editor normal del catálogo y no se pueden eliminar. La creación ocurre como parte de la creación del restaurante.
- Para pagar el pedido, el modal muestra como opciones los métodos habilitados para cobro manual en ese restaurante. **Efectivo siempre está habilitado**; Yape y los demás medios dependen de la configuración. Cada línea especial se asigna completa a un medio.
- Corregir un pago consiste en marcar el movimiento original como erróneo y conservarlo en el historial; no exige escribir un motivo. El contexto de desempeño o conducta se registra en las notas del empleado.
- Un Egreso no se interpreta automáticamente como una devolución ni activa por sí mismo una corrección. Si un restaurante acuerda representar devoluciones con un producto, ese producto/concepto se registra por separado según su procedimiento interno; su representación concreta en el catálogo queda pendiente de definir.

La interfaz y Estadísticas consultan `public.orders`; el flujo de pago usa `record_paid_order`/`pay_open_order`. `202611120003_paid_orders_and_statistics.sql` implementa pedidos pagados, líneas, agregados, snapshots de pagos, eventos de corrección y RPC de pedidos abiertos. `202611130001_required_special_products_and_payment_rules.sql` agrega Ingreso/Egreso obligatorios, efectivo obligatorio y correcciones sin motivo. El propietario confirmó el 13 de noviembre de 2026 que los últimos cambios están en producción y funcionan; si un cambio posterior depende del estado del esquema, confirma la migración en el historial remoto.

La interfaz carga los métodos manuales habilitados del restaurante al abrir el formulario de Ingreso/Egreso y el modal de pago. El efectivo aparece siempre y no se puede desactivar; la base también lo fuerza. Al corregir, la interfaz no solicita ni manda un motivo; el evento conserva actor y hora. El catálogo solo permite crear productos normales, y la base impide borrar, renombrar, cambiar de tipo o desactivar Ingreso/Egreso y su variante obligatoria. La UI de pago global admite métodos manuales configurados; la división de productos estándar sigue siendo Yape/Efectivo.

## Colas operativas opcionales

## Cierre automático de Caja y operaciones pendientes

Al acercarse el cambio al siguiente turno a menos de cinco minutos, el proceso automático de Caja puede cancelar operaciones pendientes que dependan de una Caja abierta. Esto es preventivo y no afirma que el flujo actual tenga una operación pendiente de ese tipo. Si en el futuro el cierre afecta una operación, su resultado devuelve `closedCashier` en lugar de éxito o una fecha; se trata como error y no se incluye en Estadísticas. Una cola u otro flujo que espere ese resultado debe manejarlo como error y cerrar su espera. El camino normal de pedidos no debería generar `closedCashier`. Se avisa al administrador que respetar los horarios evita estas cancelaciones y datos operativos erróneos.

El ciclo principal de pedidos conserva los pedidos abiertos y los pedidos pagados. Las colas de preparación y servicio son capas opcionales: solo se crean/consultan cuando el restaurante tiene activa la necesidad correspondiente. Si no están activas, el pedido sigue el flujo normal sin pasar por esas colas.

Flujo acordado como base:

- Con **Cocina** activa, los pedidos que entren a preparación aparecen en su cola. Cocina los prepara y marca como listos.
- Si también está activo **Salón**, un pedido listo pasa a la cola de Salón para que un mesero lo sirva.
- Si hay **Salón** pero no **Cocina**, los pedidos entran al flujo de Salón sin una etapa de preparación en Cocina.
- Sin Salón, no existe cola de servicio de Salón; sin Cocina, no existe cola de preparación.
- Las tablas de colas serán específicas por restaurante y no reemplazarán las entidades de pedidos abiertos/pagados; las referenciarán.
- Los pedidos deben identificar la mesa para Cocina y Salón: con un piso se muestra **Mesa N**; con varios, **Piso N · Mesa N**.
- La forma física de la cola sigue pendiente: una tabla compartida con etapa (Cocina/Salón) o tablas separadas. También falta decidir cómo cada entrada enlaza un pedido abierto frente a un pedido pagado.

Configuración debe determinar si cada flujo recibe los pedidos desde el pedido abierto (antes de pagar) o desde el pedido pagado. La selección puede ser distinta para Cocina y Salón. Delivery tiene configuración separada: debe poder definirse si se envía a preparar cuando el pedido de Delivery recibe pago virtual. Los controles serán independientes (checkboxes); el detalle de estados de pago y condiciones exactas queda pendiente.

## Diferencias por combinación de necesidades

Las reglas finales están pendientes de definición para estas combinaciones:

- **Solo Salón:** si se integra desde un pedido abierto, el mesero podría recibirlo antes de que esté listo. Hay que definir cómo evitarlo, por ejemplo mediante un estado de espera, un retraso u otra regla.
- **Solo Cocina:** definir qué ocurre después de que Cocina marca el pedido listo, al no existir Salón.
- **Cocina + Delivery sin Salón:** definir entrega/recogida y cómo el pago virtual habilita el envío a preparación.
- **Cocina + Salón + Delivery:** definir cómo conviven las colas de Cocina, servicio en Salón y pedidos de Delivery.

Los datos y estados de una cola deben respetar el restaurante, sede, canal y permisos. Desactivar una necesidad oculta su cola y bloquea nuevas transiciones por ese flujo, pero conserva pedidos y registros existentes.

## Registro de movimientos y pagos

Cada movimiento conserva un timestamp y el total, además del desglose de pagos. El modelo común permite pagar un movimiento con un método o dividirlo entre varios:

- Hay hasta diez espacios de importe por movimiento, cada uno expresado en soles con céntimos. Los espacios no usados quedan vacíos; no es obligatorio completar los diez.
- Un arreglo ordenado junto al desglose identifica el método de pago correspondiente a cada espacio. La posición del elemento del arreglo corresponde a la posición del importe.
- El arreglo guarda los tipos de método efectivos en el momento del movimiento, obtenidos de la configuración del restaurante. Es una instantánea histórica: cambiar después los métodos disponibles no altera cómo se interpretan movimientos anteriores.
- El total del movimiento es igual a la suma de los importes usados. Cada importe y el total se representan con precisión de dos decimales, sin cálculos monetarios de punto flotante.
- Un movimiento puede tener un solo importe ocupado o varios cuando se paga en partes. Los importes vacíos no cuentan para el total.

Configuración ofrece cinco métodos base que el administrador activa o desactiva: Efectivo, Yape, Plin, Transferencia bancaria directa y Tarjetas. Al activar un método, se habilita la modalidad manual o automática que corresponda: efectivo y transferencia bancaria directa son solo manuales; Yape, Plin y tarjetas pueden habilitarse en modalidad manual, automática o ambas. La modalidad automática requiere una integración compatible y configurada. Estos métodos no se agregan ni renombra desde Flujo de pedidos.

La capacidad de persistencia admite hasta diez espacios de importe. El método y modalidad de cada método usado se guardan como instantánea histórica, y la migración valida en el servidor que las asignaciones sumen el total. La interfaz actual solo permite el pago global o la división porcentual entre Yape y efectivo para productos normales; aún falta definir en la interfaz el uso de Plin, transferencia y tarjeta, además de pagos parciales/reintentos del mismo método.

## Ajustes de permisos desde Configuración

- Los controles llamados antes importe mínimo/máximo pertenecen a Estadísticas: activan la vista del pedido de cliente Correcto de menor/mayor importe del periodo y los permisos para verlo. No definen topes de compra ni valores que bloqueen un pago.
- El administrador puede habilitar correcciones de pagos para sí mismo y, de forma independiente, para empleados. Si se habilitan para empleados, selecciona explícitamente los roles autorizados. Las devoluciones registradas como movimientos se representan por separado, mediante el producto/concepto que acuerde cada restaurante.
- Los permisos deben validarse en el servidor; ocultar o mostrar botones según el rol no es suficiente.

## Pendientes

Definir el ciclo completo de borradores, estados de cocina/salón/delivery, anulaciones y comportamiento cuando falte conexión; también falta decidir pagos parciales/reintentos. Las correcciones no piden motivo. Si un restaurante registra una devolución como movimiento, usa un producto/concepto separado según su procedimiento. La migración actual registra pagos cerrados e ingresos/egresos, pero no implementa el ciclo de Caja ni todos los estados operativos.
