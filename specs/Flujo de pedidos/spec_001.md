# Black&White POS — Flujo de pedidos 001

**Estado:** Borrador inicial  
**Tipo:** Pestaña opcional por restaurante.

## Propósito

Registrar pedidos de todos los canales del restaurante y conducirlos desde su creación hasta su entrega y cobro.

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

## Pendientes

Definir ciclo de vida, persistencia de borradores, estados, concurrencia, anulaciones y comportamiento cuando falte conexión.
