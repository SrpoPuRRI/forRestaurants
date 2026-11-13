// Configuración operativa del restaurante, persistida en columnas y tablas de dominio.
export default function createRestaurantSettings({ supabase, state, esc, toast, render }) {
  let savedSettingsSnapshot = null;
  let settingsSaving = false;
  const methods = [
    { key: "cash", label: "Efectivo", manual: true, automatic: false },
    { key: "yape", label: "Yape", manual: true, automatic: true },
    { key: "plin", label: "Plin", manual: true, automatic: true },
    { key: "bank_transfer", label: "Transferencia bancaria directa", manual: true, automatic: false },
    { key: "card", label: "Tarjetas", manual: true, automatic: true },
  ];
  const boolFields = [
    "rankings_enabled", "rankings_products", "rankings_variants", "rankings_addons", "rankings_categories",
    "rankings_employees_enabled", "rankings_same_for_all_roles", "order_minimum_enabled", "order_minimum_admin",
    "order_minimum_employees", "order_maximum_enabled", "order_maximum_admin", "order_maximum_employees",
    "corrections_admin", "corrections_employees", "catalog_addons_enabled", "catalog_category_groups_enabled", "catalog_promotions_enabled",
    "delivery_kitchen_after_virtual_payment", "salon_waiter_map_edit", "salon_host_map_edit", "salon_show_seats", "kitchen_has_separate_bar",
    "attendance_check_in_self", "attendance_check_in_peer_at_location", "attendance_check_out_self", "attendance_check_out_peer_at_location",
  ];
  const defaults = {
    employee_note_reset_mode: "manual", employee_note_reset_days: 30,
    rankings_enabled: false, rankings_products: false, rankings_variants: false, rankings_addons: false, rankings_categories: false,
    rankings_employees_enabled: false, rankings_same_for_all_roles: true,
    order_minimum_enabled: false, order_minimum_amount: null, order_minimum_admin: true, order_minimum_employees: false,
    order_maximum_enabled: false, order_maximum_amount: null, order_maximum_admin: true, order_maximum_employees: false,
    corrections_admin: true, corrections_employees: false,
    catalog_addons_enabled: false, catalog_category_groups_enabled: false, catalog_promotions_enabled: false,
    kitchen_entry_mode: "paid", salon_entry_mode: "paid", delivery_kitchen_after_virtual_payment: false, kitchen_has_separate_bar: false,
    salon_waiter_map_edit: false, salon_host_map_edit: false, salon_show_seats: false,
    attendance_check_in_self: false, attendance_check_in_peer_at_location: false,
    attendance_check_out_self: false, attendance_check_out_peer_at_location: false,
  };
  const roleDefaults = (role) => ({ restaurant_id: state.restaurantId, role_id: role.id, rankings_products: false, rankings_variants: false, rankings_addons: false, rankings_categories: false, order_minimum_allowed: false, order_maximum_allowed: false, corrections_allowed: false });
  const check = (key, label, value, extra = "") => `<label class="settings-check"><input type="checkbox" data-setting="${key}" ${value ? "checked" : ""} ${extra}><span>${label}</span></label>`;
  const field = (key, label, value, extra = "") => `<label class="settings-field">${label}<input data-setting="${key}" type="number" min="0" step="0.01" value="${value ?? ""}" ${extra}></label>`;

  async function load() {
    if (!supabase || !state.restaurantId) return;
    state.settingsLoading = true;
    const [restaurant, roles, payments, roleSettings] = await Promise.all([
      supabase.from("restaurants").select(`${Object.keys(defaults).join(",")},needs,available_role_ids,logo_path`).eq("id", state.restaurantId).single(),
      supabase.from("roles").select("id,key,name,permissions,sort_order").order("sort_order"),
      supabase.from("restaurant_payment_methods").select("method_key,enabled,manual_enabled,automatic_enabled").eq("restaurant_id", state.restaurantId),
      supabase.from("restaurant_role_settings").select("*").eq("restaurant_id", state.restaurantId),
    ]);
    const error = restaurant.error || roles.error || payments.error || roleSettings.error;
    state.settingsError = error?.message || "";
    const settingsData = { ...(restaurant.data || {}) };
    delete settingsData.available_role_ids;
    state.restaurantSettings = { ...defaults, ...settingsData };
    state.restaurantNeeds = restaurant.data?.needs || [];
    state.availableRoleIds = restaurant.data?.available_role_ids || [];
    const enabledRoleIds = new Set(state.availableRoleIds);
    state.availableRoles = (roles.data || []).filter((role) => enabledRoleIds.has(role.id));
    state.restaurantLogoPath = restaurant.data?.logo_path || null;
    state.restaurantLogoUrl = null;
    if (state.restaurantLogoPath) {
      const { data: signed } = await supabase.storage.from("restaurant-assets").createSignedUrl(state.restaurantLogoPath, 86400);
      state.restaurantLogoUrl = signed?.signedUrl || null;
    }
    state.settingRoles = state.availableRoles;
    state.paymentSettings = Object.fromEntries((payments.data || []).map((row) => [row.method_key, row]));
    state.paymentSettings.cash = {
      ...(state.paymentSettings.cash || {}),
      method_key: "cash", enabled: true, manual_enabled: true, automatic_enabled: false,
    };
    state.roleSettings = Object.fromEntries((roleSettings.data || []).map((row) => [row.role_id, row]));
    state.settingsLoading = false;
  }

  function roleChecks(fieldName, selected = []) {
    return `<div class="settings-role-list">${(state.settingRoles || []).filter((role) => role.key !== "admin").map((role) => check(`${fieldName}:${role.id}`, esc(role.name), selected.includes(role.id))).join("") || '<span class="meta">No hay roles de empleado configurados.</span>'}</div>`;
  }
  async function configureFloorSeats() {
    const { data: floors, error } = await supabase.from("salon_floors").select("id,name,grid_rows,grid_columns,row_sizes,column_sizes,seat_count").order("sort_order");
    if (error) throw error;
    if (!floors?.length) {
      toast("Crea al menos un piso en Salón antes de activar el total de sillas.");
      return false;
    }
    return new Promise((resolve, reject) => {
      const dialog = document.createElement("dialog"); dialog.className = "password-dialog salon-dialog";
      dialog.innerHTML = `<form method="dialog"><div class="panel-title">Sillas por piso</div><p class="meta">Indica el total de sillas de cada piso. Solo se mostrarán como referencia en el mapa.</p>${floors.map((floor) => `<label class="dialog-label">${esc(floor.name)}<input type="number" min="0" max="500" required name="seat_${floor.id}" value="${floor.seat_count ?? 0}"></label>`).join("")}<p class="password-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="submit" class="btn primary">Guardar sillas</button></div></form>`;
      document.body.appendChild(dialog); const form=dialog.querySelector("form"); let result=false; dialog.showModal();
      dialog.querySelector("[data-cancel]").onclick=()=>dialog.close();
      form.onsubmit=async(event)=>{event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;const fields=new FormData(form);try{const {error:saveError}=await supabase.rpc("salon_save_seat_counts",{p_updates:floors.map((floor)=>({floor_id:floor.id,seat_count:Number(fields.get(`seat_${floor.id}`))}))});if(saveError)throw saveError;result=true;dialog.close();}catch(saveError){form.querySelector(".password-error").textContent=saveError.message||"No se pudieron guardar los totales.";button.disabled=false;}};
      dialog.addEventListener("close",()=>{dialog.remove();resolve(result);});
    });
  }
  function renderPage() {
    if (state.settingsLoading) return '<section class="panel"><div class="empty">Cargando configuración…</div></section>';
    const v = { ...defaults, ...(state.restaurantSettings || {}) };
    const paymentCards = methods.map((m) => {
      const p = state.paymentSettings?.[m.key] || {};
      const requiredCash = m.key === "cash";
      return `<article class="settings-option"><div><strong>${m.label}</strong><p class="meta">${requiredCash ? "Siempre disponible y obligatorio para todos los restaurantes." : m.automatic ? "El modo automático se habilitará al integrar un proveedor de pagos." : "Método disponible para registrar manualmente."}</p></div><div class="settings-checks">${check(`payment:${m.key}:enabled`, "Activado", requiredCash || p.enabled, requiredCash ? "disabled" : "")}${m.manual ? check(`payment:${m.key}:manual`, "Manual", requiredCash || p.manual_enabled, requiredCash || p.enabled ? (requiredCash ? "disabled" : "") : "disabled") : ""}${m.automatic ? check(`payment:${m.key}:automatic`, "Automático", p.automatic_enabled, "disabled title='Pendiente integrar proveedor de pagos'") : ""}</div></article>`;
    }).join("");
    const roleRows = (state.settingRoles || []).filter((role) => role.key !== "admin").map((role) => {
      const rs = state.roleSettings?.[role.id] || roleDefaults(role);
      return `<details class="settings-role"><summary>${esc(role.name)} <span class="meta">Editar permisos</span></summary><div class="settings-checks">${check(`role:${role.id}:rankings_products`, "Productos más vendidos", rs.rankings_products)}${check(`role:${role.id}:rankings_variants`, "Variantes más vendidas", rs.rankings_variants)}${check(`role:${role.id}:rankings_addons`, "Agregados más vendidos", rs.rankings_addons)}${check(`role:${role.id}:rankings_categories`, "Categorías más vendidas", rs.rankings_categories)}${check(`role:${role.id}:order_minimum_allowed`, "Puede aplicar pedido mínimo", rs.order_minimum_allowed)}${check(`role:${role.id}:order_maximum_allowed`, "Puede aplicar pedido máximo", rs.order_maximum_allowed)}${check(`role:${role.id}:corrections_allowed`, "Puede corregir pagos", rs.corrections_allowed)}</div></details>`;
    }).join("");
    const showRoles = (v.rankings_employees_enabled && !v.rankings_same_for_all_roles) || v.order_minimum_employees || v.order_maximum_employees || v.corrections_employees;
    const logoSection = `<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Logo del restaurante</div><div class="meta">Se muestra en Setter y en el espacio de trabajo.</div></div></div><div class="restaurant-logo-setting"><div class="restaurant-logo-preview" id="restaurant-logo-preview">${state.restaurantLogoUrl ? `<img src="${esc(state.restaurantLogoUrl)}" alt="Logo del restaurante">` : '<span>Logo</span>'}</div><div class="restaurant-logo-controls"><label class="settings-field" for="restaurant-logo-file">Cambiar logo<input id="restaurant-logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label><p class="meta">PNG, JPG, WebP o SVG · máximo 5 MB.</p>${state.restaurantLogoPath ? '<label class="settings-check"><input id="restaurant-logo-remove" type="checkbox"><span>Quitar logo</span></label>' : ""}</div></div></section>`;
    const needChoices = [["crm","CRM"],["kitchen","Cocina"],["salon","Salón"],["delivery","Delivery"],["receipts","Comprobantes"]];
    const needsSection = `<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Necesidades del restaurante</div><div class="meta">Puedes añadir o quitar espacios de trabajo. Los datos existentes se conservan; se actualizan los roles habilitados.</div></div></div><div class="settings-checks">${needChoices.map(([key,label]) => `<label class="settings-check"><input type="checkbox" data-restaurant-need="${key}" ${(state.restaurantNeeds || []).includes(key) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div></section>`;
    const attendanceSettings = `<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Asistencia</div><div class="meta">Define quién puede marcar entradas y salidas.</div></div></div><div class="settings-checks">${check("attendance_check_in_self", "Cada persona puede marcar su propia entrada", v.attendance_check_in_self)}${check("attendance_check_in_peer_at_location", "Un compañero puede marcar la entrada desde la misma sede", v.attendance_check_in_peer_at_location)}${check("attendance_check_out_self", "Cada persona puede marcar su propia salida", v.attendance_check_out_self)}${check("attendance_check_out_peer_at_location", "Un compañero puede marcar la salida desde la misma sede", v.attendance_check_out_peer_at_location)}</div><p class="meta">El administrador puede registrar una marca actual o corregir una marca de hoy o ayer.</p></section>`;
    const receiptSection = (state.restaurantNeeds || []).includes("receipts") ? `<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Comprobantes</div><div class="meta">Configura el sistema de impresión del restaurante.</div></div></div><button class="btn secondary" type="button" id="configure-printing">Configurar sistema de impresión</button></section>` : "";
    const moduleSettings = ((state.restaurantNeeds || []).includes("kitchen") || (state.restaurantNeeds || []).includes("salon") || ((state.restaurantNeeds || []).includes("delivery") && (state.restaurantNeeds || []).includes("kitchen"))) ? `<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Cierre de pedidos por Cocina y Salón</div><div class="meta">Estos ajustes aparecen solo para las necesidades activas.</div></div></div>${(state.restaurantNeeds || []).includes("kitchen") ? `${check("kitchen_has_separate_bar", "Tengo una barra separada de la cocina", v.kitchen_has_separate_bar)}<label class="settings-field">Cocina integra pedidos desde<select data-setting="kitchen_entry_mode"><option value="open" ${v.kitchen_entry_mode === "open" ? "selected" : ""}>Pedido abierto</option><option value="paid" ${v.kitchen_entry_mode === "paid" ? "selected" : ""}>Pedido pagado</option></select></label>` : ""}${(state.restaurantNeeds || []).includes("salon") ? `<label class="settings-field">Salón integra pedidos desde<select data-setting="salon_entry_mode"><option value="open" ${v.salon_entry_mode === "open" ? "selected" : ""}>Pedido abierto</option><option value="paid" ${v.salon_entry_mode === "paid" ? "selected" : ""}>Pedido pagado</option></select></label><div class="settings-checks">${check("salon_waiter_map_edit", "Mesero puede editar el mapa", v.salon_waiter_map_edit)}${check("salon_host_map_edit", "Portero puede editar el mapa", v.salon_host_map_edit)}${check("salon_show_seats", "Mostrar cantidad de sillas por piso", v.salon_show_seats)}</div><p class="meta">Define las sillas dentro de cada piso en el mapa. Es una referencia visual; no se editan posiciones de sillas.</p>` : ""}${(state.restaurantNeeds || []).includes("delivery") && (state.restaurantNeeds || []).includes("kitchen") ? check("delivery_kitchen_after_virtual_payment", "Delivery entra a Cocina cuando se confirma su pago virtual", v.delivery_kitchen_after_virtual_payment) : ""}</section>` : "";
    return `<div class="settings-save-bar" id="settings-save-bar" hidden><div class="settings-save-bar-inner"><button class="btn primary" id="save-restaurant-settings" type="button">Guardar cambios</button></div></div><section class="page-head"><div><div class="eyebrow">Administración</div><h1>Configuración</h1><p class="desc">Ajustes de las secciones fijas de tu restaurante.</p></div></section>${state.settingsError ? `<div class="inline-error" role="alert">${esc(state.settingsError)}</div>` : ""}<div class="settings-notice"><strong>Alcance de esta versión</strong><span>Los ajustes se guardan por restaurante. El cobro, las promociones y los límites aún requieren la migración del flujo operativo multi-restaurante para aplicarse a los pedidos.</span></div>${logoSection}${needsSection}${attendanceSettings}<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Métodos de pago</div><div class="meta">Activa los métodos que tu negocio recibe.</div></div></div><div class="settings-options">${paymentCards}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Cuentas</div><div class="meta">Nota personal de cada empleado.</div></div></div><div class="settings-form-grid"><label class="settings-field">Reinicio de la nota<select data-setting="employee_note_reset_mode"><option value="manual" ${v.employee_note_reset_mode === "manual" ? "selected" : ""}>Manual</option><option value="automatic" ${v.employee_note_reset_mode === "automatic" ? "selected" : ""}>Automático</option></select></label><label class="settings-field">Intervalo<select data-setting="employee_note_reset_days" ${v.employee_note_reset_mode !== "automatic" ? "disabled" : ""}>${[7,15,30].map((day) => `<option value="${day}" ${Number(v.employee_note_reset_days) === day ? "selected" : ""}>Cada ${day} días</option>`).join("")}</select></label></div><p class="meta">La nota no se borrará automáticamente hasta definir archivo, retención y fecha de reinicio.</p></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Estadísticas</div><div class="meta">Configura rankings visibles por rol.</div></div></div><div class="settings-checks">${check("rankings_enabled", "Habilitar rankings", v.rankings_enabled)}${check("rankings_products", "Productos más vendidos", v.rankings_products)}${check("rankings_variants", "Variantes más vendidas", v.rankings_variants)}${check("rankings_addons", "Agregados más vendidos", v.rankings_addons)}${check("rankings_categories", "Categorías más vendidas", v.rankings_categories, "disabled title='Disponible cuando el catálogo multi-restaurante esté migrado'")}${check("rankings_employees_enabled", "Empleados ven rankings", v.rankings_employees_enabled)}${check("rankings_same_for_all_roles", "Mismo conjunto para todos los roles", v.rankings_same_for_all_roles, v.rankings_employees_enabled ? "" : "disabled")}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Flujo de pedidos</div><div class="meta">Los límites y permisos se guardan para el restaurante.</div></div></div><div class="settings-form-grid">${check("order_minimum_enabled", "Usar importe mínimo", v.order_minimum_enabled)}${field("order_minimum_amount", "Importe mínimo (S/)", v.order_minimum_amount, v.order_minimum_enabled ? "required" : "disabled")}${check("order_minimum_admin", "Aplicar al administrador", v.order_minimum_admin)}${check("order_minimum_employees", "Aplicar a empleados", v.order_minimum_employees)}${check("order_maximum_enabled", "Usar importe máximo", v.order_maximum_enabled)}${field("order_maximum_amount", "Importe máximo (S/)", v.order_maximum_amount, v.order_maximum_enabled ? "required" : "disabled")}${check("order_maximum_admin", "Aplicar al administrador", v.order_maximum_admin)}${check("order_maximum_employees", "Aplicar a empleados", v.order_maximum_employees)}${check("corrections_admin", "Administrador puede corregir pagos", v.corrections_admin)}${check("corrections_employees", "Habilitar corrección de pagos a empleados", v.corrections_employees)}</div><div class="settings-role-list" id="settings-role-options" ${showRoles ? "" : "hidden"}><strong>Permisos por rol</strong>${roleRows}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Catálogo</div><div class="meta">Activa las herramientas que el restaurante necesita.</div></div></div><div class="settings-checks">${check("catalog_addons_enabled", "Agregados", v.catalog_addons_enabled)}${check("catalog_category_groups_enabled", "Grupos de categorías", v.catalog_category_groups_enabled)}${check("catalog_promotions_enabled", "Promociones", v.catalog_promotions_enabled)}</div><p class="meta">La administración y aplicación de promociones se habilitará junto con la migración del catálogo y el cobro.</p></section>${moduleSettings}${receiptSection}`;
  }
  function settingsSnapshot() {
    const controls = [
      ...document.querySelectorAll("[data-setting], [data-restaurant-need], #restaurant-logo-file, #restaurant-logo-remove"),
    ];
    return JSON.stringify(controls.map((input) => [
      input.dataset.setting || input.dataset.restaurantNeed || input.id,
      input.type === "checkbox" ? input.checked : input.type === "file"
        ? [...(input.files || [])].map((file) => [file.name, file.size, file.lastModified])
        : input.value,
    ]));
  }
  function syncSaveButton() {
    const button = document.getElementById("save-restaurant-settings");
    const bar = document.getElementById("settings-save-bar");
    if (!button || !bar) return;
    const dirty = savedSettingsSnapshot !== null && settingsSnapshot() !== savedSettingsSnapshot;
    button.disabled = settingsSaving || !dirty;
    bar.hidden = !dirty;
  }
  async function save() {
    const button = document.getElementById("save-restaurant-settings");
    if (!button || !supabase || state.roleKey !== "admin") return;
    settingsSaving = true;
    button.disabled = true;
    try {
      const v = { ...defaults, ...(state.restaurantSettings || {}) };
      document.querySelectorAll("[data-setting]").forEach((input) => {
        const key = input.dataset.setting;
        if (key.startsWith("payment:") || key.startsWith("role:")) return;
        v[key] = input.type === "checkbox" ? input.checked : input.type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value;
      });
      v.needs = [...document.querySelectorAll("[data-restaurant-need]:checked")].map((input) => input.dataset.restaurantNeed);
      const logoInput = document.getElementById("restaurant-logo-file");
      const logoFile = logoInput?.files?.[0] || null;
      const removeLogo = document.getElementById("restaurant-logo-remove")?.checked === true;
      if (logoFile && removeLogo) throw new Error("Elige un logo nuevo o marca quitar logo, no ambas opciones.");
      if (logoFile && (!new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]).has(logoFile.type) || logoFile.size > 5 * 1024 * 1024))
        throw new Error("El logo debe ser PNG, JPG, WebP o SVG y pesar hasta 5 MB.");
      if (v.order_minimum_enabled && (v.order_minimum_amount == null || v.order_minimum_amount < 0)) throw new Error("Indica un importe mínimo válido.");
      if (v.order_maximum_enabled && (v.order_maximum_amount == null || v.order_maximum_amount < 0)) throw new Error("Indica un importe máximo válido.");
      if (v.order_minimum_enabled && v.order_maximum_enabled && Number(v.order_minimum_amount) > Number(v.order_maximum_amount)) throw new Error("El importe mínimo no puede superar al máximo.");
      if (v.salon_show_seats && !state.restaurantSettings?.salon_show_seats && (state.restaurantNeeds || []).includes("salon")) {
        const confirmed = await configureFloorSeats();
        if (!confirmed) { settingsSaving = false; syncSaveButton(); return; }
      }
      let uploadedLogoPath = null;
      const oldLogoPath = state.restaurantLogoPath || null;
      if (logoFile) {
        uploadedLogoPath = `${state.restaurantId}/logo/${crypto.randomUUID()}`;
        const { error: uploadError } = await supabase.storage.from("restaurant-assets").upload(uploadedLogoPath, logoFile, {
          contentType: logoFile.type,
          cacheControl: "3600",
          upsert: false,
        });
        if (uploadError) throw uploadError;
        v.logo_path = uploadedLogoPath;
      } else if (removeLogo) {
        v.logo_path = null;
      } else {
        v.logo_path = oldLogoPath;
      }
      const restaurantResult = await supabase.from("restaurants").update(v).eq("id", state.restaurantId);
      if (restaurantResult.error) {
        if (uploadedLogoPath) await supabase.storage.from("restaurant-assets").remove([uploadedLogoPath]);
        throw restaurantResult.error;
      }
      if (oldLogoPath && oldLogoPath !== v.logo_path) {
        const { error: removeError } = await supabase.storage.from("restaurant-assets").remove([oldLogoPath]);
        if (removeError) toast("El logo nuevo se guardó; no se pudo borrar el archivo anterior.");
      }
      for (const method of methods) {
        const read = (suffix) => document.querySelector(`[data-setting="payment:${method.key}:${suffix}"]`)?.checked || false;
        const requiredCash = method.key === "cash";
        const enabled = requiredCash || read("enabled");
        const payload = { restaurant_id: state.restaurantId, method_key: method.key, enabled, manual_enabled: requiredCash || (enabled && read("manual")), automatic_enabled: !requiredCash && enabled && read("automatic"), updated_at: new Date().toISOString() };
        if (!method.automatic) payload.automatic_enabled = false;
        if (!method.manual) payload.manual_enabled = false;
        const result = await supabase.from("restaurant_payment_methods").upsert(payload, { onConflict: "restaurant_id,method_key" });
        if (result.error) throw result.error;
      }
      for (const role of state.settingRoles || []) {
        if (role.key === "admin") continue;
        const current = state.roleSettings?.[role.id] || roleDefaults(role);
        const payload = { ...roleDefaults(role) };
        for (const key of Object.keys(payload).filter((key) => key !== "restaurant_id" && key !== "role_id")) {
          const input = document.querySelector(`[data-setting="role:${role.id}:${key}"]`);
          payload[key] = input ? input.checked : Boolean(current[key]);
        }
        const result = await supabase.from("restaurant_role_settings").upsert(payload, { onConflict: "restaurant_id,role_id" });
        if (result.error) throw result.error;
      }
      state.restaurantSettings = v;
      await load();
      settingsSaving = false;
      toast("Configuración guardada.");
      render();
    } catch (error) {
      settingsSaving = false;
      toast(error.message || "No se pudo guardar la configuración.");
      syncSaveButton();
    }
  }
  function bind() {
    const saveButton = document.getElementById("save-restaurant-settings");
    savedSettingsSnapshot = settingsSnapshot();
    syncSaveButton();
    saveButton?.addEventListener("click", save);
    document.querySelectorAll("[data-setting], [data-restaurant-need], #restaurant-logo-file, #restaurant-logo-remove").forEach((input) => {
      input.addEventListener("input", syncSaveButton);
      input.addEventListener("change", syncSaveButton);
    });
    document.getElementById("restaurant-logo-file")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      const preview = document.getElementById("restaurant-logo-preview");
      if (!file || !preview) return;
      const previousUrl = preview.dataset.objectUrl;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      const url = URL.createObjectURL(file);
      preview.dataset.objectUrl = url;
      preview.innerHTML = `<img src="${url}" alt="Vista previa del logo">`;
      const remove = document.getElementById("restaurant-logo-remove");
      if (remove) remove.checked = false;
    });
    document.getElementById("restaurant-logo-remove")?.addEventListener("change", (event) => {
      const input = document.getElementById("restaurant-logo-file");
      const preview = document.getElementById("restaurant-logo-preview");
      if (event.target.checked && input) input.value = "";
      if (preview) preview.innerHTML = event.target.checked
        ? "<span>Se quitará el logo</span>"
        : state.restaurantLogoUrl
          ? `<img src="${esc(state.restaurantLogoUrl)}" alt="Logo del restaurante">`
          : "<span>Logo</span>";
    });
    document.getElementById("configure-printing")?.addEventListener("click", () => {
      const dialog = document.createElement("dialog");
      dialog.className = "password-dialog";
      dialog.innerHTML = `<div class="panel-title">Sistema de impresión</div><p>Próximamente</p><p class="meta">La configuración de impresión estará disponible en una próxima versión.</p><div class="dialog-actions"><button class="btn primary" type="button">Entendido</button></div>`;
      document.body.appendChild(dialog); dialog.showModal();
      dialog.querySelector("button").onclick = () => dialog.close();
      dialog.addEventListener("close", () => dialog.remove());
    });
    methods.forEach((method) => document.querySelector(`[data-setting="payment:${method.key}:enabled"]`)?.addEventListener("change", (event) => {
      if (method.key === "cash") { event.target.checked = true; return; }
      const manual = document.querySelector(`[data-setting="payment:${method.key}:manual"]`);
      if (manual) manual.disabled = !event.target.checked;
    }));
    document.querySelector('[data-setting="rankings_employees_enabled"]')?.addEventListener("change", (event) => {
      const shared = document.querySelector('[data-setting="rankings_same_for_all_roles"]');
      if (shared) shared.disabled = !event.target.checked;
    });
    document.querySelector('[data-setting="rankings_enabled"]')?.addEventListener("change", (event) => {
      if (!event.target.checked) return;
      const rankingChoices = ["products", "variants", "addons"]
        .map((key) => document.querySelector(`[data-setting="rankings_${key}"]`))
        .filter(Boolean);
      if (rankingChoices.length && !rankingChoices.some((input) => input.checked)) {
        rankingChoices[0].checked = true;
        syncSaveButton();
      }
    });
    document.querySelector('[data-setting="employee_note_reset_mode"]')?.addEventListener("change", (event) => {
      const days = document.querySelector('[data-setting="employee_note_reset_days"]');
      if (days) days.disabled = event.target.value !== "automatic";
    });
    const refreshRoleVisibility = () => {
      const visible = (document.querySelector('[data-setting="rankings_employees_enabled"]')?.checked && !document.querySelector('[data-setting="rankings_same_for_all_roles"]')?.checked) || document.querySelector('[data-setting="order_minimum_employees"]')?.checked || document.querySelector('[data-setting="order_maximum_employees"]')?.checked || document.querySelector('[data-setting="corrections_employees"]')?.checked;
      const section = document.getElementById("settings-role-options");
      if (section) section.hidden = !visible;
    };
    ["rankings_employees_enabled", "rankings_same_for_all_roles", "order_minimum_employees", "order_maximum_employees", "corrections_employees"].forEach((key) => document.querySelector(`[data-setting="${key}"]`)?.addEventListener("change", refreshRoleVisibility));
    ["order_minimum_enabled", "order_maximum_enabled"].forEach((key) => document.querySelector(`[data-setting="${key}"]`)?.addEventListener("change", (event) => {
      const amount = document.querySelector(`[data-setting="${key.replace("_enabled", "_amount")}"]`);
      if (amount) amount.disabled = !event.target.checked;
    }));
  }
  return { load, render: renderPage, bind };
}
