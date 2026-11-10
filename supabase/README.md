# Deploy and configure the shared Supabase backend

The static POS and Setter use the same Supabase project. Cloudflare Pages continues to deploy each frontend from its GitHub repository. The workflow in this repository separately applies Supabase migrations and Edge Functions when files under `supabase/` reach `main`.

## One-time dashboard setup

1. In Supabase Authentication > Users, create/confirm `srpopurr0000@gmail.com`. Do not enable public sign-ups. Setter uses an email link with `shouldCreateUser: false`, so only this existing user can get a Setter session.
2. Copy that user's Auth UUID and run this once in the Supabase SQL Editor:

   ```sql
   insert into public.platform_operators (auth_user_id)
   values ('PASTE-THE-AUTH-USER-UUID-HERE')
   on conflict (auth_user_id) do nothing;
   ```

3. In Authentication URL Configuration, set the Site URL to the production Setter origin and add the exact Setter production URL (including its path if applicable) to Redirect URLs. Add the POS production URL too for Auth redirects.
4. Configure an SMTP provider under Authentication > SMTP Settings for reliable production delivery. Keep the operator email the only approved Setter identity.
5. Set the `AUTH_EMAIL_BASE` Edge Function secret to `srpopurr0000@gmail.com` (run from the repository root):

   ```powershell
   npx supabase secrets set AUTH_EMAIL_BASE=srpopurr0000@gmail.com --project-ref yqrilxnldkzmbhxzagaz
   ```

   The Supabase URL, public key, and this Gmail address in frontend configuration are public values; never put `SUPABASE_SERVICE_ROLE_KEY` in either frontend or GitHub source.

## GitHub Actions secrets

In the `forRestaurants` GitHub repository, add these repository Actions secrets:

- `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token used by the CLI.
- `SUPABASE_DB_PASSWORD`: the database password for project `yqrilxnldkzmbhxzagaz`.

After saving them, merge/push this backend to `main`. The workflow applies the migration and deploys the four functions. Pages deployment from each frontend repository remains its existing workflow.

## Auth design

- Setter operator: direct Gmail identity, email link, explicit `platform_operators` allowlist, and no operator name/profile in the UI.
- Restaurant users: username/password in Supabase Auth. The server derives an internal Gmail plus-address from the globally unique username. Passwords are never written to `accounts`.
- `setter-create-restaurant` creates the restaurant, role snapshot, and initial admin account as one flow, cleaning up the Auth user if the database write fails.
- `setter-admin` creates/deactivates restaurant accounts and changes platform-managed restaurant status/configuration after checking the operator allowlist.
- `staff-admin` creates/updates/deactivates accounts only for the authenticated admin's active restaurant.
- `restaurant-access` checks account and restaurant status before POS loads the workspace; a deactivated restaurant gets the blocking notice.

## Current migration boundary

The initial migration establishes shared identities, roles, restaurants, schedules, locations, RLS and the private logo bucket. Migration `202611070001_setter_architecture_catalog.sql` temporarily added the architecture/configuration catalog. Migration `202611080001_fixed_optional_needs.sql` removes that transitional model, preserves attendance switches in typed columns, maps `dining` to `salon`, and restricts `restaurants.needs` to `crm`, `kitchen`, `salon`, `delivery`, and `receipts`. Setter creates Administrator and Employee baseline roles for new restaurants.

The POS still contains Kffe’to-derived operational queries and attendance/order RPCs. These operational tables and RPCs have not been migrated to `restaurant_id` with tenant-scoped policies. Do not onboard real client restaurants or treat this deployment as a production launch until that migration is complete and verified. Migration `202611080002_restaurant_operational_settings.sql` stores restaurant-scoped payment selections, role rules, and employee notes with RLS; the POS exposes those preferences in Configuración. Current checkout and reporting do not yet enforce all saved payment/order/catalog preferences, automatic payment integrations are unavailable, category ranking still needs category-aware tenant-scoped order data, and employee note auto-reset is intentionally not performed until its retention policy is decided.

Migration `202611100001_restaurant_catalog.sql` adds a tenant-scoped catalog and receipt-format storage with RLS. The POS interface treats `is_active` on products, variants, and addons as sellable availability: out-of-stock entries remain visible and cannot be added. `set_catalog_stock_availability` lets the current Employee role update only availability through a server-side function. The migration is part of the repository but has not been applied to Supabase. Receipt-format controls are in Configuración and are shown only for restaurants whose needs include `receipts`.

**Role/need direction agreed on 2026-11-10 and refined later (not yet implemented):** replace per-restaurant role rows and the single `accounts.role_id` with a global role catalog, an array of role IDs allowed by each restaurant, and an array of role IDs assigned to each account. There are no predefined mixed roles; assigning multiple simple roles accumulates permissions. The POS derives available roles and effective permissions from needs and persisted settings; server/RLS authorization must enforce the same result. The restaurant admin can add/remove needs after setup; removing a need revokes its roles/workspaces while preserving records. `Empleado` is a special exclusive role granting the union of permissions available in that restaurant. Current mapping: Cocina → Cocinero; separate-bar setting → Barista, Bartender, and Barra workspace; Salón → Mesero and Portero; CRM → Social Manager; Delivery → Repartidor once its settings are defined; Comprobantes adds no role. Include Cajero whenever at least one active need other than Comprobantes exists; remove it when none remain. The implementation must revisit `restaurant_role_settings` and its current composite foreign key because it assumes roles belong to a restaurant.

**Product direction revised after this migration:** Setter will manage needs and restaurants only; it will not manage operational settings or a generic configuration catalog. Restaurant needs determine which settings the POS app shows to its administrator. Settings will persist in explicit restaurant columns or domain-specific tables (for example, payment methods), not a generic key/value catalog. The current `architectures`, `architecture_versions`, `architecture_needs`, `architecture_configurations`, `configuration_catalog`, and `restaurants.configuration` JSONB model is legacy for this target. A follow-up database redesign must map existing values before removing it.
