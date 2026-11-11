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

La capacidad de persistencia del movimiento sigue siendo de hasta diez espacios de importe, aunque cada restaurante habilite como máximo esos cinco métodos base. El método y modalidad aplicados a cada importe se guardan como instantánea histórica. Falta decidir cómo se representan varios pagos o intentos del mismo método dentro de los diez espacios y cómo se relaciona la modalidad con el arreglo histórico de tipos.

## Ajustes de permisos y límites desde Configuración

- El administrador puede habilitar límites de importe mínimo y máximo del pedido, definir los valores y elegir si aplican al administrador, a empleados o a ambos. Si aplican a empleados, selecciona los roles autorizados.
- El administrador puede habilitar pedidos correctivos y devoluciones para sí mismo y, de forma independiente, para empleados. Si se habilitan para empleados, selecciona explícitamente los roles autorizados.
- Qué sucede cuando un pedido supera o no alcanza los límites (bloqueo, advertencia o excepción autorizada), así como el alcance exacto de «pedido correctivo», todavía queda por definir.
- Los permisos deben validarse en el servidor; ocultar o mostrar botones según el rol no es suficiente.

## Pendientes

Definir ciclo de vida, persistencia de borradores, estados, concurrencia, anulaciones y comportamiento cuando falte conexión. Precisar si un movimiento representa un cobro, devolución, ingreso/egreso de caja u otros eventos, y cómo se valida la suma y el snapshot de métodos en servidor.
