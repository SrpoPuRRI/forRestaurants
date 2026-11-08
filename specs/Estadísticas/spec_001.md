# Black&White POS — Estadísticas 001

**Estado:** Borrador inicial  
**Tipo:** Sección fija para todos los restaurantes.

## Propósito

Dar al restaurante una lectura clara de ventas, operación y desempeño dentro del alcance permitido por el rol.

## Decisión de disponibilidad

Estadísticas siempre está disponible. Qué datos aparecen y qué filtros o comportamientos se ofrecen puede configurarse desde Configuración y depender de las necesidades activas.

## Alcance por especificar

- Ventas, pedidos, promedio por pedido y ventas por hora.
- Desglose por canal, sede, producto, categoría y método de pago.
- Historial de cobros, devoluciones, anulaciones y caja.
- Rendimiento de productos, costos, márgenes, inventario y mermas cuando aplique.
- Comparaciones por periodo y exportación de informes.

## Rankings y acceso por rol

Desde Configuración, el administrador puede activar o desactivar Rankings. Si están activos, elige qué rankings se muestran:

- Productos más vendidos.
- Variantes más vendidas.
- Agregados más vendidos.
- Categorías más vendidas.

Para activar el ranking por categorías, también debe elegir y guardar una categoría válida. Sin esa selección, el ranking por categorías permanece desactivado.

La opción **Empleados ven rankings** controla el acceso del personal. Si está desactivada, los rankings solo son visibles para el administrador. Si está activada, el administrador puede asignar el mismo conjunto de rankings a todos los roles o configurar el conjunto permitido para cada rol por separado. La edición por rol se abre desde el control de edición de ese rol en Configuración.

La visibilidad de rankings no amplía el acceso de los empleados a los datos diarios: cada empleado solo consulta las estadísticas del día de su jornada. Al cambiar el día pierde el acceso al día anterior, excepto si su turno cruza medianoche; en ese caso conserva acceso hasta terminar el turno. La base de datos y la autorización del servidor deben aplicar el mismo límite que la interfaz.

## Pendientes

La sección Estadísticas está siempre disponible para todos los restaurantes. Sus indicadores y filtros pueden configurarse; las necesidades opcionales solo pueden cambiar su comportamiento, no desactivarla.

Los reportes de pagos deben leer el total y el desglose de hasta diez espacios por movimiento junto con el arreglo histórico de métodos usado en ese movimiento. Los resultados agrupan por el método registrado en cada movimiento, no por la lista actual de métodos configurada.

Definir fórmulas de cada ranking, zona horaria, comportamiento de operaciones anuladas y métricas según módulos activos. Definir también la regla de cálculo de un turno que cruza medianoche y cómo se comprueba que ya terminó.
