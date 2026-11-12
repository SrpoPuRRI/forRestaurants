# Black&White POS — Setter y administración de plataforma 001

**Estado:** Borrador de arquitectura inicial  
**Propósito:** Documentar cómo Setter crea y configura restaurantes y cómo Black&White POS carga el espacio de trabajo de cada uno.

## Productos y responsabilidades

- **Setter** es una aplicación web separada, para el equipo administrador de la plataforma B&W.
- **Black&White POS** es la aplicación de operación diaria usada por administradores y empleados de cada restaurante.
- Las cuentas de plataforma Setter y las cuentas de restaurante tienen alcances y permisos distintos.

## Decisiones de producto acordadas

- La interfaz se presenta como **Configurador de Black&White**. No muestra nombre, perfil ni cuenta de operador. El acceso se verifica con enlace de correo al Gmail del propietario antes de mostrar datos.
- La vista inicial muestra restaurantes y la acción para crear uno. No usa navegación lateral ni una pantalla de actividad.
- Setter administra el alta de restaurantes y registra sus necesidades iniciales. No tiene una sección para editar el catálogo global de necesidades, no ofrece un catálogo global de configuraciones ni edita configuraciones operativas. Después del alta, el administrador del restaurante puede cambiar sus necesidades desde Black&White POS.
- El alta muestra exactamente cinco necesidades opcionales con claves fijas: CRM (`crm`), Cocina (`kitchen`), Salón (`salon`), Delivery (`delivery`) y Comprobantes (`receipts`). No se pueden añadir, renombrar ni eliminar desde Setter.
- Todos los restaurantes tienen siempre las secciones Cuentas, Estadísticas, Flujo de pedidos, Catálogo y Configuración. No se ofrecen como necesidades opcionales al crear un restaurante.
- CRM, Cocina, Salón, Delivery y Comprobantes son las únicas necesidades opcionales. Las necesidades y los ajustes por sección pueden cambiar el comportamiento de las secciones fijas, sin quitarlas.
- Cada sección fija puede tener comportamiento configurable desde Configuración. La disponibilidad de esas opciones y sus interacciones con CRM, Salón, Cocina u otras necesidades se definirá antes de implementarlas.
- No se escogerá una arquitectura prearmada al crear un restaurante. Las necesidades seleccionadas determinan qué roles y configuraciones quedan disponibles; esto reemplaza el flujo anterior de elegir una familia y versión de arquitectura. Los roles vienen de un catálogo global y Setter no administra ese catálogo.
- La app POS determina qué opciones de configuración y roles mostrar al administrador del restaurante, usando las cinco necesidades elegidas y las secciones fijas. Por ejemplo, las cuatro opciones de asistencia pertenecen a Cuentas > Configuración del restaurante, no a Setter.
- La ficha no solicita tipo de negocio ni ciudad. Setter guarda las necesidades elegidas y administra el restaurante, sin elección de arquitectura ni edición de los valores operativos que configura el administrador en la app.
- Crear un restaurante completa su configuración inicial y lo deja activo. No existe el estado «pendiente de configuración».
- Cada restaurante puede estar activo o dado de baja. Los dados de baja se ocultan de la vista habitual; si existe al menos uno, aparece un control para mostrarlos u ocultarlos.
- Setter guarda las necesidades elegidas y administra el registro del restaurante. La app POS calcula, a partir de las necesidades y la configuración guardada, qué IDs de roles globales habilita el restaurante; luego el administrador asigna uno o varios roles a cada cuenta en Cuentas.
- Después del alta, el administrador del restaurante puede añadir o quitar necesidades opcionales desde el POS, sin crear otro restaurante. La ubicación exacta del control en la interfaz queda pendiente.
- Quitar una necesidad revoca sus roles y accesos de interfaz/operación, pero conserva los registros y valores existentes. La información no se elimina ni se migra a otro restaurante.
- Setter puede consultar el total de cuentas y los roles; nunca muestra contraseñas. Desde Setter se pueden crear o eliminar cuentas, pero no editar su perfil ni cambiar su contraseña.
- El resumen de cada restaurante muestra en modo de solo lectura las sedes registradas y sus direcciones, además del número de sedes.
- La app POS muestra al administrador las configuraciones que corresponden a las necesidades elegidas y a las secciones fijas. CRM, Salón y Cocina sí pueden ser necesidades opcionales.
- Cada sede puede guardar dirección opcional y horario de atención. Cada empleado puede tener asignado uno o más horarios de entrada y salida.
- Si un restaurante está dado de baja, las cuentas asociadas no pueden operar Black&White POS. Tras resolver la sesión, la aplicación debe descartar los datos privados del restaurante, limpiar su interfaz y mostrar una pantalla bloqueante con el aviso **«Tu restaurante ha sido dado de baja»**. La restricción debe aplicarse también en los servicios de datos; limpiar el DOM por sí solo no controla el acceso.

La autenticación es una pantalla breve de correo y enlace; no crea un perfil visible. La autorización de plataforma se mantiene en una tabla privada de Supabase y se comprueba en cada operación privilegiada.

## Flujo de alta de restaurante

