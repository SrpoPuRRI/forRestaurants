# Black&White POS — Cuentas 001

**Estado:** Primera implementación en código y migración 202611120001; UI por probar por el propietario.
**Tipo:** Sección fija para todos los restaurantes. La autenticación es infraestructura base.

## Propósito

Gestionar las personas que pueden operar un restaurante y las acciones que permite el rol de cada una.

## Decisión de disponibilidad

Cuentas siempre está disponible y no se configura como una necesidad opcional. Los roles son un catálogo global; las necesidades y configuraciones determinan qué roles están disponibles y cada cuenta puede acumular roles simples. El POS controla la navegación y la base valida las acciones protegidas. La migración convierte las cuentas y roles existentes en este modelo.

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

## Alcance implementado en primera versión

- Perfil, alta, edición, baja de acceso y restauración de cuentas del restaurante.
- Roles múltiples, permisos por módulo y asignación de sede.
- Las necesidades y configuraciones del restaurante determinan los IDs de roles habilitados que guarda `restaurants`; Cuentas permite asignar a cada cuenta uno o varios de esos roles en `accounts`.
- El administrador del restaurante puede añadir o quitar necesidades opcionales después de crear el restaurante, sin recrearlo. La edición controla disponibilidad de módulos y roles; no borra registros existentes ni los mueve a otro restaurante.
- Cada sede puede tener una dirección opcional y horario semanal; un día puede estar abierto, cerrado o sin definir.
- Cada empleado puede tener asignado uno o más bloques reutilizables de horario.
- El administrador puede establecer una contraseña temporal de al menos seis caracteres; la persona debe cambiarla al siguiente inicio de sesión.
- Las cuentas se desactivan sin borrar su historial y pueden restaurarse.
- Las operaciones administrativas protegen al último administrador activo.

El alta todavía usa una contraseña inicial definida por el administrador, no invitación por correo. No hay un historial general de acciones administrativas ni sesiones.

## Nota personal de fin de mes

Cada empleado tiene una nota de texto asociada a su cuenta para apuntar información útil de fin de mes. El empleado consulta y edita su propia nota; el administrador puede consultar la nota de cada cuenta del restaurante. La nota se guarda en la base de datos y tiene una preferencia de reinicio configurable desde Configuración:

- Reinicio manual.
- Reinicio automático cada 7, 15 o 30 días.

El criterio temporal exacto para contar el intervalo, la hora de ejecución y qué ocurre con el contenido al reiniciar (borrado, archivo o historial) aún no están decididos. La interfaz no debe borrar contenido hasta definir y documentar ese comportamiento.

## Modelo de asistencia y salida

**Estado: modelo acordado e implementado en la migración 202611120001; falta la prueba funcional del propietario.** La tabla `attendance_records` guarda cada marca como evento, y `attendance_objects` agrupa el historial de cada empleado. `accounts.assistance_id` se crea al crear la cuenta y se backfill para las cuentas existentes. Cada registro conserva restaurante, sede, tipo de evento, hora efectiva, hora de registro, quién lo registró, método y motivo de corrección cuando corresponda.

### Agrupación por empleado

El propietario propone dos entidades compartidas por todos los restaurantes:

- `attendance_objects`: un objeto de asistencia asociado a un empleado, al que apunta la cuenta. Se crea al crear la cuenta del empleado, aunque todavía no existan marcas. Sirve como identificador desacoplado del historial de asistencia de esa persona.
- `attendance_records`: tabla común con todas las marcas de todos los restaurantes. Cada registro pertenece a un `attendance_object`; un objeto puede tener varios registros.

Cardinalidad: cada cuenta apunta a un objeto de asistencia creado al insertar la cuenta; el objeto agrupa cero o muchas marcas. Cada marca conserva su restaurante y sede efectivos. La creación automática y la lectura protegida por restaurante están implementadas.

