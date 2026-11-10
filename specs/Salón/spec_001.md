# Black&White POS — Salón 001

**Estado:** Borrador inicial  
**Tipo:** Pestaña opcional por restaurante.

## Propósito

Organizar el servicio en local cuando el restaurante atiende mesas.

## Alcance por especificar

- Plano, zonas, mesas, capacidad y estados de ocupación.
- Asignación de cuenta, anfitrión y personal de atención.
- Reservas, lista de espera y turnos.
- Abrir, transferir, dividir y cerrar cuentas de mesa.
- Tiempo de espera y sincronización con Flujo de pedidos.

## Datos y cola de servicio

Cada restaurante con Salón tendrá una cola de pedidos por servir. Si también existe Cocina, la cola recibe los pedidos cuando Cocina los marca como listos; si no hay Cocina, Salón recibe directamente los pedidos que cumplan la regla de integración configurada.

**Listo en Cocina** y **Entregado en Salón** son estados distintos. Que Cocina complete un pedido solo habilita su paso a la cola de servicio; el personal de Salón debe registrar por separado la entrega. La forma de esa acción y sus marcas de tiempo queda por definir.

Los restaurantes pueden tener uno o varios pisos. Cada piso guarda la configuración de su propia grilla; las celdas se pueden redimensionar manualmente y se persiste la grilla resultante para ese piso. La definición física de pisos y grillas aún está por diseñar.

Se mantiene la propuesta de un registro por restaurante, con su `restaurant_id` y un array de mesas. Cada mesa guarda su identificador/número, el piso al que pertenece y una coordenada de la grilla de ese piso. La posición debe apuntar a una celda libre. Cada piso persiste además la configuración de su grilla. La estructura final de tablas y columnas para almacenar pisos, grillas y mesas queda por decidir.

### Crear y ordenar mesas

- Al crear mesas, asignarles número en orden cardinal. Si todavía no hay mesas, la primera se llama/numerará **Mesa 1**.
- Las mesas nuevas toman la siguiente posición disponible del piso, en el orden cardinal previsto. Interpreto este orden como filas de arriba abajo y, dentro de cada fila, de izquierda a derecha; falta confirmar ese detalle.
- Cada mesa se puede editar individualmente. El número debe ser único en todo el restaurante.

### Gestos para editar y mover

- El mapa tiene un botón **Editar** con icono SVG. El administrador siempre puede verlo. Configuración permite habilitar por separado la edición del mapa para Mesero y Portero; si se habilita, esos roles también ven el botón.
- Mantener presionada una mesa **3 segundos** activa el estado visual de arrastre (un hover/realce que indica que puede moverse). Al activarse, la mesa se coloca inicialmente en el espacio disponible más bajo; desde ahí se arrastra a cualquier lugar del mapa que tenga espacio libre.
- Si se empieza a arrastrar, se cancela la espera para mostrar las opciones de la mesa. Al soltarla, el realce de movimiento desaparece después de **2 segundos**.
- Si no se arrastra la mesa y se mantiene presionada **4 segundos más** (7 segundos en total), la mesa vuelve a su tamaño visual normal y aparece un menú contextual con **Renombrar**, **Redimensionar** y **Fusionar**.
- **Renombrar:** abre un selector numérico desplazable del 1 al 100. Solo permite elegir números que ninguna otra mesa del restaurante use.
- **Redimensionar:** cambia el área que ocupa la mesa dentro de la grilla, indicando desde qué línea de la grilla hasta qué línea se extiende. Solo puede ocupar celdas disponibles.
- **Fusionar:** solo está disponible si al menos otra mesa toca uno de sus lados. Una mesa en diagonal no cuenta como vecina. Si no cumple la condición, la opción se muestra atenuada y no se puede elegir.

El resultado de fusionar mesas (número/identidad resultante, conservación de ambas y posibilidad de deshacer) queda por definir.

### Vista de pisos e identificación en pedidos

- Si el restaurante tiene un solo piso, la interfaz muestra solo ese piso, sin selector de múltiples pisos. Si tiene varios, permite cambiar entre ellos.
- En los pedidos, cuando hay un solo piso se identifica la mesa como **Mesa N**. Cuando hay varios, se muestra **Piso N · Mesa N** tanto a Cocina como al personal de Salón.
- El mapa de modo de visión no permite acomodar mesas ni sillas. La colocación física de sillas se hace en el restaurante; no se persisten coordenadas de sillas.

Salón no tendrá cola cuando la necesidad Salón esté desactivada. Desactivar la necesidad oculta el espacio de trabajo y conserva las mesas, pedidos y registros previos.

## Regla de dependencia

Salón puede usar Cocina para enviar comandas, pero Cocina no exige Salón: también puede atender mostrador, recojo o delivery.

## Pendientes

Definir el modelo de datos de pisos/grillas/mesas, orientación exacta del orden cardinal, reservas, reasignaciones, políticas de cancelación y permisos del personal. Definir además el flujo cuando se integra desde pedidos abiertos, en especial si la comida aún no está lista.
