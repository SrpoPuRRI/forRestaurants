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
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "authentication_required" });
  const caller = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error: authError } = await caller.auth.getUser(token);
  if (authError || !user) return reply(401, { error: "invalid_session" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: operator, error: operatorError } = await caller.from("platform_operators").select("auth_user_id").eq("auth_user_id", user.id).maybeSingle();
  if (operatorError) {
    console.error("platform_operator_lookup_failed", operatorError.message);
    return reply(500, { error: "platform_operator_lookup_failed" });
  }
  if (!operator) {
    console.warn("platform_operator_not_authorized", user.id);
    return reply(403, { error: "platform_operator_required" });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  const action = String(body.action ?? "");
  const restaurantId = String(body.restaurant_id ?? "");
  if (action === "set_status") {
    if (!restaurantId || !["active", "deactivated"].includes(String(body.status))) return reply(400, { error: "invalid_status_request" });
    const { error } = await db.from("restaurants").update({ status: body.status, updated_at: new Date().toISOString() }).eq("id", restaurantId);
    return error ? reply(400, { error: error.message }) : reply(200, { success: true });
  }
  if (action === "create_account") {
    const username = normalize(String(body.username ?? ""));
    const displayName = String(body.display_name ?? "").trim();
    const password = String(body.password ?? "");
    const roleName = String(body.role_name ?? "");
    if (!restaurantId || !/^[a-z0-9._-]{1,49}$/.test(username) || !displayName || password.length < 10) return reply(400, { error: "valid_restaurant_username_name_and_password_required_min_10" });
    const { data: restaurant } = await db.from("restaurants").select("id,status").eq("id", restaurantId).maybeSingle();
    if (!restaurant || restaurant.status !== "active") return reply(400, { error: "restaurant_not_active" });
    const { data: role } = await db.from("roles").select("id,name,key").eq("restaurant_id", restaurantId).eq("name", roleName).maybeSingle();
    if (!role) return reply(400, { error: "role_not_enabled_for_restaurant" });
    const schedules = Array.isArray(body.schedules) ? body.schedules as Array<{weekday:number;starts_at:string;ends_at:string}> : [];
    if (role.key !== "admin" && (!schedules.length || schedules.some(s => !Number.isInteger(Number(s.weekday)) || Number(s.weekday)<0 || Number(s.weekday)>6 || !s.starts_at || !s.ends_at || s.starts_at>=s.ends_at)))
      return reply(400, { error: "employee_requires_valid_work_schedule" });
    const { data: location } = body.location_id ? await db.from("locations").select("id").eq("id", body.location_id).eq("restaurant_id", restaurantId).maybeSingle() : { data: null };
    if (body.location_id && !location) return reply(400, { error: "location_not_in_restaurant" });
    const baseEmail = Deno.env.get("AUTH_EMAIL_BASE")?.toLowerCase();
    if (!baseEmail || !baseEmail.includes("@")) return reply(500, { error: "server_auth_email_not_configured" });
    const [local, domain] = baseEmail.split("@");
    const { data: created, error: createError } = await db.auth.admin.createUser({ email: `${local}+k-${username}@${domain}`, password, email_confirm: true, user_metadata: { account_type: "restaurant", username } });
    if (createError || !created.user) return reply(409, { error: createError?.message ?? "auth_user_creation_failed" });
    const { error: insertError } = await db.from("accounts").insert({ auth_user_id: created.user.id, restaurant_id: restaurantId, role_id: role.id, username, display_name: displayName, location_id: location?.id ?? null });
    if (insertError) { await db.auth.admin.deleteUser(created.user.id); return reply(400, { error: insertError.message }); }
    if (schedules.length) {
      const { error } = await db.from("account_schedules").insert(schedules.map(s => ({ auth_user_id: created.user!.id, weekday: Number(s.weekday), starts_at: s.starts_at, ends_at: s.ends_at })));
      if (error) { await db.auth.admin.deleteUser(created.user.id); return reply(400, { error: error.message }); }
    }
    return reply(201, { auth_user_id: created.user.id, username, role: role.name });
  }
  if (action === "delete_account") {
    const accountId = String(body.auth_user_id ?? "");
    const { data: target } = await db.from("accounts").select("auth_user_id,role_id,roles!inner(key)").eq("auth_user_id", accountId).eq("restaurant_id", restaurantId).maybeSingle();
    if (!target) return reply(404,{error:"account_not_found"});
    if ((target.roles as any)?.key === "admin") {
      const { count } = await db.from("accounts").select("auth_user_id", { count:"exact", head:true }).eq("restaurant_id",restaurantId).eq("is_active",true).eq("role_id",target.role_id);
      if ((count ?? 0) < 2) return reply(400,{error:"restaurant_must_keep_one_active_admin"});
    }
    const { error } = await db.from("accounts").update({ is_active: false }).eq("auth_user_id", accountId).eq("restaurant_id", restaurantId);
    if (error) return reply(400, { error: error.message });
    await db.auth.admin.updateUserById(accountId, { ban_duration: "876000h" });
    return reply(200, { success: true });
  }
  return reply(400, { error: "unknown_action" });
});
