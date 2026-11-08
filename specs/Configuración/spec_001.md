# Black&White POS — Configuración 001

**Estado:** Borrador inicial  
**Tipo:** Sección fija para todos los restaurantes; contiene las opciones configurables del restaurante.

## Propósito

Centralizar la identidad y los ajustes operativos de un restaurante en un área distinta del Catálogo.

## Decisión de disponibilidad

Configuración siempre está disponible. Además de ajustes generales, administra las opciones de comportamiento de las secciones fijas (Cuentas, Estadísticas, Flujo de pedidos y Catálogo). La app presenta opciones extra según las necesidades CRM, Cocina, Salón, Delivery y Comprobantes seleccionadas para el restaurante.

## Alcance por especificar

- Datos comerciales, logo, idioma, moneda, zona horaria y horarios de atención.
- Sedes, impuestos y reglas de servicio.
- Preferencias de operación y parámetros de módulos activos.
- Métodos de pago e integraciones.
- Dispositivos, estaciones, impresoras y formatos de tickets.
- Seguridad, notificaciones, exportación y auditoría.
- Preferencias operativas del restaurante y sus valores guardados en las columnas o tablas de dominio correspondientes.

## Métodos de pago configurables

El administrador activa o desactiva cada método de pago. Al activar uno, el POS ofrece casillas separadas para habilitar su modalidad manual o automática, según lo permitido:

| Método | Manual | Automático |
| --- | --- | --- |
| Efectivo | Sí | No |
| Yape | Sí | Sí |
| Plin | Sí | Sí |
| Transferencia bancaria directa | Sí | No |
| Tarjetas | Sí | Sí |

Las modalidades automática de Yape, Plin y tarjeta requieren definir proveedor, conexión y confirmación antes de implementarse. La opción automática no se considera disponible solo por marcarla si no existe una integración configurada. El flujo de pedidos muestra únicamente los métodos y modalidades habilitados. Cada cobro conserva la instantánea histórica de métodos descrita en su spec.

## Opciones de secciones fijas

- **Cuentas:** modo de reinicio de la nota personal del empleado: manual o automático. En automático, intervalo de 7, 15 o 30 días. El contenido se guarda en la base; el momento exacto, la zona horaria, la retención y si se archiva o se borra al reiniciar quedan pendientes.
- **Estadísticas:** activar/desactivar rankings y elegir productos más vendidos, variantes más vendidas, agregados más vendidos y categorías más vendidas. Para habilitar ranking por categoría se debe escoger una categoría y guardar; si no se guarda una categoría válida, la casilla permanece desmarcada.
- **Visibilidad de rankings:** opción independiente para que los empleados vean rankings. Desactivada, los rankings quedan visibles para el administrador. Activada, se puede aplicar el mismo conjunto a todos los roles o configurar conjuntos por rol. Si se personaliza por rol, cada rol tiene un control para editar sus rankings permitidos.
- **Flujo de pedidos:** sus ajustes de límites y permisos se administran aquí; todavía quedan por definir otros ajustes propios.
- **Flujo de pedidos — límites de importe:** se puede habilitar el mínimo y/o máximo de importe del pedido. La configuración define el importe y a quién se aplica: administrador y/o empleados; si se habilitan empleados, se seleccionan los roles autorizados. El detalle de si el control bloquea, advierte o permite excepciones queda por definir.
- **Flujo de pedidos — pedidos correctivos/devoluciones:** el administrador decide si puede realizarlos y si se habilitan para empleados. Para empleados, se eligen explícitamente los roles autorizados.
- **Catálogo:** habilitar o deshabilitar Agregados, Grupos de categorías y Promociones. Al habilitar Promociones, el administrador las define en Catálogo y los empleados pueden aplicarlas al cobrar un pedido cuando la promoción cumpla sus condiciones.

Los controles por rol solo pueden referirse a roles disponibles y habilitados para ese restaurante. Al quitar un rol, sus ajustes de visibilidad deben quedar sin efecto y no conceder acceso a otro rol automáticamente.

## Modelo de configuración dentro del POS

- Las configuraciones las ve y administra el administrador del restaurante dentro de la app POS; no se editan desde Setter.
- La app determina qué controles presentar usando las necesidades seleccionadas y las secciones fijas. Las cuatro opciones de asistencia pertenecen a Cuentas > Configuración del restaurante y se muestran allí al administrador.
- No se usará una tabla genérica `configuration_catalog`/`architecture_configurations` como catálogo de ajustes. Los valores se guardan en columnas de `restaurants` o en tablas de dominio específicas, con nombres, tipos y relaciones explícitos.
- Ejemplos: interruptores de delivery propio o proveedor externo y sus datos asociados pueden ser campos de restaurante; los métodos de pago deben persistirse en una estructura propia de pagos, no como necesidad ni arquitectura.
- La app puede ocultar controles irrelevantes, pero el servidor también debe validar permisos y valores antes de guardar.
- La estructura exacta de cada conjunto de ajustes se definirá en su sección funcional antes de implementar SQL.

## Decisiones compartidas

- El logo binario se almacenará en Storage; la base de datos conservará la ruta y metadatos.
- Impresión y formatos de tickets no pertenecen al Catálogo.
- El flujo de impresión de Kffe’to POS no es el flujo predeterminado de B&W.

## Métodos de pago por restaurante

- Los métodos de pago son una configuración del restaurante, no una necesidad ni una arquitectura independiente. Su lista puede cambiarse y versionarse desde Configuración.
- La lista actual tiene cinco métodos base configurables; cada movimiento conserva hasta diez espacios de importe para pagos divididos. No es necesario ocupar todos los espacios en cada cobro.
- Flujo de pedidos obtiene de esta configuración los métodos que ofrece al cobrar. Una actualización afecta operaciones nuevas, no reinterpreta movimientos históricos.
- Cada movimiento conserva junto a su timestamp una copia ordenada de los tipos de método usados. Así se puede interpretar su desglose aunque más adelante cambie la configuración del restaurante.
- El formato del desglose y las reglas de conciliación quedan por detallar en la especificación de Flujo de pedidos. Los métodos se configuran dentro del POS; no requieren una arquitectura ni un catálogo genérico.

## Pendientes

Definir qué campos y tablas corresponden a cada ajuste, qué permisos tiene el administrador y qué dependencias entre necesidades opcionales y secciones fijas aplican.
