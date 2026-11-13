# Especificaciones de Black&White POS

Este directorio contiene las especificaciones del producto y decisiones que guían su implementación. Cada pestaña del espacio de trabajo tiene su propia carpeta y especificación. Setter tiene una especificación aparte para documentar la administración de restaurantes y la selección cerrada de necesidades opcionales.

## Documentos

- [Base de datos de Kffe’to en producción](Database/kffeto_production_reference_001.md): referencia de patrones probados para inspirar la base de Black&White, sin copiar el POS de cafetería.
- [Diseño de la app](Dise%C3%B1o%20de%20la%20app/spec_001.md): decisiones visuales y estructura común del espacio de trabajo.
- [Setter](Setter/spec_001.md): administración de necesidades y restaurantes.
- [Cuentas](Cuentas/spec_001.md)
- [CRM](CRM/spec_001.md)
- [Flujo de pedidos](Flujo%20de%20pedidos/spec_001.md)
- [Salón](Sal%C3%B3n/spec_001.md)
- [Cocina](Cocina/spec_001.md)
- [Estadísticas](Estad%C3%ADsticas/spec_001.md)
- [Catálogo](Cat%C3%A1logo/spec_001.md)
- [Configuración](Configuraci%C3%B3n/spec_001.md)
- [Decisiones pendientes por flujo](Pendientes%20por%20definir/spec_001.md): preguntas abiertas que debemos resolver antes de implementar cada módulo.
- [Portafolio web](Portafolio/spec_001.md): alcance y publicación del sitio comercial de Black&White POS en GitHub Pages y su subdominio.

## Regla de producto acordada

Todos los restaurantes tienen siempre estas secciones: **Cuentas, Estadísticas, Flujo de pedidos, Catálogo y Configuración**. No son necesidades opcionales ni se desactivan al crear el restaurante. Sus comportamientos y opciones internas pueden depender de otras necesidades y de valores configurables administrados desde Configuración. No se selecciona una arquitectura prearmada al crear el restaurante. El orden de navegación, incluyendo dónde se insertan CRM, Delivery, Cocina y Salón cuando están activos, está definido en `Diseño de la app/spec_001.md`.

Las únicas necesidades opcionales son **CRM, Cocina, Salón, Delivery y Comprobantes**. La lista es fija: no se administra ni amplía desde Setter. Setter las recoge al crear el restaurante; luego el administrador puede añadirlas o quitarlas desde Black&White POS. La app usa las necesidades activas para decidir qué espacios de trabajo y roles presentar. Quitar una necesidad revoca acceso, pero conserva los datos existentes. La autenticación es infraestructura base, independiente de la pestaña Cuentas.

La dirección de roles acordada e implementada por `202611120001_accounts_roles_attendance.sql` es un catálogo global de roles, un array de IDs habilitados en cada restaurante y un array de IDs asignados por cuenta. No hay roles mixtos predefinidos: la cuenta acumula permisos al tener varios roles. La app calcula los permisos con los roles, necesidades y configuración persistida; `Empleado` es un rol especial exclusivo que reúne los permisos disponibles en su restaurante. El mapeo de necesidades y configuraciones a roles/espacios de trabajo está en Cuentas y Configuración.

Los movimientos del restaurante usarán un desglose común para admitir hasta diez métodos de pago configurados por restaurante. Cada movimiento guarda importes por espacio, un arreglo alineado que identifica el método usado en cada espacio, el total y la hora del movimiento. El detalle de Configuración y Flujo de pedidos fija el comportamiento y la preservación histórica de esos métodos.

Las especificaciones funcionales registran decisiones y pendientes; la existencia de una especificación no significa que el módulo esté implementado. El avance local de los espacios opcionales y las dependencias para probarlos se registra en `HANDOFF.md`.