El mapa de calor será una vista calculada a partir de marcas reales de entrada y salida; no se guardará un color como dato principal ni se asignará un mapa independiente al usuario. La fuente de verdad debe ser un registro de asistencia relacionado con la cuenta, restaurante, sede y turno. Debe conservar la fecha laboral, las horas efectivas de entrada/salida, quién hizo cada marca y por qué método. JSONB puede guardar metadatos variables o el detalle de auditoría, pero las relaciones y horas consultables deben quedar en columnas explícitas para filtrar y calcular el calendario con fiabilidad. Si el volumen lo requiere, se podrá añadir una vista materializada o resumen mensual regenerable.

Permisos configurables por restaurante:

- **Marcar asistencia:** empleado para sí mismo; compañero de sede para un empleado.
- **Marcar salida:** empleado para sí mismo; compañero de sede para un empleado.

Un empleado sin compañeros podrá marcar su propia entrada/salida si la opción está habilitada. La marca por compañero solo se permite entre personas de la misma sede efectiva del turno. La sede del evento es la sede asignada al turno, que puede ser una cobertura temporal distinta de la sede principal de la cuenta. El administrador puede registrar para cualquier empleado y usar la hora actual o una marca manual según el flujo anterior.

El Administrador puede marcar entrada/salida usando la hora actual o registrar una corrección manual. La corrección manual solo permitirá ayer o hoy, capturará la hora y guardará por separado la hora efectiva y quién/cuándo registró la corrección. Si el turno cruza medianoche, la interfaz permite elegir ayer u hoy para la marca correspondiente; en un turno de un solo día solo solicita hora.

Los horarios asignados son bloques reutilizables en `account_schedules`; la cuenta guarda una lista `schedule_ids` y puede tener varios bloques. La restricción actual `starts_at < ends_at` no permite turnos nocturnos. La interfaz de Cuenta no ofrece turnos que cruzan medianoche todavía.

## Pendiente: historial de asignaciones

`accounts.location_id` representa la sede principal vigente, pero no basta para reconstruir la sede de una fecha pasada. Se propone conservar asignaciones con vigencia o por turno, para soportar cobertura temporal de un día y poder responder en qué sede debía marcar asistencia una persona en una fecha anterior. Los horarios asignados también deben poder asociarse a una sede y tener vigencia. Debe registrarse cuándo la cuenta fue activada/desactivada para interpretar fechas históricas.

### Horarios y relación con cuentas

La migración convierte `account_schedules` en bloques reutilizables asociados al restaurante; cada cuenta conserva varios IDs de bloque en `schedule_ids`. No confundir horarios asignados con los registros efectivos de asistencia. La edición del bloque reutilizable, su vigencia histórica y los turnos nocturnos quedan pendientes.

### Pedidos abiertos y pedidos pagados

El esquema actual de Black&White no tiene `open_orders` ni una entidad de pedidos pagados. Se propone definir ambas. El pedido pagado debe conservar el conjunto de información que Kffe’to guarda en `orders`, `order_items` y `order_item_addons`: cabecera, líneas, agregados y snapshots históricos. Falta decidir si ese detalle se almacena en una entidad agregada o en tablas relacionadas; no copiar el esquema de Kffe’to por defecto.

## Pendiente de decisión y prueba

La fuente de verdad es una bitácora de eventos: una fila por marca efectiva. Las marcas existentes no se editan ni eliminan desde la interfaz; las correcciones manuales agregan un nuevo evento de hoy o ayer con motivo. El mapa mensual se deriva de esas marcas. Falta probar transiciones, correcciones históricas y la presentación del calendario con datos reales.

## Reglas compartidas

- La cuenta entra a Black&White POS sin seleccionar restaurante.
- La membresía de la cuenta determina restaurante, rol y sede.
- Los permisos se aplican en base de datos además de la interfaz.
- Las cuentas de plataforma Setter se especifican separadas de las cuentas de restaurante.

## Pendientes

En la primera implementación quedan por completar dirección y horario de atención de cada sede, turnos que cruzan medianoche, historial de asignaciones de sede/horarios y el historial general de acciones administrativas/sesiones. Delivery requiere definir la configuración que habilita Repartidor en la interfaz. La nota personal sigue sin reinicio automático hasta acordar retención. El administrador puede corregir asistencias de hoy o ayer; falta validar estos casos en la UI.
