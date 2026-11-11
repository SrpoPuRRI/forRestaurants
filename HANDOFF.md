# Traspaso de contexto — Black&White POS

**Actualizado:** 11 de noviembre de 2026
**Objetivo:** permitir que otra sesión continúe el trabajo sin repetir descubrimientos ni confundir lo especificado con lo que ya está implementado.

## Continuación inmediata para la nueva cuenta (11 de noviembre)

El último problema reportado en producción es al cambiar el logo desde **Setter → Editar restaurante**: `permission denied for table restaurants`. Se rastreó en el código antes de cambiar nada: Setter envía esa acción a la Edge Function `setter-admin`; esta usa el cliente Supabase con `service_role` para leer `restaurants.id,logo_path` y luego actualizar `restaurants.logo_path`. `BYPASSRLS` evita RLS, pero no otorga permisos SQL de tabla. La migración inicial otorgaba permisos a `authenticated`, no los permisos `SELECT` y `UPDATE` que esta operación necesita para `service_role`.

La corrección de origen ya está en `202611110003_setter_restaurant_service_access.sql` y otorga únicamente `SELECT, UPDATE` sobre `public.restaurants` a `service_role`. El commit actual de forRestaurants es `dd5df2c` (`aaijasf`); incluye esa migración y la nota de despliegue en `supabase/README.md`. El repo estaba limpio y alineado con `origin/main` al documentar esto. **No se ha confirmado aquí que GitHub Actions haya aplicado esta migración ni que el flujo de logo ya funcione en producción.** Próximo paso: revisar la acción de Supabase correspondiente a `dd5df2c`, comprobar que `supabase db push` terminó bien y volver a probar el cambio desde Setter. Si la acción falla, detenerse y diagnosticar antes de pedir otro despliegue. No hace falta cambiar el bucket para este error concreto; las políticas/bucket de logo están en `202611110002_restaurant_logo_storage.sql` y cubren el flujo de Storage.

La llamada a Supabase Edge Functions usa ahora explícitamente el bearer del service key como medida defensiva. Eso no era la causa de `permission denied for table restaurants`; la causa identificada es el GRANT ausente. `setter-admin` también emite errores diferenciados para carga de objeto y escritura de metadatos, con eventos `setter_restaurant_logo_upload_failed` y `setter_restaurant_update_failed`, para que el próximo diagnóstico distinga Storage de Postgres.

El repo Setter separado (`F:\PROYECTOS\dosMiniProyectos\setter`) tiene como último commit local/remoto `9fa4a9b` (`I should be able to set a logo for a certain restaurant`) y estaba limpio. El formulario de creación acepta logo opcional; contraseña mínima de seis caracteres; Enter abre confirmación y la confirmación separa Cancelar de Aceptar y crear. El formulario de edición de Setter permite cambiar/quitar el logo. El POS también permite al admin del restaurante cambiar/quitar el logo desde Configuración. Los logos se almacenan en el bucket privado `restaurant-assets`, la base conserva `logo_path`, y la interfaz usa URL firmada temporal. Setter y POS son despliegues frontend independientes; la migración/funciones se despliegan desde forRestaurants.

**Estado de trabajo al cambiar de cuenta:** el árbol de forRestaurants y el de Setter estaban limpios; no quedó ningún archivo local sin commit. Esto documenta el estado comprobado en la sesión, no una confirmación de que el último workflow de Supabase haya terminado.

## Estado rápido

