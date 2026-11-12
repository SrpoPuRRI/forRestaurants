import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const normalize = (s: string) => s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

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
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // The Edge Function also creates a caller client with the operator JWT.
    // Pin this client's Authorization header so Storage always uses service_role.
    global: { headers: { Authorization: `Bearer ${serviceKey}` } },
  });
  const authBaseEmail = Deno.env.get("AUTH_EMAIL_BASE")?.toLowerCase();
  const authEmailDomain = authBaseEmail?.includes("@") ? authBaseEmail.split("@")[1] : undefined;
  const archiveInactiveUsername = async (username: string) => {
    const { data: previous, error } = await db.from("accounts").select("auth_user_id")
      .eq("username", username).eq("is_active", false);
    if (error) return error.message;
    if (!authEmailDomain) return previous?.length ? "server_auth_email_not_configured" : null;
    for (const account of previous || []) {
      const { error: authError } = await db.auth.admin.updateUserById(account.auth_user_id, {
        email: `inactive-${account.auth_user_id}@${authEmailDomain}`, email_confirm: true, ban_duration: "876000h",
      });
      if (authError) return authError.message;
    }
    return null;
  };
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
  let logo: File | null = null;
  try {
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      body = Object.fromEntries([...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      const candidate = form.get("logo");
      if (candidate instanceof File && candidate.size > 0) logo = candidate;
    } else {
      body = await req.json();
    }
  } catch { return reply(400, { error: "invalid_request_body" }); }
  const action = String(body.action ?? "");
  const restaurantId = String(body.restaurant_id ?? "");
  if (action === "logo_urls") {
    const ids = [...new Set(Array.isArray(body.restaurant_ids) ? body.restaurant_ids.map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [])];
    if (!ids.length) return reply(200, { logos: {} });
    const { data: rows, error } = await db.from("restaurants").select("id,logo_path").in("id", ids);
    if (error) return reply(400, { error: error.message });
    const paths = (rows || []).map((row) => row.logo_path).filter((path): path is string => typeof path === "string" && ids.some((id) => path.startsWith(`${id}/`)));
    if (!paths.length) return reply(200, { logos: {} });
    const { data: signed, error: signError } = await db.storage.from("restaurant-assets").createSignedUrls(paths, 3600);
    if (signError) return reply(400, { error: signError.message });
    const byPath = new Map((signed || []).map((item) => [item.path, item.signedUrl]));
    return reply(200, { logos: Object.fromEntries((rows || []).map((row) => [row.id, byPath.get(row.logo_path) || ""])) });
  }
  if (action === "update_restaurant") {
    const name = String(body.name ?? "").trim();
    const removeLogo = body.remove_logo === "true";
    if (!restaurantId || !name)
      return reply(400, { error: "invalid_restaurant_details" });
    if (logo && (!LOGO_MIME_TYPES.has(logo.type) || logo.size > MAX_LOGO_BYTES)) return reply(400, { error: "logo_must_be_png_jpeg_webp_or_svg_under_5mb" });
    if (logo && removeLogo) return reply(400, { error: "choose_logo_or_remove_logo" });
    const { data: current, error: readError } = await db.from("restaurants").select("id,logo_path").eq("id", restaurantId).maybeSingle();
    if (readError || !current) return reply(404, { error: readError?.message || "restaurant_not_found" });
    let logoPath: string | null | undefined;
    if (logo) {
      logoPath = `${restaurantId}/logo/${crypto.randomUUID()}`;
      const { error: uploadError } = await db.storage.from("restaurant-assets").upload(logoPath, logo, { contentType: logo.type, cacheControl: "3600", upsert: false });
      if (uploadError) {
        console.error("setter_restaurant_logo_upload_failed", { restaurantId, code: uploadError.name, message: uploadError.message });
        return reply(400, { error: `logo_storage_upload_failed: ${uploadError.message}` });
      }
    } else if (removeLogo) {
      logoPath = null;
    }
    const update: Record<string, unknown> = { name, updated_at: new Date().toISOString() };
    if (logoPath !== undefined) update.logo_path = logoPath;
    const { error: updateError } = await db.from("restaurants").update(update).eq("id", restaurantId);
    if (updateError) {
      if (logoPath) await db.storage.from("restaurant-assets").remove([logoPath]);
      console.error("setter_restaurant_update_failed", { restaurantId, code: updateError.code, message: updateError.message });
      return reply(400, { error: `restaurant_update_failed: ${updateError.message}` });
    }
    if (current.logo_path && current.logo_path !== logoPath && (logo || removeLogo)) await db.storage.from("restaurant-assets").remove([current.logo_path]);
    return reply(200, { success: true, logo_path: logoPath === undefined ? current.logo_path : logoPath });
  }
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
    if (!restaurantId || !/^[a-z0-9._-]{1,49}$/.test(username) || !displayName || password.length < 6) return reply(400, { error: "valid_restaurant_username_name_and_password_required_min_6" });
    const { data: usernameMatch, error: usernameLookupError } = await db.from("accounts").select("auth_user_id").eq("username", username).eq("is_active", true).maybeSingle();
    if (usernameLookupError) return reply(500, { error: "username_lookup_failed" });
    if (usernameMatch) return reply(409, { error: "username_taken" });
    const archiveError = await archiveInactiveUsername(username);
    if (archiveError) return reply(500, { error: "inactive_username_archive_failed", detail: archiveError });
    const { data: restaurant } = await db.from("restaurants").select("id,status,available_role_ids").eq("id", restaurantId).maybeSingle();
    if (!restaurant || restaurant.status !== "active") return reply(400, { error: "restaurant_not_active" });
    const { data: role } = await db.from("roles").select("id,name,key").eq("name", roleName).maybeSingle();
    if (!role || !(restaurant.available_role_ids || []).includes(role.id)) return reply(400, { error: "role_not_enabled_for_restaurant" });
    const schedules = Array.isArray(body.schedules) ? body.schedules as Array<{weekday:number;starts_at:string;ends_at:string}> : [];
    const { data: location } = body.location_id ? await db.from("locations").select("id").eq("id", body.location_id).eq("restaurant_id", restaurantId).maybeSingle() : { data: null };
    if (role.key !== "admin" && (!body.location_id || !location || !schedules.length || schedules.some(s => !Number.isInteger(Number(s.weekday)) || Number(s.weekday)<0 || Number(s.weekday)>6 || !s.starts_at || !s.ends_at || s.starts_at>=s.ends_at)))
      return reply(400, { error: "employee_requires_valid_work_schedule" });
    if (role.key !== "admin") {
      const byDay = new Map<number, typeof schedules>();
      for (const schedule of schedules) byDay.set(Number(schedule.weekday), [...(byDay.get(Number(schedule.weekday)) || []), schedule]);
      for (const day of byDay.values()) {
        day.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        for (let index = 1; index < day.length; index++) if (day[index].starts_at < day[index - 1].ends_at)
          return reply(400, { error: "employee_work_schedules_overlap" });
      }
    }
    if (body.location_id && !location) return reply(400, { error: "location_not_in_restaurant" });
    const baseEmail = Deno.env.get("AUTH_EMAIL_BASE")?.toLowerCase();
    if (!baseEmail || !baseEmail.includes("@")) return reply(500, { error: "server_auth_email_not_configured" });
    const [local, domain] = baseEmail.split("@");
    const scheduleIds: string[] = [];
    for (const schedule of schedules) {
      const block = { weekday: Number(schedule.weekday), starts_at: schedule.starts_at, ends_at: schedule.ends_at };
      const { data: existing } = await db.from("account_schedules").select("id").eq("restaurant_id", restaurantId).match(block).maybeSingle();
      if (existing?.id) { scheduleIds.push(existing.id); continue; }
      const { data: inserted, error: scheduleError } = await db.from("account_schedules").insert({ restaurant_id: restaurantId, ...block }).select("id").single();
      if (scheduleError || !inserted?.id) return reply(400, { error: scheduleError?.message ?? "schedule_insert_failed" });
      scheduleIds.push(inserted.id);
    }
    const { data: created, error: createError } = await db.auth.admin.createUser({ email: `${local}+k-${username}@${domain}`, password, email_confirm: true, user_metadata: { account_type: "restaurant", username } });
    if (createError || !created.user) return reply(409, { error: createError?.message ?? "auth_user_creation_failed" });
    const { error: insertError } = await db.from("accounts").insert({ auth_user_id: created.user.id, restaurant_id: restaurantId, role_ids: [role.id], schedule_ids: scheduleIds, username, display_name: displayName, location_id: location?.id ?? null });
    if (insertError) { await db.auth.admin.deleteUser(created.user.id); return insertError.code === "23505" ? reply(409, { error: "username_taken" }) : reply(400, { error: insertError.message }); }
    return reply(201, { auth_user_id: created.user.id, username, role: role.name });
  }
  if (action === "delete_account") {
    const accountId = String(body.auth_user_id ?? "");
    const { data: target } = await db.from("accounts").select("auth_user_id,role_ids,is_active").eq("auth_user_id", accountId).eq("restaurant_id", restaurantId).maybeSingle();
    if (!target) return reply(404,{error:"account_not_found"});
    const { data: adminRole } = await db.from("roles").select("id").eq("key", "admin").maybeSingle();
    if (adminRole && (target.role_ids || []).includes(adminRole.id)) {
      const { data: admins } = await db.from("accounts").select("auth_user_id,role_ids").eq("restaurant_id",restaurantId).eq("is_active",true);
      if ((admins || []).filter((account) => account.auth_user_id !== accountId && (account.role_ids || []).includes(adminRole.id)).length < 1)
        return reply(400,{error:"restaurant_must_keep_one_active_admin"});
    }
    const { data: authTarget, error: authLookupError } = await db.auth.admin.getUserById(accountId);
    if (authLookupError || !authTarget.user?.email) return reply(500, { error: "auth_account_lookup_failed" });
    if (!authEmailDomain) return reply(500, { error: "server_auth_email_not_configured" });
    const { error: banError } = await db.auth.admin.updateUserById(accountId, { email: `inactive-${accountId}@${authEmailDomain}`, email_confirm: true, ban_duration: "876000h" });
    if (banError) return reply(400, { error: banError.message });
    const { error } = await db.from("accounts").update({ is_active: false }).eq("auth_user_id", accountId).eq("restaurant_id", restaurantId);
    if (error) { await db.auth.admin.updateUserById(accountId, { email: authTarget.user.email, email_confirm: true, ban_duration: "none" }); return reply(400, { error: error.message }); }
    return reply(200, { success: true });
  }
  return reply(400, { error: "unknown_action" });
});
