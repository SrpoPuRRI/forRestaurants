//Sección de imports de las librerías y las funciones

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  AUTH_EMAIL_BASE,
} from "./supabase-config.js";
import createOrderFlow from "./order-flow.js";
import createStatistics from "./statistics.js";
import createRestaurantSettings from "./restaurant-settings.js";

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
  restaurantSettings: null,
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
  [1032, 1376], [1376, 1032], [1032, 1244], [1032, 1319],
  [1376, 946], [1376, 975],
  [768, 1024], [1024, 768], [744, 1133], [1133, 744],
  [810, 1080], [1080, 810], [820, 1180], [1180, 820],
  [834, 1112], [1112, 834], [834, 1194], [1194, 834],
  [1024, 1366], [1366, 1024], [800, 1280], [1280, 800],
  [753, 1205], [1205, 753], [800, 1340], [1340, 800],
  [962, 601], [601, 962], [600, 960], [960, 600],
  [600, 1024], [1024, 600], [800, 1232], [1232, 800],
  [853, 1280], [1280, 853], [800, 1216], [1216, 800],
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
const orderFlow = createOrderFlow({
  supabase,
  state: s,
  render: () => render(),
  toast,
  money,
  esc,
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
  const { data: profile, error } = await supabase
    .from("accounts")
    .select("auth_user_id,role_id,username,display_name,location_id,roles!inner(key,name)")
    .eq("auth_user_id", user.id)
    .single();
  if (error || !profile)
    throw new Error(
      "La cuenta no tiene un perfil de Kffe’to. Contacta al administrador.",
    );
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
  s.role = profile.roles?.key === "admin" ? "Administrador" : "Empleado";
  s.roleKey = profile.roles?.key || "employee";
  s.roleId = profile.role_id;
  s.roleLabel = profile.roles?.name || s.role;
  s.site = site;
  s.authUserId = profile.auth_user_id;
  s.locationId = profile.location_id;
  await restaurantSettings.load();
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
    const { data: access, error: accessError } = await supabase.functions.invoke("restaurant-access", { body: {} });
    if (accessError || !access?.active) {
      s.restaurantSuspended = !accessError && access?.active === false;
      await supabase.auth.signOut();
      render();
      if (!s.restaurantSuspended) throw new Error("La cuenta no está vinculada a un restaurante activo.");
      return;
    }
    s.restaurantId = access.restaurant_id;
    await loadAuthenticatedProfile(data.user);
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
      const { data: access, error } = await supabase.functions.invoke("restaurant-access", { body: {} });
      if (!error && access?.active === false) {
        s.restaurantSuspended = true;
        await supabase.auth.signOut();
      } else if (error || !access?.active) {
        await supabase.auth.signOut();
      } else {
        s.restaurantId = access.restaurant_id;
        await loadAuthenticatedProfile(session.user);
      }
    } catch {
      await supabase.auth.signOut();
    }
  }
  render();
  if (s.user) orderFlow.enter(s.page);
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && s.user) {
      orderFlow.cleanup();
      s.user = null;
      s.authUserId = null;
      s.locationId = null;
      s.current = null;
      s.orders = [];
      s.draft = { items: [], note: "" };
      render();
    }
  });
}
// Genera los botones de navegación según el rol y la vista actual.
function nav(m) {
  let list = [
    ["account", "", "Cuenta"],
    ["stats", "", "Estadísticas"],
    ["orders", "＋", m ? "Pedidos" : "Flujo de pedidos"],
  ];
  if (s.role === "Administrador") list.push(["catalog", "▤", "Catálogo"]);
  if (s.role === "Administrador") list.push(["settings", "⚙", "Configuración"]);
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
  }[s.page];
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
    '<div class="shell"><aside class="sidebar"><div class="sidebar-brand"><img src="/assets/black-white-icon.svg" alt=""><div><div class="sidebar-brand-name">BLACK&WHITE POS</div><div class="sidebar-brand-sub">ESPACIO DE TRABAJO</div></div></div><div><div class="nav-label">Espacio de trabajo</div><nav class="nav">' +
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
    '</div></div></div></aside><main class="work"><header class="topbar"><div class="mobile-brand"><img src="/assets/black-white-icon.svg" alt=""><span>BLACK&WHITE POS</span></div><div><div class="top-title">' +
    title() +
    '</div><div class="top-sub"><span>' +
    shownLabel +
    '</span></div></div><div class="top-right">' +
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
  if (!supabase || (s.role !== "Administrador" && s.role !== "Empleado"))
    return;
  s.accountsLoading = true;
  s.accountsError = "";
  const today = limaToday();
  if (s.role === "Administrador" && !s.accountDate) s.accountDate = today;
  render();
  const [accountsResult, locationsResult, schedulesResult, rolesResult, notesResult] = await Promise.all([
    supabase.from("accounts").select("auth_user_id,username,display_name,role_id,location_id,roles!inner(key,name),locations(name)").eq("is_active", true).order("display_name"),
    supabase.from("locations").select("id,name").eq("is_active", true).order("name"),
    supabase.from("account_schedules").select("auth_user_id,weekday,starts_at,ends_at"),
    supabase.from("roles").select("id,key,name,permissions").order("name"),
    supabase.from("employee_notes").select("auth_user_id,note,updated_at").eq("restaurant_id", s.restaurantId),
  ]);
  s.accountsLoading = false;
  if (accountsResult.error || locationsResult.error) {
    s.accountsError =
      "No se pudieron cargar las cuentas. Revisa la conexión y los permisos.";
    s.accounts = [];
    s.locations = [];
    render();
    return;
  }
  const scheduleByUser = new Map();
  for (const item of schedulesResult.data || []) {
    const list = scheduleByUser.get(item.auth_user_id) || [];
    list.push(item);
    scheduleByUser.set(item.auth_user_id, list);
  }
  s.accounts = (accountsResult.data || []).map((a) => ({
    auth_user_id: a.auth_user_id,
    username: a.username,
    display_name: a.display_name,
    role: a.roles?.key || "employee",
    role_name: a.roles?.name || "Empleado",
    location_id: a.location_id,
    site: a.locations?.name || "Todas las sedes",
    attendance: false,
    attendance_location: "",
    schedules: scheduleByUser.get(a.auth_user_id) || [],
  }));
  s.locations = locationsResult.data || [];
  s.availableRoles = rolesResult.data || [];
  s.employeeNotes = notesResult.data || [];
  s.accountDataDates = [today];
  render();
}
// Genera la vista de administración de cuentas y asistencia.
function account() {
  const emp = s.role === "Empleado",
    list = s.accounts,
    adminCount = list.filter((a) => a.role === "admin").length,
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
        role = a.role_name || (a.role === "admin" ? "Administrador" : "Empleado"),
        canDelete =
          !isHistorical &&
          s.role === "Administrador" &&
          (a.role !== "admin" || self),
        deleteDisabled = self && adminCount < 2,
        attendanceAction =
          !isHistorical &&
          !a.attendance &&
          (s.role === "Administrador" || !self)
            ? '<button class="rowaction" data-mark-attendance="' +
              a.auth_user_id +
              '">Marcar presente</button>'
            : "",
        editAction =
          !isHistorical && s.role === "Administrador"
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
        attendanceText = a.attendance
          ? (isHistorical ? "Vino ese día" : "Presente") +
            (a.attendance_location ? " · " + esc(a.attendance_location) : "")
          : "Pendiente";
      return (
        '<tr><td><div class="personcell"><span class="mini">' +
        esc(initials) +
        "</span><span><strong>" +
        esc(a.display_name) +
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
        (a.attendance ? "present-badge" : "") +
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
    list.filter((a) => a.attendance).length +
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
    `</section>${emp ? `<section class="panel personal-note-panel"><div class="panel-head"><div><div class="panel-title">Mi nota del mes</div><div class="meta">Anota información útil para el cierre de mes.</div></div><button class="btn secondary" id="save-employee-note">Guardar nota</button></div><textarea id="employee-note" maxlength="5000" placeholder="Escribe una nota para recordar…">${esc((s.employeeNotes || []).find((x) => x.auth_user_id === s.authUserId)?.note || "")}</textarea><div class="meta">${esc((s.employeeNotes || []).find((x) => x.auth_user_id === s.authUserId)?.updated_at ? `Última edición: ${formatDateLong(limaToday())}` : "Aún no hay una nota guardada.")}</div></section>` : s.role === "Administrador" ? `<section class="panel personal-note-panel"><div class="panel-head"><div><div class="panel-title">Notas del equipo</div><div class="meta">Notas personales que cada empleado mantiene para el cierre de mes.</div></div></div><div class="notes-team-list">${list.filter((a) => a.role !== "admin").map((a) => { const note = (s.employeeNotes || []).find((x) => x.auth_user_id === a.auth_user_id)?.note; return `<div class="notes-team-row"><strong>${esc(a.display_name)}</strong><span class="roletag employeetag">${esc(a.role_name)}</span><p>${note ? esc(note) : '<span class="meta">Sin nota registrada</span>'}</p></div>`; }).join("") || '<div class="empty">No hay empleados.</div>'}</div></section>` : ""}`
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
// Abre el formulario para editar una cuenta existente.
function editAccountDialog(account) {
  const d = document.createElement("dialog");
  d.className = "password-dialog account-dialog";
  const isAdmin = account.role === "admin";
  const roleOptions = (s.availableRoles || []).map((r) => '<option value="' + esc(r.key) + '" ' + (r.key === account.role ? "selected" : "") + '>' + esc(r.name) + "</option>").join("");
  d.innerHTML =
    '<form method="dialog"><div class="panel-title">Editar cuenta</div><label class="dialog-label">Nombre visible<input name="display_name" maxlength="100" required value="' +
    esc(account.display_name) +
    '"></label><label class="dialog-label">Tipo de cuenta<select name="role" id="edit-account-role">' + roleOptions + '</select></label><label class="dialog-label" id="edit-account-location-wrap">Sede<select name="location_id" id="edit-account-location">' +
    s.locations
      .map(
        (l) =>
          '<option value="' +
          l.id +
          '" ' +
          (l.id === account.location_id ? "selected" : "") +
          ">" +
          esc(l.name) +
          "</option>",
      )
      .join("") +
    '</select></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="save-account" value="save">Guardar cambios</button></div></form>';
  document.body.appendChild(d);
  const f = d.querySelector("form"),
    role = f.querySelector("#edit-account-role"),
    wrap = f.querySelector("#edit-account-location-wrap"),
    site = f.querySelector("#edit-account-location"),
    save = f.querySelector("#save-account");
  const updateFields = () => {
    wrap.hidden = role.value === "admin";
    site.required = role.value !== "admin";
  };
  role.addEventListener("change", updateFields);
  updateFields();
  d.showModal();
  f.addEventListener("submit", async (e) => {
    if (e.submitter?.id !== "save-account") return;
    e.preventDefault();
    const err = f.querySelector(".password-error"),
      name = new FormData(f).get("display_name").trim();
    err.textContent = "";
    if (!name) {
      err.textContent = "Escribe el nombre de la cuenta.";
      return;
    }
    save.disabled = true;
    try {
      const { data, error } = await supabase.functions.invoke("staff-admin", {
        body: {
          action: "update",
          auth_user_id: account.auth_user_id,
          display_name: name,
          role: role.value,
          location_id: role.value !== "admin" ? site.value : null,
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
// Abre el diálogo para registrar la asistencia de una cuenta.
function markAttendanceDialog(account) {
  const d = document.createElement("dialog");
  d.className = "password-dialog";
  d.innerHTML =
    '<form method="dialog"><div class="panel-title">Asistencia de administrador</div><p class="meta">Elige la sede a la que asistió hoy. Se registrará una sola sede para esta fecha.</p><label class="dialog-label">Sede<select name="location_id" required>' +
    s.locations
      .map(
        (l, i) =>
          '<option value="' +
          l.id +
          '" ' +
          (i === 0 ? "selected" : "") +
          ">" +
          esc(l.name) +
          "</option>",
      )
      .join("") +
    '</select></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="confirm-admin-attendance" value="save">Marcar asistencia</button></div></form>';
  document.body.appendChild(d);
  const f = d.querySelector("form");
  d.showModal();
  f.addEventListener("submit", async (e) => {
    if (e.submitter?.id !== "confirm-admin-attendance") return;
    e.preventDefault();
    const btn = f.querySelector("#confirm-admin-attendance"),
      err = f.querySelector(".password-error"),
      locationId = new FormData(f).get("location_id");
    btn.disabled = true;
    const { error } = await supabase.rpc("mark_attendance", {
      p_staff_profile_id: account.auth_user_id,
      p_location_id: locationId,
    });
    btn.disabled = false;
    if (error) {
      err.textContent =
        error.code === "23505"
          ? "La asistencia ya fue marcada hoy."
          : error.message || "No se pudo marcar la asistencia.";
      return;
    }
    d.close();
    await loadAccounts();
    toast(
      "Asistencia marcada en " +
        s.locations.find((x) => x.id === locationId)?.name +
        ".",
    );
  });
  d.addEventListener("close", () => d.remove());
}
// Guarda o actualiza la asistencia de un miembro del personal.
async function markAttendance(staffId) {
  const account = s.accounts.find((a) => a.auth_user_id === staffId);
  if (!account) return;
  if (s.role === "Administrador" && account.role === "admin") {
    if (!s.locations.length) {
      toast("Primero crea una sede.");
      return;
    }
    markAttendanceDialog(account);
    return;
  }
  const { error } = await supabase.rpc("mark_attendance", {
    p_staff_profile_id: staffId,
    p_location_id: account.location_id,
  });
  if (error) {
    toast(
      error.code === "23505"
        ? "La asistencia ya fue marcada hoy."
        : error.message || "No se pudo marcar la asistencia.",
    );
    return;
  }
  await loadAccounts();
  toast("Asistencia marcada.");
}
// Abre el formulario para crear una nueva cuenta de personal.
function createAccountDialog() {
  const d = document.createElement("dialog");
  d.className = "password-dialog account-dialog";
  const roleOptions = (s.availableRoles || []).map((r) => '<option value="' + esc(r.key) + '">' + esc(r.name) + "</option>").join("");
  d.innerHTML =
    '<form method="dialog"><div class="panel-title">Crear cuenta</div><p class="meta">La persona iniciará sesión con el usuario y la contraseña que asignes.</p><label class="dialog-label">Nombre completo<input name="display_name" maxlength="100" required autocomplete="name" placeholder="Ej. Ana Morales"></label><label class="dialog-label">Nombre de usuario<input name="username" maxlength="49" required autocomplete="off" placeholder="Ej. ana.morales"><span class="meta">Sin espacios; se guardará en minúsculas y sin tildes.</span></label><label class="dialog-label">Tipo de cuenta<select name="role" id="new-account-role">' + roleOptions + '</select></label><label class="dialog-label" id="new-account-location-wrap">Sede<select name="location_id" id="new-account-location">' +
    s.locations
      .map(
        (l, i) =>
          '<option value="' +
          l.id +
          '" ' +
          (i === 0 ? "selected" : "") +
          ">" +
          esc(l.name) +
          "</option>",
      )
      .join("") +
    '</select><span class="meta" id="no-locations-message" ' +
    (s.locations.length ? "hidden" : "") +
    '>Primero crea una sede con “Gestionar sedes”.</span></label><label class="dialog-label">Contraseña inicial<input name="password" type="password" minlength="10" required autocomplete="new-password" placeholder="Mínimo 10 caracteres"></label><label class="dialog-label">Horarios de trabajo<div id="work-schedule-rows"><div class="schedule-row"><select name="workday"><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option></select><input type="time" name="workstart"><input type="time" name="workend"></div></div><button type="button" class="btn small" id="add-work-schedule">＋ Agregar horario</button></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="submit-new-account" value="save" ' +
    (s.locations.length ? "" : "disabled") +
    ">Crear cuenta</button></div></form>";
  document.body.appendChild(d);
  const form = d.querySelector("form"),
    role = form.querySelector("#new-account-role"),
    locationWrap = form.querySelector("#new-account-location-wrap"),
    locationSelect = form.querySelector("#new-account-location"),
    submit = form.querySelector("#submit-new-account");
  const syncRole = () => {
    const employee = role.value !== "admin";
    locationWrap.hidden = !employee;
    submit.disabled = employee && !s.locations.length;
  };
  role.addEventListener("change", syncRole);
  form.querySelector("#add-work-schedule").addEventListener("click", () => form.querySelector("#work-schedule-rows").insertAdjacentHTML("beforeend", form.querySelector("#work-schedule-rows .schedule-row").outerHTML));
  if (!s.locations.length) {
    locationSelect.disabled = true;
    locationWrap.hidden = false;
  }
  syncRole();
  d.showModal();
  form.addEventListener("submit", async (e) => {
    if (!e.submitter || e.submitter.id !== "submit-new-account") return;
    e.preventDefault();
    const data = new FormData(form),
      error = form.querySelector(".password-error"),
      username = normalizeUsername(data.get("username"));
    error.textContent = "";
    if (!/^[a-z0-9._-]{1,49}$/.test(username)) {
      error.textContent =
        "El usuario debe tener hasta 49 caracteres: letras, números, punto, guion o guion bajo.";
      return;
    }
    if (role.value !== "admin" && !data.get("location_id")) {
      error.textContent = "Crea o selecciona una sede para el empleado.";
      return;
    }
    const workdays = [...form.querySelectorAll('[name="workday"]')], workstarts = [...form.querySelectorAll('[name="workstart"]')], workends = [...form.querySelectorAll('[name="workend"]')], schedules = workdays.map((x, i) => ({ weekday: Number(x.value), starts_at: workstarts[i].value, ends_at: workends[i].value })).filter(x => x.starts_at && x.ends_at);
    if (role.value !== "admin" && (!schedules.length || schedules.length !== workdays.length)) { error.textContent = "Asigna entrada y salida a cada horario del empleado."; return; }
    submit.disabled = true;
    try {
      const { data: result, error: invokeError } =
        await supabase.functions.invoke("staff-admin", {
          body: {
            action: "create",
            display_name: data.get("display_name"),
            username,
            role: role.value,
            location_id:
              role.value !== "admin" ? data.get("location_id") : null,
            password: data.get("password"),
            schedules,
          },
        });
      if (invokeError)
        throw new Error(
          (await invokeError.context?.json?.())?.error ||
            invokeError.message ||
            "No se pudo crear la cuenta.",
        );
      if (result?.error) throw new Error(result.error);
      d.close();
      await loadAccounts();
      toast("Cuenta creada correctamente.");
    } catch (err) {
      error.textContent = err.message || "No se pudo crear la cuenta.";
    } finally {
      if (submit.isConnected)
        submit.disabled = role.value !== "admin" && !s.locations.length;
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
          '<div class="location-row"><strong>' +
          esc(l.name) +
          '</strong><span class="location-actions"><button type="button" class="rowaction" data-rename-location="' +
          l.id +
          '">Renombrar</button><button type="button" class="rowaction danger-action" data-delete-location="' +
          l.id +
          '">Eliminar</button></span></div>',
      )
      .join("");
    d.innerHTML =
      '<form method="dialog"><div class="panel-title">Gestionar sedes</div><p class="meta">Las sedes con cuentas o historial asociado no se pueden eliminar.</p><div class="location-list">' +
      (rows || '<div class="empty">Aún no hay sedes.</div>') +
      '</div><div class="dialog-actions"><button class="btn secondary" value="close">Cerrar</button><button type="button" class="btn primary" id="open-create-location">＋ Crear sede</button></div></form>';
    d.querySelector("#open-create-location").onclick = () =>
      createLocationDialog();
    d.querySelectorAll("[data-rename-location]").forEach(
      (b) =>
        (b.onclick = () => {
          const l = s.locations.find((x) => x.id === b.dataset.renameLocation);
          if (l) renameLocationDialog(l);
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
// Abre el formulario para crear una nueva sede.
function createLocationDialog() {
  const d = document.createElement("dialog");
  d.className = "password-dialog";
  d.innerHTML =
    '<form method="dialog"><div class="panel-title">Crear sede</div><label class="dialog-label">Nombre de la sede<input name="name" maxlength="80" required placeholder="Ej. Centro"></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="add-location" value="save">Crear sede</button></div></form>';
  document.body.appendChild(d);
  const f = d.querySelector("form");
  d.showModal();
  f.addEventListener("submit", async (e) => {
    if (e.submitter?.id !== "add-location") return;
    e.preventDefault();
    const name = new FormData(f).get("name").trim(),
      err = f.querySelector(".password-error"),
      btn = f.querySelector("#add-location");
    if (!name) {
      err.textContent = "Escribe el nombre de la sede.";
      return;
    }
    btn.disabled = true;
    const { error } = await supabase.from("locations").insert({ name, restaurant_id: s.restaurantId });
    btn.disabled = false;
    if (error) {
      err.textContent =
        error.code === "23505"
          ? "Ya existe una sede con ese nombre."
          : "No se pudo crear la sede.";
      return;
    }
    d.close();
    const manager = document.querySelector("dialog.account-dialog");
    if (manager?.open) manager.close();
    await loadAccounts();
    toast("Sede creada.");
    manageLocationsDialog();
  });
  d.addEventListener("close", () => d.remove());
}
// Abre el formulario para cambiar el nombre de una sede.
function renameLocationDialog(location) {
  const d = document.createElement("dialog");
  d.className = "password-dialog";
  d.innerHTML =
    '<form method="dialog"><div class="panel-title">Renombrar sede</div><label class="dialog-label">Nombre<input name="name" maxlength="80" required value="' +
    esc(location.name) +
    '"></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="save-location-name" value="save">Guardar nombre</button></div></form>';
  document.body.appendChild(d);
  const f = d.querySelector("form");
  d.showModal();
  f.addEventListener("submit", async (e) => {
    if (e.submitter?.id !== "save-location-name") return;
    e.preventDefault();
    const name = new FormData(f).get("name").trim(),
      err = f.querySelector(".password-error"),
      btn = f.querySelector("#save-location-name");
    if (!name) {
      err.textContent = "Escribe el nombre de la sede.";
      return;
    }
    btn.disabled = true;
    const { error } = await supabase
      .from("locations")
      .update({ name })
      .eq("id", location.id);
    btn.disabled = false;
    if (error) {
      err.textContent =
        error.code === "23505"
          ? "Ya existe una sede con ese nombre."
          : "No se pudo renombrar la sede.";
      return;
    }
    d.close();
    const manager = document.querySelector("dialog.account-dialog");
    if (manager?.open) manager.close();
    await loadAccounts();
    toast("Sede renombrada.");
    manageLocationsDialog();
  });
  d.addEventListener("close", () => d.remove());
}
// Elimina una sede después de validar que la operación sea posible.
async function deleteLocation(location) {
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
    adminCount = s.accounts.filter((a) => a.role === "admin").length;
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
      render();
      return;
    }
    await loadAccounts();
    toast("Acceso eliminado; el historial permanece.");
  });
  d.addEventListener("close", () => d.remove());
}

// Procesa el cambio de contraseña de la cuenta actual.
function changePassword() {
  const d = document.createElement("dialog");
  d.className = "password-dialog";
  d.innerHTML =
    '<form method="dialog"><div class="panel-title">Cambiar contraseña</div><p class="meta">Confirma tu contraseña actual y escribe una nueva.</p><label class="dialog-label">Contraseña actual<input name="old" type="password" required autocomplete="current-password"></label><label class="dialog-label">Contraseña nueva<input name="next" type="password" required autocomplete="new-password"></label><label class="dialog-label">Repite la contraseña nueva<input name="confirm" type="password" required autocomplete="new-password"></label><p class="password-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" id="save-password" value="save">Guardar</button></div></form>';
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
      d.close();
      toast("Contraseña actualizada.");
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
    root.innerHTML = '<main class="login"><section class="login-card" style="max-width:760px;padding:64px 36px"><img src="/assets/black-white-logo.svg" alt="Black&White POS" style="width:min(320px,80%);margin-bottom:38px"><div class="eyebrow">Acceso no disponible</div><h1 style="font-size:clamp(30px,6vw,58px);margin:14px 0">Tu restaurante ha sido dado de baja</h1><p>Contacta con el equipo de Black&amp;White para revisar el estado de tu servicio.</p></section></main>';
    return;
  }
  if (s.page === "catalog" && s.role !== "Administrador") s.page = "orders";
  applyDeviceClasses();
  let root = $("#app");
  root.innerHTML = s.user ? shell() : login();
  bind();
  requestAnimationFrame(adaptNewOrderButton);
}
function primaryDeviceKind() {
  if (deviceFormFactors?.includes("Tablet")) return "tablet";
  if (deviceFormFactors?.includes("Mobile")) return "mobile";
  if (deviceFormFactors?.includes("Desktop")) return "desktop";

  const ua = navigator.userAgent || "";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "tablet";
  if (/iPhone|iPod|Windows Phone/i.test(ua)) return "mobile";

  const android = /Android/i.test(ua);
  const tabletModel = /\b(?:SM-T|SM-X|Lenovo TB|Pixel Tablet|MatePad|MediaPad|Nexus 7|Nexus 10|Tab\s)/i.test(ua);
  if (android && tabletModel) return "tablet";
  if (navigator.userAgentData?.mobile === true || /Android.*Mobile/i.test(ua)) return "mobile";
  if (android && !/Mobile/i.test(ua)) return "tablet";

  // Touch-capable desktop-class devices are ambiguous; try the resolution fallback.
  const mayBeTablet = navigator.maxTouchPoints > 0 || matchMedia("(any-pointer: coarse)").matches;
  return mayBeTablet ? null : "desktop";
}
function isTabletResolution() {
  const touchCapable = navigator.maxTouchPoints > 0 || matchMedia("(any-pointer: coarse)").matches;
  const tabletLikeDensity = window.devicePixelRatio >= 1.5;
  if (!touchCapable && !tabletLikeDensity) return false;
  const sizes = [[screen.width, screen.height], [innerWidth, innerHeight]];
  const tolerance = 24;
  return sizes.some(([width, height]) => width > 0 && height > 0 &&
    TABLET_RESOLUTION_FALLBACK.some(([tabletWidth, tabletHeight]) =>
      Math.abs(width - tabletWidth) <= tolerance && Math.abs(height - tabletHeight) <= tolerance
    )
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
  if (!head || !button || !document.body.classList.contains("device-mobile")) return;

  const text = head.firstElementChild;
  const probe = text.cloneNode(true);
  Object.assign(probe.style, { position: "absolute", visibility: "hidden", width: "min-content", flex: "none", inset: "0 auto auto 0" });
  head.append(probe);
  const minimumTextWidth = probe.getBoundingClientRect().width;
  probe.remove();
  const gap = parseFloat(getComputedStyle(head).columnGap) || 12;
  const availableWidth = head.clientWidth;

  button.classList.remove("new-order-mode-single", "new-order-mode-stacked", "new-order-mode-icon");
  button.classList.add("new-order-mode-single");
  if (minimumTextWidth + gap + button.getBoundingClientRect().width <= availableWidth) return;
  button.classList.replace("new-order-mode-single", "new-order-mode-stacked");
  if (minimumTextWidth + gap + button.getBoundingClientRect().width <= availableWidth) return;
  button.classList.replace("new-order-mode-stacked", "new-order-mode-icon");
}
// Vincula los eventos de interacción de la vista actual.
function bind() {
  document.querySelectorAll("[data-page]").forEach(
    (b) =>
      (b.onclick = () => {
        s.page = b.dataset.page;
        render();
        orderFlow.enter(s.page);
        if (s.page === "account") loadAccounts();
        if (s.page === "stats") statistics.enter();
        if (s.page === "settings") restaurantSettings.load().then(() => render());
      }),
  );
  $("#login-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitLogin();
  });
  $("#logout")?.addEventListener("click", async () => {
    orderFlow.cleanup();
    if (supabase) await supabase.auth.signOut();
    s.user = null;
    s.authUserId = null;
    s.locationId = null;
    s.current = null;
    s.orders = [];
    s.draft = { items: [], note: "" };
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
  if (s.page === "account") {
    $("#save-employee-note")?.addEventListener("click", async () => {
      const button = $("#save-employee-note");
      button.disabled = true;
      const result = await supabase.from("employee_notes").upsert({ auth_user_id: s.authUserId, restaurant_id: s.restaurantId, note: $("#employee-note").value, updated_at: new Date().toISOString() }, { onConflict: "auth_user_id" });
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
      (b) => (b.onclick = () => markAttendance(b.dataset.markAttendance)),
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
