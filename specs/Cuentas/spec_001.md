# Black&White POS — Cuentas 001

**Estado:** Borrador inicial  
**Tipo:** Pestaña opcional por restaurante; la autenticación es infraestructura base.

## Propósito

Gestionar las personas que pueden operar un restaurante y las acciones que permite el rol de cada una.

## Alcance por especificar

- Perfil, alta, edición, suspensión y baja de cuentas del restaurante.
- Roles, permisos por módulo y asignación de sede.
- La arquitectura elegida en Setter define los roles disponibles para cada restaurante y estos se guardan asociados al restaurante.
- Cada sede puede tener una dirección opcional y un horario de atención.
- Cada empleado puede tener asignado uno o más horarios de entrada y salida.
- Invitación o contraseña temporal y cambio de contraseña.
- Historial de acciones administrativas y sesiones.
- Restricciones de administración de cuenta para proteger al último administrador.

## Reglas compartidas

- La cuenta entra a Black&White POS sin seleccionar restaurante.
- La membresía de la cuenta determina restaurante, rol y sede.
- Los permisos se aplican en base de datos además de la interfaz.
- Las cuentas de plataforma Setter se especifican separadas de las cuentas de restaurante.

## Pendientes

Definir roles predeterminados, granularidad de permisos, recuperación de acceso, política de contraseñas y casos de usuarios con varias membresías.
