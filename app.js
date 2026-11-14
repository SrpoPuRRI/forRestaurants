//Sección de imports de las librerías y las funciones

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  AUTH_EMAIL_BASE,
} from "./supabase-config.js";
import createOrderFlow from "./order-flow.js";
import createStatistics from "./statistics.js?v=20261113-statistics-order-extremes";
import createRestaurantSettings from "./restaurant-settings.js?v=20261113-statistics-order-extremes";
import createRestaurantWorkspaces from "./restaurant-workspaces.js";
import createAppearance from "./appearance.js?v=20261113-appearance-builder";

//Sección de inicialización de las cuentas, función propuesta por la documentación que leí en Supabase
const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage,
        },
      })
    : null;

//BAse de datos de prueba para mi prototipo:
const products = [
  {
    id: "espresso",
    name: "Espresso",
    category: "Café",
    price: 7,
    tag: "Clásico",
  },
  {
    id: "americano",
    name: "Americano",
    category: "Café",
    price: 8,
    tag: "Caliente",
  },
  { id: "latte", name: "Latte", category: "Café", price: 12, tag: "Favorito" },
  {
    id: "capuccino",
    name: "Capuccino",
    category: "Café",
    price: 12,
    tag: "Caliente",
  },
  {
    id: "coldbrew",
    name: "Cold brew",
    category: "Café",
    price: 13,
    tag: "Frío",
  },
  {
    id: "chocolate",
    name: "Chocolate",
    category: "Bebidas",
    price: 11,
    tag: "Caliente",
  },
  {
    id: "limonada",
    name: "Limonada",
    category: "Bebidas",
    price: 9,
    tag: "Fría",
  },
  {
    id: "croissant",
    name: "Croissant",
    category: "Panadería",
    price: 8,
    tag: "Horneado",
  },
  {
    id: "brownie",
    name: "Brownie",
    category: "Postres",
    price: 9,
    tag: "Favorito",
  },
  {
    id: "ingreso",
    name: "Ingreso",
    category: "Movimientos",
    tag: "Entrada de dinero",
    special: "in",
  },
  {
    id: "egreso",
    name: "Egreso",
    category: "Movimientos",
    tag: "Salida de dinero",
    special: "out",
  },
];
const categories = [
  "Todos",
  "Café",
  "Bebidas",
  "Panadería",
  "Postres",
  "Movimientos",
];
const sales = [
  {
    id: "V-084",
    site: "Centro",
    time: "10:42",
    total: 24,
    items: ["Latte", "Brownie"],
  },
  {
    id: "V-083",
    site: "Centro",
    time: "10:31",
    total: 16,
    items: ["Americano", "Croissant"],
  },
  {
    id: "V-082",
    site: "Miraflores",
    time: "10:22",
    total: 32,
    items: ["2 × Latte", "Egreso"],
  },
  {
    id: "V-081",
    site: "Centro",
    time: "10:04",
    total: 13,
    items: ["Cold brew"],
  },
  {
    id: "V-080",
    site: "Miraflores",
    time: "09:48",
    total: 19,
    items: ["Chocolate", "Croissant"],
  },
];
const s = {
  user: null,
  username: "",
  role: "Administrador",
  roleLabel: "Administrador",
  restaurantId: null,
  restaurantName: "",
  restaurantLogoPath: null,
  restaurantLogoUrl: null,
  site: "Centro",
  page: "orders",
  category: "Todos",
  query: "",
  current: null,
  draft: { items: [], note: "" },
  orders: [],
  sales: sales.slice(),
  filter: "Todos",
  timer: null,
  accounts: [],
  locations: [],
  accountsLoading: false,
  accountsError: "",
  accountDate: "",
  accountDataDates: [],
  restaurantSuspended: false,
  roleKey: "employee",
  roleId: null,
  roleIds: [],
  roleKeys: [],
  availableRoleIds: [],
  availableRoles: [],
  mustChangePassword: false,
  attendanceRecords: [],
  restaurantSettings: null,
  restaurantNeeds: [],
  orderTableId: null,
  orderTableLabel: "",
  settingRoles: [],
  paymentSettings: {},
  roleSettings: {},
  settingsLoading: false,
  settingsError: "",
};

//Función de formateo de textos: Fuente W3WSchools
const $ = (x) => document.querySelector(x),
  money = (n) => "S/ " + Number(n).toFixed(2),
  esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

let newOrderResizeFrame = 0;
let deviceFormFactors = null;
const TABLET_RESOLUTION_FALLBACK = [
  [1032, 1376],
  [1376, 1032],
  [1032, 1244],
  [1032, 1319],
  [1376, 946],
  [1376, 975],
  [768, 1024],
  [1024, 768],
  [744, 1133],
  [1133, 744],
  [810, 1080],
  [1080, 810],
  [820, 1180],
  [1180, 820],
  [834, 1112],
  [1112, 834],
  [834, 1194],
  [1194, 834],
  [1024, 1366],
  [1366, 1024],
  [800, 1280],
  [1280, 800],
  [753, 1205],
  [1205, 753],
  [800, 1340],
  [1340, 800],
  [962, 601],
  [601, 962],
  [600, 960],
  [960, 600],
  [600, 1024],
  [1024, 600],
  [800, 1232],
  [1232, 800],
  [853, 1280],
  [1280, 853],
  [800, 1216],
  [1216, 800],
];
window.addEventListener("resize", () => {
  cancelAnimationFrame(newOrderResizeFrame);
  newOrderResizeFrame = requestAnimationFrame(() => {
    applyDeviceClasses();
    adaptNewOrderButton();
  });
});

//Sección de formateos
//Formateo de Flujo de pedidos
let orderFlow;
const workspaces = createRestaurantWorkspaces({
  supabase,
  state: s,
  render: () => render(),
  toast,
  money,
  esc,
  refreshCatalog: () => orderFlow?.reloadCatalog(),
  hasActiveOrder: () => orderFlow?.hasActiveOrder() || false,
  navigate: (page) => {
    s.page = page;
    render();
    orderFlow?.enter(page);
    workspaces.enter(page);
  },
});
orderFlow = createOrderFlow({
  supabase,
  state: s,
  render: () => render(),
  toast,
  money,
  esc,
  workspaces,
});

//Formateo de las estadísticas
// Obtiene la fecha actual usando la zona horaria de Lima.
function limaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Formatea una fecha en una versión corta para mostrarla en la interfaz.
function formatDateShort(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

// Formatea una fecha con el día de la semana y el nombre del mes.
function formatDateLong(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

function limaDateOf(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

const statistics = createStatistics({
  supabase,
  state: s,
  render: () => render(),
  printTicket: (orderId) => orderFlow.printTicket(orderId),
  money,
  esc,
  limaToday,
  formatDateShort,
  formatDateLong,
});
const appearance = createAppearance({ state: s, supabase });
const restaurantSettings = createRestaurantSettings({
  supabase,
  state: s,
  esc,
  toast,
  render: () => render(),
});

// Devuelve el pedido activo o el borrador actual.
function active() {
  return s.current ? s.orders.find((o) => o.id === s.current) : s.draft;
}

// Calcula el total de los productos y movimientos de un pedido.
function total(o) {
  return o.items.reduce(
    (a, i) => a + (i.special === "out" ? -1 : 1) * i.unit * i.qty,
    0,
  );
}

// Muestra un mensaje temporal de confirmación al usuario.
function toast(t) {
  let e = $("#toast");
  if (!e) return;
  e.textContent = t;
  e.classList.add("show");
  clearTimeout(s.timer);
  s.timer = setTimeout(() => e.classList.remove("show"), 2000);
}

// Muestra un diálogo interno y devuelve si el usuario confirmó la acción.
function confirmInApp(title, message, action = "Confirmar") {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "password-dialog entity-dialog confirm-dialog";
    d.innerHTML = `<div class="panel-title">'+esc(title)+'</div><p>'+esc(message)+'</p><div class="dialog-actions"><button type="button" class="btn secondary" data-cancel>Volver</button><button type="button" class="btn danger-button" data-confirm>'+esc(action)+'</button></div>`;
    let confirmed = false;
    d.querySelector("[data-cancel]").onclick = () => d.close();
    d.querySelector("[data-confirm]").onclick = () => {
      confirmed = true;
      d.close();
    };
    d.addEventListener(
      "close",
      () => {
        d.remove();
        resolve(confirmed);
      },
      { once: true },
    );
    document.body.appendChild(d);
    d.showModal();
  });
}

// Normaliza el nombre de usuario para validarlo y usarlo en autenticación.
function normalizeUsername(value) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
// Construye el correo interno de autenticación a partir del nombre de usuario.
function authEmailForUsername(username) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{1,49}$/.test(normalized))
    throw new Error(
      "El usuario debe tener hasta 49 caracteres: letras, números, punto, guion o guion bajo.",
    );
  if (!AUTH_EMAIL_BASE || !AUTH_EMAIL_BASE.includes("@"))
    throw new Error("Falta configurar el Gmail base de autenticación.");
  const [local, domain] = AUTH_EMAIL_BASE.toLowerCase().split("@");
  return `${local}+k-${normalized}@${domain}`;
}
// Carga el perfil y la sede asociados a la cuenta autenticada.
async function loadAuthenticatedProfile(user) {
  s.restaurantSuspended = false;
  const { data: profile, error } = await supabase
    .from("accounts")
    .select(
      "auth_user_id,restaurant_id,role_ids,assistance_id,username,display_name,location_id,is_active,must_change_password",
    )
    .eq("auth_user_id", user.id)
    .single();
  if (error || !profile)
    throw new Error("La cuenta no está vinculada a un restaurante activo.");
  if (!profile.is_active)
    throw new Error(
      "Esta cuenta está desactivada. Contacta al administrador del restaurante.",
    );

  const { data: restaurant, error: restaurantError } = await supabase
    .from("restaurants")
    .select("id,name,status,logo_path,needs,available_role_ids")
    .eq("id", profile.restaurant_id)
    .maybeSingle();
  if (restaurantError)
    throw new Error("No se pudo validar el restaurante. Intenta de nuevo.");
  if (!restaurant || restaurant.status !== "active") {
    s.restaurantSuspended = true;
    return;
  }

  const roleIds = Array.isArray(profile.role_ids) ? profile.role_ids : [];
  const { data: roles, error: roleError } = await supabase
    .from("roles")
    .select("id,key,name,permissions")
    .in("id", roleIds);
  if (roleError || !roles?.length)
    throw new Error("No se pudo cargar el rol de esta cuenta.");
  const roleKeys = roles.map((role) => role.key);
  const isAdmin = roleKeys.includes("admin");

  s.restaurantId = restaurant.id;
  s.restaurantName = restaurant.name || "";
  s.restaurantNeeds = restaurant.needs || [];
  s.availableRoleIds = restaurant.available_role_ids || [];
  s.availableRoles = [];
  s.restaurantLogoPath = restaurant.logo_path || null;
  let site = "Todas las sedes";
  if (profile.location_id) {
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("name")
      .eq("id", profile.location_id)
      .single();
    if (locationError || !location)
      throw new Error("No se pudo cargar la sede asignada a esta cuenta.");
    site = location.name;
  }
  s.username = profile.username;
  s.user = profile.display_name;
  s.role = isAdmin ? "Administrador" : "Empleado";
  s.roleKey = isAdmin
    ? "admin"
    : roleKeys.includes("employee")
      ? "employee"
      : roleKeys[0] || "employee";
  s.roleIds = roleIds;
  s.roleKeys = roleKeys;
  s.roleId = roleIds[0] || null;
  s.roleLabel = roles.map((role) => role.name).join(" · ") || s.role;
  s.mustChangePassword = profile.must_change_password === true;
  s.site = site;
  s.authUserId = profile.auth_user_id;
  s.locationId = profile.location_id;
  await restaurantSettings.load();
  appearance.apply();
}
// Valida las credenciales e inicia la sesión del usuario.
async function submitLogin() {
  const button = $("#login"),
    message = $("#login-error"),
    username = $("#username").value,
    password = $("#password").value;
  message.textContent = "";
  if (!username.trim() || !password) {
    message.textContent = "Escribe tu usuario y contraseña.";
    return;
  }
  if (!supabase) {
    message.textContent = "Falta configurar la conexión con Supabase.";
    return;
  }
  button.disabled = true;
  button.textContent = "Validando…";
  try {
    const email = authEmailForUsername(username);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw new Error("Usuario o contraseña incorrectos.");
    await loadAuthenticatedProfile(data.user);
    if (s.restaurantSuspended) {
      await supabase.auth.signOut();
      render();
      return;
    }
    if (s.mustChangePassword) {
      s.page = "account";
      render();
      changePassword(true);
      return;
    }
    s.page = "orders";
    render();
    orderFlow.enter("orders");
  } catch (error) {
    message.textContent = error.message || "No se pudo iniciar sesión.";
    if (supabase) await supabase.auth.signOut();
  } finally {
    if ($("#login")) {
      $("#login").disabled = false;
      $("#login").textContent = "Iniciar sesión";
    }
  }
}
// Genera la vista del formulario de inicio de sesión.
function login() {
  return '<main class="login"><section class="login-card"><div class="login-brand"><img src="/assets/black-white-logo.svg" alt="Black&White POS"></div><h1>Qué bueno verte</h1><p>Inicia sesión con tu nombre de usuario.</p><form id="login-form"><div class="field"><label for="username">Nombre de usuario</label><input id="username" autocomplete="username" placeholder="Tu nombre de usuario" required></div><div class="field"><label for="password">Contraseña</label><input id="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required></div><button class="btn primary full" id="login" type="submit">Iniciar sesión</button><p id="login-error" class="login-error" role="alert"></p></form></section></main>';
}
// Inicializa la sesión, los datos iniciales y los listeners de autenticación.
async function initializeApp() {
  if (!supabase) {
    render();
    return;
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    try {
      await loadAuthenticatedProfile(session.user);
      if (s.restaurantSuspended) await supabase.auth.signOut();
      else if (s.mustChangePassword) s.page = "account";
    } catch {
      await supabase.auth.signOut();
    }
  }
  render();
  if (s.user && s.mustChangePassword) changePassword(true);
  if (s.user) orderFlow.enter(s.page);
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && s.user) {
      orderFlow.cleanup();
      workspaces.cleanup();
      s.user = null;
      s.authUserId = null;
      s.locationId = null;
      s.current = null;
      s.orders = [];
      s.draft = { items: [], note: "" };
      s.orderTableId = null;
      s.orderTableLabel = "";
      render();
    }
  });
}
function hasWorkspaceAccess(workspace) {
  const keys = new Set(s.roleKeys || []);
  if (keys.has("admin") || keys.has("employee")) return true;
  const rolesByWorkspace = {
    orders: ["cashier"],
    kitchen: ["cook"],
    bar: ["barista", "bartender"],
    salon: ["waiter", "host"],
    crm: ["social_manager"],
    delivery: ["courier"],
  };
  return (rolesByWorkspace[workspace] || []).some((key) => keys.has(key));
}

