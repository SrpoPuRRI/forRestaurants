// Workspaces opcionales: CRM demostrativo, Delivery próximamente, KDS y mapa Salón.
export default function createRestaurantWorkspaces({ supabase, state, render, toast, esc, money, navigate, refreshCatalog }) {
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
    if (!supabase) return;
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
  async function loadKitchen() {
    if (!supabase) return;
    data.loading = true; data.error = ""; render();
    await supabase.rpc("workspace_prune_completed_queues");
    const { data: queue, error } = await supabase.from("kitchen_queue_entries").select("id,source_order_id,source_order_kind,location_id,table_label,order_note,items,status,queued_at,completed_at").eq("status","queued").order("queued_at");
    if (error) data.error = "No se pudo cargar Cocina. Aplica la migración de espacios de trabajo y vuelve a intentarlo.";
    data.kitchen = queue || []; data.loading = false; render();
  }
  async function enter(page) {
    data.page = page;
    clearInterval(data.poll); data.poll = null;
    if (page === "salon" || page === "kitchen" || page === "bar") {
      await loadSettings();
      if (page === "salon") await loadSalon(); else await loadKitchen();
      data.poll = setInterval(() => page === "salon" ? loadSalon() : loadKitchen(), 7000);
    }
  }
  function cleanup() { clearInterval(data.poll); data.poll = null; clearTimeout(data.press?.timer); data.press = null; }

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
      return `<article class="panel kitchen-order-card"><header><div><div class="kitchen-order-ref">${entry.table_label ? escText(entry.table_label) : `Pedido ${escText(entry.source_order_id.slice(0,8))}`}</div><div class="meta">${entry.source_order_kind === "open" ? "Sin pagar" : "Pagado"} · Ingresó ${formatTime(entry.queued_at)}</div></div><button class="btn primary" data-kitchen-action="order_ready" data-entry="${entry.id}">Dar pedido como listo</button></header>${entry.order_note ? `<p class="kitchen-note">${escText(entry.order_note)}</p>` : ""}<div class="kitchen-items">${items.map((item, i) => { const units = Array.isArray(item.units) ? item.units : []; const name = [item.name, item.variant_name].filter(Boolean).join(" · "); return `<section class="kitchen-item"><div class="kitchen-item-head"><div><strong>${escText(name)}</strong><span class="meta">${money(item.unit_price || 0)} c/u</span>${(item.addons || []).length ? `<span class="meta">${item.addons.map((addon) => `${addon.quantity || 1} × ${escText(addon.name || "Agregado")}`).join(", ")}</span>` : ""}</div><button class="rowaction" data-kitchen-action="item_ready" data-entry="${entry.id}" data-item="${i}">Dar item como listo</button><button class="rowaction danger-action" data-kitchen-action="item_out_of_stock" data-entry="${entry.id}" data-item="${i}">Quitar por fuera de stock</button>${item.product_id ? `<button class="rowaction danger-action" data-product-stock="${escText(item.product_id)}">Marcar producto fuera de stock</button>` : ""}</div><div class="kitchen-units">${units.map((unit, u) => `<button class="kitchen-unit ${unit.status !== "pending" ? `unit-${unit.status}` : ""}" ${unit.status !== "pending" ? "disabled" : ""} data-kitchen-unit="${entry.id}" data-item="${i}" data-unit="${u}" aria-label="Unidad ${u + 1}: ${unit.status}">${unit.status === "pending" ? `Unidad ${u+1} · Listo` : unit.status === "ready" ? `✓ Lista · ${formatTime(unit.changed_at)}` : `Sin stock · ${formatTime(unit.changed_at)}`}</button><button class="kitchen-unit-stock" ${unit.status !== "pending" ? "disabled" : ""} data-kitchen-stock="${entry.id}" data-item="${i}" data-unit="${u}">Sin stock</button>`).join("")}</div></section>`; }).join("")}</div></article>`;
    }).join("");
    return `<section class="page-head"><div><div class="eyebrow">Espacio de trabajo</div><h1>Cocina</h1><p class="desc">Prepara los pedidos y marca cada artículo cuando esté listo.</p></div></section>${data.error ? `<div class="inline-error" role="alert">${escText(data.error)}</div>` : ""}${data.loading ? '<div class="stats-loading-bar">Actualizando cocina…</div>' : ""}<div class="kitchen-queue-head"><strong>Por preparar <span>${data.kitchen.length}</span></strong><span class="meta">Los pedidos listos se envían a Salón si está activo.</span></div><div class="kitchen-queue">${cards || '<section class="panel empty-panel"><div class="empty">No hay pedidos por preparar.</div></section>'}</div>`;
  }
  function renderSalon() {
    const floor = data.floors.find((x) => x.id === data.floorId);
    const tables = data.tables.filter((x) => x.floor_id === floor?.id);
    const canEdit = isAdmin() || (isEmployee() && (data.settings.salon_waiter_map_edit || data.settings.salon_host_map_edit));
    const grid = floor ? `<div class="salon-map-grid ${data.editingMap ? "is-editing" : ""}" style="--map-cols:${floor.grid_columns};--map-rows:${floor.grid_rows};grid-template-columns:${(floor.column_sizes || Array(floor.grid_columns).fill(1)).map((x)=>`${Number(x)}fr`).join(" ")};grid-template-rows:${(floor.row_sizes || Array(floor.grid_rows).fill(1)).map((x)=>`${Number(x)}fr`).join(" ")}">${tables.map((table) => `<button type="button" class="salon-table ${table.status === "occupied" ? "is-occupied" : ""} ${table.fusion_group_id ? "is-fused" : ""} ${data.dragging === table.id ? "is-dragging" : ""} ${data.moveHighlightId === table.id ? "can-drag" : ""}" aria-label="Mesa ${table.table_number}, ${table.status === "occupied" ? "ocupada" : "libre"}" style="grid-row:${table.grid_row+1}/span ${table.row_span};grid-column:${table.grid_column+1}/span ${table.column_span}" data-table="${table.id}" data-number="${table.table_number}"><span class="salon-table-number">${table.table_number}</span>${data.settings.salon_show_seats && floor.seat_count != null ? '<span class="salon-chair-mark">·</span>' : ""}</button>`).join("")}</div>` : '<div class="empty salon-empty">Aún no hay pisos. Crea el primero para armar el mapa.</div>';
    return `<section class="page-head"><div><div class="eyebrow">Espacio de trabajo</div><h1>Salón</h1><p class="desc">Consulta el mapa de mesas y los pedidos listos para entregar.</p></div><div class="salon-head-actions">${canEdit ? `<button class="btn ${data.editingMap ? "secondary" : "primary"}" id="salon-edit-map">${data.editingMap ? "Terminar edición" : "Editar mapa"}</button>` : ""}${canEdit && data.editingMap ? '<button class="btn secondary" id="salon-new-floor">＋ Piso</button><button class="btn secondary" id="salon-new-table">＋ Mesa</button><button class="btn secondary" id="salon-floor-settings">Ajustar piso</button>' : ""}</div></section>${data.error ? `<div class="inline-error" role="alert">${escText(data.error)}</div>` : ""}<div class="salon-layout"><section class="panel salon-map-panel"><div class="salon-floor-tabs">${data.floors.length > 1 ? data.floors.map((f) => `<button class="${f.id === data.floorId ? "active" : ""}" data-floor="${f.id}">${escText(f.name)}</button>`).join("") : floor ? `<span>${escText(floor.name)}</span>` : ""}<span class="meta">${floor ? `${floor.grid_rows} × ${floor.grid_columns}` : ""}${data.settings.salon_show_seats && floor?.seat_count != null ? ` · ${floor.seat_count} sillas` : ""}</span></div>${grid}<p class="salon-map-help">${data.editingMap ? "Mantén una mesa 3 segundos para moverla; espera 7 segundos para sus opciones." : "Vista del salón · Las mesas se organizan en el restaurante."}</p></section><section class="panel salon-service-panel"><div class="panel-head"><div><div class="panel-title">Listos para entregar</div><div class="meta">${data.service.length} pedidos esperan en Salón</div></div></div><div class="salon-service-list">${data.service.map((entry) => `<article class="salon-service-card"><div class="salon-service-title"><strong>${escText(entry.table_label || `Pedido ${entry.source_order_id.slice(0,8)}`)}</strong><span class="meta">${formatTime(entry.queued_at)}</span></div>${entry.order_note ? `<p>${escText(entry.order_note)}</p>` : ""}<ul>${(entry.items || []).map((item) => `<li>${entry.kitchen_entry_id && Array.isArray(item.units) ? item.units.filter((x) => x.status === "ready").length : item.quantity} × ${escText([item.name,item.variant_name].filter(Boolean).join(" · "))}</li>`).join("")}</ul><button class="btn primary" data-salon-delivered="${entry.id}">Marcar como entregado</button></article>`).join("") || '<div class="empty">No hay pedidos esperando entrega.</div>'}</div></section></div>`;
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
    const neighbors = data.tables.filter((other) => other.id !== table.id && other.floor_id === table.floor_id && (((table.grid_row+table.row_span===other.grid_row || other.grid_row+other.row_span===table.grid_row) && table.grid_column<other.grid_column+other.column_span && table.grid_column+table.column_span>other.grid_column) || ((table.grid_column+table.column_span===other.grid_column || other.grid_column+other.column_span===table.grid_column) && table.grid_row<other.grid_row+other.row_span && table.grid_row+table.row_span>other.grid_row)));
    const d = document.createElement("dialog"); d.className = "password-dialog salon-dialog";
    d.innerHTML = `<div class="panel-title">Mesa ${table.table_number}</div><div class="salon-option-list"><button data-rename>Renombrar</button><button data-resize>Redimensionar</button><button data-merge ${neighbors.length ? "" : "disabled"}>Fusionar${neighbors.length ? "" : " · requiere una mesa vecina"}</button>${table.fusion_group_id ? '<button data-unmerge>Deshacer fusión</button>' : ""}</div><div class="dialog-actions"><button class="btn secondary" data-close>Cerrar</button></div>`;
    document.body.append(d); d.showModal(); d.querySelector("[data-close]").onclick = () => d.close();
    d.querySelector("[data-rename]").onclick = () => { d.close(); showDialog("Renombrar mesa", `<label class="dialog-label">Número<select name="number">${Array.from({length:100},(_,i)=>i+1).filter((n)=>n===table.table_number||!data.tables.some((x)=>x.id!==table.id&&x.table_number===n)).map((n)=>`<option value="${n}" ${n===table.table_number?"selected":""}>Mesa ${n}</option>`).join("")}</select></label>`, async (form) => { const n=Number(form.get("number")); if (data.tables.some((x)=>x.id!==table.id&&x.table_number===n)) throw new Error("Ese número ya está ocupado."); const { error }=await supabase.rpc("salon_update_table",{p_table_id:table.id,p_table_number:n,p_row:table.grid_row,p_column:table.grid_column,p_row_span:table.row_span,p_column_span:table.column_span}); if(error) throw error; }); };
    d.querySelector("[data-resize]").onclick = () => { d.close(); showDialog("Redimensionar mesa", `<div class="settings-form-grid"><label class="dialog-label">Filas<input name="rows" type="number" min="1" max="10" required value="${table.row_span}"></label><label class="dialog-label">Columnas<input name="columns" type="number" min="1" max="10" required value="${table.column_span}"></label></div>`, async (form) => { const {error}=await supabase.rpc("salon_update_table",{p_table_id:table.id,p_table_number:table.table_number,p_row:table.grid_row,p_column:table.grid_column,p_row_span:Number(form.get("rows")),p_column_span:Number(form.get("columns"))}); if(error) throw error; }); };
    d.querySelector("[data-merge]").onclick = () => { if(!neighbors.length)return; d.close(); showDialog("Fusionar mesas", `<label class="dialog-label">Mesa vecina<select name="neighbor">${neighbors.map((n)=>`<option value="${n.id}">Mesa ${n.table_number}</option>`).join("")}</select></label><p class="meta">Se agruparán en el mapa y conservarán sus números. Puedes deshacerlo desde las opciones.</p>`, async(form)=>{const {error}=await supabase.rpc("salon_merge_tables",{p_first_id:table.id,p_second_id:form.get("neighbor")});if(error)throw error;}); };
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
    if (!supabase || !has(destination === "kitchen" ? "kitchen" : "salon")) return;
    const { error } = await supabase.rpc("workspace_enqueue_order", {
      p_destination: destination, p_source_order_id: order.id, p_source_order_kind: order.kind,
      p_location_id: order.location_id || null, p_table_id: state.orderTableId || null, p_table_label: order.table_label || null,
      p_order_note: order.note || "", p_items: order.items || [],
    });
    if (error) toast("El pedido se guardó, pero no pudo entrar a la cola: " + (error.message || "error"));
  }
  async function cancelOrder(sourceOrderId, sourceOrderKind = "open") {
    if (!supabase || (!has("kitchen") && !has("salon"))) return;
    const { error } = await supabase.rpc("workspace_cancel_order", { p_source_order_id: sourceOrderId, p_source_order_kind: sourceOrderKind });
    if (error) toast("El pedido se canceló, pero no se pudo actualizar su cola.");
  }

  function bind() {
    document.querySelectorAll("[data-crm-tab]").forEach((b)=>b.onclick=()=>{data.crmTab=b.dataset.crmTab;render();});
    document.querySelectorAll("[data-crm-demo]").forEach((b)=>b.onclick=()=>toast("Esta pantalla CRM es una vista de muestra; todavía no guarda clientes ni campañas."));
    document.getElementById("crm-search")?.addEventListener("input",(e)=>{data.crmQuery=e.target.value;render();document.getElementById("crm-search")?.focus();});
    document.querySelectorAll("[data-floor]").forEach((b)=>b.onclick=()=>{data.floorId=b.dataset.floor;render();});
    document.querySelectorAll("[data-table]").forEach((el)=>el.onclick=()=>{if(data.editingMap)return;const table=data.tables.find((x)=>x.id===el.dataset.table);const floor=data.floors.find((x)=>x.id===table?.floor_id);if(!table)return;state.orderTableId=table.id;state.orderTableLabel=data.floors.length>1?`${floor?.name || "Piso"} · Mesa ${table.table_number}`:`Mesa ${table.table_number}`;navigate("orders");});
    document.getElementById("salon-edit-map")?.addEventListener("click",()=>{data.editingMap=!data.editingMap;render();});
    document.getElementById("salon-new-floor")?.addEventListener("click",()=>showDialog("Crear piso",`<label class="dialog-label">Nombre<input name="name" maxlength="40" required placeholder="Ej. Segundo piso"></label><div class="settings-form-grid"><label class="dialog-label">Filas<input name="rows" type="number" min="3" max="30" value="8" required></label><label class="dialog-label">Columnas<input name="columns" type="number" min="3" max="30" value="8" required></label></div>`,async(form)=>{const {error}=await supabase.rpc("salon_create_floor",{p_name:String(form.get("name")).trim(),p_rows:Number(form.get("rows")),p_columns:Number(form.get("columns"))});if(error)throw error;}));
    document.getElementById("salon-new-table")?.addEventListener("click",async()=>{const {error}=await supabase.rpc("salon_create_table",{p_floor_id:data.floorId});if(error)toast(error.message||"No hay espacio libre en este piso.");else await loadSalon();});
    document.getElementById("salon-floor-settings")?.addEventListener("click",()=>{const f=data.floors.find((x)=>x.id===data.floorId);if(!f)return;const rowFields=Array.from({length:f.grid_rows},(_,i)=>`<label>Fila ${i+1}<input name="row_size_${i}" type="number" min="0.5" max="4" step="0.25" value="${f.row_sizes?.[i]??1}"></label>`).join("");const colFields=Array.from({length:f.grid_columns},(_,i)=>`<label>Columna ${i+1}<input name="column_size_${i}" type="number" min="0.5" max="4" step="0.25" value="${f.column_sizes?.[i]??1}"></label>`).join("");showDialog("Ajustes del piso",`<div class="settings-form-grid"><label class="dialog-label">Filas<input name="rows" type="number" min="3" max="30" value="${f.grid_rows}" required></label><label class="dialog-label">Columnas<input name="columns" type="number" min="3" max="30" value="${f.grid_columns}" required></label><label class="dialog-label">Sillas en este piso<input name="seats" type="number" min="0" max="500" value="${f.seat_count??0}" required></label></div><p class="meta">Ajusta el ancho y alto relativo de cada línea. Un cambio no puede dejar mesas fuera de la grilla.</p><div class="grid-size-controls"><div><strong>Alto de filas</strong>${rowFields}</div><div><strong>Ancho de columnas</strong>${colFields}</div></div>`,async(form)=>{const rows=Number(form.get("rows")),columns=Number(form.get("columns"));const rowSizes=Array.from({length:rows},(_,i)=>Number(form.get(`row_size_${i}`)||1));const columnSizes=Array.from({length:columns},(_,i)=>Number(form.get(`column_size_${i}`)||1));const {error}=await supabase.rpc("salon_update_floor",{p_floor_id:f.id,p_rows:rows,p_columns:columns,p_seat_count:Number(form.get("seats")),p_row_sizes:rowSizes,p_column_sizes:columnSizes});if(error)throw error;}});
    document.querySelectorAll("[data-kitchen-action]").forEach((b)=>b.onclick=()=>setKitchenProgress(b.dataset.entry,b.dataset.kitchenAction,b.hasAttribute("data-item")?Number(b.dataset.item):null,null));
    document.querySelectorAll("[data-kitchen-unit]").forEach((b)=>b.onclick=()=>setKitchenProgress(b.dataset.kitchenUnit,"unit_ready",Number(b.dataset.item),Number(b.dataset.unit)));
    document.querySelectorAll("[data-kitchen-stock]").forEach((b)=>b.onclick=()=>setKitchenProgress(b.dataset.kitchenStock,"unit_out_of_stock",Number(b.dataset.item),Number(b.dataset.unit)));
    document.querySelectorAll("[data-product-stock]").forEach((b)=>b.onclick=async()=>{const {error}=await supabase.rpc("set_catalog_stock_availability",{p_entity:"product",p_entity_id:b.dataset.productStock,p_is_available:false});if(error)toast(error.message||"No se pudo marcar fuera de stock.");else{toast("Producto marcado fuera de stock.");await refreshCatalog?.();}});
    document.querySelectorAll("[data-salon-delivered]").forEach((b)=>b.onclick=async()=>{const {error}=await supabase.rpc("salon_mark_delivered",{p_entry_id:b.dataset.salonDelivered});if(error)toast(error.message);else{toast("Pedido marcado como entregado.");await loadSalon();}});
    if(data.editingMap) document.querySelectorAll("[data-table]").forEach((el)=>{
      const table=data.tables.find((x)=>x.id===el.dataset.table); if(!table)return;
      el.onpointerdown=(event)=>{clearTimeout(data.press?.timer);el.setPointerCapture?.(event.pointerId);data.press={id:table.id,x:event.clientX,y:event.clientY,movable:false,dragged:false,timer:setTimeout(()=>{if(!data.press||data.press.id!==table.id)return;data.press.movable=true;el.classList.add("can-drag");data.press.menuTimer=setTimeout(()=>{if(data.press?.id===table.id&&!data.press.dragged){el.classList.remove("can-drag");data.press=null;salonOptions(table);}},4000);},3000)};};
      el.onpointermove=(event)=>{if(!data.press||data.press.id!==table.id||!data.press.movable)return;if(Math.abs(event.clientX-data.press.x)+Math.abs(event.clientY-data.press.y)<8)return;data.press.dragged=true;data.dragging=table.id;el.classList.add("is-dragging");};
      el.onpointerup=async(event)=>{if(!data.press||data.press.id!==table.id)return;const p=data.press;clearTimeout(p.timer);clearTimeout(p.menuTimer);if(p.dragged){const grid=el.closest(".salon-map-grid"),rect=grid.getBoundingClientRect(),floor=data.floors.find((x)=>x.id===table.floor_id);const col=Math.max(0,Math.min(floor.grid_columns-table.column_span,Math.floor((event.clientX-rect.left)/rect.width*floor.grid_columns)));const row=Math.max(0,Math.min(floor.grid_rows-table.row_span,Math.floor((event.clientY-rect.top)/rect.height*floor.grid_rows)));const {error}=await supabase.rpc("salon_update_table",{p_table_id:table.id,p_table_number:table.table_number,p_row:row,p_column:col,p_row_span:table.row_span,p_column_span:table.column_span});data.dragging=null;if(error)toast(error.message||"Ese espacio está ocupado.");else{data.moveHighlightId=table.id;await loadSalon();setTimeout(()=>{data.moveHighlightId="";if(data.page==="salon")render();},2000);}}else if(p.movable){data.press=null;return;}else data.press=null;data.press=null;};
      el.onpointercancel=()=>{clearTimeout(data.press?.timer);clearTimeout(data.press?.menuTimer);data.press=null;data.dragging=null;};
    });
  }
  return { enter, cleanup, render, bind, enqueueOrder, cancelOrder, has, state: data };
}
