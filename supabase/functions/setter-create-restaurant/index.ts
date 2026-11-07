import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const normalize = (s: string) => s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const baseEmail = Deno.env.get("AUTH_EMAIL_BASE")?.toLowerCase();
  if (!baseEmail || !baseEmail.includes("@")) return reply(500, { error: "server_auth_email_not_configured" });
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "authentication_required" });
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error: userError } = await caller.auth.getUser(token);
  if (userError || !user) return reply(401, { error: "invalid_session" });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: operator } = await admin.from("platform_operators").select("auth_user_id").eq("auth_user_id", user.id).maybeSingle();
  if (!operator) return reply(403, { error: "platform_operator_required" });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  const name = String(body.name ?? "").trim();
  const kind = String(body.kind ?? "Restaurante").trim();
  const city = String(body.city ?? "").trim();
  const architectureId = String(body.architecture_id ?? "");
  const username = normalize(String(body.initial_username ?? ""));
  const displayName = String(body.initial_display_name ?? "Administrador").trim();
  const password = String(body.initial_password ?? "");
  const needs = Array.isArray(body.needs) ? body.needs.map(String) : [];
  const configuration = body.configuration && typeof body.configuration === "object" ? body.configuration : {};
  if (!name || !architectureId || !/^[a-z0-9._-]{1,49}$/.test(username) || password.length < 10 || !displayName)
    return reply(400, { error: "name_architecture_username_display_name_and_password_required", password_min_length: 10 });
  const { data: architecture, error: archError } = await admin.from("architectures").select("id,version,role_templates,allowed_features").eq("id", architectureId).maybeSingle();
  if (archError || !architecture) return reply(400, { error: "unknown_architecture" });
  const allowed = new Set(architecture.allowed_features as string[]);
  if (needs.some((key) => !allowed.has(key))) return reply(400, { error: "architecture_does_not_support_selected_need" });
  const roles = architecture.role_templates as Array<{key:string;name:string;permissions?:Record<string,unknown>}>;
  if (!roles.some((r) => r.key === "admin")) return reply(400, { error: "architecture_missing_admin_role" });
  const [local, domain] = baseEmail.split("@");
  const email = `${local}+k-${username}@${domain}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { account_type: "restaurant", username } });
  if (createError || !created.user) return reply(409, { error: createError?.message ?? "auth_user_creation_failed" });
  const { data: restaurantId, error: bundleError } = await admin.rpc("create_restaurant_bundle", {
    payload: { name, kind, city, architecture_id: architecture.id, architecture_version: architecture.version,
      needs, configuration, roles, initial_auth_user_id: created.user.id, initial_username: username,
      initial_display_name: displayName },
  });
  if (bundleError || !restaurantId) {
    await admin.auth.admin.deleteUser(created.user.id);
    return reply(400, { error: bundleError?.message ?? "restaurant_creation_failed" });
  }
  return reply(201, { restaurant_id: restaurantId, initial_username: username, role: "admin" });
});
