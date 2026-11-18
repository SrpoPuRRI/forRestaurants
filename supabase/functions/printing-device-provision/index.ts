import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
};
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "authentication_required" });

  const caller = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authError } = await caller.auth.getUser(token);
  if (authError || !user) return reply(401, { error: "invalid_session" });

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${serviceKey}` } },
  });
  const { data: account, error: accountError } = await db.from("accounts")
    .select("restaurant_id,is_active,role_ids,restaurants!inner(status)")
    .eq("auth_user_id", user.id).maybeSingle();
  if (accountError) return reply(500, { error: "account_lookup_failed" });
  const restaurant = account?.restaurants as any;
  const { data: adminRole, error: roleError } = await db.from("roles")
    .select("id").eq("key", "admin").maybeSingle();
  if (roleError) return reply(500, { error: "role_catalog_unavailable" });
  if (!account?.is_active || restaurant?.status !== "active"
    || !adminRole?.id || !(account.role_ids || []).includes(adminRole.id))
    return reply(403, { error: "active_restaurant_admin_required" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  const hardwareKey = String(body.hardware_key ?? "").trim();
  const model = String(body.model ?? "").trim();
  if (hardwareKey.length < 8 || hardwareKey.length > 200)
    return reply(400, { error: "invalid_hardware_key" });
  if (model.length < 1 || model.length > 120)
    return reply(400, { error: "invalid_printer_model" });

  const { data: existing, error: existingError } = await db.from("printing_devices")
    .select("id,restaurant_id").eq("hardware_key", hardwareKey).maybeSingle();
  if (existingError) return reply(500, { error: "printer_lookup_failed" });
  if (existing?.restaurant_id && existing.restaurant_id !== account.restaurant_id)
    return reply(409, { error: "printing_device_already_linked" });

  const deviceToken = randomToken();
  const tokenHash = await sha256(deviceToken);
  if (existing) {
    const { error: updateError } = await db.from("printing_devices").update({
      model,
      restaurant_id: account.restaurant_id,
      device_token_hash: tokenHash,
      last_seen_at: new Date().toISOString(),
      operation_mode: "idle",
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    if (updateError) return reply(400, { error: "printer_update_failed", detail: updateError.message });
    return reply(200, { device_id: existing.id, device_token: deviceToken, hardware_key: hardwareKey });
  }

  const { data: deviceId, error: registerError } = await db.rpc("register_printing_device", {
    p_hardware_key: hardwareKey,
    p_model: model,
    p_device_token: deviceToken,
  });
  if (registerError || !deviceId)
    return reply(400, { error: "printer_registration_failed", detail: registerError?.message });
  const { error: linkError } = await db.from("printing_devices").update({
    restaurant_id: account.restaurant_id,
  }).eq("id", deviceId);
  if (linkError) return reply(400, { error: "printer_link_failed", detail: linkError.message });

  return reply(200, { device_id: deviceId, device_token: deviceToken, hardware_key: hardwareKey });
});
