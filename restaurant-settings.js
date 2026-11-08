// Configuración operativa del restaurante, persistida en columnas y tablas de dominio.
export default function createRestaurantSettings({ supabase, state, esc, toast, render }) {
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
  ];
  const defaults = {
    employee_note_reset_mode: "manual", employee_note_reset_days: 30,
    rankings_enabled: false, rankings_products: false, rankings_variants: false, rankings_addons: false, rankings_categories: false,
    rankings_employees_enabled: false, rankings_same_for_all_roles: true,
    order_minimum_enabled: false, order_minimum_amount: null, order_minimum_admin: true, order_minimum_employees: false,
    order_maximum_enabled: false, order_maximum_amount: null, order_maximum_admin: true, order_maximum_employees: false,
    corrections_admin: true, corrections_employees: false,
    catalog_addons_enabled: false, catalog_category_groups_enabled: false, catalog_promotions_enabled: false,
  };
  const roleDefaults = (role) => ({ restaurant_id: state.restaurantId, role_id: role.id, rankings_products: false, rankings_variants: false, rankings_addons: false, rankings_categories: false, order_minimum_allowed: false, order_maximum_allowed: false, corrections_allowed: false });
  const check = (key, label, value, extra = "") => `<label class="settings-check"><input type="checkbox" data-setting="${key}" ${value ? "checked" : ""} ${extra}><span>${label}</span></label>`;
  const field = (key, label, value, extra = "") => `<label class="settings-field">${label}<input data-setting="${key}" type="number" min="0" step="0.01" value="${value ?? ""}" ${extra}></label>`;

  async function load() {
    if (!supabase || !state.restaurantId) return;
    state.settingsLoading = true;
    const [restaurant, roles, payments, roleSettings] = await Promise.all([
      supabase.from("restaurants").select(Object.keys(defaults).join(",")).eq("id", state.restaurantId).single(),
      supabase.from("roles").select("id,key,name").eq("restaurant_id", state.restaurantId).order("name"),
      supabase.from("restaurant_payment_methods").select("method_key,enabled,manual_enabled,automatic_enabled").eq("restaurant_id", state.restaurantId),
      supabase.from("restaurant_role_settings").select("*").eq("restaurant_id", state.restaurantId),
    ]);
    const error = restaurant.error || roles.error || payments.error || roleSettings.error;
    state.settingsError = error?.message || "";
    state.restaurantSettings = { ...defaults, ...(restaurant.data || {}) };
    state.settingRoles = roles.data || [];
    state.paymentSettings = Object.fromEntries((payments.data || []).map((row) => [row.method_key, row]));
    state.roleSettings = Object.fromEntries((roleSettings.data || []).map((row) => [row.role_id, row]));
    state.settingsLoading = false;
  }

  function roleChecks(fieldName, selected = []) {
    return `<div class="settings-role-list">${(state.settingRoles || []).filter((role) => role.key !== "admin").map((role) => check(`${fieldName}:${role.id}`, esc(role.name), selected.includes(role.id))).join("") || '<span class="meta">No hay roles de empleado configurados.</span>'}</div>`;
  }
  function renderPage() {
    if (state.settingsLoading) return '<section class="panel"><div class="empty">Cargando configuración…</div></section>';
    const v = { ...defaults, ...(state.restaurantSettings || {}) };
    const paymentCards = methods.map((m) => {
      const p = state.paymentSettings?.[m.key] || {};
      return `<article class="settings-option"><div><strong>${m.label}</strong><p class="meta">${m.automatic ? "El modo automático se habilitará al integrar un proveedor de pagos." : "Método disponible para registrar manualmente."}</p></div><div class="settings-checks">${check(`payment:${m.key}:enabled`, "Activado", p.enabled)}${m.manual ? check(`payment:${m.key}:manual`, "Manual", p.manual_enabled, p.enabled ? "" : "disabled") : ""}${m.automatic ? check(`payment:${m.key}:automatic`, "Automático", p.automatic_enabled, "disabled title='Pendiente integrar proveedor de pagos'") : ""}</div></article>`;
    }).join("");
    const roleRows = (state.settingRoles || []).filter((role) => role.key !== "admin").map((role) => {
      const rs = state.roleSettings?.[role.id] || roleDefaults(role);
      return `<details class="settings-role"><summary>${esc(role.name)} <span class="meta">Editar permisos</span></summary><div class="settings-checks">${check(`role:${role.id}:rankings_products`, "Productos más vendidos", rs.rankings_products)}${check(`role:${role.id}:rankings_variants`, "Variantes más vendidas", rs.rankings_variants)}${check(`role:${role.id}:rankings_addons`, "Agregados más vendidos", rs.rankings_addons)}${check(`role:${role.id}:rankings_categories`, "Categorías más vendidas", rs.rankings_categories)}${check(`role:${role.id}:order_minimum_allowed`, "Puede aplicar pedido mínimo", rs.order_minimum_allowed)}${check(`role:${role.id}:order_maximum_allowed`, "Puede aplicar pedido máximo", rs.order_maximum_allowed)}${check(`role:${role.id}:corrections_allowed`, "Puede crear pedidos correctivos/devoluciones", rs.corrections_allowed)}</div></details>`;
    }).join("");
    const showRoles = (v.rankings_employees_enabled && !v.rankings_same_for_all_roles) || v.order_minimum_employees || v.order_maximum_employees || v.corrections_employees;
    return `<section class="page-head"><div><div class="eyebrow">Administración</div><h1>Configuración</h1><p class="desc">Ajustes de las secciones fijas de tu restaurante.</p></div><button class="btn primary" id="save-restaurant-settings">Guardar cambios</button></section>${state.settingsError ? `<div class="inline-error" role="alert">${esc(state.settingsError)}</div>` : ""}<div class="settings-notice"><strong>Alcance de esta versión</strong><span>Los ajustes se guardan por restaurante. El cobro, las promociones y los límites aún requieren la migración del flujo operativo multi-restaurante para aplicarse a los pedidos.</span></div><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Métodos de pago</div><div class="meta">Activa los métodos que tu negocio recibe.</div></div></div><div class="settings-options">${paymentCards}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Cuentas</div><div class="meta">Nota personal de cada empleado.</div></div></div><div class="settings-form-grid"><label class="settings-field">Reinicio de la nota<select data-setting="employee_note_reset_mode"><option value="manual" ${v.employee_note_reset_mode === "manual" ? "selected" : ""}>Manual</option><option value="automatic" ${v.employee_note_reset_mode === "automatic" ? "selected" : ""}>Automático</option></select></label><label class="settings-field">Intervalo<select data-setting="employee_note_reset_days" ${v.employee_note_reset_mode !== "automatic" ? "disabled" : ""}>${[7,15,30].map((day) => `<option value="${day}" ${Number(v.employee_note_reset_days) === day ? "selected" : ""}>Cada ${day} días</option>`).join("")}</select></label></div><p class="meta">La nota no se borrará automáticamente hasta definir archivo, retención y fecha de reinicio.</p></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Estadísticas</div><div class="meta">Configura rankings visibles por rol.</div></div></div><div class="settings-checks">${check("rankings_enabled", "Habilitar rankings", v.rankings_enabled)}${check("rankings_products", "Productos más vendidos", v.rankings_products)}${check("rankings_variants", "Variantes más vendidas", v.rankings_variants)}${check("rankings_addons", "Agregados más vendidos", v.rankings_addons)}${check("rankings_categories", "Categorías más vendidas", v.rankings_categories, "disabled title='Disponible cuando el catálogo multi-restaurante esté migrado'")}${check("rankings_employees_enabled", "Empleados ven rankings", v.rankings_employees_enabled)}${check("rankings_same_for_all_roles", "Mismo conjunto para todos los roles", v.rankings_same_for_all_roles, v.rankings_employees_enabled ? "" : "disabled")}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Flujo de pedidos</div><div class="meta">Los límites y permisos se guardan para el restaurante.</div></div></div><div class="settings-form-grid">${check("order_minimum_enabled", "Usar importe mínimo", v.order_minimum_enabled)}${field("order_minimum_amount", "Importe mínimo (S/)", v.order_minimum_amount, v.order_minimum_enabled ? "required" : "disabled")}${check("order_minimum_admin", "Aplicar al administrador", v.order_minimum_admin)}${check("order_minimum_employees", "Aplicar a empleados", v.order_minimum_employees)}${check("order_maximum_enabled", "Usar importe máximo", v.order_maximum_enabled)}${field("order_maximum_amount", "Importe máximo (S/)", v.order_maximum_amount, v.order_maximum_enabled ? "required" : "disabled")}${check("order_maximum_admin", "Aplicar al administrador", v.order_maximum_admin)}${check("order_maximum_employees", "Aplicar a empleados", v.order_maximum_employees)}${check("corrections_admin", "Administrador puede crear pedidos correctivos/devoluciones", v.corrections_admin)}${check("corrections_employees", "Habilitar pedidos correctivos/devoluciones a empleados", v.corrections_employees)}</div><div class="settings-role-list" id="settings-role-options" ${showRoles ? "" : "hidden"}><strong>Permisos por rol</strong>${roleRows}</div></section><section class="panel settings-panel"><div class="panel-head"><div><div class="panel-title">Catálogo</div><div class="meta">Activa las herramientas que el restaurante necesita.</div></div></div><div class="settings-checks">${check("catalog_addons_enabled", "Agregados", v.catalog_addons_enabled)}${check("catalog_category_groups_enabled", "Grupos de categorías", v.catalog_category_groups_enabled)}${check("catalog_promotions_enabled", "Promociones", v.catalog_promotions_enabled)}</div><p class="meta">La administración y aplicación de promociones se habilitará junto con la migración del catálogo y el cobro.</p></section>`;
  }
  async function save() {
    const button = document.getElementById("save-restaurant-settings");
    if (!button || !supabase || state.roleKey !== "admin") return;
    button.disabled = true;
    try {
      const v = { ...defaults, ...(state.restaurantSettings || {}) };
      document.querySelectorAll("[data-setting]").forEach((input) => {
        const key = input.dataset.setting;
        if (key.startsWith("payment:") || key.startsWith("role:")) return;
        v[key] = input.type === "checkbox" ? input.checked : input.type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value;
      });
      if (v.order_minimum_enabled && (v.order_minimum_amount == null || v.order_minimum_amount < 0)) throw new Error("Indica un importe mínimo válido.");
      if (v.order_maximum_enabled && (v.order_maximum_amount == null || v.order_maximum_amount < 0)) throw new Error("Indica un importe máximo válido.");
      if (v.order_minimum_enabled && v.order_maximum_enabled && Number(v.order_minimum_amount) > Number(v.order_maximum_amount)) throw new Error("El importe mínimo no puede superar al máximo.");
      const restaurantResult = await supabase.from("restaurants").update(v).eq("id", state.restaurantId);
      if (restaurantResult.error) throw restaurantResult.error;
      for (const method of methods) {
        const read = (suffix) => document.querySelector(`[data-setting="payment:${method.key}:${suffix}"]`)?.checked || false;
        const enabled = read("enabled");
        const payload = { restaurant_id: state.restaurantId, method_key: method.key, enabled, manual_enabled: enabled && read("manual"), automatic_enabled: enabled && read("automatic"), updated_at: new Date().toISOString() };
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
      toast("Configuración guardada.");
      render();
    } catch (error) {
      toast(error.message || "No se pudo guardar la configuración.");
      button.disabled = false;
    }
  }
  function bind() {
    document.getElementById("save-restaurant-settings")?.addEventListener("click", save);
    methods.forEach((method) => document.querySelector(`[data-setting="payment:${method.key}:enabled"]`)?.addEventListener("change", (event) => {
      const manual = document.querySelector(`[data-setting="payment:${method.key}:manual"]`);
      if (manual) manual.disabled = !event.target.checked;
    }));
    document.querySelector('[data-setting="rankings_employees_enabled"]')?.addEventListener("change", (event) => {
      const shared = document.querySelector('[data-setting="rankings_same_for_all_roles"]');
      if (shared) shared.disabled = !event.target.checked;
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
