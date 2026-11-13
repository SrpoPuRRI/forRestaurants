# Handoff de Black&White POS

**Actualizado:** 13 de noviembre de 2026
**Repositorio:** `F:\PROYECTOS\forRestaurants`
**Rama y corte local:** `main`, commit `61a6ae4` (`ankfasnkfamkafamfak`). El árbol estaba limpio antes de actualizar este documento.
**Estado de publicación:** el propietario confirmó que subió a producción los últimos cambios y que funcionan. No se consultaron directamente GitHub Actions, Cloudflare Pages ni el historial remoto de Supabase en esta sesión; verifica esos estados antes de asumir que una migración se aplicó.

## Instrucciones importantes para el siguiente agente

- El proyecto principal es este repositorio, **forRestaurants / Black&White POS**.
- `F:\PROYECTOS\Kffeto POS` es una aplicación de producción usada solo como inspiración e investigación. **No editar sus archivos.** El usuario dijo que no se toque ese código.
- `F:\PROYECTOS\dosMiniProyectos\setter` es el configurador separado. Se puede modificar, pero lee primero su documentación y comprueba su estado actual.
- No asumir que una regla escrita en una spec ya existe en código. Distinguir siempre entre decisión aprobada, implementación local y estado desplegado.
- El usuario suele probar personalmente la interfaz y prioriza flujos directos y prácticos para restaurantes pequeños. No volver a pedir decisiones ya registradas en las specs.
- No insertar contraseñas, service keys ni tokens en repositorios, logs o documentación.

## Resumen del producto

Black&White POS es un POS multi-restaurante. Setter da de alta restaurantes y sus necesidades; la aplicación POS autentica al personal, calcula los permisos según los roles asignados y las necesidades/configuraciones, y muestra los espacios de trabajo del restaurante. Kffe’to ayuda a entender comportamientos operativos reales, pero su esquema no es el diseño final de B&W.

Las secciones fijas son **Cuentas, Estadísticas, Flujo de pedidos, Catálogo y Configuración**. Las necesidades opcionales son **CRM, Cocina, Salón, Delivery y Comprobantes**. Orden en la navegación:

1. Cuentas.
2. CRM, si está activo.
3. Estadísticas.
4. Delivery, si está activo.
5. Flujo de pedidos.
6. Cocina, si está activa.
7. Barra, después de Cocina, si se configuró barra separada.
8. Salón, si está activo.
9. Catálogo.
10. Configuración, al final.

El POS autenticado muestra el nombre y logo del restaurante como marca principal. El login conserva la marca Black&White.

## Estado de producción más reciente

El usuario confirmó que subió el commit `61a6ae4` a producción y que los cambios de pagos y Estadísticas funcionan. Ese corte incorpora:

- Recargar la configuración de rankings desde la base al entrar a Estadísticas; exigir que los rankings estén habilitados y permitidos para el rol para mostrar sus secciones.
- Cargar únicamente métodos de pago habilitados para cobro manual en Estadísticas. Mostrar el desglose cuando hay más de un método manual disponible; no renderizar el desglose ni los métodos desactivados si solo está activo Efectivo.
- Actualizar los métodos manuales antes de abrir el modal de Ingreso/Egreso y antes de confirmar el pago, para que la lista refleje la configuración actual del restaurante.
- El modal de pago ofrece opciones configuradas, no una lista fija de Yape/Efectivo.

**Producción:** según el propietario, los cambios recién publicados funcionan. El agente que retome no necesita volver a pedir que se repita esa prueba; si aparece un problema nuevo, leer primero el código exacto del commit publicado y comparar los datos de configuración.

## Base de datos y migraciones

El workflow `.github/workflows/deploy-supabase.yml` aplica migraciones y despliega Edge Functions al llegar cambios a `main`. Cloudflare Pages publica el frontend desde su repositorio configurado. Son despliegues separados: comprobar ambos cuando corresponda.

Migraciones presentes en este repositorio, en orden:

