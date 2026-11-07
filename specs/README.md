# Especificaciones de Black&White POS

Este directorio contiene las especificaciones del producto antes de pasar a implementación. Cada pestaña del espacio de trabajo tiene su propia carpeta y especificación. Setter tiene una especificación aparte para documentar la arquitectura de la plataforma y la administración de restaurantes.

## Documentos

- [Base de datos de Kffe’to en producción](Database/kffeto_production_reference_001.md): referencia de patrones probados para inspirar la base de Black&White, sin copiar el POS de cafetería.
- [Diseño de la app](Dise%C3%B1o%20de%20la%20app/spec_001.md): decisiones visuales y estructura común del espacio de trabajo.
- [Setter](Setter/spec_001.md): arquitectura propuesta para administrar restaurantes y activar módulos.
- [Cuentas](Cuentas/spec_001.md)
- [CRM](CRM/spec_001.md)
- [Flujo de pedidos](Flujo%20de%20pedidos/spec_001.md)
- [Salón](Sal%C3%B3n/spec_001.md)
- [Cocina](Cocina/spec_001.md)
- [Estadísticas](Estad%C3%ADsticas/spec_001.md)
- [Catálogo](Cat%C3%A1logo/spec_001.md)
- [Configuración](Configuraci%C3%B3n/spec_001.md)

## Regla de producto acordada

Las ocho pestañas son módulos configurables por restaurante desde Setter. La selección hecha al crear un restaurante determina qué pestañas y funciones ve ese cliente, junto con los permisos de su cuenta. El acceso de autenticación necesario para entrar a Black&White POS es infraestructura base y no depende de que la pestaña de gestión de Cuentas esté activada.

Las especificaciones están en borrador y se completarán antes de implementar sus funciones.
