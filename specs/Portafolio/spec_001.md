# Portafolio web de Black&White POS

**Estado:** plan acordado; implementación pendiente  
**Fecha:** 15 de noviembre de 2026

## Objetivo

Crear un sitio web independiente para presentar y vender Black&White POS a restaurantes. Debe comunicar el producto y su identidad con claridad, generar confianza y ofrecer una forma directa de pedir información o una demostración.

El sitio no forma parte de la interfaz operativa del POS ni de Setter. Se desarrollará en el repo separado `F:\PROYECTOS\dosMiniProyectos\portfolio` (la carpeta existente; `protfolio/` fue un error de escritura) y se publicará como un sitio aparte en GitHub Pages. No se modificará el código de producción de Kffe’to POS.

## Publicación y dominio

- GitHub Pages alojará el sitio estático.
- Un subdominio de `bnw.cash` redirigirá a la URL pública del sitio de GitHub Pages mediante una regla de redirección de Cloudflare.
- La redirección debe conservar la ruta y, cuando corresponda, los parámetros de consulta.
- El subdominio exacto y la URL final de GitHub Pages se confirmarán al preparar la publicación.
- La configuración debe quedar separada del dominio principal que usa Black&White POS.

Una entrada DNS por sí sola no redirige una visita web. La redirección se configurará en Cloudflare y requerirá que el registro DNS del subdominio pase por su proxy. No se implementará un script de redirección dentro del POS.

## Contenido y diseño

El sitio tendrá como audiencia principal a dueños y administradores de restaurantes que evalúan un sistema POS. El contenido debe explicar el valor del producto con lenguaje directo y mostrar una identidad visual coherente con Black&White. También funcionará como página comercial informativa con opciones y recomendaciones de hardware.

Antes de considerar terminado el sitio, se definirán y revisarán como mínimo:

- nombre, titular y descripción breve del producto;
- propuesta comercial vigente: S/ 2,000 como compra única de Black&White y S/ 50 por año como aporte de continuidad/infraestructura; antes de publicar se debe explicar qué cubre la cuota y qué ocurre si no se renueva;
- el POS funciona en tablet, PC y móvil; los requisitos mínimos de navegador/dispositivo y las diferencias de impresión deben especificarse antes de prometer compatibilidad;
- tablets usadas o reacondicionadas opcionales a un precio propuesto de S/ 300; informar estado, pruebas realizadas, accesorios incluidos y garantía;
- lista de impresoras dividida por modalidad comprobada: impresión manual desde navegador e impresión automática con BPrint; publicar modelos solo después de validar la combinación de modelo, conexión y modalidad;
- enlaces de compra a impresoras compatibles con precios objetivo de S/ 600–800; se puede obtener una comisión o revender con margen, indicando al cliente de forma clara cualquier comisión o relación comercial;
- aviso de compatibilidad: el soporte se confirma para los modelos y modalidades publicados; otros modelos pueden funcionar, pero no se garantiza su compatibilidad;
- funcionalidades que ya se pueden ofrecer en el restaurante de prueba, distinguiéndolas de prototipos o módulos pendientes;
- capturas o imágenes del producto y sus textos alternativos;
- llamada a la acción y canal de contacto;
- datos de contacto y enlaces públicos;
- adaptación a móvil, escritorio y accesibilidad básica;
- icono, título, descripción para compartir/buscadores y página de error si hace falta.

Los precios anteriores quedan registrados como decisiones comerciales actuales, pero las condiciones de venta y soporte siguen pendientes. No publicar promesas de funciones, datos de clientes ni testimonios sin confirmación del usuario. El contenido comercial debe reflejar el estado real de las funciones, teniendo en cuenta las limitaciones indicadas en `HANDOFF.md` y la matriz de candidatos de `BPrint/docs/PRINTER_CANDIDATES.md`.

## Flujo de trabajo

1. Preparar el sitio de forma aislada en `protfolio/`, sin mezclar sus archivos con el runtime del POS.
2. Revisar el contenido y los detalles visuales con el usuario.
3. Verificar enlaces, visualización móvil/escritorio, metadatos y publicación de GitHub Pages.
4. Configurar y comprobar la redirección del subdominio en Cloudflare.
5. Documentar la estructura final, el repositorio y la URL de GitHub Pages, el subdominio, la regla de Cloudflare, el flujo de publicación y cualquier limitación.

## Pendientes antes de cerrar

- Confirmar el subdominio que se usará (propuesta: `portafolio.bnw.cash`).
- Confirmar la llamada a la acción y el método de contacto.
- Seleccionar capturas y funcionalidades que se presentarán públicamente.
- Definir las condiciones de compra única y cuota anual: soporte, actualizaciones, respaldos, infraestructura y efecto de no renovar.
- Definir el proceso de revisión, accesorios, garantía y devoluciones para tablets reacondicionadas.
- Validar impresoras físicamente antes de publicarlas como compatibles y definir condiciones de afiliación o reventa.
- Confirmar el nombre del repositorio de GitHub Pages y su URL publicada.
- Verificar que Cloudflare haya activado la zona `bnw.cash` y que el subdominio no interfiera con los registros existentes.

La página no se considera completa hasta revisar estos detalles y comprobar de extremo a extremo la publicación y la redirección.
