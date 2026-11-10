# Black&White POS — Cuentas 001

**Estado:** Borrador inicial  
**Tipo:** Sección fija para todos los restaurantes. La autenticación es infraestructura base.

## Propósito

Gestionar las personas que pueden operar un restaurante y las acciones que permite el rol de cada una.

## Decisión de disponibilidad

Cuentas siempre está disponible y no se configura como una necesidad opcional. Los roles son un catálogo global de la app; el POS calcula sus permisos a partir de los roles asignados, las necesidades del restaurante y las opciones que el administrador guarda en Configuración. Las preferencias de asistencia descritas abajo no definen el modelo de registros de asistencia, que queda pendiente de discusión.

## Roles acordados

No existen roles mixtos predefinidos. Los permisos de una cuenta se acumulan al asignarle varios roles simples disponibles para su restaurante. Por ejemplo, para que una persona pueda cocinar y cobrar, se le asignan **Cocinero** y **Cajero**; no se crea un rol llamado «Cocinero/cajero».

El catálogo global incluye los roles **Administrador**, **Empleado**, **Cajero**, **Cocinero**, **Mesero**, **Portero**, **Barista**, **Bartender**, **Social Manager** y **Repartidor**. Que existan en el catálogo no significa que todos estén disponibles para cada restaurante.

Todos los restaurantes empiezan con **Administrador** y **Empleado**. Las necesidades y las configuraciones del restaurante determinan cuáles roles adicionales se añaden a su array de roles disponibles:

- **Cocina:** añade **Cocinero**. Si el administrador activa «Tengo una barra separada de la cocina», añade **Barista** y **Bartender**, y habilita el espacio de trabajo **Barra** además de **Cocina**.
- **Salón:** añade **Mesero** y **Portero**; ambos pueden acceder al espacio de trabajo **Salón**.
- **CRM:** añade **Social Manager**, con acceso a la pestaña **CRM**.
- **Delivery:** puede añadir **Repartidor** cuando estén activadas las configuraciones requeridas. Cuáles son esas configuraciones queda pendiente.
- **Comprobantes:** no añade roles ni espacios de trabajo por sí sola.

Si el restaurante tiene al menos una necesidad opcional distinta de **Comprobantes**, **Cajero** se incluye en los roles disponibles, además de los roles implicados por las necesidades. Si se quitan todas las necesidades opcionales distintas de Comprobantes, Cajero se quita de los roles disponibles; **Empleado** representa conceptualmente la capacidad de caja en ese caso.

**Empleado** es un rol especial y exclusivo: no se combina con otros roles. Concede los permisos de todos los roles disponibles para ese restaurante. Si el restaurante solo selecciona Comprobantes, sus roles disponibles siguen siendo Administrador y Empleado.

El catálogo global `roles` no pertenece a restaurantes ni a cuentas y no debe tener claves foráneas hacia ellas. `restaurants` guardará un array con los IDs de rol habilitados según sus necesidades y configuración; `accounts` guardará un array con los IDs asignados a cada cuenta. La app web calcula los permisos efectivos a partir de esos arrays y de la configuración del restaurante. El backend debe validar las mismas reglas al autorizar operaciones.

Ejemplo: Setter crea el restaurante con la necesidad **Cocina**; quedan disponibles **Cocinero** y **Cajero**, porque existe una necesidad distinta de Comprobantes. En Cuentas, el administrador puede asignar ambos roles a la misma persona. Si además activa «Tengo una barra separada de la cocina», quedan disponibles Barista y Bartender y aparece el espacio de trabajo Barra.

## Alcance por especificar

- Perfil, alta, edición, suspensión y baja de cuentas del restaurante.
- Roles, permisos por módulo y asignación de sede.
- Las necesidades y configuraciones del restaurante determinan los IDs de roles habilitados que guarda `restaurants`; Cuentas permite asignar a cada cuenta uno o varios de esos roles en `accounts`.
- El administrador del restaurante puede añadir o quitar necesidades opcionales después de crear el restaurante, sin recrearlo. La edición controla disponibilidad de módulos y roles; no borra registros existentes ni los mueve a otro restaurante.
- Cada sede puede tener una dirección opcional y un horario de atención.
- Cada empleado puede tener asignado uno o más horarios de entrada y salida.
- Invitación o contraseña temporal y cambio de contraseña.
- Historial de acciones administrativas y sesiones.
- Restricciones de administración de cuenta para proteger al último administrador.

## Nota personal de fin de mes

Cada empleado tiene una nota de texto asociada a su cuenta para apuntar información útil de fin de mes. El empleado consulta y edita su propia nota; el administrador puede consultar la nota de cada cuenta del restaurante. La nota se guarda en la base de datos y tiene una preferencia de reinicio configurable desde Configuración:

- Reinicio manual.
- Reinicio automático cada 7, 15 o 30 días.

El criterio temporal exacto para contar el intervalo, la hora de ejecución y qué ocurre con el contenido al reiniciar (borrado, archivo o historial) aún no están decididos. La interfaz no debe borrar contenido hasta definir y documentar ese comportamiento.

## Propuesta de asistencia y salida

**Estado: pendiente de discusión; no representa un modelo aprobado ni implementado.** El esquema actual de Black&White no tiene una tabla de registros de asistencia. Las columnas `attendance_*` de `restaurants` solo guardan preferencias para permitir ciertas acciones; no guardan marcas de entrada/salida. Tampoco existe `accounts.assistance_id`.