- `202611060001_platform_core.sql`: plataforma, restaurantes, cuentas, sedes, roles/identidad inicial, RLS y almacenamiento de logos.
- `202611070001_setter_architecture_catalog.sql` y `202611070002_fix_service_role_claim.sql`: cambios transitorios/compatibilidad de Setter; parte de ese modelo es legado.
- `202611080001_fixed_optional_needs.sql`: necesidades fijas y restricciones de Setter.
- `202611080002_restaurant_operational_settings.sql`: métodos de pago, preferencias y notas por restaurante.
- `202611100001_restaurant_catalog.sql`: catálogo multi-restaurante, variantes, agregados, disponibilidad por sede y formato de comprobante.
- `202611110001_restaurant_workspaces.sql`: estructuras y RPC de pisos, mesas, colas de cocina/salón y estados de progreso.
- `202611110002_restaurant_logo_storage.sql`: bucket privado y políticas de logo.
- `202611110003_setter_restaurant_service_access.sql`: concede `SELECT`/`UPDATE` de `restaurants` al `service_role` que usa Setter. `BYPASSRLS` por sí solo no concede privilegios SQL.
- `202611120001_accounts_roles_attendance.sql`: catálogo global de roles, arrays de roles, horarios reutilizables y tablas de asistencia.
- `202611120002_account_locations_and_active_usernames.sql`: sede principal y unicidad de nombres de usuario entre cuentas activas.
- `202611120003_paid_orders_and_statistics.sql`: `orders`, `order_items`, `order_item_addons`, `order_correction_events`, `open_orders` y RPC de pedidos/pago/corrección.
- `202611130001_required_special_products_and_payment_rules.sql`: productos Ingreso/Egreso obligatorios, efectivo forzado y correcciones sin motivo. La sintaxis del `CASE` del trigger se corrigió agrupando la expresión; no restaurar la versión que falló con `syntax error at end of input`.
- `202611130002_reconcile_account_roles_on_need_changes.sql`: sincroniza roles habilitados y reasigna a Empleado cuentas que quedan sin roles al retirar necesidades.
- `202611130003_restaurant_color_schemes.sql`: agrega `restaurants.appearance` JSONB para esquemas de color claro/oscuro opcionales.

El usuario indicó que desplegó los últimos cambios y que funcionan. Aun así, el Handoff no reemplaza la evidencia del historial remoto: si una nueva tarea depende de una columna/función específica, verifica `supabase_migrations.schema_migrations` o consulta el esquema remoto antes de proponer otra migración. Nunca edites migraciones ya aplicadas; agrega una con timestamp posterior.

El primer intento remoto del catálogo falló con `relation "categories" already exists`. Se compartieron introspecciones para reconciliar diferencias de esquema. No resuelvas discrepancias con `IF NOT EXISTS` a ciegas ni marcando una migración como aplicada sin verificar todas sus tablas, índices, políticas, funciones y triggers.

## Roles, necesidades y Cuentas

Los roles son permisos globales, no roles mixtos predefinidos:

- `roles` es el catálogo global, sin relación con restaurante ni cuenta.
- `restaurants.available_role_ids` contiene los roles habilitados para ese restaurante.
- `accounts.role_ids` permite asignar varios roles y acumular sus permisos.
- `Administrador` y `Empleado` siempre existen. `Empleado` es exclusivo y representa la unión de permisos de los roles disponibles para ese restaurante, sin permisos de admin.
- Los roles disponibles derivan de necesidades y configuraciones: Cocina → Cocinero; barra separada → Barista, Bartender y espacio Barra; Salón → Mesero y Portero; CRM → Social Manager; Delivery → Repartidor. Cajero se incluye cuando hay una necesidad activa distinta de Comprobantes. Al retirar necesidades se eliminan roles de la lista habilitada, pero se conservan datos.
- El administrador del POS puede añadir o quitar necesidades después del alta. Una sede principal es requisito del restaurante.

