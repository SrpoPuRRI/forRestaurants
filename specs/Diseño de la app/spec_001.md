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

### Marca del producto y marca del restaurante

- Antes de iniciar sesión, la pantalla identifica **Black&White POS** como el producto que la persona está usando.
- Después de iniciar sesión, el espacio de trabajo debe sentirse propio del restaurante: la marca principal del encabezado pasa a ser el **nombre del restaurante** junto con **su logo**. No debe seguir mostrando «BLACK&WHITE POS» como identidad principal en la navegación interna.
- El nombre y el logo del restaurante deben tener suficiente presencia y tamaño para reconocerse al abrir la app, tanto en escritorio como en móvil. La identidad del producto puede quedar fuera del encabezado de trabajo; no debe competir con la marca del restaurante.
- El logo se presenta dentro de un marco cuadrado y ocupa todo el marco, sin padding, borde ni fondo añadidos por la interfaz. La imagen se ajusta a ese cuadrado; los logos horizontales pueden recortarse, por lo que se recomienda subir un archivo cuadrado.
- En escritorio, el marco mide 88 × 88 px junto al nombre; en móvil, 56 × 56 px junto al nombre. El nombre puede ocupar varias líneas y truncarse con cuidado si es muy largo.
- Si el restaurante no tiene logo, se muestra un monograma con sus iniciales junto al nombre. No se vuelve a mostrar la marca Black&White dentro del espacio de trabajo.
- Estas son las medidas iniciales implementadas; se pueden ajustar tras revisar el resultado visual en dispositivos reales.

## Estructura del espacio de trabajo

El shell muestra la marca del restaurante activo en la parte superior izquierda: logo y nombre del restaurante. La cuenta y el rol se muestran en la barra lateral. La acción **Salir** permanece visible en la parte superior derecha. Esta marca sustituye la identidad «BLACK&WHITE POS» dentro del espacio de trabajo; el login conserva la identidad del producto.

## Orden de los espacios de trabajo

La navegación conserva las cinco secciones fijas y coloca las opcionales activas en posiciones definidas. El orden completo es:

1. **Cuentas**
2. **CRM**, solo si está activo
3. **Estadísticas**
4. **Delivery**, solo si está activo
5. **Flujo de pedidos**
6. **Cocina**, solo si está activa
   - **Barra**, inmediatamente después de Cocina si está activa la configuración de barra separada
7. **Salón**, solo si está activo
8. **Catálogo**
9. **Configuración**, siempre al final

Si una necesidad opcional no está activa, se omite su espacio y se conserva el orden relativo de los demás. Cuando Cocina y Salón están activos, Cocina aparece antes que Salón. Barra se agrupa con Cocina y no altera el orden relativo de estos módulos. Este orden aplica a la navegación del espacio de trabajo en las vistas que la presenten.

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
- Aprobar arte final del logotipo y el ícono de Black&White antes de producción.
- Revisar las medidas iniciales del marco cuadrado de marca (88 px en escritorio y 56 px en móvil) en dispositivos reales y ajustarlas si el logo continúa viéndose pequeño.
- Definir cómo las necesidades opcionales condicionan el comportamiento de las secciones fijas y qué ajustes ofrece Configuración.
