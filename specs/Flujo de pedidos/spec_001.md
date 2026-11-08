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
