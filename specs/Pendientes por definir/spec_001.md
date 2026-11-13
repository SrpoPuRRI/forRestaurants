# Black&White POS — Decisiones pendientes por flujo 001

**Estado:** Lista de preguntas abiertas para cerrar antes de implementar los flujos correspondientes.

Este documento reúne las decisiones funcionales que todavía requieren conversación. Una pregunta pendiente no cambia por sí sola las decisiones ya registradas en la especificación de su módulo.

## Cuentas, roles y necesidades

- ¿Qué permisos exactos corresponden a cada rol?
- Al quitar una necesidad, ¿qué hacemos con los roles que ya tienen asignados los empleados? Si se vuelve a activar, ¿se restauran?
- ¿Cómo se administran las asignaciones de horarios y cómo se conserva su historial cuando cambian?

## Asistencias

- ¿Qué información guarda cada marca además de empleado, hora y sede?
- ¿Se registra entrada y salida, y cómo se corrigen marcas equivocadas?
- ¿Quién puede marcar la asistencia de otra persona y bajo qué condiciones?
- ¿Cómo se relaciona cada marca con el horario y la sede vigentes en ese momento?

## Catálogo

- ¿Fuera de stock aplica al producto entero, a una variante, a un agregado o a los tres por separado?
- ¿Marcar un producto fuera de stock debe afectar sus variantes y agregados?
- ¿Quién puede volver a marcar algo disponible y desde qué pantalla?
- ¿Se requieren precios o disponibilidad diferentes por sede o canal?
- ¿Qué pasa si se intenta eliminar algo usado por pedidos históricos?

## Flujo de pedidos

- ¿Qué canales y estados tendrá un pedido?
- ¿Qué información conserva un pedido abierto y cuándo se convierte en pagado?
- ¿Cómo funcionan pagos divididos, devoluciones y pedidos correctivos?
- ¿Cómo se evita que dos personas sobrescriban cambios simultáneos?

## Cocina

- ¿La cola recibe pedidos abiertos, pagados o ambos? ¿Qué condición exacta los incorpora?
- El flujo admite marcar el pedido, un artículo o unidades individuales. ¿Cómo se combinan esas opciones cuando un pedido tiene varios artículos y cantidades?
- ¿Qué pasa si una parte no se puede preparar? ¿Cómo se relaciona esa marca con declarar el producto fuera de stock para pedidos nuevos?
- Cuando Cocina marca listo y no existe Salón, ¿a dónde pasa el pedido?
- ¿Qué ocurre al cancelar o cambiar un pedido que ya está en preparación?
- ¿Cómo se limpian las entradas completadas tras dos días y qué historial se conserva fuera de la cola?

## Salón

- ¿Cómo se abren, transfieren, dividen y cierran las cuentas de mesa?
- ¿Cómo se evita mostrar al mesero pedidos que todavía no están listos cuando Salón recibe pedidos abiertos?
- ¿Qué significa fusionar mesas en los datos: cuál conserva el número y cómo se deshace?
- ¿Cómo se identifican las mesas ocupadas, libres o con pedidos pendientes?
- ¿Cómo se asignan pedidos y meseros a una mesa?

## Combinaciones de Cocina, Salón y Delivery

- Falta definir reglas para cada combinación: solo Salón, solo Cocina, Cocina con Delivery, y Cocina con Salón y Delivery.
- ¿Qué ajuste controla cada entrada a las colas y cómo interactúan los ajustes de pedido abierto, pago normal y pago virtual de Delivery?

## Estadísticas

- Definir cómo se valida la contraseña al cerrar Caja manualmente y si corresponde a la autenticación actual de la cuenta.
- Definir si el reinicio mensual del JSON de aperturas conserva el historial anterior en otra fila/archivo o elimina esos datos, y cuánto tiempo se conserva.
- Definir la representación de devoluciones cuando se diseñe el flujo de pedidos.
- Migrar la configuración de rankings, que hoy solo tiene `rankings_categories`, para persistir la clasificación elegida (categorías, grupos o etiquetas) y sus permisos por rol.

Métricas, periodos, rankings, zona horaria y agrupación después de medianoche ya están definidos en la especificación de [Estadísticas](../Estad%C3%ADsticas/spec_001.md): se inspiran en Kffe’to; las métricas usan solo movimientos correctos; el historial conserva los corregidos/devueltos con aviso; la interfaz agrupa por la fecha de apertura de Caja y cada evento conserva su timestamp real.

## Estado de implementación de base de datos

El catálogo, los roles globales y múltiples, la asistencia y los pedidos abiertos/pagados ya tienen tablas y RPC en las migraciones del repositorio; el propietario confirmó el 13 de noviembre de 2026 que los últimos cambios están en producción. Las decisiones de Caja, varias combinaciones de Cocina/Salón/Delivery, pagos divididos genéricos, el tipo/permisos del ranking de taxonomía y algunos detalles de asistencia siguen pendientes de especificar o terminar. Consulta cada spec y verifica el historial remoto antes de una migración posterior.
