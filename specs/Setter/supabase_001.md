# Black&White POS — Supabase compartido 001

**Estado:** Primera implementación local; requiere configuración única y despliegue del proyecto Supabase antes de usarla en producción.
**Objetivo:** Una base Supabase compartida por Setter y Black&White POS, con datos aislados por restaurante.

## Esquema actualmente desplegado (flujo anterior)

La siguiente tabla describe el modelo que ya se implementó y desplegó para el flujo previo de familias/versiones de arquitectura. No representa el nuevo flujo acordado más abajo.

| Entidad | Propósito |
|---|---|
| `restaurants` | Nombre, estado activo/dado de baja, necesidades opcionales seleccionadas, ajustes tipados de dominio y ruta del logo. No guarda arquitectura, tipo ni ciudad. |
| `accounts` | Perfil de una persona autenticada, su `auth.users.id`, nombre de usuario global, restaurante, rol y estado. La clave de acceso y contraseña no se guardan en esta tabla. |
| `roles` | Roles habilitados para cada restaurante, con clave, etiqueta y permisos efectivos. Se crean/administran según los flujos de roles definidos para el POS. |
| `restaurants.needs` | Lista cerrada de necesidades opcionales: `crm`, `kitchen`, `salon`, `delivery`, `receipts`. Las secciones base no se guardan aquí porque siempre existen. |
| `attendance_*` | Interruptores tipados de asistencia: autoentrada, entrada por compañero, autosalida y salida por compañero. Se administran desde Configuración del POS. |
| `architecture_configurations` | Configuraciones que ofrece cada versión y posibles valores iniciales propios. |
| `restaurants.configuration` y `restaurants.configuration_keys` | Valores JSON actuales y copia de las claves disponibles para ese restaurante. |
| `locations` | Sedes del restaurante, con dirección opcional y horario de atención. |
| `location_hours` | Horario de atención estructurado por día de la semana. |
| `account_schedules` | Uno o más horarios de entrada y salida asignados a una cuenta de empleado. |
| Asistencia (propuesta) | Marcas de entrada/salida con actor, sede efectiva, turno y auditoría; el mapa de calor es un resumen derivado. |
| Movimientos y pagos (propuesta) | Registro común para todos los restaurantes, con timestamp, total, hasta diez importes y un arreglo ordenado que identifica el método usado en cada espacio. |

Los nombres se mantienen en inglés para mantener consistencia con las tablas y consultas actuales del proyecto. La pantalla usa etiquetas en español.

No se usa selector de arquitectura/versiones. En el alta se guardan únicamente las necesidades opcionales escogidas. Las secciones fijas son Cuentas, Estadísticas, Flujo de pedidos, Catálogo y Configuración; el POS decide qué opciones mostrar según esas secciones y las necesidades.

La migración `202611080001_fixed_optional_needs.sql` transforma las antiguas claves `dining` a `salon`, filtra las antiguas secciones base de `restaurants.needs`, mantiene los cuatro valores de asistencia en columnas booleanas y retira el catálogo genérico de configuraciones y las tablas de arquitectura. La función de alta valida estrictamente las cinco claves permitidas.

El movimiento conserva una instantánea de los tipos de pago junto con los importes para que cambios posteriores a los métodos configurados no alteren el significado histórico. El diseño físico de esa tabla queda pendiente de la especificación de Flujo de pedidos; no se incorpora todavía a una migración SQL.

## Flujo objetivo acordado (pendiente de rediseño SQL)

Setter administra restaurantes y no edita un catálogo de necesidades. El alta ofrece exactamente CRM (`crm`), Cocina (`kitchen`), Salón (`salon`), Delivery (`delivery`) y Comprobantes (`receipts`); no hay otras necesidades marcables ni se pueden añadir desde la interfaz. Setter no administra configuraciones operativas ni expone un catálogo genérico de configuraciones. El alta no pide una arquitectura o versión: guarda la selección de necesidades en el restaurante. La app POS decide qué ajustes presentar al administrador a partir de esa selección y de las cinco secciones fijas.

Lógicamente, el esquema futuro necesita:

- En `restaurants`, las necesidades y campos explícitos para valores simples (por ejemplo, delivery propio, uso de proveedor externo y datos asociados).
- Tablas de dominio para valores estructurados o múltiples, como métodos de pago, roles y relaciones de cuentas, en lugar de una tabla universal de configuraciones.
- La app determina qué opciones mostrar a partir de las necesidades seleccionadas; las operaciones de servidor validan y guardan esos valores en sus campos/tablas de dominio.
- La configuración de métodos de pago vive dentro del POS y se guarda en el modelo de pagos; no se administra como arquitectura ni como catálogo genérico.

La estructura restante de roles y campos se definirá con cada sección. La migración nueva elimina los objetos del flujo anterior y conserva restaurantes, roles, cuentas, sedes y preferencias de asistencia.

## Acceso desde ambos productos

- Black&White POS usa la clave pública de Supabase y el token Auth de la persona. Las políticas RLS limitan los datos a su restaurante, rol y sede, y bloquean la operación cuando el restaurante está dado de baja.
- Setter lee y modifica los mismos registros y llama a Edge Functions para crear identidades Auth y gestionar el ciclo de vida de cuentas.
- La clave `service_role` solo existe como secreto de Edge Functions; nunca se incluye en Setter, en Black&White POS ni en código estático.
- Sin selección de restaurante al iniciar sesión, el nombre de usuario debe ser único globalmente. Una sesión resuelve la cuenta, restaurante, rol y sede desde `accounts`.

