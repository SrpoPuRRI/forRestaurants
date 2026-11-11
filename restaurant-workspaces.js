// Workspaces opcionales: CRM demostrativo, Delivery próximamente, KDS y mapa Salón.
export default function createRestaurantWorkspaces({ supabase, state, render, toast, esc, money, navigate, refreshCatalog, hasActiveOrder }) {
  const data = { page: "", loading: false, error: "", floors: [], tables: [], kitchen: [], service: [], settings: {}, floorId: "", editingMap: false, poll: null, press: null, dragging: null, moveHighlightId: "", crmQuery: "", crmTab: "clientes" };
  const needs = () => state.restaurantNeeds || [];
  const has = (need) => needs().includes(need);
  const isAdmin = () => state.roleKey === "admin" || state.role === "Administrador";
  const isEmployee = () => state.roleKey === "employee" || state.role === "Empleado";
  const escText = (value) => esc(String(value ?? ""));
  const formatTime = (value) => value ? new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(value)) : "";

  async function loadSettings() {
    if (!supabase || !state.restaurantId) return;
    const { data: row } = await supabase.from("restaurants").select("kitchen_entry_mode,salon_entry_mode,delivery_kitchen_after_virtual_payment,salon_waiter_map_edit,salon_host_map_edit,salon_show_seats").eq("id", state.restaurantId).maybeSingle();
    data.settings = row || {};
  }
  async function loadSalon() {
    if (!supabase || data.loading) return;
    data.loading = true; data.error = ""; render();
    const [floors, tables, queue] = await Promise.all([
      supabase.from("salon_floors").select("id,name,sort_order,grid_rows,grid_columns,seat_count,row_sizes,column_sizes").order("sort_order"),
      supabase.from("salon_tables").select("id,floor_id,table_number,grid_row,grid_column,row_span,column_span,fusion_group_id,status").order("table_number"),
      supabase.from("salon_service_entries").select("id,kitchen_entry_id,source_order_id,source_order_kind,location_id,table_id,table_label,order_note,items,status,queued_at,delivered_at").eq("status","ready").order("queued_at"),
    ]);
    const failure = floors.error || tables.error || queue.error;
    if (failure) data.error = "No se pudo cargar Salón. Aplica la migración de espacios de trabajo y vuelve a intentarlo.";
    data.floors = floors.data || []; data.tables = tables.data || []; data.service = queue.data || [];
    if (!data.floorId || !data.floors.some((x) => x.id === data.floorId)) data.floorId = data.floors[0]?.id || "";
    data.loading = false; render();
  }
  async function loadKitchen({ prune = false } = {}) {
    if (!supabase || data.loading) return;
    data.loading = true; data.error = ""; render();
    if (prune) {
      const { error: pruneError } = await supabase.rpc("workspace_prune_completed_queues");
      if (pruneError) data.error = "No se pudo depurar la cola de Cocina.";
    }
    const { data: queue, error } = await supabase.from("kitchen_queue_entries").select("id,source_order_id,source_order_kind,location_id,table_label,order_note,items,status,queued_at,completed_at").eq("status","queued").order("queued_at");
    if (error) data.error = "No se pudo cargar Cocina. Aplica la migración de espacios de trabajo y vuelve a intentarlo.";
    data.kitchen = queue || []; data.loading = false; render();
  }
  async function enter(page) {
    data.page = page;
    clearInterval(data.poll); data.poll = null;
    clearTimeout(data.press?.timer);
    clearTimeout(data.press?.menuTimer);
    data.press = null;
    if (page === "salon" || page === "kitchen") {
      await loadSettings();
      if (page === "salon") {
        await loadSalon();
        data.poll = setInterval(loadSalon, 7000);
      } else {
        await loadKitchen({ prune: true });
        data.poll = setInterval(loadKitchen, 7000);
      }
    }
  }
  function cleanup() {
    clearInterval(data.poll);
    data.poll = null;
    clearTimeout(data.press?.timer);
    clearTimeout(data.press?.menuTimer);
    data.press = null;
    data.page = "";
    data.loading = false;
    data.error = "";
    data.floors = [];
    data.tables = [];
    data.kitchen = [];
    data.service = [];
    data.floorId = "";
    data.editingMap = false;
    data.dragging = null;
    data.moveHighlightId = "";
    state.orderTableId = null;
    state.orderTableLabel = "";
  }

  function renderCrm() {
    const rows = [
      ["LM", "Lucía Mendoza", "Frecuente", "12 visitas", "Hoy, 10:42"],
      ["AR", "Andrés Rojas", "Nuevo", "1 visita", "Ayer, 18:16"],
      ["VP", "Valeria Paredes", "VIP", "28 visitas", "Ayer, 13:05"],
      ["CM", "Carlos Medina", "Frecuente", "8 visitas", "10 nov, 09:34"],
    ].filter((row) => row[1].toLowerCase().includes(data.crmQuery.toLowerCase()));
    return `<section class="page-head"><div><div class="eyebrow">Relaciones con clientes · Vista de muestra</div><h1>CRM</h1><p class="desc">Un vistazo a las visitas y preferencias de tus clientes.</p></div><button class="btn primary" type="button" data-crm-demo="campaign">＋ Nueva campaña</button></section><div class="crm-preview-banner"><span class="crm-preview-dot"></span>Prototipo visual · Los datos mostrados son de ejemplo y no se guardan</div><div class="crm-kpis"><article class="panel"><span class="meta">Clientes registrados</span><strong>1,284</strong><span class="crm-kpi-note">+8.4% este mes</span></article><article class="panel"><span class="meta">Clientes recurrentes</span><strong>62%</strong><span class="crm-kpi-note">Visitaron más de una vez</span></article><article class="panel"><span class="meta">Visitas este mes</span><strong>3,816</strong><span class="crm-kpi-note">En todas tus sedes</span></article><article class="panel"><span class="meta">Campañas activas</span><strong>3</strong><span class="crm-kpi-note">Una termina mañana</span></article></div><section class="panel crm-panel"><div class="crm-toolbar"><div class="crm-tabs"><button data-crm-tab="clientes" class="${data.crmTab === "clientes" ? "active" : ""}">Clientes</button><button data-crm-tab="campanas" class="${data.crmTab === "campanas" ? "active" : ""}">Campañas <span>3</span></button><button data-crm-tab="segmentos" class="${data.crmTab === "segmentos" ? "active" : ""}">Segmentos</button></div><input class="search" id="crm-search" placeholder="Buscar cliente" value="${escText(data.crmQuery)}"></div>${data.crmTab === "clientes" ? `<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Cliente</th><th>Segmento</th><th>Visitas</th><th>Última visita</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td><span class="crm-avatar">${r[0]}</span><strong>${r[1]}</strong></td><td><span class="crm-tag ${r[2].toLowerCase()}">${r[2]}</span></td><td>${r[3]}</td><td>${r[4]}</td><td><button class="rowaction" data-crm-demo="profile">Ver perfil</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="crm-campaigns">${(data.crmTab === "campanas" ? [["☕", "Vuelve por tu favorito", "WhatsApp · 128 clientes", "En curso"], ["🎉", "Cumpleaños de noviembre", "WhatsApp · 34 clientes", "Programada"], ["✨", "Novedades de temporada", "Instagram · 420 personas", "En curso"]] : [["Clientes frecuentes", "8 o más visitas en los últimos 60 días", "184 clientes"], ["Hace tiempo que no vienen", "Sin visitas en los últimos 30 días", "96 clientes"], ["Nuevos clientes", "Primera visita en los últimos 14 días", "73 clientes"]]).map((x) => `<article class="crm-campaign-card"><span class="crm-campaign-icon">${x[0]}</span><div><strong>${x[1]}</strong><p class="meta">${x[2]}</p></div><span class="crm-tag">${x[3]}</span></article>`).join("")}</div>`}</section>`;
  }
  function renderDelivery() {
    return `<section class="page-head"><div><div class="eyebrow">Espacio de trabajo</div><h1>Delivery</h1><p class="desc">Pedidos para entregar fuera del restaurante.</p></div></section><section class="panel coming-soon-panel"><div class="coming-soon-mark">↗</div><span class="coming-soon-pill">Próximamente</span><h2>Delivery está en camino</h2><p>Este espacio aparecerá aquí cuando activemos el flujo de entregas. El rol Repartidor está reservado para esta función.</p></section>`;
  }
  function renderKitchen() {
    const cards = data.kitchen.map((entry) => {
      const items = Array.isArray(entry.items) ? entry.items : [];
      return `<article class="panel kitchen-order-card"><header><div><div class="kitchen-order-ref">${entry.table_label ? escText(entry.table_label) : `Pedido ${escText(entry.source_order_id.slice(0, 8))}`}</div><div class="meta">Origen: ${entry.source_order_kind === "open" ? "pedido abierto" : "pedido pagado"} · Ingresó ${formatTime(entry.queued_at)}</div></div><button class="btn primary" data-kitchen-action="order_ready" data-entry="${entry.id}">Dar pedido como listo</button></header>${entry.order_note ? `<p class="kitchen-note">${escText(entry.order_note)}</p>` : ""}<div class="kitchen-items">${items.map((item, index) => {
        const units = Array.isArray(item.units) ? item.units : [];
        const hasPending = units.some((unit) => unit.status === "pending");
        const name = [item.name, item.variant_name].filter(Boolean).join(" · ");
        return `<section class="kitchen-item"><div class="kitchen-item-head"><div><strong>${escText(name)}</strong><span class="meta">${money(item.unit_price || 0)} c/u</span>${(item.addons || []).length ? `<span class="meta">${item.addons.map((addon) => `${addon.quantity || 1} × ${escText(addon.name || "Agregado")}`).join(", ")}</span>` : ""}</div><button class="rowaction" ${hasPending ? "" : "disabled"} data-kitchen-action="item_ready" data-entry="${entry.id}" data-item="${index}">Dar item como listo</button><button class="rowaction danger-action" ${hasPending ? "" : "disabled"} data-kitchen-action="item_out_of_stock" data-entry="${entry.id}" data-item="${index}">Quitar por fuera de stock</button>${item.product_id ? `<button class="rowaction danger-action" data-product-stock="${escText(item.product_id)}">Marcar producto fuera de stock</button>` : ""}</div><div class="kitchen-units">${units.map((unit, unitIndex) => `<button class="kitchen-unit ${unit.status !== "pending" ? `unit-${unit.status}` : ""}" ${unit.status !== "pending" ? "disabled" : ""} data-kitchen-unit="${entry.id}" data-item="${index}" data-unit="${unitIndex}" aria-label="Unidad ${unitIndex + 1}: ${unit.status}">${unit.status === "pending" ? `Unidad ${unitIndex + 1} · Listo` : unit.status === "ready" ? `✓ Lista · ${formatTime(unit.changed_at)}` : `Sin stock · ${formatTime(unit.changed_at)}`}</button><button class="kitchen-unit-stock" ${unit.status !== "pending" ? "disabled" : ""} data-kitchen-stock="${entry.id}" data-item="${index}" data-unit="${unitIndex}">Sin stock</button>`).join("")}</div></section>`;
      }).join("")}</div></article>`;
    }).join("");
    return `<section class="page-head"><div><div class="eyebrow">Espacio de trabajo</div><h1>Cocina</h1><p class="desc">Prepara los pedidos y marca cada artículo cuando esté listo.</p></div></section>${data.error ? `<div class="inline-error" role="alert">${escText(data.error)}</div>` : ""}${data.loading ? '<div class="stats-loading-bar">Actualizando cocina…</div>' : ""}<div class="kitchen-queue-head"><strong>Por preparar <span>${data.kitchen.length}</span></strong><span class="meta">Los pedidos listos se envían a Salón si está activo.</span></div><div class="kitchen-queue">${cards || '<section class="panel empty-panel"><div class="empty">No hay pedidos por preparar.</div></section>'}</div>`;
  }
  function renderSalon() {
    const floor = data.floors.find((x) => x.id === data.floorId);
    const tables = data.tables.filter((x) => x.floor_id === floor?.id);
    const canEdit = isAdmin() || (isEmployee() && (data.settings.salon_waiter_map_edit || data.settings.salon_host_map_edit));
    const grid = floor ? `<div class="salon-map-grid ${data.editingMap ? "is-editing" : ""}" style="--map-cols:${floor.grid_columns};--map-rows:${floor.grid_rows};grid-template-columns:${(floor.column_sizes || Array(floor.grid_columns).fill(1)).map((x)=>`${Number(x)}fr`).join(" ")};grid-template-rows:${(floor.row_sizes || Array(floor.grid_rows).fill(1)).map((x)=>`${Number(x)}fr`).join(" ")}">${tables.map((table) => `<button type="button" class="salon-table ${table.status === "occupied" ? "is-occupied" : ""} ${table.fusion_group_id ? "is-fused" : ""} ${data.dragging === table.id ? "is-dragging" : ""} ${data.moveHighlightId === table.id ? "can-drag" : ""}" aria-label="Mesa ${table.table_number}, ${table.status === "occupied" ? "ocupada" : "libre"}" style="grid-row:${table.grid_row+1}/span ${table.row_span};grid-column:${table.grid_column+1}/span ${table.column_span}" data-table="${table.id}" data-number="${table.table_number}"><span class="salon-table-number">${table.table_number}</span>${data.settings.salon_show_seats && floor.seat_count != null ? '<span class="salon-chair-mark">·</span>' : ""}</button>`).join("")}</div>` : '<div class="empty salon-empty">Aún no hay pisos. Crea el primero para armar el mapa.</div>';
    return `<section class="page-head"><div><div class="eyebrow">Espacio de trabajo</div><h1>Salón</h1><p class="desc">Consulta el mapa de mesas y los pedidos listos para entregar.</p></div><div class="salon-head-actions">${canEdit ? `<button class="btn ${data.editingMap ? "secondary" : "primary"}" id="salon-edit-map"><svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 16.5V20h3.5L19 8.5 15.5 5 4 16.5Z"/><path d="m13.5 7 3.5 3.5M4 20h16"/></svg><span>${data.editingMap ? "Terminar edición" : "Editar mapa"}</span></button>` : ""}${canEdit && data.editingMap ? '<button class="btn secondary" id="salon-new-floor">＋ Piso</button><button class="btn secondary" id="salon-new-table">＋ Mesa</button><button class="btn secondary" id="salon-floor-settings">Ajustar piso</button>' : ""}</div></section>${data.error ? `<div class="inline-error" role="alert">${escText(data.error)}</div>` : ""}<div class="salon-layout"><section class="panel salon-map-panel"><div class="salon-floor-tabs">${data.floors.length > 1 ? data.floors.map((f) => `<button class="${f.id === data.floorId ? "active" : ""}" data-floor="${f.id}">${escText(f.name)}</button>`).join("") : floor ? `<span>${escText(floor.name)}</span>` : ""}<span class="meta">${floor ? `${floor.grid_rows} × ${floor.grid_columns}` : ""}${data.settings.salon_show_seats && floor?.seat_count != null ? ` · ${floor.seat_count} sillas` : ""}</span></div>${grid}<p class="salon-map-help">${data.editingMap ? "Mantén una mesa 3 segundos para moverla; espera 7 segundos para sus opciones." : "Vista del salón · Las mesas se organizan en el restaurante."}</p></section><section class="panel salon-service-panel"><div class="panel-head"><div><div class="panel-title">Listos para entregar</div><div class="meta">${data.service.length} pedidos esperan en Salón</div></div></div><div class="salon-service-list">${data.service.map((entry) => `<article class="salon-service-card"><div class="salon-service-title"><strong>${escText(entry.table_label || `Pedido ${entry.source_order_id.slice(0,8)}`)}</strong><span class="meta">${formatTime(entry.queued_at)}</span></div>${entry.order_note ? `<p>${escText(entry.order_note)}</p>` : ""}<ul>${(entry.items || []).map((item) => {
      const isKitchenOrder = entry.kitchen_entry_id && Array.isArray(item.units);
      const readyCount = isKitchenOrder ? item.units.filter((unit) => unit.status === "ready").length : Number(item.quantity || 0);
      const unavailableCount = isKitchenOrder ? item.units.filter((unit) => unit.status === "out_of_stock").length : 0;
      const name = escText([item.name, item.variant_name].filter(Boolean).join(" · "));
      return `<li>${readyCount > 0 ? `${readyCount} × ${name}` : `Sin unidades disponibles · ${name}`}${unavailableCount > 0 ? ` · ${unavailableCount} sin stock` : ""}</li>`;
    }).join("")}</ul><button class="btn primary" data-salon-delivered="${entry.id}">Marcar como entregado</button></article>`).join("") || '<div class="empty">No hay pedidos esperando entrega.</div>'}</div></section></div>`;
  }
  function render(page = data.page) {
    if (page === "crm") return renderCrm();
    if (page === "delivery") return renderDelivery();
    if (page === "bar") return `<section class="page-head"><div><div class="eyebrow">Espacio de trabajo</div><h1>Barra</h1><p class="desc">Área separada de preparación de bebidas.</p></div></section><section class="panel coming-soon-panel"><div class="coming-soon-mark">◉</div><h2>Barra separada</h2><p>El espacio está habilitado. La distribución automática de artículos entre Cocina y Barra aún no está definida.</p></section>`;
    if (page === "kitchen") return renderKitchen();
    if (page === "salon") return renderSalon();
    return '<section class="panel"><div class="empty">Espacio de trabajo no disponible.</div></section>';
  }
  function showDialog(title, body, onSave) {
    const d = document.createElement("dialog"); d.className = "password-dialog salon-dialog";
    d.innerHTML = `<form method="dialog"><div class="panel-title">${escText(title)}</div>${body}<p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-close>Cancelar</button><button type="submit" class="btn primary">Guardar</button></div></form>`;
    document.body.append(d); const f = d.querySelector("form"); d.showModal(); d.querySelector("[data-close]").onclick = () => d.close();
    f.onsubmit = async (e) => { e.preventDefault(); const b = f.querySelector('[type="submit"]'); b.disabled = true; try { await onSave(new FormData(f)); d.close(); await loadSalon(); } catch (error) { f.querySelector(".password-error").textContent = error.message || "No se pudo guardar."; b.disabled = false; } };
    d.addEventListener("close", () => d.remove());
  }
  async function salonOptions(table) {
    const neighbors = data.tables.filter((other) => other.id !== table.id && other.floor_id === table.floor_id && !other.fusion_group_id && other.status === "free" && (((table.grid_row+table.row_span===other.grid_row || other.grid_row+other.row_span===table.grid_row) && table.grid_column<other.grid_column+other.column_span && table.grid_column+table.column_span>other.grid_column) || ((table.grid_column+table.column_span===other.grid_column || other.grid_column+other.column_span===table.grid_column) && table.grid_row<other.grid_row+other.row_span && table.grid_row+table.row_span>other.grid_row)));
    const d = document.createElement("dialog"); d.className = "password-dialog salon-dialog";
    d.innerHTML = `<div class="panel-title">Mesa ${table.table_number}</div><div class="salon-option-list"><button data-rename>Renombrar</button><button data-resize>Redimensionar</button><button data-merge ${neighbors.length && !table.fusion_group_id && table.status === "free" ? "" : "disabled"}>Fusionar${neighbors.length && !table.fusion_group_id && table.status === "free" ? "" : " · requiere una mesa libre vecina"}</button>${table.fusion_group_id ? '<button data-unmerge>Deshacer fusión</button>' : ""}</div><div class="dialog-actions"><button class="btn secondary" data-close>Cerrar</button></div>`;
    document.body.append(d); d.showModal(); d.querySelector("[data-close]").onclick = () => d.close();
    d.querySelector("[data-rename]").onclick = () => { d.close(); showDialog("Renombrar mesa", `<label class="dialog-label">Número<select name="number">${Array.from({length:100},(_,i)=>i+1).filter((n)=>n===table.table_number||!data.tables.some((x)=>x.id!==table.id&&x.table_number===n)).map((n)=>`<option value="${n}" ${n===table.table_number?"selected":""}>Mesa ${n}</option>`).join("")}</select></label>`, async (form) => { const n=Number(form.get("number")); if (data.tables.some((x)=>x.id!==table.id&&x.table_number===n)) throw new Error("Ese número ya está ocupado."); const { error }=await supabase.rpc("salon_update_table",{p_table_id:table.id,p_table_number:n,p_row:table.grid_row,p_column:table.grid_column,p_row_span:table.row_span,p_column_span:table.column_span}); if(error) throw error; }); };
    d.querySelector("[data-resize]").onclick = () => { d.close(); showDialog("Redimensionar mesa", `<div class="settings-form-grid"><label class="dialog-label">Filas<input name="rows" type="number" min="1" max="10" required value="${table.row_span}"></label><label class="dialog-label">Columnas<input name="columns" type="number" min="1" max="10" required value="${table.column_span}"></label></div>`, async (form) => { const {error}=await supabase.rpc("salon_update_table",{p_table_id:table.id,p_table_number:table.table_number,p_row:table.grid_row,p_column:table.grid_column,p_row_span:Number(form.get("rows")),p_column_span:Number(form.get("columns"))}); if(error) throw error; }); };
    d.querySelector("[data-merge]").onclick = () => { if(!neighbors.length || table.fusion_group_id || table.status !== "free")return; d.close(); showDialog("Fusionar mesas", `<label class="dialog-label">Mesa vecina<select name="neighbor">${neighbors.map((n)=>`<option value="${n.id}">Mesa ${n.table_number}</option>`).join("")}</select></label><p class="meta">Se agruparán en el mapa y conservarán sus números. Puedes deshacerlo desde las opciones.</p>`, async(form)=>{const {error}=await supabase.rpc("salon_merge_tables",{p_first_id:table.id,p_second_id:form.get("neighbor")});if(error)throw error;}); };
    d.querySelector("[data-unmerge]")?.addEventListener("click", async()=>{const {error}=await supabase.rpc("salon_unmerge_table",{p_table_id:table.id});if(error)return toast(error.message);d.close();await loadSalon();});
    d.addEventListener("close",()=>d.remove());
  }
  async function setKitchenProgress(entryId, action, itemIndex=null, unitIndex=null) {
    const { error } = await supabase.rpc("kitchen_set_progress", { p_entry_id: entryId, p_action: action, p_item_index: itemIndex, p_unit_index: unitIndex });
    if (error) return toast(error.message || "No se pudo actualizar la preparación.");
    await loadKitchen();
    if (has("salon")) await loadSalon();
  }
  async function enqueueOrder(destination, order) {
    if (!supabase || !has(destination === "kitchen" ? "kitchen" : "salon")) return false;
    if (!(order.items || []).length) return false;
    const { error } = await supabase.rpc("workspace_enqueue_order", {
      p_destination: destination, p_source_order_id: order.id, p_source_order_kind: order.kind,
      p_location_id: order.location_id || null, p_table_id: state.orderTableId || null, p_table_label: order.table_label || null,
      p_order_note: order.note || "", p_items: order.items || [], p_open_order_id: order.source_open_order_id || null,
    });
    if (error) toast("El pedido se guardó, pero no pudo entrar a la cola: " + (error.message || "error"));
    return !error;
  }

  async function linkOpenOrder(openOrderId) {
    if (!state.orderTableId || !has("salon")) return true;
    const { error } = await supabase.rpc("salon_link_open_order", {
      p_open_order_id: openOrderId,
      p_table_id: state.orderTableId,
      p_table_label: state.orderTableLabel,
    });
    if (error) toast(error.message || "No se pudo vincular el pedido abierto con la mesa.");
    return !error;
  }

  async function getOpenOrderTable(openOrderId) {
    state.orderTableId = null;
    state.orderTableLabel = "";
    if (!has("salon")) return null;
    const { data: rows, error } = await supabase.rpc("salon_get_open_order_table", { p_open_order_id: openOrderId });
    if (error) {
      toast(error.message || "No se pudo recuperar la mesa del pedido.");
      return null;
    }
    const row = rows?.[0] || null;
    if (row) {
      state.orderTableId = row.table_id;
      state.orderTableLabel = row.table_label;
    }
    return row;
  }

  async function clearOpenOrderTable(openOrderId) {
    if (!openOrderId || !has("salon")) return true;
    const { error } = await supabase.rpc("salon_clear_open_order_table", { p_open_order_id: openOrderId });
    if (error) toast(error.message || "No se pudo liberar el vínculo de la mesa.");
    return !error;
  }

  async function hasOpenOrderQueue(openOrderId) {
    if (!openOrderId) return false;
    const checks = [];
    if (has("kitchen")) checks.push(supabase.from("kitchen_queue_entries").select("id").eq("source_order_id", openOrderId).eq("source_order_kind", "open").limit(1));
    if (has("salon")) checks.push(supabase.from("salon_service_entries").select("id").eq("source_order_id", openOrderId).eq("source_order_kind", "open").limit(1));
    const results = await Promise.all(checks);
    return results.some((result) => !result.error && result.data?.length);
  }

  async function cancelOrder(sourceOrderId, sourceOrderKind = "open") {
    if (!supabase || (!has("kitchen") && !has("salon"))) return;
    const { error } = await supabase.rpc("workspace_cancel_order", { p_source_order_id: sourceOrderId, p_source_order_kind: sourceOrderKind });
    if (error) toast("El pedido se canceló, pero no se pudo actualizar su cola.");
  }

  function gridTrackAt(coordinate, start, size, weights, gap) {
    const totalGap = gap * Math.max(0, weights.length - 1);
    const trackSpace = size - totalGap;
    const point = coordinate - start;
    if (point < 0 || point > size || trackSpace <= 0) return null;
    const totalWeight = weights.reduce((sum, value) => sum + Number(value || 1), 0);
    let cursor = 0;
    for (let index = 0; index < weights.length; index += 1) {
      const extent = trackSpace * Number(weights[index] || 1) / totalWeight;
      const midpoint = cursor + extent + gap / 2;
      if (point <= midpoint) return index;
      cursor += extent + gap;
    }
    return weights.length - 1;
  }

  function tableDropCell(event, grid, floor, table) {
    const rect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const columnGap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || 0;
    const column = gridTrackAt(
      event.clientX,
      rect.left + paddingLeft,
      rect.width - paddingLeft - paddingRight,
      floor.column_sizes || Array(floor.grid_columns).fill(1),
      columnGap,
    );
    const row = gridTrackAt(
      event.clientY,
      rect.top + paddingTop,
      rect.height - paddingTop - paddingBottom,
      floor.row_sizes || Array(floor.grid_rows).fill(1),
      rowGap,
    );
    if (column == null || row == null) return null;
    return {
      column: Math.max(0, Math.min(floor.grid_columns - table.column_span, column - Math.floor(table.column_span / 2))),
      row: Math.max(0, Math.min(floor.grid_rows - table.row_span, row - Math.floor(table.row_span / 2))),
    };
  }

  function bind() {
    document.querySelectorAll("[data-crm-tab]").forEach((b)=>b.onclick=()=>{data.crmTab=b.dataset.crmTab;render();});
    document.querySelectorAll("[data-crm-demo]").forEach((b)=>b.onclick=()=>toast("Esta pantalla CRM es una vista de muestra; todavía no guarda clientes ni campañas."));
    document.getElementById("crm-search")?.addEventListener("input",(e)=>{data.crmQuery=e.target.value;render();document.getElementById("crm-search")?.focus();});
    document.querySelectorAll("[data-floor]").forEach((b)=>b.onclick=()=>{data.floorId=b.dataset.floor;render();});
    document.querySelectorAll("[data-table]").forEach((el)=>el.onclick=()=>{if(data.editingMap)return;const table=data.tables.find((x)=>x.id===el.dataset.table);const floor=data.floors.find((x)=>x.id===table?.floor_id);if(!table)return;if(table.status==="occupied"){toast("Mesa ocupada. Revisa el pedido desde Flujo de pedidos.");return;}if(hasActiveOrder?.()){toast("Termina, publica o cancela el pedido actual antes de abrir otra mesa.");return;}state.orderTableId=table.id;state.orderTableLabel=data.floors.length>1?`${floor?.name || "Piso"} · Mesa ${table.table_number}`:`Mesa ${table.table_number}`;navigate("orders");});
    document.getElementById("salon-edit-map")?.addEventListener("click",()=>{data.editingMap=!data.editingMap;render();});
    document.getElementById("salon-new-floor")?.addEventListener("click",()=>showDialog("Crear piso",`<label class="dialog-label">Nombre<input name="name" maxlength="40" required placeholder="Ej. Segundo piso"></label><div class="settings-form-grid"><label class="dialog-label">Filas<input name="rows" type="number" min="3" max="30" value="8" required></label><label class="dialog-label">Columnas<input name="columns" type="number" min="3" max="30" value="8" required></label></div>`,async(form)=>{const {error}=await supabase.rpc("salon_create_floor",{p_name:String(form.get("name")).trim(),p_rows:Number(form.get("rows")),p_columns:Number(form.get("columns"))});if(error)throw error;}));
    document.getElementById("salon-new-table")?.addEventListener("click",async()=>{const {error}=await supabase.rpc("salon_create_table",{p_floor_id:data.floorId});if(error)toast(error.message||"No hay espacio libre en este piso.");else await loadSalon();});
    document.getElementById("salon-floor-settings")?.addEventListener("click", () => {
      const floor = data.floors.find((item) => item.id === data.floorId);
      if (!floor) return;
      const rowFields = Array.from({ length: floor.grid_rows }, (_, index) =>
        `<label>Fila ${index + 1}<input name="row_size_${index}" type="number" min="0.5" max="4" step="0.25" value="${floor.row_sizes?.[index] ?? 1}"></label>`,
      ).join("");
      const columnFields = Array.from({ length: floor.grid_columns }, (_, index) =>
        `<label>Columna ${index + 1}<input name="column_size_${index}" type="number" min="0.5" max="4" step="0.25" value="${floor.column_sizes?.[index] ?? 1}"></label>`,
      ).join("");
      showDialog(
        "Ajustes del piso",
        `<div class="settings-form-grid"><label class="dialog-label">Filas<input name="rows" type="number" min="3" max="30" value="${floor.grid_rows}" required></label><label class="dialog-label">Columnas<input name="columns" type="number" min="3" max="30" value="${floor.grid_columns}" required></label><label class="dialog-label">Sillas en este piso<input name="seats" type="number" min="0" max="500" value="${floor.seat_count ?? 0}" required></label></div><p class="meta">Ajusta el ancho y alto relativo de cada línea. Un cambio no puede dejar mesas fuera de la grilla.</p><div class="grid-size-controls"><div><strong>Alto de filas</strong>${rowFields}</div><div><strong>Ancho de columnas</strong>${columnFields}</div></div>`,
        async (form) => {
          const rows = Number(form.get("rows"));
          const columns = Number(form.get("columns"));
          const rowSizes = Array.from({ length: rows }, (_, index) => Number(form.get(`row_size_${index}`) || 1));
          const columnSizes = Array.from({ length: columns }, (_, index) => Number(form.get(`column_size_${index}`) || 1));
          const { error } = await supabase.rpc("salon_update_floor", {
            p_floor_id: floor.id,
            p_rows: rows,
            p_columns: columns,
            p_seat_count: Number(form.get("seats")),
            p_row_sizes: rowSizes,
            p_column_sizes: columnSizes,
          });
          if (error) throw error;
        },
      );
    });
    document.querySelectorAll("[data-kitchen-action]").forEach((b)=>b.onclick=()=>setKitchenProgress(b.dataset.entry,b.dataset.kitchenAction,b.hasAttribute("data-item")?Number(b.dataset.item):null,null));
    document.querySelectorAll("[data-kitchen-unit]").forEach((b)=>b.onclick=()=>setKitchenProgress(b.dataset.kitchenUnit,"unit_ready",Number(b.dataset.item),Number(b.dataset.unit)));
    document.querySelectorAll("[data-kitchen-stock]").forEach((b)=>b.onclick=()=>setKitchenProgress(b.dataset.kitchenStock,"unit_out_of_stock",Number(b.dataset.item),Number(b.dataset.unit)));
    document.querySelectorAll("[data-product-stock]").forEach((b)=>b.onclick=async()=>{const {error}=await supabase.rpc("set_catalog_stock_availability",{p_entity:"product",p_entity_id:b.dataset.productStock,p_is_available:false});if(error)toast(error.message||"No se pudo marcar fuera de stock.");else{toast("Producto marcado fuera de stock.");await refreshCatalog?.();}});
    document.querySelectorAll("[data-salon-delivered]").forEach((b)=>b.onclick=async()=>{const {error}=await supabase.rpc("salon_mark_delivered",{p_entry_id:b.dataset.salonDelivered});if(error)toast(error.message);else{toast("Pedido marcado como entregado.");await loadSalon();}});
    if (data.editingMap) document.querySelectorAll("[data-table]").forEach((el) => {
      const table = data.tables.find((item) => item.id === el.dataset.table);
      if (!table) return;
      el.onpointerdown = (event) => {
        const previousPress = data.press;
        clearTimeout(data.press?.timer);
        clearTimeout(data.press?.menuTimer);
        if (previousPress) document.querySelector(`[data-table="${previousPress.id}"]`)?.classList.remove("can-drag", "is-dragging");
        el.setPointerCapture?.(event.pointerId);
        const press = { id: table.id, x: event.clientX, y: event.clientY, movable: false, dragged: false, timer: null, menuTimer: null };
        data.press = press;
        press.timer = setTimeout(() => {
          if (data.press !== press) return;
          press.movable = true;
          el.classList.add("can-drag");
          press.menuTimer = setTimeout(() => {
            if (data.press !== press || press.dragged) return;
            el.classList.remove("can-drag");
            data.press = null;
            salonOptions(table);
          }, 4000);
        }, 3000);
      };
      el.onpointermove = (event) => {
        const press = data.press;
        if (!press || press.id !== table.id || !press.movable) return;
        if (Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) < 8) return;
        press.dragged = true;
        clearTimeout(press.menuTimer);
        data.dragging = table.id;
        el.classList.add("is-dragging");
        el.style.setProperty("--drag-x", `${event.clientX - press.x}px`);
        el.style.setProperty("--drag-y", `${event.clientY - press.y}px`);
      };
      el.onpointerup = async (event) => {
        const press = data.press;
        if (!press || press.id !== table.id) return;
        clearTimeout(press.timer);
        clearTimeout(press.menuTimer);
        data.press = null;
        el.classList.remove("can-drag", "is-dragging");
        el.style.removeProperty("--drag-x");
        el.style.removeProperty("--drag-y");
        if (!press.dragged) return;
        const floor = data.floors.find((item) => item.id === table.floor_id);
        const grid = el.closest(".salon-map-grid");
        const cell = floor && grid ? tableDropCell(event, grid, floor, table) : null;
        if (!cell) {
          data.dragging = null;
          return;
        }
        const { error } = await supabase.rpc("salon_update_table", {
          p_table_id: table.id,
          p_table_number: table.table_number,
          p_row: cell.row,
          p_column: cell.column,
          p_row_span: table.row_span,
          p_column_span: table.column_span,
        });
        data.dragging = null;
        if (error) toast(error.message || "Ese espacio está ocupado.");
        else {
          data.moveHighlightId = table.id;
          await loadSalon();
          setTimeout(() => {
            data.moveHighlightId = "";
            if (data.page === "salon") render();
          }, 2000);
        }
      };
      el.onpointercancel = () => {
        clearTimeout(data.press?.timer);
        clearTimeout(data.press?.menuTimer);
        data.press = null;
        data.dragging = null;
        el.classList.remove("can-drag", "is-dragging");
        el.style.removeProperty("--drag-x");
        el.style.removeProperty("--drag-y");
      };
    });
  }
  return { enter, cleanup, render, bind, enqueueOrder, cancelOrder, linkOpenOrder, getOpenOrderTable, clearOpenOrderTable, hasOpenOrderQueue, has, state: data };
}
