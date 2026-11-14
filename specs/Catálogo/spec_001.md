# Black&White POS — Catálogo 001

**Estado:** Base de datos e interfaz inicial implementadas en desarrollo; falta aplicar migraciones al proyecto Supabase.
**Tipo:** Sección fija para todos los restaurantes.

## Propósito

Administrar la oferta que el restaurante vende en sus diferentes sedes y canales.

## Decisión de disponibilidad

Catálogo siempre está disponible. Las necesidades opcionales pueden cambiar disponibilidad, sedes o canales de venta; no convierten Catálogo en una sección opcional. Sus opciones propias se definirán desde Configuración.

## Alcance por especificar

- Productos, categorías, variantes, modificadores, agregados y combos.
- Precio, descripción, foto, impuestos, disponibilidad y orden de presentación.
- Menús por sede, horario o canal.
- Importación, cambios masivos y archivo de productos.
- Relación con ingredientes e inventario si esos módulos están activos.

## Opciones habilitables desde Configuración

El administrador puede habilitar o deshabilitar estas capacidades del Catálogo:

- **Agregados:** administrar agregados que se ofrecen junto con productos y que pueden seleccionarse en un pedido.
- **Grupos de categorías:** organizar categorías en grupos. La estructura y el uso de estos grupos quedan por definir.
- **Promociones:** administrar promociones en Catálogo. Si esta opción está habilitada, los empleados pueden aplicar una promoción al cobrar un pedido cuando se cumplan sus condiciones; la validación debe hacerse también en el servidor.

Estas opciones no convierten Catálogo en una necesidad opcional. Promociones se habilita desde Configuración y su definición/administración se realiza dentro de Catálogo.

## Límite acordado

El Catálogo no administra impresoras ni formatos de tickets. Esos ajustes vivirán en Configuración.

## Modelo y disponibilidad implementados

La migración `202611100001_restaurant_catalog.sql` crea un catálogo aislado por `restaurant_id`: `categories`, `tags`, `products`, `variants`, `addons`, `product_categories`, `product_tags`, `product_addons` y `variant_locations`. Las tablas aplican RLS por restaurante; las escrituras quedan limitadas al administrador. Las variantes pertenecen a un producto y pueden ofrecerse por sede. Un producto activo debe conservar al menos una variante.

En B&W, `is_active` expresa disponibilidad para vender, no visibilidad del catálogo. Un producto, variante o agregado marcado fuera de stock sigue apareciendo; al intentar elegirlo, la interfaz muestra un diálogo propio con **Aceptar** y no lo agrega al pedido. Volver a marcarlo disponible restaura su venta. Administrador puede administrar estos estados en Catálogo; Empleado puede marcar productos fuera de stock o disponibles desde el menú de pedidos mediante una operación de servidor limitada a disponibilidad. **Eliminar** sigue siendo una acción distinta que borra el registro cuando sus referencias lo permiten. No hay inventario ni conteo de existencias.

El formato de comprobante se guarda por restaurante en `printing_ticket_templates`. Su sección está en Configuración y solo se muestra si `restaurants.needs` incluye `printing_systems`; no es una pestaña ni una acción del Catálogo. La configuración no se duplica en catálogo.

## Pendientes

Definir esquema de modificadores, combos, precios por canal, impuestos y compatibilidad entre productos y sedes. El catálogo implementado aún requiere aplicar la migración Supabase y conectarse al flujo de pedidos multi-restaurante cuando ese modelo esté disponible.
