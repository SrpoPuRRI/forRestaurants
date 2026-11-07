# Black&White POS — Supabase compartido 001

**Estado:** Primera implementación local; requiere configuración única y despliegue del proyecto Supabase antes de usarla en producción.
**Objetivo:** Una base Supabase compartida por Setter y Black&White POS, con datos aislados por restaurante.

## Modelo propuesto

| Entidad | Propósito |
|---|---|
| `restaurants` | Identidad del restaurante, estado activo/dado de baja, arquitectura elegida, ruta del logo y configuración general. |
| `accounts` | Perfil de una persona autenticada, su `auth.users.id`, nombre de usuario global, restaurante, rol y estado. La clave de acceso y contraseña no se guardan en esta tabla. |
| `roles` | Roles habilitados para cada restaurante, con clave, etiqueta y permisos efectivos. La lista se crea como copia versionada desde la arquitectura seleccionada. |
| `architectures` | Plantillas disponibles, versión y descripción del modelo operativo. |
| `architecture_roles` | Roles que aporta cada versión de arquitectura. |
| `needs` | Catálogo de capacidades opcionales: módulos y necesidades operativas configurables. |
| `architecture_needs` | Necesidades que admite cada arquitectura y reglas de compatibilidad. |
| `restaurant_needs` | Selección de necesidades por restaurante y su configuración asociada. |
| `locations` | Sedes del restaurante, con dirección opcional y horario de atención. |
| `location_hours` | Horario de atención estructurado por día de la semana. |
| `account_schedules` | Uno o más horarios de entrada y salida asignados a una cuenta de empleado. |

Los nombres se proponen en inglés para mantener consistencia con las tablas y consultas actuales del proyecto. La pantalla puede usar etiquetas en español.

La selección de arquitectura y necesidades se guarda como configuración propia del restaurante. Los roles se copian a `roles` al crearlo para que una actualización futura de plantillas no cambie permisos de restaurantes ya existentes.

## Acceso desde ambos productos

- Black&White POS usa la clave pública de Supabase y el token Auth de la persona. Las políticas RLS limitan los datos a su restaurante, rol y sede, y bloquean la operación cuando el restaurante está dado de baja.
- Setter lee y modifica los mismos registros y llama a Edge Functions para crear identidades Auth y gestionar el ciclo de vida de cuentas.
- La clave `service_role` solo existe como secreto de Edge Functions; nunca se incluye en Setter, en Black&White POS ni en código estático.
- Sin selección de restaurante al iniciar sesión, el nombre de usuario debe ser único globalmente. Una sesión resuelve la cuenta, restaurante, rol y sede desde `accounts`.

## Edge Functions

1. `setter-create-restaurant`: valida la solicitud, guarda restaurante, arquitectura, necesidades y copia de roles; crea la cuenta inicial Administrador y devuelve las credenciales temporales una sola vez.
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

- La migración `202611060001_platform_core.sql` crea catálogos de necesidades/arquitecturas, restaurantes, roles por restaurante, cuentas Auth, sedes, horarios, registro de operador, políticas RLS y bucket privado de logos.
- Edge Functions: `setter-create-restaurant`, `setter-admin`, `staff-admin` y `restaurant-access`.
- Setter ya usa el proyecto compartido para acceso por Gmail, lista de restaurantes, alta de restaurante y administrador inicial, cuentas, baja/reactivación, configuración y horarios de atención de sedes.
- POS inicia sesión por nombre de usuario, consulta `accounts`, crea cuentas mediante `staff-admin` y consulta el estado del restaurante antes de abrir el espacio de trabajo.
- Los módulos operativos derivados de Kffe’to, sus RPC y asistencias aún no han sido migrados a un modelo multi-restaurante. No habilitar restaurantes reales hasta asociar esos datos a `restaurant_id` y probar RLS por módulo.

## Activación de producción

Seguir [README de Supabase](../../supabase/README.md): crear el usuario Auth del propietario, autorizar su UUID, configurar URLs/SMTP, agregar secretos de GitHub y desplegar la migración y funciones. El push del frontend a Cloudflare Pages no publica por sí solo cambios de Supabase.
