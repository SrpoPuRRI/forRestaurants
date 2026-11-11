# Black&White POS — Cocina 001

**Estado:** Especificación parcial; UI y migración local implementadas, pendientes de aplicar y verificar en Supabase  
**Tipo:** Pestaña opcional por restaurante e independiente de Salón.

## Propósito

Mostrar y coordinar la preparación de pedidos con el equipo de cocina.

## Alcance

- Pantalla KDS con cola de pedidos y artículos/unidades por preparar.
- Estaciones de producción y reglas para enrutar artículos.
- Prioridad, tiempos, pausas, notas y estados de preparación.
- Pedidos de salón, mostrador, para llevar y delivery.
- Alertas de atraso y comunicación de pedidos listos.

## Decisiones compartidas

- Cocina puede operar sin mesas.
- Si Cocina está activa, cuenta con una cola de pedidos por preparar. Un empleado de Cocina marca cada pedido como listo.
- Si el restaurante también tiene Salón, el pedido marcado listo pasa a la cola de Salón para que lo atienda un mesero.
- La integración de pedidos a Cocina puede configurarse desde pedido abierto o pedido pagado. Delivery tiene un control separado para definir si se manda a preparar cuando recibe pago virtual.
- Si Cocina no está activa, el flujo no usa ni muestra su cola y los pedidos siguen el ciclo normal de pedido abierto/pagado.
- Configuración de impresoras y formatos no pertenece a Catálogo; se definirá en Configuración.
- El flujo de impresión de Kffe’to POS no se hereda por defecto.

## Cola y marcado de preparación implementados localmente

La cola de Cocina debe conservar la referencia al pedido original y un registro de qué partes ya están listas. La granularidad debe permitir operar de estas tres formas, incluso dentro del mismo pedido:

- Marcar todo el pedido como listo.
- Marcar un artículo completo como listo.
- Marcar unidades individuales de la cantidad de un artículo como listas.

En la interfaz se muestra la lista de artículos del pedido y una acción destacada **Dar pedido como listo**. Cada artículo ofrece **Dar item como listo** y **Quitar por fuera de stock**. Si un artículo tiene varias unidades, cada unidad puede marcarse por separado como lista o como no disponible por falta de stock.

Al marcar una parte como lista, se registra una marca de tiempo para ese pedido, artículo o unidad. La cola guarda también cuándo se incorporó el pedido a Cocina. Cuando el 100 % de las unidades del pedido esté listo, el pedido pasa a completado en Cocina y se registra la hora de finalización.

**Listo en Cocina** y **Entregado en Salón** son estados diferentes. Completar la preparación no debe registrar automáticamente que el mesero ya entregó el pedido. Si Salón está activo, el pedido listo puede pasar a su cola de servicio según el flujo configurado.

La cola local guarda el pedido original, el progreso por unidad y eventos con actor/fecha. Cocina integra pedidos abiertos o pagados según Configuración. Los completados se borran al abrir Cocina si tienen más de dos días; falta un borrado programado en servidor. El inventario no se gestiona: la disponibilidad es un estado de venta y el personal puede declarar una unidad o producto fuera de stock. La distribución de productos entre Cocina y Barra está pendiente.

## Propuesta inicial: productos fuera de stock

Black&White no tendrá inventario ni cantidades de existencias. Como concepto operativo separado, Cocinero y Administrador podrán declarar que un producto está fuera de stock; Empleado también podría hacerlo por su alcance de permisos. La declaración no elimina ni desactiva el producto del catálogo: sigue apareciendo en las búsquedas al armar un pedido, pero al seleccionarlo la interfaz informa que no está en stock. Al aceptar ese aviso, no agrega el producto al pedido.

La acción **Quitar por fuera de stock** durante la preparación permite registrar que un artículo o unidad de un pedido ya recibido no puede prepararse por falta de stock. La relación entre esta marca de pedido y la disponibilidad general del producto todavía no está definida: falta aclarar si quitar una unidad del pedido también declara el producto fuera de stock para nuevos pedidos, y cómo se revierte esa declaración.

## Retención de la cola

La cola debe conservar las marcas de tiempo de entrada, de los artículos/unidades y de finalización total. Como propuesta, los pedidos completados hace más de dos días se eliminan de la cola para limitar su crecimiento. Falta decidir si la limpieza elimina solo la entrada operativa de la cola o también sus marcas de tiempo/historial; los datos originales del pedido deben tratarse por separado.

Estas estructuras y reglas son diseño funcional en discusión: aún no se ha decidido la forma física de tablas, columnas, arrays u objetos, ni se han añadido a la base de datos.

## Pendientes

Definir el modelo de datos de la cola y de sus marcas de tiempo; semántica y reversión de fuera de stock; estaciones, temporizadores, reimpresión, contingencia sin pantalla o sin red, dispositivos compatibles, permisos detallados y el destino del pedido listo cuando no hay Salón.
