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

## Decisiones compartidas

- El logo binario se almacenará en Storage; la base de datos conservará la ruta y metadatos.
- Impresión y formatos de tickets no pertenecen al Catálogo.
- El flujo de impresión de Kffe’to POS no es el flujo predeterminado de B&W.

## Pendientes

Definir qué ajustes puede cambiar el administrador del restaurante, cuáles controla Setter, y qué sucede si esta pestaña se desactiva desde Setter.