function defaultWorkspaceForAccount() {
  for (const workspace of [
    "orders",
    "crm",
    "delivery",
    "kitchen",
    "bar",
    "salon",
    "account",
  ]) {
    if (workspace === "account" || hasWorkspaceAccess(workspace))
      return workspace;
  }
  return "account";
}

function canOpenWorkspace(page) {
  if (page === "catalog" || page === "settings")
    return s.role === "Administrador";
  const requiredNeed = {
    crm: "crm",
    delivery: "delivery",
    kitchen: "kitchen",
    bar: "kitchen",
    salon: "salon",
  }[page];
  if (requiredNeed && !(s.restaurantNeeds || []).includes(requiredNeed))
    return false;
  return ["orders", "crm", "delivery", "kitchen", "bar", "salon"].includes(page)
    ? hasWorkspaceAccess(page)
    : true;
}

// Genera los botones de navegación según los permisos de los roles asignados.
function nav(m) {
  const needs = s.restaurantNeeds || [];
  const list = [["account", "", "Cuenta"]];
  if (needs.includes("crm") && hasWorkspaceAccess("crm"))
    list.push(["crm", "◎", "CRM"]);
  list.push(["stats", "", "Estadísticas"]);
  if (needs.includes("delivery") && hasWorkspaceAccess("delivery"))
    list.push(["delivery", "↗", "Delivery"]);
  if (hasWorkspaceAccess("orders"))
    list.push(["orders", "＋", m ? "Pedidos" : "Flujo de pedidos"]);
  if (needs.includes("kitchen") && hasWorkspaceAccess("kitchen")) {
    list.push(["kitchen", "▦", "Cocina"]);
  }
  if (
    needs.includes("kitchen") &&
    s.restaurantSettings?.kitchen_has_separate_bar &&
    hasWorkspaceAccess("bar")
  ) {
    list.push(["bar", "◉", "Barra"]);
  }
  if (needs.includes("salon") && hasWorkspaceAccess("salon"))
    list.push(["salon", "⌂", "Salón"]);
  if (s.role === "Administrador") {
    list.push(["catalog", "▤", "Catálogo"]);
    list.push(["settings", "⚙", "Configuración"]);
  }
  const icon = (key, fallback) =>
    key === "account"
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15.7" cy="6.7" r="3.1"/><path d="M11.5 13.2c1.1-1.3 2.5-2 4.2-2 3.5 0 5.8 2.5 5.8 6v3.4c-2.1 1.1-4.7 1.7-7.4 1.7h-1.8"/><circle cx="7.2" cy="9.1" r="4.2"/><path d="M1 21v-2.7c0-4.2 2.6-6.9 6.4-6.9h.8c3.8 0 6.4 2.7 6.4 6.9V21c-2.1 1.2-4.3 1.8-6.8 1.8S3.1 22.2 1 21Z"/></svg>'
      : key === "stats"
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 21h20"/><rect x="4" y="10" width="3" height="10" rx=".5"/><rect x="9" y="13" width="3" height="7" rx=".5"/><rect x="14" y="5" width="3" height="15" rx=".5"/><rect x="19" y="2" width="3" height="18" rx=".5"/></svg>'
        : fallback;
  return list
    .map(
      (x) =>
        '<button data-page="' +
        x[0] +
        '" class="' +
        (s.page === x[0] ? "active" : "") +
        '"><span class="nav-icon ' +
        (x[0] === "account" || x[0] === "stats" ? "nav-icon-art" : "") +
        '">' +
        icon(x[0], x[1]) +
        "</span>" +
        x[2] +
        "</button>",
    )
    .join("");
}
// Devuelve el título correspondiente a la página activa.
function title() {
  return {
    orders: "Flujo de pedidos",
    stats: "Estadísticas",
    account: "Cuenta",
    catalog: "Catálogo",
    settings: "Configuración",
    crm: "CRM",
    kitchen: "Cocina",
    bar: "Barra",
    salon: "Salón",
    delivery: "Delivery",
  }[s.page];
}
// Presenta la marca del restaurante después de autenticar la cuenta.
function restaurantBrandMarkup(placement) {
  const name = (s.restaurantName || "Restaurante").trim();
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] || "")
    .join("")
    .toLocaleUpperCase("es");
  const mark = s.restaurantLogoUrl
    ? `<img class="restaurant-brand-mark" src="${esc(s.restaurantLogoUrl)}" alt="Logo de ${esc(name)}">`
    : `<span class="restaurant-brand-mark restaurant-brand-fallback" aria-hidden="true">${esc(initials || "R")}</span>`;
  return `<div class="restaurant-brand ${placement}" title="${esc(name)}">${mark}<span class="restaurant-brand-name">${esc(name)}</span></div>`;
}
// Genera la estructura principal de la aplicación.
function shell() {
  const today = limaToday(),
    shownDate =
      s.page === "account" && s.role === "Administrador"
        ? s.accountDate || today
        : today,
    shownLabel =
      s.page === "stats" ? statistics.headerLabel() : formatDateLong(shownDate);
  return (
    '<div class="shell"><aside class="sidebar">' +
    restaurantBrandMarkup("sidebar-brand") +
    '<div><div class="nav-label">Espacio de trabajo</div><nav class="nav">' +
    nav(false) +
    '</nav></div><div class="profile"><div class="avatar">' +
    esc(
      (s.user || "")
        .split(" ")
        .map((x) => x[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
    ) +
    '</div><div><div class="person">' +
    esc(s.user) +
    '</div><div class="meta">' +
    esc(s.roleLabel || s.role) +
    " · " +
    (s.role === "Administrador" ? "Todas las sedes" : s.site) +
    '</div></div></div></aside><main class="work"><header class="topbar">' +
    restaurantBrandMarkup("mobile-brand") +
    '<div><div class="top-title">' +
    title() +
    '</div><div class="top-sub"><span>' +
    shownLabel +
    '</span></div></div><div class="top-right">' +
    appearance.buttonMarkup() +
    '<button class="btn secondary" id="logout" style="padding:8px 10px;font-size:10px">Salir</button></div></header><div class="content">' +
    page() +
    '</div></main><nav class="mobile-nav ' +
    (s.role === "Administrador" ? "admin-nav" : "") +
    '">' +
    nav(true) +
    '</nav></div><div class="toast" id="toast" role="status"></div>'
  );
}
// Selecciona y renderiza el contenido de la página activa.
function page() {
  return s.page === "orders"
    ? orderFlow.renderOrders()
    : s.page === "catalog"
      ? orderFlow.renderCatalog()
      : s.page === "stats"
        ? statistics.render()
        : s.page === "settings" && s.role === "Administrador"
          ? restaurantSettings.render()
          : ["crm", "kitchen", "bar", "salon", "delivery"].includes(s.page)
            ? workspaces.render(s.page)
            : account();
}
// Genera la vista del flujo de pedidos y sus productos disponibles.
function orders() {
  let o = active(),
    p = products.filter(
      (x) =>
        (s.category === "Todos" || x.category === s.category) &&
        (x.name.toLowerCase().includes(s.query.toLowerCase()) ||
          x.tag.toLowerCase().includes(s.query.toLowerCase())),
    );
  let cats = categories
    .map(
      (c) =>
        '<button class="chip ' +
        (s.category === c ? "active" : "") +
        '" data-cat="' +
        c +
        '">' +
        c +
        "</button>",
    )
    .join("");
  let cards = p
    .map(
      (x) =>
        '<button class="product ' +
        (x.special ? "special " + x.special : "") +
        '" data-product="' +
        x.id +
        '"><span><span class="pname">' +
        x.name +
        '</span><span class="tag">' +
        x.tag +
        '</span></span><span class="price">' +
        (x.special ? "Agregar monto" : money(x.price)) +
        "</span></button>",
    )
    .join("");
  let lines = o.items.length
    ? o.items
        .map(
          (i, n) =>
            '<div class="line"><div><div class="lname">' +
            esc(i.name) +
            (i.special === "in"
              ? " · ingreso"
              : i.special === "out"
                ? " · egreso"
                : "") +
            '</div><div class="caption">' +
            money(i.unit) +
            " " +
            (i.special ? "movimiento" : "c/u") +
            '</div><div class="controls"><button data-line="dec" data-index="' +
            n +
            '">−</button><span>' +
            i.qty +
            '</span><button data-line="inc" data-index="' +
            n +
            '">+</button></div></div><div><div class="ltotal">' +
            money(i.unit * i.qty * (i.special === "out" ? -1 : 1)) +
            '</div><button class="remove" data-line="remove" data-index="' +
            n +
            '">Quitar</button></div></div>',
        )
        .join("")
    : '<div class="empty"><span>☕</span>Agrega productos para empezar</div>';
  let opens = s.orders.length
    ? s.orders
        .map(
          (a) =>
            '<article class="open-card" data-open="' +
            a.id +
            '"><div class="open-row"><span class="open-id">' +
            a.id +
            '</span><span class="badge">Sin pagar</span></div><div class="open-meta"><span>' +
            a.items.reduce((n, i) => n + i.qty, 0) +
            " productos</span><strong>" +
            money(total(a)) +
            "</strong></div></article>",
        )
        .join("")
    : '<div class="empty" style="padding:10px 0">Aquí aparecerán los pedidos que dejes sin pagar.</div>';
  return (
    '<section class="page-head"><div><div class="eyebrow">Punto de venta</div><h1>Toma un pedido</h1><p class="desc">' +
    (s.role === "Administrador"
      ? "Sede seleccionada: " + s.site
      : "Registrando ventas para " + s.site) +
    '</p></div><button class="btn primary" id="new">＋ Nuevo pedido</button></section><div class="layout"><section class="panel"><div class="panel-head"><div class="panel-title">Menú</div><input class="search" id="search" placeholder="⌕  Buscar producto" value="' +
    esc(s.query) +
    '"></div><div class="chips">' +
    cats +
    '</div><div class="products">' +
    (cards || '<div class="empty">No hay coincidencias</div>') +
    '</div></section><aside class="panel order"><div class="order-head"><div><div class="order-title">' +
    (s.current ? "Pedido " + s.current : "Pedido nuevo") +
    '</div><div class="order-sub">' +
    (s.current ? "Sin pagar" : "Temporal") +
    " · " +
    s.site +
    '</div></div><div class="tools"><button class="icon" id="new-icon">＋</button><button class="icon" id="delete">×</button></div></div><div class="lines">' +
    lines +
    '</div><div class="notes"><textarea id="note" placeholder="Nota para este pedido…">' +
    esc(o.note || "") +
    '</textarea></div><div class="sum"><div class="sumrow"><span>Saldo del pedido</span><span>' +
    money(total(o)) +
    '</span></div><div class="sumrow total"><span>Total</span><span>' +
    money(total(o)) +
    '</span></div><button class="pay" id="pay" ' +
    (o.items.length ? "" : "disabled") +
    '>Registrar pago</button></div></aside></div><section class="open-section"><div class="open-heading"><h2>Pedidos abiertos</h2><span>' +
    s.orders.length +
    ' sin pagar</span></div><div class="open-grid">' +
    opens +
    "</div></section>"
  );
}
// Carga las cuentas, sedes y datos de asistencia desde Supabase.
async function loadAccounts() {
  if (!supabase || !s.restaurantId) return;
  s.accountsLoading = true;
  s.accountsError = "";
  const today = limaToday();
  if (s.role === "Administrador" && !s.accountDate) s.accountDate = today;
  render();
  const [
    accountsResult,
    locationsResult,
    schedulesResult,
    rolesResult,
    notesResult,
    attendanceResult,
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select(
        "auth_user_id,restaurant_id,username,display_name,role_ids,schedule_ids,assistance_id,location_id,is_active,locations(name)",
      )
      .eq("restaurant_id", s.restaurantId)
      .order("display_name"),
    supabase
      .from("locations")
      .select(
        "id,name,address,location_hours(weekday,opens_at,closes_at,closed)",
      )
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("account_schedules")
      .select("id,restaurant_id,weekday,starts_at,ends_at")
      .eq("restaurant_id", s.restaurantId),
    supabase
      .from("roles")
      .select("id,key,name,permissions,sort_order")
      .order("sort_order"),
    supabase
      .from("employee_notes")
      .select("auth_user_id,note,updated_at")
      .eq("restaurant_id", s.restaurantId),
    supabase
      .from("attendance_records")
      .select(
        "id,assistance_id,location_id,event_type,occurred_at,recorded_at,method,correction_reason",
      )
      .eq("restaurant_id", s.restaurantId)
      .order("occurred_at", { ascending: false }),
  ]);
  s.accountsLoading = false;
  const loadError = [
    accountsResult,
    locationsResult,
    schedulesResult,
    rolesResult,
    notesResult,
    attendanceResult,
  ].find((result) => result.error)?.error;
  if (loadError) {
    s.accountsError =
      "No se pudieron cargar las cuentas y asistencias. Revisa que la migración de Cuentas esté aplicada y que la sesión tenga permisos.";
    s.accounts = [];
    s.locations = [];
    render();
    return;
  }
  const schedulesById = new Map(
    (schedulesResult.data || []).map((item) => [item.id, item]),
  );
  const roleById = new Map(
    (rolesResult.data || []).map((item) => [item.id, item]),
  );
  const eventsByObject = new Map();
  for (const event of attendanceResult.data || []) {
    const list = eventsByObject.get(event.assistance_id) || [];
    list.push(event);
    eventsByObject.set(event.assistance_id, list);
  }
  const allowedRoles = new Set(s.availableRoleIds || []);
  s.locations = locationsResult.data || [];
  s.availableRoles = (rolesResult.data || []).filter((role) =>
    allowedRoles.has(role.id),
  );
  const accountRows = (accountsResult.data || []).filter(
    (item) => item.is_active,
  );
  s.accounts = accountRows.map((a) => {
    const roleIds = Array.isArray(a.role_ids) ? a.role_ids : [];
    const accountRoles = roleIds.map((id) => roleById.get(id)).filter(Boolean);
    const events = (eventsByObject.get(a.assistance_id) || []).sort(
      (x, y) =>
        new Date(y.occurred_at).getTime() - new Date(x.occurred_at).getTime(),
    );
    const dateEvents = events.filter(
      (event) => limaDateOf(event.occurred_at) === (s.accountDate || today),
    );
    const latest = dateEvents[0];
    const presentEvent = dateEvents.find(
      (event) => event.event_type === "check_in",
    );
    return {
      auth_user_id: a.auth_user_id,
      username: a.username,
      display_name: a.display_name,
      role_ids: roleIds,
      role_keys: accountRoles.map((role) => role.key),
      role: accountRoles.some((role) => role.key === "admin")
        ? "admin"
        : accountRoles.some((role) => role.key === "employee")
          ? "employee"
          : accountRoles[0]?.key || "employee",
      role_name:
        accountRoles.map((role) => role.name).join(" · ") || "Empleado",
      location_id: a.location_id,
      site: a.locations?.name || "Todas las sedes",
      is_active: a.is_active,
      assistance_id: a.assistance_id,
      attendance: Boolean(
        presentEvent && (!latest || latest.event_type === "check_in"),
      ),
      attendance_ever: Boolean(presentEvent),
      attendance_status: latest?.event_type || null,
      attendance_location:
        (s.locations || []).find(
          (location) => location.id === latest?.location_id,
        )?.name || "",
      schedules: (Array.isArray(a.schedule_ids) ? a.schedule_ids : [])
        .map((id) => schedulesById.get(id))
        .filter(Boolean),
    };
  });
  s.employeeNotes = notesResult.data || [];
  s.attendanceRecords = attendanceResult.data || [];
  s.accountDataDates = [
    ...new Set([
      today,
      ...(attendanceResult.data || []).map((event) =>
        limaDateOf(event.occurred_at),
      ),
    ]),
  ].sort();
  render();
}
// Genera la vista de administración de cuentas y asistencia.
function account() {
  const emp = s.role === "Empleado",
    list = s.accounts,
    adminCount = list.filter((a) => a.role === "admin" && a.is_active).length,
    today = limaToday(),
    accountDate = s.accountDate || today,
    isHistorical = s.role === "Administrador" && accountDate !== today,
    presentLabel = emp
      ? "Presentes hoy"
      : isHistorical
        ? "Presentes el " + formatDateShort(accountDate)
        : "Presentes hoy";
  const rows = list
    .map((a) => {
      const self = a.auth_user_id === s.authUserId,
        role =
          a.role_name || (a.role === "admin" ? "Administrador" : "Empleado"),
        sameLocation = Boolean(s.locationId && a.location_id === s.locationId),
        attendanceEvent = a.attendance ? "check_out" : "check_in",
        canMarkAttendance =
          a.is_active &&
          !isHistorical &&
          (s.role === "Administrador" ||
            (self &&
              (attendanceEvent === "check_in"
                ? s.restaurantSettings?.attendance_check_in_self
                : s.restaurantSettings?.attendance_check_out_self)) ||
            (!self &&
              sameLocation &&
              (attendanceEvent === "check_in"
                ? s.restaurantSettings?.attendance_check_in_peer_at_location
                : s.restaurantSettings
                    ?.attendance_check_out_peer_at_location))),
        canDelete =
          !isHistorical &&
          a.is_active &&
          s.role === "Administrador" &&
          (a.role !== "admin" || self),
        deleteDisabled = self && adminCount < 2,
        attendanceAction = canMarkAttendance
          ? '<button class="rowaction" data-mark-attendance="' +
            a.auth_user_id +
            '" data-attendance-event="' +
            attendanceEvent +
            '">' +
            (attendanceEvent === "check_in"
              ? "Marcar entrada"
              : "Marcar salida") +
            "</button>"
          : "",
        editAction =
          !isHistorical && s.role === "Administrador" && a.is_active
            ? '<button class="rowaction" data-edit-account="' +
              a.auth_user_id +
              '">Editar</button>'
            : "",
        deleteAction = canDelete
          ? '<button class="rowaction danger-action" data-delete-account="' +
            a.auth_user_id +
            '" ' +
            (deleteDisabled
              ? 'disabled title="Debe quedar otro administrador"'
              : "") +
            ">Eliminar</button>"
          : "",
        initials = a.display_name
          .split(" ")
          .filter(Boolean)
          .map((x) => x[0] || "")
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        attendanceText = isHistorical
          ? a.attendance_ever
            ? "Vino ese día"
            : "Sin marca"
          : a.attendance
            ? "Presente"
            : a.attendance_status === "check_out"
              ? "Salió" +
                (a.attendance_location
                  ? " · " + esc(a.attendance_location)
                  : "")
              : "Pendiente";
      return (
        '<tr><td><div class="personcell"><span class="mini">' +
        esc(initials) +
        "</span><span><strong>" +
        esc(a.display_name) +
        (!a.is_active ? ' <span class="meta">(desactivada)</span>' : "") +
        (self ? ' <span class="meta">(tú)</span>' : "") +
        '</strong><br><span class="meta">@' +
        esc(a.username) +
        '</span></span></div></td><td><span class="roletag ' +
        (a.role !== "admin" ? "employeetag" : "") +
        '">' +
        role +
        "</span></td><td>" +
        esc(a.site) +
        '</td><td><span class="badge ' +
        ((isHistorical ? a.attendance_ever : a.attendance)
          ? "present-badge"
          : "") +
        '">' +
        attendanceText +
        '</span></td><td><div class="account-row-actions">' +
        attendanceAction +
        editAction +
        deleteAction +
        "</div></td></tr>"
      );
    })
    .join("");
  const body = s.accountsLoading
    ? '<div class="empty">Cargando cuentas…</div>'
    : s.accountsError
      ? '<div class="empty">' + esc(s.accountsError) + "</div>"
      : rows
        ? '<div class="tablewrap"><table class="table account-table"><thead><tr><th>PERSONA</th><th>ROL</th><th>SEDE</th><th>' +
          presentLabel.toUpperCase() +
          "</th><th>ACCIONES</th></tr></thead><tbody>" +
          rows +
          "</tbody></table></div>"
        : '<div class="empty">No había cuentas registradas para esta fecha.</div>';
  const dateControl =
    s.role === "Administrador"
      ? '<div class="account-date-control"><span class="meta">' +
        (isHistorical
          ? "Consulta histórica: " + formatDateLong(accountDate)
          : "Consulta de hoy") +
        '</span><button class="btn secondary" id="edit-account-date">Elegir fecha</button></div>'
      : "";
  return (
    '<section class="page-head"><div><div class="eyebrow">Perfil y equipo</div><h1>' +
    (emp ? "Tu cuenta y equipo" : "Cuentas y equipo") +
    '</h1></div><div class="account-actions">' +
    dateControl +
    (emp
      ? ""
      : '<button class="btn secondary" id="manage-sites">Gestionar sedes</button><button class="btn primary" id="create-account">＋ Crear cuenta</button>') +
    '<button class="btn secondary" id="change-password">Cambiar contraseña</button></div></section><div class="metrics account-metrics"><article class="metric"><div class="metric-label">Mi perfil</div><div class="metric-value" style="font-size:17px">' +
    esc(s.user) +
    '</div><div class="metric-foot neutral">' +
    esc(s.roleLabel || s.role) +
    '</div></article><article class="metric"><div class="metric-label">Mi sede</div><div class="metric-value" style="font-size:17px">' +
    esc(s.site) +
    '</div></article><article class="metric"><div class="metric-label">Cuentas visibles</div><div class="metric-value">' +
    list.length +
    '</div></article><article class="metric"><div class="metric-label">' +
    presentLabel +
    '</div><div class="metric-value">' +
    list.filter((a) => (isHistorical ? a.attendance_ever : a.attendance))
      .length +
    "/" +
    list.length +
    '</div></article></div><section class="panel"><div class="panel-head"><div><div class="panel-title">' +
    (emp ? "Compañeros de " + esc(s.site) : "Personal y permisos") +
    "</div>" +
    (emp
      ? '<div class="meta">La asistencia la marca un compañero o administrador.</div>'
      : "") +
    "</div></div>" +
    body +
    `</section>${
      emp
        ? `<section class="panel personal-note-panel"><div class="panel-head"><div><div class="panel-title">Mi nota del mes</div><div class="meta">Anota información útil para el cierre de mes.</div></div><button class="btn secondary" id="save-employee-note">Guardar nota</button></div><textarea id="employee-note" maxlength="5000" placeholder="Escribe una nota para recordar…">${esc((s.employeeNotes || []).find((x) => x.auth_user_id === s.authUserId)?.note || "")}</textarea><div class="meta">${esc((s.employeeNotes || []).find((x) => x.auth_user_id === s.authUserId)?.updated_at ? `Última edición: ${formatDateLong(limaDateOf((s.employeeNotes || []).find((x) => x.auth_user_id === s.authUserId).updated_at))}` : "Aún no hay una nota guardada.")}</div></section>`
        : s.role === "Administrador"
          ? `<section class="panel personal-note-panel"><div class="panel-head"><div><div class="panel-title">Notas del equipo</div><div class="meta">Notas personales que cada empleado mantiene para el cierre de mes.</div></div></div><div class="notes-team-list">${
              list
                .filter((a) => a.role !== "admin")
                .map((a) => {
                  const note = (s.employeeNotes || []).find(
                    (x) => x.auth_user_id === a.auth_user_id,
                  )?.note;
                  return `<div class="notes-team-row"><strong>${esc(a.display_name)}</strong><span class="roletag employeetag">${esc(a.role_name)}</span><p>${note ? esc(note) : '<span class="meta">Sin nota registrada</span>'}</p></div>`;
                })
                .join("") || '<div class="empty">No hay empleados.</div>'
            }</div></section>`
          : ""
    }`
  );
}
// Abre el diálogo para seleccionar la fecha de asistencia.
function accountDateDialog() {
  const dates = new Set(s.accountDataDates),
    months = [...new Set([...dates].map((x) => x.slice(0, 7)))].sort(),
    d = document.createElement("dialog");
  d.className = "password-dialog account-calendar";
  let month =
      s.accountDate && months.includes(s.accountDate.slice(0, 7))
        ? s.accountDate.slice(0, 7)
        : months[months.length - 1] || limaToday().slice(0, 7),
    selected = dates.has(s.accountDate) ? s.accountDate : "";
  const draw = () => {
    const [year, monthNum] = month.split("-").map(Number),
      first = new Date(year, monthNum - 1, 1),
      offset = (first.getDay() + 6) % 7,
      days = new Date(year, monthNum, 0).getDate(),
      monthIndex = months.indexOf(month),
      title = new Intl.DateTimeFormat("es-PE", {
        month: "long",
        year: "numeric",
      }).format(new Date(year, monthNum - 1, 15)),
      cells = Array.from(
        { length: offset },
        () => '<span class="calendar-blank"></span>',
      );
    for (let day = 1; day <= days; day++) {
      const date = month + "-" + String(day).padStart(2, "0"),
        enabled = dates.has(date);
      cells.push(
        '<button type="button" class="calendar-day ' +
          (selected === date ? "selected" : "") +
          '" data-calendar-date="' +
          (enabled ? date : "") +
          '" ' +
          (enabled ? "" : "disabled") +
          ">" +
          day +
          "</button>",
      );
    }
    d.innerHTML =
      '<div class="calendar-head"><button type="button" class="calendar-nav" id="calendar-prev" ' +
      (monthIndex <= 0 ? "disabled" : "") +
      ' aria-label="Mes anterior">‹</button><div class="panel-title">' +
      title +
      '</div><button type="button" class="calendar-nav" id="calendar-next" ' +
      (monthIndex < 0 || monthIndex >= months.length - 1 ? "disabled" : "") +
      ' aria-label="Mes siguiente">›</button></div><div class="calendar-grid calendar-weekdays"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div><div class="calendar-grid">' +
      cells.join("") +
      '</div><div class="dialog-actions calendar-actions"><button type="button" class="btn secondary" id="close-calendar">Cerrar</button><button type="button" class="btn secondary" id="show-today">Ver hoy</button><button type="button" class="btn primary" id="show-date" ' +
      (selected ? "" : "disabled") +
      ">Ver fecha</button></div>";
    d.querySelector("#close-calendar").onclick = () => d.close();
    d.querySelector("#show-today").onclick = () => {
      s.accountDate = limaToday();
      d.close();
      loadAccounts();
    };
    d.querySelector("#show-date").onclick = () => {
      if (!dates.has(selected)) return;
      s.accountDate = selected;
      d.close();
      loadAccounts();
    };
    d.querySelector("#calendar-prev").onclick = () => {
      if (monthIndex > 0) {
        month = months[monthIndex - 1];
        draw();
      }
    };
    d.querySelector("#calendar-next").onclick = () => {
      if (monthIndex >= 0 && monthIndex < months.length - 1) {
        month = months[monthIndex + 1];
        draw();
      }
    };
    d.querySelectorAll("[data-calendar-date]").forEach(
      (b) =>
        (b.onclick = () => {
          if (b.dataset.calendarDate) {
            selected = b.dataset.calendarDate;
            draw();
          }
        }),
    );
  };
  draw();
  document.body.appendChild(d);
  d.showModal();
  d.addEventListener("close", () => d.remove());
}
function accountRoleSelectorMarkup(selectedIds = []) {
  const selected = new Set(selectedIds),
    selectedRoles = (s.availableRoles || []).filter((role) =>
      selected.has(role.id),
    ),
    mode = selectedRoles.some((role) => role.key === "admin")
      ? "admin"
      : selectedRoles.some((role) => role.key === "employee")
        ? "employee"
        : "custom",
    role = (key) => (s.availableRoles || []).find((item) => item.key === key);
  return `<label class="dialog-label account-role-mode">Tipo de cuenta<select name="role_mode"><option value="admin" ${mode === "admin" ? "selected" : ""}>Administrador</option><option value="employee" ${mode === "employee" ? "selected" : ""}>Empleado</option><option value="custom" ${mode === "custom" ? "selected" : ""}>Ninguna de las anteriores</option></select></label><div class="account-custom-roles" ${mode === "custom" ? "" : "hidden"}><p class="meta">Selecciona uno o más permisos para combinar sus funciones.</p><div class="account-role-options">${(
    s.availableRoles || []
  )
    .filter((item) => !["admin", "employee"].includes(item.key))
    .map(
      (item) =>
        `<label class="account-role-option"><input type="checkbox" name="custom_role_ids" value="${esc(item.id)}" ${selected.has(item.id) ? "checked" : ""}><span>${esc(item.name)}</span></label>`,
    )
    .join("")}</div></div>`;
}

function selectedAccountRoleIds(form) {
  const mode = form.querySelector('[name="role_mode"]')?.value;
  if (mode === "admin" || mode === "employee") {
    const id = (s.availableRoles || []).find((role) => role.key === mode)?.id;
    return id ? [id] : [];
  }
  return [...form.querySelectorAll('[name="custom_role_ids"]:checked')].map(
    (input) => input.value,
  );
}

function bindAccountRoleSelector(form, onChange = () => {}) {
  const select = form.querySelector('[name="role_mode"]'),
    options = form.querySelector(".account-custom-roles");
  const update = () => {
    options.hidden = select.value !== "custom";
    onChange();
  };
  select.addEventListener("change", update);
  form
    .querySelectorAll('[name="custom_role_ids"]')
    .forEach((input) => input.addEventListener("change", onChange));
  update();
}

function accountScheduleRowMarkup(schedule = {}) {
  const weekdays = [
    [1, "Lunes"],
    [2, "Martes"],
    [3, "Miércoles"],
    [4, "Jueves"],
    [5, "Viernes"],
    [6, "Sábado"],
    [0, "Domingo"],
  ];
  return `<div class="schedule-row"><select name="workday" aria-label="Día">${weekdays.map(([value, label]) => `<option value="${value}" ${Number(schedule.weekday) === value ? "selected" : ""}>${label}</option>`).join("")}</select><label class="schedule-time"><span>Entrada</span><input type="time" name="workstart" value="${esc(String(schedule.starts_at || "").slice(0, 5))}" required></label><label class="schedule-time"><span>Salida</span><input type="time" name="workend" value="${esc(String(schedule.ends_at || "").slice(0, 5))}" required></label><button type="button" class="schedule-remove" data-remove-schedule aria-label="Quitar horario">×</button></div>`;
}

function bindAccountScheduleRows(form) {
  const rows = form.querySelector("#work-schedule-rows"),
    add = form.querySelector("#add-work-schedule");
  const syncRemoveButtons = () => {
    const items = rows.querySelectorAll(".schedule-row"),
      onlyOne = items.length <= 1;
    items.forEach((item) => {
      const button = item.querySelector("[data-remove-schedule]");
      button.disabled = onlyOne;
      button.title = onlyOne
        ? "Debe quedar al menos un horario"
        : "Quitar horario";
    });
  };
  add?.addEventListener("click", () => {
    rows.insertAdjacentHTML("beforeend", accountScheduleRowMarkup());
    syncRemoveButtons();
  });
  rows?.addEventListener("click", (event) => {
    if (
      event.target.closest("[data-remove-schedule]") &&
      rows.querySelectorAll(".schedule-row").length > 1
    ) {
      event.target.closest(".schedule-row").remove();
      syncRemoveButtons();
    }
  });
  syncRemoveButtons();
}

function collectAccountSchedules(form) {
  const rows = [...form.querySelectorAll("#work-schedule-rows .schedule-row")];
  const schedules = rows.map((row) => ({
    weekday: Number(row.querySelector('[name="workday"]').value),
    starts_at: row.querySelector('[name="workstart"]').value,
    ends_at: row.querySelector('[name="workend"]').value,
  }));
  if (
    !schedules.length ||
    schedules.some((item) => !item.starts_at || !item.ends_at)
  )
    return {
      schedules,
      error:
        "Completa el día, la hora de entrada y la hora de salida de cada horario.",
    };
  if (schedules.some((item) => item.starts_at >= item.ends_at))
    return {
      schedules,
      error: "La entrada debe ser anterior a la salida en cada horario.",
    };
  const byDay = new Map();
  for (const item of schedules) {
    const daySchedules = byDay.get(item.weekday) || [];
    daySchedules.push(item);
    byDay.set(item.weekday, daySchedules);
  }
  for (const daySchedules of byDay.values()) {
    daySchedules.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (let index = 1; index < daySchedules.length; index++) {
      if (daySchedules[index].starts_at < daySchedules[index - 1].ends_at)
        return {
          schedules,
          error:
            "Los horarios del mismo día se cruzan. Ajusta las horas para que no se superpongan.",
        };
    }
  }
  return { schedules, error: "" };
}

function isAdminRoleSelection(form) {
  return form.querySelector('[name="role_mode"]')?.value === "admin";
}

// Abre el formulario para editar una cuenta existente.
function editAccountDialog(account) {
  const d = document.createElement("dialog");
  d.className = "password-dialog account-dialog";
  const schedules = account.schedules?.length ? account.schedules : [{}];
  d.innerHTML = `<form method="dialog"><div class="panel-title">Editar cuenta</div><label class="dialog-label">Nombre visible<input name="display_name" maxlength="100" required value="${esc(account.display_name)}"></label><fieldset class="dialog-label"><legend>Roles y permisos</legend>${accountRoleSelectorMarkup(account.role_ids || [])}</fieldset><label class="dialog-label" id="edit-account-location-wrap">Sede<select name="location_id" id="edit-account-location"><option value="">Seleccionar sede</option>${s.locations.map((location) => `<option value="${esc(location.id)}" ${location.id === account.location_id ? "selected" : ""}>${esc(location.name)}</option>`).join("")}</select></label><div class="dialog-label" id="edit-account-schedules-wrap"><span>Horarios de trabajo</span><div id="work-schedule-rows" class="schedule-list">${schedules.map((schedule) => accountScheduleRowMarkup(schedule)).join("")}</div><button type="button" class="btn small" id="add-work-schedule">＋ Agregar horario</button></div><button type="button" class="btn secondary" id="reset-account-password">Restablecer contraseña</button><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="save-account" value="save">Guardar cambios</button></div></form>`;
  document.body.appendChild(d);
  const f = d.querySelector("form"),
    wrap = f.querySelector("#edit-account-location-wrap"),
    site = f.querySelector("#edit-account-location"),
    scheduleWrap = f.querySelector("#edit-account-schedules-wrap"),
    save = f.querySelector("#save-account");
  const updateFields = () => {
    const selectedAdmin = isAdminRoleSelection(f);
    wrap.hidden = selectedAdmin;
    site.required = !selectedAdmin;
    scheduleWrap.hidden = selectedAdmin;
  };
  bindAccountRoleSelector(f, updateFields);
  bindAccountScheduleRows(f);
  updateFields();
  f.querySelector("#reset-account-password").addEventListener("click", () =>
    resetAccountPasswordDialog(account),
  );
  d.showModal();
  f.addEventListener("submit", async (e) => {
    if (e.submitter?.id !== "save-account") return;
    e.preventDefault();
    const err = f.querySelector(".password-error"),
      name = new FormData(f).get("display_name").trim(),
      roleIds = selectedAccountRoleIds(f),
      adminSelected = isAdminRoleSelection(f),
      scheduleResult = collectAccountSchedules(f);
    err.textContent = "";
    if (!name) {
      err.textContent = "Escribe el nombre de la cuenta.";
      return;
    }
    if (!roleIds.length) {
      err.textContent = "Selecciona al menos un rol de la lista.";
      return;
    }
    if (!adminSelected && !site.value) {
      err.textContent = "Selecciona una sede para la cuenta.";
      return;
    }
    if (!adminSelected && scheduleResult.error) {
      err.textContent = scheduleResult.error;
      return;
    }
    save.disabled = true;
    try {
      const { data, error } = await supabase.functions.invoke("staff-admin", {
        body: {
          action: "update",
          auth_user_id: account.auth_user_id,
          display_name: name,
          role_ids: roleIds,
          location_id: adminSelected ? null : site.value,
          schedules: adminSelected ? [] : scheduleResult.schedules,
        },
      });
      if (error || data?.error)
        throw new Error(data?.error || "No se pudo actualizar la cuenta.");
      d.close();
      await loadAccounts();
      toast("Cuenta actualizada.");
    } catch (error) {
      err.textContent = error.message || "No se pudo actualizar la cuenta.";
    } finally {
      if (save.isConnected) save.disabled = false;
    }
  });
  d.addEventListener("close", () => d.remove());
}

function resetAccountPasswordDialog(account) {
  const dialog = document.createElement("dialog");
  dialog.className = "password-dialog";
  dialog.innerHTML = `<form method="dialog"><div class="panel-title">Restablecer contraseña</div><p class="meta">Al iniciar sesión de nuevo, la persona deberá elegir una contraseña nueva.</p><label class="dialog-label">Contraseña temporal<input name="password" type="password" minlength="6" autocomplete="new-password" required></label><label class="dialog-label">Repite la contraseña<input name="confirm" type="password" minlength="6" autocomplete="new-password" required></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="confirm-reset-password" value="save">Restablecer</button></div></form>`;
  document.body.appendChild(dialog);
  const form = dialog.querySelector("form");
  dialog.showModal();
  form.addEventListener("submit", async (event) => {
    if (event.submitter?.id !== "confirm-reset-password") return;
    event.preventDefault();
    const values = new FormData(form),
      password = String(values.get("password")),
      confirm = String(values.get("confirm"));
    const error = form.querySelector(".password-error"),
      button = form.querySelector("#confirm-reset-password");
    error.textContent = "";
    if (password !== confirm) {
      error.textContent = "Las contraseñas no coinciden.";
      return;
    }
    button.disabled = true;
    try {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "staff-admin",
        {
          body: {
            action: "reset_password",
            auth_user_id: account.auth_user_id,
            password,
          },
        },
      );
      if (invokeError || data?.error)
        throw new Error(
          data?.error ||
            invokeError?.message ||
            "No se pudo restablecer la contraseña.",
        );
      dialog.close();
      toast(
        "Contraseña temporal guardada. Debe cambiarla al volver a ingresar.",
      );
    } catch (requestError) {
      error.textContent =
        requestError.message || "No se pudo restablecer la contraseña.";
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  dialog.addEventListener("close", () => dialog.remove());
}

// Abre el diálogo para registrar la asistencia de una cuenta.
function markAttendanceDialog(account, eventType) {
  const d = document.createElement("dialog");
  d.className = "password-dialog";
  const preferredLocation = account.location_id || s.locations[0]?.id;
  d.innerHTML = `<form method="dialog"><div class="panel-title">Registrar ${eventType === "check_in" ? "entrada" : "salida"}</div><p class="meta">Puedes usar la hora actual o registrar una corrección de hoy o ayer.</p><label class="dialog-label">Sede<select name="location_id" required>${s.locations.map((location) => `<option value="${esc(location.id)}" ${location.id === preferredLocation ? "selected" : ""}>${esc(location.name)}</option>`).join("")}</select></label><label class="dialog-label">Hora efectiva (opcional)<input type="datetime-local" name="event_at"><span class="meta">Déjala vacía para registrar ahora. Si eliges una hora, explica la corrección.</span></label><label class="dialog-label">Motivo de corrección<textarea name="correction_reason" maxlength="500" placeholder="Obligatorio al registrar una hora anterior"></textarea></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="confirm-admin-attendance" value="save">Registrar marca</button></div></form>`;
  document.body.appendChild(d);
  const f = d.querySelector("form");
  d.showModal();
  f.addEventListener("submit", async (e) => {
    if (e.submitter?.id !== "confirm-admin-attendance") return;
    e.preventDefault();
    const btn = f.querySelector("#confirm-admin-attendance"),
      err = f.querySelector(".password-error"),
      fields = new FormData(f),
      locationId = fields.get("location_id"),
      localDateTime = String(fields.get("event_at") || ""),
      reason = String(fields.get("correction_reason") || "").trim();
    if (localDateTime && !reason) {
      err.textContent = "Escribe el motivo de la corrección.";
      return;
    }
    btn.disabled = true;
    const { error } = await supabase.rpc("mark_attendance", {
      p_staff_profile_id: account.auth_user_id,
      p_location_id: locationId,
      p_event_type: eventType,
      p_event_at: localDateTime ? new Date(localDateTime).toISOString() : null,
      p_correction_reason: localDateTime ? reason : null,
    });
    btn.disabled = false;
    if (error) {
      err.textContent = error.message || "No se pudo registrar la asistencia.";
      return;
    }
    d.close();
    await loadAccounts();
    toast(
      "Marca registrada en " +
        s.locations.find((x) => x.id === locationId)?.name +
        ".",
    );
  });
  d.addEventListener("close", () => d.remove());
}
// Guarda o actualiza la asistencia de un miembro del personal.
async function markAttendance(staffId, eventType = "check_in") {
  const account = s.accounts.find((a) => a.auth_user_id === staffId);
  if (!account) return;
  if (s.role === "Administrador") {
    if (!s.locations.length) {
      toast("Primero crea una sede.");
      return;
    }
    markAttendanceDialog(account, eventType);
    return;
  }
  const { error } = await supabase.rpc("mark_attendance", {
    p_staff_profile_id: staffId,
    p_location_id: account.location_id,
    p_event_type: eventType,
  });
  if (error) {
    toast(error.message || "No se pudo marcar la asistencia.");
    return;
  }
  await loadAccounts();
  toast(
    eventType === "check_in" ? "Entrada registrada." : "Salida registrada.",
  );
}
// Abre el formulario para crear una nueva cuenta de personal.
function createAccountDialog() {
  const d = document.createElement("dialog");
  d.className = "password-dialog account-dialog";
  d.innerHTML = `<form method="dialog"><div class="panel-title">Crear cuenta</div><p class="meta">La persona iniciará sesión con el usuario y la contraseña que asignes.</p><label class="dialog-label">Nombre completo<input name="display_name" maxlength="100" required autocomplete="name" placeholder="Ej. Ana Morales"></label><label class="dialog-label">Nombre de usuario<input name="username" id="new-account-username" maxlength="49" required autocomplete="off" placeholder="Ej. ana.morales"><span class="meta">Sin espacios; se guardará en minúsculas y sin tildes.</span><span class="username-availability" id="username-availability" aria-live="polite"></span></label><fieldset class="dialog-label"><legend>Roles y permisos</legend>${accountRoleSelectorMarkup()}</fieldset><label class="dialog-label" id="new-account-location-wrap">Sede<select name="location_id" id="new-account-location"><option value="">Seleccionar sede</option>${s.locations.map((location) => `<option value="${esc(location.id)}">${esc(location.name)}</option>`).join("")}</select><span class="meta" id="no-locations-message" ${s.locations.length ? "hidden" : ""}>Primero crea una sede con “Gestionar sedes”.</span></label><label class="dialog-label">Contraseña inicial<input name="password" type="password" minlength="6" required autocomplete="new-password" placeholder="Mínimo 6 caracteres"></label><div class="dialog-label" id="new-account-schedules-wrap"><span>Horarios de trabajo</span><div id="work-schedule-rows" class="schedule-list">${accountScheduleRowMarkup()}</div><button type="button" class="btn small" id="add-work-schedule">＋ Agregar horario</button></div><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="submit-new-account" value="save">Crear cuenta</button></div></form>`;
  document.body.appendChild(d);
  const form = d.querySelector("form"),
    locationWrap = form.querySelector("#new-account-location-wrap"),
    locationSelect = form.querySelector("#new-account-location"),
    scheduleWrap = form.querySelector("#new-account-schedules-wrap"),
    submit = form.querySelector("#submit-new-account");
  const usernameInput = form.querySelector("#new-account-username"),
    usernameHelp = form.querySelector("#username-availability");
  let usernameCheckVersion = 0;
  const checkUsernameAvailability = async () => {
    const version = ++usernameCheckVersion,
      username = normalizeUsername(usernameInput.value);
    usernameHelp.textContent = "";
    usernameHelp.className = "username-availability";
    if (!/^[a-z0-9._-]{1,49}$/.test(username)) return false;
    const { data, error } = await supabase
      .from("accounts")
      .select("auth_user_id")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();
    if (version !== usernameCheckVersion) return Boolean(data);
    if (error) {
      usernameHelp.textContent =
        "No se pudo comprobar el usuario. Vuelve a intentarlo.";
      usernameHelp.classList.add("error");
      return false;
    }
    if (data) {
      usernameHelp.textContent = "Este nombre ya está tomado.";
      usernameHelp.classList.add("error");
      return true;
    }
    usernameHelp.textContent = "Nombre disponible.";
    usernameHelp.classList.add("available");
    return false;
  };
  usernameInput.addEventListener("input", () => {
    usernameCheckVersion++;
    usernameHelp.textContent = "";
    usernameHelp.className = "username-availability";
  });
  usernameInput.addEventListener("blur", checkUsernameAvailability);
  const syncRole = () => {
    const adminSelected = isAdminRoleSelection(form),
      roleIds = selectedAccountRoleIds(form);
    locationWrap.hidden = adminSelected;
    scheduleWrap.hidden = adminSelected;
    locationSelect.required = !adminSelected;
    submit.disabled =
      !roleIds.length || (!adminSelected && !s.locations.length);
  };
  bindAccountRoleSelector(form, syncRole);
  bindAccountScheduleRows(form);
  syncRole();
  d.showModal();
  form.addEventListener("submit", async (e) => {
    if (!e.submitter || e.submitter.id !== "submit-new-account") return;
    e.preventDefault();
    const data = new FormData(form),
      error = form.querySelector(".password-error"),
      username = normalizeUsername(data.get("username")),
      roleIds = selectedAccountRoleIds(form),
      adminSelected = isAdminRoleSelection(form),
      scheduleResult = collectAccountSchedules(form);
    error.textContent = "";
    if (!/^[a-z0-9._-]{1,49}$/.test(username)) {
      error.textContent =
        "El usuario debe tener hasta 49 caracteres: letras, números, punto, guion o guion bajo.";
      return;
    }
    if (!roleIds.length) {
      error.textContent = "Selecciona un rol o combina permisos de la lista.";
      return;
    }
    if (!adminSelected && !data.get("location_id")) {
      error.textContent = "Crea o selecciona una sede para el empleado.";
      return;
    }
    if (!adminSelected && scheduleResult.error) {
      error.textContent = scheduleResult.error;
      return;
    }
    submit.disabled = true;
    const usernameTaken = await checkUsernameAvailability();
    if (usernameTaken || usernameHelp.classList.contains("error")) {
      submit.disabled = false;
      usernameInput.focus();
      if (usernameTaken)
        error.textContent = "Elige otro nombre de usuario para continuar.";
      return;
    }
    try {
      const { data: result, error: invokeError } =
        await supabase.functions.invoke("staff-admin", {
          body: {
            action: "create",
            display_name: data.get("display_name"),
            username,
            role_ids: roleIds,
            location_id: !adminSelected ? data.get("location_id") : null,
            password: data.get("password"),
            schedules: adminSelected ? [] : scheduleResult.schedules,
          },
        });
      if (invokeError) {
        let details = null;
        try {
          details = await invokeError.context?.json?.();
        } catch {}
        if (details?.error === "username_taken") {
          usernameHelp.textContent = "Este nombre ya está tomado.";
          usernameHelp.classList.add("error");
          usernameInput.focus();
          return;
        }
        throw new Error(
          details?.error ||
            invokeError.message ||
            "No se pudo crear la cuenta.",
        );
      }
      if (result?.error) throw new Error(result.error);
      d.close();
      await loadAccounts();
      toast("Cuenta creada correctamente.");
    } catch (err) {
      error.textContent = err.message || "No se pudo crear la cuenta.";
    } finally {
      if (submit.isConnected) syncRole();
    }
  });
  d.addEventListener("close", () => d.remove());
}
// Abre el diálogo para administrar las sedes disponibles.
function manageLocationsDialog() {
  const d = document.createElement("dialog");
  d.className = "password-dialog account-dialog";
  const draw = () => {
    const rows = s.locations
      .map(
        (l) =>
          '<div class="location-row"><span><strong>' +
          esc(l.name) +
          "</strong><small>" +
          esc(l.address || "Sin dirección") +
          '</small></span><span class="location-actions"><button type="button" class="rowaction" data-rename-location="' +
          l.id +
          '">Editar</button><button type="button" class="rowaction danger-action" data-delete-location="' +
          l.id +
          '" ' +
          (s.locations.length <= 1
            ? 'disabled title="El restaurante debe conservar al menos una sede"'
            : "") +
          ">Eliminar</button></span></div>",
      )
      .join("");
    d.innerHTML =
      '<form method="dialog"><div class="panel-title">Gestionar sedes</div><p class="meta">Las sedes con cuentas o historial asociado no se pueden eliminar.</p><div class="location-list">' +
      (rows || '<div class="empty">Aún no hay sedes.</div>') +
      '</div><div class="dialog-actions"><button class="btn secondary" value="close">Cerrar</button><button type="button" class="btn primary" id="open-create-location">＋ Crear sede</button></div></form>';
    d.querySelector("#open-create-location").onclick = () =>
      editLocationDialog();
    d.querySelectorAll("[data-rename-location]").forEach(
      (b) =>
        (b.onclick = () => {
          const l = s.locations.find((x) => x.id === b.dataset.renameLocation);
          if (l) editLocationDialog(l);
        }),
    );
    d.querySelectorAll("[data-delete-location]").forEach(
      (b) =>
        (b.onclick = () => {
          const l = s.locations.find((x) => x.id === b.dataset.deleteLocation);
          if (l) deleteLocation(l);
        }),
    );
  };
  draw();
  document.body.appendChild(d);
  d.showModal();
  d.addEventListener("close", () => d.remove());
}
const locationWeekdays = [
  [1, "Lunes"],
  [2, "Martes"],
  [3, "Miércoles"],
  [4, "Jueves"],
  [5, "Viernes"],
  [6, "Sábado"],
  [0, "Domingo"],
];
function locationHoursMarkup(location) {
  const byDay = new Map(
    (location?.location_hours || []).map((item) => [
      Number(item.weekday),
      item,
    ]),
  );
  return locationWeekdays
    .map(([weekday, label]) => {
      const item = byDay.get(weekday),
        mode = item ? (item.closed ? "closed" : "open") : "unset";
      return `<div class="schedule-row location-hours-row"><strong>${label}</strong><select name="hour_mode" data-weekday="${weekday}"><option value="unset" ${mode === "unset" ? "selected" : ""}>Sin definir</option><option value="open" ${mode === "open" ? "selected" : ""}>Abierto</option><option value="closed" ${mode === "closed" ? "selected" : ""}>Cerrado</option></select><input aria-label="Apertura ${label}" type="time" name="opens_at" value="${esc(String(item?.opens_at || "").slice(0, 5))}" ${mode === "open" ? "required" : "disabled"}><input aria-label="Cierre ${label}" type="time" name="closes_at" value="${esc(String(item?.closes_at || "").slice(0, 5))}" ${mode === "open" ? "required" : "disabled"}></div>`;
    })
    .join("");
}

// Crea o edita los datos y el horario semanal de una sede.
function editLocationDialog(location = null) {
  const d = document.createElement("dialog");
  d.className = "password-dialog account-dialog";
  d.innerHTML = `<form method="dialog"><div class="panel-title">${location ? "Editar sede" : "Crear sede"}</div><label class="dialog-label">Nombre de la sede<input name="name" maxlength="80" required placeholder="Ej. Centro" value="${esc(location?.name || "")}"></label><label class="dialog-label">Dirección (opcional)<input name="address" maxlength="250" value="${esc(location?.address || "")}" placeholder="Calle, distrito"></label><fieldset class="dialog-label"><legend>Horario semanal</legend><p class="meta">Puedes dejar un día sin definir, marcarlo cerrado o indicar su horario.</p><div class="location-hours-list">${locationHoursMarkup(location)}</div></fieldset><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="save-location" value="save">${location ? "Guardar cambios" : "Crear sede"}</button></div></form>`;
  document.body.appendChild(d);
  const f = d.querySelector("form");
  const syncHours = (select) => {
    const row = select.closest(".location-hours-row"),
      enabled = select.value === "open";
    row
      .querySelectorAll('input[name="opens_at"],input[name="closes_at"]')
      .forEach((input) => {
        input.disabled = !enabled;
        input.required = enabled;
      });
  };
  f.querySelectorAll('[name="hour_mode"]').forEach((select) => {
    select.addEventListener("change", () => syncHours(select));
    syncHours(select);
  });
  d.showModal();
  f.addEventListener("submit", async (e) => {
    if (e.submitter?.id !== "save-location") return;
    e.preventDefault();
    const values = new FormData(f),
      name = String(values.get("name") || "").trim(),
      err = f.querySelector(".password-error"),
      btn = f.querySelector("#save-location"),
      address = String(values.get("address") || "").trim(),
      hours = [...f.querySelectorAll(".location-hours-row")].flatMap((row) => {
        const mode = row.querySelector('[name="hour_mode"]').value;
        if (mode === "unset") return [];
        return [
          {
            location_id: location?.id,
            weekday: Number(
              row.querySelector('[name="hour_mode"]').dataset.weekday,
            ),
            opens_at:
              mode === "open"
                ? row.querySelector('[name="opens_at"]').value
                : null,
            closes_at:
              mode === "open"
                ? row.querySelector('[name="closes_at"]').value
                : null,
            closed: mode === "closed",
          },
        ];
      });
    if (!name) {
      err.textContent = "Escribe el nombre de la sede.";
      return;
    }
    btn.disabled = true;
    let locationId = location?.id,
      locationError;
    if (location) {
      const result = await supabase
        .from("locations")
        .update({ name, address: address || null })
        .eq("id", location.id);
      locationError = result.error;
    } else {
      const result = await supabase
        .from("locations")
        .insert({
          name,
          address: address || null,
          restaurant_id: s.restaurantId,
        })
        .select("id")
        .single();
      locationError = result.error;
      locationId = result.data?.id;
    }
    if (!locationError && locationId) {
      const existingDays = (location?.location_hours || []).map((item) =>
        Number(item.weekday),
      );
      const selectedDays = hours.map((item) => item.weekday);
      const removedDays = existingDays.filter(
        (day) => !selectedDays.includes(day),
      );
      if (hours.length) {
        const result = await supabase.from("location_hours").upsert(
          hours.map((item) => ({ ...item, location_id: locationId })),
          { onConflict: "location_id,weekday" },
        );
        locationError = result.error;
      }
      if (!locationError && removedDays.length) {
        const result = await supabase
          .from("location_hours")
          .delete()
          .eq("location_id", locationId)
          .in("weekday", removedDays);
        locationError = result.error;
      }
    }
    btn.disabled = false;
    if (locationError || !locationId) {
      err.textContent =
        locationError?.code === "23505"
          ? "Ya existe una sede con ese nombre."
          : "No se pudieron guardar todos los datos de la sede. Revisa la conexión y vuelve a intentar.";
      return;
    }
    d.close();
    const manager = document.querySelector("dialog.account-dialog");
    if (manager?.open) manager.close();
    await loadAccounts();
    toast(location ? "Sede actualizada." : "Sede creada.");
    manageLocationsDialog();
  });
  d.addEventListener("close", () => d.remove());
}
// Elimina una sede después de validar que la operación sea posible.
async function deleteLocation(location) {
  if (s.locations.filter((item) => item.is_active !== false).length <= 1) {
    toast("El restaurante debe conservar al menos una sede.");
    return;
  }
  if (
    !(await confirmInApp(
      "Eliminar sede",
      "¿Eliminar la sede «" +
        location.name +
        "»? Solo se puede si no tiene cuentas ni historial asociado.",
      "Eliminar sede",
    ))
  )
    return;
  const { error } = await supabase
    .from("locations")
    .delete()
    .eq("id", location.id);
  if (error) {
    toast(
      error.code === "23503"
        ? "No se puede eliminar: la sede tiene cuentas o registros históricos asociados."
        : "No se pudo eliminar la sede.",
    );
    return;
  }
  const d = document.querySelector("dialog.account-dialog");
  if (d?.open) d.close();
  await loadAccounts();
  toast("Sede eliminada.");
  manageLocationsDialog();
}
// Abre el diálogo para confirmar la eliminación de una cuenta.
function deleteAccountDialog(account) {
  const self = account.auth_user_id === s.authUserId,
    adminCount = s.accounts.filter(
      (a) => a.role === "admin" && a.is_active,
    ).length;
  if (account.role === "admin" && !self) {
    toast("No puedes eliminar a otro administrador.");
    return;
  }
  if (self && adminCount < 2) {
    toast("Debe quedar al menos otro administrador.");
    return;
  }
  const d = document.createElement("dialog");
  d.className = "password-dialog";
  d.innerHTML =
    '<form method="dialog"><div class="panel-title">Eliminar cuenta</div><p>¿Eliminar el acceso de <strong>' +
    esc(account.display_name) +
    "</strong> (@" +
    esc(account.username) +
    ')?</p><p class="meta">Sus pedidos y asistencias históricos se conservarán.</p><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel">Cancelar</button><button class="btn danger-button" id="confirm-delete-account" value="delete">Eliminar cuenta</button></div></form>';
  document.body.appendChild(d);
  const form = d.querySelector("form");
  d.showModal();
  form.addEventListener("submit", async (e) => {
    if (!e.submitter || e.submitter.id !== "confirm-delete-account") return;
    e.preventDefault();
    const error = form.querySelector(".password-error"),
      button = form.querySelector("#confirm-delete-account");
    button.disabled = true;
    const { data: result, error: invokeError } =
      await supabase.functions.invoke("staff-admin", {
        body: { action: "delete", auth_user_id: account.auth_user_id },
      });
    button.disabled = false;
    if (invokeError || result?.error) {
      error.textContent =
        result?.error ||
        "No se pudo eliminar la cuenta. Comprueba que la Edge Function esté desplegada.";
      return;
    }
    d.close();
    if (self) {
      await supabase.auth.signOut();
      s.user = null;
      s.authUserId = null;
      s.current = null;
      s.orders = [];
      s.draft = { items: [], note: "" };
      s.orderTableId = null;
      s.orderTableLabel = "";
      render();
      return;
    }
    await loadAccounts();
    toast("Acceso eliminado; el historial permanece.");
  });
  d.addEventListener("close", () => d.remove());
}

// Procesa el cambio de contraseña de la cuenta actual.
function changePassword(required = false) {
  const d = document.createElement("dialog");
  d.className = "password-dialog";
  d.innerHTML = `<form method="dialog"><div class="panel-title">${required ? "Elige una nueva contraseña" : "Cambiar contraseña"}</div><p class="meta">Ingresa tu contraseña actual y define una nueva.</p><label class="dialog-label">Contraseña actual<input name="old" type="password" required autocomplete="current-password"></label><label class="dialog-label">Contraseña nueva<input name="next" type="password" minlength="6" required autocomplete="new-password"></label><label class="dialog-label">Repite la contraseña nueva<input name="confirm" type="password" minlength="6" required autocomplete="new-password"></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="save-password" value="save">Guardar</button></div></form>`;
  document.body.appendChild(d);
  d.showModal();
  d.querySelector("form").addEventListener("submit", async (e) => {
    if (!e.submitter || e.submitter.id !== "save-password") return;
    e.preventDefault();
    const form = d.querySelector("form"),
      f = new FormData(form),
      old = f.get("old"),
      next = f.get("next"),
      confirm = f.get("confirm"),
      error = d.querySelector(".password-error"),
      button = d.querySelector("#save-password");
    error.textContent = "";
    if (next !== confirm) {
      error.textContent = "Las contraseñas nuevas no coinciden.";
      return;
    }
    if (String(next).length < 6) {
      error.textContent = "La contraseña debe tener al menos 6 caracteres.";
      return;
    }
    if (next === old) {
      error.textContent = "Elige una contraseña diferente a la actual.";
      return;
    }
    if (!supabase || !s.username) {
      error.textContent = "No hay una sesión autenticada.";
      return;
    }
    button.disabled = true;
    try {
      const email = authEmailForUsername(s.username);
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password: old,
      });
      if (verifyError) throw new Error("La contraseña actual no es correcta.");
      const { error: updateError } = await supabase.auth.updateUser({
        password: next,
      });
      if (updateError) throw updateError;
      if (required) {
        const { error: clearError } = await supabase.rpc(
          "clear_own_password_change_requirement",
        );
        if (clearError) throw clearError;
        s.mustChangePassword = false;
      }
      let toSave = next;
      await supabase.from("accounts").update({ passwords: toSave }).eq("auth_user_id", s.authUserId); 
      d.close();
      toast("Contraseña actualizada.");
      if (required) {
        s.page = "orders";
        render();
        orderFlow.enter("orders");
      }
    } catch (error) {
      d.querySelector(".password-error").textContent =
        error.message || "No se pudo cambiar la contraseña.";
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  d.addEventListener("close", () => d.remove());
}
// Renderiza la aplicación y conecta sus eventos principales.
function render() {
  if (s.restaurantSuspended) {
    const root = $("#app");
    root.innerHTML =
      '<main class="login"><section class="login-card" style="max-width:760px;padding:64px 36px"><img src="/assets/black-white-logo.svg" alt="Black&White POS" style="width:min(320px,80%);margin-bottom:38px"><div class="eyebrow">Acceso no disponible</div><h1 style="font-size:clamp(30px,6vw,58px);margin:14px 0">Tu restaurante ha sido dado de baja</h1><p>Contacta con el equipo de Black&amp;White para revisar el estado de tu servicio.</p></section></main>';
    return;
  }
  if (s.user && !canOpenWorkspace(s.page))
    s.page = defaultWorkspaceForAccount();
  applyDeviceClasses();
  let root = $("#app");
  root.innerHTML = s.user ? shell() : login();
  appearance.apply();
  bind();
  requestAnimationFrame(adaptNewOrderButton);
}
function primaryDeviceKind() {
  if (deviceFormFactors?.includes("Tablet")) return "tablet";
  if (deviceFormFactors?.includes("Mobile")) return "mobile";
  if (deviceFormFactors?.includes("Desktop")) return "desktop";

  const ua = navigator.userAgent || "";
  if (
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  )
    return "tablet";
  if (/iPhone|iPod|Windows Phone/i.test(ua)) return "mobile";

  const android = /Android/i.test(ua);
  const tabletModel =
    /\b(?:SM-T|SM-X|Lenovo TB|Pixel Tablet|MatePad|MediaPad|Nexus 7|Nexus 10|Tab\s)/i.test(
      ua,
    );
  if (android && tabletModel) return "tablet";
  if (navigator.userAgentData?.mobile === true || /Android.*Mobile/i.test(ua))
    return "mobile";
  if (android && !/Mobile/i.test(ua)) return "tablet";

  // Touch-capable desktop-class devices are ambiguous; try the resolution fallback.
  const mayBeTablet =
    navigator.maxTouchPoints > 0 || matchMedia("(any-pointer: coarse)").matches;
  return mayBeTablet ? null : "desktop";
}
function isTabletResolution() {
  const touchCapable =
    navigator.maxTouchPoints > 0 || matchMedia("(any-pointer: coarse)").matches;
  const tabletLikeDensity = window.devicePixelRatio >= 1.5;
  if (!touchCapable && !tabletLikeDensity) return false;
  const sizes = [
    [screen.width, screen.height],
    [innerWidth, innerHeight],
  ];
  const tolerance = 24;
  return sizes.some(
    ([width, height]) =>
      width > 0 &&
      height > 0 &&
      TABLET_RESOLUTION_FALLBACK.some(
        ([tabletWidth, tabletHeight]) =>
          Math.abs(width - tabletWidth) <= tolerance &&
          Math.abs(height - tabletHeight) <= tolerance,
      ),
  );
}
function deviceKind() {
  const primary = primaryDeviceKind();
  // Device emulation can leave a desktop UA in place while presenting a tablet viewport.
  // Let a tablet-sized screen plus touch/high-density evidence override that generic hint.
  if (isTabletResolution()) return "tablet";
  if (primary) return primary;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPod|Windows Phone/i.test(ua) ? "mobile" : "desktop";
}
function applyDeviceClasses() {
  const kind = deviceKind();
  document.body.classList.toggle("device-tablet", kind === "tablet");
  document.body.classList.toggle("device-mobile", kind === "mobile");
}
async function loadDeviceFormFactors() {
  try {
    const hints = navigator.userAgentData?.getHighEntropyValues;
    if (typeof hints !== "function") return;
    const result = await hints.call(navigator.userAgentData, ["formFactors"]);
    if (!Array.isArray(result.formFactors)) return;
    deviceFormFactors = result.formFactors;
    applyDeviceClasses();
    requestAnimationFrame(adaptNewOrderButton);
  } catch {
    // Fall back to OS identification when the browser does not expose device form factors.
  }
}
function adaptNewOrderButton() {
  const head = document.querySelector(".orders-page-head");
  const button = head?.querySelector(".new-order-button");
  if (!head || !button || !document.body.classList.contains("device-mobile"))
    return;

  const text = head.firstElementChild;
  const probe = text.cloneNode(true);
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    width: "min-content",
    flex: "none",
    inset: "0 auto auto 0",
  });
  head.append(probe);
  const minimumTextWidth = probe.getBoundingClientRect().width;
  probe.remove();
  const gap = parseFloat(getComputedStyle(head).columnGap) || 12;
  const availableWidth = head.clientWidth;

  button.classList.remove(
    "new-order-mode-single",
    "new-order-mode-stacked",
    "new-order-mode-icon",
  );
  button.classList.add("new-order-mode-single");
  if (
    minimumTextWidth + gap + button.getBoundingClientRect().width <=
    availableWidth
  )
    return;
  button.classList.replace("new-order-mode-single", "new-order-mode-stacked");
  if (
    minimumTextWidth + gap + button.getBoundingClientRect().width <=
    availableWidth
  )
    return;
  button.classList.replace("new-order-mode-stacked", "new-order-mode-icon");
}
function bindWorkspaceNavEdgeScroll() {
  const nav = document.querySelector(".sidebar .nav");
  if (!nav || nav.dataset.edgeScrollBound === "true") return;
  nav.dataset.edgeScrollBound = "true";
  let pointerY = null;
  let frame = 0;
  const edgeSize = 48;
  const stop = () => {
    pointerY = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const tick = () => {
    frame = 0;
    if (pointerY === null || nav.scrollHeight <= nav.clientHeight + 1) return;
    const rect = nav.getBoundingClientRect();
    let delta = 0;
    if (pointerY < rect.top + edgeSize)
      delta = -Math.ceil(8 * (1 - Math.max(0, pointerY - rect.top) / edgeSize));
    else if (pointerY > rect.bottom - edgeSize)
      delta = Math.ceil(8 * (1 - Math.max(0, rect.bottom - pointerY) / edgeSize));
    if (delta) nav.scrollTop += delta;
    if (delta && ((delta < 0 && nav.scrollTop > 0) || (delta > 0 && nav.scrollTop + nav.clientHeight < nav.scrollHeight)))
      frame = requestAnimationFrame(tick);
  };
  nav.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    pointerY = event.clientY;
    if (!frame) frame = requestAnimationFrame(tick);
  });
  nav.addEventListener("pointerleave", stop);
}
// Vincula los eventos de interacción de la vista actual.
function bind() {
  appearance.bind();
  bindWorkspaceNavEdgeScroll();
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        s.page = b.dataset.page;
        render();
        orderFlow.enter(s.page);
        workspaces.enter(s.page);
        if (s.page === "account") loadAccounts();
        if (s.page === "stats") statistics.enter();
        if (s.page === "settings")
          restaurantSettings.load().then(() => render());
      }),
  );
  $("#login-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitLogin();
  });
  $("#logout")?.addEventListener("click", async () => {
    orderFlow.cleanup();
    workspaces.cleanup();
    if (supabase) await supabase.auth.signOut();
    s.user = null;
    s.authUserId = null;
    s.locationId = null;
    s.current = null;
    s.orders = [];
    s.draft = { items: [], note: "" };
    s.orderTableId = null;
    s.orderTableLabel = "";
    s.restaurantSettings = null;
    render();
  });
  if (s.page === "orders" || s.page === "catalog") {
    orderFlow.bind();
    return;
  }
  if (s.page === "stats") {
    statistics.bind();
    return;
  }
  if (s.page === "settings") {
    restaurantSettings.bind();
    return;
  }
  if (["crm", "kitchen", "bar", "salon", "delivery"].includes(s.page)) {
    workspaces.bind();
    return;
  }
  if (s.page === "account") {
    $("#save-employee-note")?.addEventListener("click", async () => {
      const button = $("#save-employee-note");
      button.disabled = true;
      const result = await supabase.from("employee_notes").upsert(
        {
          auth_user_id: s.authUserId,
          restaurant_id: s.restaurantId,
          note: $("#employee-note").value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "auth_user_id" },
      );
      button.disabled = false;
      if (result.error) return toast("No se pudo guardar la nota.");
      toast("Nota guardada.");
      loadAccounts();
    });
  }
  $("#site")?.addEventListener("change", (e) => {
    s.site = e.target.value;
    render();
  });
  $("#search")?.addEventListener("input", (e) => {
    s.query = e.target.value;
    let pos = e.target.selectionStart;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(pos, pos);
  });
  document.querySelectorAll("[data-cat]").forEach(
    (b) =>
      (b.onclick = () => {
        s.category = b.dataset.cat;
        render();
      }),
  );
  document
    .querySelectorAll("[data-product]")
    .forEach((b) => (b.onclick = () => add(b.dataset.product)));
  $("#note")?.addEventListener(
    "input",
    (e) => (active().note = e.target.value),
  );
  $("#new")?.addEventListener("click", newOrder);
  $("#new-icon")?.addEventListener("click", newOrder);
  $("#delete")?.addEventListener("click", deleteOrder);
  $("#pay")?.addEventListener("click", pay);
  document
    .querySelectorAll("[data-line]")
    .forEach(
      (b) =>
        (b.onclick = () => change(Number(b.dataset.index), b.dataset.line)),
    );
  document.querySelectorAll("[data-open]").forEach(
    (b) =>
      (b.onclick = () => {
        active().note = $("#note")?.value || active().note;
        s.current = b.dataset.open;
        render();
      }),
  );
  document
    .querySelectorAll("[data-mark-attendance]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          markAttendance(b.dataset.markAttendance, b.dataset.attendanceEvent)),
    );
  document.querySelectorAll("[data-edit-account]").forEach(
    (b) =>
      (b.onclick = () => {
        const a = s.accounts.find(
          (x) => x.auth_user_id === b.dataset.editAccount,
        );
        if (a) editAccountDialog(a);
      }),
  );
  document.querySelectorAll("[data-delete-account]").forEach(
    (b) =>
      (b.onclick = () => {
        const a = s.accounts.find(
          (x) => x.auth_user_id === b.dataset.deleteAccount,
        );
        if (a) deleteAccountDialog(a);
      }),
  );
  $("#create-account")?.addEventListener("click", createAccountDialog);
  $("#manage-sites")?.addEventListener("click", manageLocationsDialog);
  $("#change-password")?.addEventListener("click", changePassword);
  $("#edit-account-date")?.addEventListener("click", accountDateDialog);
}

