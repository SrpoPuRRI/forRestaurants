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
  const { data: actor } = await admin.from("accounts").select("restaurant_id,role_id,is_active,restaurants!inner(status),roles!inner(key)").eq("auth_user_id", user.id).maybeSingle();
  if (!actor?.is_active || (actor.restaurants as any)?.status !== "active" || (actor.roles as any)?.key !== "admin")
    return reply(403, { error: "active_restaurant_admin_required" });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  const action = String(body.action ?? "");
  if (action === "create") {
    const username = normalize(String(body.username ?? ""));
    const displayName = String(body.display_name ?? "").trim();
    const password = String(body.password ?? "");
    const roleKey = String(body.role ?? "");
    if (!/^[a-z0-9._-]{1,49}$/.test(username) || !displayName || password.length < 10)
      return reply(400, { error: "valid_username_display_name_and_password_required_min_10" });
    let roleQuery = admin.from("roles").select("id,key,name").eq("restaurant_id", actor.restaurant_id);
    let { data: role } = await roleQuery.eq("key", roleKey).maybeSingle();
    if (!role && roleKey === "employee") {
      const { data: choices } = await admin.from("roles").select("id,key,name").eq("restaurant_id", actor.restaurant_id).neq("key", "admin").order("name").limit(1);
      role = choices?.[0] ?? null;
    }
    if (!role) return reply(400, { error: "role_not_enabled_for_restaurant" });
    const schedules = Array.isArray(body.schedules) ? body.schedules as Array<{weekday:number;starts_at:string;ends_at:string}> : [];
    if (role.key !== "admin" && (!schedules.length || schedules.some(s=>!Number.isInteger(Number(s.weekday))||Number(s.weekday)<0||Number(s.weekday)>6||!s.starts_at||!s.ends_at||s.starts_at>=s.ends_at)))
      return reply(400,{error:"employee_requires_valid_work_schedule"});
    const [local, domain] = baseEmail.split("@");
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `${local}+k-${username}@${domain}`, password, email_confirm: true,
      user_metadata: { account_type: "restaurant", username },
    });
    if (createError || !created.user) return reply(409, { error: createError?.message ?? "auth_user_creation_failed" });
    const { error: insertError } = await admin.from("accounts").insert({ auth_user_id: created.user.id,
      restaurant_id: actor.restaurant_id, role_id: role.id, username, display_name: displayName,
      location_id: body.location_id || null });
    if (insertError) { await admin.auth.admin.deleteUser(created.user.id); return reply(400, { error: insertError.message }); }
    if (schedules.length) {
      const { error: scheduleError } = await admin.from("account_schedules").insert(schedules.map(s=>({auth_user_id:created.user!.id,weekday:Number(s.weekday),starts_at:s.starts_at,ends_at:s.ends_at})));
      if (scheduleError) { await admin.auth.admin.deleteUser(created.user.id); return reply(400,{error:scheduleError.message}); }
    }
    const schedules = Array.isArray(body.schedules) ? body.schedules : [];
    if (schedules.length) {
      const rows = schedules.map((s: any) => ({ auth_user_id: created.user!.id, weekday: Number(s.weekday), starts_at: s.starts_at, ends_at: s.ends_at }));
      const { error: scheduleError } = await admin.from("account_schedules").insert(rows);
      if (scheduleError) { await admin.auth.admin.deleteUser(created.user.id); return reply(400, { error: scheduleError.message }); }
    }
    return reply(201, { auth_user_id: created.user.id, username, role: role.name });
  }
  const targetId = String(body.auth_user_id ?? "");
  const { data: target } = await admin.from("accounts").select("auth_user_id,restaurant_id,role_id,roles!inner(key)").eq("auth_user_id", targetId).eq("restaurant_id", actor.restaurant_id).maybeSingle();
  if (!target) return reply(404, { error: "account_not_found" });
  if (action === "delete") {
    if ((target.roles as any)?.key === "admin") {
      const { count } = await admin.from("accounts").select("auth_user_id", { count: "exact", head: true }).eq("restaurant_id", actor.restaurant_id).eq("is_active", true).eq("role_id", target.role_id);
      if ((count ?? 0) < 2) return reply(400, { error: "restaurant_must_keep_one_active_admin" });
    }
    const { error } = await admin.from("accounts").update({ is_active: false }).eq("auth_user_id", targetId);
    if (error) return reply(400, { error: error.message });
    await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
    return reply(200, { success: true });
  }
  if (action === "update") {
    const update: Record<string, unknown> = {};
    if (typeof body.display_name === "string") update.display_name = body.display_name.trim();
    if (typeof body.location_id !== "undefined") update.location_id = body.location_id || null;
    if (typeof body.role === "string" && body.role !== "employee") {
      const { data: role } = await admin.from("roles").select("id").eq("restaurant_id", actor.restaurant_id).eq("key", body.role).maybeSingle();
      if (!role) return reply(400, { error: "role_not_enabled_for_restaurant" });
      update.role_id = role.id;
    }
    const { error } = await admin.from("accounts").update(update).eq("auth_user_id", targetId);
    return error ? reply(400, { error: error.message }) : reply(200, { success: true });
  }
  return reply(400, { error: "unknown_action" });
});
