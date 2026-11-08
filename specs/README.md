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

## Regla de producto acordada

Todos los restaurantes tienen siempre estas secciones: **Cuentas, Estadísticas, Flujo de pedidos, Catálogo y Configuración**. No son necesidades opcionales ni se desactivan al crear el restaurante. Sus comportamientos y opciones internas pueden depender de otras necesidades y de valores configurables administrados desde Configuración. No se selecciona una arquitectura prearmada al crear el restaurante.

Las únicas necesidades opcionales marcables al crear un restaurante son **CRM, Cocina, Salón, Delivery y Comprobantes**. La lista es fija: no se administra ni amplía desde Setter. La app POS usa las necesidades elegidas para decidir qué configuraciones y roles presentar al administrador. La autenticación necesaria para entrar a Black&White POS es infraestructura base, independiente de la pestaña Cuentas.

Los movimientos del restaurante usarán un desglose común para admitir hasta diez métodos de pago configurados por restaurante. Cada movimiento guarda importes por espacio, un arreglo alineado que identifica el método usado en cada espacio, el total y la hora del movimiento. El detalle de Configuración y Flujo de pedidos fija el comportamiento y la preservación histórica de esos métodos.

Las especificaciones funcionales siguen en borrador y se completarán antes de implementar cada módulo operativo.
