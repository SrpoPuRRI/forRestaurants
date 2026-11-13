export const DEFAULT_COLOR_THEMES = {
  light: {
    background: "#f4f1ea",
    surface: "#fffefa",
    surfaceAlt: "#f8f6f1",
    text: "#191a18",
    muted: "#77756f",
    border: "#e5e0d8",
    button: "#20211f",
    buttonText: "#fffefa",
    accent: "#b64b36",
    font: "DM Sans",
    fontSize: 14,
    buttonSize: "medium",
  },
  dark: {
    background: "#171816",
    surface: "#222320",
    surfaceAlt: "#1d1e1c",
    text: "#f1eee7",
    muted: "#aaa69d",
    border: "#393a35",
    button: "#927344",
    buttonText: "#fffefa",
    accent: "#d2765e",
    font: "DM Sans",
    fontSize: 14,
    buttonSize: "medium",
  },
};

export const ALLOWED_FONTS = [
  "DM Sans",
  "Manrope",
  "Lato",
  "Nunito Sans",
  "Montserrat",
  "Poppins",
];

const BUTTON_SIZES = {
  small: { padding: "9px 12px", font: "12px", radius: "9px" },
  medium: { padding: "12px 16px", font: "14px", radius: "11px" },
  large: { padding: "15px 20px", font: "16px", radius: "13px" },
};
const ALLOWED_FONT_SET = new Set(ALLOWED_FONTS);

export default function createAppearance({ state, supabase }) {
  const preferenceKey = "bw-personal-theme";

  function mode() {
    try {
      return localStorage.getItem(preferenceKey) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  function activeTheme() {
    const appearance = state.restaurantSettings?.appearance || {};
    const selected = appearance.color_schemes?.find(
      (scheme) => scheme.id === appearance.active_color_scheme_id,
    );
    const theme = { ...DEFAULT_COLOR_THEMES[mode()], ...(selected?.[mode()] || {}) };
    if (!ALLOWED_FONT_SET.has(theme.font)) theme.font = "DM Sans";
    return theme;
  }

  function apply() {
    const root = document.documentElement;
    const themeMode = mode();
    const theme = activeTheme();
    const size = BUTTON_SIZES[theme.buttonSize] || BUTTON_SIZES.medium;
    root.dataset.theme = themeMode;
    root.style.setProperty("--app-background", theme.background);
    root.style.setProperty("--white", theme.surface);
    root.style.setProperty("--surface-alt", theme.surfaceAlt);
    root.style.setProperty("--ink", theme.text);
    root.style.setProperty("--muted", theme.muted);
    root.style.setProperty("--line", theme.border);
    root.style.setProperty("--coffee", theme.button);
    root.style.setProperty("--dark", `color-mix(in srgb, ${theme.button} 82%, black)`);
    root.style.setProperty("--cream", `color-mix(in srgb, ${theme.button} 18%, ${theme.background})`);
    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--button-text", theme.buttonText);
    root.style.setProperty("--app-font-family", `"${theme.font}", system-ui, sans-serif`);
    root.style.setProperty("--app-font-size", `${Math.min(18, Math.max(12, Number(theme.fontSize) || 14))}px`);
    root.style.setProperty("--app-button-padding", size.padding);
    root.style.setProperty("--app-button-font-size", size.font);
    root.style.setProperty("--app-button-radius", size.radius);
    const toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.setAttribute("aria-label", themeMode === "light" ? "Cambiar a tema oscuro" : "Cambiar a tema claro");
      toggle.setAttribute("title", themeMode === "light" ? "Tema claro" : "Tema oscuro");
      toggle.innerHTML = themeMode === "light"
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.4A8.6 8.6 0 0 1 8.6 3.8 8.7 8.7 0 1 0 20.2 15.4Z"/></svg>';
    }
  }

  async function toggle() {
    if (supabase && state.restaurantId) {
      const { data, error } = await supabase
        .from("restaurants")
        .select("appearance")
        .eq("id", state.restaurantId)
        .single();
      if (!error && data) state.restaurantSettings = { ...(state.restaurantSettings || {}), appearance: data.appearance };
    }
    const next = mode() === "light" ? "dark" : "light";
    try {
      localStorage.setItem(preferenceKey, next);
    } catch {
      // Keep the current tab's theme even if browser storage is unavailable.
    }
    apply();
  }

  function buttonMarkup() {
    return '<button class="theme-toggle" id="theme-toggle" type="button" aria-label="Cambiar tema" title="Cambiar tema"></button>';
  }

  function bind() {
    document.getElementById("theme-toggle")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await toggle();
      } finally {
        button.disabled = false;
      }
    });
  }

  return { apply, bind, buttonMarkup, toggle, mode };
}
