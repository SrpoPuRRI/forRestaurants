import { ALLOWED_FONTS, DEFAULT_COLOR_THEMES } from "./appearance.js?v=20261113-appearance-builder";

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
  const defaults = {
    appearance: { color_schemes: [], active_color_scheme_id: null },
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
  const safeHex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
  const TICKET_FORMAT_DEFAULTS = Object.freeze({
    margin_top_mm: 0, margin_right_mm: 0, margin_bottom_mm: 0, margin_left_mm: 0,
    min_height_mm: 0, font_family: "device", font_size_pt: 12,
    line_spacing: "normal", density: "normal", text_depth: "standard",
    feed_before_mm: 0, feed_after_mm: 3, cut_mode: "partial",
  });
  const TICKET_SECTION_ORDER = Object.freeze([
    "brand", "header", "event_title", "location", "order_datetime", "operator",
    "table", "status", "establishment_ruc", "note", "items", "payment_breakdown", "total", "footer",
  ]);
  const TICKET_SECTION_LABELS = Object.freeze({
    brand: "Identidad de la app", header: "Encabezado", event_title: "Título del pedido",
    location: "Sede", order_datetime: "Fecha y hora", operator: "Empleado", table: "Mesa",
    status: "Estado del pedido", establishment_ruc: "RUC del establecimiento", note: "Nota",
    items: "Desglose del pedido", payment_breakdown: "Desglose de pago", total: "Total", footer: "Pie del ticket",
  });

  async function load() {
    if (!supabase || !state.restaurantId) return;
    state.settingsLoading = true;
    const [restaurant, roles, payments, roleSettings, points, flows, routes, templates, devices] = await Promise.all([
      supabase.from("restaurants").select(`${Object.keys(defaults).join(",")},needs,available_role_ids,logo_path`).eq("id", state.restaurantId).single(),
      supabase.from("roles").select("id,key,name,permissions,sort_order").order("sort_order"),
      supabase.from("restaurant_payment_methods").select("method_key,enabled,manual_enabled,automatic_enabled").eq("restaurant_id", state.restaurantId),
      supabase.from("restaurant_role_settings").select("*").eq("restaurant_id", state.restaurantId),
      supabase.from("printing_points").select("*").eq("restaurant_id", state.restaurantId).order("created_at"),
      supabase.from("printing_flows").select("*").eq("restaurant_id", state.restaurantId).order("created_at"),
      supabase.from("printing_flow_routes").select("*").eq("restaurant_id", state.restaurantId).order("sort_order"),
      supabase.from("printing_ticket_templates").select("*").eq("restaurant_id", state.restaurantId).order("created_at"),
      supabase.from("printing_devices").select("id,hardware_key,model,display_name,serial_number,network_name,ip_address,tcp_port,connection_type,last_seen_at,operation_mode").eq("restaurant_id", state.restaurantId).order("created_at"),
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
    const devicesById = new Map((devices.data || []).map((device) => [device.id, device]));
    state.printingPoints = points.error ? [] : (points.data || []).map((point) => ({
      ...point,
      device: devicesById.get(point.device_id) || null,
      device_deprecated: !devices.error && Boolean(point.device_id) && !devicesById.has(point.device_id),
    }));
    state.printingFlows = flows.error ? [] : (flows.data || []);
    state.printingFlowRoutes = routes.error ? [] : (routes.data || []);
    state.printingTicketTemplates = templates.error ? [] : (templates.data || []);
    state.printingDevices = devices.error ? [] : (devices.data || []);
    state.printingDevicesLoaded = !devices.error;
    const printingLoadErrors = [
      ["puntos", points.error], ["flujos", flows.error], ["rutas", routes.error],
      ["formatos", templates.error], ["dispositivos", devices.error],
    ].filter(([, queryError]) => queryError)
      .map(([section, queryError]) => {
        const detail = [queryError.message, queryError.code && `código ${queryError.code}`, queryError.details, queryError.hint && `sugerencia: ${queryError.hint}`]
          .filter(Boolean).join(" · ");
        return `${section}: ${detail || "error desconocido"}`;
      });
    state.printingSettingsError = printingLoadErrors.length
      ? `No se pudieron cargar los ajustes de impresión (${printingLoadErrors.join("; ")}).`
      : "";
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
  const colorFields = [
    ["background", "Fondo de la aplicación"], ["surface", "Paneles y tarjetas"],
    ["surfaceAlt", "Barras y superficies secundarias"], ["text", "Texto principal"],
    ["muted", "Texto secundario"], ["border", "Bordes"],
    ["button", "Botones principales"], ["buttonText", "Texto de botones"],
    ["accent", "Acento"],
  ];
  function currentAppearance() {
    const appearance = state.restaurantSettings?.appearance || {};
    return {
      color_schemes: Array.isArray(appearance.color_schemes) ? appearance.color_schemes : [],
      active_color_scheme_id: appearance.active_color_scheme_id || null,
    };
  }
  function colorSchemeCards(selectedId = currentAppearance().active_color_scheme_id) {
    const appearance = currentAppearance();
    const schemes = appearance.color_schemes.map((scheme) => {
      const theme = scheme.light || DEFAULT_COLOR_THEMES.light;
      return `<label class="color-scheme-card ${selectedId === scheme.id ? "selected" : ""}"><input type="radio" name="active-color-scheme" data-active-color-scheme value="${esc(scheme.id)}" ${selectedId === scheme.id ? "checked" : ""}><span class="color-scheme-swatches" style="--scheme-background:${safeHex(theme.background, "#f4f1ea")};--scheme-surface:${safeHex(theme.surface, "#fffefa")};--scheme-button:${safeHex(theme.button, "#20211f")};--scheme-accent:${safeHex(theme.accent, "#b64b36")}"><i></i><i></i><i></i><i></i></span><span class="color-scheme-card-copy"><strong>${esc(scheme.name)}</strong><small>${selectedId === scheme.id ? "Seleccionado" : "Usar esquema"}</small></span></label>`;
    }).join("");
    return `${schemes}<button class="color-scheme-create" type="button" id="create-color-scheme"><span class="color-scheme-create-icon" aria-hidden="true">+</span><strong>Crear esquema</strong></button>`;
  }
  function bindColorSchemeCards() {
    document.querySelectorAll("[data-active-color-scheme]").forEach((radio) => {
      radio.addEventListener("change", () => {
        document.querySelectorAll(".color-scheme-card").forEach((card) => card.classList.toggle("selected", card.querySelector("input")?.checked));
        const reset = document.getElementById("clear-active-color-scheme");
        if (reset) { reset.hidden = false; reset.disabled = false; reset.textContent = "Usar colores predeterminados"; }
        syncSaveButton();
      });
    });
    document.getElementById("clear-active-color-scheme")?.addEventListener("click", (event) => {
      document.querySelectorAll("[data-active-color-scheme]").forEach((radio) => { radio.checked = false; });
      document.querySelectorAll(".color-scheme-card").forEach((card) => card.classList.remove("selected"));
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = "Colores predeterminados seleccionados";
      syncSaveButton();
    });
    document.getElementById("create-color-scheme")?.addEventListener("click", openColorSchemeEditor);
  }
  function readEditorTheme(dialog, draft, mode) {
    const theme = { ...draft[mode] };
    dialog.querySelectorAll("[data-theme-value]").forEach((input) => {
      const key = input.dataset.themeValue;
      theme[key] = input.type === "number" ? Math.min(18, Math.max(12, Number(input.value) || 14)) : input.value;
    });
    draft[mode] = theme;
  }
  function themeEditorFields(theme) {
    const colors = colorFields.map(([key, label]) => `<label class="theme-editor-color"><span>${label}</span><input type="color" data-theme-value="${key}" value="${esc(theme[key])}"></label>`).join("");
    const fonts = ALLOWED_FONTS.map((font) => `<option value="${esc(font)}" ${theme.font === font ? "selected" : ""}>${esc(font)}</option>`).join("");
    return `<div class="theme-editor-colors">${colors}</div><div class="theme-editor-options"><label class="settings-field">Tipografía<select data-theme-value="font">${fonts}</select></label><label class="settings-field">Tamaño del texto<input type="number" min="12" max="18" step="1" data-theme-value="fontSize" value="${Number(theme.fontSize) || 14}"></label><label class="settings-field">Tamaño de los botones<select data-theme-value="buttonSize"><option value="small" ${theme.buttonSize === "small" ? "selected" : ""}>Compacto</option><option value="medium" ${!theme.buttonSize || theme.buttonSize === "medium" ? "selected" : ""}>Mediano</option><option value="large" ${theme.buttonSize === "large" ? "selected" : ""}>Grande</option></select></label></div>`;
  }
  function openColorSchemeEditor() {
    const draft = {
      light: { ...DEFAULT_COLOR_THEMES.light },
      dark: { ...DEFAULT_COLOR_THEMES.dark },
    };
    const dialog = document.createElement("dialog");
    dialog.className = "password-dialog color-scheme-editor";
    dialog.innerHTML = `<div class="color-scheme-editor-head"><div><div class="panel-title">Crear esquema de colores</div><p class="meta">Guárdalo para poder seleccionarlo después en Configuración.</p></div><button type="button" class="dialog-close" aria-label="Cerrar">×</button></div><label class="settings-field">Nombre del esquema<input type="text" id="color-scheme-name" maxlength="40" placeholder="Ej. El Sabor"></label><div class="theme-editor-tabs" role="tablist"><button type="button" class="active" role="tab" aria-selected="true" data-theme-tab="light">Claro</button><button type="button" role="tab" aria-selected="false" data-theme-tab="dark">Oscuro</button></div><div id="theme-editor-fields">${themeEditorFields(draft.light)}</div><div class="theme-editor-preview" id="theme-editor-preview"><span>Vista previa</span><button type="button">Botón</button></div><p class="appearance-editor-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="button" class="btn primary" data-save>Guardar esquema</button></div>`;
    document.body.appendChild(dialog);
    let mode = "light";
    const updatePreview = () => {
      readEditorTheme(dialog, draft, mode);
      const theme = draft[mode];
      const preview = dialog.querySelector("#theme-editor-preview");
      preview.style.setProperty("--preview-bg", theme.background);
      preview.style.setProperty("--preview-surface", theme.surface);
      preview.style.setProperty("--preview-text", theme.text);
      preview.style.setProperty("--preview-button", theme.button);
      preview.style.setProperty("--preview-button-text", theme.buttonText);
    };
    const renderTab = (nextMode) => {
      readEditorTheme(dialog, draft, mode);
      mode = nextMode;
      dialog.querySelectorAll("[data-theme-tab]").forEach((tab) => {
        const active = tab.dataset.themeTab === mode;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      dialog.querySelector("#theme-editor-fields").innerHTML = themeEditorFields(draft[mode]);
      dialog.querySelectorAll("[data-theme-value]").forEach((input) => input.addEventListener("input", updatePreview));
      updatePreview();
    };
    dialog.querySelectorAll("[data-theme-tab]").forEach((tab) => tab.addEventListener("click", () => renderTab(tab.dataset.themeTab)));
    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.querySelector("[data-save]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const name = dialog.querySelector("#color-scheme-name").value.trim();
      const error = dialog.querySelector(".appearance-editor-error");
      error.textContent = "";
      if (!name) {
        error.textContent = "Escribe un nombre para el esquema.";
        dialog.querySelector("#color-scheme-name").focus();
        return;
      }
      readEditorTheme(dialog, draft, mode);
      const currentSelection = document.querySelector("[data-active-color-scheme]:checked")?.value || currentAppearance().active_color_scheme_id;
      const appearance = currentAppearance();
      const schema = { id: crypto.randomUUID(), name, light: draft.light, dark: draft.dark };
      const nextAppearance = { ...appearance, color_schemes: [...appearance.color_schemes, schema] };
      button.disabled = true;
      try {
        const { error: saveError } = await supabase.from("restaurants").update({ appearance: nextAppearance }).eq("id", state.restaurantId);
        if (saveError) throw saveError;
        state.restaurantSettings.appearance = nextAppearance;
        dialog.close();
        const container = document.getElementById("color-scheme-list");
        if (container) {
          container.innerHTML = colorSchemeCards(currentSelection);
          bindColorSchemeCards();
        }
        syncSaveButton();
        toast("Esquema guardado.");
      } catch (saveError) {
        error.textContent = saveError.message || "No se pudo guardar el esquema.";
        button.disabled = false;
      }
    });
    dialog.showModal();
    dialog.querySelector("#color-scheme-name").focus();
    dialog.querySelectorAll("[data-theme-value]").forEach((input) => input.addEventListener("input", updatePreview));
    updatePreview();
  }
  function renderPage() {
    if (state.settingsLoading) return '<section class="panel"><div class="empty">Cargando configuración…</div></section>';
    const v = { ...defaults, ...(state.restaurantSettings || {}) };
    const paymentCards = methods.map((m) => {
      const p = state.paymentSettings?.[m.key] || {};
      const requiredCash = m.key === "cash";
      return `<article class="settings-option"><div><strong>${m.label}</strong><p class="meta">${requiredCash ? "Siempre disponible y obligatorio para todos los restaurantes." : m.automatic ? "El modo automático se habilitará al integrar un proveedor de pagos." : "Método disponible para registrar manualmente."}</p></div><div class="settings-checks">${check(`payment:${m.key}:enabled`, "Activado", requiredCash || p.enabled, requiredCash ? "disabled" : "")}${m.manual ? check(`payment:${m.key}:manual`, "Manual", requiredCash || p.manual_enabled, requiredCash || p.enabled ? (requiredCash ? "disabled" : "") : "disabled") : ""}${m.automatic ? check(`payment:${m.key}:automatic`, "Automático", p.automatic_enabled, "disabled title='Pendiente integrar proveedor de pagos'") : ""}</div></article>`;
    }).join("");
    const roleStatisticsRows = (state.settingRoles || []).filter((role) => role.key !== "admin").map((role) => {
      const rs = state.roleSettings?.[role.id] || roleDefaults(role);
      return `<details class="settings-role"><summary>${esc(role.name)} <span class="meta">Editar visibilidad</span></summary><div class="settings-checks">${check(`role:${role.id}:rankings_products`, "Productos más vendidos", rs.rankings_products)}${check(`role:${role.id}:rankings_variants`, "Variantes más vendidas", rs.rankings_variants)}${check(`role:${role.id}:rankings_addons`, "Agregados más vendidos", rs.rankings_addons)}${check(`role:${role.id}:rankings_categories`, "Categorías más vendidas", rs.rankings_categories)}${check(`role:${role.id}:order_minimum_allowed`, "Ver pedido de menor importe en Estadísticas", rs.order_minimum_allowed)}${check(`role:${role.id}:order_maximum_allowed`, "Ver pedido de mayor importe en Estadísticas", rs.order_maximum_allowed)}</div></details>`;
    }).join("");
    const correctionRoleRows = (state.settingRoles || []).filter((role) => role.key !== "admin").map((role) => {
      const rs = state.roleSettings?.[role.id] || roleDefaults(role);
      return `<details class="settings-role"><summary>${esc(role.name)} <span class="meta">Editar permisos</span></summary><div class="settings-checks">${check(`role:${role.id}:corrections_allowed`, "Puede corregir pagos", rs.corrections_allowed)}</div></details>`;
    }).join("");
    const showStatisticsRoles = (v.rankings_employees_enabled && !v.rankings_same_for_all_roles) || v.order_minimum_employees || v.order_maximum_employees;
    const showCorrectionRoles = v.corrections_employees;
    const logoSection = `<div class="restaurant-logo-setting"><div class="restaurant-logo-preview" id="restaurant-logo-preview">${state.restaurantLogoUrl ? `<img src="${esc(state.restaurantLogoUrl)}" alt="Logo del restaurante">` : '<span>Logo</span>'}</div><div class="restaurant-logo-controls"><div class="logo-drop-zone" id="logo-drop-zone" role="button" tabindex="0" aria-label="Arrastra una imagen o elige un archivo"><input id="restaurant-logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3"/></svg><strong id="logo-drop-title">Arrastra y suelta tu logo</strong><span id="logo-drop-status">o <button type="button" class="logo-browse" id="choose-restaurant-logo">elige un archivo</button></span><small>PNG, JPG, WebP o SVG · máximo 5 MB · Resolución de imagen recomendada: 512 × 512 px</small></div><p class="logo-upload-error" id="logo-upload-error" role="alert"></p>${state.restaurantLogoPath ? '<label class="settings-check"><input id="restaurant-logo-remove" type="checkbox"><span>Quitar logo</span></label>' : ""}</div></div>`;
    const needChoices = [["crm","CRM"],["kitchen","Cocina"],["salon","Salón"],["delivery","Delivery"],["printing_systems","Sistemas de Impresión"]];
    const needsSection = `<div class="settings-general-needs"><div class="panel-title">Necesidades del restaurante</div><div class="meta">Activa los espacios de trabajo que usa tu restaurante.</div><div class="settings-checks">${needChoices.map(([key,label]) => `<label class="settings-check"><input type="checkbox" data-restaurant-need="${key}" ${(state.restaurantNeeds || []).includes(key) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div></div>`;
    const appearanceSection = `<div class="settings-general-personalization"><div class="panel-head"><div><div class="panel-title">Personalización</div><div class="meta">Crea esquemas propios o selecciona uno para todo tu restaurante.</div></div><button type="button" class="rowaction" id="clear-active-color-scheme" ${v.appearance?.active_color_scheme_id ? "" : "hidden disabled"}>Usar colores predeterminados</button></div><div class="color-scheme-grid" id="color-scheme-list">${colorSchemeCards(v.appearance?.active_color_scheme_id)}</div><p class="meta">Sin un esquema seleccionado, se usan los colores predeterminados de Black&amp;White.</p></div>`;
    const generalSection = `<section class="panel settings-panel settings-general-panel"><div class="panel-head"><div><div class="panel-title">General</div><div class="meta">Personaliza la identidad y las necesidades de tu restaurante.</div></div></div>${logoSection}${appearanceSection}${needsSection}</section>`;
    const attendanceSettings = `<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Asistencia</div><div class="meta">Define quién puede marcar entradas y salidas.</div></div></div><div class="settings-checks">${check("attendance_check_in_self", "Cada persona puede marcar su propia entrada", v.attendance_check_in_self)}${check("attendance_check_in_peer_at_location", "Un compañero puede marcar la entrada desde la misma sede", v.attendance_check_in_peer_at_location)}${check("attendance_check_out_self", "Cada persona puede marcar su propia salida", v.attendance_check_out_self)}${check("attendance_check_out_peer_at_location", "Un compañero puede marcar la salida desde la misma sede", v.attendance_check_out_peer_at_location)}</div><p class="meta">El administrador puede registrar una marca actual o corregir una marca de hoy o ayer.</p></section>`;
    const printingSection = (state.restaurantNeeds || []).includes("printing_systems") ? renderPrintingSettings() : "";
    const sunatComingSoon = `<section class="panel settings-panel settings-coming-soon"><div class="panel-head"><div><div class="panel-title">Configuración SUNAT</div><div class="meta">La integración de comprobantes electrónicos se configurará por separado de los sistemas de impresión.</div></div><span class="coming-soon-badge">Próximamente</span></div></section>`;
    const moduleSettings = ((state.restaurantNeeds || []).includes("kitchen") || (state.restaurantNeeds || []).includes("salon") || ((state.restaurantNeeds || []).includes("delivery") && (state.restaurantNeeds || []).includes("kitchen"))) ? `<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Cierre de pedidos por Cocina y Salón</div><div class="meta">Estos ajustes aparecen solo para las necesidades activas.</div></div></div>${(state.restaurantNeeds || []).includes("kitchen") ? `${check("kitchen_has_separate_bar", "Tengo una barra separada de la cocina", v.kitchen_has_separate_bar)}<label class="settings-field">Cocina integra pedidos desde<select data-setting="kitchen_entry_mode"><option value="open" ${v.kitchen_entry_mode === "open" ? "selected" : ""}>Pedido abierto</option><option value="paid" ${v.kitchen_entry_mode === "paid" ? "selected" : ""}>Pedido pagado</option></select></label>` : ""}${(state.restaurantNeeds || []).includes("salon") ? `<label class="settings-field">Salón integra pedidos desde<select data-setting="salon_entry_mode"><option value="open" ${v.salon_entry_mode === "open" ? "selected" : ""}>Pedido abierto</option><option value="paid" ${v.salon_entry_mode === "paid" ? "selected" : ""}>Pedido pagado</option></select></label><div class="settings-checks">${check("salon_waiter_map_edit", "Mesero puede editar el mapa", v.salon_waiter_map_edit)}${check("salon_host_map_edit", "Portero puede editar el mapa", v.salon_host_map_edit)}${check("salon_show_seats", "Mostrar cantidad de sillas por piso", v.salon_show_seats)}</div><p class="meta">Define las sillas dentro de cada piso en el mapa. Es una referencia visual; no se editan posiciones de sillas.</p>` : ""}${(state.restaurantNeeds || []).includes("delivery") && (state.restaurantNeeds || []).includes("kitchen") ? check("delivery_kitchen_after_virtual_payment", "Delivery entra a Cocina cuando se confirma su pago virtual", v.delivery_kitchen_after_virtual_payment) : ""}</section>` : "";
    return `<div class="settings-save-bar" id="settings-save-bar" hidden><div class="settings-save-bar-inner"><button class="btn primary" id="save-restaurant-settings" type="button">Guardar cambios</button></div></div><section class="page-head"><div><div class="eyebrow">Administración</div><h1>Configuración</h1><p class="desc">Ajustes de las secciones fijas de tu restaurante.</p></div></section>${state.settingsError ? `<div class="inline-error" role="alert">${esc(state.settingsError)}</div>` : ""}${generalSection}${attendanceSettings}<section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Métodos de pago</div><div class="meta">Activa los métodos que tu negocio recibe.</div></div></div><div class="settings-options">${paymentCards}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Cuentas</div><div class="meta">Nota personal de cada empleado.</div></div></div><div class="settings-form-grid"><label class="settings-field">Reinicio de la nota<select data-setting="employee_note_reset_mode"><option value="manual" ${v.employee_note_reset_mode === "manual" ? "selected" : ""}>Manual</option><option value="automatic" ${v.employee_note_reset_mode === "automatic" ? "selected" : ""}>Automático</option></select></label><label class="settings-field">Intervalo<select data-setting="employee_note_reset_days" ${v.employee_note_reset_mode !== "automatic" ? "disabled" : ""}>${[7,15,30].map((day) => `<option value="${day}" ${Number(v.employee_note_reset_days) === day ? "selected" : ""}>Cada ${day} días</option>`).join("")}</select></label></div><p class="meta">La nota no se borrará automáticamente hasta definir archivo, retención y fecha de reinicio.</p></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Estadísticas</div><div class="meta">Configura rankings y los importes de los pedidos visibles por rol.</div></div></div><div class="settings-checks">${check("rankings_enabled", "Habilitar rankings", v.rankings_enabled)}${check("rankings_products", "Productos más vendidos", v.rankings_products)}${check("rankings_variants", "Variantes más vendidas", v.rankings_variants)}${check("rankings_addons", "Agregados más vendidos", v.rankings_addons)}${check("rankings_categories", "Categorías más vendidas", v.rankings_categories, "disabled title='Disponible cuando el catálogo multi-restaurante esté migrado'")}${check("rankings_employees_enabled", "Empleados ven rankings", v.rankings_employees_enabled)}${check("rankings_same_for_all_roles", "Mismo conjunto para todos los roles", v.rankings_same_for_all_roles, v.rankings_employees_enabled ? "" : "disabled")}</div><div class="settings-form-grid settings-stat-order-options"><div class="settings-stat-order-option"><strong>Pedido de menor importe</strong><div class="settings-checks">${check("order_minimum_enabled", "Mostrar en Estadísticas", v.order_minimum_enabled)}${check("order_minimum_admin", "Administrador puede verlo", v.order_minimum_admin)}${check("order_minimum_employees", "Empleados pueden verlo", v.order_minimum_employees)}</div></div><div class="settings-stat-order-option"><strong>Pedido de mayor importe</strong><div class="settings-checks">${check("order_maximum_enabled", "Mostrar en Estadísticas", v.order_maximum_enabled)}${check("order_maximum_admin", "Administrador puede verlo", v.order_maximum_admin)}${check("order_maximum_employees", "Empleados pueden verlo", v.order_maximum_employees)}</div></div></div><div class="settings-role-list" id="settings-role-options" ${showStatisticsRoles ? "" : "hidden"}><strong>Permisos de estadísticas por rol</strong>${roleStatisticsRows}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Flujo de pedidos</div><div class="meta">Controla quién puede corregir pagos registrados por error.</div></div></div><div class="settings-checks">${check("corrections_admin", "Administrador puede corregir pagos", v.corrections_admin)}${check("corrections_employees", "Habilitar corrección de pagos a empleados", v.corrections_employees)}</div><div class="settings-role-list" id="settings-correction-role-options" ${showCorrectionRoles ? "" : "hidden"}><strong>Roles que pueden corregir pagos</strong>${correctionRoleRows}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Catálogo</div><div class="meta">Activa las herramientas que el restaurante necesita.</div></div></div><div class="settings-checks">${check("catalog_addons_enabled", "Agregados", v.catalog_addons_enabled)}${check("catalog_category_groups_enabled", "Grupos de categorías", v.catalog_category_groups_enabled)}${check("catalog_promotions_enabled", "Promociones", v.catalog_promotions_enabled)}</div><p class="meta">La administración y aplicación de promociones se habilitará junto con la migración del catálogo y el cobro.</p></section>${moduleSettings}${printingSection}${sunatComingSoon}`;
  }
  function settingsSnapshot() {
    const controls = [
      ...document.querySelectorAll("[data-setting], [data-restaurant-need], #restaurant-logo-file, #restaurant-logo-remove"),
    ];
    return JSON.stringify([
      ...controls.map((input) => [
        input.dataset.setting || input.dataset.restaurantNeed || input.id,
        input.type === "checkbox" ? input.checked : input.type === "file"
          ? [...(input.files || [])].map((file) => [file.name, file.size, file.lastModified])
          : input.value,
      ]),
      ["activeColorScheme", document.querySelector("[data-active-color-scheme]:checked")?.value || ""],
    ]);
  }
  function syncSaveButton() {
    const button = document.getElementById("save-restaurant-settings");
    const bar = document.getElementById("settings-save-bar");
    if (!button || !bar) return;
    const dirty = savedSettingsSnapshot !== null && settingsSnapshot() !== savedSettingsSnapshot;
    button.disabled = settingsSaving || !dirty;
    bar.hidden = !dirty;
  }
  function confirmNeedRemoval(input, needName) {
    input.checked = true;
    syncSaveButton();
    const dialog = document.createElement("dialog");
    dialog.className = "password-dialog settings-need-dialog";
    dialog.innerHTML = `<form method="dialog"><div class="panel-title">Cambiar las necesidades de tu restaurante</div><p class="meta">Cambiar las necesidades de tu restaurante es un cambio de arquitectura. Puede afectar la forma en que se guardan cosas en la base de datos y tu acceso a roles y necesidades. Los empleados que posean roles que ya no existan pasarán a tener un rol genérico (Empleado).</p><p class="meta">¿Estás seguro de que quieres desmarcar ${esc(needName)}?</p><div class="dialog-actions"><button class="btn secondary" type="button" data-cancel>Cancelar</button><button class="btn primary" type="button" data-accept>Aceptar</button></div></form>`;
    document.body.appendChild(dialog);
    dialog.showModal();
    const close = (accepted) => {
      if (accepted) input.checked = false;
      dialog.close();
      syncSaveButton();
    };
    dialog.querySelector("[data-cancel]").addEventListener("click", () => close(false));
    dialog.querySelector("[data-accept]").addEventListener("click", () => close(true));
    dialog.addEventListener("close", () => {
      dialog.remove();
      syncSaveButton();
    }, { once: true });
  }
  const PRINT_EVENTS = [
    ["open_order_created", "Pedido abierto creado"],
    ["open_order_updated", "Pedido abierto actualizado"],
    ["paid_order_created", "Pedido pagado"],
    ["payment_corrected", "Pago corregido"],
    ["kitchen_order_ready", "Pedido listo en cocina"],
    ["salon_order_delivered", "Pedido entregado en salón"],
    ["manual_reprint", "Reimpresión manual"],
  ];
  const PRINT_EVENT_DATA_OBJECTS = Object.freeze({
    open_order_created: [{ key: "open_order", label: "Pedido abierto recién creado" }],
    open_order_updated: [{ key: "open_order", label: "Pedido abierto actualizado" }],
    paid_order_created: [
      { key: "paid_order", label: "Pedido pagado" },
      { key: "open_order", label: "Pedido abierto antes del pago" },
    ],
    payment_corrected: [
      { key: "paid_order", label: "Pedido pagado con la corrección" },
      { key: "payment", label: "Resumen de pago corregido" },
    ],
    kitchen_order_ready: [
      { key: "items", label: "Pedido y productos para cocina" },
      { key: "event", label: "Datos completos del evento de cocina" },
    ],
    salon_order_delivered: [
      { key: "items", label: "Pedido y productos entregados" },
      { key: "event", label: "Datos completos del evento de salón" },
    ],
    manual_reprint: [{ key: "paid_order", label: "Pedido pagado seleccionado para reimpresión" }],
  });
  const printEventLabel = (key) => PRINT_EVENTS.find(([eventKey]) => eventKey === key)?.[1] || key;
  function printingPointIsDeprecated(point) {
    if (!point?.device_id) return false;
    if (point.device_deprecated === true) return true;
    if (state.printingDevicesLoaded === true)
      return !(state.printingDevices || []).some((device) => device.id === point.device_id);
    if (state.printingDeviceStatusesLoaded === true)
      return !(state.printingDeviceStatuses || []).some((device) => device.id === point.device_id);
    return false;
  }
  function printingFlowNeedsUpdate(flowId) {
    const routes = (state.printingFlowRoutes || []).filter((route) => route.flow_id === flowId && route.event_keys?.length);
    return routes.some((route) => {
      const point = (state.printingPoints || []).find((item) => item.id === route.point_id);
      return !point || !point.device_id || printingPointIsDeprecated(point);
    });
  }
  function printingArea(title, description, cards, actionId, actionLabel) {
    return `<section class="printing-config-area"><div class="printing-config-area-head"><div><h3>${title}</h3><p class="meta">${description}</p></div></div><div class="printing-config-grid">${cards}<button type="button" class="printing-create-card" id="${actionId}"><span aria-hidden="true">＋</span><strong>${actionLabel}</strong></button></div></section>`;
  }
  function printingPointIsActive(point) {
    if (printingPointIsDeprecated(point)) return false;
    const device = point?.device;
    if (!device) return false;
    const runtime = (state.printingDeviceStatuses || []).find((item) => item.id === device.id);
    if (runtime && typeof runtime.available === "boolean") return runtime.available;
    const lastSeen = Date.parse(device.last_seen_at || "");
    if (!Number.isFinite(lastSeen)) return false;
    const age = Date.now() - lastSeen;
    const threshold = device.operation_mode === "working" ? 7000 : 15000;
    return device.operation_mode !== "offline" && age >= 0 && age <= threshold;
  }
  function showPrintingMessage(title, message) {
    const dialog = document.createElement("dialog");
    dialog.className = "password-dialog printing-message-dialog";
    dialog.innerHTML = `<div class="panel-title">${esc(title)}</div><p>${esc(message)}</p><div class="dialog-actions"><button type="button" class="btn primary" data-message-accept>Aceptar</button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-message-accept]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  }
  function openPrintPointDetails(point) {
    const device = point?.device;
    const deprecated = printingPointIsDeprecated(point);
    const online = printingPointIsActive(point);
    const connectionType = deprecated ? "Dispositivo eliminado" : device?.connection_type || "No informada por BPrint";
    const networkDetails = !deprecated && device?.connection_type === "Red"
      ? `<div class="printing-point-detail"><span>Nombre de red</span><strong>${esc(device?.network_name || "No identificada en BPrint")}</strong></div><div class="printing-point-detail"><span>IP actual</span><strong>${esc(device?.ip_address || "No informada")}</strong></div>`
      : "";
    const dialog = document.createElement("dialog");
    dialog.className = "password-dialog printing-point-details-dialog";
    dialog.innerHTML = `<div class="color-scheme-editor-head"><div><div class="panel-title">Información del punto</div></div><button type="button" class="dialog-close" aria-label="Cerrar">×</button></div><div class="printing-point-detail-list"><div class="printing-point-detail"><span>Nombre del punto</span><strong>${esc(point?.name || "")}</strong></div><div class="printing-point-detail"><span>ID del dispositivo</span><code>${esc(device?.id || point?.device_id || "No enlazado")}</code></div><div class="printing-point-detail"><span>Conexión</span><strong>${esc(connectionType)}</strong></div>${networkDetails}<div class="printing-point-detail"><span>Estado</span><strong class="printing-device-state ${deprecated ? "is-deprecated" : online ? "is-online" : "is-offline"}"><span class="printing-device-dot"></span>${deprecated ? "Deprecated" : online ? "Activa" : "Inactiva"}</strong></div></div><div class="dialog-actions">${deprecated ? '<button type="button" class="btn primary" data-repair-point>Actualizar impresora</button>' : ""}<button type="button" class="btn secondary" data-detail-accept>Aceptar</button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-detail-accept]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-repair-point]")?.addEventListener("click", () => { dialog.close(); openPrintPointDeviceRepair(point); });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
  }
  function openPrintPointDeviceRepair(point) {
    const devices = (state.printingDevices || []).filter((device) =>
      !(state.printingPoints || []).some((other) => other.id !== point.id && other.device_id === device.id));
    if (!devices.length) {
      showPrintingMessage("No hay impresoras para enlazar", "Registra otra impresora en BPrint y vuelve a intentarlo.");
      return;
    }
    const options = devices.map((device) => {
      const label = device.display_name || device.model || "Impresora";
      const connection = [device.connection_type, device.network_name, device.ip_address].filter(Boolean).join(" · ");
      return `<option value="${esc(device.id)}">${esc(label)} · ${esc(device.id)}${connection ? ` · ${esc(connection)}` : ""}</option>`;
    }).join("");
    const body = `<p class="meta">El punto conservará su nombre y sus destinos. Solo cambiará el dispositivo enlazado.</p><label class="settings-field">Impresora registrada<select name="device_id" required>${options}</select></label>`;
    openPrintDialog("Actualizar impresora del punto", body, async (form) => {
      const { error } = await supabase.rpc("replace_printing_point_device", {
        p_point_id: point.id,
        p_device_id: new FormData(form).get("device_id"),
      });
      if (error) {
        if (error.message?.includes("printing_flow_needs_update"))
          throw new Error("Este flujo necesita actualizarse: reemplaza o quita el punto de impresión que perdió su impresora.");
        if (error.message?.includes("printing_device_already_linked")) throw new Error("Esa impresora ya está enlazada a otro punto.");
        if (error.message?.includes("printing_device_not_in_restaurant")) throw new Error("Esa impresora ya no pertenece a este restaurante.");
        throw new Error(error.message || "No se pudo actualizar la impresora del punto.");
      }
    });
  }
  function renderPrintingSettings() {
    const points = state.printingPoints || [];
    const flows = state.printingFlows || [];
    const routes = state.printingFlowRoutes || [];
    const templates = state.printingTicketTemplates || [];
    const pointCards = points.map((point) => {
      const device = point.device;
      const deprecated = printingPointIsDeprecated(point);
      const online = printingPointIsActive(point);
      const connectionType = deprecated ? "Impresora eliminada · necesita actualizarse" : device?.connection_type || "Conexión no informada";
      return `<button type="button" class="printing-config-card printing-point-card" data-print-view-point="${esc(point.id)}" data-print-point-card="${esc(point.id)}"><span class="printing-config-card-head"><strong>${esc(point.name)}</strong><span class="printing-status ${deprecated ? "is-deprecated" : online ? "is-on" : ""}" data-print-point-status>${deprecated ? "Deprecated" : online ? "Activa" : "Inactiva"}</span></span><span class="printing-point-card-id">ID <code>${esc(device?.id || point.device_id || "Sin dispositivo")}</code></span><span class="meta" data-print-point-meta>${esc(connectionType)} · Ver información</span></button>`;
    }).join("");
    const flowCards = flows.map((flow) => {
      const needsUpdate = printingFlowNeedsUpdate(flow.id);
      const flowRoutes = routes.filter((route) => route.flow_id === flow.id && route.event_keys?.length);
      const events = (flow.captured_events || []).map(printEventLabel).join(" · ") || "Sin eventos";
      const queuedRuns = (state.printingFlowQueue || []).filter((run) => run.flow_id === flow.id);
      const queuedJobs = queuedRuns.reduce((sum, run) => sum + Number(run.published_count || 0), 0);
      const takenJobs = queuedRuns.reduce((sum, run) => sum + Number(run.taken_count || 0), 0);
      const queueStatus = state.printingFlowQueueLoaded
        ? queuedRuns.length
          ? `${queuedRuns.length} ${queuedRuns.length === 1 ? "ejecución" : "ejecuciones"} · ${queuedJobs} en cola · ${takenJobs} en impresión`
          : "Sin ejecuciones pendientes"
        : "Consultando estado de la cola…";
      const runtimeStatus = needsUpdate ? "Flujo necesita actualizarse" : !flow.is_active ? "Flujo pausado · motor detenido" : state.printingFlowRuntimeLoaded ? "Esperando cuenta motor…" : "Consultando motor…";
      return `<article class="printing-config-card" data-print-flow-card="${esc(flow.id)}"><div class="printing-config-card-head"><strong>${esc(flow.name)}</strong><span class="printing-status ${needsUpdate ? "is-deprecated" : flow.is_active ? "is-on" : ""}" data-print-flow-status>${needsUpdate ? "Necesita actualizarse" : flow.is_active ? "Activo" : "Pausado"}</span></div><p>${esc(events)}</p><p>${flowRoutes.length} tarea${flowRoutes.length === 1 ? "" : "s"} secuencial${flowRoutes.length === 1 ? "" : "es"}</p><p class="meta" data-print-flow-queue="${esc(flow.id)}">${esc(queueStatus)}</p><p class="meta" data-print-flow-runtime="${esc(flow.id)}">${runtimeStatus}</p><div class="printing-card-actions"><button type="button" class="rowaction" data-print-edit-flow="${esc(flow.id)}">Editar flujo</button></div></article>`;
    }).join("");
    const templateCards = templates.map((template) => {
      const linked = routes.some((route) => route.template_id === template.id && route.event_keys?.length);
      return `<button type="button" class="printing-config-card printing-template-card" data-print-open-template="${esc(template.id)}"><span class="printing-config-card-head"><strong>${esc(template.name)}</strong>${linked ? '<span class="printing-status is-on">Enlazado</span>' : ""}</span><span class="meta">${esc(`${template.format?.paper_width_mm || 80} mm · ${template.format?.header?.lines?.length || 0} líneas de encabezado`)}</span></button>`;
    }).join("");
    return `<section class="panel settings-panel printing-settings-panel"><div class="panel-head"><div><div class="panel-title">Sistemas de Impresión</div><div class="meta">Asigna impresoras a puntos, define flujos y guarda formatos de ticket.</div></div></div>${state.printingSettingsError ? `<p class="inline-error printing-settings-error" role="alert">${esc(state.printingSettingsError)}</p>` : ""}${printingArea("Puntos de Impresión", "Agrega dispositivos BPrint registrados en tu restaurante.", pointCards, "create-print-point", "Crear punto de Impresión")}${printingArea("Flujos de impresión", "Elige qué eventos se capturan y a qué destinos se envían.", flowCards, "create-print-flow", "Crear flujo de impresión")}${printingArea("Formatos de ticket", "Guarda varios formatos y selecciona uno distinto en cada ruta.", templateCards, "create-print-template", "Crear formato de ticket")}</section>`;
  }
  function openPrintDialog(title, body, onSave, options = {}) {
    const { submitLabel = "Guardar", deleteLabel = "Eliminar", errorMode = "inline", onDelete = null, deleteToast = "Formato eliminado.", successToast = "Configuración de impresión guardada.", reloadAfterSave = true, dialogClass = "", disableSaveInitially = false } = options;
    const dialog = document.createElement("dialog");
    dialog.className = `password-dialog printing-editor-dialog ${dialogClass}`.trim();
    dialog.innerHTML = `<form data-print-editor><div class="color-scheme-editor-head"><div><div class="panel-title">${title}</div></div><button type="button" class="dialog-close" aria-label="Cerrar">×</button></div>${body}<p class="appearance-editor-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button>${onDelete ? `<button type="button" class="btn danger" data-delete>${esc(deleteLabel)}</button>` : ""}<button type="submit" class="btn primary" data-save>${esc(submitLabel)}</button></div></form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector("[data-print-editor]");
    if (disableSaveInitially) dialog.querySelector("[data-save]").disabled = true;
    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    if (onDelete) dialog.querySelector("[data-delete]").addEventListener("click", async () => {
      const deleteButton = dialog.querySelector("[data-delete]");
      const saveButton = dialog.querySelector("[data-save]");
      const error = dialog.querySelector(".appearance-editor-error");
      deleteButton.disabled = true;
      saveButton.disabled = true;
      error.textContent = "";
      try {
        const deleted = await onDelete(form);
        if (deleted === false) { deleteButton.disabled = false; saveButton.disabled = false; return; }
        dialog.close();
        await load();
        render();
        toast(deleteToast);
      } catch (deleteError) {
        error.textContent = deleteError.message || "No se pudo eliminar el formato.";
        deleteButton.disabled = false;
        saveButton.disabled = false;
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const saveButton = form.querySelector("[data-save]");
      if (saveButton.disabled) return;
      const error = dialog.querySelector(".appearance-editor-error");
      error.textContent = "";
      saveButton.disabled = true;
      try {
        await onSave(form);
        dialog.close();
        if (reloadAfterSave) {
          await load();
          render();
          if (successToast) toast(successToast);
        }
      } catch (saveError) {
        if (errorMode === "dialog") showPrintingMessage("No se pudo crear el punto", saveError.message || "No se pudo guardar la configuración.");
        else error.textContent = saveError.message || "No se pudo guardar la configuración.";
        saveButton.disabled = false;
      }
    });
    dialog.showModal();
    return dialog;
  }
  function openPrintPointEditor() {
    const body = `<label class="settings-field">Nombre del punto de impresión<input name="name" maxlength="80" required placeholder="Ej. Caja, Cocina, Barra"></label><label class="settings-field">ID del dispositivo<input name="device_id" type="text" required autocomplete="off" spellcheck="false" placeholder="Pega el ID que muestra BPrint"></label>`;
    openPrintDialog("Crear punto de Impresión", body, async (d) => {
      const form = new FormData(d);
      const name = String(form.get("name") || "").trim();
      if (!name) throw new Error("Escribe el nombre del punto.");
      const deviceId = String(form.get("device_id") || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId))
        throw new Error("Pega el ID completo del dispositivo que muestra BPrint.");
      const { data: device, error: lookupError } = await supabase.from("printing_devices")
        .select("id").eq("id", deviceId).eq("restaurant_id", state.restaurantId).maybeSingle();
      if (lookupError) throw new Error("No se pudo verificar el dispositivo. Vuelve a intentarlo.");
      if (!device) throw new Error("Ese ID no pertenece a un dispositivo registrado en este restaurante.");
      if ((state.printingPoints || []).some((point) => point.device_id === deviceId))
        throw new Error("Ese dispositivo ya está enlazado a un punto de impresión.");
      const { error } = await supabase.rpc("create_printing_point", {
        p_name: name,
        p_device_id: deviceId,
      });
      if (error) {
        if (error.message?.includes("printing_device_already_linked"))
          throw new Error("Ese dispositivo ya está enlazado a un punto de impresión.");
        if (error.message?.includes("printing_device_not_in_restaurant"))
          throw new Error("Ese ID no pertenece a un dispositivo registrado en este restaurante.");
        throw new Error(error.message || "No se pudo crear el punto de impresión.");
      }
    }, { submitLabel: "Aceptar", errorMode: "dialog" });
  }
  function clampTicketElement(element, canvas, allElements = []) {
    if (element.type === "margin") {
      const parent = allElements.find((item) => item.id === element.parent_id);
      if (!parent) return "display:none";
      const x = Number(parent.x) || 0;
      const y = Number(parent.y) || 0;
      const width = Number(parent.width) || 0;
      const height = Number(parent.height) || 0;
      if (element.side === "top") return `left:${x}%;top:0;width:${width}%;height:${y}%;`;
      if (element.side === "bottom") return `left:${x}%;top:${y + height}%;width:${width}%;height:${Math.max(0, 100 - y - height)}%;`;
      if (element.side === "left") return `left:0;top:${y}%;width:${x}%;height:${height}%;`;
      if (element.side === "right") return `left:${x + width}%;top:${y}%;width:${Math.max(0, 100 - x - width)}%;height:${height}%;`;
      return "display:none";
    }
    const x = Math.max(0, Math.min(95, Number(element.x) || 0));
    const y = Math.max(0, Math.min(95, Number(element.y) || 0));
    const width = Math.max(4, Math.min(100 - x, Number(element.width) || 24));
    const height = Math.max(3, Math.min(100 - y, Number(element.height) || 12));
    return `left:${x}%;top:${y}%;width:${width}%;height:${height}%;`;
  }
  function ticketElementMarkup(element, canvas, allElements = []) {
    const data = esc(JSON.stringify(element));
    let contents = "";
    if (element.type === "image") contents = element.preview_url
      ? `<img src="${esc(element.preview_url)}" alt="Imagen del ticket">`
      : '<span class="ticket-image-placeholder">Imagen</span>';
    else if (element.type === "qr") contents = `<span class="ticket-fake-qr" aria-label="QR de ejemplo">${Array.from({ length: 121 }, (_, i) => ((i * 17 + Math.floor(i / 11) * 7) % 5 < 2) ? "<i></i>" : "<i class='off'></i>").join("")}</span>`;
    else if (element.type === "sunat_summary") contents = '<span class="ticket-summary-placeholder">VALOR RESUMEN<br>0123456789ABCDEF<br>(referencia visual)</span>';
    const marginClass = element.type === "margin" ? `is-margin ticket-margin-${esc(element.side || "")}` : "";
    return `<div class="ticket-canvas-object ticket-object-${esc(element.type)} ${marginClass}" data-ticket-element="${data}" style="${clampTicketElement(element, canvas, allElements)}" tabindex="0">${contents}<span class="ticket-object-resize" data-ticket-resize aria-label="Redimensionar"></span></div>`;
  }
  function showTicketImagePicker(onPick) {
    const picker = document.createElement("dialog");
    picker.className = "password-dialog ticket-image-dialog";
    picker.innerHTML = `<form method="dialog"><div class="color-scheme-editor-head"><div><div class="panel-title">Agregar imagen al ticket</div><p class="meta">La imagen se guardará como recurso privado del restaurante.</p></div><button type="button" class="dialog-close" aria-label="Cerrar">×</button></div><label class="ticket-image-drop" data-ticket-drop><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden><span class="ticket-image-upload-icon">↑</span><strong>Arrastra y suelta una imagen</strong><span>o <button type="button" class="logo-browse" data-ticket-browse>elige un archivo</button></span><small>Resolución recomendada: 512 × 512 px · máximo 5 MB. Se convierte a PNG para impresión.</small><span class="ticket-image-filename" data-ticket-filename></span></label><div class="appearance-editor-error" role="alert"></div><div class="dialog-actions"><button type="button" class="btn secondary" data-ticket-cancel>Cancelar</button><button type="button" class="btn primary" data-ticket-accept disabled>Aceptar</button></div></form>`;
    document.body.appendChild(picker);
    const input = picker.querySelector('input[type="file"]');
    const drop = picker.querySelector("[data-ticket-drop]");
    const accept = picker.querySelector("[data-ticket-accept]");
    let chosen = null;
    const choose = (file) => {
      const error = picker.querySelector(".appearance-editor-error");
      error.textContent = "";
      if (!file) return;
      if (!new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]).has(file.type) || file.size > 5 * 1024 * 1024) {
        error.textContent = "Usa PNG, JPG, WebP o SVG de hasta 5 MB.";
        accept.disabled = true;
        return;
      }
      chosen = file;
      picker.querySelector("[data-ticket-filename]").textContent = file.name;
      accept.disabled = false;
    };
    picker.querySelector("[data-ticket-browse]").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); input.click(); });
    picker.querySelector(".dialog-close").addEventListener("click", () => picker.close());
    picker.querySelector("[data-ticket-cancel]").addEventListener("click", () => picker.close());
    input.addEventListener("change", () => choose(input.files?.[0]));
    ["dragenter", "dragover"].forEach((eventName) => drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.add("drag-over"); }));
    ["dragleave", "dragend"].forEach((eventName) => drop.addEventListener(eventName, () => drop.classList.remove("drag-over")));
    drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("drag-over"); choose(event.dataTransfer?.files?.[0]); });
    accept.addEventListener("click", async () => {
      try {
        const objectUrl = URL.createObjectURL(chosen);
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        URL.revokeObjectURL(objectUrl);
        if (!png) throw new Error("No se pudo procesar la imagen.");
        onPick(new File([png], `${chosen.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" }));
        picker.close();
      } catch (error) {
        picker.querySelector(".appearance-editor-error").textContent = error.message || "No se pudo leer la imagen.";
      }
    });
    picker.addEventListener("close", () => picker.remove(), { once: true });
    picker.showModal();
  }
  function ticketDeleteConfirmation() {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "password-dialog ticket-delete-confirm-dialog";
      dialog.innerHTML = `<div class="panel-title">Eliminar formato</div><p>El formato se eliminará de tu restaurante. Si está enlazado a un flujo, primero tendrás que quitarlo de ese flujo.</p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Cancelar</button><button type="button" class="btn danger" data-confirm>Eliminar formato</button></div>`;
      document.body.appendChild(dialog);
      let confirmed = false;
      dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
      dialog.querySelector("[data-confirm]").addEventListener("click", () => { confirmed = true; dialog.close(); });
      dialog.addEventListener("close", () => { dialog.remove(); resolve(confirmed); }, { once: true });
      dialog.showModal();
    });
  }
  async function openPrintTemplateEditor(template = null) {
    const initial = template?.format ? JSON.parse(JSON.stringify(template.format)) : {};
    const format = {
      schema_version: 3,
      paper_width_mm: Number(initial.paper_width_mm) === 58 ? 58 : 80,
      header: initial.header || { lines: [] }, footer: initial.footer || { lines: [] },
      body: {
        show_location: true, show_operator: true, show_note: true, show_payment_breakdown: true,
        show_order_datetime: true, show_establishment_ruc: false,
        show_brand: true, show_event_title: true, show_status: true, show_total: true,
        ...(initial.body || {}),
        show_table: (state.restaurantNeeds || []).includes("salon") && (initial.body?.show_table ?? true),
      },
      layout: { ...TICKET_FORMAT_DEFAULTS, ...(initial.layout || {}) },
      elements: Array.isArray(initial.elements) ? initial.elements : [],
    };
    const originalAssetPaths = new Set((initial.elements || []).filter((item) => item.type === "image" && item.asset_path).map((item) => item.asset_path));
    for (const element of format.elements.filter((item) => item.type !== "margin")) {
      const margins = format.elements.filter((item) => item.type === "margin" && item.parent_id === element.id);
      if (!margins.some((item) => ["left", "right"].includes(item.side))) element.x = 0;
      if (!margins.some((item) => ["top", "bottom"].includes(item.side))) element.y = 0;
    }
    const pendingImages = new Map();
    const objectUrls = new Set();
    for (const element of format.elements.filter((item) => item.type === "image" && item.asset_path)) {
      const { data } = await supabase.storage.from("ticket-assets").createSignedUrl(element.asset_path, 3600);
      if (data?.signedUrl) element.preview_url = data.signedUrl;
    }
    const header = (format.header?.lines || []).join("\n");
    const footer = (format.footer?.lines || []).join("\n");
    let elements = format.elements;
    let sectionOrder = [...new Set([...(Array.isArray(initial.layout?.section_order) ? initial.layout.section_order.filter((key) => TICKET_SECTION_ORDER.includes(key)) : []), ...TICKET_SECTION_ORDER])];
    const sectionBreaks = { ...(initial.layout?.section_breaks || {}) };
    let itemLineBreaks = Math.max(0, Math.min(5, Number(initial.layout?.item_line_breaks) || 0));
    const numberField = (key, label, unit) => `<label class="settings-field">${label}<div class="ticket-number-input"><input type="number" step="0.5" data-layout="${key}" value="${Object.hasOwn(initial.layout || {}, key) ? esc(format.layout[key]) : ""}" placeholder="Dejar en blanco para el valor por defecto"><span>${unit}</span></div></label>`;
    const optionField = (key, label, defaultLabel, options) => `<label class="settings-field">${label}<select data-layout="${key}"><option value="__default">${defaultLabel} (por defecto)</option>${options.map(([value, text]) => `<option value="${value}" ${Object.hasOwn(initial.layout || {}, key) && format.layout[key] === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
    const body = `<div class="ticket-editor-layout"><div class="ticket-editor-controls"><label class="settings-field">Nombre del formato<input name="name" maxlength="80" required value="${esc(template?.name || "")}" placeholder="Ej. Ticket de venta"></label><label class="settings-field">Ancho del papel<select name="paper_width_mm"><option value="80" ${format.paper_width_mm === 80 ? "selected" : ""}>80 mm</option><option value="58" ${format.paper_width_mm === 58 ? "selected" : ""}>58 mm</option></select></label><label class="settings-field">Encabezado<textarea name="header" rows="3" placeholder="Una línea por renglón">${esc(header)}</textarea></label><label class="settings-field">Pie del ticket<textarea name="footer" rows="3" placeholder="Una línea por renglón">${esc(footer)}</textarea></label><div class="settings-checks ticket-basic-options"><label class="settings-check"><input type="checkbox" data-template-body="show_location" ${format.body.show_location ? "checked" : ""}><span>Mostrar sede</span></label><label class="settings-check"><input type="checkbox" data-template-body="show_operator" ${format.body.show_operator ? "checked" : ""}><span>Mostrar empleado</span></label>${(state.restaurantNeeds || []).includes("salon") ? `<label class="settings-check"><input type="checkbox" data-template-body="show_table" ${format.body.show_table ? "checked" : ""}><span>Mostrar mesa</span></label>` : ""}<label class="settings-check"><input type="checkbox" data-template-body="show_order_datetime" ${format.body.show_order_datetime ? "checked" : ""}><span>Mostrar fecha y hora (dd/mm/yyyy hh:mm:ss)</span></label><label class="settings-check"><input type="checkbox" data-template-body="show_establishment_ruc" ${format.body.show_establishment_ruc ? "checked" : ""}><span>Mostrar RUC del establecimiento (referencia de prueba)</span></label><label class="settings-check"><input type="checkbox" data-template-body="show_note" ${format.body.show_note ? "checked" : ""}><span>Mostrar nota</span></label><label class="settings-check"><input type="checkbox" data-template-body="show_payment_breakdown" ${format.body.show_payment_breakdown ? "checked" : ""}><span>Mostrar desglose de pago</span></label></div><details class="ticket-advanced-options"><summary>Mostrar opciones avanzadas</summary><p class="meta">Los valores en blanco usan el valor predeterminado del formato; se guardan explícitamente en el JSON.</p><div class="ticket-advanced-grid">${numberField("margin_top_mm", "Margen superior", "mm")}${numberField("margin_right_mm", "Margen derecho", "mm")}${numberField("margin_bottom_mm", "Margen inferior", "mm")}${numberField("margin_left_mm", "Margen izquierdo", "mm")}${numberField("min_height_mm", "Altura mínima", "mm")}${numberField("feed_before_mm", "Avance antes de imprimir", "mm")}${numberField("feed_after_mm", "Avance antes del corte", "mm")}${optionField("font_family", "Tipografía", "Tipografía de impresora", [["device", "Tipografía de impresora"], ["sans", "Sans serif rasterizada"], ["serif", "Serif rasterizada"]])}${optionField("font_size_pt", "Tamaño de texto", "12 pt", [["10", "10 pt"], ["12", "12 pt"], ["14", "14 pt"], ["16", "16 pt"], ["20", "20 pt"]])}${optionField("line_spacing", "Espaciado de línea", "Normal", [["compact", "Compacto"], ["normal", "Normal"], ["wide", "Amplio"]])}${optionField("density", "Densidad / calidad", "Normal", [["draft", "Borrador"], ["normal", "Normal"], ["high", "Alta"]])}${optionField("text_depth", "Profundidad del texto", "Estándar", [["compact", "Compacta"], ["standard", "Estándar"], ["detailed", "Detallada"]])}${optionField("cut_mode", "Corte al finalizar", "Corte parcial", [["none", "Sin corte"], ["partial", "Parcial"], ["full", "Completo"]])}</div></details></div><section class="ticket-preview-panel"><div class="ticket-preview-head"><div><strong>Vista previa</strong><span class="meta">Los elementos insertados son referencias visuales.</span></div><div class="ticket-add-control"><button type="button" class="ticket-add-button" data-ticket-add aria-label="Agregar elemento">+</button><div class="ticket-add-menu" data-ticket-add-menu hidden><button type="button" data-add-element="image">Agregar imagen</button><button type="button" data-add-element="qr">Agregar QR</button><button type="button" data-add-element="sunat_summary">Agregar valor resumen SUNAT</button></div></div></div><div class="ticket-preview-scroll"><div class="ticket-preview-paper" data-ticket-canvas><div class="ticket-preview-header" data-preview-header>${esc(header || "Nombre del restaurante")}</div><div class="ticket-preview-sample">PEDIDO DE EJEMPLO<br>2 × Producto<br>1 × Bebida<br><br>TOTAL&nbsp;&nbsp;&nbsp; S/ 00.00</div><div class="ticket-preview-footer" data-preview-footer>${esc(footer || "Gracias por su compra")}</div>${format.elements.map((element) => ticketElementMarkup(element, { getBoundingClientRect: () => ({ width: 260, height: 600 }) })).join("")}</div></div></section></div>`;
    const sectionControls = `<details class="ticket-advanced-options ticket-sections-options"><summary>Ajuste de secciones</summary><div class="settings-checks ticket-section-toggles"><label class="settings-check"><input type="checkbox" data-template-body="show_brand" ${format.body.show_brand ? "checked" : ""}><span>Mostrar identidad de la app</span></label><label class="settings-check"><input type="checkbox" data-template-body="show_event_title" ${format.body.show_event_title ? "checked" : ""}><span>Mostrar título del pedido</span></label><label class="settings-check"><input type="checkbox" data-template-body="show_status" ${format.body.show_status ? "checked" : ""}><span>Mostrar estado del pedido</span></label><label class="settings-check"><input type="checkbox" data-template-body="show_total" ${format.body.show_total ? "checked" : ""}><span>Mostrar total</span></label></div><p class="meta">Arrastra las secciones para ordenar el ticket. Los saltos entre secciones y productos usan el espaciado de línea seleccionado.</p><div class="ticket-section-list" data-ticket-section-list></div><label class="settings-field ticket-item-breaks">Saltos de línea entre cada producto<input type="number" min="0" max="5" step="1" data-ticket-item-breaks value="${itemLineBreaks}"></label></details>`;
    const bodyWithSectionControls = body.replace(
      `</div><details class="ticket-advanced-options"><summary>Mostrar opciones avanzadas</summary>`,
      `</div>${sectionControls}<details class="ticket-advanced-options"><summary>Mostrar opciones avanzadas</summary>`,
    );
    const activeSectionKeys = () => {
      const enabled = (key) => Boolean(editor?.querySelector(`[data-template-body="${key}"]`)?.checked);
      const active = new Set(["event_title", "items"]);
      if (enabled("show_brand")) active.add("brand");
      if (!enabled("show_event_title")) active.delete("event_title");
      if (editor?.querySelector('[name="header"]')?.value.trim()) active.add("header");
      if (enabled("show_location")) active.add("location");
      if (enabled("show_order_datetime")) active.add("order_datetime");
      if (enabled("show_operator")) active.add("operator");
      if (enabled("show_table")) active.add("table");
      if (enabled("show_status")) active.add("status");
      if (enabled("show_total")) active.add("total");
      if (enabled("show_establishment_ruc")) active.add("establishment_ruc");
      if (enabled("show_note")) active.add("note");
      if (enabled("show_payment_breakdown")) active.add("payment_breakdown");
      if (editor?.querySelector('[name="footer"]')?.value.trim()) active.add("footer");
      return sectionOrder.filter((key) => active.has(key));
    };
    const activeSectionBreaks = () => {
      const active = activeSectionKeys();
      return Object.fromEntries(active.slice(0, -1).map((key) => [key, getSectionBreak(key, active)]));
    };
    const editor = openPrintDialog(template ? "Editar formato de ticket" : "Crear formato de ticket", bodyWithSectionControls, async (dialog) => {
      const form = new FormData(dialog);
      const name = String(form.get("name") || "").trim();
      if (!name) throw new Error("Escribe el nombre del formato.");
      const templateId = template?.id || crypto.randomUUID();
      const layout = {};
      for (const [key, defaultValue] of Object.entries(TICKET_FORMAT_DEFAULTS)) {
        const input = dialog.querySelector(`[data-layout="${key}"]`);
        if (!input) { layout[key] = defaultValue; continue; }
        if (input.value === "__default" || input.value === "") layout[key] = defaultValue;
        else layout[key] = typeof defaultValue === "number" ? Number(input.value) : input.value;
      }
      const uploadedPaths = [];
      const templateElements = elements.map((element) => ({ ...element }));
      try {
        for (const element of templateElements) {
          delete element.preview_url;
          const file = pendingImages.get(element.id);
          if (file) {
            const path = `${state.restaurantId}/templates/${templateId}/${crypto.randomUUID()}.png`;
            const { error: uploadError } = await supabase.storage.from("ticket-assets").upload(path, file, { contentType: "image/png", cacheControl: "3600", upsert: false });
            if (uploadError) throw uploadError;
            uploadedPaths.push(path);
            element.asset_path = path;
          }
        }
        const activeSections = activeSectionKeys();
        layout.section_order = activeSections;
        layout.section_breaks = activeSectionBreaks();
        layout.item_line_breaks = itemLineBreaks;
        const formatPayload = {
          schema_version: 3,
          paper_width_mm: Number(form.get("paper_width_mm")),
          header: { lines: String(form.get("header") || "").split("\n").map((line) => line.trim()).filter(Boolean) },
          body: {
            show_location: dialog.querySelector('[data-template-body="show_location"]').checked,
            show_operator: dialog.querySelector('[data-template-body="show_operator"]').checked,
            show_note: dialog.querySelector('[data-template-body="show_note"]').checked,
            show_payment_breakdown: dialog.querySelector('[data-template-body="show_payment_breakdown"]').checked,
            show_table: dialog.querySelector('[data-template-body="show_table"]')?.checked || false,
            show_order_datetime: dialog.querySelector('[data-template-body="show_order_datetime"]').checked,
            show_establishment_ruc: dialog.querySelector('[data-template-body="show_establishment_ruc"]').checked,
            show_brand: dialog.querySelector('[data-template-body="show_brand"]').checked,
            show_event_title: dialog.querySelector('[data-template-body="show_event_title"]').checked,
            show_status: dialog.querySelector('[data-template-body="show_status"]').checked,
            show_total: dialog.querySelector('[data-template-body="show_total"]').checked,
          },
          footer: { lines: String(form.get("footer") || "").split("\n").map((line) => line.trim()).filter(Boolean) },
          layout,
          elements: templateElements,
        };
        const { error } = await supabase.from("printing_ticket_templates").upsert({ id: templateId, restaurant_id: state.restaurantId, name, format: formatPayload, is_active: true });
        if (error) throw error;
      } catch (error) {
        if (uploadedPaths.length) await supabase.storage.from("ticket-assets").remove(uploadedPaths);
        throw error;
      }
      for (const element of templateElements) {
        const original = elements.find((item) => item.id === element.id);
        if (original?.asset_path !== element.asset_path && element.asset_path) original.asset_path = element.asset_path;
        if (pendingImages.has(element.id)) pendingImages.delete(element.id);
      }
      const retainedAssets = new Set(templateElements.map((item) => item.asset_path).filter(Boolean));
      const removedAssets = [...originalAssetPaths].filter((path) => !retainedAssets.has(path));
      if (removedAssets.length) {
        const { error: removeError } = await supabase.storage.from("ticket-assets").remove(removedAssets);
        if (removeError) throw new Error(`El formato se guardó, pero no se pudo eliminar una imagen anterior del almacenamiento: ${removeError.message}`);
      }
    }, {
      dialogClass: "ticket-format-editor",
      disableSaveInitially: true,
      onDelete: template ? async () => {
        if (!(await ticketDeleteConfirmation())) return false;
        const { error } = await supabase.rpc("delete_printing_ticket_template", { p_template_id: template.id });
        if (error?.message?.includes("ticket_template_linked")) throw new Error("Este formato está enlazado a un flujo. Desenlázalo antes de eliminarlo.");
        if (error) throw new Error(error.message || "No se pudo eliminar el formato.");
      } : null,
    });
    const sectionList = editor.querySelector("[data-ticket-section-list]");
    const itemBreakInput = editor.querySelector("[data-ticket-item-breaks]");
    const sectionBreakDefault = (key, activeKeys) => {
      const index = activeKeys.indexOf(key);
      const next = activeKeys[index + 1];
      const orderInfoKeys = ["location", "order_datetime", "operator", "table", "status", "establishment_ruc", "note"];
      if (next === "items" && orderInfoKeys.includes(key)) return 1;
      if (key === "items" && ["payment_breakdown", "total"].includes(next)) return 1;
      return 0;
    };
    const getSectionBreak = (key, activeKeys = activeSectionKeys()) => Math.max(0, Math.min(5,
      Object.hasOwn(sectionBreaks, key) ? Number(sectionBreaks[key]) || 0 : sectionBreakDefault(key, activeKeys)));
    const moveSection = (key, direction) => {
      const active = activeSectionKeys();
      const index = active.indexOf(key);
      const target = active[index + direction];
      if (!target) return;
      const firstIndex = sectionOrder.indexOf(key);
      const secondIndex = sectionOrder.indexOf(target);
      [sectionOrder[firstIndex], sectionOrder[secondIndex]] = [sectionOrder[secondIndex], sectionOrder[firstIndex]];
      renderSectionList();
      updatePreview();
    };
    const renderSectionList = () => {
      const active = activeSectionKeys();
      sectionList.innerHTML = active.map((key, index) => {
        const gap = index < active.length - 1
          ? `<label class="ticket-section-gap"><span>Saltos de línea</span><select data-section-break="${key}">${Array.from({ length: 6 }, (_, value) => `<option value="${value}" ${getSectionBreak(key, active) === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>`
          : "";
        return `<div class="ticket-section-entry"><div class="ticket-section-row" data-ticket-section-row="${key}" draggable="true"><span class="ticket-section-grip" aria-hidden="true">⠿</span><strong>${TICKET_SECTION_LABELS[key]}</strong><div class="ticket-section-move"><button type="button" data-section-move="-1" aria-label="Mover ${TICKET_SECTION_LABELS[key]} hacia arriba" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-section-move="1" aria-label="Mover ${TICKET_SECTION_LABELS[key]} hacia abajo" ${index === active.length - 1 ? "disabled" : ""}>↓</button></div></div>${gap}</div>`;
      }).join("");
    };
    let draggedSectionKey = "";
    sectionList.addEventListener("change", (event) => {
      const key = event.target.dataset.sectionBreak;
      if (key) sectionBreaks[key] = Math.max(0, Math.min(5, Number(event.target.value) || 0));
      updatePreview();
    });
    sectionList.addEventListener("click", (event) => {
      const move = event.target.closest("[data-section-move]");
      if (move) moveSection(move.closest("[data-ticket-section-row]").dataset.ticketSectionRow, Number(move.dataset.sectionMove));
    });
    sectionList.addEventListener("dragstart", (event) => {
      const row = event.target.closest("[data-ticket-section-row]");
      if (!row) return;
      draggedSectionKey = row.dataset.ticketSectionRow;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedSectionKey);
      row.classList.add("is-dragging");
    });
    sectionList.addEventListener("dragend", () => {
      draggedSectionKey = "";
      sectionList.querySelectorAll(".is-dragging,.is-drop-before,.is-drop-after").forEach((row) => row.classList.remove("is-dragging", "is-drop-before", "is-drop-after"));
    });
    sectionList.addEventListener("dragover", (event) => {
      const row = event.target.closest("[data-ticket-section-row]");
      if (!row || !draggedSectionKey) return;
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      row.classList.toggle("is-drop-before", event.clientY < rect.top + rect.height / 2);
      row.classList.toggle("is-drop-after", event.clientY >= rect.top + rect.height / 2);
    });
    sectionList.addEventListener("drop", (event) => {
      const row = event.target.closest("[data-ticket-section-row]");
      const targetKey = row?.dataset.ticketSectionRow;
      const sourceKey = event.dataTransfer?.getData("text/plain") || draggedSectionKey;
      if (!row || !sourceKey || sourceKey === targetKey) return;
      event.preventDefault();
      const active = activeSectionKeys();
      const from = active.indexOf(sourceKey);
      const to = active.indexOf(targetKey);
      if (from < 0 || to < 0) return;
      const before = active[to];
      active.splice(from, 1);
      const insertAt = event.clientY >= row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2
        ? active.indexOf(before) + 1
        : active.indexOf(before);
      active.splice(Math.max(0, insertAt), 0, sourceKey);
      const activeKeys = new Set(activeSectionKeys());
      const activeSlots = sectionOrder.map((key, index) => activeKeys.has(key) ? index : -1).filter((index) => index >= 0);
      active.forEach((key, index) => { sectionOrder[activeSlots[index]] = key; });
      renderSectionList();
      updatePreview();
    });
    itemBreakInput.addEventListener("input", () => {
      itemLineBreaks = Math.max(0, Math.min(5, Number(itemBreakInput.value) || 0));
      updatePreview();
    });
    const canvas = editor.querySelector("[data-ticket-canvas]");
    canvas.dataset.paperWidth = String(format.paper_width_mm);
    const renderElements = () => {
      marginObserver.disconnect();
      canvas.querySelectorAll("[data-ticket-element]").forEach((node) => node.remove());
      elements.forEach((element) => canvas.insertAdjacentHTML("beforeend", ticketElementMarkup(element, canvas, elements)));
      bindCanvasElements();
      canvas.querySelectorAll("[data-ticket-element]").forEach((node) => {
        const element = elements.find((item) => item.id === JSON.parse(node.dataset.ticketElement).id);
        if (element && element.type !== "margin") marginObserver.observe(node, { attributes: true, attributeFilter: ["style"] });
      });
    };
    const previewSample = canvas.querySelector(".ticket-preview-sample");
    const previewHeader = canvas.querySelector("[data-preview-header]");
    const previewFooter = canvas.querySelector("[data-preview-footer]");
    previewHeader.style.display = "none";
    previewFooter.style.display = "none";
    const saveButton = editor.querySelector("[data-save]");
    const layoutState = () => Object.fromEntries(Object.entries(TICKET_FORMAT_DEFAULTS).map(([key, fallback]) => {
      const value = editor.querySelector(`[data-layout="${key}"]`)?.value ?? "";
      return [key, value === "" || value === "__default" ? fallback : typeof fallback === "number" ? Number(value) : value];
    }));
    const currentEditorState = () => JSON.stringify({
      name: editor.querySelector('[name="name"]').value.trim(),
      paper_width_mm: Number(editor.querySelector('[name="paper_width_mm"]').value),
      header: editor.querySelector('[name="header"]').value,
      footer: editor.querySelector('[name="footer"]').value,
      body: Object.fromEntries([...editor.querySelectorAll("[data-template-body]")].map((input) => [input.dataset.templateBody, input.checked])),
      layout: { ...layoutState(), section_order: activeSectionKeys(), section_breaks: activeSectionBreaks(), item_line_breaks: itemLineBreaks },
      elements: elements.map(({ preview_url, ...element }) => element),
    });
    let initialEditorState = "";
    const updateDirtyState = () => {
      if (initialEditorState) saveButton.disabled = currentEditorState() === initialEditorState;
    };
    const updatePreview = () => {
      const layout = layoutState();
      const body = Object.fromEntries([...editor.querySelectorAll("[data-template-body]")].map((input) => [input.dataset.templateBody, input.checked]));
      const date = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
      const itemGroups = layout.text_depth === "compact"
        ? [["2 × Producto"], ["1 × Bebida"]]
        : layout.text_depth === "detailed"
          ? [["2 × Producto     S/ 20.00", "  Variante: Regular"], ["1 × Bebida       S/ 8.00"]]
          : [["2 × Producto"], ["1 × Bebida"]];
      const sectionLines = {
        brand: ["BLACK&WHITE POS"],
        header: editor.querySelector('[name="header"]').value.split("\n").map((line) => line.trim()).filter(Boolean),
        event_title: ["PEDIDO DE EJEMPLO"],
        location: ["Sede: Principal"],
        order_datetime: [`Fecha: ${date}`],
        operator: ["Atendió: Empleado"],
        table: ["Mesa: Mesa 1"],
        status: ["Estado: Correcto"],
        establishment_ruc: ["RUC: 00000000000 (PRUEBA)"],
        note: ["Nota: ejemplo"],
        payment_breakdown: ["Efectivo        S/ 28.00"],
        total: ["TOTAL            S/ 28.00"],
        footer: editor.querySelector('[name="footer"]').value.split("\n").map((line) => line.trim()).filter(Boolean),
      };
      const active = activeSectionKeys();
      const preview = [];
      const pushLine = (key, value) => preview.push(`<div class="ticket-preview-text-line" data-ticket-preview-line="${key}">${value ? esc(value) : "&nbsp;"}</div>`);
      active.forEach((key, index) => {
        preview.push(`<div class="ticket-preview-text-section" data-ticket-preview-section="${key}">`);
        if (key === "items") {
          itemGroups.forEach((group, index) => {
            if (index) for (let count = 0; count < itemLineBreaks; count += 1) pushLine(key, "");
            group.forEach((line) => pushLine(key, line));
          });
        } else {
          (sectionLines[key] || []).forEach((line) => pushLine(key, line));
        }
        preview.push("</div>");
        if (index < active.length - 1)
          for (let count = 0; count < getSectionBreak(key, active); count += 1) pushLine("section-break", "");
      });
      previewSample.innerHTML = preview.join("");
      canvas.style.padding = `${layout.margin_top_mm}mm ${layout.margin_right_mm}mm ${layout.margin_bottom_mm}mm ${layout.margin_left_mm}mm`;
      canvas.style.minHeight = `${Math.max(138, layout.min_height_mm)}mm`;
      canvas.style.fontFamily = ({ device: '"Courier New", monospace', sans: "Arial, sans-serif", serif: "Georgia, serif" })[layout.font_family] || '"Courier New", monospace';
      canvas.style.fontSize = `${layout.font_size_pt}pt`;
      canvas.style.lineHeight = ({ compact: "1.1", normal: "1.35", wide: "1.75" })[layout.line_spacing] || "1.35";
      previewSample.style.color = ({ draft: "#777", normal: "#171717", high: "#000" })[layout.density] || "#171717";
      renderSectionList();
      updateDirtyState();
    };
    const addMargin = (element, side) => {
      if (elements.some((item) => item.type === "margin" && item.parent_id === element.id && item.side === side)) return;
      elements.push({ id: crypto.randomUUID(), type: "margin", parent_id: element.id, side });
      renderElements();
      updateDirtyState();
    };
    const syncMarginNodes = (parentId) => {
      elements.filter((item) => item.type === "margin" && item.parent_id === parentId).forEach((margin) => {
        const node = [...canvas.querySelectorAll("[data-ticket-element]")].find((candidate) => JSON.parse(candidate.dataset.ticketElement).id === margin.id);
        if (node) node.setAttribute("style", clampTicketElement(margin, canvas, elements));
      });
    };
    const marginObserver = new MutationObserver((changes) => {
      const parentIds = new Set();
      changes.forEach(({ target }) => {
        const element = elements.find((item) => item.id === JSON.parse(target.dataset.ticketElement || "{}").id);
        if (element && element.type !== "margin") parentIds.add(element.id);
      });
      parentIds.forEach(syncMarginNodes);
    });
    const openObjectMenu = (element, x, y) => {
      editor.querySelector("[data-ticket-object-menu]")?.remove();
      const menu = document.createElement("div");
      menu.className = "ticket-object-menu";
      menu.dataset.ticketObjectMenu = "true";
      const items = element.type === "margin"
        ? [["remove", "Eliminar"]]
        : [["remove", "Eliminar"], ...[["top", "Agregar margen arriba"], ["left", "Agregar margen a la izquierda"], ["right", "Agregar margen a la derecha"], ["bottom", "Agregar margen abajo"]].filter(([side]) => !elements.some((item) => item.type === "margin" && item.parent_id === element.id && item.side === side)).map(([side, label]) => [`margin:${side}`, label]), ["center", "Centrar"]];
      menu.innerHTML = items.map(([action, label]) => `<button type="button" data-object-action="${action}">${label}</button>`).join("");
      editor.appendChild(menu);
      const rect = editor.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(x - rect.left, rect.width - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(56, Math.min(y - rect.top, rect.height - menu.offsetHeight - 56))}px`;
      menu.addEventListener("click", (event) => {
        const action = event.target.closest("[data-object-action]")?.dataset.objectAction;
        if (!action) return;
        menu.remove();
        if (action === "remove") {
          const removed = elements.filter((item) => item.id === element.id || item.parent_id === element.id);
          removed.forEach((item) => {
            pendingImages.delete(item.id);
            if (item.preview_url && objectUrls.has(item.preview_url)) {
              URL.revokeObjectURL(item.preview_url);
              objectUrls.delete(item.preview_url);
            }
          });
          elements = elements.filter((item) => item.id !== element.id && item.parent_id !== element.id);
        }
        else if (action.startsWith("margin:")) addMargin(element, action.split(":")[1]);
        else if (action === "center") {
          const sideMargins = elements.filter((item) => item.type === "margin" && item.parent_id === element.id && ["left", "right"].includes(item.side));
          const left = sideMargins.find((item) => item.side === "left") || { id: crypto.randomUUID(), type: "margin", parent_id: element.id, side: "left" };
          const right = sideMargins.find((item) => item.side === "right") || { id: crypto.randomUUID(), type: "margin", parent_id: element.id, side: "right" };
          const width = Math.min(Number(element.width) || 22, 70);
          element.x = Math.max(0, (100 - width) / 2);
          element.width = width;
          if (!elements.includes(left)) elements.push(left);
          if (!elements.includes(right)) elements.push(right);
          renderElements();
        }
        renderElements();
        updateDirtyState();
      });
    };
    const bindCanvasElements = () => canvas.querySelectorAll("[data-ticket-element]").forEach((node) => {
      const element = elements.find((item) => item.id === JSON.parse(node.dataset.ticketElement).id);
      if (!element) return;
      let start = null;
      let longPress = null;
      node.addEventListener("dblclick", (event) => { event.preventDefault(); openObjectMenu(element, event.clientX, event.clientY); });
      node.addEventListener("contextmenu", (event) => { event.preventDefault(); openObjectMenu(element, event.clientX, event.clientY); });
      node.addEventListener("pointerdown", (event) => {
        if (event.target.closest("[data-ticket-resize]")) return;
        const parent = element.type === "margin" ? elements.find((item) => item.id === element.parent_id) : element;
        start = { x: event.clientX, y: event.clientY, left: Number(parent?.x) || 0, top: Number(parent?.y) || 0, mode: element.type === "margin" ? "margin" : "move", parent };
        longPress = setTimeout(() => openObjectMenu(element, event.clientX, event.clientY), 500);
        node.setPointerCapture(event.pointerId);
      });
      node.addEventListener("pointermove", (event) => {
        if (!start || event.buttons === 0 || start.mode === "resize") return;
        const rect = canvas.getBoundingClientRect();
        const dx = (event.clientX - start.x) / rect.width * 100;
        const dy = (event.clientY - start.y) / rect.height * 100;
        if (Math.abs(dx) + Math.abs(dy) > 1) clearTimeout(longPress);
        if (start.mode !== "margin") return;
        const target = start.parent;
        if (!target) return;
        if (["left", "right"].includes(element.side)) target.x = Math.max(0, Math.min(100 - target.width, start.left + dx));
        else target.y = Math.max(0, Math.min(100 - target.height, start.top + dy));
        const parentNode = [...canvas.querySelectorAll("[data-ticket-element]")].find((candidate) => JSON.parse(candidate.dataset.ticketElement).id === target.id);
        if (parentNode) { parentNode.style.left = `${target.x}%`; parentNode.style.top = `${target.y}%`; }
      });
      node.addEventListener("pointerup", () => { clearTimeout(longPress); start = null; updateDirtyState(); });
      node.querySelector("[data-ticket-resize]")?.addEventListener("pointerdown", (event) => {
        event.stopPropagation(); event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        if (element.type === "margin") {
          const parent = elements.find((item) => item.id === element.parent_id);
          start = { x: event.clientX, y: event.clientY, left: Number(parent?.x) || 0, top: Number(parent?.y) || 0, mode: "margin", parent };
        } else {
          start = { x: event.clientX, y: event.clientY, width: Number(element.width) || 20, height: Number(element.height) || 8, mode: "resize", rect };
        }
        node.setPointerCapture(event.pointerId);
      });
      node.addEventListener("pointermove", (event) => {
        if (element.type === "margin" || start?.mode !== "resize" || event.buttons === 0) return;
        element.width = Math.max(4, Math.min(100 - (Number(element.x) || 0), start.width + (event.clientX - start.x) / start.rect.width * 100));
        element.height = Math.max(3, Math.min(100 - (Number(element.y) || 0), start.height + (event.clientY - start.y) / start.rect.height * 100));
        node.style.width = `${element.width}%`; node.style.height = `${element.height}%`;
      });
      node.addEventListener("pointerup", () => { if (start) { start = null; updateDirtyState(); } });
    });
    editor.querySelectorAll("input, select, textarea").forEach((input) => {
      input.addEventListener("input", updatePreview);
      input.addEventListener("change", updatePreview);
    });
    editor.querySelector('[name="paper_width_mm"]').addEventListener("change", (event) => { canvas.dataset.paperWidth = event.target.value; updatePreview(); });
    editor.querySelector("[data-ticket-add]").addEventListener("click", () => { const menu = editor.querySelector("[data-ticket-add-menu]"); menu.hidden = !menu.hidden; });
    editor.querySelectorAll("[data-add-element]").forEach((button) => button.addEventListener("click", () => {
      editor.querySelector("[data-ticket-add-menu]").hidden = true;
      const type = button.dataset.addElement;
      const insert = (file = null) => {
        const element = { id: crypto.randomUUID(), type, x: 0, y: 0, width: type === "image" ? 30 : 24, height: type === "image" ? 18 : 16 };
        if (file) { pendingImages.set(element.id, file); element.preview_url = URL.createObjectURL(file); objectUrls.add(element.preview_url); }
        elements.push(element);
        renderElements();
        updateDirtyState();
      };
      if (type === "image") showTicketImagePicker(insert); else insert();
    }));
    renderElements();
    updatePreview();
    initialEditorState = currentEditorState();
    saveButton.disabled = true;
    editor.addEventListener("close", () => {
      marginObserver.disconnect();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    }, { once: true });
  }
  async function openPrintFlowEditor(flow = null) {
    const routes = flow ? (state.printingFlowRoutes || []).filter((r) => r.flow_id === flow.id && r.event_keys?.length) : [];
    const [{ data: accountRows, error: accountError }, { data: sharedAccountOrder, error: orderError }] = await Promise.all([
      supabase.from("accounts").select("auth_user_id,username,display_name,role_ids")
        .eq("restaurant_id",state.restaurantId).eq("is_active",true).order("display_name"),
      supabase.from("printing_flow_engine_accounts").select("account_id").eq("restaurant_id",state.restaurantId).order("priority"),
    ]);
    if (accountError || orderError) { toast("No se pudo cargar la lista global de cuentas motor."); return; }
    const enabledRoles = state.availableRoles || [];
    const hasPrintPermission = (account) => {
      const roles = enabledRoles.filter((role) => (account.role_ids || []).includes(role.id));
      if (roles.some((role) => role.key === "admin")) return true;
      if (roles.some((role) => role.key === "employee")) return enabledRoles.some((role) => ["orders","payments","kitchen","salon"].some((key) => role.permissions?.[key]));
      return roles.some((role) => ["orders","payments","kitchen","salon"].some((key) => role.permissions?.[key]));
    };
    const accounts = (accountRows || []).filter(hasPrintPermission);
    const points = state.printingPoints || [], templates = state.printingTicketTemplates || [];
    const accountOrder = (sharedAccountOrder || []).map((row) => row.account_id).filter((id) => accounts.some((a) => a.auth_user_id===id));
    accounts.forEach((a) => { if (!accountOrder.includes(a.auth_user_id)) accountOrder.push(a.auth_user_id); });
    const normalizeFlowDataObject=(eventKey,key)=>(PRINT_EVENT_DATA_OBJECTS[eventKey]||[]).some((item)=>item.key===key)?key:(
      key==="open_order"&&eventKey==="paid_order_created"?"open_order":
      key==="event"&&["open_order_created","open_order_updated"].includes(eventKey)?"open_order":
      ["order","items"].includes(key)&&["open_order_created","open_order_updated"].includes(eventKey)?"open_order":
      key==="event"&&["paid_order_created","payment_corrected","manual_reprint"].includes(eventKey)?"paid_order":
      ["event","order","items","payment"].includes(key)&&["paid_order_created","payment_corrected","manual_reprint"].includes(eventKey)?"paid_order":
      key==="order"&&["kitchen_order_ready","salon_order_delivered"].includes(eventKey)?"items":
      key==="payment"&&eventKey==="payment_corrected"?"payment":
      key==="event"&&["kitchen_order_ready","salon_order_delivered"].includes(eventKey)?"event":""
    );
    const savedNodes = Array.isArray(flow?.editor_nodes) ? flow.editor_nodes : [];
    const groups = savedNodes.length
      ? savedNodes.map((node,index) => ({
        node_id: node.node_id || crypto.randomUUID(),
        key: node.event_key || node.key || "",
        point: node.point_id || node.point || "",
        mode: node.output_mode || node.mode || "",
        tasks: Array.isArray(node.tasks) ? node.tasks.map((task) => ({...task,data_object_key:normalizeFlowDataObject(node.event_key||node.key||"",task.data_object_key||"")})) : [],
        position: node.position && Number.isFinite(Number(node.position.x)) && Number.isFinite(Number(node.position.y))
          ? {x:Number(node.position.x),y:Number(node.position.y)} : {x:100+index*280,y:80},
      }))
      : (flow?.captured_events || []).map((key,index) => {
        const tasks = routes.filter((r) => r.event_keys.includes(key)).sort((a,b) => a.sort_order-b.sort_order);
        return { node_id:crypto.randomUUID(),key,point:tasks[0]?.point_id||"",mode:tasks[0]?.output_mode||"",tasks:tasks.map((task)=>({...task,data_object_key:normalizeFlowDataObject(key,task.data_object_key||"")})),position:{x:100+index*280,y:80} };
      });
    let currentActive = flow ? Boolean(flow.is_active) : accountOrder.length > 0;
    let flowEditorDialog = null;
    let flowWasDeleted = false;
    let selectedGroup = groups.length ? 0 : -1;
    let selectedNodeType = "event";
    let selectedTaskIndex = -1;
    let graphZoom = 1;
    let suppressGraphClick = false;
    let initialAccountOrder = JSON.stringify(accountOrder);
    let initialFlowActive = currentActive;
    const eventLabel = (key) => printEventLabel(key) || key;
    const pointLabel = (id) => points.find((point) => point.id===id)?.name || "Selecciona impresora";
    const dataObjects=(eventKey)=>PRINT_EVENT_DATA_OBJECTS[eventKey]||[];
    const dataObjectLabel=(eventKey,key)=>dataObjects(eventKey).find((item)=>item.key===key)?.label||"Datos por configurar";
    const groupComplete=(group)=>{
      if(!PRINT_EVENTS.some(([key])=>key===group.key))return false;
      const point=points.find((item)=>item.id===group.point);
      if(!point||!point.is_active||!point.device_id||printingPointIsDeprecated(point))return false;
      const modes=point.supported_output_modes||[point.output_mode||"manual"];
      if(!modes.includes(group.mode)||!group.tasks?.length)return false;
      return group.tasks.every((task)=>dataObjects(group.key).some((item)=>item.key===task.data_object_key)
        && templates.some((template)=>template.id===task.template_id)
        && Number.isInteger(Number(task.copies))&&Number(task.copies)>=1&&Number(task.copies)<=20);
    };
    const nodeSnapshot=()=>JSON.stringify(groups.map((group)=>({node_id:group.node_id,key:group.key,point:group.point,mode:group.mode,tasks:group.tasks.map((task)=>({id:task.id||null,data_object_key:task.data_object_key||"",template_id:task.template_id||"",copies:task.copies==null?"":Number(task.copies)})),position:group.position||{x:0,y:0}})));
    const initialNodesSnapshot = nodeSnapshot();
    const objectOptionsMarkup=(eventKey,value="")=>`<option value="">Selecciona los datos</option>${dataObjects(eventKey).map((item)=>`<option value="${esc(item.key)}" ${item.key===value?"selected":""}>${esc(item.label)}</option>`).join("")}`;
    const templateOptionsMarkup=(value="")=>`<option value="">Selecciona formato</option>${templates.map((template)=>`<option value="${esc(template.id)}" ${template.id===value?"selected":""}>${esc(template.name)}</option>`).join("")}`;
    const circleNode=(group,index,type,taskIndex=-1)=>{
      const complete=groupComplete(group),selected=selectedGroup===index&&selectedNodeType===type&&(type!=="task"||selectedTaskIndex===taskIndex);
      const task=taskIndex>=0?group.tasks[taskIndex]:null;
      const isEvent=type==="event",isPrinter=type==="printer";
      const title=isEvent?eventLabel(group.key):isPrinter?pointLabel(group.point):(templates.find((item)=>item.id===task?.template_id)?.name||`Tarea ${taskIndex+1}`);
      const detail=isEvent?"Evento":isPrinter?`${group.mode==="manual"?"Manual":"Automática"} · ${pointLabel(group.point)}`:`${dataObjectLabel(group.key,task?.data_object_key)} · ${Number(task?.copies)||"—"} copias`;
      const icon=isEvent?'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 18h8"/></svg>':isPrinter?'<svg viewBox="0 0 24 24"><path d="M6 8V3h12v5M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6zM18 11h.01"/></svg>':'<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM15 3v5h5M9 12h7M9 16h7"/></svg>';
      return `<button type="button" class="flow-graph-node ${isEvent?"is-event":isPrinter?"is-printer":"is-task"} ${complete?"":"is-inactive"} ${selected?"is-selected":""}" data-select-flow-node data-group-index="${index}" data-node-type="${type}" data-task-index="${taskIndex}" aria-label="${esc(`${title}. ${detail}${complete?"":". Inactivo, falta configurar"}`)}"><span class="flow-graph-icon" aria-hidden="true">${icon}</span><strong>${esc(title)}</strong><small>${esc(detail)}</small>${complete?"":'<span class="flow-node-state">Inactivo</span>'}</button>`;
    };
    const groupMarkup=(group,index)=>{
      const attached=[circleNode(group,index,"printer")];
      group.tasks.forEach((task,taskIndex)=>attached.push(circleNode(group,index,"task",taskIndex)));
      const position=group.position||{x:0,y:0};
      return `<div class="flow-graph-chain" data-graph-group-index="${index}" style="left:${Math.max(0,Number(position.x)||0)}px;top:${Math.max(0,Number(position.y)||0)}px"><div class="flow-event-column"><div class="flow-event-main">${circleNode(group,index,"event")}</div><div class="flow-event-branch"><span class="flow-graph-link flow-graph-vertical-link" aria-hidden="true"></span>${attached.map((node,nodeIndex)=>`${nodeIndex?'<span class="flow-graph-link flow-graph-vertical-link" aria-hidden="true"></span>':""}${node}`).join("")}</div></div></div>`;
    };
    const editorBody=`<label class="settings-field flow-name-field">Nombre del flujo<input name="name" required maxlength="80" value="${esc(flow?.name||"")}" placeholder="Ej. Comandas de cocina"></label><div class="flow-editor-toolbar"><div><strong>Cadena principal de eventos</strong><p class="meta">Mueve los nodos y arrastra el lienzo para navegar. Cada nodo nuevo exige evento, punto y primera tarea completos; el flujo requiere al menos un nodo completo.</p></div><div class="flow-zoom-controls"><button type="button" data-zoom-out aria-label="Alejar">−</button><span data-zoom-label>100%</span><button type="button" data-zoom-in aria-label="Acercar">+</button><button type="button" data-zoom-fit>Ajustar</button></div></div><section class="flow-graph-shell"><div class="flow-graph-viewport" data-flow-viewport><div class="flow-graph-canvas" data-flow-graph>${groups.map(groupMarkup).join("")||'<div class="flow-graph-empty"><button type="button" class="flow-graph-add" data-add-event aria-label="Crear nodo">+</button><strong>Empieza con un nodo</strong><span>Al crear cada nodo definirás evento, punto y primera tarea.</span></div>'}${groups.length?'<button type="button" class="flow-graph-add flow-graph-add-tail" data-add-event aria-label="Crear nodo">+</button>':""}</div></div></section><div class="flow-graph-selection" data-graph-selection></div>`;
    flowEditorDialog=openPrintDialog(flow?"Editar flujo de impresión":"Crear flujo de impresión",editorBody,async(d)=>{
      const name=String(new FormData(d).get("name")||"").trim();
      syncGraphOrder();
      if(!name)throw new Error("Escribe un nombre para el flujo.");
      const completeGroups=groups.filter(groupComplete);
      if(!completeGroups.length)throw new Error("Configura por completo al menos un nodo antes de crear el flujo.");
      const eventKeys=groups.map((group)=>group.key);
      if(eventKeys.some((key,index)=>eventKeys.indexOf(key)!==index))throw new Error("Cada evento puede aparecer una sola vez en la cadena.");
      const capturedEvents=completeGroups.map((group)=>group.key),payloadRoutes=[];let sortOrder=0;
      for(const group of completeGroups){
        const point=points.find((item)=>item.id===group.point);
        for(const task of group.tasks){
          const template=templates.find((item)=>item.id===task.template_id);
          const route={point_id:point.id,template_id:template.id,event_keys:[group.key],output_mode:group.mode,copies:Number(task.copies),cadence_ms:0,text_depth:template.format?.layout?.text_depth||"standard",data_object_key:task.data_object_key,sort_order:sortOrder++};
          if(task.id)route.route_id=task.id;
          payloadRoutes.push(route);
        }
      }
      const editorNodes=groups.map((group,index)=>({node_id:group.node_id,event_key:group.key,point_id:group.point||null,output_mode:group.mode||null,tasks:group.tasks.map((task)=>({id:task.id||null,data_object_key:task.data_object_key||null,template_id:task.template_id||null,copies:task.copies==null||task.copies===""?null:Number(task.copies)})),position:group.position||{x:index*260,y:0}}));
      const {error}=await supabase.rpc("save_printing_flow_editor_graph",{p_flow_id:flow?.id||null,p_name:name,p_captured_events:capturedEvents,p_is_active:currentActive,p_routes:payloadRoutes,p_engine_account_order:accountOrder,p_editor_nodes:editorNodes});
      if(error)throw new Error(({invalid_printing_flow_nodes:"El lienzo contiene nodos con datos inválidos.",duplicate_printing_flow_event_node:"No repitas un evento en la cadena.",printing_flow_account_order_required:"Deja al menos una cuenta en la lista global, porque hay flujos activos.",printing_flow_account_unavailable:"Una cuenta ya no está activa o no tiene permisos de impresión.",event_data_object_unavailable:"La tarea eligió datos que ese evento no contiene.",printing_event_multiple_points:"Cada evento debe tener un solo punto de impresión.",printing_event_without_task:"Cada evento activo necesita al menos una tarea.",invalid_print_data_object:"El objeto de datos de una tarea no es válido.",printing_point_unavailable:"Uno de los puntos ya no está disponible.",ticket_template_required:"Cada tarea necesita un formato de ticket.",ticket_template_unavailable:"Uno de los formatos ya no está disponible."})[error.message]||error.message||"No se pudo guardar el flujo.");
    },{submitLabel:flow?"Guardar":"Crear",disableSaveInitially:true,successToast:flow?"Flujo guardado.":"Flujo creado.",dialogClass:"flow-editor-dialog"});
    const graph=flowEditorDialog.querySelector("[data-flow-graph]"),viewport=flowEditorDialog.querySelector("[data-flow-viewport]"),saveButton=flowEditorDialog.querySelector("[data-save]"),nameInput=flowEditorDialog.querySelector('[name="name"]');
    const initialName=nameInput.value;
    const syncGraphOrder=()=>groups.forEach((group,index)=>{
      if(!group.position||!Number.isFinite(Number(group.position.x))||!Number.isFinite(Number(group.position.y)))group.position={x:100+index*280,y:80};
    });
    const drawEventConnectors=()=>{
      const svg=graph.querySelector(".flow-graph-connectors"),paths=svg?.querySelector(".flow-graph-paths");
      if(!svg||!paths)return;
      const width=Math.max(viewport.clientWidth/graphZoom,...groups.map((group)=>Number(group.position?.x||0)+400),500);
      const height=Math.max(viewport.clientHeight/graphZoom,...groups.map((group)=>Number(group.position?.y||0)+230+group.tasks.length*172),420);
      graph.style.width=`${width}px`;graph.style.height=`${height}px`;
      svg.setAttribute("width",String(width));svg.setAttribute("height",String(height));svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
      paths.innerHTML=groups.slice(0,-1).map((group,index)=>{
        const next=groups[index+1],startX=Number(group.position?.x||0)+178,startY=Number(group.position?.y||0)+71,endX=Number(next.position?.x||0)+30,endY=Number(next.position?.y||0)+71;
        const bend=Math.max(36,Math.abs(endX-startX)*.35);
        const direction=endX>=startX?1:-1;
        return `<path class="flow-graph-connector-path" d="M ${startX} ${startY} C ${startX+direction*bend} ${startY}, ${endX-direction*bend} ${endY}, ${endX} ${endY}" marker-end="url(#flow-arrow)"/>`;
      }).join("");
    };
    const updateMainSave=()=>{
      const changed=nameInput.value!==initialName||nodeSnapshot()!==initialNodesSnapshot
        ||JSON.stringify(accountOrder)!==initialAccountOrder||currentActive!==initialFlowActive;
      saveButton.disabled=flow?!(changed&&groups.some(groupComplete)):!groups.some(groupComplete);
    };
    nameInput.addEventListener("input",updateMainSave);
    const renderGraph=()=>{
      graph.innerHTML=`<svg class="flow-graph-connectors" aria-hidden="true"><defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"></path></marker></defs><g class="flow-graph-paths"></g></svg>${groups.map(groupMarkup).join("")||'<div class="flow-graph-empty"><button type="button" class="flow-graph-add" data-add-event aria-label="Crear nodo">+</button><strong>Empieza con un nodo</strong><span>Al crear cada nodo definirás evento, punto y primera tarea.</span></div>'}`;
      if(groups.length){const tail=groups.reduce((last,group)=>Number(group.position?.x||0)>Number(last.position?.x||0)?group:last,groups[0]);graph.insertAdjacentHTML("beforeend",`<button type="button" class="flow-graph-add flow-graph-add-tail" data-add-event aria-label="Crear nodo" style="left:${Number(tail.position?.x||0)+280}px;top:${Number(tail.position?.y||0)+47}px">+</button>`);}
      drawEventConnectors();
      graph.querySelectorAll("[data-select-flow-node]").forEach((button)=>button.addEventListener("click",()=>{const target=groups[Number(button.dataset.groupIndex)];syncGraphOrder();selectedGroup=groups.indexOf(target);selectedNodeType=button.dataset.nodeType;selectedTaskIndex=Number(button.dataset.taskIndex);renderGraph();}));
      graph.querySelectorAll("[data-add-event]").forEach((button)=>button.addEventListener("click",addEvent));
      graph.querySelectorAll("[data-graph-group-index]").forEach((node)=>{
        let drag=null;
        node.addEventListener("pointerdown",(event)=>{if(event.button!==0)return;selectedGroup=Number(node.dataset.graphGroupIndex);selectedNodeType="event";selectedTaskIndex=-1;drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,left:Number(groups[selectedGroup].position?.x||0),top:Number(groups[selectedGroup].position?.y||0),moved:false};(event.target.closest("[data-select-flow-node]")||node).setPointerCapture(event.pointerId);});
        node.addEventListener("pointermove",(event)=>{if(!drag||drag.pointerId!==event.pointerId)return;const dx=(event.clientX-drag.startX)/graphZoom,dy=(event.clientY-drag.startY)/graphZoom;if(!drag.moved&&Math.hypot(dx,dy)<5)return;drag.moved=true;event.preventDefault();const group=groups[Number(node.dataset.graphGroupIndex)];group.position={x:Math.max(0,drag.left+dx),y:Math.max(0,drag.top+dy)};node.style.left=`${group.position.x}px`;node.style.top=`${group.position.y}px`;const tail=graph.querySelector(".flow-graph-add-tail"),rightmost=groups.reduce((last,item,index)=>Number(item.position?.x||0)>Number(groups[last]?.position?.x||0)?index:last,0),tailGroup=groups[rightmost];if(tail&&tailGroup){tail.style.left=`${Number(tailGroup.position?.x||0)+280}px`;tail.style.top=`${Number(tailGroup.position?.y||0)+47}px`;}drawEventConnectors();});
        const endDrag=(event)=>{if(!drag||drag.pointerId!==event.pointerId)return;const moved=drag.moved;drag=null;if(moved){suppressGraphClick=true;window.setTimeout(()=>{suppressGraphClick=false;},0);renderGraph();}};
        node.addEventListener("pointerup",endDrag);node.addEventListener("pointercancel",endDrag);
      });
      if(!graph.dataset.clickGuard){graph.dataset.clickGuard="true";graph.addEventListener("click",(event)=>{if(!suppressGraphClick)return;suppressGraphClick=false;event.preventDefault();event.stopImmediatePropagation();},true);}
      const selection=flowEditorDialog.querySelector("[data-graph-selection]");
      if(selectedGroup>=0&&groups[selectedGroup]){
        const selected=groups[selectedGroup],selectedTask=selectedNodeType==="task"?selected.tasks[selectedTaskIndex]:null;
        const info=selectedNodeType==="event"?`Escucha: ${eventLabel(selected.key)}`:selectedNodeType==="printer"?`Punto: ${pointLabel(selected.point)}`:`Tarea: ${templates.find((item)=>item.id===selectedTask?.template_id)?.name||"Por configurar"} · ${dataObjectLabel(selected.key,selectedTask?.data_object_key)}`;
        selection.innerHTML=`<div><strong>${esc(info)}</strong><span>${groupComplete(selected)?"Nodo configurado y activo":"Nodo inactivo · completa sus datos para incorporarlo al flujo"}</span></div><div class="flow-selection-actions"><button type="button" class="btn secondary" data-edit-global-list>Editar lista</button><button type="button" class="flow-icon-action" data-edit-selected aria-label="Editar nodo" title="Editar">✎</button><button type="button" class="flow-icon-action is-danger" data-remove-selected aria-label="Eliminar nodo" title="Eliminar">×</button></div>`;
        selection.querySelector("[data-edit-selected]").addEventListener("click",()=>openGroupEditor(selected));
        selection.querySelector("[data-remove-selected]").addEventListener("click",()=>{syncGraphOrder();if(selectedNodeType==="task"&&selectedTaskIndex>=0)selected.tasks.splice(selectedTaskIndex,1);else groups.splice(selectedGroup,1);selectedGroup=groups.length?Math.min(selectedGroup,groups.length-1):-1;selectedNodeType="event";selectedTaskIndex=-1;renderGraph();updateMainSave();});
        selection.querySelector("[data-edit-global-list]").addEventListener("click",openGlobalListManager);
      }else selection.innerHTML='<span class="meta">Selecciona un nodo circular para ver sus datos y acciones.</span>';
      flowEditorDialog.querySelector("[data-zoom-label]").textContent=`${Math.round(graphZoom*100)}%`;
      graph.style.zoom=String(graphZoom);
      updateMainSave();
    };
    const zoomBy=(delta)=>{graphZoom=Math.max(.4,Math.min(1.5,Math.round((graphZoom+delta)*100)/100));renderGraph();};
    flowEditorDialog.querySelector("[data-zoom-in]").addEventListener("click",()=>zoomBy(.1));
    flowEditorDialog.querySelector("[data-zoom-out]").addEventListener("click",()=>zoomBy(-.1));
    flowEditorDialog.querySelector("[data-zoom-fit]").addEventListener("click",()=>{
      if(groups.length){
        const maxX=Math.max(...groups.map((group)=>Number(group.position?.x||0)+208))+48;
        const maxY=Math.max(...groups.map((group)=>Number(group.position?.y||0)+142+(group.tasks.length+1)*172))+48;
        graphZoom=Math.max(.4,Math.min(1,viewport.clientWidth/maxX,viewport.clientHeight/maxY));
      }else graphZoom=1;
      renderGraph();
      viewport.scrollTo({left:0,top:0,behavior:"smooth"});
    });
    let pan=null;
    viewport.addEventListener("pointerdown",(event)=>{
      if(event.target.closest("button,[data-graph-group-index]"))return;
      pan={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
      viewport.classList.add("is-panning");
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener("pointermove",(event)=>{
      if(!pan)return;
      viewport.scrollLeft=pan.left-(event.clientX-pan.x);
      viewport.scrollTop=pan.top-(event.clientY-pan.y);
    });
    const stopPan=()=>{pan=null;viewport.classList.remove("is-panning");};
    viewport.addEventListener("pointerup",stopPan);
    viewport.addEventListener("pointercancel",stopPan);
    const addEvent=()=>{
      syncGraphOrder();
      openCreateFlowNode();
    };
    const openGroupEditor=(group)=>{
      const otherKeys=new Set(groups.filter((item)=>item!==group).map((item)=>item.key));
      const eventOptions=PRINT_EVENTS.filter(([key])=>!otherKeys.has(key)||key===group.key).map(([key,label])=>`<option value="${esc(key)}" ${group.key===key?"selected":""}>${esc(label)}</option>`).join("");
      const pointOptions=`<option value="">Selecciona un punto</option>${points.map((point)=>`<option value="${esc(point.id)}" ${group.point===point.id?"selected":""}>${esc(point.name)}${!point.is_active?" · Pausado":""}${printingPointIsDeprecated(point)?" · Deprecated":""}</option>`).join("")}`;
      const taskMarkup=(task={})=>`<div class="flow-task-config" draggable="true" data-flow-task data-route-id="${esc(task.id||"")}"><span class="flow-task-grip" aria-hidden="true">⠿</span><label class="settings-field">Objeto de datos<select data-task-object>${objectOptionsMarkup(group.key,task.data_object_key||"")}</select></label><label class="settings-field">Formato<select data-task-template>${templateOptionsMarkup(task.template_id||"")}</select></label><label class="settings-field flow-copies">Copias<input data-task-copies type="number" min="1" max="20" value="${task.copies??""}"></label><button type="button" class="flow-icon-action is-danger" data-remove-task aria-label="Quitar tarea">×</button></div>`;
      const point=points.find((item)=>item.id===group.point),modes=point?.supported_output_modes||[point?.output_mode||"manual"];
      const modeOptions=`<option value="">Selecciona salida</option>${modes.map((mode)=>`<option value="${mode}" ${mode===group.mode?"selected":""}>${mode==="automatic"?"Automática":"Manual"}</option>`).join("")}`;
      const body=`<label class="settings-field">Evento escuchado<select name="event_key">${eventOptions}</select></label><div class="flow-printer-config"><label class="settings-field">Punto de impresión<select name="point_id">${pointOptions}</select></label><label class="settings-field">Modo de salida<select name="output_mode">${modeOptions}</select></label></div><p class="meta flow-data-hint" data-object-hint>${group.key==="paid_order_created"?"El objeto Pedido abierto solo existe cuando el pago provino de un pedido abierto; en pagos directos esa tarea se reportará como no disponible.":"Los objetos disponibles dependen del evento escuchado."}</p><section class="flow-task-config-section"><div><strong>Tareas de impresión</strong><p class="meta">Cada tarea debe indicar qué objeto imprime, qué formato usa y cuántas copias prepara.</p></div><div data-task-config-list>${group.tasks.length?group.tasks.map(taskMarkup).join(""):taskMarkup({})}</div><button type="button" class="btn secondary" data-add-config-task>+ Añadir tarea</button></section>`;
      const initial=JSON.stringify({key:group.key,point:group.point,mode:group.mode,tasks:group.tasks.map((task)=>({id:task.id||null,data_object_key:task.data_object_key||"",template_id:task.template_id||"",copies:task.copies==null?"":String(task.copies)}))});
      const editor=openPrintDialog("Editar nodo del flujo",body,async(d)=>{
        const key=d.querySelector('[name="event_key"]').value,pointId=d.querySelector('[name="point_id"]').value;
        if(groups.some((item)=>item!==group&&item.key===key))throw new Error("Ese evento ya tiene un nodo en esta cadena.");
        const tasks=[...d.querySelectorAll("[data-flow-task]")].map((row)=>({id:row.dataset.routeId||null,data_object_key:row.querySelector("[data-task-object]").value||null,template_id:row.querySelector("[data-task-template]").value||null,copies:row.querySelector("[data-task-copies]").value===""?null:Number(row.querySelector("[data-task-copies]").value)}));
        group.key=key;group.point=pointId;group.mode=d.querySelector('[name="output_mode"]').value;group.tasks=tasks;renderGraph();
      },{dialogClass:"flow-node-editor-dialog",disableSaveInitially:true,reloadAfterSave:false,successToast:""});
      const list=editor.querySelector("[data-task-config-list]"),editSave=editor.querySelector("[data-save]");
      const rowMarkup=(task)=>`<div class="flow-task-config" draggable="true" data-flow-task data-route-id="${esc(task.id||"")}"><span class="flow-task-grip" aria-hidden="true">⠿</span><label class="settings-field">Objeto de datos<select data-task-object>${objectOptionsMarkup(editor.querySelector('[name="event_key"]').value,task.data_object_key||"")}</select></label><label class="settings-field">Formato<select data-task-template>${templateOptionsMarkup(task.template_id||"")}</select></label><label class="settings-field flow-copies">Copias<input data-task-copies type="number" min="1" max="20" value="${task.copies??""}"></label><button type="button" class="flow-icon-action is-danger" data-remove-task aria-label="Quitar tarea">×</button></div>`;
      const readDraft=()=>({key:editor.querySelector('[name="event_key"]').value,point:editor.querySelector('[name="point_id"]').value,mode:editor.querySelector('[name="output_mode"]').value,tasks:[...editor.querySelectorAll("[data-flow-task]")].map((row)=>({id:row.dataset.routeId||null,data_object_key:row.querySelector("[data-task-object]").value||"",template_id:row.querySelector("[data-task-template]").value||"",copies:row.querySelector("[data-task-copies]").value}))});
      const updateEditDirty=()=>{editSave.disabled=JSON.stringify(readDraft())===initial;};
      let draggedTask=null;
      const bindTaskRow=(row)=>{
        row.querySelector("[data-remove-task]")?.addEventListener("click",(event)=>{event.currentTarget.closest("[data-flow-task]").remove();updateEditDirty();});
        row.addEventListener("dragstart",(event)=>{draggedTask=row;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",row.dataset.routeId||"task");row.classList.add("is-dragging");});
        row.addEventListener("dragend",()=>{row.classList.remove("is-dragging");draggedTask=null;updateEditDirty();});
        row.addEventListener("dragover",(event)=>{if(!draggedTask||draggedTask===row)return;event.preventDefault();const rect=row.getBoundingClientRect();list.insertBefore(draggedTask,event.clientY>rect.top+rect.height/2?row.nextSibling:row);});
      };
      list.querySelectorAll("[data-flow-task]").forEach(bindTaskRow);
      editor.querySelector("[data-add-config-task]").addEventListener("click",()=>{list.insertAdjacentHTML("beforeend",rowMarkup({}));bindTaskRow(list.lastElementChild);updateEditDirty();});
      editor.querySelector('[name="event_key"]').addEventListener("change",(event)=>{
        list.querySelectorAll("[data-task-object]").forEach((select)=>{const previous=select.value;select.innerHTML=objectOptionsMarkup(event.target.value);if(dataObjects(event.target.value).some((item)=>item.key===previous))select.value=previous;});
        editor.querySelector("[data-object-hint]").textContent=event.target.value==="paid_order_created"?"El objeto Pedido abierto solo existe cuando el pago provino de un pedido abierto; en pagos directos esa tarea se reportará como no disponible.":"Los objetos disponibles dependen del evento escuchado.";updateEditDirty();
      });
      editor.querySelector('[name="point_id"]').addEventListener("change",(event)=>{const selected=points.find((item)=>item.id===event.target.value),availableModes=selected?.supported_output_modes||[selected?.output_mode||"manual"],modeSelect=editor.querySelector('[name="output_mode"]');modeSelect.innerHTML=`<option value="">Selecciona salida</option>${availableModes.map((mode)=>`<option value="${mode}">${mode==="automatic"?"Automática":"Manual"}</option>`).join("")}`;updateEditDirty();});
      editor.querySelector("form").addEventListener("input",updateEditDirty);editor.querySelector("form").addEventListener("change",updateEditDirty);
    };
    const openCreateFlowNode=()=>{
      const unusedEvents=PRINT_EVENTS.filter(([key])=>!groups.some((group)=>group.key===key));
      if(!unusedEvents.length){toast("Ya agregaste todos los eventos disponibles.");return;}
      const eventOptions=`<option value="">Selecciona un evento</option>${unusedEvents.map(([key,label])=>`<option value="${esc(key)}">${esc(label)}</option>`).join("")}`;
      const pointOptions=`<option value="">Selecciona un punto</option>${points.map((point)=>`<option value="${esc(point.id)}">${esc(point.name)}${!point.is_active?" · Pausado":""}${printingPointIsDeprecated(point)?" · Deprecated":""}</option>`).join("")}`;
      const body=`<p class="meta">Antes de crear el nodo define todos sus datos. La primera tarea también se configura aquí; no se completa automáticamente.</p><label class="settings-field">Evento que escuchará<select name="event_key" required>${eventOptions}</select></label><label class="settings-field">Punto de impresión<select name="point_id" required>${pointOptions}</select></label><label class="settings-field">Modo de salida<select name="output_mode" required><option value="">Selecciona una salida</option></select></label><section class="flow-task-config-section"><div><strong>Primera tarea de impresión</strong><p class="meta">Elige el objeto exacto del evento, un formato y las copias.</p></div><label class="settings-field">Objeto de datos<select name="data_object_key" required>${objectOptionsMarkup("")}</select></label><label class="settings-field">Formato de ticket<select name="template_id" required>${templateOptionsMarkup()}</select></label><label class="settings-field">Copias<input name="copies" type="number" min="1" max="20" step="1" required></label><p class="meta" data-create-object-hint>Elige un evento para ver solo los objetos que ese evento entrega.</p></section><p class="meta flow-create-validation" data-create-validation role="status">Completa todos los datos para crear este nodo.</p>`;
      const editor=openPrintDialog("Crear nodo",body,async(d)=>{
        const maxX=groups.reduce((max,item)=>Math.max(max,Number(item.position?.x||0)),0);
        const group={node_id:crypto.randomUUID(),key:d.querySelector('[name="event_key"]').value,point:d.querySelector('[name="point_id"]').value,mode:d.querySelector('[name="output_mode"]').value,tasks:[{data_object_key:d.querySelector('[name="data_object_key"]').value,template_id:d.querySelector('[name="template_id"]').value,copies:Number(d.querySelector('[name="copies"]').value)}],position:{x:groups.length?maxX+280:80,y:80}};
        if(!groupComplete(group))throw new Error("Completa evento, punto, salida, objeto, formato y copias antes de crear el nodo.");
        groups.push(group);selectedGroup=groups.length-1;selectedNodeType="event";selectedTaskIndex=-1;renderGraph();
      },{submitLabel:"Crear nodo",disableSaveInitially:true,reloadAfterSave:false,successToast:"" ,dialogClass:"flow-node-editor-dialog flow-node-create-dialog"});
      const refreshCreateAvailability=()=>{const group={key:editor.querySelector('[name="event_key"]').value,point:editor.querySelector('[name="point_id"]').value,mode:editor.querySelector('[name="output_mode"]').value,tasks:[{data_object_key:editor.querySelector('[name="data_object_key"]').value,template_id:editor.querySelector('[name="template_id"]').value,copies:editor.querySelector('[name="copies"]').value}]},point=points.find((item)=>item.id===group.point),hint=editor.querySelector("[data-create-validation]");let reason="Completa evento, punto, salida, objeto de datos, formato y copias para crear este nodo.";if(group.key&&!dataObjects(group.key).length)reason="Este evento no tiene objetos imprimibles disponibles.";else if(group.point&&(!point?.is_active||!point?.device_id||printingPointIsDeprecated(point)))reason="El punto está pausado, no tiene dispositivo o está Deprecated.";else if(groupComplete(group))reason="Nodo listo para añadir al lienzo.";hint.textContent=reason;hint.classList.toggle("is-ready",groupComplete(group));editor.querySelector("[data-save]").disabled=!groupComplete(group);};
      editor.querySelector('[name="event_key"]').addEventListener("change",(event)=>{const object=editor.querySelector('[name="data_object_key"]');object.innerHTML=objectOptionsMarkup(event.target.value);editor.querySelector("[data-create-object-hint]").textContent=event.target.value==="paid_order_created"?"Pedido pagado siempre está disponible. Pedido abierto solo existe si este pago provino de un pedido abierto.":"La lista muestra únicamente los datos que entrega este evento.";refreshCreateAvailability();});
      editor.querySelector('[name="point_id"]').addEventListener("change",(event)=>{const point=points.find((item)=>item.id===event.target.value),availableModes=point?.supported_output_modes||[point?.output_mode||"manual"],mode=editor.querySelector('[name="output_mode"]');mode.innerHTML=`<option value="">Selecciona una salida</option>${availableModes.map((value)=>`<option value="${value}">${value==="automatic"?"Automática":"Manual"}</option>`).join("")}`;refreshCreateAvailability();});
      editor.querySelector("form").addEventListener("input",refreshCreateAvailability);editor.querySelector("form").addEventListener("change",refreshCreateAvailability);
    };
    const openGlobalListManager=()=>{
      const accountMarkup=()=>accountOrder.map((id,index)=>{const account=accounts.find((item)=>item.auth_user_id===id);if(!account)return "";return `<li class="flow-account-item" draggable="true" data-flow-account="${esc(id)}"><span class="flow-grip">⠿</span><span><strong>${esc(account.display_name)}</strong><small>${esc(account.username)}</small></span><span class="flow-rank">${index===0?"Motor principal":"Respaldo "+index}</span></li>`;}).join("");
      const managerBody=`<p class="meta">Este orden es global para el restaurante. La primera cuenta disponible coordina todos los flujos; las demás son respaldos.</p>${flow?`<label class="flow-manager-state"><span><strong>Estado del flujo</strong><small>${flow.is_active?"El flujo escucha sus eventos":"El flujo está pausado"}</small></span><input type="checkbox" name="flow_active" ${currentActive?"checked":""}><span class="flow-switch" aria-hidden="true"></span></label>`:""}<ol class="flow-account-list flow-account-manager-list" data-account-list>${accountMarkup()||'<li class="meta">No hay cuentas disponibles con permisos para operar impresión.</li>'}</ol>`;
      const initialManagerSnapshot=JSON.stringify({order:[...accountOrder],active:currentActive});
      let manager=null;
      manager=openPrintDialog("Editar lista",managerBody,async(managerDialog)=>{
        const nextOrder=[...managerDialog.querySelectorAll("[data-flow-account]")].map((item)=>item.dataset.flowAccount);
        const nextActive=flow?managerDialog.querySelector('[name="flow_active"]').checked:false;
        if(nextActive&&flow&&printingFlowNeedsUpdate(flow.id))throw new Error("Este flujo necesita actualizarse: reemplaza la impresora marcada como Deprecated.");
        if(nextActive&&!nextOrder.length)throw new Error("Añade al menos una cuenta disponible a la lista global.");
        const {error:orderError}=await supabase.rpc("save_printing_flow_engine_accounts",{p_account_ids:nextOrder});
        if(orderError)throw new Error(({admin_required:"Solo un administrador puede editar la lista global.",duplicate_flow_engine_account:"No repitas cuentas en la lista.",printing_flow_account_order_required:"Deja al menos una cuenta en la lista global porque hay flujos activos.",printing_flow_account_unavailable:"Una cuenta ya no está activa o no tiene permisos para operar impresión."})[orderError.message]||orderError.message||"No se pudo guardar la lista global.");
        if(flow&&nextActive!==currentActive){
          const {error:activeError}=await supabase.rpc("set_printing_flow_active",{p_flow_id:flow.id,p_is_active:nextActive});
          if(activeError)throw new Error(activeError.message?.includes("printing_flow_needs_update")?"Necesita actualizarse: reemplaza primero la impresora del punto.":activeError.message||"No se pudo cambiar el estado del flujo.");
        }
        accountOrder.splice(0,accountOrder.length,...nextOrder);currentActive=nextActive;if(flow)flow.is_active=nextActive;
        initialAccountOrder=JSON.stringify(accountOrder);initialFlowActive=currentActive;
        toast("Lista global actualizada.");
        renderGraph();
      },{onDelete:flow?async()=>{if(!window.confirm("¿Eliminar este flujo? No puede tener impresiones pendientes."))return false;const {error}=await supabase.rpc("delete_printing_flow",{p_flow_id:flow.id});if(error)throw new Error(error.message?.includes("printing_flow_has_pending_jobs")?"El flujo tiene impresiones pendientes o reportes sin aceptar.":error.message);flowWasDeleted=true;return true;}:null,deleteLabel:"Eliminar flujo",deleteToast:"Flujo eliminado.",dialogClass:"flow-list-manager-dialog",disableSaveInitially:true,reloadAfterSave:false,successToast:""});
      const managerSave=manager.querySelector("[data-save]");
      const accountOrderFromDOM=()=>[...manager.querySelectorAll("[data-flow-account]")].map((item)=>item.dataset.flowAccount);
      const updateManagerSave=()=>{managerSave.disabled=initialManagerSnapshot===JSON.stringify({order:accountOrderFromDOM(),active:flow?manager.querySelector('[name="flow_active"]').checked:false});};
      manager.querySelector('[name="flow_active"]')?.addEventListener("change",(event)=>{manager.querySelector(".flow-manager-state small").textContent=event.target.checked?"El flujo escuchará sus eventos":"El flujo quedará pausado";});
      const list=manager.querySelector("[data-account-list]");let dragged=null;
      const updateRanks=()=>list.querySelectorAll("[data-flow-account]").forEach((item,index)=>item.querySelector(".flow-rank").textContent=`${index===0?"Motor principal":"Respaldo "+index}`);
      list.querySelectorAll("[data-flow-account]").forEach((item)=>{
        item.addEventListener("dragstart",(event)=>{dragged=item;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",item.dataset.flowAccount);item.classList.add("is-dragging");});
        item.addEventListener("dragend",()=>{item.classList.remove("is-dragging");dragged=null;updateRanks();updateManagerSave();});
        item.addEventListener("dragover",(event)=>{if(!dragged||dragged===item)return;event.preventDefault();const rect=item.getBoundingClientRect();list.insertBefore(dragged,event.clientY>rect.top+rect.height/2?item.nextSibling:item);updateManagerSave();});
      });
      manager.querySelector('[name="flow_active"]')?.addEventListener("change",updateManagerSave);
      manager.addEventListener("close",()=>{if(flowWasDeleted)flowEditorDialog.close();},{once:true});
    };
    renderGraph();
  }
  function bindRouteRows(container) {
    container.querySelectorAll("[data-remove-route]").forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = "true";
      button.addEventListener("click", () => button.closest("[data-print-route]").remove());
    });
    container.querySelectorAll("[data-route-point]").forEach((select) => {
      if (select.dataset.bound) return;
      select.dataset.bound = "true";
      select.addEventListener("change", () => syncRoutePointOptions(select.closest("[data-print-route]")));
    });
    container.querySelectorAll("[data-route-event]").forEach((input) => {
      if (input.dataset.bound) return;
      input.dataset.bound = "true";
      input.addEventListener("change", syncFlowEventOptions);
    });
    syncFlowEventOptions();
  }
  function syncRoutePointOptions(row) {
    if (!row) return;
    const point = (state.printingPoints || []).find((item) => item.id === row.querySelector("[data-route-point]")?.value);
    const modeSelect = row.querySelector("[data-route-mode]");
    const templateSelect = row.querySelector("[data-route-template]");
    const modes = point?.supported_output_modes || [point?.output_mode || "manual"];
    const previousMode = modeSelect.value;
    modeSelect.innerHTML = modes.map((mode) => `<option value="${mode}">${mode === "automatic" ? "Automática" : "Manual"}</option>`).join("");
    modeSelect.value = modes.includes(previousMode) ? previousMode : modes[0];
  }
  function syncFlowEventOptions() {
    const selected = new Set([...document.querySelectorAll('.printing-editor-dialog [name="flow_event"]:checked')].map((input) => input.value));
    document.querySelectorAll(".printing-editor-dialog [data-route-event]").forEach((input) => {
      const enabled = selected.has(input.value);
      input.disabled = !enabled;
      if (!enabled) input.checked = false;
    });
  }
  async function togglePrintingRow(table, row) {
    if (table === "printing_flows" && !row.is_active && printingFlowNeedsUpdate(row.id)) {
      toast("Necesita actualizarse: reemplaza primero la impresora del punto.");
      return;
    }
    const result = table === "printing_points"
      ? await supabase.rpc("set_printing_point_active", { p_point_id: row.id, p_is_active: !row.is_active })
      : table === "printing_flows"
        ? await supabase.rpc("set_printing_flow_active", { p_flow_id: row.id, p_is_active: !row.is_active })
        : await supabase.from(table).update({ is_active: !row.is_active }).eq("id", row.id).eq("restaurant_id", state.restaurantId);
    const { error } = result;
    if (error) { toast(error.message?.includes("printing_flow_needs_update") ? "Necesita actualizarse: reemplaza primero la impresora del punto." : error.message || "No se pudo actualizar el estado."); return; }
    await load(); render();
  }
  function bindPrintingSettings() {
    document.getElementById("create-print-point")?.addEventListener("click", () => openPrintPointEditor());
    document.getElementById("create-print-flow")?.addEventListener("click", () => openPrintFlowEditor());
    document.getElementById("create-print-template")?.addEventListener("click", () => openPrintTemplateEditor());
    document.querySelectorAll("[data-print-view-point]").forEach((button) => button.addEventListener("click", () => {
      const point = (state.printingPoints || []).find((row) => row.id === button.dataset.printViewPoint);
      if (point) openPrintPointDetails(point);
    }));
    document.querySelectorAll("[data-print-edit-flow]").forEach((button) => button.addEventListener("click", () => openPrintFlowEditor((state.printingFlows || []).find((row) => row.id === button.dataset.printEditFlow))));
    document.querySelectorAll("[data-print-open-template]").forEach((button) => button.addEventListener("click", () => { const row = (state.printingTicketTemplates || []).find((item) => item.id === button.dataset.printOpenTemplate); if (row) void openPrintTemplateEditor(row); }));
    document.querySelectorAll("[data-print-toggle-flow]").forEach((button) => button.addEventListener("click", () => { const row = (state.printingFlows || []).find((item) => item.id === button.dataset.printToggleFlow); if (row) void togglePrintingRow("printing_flows", row); }));
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
      // Legacy numeric thresholds are retained in the schema for compatibility,
      // but minimum/maximum now describe statistics, never payment validation.
      v.order_minimum_amount = null;
      v.order_maximum_amount = null;
      v.needs = [...document.querySelectorAll("[data-restaurant-need]:checked")].map((input) => input.dataset.restaurantNeed);
      v.appearance = {
        ...currentAppearance(),
        active_color_scheme_id: document.querySelector("[data-active-color-scheme]:checked")?.value || null,
      };
      const logoInput = document.getElementById("restaurant-logo-file");
      const logoFile = logoInput?.files?.[0] || null;
      const removeLogo = document.getElementById("restaurant-logo-remove")?.checked === true;
      if (logoFile && removeLogo) throw new Error("Elige un logo nuevo o marca quitar logo, no ambas opciones.");
      if (logoFile && (!new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]).has(logoFile.type) || logoFile.size > 5 * 1024 * 1024))
        throw new Error("El logo debe ser PNG, JPG, WebP o SVG y pesar hasta 5 MB.");
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
    bindColorSchemeCards();
    bindPrintingSettings();
    document.querySelectorAll("[data-setting], [data-restaurant-need], #restaurant-logo-file, #restaurant-logo-remove").forEach((input) => {
      input.addEventListener("input", syncSaveButton);
      input.addEventListener("change", syncSaveButton);
    });
    document.querySelectorAll("[data-restaurant-need]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked || !(state.restaurantNeeds || []).includes(input.dataset.restaurantNeed)) return;
        const name = input.closest("label")?.querySelector("span")?.textContent?.trim() || input.dataset.restaurantNeed;
        confirmNeedRemoval(input, name);
      });
    });
    const logoInput = document.getElementById("restaurant-logo-file");
    const dropZone = document.getElementById("logo-drop-zone");
    const setLogoDropCopy = (file = null) => {
      const title = document.getElementById("logo-drop-title");
      const status = document.getElementById("logo-drop-status");
      if (!title || !status) return;
      if (file) {
        title.textContent = "Imagen seleccionada · lista para guardar";
        status.textContent = file.name;
      } else {
        title.textContent = "Arrastra y suelta tu logo";
        status.innerHTML = 'o <button type="button" class="logo-browse" id="choose-restaurant-logo">elige un archivo</button>';
        status.querySelector("button")?.addEventListener("click", () => logoInput?.click());
      }
    };
    const useLogoFile = (file) => {
      const error = document.getElementById("logo-upload-error");
      if (error) error.textContent = "";
      if (!file) return;
      if (!new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]).has(file.type) || file.size > 5 * 1024 * 1024) {
        if (error) error.textContent = "Usa PNG, JPG, WebP o SVG de hasta 5 MB.";
        if (logoInput) logoInput.value = "";
        const preview = document.getElementById("restaurant-logo-preview");
        if (preview) preview.innerHTML = state.restaurantLogoUrl
          ? `<img src="${esc(state.restaurantLogoUrl)}" alt="Logo del restaurante">`
          : "<span>Logo</span>";
        setLogoDropCopy();
        syncSaveButton();
        return;
      }
      if (logoInput && file !== logoInput.files?.[0]) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        logoInput.files = transfer.files;
      }
      const preview = document.getElementById("restaurant-logo-preview");
      if (!preview) return;
      const previousUrl = preview.dataset.objectUrl;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      const url = URL.createObjectURL(file);
      preview.dataset.objectUrl = url;
      preview.innerHTML = `<img src="${url}" alt="Vista previa del logo">`;
      setLogoDropCopy(file);
      const remove = document.getElementById("restaurant-logo-remove");
      if (remove) remove.checked = false;
      syncSaveButton();
    };
    logoInput?.addEventListener("change", (event) => useLogoFile(event.target.files?.[0]));
    document.getElementById("choose-restaurant-logo")?.addEventListener("click", () => logoInput?.click());
    dropZone?.addEventListener("click", (event) => {
      if (!event.target.closest("button")) logoInput?.click();
    });
    dropZone?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        logoInput?.click();
      }
    });
    ["dragenter", "dragover"].forEach((name) => dropZone?.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    }));
    ["dragleave", "dragend"].forEach((name) => dropZone?.addEventListener(name, () => dropZone?.classList.remove("drag-over")));
    dropZone?.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
      useLogoFile(event.dataTransfer?.files?.[0]);
    });
    document.getElementById("restaurant-logo-remove")?.addEventListener("change", (event) => {
      const input = document.getElementById("restaurant-logo-file");
      const preview = document.getElementById("restaurant-logo-preview");
      if (event.target.checked && input) { input.value = ""; setLogoDropCopy(); }
      if (preview) preview.innerHTML = event.target.checked
        ? "<span>Se quitará el logo</span>"
        : state.restaurantLogoUrl
          ? `<img src="${esc(state.restaurantLogoUrl)}" alt="Logo del restaurante">`
          : "<span>Logo</span>";
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
      const rankingsVisible = document.querySelector('[data-setting="rankings_employees_enabled"]')?.checked && !document.querySelector('[data-setting="rankings_same_for_all_roles"]')?.checked;
      const minimumVisible = document.querySelector('[data-setting="order_minimum_employees"]')?.checked;
      const maximumVisible = document.querySelector('[data-setting="order_maximum_employees"]')?.checked;
      const correctionVisible = document.querySelector('[data-setting="corrections_employees"]')?.checked;
      const statisticsRoles = document.getElementById("settings-role-options");
      const correctionRoles = document.getElementById("settings-correction-role-options");
      if (statisticsRoles) statisticsRoles.hidden = !(rankingsVisible || minimumVisible || maximumVisible);
      if (correctionRoles) correctionRoles.hidden = !correctionVisible;
    };
    ["rankings_employees_enabled", "rankings_same_for_all_roles", "order_minimum_employees", "order_maximum_employees", "corrections_employees"].forEach((key) => document.querySelector(`[data-setting="${key}"]`)?.addEventListener("change", refreshRoleVisibility));
  }
  return { load, render: renderPage, bind };
}
