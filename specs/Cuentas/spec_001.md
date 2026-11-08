# Black&White POS — Cuentas 001

**Estado:** Borrador inicial  
**Tipo:** Sección fija para todos los restaurantes. La autenticación es infraestructura base.

## Propósito

Gestionar las personas que pueden operar un restaurante y las acciones que permite el rol de cada una.

## Decisión de disponibilidad

Cuentas siempre está disponible y no se configura como una necesidad opcional. Sus roles disponibles derivan de las necesidades seleccionadas y los roles que el operador habilitó; su comportamiento también puede variar por opciones que el administrador del restaurante controla desde Configuración. Los permisos de asistencia descritos abajo son un ejemplo de esas opciones.

## Alcance por especificar

- Perfil, alta, edición, suspensión y baja de cuentas del restaurante.
- Roles, permisos por módulo y asignación de sede.
- Las necesidades seleccionadas determinan qué roles puede habilitar el administrador dentro de la app POS. Los roles habilitados se asocian al restaurante y determinan las opciones al crear cuentas.
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

El mapa de calor será una vista calculada a partir de marcas reales de entrada y salida; no se guardará un color como dato principal ni se asignará un mapa independiente al usuario. La fuente de verdad debe ser un registro de asistencia relacionado con la cuenta, restaurante, sede y turno. Debe conservar la fecha laboral, las horas efectivas de entrada/salida, quién hizo cada marca y por qué método. JSONB puede guardar metadatos variables o el detalle de auditoría, pero las relaciones y horas consultables deben quedar en columnas explícitas para filtrar y calcular el calendario con fiabilidad. Si el volumen lo requiere, se podrá añadir una vista materializada o resumen mensual regenerable.

Permisos configurables por restaurante:

- **Marcar asistencia:** empleado para sí mismo; compañero de sede para un empleado.
- **Marcar salida:** empleado para sí mismo; compañero de sede para un empleado.

Un empleado sin compañeros podrá marcar su propia entrada/salida si la opción está habilitada. La marca por compañero solo se permite entre personas de la misma sede efectiva del turno. La sede del evento es la sede asignada al turno, que puede ser una cobertura temporal distinta de la sede principal de la cuenta. El administrador puede registrar para cualquier empleado y usar la hora actual o una marca manual según el flujo anterior.

El Administrador puede marcar entrada/salida usando la hora actual o registrar una corrección manual. La corrección manual solo permitirá ayer o hoy, capturará la hora y guardará por separado la hora efectiva y quién/cuándo registró la corrección. Si el turno cruza medianoche, la interfaz permite elegir ayer u hoy para la marca correspondiente; en un turno de un solo día solo solicita hora.

Un horario que cruza medianoche debe indicar explícitamente el desplazamiento del día de salida o fechas de inicio/fin. La restricción actual `starts_at < ends_at` en la migración inicial no permite turnos nocturnos y necesita revisarse antes de implementar esta propuesta.

## Propuesta de historial de asignaciones

`accounts.location_id` representa la sede principal vigente, pero no basta para reconstruir la sede de una fecha pasada. Se propone conservar asignaciones con vigencia o por turno, para soportar cobertura temporal de un día y poder responder en qué sede debía marcar asistencia una persona en una fecha anterior. Los horarios asignados también deben poder asociarse a una sede y tener vigencia. Debe registrarse cuándo la cuenta fue activada/desactivada para interpretar fechas históricas.

## Pendiente de decisión

Definir si la fuente principal será una fila por turno con columnas de entrada/salida más eventos JSON de auditoría, o una bitácora de eventos append-only. En ambos casos el mapa mensual se deriva de las marcas y del horario vigente; no se acepta editar o borrar silenciosamente una marca histórica.

## Reglas compartidas

- La cuenta entra a Black&White POS sin seleccionar restaurante.
- La membresía de la cuenta determina restaurante, rol y sede.
- Los permisos se aplican en base de datos además de la interfaz.
- Las cuentas de plataforma Setter se especifican separadas de las cuentas de restaurante.

## Pendientes

Definir roles predeterminados, granularidad de permisos, recuperación de acceso, política de contraseñas y casos de usuarios con varias membresías.