- Repositorio POS/backend: `F:\PROYECTOS\forRestaurants`, rama `main`, remoto `SrpoPuRRI/forRestaurants`.
- Último despliegue que está confirmado en el historial previo: `65d482a` — `Fix duplicate staff schedule insertion`; GitHub Actions #10 terminó correctamente. Esto no confirma el despliegue de los commits posteriores.
- El último commit de código de base/backend que se comprobó localmente es `dd5df2c` (`aaijasf`), alineado con `origin/main`, y contiene la migración `202611110003_setter_restaurant_service_access.sql`. **Revisar Actions para saber si ya se aplicó en Supabase.**
- El último run de Supabase previamente confirmado fue [run 42526209757](https://github.com/SrpoPuRRI/forRestaurants/actions/runs/42526209757), asociado al despliegue anterior; no asumir que cubre `dd5df2c`.
- El check de Cloudflare Pages asociado a aquel despliegue previo terminó correctamente: [Cloudflare Pages](https://github.com/SrpoPuRRI/forRestaurants/runs/128862361196). No asumir que verifica los últimos cambios del frontend.
- Repositorio Setter: `F:\PROYECTOS\dosMiniProyectos\setter`, rama `main`, remoto `SrpoPuRRI/BandWConfig`. Último commit publicado comprobado: `9fa4a9b` — `I should be able to set a logo for a certain restaurant`; el árbol estaba limpio. La URL de GitHub Pages comprobada anteriormente es `https://srpopurri.github.io/BandWConfig/`.
- Las migraciones y Edge Functions se aplican mediante el workflow descrito abajo. Para el arreglo actual de permisos de Setter hay que confirmar la acción posterior al commit `dd5df2c`; no declarar resuelto el incidente solo porque el commit exista.
- Los despliegues verdes **no significan que el POS esté listo para incorporar restaurantes clientes**. Las tablas y RPC operativas heredadas de Kffe’to todavía no tienen aislamiento multi-restaurante suficiente.

## Producto y decisiones vigentes

Black&White POS es un POS multi-restaurante que se adapta a la operación de cada negocio. Kffe’to POS sirve como referencia operativa real, no como esquema final. La identidad elegida usa el conector como símbolo y una paleta cálida; ver `assetsIdent/` y `specs/Diseño de la app/spec_001.md`.

Hay dos aplicaciones con límites diferentes:

1. **Configurador de Black&White (Setter):** herramienta privada de plataforma. Usa Auth y la lista `platform_operators` para autorizar al operador, pero no muestra una cuenta/nombre de operador en su interfaz ni pide credenciales de restaurante. Permite ver restaurantes, crear uno, seleccionar necesidades fijas, ver estado y gestionar cuentas de restaurante dentro del alcance acordado. No administra configuraciones operativas ni catálogos de necesidades.
2. **Black&White POS:** inicio de sesión de cuentas del restaurante; determina el restaurante y el rol desde la membresía, sin preguntar al usuario qué restaurante quiere abrir. El encabezado/espacio de trabajo debe comunicar la identidad del restaurante.

Las pestañas fijas de cada restaurante son **Cuentas, Estadísticas, Flujo de pedidos, Catálogo y Configuración**. Las únicas necesidades opcionales seleccionables en Setter son **CRM (`crm`), Cocina (`kitchen`), Salón (`salon`), Delivery (`delivery`) y Comprobantes (`receipts`)**. No agregar necesidades para pestañas fijas ni reintroducir selector de arquitectura/versiones. Las necesidades y configuraciones determinan qué roles/permisos estarán disponibles en el POS.

**Dirección de roles y necesidades acordada (aún no implementada):** `roles` será un catálogo global, sin `restaurant_id` ni referencias a cuentas. `restaurants` guardará un array de IDs de roles permitidos; `accounts` guardará un array de IDs asignados. No existen roles mixtos predefinidos: una cuenta acumula permisos al asignarle varios roles simples. El administrador podrá añadir o quitar necesidades después del alta desde el POS, sin borrar los datos del restaurante. Quitar una necesidad retira sus roles y accesos; la conservación/reactivación de asignaciones personales al reactivar queda pendiente. Mapeo: Cocina → Cocinero; barra separada → Barista, Bartender y espacio Barra; Salón → Mesero y Portero; CRM → Social Manager; Delivery → Repartidor tras configuraciones pendientes; Comprobantes → sin rol adicional. Si queda alguna necesidad activa aparte de Comprobantes, incluir Cajero; al quitar la última de ellas, quitar Cajero. Sin necesidades operativas o con solo Comprobantes, Empleado representa conceptualmente caja y solo están Administrador y Empleado.

El usuario quiere un flujo claro y no ambiguo, datos específicos por restaurante, permisos aplicados en servidor/RLS además de la interfaz, y que el admin del restaurante configure la operación desde Configuración del POS. La información de cada restaurante debe sentirse propia del cliente.

## Lo último que se implementó

### Prototipos y espacios opcionales (11 de noviembre de 2026)

- CRM ahora tiene un prototipo visual independiente de la base de datos.
- Delivery muestra un espacio «Próximamente»; el rol Repartidor aún no habilita operaciones.
- Comprobantes muestra el botón «Configurar sistema de impresión» y un diálogo «Próximamente».
- Se añadió en el POS la UI de Cocina (colas, marcar pedido/artículo/unidad listo o fuera de stock) y Salón (pisos, grilla, mesas, servicio, edición configurable y sillas por piso). La Barra separada tiene una pantalla informativa: aún no se distribuyen artículos entre Cocina y Barra.
- La migración local `202611110001_restaurant_workspaces.sql` añade tablas/RPC con aislamiento por restaurante para pisos, mesas, colas de Cocina/Salón y eventos de progreso. **No está aplicada en Supabase**; los workspaces no funcionarán en el entorno remoto hasta aplicar las migraciones pendientes y verificar las funciones.
- La cola se limpia al abrir Cocina y elimina pedidos completados con más de dos días; no hay proceso programado en servidor. El alta/pago del pedido heredado y su entrada a cola son llamadas separadas, no una transacción única.
- La UI de permisos sigue usando únicamente los roles heredados Administrador y Empleado. Los roles globales/múltiples y los permisos individuales Cocinero, Mesero, Portero, etc., aún no están implementados; por tanto, no tratar estas pantallas como autorización final por puesto.
- El mapa y las colas son funcionales en el código local. `salon_open_order_links` vincula la cuenta abierta con su mesa para recuperar esa relación al reabrirla; la migración todavía debe aplicarse y probarse en Supabase. La unión de mesas conserva las mesas y sus números como grupo visual (no crea una mesa física consolidada).

El commit `b7563c8` contiene:

- Pantalla **Configuración**, solo visible para cuentas con rol `admin`.
- Nuevas columnas tipadas en `restaurants` para preferencias de notas, rankings, límites y capacidades del catálogo.
- `restaurant_payment_methods` con RLS para los cinco métodos acordados: efectivo, Yape, Plin, transferencia bancaria y tarjetas.
- `restaurant_role_settings` para permisos de rankings/pedidos por rol, con FK compuesta al restaurante.
- `employee_notes` con RLS: cada empleado escribe/lee su nota y el admin puede leer notas de su restaurante.
- UI de nota propia del empleado y vista administrativa de notas de equipo.
- Estadísticas lee ahora preferencias persistidas para mostrar rankings al admin/empleados según la configuración.
- README de Supabase actualizado para advertir del límite multi-tenant.

Archivos principales:

- `restaurant-settings.js`: lectura, presentación y guardado de las preferencias.
- `app.js`: ruta, navegación, carga de ajustes y UI de notas en Cuentas.
- `statistics.js`: filtrado de rankings según preferencias guardadas.
- `supabase/migrations/202611080002_restaurant_operational_settings.sql`: migración más reciente.
- `supabase/README.md`: despliegue, autenticación y advertencias de producción.

En esta sesión se hizo `node --check` de `app.js`, `statistics.js` y `restaurant-settings.js`, y `git diff --check`; pasaron. No se hicieron pruebas de integración contra un restaurante real.

## Lo que la interfaz todavía no hace cumplir

No presentar las siguientes opciones como funcionalidades de operación listas:

- **Pagos:** se guardan preferencias manuales por método. La modalidad automática está desactivada en UI porque no hay proveedor integrado. El checkout actual sigue usando el modelo antiguo (Yape/efectivo); no lee la configuración nueva ni admite todos los métodos.
- **Límite mínimo/máximo y pedidos correctivos/devoluciones:** valores y permisos por rol se guardan, pero el flujo/RPC de pedidos no los aplica.
- **Rankings:** la visibilidad usa la configuración existente, pero los datos se consultan desde el modelo operativo heredado. Tras adoptar la clasificación de Kffe’to (categorías, grupos o etiquetas), la base aún debe guardar el tipo elegido y sus permisos; los pedidos multi-restaurante deben guardar sus relaciones con catálogo.
- **Catálogo:** se añadió al repositorio un catálogo multi-restaurante inspirado en Kffe’to (productos, categorías, etiquetas, variantes, agregados y disponibilidad por sede), con RLS y UI. `is_active` indica si se puede vender; los registros fuera de stock siguen visibles y muestran un diálogo al intentar agregarlos. Admin administra Catálogo y Empleado puede cambiar disponibilidad desde el menú por una operación de servidor limitada. Falta aplicar la migración `202611100001_restaurant_catalog.sql` a Supabase. Los interruptores de agregados, grupos y promociones aún no gobiernan esos flujos; las promociones no tienen editor ni aplicación al cobro.
- **Notas:** lectura/escritura y visibilidad administrativa están implementadas. No se ha construido reinicio manual ni automático. El campo modo/intervalo se guarda; la nota no se borra porque faltan fecha exacta, retención y archivo/historial definidos.
- **Estadísticas y caja:** la especificación sigue las métricas de Kffe’to y agrupa la interfaz por la fecha de apertura de Caja. Caja tiene estado booleano y un registro mensual por restaurante organizado por fecha, turno y timestamps de apertura/cierre. Solo hay un periodo por turno; cerrar manualmente exige contraseña y solo el administrador puede reabrir, eliminando la marca de cierre del JSON. El fin del turno no cierra Caja: muestra un aviso y permite seguir cobrando. Un proceso automático, aun sin cuentas iniciadas, cierra Caja a menos de cinco minutos del cambio al siguiente turno. Esto es preventivo para operaciones pendientes futuras, no significa que hoy haya una; si un flujo afectado devuelve `closedCashier`, es un error y no cuenta en Estadísticas. Se avisa al administrador que respete los horarios. Cada turno obtiene sus pagos consultando sus periodos de Caja. Configuración de Estadísticas puede mostrar separadores visuales sin alterar movimientos o cálculos. Falta definir qué retención tiene el JSON al reiniciar cada mes; cada movimiento conserva su timestamp real.

La pantalla de Configuración advierte que cobro, promociones y límites necesitan migración del flujo operativo multi-restaurante. Mantener esa transparencia.

## Bloqueo de producto antes de incorporar clientes

`supabase/README.md` documenta la condición principal: `orders`, `open_orders` y RPC financieras/asistencia siguen sin un modelo uniforme `restaurant_id` con RLS multi-tenant verificada. La migración del catálogo aislado ya está en el repositorio, pero aún no aplicada al proyecto Supabase. La tabla de restaurantes/cuentas/roles tiene base compartida; eso no aísla automáticamente pedidos ni pagos. **No conectar clientes reales ni usar sus operaciones hasta completar y verificar ese aislamiento.**

El primer restaurante de prueba con Cocina/Salón también depende de aplicar las migraciones de catálogo y workspaces. Incluso después, debe probarse con datos aislados: el modelo de pedidos heredado y el esquema de roles siguen siendo bloqueos conocidos para validar un restaurante completo.

El siguiente trabajo de arquitectura debería definir/migrar primero:

1. Aplicar y verificar la migración del catálogo; luego conectar estadísticas de categoría y flujos promocionales.
2. Pedidos abiertos, movimientos, items, pagos divididos y correcciones con pertenencia al restaurante, snapshots y autorización en RLS/RPC.
3. Pagos: hasta diez importes por movimiento y una lista ordenada de métodos históricos alineada con esos importes; total y validación de suma en servidor. No renombrar movimientos históricos al cambiar los métodos actuales.
4. Pruebas de aislamiento con dos restaurantes distintos y roles diferentes, antes de publicar la operación a clientes.

Lee `specs/Database/kffeto_production_reference_001.md` antes de proponer SQL. Ese documento resume el esquema de Kffe’to recibido y sus límites; sirve de inspiración, no incluye cuerpos de RPC ni autoriza copiar su diseño.

## Diferencia entre spec y el código actual que hay que resolver

El esquema actual todavía asocia `roles` a cada restaurante mediante `restaurant_id` y `accounts` solo tiene `role_id` singular. Setter crea roles **Administrador** y **Empleado** por restaurante. Esto no implementa la dirección global/multirrol acordada el 10 de noviembre. La migración de roles debe diseñarse después de definir cómo mantener la integridad de las listas de IDs y cómo aplicar los permisos calculados por la app también en servidor/RLS.

En el árbol local se confirmó que `staff-admin/index.ts` declaraba `schedules` dos veces y ejecutaba dos inserciones de los mismos horarios al crear una cuenta. Se eliminó el bloque duplicado. `deno check` pasó para las cuatro Edge Functions (`setter-create-restaurant`, `setter-admin`, `staff-admin` y `restaurant-access`). La corrección se publicó en el commit `65d482a`; GitHub Actions #10 terminó correctamente y desplegó las Edge Functions.

## Supabase, Auth y publicación

- Proyecto Supabase compartido: referencia `yqrilxnldkzmbhxzagaz`.
- POS usa Supabase Auth con usuario escrito por el cliente y alias interno del Gmail base `AUTH_EMAIL_BASE`; las contraseñas viven en Auth, no en `accounts`.
- Setter valida el usuario autenticado contra `platform_operators`. No introducir service role key en frontend, repositorios ni logs.
- Migración inicial: `202611060001_platform_core.sql`.
- Migración transitoria de catálogo de arquitectura: `202611070001_setter_architecture_catalog.sql`.
- Migración vigente de necesidades fijas y eliminación del catálogo genérico: `202611080001_fixed_optional_needs.sql`.
- Migración de preferencias operativas: `202611080002_restaurant_operational_settings.sql`.
- Migración de catálogo multi-restaurante y formatos de comprobante: `202611100001_restaurant_catalog.sql` (pendiente de aplicar al proyecto remoto).
- Migración de espacios de trabajo de Cocina/Salón: `202611110001_restaurant_workspaces.sql` (estado remoto por confirmar).
- Migraciones de bucket/logos y privilegios del servicio: `202611110002_restaurant_logo_storage.sql` y `202611110003_setter_restaurant_service_access.sql` (el segundo está incluido en `dd5df2c`; estado remoto por confirmar).
- Workflow `.github/workflows/deploy-supabase.yml`: cuando cambia `supabase/**`, `main` enlaza proyecto, ejecuta `supabase db push --yes --remote` y despliega cuatro Edge Functions.
- Secrets de GitHub Actions ya funcionaban en el último run. En GitHub están como nombres `SUPABASE_ACCESS_TOKEN` y `SUPABASE_DB_PASSWORD`; nunca documentar sus valores.
- El proyecto Cloudflare Pages está conectado al repositorio. Los cambios bajo `supabase/**` despliegan Supabase mediante Actions; los cambios de frontend publican Pages. Comprobar el despliegue que corresponda a cada cambio.
- No repetir ni permitir que se suba `supaSecret.txt` u otro token personal. Push protection de GitHub bloqueó ese archivo anteriormente; el archivo/commit con token no debe volver a estar en historial.

### Historial de error al aplicar migraciones

El propietario reportó que `supabase db push --yes --remote` se detuvo en `202611100001_restaurant_catalog.sql`, al crear `public.categories`, con `ERROR: relation "categories" already exists` (`SQLSTATE 42P07`). Esto demuestra que el esquema remoto ya tenía al menos esa relación cuando la migración intentó crearla; no asumir que la base remota coincide con el historial local de migraciones. El usuario compartió resultados de introspección de tablas, funciones y otros objetos para reconciliar la diferencia. Antes de volver a ejecutar `db push`, revisar el estado actual de `supabase_migrations.schema_migrations` y comparar el esquema remoto con **todas** las sentencias de `202611100001_restaurant_catalog.sql`; hacer una reparación segura y repetible. No resolverlo con `IF NOT EXISTS` a ciegas, marcando la migración como aplicada sin validar cada objeto/policy/RPC, ni editando una migración que ya se haya aplicado en algún entorno. Hasta reconciliar esto, la acción del commit `dd5df2c` podría volver a detenerse antes de llegar al GRANT de `202611110003`.

## Especificaciones disponibles

`specs/README.md` enlaza a las specs separadas de Setter, diseño, Cuentas, CRM, Flujo de pedidos, Salón, Cocina, Estadísticas, Catálogo y Configuración. Antes de modificar un área, leer su spec y verificar si una decisión es final, borrador o pendiente.

Detalles recientes del usuario ya reflejados en las specs:

- Roles globales compartidos, arrays de IDs de roles habilitados en cada restaurante y asignados a cuentas. No hay roles mixtos; los permisos se acumulan con varios roles simples. `Empleado` es exclusivo y acumula todos los permisos disponibles para el restaurante.
- Mapeo acordado: Cocina habilita Cocinero; «Tengo una barra separada de la cocina» añade Barista, Bartender y el espacio Barra; Salón habilita Mesero y Portero; CRM habilita Social Manager; Delivery habilitará Repartidor cuando se definan sus configuraciones; Comprobantes no añade rol. Si existe alguna necesidad activa distinta de Comprobantes, incluir Cajero; si se quitan todas, quitar Cajero.
- El administrador puede añadir/quitar necesidades después del alta. Quitar una necesidad revoca sus roles y acceso sin borrar sus datos. Falta decidir qué ocurre con roles asignados a cuentas al reactivar esa necesidad.
- Arquitectura de colas propuesta: pedido abierto/pagado sigue como flujo base; Cocina y Salón agregan colas solo si sus necesidades están activas. Cocina marca listo y, si hay Salón, pasa a su cola para servir. Configuración independiente define entrada desde Pedido abierto o Pedido pagado para Cocina/Salón; Delivery tiene control separado para mandar a cocinar tras pago virtual. Salón propone una fila por restaurante con array de mesas. Falta definir la forma física de colas, reglas de Salon sin Cocina, Cocina sin Salón, Cocina+Delivery sin Salón y los tres módulos juntos.
- Salón tendrá uno o varios pisos; cada piso guarda una grilla con celdas redimensionables manualmente. Cada mesa del array registra piso y coordenada. Al crear, se asigna número y celda en orden cardinal. Botón Editar es visible al admin; Configuración puede permitirlo también a Mesero y Portero. Mantener 3s activa el estado de arrastre; si no se arrastra, a los 7s aparece menú Renombrar/Redimensionar/Fusionar. Renombrar usa números únicos 1–100; Redimensionar ocupa líneas/celdas libres; Fusionar requiere vecino tocando un lado (no diagonal). Al soltar un movimiento, el realce se va en 2s. Modo visión no edita mesas ni sillas. Configuración puede mostrar total de sillas por piso y una representación visual no editable; no se guardan posiciones de sillas. Con un piso, pedidos muestran «Mesa N»; con varios, «Piso N · Mesa N» a Cocina y Salón. Pendientes: orientación cardinal exacta, resultado/deshacer fusión, distribución visual de sillas y modelo de datos.
- `account_schedules` actual admite varias filas por cuenta, pero no ofrece horarios reutilizables. Se discutió migrar a asignaciones basadas en IDs de horarios; la forma final está pendiente.
- Black&White no tiene tabla de registros de asistencia ni `open_orders`/pedidos pagados. Dirección acordada para asistencia: al crear la cuenta de empleado se crea también su `attendance_object`, aunque no tenga marcas; la cuenta apunta a ese objeto y agrupa cero o muchos `attendance_records` en una tabla compartida por restaurantes. Sigue pendiente si hace falta una referencia inversa y el diseño de columnas/flujo de cada marca. El pedido pagado debe conservar cabecera, líneas, agregados y snapshots equivalentes a la información de las tres tablas financieras de Kffe’to; su forma física queda pendiente.

- Pagos activos/desactivados, con manual/automático por método (efectivo y transferencia solo manual; Yape/Plin/tarjeta admiten ambas modalidades, pero automático requiere proveedor).
- Notas de cuenta para fin de mes; reinicio manual o 7/15/30 días, sin borrar automáticamente hasta decidir la política.
- Rankings: productos, variantes, agregados y categorías; admin configura visibilidad; empleados ven el mismo conjunto o uno por rol. Categoría requiere escoger una categoría válida.
- Límites mínimo/máximo y permisos para pedidos correctivos/devoluciones configurados para admin y roles de empleados.
- Catálogo: interruptores para agregados, grupos de categorías y promociones; el admin define promociones en Catálogo y empleados las aplican solo al cobrar si cumplen condiciones.
- Asistencia futura: marcas separadas de entrada/salida, actor y sede efectiva; permisos configurables para uno mismo o compañeros de sede; heatmap calculado de eventos, no persistir colores.

## Próximos pasos recomendados

1. Revisar la UX en producción de Configuración/Cuentas con una cuenta de prueba, sin cargar datos reales de clientes.
2. Diseñar e implementar el catálogo global de roles y la asignación multirrol, con permisos calculados desde necesidades/configuración y validados en servidor.
3. Diseñar y migrar el catálogo/pedidos/cobros a un esquema con aislamiento multi-restaurante y policies/RPC seguras.
4. Conectar el checkout a las modalidades manuales configuradas; después integrar pagos automáticos y definir proveedor.
5. Implementar efectivamente límites, devoluciones/correcciones y promociones, con validación en servidor.
6. Definir la política de reinicio de notas, ranking de categorías y permisos de turno nocturno antes de automatizar/mostrar datos históricos.

## Cuidado al continuar

- El dueño autorizó aplicar cambios y publicar a producción en la conversación anterior. Ese permiso no implica que cada migración destructiva o cambio de datos se deba hacer sin revisar el impacto.
- No modificar una migración ya aplicada en producción; crear otra nueva con timestamp posterior.
- No desplegar un cambio que haga creer que un ajuste se hace cumplir si solo se guarda en la interfaz/base.
- Mantener el repositorio sin secretos; la clave pública Supabase es publicable, las credenciales de servicio y tokens no.
