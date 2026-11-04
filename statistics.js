// Crea la logica de la vista de estadisticas.
export default function createStatistics({
  supabase,
  state,
  render: refreshApp,
  printTicket,
  money,
  esc,
  limaToday,
  formatDateShort,
  formatDateLong,
}) {
  const storageKey = "kffeto.stats.sections.v1";
  const defaults = {
    products: true,
    variants: true,
    addons: true,
    taxonomy: true,
    taxonomyType: "category",
  };
  const data = {
    initialized: false,
    loading: false,
    error: "",
    taxonomyError: "",
    allOrders: [],
    orders: [],
    items: [],
    addons: [],
    locations: [],
    categories: [],
    tags: [],
    productCategories: [],
    productTags: [],
    categoryGroups: [],
    corrections: [],
    start: limaToday(),
    end: limaToday(),
    mode: "single",
    selectedLocation: "",
    availableDates: [],
    settings: readSettings(),
    detailDialog: null,
    dateDialog: null,
    settingsDialog: null,
  };

  // Lee las preferencias guardadas localmente.
  function readSettings() {
    try {
      return {
        ...defaults,
        ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
      };
    } catch {
      return { ...defaults };
    }
  }
  // Guarda las preferencias para futuras sesiones.
  function saveSettings(settings) {
    data.settings = settings;
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {
      /* Preferences remain usable for this session. */
    }
  }
  // Convierte una fecha local en un objeto Date.
  function dateAt(value) {
    return new Date(`${value}T00:00:00-05:00`);
  }
  // Suma dias a una fecha y devuelve el resultado.
  function addDays(value, amount) {
    const [year, month, day] = value.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + amount));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  }
  // Genera la etiqueta de la fecha actual.
  function todayLabel() {
    return formatDateLong(limaToday());
  }
  // Formatea una fecha dentro de un periodo.
  function periodDate(value, includeYear = false) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const parts = new Intl.DateTimeFormat("es-PE", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).formatToParts(date);
    const dayText = parts.find((part) => part.type === "day")?.value;
    const monthText = parts.find((part) => part.type === "month")?.value;
    return `${dayText} de ${monthText}${includeYear ? ` del ${year}` : ""}`;
  }
  // Genera el encabezado del periodo seleccionado.
  function headerLabel() {
    if (!data.initialized) return todayLabel();
    if (data.mode === "single")
      return `${data.start === limaToday() ? "Hoy, " : ""}${formatDateLong(data.start)}`;
    const [startYear] = data.start.split("-");
    const [endYear] = data.end.split("-");
    if (startYear === endYear)
      return `Segmento: Desde el ${periodDate(data.start)} hasta el ${periodDate(data.end)} de ${endYear}`;
    return `Segmento: Desde el ${periodDate(data.start, true)} hasta el ${periodDate(data.end, true)}`;
  }
  // Calcula los limites temporales de las consultas.
  function rangeBounds(start = data.start, end = data.end) {
    return {
      from: dateAt(start).toISOString(),
      until: dateAt(addDays(end, 1)).toISOString(),
    };
  }
  // Obtiene todos los registros por paginas.
  async function fetchAll(queryFactory) {
    const rows = [];
    let offset = 0;
    while (true) {
      const { data: page, error } = await queryFactory().range(
        offset,
        offset + 999,
      );
      if (error) throw error;
      rows.push(...(page || []));
      if (!page || page.length < 1000) return rows;
      offset += 1000;
    }
  }
  // Ejecuta consultas por grupos de identificadores.
  async function fetchInChunks(ids, fetchChunk, size = 100) {
    const out = [];
    for (let index = 0; index < ids.length; index += size)
      out.push(...(await fetchChunk(ids.slice(index, index + size))));
    return out;
  }
  // Detecta grupos de categorias relacionados.
  function detectGroups() {
    const memberships = data.categories.map((category) => ({
      id: category.id,
      products: new Set(
        data.productCategories
          .filter((row) => row.category_id === category.id)
          .map((row) => row.product_id),
      ),
    }));
    const signature = memberships
      .map((row) => `${row.id}:${[...row.products].sort().join(",")}`)
      .sort()
      .join("|");
    let cacheKey = "";
    try {
      let hash = 2166136261;
      for (let i = 0; i < signature.length; i++)
        hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
      cacheKey = `kffeto.category-groups.v1.${(hash >>> 0).toString(36)}`;
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (Array.isArray(cached))
        return cached.filter((id) =>
          data.categories.some((category) => category.id === id),
        );
    } catch {
      /* Recompute when the browser cache is missing or malformed. */
    }
    const found = [];
    for (const candidate of memberships) {
      if (candidate.products.size < 2) continue;
      const others = memberships.filter(
        (row) => row.id !== candidate.id && row.products.size > 0,
      );
      let match = false;
      const visit = (index, union, selected) => {
        if (match || union.size > candidate.products.size) return;
        if (index === others.length) {
          if (
            selected >= 2 &&
            union.size === candidate.products.size &&
            [...union].every((id) => candidate.products.has(id))
          )
            match = true;
          return;
        }
        visit(index + 1, union, selected);
        const next = new Set(union);
        for (const id of others[index].products) next.add(id);
        visit(index + 1, next, selected + 1);
      };
      visit(0, new Set(), 0);
      if (match) found.push(candidate.id);
    }
    try {
      if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify(found));
    } catch {
      /* Group detection still works without browser storage. */
    }
    return found;
  }
  // Actualiza las fechas disponibles segun la sede.
  function updateAvailableDates() {
    const filtered = data.selectedLocation
      ? data.allOrders.filter((o) => o.location_id === data.selectedLocation)
      : data.allOrders;
    data.availableDates = [
      ...new Set(filtered.map((o) => limaDate(o.paid_at))),
    ].sort();
  }
  // Carga categorias, etiquetas y relaciones desde Supabase.
  async function loadTaxonomy() {
    if (state.role !== "Administrador") return;
    try {
      const [categories, tags, productCategories, productTags] =
        await Promise.all([
          fetchAll(() =>
            supabase.from("categories").select("id,name").order("name"),
          ),
          fetchAll(() => supabase.from("tags").select("id,name").order("name")),
          fetchAll(() =>
            supabase
              .from("product_categories")
              .select("product_id,category_id")
              .order("category_id"),
          ),
          fetchAll(() =>
            supabase
              .from("product_tags")
              .select("product_id,tag_id")
              .order("tag_id"),
          ),
        ]);
      data.categories = categories;
      data.tags = tags;
      data.productCategories = productCategories;
      data.productTags = productTags;
      data.categoryGroups = detectGroups();
      data.taxonomyError = "";
    } catch (error) {
      data.taxonomyError =
        error.message ||
        "No se pudieron cargar las categorías y etiquetas para los rankings.";
    }
  }
  // Convierte una fecha instantanea a la fecha de Lima.
  function limaDate(instant) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(instant));
    const get = (type) => parts.find((p) => p.type === type)?.value || "00";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  // Inicializa o actualiza las estadisticas.
  async function enter() {
    if (!supabase || !state.user || data.loading) return;
    if (data.initialized) {
      data.loading = true;
      data.error = "";
      refreshApp();
      try {
        let query = supabase
          .from("orders")
          .select("location_id,paid_at")
          .order("paid_at", { ascending: false });
        if (state.role === "Empleado") {
          const bounds = rangeBounds(limaToday(), limaToday());
          query = query
            .eq("location_id", state.locationId)
            .gte("paid_at", bounds.from)
            .lt("paid_at", bounds.until);
        }
        data.allOrders = await fetchAll(() => query);
        updateAvailableDates();
        if (state.role === "Administrador" && data.taxonomyError)
          await loadTaxonomy();
        await loadRange();
      } catch (error) {
        data.loading = false;
        data.error =
          error.message || "No se pudieron actualizar las fechas disponibles.";
        refreshApp();
      }
      return;
    }
    data.loading = true;
    data.error = "";
    refreshApp();
    try {
      const [locations, orders] = await Promise.all([
        supabase
          .from("locations")
          .select("id,name")
          .order("name")
          .then(({ data: rows, error }) => {
            if (error) throw error;
            return rows || [];
          }),
        fetchAll(() => {
          let query = supabase
            .from("orders")
            .select("location_id,paid_at")
            .order("paid_at", { ascending: false });
          if (state.role === "Empleado")
            query = query
              .eq("location_id", state.locationId)
              .gte("paid_at", rangeBounds(limaToday(), limaToday()).from)
              .lt("paid_at", rangeBounds(limaToday(), limaToday()).until);
          return query;
        }),
      ]);
      data.locations = locations;
      data.allOrders = orders;
      // Dates and paid orders must remain available even if optional catalog ranking data fails to load.
      updateAvailableDates();
      data.initialized = true;
      data.loading = false;
      await loadTaxonomy();
      if (state.role === "Administrador") {
        const today = limaToday();
        data.start = data.end = data.availableDates.includes(today)
          ? today
          : [...data.availableDates].reverse().find((d) => d <= today) || today;
      } else data.start = data.end = limaToday();
      data.mode = "single";
      await loadRange();
    } catch (error) {
      data.loading = false;
      data.error = error.message || "No se pudieron cargar las estadísticas.";
      refreshApp();
    }
  }
  // Carga los pedidos del periodo seleccionado.
  async function loadRange() {
    if (!supabase || !data.initialized) return;
    data.loading = true;
    data.error = "";
    refreshApp();
    const { from, until } = rangeBounds();
    try {
      let query = supabase
        .from("orders")
        .select(
          "id,location_id,status,amount_yape,amount_cash,total,paid_at,operator_name_snapshot,note,locations(name)",
        )
        .gte("paid_at", from)
        .lt("paid_at", until)
        .order("paid_at", { ascending: false });
      if (state.role === "Empleado")
        query = query.eq("location_id", state.locationId);
      else if (data.selectedLocation)
        query = query.eq("location_id", data.selectedLocation);
      data.orders = await fetchAll(() => query);
      const orderIds = data.orders.map((o) => o.id);
      data.items = await fetchInChunks(orderIds, (ids) =>
        fetchAll(() =>
          supabase
            .from("order_items")
            .select(
              "id,order_id,product_id,product_name_snapshot,variant_name_snapshot,line_kind,quantity,unit_price,line_total,amount_yape,amount_cash,concept",
            )
            .in("order_id", ids)
            .order("id"),
        ),
      );
      const itemIds = data.items.map((row) => row.id);
      [data.addons, data.corrections] = await Promise.all([
        fetchInChunks(itemIds, (ids) =>
          fetchAll(() =>
            supabase
              .from("order_item_addons")
              .select(
                "id,order_item_id,addon_name_snapshot,quantity,unit_price,line_total",
              )
              .in("order_item_id", ids)
              .order("id"),
          ),
        ),
        fetchInChunks(orderIds, (ids) =>
          fetchAll(() =>
            supabase
              .from("order_correction_events")
              .select("order_id,operator_name_snapshot,reason,corrected_at")
              .in("order_id", ids),
          ),
        ),
      ]);
      data.loading = false;
      refreshApp();
    } catch (error) {
      data.loading = false;
      data.error =
        error.message ||
        "No se pudieron cargar los movimientos de este periodo.";
      data.orders = [];
      data.items = [];
      data.addons = [];
      refreshApp();
    }
  }
  // Obtiene las lineas asociadas a un pedido.
  function orderItems(orderId) {
    return data.items.filter((item) => item.order_id === orderId);
  }
  // Obtiene los agregados de una linea de pedido.
  function addonRows(itemId) {
    return data.addons.filter((addon) => addon.order_item_id === itemId);
  }
  // Devuelve los pedidos correctos.
  function validOrders() {
    return data.orders.filter((order) => order.status === "correct");
  }
  // Devuelve las lineas de producto de pedidos correctos.
  function itemRows() {
    const valid = new Set(validOrders().map((order) => order.id));
    return data.items.filter(
      (item) => valid.has(item.order_id) && item.line_kind === "product",
    );
  }
  // Calcula los rankings de ventas.
  function rankings() {
    const rows = itemRows(),
      productCounts = new Map(),
      variantCounts = new Map(),
      addonCounts = new Map(),
      categoryCounts = new Map(),
      tagCounts = new Map();
    const productTotals = new Map();
    for (const item of rows) {
      const quantity = Number(item.quantity || 0),
        productName = item.product_name_snapshot || "Producto";
      productCounts.set(
        productName,
        (productCounts.get(productName) || 0) + quantity,
      );
      const variantName = item.variant_name_snapshot || "Variante";
      const variantKey = `${productName}|||${variantName}`;
      variantCounts.set(
        variantKey,
        (variantCounts.get(variantKey) || 0) + quantity,
      );
      if (item.product_id)
        productTotals.set(
          item.product_id,
          (productTotals.get(item.product_id) || 0) + quantity,
        );
    }
    const valid = new Set(validOrders().map((order) => order.id));
    for (const addon of data.addons) {
      const item = data.items.find((row) => row.id === addon.order_item_id);
      if (item && valid.has(item.order_id))
        addonCounts.set(
          addon.addon_name_snapshot,
          (addonCounts.get(addon.addon_name_snapshot) || 0) +
            Number(addon.quantity || 0),
        );
    }
    for (const [productId, quantity] of productTotals) {
      for (const row of data.productCategories.filter(
        (x) => x.product_id === productId,
      ))
        categoryCounts.set(
          row.category_id,
          (categoryCounts.get(row.category_id) || 0) + quantity,
        );
      for (const row of data.productTags.filter(
        (x) => x.product_id === productId,
      ))
        tagCounts.set(row.tag_id, (tagCounts.get(row.tag_id) || 0) + quantity);
    }
    const sortMap = (map, labelFor) =>
      [...map]
        .map(([key, count]) => ({ key, count, label: labelFor(key) }))
        .filter((x) => x.count > 0)
        .sort(
          (a, b) =>
            b.count - a.count ||
            a.label.localeCompare(b.label, "es", { sensitivity: "base" }),
        )
        .slice(0, 10);
    const categoryGroupIds = new Set(data.categoryGroups);
    let taxonomy = [];
    if (data.settings.taxonomyType === "tag")
      taxonomy = sortMap(
        tagCounts,
        (id) =>
          data.tags.find((x) => x.id === id)?.name || "Etiqueta eliminada",
      );
    else if (data.settings.taxonomyType === "group")
      taxonomy = sortMap(
        categoryCounts,
        (id) =>
          data.categories.find((x) => x.id === id)?.name ||
          "Categoría eliminada",
      ).filter((x) => categoryGroupIds.has(x.key));
    else
      taxonomy = sortMap(
        categoryCounts,
        (id) =>
          data.categories.find((x) => x.id === id)?.name ||
          "Categoría eliminada",
      ).filter((x) => !categoryGroupIds.has(x.key));
    return {
      products: sortMap(productCounts, (name) => name),
      variants: sortMap(variantCounts, (key) => {
        const [product, variant] = key.split("|||");
        return `${product} · ${variant}`;
      }),
      addons: sortMap(addonCounts, (name) => name),
      taxonomy,
      taxonomyLabel:
        data.settings.taxonomyType === "tag"
          ? "Etiquetas más vendidas"
          : data.settings.taxonomyType === "group"
            ? "Grupos de categorías más vendidos"
            : "Categorías más vendidas",
    };
  }
  // Calcula los totales y el promedio de pedidos.
  function totals() {
    const valid = validOrders();
    const yape = valid.reduce(
      (sum, order) => sum + Number(order.amount_yape || 0),
      0,
    );
    const cash = valid.reduce(
      (sum, order) => sum + Number(order.amount_cash || 0),
      0,
    );
    const total = yape + cash;
    return {
      valid,
      yape,
      cash,
      total,
      average: valid.length ? total / valid.length : 0,
    };
  }
  // Prepara los datos del grafico.
  function chartData() {
    const counts = new Map();
    for (const order of validOrders()) {
      const key =
        data.mode === "single"
          ? new Intl.DateTimeFormat("en-US", {
              timeZone: "America/Lima",
              hour: "2-digit",
              hourCycle: "h23",
            }).format(new Date(order.paid_at))
          : limaDate(order.paid_at);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const points = [];
    if (data.mode === "single")
      for (let hour = 0; hour < 24; hour++)
        points.push({
          label: String(hour).padStart(2, "0"),
          value: counts.get(String(hour).padStart(2, "0")) || 0,
        });
    else
      for (let date = data.start; date <= data.end; date = addDays(date, 1))
        points.push({
          label: formatDateShort(date).slice(0, 5),
          value: counts.get(date) || 0,
        });
    return points;
  }
  // Genera el HTML del grafico.
  function chartHtml() {
    const points = chartData(),
      peak = Math.max(0, ...points.map((point) => point.value));
    let step = 1;
    while (peak > step * 4) step *= 5;
    let axisMax = peak ? Math.ceil(peak / step) * step : step;
    // At the start of each scale band, leave one full interval above the first threshold.
    if (peak > 4 && peak === step) axisMax = step * 2;
    const ticks = [];
    for (let value = axisMax; value >= 0; value -= step) ticks.push(value);
    const columns = points
      .map(
        (point) =>
          `<div class="stats-column" title="${point.value} pedidos"><span class="stats-column-value">${point.value || ""}</span><div class="stats-bar ${point.value === peak && peak ? "active" : ""}" style="height:${(point.value / axisMax) * 100}%"></div></div>`,
      )
      .join("");
    const labels = points
      .map(
        (point) =>
          `<span class="stats-column-label">${esc(point.label)}</span>`,
      )
      .join("");
    const lines = ticks
      .map(
        (value) =>
          `<span class="stats-gridline" style="bottom:${(value / axisMax) * 100}%"></span>`,
      )
      .join("");
    const axis = ticks.map((value) => `<span>${value}</span>`).join("");
    const pointWidth = data.mode === "single" ? 31 : 44;
    return `<div class="stats-chart-shell"><div class="stats-axis">${axis}</div><div class="stats-chart-scroll" tabindex="0" role="region" aria-label="${data.mode === "single" ? "Pedidos por hora" : "Pedidos por día"}"><div class="stats-plot" style="min-width:${Math.max(0, points.length * pointWidth)}px"><div class="stats-data-area">${lines}<div class="stats-columns">${columns}</div></div><div class="stats-xlabels">${labels}</div></div></div></div>`;
  }
  // Genera las filas HTML de un ranking.
  function rankingRows(entries) {
    return (
      entries
        .map(
          (entry, index) =>
            `<div class="rankrow"><div class="rankname"><span class="ranknum">${String(index + 1).padStart(2, "0")}</span><span class="rank-label">${esc(entry.label)}</span></div><strong>${entry.count}</strong></div>`,
        )
        .join("") ||
      '<div class="empty">No hay ventas de este tipo en el periodo.</div>'
    );
  }
  // Genera una descripcion de los articulos de un pedido.
  function itemDescription(order) {
    return (
      orderItems(order.id)
        .map(
          (item) =>
            `${Number(item.quantity) > 1 ? `${item.quantity} × ` : ""}${item.product_name_snapshot}${item.variant_name_snapshot ? ` · ${item.variant_name_snapshot}` : ""}`,
        )
        .join(", ") || "Sin detalle"
    );
  }
  // Genera la vista completa de estadisticas.
  function render() {
    const isEmployee = state.role === "Empleado",
      summary = totals(),
      rank = rankings(),
      points = chartData();
    const dateText =
      data.mode === "single"
        ? `${data.start === limaToday() ? "Hoy, " : ""}${formatDateLong(data.start)}`
        : headerLabel();
    const siteFilter = isEmployee
      ? `<span class="stats-site-label">${esc(state.site)}</span>`
      : `<select class="select" id="stats-site-filter"><option value="">Todas las sedes</option>${data.locations.map((loc) => `<option value="${esc(loc.id)}" ${data.selectedLocation === loc.id ? "selected" : ""}>${esc(loc.name)}</option>`).join("")}</select>`;
    const cards = `<div class="metrics"><article class="metric"><div class="metric-label">Saldo neto</div><div class="metric-value">${money(summary.total)}</div><div class="metric-foot">Solo pedidos correctos</div></article><article class="metric"><div class="metric-label">Pedidos pagados</div><div class="metric-value">${summary.valid.length}</div><div class="metric-foot neutral">${esc(dateText)}</div></article><article class="metric"><div class="metric-label">Promedio por pedido</div><div class="metric-value">${money(summary.average)}</div><div class="metric-foot neutral">Saldo neto / pedidos correctos</div></article><article class="metric"><div class="metric-label">Desglose</div><div class="stats-payments"><span>Yape <strong>${money(summary.yape)}</strong></span><span>Efectivo <strong>${money(summary.cash)}</strong></span></div></article></div>`;
    const sections = [];
    if (isEmployee || data.settings.products)
      sections.push(
        `<section class="panel"><div class="panel-head"><div class="panel-title">Productos más vendidos</div></div>${rankingRows(rank.products)}</section>`,
      );
    if (!isEmployee && data.settings.variants)
      sections.push(
        `<section class="panel"><div class="panel-head"><div class="panel-title">Variantes más vendidas</div></div>${rankingRows(rank.variants)}</section>`,
      );
    if (!isEmployee && data.settings.addons)
      sections.push(
        `<section class="panel"><div class="panel-head"><div class="panel-title">Agregados más vendidos</div></div>${rankingRows(rank.addons)}</section>`,
      );
    if (!isEmployee && data.settings.taxonomy)
      sections.push(
        `<section class="panel"><div class="panel-head"><div class="panel-title">${esc(rank.taxonomyLabel)}</div></div>${rankingRows(rank.taxonomy)}</section>`,
      );
    const movementRows = data.orders
      .map(
        (order) =>
          `<article class="stats-movement ${order.status === "erroneous" ? "is-erroneous" : ""}"><div class="stats-movement-info"><div class="stats-movement-title"><strong>${esc(order.operator_name_snapshot || "Pedido")}</strong>${order.status === "erroneous" ? '<span class="badge erroneous-badge">Erróneo</span>' : ""}</div><div class="stats-movement-meta">${esc(order.locations?.name || data.locations.find((x) => x.id === order.location_id)?.name || "Sede")} · ${new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(order.paid_at))}</div><div class="stats-movement-items">${esc(itemDescription(order))}</div></div><div class="stats-movement-total"><strong>${money(order.total)}</strong><button type="button" class="btn secondary stats-view-button" data-view-movement="${esc(order.id)}">Ver</button></div></article>`,
      )
      .join("");
    return `<section class="page-head stats-page-head"><div><div class="eyebrow">${isEmployee ? "Resumen diario" : "Visión general"}</div><h1>${isEmployee ? `Hoy en ${esc(state.site)}` : "Estadísticas"}</h1><p class="desc">${isEmployee ? "Resumen y movimientos de hoy en tu sede." : "Consulta pagos e indicadores del periodo seleccionado."}</p></div><div class="stats-toolbar">${isEmployee ? `<span class="stats-period-label">${esc(dateText)}</span>` : `<button type="button" class="icon stats-calendar-trigger" id="stats-open-date" aria-label="Elegir fechas" title="Elegir fechas"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17M7.5 13h2m3 0h2m-7 4h2"/></svg></button>${siteFilter}<button type="button" class="btn secondary" id="stats-edit-sections">Editar</button>`}</div></section>${data.error ? `<div class="inline-error" role="alert">${esc(data.error)}</div>` : ""}${data.taxonomyError ? `<div class="inline-error" role="status">No se pudieron cargar los datos de categorías/etiquetas; los pagos e historial siguen disponibles. ${esc(data.taxonomyError)}</div>` : ""}${data.loading ? '<div class="stats-loading-bar">Actualizando estadísticas…</div>' : ""}${cards}<section class="panel stats-chart-panel"><div class="panel-head"><div class="panel-title">${data.mode === "single" ? "Pedidos por hora" : "Pedidos por día"}</div><span class="meta">${data.mode === "single" ? "Hora de Lima" : esc(dateText)}</span></div>${chartHtml()}</section><div class="stats-rankings">${sections.join("")}</div><section class="panel stats-history-panel"><div class="panel-head"><div><div class="panel-title">${isEmployee ? "Movimientos de hoy" : "Movimientos del periodo"}</div><div class="meta">${data.orders.length} registros · los erróneos se conservan y no suman al saldo</div></div><span class="stats-scroll-hint">Desplázate para ver todos</span></div><div class="stats-history-list" role="region" aria-label="Movimientos del periodo" tabindex="0">${movementRows || '<div class="empty">No hay movimientos en este periodo.</div>'}</div></section>`;
  }
  // Genera el calendario para seleccionar un periodo.
  function datePickerHtml(month, selectedStart, selectedEnd, mode) {
    const [year, monthNumber] = month.split("-").map(Number),
      first = new Date(Date.UTC(year, monthNumber - 1, 1)),
      daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7,
      headers = ["L", "M", "X", "J", "V", "S", "D"]
        .map((x) => `<span class="calendar-weekday">${x}</span>`)
        .join("");
    const available = new Set(data.availableDates),
      cells = Array.from(
        { length: offset },
        () => '<span class="calendar-blank"></span>',
      );
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        enabled = available.has(date),
        inRange =
          selectedStart &&
          selectedEnd &&
          date >= selectedStart &&
          date <= selectedEnd;
      const selected = date === selectedStart || date === selectedEnd;
      cells.push(
        `<button type="button" class="calendar-day ${enabled ? "is-available" : "is-unavailable"} ${selected ? "selected" : ""} ${inRange ? "in-range" : ""}" data-calendar-date="${date}" ${enabled ? "" : "disabled"} aria-pressed="${selected}" aria-label="${day}${enabled ? ", con datos" : ", sin datos"}">${day}</button>`,
      );
    }
    return `${headers}${cells.join("")}`;
  }
  // Abre el dialogo de seleccion de fechas.
  function openDateDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "password-dialog stats-dialog stats-date-dialog";
    let mode = data.mode === "single" ? "single" : "range",
      start = data.start,
      end = data.end,
      month = `${start.slice(0, 7)}`;
    const draw = () => {
      const quick = ["today", "yesterday", "7", "30"]
        .map(
          (key) =>
            `<button type="button" class="stats-quick-option ${draftPreset === key ? "active" : ""}" data-quick-period="${key}">${{ today: "Hoy", yesterday: "Ayer", 7: "Últimos 7 días", 30: "Último mes" }[key]}</button>`,
        )
        .join("");
      const monthDate = new Date(`${month}-01T00:00:00Z`),
        monthLabel = new Intl.DateTimeFormat("es-PE", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(monthDate);
      dialog.innerHTML = `<div class="stats-dialog-head"><div><div class="panel-title">Periodo de estadísticas</div><div class="meta">${mode === "range" ? "Elige dos fechas con movimientos" : "Selecciona una fecha con datos"}</div></div><button type="button" class="dialog-close" data-close-date aria-label="Cerrar">×</button></div><div class="stats-date-layout"><div class="stats-quick-list">${quick}<button type="button" class="stats-quick-option ${mode === "range" && !draftPreset ? "active" : ""}" data-start-range>Seleccionar periodo</button></div><div class="stats-calendar"><div class="calendar-top"><button type="button" class="icon" data-month-shift="-1" aria-label="Mes anterior">‹</button><strong>${esc(monthLabel)}</strong><button type="button" class="icon" data-month-shift="1" aria-label="Mes siguiente">›</button></div><div class="calendar-grid">${datePickerHtml(month, start, end, mode)}</div><div class="calendar-selection">${start ? formatDateShort(start) : "Desde"}${mode === "range" ? ` — ${end ? formatDateShort(end) : "Hasta"}` : ""}</div><div class="calendar-legend"><span><i class="unavailable"></i>Sin datos</span><span><i class="available"></i>Con datos</span><span><i class="chosen"></i>Seleccionada</span></div><div class="dialog-actions"><button type="button" class="btn secondary" data-close-date>Cerrar</button><button type="button" class="btn primary" data-save-date ${!start || (mode === "range" && !end) ? "disabled" : ""}>Guardar cambios</button></div></div></div>`;
      dialog
        .querySelectorAll("[data-close-date]")
        .forEach((button) => (button.onclick = () => dialog.close()));
      dialog.querySelectorAll("[data-month-shift]").forEach(
        (button) =>
          (button.onclick = () => {
            const next = new Date(`${month}-01T00:00:00Z`);
            next.setUTCMonth(
              next.getUTCMonth() + Number(button.dataset.monthShift),
            );
            month = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
            draw();
          }),
      );
      dialog.querySelector("[data-start-range]").onclick = () => {
        mode = "range";
        draftPreset = "";
        start = "";
        end = "";
        draw();
      };
      dialog.querySelectorAll("[data-calendar-date]").forEach(
        (button) =>
          (button.onclick = () => {
            const date = button.dataset.calendarDate;
            draftPreset = "";
            if (mode === "single") {
              start = end = date;
              draw();
              return;
            }
            if (!start || end) {
              start = date;
              end = "";
            } else if (date < start) {
              end = start;
              start = date;
            } else end = date;
            draw();
          }),
      );
      dialog
        .querySelector("[data-save-date]")
        ?.addEventListener("click", () => {
          if (!start || (mode === "range" && !end)) return;
          data.start = start;
          data.end = end || start;
          data.mode = mode === "single" ? "single" : "period";
          dialog.close();
          loadRange();
        });
      dialog.querySelectorAll("[data-quick-period]").forEach(
        (button) =>
          (button.onclick = () => {
            applyPreset(button.dataset.quickPeriod);
            draw();
          }),
      );
    };
    let draftPreset = "";
    // Aplica un periodo rapido de fechas.
    function applyPreset(key) {
      const today = limaToday(),
        yesterday = addDays(today, -1);
      draftPreset = key;
      if (key === "today" || key === "yesterday") {
        mode = "single";
        start = end = key === "today" ? today : yesterday;
        month = start.slice(0, 7);
        return;
      }
      mode = "range";
      const endCandidate =
        [...data.availableDates].reverse().find((d) => d <= today) || yesterday;
      const days = Number(key),
        earliest = data.availableDates[0] || endCandidate;
      const targetStart = addDays(endCandidate, -(days - 1));
      start = targetStart < earliest ? earliest : targetStart;
      end = endCandidate;
      month = start.slice(0, 7);
    }
    data.dateDialog = dialog;
    draw();
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener("close", () => {
      dialog.remove();
      data.dateDialog = null;
    });
  }
  // Abre el dialogo de configuracion.
  function openSettingsDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "password-dialog stats-dialog stats-settings-dialog";
    const draft = { ...data.settings };
    let categoryChoice = null;
    const draw = () => {
      dialog.innerHTML = `<div class="stats-dialog-head"><div><div class="panel-title">Personalizar estadísticas</div><div class="meta">Elige las secciones de rankings que quieres consultar.</div></div><button type="button" class="dialog-close" data-close-settings aria-label="Cerrar">×</button></div><div class="stats-settings-list"><label class="stats-check-row"><input type="checkbox" data-setting="products" ${draft.products ? "checked" : ""}><span><strong>Productos más vendidos</strong><small>Unidades vendidas por producto.</small></span></label><label class="stats-check-row"><input type="checkbox" data-setting="variants" ${draft.variants ? "checked" : ""}><span><strong>Variantes más vendidas</strong><small>Unidades por variante y producto.</small></span></label><label class="stats-check-row"><input type="checkbox" data-setting="addons" ${draft.addons ? "checked" : ""}><span><strong>Agregados más vendidos</strong><small>Cantidades de agregados seleccionados.</small></span></label><div class="stats-check-row"><input id="stats-taxonomy-setting" type="checkbox" data-setting="taxonomy" ${draft.taxonomy ? "checked" : ""}><div class="stats-check-content"><label for="stats-taxonomy-setting"><strong>${esc(taxonomyName(draft.taxonomyType))} más vendidas</strong><small>Elige categorías, grupos o etiquetas.</small></label><button type="button" class="rowaction" data-edit-taxonomy>Elegir tipo</button></div></div></div><p class="password-error" data-settings-error role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-close-settings>Cancelar</button><button type="button" class="btn primary" data-save-settings ${[draft.products, draft.variants, draft.addons, draft.taxonomy].some(Boolean) ? "" : "disabled"}>Guardar cambios</button></div>`;
      dialog
        .querySelectorAll("[data-close-settings]")
        .forEach((button) => (button.onclick = () => dialog.close()));
      dialog.querySelectorAll("[data-setting]").forEach(
        (input) =>
          (input.onchange = () => {
            const key = input.dataset.setting;
            if (key === "taxonomy" && input.checked) {
              input.checked = false;
              openTaxonomyPicker((type) => {
                draft.taxonomyType = type;
                draft.taxonomy = true;
                draw();
              });
              return;
            }
            draft[key] = input.checked;
            draw();
          }),
      );
      dialog.querySelector("[data-edit-taxonomy]").onclick = () =>
        openTaxonomyPicker((type) => {
          draft.taxonomyType = type;
          draft.taxonomy = true;
          draw();
        });
      dialog.querySelector("[data-save-settings]").onclick = () => {
        if (
          ![draft.products, draft.variants, draft.addons, draft.taxonomy].some(
            Boolean,
          )
        ) {
          dialog.querySelector("[data-settings-error]").textContent =
            "Selecciona al menos una sección.";
          return;
        }
        const saved = {
          ...defaults,
          products: Boolean(
            dialog.querySelector('[data-setting="products"]').checked,
          ),
          variants: Boolean(
            dialog.querySelector('[data-setting="variants"]').checked,
          ),
          addons: Boolean(
            dialog.querySelector('[data-setting="addons"]').checked,
          ),
          taxonomy: Boolean(
            dialog.querySelector('[data-setting="taxonomy"]').checked,
          ),
          taxonomyType: draft.taxonomyType,
        };
        if (
          ![saved.products, saved.variants, saved.addons, saved.taxonomy].some(
            Boolean,
          )
        ) {
          dialog.querySelector("[data-settings-error]").textContent =
            "Selecciona al menos una sección.";
          return;
        }
        saveSettings(saved);
        dialog.close();
        refreshApp();
      };
    };
    // Devuelve el nombre visible de la taxonomia.
    function taxonomyName(type) {
      return type === "tag"
        ? "Etiquetas"
        : type === "group"
          ? "Grupos de categorías"
          : "Categorías";
    }
    // Abre el selector de taxonomia.
    function openTaxonomyPicker(onSave) {
      const child = document.createElement("dialog");
      child.className = "password-dialog stats-dialog stats-taxonomy-dialog";
      let selected = draft.taxonomyType || "category";
      child.innerHTML = `<div class="stats-dialog-head"><div><div class="panel-title">Tipo de clasificación</div><div class="meta">¿Qué quieres comparar?</div></div><button type="button" class="dialog-close" data-close-taxonomy aria-label="Cerrar">×</button></div><div class="taxonomy-choice-list">${[
        ["category", "Categorías"],
        ["group", "Grupos de categorías"],
        ["tag", "Etiquetas"],
      ]
        .map(
          ([value, label]) =>
            `<label class="stats-check-row"><input type="radio" name="taxonomy-type" value="${value}" ${selected === value ? "checked" : ""}><span><strong>${label}</strong></span></label>`,
        )
        .join(
          "",
        )}</div><div class="dialog-actions"><button type="button" class="btn secondary" data-close-taxonomy>Cancelar</button><button type="button" class="btn primary" data-save-taxonomy>Guardar</button></div>`;
      child
        .querySelectorAll("[data-close-taxonomy]")
        .forEach((button) => (button.onclick = () => child.close()));
      child.querySelectorAll("[name=taxonomy-type]").forEach(
        (radio) =>
          (radio.onchange = () => {
            selected = radio.value;
          }),
      );
      child.querySelector("[data-save-taxonomy]").onclick = () => {
        onSave(selected);
        child.close();
      };
      document.body.appendChild(child);
      child.showModal();
      child.addEventListener("close", () => child.remove());
    }
    data.settingsDialog = dialog;
    draw();
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener("close", () => {
      dialog.remove();
      data.settingsDialog = null;
    });
  }
  // Abre el detalle de un pedido.
  function openMovement(orderId) {
    const order = data.orders.find((row) => row.id === orderId);
    if (!order) return;
    const dialog = document.createElement("dialog");
    dialog.className = "password-dialog stats-dialog stats-detail-dialog";
    const rows = orderItems(order.id)
      .map((item) => {
        const addOns = addonRows(item.id)
          .map(
            (addon) =>
              `<div class="stats-detail-addon"><span>+ ${esc(addon.addon_name_snapshot)}${addon.quantity > 1 ? ` × ${addon.quantity}` : ""}</span><span>${money(addon.line_total)}</span></div>`,
          )
          .join("");
        return `<article class="stats-detail-line"><div class="stats-detail-line-head"><div><strong>${esc(item.product_name_snapshot)}</strong><div class="meta">${esc(item.variant_name_snapshot || "Movimiento")}${item.quantity > 1 ? ` · ${item.quantity} unidades` : ""}${item.concept ? ` · ${esc(item.concept)}` : ""}</div></div><strong>${money(item.line_total)}</strong></div>${addOns}<div class="stats-detail-split"><span>Yape ${money(item.amount_yape)}</span><span>Efectivo ${money(item.amount_cash)}</span></div></article>`;
      })
      .join("");
    const location =
      order.locations?.name ||
      data.locations.find((x) => x.id === order.location_id)?.name ||
      "Sede";
    const correction = data.corrections.find(
      (row) => row.order_id === order.id,
    );
    dialog.innerHTML = `<div class="stats-dialog-head"><div><div class="panel-title">Detalle del movimiento</div><div class="meta">${esc(location)} · ${new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "full", timeStyle: "short" }).format(new Date(order.paid_at))}</div></div><button type="button" class="dialog-close" data-close-detail aria-label="Cerrar">×</button></div><div class="stats-detail-summary"><div><span>Registró</span><strong>${esc(order.operator_name_snapshot || "Equipo")}</strong></div><div><span>Estado</span><strong class="${order.status === "erroneous" ? "status-error" : "status-ok"}">${order.status === "erroneous" ? "Erróneo" : "Correcto"}</strong></div></div>${correction ? `<section class="stats-detail-note correction-note"><span>Corrección</span><p>${esc(correction.reason || "Pedido marcado como erróneo")}</p><small>Confirmó ${esc(correction.operator_name_snapshot || "Equipo")} · ${new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "medium", timeStyle: "short" }).format(new Date(correction.corrected_at))}</small></section>` : ""}<section class="stats-detail-note"><span>Nota del pedido</span><p>${order.note ? esc(order.note) : "Este pedido no tiene nota."}</p></section><div class="stats-detail-lines">${rows || '<div class="empty">Este movimiento no tiene líneas de detalle.</div>'}</div><div class="stats-detail-totals"><div><span>Yape</span><strong>${money(order.amount_yape)}</strong></div><div><span>Efectivo</span><strong>${money(order.amount_cash)}</strong></div><div class="grand-total"><span>Total neto</span><strong>${money(order.total)}</strong></div></div><div class="stats-detail-footer"><button type="button" class="btn secondary" data-print-movement>Imprimir comprobante</button><button type="button" class="btn primary" data-close-detail>Cerrar</button></div>`;
    dialog
      .querySelectorAll("[data-close-detail]")
      .forEach((button) => (button.onclick = () => dialog.close()));
    dialog.querySelector("[data-print-movement]").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Procesando impresión…";
      await printTicket(order.id);
      if (dialog.open) {
        button.disabled = false;
        button.textContent = "Imprimir comprobante";
      }
    };
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.addEventListener("close", () => dialog.remove());
  }
  // Conecta los eventos de la vista de estadisticas.
  function bind() {
    if (data.mode === "single") {
      requestAnimationFrame(() => {
        const scroll = document.querySelector(".stats-chart-scroll");
        const eightAm = scroll?.querySelectorAll(".stats-column-label")[8];
        if (!scroll || !eightAm || scroll.scrollWidth <= scroll.clientWidth) return;
        const scrollRect = scroll.getBoundingClientRect();
        const labelRect = eightAm.getBoundingClientRect();
        scroll.scrollLeft += labelRect.left - scrollRect.left;
      });
    }
    document
      .getElementById("stats-open-date")
      ?.addEventListener("click", openDateDialog);
    document
      .getElementById("stats-edit-sections")
      ?.addEventListener("click", openSettingsDialog);
    document
      .getElementById("stats-site-filter")
      ?.addEventListener("change", async (event) => {
        data.selectedLocation = event.target.value;
        updateAvailableDates();
        await loadRange();
      });
    document
      .querySelectorAll("[data-view-movement]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          openMovement(button.dataset.viewMovement),
        ),
      );
  }
  return { render, bind, enter, headerLabel };
}
