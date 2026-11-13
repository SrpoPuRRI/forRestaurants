# Black&White POS — Estadísticas 001

**Estado:** `orders`, pagos y estadísticas están implementados con `202611120003_paid_orders_and_statistics.sql`; productos obligatorios y reglas de pago se completan con `202611130001_required_special_products_and_payment_rules.sql`. El propietario confirmó que los últimos cambios se publicaron y funcionan en producción el 13 de noviembre de 2026; verificar el historial remoto si una tarea posterior depende de una migración específica.
**Tipo:** Sección fija para todos los restaurantes.

## Propósito

Dar al restaurante una lectura clara de ventas, operación y desempeño dentro del alcance permitido por el rol.

## Decisión de disponibilidad

Estadísticas siempre está disponible. Qué datos aparecen y qué filtros o comportamientos se ofrecen puede configurarse desde Configuración y depender de las necesidades activas.

## Métricas principales

La vista principal sigue las cuatro métricas de Kffe’to:

1. **Saldo neto:** suma de los movimientos pagados correctos del periodo.
2. **Pedidos pagados:** cantidad de movimientos correctos.
3. **Promedio por pedido:** saldo neto dividido entre pedidos pagados correctos.
4. **Desglose por método de pago:** total agrupado según los métodos guardados en cada movimiento.

En B&W el desglose usa los métodos de pago habilitados para cobro manual y la instantánea histórica de importes/métodos de cada movimiento; un cambio posterior no reclasifica ventas pasadas. Solo se muestra la métrica de desglose cuando hay más de un método habilitado para cobro manual. Si solo está habilitado efectivo, la tarjeta no se renderiza ni aparecen métodos desactivados en ella.

## Gráfica y periodos

- En una fecha, mostrar la cantidad de pedidos pagados por hora.
- En un periodo, mostrar la cantidad por día.
- Administrador puede elegir una fecha o un rango, usar accesos rápidos de hoy, ayer, últimos 7 días y últimos 30 días, y filtrar por sede.
- Empleado ve el resumen y los movimientos de su sede para el día operativo de la caja.
- La agrupación de la interfaz sigue la fecha en que se abrió la caja. Si la caja sigue abierta después de medianoche, las operaciones posteriores continúan dentro de ese día operativo. Cada movimiento conserva su hora real; no se reemplaza por la fecha de apertura.
- La zona horaria de presentación es **America/Lima**.

## Caja y agrupación por turnos

La caja tiene un estado booleano del restaurante: `false` significa **cerrada** y `true` significa **abierta**. El administrador puede abrirla y cerrarla; durante un turno activo, Cajero, Empleado o Administrador también pueden abrirla si ese turno lo permite. Solo se puede cerrar si está abierta. Para confirmar el cierre, la persona que lo realiza debe ingresar su contraseña.

Cada apertura y cierre guarda su timestamp en un registro de aperturas de Caja. La propuesta es una fila mensual por restaurante con un JSON de fechas y turnos, por ejemplo `1/12 → turno 1 → [timestamp_apertura, timestamp_cierre]`. Una fecha puede tener uno o varios turnos, pero cada turno admite un solo periodo de Caja abierta. Tras cerrar, el turno queda cerrado definitivamente para la operación normal. Solo el administrador puede reabrirlo, en un procedimiento excepcional que elimina del JSON la marca de cierre de ese turno; así queda registrada una sola apertura y un solo cierre vigente para ese periodo.

El fin de un turno, por sí solo, no cierra Caja. Cuando el horario del turno termina, se muestra un aviso, pero se permite seguir registrando pagos si Caja continúa abierta: los restaurantes pueden operar fuera de horario o extender un turno.

Un proceso automático, que funciona aunque no haya ninguna cuenta iniciada, revisa los horarios de turnos. Si detecta que el cambio a otro turno está a menos de cinco minutos y hay un periodo de Caja abierto, cierra ese periodo automáticamente y cancela la operación en curso. Así cada periodo de Caja abierta pertenece a un único turno. Los pagos se organizan en cajas temporales; cada turno consulta sus periodos de Caja para representar cuánto se registró en ese turno. Cada movimiento conserva su propio timestamp real.

