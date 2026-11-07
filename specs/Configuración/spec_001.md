# Black&White POS — Configuración 001

**Estado:** Borrador inicial  
**Tipo:** Pestaña configurable por restaurante; los permisos y el alcance administrativo se precisarán aquí.

## Propósito

Centralizar la identidad y los ajustes operativos de un restaurante en un área distinta del Catálogo.

## Alcance por especificar

- Datos comerciales, logo, idioma, moneda, zona horaria y horarios de atención.
- Sedes, impuestos y reglas de servicio.
- Preferencias de operación y parámetros de módulos activos.
- Métodos de pago e integraciones.
- Dispositivos, estaciones, impresoras y formatos de tickets.
- Seguridad, notificaciones, exportación y auditoría.
- Definiciones de configuraciones disponibles y valores admitidos por arquitectura; valores propios del restaurante separados de ese catálogo.

## Propuesta de catálogo de configuraciones

Separar tres conceptos:

1. **Catálogo maestro de configuraciones:** clave estable, etiqueta, tipo de valor, opciones/rango permitido, valor predeterminado, área y descripción.
2. **Disponibilidad por arquitectura:** relaciones que indican qué claves puede usar cada versión de arquitectura y, si aplica, qué necesidad las activa.
3. **Valor por restaurante:** solo una fila para cada configuración disponible que el restaurante tenga seleccionada; validada con la definición del catálogo.

Ejemplo de la configuración de asistencia (propuesta, aún sin SQL): cuatro valores booleanos independientes, como `attendance.check_in.self`, `attendance.check_in.peer_at_location`, `attendance.check_out.self` y `attendance.check_out.peer_at_location`. Setter decide qué configuraciones están disponibles según arquitectura; la pestaña Configuración del restaurante administra sus valores. La interfaz consulta disponibilidad y valor efectivo para construir los controles; las políticas/RPC del servidor vuelven a validar disponibilidad y permisos en cada operación.

El almacenamiento JSON puede servir para un grupo de valores relacionados, pero cada clave debe tener esquema/tipo validado desde servidor. No confiar solo en que la interfaz oculte controles.

## Decisiones compartidas

- El logo binario se almacenará en Storage; la base de datos conservará la ruta y metadatos.
- Impresión y formatos de tickets no pertenecen al Catálogo.
- El flujo de impresión de Kffe’to POS no es el flujo predeterminado de B&W.

## Pendientes

Definir qué ajustes puede cambiar el administrador del restaurante, cuáles controla Setter, y qué sucede si esta pestaña se desactiva desde Setter.
