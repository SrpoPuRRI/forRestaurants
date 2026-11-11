# Black&White POS — Salón 001

**Estado:** Especificación parcial; mapa, edición y cola implementados localmente, pendientes de aplicar y verificar en Supabase  
**Tipo:** Pestaña opcional por restaurante.

## Propósito

Organizar el servicio en local cuando el restaurante atiende mesas.

## Alcance

- Plano, zonas, mesas, capacidad y estados de ocupación.
- Asignación de cuenta, anfitrión y personal de atención.
- Reservas, lista de espera y turnos.
- Abrir, transferir, dividir y cerrar cuentas de mesa.
- Tiempo de espera y sincronización con Flujo de pedidos.

## Datos y cola de servicio

Cada restaurante con Salón tendrá una cola de pedidos por servir. Si también existe Cocina, la cola recibe los pedidos cuando Cocina los marca como listos; si no hay Cocina, Salón recibe directamente los pedidos que cumplan la regla de integración configurada.

**Listo en Cocina** y **Entregado en Salón** son estados distintos. Que Cocina complete un pedido solo habilita su paso a la cola de servicio; la UI y RPC local permiten registrar por separado la entrega con su actor y marca de tiempo.

Los restaurantes pueden tener uno o varios pisos. Cada piso guarda la configuración de su propia grilla; se pueden ajustar tamaños relativos de filas y columnas y se persiste el resultado.

La implementación local usa tablas separadas por restaurante para pisos y mesas. Cada mesa guarda piso, posición, tamaño, número y estado. Las RPC comprueban que la posición esté dentro de la grilla y libre. `salon_open_order_links` relaciona una cuenta abierta con su mesa, evita asignar una segunda cuenta abierta a la misma mesa y permite recuperar la mesa al reabrir la cuenta. Al pagar o cancelar, se elimina ese vínculo y la ocupación se conserva mientras haya pedidos activos en Cocina o Salón.

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

La fusión local agrupa mesas visualmente, conserva los números y permite deshacer el grupo. No crea una entidad física consolidada para el servicio.

### Vista de pisos e identificación en pedidos

- Si el restaurante tiene un solo piso, la interfaz muestra solo ese piso, sin selector de múltiples pisos. Si tiene varios, permite cambiar entre ellos.
- En los pedidos, cuando hay un solo piso se identifica la mesa como **Mesa N**. Cuando hay varios, se muestra **Piso N · Mesa N** tanto a Cocina como al personal de Salón.
- El mapa de modo de visión no permite acomodar mesas ni sillas. La colocación física de sillas se hace en el restaurante; no se persisten coordenadas de sillas.

Salón no tendrá cola cuando la necesidad Salón esté desactivada. Desactivar la necesidad oculta el espacio de trabajo y conserva las mesas, pedidos y registros previos.

## Regla de dependencia

Salón puede usar Cocina para enviar comandas, pero Cocina no exige Salón: también puede atender mostrador, recojo o delivery.

## Pendientes

Aplicar y verificar la migración de Salón en Supabase. Asociar una cuenta abierta persistente con su mesa y definir el comportamiento al reabrir una mesa ocupada. También faltan reservas, reasignaciones, políticas de cancelación, permisos individuales por rol y reglas de pedidos abiertos cuando Cocina y Salón están activos.