## Edge Functions actuales (modelo desplegado)

1. `setter-create-restaurant`: valida el nombre y la lista cerrada de necesidades, guarda el restaurante y crea su cuenta inicial Administrador.
2. `setter-create-account`: valida que el rol esté habilitado en ese restaurante, crea la identidad Auth y guarda la relación. Si guardar el perfil falla, elimina la identidad recién creada.
3. `setter-delete-account`: revoca el acceso y conserva los registros históricos necesarios.
4. `setter-set-restaurant-status`: activa o da de baja un restaurante. La baja impide leer y modificar datos operativos; POS debe limpiar el contenido visible de la sesión y mostrar el aviso de baja.
5. `get-my-restaurant-access`: devuelve el estado de acceso después del login para que POS resuelva el restaurante antes de cargar sus datos.

Cada función debe validar autenticación/autorización, entrada, estado del restaurante, límites de cuentas y permisos por rol. Las funciones administrativas no deben quedar invocables por una sesión pública anónima.

## Storage

- Bucket privado `restaurant-assets` para logos y archivos de configuración.
- Ruta prevista: `<restaurant_id>/<tipo>/<uuid>.<extensión>`.
- `restaurants.logo_path` almacena solo la ruta y metadatos necesarios, no el archivo binario.
- RLS de `storage.objects` limita lectura y escritura al restaurante correspondiente; Setter obtiene cargas firmadas mediante una Edge Function autorizada.
- Validar tamaño, MIME y extensión. Reemplazar o borrar un logo no debe borrar el restaurante ni sus datos.

## Migración del POS actual

El frontend consulta `staff_profiles`, `locations`, catálogo, `open_orders`, `orders`, asistencia e impresión con funciones RPC propias de una cafetería. Esas tablas y funciones todavía no tienen un `restaurant_id` compartido. Antes de cambiar la configuración del cliente a la nueva arquitectura, sus datos deben quedar asociados a un restaurante y cada RPC/política debe aplicar aislamiento por restaurante además de sede, rol y necesidad activa.

## Acceso de Setter decidido e implementado

- Setter solicita un enlace de acceso por correo a `srpopurr0000@gmail.com`, solo para un usuario Auth ya existente (`shouldCreateUser: false`).
- No muestra nombre, perfil ni cuenta del operador.
- Una fila interna en `platform_operators` autoriza ese usuario. Cada Edge Function vuelve a comprobarla antes de leer o cambiar datos de plataforma.
- El registro público de Supabase Auth debe permanecer desactivado. La lista de Redirect URLs debe incluir la URL de producción de Setter.
- Las claves privilegiadas se usan únicamente desde Edge Functions. En el navegador solo está la clave pública.

## Implementación y límites actuales

- La migración `202611060001_platform_core.sql` creó los primeros catálogos de necesidades/arquitecturas, restaurantes, roles por restaurante, cuentas Auth, sedes, horarios, registro de operador, políticas RLS y bucket privado de logos.
- Edge Functions: `setter-create-restaurant`, `setter-admin`, `staff-admin` y `restaurant-access`.
- Setter ya usa el proyecto compartido para acceso por Gmail, lista de restaurantes, alta de restaurante y administrador inicial, cuentas y baja/reactivación. La pantalla de catálogo de necesidades/arquitecturas y los editores de configuración/sedes se retiraron del frontend.
- POS inicia sesión por nombre de usuario, consulta `accounts`, crea cuentas mediante `staff-admin` y consulta el estado del restaurante antes de abrir el espacio de trabajo.
- Los módulos operativos derivados de Kffe’to, sus RPC y asistencias aún no han sido migrados a un modelo multi-restaurante. No habilitar restaurantes reales hasta asociar esos datos a `restaurant_id` y probar RLS por módulo.

## Propuestas nuevas: asistencia y configuración dinámica

- El detalle de la propuesta de permisos de entrada/salida, turnos nocturnos y asignaciones temporales está en [Cuentas](../Cuentas/spec_001.md).
- La relación objetivo de configuraciones con necesidades/secciones y los valores por restaurante está en [Configuración](../Configuraci%C3%B3n/spec_001.md).
- La migración `202611070001_setter_architecture_catalog.sql` agregó temporalmente catálogos versionados de arquitecturas y configuraciones; el siguiente cambio de esquema los retira porque ya no forman parte del modelo elegido.
- La migración `202611080001_fixed_optional_needs.sql` migra los datos a la lista fija de cinco necesidades opcionales, reemplaza la configuración genérica de asistencia por columnas booleanas tipadas y retira del esquema los catálogos de arquitectura/configuración.
- `account_schedules` todavía no lleva sede/vigencia y aún no existe una tabla de marcas de asistencia.

## Activación de producción

Seguir [README de Supabase](../../supabase/README.md): crear el usuario Auth del propietario, autorizar su UUID, configurar URLs/SMTP, agregar secretos de GitHub y desplegar la migración y funciones. El push del frontend a Cloudflare Pages no publica por sí solo cambios de Supabase.