Cuentas permite crear, editar y desactivar cuentas; la interfaz no reactiva cuentas desactivadas. Los nombres de usuario son únicos entre cuentas activas, los nombres completos pueden repetirse. Los horarios múltiples se asignan a la cuenta, requieren entradas/salidas válidas y no superpuestas. La baja no borra el historial.

Asistencia usa `attendance_objects` (un objeto por empleado) y `attendance_records` (marcas). La cuenta apunta al objeto. Se conserva hora efectiva, hora de registro, actor, sede, método y motivo de corrección de marca; no confundir el motivo de corrección de asistencia con el de pago. Asistencia no es lo mismo que los turnos/caja de Estadísticas.

### Nota pendiente sobre contraseña en `accounts`

El propietario añadió manualmente una columna `accounts.passwords` en Supabase y pidió conservar la contraseña legible. En el `app.js` actual, el flujo de cambio de contraseña actualiza primero Supabase Auth e intenta después `accounts.update({ passwords: ... })`, pero no comprueba ni reporta el error de esa actualización. No hay una migración del repositorio que cree esa columna ni consta aquí que el alta inicial de cuentas la rellene. **No afirmar que la copia en `accounts.passwords` está funcionando** sin inspeccionar esquema y respuesta de la operación. El login y la contraseña efectiva siguen dependiendo de Supabase Auth.

## Catálogo

El catálogo multi-restaurante tiene productos estándar, categorías, etiquetas, variantes, agregados y disponibilidad por sede. `is_active` significa disponible para vender; lo inactivo sigue visible en la búsqueda, pero no se añade al pedido y la app presenta un diálogo propio. Desactivar no equivale a eliminar. No hay inventario por cantidad.

El catálogo de administración solo crea productos estándar. Ingreso/Egreso se gestionan como productos especiales protegidos, descritos abajo. Formato de ticket se ofrece desde Configuración solo si el restaurante tiene Comprobantes; la configuración de impresión todavía muestra «Próximamente».

## Flujo de pedidos, pagos y productos especiales

### Implementado en el modelo actual

- `open_orders` conserva borradores abiertos por sede y operador con revisión optimista.
- `orders` guarda movimientos pagados y snapshots de importes/métodos/modos, total, operador, sede y timestamps.
- `order_items` y `order_item_addons` conservan nombres/precios como snapshots.
- La persistencia admite hasta diez importes/métodos por movimiento; la base valida sumas y conserva snapshots históricos.
- `correct_paid_order` marca el pedido original Erróneo y crea un evento de corrección; no borra el movimiento original. Solo muestra candidatos de hoy/ayer según permisos y sede. Estadísticas excluye los movimientos erróneos de métricas limpias, pero conserva su aviso en el historial.

### Reglas actuales de Ingreso y Egreso

- Todo restaurante debe tener un producto **Ingreso** y uno **Egreso**, con variante **Monto variable** de precio cero. La migración `202611130001...` los siembra para restaurantes existentes y un trigger los crea al insertar futuros restaurantes.
- Son obligatorios: no se crean a mano desde Catálogo, no se pueden eliminar, renombrar, cambiar de tipo ni desactivar. La variante también está protegida.
- Al registrar un movimiento, el empleado introduce un monto mayor que cero y puede escribir concepto opcional. Ingreso suma; Egreso resta. Cada línea especial tiene cantidad uno, sin agregados.
- El modal muestra métodos habilitados para cobro manual del restaurante. **Efectivo es obligatorio para todos los restaurantes** y la interfaz/base impiden desactivarlo. Yape, Plin, transferencia y tarjeta aparecen solo si se habilitaron para cobro manual.
- Corregir un pago no pide explicación. La base conserva actor y hora; el contexto del empleado pertenece a sus notas. La columna histórica `reason` de eventos de corrección puede quedar en `NULL` por compatibilidad.
- Egreso no significa automáticamente devolución ni activa por sí mismo una corrección. Si el restaurante necesita simbolizar una devolución como movimiento, acuerda un producto/concepto separado según su política interna.