La cancelación es una regla preventiva para operaciones pendientes que pudieran existir en otros flujos; no presupone que hoy haya una operación así. Si en el futuro un flujo depende de una operación pendiente al cerrarse Caja, esta se cancela y cualquier resultado que normalmente habría sido éxito/fecha devuelve `closedCashier`. Se considera un resultado erróneo, se conserva para el manejo del flujo pero no cuenta en ninguna métrica. Si una cola u otro flujo estaba esperando ese resultado, trata `closedCashier` como error y cierra esa espera. El camino normal no debería producir este estado. El administrador recibe un aviso sobre la importancia de respetar los horarios del restaurante.

En Configuración de Estadísticas habrá una opción para mostrar separadores por turno. Es una vista: no cambia los importes, movimientos, pagos ni cálculos. El usuario puede reconocer visualmente qué ganancias corresponden a cada turno dentro del día de apertura de Caja.

## Rankings

Inspirados en Kffe’to, los rankings cuentan **unidades**, no importe de venta, y muestran hasta diez resultados:

- Productos más vendidos.
- Variantes más vendidas, identificadas junto a su producto.
- Agregados más vendidos.
- Una clasificación elegida por configuración: categorías, grupos de categorías o etiquetas. Los grupos de categorías siguen la detección de Kffe’to a partir de las relaciones entre categorías y productos.

Los rankings se calculan únicamente con movimientos correctos. Se mantienen las reglas de Configuración sobre qué rankings se muestran al administrador y cuáles puede ver cada rol. Cuando ningún ranking está habilitado o visible para el rol, no se renderiza sección ni mensaje vacío.

No se incluirán métricas de costos, márgenes, inventario ni mermas en este módulo: B&W no lleva inventario y esas métricas no forman parte del modelo actual de Kffe’to.

## Historial de movimientos

El historial muestra los movimientos del periodo, incluidos los que fueron corregidos, devueltos o cerrados con error por Caja (`closedCashier`), con su timestamp real. Esos movimientos quedan claramente marcados y **no participan** en saldo neto, cantidad de pedidos, promedio, gráfica ni rankings. Al abrir su detalle se muestra el aviso correspondiente y el actor/timestamp; la corrección de pagos no lleva motivo.

Los pedidos erróneos se conservan en historial en vez de eliminarse. B&W muestra el estado erróneo, quién confirmó y cuándo; corregir un pago no exige motivo. El contexto del empleado va en sus notas.

## Rankings y acceso por rol

Desde Configuración, el administrador puede activar o desactivar Rankings. Si están activos, elige qué rankings se muestran:

- Productos más vendidos.
- Variantes más vendidas.
- Agregados más vendidos.
- Clasificación más vendida: categorías, grupos de categorías o etiquetas.

Para activar el ranking por categorías, también debe elegir y guardar una categoría válida. Sin esa selección, el ranking por categorías permanece desactivado.

La opción **Empleados ven rankings** controla el acceso del personal. Si está desactivada, los rankings solo son visibles para el administrador. Si está activada, el administrador puede asignar el mismo conjunto de rankings a todos los roles o configurar el conjunto permitido para cada rol por separado. La edición por rol se abre desde el control de edición de ese rol en Configuración. Para el ranking de clasificación, Configuración permite escoger categorías, grupos de categorías o etiquetas.

La visibilidad de rankings no amplía el acceso de los empleados a los datos diarios. La fecha de la vista se determina por la apertura de caja, incluso cuando la caja cruza medianoche. El servidor debe aplicar el mismo alcance de sede y caja que la interfaz.

## Pendientes

La sección Estadísticas está siempre disponible para todos los restaurantes. Sus indicadores y filtros pueden configurarse; las necesidades opcionales solo pueden cambiar su comportamiento, no desactivarla.

Los reportes leen los timestamps propios de cada movimiento y el método histórico asociado a cada importe. No hace falta duplicar una fecha operativa en cada fila de movimientos: la interfaz agrupa por la fecha de apertura de caja.

Caja todavía no está implementada: falta definir cómo se valida la contraseña al cierre manual y si el reinicio mensual del JSON conserva el historial anterior en otra fila/archivo. Las devoluciones como movimiento se registran separadas de la corrección de un pago, según el producto/concepto que acuerde cada restaurante.

La configuración actual de base de datos solo guarda `rankings_categories`; falta migrar los ajustes para guardar qué tipo de clasificación se eligió (categorías, grupos o etiquetas) y los permisos por rol correspondientes.