// Agrega un producto o movimiento al pedido activo.
function add(id) {
  let p = products.find((x) => x.id === id),
    o = active();
  if (!p) return;
  if (p.special) {
    toast("Los movimientos especiales se agregan desde el flujo de pedidos.");
    return;
  }
  let i = o.items.find((x) => x.id === id && !x.special);
  if (i) i.qty++;
  else o.items.push({ id: p.id, name: p.name, unit: p.price, qty: 1 });
  render();
}
// Guarda el pedido actual y prepara un nuevo pedido vacío.
function newOrder() {
  if (s.current) {
    active().note = $("#note")?.value || active().note;
  } else if (s.draft.items.length) {
    let id = "P-" + String(s.orders.length + 1).padStart(3, "0");
    s.orders.unshift({ id: id, items: s.draft.items, note: s.draft.note });
    s.current = id;
  }
  s.current = null;
  s.draft = { items: [], note: "" };
  render();
}
// Elimina el pedido actual o limpia el borrador en curso.
function deleteOrder() {
  if (s.current) {
    s.orders = s.orders.filter((o) => o.id !== s.current);
    s.current = null;
    s.draft = { items: [], note: "" };
  } else s.draft = { items: [], note: "" };
  render();
  toast("Pedido temporal eliminado");
}
// Modifica la cantidad o elimina una línea del pedido.
function change(n, act) {
  let o = active(),
    i = o.items[n];
  if (act === "inc") i.qty++;
  if (act === "dec") {
    i.qty--;
    if (i.qty < 1) o.items.splice(n, 1);
  }
  if (act === "remove") o.items.splice(n, 1);
  render();
}
// Registra el pago del pedido y actualiza el historial de ventas.
function pay() {
  let o = active();
  o.note = $("#note")?.value || o.note;
  if (!o.items.length) return;
  let sum = total(o),
    id = "V-" + String(85 + s.sales.length - 5).padStart(3, "0");
  s.sales.unshift({
    id: id,
    site: s.site,
    time: new Date().toLocaleTimeString("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    total: sum,
    items: o.items.map((i) => (i.qty > 1 ? i.qty + " × " : "") + i.name),
  });
  if (s.current) s.orders = s.orders.filter((x) => x.id !== s.current);
  s.current = null;
  s.draft = { items: [], note: "" };
  render();
  toast("Pago registrado en demostración · " + money(sum));
}
initializeApp();
loadDeviceFormFactors();