### Límites que aún deben respetarse

- La UI permite elegir cualquier método manual habilitado para un pago global y para los movimientos especiales. El pago dividido de productos estándar sigue siendo específicamente entre Yape y Efectivo; un split genérico entre cualquier pareja de métodos no está implementado.
- Métodos automáticos no tienen proveedor integrado y siguen deshabilitados.
- No hay ciclo completo de anulaciones, devolución financiera, caja ni control de turnos.
- Límite mínimo/máximo y permisos relacionados tienen configuración guardada, pero verificar en `record_paid_order` si se aplican antes de prometerlo: no inferir cumplimiento por la UI de Configuración.

## Estadísticas y Caja

- Estadísticas usa la fecha/rango del timestamp del movimiento y zona `America/Lima`; para un solo día grafica pedidos por hora, para rango por día.
- Métricas limpias incluyen solo movimientos Correctos: saldo neto, cantidad, promedio y desglose cuando existen varios métodos de pago manual habilitados.
- Rankings respetan el switch global, los switches por tipo y los permisos de rol. Si no hay ninguno habilitado/visible, no debe salir la sección ni un «no hay rankings». El último cambio recarga la configuración al entrar a Estadísticas para evitar valores antiguos en memoria.
- El desglose lista métodos activos para cobro manual; con solo efectivo se oculta, y no deben aparecer métodos desactivados.
- El historial sí conserva movimientos Erróneos con aviso. Ingreso/Egreso participa en saldo neto con signo; productos especiales no cuentan como unidades de productos vendidos.

**Caja aún es diseño/spec, no flujo terminado:** hay una propuesta de boolean abierta/cerrada, registro mensual por turnos con timestamps, cierre manual con contraseña y cierre automático cerca del siguiente turno. El fin de turno no debe cerrar automáticamente la caja. No decir que esto ya existe en producción. Ver `specs/Estadísticas/spec_001.md`.

La migración `202611130003_restaurant_color_schemes.sql` es necesaria para la última versión de Configuración; no se aplicó desde este entorno. El esquema activo es compartido por restaurante y el tema claro/oscuro es una preferencia personal por navegador (`localStorage`).

## Cocina, Salón y demás necesidades

El modelo contempla colas separadas por necesidad, referencias a pedidos y estados de Cocina/Salón. Cocina puede marcar pedido, ítem o unidades listas y declarar disponibilidad fuera de stock; Salón tiene pisos, mapa de grilla, mesas y flujo de servicio. Las necesidades desactivadas no deben borrar datos operativos. Revisa `specs/Cocina/spec_001.md` y `specs/Salón/spec_001.md` antes de tocar esas áreas.

La UI/código local de Cocina y Salón ya contiene trabajo sustancial (colas, progreso, pisos, grillas, mesas, permisos de edición y sillas por piso). Sin embargo, el flujo completo y todas las combinaciones siguen pendientes de prueba con datos reales. No asumir reglas finales para Solo Salón, Solo Cocina, Cocina+Delivery sin Salón o Cocina+Salón+Delivery. La cola no sustituye `open_orders` ni `orders`.

- CRM: prototipo visual; no necesita conexión a base todavía.
- Delivery: espacio «Próximamente»; el rol Repartidor aún no ejecuta el flujo.
- Comprobantes: botón de configuración e interfaz «Próximamente»; falta integrar impresión.
- Barra: espacio informativo si el restaurante separó barra; no hay reparto operativo de artículos entre Cocina y Barra.

## Setter, logo, autenticación y publicación

Setter es un proyecto separado en `F:\PROYECTOS\dosMiniProyectos\setter`. La cuenta está permitida por `platform_operators`. El login POS consulta la cuenta autenticada y restaurante directamente usando RLS; el error anterior `UNAUTHORIZED_NO_AUTH_HEADER` se abordó evitando la llamada extra `restaurant-access` durante el inicio/restauración de sesión. No reintroducirla sin revisar el flujo actual.

