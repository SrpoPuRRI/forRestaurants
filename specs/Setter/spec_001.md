# Black&White POS — Setter y arquitectura de la plataforma 001

**Estado:** Borrador de arquitectura inicial  
**Propósito:** Documentar cómo Setter crea y configura restaurantes y cómo Black&White POS carga el espacio de trabajo de cada uno.

## Productos y responsabilidades

- **Setter** es una aplicación web separada, para el equipo administrador de la plataforma B&W.
- **Black&White POS** es la aplicación de operación diaria usada por administradores y empleados de cada restaurante.
- Las cuentas de plataforma Setter y las cuentas de restaurante tienen alcances y permisos distintos.

## Decisiones de producto acordadas

- La interfaz se presenta como **Configurador de Black&White**. No muestra nombre, perfil ni cuenta de operador. El acceso se verifica con enlace de correo al Gmail del propietario antes de mostrar datos.
- La vista inicial muestra restaurantes y la acción para crear uno. No usa navegación lateral ni una pantalla de actividad.
- Junto a «Crear restaurante» hay una sección global «Necesidades y arquitectura» para administrar necesidades, familias de arquitectura y configuraciones.
- Una familia de arquitectura tiene un identificador estable y un historial de versiones inmutables. Cada versión es una arquitectura completa: especifica las necesidades que soporta, los roles disponibles y las configuraciones con sus valores iniciales. Las mismas necesidades pueden corresponder a varias familias, con responsabilidades distintas.
- Al crear un restaurante, Setter primero pide sus necesidades y luego muestra la versión más reciente de cada familia activa que las cubre. Guarda el UUID exacto de esa versión; nuevas versiones no alteran restaurantes existentes. Para cambiar un restaurante existente, el operador elige manualmente una versión compatible.
- La ficha no solicita tipo de negocio ni ciudad. La versión seleccionada, no el identificador de familia, representa la arquitectura operativa exacta.
- Crear un restaurante completa su configuración inicial y lo deja activo. No existe el estado «pendiente de configuración».
- Cada restaurante puede estar activo o dado de baja. Los dados de baja se ocultan de la vista habitual; si existe al menos uno, aparece un control para mostrarlos u ocultarlos.
- Setter guarda para cada restaurante las necesidades, la arquitectura seleccionada y la lista de roles resultante. Esos roles determinan las opciones al crear cuentas de restaurante.
- Setter puede consultar el total de cuentas y los roles; nunca muestra contraseñas. Desde Setter se pueden crear o eliminar cuentas, pero no editar su perfil ni cambiar su contraseña.
- Setter muestra la configuración que también administra el rol Administrador dentro de Black&White POS. Las opciones se limitan a las necesidades habilitadas; no muestra ajustes de cada pestaña operativa.
- Cada sede puede guardar dirección opcional y horario de atención. Cada empleado puede tener asignado uno o más horarios de entrada y salida.
- Si un restaurante está dado de baja, las cuentas asociadas no pueden operar Black&White POS. Tras resolver la sesión, la aplicación debe descartar los datos privados del restaurante, limpiar su interfaz y mostrar una pantalla bloqueante con el aviso **«Tu restaurante ha sido dado de baja»**. La restricción debe aplicarse también en los servicios de datos; limpiar el DOM por sí solo no controla el acceso.

La autenticación es una pantalla breve de correo y enlace; no crea un perfil visible. La autorización de plataforma se mantiene en una tabla privada de Supabase y se comprueba en cada operación privilegiada.

## Flujo de alta de restaurante

1. Un operador autorizado entra a Setter.
2. Si hace falta, prepara necesidades, arquitecturas, roles y configuraciones en la sección de plataforma.
3. Crea el restaurante, selecciona sus necesidades y elige una de las versiones más recientes compatibles que Setter presenta.
4. El sistema guarda el UUID de esa versión, copia sus roles y valores iniciales de configuración, y crea la cuenta inicial Administrador vinculada al restaurante.
5. La persona inicia sesión en Black&White POS. La app resuelve su restaurante y sus permisos sin pedirle que lo seleccione.

La contraseña inicial debe tratarse como credencial temporal; nunca se almacena en texto plano en las tablas del producto. El método de entrega y el cambio obligatorio en el primer acceso quedan por definir.

## Modelo de datos

- `restaurants`: nombre, estado, `architecture_version_id` exacto, necesidades elegidas y valores actuales de configuración.
- `needs`: catálogo administrable de necesidades.
- `architectures`: familias estables de arquitectura con metadatos.
- `architecture_versions`: cada versión completa e inmutable, con número, roles plantilla y descripción.
- `architecture_needs`: necesidades soportadas por cada versión concreta.
- `configuration_catalog` y `architecture_configurations`: definiciones tipadas de ajustes, su disponibilidad por versión y sus valores iniciales.
- `roles`: copia por restaurante de los roles plantilla al momento de crear el restaurante.
- `locations`: sedes pertenecientes a un restaurante.
- Datos operativos de cada módulo: asociados al restaurante y, cuando aplique, a una sede.

El `id` de `architectures` identifica una familia que puede tener muchas versiones. Cada fila de `architecture_versions` es una arquitectura concreta; `restaurants.architecture_version_id` fija cuál eligió el restaurante. Crear una versión nueva solo cambia la opción más reciente que se ofrece en nuevas altas. Los restaurantes existentes conservan su versión hasta que Setter la cambie expresamente.

Las ocho pestañas configurables son Cuentas, CRM, Flujo de pedidos, Salón, Cocina, Estadísticas, Catálogo y Configuración. La autenticación necesaria para acceder sigue siendo infraestructura base aunque la pestaña de administración de Cuentas esté apagada.
## Aislamiento entre restaurantes

- Los permisos deben aplicarse en la base de datos, no solo ocultando pestañas.
- Las políticas RLS deben limitar cada lectura y escritura a los restaurantes a los que pertenece la cuenta.
- Las funciones de servidor y RPC deben comprobar membresía, rol, restaurante y módulos activos.
- Setter administra el catálogo de funciones; los datos operativos permanecen dentro del ámbito de cada restaurante.

## Logo y archivos

- Los archivos del restaurante se almacenan en Supabase Storage, organizados por restaurante.
- La base de datos conserva la ruta del objeto y sus metadatos, no el contenido binario del logo.
- El tipo de bucket, lectura pública o privada y las políticas para subir, reemplazar y borrar se definirán en la especificación de Configuración.

## Creación segura de cuentas

La creación de usuarios privilegiados requiere una operación de servidor de Setter. Una clave privilegiada de Supabase no se expone en el navegador. La operación debe validar que quien usa Setter tenga autorización de plataforma y manejar de forma segura errores parciales entre la creación de la identidad Auth y los registros de negocio.

## Decisiones pendientes de arquitectura

- Si cada usuario POS pertenece a un solo restaurante o puede tener varias membresías.
- Cómo se obtiene un identificador de acceso único si el inicio usa nombre de usuario sin restaurante.
- Cómo se entrega la contraseña temporal o invitación de la cuenta inicial.
- Qué funciones dependen unas de otras y qué puede configurarse por sede.
- Cómo se habilitan, suspenden y versionan planes o paquetes.
- Qué reglas de RLS, auditoría, retención, exportación y eliminación aplican por entidad.
- Qué ocurre si se intenta desactivar una pestaña con datos operativos existentes.

## Fuera del alcance de esta versión

Este documento fija el mapa y las decisiones iniciales. No define aún el SQL final, endpoints, componentes de interfaz ni el flujo concreto de pagos o impresión.
