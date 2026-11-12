import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const normalize = (value: string) =>
  value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const validUsername = (value: string) => /^[a-z0-9._-]{1,49}$/.test(value);
const validSchedule = (value: any) =>
  Number.isInteger(Number(value?.weekday)) && Number(value.weekday) >= 0 && Number(value.weekday) <= 6 &&
  /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(value?.starts_at ?? "")) &&
  /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(value?.ends_at ?? "")) &&
  String(value.starts_at) < String(value.ends_at);

type Schedule = { weekday: number; starts_at: string; ends_at: string };

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
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${serviceKey}` } },
  });

  const { data: actor, error: actorError } = await admin.from("accounts")
    .select("auth_user_id,restaurant_id,role_ids,location_id,is_active,restaurants!inner(status,available_role_ids)")
    .eq("auth_user_id", user.id).maybeSingle();
  if (actorError) return reply(500, { error: "account_lookup_failed" });
  const restaurant = actor?.restaurants as any;
  const { data: adminRole } = await admin.from("roles").select("id").eq("key", "admin").maybeSingle();
  if (!actor?.is_active || restaurant?.status !== "active" || !adminRole?.id || !(actor.role_ids || []).includes(adminRole.id))
    return reply(403, { error: "active_restaurant_admin_required" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  const action = String(body.action ?? "");
  const restaurantId = actor.restaurant_id;

  const { data: roleRows, error: rolesError } = await admin.from("roles")
    .select("id,key,name").order("sort_order");
  if (rolesError) return reply(500, { error: "role_catalog_unavailable" });
  const rolesById = new Map((roleRows || []).map((role) => [role.id, role]));
  const availableRoleIds = new Set<string>(restaurant.available_role_ids || []);

  const parseRoleIds = (input: unknown): string[] | null => {
    if (!Array.isArray(input) || input.length === 0 || input.some((id) => typeof id !== "string")) return null;
    const ids = [...new Set(input as string[])];
    if (ids.length !== input.length || ids.some((id) => !availableRoleIds.has(id) || !rolesById.has(id))) return null;
    const keys = ids.map((id) => rolesById.get(id)!.key);
    if (keys.includes("admin") || keys.includes("employee")) return ids.length === 1 ? ids : null;
    return ids;
  };

  const parseSchedules = (input: unknown): Schedule[] | null => {
    if (!Array.isArray(input)) return null;
    if (input.length > 21 || input.some((schedule) => !validSchedule(schedule))) return null;
    const schedules = input.map((schedule: any) => ({
      weekday: Number(schedule.weekday),
      starts_at: String(schedule.starts_at).slice(0, 8),
      ends_at: String(schedule.ends_at).slice(0, 8),
    }));
    return schedules.filter((schedule, index) => schedules.findIndex((other) =>
      other.weekday === schedule.weekday && other.starts_at === schedule.starts_at && other.ends_at === schedule.ends_at
    ) === index);
  };

  const saveScheduleBlocks = async (schedules: Schedule[]) => {
    const ids: string[] = [];
    const created: string[] = [];
    for (const schedule of schedules) {
      const existing = await admin.from("account_schedules").select("id")
        .eq("restaurant_id", restaurantId).eq("weekday", schedule.weekday)
        .eq("starts_at", schedule.starts_at).eq("ends_at", schedule.ends_at).maybeSingle();
      if (existing.error) return { ids, created, error: existing.error };
      if (existing.data?.id) {
        ids.push(existing.data.id);
        continue;
      }
      const inserted = await admin.from("account_schedules")
        .insert({ restaurant_id: restaurantId, ...schedule }).select("id").single();
      if (inserted.error || !inserted.data?.id) return { ids, created, error: inserted.error || new Error("schedule_insert_failed") };
      ids.push(inserted.data.id);
      created.push(inserted.data.id);
    }
    return { ids, created, error: null };
  };

  const validateLocation = async (value: unknown, required: boolean) => {
    if (!value) return required ? null : "";
    if (typeof value !== "string") return null;
    const { data, error } = await admin.from("locations").select("id")
      .eq("id", value).eq("restaurant_id", restaurantId).eq("is_active", true).maybeSingle();
    return error || !data ? null : data.id;
  };

  if (action === "create") {
    const username = normalize(String(body.username ?? ""));
    const displayName = String(body.display_name ?? "").trim();
    const password = String(body.password ?? "");
    const roleIds = parseRoleIds(body.role_ids);
    const schedules = parseSchedules(body.schedules);
    const isAdmin = Boolean(roleIds?.some((id) => rolesById.get(id)?.key === "admin"));
    const locationId = await validateLocation(body.location_id, !isAdmin);
    if (!validUsername(username) || !displayName || password.length < 6)
      return reply(400, { error: "valid_username_display_name_and_password_required_min_6" });
    if (!roleIds) return reply(400, { error: "choose_only_roles_enabled_for_restaurant" });
    if (!schedules || (!isAdmin && schedules.length === 0))
      return reply(400, { error: "employee_requires_valid_work_schedule" });
    if (locationId === null) return reply(400, { error: "location_not_in_restaurant" });

    const storedSchedules = await saveScheduleBlocks(schedules);
    if (storedSchedules.error) {
      if (storedSchedules.created.length) await admin.from("account_schedules").delete().in("id", storedSchedules.created);
      return reply(400, { error: storedSchedules.error.message });
    }
    const [local, domain] = baseEmail.split("@");
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `${local}+k-${username}@${domain}`,
      password,
      email_confirm: true,
      user_metadata: { account_type: "restaurant", username },
    });
    if (createError || !created.user) {
      if (storedSchedules.created.length) await admin.from("account_schedules").delete().in("id", storedSchedules.created);
      return reply(409, { error: createError?.message ?? "auth_user_creation_failed" });
    }
    const { error: insertError } = await admin.from("accounts").insert({
      auth_user_id: created.user.id,
      restaurant_id: restaurantId,
      role_ids: roleIds,
      schedule_ids: storedSchedules.ids,
      username,
      display_name: displayName,
      location_id: locationId || null,
    });
    if (insertError) {
      await admin.auth.admin.deleteUser(created.user.id);
      if (storedSchedules.created.length) await admin.from("account_schedules").delete().in("id", storedSchedules.created);
      return reply(400, { error: insertError.message });
    }
    return reply(201, {
      auth_user_id: created.user.id,
      username,
      role_ids: roleIds,
      roles: roleIds.map((id) => rolesById.get(id)?.name),
    });
  }

  const targetId = String(body.auth_user_id ?? "");
  const { data: target, error: targetError } = await admin.from("accounts")
    .select("auth_user_id,restaurant_id,role_ids,schedule_ids,location_id,is_active")
    .eq("auth_user_id", targetId).eq("restaurant_id", restaurantId).maybeSingle();
  if (targetError) return reply(500, { error: "account_lookup_failed" });
  if (!target) return reply(404, { error: "account_not_found" });

  const hasAdminRole = (ids: string[]) => ids.some((id) => rolesById.get(id)?.key === "admin");
  const countOtherAdmins = async () => {
    const { data, error } = await admin.from("accounts").select("auth_user_id,role_ids")
      .eq("restaurant_id", restaurantId).eq("is_active", true);
    if (error) throw error;
    return (data || []).filter((account) =>
      account.auth_user_id !== targetId && hasAdminRole(account.role_ids || [])
    ).length;
  };

  if (action === "delete") {
    if (hasAdminRole(target.role_ids || [])) {
      if (targetId !== user.id) return reply(400, { error: "cannot_deactivate_another_admin" });
      try { if (await countOtherAdmins() < 1) return reply(400, { error: "restaurant_must_keep_one_active_admin" }); }
      catch { return reply(500, { error: "admin_count_failed" }); }
    }
    const { error } = await admin.from("accounts").update({ is_active: false }).eq("auth_user_id", targetId);
    if (error) return reply(400, { error: error.message });
    const { error: banError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
    if (banError) {
      await admin.from("accounts").update({ is_active: true }).eq("auth_user_id", targetId);
      return reply(400, { error: banError.message });
    }
    return reply(200, { success: true });
  }

  if (action === "restore") {
    const { error: unbanError } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" });
    if (unbanError) return reply(400, { error: unbanError.message });
    const { error } = await admin.from("accounts").update({ is_active: true }).eq("auth_user_id", targetId);
    if (error) {
      await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" });
      return reply(400, { error: error.message });
    }
    return reply(200, { success: true });
  }

  if (action === "reset_password") {
    const password = String(body.password ?? "");
    if (password.length < 6) return reply(400, { error: "password_min_length_6" });
    if (!target.is_active) return reply(400, { error: "restore_account_before_password_reset" });
    const { error: flagError } = await admin.from("accounts").update({ must_change_password: true }).eq("auth_user_id", targetId);
    if (flagError) return reply(400, { error: flagError.message });
    const { error: passwordError } = await admin.auth.admin.updateUserById(targetId, { password });
    if (passwordError) {
      await admin.from("accounts").update({ must_change_password: false }).eq("auth_user_id", targetId);
      return reply(400, { error: passwordError.message });
    }
    return reply(200, { success: true });
  }

  if (action === "update") {
    const update: Record<string, unknown> = {};
    if (typeof body.display_name === "string") {
      const displayName = body.display_name.trim();
      if (!displayName) return reply(400, { error: "display_name_required" });
      update.display_name = displayName;
    }
    if (typeof body.location_id !== "undefined") {
      const currentAdmin = hasAdminRole(target.role_ids || []);
      const locationId = await validateLocation(body.location_id, !currentAdmin);
      if (locationId === null) return reply(400, { error: "location_not_in_restaurant" });
      update.location_id = locationId || null;
    }
    if (typeof body.role_ids !== "undefined") {
      const roleIds = parseRoleIds(body.role_ids);
      if (!roleIds) return reply(400, { error: "choose_only_roles_enabled_for_restaurant" });
      if (hasAdminRole(target.role_ids || []) && !hasAdminRole(roleIds)) {
        try { if (await countOtherAdmins() < 1) return reply(400, { error: "restaurant_must_keep_one_active_admin" }); }
        catch { return reply(500, { error: "admin_count_failed" }); }
      }
      update.role_ids = roleIds;
    }
    if (typeof body.schedules !== "undefined") {
      const schedules = parseSchedules(body.schedules);
      const resultingRoles = (update.role_ids as string[] | undefined) || target.role_ids || [];
      const resultingAdmin = hasAdminRole(resultingRoles);
      if (!schedules || (!resultingAdmin && schedules.length === 0))
        return reply(400, { error: "employee_requires_valid_work_schedule" });
      const storedSchedules = await saveScheduleBlocks(schedules);
      if (storedSchedules.error) return reply(400, { error: storedSchedules.error.message });
      update.schedule_ids = storedSchedules.ids;
    }
    const { error } = await admin.from("accounts").update(update).eq("auth_user_id", targetId);
    return error ? reply(400, { error: error.message }) : reply(200, { success: true });
  }

  return reply(400, { error: "unknown_action" });
});