El logo se guarda en Storage privado `restaurant-assets`; `restaurants.logo_path` solo conserva la ruta. POS admin puede cambiarlo desde Configuración y Setter desde edición/creación. El error `permission denied for table restaurants` venía de privilegios SQL ausentes para `service_role`, no del bucket: revisa `202611110003_setter_restaurant_service_access.sql` si vuelve a aparecer.

El sitio público usa Cloudflare Pages. El usuario compró `bnw.cash` y configuró DNS/Pages; en los últimos mensajes seguía pendiente de propagación/verificación de Namecheap y DNS. El estado actual del dominio debe comprobarse si vuelve a ser relevante; no asumir que está resuelto solo porque Pages publique en `*.pages.dev`.

El portafolio comercial está especificado en `specs/Portafolio/spec_001.md`. El directorio indicado por el usuario se llama literalmente `protfolio/`; en un corte anterior no apareció dentro de `F:\PROYECTOS`. Confirma su ubicación actual antes de escribir archivos. El objetivo es Github Pages y un subdominio de `bnw.cash` que redirija al portafolio; no mezclarlo con el runtime del POS.

## Documentación para continuar

Antes de implementar un módulo, lee su spec y sus dependencias:

- `specs/README.md`: decisiones generales y mapa de documentos.
- `specs/Setter/`: Setter.
- `specs/Cuentas/`: cuentas, roles, necesidades y asistencia.
- `specs/Flujo de pedidos/`: pedidos, pagos, especiales y colas.
- `specs/Estadísticas/`: métricas, Caja y rankings.
- `specs/Catálogo/`: productos y disponibilidad.
- `specs/Cocina/`, `specs/Salón/`: cocina y mapa/servicio.
- `specs/Configuración/`: preferencias disponibles.
- `specs/Pendientes por definir/`: preguntas aún abiertas.
- `specs/Database/kffeto_production_reference_001.md`: referencia investigada en Kffe’to, solo lectura.
- `HANDOFF.md`: estado de implementación y despliegue, actualizado aquí.

## Próximas verificaciones y trabajo posible

1. Mantener este handoff y las specs sincronizados cuando una decisión cambie.
2. Cuando se toque pagos, comprobar modal con solo Efectivo, con Efectivo+Yape y con un método alterno manual (Plin/transferencia/tarjeta); comprobar también cambio de configuración dentro de una sesión.
3. Cuando se toque Estadísticas, comprobar que desactivar global/individualmente los rankings oculta por completo sus secciones, que empleados respeten su rol y que con solo Efectivo no aparezca desglose.
4. Continuar definiendo y probando el ciclo abierto→cocina→salón→cobro, especialmente las combinaciones pendientes en la spec. El flujo de Caja y los turnos aún requiere discusión e implementación.
5. Resolver la divergencia de la columna manual `accounts.passwords`: confirmar existencia/permisos/altas y errores en `app.js`; no afirmar que el valor se actualiza si el resultado de Supabase no se valida.
6. Si hay que tocar producción, comprobar antes el estado remoto de migraciones y el deployment de Pages. El usuario reportó que el commit `61a6ae4` funciona en producción, pero no se consultó el run desde esta sesión.

## Preferencias de trabajo del propietario

- Leer código y documentación antes de diagnosticar problemas; el propietario se frustra con hipótesis sin revisar el repo.
- No tocar el código de Kffe’to POS; es inspiración de solo lectura.
- No implementar una devolución como motivo obligatorio de corrección. Una corrección financiera no pide explicación; las notas de empleados guardan contexto. Las devoluciones como movimientos se registran aparte conforme al acuerdo del restaurante.
- Efectivo siempre está disponible. Los demás métodos se configuran por restaurante.
- No borrar datos por desactivar necesidades, productos o mesas fuera de las reglas expresas de cada spec.