1. Un operador autorizado entra a Setter.
2. Crea el restaurante, selecciona sus necesidades y define el nombre de su sede principal (la dirección es opcional); Setter guarda la sede y crea la cuenta inicial Administrador vinculada al restaurante. Se pueden añadir más sedes desde Cuentas dentro del POS.
3. La persona inicia sesión en Black&White POS. La app resuelve su restaurante y sus permisos sin pedirle que lo seleccione.
4. Dentro del POS, el administrador ve las configuraciones aplicables según las necesidades y las secciones fijas, y guarda sus valores en los campos/tablas propios de cada área.

La contraseña inicial debe tratarse como credencial temporal; nunca se almacena en texto plano en las tablas del producto. Supabase Auth es responsable de guardar y verificar credenciales. Al cambiar una contraseña desde POS se exige la actual, incluso tras un restablecimiento administrativo. El método de entrega queda por definir.

## Modelo de datos

- `restaurants`: nombre, estado, necesidades opcionales elegidas y valores directos de configuración que correspondan al restaurante.
- `restaurants.needs` acepta únicamente `crm`, `kitchen`, `salon`, `delivery` y `receipts`; no existe catálogo editable de necesidades.
- `roles` es un catálogo global de la app, sin `restaurant_id` ni relación hacia cuentas.
- `restaurants` guarda un array de IDs de roles habilitados para ese restaurante según sus necesidades y configuración. `accounts` guarda un array de IDs de roles asignados a cada cuenta. La app calcula los permisos efectivos; el backend aplica la misma autorización.
- No hay roles mixtos predefinidos: se acumulan permisos asignando varios roles a una cuenta.
- El rol especial `Empleado` existe para todos los restaurantes y concede los permisos de todos los roles disponibles para ese restaurante. Es exclusivo y no se combina con otros roles. Si el restaurante no tiene necesidades opcionales, o solo selecciona Comprobantes, los roles son Administrador y Empleado.
- Cocina habilita Cocinero; la opción de barra separada habilita Barista y Bartender y el espacio de trabajo Barra. Salón habilita Mesero y Portero. CRM habilita Social Manager. Delivery habilita Repartidor cuando se definan y activen sus configuraciones. Comprobantes no añade roles. Si existe al menos una necesidad opcional distinta de Comprobantes, Cajero se incluye entre los roles disponibles; si se quitan todas esas necesidades, Cajero se quita y Empleado cubre conceptualmente caja.
- Configuraciones persistidas en columnas directas de `restaurants` o en tablas de dominio específicas, según su forma y relación. No se usará un catálogo genérico de configuraciones.
- `locations`: sedes pertenecientes a un restaurante.
- Todo restaurante se crea con la sede **Sede principal** o el nombre que escriba el operador. La dirección es opcional; se pueden crear otras sedes desde el POS y no se permite eliminar la última.
- Datos operativos de cada módulo: asociados al restaurante y, cuando aplique, a una sede.

Las necesidades elegidas determinan qué opciones aparecen en la app POS, sin selector de arquitectura/versiones. El backend valida y persiste cada ajuste en campos o tablas con significado de dominio, en lugar de usar un almacén genérico clave-valor. Los valores, restricciones y relaciones deben quedar definidos en el esquema de cada área.

Las secciones fijas son Cuentas, Estadísticas, Flujo de pedidos, Catálogo y Configuración. Las necesidades opcionales marcables son CRM, Cocina, Salón, Delivery y Comprobantes. La lista es fija y no editable desde Setter. La autenticación necesaria para acceder es infraestructura base. La app presenta los ajustes según las necesidades elegidas y las secciones fijas.
## Aislamiento entre restaurantes

- Los permisos deben aplicarse en la base de datos, no solo ocultando pestañas.
- Las políticas RLS deben limitar cada lectura y escritura a los restaurantes a los que pertenece la cuenta.
- Las funciones de servidor y RPC deben comprobar membresía, rol, restaurante y módulos activos.
- Setter administra restaurantes y sus cuentas iniciales; el POS administra roles y configuraciones operativas dentro del restaurante.

## Logo y archivos

- Los archivos del restaurante se almacenan en Supabase Storage, organizados por restaurante.
- La base de datos conserva la ruta del objeto y sus metadatos, no el contenido binario del logo.
- El tipo de bucket, lectura pública o privada y las políticas para subir, reemplazar y borrar se definirán en la especificación de Configuración.

## Creación segura de cuentas

La creación de usuarios privilegiados requiere una operación de servidor de Setter. Una clave privilegiada de Supabase no se expone en el navegador. La operación debe validar que quien usa Setter tenga autorización de plataforma y manejar de forma segura errores parciales entre la creación de la identidad Auth y los registros de negocio.

## Decisiones pendientes

- Definir qué valores iniciales reciben los ajustes operativos al crear el restaurante y si el administrador los completa en un paso inicial dentro del POS.

- Si cada usuario POS pertenece a un solo restaurante o puede tener varias membresías.
- Cómo se obtiene un identificador de acceso único si el inicio usa nombre de usuario sin restaurante.
- Cómo se entrega la contraseña temporal o invitación de la cuenta inicial.
- Qué funciones dependen unas de otras y qué puede configurarse por sede.
- Cómo se habilitan, suspenden y versionan planes o paquetes.
- Qué reglas de RLS, auditoría, retención, exportación y eliminación aplican por entidad.
- Qué ocurre si se intenta desactivar una pestaña con datos operativos existentes.

## Fuera del alcance de esta versión

Este documento fija el mapa y las decisiones iniciales. No define aún el SQL final, endpoints, componentes de interfaz ni el flujo concreto de pagos o impresión.
