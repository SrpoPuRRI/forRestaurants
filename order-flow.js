// Crea y devuelve la lógica del flujo de pedidos y del catálogo.
export default function createOrderFlow({
  supabase,
  state,
  render,
  toast,
  money,
  esc,
}) {
  const data = {
    loading: false,
    loaded: false,
    error: "",
    products: [],
    categories: [],
    tags: [],
    variants: [],
    addons: [],
    productCategories: [],
    productTags: [],
    productAddons: [],
    variantLocations: [],
    locations: [],
    orderLocationId: "",
    openFilterLocationId: "",
    openOrders: [],
    paidToday: 0,
    activeDraft: null,
    activeOpen: null,
    categoryId: "",
    groupId: "",
    categoryAfterGroupId: "",
    tagIds: [],
    query: "",
    groups: [],
    selectedMenuProduct: "",
    saveBusy: false,
    saveQueued: false,
    pollTimer: null,
    pollBusy: false,
    catalogTab: "products",
    productQuery: "",
    categoryQuery: "",
    tagQuery: "",
    addonQuery: "",
  };
  const tenthSolValidationMessage =
    "Las finanzas se manejan con saltos de almenos 10 céntimos, ingrese un monto válido.";
  const isTenthSol = (value) => {
    const text = String(value ?? "").trim().replace(",", ".");
    if (!/^\d+(?:\.\d*)?$/.test(text)) return false;
    const decimals = text.split(".")[1] || "";
    return decimals.length <= 1 || /^0+$/.test(decimals.slice(1));
  };

  // Indica si el usuario actual tiene permisos de administrador.
  const isAdmin = () => state.role === "Administrador";
  // Busca un elemento por su identificador.
  const byId = (list, id) => list.find((item) => item.id === id);
  // Obtiene las categorías asociadas a un producto.
  const productCats = (id) =>
    data.productCategories
      .filter((x) => x.product_id === id)
      .map((x) => x.category_id);
  // Obtiene las etiquetas asociadas a un producto.
  const productTags = (id) =>
    data.productTags.filter((x) => x.product_id === id).map((x) => x.tag_id);
  // Obtiene los identificadores de agregados de un producto.
  const productAddonIds = (id) =>
    data.productAddons
      .filter((x) => x.product_id === id)
      .map((x) => x.addon_id);
  // Obtiene las variantes activas disponibles para un producto.
  const activeVariants = (product) =>
    data.variants
      .filter((v) => v.product_id === product.id && v.is_active)
      .filter(
        (v) =>
          product.product_kind !== "standard" ||
          data.variantLocations.some(
            (x) =>
              x.variant_id === v.id &&
              x.location_id === currentLocationId() &&
              x.is_available,
          ),
      );
  // Obtiene todas las variantes de un producto para editarlo.
  const variantsForEditor = (productId) =>
    data.variants.filter((v) => v.product_id === productId);
  // Obtiene los agregados activos de un producto.
  const addonsFor = (productId) =>
    productAddonIds(productId)
      .map((id) => byId(data.addons, id))
      .filter((x) => x && x.is_active);
  // Obtiene la sede seleccionada para el pedido.
  const currentLocationId = () =>
    data.orderLocationId || state.locationId || data.locations[0]?.id || "";
  // Obtiene el nombre de la sede seleccionada.
  const currentLocationName = () =>
    byId(data.locations, currentLocationId())?.name || state.site || "Sede";
  // Devuelve el pedido abierto o borrador activo.
  const activeOrder = () => data.activeOpen || data.activeDraft;
  // Indica si hay un pedido abierto activo.
  const isOpenOrder = () => Boolean(data.activeOpen);

  // Normaliza un texto para facilitar las búsquedas y comparaciones.
  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  // Genera una clave corta a partir de un texto.
  function hash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++)
      h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  // Detecta grupos de categorías relacionados y reutiliza su caché.
  function detectCategoryGroups() {
    const memberships = data.categories.map((category) => ({
      id: category.id,
      products: new Set(
        data.productCategories
          .filter((x) => x.category_id === category.id)
          .map((x) => x.product_id),
      ),
    }));
    const signature = memberships
      .map((x) => `${x.id}:${[...x.products].sort().join(",")}`)
      .sort()
      .join("|");
    const cacheKey = `kffeto.category-groups.v1.${hash(signature)}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (Array.isArray(cached))
        return cached.filter((id) => data.categories.some((x) => x.id === id));
    } catch {
      /* Recompute if local storage is unavailable or malformed. */
    }
    const found = [];
    for (const candidate of memberships) {
      if (candidate.products.size < 2) continue;
      const others = memberships.filter(
        (x) => x.id !== candidate.id && x.products.size > 0,
      );
      let match = false;
      const visit = (index, union, selectedCount) => {
        if (match || union.size > candidate.products.size) return;
        if (index === others.length) {
          if (
            selectedCount >= 2 &&
            union.size === candidate.products.size &&
            [...union].every((id) => candidate.products.has(id))
          )
            match = true;
          return;
        }
        visit(index + 1, union, selectedCount);
        const next = new Set(union);
        for (const id of others[index].products) next.add(id);
        visit(index + 1, next, selectedCount + 1);
      };
      visit(0, new Set(), 0);
      if (match) found.push(candidate.id);
    }
    try {
      localStorage.setItem(cacheKey, JSON.stringify(found));
    } catch {
      /* The menu still works without a cache. */
    }
    return found;
  }

  // Calcula la prioridad de coincidencia entre una etiqueta y una búsqueda.
  function matchRank(label, query) {
    const text = normalizeText(label),
      needle = normalizeText(query);
    if (!needle) return 0;
    if (text.startsWith(needle)) return 1;
    if (text.includes(needle)) return 2;
    return 99;
  }

  // Filtra y ordena una lista según la coincidencia con una búsqueda.
  function ranked(list, query, label = (x) => x.name) {
    return list
      .map((item) => ({ item, rank: matchRank(label(item), query) }))
      .filter((x) => x.rank < 99)
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          label(a.item).localeCompare(label(b.item), "es", {
            sensitivity: "base",
          }),
      )
      .map((x) => x.item);
  }

  // Carga desde Supabase los datos necesarios para el catálogo.
  async function loadCatalog() {
    if (!supabase) return;
    data.loading = true;
    data.error = "";
    render();
    const results = await Promise.all([
      supabase.from("locations").select("id,name").order("name"),
      supabase
        .from("products")
        .select("id,name,description,category_id,product_kind,is_active")
        .order("name"),
      supabase.from("categories").select("id,name,sort_order").order("name"),
      supabase.from("tags").select("id,name").order("name"),
      supabase
        .from("variants")
        .select("id,product_id,name,price,is_active")
        .order("name"),
      supabase.from("addons").select("id,name,price,is_active").order("name"),
      supabase
        .from("product_categories")
        .select("product_id,category_id")
        .order("category_id"),
      supabase.from("product_tags").select("product_id,tag_id").order("tag_id"),
      supabase
        .from("product_addons")
        .select("product_id,addon_id")
        .order("addon_id"),
      supabase
        .from("variant_locations")
        .select("variant_id,location_id,is_available"),
    ]);
    const failed = results.find((x) => x.error);
    data.loading = false;
    if (failed) {
      data.error = failed.error?.message || "No se pudo cargar el catálogo.";
      data.loaded = false;
      render();
      return;
    }
    [
      data.locations,
      data.products,
      data.categories,
      data.tags,
      data.variants,
      data.addons,
      data.productCategories,
      data.productTags,
      data.productAddons,
      data.variantLocations,
    ] = results.map((x) => x.data || []);
    // Preserve compatibility with products created before the many-to-many category relation.
    for (const product of data.products)
      if (
        product.category_id &&
        !data.productCategories.some(
          (x) =>
            x.product_id === product.id &&
            x.category_id === product.category_id,
        )
      ) {
        data.productCategories.push({
          product_id: product.id,
          category_id: product.category_id,
        });
      }
    if (!data.orderLocationId)
      data.orderLocationId = isAdmin()
        ? data.locations.find((x) => x.name === state.site)?.id ||
          data.locations[0]?.id ||
          ""
        : state.locationId ||
          data.locations.find((x) => x.name === state.site)?.id ||
          "";
    data.groups = detectCategoryGroups();
    data.loaded = true;
    await refreshOpenOrders(false);
    render();
  }

  // Actualiza la lista de pedidos abiertos y el total pagado del día.
  async function refreshOpenOrders(shouldRender = true, preserveMenuSearchFocus = false) {
    if (!supabase || !data.loaded) return;
    const filterId = isAdmin()
      ? data.openFilterLocationId || null
      : state.locationId || null;
    try {
      const [ordersResult, countResult] = await Promise.all([
        supabase.rpc("list_open_orders", { p_location_id: filterId }),
        supabase.rpc("get_open_order_paid_today_count", {
          p_location_id: filterId,
        }),
      ]);
      if (ordersResult.error || countResult.error) {
        data.error =
          ordersResult.error?.message ||
          countResult.error?.message ||
          "No se pudieron cargar los pedidos abiertos.";
        if (shouldRender) renderWithMenuSearchFocus(preserveMenuSearchFocus);
        return;
      }
      data.error = "";
      data.openOrders = ordersResult.data || [];
      data.paidToday = Number(countResult.data || 0);
      if (data.activeOpen) await refreshActiveOpenOrder(false);
      if (shouldRender) renderWithMenuSearchFocus(preserveMenuSearchFocus);
    } catch (error) {
      data.error = error.message || "No hay conexión para actualizar los pedidos abiertos.";
      if (shouldRender) renderWithMenuSearchFocus(preserveMenuSearchFocus);
    }
  }

  // El sondeo reemplaza el DOM al renderizar; conserva el foco si se estaba escribiendo aquí.
  function renderWithMenuSearchFocus(preserveFocus) {
    const active = preserveFocus && document.activeElement?.id === "menu-search"
      ? document.activeElement
      : null;
    const selectionStart = active?.selectionStart;
    const selectionEnd = active?.selectionEnd;
    const selectionDirection = active?.selectionDirection;
    render();
    if (!active) return;
    const replacement = document.getElementById("menu-search");
    if (!replacement) return;
    replacement.focus({ preventScroll: true });
    if (selectionStart != null && selectionEnd != null) {
      replacement.setSelectionRange(selectionStart, selectionEnd, selectionDirection || "none");
    }
  }

  // Sincroniza el pedido abierto activo con la base de datos.
  async function refreshActiveOpenOrder(shouldRender = true) {
    if (!data.activeOpen || !supabase) return;
    const { data: latest, error } = await supabase
      .from("open_orders")
      .select(
        "id,location_id,note,items,status,revision,operator_name_snapshot",
      )
      .eq("id", data.activeOpen.id)
      .maybeSingle();
    if (error) {
      if (shouldRender) toast("No se pudo actualizar el pedido compartido.");
      return;
    }
    if (!latest || latest.status !== "open") {
      const wasPaid = latest?.status === "paid";
      data.activeOpen = null;
      await refreshOpenOrders(false);
      toast(
        wasPaid
          ? "Ya no puedes ver este pedido: alguien lo registró como pagado. Ve a Estadísticas para consultarlo."
          : "Ya no puedes ver este pedido: alguien lo canceló.",
      );
      if (shouldRender) render();
      return;
    }
    if (latest.revision !== data.activeOpen.revision && !data.saveBusy) {
      data.activeOpen.note = latest.note || "";
      data.activeOpen.items = latest.items || [];
      data.activeOpen.revision = latest.revision;
      if (shouldRender) {
        toast("El pedido se actualizó desde otro dispositivo.");
        render();
      }
    }
  }

  // Inicia la actualización periódica de los pedidos abiertos.
  function startPolling() {
    stopPolling();
    data.pollTimer = setInterval(() => {
      if (state.page !== "orders" || data.pollBusy) return;
      data.pollBusy = true;
      refreshOpenOrders(true, true).finally(() => { data.pollBusy = false; });
    }, 2000);
  }

  // Detiene la actualización periódica de los pedidos abiertos.
  function stopPolling() {
    if (data.pollTimer) clearInterval(data.pollTimer);
    data.pollTimer = null;
  }

  // Prepara el flujo de pedidos o catálogo al entrar en una página.
  function enter(page = state.page) {
    if (page === "orders" || page === "catalog") {
      if (!data.loaded) loadCatalog();
      else refreshOpenOrders(false);
      startPolling();
    } else stopPolling();
  }

  // Obtiene el nombre visible de una línea del pedido.
  function lineName(item) {
    const product = byId(data.products, item.product_id);
    if (item.line_kind === "income" || item.product_kind === "income")
      return item.concept || product?.name || "Ingreso";
    if (item.line_kind === "expense" || item.product_kind === "expense")
      return item.concept || product?.name || "Egreso";
    return item.product_name || product?.name || "Producto";
  }

  // Busca la variante asociada a una línea del pedido.
  function variantFor(item) {
    return byId(data.variants, item.variant_id);
  }
  // Obtiene los agregados seleccionados de una línea.
  function addonRows(item) {
    return (item.addons || []).map((entry) => {
      const addon = byId(data.addons, entry.addon_id);
      return {
        id: entry.addon_id,
        name: entry.name || addon?.name || "Agregado",
        quantity: Number(entry.quantity || 1),
        price: Number(entry.price ?? addon?.price ?? 0),
      };
    });
  }

  // Calcula el importe de una línea del pedido.
  function lineAmount(item) {
    if (item.manual_amount != null) return Number(item.manual_amount);
    const variant = variantFor(item);
    return (
      (Number(variant?.price || item.unit_price || 0) +
        addonRows(item).reduce((sum, a) => sum + a.price * a.quantity, 0)) *
      Number(item.quantity || 1)
    );
  }

  // Calcula la cantidad total de artículos.
  function itemCount(items) {
    return (items || []).reduce((sum, x) => sum + Number(x.quantity || 1), 0);
  }
  // Calcula el total de una lista de artículos.
  function orderTotal(items) {
    return (items || []).reduce(
      (sum, item) =>
        sum +
        (item.product_kind === "expense" || item.line_kind === "expense"
          ? -1
          : 1) *
          lineAmount(item),
      0,
    );
  }
  // Genera una descripción resumida de los artículos solicitados.
  function orderedLabel(items) {
    return (items || [])
      .map(
        (x) =>
          `${Number(x.quantity || 1) > 1 ? `${x.quantity} × ` : ""}${esc(lineName(x))}`,
      )
      .join(", ");
  }

  // Filtra y ordena los productos visibles en el menú.
  function menuProducts() {
    let list = data.products.filter(
      (product) => product.is_active && activeVariants(product).length,
    );
    const hasFilters = Boolean(
      data.categoryId ||
      data.groupId ||
      data.categoryAfterGroupId ||
      data.tagIds.length,
    );
    const hasQuery = Boolean(data.query.trim());
    const isSpecial = (product) =>
      product.product_kind === "income" || product.product_kind === "expense";
    if (hasFilters || hasQuery)
      list = list.filter((product) => !isSpecial(product));
    if (data.categoryId)
      list = list.filter((p) => productCats(p.id).includes(data.categoryId));
    if (data.groupId)
      list = list.filter((p) => productCats(p.id).includes(data.groupId));
    if (data.categoryAfterGroupId)
      list = list.filter((p) =>
        productCats(p.id).includes(data.categoryAfterGroupId),
      );
    if (data.tagIds.length)
      list = list.filter((p) => {
        const ids = productTags(p.id);
        return data.tagIds.some((tagId) => ids.includes(tagId));
      });
    if (!hasFilters && !hasQuery) {
      const specials = list
        .filter(isSpecial)
        .sort((a, b) =>
          a.product_kind === b.product_kind
            ? 0
            : a.product_kind === "income"
              ? -1
              : 1,
        );
      return [
        ...specials,
        ...ranked(
          list.filter((product) => !isSpecial(product)),
          data.query,
        ),
      ];
    }
    return ranked(list, data.query);
  }

  // Genera el marcado de los filtros activos del menú.
  function filtersHtml() {
    const selected = [];
    if (data.groupId)
      selected.push(
        `<button class="filter-chip selected" data-remove-group>${esc(byId(data.categories, data.groupId)?.name || "Grupo")}</button>`,
      );
    if (data.categoryId)
      selected.push(
        `<button class="filter-chip selected" data-remove-category>${esc(byId(data.categories, data.categoryId)?.name || "Categoría")}</button>`,
      );
    if (data.categoryAfterGroupId)
      selected.push(
        `<button class="filter-chip selected" data-remove-after-category>${esc(byId(data.categories, data.categoryAfterGroupId)?.name || "Categoría")}</button>`,
      );
    data.tagIds.forEach((id) =>
      selected.push(
        `<button class="filter-chip selected tag-filter" data-remove-tag="${esc(id)}">${esc(byId(data.tags, id)?.name || "Etiqueta")} <span aria-hidden="true">×</span></button>`,
      ),
    );
    if (!selected.length)
      selected.push(
        '<button class="filter-chip active" disabled>Todo</button>',
      );
    const canAddCategory = !data.categoryId && !data.categoryAfterGroupId;
    selected.push(
      canAddCategory
        ? '<button class="filter-chip dashed" data-add-category>＋ Agregar categoría</button>'
        : "",
    );
    selected.push(
      `<button class="filter-chip dashed" data-add-tag ${data.tagIds.length >= 2 ? 'disabled title="Puedes elegir hasta dos etiquetas"' : ""}>＋ Agregar etiqueta</button>`,
    );
    return selected.filter(Boolean).join("");
  }

  // Genera el selector de sedes para la vista actual.
  function locationSelect(id, value, allOption = false) {
    return `<select class="select" id="${id}">${allOption ? '<option value="">Todas las sedes</option>' : ""}${data.locations.map((l) => `<option value="${esc(l.id)}" ${l.id === value ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>`;
  }

  // Muestra un diálogo interno y devuelve la confirmación del usuario.
  function confirmInApp(
    title,
    message,
    confirmLabel = "Confirmar",
    danger = true,
  ) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "password-dialog entity-dialog confirm-dialog";
      dialog.innerHTML = `<div class="panel-title">${esc(title)}</div><p>${esc(message)}</p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Volver</button><button type="button" class="btn ${danger ? "danger-button" : "primary"}" data-confirm>${esc(confirmLabel)}</button></div>`;
      let confirmed = false;
      dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
      dialog.querySelector("[data-confirm]").onclick = () => {
        confirmed = true;
        dialog.close();
      };
      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          resolve(confirmed);
        },
        { once: true },
      );
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  // Genera la tarjeta visual de un producto.
  function renderProductCard(product, active) {
    const variants = activeVariants(product);
    const price =
      product.product_kind !== "standard"
        ? "Agregar movimiento"
        : variants.length > 1
          ? `Desde ${money(Math.min(...variants.map((v) => Number(v.price))))}`
          : money(variants[0]?.price || 0);
    const selected = data.selectedMenuProduct === product.id && !active;
    const special =
      product.product_kind === "income" || product.product_kind === "expense";
    const hoverActions =
      !active && isAdmin() && !special
        ? `<span class="product-actions"><button type="button" class="product-icon" data-menu-edit="${esc(product.id)}" aria-label="Editar ${esc(product.name)}" title="Editar">✎</button><button type="button" class="product-icon" data-menu-add="${esc(product.id)}" aria-label="Agregar ${esc(product.name)}" title="Agregar">＋</button></span>`
        : !active && selected
          ? `<span class="product-actions">${isAdmin() && !special ? `<button type="button" class="product-icon" data-menu-edit="${esc(product.id)}" aria-label="Editar ${esc(product.name)}" title="Editar">✎</button>` : ""}<button type="button" class="product-icon" data-menu-add="${esc(product.id)}" aria-label="Agregar ${esc(product.name)}" title="Agregar">＋</button></span>`
          : "";
    const firstTag = productTags(product.id)
      .map((id) => byId(data.tags, id)?.name)
      .filter(Boolean)[0];
    return `<article class="product ${!active && isAdmin() ? "admin-hover" : ""} ${special ? `special ${product.product_kind === "income" ? "in" : "out"}` : ""} ${selected ? "selected" : ""}" tabindex="0" data-product-card="${esc(product.id)}">
      <span class="product-copy"><span class="pname">${esc(product.name)}</span><span class="tag">${esc(firstTag || (special ? (product.product_kind === "income" ? "Entrada de dinero" : "Salida de dinero") : ""))}</span></span>
      <span class="price">${price}</span>${hoverActions}</article>`;
  }

  // Genera la fila visual de una línea del pedido.
  function renderLine(item, index) {
    const isSpecial =
      item.product_kind === "income" ||
      item.product_kind === "expense" ||
      item.line_kind === "income" ||
      item.line_kind === "expense";
    const sign =
      item.product_kind === "expense" || item.line_kind === "expense" ? -1 : 1;
    const amount = lineAmount(item) * sign;
    const variant = variantFor(item);
    const addons = addonRows(item);
    const expanded = Boolean(item.expanded);
    const product = byId(data.products, item.product_id);
    const hasOptions =
      !isSpecial &&
      Boolean(product) &&
      (activeVariants(product).length > 1 || addonsFor(product.id).length > 0);
    const method = item.payment_method
      ? item.payment_method === "cash"
        ? "Efectivo"
        : "Yape"
      : "";
    const details = isSpecial
      ? `<div class="caption">${money(Math.abs(amount))}${method ? ` · ${esc(method)}` : ""}</div>`
      : `<div class="caption">${money(variant?.price || item.unit_price || 0)} c/u</div>${expanded ? `<div class="line-detail">${variant ? `<span>Variante: ${esc(variant.name)}</span>` : ""}${addons.map((a) => `<span>${esc(a.name)}${a.quantity > 1 ? ` × ${a.quantity}` : ""} · ${money(a.price * a.quantity)}</span>`).join("")}</div>` : ""}`;
    const expand = hasOptions
      ? `<button type="button" class="line-expand" data-expand-line="${index}" aria-expanded="${expanded}">${expanded ? "Ocultar detalle" : "Ver variante y agregados"}</button>`
      : "";
    const controls = isSpecial
      ? ""
      : `<div class="controls"><button type="button" data-line="dec" data-index="${index}" aria-label="Restar uno">−</button><span>${Number(item.quantity || 1)}</span><button type="button" data-line="inc" data-index="${index}" aria-label="Sumar uno">＋</button></div>`;
    const edit =
      isSpecial || hasOptions
        ? `<button type="button" class="line-icon" data-edit-line="${index}" aria-label="Editar ${esc(lineName(item))}" title="Editar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button>`
        : "";
    const remove = `<button type="button" class="line-icon delete-line" data-line="remove" data-index="${index}" aria-label="Eliminar ${esc(lineName(item))}" title="Eliminar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg></button>`;
    return `<div class="line ${expanded ? "expanded" : ""}"><div class="line-main"><div class="line-info" ${hasOptions ? `data-toggle-line="${index}" tabindex="0" role="button" aria-expanded="${expanded}"` : ""}><div class="lname">${esc(lineName(item))}${isSpecial ? (sign < 0 ? " · egreso" : " · ingreso") : ""}</div>${details}${expand}${controls}</div><div class="line-values"><div class="ltotal">${money(isSpecial ? Math.abs(amount) : amount)}</div><span class="line-actions">${edit}${remove}</span></div></div></div>`;
  }

  // Genera la vista completa del flujo de pedidos.
  function renderOrders() {
    if (!data.loaded && data.loading)
      return '<section class="page-head"><div><div class="eyebrow">Punto de venta</div><h1>Flujo de pedidos</h1></div></section><div class="panel"><div class="empty">Cargando menú…</div></div>';
    if (data.error && !data.loaded)
      return `<section class="page-head"><div><div class="eyebrow">Punto de venta</div><h1>Flujo de pedidos</h1></div></section><div class="panel"><div class="empty">${esc(data.error)}</div></div>`;
    const productList = menuProducts();
    const active = Boolean(activeOrder());
    const order = activeOrder() || { items: [], note: "" };
    const productsHtml = productList.length
      ? productList.map((p) => renderProductCard(p, active)).join("")
      : '<div class="empty">No hay productos que coincidan con esos filtros.</div>';
    const linesHtml = order.items.length
      ? order.items.map(renderLine).join("")
      : '<div class="empty order-empty"><span>☕</span>Agrega productos para empezar</div>';
    const adminSite = isAdmin()
      ? locationSelect("order-location", currentLocationId())
      : `<span class="select site-static">${esc(currentLocationName())}</span>`;
    const orderHeader = active
      ? `<div class="order-head"><div class="order-title">${isOpenOrder() ? `Pedido compartido · ${esc(data.activeOpen.operator_name || "Equipo")}` : "Pedido nuevo"}</div><div class="tools">${adminSite}<button type="button" class="icon note-icon ${active.note ? "has-note" : ""}" id="order-note-button" title="Administrar notas" aria-label="Administrar notas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4 4v12.5H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z"/><path d="M14 4v4h4M8.5 12h7M8.5 15.5h7"/></svg>${active.note ? '<i aria-hidden="true"></i>' : ""}</button></div></div>`
      : "";
    const openCards = data.openOrders.length
      ? data.openOrders
          .map(
            (o) =>
              `<article class="open-card ${data.activeOpen?.id === o.order_id ? "active-open-card" : ""}" data-open="${esc(o.order_id)}" role="button" tabindex="0" aria-label="${data.activeOpen?.id === o.order_id ? "Cerrar" : "Abrir"} pedido abierto de ${esc(byId(data.locations, o.location_id)?.name || o.location_name || "Sede")}"><div class="open-row"><span class="open-id">${esc(byId(data.locations, o.location_id)?.name || o.location_name || "Sede")}</span><span class="badge">${data.activeOpen?.id === o.order_id ? "Abierto · toca para cerrar" : "Sin pagar"}</span></div><div class="open-meta"><span>${itemCount(o.items)} productos · ${esc(o.operator_name || "Equipo")}</span><strong>${money(orderTotal(o.items))}</strong></div><div class="open-items">${orderedLabel(o.items)}</div></article>`,
          )
          .join("")
      : '<div class="empty" style="padding:10px 0">No hay pedidos pendientes.</div>';
    const draftActions = isOpenOrder()
      ? `<div class="order-actions"><button class="btn secondary" id="cancel-open-order">Cancelar pedido</button><button class="pay" id="pay-order">Registrar pago</button></div>`
      : `<button class="btn primary publish-order" id="publish-order" ${order.items.length ? "" : "disabled"}>Registrar pedido</button><div class="order-actions"><button class="btn secondary" id="cancel-draft">Cancelar</button><button class="pay" id="pay-order" ${order.items.length ? "" : "disabled"}>Registrar pago</button></div>`;
    const orderPanel = active
      ? `<aside class="panel order">${orderHeader}<div class="lines">${linesHtml}</div><div class="sum"><div class="sumrow"><span>Total</span><span>${money(orderTotal(order.items))}</span></div>${draftActions}</div></aside>`
      : "";
    return `<section class="page-head orders-page-head"><div><div class="eyebrow">Punto de venta</div><h1>Toma un pedido</h1>${active ? `<p class="desc">${isOpenOrder() ? "Editando un pedido compartido." : "Pedido en curso."}</p>` : '<p class="desc orders-start-hint">Selecciona productos del menú para empezar.</p>'}</div><div class="order-page-actions">${active ? "" : '<button class="btn primary new-order-button" id="new-order" aria-label="Nuevo pedido" title="Nuevo pedido"><span class="new-order-plus-text" aria-hidden="true">＋</span><span class="new-order-label--wide">Nuevo pedido</span><span class="new-order-label--stacked">Nuevo<br>pedido</span><svg class="new-order-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>'}</div></section>
      <div class="orders-workspace"><div class="layout ${active ? "with-order" : "menu-only"}"><section class="panel menu-panel"><div class="panel-head"><div class="panel-title">Menú</div><input class="search" id="menu-search" placeholder="⌕ Buscar producto" value="${esc(data.query)}"></div><div class="chips filter-chips">${filtersHtml()}</div><div class="products">${productsHtml}</div></section>${orderPanel}</div>
      <section class="open-section"><div class="open-heading"><div><h2>Pedidos abiertos</h2><span class="meta">${data.paidToday} pedidos pagados hoy</span></div>${isAdmin() ? locationSelect("open-site-filter", data.openFilterLocationId, true) : ""}</div><div class="open-grid">${openCards}</div></section></div>`;
  }

  // Actualiza una selección de categoría, grupo o etiqueta.
  function setSelection(kind, id) {
    if (kind === "category") {
      data.categoryId = id;
      data.groupId = "";
      data.categoryAfterGroupId = "";
    }
    if (kind === "group") {
      data.groupId = id;
      data.categoryId = "";
      data.categoryAfterGroupId = "";
    }
    if (kind === "category-after-group") data.categoryAfterGroupId = id;
    data.selectedMenuProduct = "";
    render();
  }

  // Muestra un diálogo para elegir elementos de una lista.
  function pickerDialog(title, entries, onSelect, selectedIds = []) {
    const d = document.createElement("dialog");
    d.className = "password-dialog picker-dialog";
    d.innerHTML = `<div class="panel-title">${esc(title)}</div><div class="picker-list">${entries.map((x) => `<button type="button" class="picker-option" data-pick="${esc(x.id)}" ${selectedIds.includes(x.id) ? "disabled" : ""}>${esc(x.name)}${x.group ? '<span class="meta">Grupo</span>' : ""}</button>`).join("") || '<div class="empty">No hay opciones disponibles.</div>'}</div><div class="dialog-actions"><button type="button" class="btn secondary" data-close-picker>Cancelar</button></div>`;
    d.querySelectorAll("[data-pick]").forEach((button) =>
      button.addEventListener("click", () => {
        const entry = entries.find((x) => x.id === button.dataset.pick);
        d.close();
        if (entry) onSelect(entry);
      }),
    );
    d.querySelector("[data-close-picker]").onclick = () => d.close();
    document.body.appendChild(d);
    d.showModal();
    d.addEventListener("close", () => d.remove());
  }

  // Abre el selector de categorías.
  function chooseCategory() {
    const groupSet = new Set(data.groups);
    const entries = data.categories.map((x) => ({
      id: x.id,
      name: x.name,
      group: groupSet.has(x.id),
    }));
    // Until multiple-group selection is clarified, allow at most one inferred group.
    const allowed = data.groupId ? entries.filter((x) => !x.group) : entries;
    pickerDialog("Agregar categoría", allowed, (entry) =>
      setSelection(
        entry.group
          ? "group"
          : data.groupId
            ? "category-after-group"
            : "category",
        entry.id,
      ),
    );
  }

  // Abre el selector de etiquetas.
  function chooseTag() {
    const entries = data.tags.filter((x) => !data.tagIds.includes(x.id));
    pickerDialog(
      "Agregar etiqueta",
      entries,
      (entry) => {
        if (data.tagIds.length < 2) data.tagIds.push(entry.id);
        render();
      },
      data.tagIds,
    );
  }

  // Agrega un producto al pedido o abre sus opciones.
  function addProductToOrder(product) {
    if (
      product.product_kind === "income" ||
      product.product_kind === "expense"
    ) {
      specialDialog(product);
      return;
    }
    const variants = activeVariants(product);
    if (!variants.length) {
      toast("Este producto no está disponible en la sede seleccionada.");
      return;
    }
    const addons = addonsFor(product.id);
    const current = activeOrder();
    const canSelect = variants.length > 1 || addons.length > 0;
    if (canSelect) {
      productOptionsDialog(product, variants, addons);
      return;
    }
    addConfiguredLine(product, variants[0], [], current);
  }

  // Agrega al pedido una línea con sus opciones configuradas.
  function addConfiguredLine(
    product,
    variant,
    selectedAddons,
    current = activeOrder(),
  ) {
    if (!current) {
      data.activeDraft = {
        location_id: currentLocationId(),
        items: [],
        note: "",
        showNotes: false,
      };
      current = data.activeDraft;
    }
    const newLine = {
      product_id: product.id,
      product_kind: product.product_kind,
      product_name: product.name,
      variant_id: variant.id,
      variant_name: variant.name,
      unit_price: Number(variant.price),
      quantity: 1,
      addons: selectedAddons.map((x) => ({
        addon_id: x.id,
        name: x.name,
        price: Number(x.price),
        quantity: 1,
      })),
    };
    const same = current.items.find(
      (x) =>
        x.product_id === newLine.product_id &&
        x.variant_id === newLine.variant_id &&
        JSON.stringify(x.addons || []) === JSON.stringify(newLine.addons),
    );
    if (same) same.quantity = Number(same.quantity || 1) + 1;
    else current.items.push(newLine);
    data.selectedMenuProduct = "";
    render();
    persistIfOpen();
  }

  // Muestra las opciones de variante y agregados de un producto.
  function productOptionsDialog(
    product,
    variants,
    addons,
    editingIndex = null,
  ) {
    const existing =
      editingIndex == null ? null : activeOrder()?.items[editingIndex];
    const d = document.createElement("dialog");
    d.className = "password-dialog product-options-dialog";
    const defaultVariant =
      existing?.variant_id || (variants.length === 1 ? variants[0].id : "");
    const oldAddonIds = new Set(
      (existing?.addons || []).map((x) => x.addon_id),
    );
    const draw = () => {
      d.innerHTML = `<form method="dialog"><div class="panel-title">${editingIndex == null ? "Agregar producto" : "Editar producto"}</div><p class="meta">${esc(product.name)}</p>
        <fieldset class="option-group"><legend>Variante <span class="required">Obligatoria</span></legend>${variants.map((v) => `<label class="option-row"><input type="radio" name="variant" value="${esc(v.id)}" ${d.querySelector(`[name="variant"][value="${CSS.escape(v.id)}"]`)?.checked || v.id === defaultVariant ? "checked" : ""}><span>${esc(v.name)}</span><strong>${money(v.price)}</strong></label>`).join("")}</fieldset>
        ${addons.length ? `<fieldset class="option-group"><legend>Agregados <span class="meta">Opcionales</span></legend>${addons.map((a) => `<label class="option-row"><input type="checkbox" name="addon" value="${esc(a.id)}" ${d.querySelector(`[name="addon"][value="${CSS.escape(a.id)}"]`)?.checked || oldAddonIds.has(a.id) ? "checked" : ""}><span>${esc(a.name)}</span><strong>+ ${money(a.price)}</strong></label>`).join("")}</fieldset>` : ""}
        <div class="dialog-actions"><button type="button" class="btn secondary" data-cancel-options>Cancelar</button><button type="submit" class="btn primary" data-confirm-options>${editingIndex == null ? "Agregar producto" : "Guardar cambios"}</button></div><p class="password-error" role="alert"></p></form>`;
      d.querySelector("[data-cancel-options]").onclick = () => d.close();
      d.querySelector("form").onsubmit = (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const variant = byId(variants, form.get("variant"));
        if (!variant) {
          d.querySelector(".password-error").textContent =
            "Elige una variante para continuar.";
          return;
        }
        const selectedAddons = [...form.getAll("addon")]
          .map((id) => byId(addons, id))
          .filter(Boolean);
        if (editingIndex == null)
          addConfiguredLine(product, variant, selectedAddons);
        else {
          const item = activeOrder().items[editingIndex];
          item.variant_id = variant.id;
          item.variant_name = variant.name;
          item.unit_price = Number(variant.price);
          item.addons = selectedAddons.map((x) => ({
            addon_id: x.id,
            name: x.name,
            price: Number(x.price),
            quantity: 1,
          }));
          render();
          persistIfOpen();
        }
        d.close();
      };
    };
    draw();
    document.body.appendChild(d);
    d.showModal();
    d.addEventListener("close", () => d.remove());
  }

  // Muestra el diálogo para editar las notas del pedido.
  function notesDialog() {
    const order = activeOrder();
    if (!order) return;
    const d = document.createElement("dialog");
    d.className = "password-dialog notes-dialog";
    d.innerHTML = `<form method="dialog"><div class="notes-dialog-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.75h7l4 4v12.5H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1 2-2Z"/><path d="M14 4v4h4M8.5 12h7M8.5 15.5h7"/></svg><div><div class="panel-title">Notas del pedido</div><div class="meta">Visible para el equipo que comparte este pedido</div></div></div><label class="dialog-label" for="order-note-input">Nota<textarea id="order-note-input" name="note" maxlength="1000" placeholder="Escribe aquí las indicaciones…">${esc(order.note || "")}</textarea></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel-notes>Cancelar</button><button type="submit" class="btn primary" data-save-notes>Guardar nota</button></div></form>`;
    d.querySelector("[data-cancel-notes]").onclick = () => d.close();
    d.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const button = d.querySelector("[data-save-notes]");
      order.note = String(
        new FormData(event.currentTarget).get("note") || "",
      ).trim();
      button.disabled = true;
      if (isOpenOrder()) await persistIfOpen();
      else render();
      d.close();
    };
    document.body.appendChild(d);
    d.showModal();
    d.querySelector("#order-note-input").focus();
    d.addEventListener("close", () => d.remove());
  }

  // Muestra el diálogo para registrar o editar un movimiento especial.
  function specialDialog(product, editingIndex = null) {
    const editing =
      editingIndex == null ? null : activeOrder()?.items[editingIndex];
    const d = document.createElement("dialog");
    d.className = "password-dialog special-dialog";
    const isExpense = product.product_kind === "expense";
    const currentOrder = activeOrder();
    const canCorrect =
      isExpense &&
      !editing &&
      (!currentOrder || currentOrder.items.length === 0);
    let amountText = editing
      ? String(editing.manual_amount)
      : canCorrect
        ? "0"
        : "";
    let conceptText = editing?.concept || "";
    let method = editing?.payment_method || "yape";
    let candidates = [],
      loadingCandidates = canCorrect,
      candidateError = "",
      selectedCandidateId = "",
      saving = false;
    const isCorrectionMode = () =>
      canCorrect &&
      (!amountText.trim() ||
        Number(String(amountText).replace(",", ".")) === 0);
    const dateTime = (value) =>
      new Intl.DateTimeFormat("es-PE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Lima",
      }).format(new Date(value));
    const draw = () => {
      const correctionMode = isCorrectionMode();
      const rows = candidates
        .map((candidate) => {
          const items = (candidate.item_summary || [])
            .map(
              (x) =>
                `${esc(x.name)}${x.quantity > 1 ? ` × ${x.quantity}` : ""}`,
            )
            .join(", ");
          return `<button type="button" class="correction-candidate ${selectedCandidateId === candidate.order_id ? "selected" : ""}" data-correction-candidate="${esc(candidate.order_id)}" aria-pressed="${selectedCandidateId === candidate.order_id}"><span class="correction-candidate-top"><strong>${dateTime(candidate.paid_at)} · ${esc(candidate.location_name || "Sede")}</strong><strong>${money(candidate.total)}</strong></span><span>${esc(candidate.operator_name || "Equipo")}</span><span class="meta">Yape ${money(candidate.amount_yape)} · Efectivo ${money(candidate.amount_cash)}</span><span class="meta correction-items">${items || "Sin detalle de productos"}</span></button>`;
        })
        .join("");
      d.innerHTML = `<form method="dialog"><div class="panel-title">${editing ? "Editar movimiento" : "Agregar egreso"}</div><p class="meta">${esc(product.name)}</p><label class="dialog-label">Monto (S/)<input name="amount" required inputmode="decimal" type="number" min="${canCorrect ? "0" : "0.01"}" step="any" value="${esc(amountText)}" placeholder="0.00"></label>
        ${canCorrect ? `<section class="expense-corrections" data-correction-panel ${correctionMode ? "" : "hidden"}><div class="correction-heading"><strong>Corregir un pago</strong><span class="meta">Pagos correctos de hoy y ayer</span></div>${loadingCandidates ? '<div class="empty">Buscando pagos…</div>' : candidateError ? `<div class="correction-error">${esc(candidateError)}</div>` : rows || '<div class="empty">No hay pagos correctos de hoy ni de ayer en esta sede.</div>'}<button type="button" class="btn primary full" data-run-correction ${selectedCandidateId && !saving ? "" : "disabled"}>${saving ? "Corrigiendo…" : "Corregir pago seleccionado"}</button><p class="correction-warning">El pago se conservará en el historial y quedará marcado como erróneo.</p></section>` : ""}
        <label class="dialog-label" data-concept-wrap ${correctionMode ? "hidden" : ""}>Concepto (opcional)<input name="concept" maxlength="120" value="${esc(conceptText)}" placeholder="Ej. compra de insumos"></label><div class="special-methods" data-method-wrap ${correctionMode ? "hidden" : ""}><span class="dialog-label">Medio de pago</span><div class="method-choice"><button type="button" data-method="yape" class="${method === "yape" ? "active" : ""}">Yape</button><button type="button" data-method="cash" class="${method === "cash" ? "active" : ""}">Efectivo</button></div></div><p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel-special>Cancelar</button><button type="submit" class="btn primary" data-add-special ${correctionMode ? "disabled" : ""} ${correctionMode ? 'aria-disabled="true"' : ""}>${editing ? "Guardar cambios" : "Agregar monto"}</button></div></form>`;
      d.querySelector("[data-cancel-special]").onclick = () => d.close();
      const amountInput = d.querySelector('[name="amount"]');
      amountInput.oninput = () => {
        amountText = amountInput.value;
        const correctionModeNow = isCorrectionMode();
        d.querySelector("[data-correction-panel]")?.toggleAttribute(
          "hidden",
          !correctionModeNow,
        );
        d.querySelector("[data-concept-wrap]")?.toggleAttribute(
          "hidden",
          correctionModeNow,
        );
        d.querySelector("[data-method-wrap]")?.toggleAttribute(
          "hidden",
          correctionModeNow,
        );
        const addButton = d.querySelector("[data-add-special]");
        if (addButton) {
          addButton.disabled = correctionModeNow;
          addButton.setAttribute("aria-disabled", String(correctionModeNow));
        }
      };
      d.querySelector('[name="concept"]').oninput = (event) => {
        conceptText = event.target.value;
      };
      d.querySelectorAll("[data-method]").forEach(
        (b) =>
          (b.onclick = () => {
            method = b.dataset.method;
            d.querySelectorAll("[data-method]").forEach((x) =>
              x.classList.toggle("active", x === b),
            );
          }),
      );
      d.querySelectorAll("[data-correction-candidate]").forEach(
        (b) =>
          (b.onclick = () => {
            selectedCandidateId = b.dataset.correctionCandidate;
            draw();
          }),
      );
      d.querySelector("[data-run-correction]")?.addEventListener(
        "click",
        runCorrection,
      );
      d.querySelector("form").onsubmit = async (event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const amount = Number(String(amountText).replace(",", "."));
        if (!Number.isFinite(amount) || amount <= 0) {
          d.querySelector(".password-error").textContent =
            "Escribe un monto mayor que cero o elige un pago para corregir.";
          return;
        }
        if ((!editing || Number(editing.manual_amount) !== amount) && !isTenthSol(amountText)) {
          window.alert(tenthSolValidationMessage);
          return;
        }
        if (editing) {
          const item = activeOrder().items[editingIndex];
          item.manual_amount = amount;
          item.concept = String(fields.get("concept") || "").trim();
          item.payment_method = method;
        } else {
          const current =
            activeOrder() ||
            (data.activeDraft = {
              location_id: currentLocationId(),
              items: [],
              note: "",
              showNotes: false,
            });
          const variant = data.variants.find(
            (v) => v.product_id === product.id && v.is_active,
          );
          if (!variant) {
            d.querySelector(".password-error").textContent =
              "Falta configurar la variante de este movimiento.";
            return;
          }
          current.items.push({
            product_id: product.id,
            product_kind: product.product_kind,
            product_name: product.name,
            variant_id: variant.id,
            variant_name: variant.name,
            unit_price: amount,
            manual_amount: amount,
            concept: String(fields.get("concept") || "").trim(),
            payment_method: method,
            quantity: 1,
            addons: [],
          });
        }
        d.close();
        render();
        persistIfOpen();
      };
    };
    // Carga los movimientos candidatos para una corrección.
    async function loadCorrectionCandidates() {
      if (!canCorrect) return;
      const active = activeOrder();
      const locationIds =
        isAdmin() && !active
          ? data.locations.map((location) => location.id)
          : [
              active?.location_id || state.locationId || currentLocationId(),
            ].filter(Boolean);
      if (!locationIds.length) {
        loadingCandidates = false;
        candidateError = "No hay una sede seleccionada para buscar pagos.";
        draw();
        return;
      }
      const results = await Promise.all(
        locationIds.map(async (locationId) => {
          const { data: rows, error } = await supabase.rpc(
            "get_correction_candidates",
            { p_location_id: locationId },
          );
          return { rows, error, locationId };
        }),
      );
      const failed = results.find((result) => result.error);
      loadingCandidates = false;
      if (failed)
        candidateError =
          failed.error.message || "No se pudieron buscar los pagos.";
      else
        candidates = results
          .flatMap((result) =>
            (result.rows || []).map((row) => ({
              ...row,
              location_name:
                byId(data.locations, result.locationId)?.name || "Sede",
            })),
          )
          .sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at));
      draw();
    }
    // Aplica la corrección seleccionada a un movimiento.
    async function runCorrection() {
      const candidate = candidates.find(
        (x) => x.order_id === selectedCandidateId,
      );
      if (!candidate || saving) return;
      saving = true;
      draw();
      const { error } = await supabase.rpc("correct_paid_order", {
        p_order_id: candidate.order_id,
        p_reason: "Corrección solicitada desde el flujo de egreso",
      });
      if (error) {
        saving = false;
        candidateError = error.message || "No se pudo corregir el pago.";
        draw();
        return;
      }
      d.close();
      toast(`Pago de ${money(candidate.total)} marcado como erróneo.`);
      render();
      await refreshOpenOrders(false);
    }
    draw();
    document.body.appendChild(d);
    d.showModal();
    d.querySelector('[name="amount"]').focus();
    d.addEventListener("close", () => d.remove());
    if (canCorrect) loadCorrectionCandidates();
  }

  // Muestra el diálogo para confirmar el pago del pedido.
  function payDialog() {
    const order = activeOrder();
    if (!order?.items?.length) {
      toast("Agrega al menos un producto o movimiento.");
      return;
    }
    const normalSubtotal = order.items
      .filter(
        (x) =>
          x.product_kind !== "income" &&
          x.product_kind !== "expense" &&
          x.line_kind !== "income" &&
          x.line_kind !== "expense",
      )
      .reduce((sum, x) => sum + lineAmount(x), 0);
    const roundToTenth = (value) =>
      Math.floor((Number(value) || 0) * 10 + 0.500000001) / 10;
    let universalize = true,
      method = "yape",
      syncSpecials = false,
      yapeAmount = roundToTenth(normalSubtotal / 2);
    let specialMethods = order.items.map((x) => x.payment_method || "yape");
    let printerCheckBusy = false;
    let printerAvailable = false;
    let printerStatusTimer = null;
    let printRequested = false;
    const d = document.createElement("dialog");
    d.className = "password-dialog payment-dialog";
    const draw = () => {
      const current = activeOrder();
      if (!current) {
        d.close();
        return;
      }
      const currentNormal = current.items
        .filter(
          (x) =>
            x.product_kind !== "income" &&
            x.product_kind !== "expense" &&
            x.line_kind !== "income" &&
            x.line_kind !== "expense",
        )
        .reduce((sum, x) => sum + lineAmount(x), 0);
      yapeAmount = Math.max(0, Math.min(currentNormal, roundToTenth(yapeAmount)));
      const specials = current.items
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) =>
            ["income", "expense"].includes(item.product_kind) ||
            ["income", "expense"].includes(item.line_kind),
        );
      d.innerHTML = `<form method="dialog"><div class="panel-title">Registrar pago</div>
        <div class="payment-global"><div class="payment-row"><div><div class="panel-title small-title">${universalize ? "Saldo sin productos especiales" : "Asignar Yape a productos"}</div><div class="payment-amount">${money(currentNormal)}</div></div>${universalize ? `<div class="method-choice large"><button type="button" data-global-method="yape" class="${method === "yape" ? "active" : ""}">Yape</button><button type="button" data-global-method="cash" class="${method === "cash" ? "active" : ""}">Efectivo</button></div>` : `<label class="yape-input">Yape<input type="number" min="0" max="${currentNormal}" step="0.1" value="${yapeAmount.toFixed(2)}" data-yape-input></label>`}</div>
        ${universalize ? "" : `<div class="split-control"><input type="range" min="0" max="${currentNormal}" step="0.01" value="${yapeAmount}" data-yape-range><div class="split-values"><span>Yape: <strong data-yape-value>${money(yapeAmount)}</strong></span><span>Efectivo: <strong data-cash-value>${money(currentNormal - yapeAmount)}</strong></span></div></div>`}
        <label class="toggle-row"><input type="checkbox" data-universalize ${universalize ? "checked" : ""}> Universalizar</label>
        <label class="toggle-row printer-option"><input type="checkbox" data-print-ticket ${printRequested ? "checked" : ""} ${printerAvailable ? "" : "disabled"}><span>Imprimir comprobante de pago</span><span class="meta" data-printer-status>${printerAvailable ? "Dispositivo disponible" : "Comprobando dispositivo…"}</span></label>
        ${universalize && specials.length ? `<label class="toggle-row"><input type="checkbox" data-sync ${syncSpecials ? "checked" : ""}> Sincronizar movimientos con el medio general</label>` : ""}</div>
        ${specials.length ? `<section class="payment-specials"><div class="panel-title small-title">Productos especiales</div>${specials.map(({ item, index }) => `<div class="special-payment-row"><div><strong>${esc(lineName(item))}</strong><span class="meta">${money(Math.abs(lineAmount(item)))}</span></div><div class="method-choice"><button type="button" data-special-method="yape" data-special-index="${index}" class="${specialMethods[index] === "yape" ? "active" : ""}">Yape</button><button type="button" data-special-method="cash" data-special-index="${index}" class="${specialMethods[index] === "cash" ? "active" : ""}">Efectivo</button></div></div>`).join("")}</section>` : ""}
        <div class="payment-total"><span>Total del pedido</span><strong>${money(orderTotal(current.items))}</strong></div><p class="password-error payment-error" data-payment-error role="alert"></p>
        <div class="dialog-actions"><button type="button" class="btn secondary" data-cancel-payment>Cancelar</button><button type="submit" class="btn primary" data-confirm-payment>Registrar</button></div></form>`;
      d.querySelector("[data-cancel-payment]").onclick = () => d.close();
      const printCheckbox = d.querySelector("[data-print-ticket]");
      printCheckbox.onchange = () => {
        printRequested = printCheckbox.checked;
      };
      d.querySelector("[data-universalize]").onchange = (e) => {
        universalize = e.target.checked;
        draw();
      };
      d.querySelector("[data-sync]")?.addEventListener("change", (e) => {
        syncSpecials = e.target.checked;
        if (syncSpecials) specialMethods = specialMethods.map(() => method);
        draw();
      });
      d.querySelectorAll("[data-global-method]").forEach(
        (b) =>
          (b.onclick = () => {
            method = b.dataset.globalMethod;
            if (syncSpecials) specialMethods = specialMethods.map(() => method);
            draw();
          }),
      );
      d.querySelector("[data-yape-input]")?.addEventListener("input", (e) => {
        const rawValue = e.target.value.trim();
        const n = Number(rawValue);
        if (rawValue && Number.isFinite(n)) {
          const validTenth = isTenthSol(rawValue);
          yapeAmount = Math.max(
            0,
            Math.min(currentNormal, validTenth ? n : roundToTenth(n)),
          );
          if (!validTenth) e.target.value = yapeAmount.toFixed(2);
          const values = d.querySelector(".split-values");
          if (values)
            values.innerHTML = `<span>Yape: <strong>${money(yapeAmount)}</strong></span><span>Efectivo: <strong>${money(currentNormal - yapeAmount)}</strong></span>`;
          d.querySelector("[data-yape-range]").value = yapeAmount;
        }
      });
      d.querySelector("[data-yape-input]")?.addEventListener("change", (e) => {
        e.target.value = yapeAmount.toFixed(2);
      });
      d.querySelector("[data-yape-range]")?.addEventListener("input", (e) => {
        const n = Number(e.target.value);
        yapeAmount = Math.max(0, Math.min(currentNormal, roundToTenth(n)));
        d.querySelector("[data-yape-value]").textContent = money(yapeAmount);
        d.querySelector("[data-cash-value]").textContent = money(
          currentNormal - yapeAmount,
        );
      });
      d.querySelectorAll("[data-special-method]").forEach(
        (b) =>
          (b.onclick = () => {
            specialMethods[Number(b.dataset.specialIndex)] =
              b.dataset.specialMethod;
            const index = Number(b.dataset.specialIndex);
            const item = current.items[index];
            item.payment_method = b.dataset.specialMethod;
            if (syncSpecials) syncSpecials = false;
            draw();
          }),
      );
      d.querySelector("form").onsubmit = async (event) => {
        event.preventDefault();
        const button = d.querySelector("[data-confirm-payment]"),
          errorBox = d.querySelector("[data-payment-error]");
        button.disabled = true;
        errorBox.textContent = "";
        const requestPrint = d.querySelector("[data-print-ticket]")?.checked === true;
        try {
          const orderNow = activeOrder();
          if (!orderNow?.items?.length)
            throw new Error("Agrega al menos un producto o movimiento.");
          orderNow.items.forEach((item, index) => {
            if (
              ["income", "expense"].includes(item.product_kind) ||
              ["income", "expense"].includes(item.line_kind)
            )
              item.payment_method =
                specialMethods[index] || item.payment_method || "yape";
          });
          // The RPC allocates this ratio across lines and rounds the cumulative
          // result to cents; derive it from the exact amount shown in the dialog.
          const percent = currentNormal > 0
            ? Number(((yapeAmount / currentNormal) * 100).toFixed(12))
            : 0;
          const args = {
            p_universalize: universalize,
            p_universal_method: method,
            p_yape_percent: universalize ? 0 : percent,
          };
          let result;
          if (isOpenOrder()) {
            const currentOpen = data.activeOpen;
            const saveResult = await supabase.rpc("update_open_order", {
              p_order_id: currentOpen.id,
              p_expected_revision: currentOpen.revision,
              p_note: currentOpen.note || null,
              p_items: toRpcItems(orderNow.items),
            });
            if (saveResult.error) throw saveResult.error;
            currentOpen.revision = saveResult.data;
            currentOpen.items = orderNow.items;
            result = await supabase.rpc("pay_open_order", {
              p_order_id: currentOpen.id,
              p_expected_revision: currentOpen.revision,
              ...args,
            });
          } else {
            result = await supabase.rpc("record_paid_order", {
              p_location_id: orderNow.location_id || currentLocationId(),
              p_note: orderNow.note || null,
              p_items: toRpcItems(orderNow.items),
              ...args,
            });
          }
          if (result.error) throw result.error;
          const paidOrderId = result.data?.order_id;
          d.close();
          data.activeDraft = null;
          data.activeOpen = null;
          await refreshOpenOrders(false);
          render();
          if (requestPrint) {
            if (paidOrderId) {
              await printTicket(paidOrderId, { paymentJustRegistered: true });
            } else {
              toast("Pago registrado correctamente, pero no se recibió el identificador para imprimir.");
            }
          } else {
            toast("Pago registrado correctamente.");
          }

        } catch (error) {
          button.disabled = false;
          errorBox.textContent =
            error?.message ||
            "No se pudo registrar el pago. Revisa tu conexión e inténtalo otra vez.";
          if (error?.code === "40001") {
            errorBox.textContent =
              "El pedido cambió mientras registrabas el pago. Se actualizará; vuelve a intentarlo.";
            await refreshActiveOpenOrder(true);
          }
        }
      };
    };
    draw();
    document.body.appendChild(d);
    d.showModal();
    const updatePrinterStatus = async () => {
      if (printerCheckBusy || !d.open) return;
      printerCheckBusy = true;
      try {
        const { data: available, error } = await supabase.rpc("get_my_printer_status");
        printerAvailable = !error && available === true;
        const checkbox = d.querySelector("[data-print-ticket]");
        const status = d.querySelector("[data-printer-status]");
        if (checkbox) {
          checkbox.disabled = !printerAvailable;
          if (!printerAvailable) {
            checkbox.checked = false;
            printRequested = false;
          }
        }
        if (status)
          status.textContent = printerAvailable
            ? "Dispositivo disponible"
            : "No hay dispositivo conectado";
      } catch {
        printerAvailable = false;
      } finally {
        printerCheckBusy = false;
      }
    };
    void updatePrinterStatus();
    printerStatusTimer = window.setInterval(updatePrinterStatus, 1000);
    d.addEventListener("close", () => {
      if (printerStatusTimer) window.clearInterval(printerStatusTimer);
      d.remove();
    });
  }

  function showPrinterResultDialog({ title, message, success = false }) {
    const dialog = document.createElement("dialog");
    dialog.className = "printer-result-dialog";
    dialog.setAttribute("aria-labelledby", "printer-result-title");
    dialog.setAttribute("aria-describedby", "printer-result-message");

    const content = document.createElement("div");
    content.className = "printer-result-dialog__content";
    const icon = document.createElement("div");
    icon.className = `printer-result-dialog__icon${success ? " is-success" : " is-error"}`;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = success ? "✓" : "!";
    const heading = document.createElement("h2");
    heading.id = "printer-result-title";
    heading.textContent = title;
    const description = document.createElement("p");
    description.id = "printer-result-message";
    description.textContent = message;
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "btn primary printer-result-dialog__accept";
    accept.textContent = "Aceptar";

    content.append(icon, heading, description, accept);
    dialog.append(content);
    document.body.append(dialog);

    const dismiss = () => {
      if (dialog.open) dialog.close();
    };
    accept.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) event.preventDefault();
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    accept.focus();
  }

  async function printTicket(orderId, { paymentJustRegistered = false } = {}) {
    const unavailableMessage = "No tienes dispositivos que puedan procesar esta solicitud.";
    const notify = (message) => showPrinterResultDialog({
      title: paymentJustRegistered ? "Pago registrado · impresión no disponible" : "Impresión no disponible",
      message: paymentJustRegistered
        ? `El pago se registró correctamente, pero ${message.charAt(0).toLowerCase()}${message.slice(1)}`
        : message,
    });
    try {
      // La disponibilidad se consulta primero aquí y se vuelve a validar al encolar.
      const { data: available, error: availabilityError } = await supabase.rpc("get_my_printer_status");
      if (availabilityError || available !== true) {
        notify(unavailableMessage);
        return false;
      }

      const [{ data: order, error: orderError }, { data: location, error: locationError }, { data: items, error: itemsError }] = await Promise.all([
        supabase.from("orders").select("*").eq("id", orderId).single(),
        supabase.from("orders").select("location_id, locations(name)").eq("id", orderId).single(),
        supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at"),
      ]);
      if (orderError) throw orderError;
      if (locationError) throw locationError;
      if (itemsError) throw itemsError;
      const itemIds = (items || []).map((item) => item.id);
      let addons = [];
      if (itemIds.length) {
        const { data, error } = await supabase
          .from("order_item_addons")
          .select("order_item_id, addon_name_snapshot, quantity, unit_price, line_total")
          .in("order_item_id", itemIds);
        if (error) throw error;
        addons = data || [];
      }
      const payload = {
        schema_version: 1,
        order: {
          id: order.id,
          paid_at: order.paid_at,
          location: location?.locations?.name || "Sede",
          operator: order.operator_name_snapshot,
          note: order.note,
          status: order.status,
          total: order.total,
          amount_yape: order.amount_yape,
          amount_cash: order.amount_cash,
        },
        items: (items || []).map((item) => ({
          name: item.product_name_snapshot,
          variant: item.variant_name_snapshot,
          kind: item.line_kind,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
          amount_yape: item.amount_yape,
          amount_cash: item.amount_cash,
          concept: item.concept,
          addons: addons
            .filter((addon) => addon.order_item_id === item.id)
            .map(({ addon_name_snapshot, quantity, unit_price, line_total }) => ({
              name: addon_name_snapshot,
              quantity,
              unit_price,
              line_total,
            })),
        })),
      };
      const { data: requestId, error: enqueueError } = await supabase.rpc("create_print_request", {
        p_paid_order_id: orderId,
        p_payload: payload,
      });
      if (enqueueError) {
        if (/No printer device available/i.test(enqueueError.message || "")) {
          notify(unavailableMessage);
          return false;
        }
        throw enqueueError;
      }
      toast(paymentJustRegistered
        ? "Pago registrado correctamente. En breve se imprimirá el comprobante."
        : "Solicitud de impresión enviada.");

      while (true) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const { data: printerAlive, error: printerError } = await supabase.rpc("get_my_printer_status");
        if (printerError) continue;
        const { data: result, error: statusError } = await supabase.rpc("get_print_request_status", {
          p_request_id: requestId,
        });
        if (statusError) continue;
        const status = Array.isArray(result) ? result[0] : result;
        if (printerAlive !== true && status?.status === "pending") continue;
        if (status?.status === "succeeded" || status?.status === "failed") {
          const succeeded = status.status === "succeeded";
          showPrinterResultDialog({
            title: succeeded ? "Solicitud de impresión completada" : "No se pudo imprimir",
            message: succeeded
              ? "La impresora recibió el comprobante. Verifica que haya salido el papel."
              : `${paymentJustRegistered ? "El pago se registró correctamente, pero no se pudo imprimir el comprobante" : "No se pudo imprimir el comprobante"}${status.result_message ? `: ${status.result_message}` : "."}`,
            success: succeeded,
          });
          const { error: deleteError } = await supabase.rpc("delete_print_request", {
            p_request_id: requestId,
          });
          if (deleteError) console.error("No se pudo limpiar la solicitud de impresión", deleteError);
          return status.status === "succeeded";
        }
      }
    } catch (error) {
      const details = error?.message || "No se pudo iniciar la solicitud de impresión.";
      showPrinterResultDialog({
        title: paymentJustRegistered ? "Pago registrado · impresión fallida" : "Error de impresión",
        message: paymentJustRegistered
          ? `El pago se registró correctamente, pero ocurrió un error al imprimir: ${details}`
          : details,
      });
      return false;
    }
  }

  // Convierte las líneas del pedido al formato de la función RPC.
  function toRpcItems(items) {
    return items.map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: Number(item.quantity || 1),
      addons: (item.addons || []).map((x) => ({
        addon_id: x.addon_id,
        quantity: Number(x.quantity || 1),
      })),
      manual_amount: item.manual_amount,
      payment_method: item.payment_method,
      concept: item.concept,
    }));
  }

  // Publica el borrador actual como un pedido abierto.
  async function publishDraft() {
    if (!data.activeDraft || !data.activeDraft.items.length) {
      toast("Agrega al menos un producto antes de registrar el pedido.");
      return;
    }
    const { data: id, error } = await supabase.rpc("create_open_order", {
      p_location_id: data.activeDraft.location_id || currentLocationId(),
      p_note: data.activeDraft.note || null,
      p_items: toRpcItems(data.activeDraft.items),
    });
    if (error) {
      toast(error.message || "No se pudo publicar el pedido.");
      return;
    }
    data.activeOpen = {
      id,
      location_id: data.activeDraft.location_id || currentLocationId(),
      note: data.activeDraft.note || "",
      items: toRpcItems(data.activeDraft.items),
      revision: 1,
      operator_name: state.user,
    };
    data.activeDraft = null;
    await refreshOpenOrders(false);
    render();
    toast("Pedido publicado para el equipo.");
  }

  // Guarda los cambios del pedido abierto cuando corresponde.
  async function persistIfOpen() {
    if (!data.activeOpen || !supabase) return;
    if (data.saveBusy) {
      data.saveQueued = true;
      return;
    }
    data.saveBusy = true;
    try {
      do {
        data.saveQueued = false;
        const current = data.activeOpen;
        if (!current) break;
        const { data: revision, error } = await supabase.rpc(
          "update_open_order",
          {
            p_order_id: current.id,
            p_expected_revision: current.revision,
            p_note: current.note || null,
            p_items: toRpcItems(current.items),
          },
        );
        if (error) {
          toast(
            error.code === "40001"
              ? "Otra persona modificó este pedido; se cargará la versión más reciente."
              : error.message || "No se pudo guardar el pedido compartido.",
          );
          await refreshActiveOpenOrder(false);
          break;
        }
        current.revision = Number(revision);
      } while (data.saveQueued);
    } finally {
      data.saveBusy = false;
    }
    render();
  }

  // Abre y carga un pedido existente.
  async function openOrder(id) {
    if (data.activeDraft) {
      toast(
        "No puedes abrir otro pedido hasta publicar o cancelar el borrador actual.",
      );
      return;
    }
    if (data.activeOpen?.id === id) {
      data.activeOpen = null;
      render();
      return;
    }
    const order = data.openOrders.find((x) => x.order_id === id);
    if (!order) return;
    data.activeOpen = {
      id: order.order_id,
      location_id: order.location_id,
      note: order.note || "",
      items: order.items || [],
      revision: order.revision,
      operator_name: order.operator_name,
    };
    data.orderLocationId = order.location_id;
    data.openFilterLocationId = isAdmin()
      ? data.openFilterLocationId
      : order.location_id;
    render();
  }

  // Modifica la cantidad o elimina una línea del pedido.
  function alterLine(index, action) {
    const order = activeOrder();
    if (!order) return;
    const item = order.items[index];
    if (!item) return;
    if (action === "inc") item.quantity = Number(item.quantity || 1) + 1;
    if (action === "dec") {
      item.quantity = Number(item.quantity || 1) - 1;
      if (item.quantity < 1) order.items.splice(index, 1);
    }
    if (action === "remove") order.items.splice(index, 1);
    render();
    persistIfOpen();
  }

  // Cancela el borrador de pedido actual.
  async function cancelDraft() {
    if (!data.activeDraft) return;
    if (
      !(await confirmInApp(
        "Cancelar borrador",
        "Se perderán los cambios de este pedido.",
        "Cancelar borrador",
      ))
    )
      return;
    data.activeDraft = null;
    render();
  }

  // Cancela el pedido abierto actual.
  async function cancelOpenOrder() {
    if (!data.activeOpen) return;
    if (
      !(await confirmInApp(
        "Cancelar pedido abierto",
        "Este pedido dejará de estar disponible para todo el equipo.",
        "Cancelar pedido",
      ))
    )
      return;
    const { error } = await supabase.rpc("cancel_open_order", {
      p_order_id: data.activeOpen.id,
    });
    if (error) {
      toast(error.message || "No se pudo cancelar el pedido.");
      return;
    }
    data.activeOpen = null;
    await refreshOpenOrders(false);
    render();
    toast("Pedido cancelado.");
  }

  // Genera la vista de administración del catálogo.
  function renderCatalog() {
    if (!data.loaded && data.loading)
      return '<section class="page-head"><div><div class="eyebrow">Administración</div><h1>Catálogo</h1></div></section><div class="panel"><div class="empty">Cargando catálogo…</div></div>';
    if (data.error && !data.loaded)
      return `<section class="page-head"><div><div class="eyebrow">Administración</div><h1>Catálogo</h1></div></section><div class="panel"><div class="empty">${esc(data.error)}</div></div>`;
    const tabs = [
      ["products", "Productos"],
      ["categories", "Categorías"],
      ["tags", "Etiquetas"],
      ["addons", "Agregados"],
      ["print-format", "Formato de ticket"],
    ];
    let body = "";
    if (data.catalogTab === "products") {
      const products = ranked(
        data.products.filter((p) => p.product_kind === "standard"),
        data.productQuery,
      );
      body = `<div class="panel-head"><div class="panel-title">Productos</div><input class="search catalog-search" id="product-admin-search" placeholder="Buscar producto" value="${esc(data.productQuery)}"><button class="btn primary" data-new-product>＋ Crear producto</button></div><div class="catalog-list">${products.map((p) => `<div class="catalog-row"><div><strong>${esc(p.name)}</strong><div class="meta">${p.is_active ? "Activo" : "Inactivo"} · ${variantsForEditor(p.id).length} variantes</div></div><div class="catalog-actions"><button class="rowaction" data-edit-product="${esc(p.id)}">Editar</button><button class="rowaction danger-action" data-toggle-product="${esc(p.id)}">${p.is_active ? "Desactivar" : "Activar"}</button><button class="rowaction danger-action" data-delete-product="${esc(p.id)}">Eliminar</button></div></div>`).join("") || '<div class="empty">No hay productos.</div>'}</div>`;
    } else if (data.catalogTab === "categories") {
      const list = ranked(data.categories, data.categoryQuery);
      body = `<div class="panel-head"><div class="panel-title">Categorías</div><input class="search catalog-search" id="category-admin-search" placeholder="Buscar categoría" value="${esc(data.categoryQuery)}"><button class="btn primary" data-new-category>＋ Crear categoría</button></div><div class="catalog-list">${list.map((x) => `<div class="catalog-row"><div><strong>${esc(x.name)}</strong><div class="meta">${data.groups.includes(x.id) ? "Grupo de categorías" : "Categoría"} · ${productCatsByCategory(x.id).length} productos</div></div><div class="catalog-actions"><button class="rowaction" data-edit-category="${esc(x.id)}">Editar</button><button class="rowaction danger-action" data-delete-category="${esc(x.id)}">Eliminar</button></div></div>`).join("") || '<div class="empty">No hay categorías.</div>'}</div>`;
    } else if (data.catalogTab === "tags") {
      const list = ranked(data.tags, data.tagQuery);
      body = `<div class="panel-head"><div class="panel-title">Etiquetas</div><input class="search catalog-search" id="tag-admin-search" placeholder="Buscar etiqueta" value="${esc(data.tagQuery)}"><button class="btn primary" data-new-tag>＋ Crear etiqueta</button></div><div class="catalog-list">${list.map((x) => `<div class="catalog-row"><div><strong>${esc(x.name)}</strong><div class="meta">${data.productTags.filter((p) => p.tag_id === x.id).length} productos</div></div><div class="catalog-actions"><button class="rowaction" data-edit-tag="${esc(x.id)}">Editar</button><button class="rowaction danger-action" data-delete-tag="${esc(x.id)}">Eliminar</button></div></div>`).join("") || '<div class="empty">No hay etiquetas.</div>'}</div>`;
    } else if (data.catalogTab === "addons") {
      const list = ranked(data.addons, data.addonQuery);
      body = `<div class="panel-head"><div class="panel-title">Agregados</div><input class="search catalog-search" id="addon-admin-search" placeholder="Buscar agregado" value="${esc(data.addonQuery)}"><button class="btn primary" data-new-addon-global>＋ Crear agregado</button></div><div class="catalog-list">${list.map((x) => `<div class="catalog-row"><div><strong>${esc(x.name)}</strong><div class="meta">${money(x.price)} · ${x.is_active ? `${data.productAddons.filter((p) => p.addon_id === x.id).length} productos` : "Archivado"}</div></div><div class="catalog-actions"><button class="rowaction" data-edit-addon="${esc(x.id)}">Editar</button><button class="rowaction danger-action" data-delete-addon="${esc(x.id)}">${x.is_active ? "Eliminar" : "Eliminar definitivamente"}</button></div></div>`).join("") || '<div class="empty">No hay agregados.</div>'}</div>`;
    } else {
      body = `<div class="panel-head"><div><div class="panel-title">Formato de ticket</div><div class="meta">Carga un archivo JSON para definir encabezado, pie y parámetros de impresión.</div></div><label class="btn primary" for="print-format-file">Subir formato</label><input id="print-format-file" type="file" accept="application/json,.json" hidden></div><div class="catalog-list"><div class="catalog-row"><div><strong>Formato de comprobante</strong><div class="meta">Se guarda en Supabase y los teléfonos lo consultan antes de imprimir.</div></div><button type="button" class="rowaction" data-download-print-format>Descargar ejemplo</button></div></div><p class="meta">Campos del prototipo: header, footer, paper_width (384), feed_px y density (1 a 7).</p>`;
    }
    return `<section class="page-head"><div><div class="eyebrow">Administración</div><h1>Administrar catálogo</h1><p class="desc">Gestiona productos, categorías, etiquetas, variantes y agregados compartidos.</p></div></section><div class="catalog-tabs">${tabs.map(([id, label]) => `<button class="catalog-tab ${data.catalogTab === id ? "active" : ""}" data-catalog-tab="${id}">${label}</button>`).join("")}</div><section class="panel catalog-panel">${body}</section>`;
  }

  // Obtiene los productos relacionados con una categoría.
  function productCatsByCategory(categoryId) {
    return data.productCategories
      .filter((x) => x.category_id === categoryId)
      .map((x) => x.product_id);
  }

  // Sincroniza una relación de muchos a muchos con sus identificadores.
  function syncRelation(table, key, ownerId, ids, ownerKey) {
    return supabase
      .from(table)
      .delete()
      .eq(ownerKey, ownerId)
      .then(async ({ error }) => {
        if (error || !ids.length) return { error };
        return supabase
          .from(table)
          .insert(ids.map((id) => ({ [ownerKey]: ownerId, [key]: id })));
      });
  }

  // Confirma la eliminación de una variante.
  function confirmVariantDelete(variant) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "password-dialog entity-dialog";
      dialog.innerHTML = `<div class="panel-title">Eliminar variante</div><p>¿Quieres eliminar <strong>${esc(variant.name)}</strong> de este producto?</p><p class="meta">Esta acción no se puede deshacer.</p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="button" class="btn primary danger-button" data-confirm>Eliminar variante</button></div>`;
      let confirmed = false;
      dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
      dialog.querySelector("[data-confirm]").onclick = () => {
        confirmed = true;
        dialog.close();
      };
      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          resolve(confirmed);
        },
        { once: true },
      );
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  // Abre el editor para crear o modificar un producto.
  function openProductEditor(product = null) {
    if (product && product.product_kind !== "standard") return;
    const original = product || {
      id: "",
      name: "",
      description: "",
      category_id: null,
      product_kind: "standard",
      is_active: true,
    };
    const editor = {
      product: original,
      categoryIds: product ? productCats(product.id) : [],
      tagIds: product ? productTags(product.id) : [],
      addonIds: product ? productAddonIds(product.id) : [],
      newAddons: [],
      variants: product
        ? variantsForEditor(product.id).map((v) => ({
            ...v,
            locations: data.variantLocations
              .filter((x) => x.variant_id === v.id && x.is_available)
              .map((x) => x.location_id),
          }))
        : [],
      busy: false,
    };
    const d = document.createElement("dialog");
    d.className = "password-dialog catalog-editor";
    const openVariantDialog = (variant = null) => {
      const v = variant || {
        name: "",
        price: "",
        is_active: true,
        locations: data.locations.map((x) => x.id),
      };
      const modal = document.createElement("dialog");
      modal.className = "password-dialog catalog-editor entity-dialog";
      modal.innerHTML = `<form method="dialog"><div class="panel-title">${variant ? "Editar variante" : "Nueva variante"}</div><label class="dialog-label">Nombre<input name="name" maxlength="100" required value="${esc(v.name)}"></label><label class="dialog-label">Precio (S/)<input name="price" type="number" min="0" step="any" required placeholder="0.00" value="${esc(v.price)}"></label><div class="dialog-label">Disponible en sedes<div class="check-list">${data.locations.map((l) => `<label><input type="checkbox" name="location" value="${esc(l.id)}" ${v.locations.includes(l.id) ? "checked" : ""}> ${esc(l.name)}</label>`).join("")}</div></div><p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="submit" class="btn primary">Guardar variante</button></div></form>`;
      modal.querySelector("[data-cancel]").onclick = () => modal.close();
      modal.querySelector("form").onsubmit = (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget),
          name = String(f.get("name") || "").trim(),
          price = Number(f.get("price"));
        if (!name || !Number.isFinite(price) || price < 0) {
          modal.querySelector(".password-error").textContent =
            "Revisa el nombre y el precio.";
          return;
        }
        if ((!variant || Number(variant.price) !== price) && !isTenthSol(f.get("price"))) {
          window.alert(tenthSolValidationMessage);
          return;
        }
        const next = {
          ...v,
          id: variant?.id || `new-${crypto.randomUUID()}`,
          name,
          price,
          locations: f.getAll("location"),
        };
        if (!next.locations.length) {
          modal.querySelector(".password-error").textContent =
            "Selecciona al menos una sede.";
          return;
        }
        if (variant) Object.assign(variant, next);
        else editor.variants.push(next);
        modal.close();
        draw();
      };
      document.body.appendChild(modal);
      modal.showModal();
      modal.addEventListener("close", () => modal.remove());
    };
    const openAddonForm = (addon = null, onSave = null) => {
      const modal = document.createElement("dialog");
      modal.className = "password-dialog entity-dialog";
      modal.innerHTML = `<form method="dialog"><div class="panel-title">${addon ? "Editar agregado" : "Crear agregado"}</div><label class="dialog-label">Nombre<input name="name" maxlength="100" required value="${esc(addon?.name || "")}"></label><label class="dialog-label">Precio (S/)<input name="price" type="number" min="0" step="any" required placeholder="0.00" value="${esc(addon?.price ?? "")}"></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="submit" class="btn primary">${addon ? "Guardar cambios" : "Crear agregado"}</button></div></form>`;
      modal.querySelector("[data-cancel]").onclick = () => modal.close();
      modal.querySelector("form").onsubmit = async (event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget),
          name = String(f.get("name") || "").trim(),
          price = Number(f.get("price")),
          err = modal.querySelector(".password-error");
        if (!name || !Number.isFinite(price) || price < 0) {
          err.textContent = "Revisa el nombre y el precio.";
          return;
        }
        if ((!addon || Number(addon.price) !== price) && !isTenthSol(f.get("price"))) {
          window.alert(tenthSolValidationMessage);
          return;
        }
        const submit = modal.querySelector("button[type=submit]");
        submit.disabled = true;
        if (onSave && !addon) {
          const created = {
            id: `new-addon-${crypto.randomUUID()}`,
            name,
            price,
            is_active: true,
          };
          modal.close();
          onSave(created);
          return;
        }
        const result = addon
          ? await supabase
              .from("addons")
              .update({ name, price })
              .eq("id", addon.id)
              .select("id,name,price,is_active")
              .single()
          : await supabase
              .from("addons")
              .insert({ name, price, is_active: true })
              .select("id,name,price,is_active")
              .single();
        if (result.error) {
          submit.disabled = false;
          err.textContent =
            result.error.message || "No se pudo guardar el agregado.";
          return;
        }
        modal.close();
        if (onSave) onSave(result.data);
        else {
          await loadCatalog();
          toast(addon ? "Agregado actualizado." : "Agregado creado.");
        }
      };
      document.body.appendChild(modal);
      modal.showModal();
      modal.addEventListener("close", () => modal.remove());
    };
    const openAddonPicker = () => {
      const modal = document.createElement("dialog");
      modal.className = "password-dialog picker-dialog";
      const drawPicker = (query = "") => {
        const available = ranked(
          data.addons.filter(
            (x) => x.is_active && !editor.addonIds.includes(x.id),
          ),
          query,
        );
        modal.innerHTML = `<div class="panel-title">Agregar a este producto</div><p class="meta">Los agregados se comparten entre sedes.</p><input class="search catalog-search" data-addon-picker-search placeholder="Buscar agregado" value="${esc(query)}"><div class="picker-list">${available.map((x) => `<button type="button" class="picker-option" data-pick-addon="${esc(x.id)}"><span><strong>${esc(x.name)}</strong><strong>${money(x.price)}</strong></span></button>`).join("") || '<div class="empty">No hay agregados disponibles para asignar.</div>'}</div><p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="button" class="btn secondary" data-create-addon>Crear nuevo</button><button type="button" class="btn primary" data-assign-addon disabled>Asignar agregado</button></div>`;
        let selected = "";
        modal.querySelectorAll("[data-pick-addon]").forEach(
          (b) =>
            (b.onclick = () => {
              selected = b.dataset.pickAddon;
              modal
                .querySelectorAll("[data-pick-addon]")
                .forEach((x) => x.classList.toggle("selected", x === b));
              modal.querySelector("[data-assign-addon]").disabled = false;
            }),
        );
        modal.querySelector("[data-addon-picker-search]").oninput = (e) => {
          const val = e.target.value;
          drawPicker(val);
        };
        modal.querySelector("[data-cancel]").onclick = () => modal.close();
        modal.querySelector("[data-assign-addon]").onclick = () => {
          if (selected) {
            editor.addonIds.push(selected);
            modal.close();
            draw();
          }
        };
        modal.querySelector("[data-create-addon]").onclick = () => {
          modal.close();
          openAddonForm(null, (created) => {
            editor.newAddons.push(created);
            editor.addonIds.push(created.id);
            data.addons.push(created);
            draw();
          });
        };
      };
      drawPicker();
      document.body.appendChild(modal);
      modal.showModal();
      modal.addEventListener("close", () => modal.remove());
    };
    const draw = () => {
      const previousForm = d.querySelector("form");
      if (previousForm) {
        const previousValues = new FormData(previousForm);
        editor.product = {
          ...editor.product,
          name: String(previousValues.get("name") || ""),
          description: String(previousValues.get("description") || ""),
        };
        editor.categoryIds = previousValues.getAll("category");
        editor.tagIds = previousValues.getAll("tag");
      }
      const variants = [...editor.variants].sort((a, b) =>
        a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
      );
      d.innerHTML = `<form method="dialog"><div class="panel-title">${product ? "Editar producto" : "Crear producto"}</div>
        <label class="dialog-label">Nombre<input name="name" maxlength="120" required value="${esc(editor.product.name)}"></label>
        <label class="dialog-label">Descripción<input name="description" maxlength="300" value="${esc(editor.product.description || "")}"></label>
        <label class="dialog-label">Categorías<div class="check-list">${data.categories.map((x) => `<label><input type="checkbox" name="category" value="${esc(x.id)}" ${editor.categoryIds.includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`).join("") || '<span class="meta">Aún no hay categorías.</span>'}</div></label>
        <label class="dialog-label">Etiquetas<div class="check-list">${data.tags.map((x) => `<label><input type="checkbox" name="tag" value="${esc(x.id)}" ${editor.tagIds.includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`).join("") || '<span class="meta">Aún no hay etiquetas.</span>'}</div></label>
        <div class="editor-section"><div class="editor-heading"><strong>Variantes</strong><button type="button" class="rowaction" data-add-variant>＋ Agregar variante</button></div><div class="variant-editor-list">${
          variants
            .map(
              (v) =>
                `<div class="variant-editor-row"><div><strong>${esc(v.name)}</strong><span class="meta">${money(v.price)} · ${v.is_active ? "Activa" : "Inactiva"}</span><span class="meta">Sedes: ${
                  v.locations
                    .map((id) => esc(byId(data.locations, id)?.name || ""))
                    .filter(Boolean)
                    .join(", ") || "ninguna"
                }</span></div><div><button type="button" class="rowaction" data-edit-variant="${esc(v.id)}">Editar</button><button type="button" class="rowaction danger-action" data-remove-variant="${esc(v.id)}">${v.is_active ? "Desactivar" : "Activar"}</button><button type="button" class="rowaction danger-action" data-delete-variant="${esc(v.id)}">Eliminar</button></div></div>`,
            )
            .join("") ||
          '<div class="empty">Agrega al menos una variante.</div>'
        }</div></div>
        <div class="editor-section"><div class="editor-heading"><strong>Agregados permitidos</strong><button type="button" class="rowaction" data-new-addon>＋ Agregar agregado</button></div><div class="product-addon-list">${
          editor.addonIds
            .map((id) => byId(data.addons, id))
            .filter(Boolean)
            .map(
              (x) =>
                `<div class="product-addon-row"><span><strong>${esc(x.name)}</strong><small>${money(x.price)}</small></span><button type="button" class="rowaction danger-action" data-unassign-addon="${esc(x.id)}">Quitar</button><input type="hidden" name="addon" value="${esc(x.id)}"></div>`,
            )
            .join("") ||
          '<div class="empty">Este producto aún no tiene agregados permitidos.</div>'
        }</div></div>
        <p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel-editor>Cancelar</button><button type="submit" class="btn primary" ${editor.busy ? "disabled" : ""}>Guardar producto</button></div></form>`;
      d.querySelector("[data-cancel-editor]").onclick = () => d.close();
      d.querySelector("[data-add-variant]").onclick = () => openVariantDialog();
      d.querySelectorAll("[data-edit-variant]").forEach(
        (b) =>
          (b.onclick = () => {
            const v = editor.variants.find(
              (x) => x.id === b.dataset.editVariant,
            );
            if (!v) return;
            openVariantDialog(v);
          }),
      );
      d.querySelectorAll("[data-remove-variant]").forEach(
        (b) =>
          (b.onclick = async () => {
            const v = editor.variants.find(
              (x) => x.id === b.dataset.removeVariant,
            );
            if (!v) return;
            if (v.is_active && !v.id.startsWith("new-")) {
              const { data: pending, error } = await supabase
                .from("open_orders")
                .select("id")
                .eq("status", "open")
                .contains("items", [{ variant_id: v.id }])
                .limit(1);
              if (error) {
                toast(
                  error.message ||
                    "No se pudo comprobar si la variante está en un pedido abierto.",
                );
                return;
              }
              if (pending?.length) {
                toast(
                  "No se puede desactivar: la variante aparece en un pedido abierto.",
                );
                return;
              }
            }
            v.is_active = !v.is_active;
            draw();
          }),
      );
      d.querySelectorAll("[data-delete-variant]").forEach(
        (b) =>
          (b.onclick = async () => {
            const v = editor.variants.find(
              (x) => x.id === b.dataset.deleteVariant,
            );
            if (!v || !(await confirmVariantDelete(v))) return;
            if (v.id.startsWith("new-")) {
              editor.variants = editor.variants.filter((x) => x !== v);
              draw();
              return;
            }
            const { data: pending, error: pendingError } = await supabase
              .from("open_orders")
              .select("id")
              .eq("status", "open")
              .contains("items", [{ variant_id: v.id }])
              .limit(1);
            if (pendingError) {
              toast(
                pendingError.message ||
                  "No se pudo comprobar si hay pedidos abiertos.",
              );
              return;
            }
            if (pending?.length) {
              toast(
                "No se puede eliminar: la variante aparece en un pedido abierto.",
              );
              return;
            }
            const { data: linked, error: lookupError } = await supabase
              .from("order_items")
              .select("id")
              .eq("variant_id", v.id)
              .limit(1);
            if (lookupError) {
              toast(
                lookupError.message || "No se pudo comprobar el historial.",
              );
              return;
            }
            if (linked?.length) {
              toast(
                "Esta variante ya tiene historial; desactívala para conservar los pedidos.",
              );
              return;
            }
            const { error } = await supabase
              .from("variants")
              .delete()
              .eq("id", v.id);
            if (error) {
              toast(error.message || "No se pudo eliminar la variante.");
              return;
            }
            editor.variants = editor.variants.filter((x) => x.id !== v.id);
            data.variantLocations = data.variantLocations.filter(
              (x) => x.variant_id !== v.id,
            );
            draw();
          }),
      );
      d.querySelector("[data-new-addon]").onclick = openAddonPicker;
      d.querySelectorAll("[data-unassign-addon]").forEach(
        (b) =>
          (b.onclick = () => {
            const id = b.dataset.unassignAddon;
            editor.addonIds = editor.addonIds.filter((x) => x !== id);
            if (id.startsWith("new-addon-")) {
              editor.newAddons = editor.newAddons.filter((x) => x.id !== id);
              data.addons = data.addons.filter((x) => x.id !== id);
            }
            draw();
          }),
      );
      d.querySelector("form").onsubmit = async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const errorBox = d.querySelector(".password-error");
        const name = String(values.get("name") || "").trim();
        if (!name) {
          errorBox.textContent = "Escribe el nombre del producto.";
          return;
        }
        if (
          editor.product.product_kind === "standard" &&
          !editor.variants.length
        ) {
          errorBox.textContent = "Agrega al menos una variante.";
          return;
        }
        const categoryIds = values.getAll("category");
        const tagIds = values.getAll("tag");
        let addonIds = values.getAll("addon");
        editor.busy = true;
        d.querySelector("button[type=submit]").disabled = true;
        try {
          const firstCategory = categoryIds[0] || null;
          let savedProduct;
          if (product) {
            const { data: updated, error } = await supabase
              .from("products")
              .update({
                name,
                description:
                  String(values.get("description") || "").trim() || null,
                category_id: firstCategory,
              })
              .eq("id", product.id)
              .select("id,name,description,category_id,product_kind,is_active")
              .single();
            if (error) throw error;
            savedProduct = updated;
          } else {
            const { data: created, error } = await supabase
              .from("products")
              .insert({
                name,
                description:
                  String(values.get("description") || "").trim() || null,
                category_id: firstCategory,
                product_kind: "standard",
                is_active: false,
              })
              .select("id,name,description,category_id,product_kind,is_active")
              .single();
            if (error) throw error;
            savedProduct = created;
          }
          for (const pendingAddon of editor.newAddons.filter((x) =>
            addonIds.includes(x.id),
          )) {
            const { data: createdAddon, error } = await supabase
              .from("addons")
              .insert({
                name: pendingAddon.name,
                price: pendingAddon.price,
                is_active: true,
              })
              .select("id,name,price,is_active")
              .single();
            if (error) throw error;
            data.addons = data.addons.filter((x) => x.id !== pendingAddon.id);
            data.addons.push(createdAddon);
            addonIds = addonIds.map((id) =>
              id === pendingAddon.id ? createdAddon.id : id,
            );
          }
          const categoriesSync = await syncRelation(
            "product_categories",
            "category_id",
            savedProduct.id,
            categoryIds,
            "product_id",
          );
          if (categoriesSync.error) throw categoriesSync.error;
          const tagsSync = await syncRelation(
            "product_tags",
            "tag_id",
            savedProduct.id,
            tagIds,
            "product_id",
          );
          if (tagsSync.error) throw tagsSync.error;
          const addonsSync = await syncRelation(
            "product_addons",
            "addon_id",
            savedProduct.id,
            addonIds,
            "product_id",
          );
          if (addonsSync.error) throw addonsSync.error;
          for (const variant of editor.variants) {
            let savedVariant;
            if (variant.id.startsWith("new-")) {
              const { data: created, error } = await supabase
                .from("variants")
                .insert({
                  product_id: savedProduct.id,
                  name: variant.name,
                  price: variant.price,
                  is_active: variant.is_active,
                })
                .select("id,product_id,name,price,is_active")
                .single();
              if (error) throw error;
              savedVariant = created;
            } else {
              const { data: updated, error } = await supabase
                .from("variants")
                .update({
                  name: variant.name,
                  price: variant.price,
                  is_active: variant.is_active,
                })
                .eq("id", variant.id)
                .select("id,product_id,name,price,is_active")
                .single();
              if (error) throw error;
              savedVariant = updated;
            }
            const locationRows = data.variantLocations.filter(
              (x) => x.variant_id === savedVariant.id,
            );
            const currentLocations = locationRows.map((x) => x.location_id);
            const toRemove = locationRows
              .filter(
                (x) =>
                  x.is_available && !variant.locations.includes(x.location_id),
              )
              .map((x) => x.location_id);
            if (toRemove.length) {
              const { error } = await supabase
                .from("variant_locations")
                .delete()
                .eq("variant_id", savedVariant.id)
                .in("location_id", toRemove);
              if (error) throw error;
            }
            const toEnable = variant.locations.filter((id) =>
              locationRows.some((x) => x.location_id === id && !x.is_available),
            );
            if (toEnable.length) {
              const { error } = await supabase
                .from("variant_locations")
                .update({ is_available: true })
                .eq("variant_id", savedVariant.id)
                .in("location_id", toEnable);
              if (error) throw error;
            }
            const toAdd = variant.locations.filter(
              (id) => !currentLocations.includes(id),
            );
            if (toAdd.length) {
              const { error } = await supabase
                .from("variant_locations")
                .insert(
                  toAdd.map((location_id) => ({
                    variant_id: savedVariant.id,
                    location_id,
                    is_available: true,
                  })),
                );
              if (error) throw error;
            }
          }
          const { error: activateError } = await supabase
            .from("products")
            .update({ is_active: true })
            .eq("id", savedProduct.id);
          if (activateError) throw activateError;
          d.close();
          await loadCatalog();
          toast(product ? "Producto actualizado." : "Producto creado.");
        } catch (error) {
          editor.busy = false;
          errorBox.textContent =
            error.message || "No se pudo guardar el producto.";
          d.querySelector("button[type=submit]").disabled = false;
        }
      };
    };
    draw();
    document.body.appendChild(d);
    d.showModal();
    d.addEventListener("close", () => {
      const pendingIds = new Set(editor.newAddons.map((x) => x.id));
      data.addons = data.addons.filter((x) => !pendingIds.has(x.id));
      d.remove();
    });
  }

  // Abre el editor para crear o modificar una categoría.
  function openCategoryEditor(category = null) {
    const selected = category ? productCatsByCategory(category.id) : [];
    const d = document.createElement("dialog");
    d.className = "password-dialog catalog-editor";
    d.innerHTML = `<form method="dialog"><div class="panel-title">${category ? "Editar categoría" : "Crear categoría"}</div><label class="dialog-label">Nombre<input name="name" maxlength="100" required value="${esc(category?.name || "")}"></label><label class="dialog-label">Productos (opcional)<div class="check-list">${data.products
      .filter((x) => x.product_kind === "standard")
      .map(
        (x) =>
          `<label><input type="checkbox" name="product" value="${esc(x.id)}" ${selected.includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`,
      )
      .join(
        "",
      )}</div></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`;
    d.querySelector("[data-cancel]").onclick = () => d.close();
    d.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const f = new FormData(event.currentTarget),
        name = String(f.get("name") || "").trim(),
        productIds = f.getAll("product"),
        err = d.querySelector(".password-error");
      if (!name) {
        err.textContent = "Escribe el nombre de la categoría.";
        return;
      }
      let saved;
      if (category) {
        const result = await supabase
          .from("categories")
          .update({ name })
          .eq("id", category.id)
          .select("id,name,sort_order")
          .single();
        if (result.error) {
          err.textContent = result.error.message;
          return;
        }
        saved = result.data;
      } else {
        const result = await supabase
          .from("categories")
          .insert({ name })
          .select("id,name,sort_order")
          .single();
        if (result.error) {
          err.textContent = result.error.message;
          return;
        }
        saved = result.data;
      }
      for (const product of data.products) {
        const has = data.productCategories.some(
            (x) => x.product_id === product.id && x.category_id === saved.id,
          ),
          want = productIds.includes(product.id);
        if (want && !has) {
          const { error } = await supabase
            .from("product_categories")
            .insert({ product_id: product.id, category_id: saved.id });
          if (error) {
            err.textContent = error.message;
            return;
          }
        }
        if (!want && has) {
          const { error } = await supabase
            .from("product_categories")
            .delete()
            .eq("product_id", product.id)
            .eq("category_id", saved.id);
          if (error) {
            err.textContent = error.message;
            return;
          }
        }
      }
      d.close();
      await loadCatalog();
      toast(category ? "Categoría actualizada." : "Categoría creada.");
    };
    document.body.appendChild(d);
    d.showModal();
    d.addEventListener("close", () => d.remove());
  }

  // Abre el editor para crear o modificar una etiqueta.
  function openTagEditor(tag = null) {
    const selected = tag
      ? data.productTags
          .filter((x) => x.tag_id === tag.id)
          .map((x) => x.product_id)
      : [];
    const d = document.createElement("dialog");
    d.className = "password-dialog catalog-editor";
    d.innerHTML = `<form method="dialog"><div class="panel-title">${tag ? "Editar etiqueta" : "Crear etiqueta"}</div><label class="dialog-label">Nombre<input name="name" maxlength="100" required value="${esc(tag?.name || "")}"></label><label class="dialog-label">Productos (opcional)<div class="check-list">${data.products
      .filter((x) => x.product_kind === "standard")
      .map(
        (x) =>
          `<label><input type="checkbox" name="product" value="${esc(x.id)}" ${selected.includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`,
      )
      .join(
        "",
      )}</div></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`;
    d.querySelector("[data-cancel]").onclick = () => d.close();
    d.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const f = new FormData(event.currentTarget),
        name = String(f.get("name") || "").trim(),
        productIds = f.getAll("product"),
        err = d.querySelector(".password-error");
      if (!name) {
        err.textContent = "Escribe el nombre de la etiqueta.";
        return;
      }
      let saved;
      if (tag) {
        const result = await supabase
          .from("tags")
          .update({ name })
          .eq("id", tag.id)
          .select("id,name")
          .single();
        if (result.error) {
          err.textContent = result.error.message;
          return;
        }
        saved = result.data;
      } else {
        const result = await supabase
          .from("tags")
          .insert({ name })
          .select("id,name")
          .single();
        if (result.error) {
          err.textContent = result.error.message;
          return;
        }
        saved = result.data;
      }
      for (const product of data.products) {
        const has = data.productTags.some(
            (x) => x.product_id === product.id && x.tag_id === saved.id,
          ),
          want = productIds.includes(product.id);
        if (want && !has) {
          const { error } = await supabase
            .from("product_tags")
            .insert({ product_id: product.id, tag_id: saved.id });
          if (error) {
            err.textContent = error.message;
            return;
          }
        }
        if (!want && has) {
          const { error } = await supabase
            .from("product_tags")
            .delete()
            .eq("product_id", product.id)
            .eq("tag_id", saved.id);
          if (error) {
            err.textContent = error.message;
            return;
          }
        }
      }
      d.close();
      await loadCatalog();
      toast(tag ? "Etiqueta actualizada." : "Etiqueta creada.");
    };
    document.body.appendChild(d);
    d.showModal();
    d.addEventListener("close", () => d.remove());
  }

  // Abre el administrador de agregados.
  function openAddonManager(addon = null) {
    const selected = addon ? productAddonIdsForAddon(addon.id) : [];
    const d = document.createElement("dialog");
    d.className = "password-dialog catalog-editor";
    d.innerHTML = `<form method="dialog"><div class="panel-title">${addon ? "Editar agregado" : "Crear agregado"}</div><p class="meta">Los agregados son compartidos entre sedes.</p><label class="dialog-label">Nombre<input name="name" maxlength="100" required value="${esc(addon?.name || "")}"></label><label class="dialog-label">Precio (S/)<input name="price" type="number" min="0" step="any" required placeholder="0.00" value="${esc(addon?.price ?? "")}"></label><label class="dialog-label">Productos que lo permiten<div class="check-list">${
      data.products
        .filter((x) => x.product_kind === "standard")
        .map(
          (x) =>
            `<label><input type="checkbox" name="product" value="${esc(x.id)}" ${selected.includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`,
        )
        .join("") || '<span class="meta">Aún no hay productos.</span>'
    }</div></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="submit" class="btn primary">${addon ? "Guardar cambios" : "Crear agregado"}</button></div></form>`;
    d.querySelector("[data-cancel]").onclick = () => d.close();
    d.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const f = new FormData(event.currentTarget),
        name = String(f.get("name") || "").trim(),
        price = Number(f.get("price")),
        products = f.getAll("product"),
        err = d.querySelector(".password-error");
      if (!name || !Number.isFinite(price) || price < 0) {
        err.textContent = "Revisa el nombre y el precio.";
        return;
      }
      if ((!addon || Number(addon.price) !== price) && !isTenthSol(f.get("price"))) {
        window.alert(tenthSolValidationMessage);
        return;
      }
      const submit = d.querySelector("button[type=submit]");
      submit.disabled = true;
      const result = addon
        ? await supabase
            .from("addons")
            .update({ name, price })
            .eq("id", addon.id)
            .select("id,name,price,is_active")
            .single()
        : await supabase
            .from("addons")
            .insert({ name, price, is_active: true })
            .select("id,name,price,is_active")
            .single();
      if (result.error) {
        submit.disabled = false;
        err.textContent =
          result.error.message || "No se pudo guardar el agregado.";
        return;
      }
      const saved = result.data;
      for (const product of data.products.filter(
        (x) => x.product_kind === "standard",
      )) {
        const has = data.productAddons.some(
            (x) => x.product_id === product.id && x.addon_id === saved.id,
          ),
          want = products.includes(product.id);
        if (want && !has) {
          const { error } = await supabase
            .from("product_addons")
            .insert({ product_id: product.id, addon_id: saved.id });
          if (error) {
            err.textContent = error.message;
            submit.disabled = false;
            return;
          }
        }
        if (!want && has) {
          const { error } = await supabase
            .from("product_addons")
            .delete()
            .eq("product_id", product.id)
            .eq("addon_id", saved.id);
          if (error) {
            err.textContent = error.message;
            submit.disabled = false;
            return;
          }
        }
      }
      d.close();
      await loadCatalog();
      toast(addon ? "Agregado actualizado." : "Agregado creado.");
    };
    document.body.appendChild(d);
    d.showModal();
    d.addEventListener("close", () => d.remove());
  }

  // Obtiene los productos relacionados con un agregado.
  function productAddonIdsForAddon(addonId) {
    return data.productAddons
      .filter((x) => x.addon_id === addonId)
      .map((x) => x.product_id);
  }

  // Elimina o archiva un agregado según su historial.
  async function deleteAddon(addon) {
    const { data: history, error: historyError } = await supabase
      .from("order_item_addons")
      .select("order_item_id")
      .eq("addon_id", addon.id)
      .limit(1);
    if (historyError) {
      toast(
        historyError.message ||
          "No se pudo comprobar el historial del agregado.",
      );
      return;
    }
    const { error: unlinkError } = await supabase
      .from("product_addons")
      .delete()
      .eq("addon_id", addon.id);
    if (unlinkError) {
      toast(
        unlinkError.message ||
          "No se pudo retirar el agregado de los productos.",
      );
      return;
    }
    const result = history?.length
      ? await supabase
          .from("addons")
          .update({ is_active: false })
          .eq("id", addon.id)
      : await supabase.from("addons").delete().eq("id", addon.id);
    if (result.error) {
      toast(result.error.message || "No se pudo eliminar el agregado.");
      return;
    }
    await loadCatalog();
    toast(
      history?.length
        ? "Agregado archivado para conservar el historial."
        : "Agregado eliminado.",
    );
  }

  // Conecta un campo de búsqueda con el estado correspondiente.
  function bindSearch(inputId, property) {
    document.getElementById(inputId)?.addEventListener("input", (event) => {
      data[property] = event.target.value;
      const value = event.target.value,
        start = event.target.selectionStart;
      render();
      const next = document.getElementById(inputId);
      if (next) {
        next.focus();
        next.setSelectionRange(start, start);
      }
    });
  }

  // Conecta los eventos de la página activa.
  function bind() {
    if (state.page === "orders") bindOrders();
    if (state.page === "catalog") bindCatalog();
  }

  // Conecta las interacciones de la vista de pedidos.
  function bindOrders() {
    bindSearch("menu-search", "query");
    document.querySelectorAll("[data-product-card]").forEach((card) => {
      card.onclick = (event) => {
        if (event.target.closest("[data-menu-add],[data-menu-edit]")) return;
        const product = byId(data.products, card.dataset.productCard);
        if (!product) return;
        if (
          !activeOrder() &&
          window.matchMedia("(hover: none)").matches &&
          !data.selectedMenuProduct
        ) {
          data.selectedMenuProduct = product.id;
          render();
          return;
        }
        addProductToOrder(product);
      };
      card.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          card.click();
        }
      };
    });
    document.querySelectorAll("[data-menu-add]").forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          const p = byId(data.products, b.dataset.menuAdd);
          if (p) addProductToOrder(p);
        }),
    );
    document.querySelectorAll("[data-menu-edit]").forEach(
      (b) =>
        (b.onclick = (e) => {
          e.stopPropagation();
          const p = byId(data.products, b.dataset.menuEdit);
          if (p && !activeOrder()) openProductEditor(p);
        }),
    );
    document
      .querySelector("[data-add-category]")
      ?.addEventListener("click", chooseCategory);
    document
      .querySelector("[data-add-tag]")
      ?.addEventListener("click", chooseTag);
    document
      .querySelector("[data-remove-group]")
      ?.addEventListener("click", () => {
        data.groupId = "";
        data.categoryAfterGroupId = "";
        render();
      });
    document
      .querySelector("[data-remove-category]")
      ?.addEventListener("click", () => {
        data.categoryId = "";
        render();
      });
    document
      .querySelector("[data-remove-after-category]")
      ?.addEventListener("click", () => {
        data.categoryAfterGroupId = "";
        render();
      });
    document.querySelectorAll("[data-remove-tag]").forEach(
      (b) =>
        (b.onclick = () => {
          data.tagIds = data.tagIds.filter((x) => x !== b.dataset.removeTag);
          render();
        }),
    );
    document.getElementById("new-order")?.addEventListener("click", () => {
      data.activeDraft = {
        location_id: currentLocationId(),
        items: [],
        note: "",
        showNotes: false,
      };
      data.activeOpen = null;
      render();
    });
    document
      .getElementById("publish-order")
      ?.addEventListener("click", publishDraft);
    document
      .getElementById("cancel-draft")
      ?.addEventListener("click", cancelDraft);
    document
      .getElementById("cancel-open-order")
      ?.addEventListener("click", cancelOpenOrder);
    document.getElementById("pay-order")?.addEventListener("click", payDialog);
    document
      .querySelectorAll("[data-line]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            alterLine(Number(b.dataset.index), b.dataset.line)),
      );
    document.querySelectorAll("[data-expand-line]").forEach(
      (b) =>
        (b.onclick = () => {
          const item = activeOrder()?.items[Number(b.dataset.expandLine)];
          if (item) item.expanded = !item.expanded;
          render();
        }),
    );
    document.querySelectorAll("[data-toggle-line]").forEach((row) => {
      const toggle = (event) => {
        if (event.target.closest("button")) return;
        const item = activeOrder()?.items[Number(row.dataset.toggleLine)];
        if (item) {
          item.expanded = !item.expanded;
          render();
        }
      };
      row.onclick = toggle;
      row.onkeydown = (event) => {
        if (
          event.target === row &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          toggle(event);
        }
      };
    });
    document.querySelectorAll("[data-edit-line]").forEach(
      (b) =>
        (b.onclick = () => {
          const index = Number(b.dataset.editLine),
            item = activeOrder()?.items[index],
            product = item && byId(data.products, item.product_id);
          if (!item || !product) return;
          if (item.manual_amount != null) specialDialog(product, index);
          else
            productOptionsDialog(
              product,
              activeVariants(product),
              addonsFor(product.id),
              index,
            );
        }),
    );
    document.querySelectorAll("[data-open]").forEach((b) => {
      b.onclick = () => openOrder(b.dataset.open);
      b.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openOrder(b.dataset.open);
        }
      };
    });
    document
      .getElementById("order-note-button")
      ?.addEventListener("click", notesDialog);
    document
      .getElementById("order-location")
      ?.addEventListener("change", (e) => {
        if (data.activeOpen) {
          toast("No se puede cambiar la sede de un pedido publicado.");
          return;
        }
        data.orderLocationId = e.target.value;
        if (data.activeDraft) data.activeDraft.location_id = e.target.value;
        render();
      });
    document
      .getElementById("open-site-filter")
      ?.addEventListener("change", async (e) => {
        data.openFilterLocationId = e.target.value;
        await refreshOpenOrders();
      });
  }

  // Conecta las interacciones de la vista de catálogo.
  function bindCatalog() {
    bindSearch("product-admin-search", "productQuery");
    bindSearch("category-admin-search", "categoryQuery");
    bindSearch("tag-admin-search", "tagQuery");
    bindSearch("addon-admin-search", "addonQuery");
    document.querySelectorAll("[data-catalog-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          data.catalogTab = b.dataset.catalogTab;
          render();
        }),
    );
    document.querySelector("[data-download-print-format]")?.addEventListener("click", () => {
      const example = { schema_version: 1, header: "BLACK&WHITE POS", footer: "Gracias por tu compra", paper_width: 384, feed_px: 120, density: 3 };
      const url = URL.createObjectURL(new Blob([JSON.stringify(example, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "formato-ticket-black-white.json";
      link.click();
      URL.revokeObjectURL(url);
    });
    document.querySelector("#print-format-file")?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        if (file.size > 16384) throw new Error("El formato debe pesar menos de 16 KB.");
        const format = JSON.parse(await file.text());
        if (format.schema_version !== 1 || typeof format.header !== "string" || format.header.length > 120 || typeof format.footer !== "string" || format.footer.length > 120 || Number(format.paper_width) !== 384 || !Number.isInteger(Number(format.density)) || Number(format.density) < 1 || Number(format.density) > 7 || !Number.isInteger(Number(format.feed_px)) || Number(format.feed_px) < 0 || Number(format.feed_px) > 2000) {
          throw new Error("Formato inválido. Revisa schema_version 1, encabezado, pie, ancho 384, avance y densidad de 1 a 7.");
        }
        const { error } = await supabase.rpc("save_printer_template", { p_format: format });
        if (error) throw error;
        toast("Formato de ticket guardado.");
      } catch (error) {
        toast(error?.message || "No se pudo guardar el formato.");
      } finally {
        event.target.value = "";
      }
    });
    document
      .querySelector("[data-new-product]")
      ?.addEventListener("click", () => openProductEditor());
    document.querySelectorAll("[data-edit-product]").forEach(
      (b) =>
        (b.onclick = () => {
          const p = byId(data.products, b.dataset.editProduct);
          if (p?.product_kind === "standard") openProductEditor(p);
        }),
    );
    document.querySelectorAll("[data-toggle-product]").forEach(
      (b) =>
        (b.onclick = async () => {
          const p = byId(data.products, b.dataset.toggleProduct);
          if (!p) return;
          if (
            !(await confirmInApp(
              p.is_active ? "Desactivar producto" : "Activar producto",
              `${p.name} ${p.is_active ? "dejará de aparecer en el menú" : "volverá a aparecer en el menú"}.`,
              p.is_active ? "Desactivar" : "Activar",
            ))
          )
            return;
          if (p.is_active) {
            const { data: pending, error: pendingError } = await supabase
              .from("open_orders")
              .select("id")
              .eq("status", "open")
              .contains("items", [{ product_id: p.id }])
              .limit(1);
            if (pendingError) {
              toast(
                pendingError.message ||
                  "No se pudo comprobar si hay pedidos abiertos.",
              );
              return;
            }
            if (pending?.length) {
              toast(
                "No se puede desactivar: el producto aparece en un pedido abierto.",
              );
              return;
            }
          }
          const { error } = await supabase
            .from("products")
            .update({ is_active: !p.is_active })
            .eq("id", p.id);
          if (error)
            toast(
              error.message || "No se pudo cambiar el estado del producto.",
            );
          else {
            await loadCatalog();
            toast(p.is_active ? "Producto desactivado." : "Producto activado.");
          }
        }),
    );
    document.querySelectorAll("[data-delete-product]").forEach(
      (b) =>
        (b.onclick = async () => {
          const p = byId(data.products, b.dataset.deleteProduct);
          if (
            !p ||
            !(await confirmInApp(
              "Eliminar producto",
              `¿Eliminar ${p.name}? Si tiene pedidos en el historial, tendrás que desactivarlo.`,
              "Eliminar producto",
            ))
          )
            return;
          const { data: pending, error: pendingError } = await supabase
            .from("open_orders")
            .select("id")
            .eq("status", "open")
            .contains("items", [{ product_id: p.id }])
            .limit(1);
          if (pendingError) {
            toast(
              pendingError.message ||
                "No se pudo comprobar si hay pedidos abiertos.",
            );
            return;
          }
          if (pending?.length) {
            toast(
              "No se puede eliminar: el producto aparece en un pedido abierto.",
            );
            return;
          }
          const { data: linked, error: lookupError } = await supabase
            .from("order_items")
            .select("id")
            .eq("product_id", p.id)
            .limit(1);
          if (lookupError) {
            toast(lookupError.message || "No se pudo comprobar el historial.");
            return;
          }
          if (linked?.length) {
            toast(
              "Este producto tiene pedidos históricos; desactívalo para conservarlos.",
            );
            return;
          }
          const variantIds = variantsForEditor(p.id).map((v) => v.id);
          if (variantIds.length) {
            const { error } = await supabase
              .from("variants")
              .delete()
              .in("id", variantIds);
            if (error) {
              toast(error.message || "No se pudieron eliminar las variantes.");
              return;
            }
          }
          const { error } = await supabase
            .from("products")
            .delete()
            .eq("id", p.id);
          if (error) {
            toast(error.message || "No se pudo eliminar el producto.");
            return;
          }
          await loadCatalog();
          toast("Producto eliminado.");
        }),
    );
    document
      .querySelector("[data-new-category]")
      ?.addEventListener("click", () => openCategoryEditor());
    document
      .querySelectorAll("[data-edit-category]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            openCategoryEditor(byId(data.categories, b.dataset.editCategory))),
      );
    document.querySelectorAll("[data-delete-category]").forEach(
      (b) =>
        (b.onclick = async () => {
          const c = byId(data.categories, b.dataset.deleteCategory);
          if (
            !c ||
            !(await confirmInApp(
              "Eliminar categoría",
              `¿Eliminar ${c.name}?`,
              "Eliminar categoría",
            ))
          )
            return;
          const { error } = await supabase
            .from("categories")
            .delete()
            .eq("id", c.id);
          if (error)
            toast(error.message || "No se pudo eliminar la categoría.");
          else {
            await loadCatalog();
            toast("Categoría eliminada.");
          }
        }),
    );
    document
      .querySelector("[data-new-tag]")
      ?.addEventListener("click", () => openTagEditor());
    document
      .querySelectorAll("[data-edit-tag]")
      .forEach(
        (b) =>
          (b.onclick = () => openTagEditor(byId(data.tags, b.dataset.editTag))),
      );
    document.querySelectorAll("[data-delete-tag]").forEach(
      (b) =>
        (b.onclick = async () => {
          const tag = byId(data.tags, b.dataset.deleteTag);
          if (
            !tag ||
            !(await confirmInApp(
              "Eliminar etiqueta",
              `¿Eliminar ${tag.name}?`,
              "Eliminar etiqueta",
            ))
          )
            return;
          const { error } = await supabase
            .from("tags")
            .delete()
            .eq("id", tag.id);
          if (error) toast(error.message || "No se pudo eliminar la etiqueta.");
          else {
            await loadCatalog();
            toast("Etiqueta eliminada.");
          }
        }),
    );
    document
      .querySelector("[data-new-addon-global]")
      ?.addEventListener("click", () => openAddonManager());
    document.querySelectorAll("[data-edit-addon]").forEach(
      (b) =>
        (b.onclick = () => {
          const addon = byId(data.addons, b.dataset.editAddon);
          if (addon) openAddonManager(addon);
        }),
    );
    document.querySelectorAll("[data-delete-addon]").forEach(
      (b) =>
        (b.onclick = () => {
          const addon = byId(data.addons, b.dataset.deleteAddon);
          if (addon) deleteAddon(addon);
        }),
    );
  }

  // Libera los recursos y detiene las tareas periódicas del módulo.
  function cleanup() {
    stopPolling();
  }

  function openPrintFormat() {
    data.catalogTab = "print-format";
    render();
    document.querySelector("#print-format-file")?.click();
  }

  return {
    renderOrders,
    renderCatalog,
    bind,
    enter,
    load: loadCatalog,
    cleanup,
    printTicket,
    openPrintFormat,
  };
}