### Propuesta de agrupación por empleado

El propietario propone dos entidades compartidas por todos los restaurantes:

- `attendance_objects`: un objeto de asistencia asociado a un empleado, al que apunta la cuenta. Se crea al crear la cuenta del empleado, aunque todavía no existan marcas. Sirve como identificador desacoplado del historial de asistencia de esa persona.
- `attendance_records`: tabla común con todas las marcas de todos los restaurantes. Cada registro pertenece a un `attendance_object`; un objeto puede tener varios registros.

Cardinalidad acordada: cada cuenta de empleado apunta a un objeto de asistencia, creado junto con la cuenta; ese objeto agrupa cero o muchas marcas. La implementación deberá mantener coherentes la creación de ambos registros. En particular, no se añadirá una segunda referencia redundante al empleado sin definir cómo impedir inconsistencias entre ambos vínculos. Cada marca deberá poder determinar su restaurante y sede efectivos para aplicar aislamiento y permisos.

El mapa de calor será una vista calculada a partir de marcas reales de entrada y salida; no se guardará un color como dato principal ni se asignará un mapa independiente al usuario. La fuente de verdad debe ser un registro de asistencia relacionado con la cuenta, restaurante, sede y turno. Debe conservar la fecha laboral, las horas efectivas de entrada/salida, quién hizo cada marca y por qué método. JSONB puede guardar metadatos variables o el detalle de auditoría, pero las relaciones y horas consultables deben quedar en columnas explícitas para filtrar y calcular el calendario con fiabilidad. Si el volumen lo requiere, se podrá añadir una vista materializada o resumen mensual regenerable.

Permisos configurables por restaurante:

- **Marcar asistencia:** empleado para sí mismo; compañero de sede para un empleado.
- **Marcar salida:** empleado para sí mismo; compañero de sede para un empleado.

Un empleado sin compañeros podrá marcar su propia entrada/salida si la opción está habilitada. La marca por compañero solo se permite entre personas de la misma sede efectiva del turno. La sede del evento es la sede asignada al turno, que puede ser una cobertura temporal distinta de la sede principal de la cuenta. El administrador puede registrar para cualquier empleado y usar la hora actual o una marca manual según el flujo anterior.

El Administrador puede marcar entrada/salida usando la hora actual o registrar una corrección manual. La corrección manual solo permitirá ayer o hoy, capturará la hora y guardará por separado la hora efectiva y quién/cuándo registró la corrección. Si el turno cruza medianoche, la interfaz permite elegir ayer u hoy para la marca correspondiente; en un turno de un solo día solo solicita hora.

Un horario que cruza medianoche debe indicar explícitamente el desplazamiento del día de salida o fechas de inicio/fin. La restricción actual `starts_at < ends_at` en la migración inicial no permite turnos nocturnos y necesita revisarse antes de implementar esta propuesta.

## Propuesta de historial de asignaciones

`accounts.location_id` representa la sede principal vigente, pero no basta para reconstruir la sede de una fecha pasada. Se propone conservar asignaciones con vigencia o por turno, para soportar cobertura temporal de un día y poder responder en qué sede debía marcar asistencia una persona en una fecha anterior. Los horarios asignados también deben poder asociarse a una sede y tener vigencia. Debe registrarse cuándo la cuenta fue activada/desactivada para interpretar fechas históricas.

### Horarios y relación con cuentas

Actualmente `account_schedules` guarda un horario por fila y lo relaciona mediante `auth_user_id`; por lo tanto, ya permite varias filas/horarios para una misma cuenta. No existe una entidad de horarios reutilizables. Se propone revisar el modelo para usar una entidad de horarios y una relación de asignación a cuentas, identificadas con el ID de cuenta; el detalle físico (incluido si se almacena una lista en `accounts` o una tabla de relación) queda por decidir. No confundir horarios asignados con los registros efectivos de asistencia.

### Pedidos abiertos y pedidos pagados

El esquema actual de Black&White no tiene `open_orders` ni una entidad de pedidos pagados. Se propone definir ambas. El pedido pagado debe conservar el conjunto de información que Kffe’to guarda en `orders`, `order_items` y `order_item_addons`: cabecera, líneas, agregados y snapshots históricos. Falta decidir si ese detalle se almacena en una entidad agregada o en tablas relacionadas; no copiar el esquema de Kffe’to por defecto.

## Pendiente de decisión

Definir si la fuente principal será una fila por turno con columnas de entrada/salida más eventos JSON de auditoría, o una bitácora de eventos append-only. En ambos casos el mapa mensual se deriva de las marcas y del horario vigente; no se acepta editar o borrar silenciosamente una marca histórica.

## Reglas compartidas

- La cuenta entra a Black&White POS sin seleccionar restaurante.
- La membresía de la cuenta determina restaurante, rol y sede.
- Los permisos se aplican en base de datos además de la interfaz.
- Las cuentas de plataforma Setter se especifican separadas de las cuentas de restaurante.

## Pendientes

Definir el catálogo y los IDs globales de roles, cómo se almacenan/validan las listas de roles habilitados y asignados, qué permisos concretos aporta cada rol base, qué capacidades cruzadas se configuran, recuperación de acceso, política de contraseñas y casos de usuarios con varias membresías. Discutir y aprobar por separado el modelo de registros de asistencia.
