# Black&White POS — Diseño de la app 001

**Estado:** Decisiones visuales iniciales acordadas  
**Alcance:** Identidad, estructura compartida de la interfaz y navegación del espacio de trabajo.

## Identidad de marca

- Nombre del producto: **Black&White POS**.
- Dirección elegida: **El Conector + Hospitalidad cálida**.
- El símbolo principal toma la ampersand (`&`) como idea de conexión entre restaurantes, equipos y flujos diferentes.
- La marca usa contraste carbón y marfil; terracota destaca acciones y estados activos. La madera y la piedra aportan calidez en superficies secundarias.
- Paleta de referencia: carbón `#1B1B1B`, marfil `#FBF8F2`, madera `#8B6E54`, piedra `#D9D3C8`, terracota `#D77936`.
- Los SVG de exploración están en `assetsIdent/`. Son referencias conceptuales; no sustituyen el arte final de producción.

## Estructura del espacio de trabajo

El shell muestra la marca del restaurante activo en la parte superior izquierda: logo y nombre del restaurante. La cuenta y el rol se muestran en la barra lateral. La acción **Salir** permanece visible en la parte superior derecha.

El espacio de trabajo tiene cinco secciones fijas para todos los restaurantes:

1. Cuentas
2. Estadísticas
3. Flujo de pedidos
4. Catálogo
5. Configuración

Las únicas necesidades opcionales son CRM, Cocina, Salón, Delivery y Comprobantes. Setter no administra esta lista: muestra las cinco opciones fijas al crear el restaurante. La app POS usa la selección para mostrar al administrador las configuraciones correspondientes a necesidades y secciones. Las secciones fijas nunca se eliminan. Black&White POS respeta los permisos de la cuenta autenticada y las funciones habilitadas.

## Decisiones de navegación

- El usuario inicia sesión en Black&White POS; no selecciona un restaurante en cada acceso. La pertenencia de su cuenta resuelve el restaurante y la sede correspondiente.
- Salón y Cocina son módulos independientes; una cocina puede atender pedidos sin mesas.
- La configuración de tickets e impresoras pertenece a **Configuración**, dentro de dispositivos e impresión; no pertenece a Catálogo.
- El flujo de impresión existente en Kffe’to POS es una referencia, no el flujo que B&W implementará por defecto.
- La imagen de Kffe’to POS sirve como referencia de jerarquía y controles de navegación, no como identidad visual final.

## Pendientes

- Definir variantes responsive y la composición exacta de la navegación móvil.
- Definir estados visuales, accesibilidad, iconografía y reglas completas de contraste.
- Aprobar arte final del logotipo y el ícono antes de producción.
- Definir cómo las necesidades opcionales condicionan el comportamiento de las secciones fijas y qué ajustes ofrece Configuración.
