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
- Restaurant logos use the private `restaurant-assets` bucket. Setter uploads through its authenticated Edge Functions; the restaurant admin can replace/remove the logo from Configuración. The database stores only the tenant-scoped object path, and the UI displays short-lived signed URLs.
- `staff-admin` creates/updates/deactivates accounts only for the authenticated admin's active restaurant.
- `restaurant-access` checks account and restaurant status before POS loads the workspace; a deactivated restaurant gets the blocking notice.

## Current migration boundary

The initial migration establishes shared identities, restaurants, schedules, locations, RLS and the private logo bucket. Migration `202611070001_setter_architecture_catalog.sql` temporarily added the architecture/configuration catalog. Migration `202611080001_fixed_optional_needs.sql` removes that transitional model, preserves attendance switches in typed columns, and maps `dining` to `salon`. Migration `202611130007_printing_systems.sql` renames the old `receipts` optional need to `printing_systems`; new restaurants use the new key. Since `202611120001`, new restaurants get global Administrator and Employee roles; optional roles are derived from their selected needs and settings.

The current order model is tenant-scoped: migrations `202611120003_paid_orders_and_statistics.sql` and `202611130001_required_special_products_and_payment_rules.sql` add restaurant-scoped open/paid orders, item/payment snapshots, correction events, required Ingreso/Egreso products, mandatory cash and the corresponding RPC protections. The owner reported on 2026-11-13 that the latest frontend/backend changes are in production and working. Verify `supabase_migrations.schema_migrations` before later schema work; this README is not a substitute for a live migration-history check. Automatic payment integrations are unavailable; employee-note auto-reset is not performed until its retention policy is decided.

Migration `202611100001_restaurant_catalog.sql` adds a tenant-scoped catalog and legacy receipt-format storage with RLS. The POS interface treats `is_active` on products, variants, and addons as sellable availability: out-of-stock entries remain visible and cannot be added. `set_catalog_stock_availability` lets accounts with the catalog-stock permission update only availability through a server-side function. Migration `202611130007_printing_systems.sql` adds the new printing configuration and event queue; each prior single-template record is copied to `printing_ticket_templates`.

Migration `202611110002_restaurant_logo_storage.sql` makes the private logo bucket configuration repeatable and adds tenant/admin-scoped delete access so restaurant admins can replace or remove their own logo. It is applied to the linked Supabase project.

Migration `202611110003_setter_restaurant_service_access.sql` grants the Setter Edge Function's service role the specific `SELECT` and `UPDATE` table privileges it needs to read and change restaurant metadata. RLS bypass does not itself grant PostgreSQL table privileges.

Migration `202611120001_accounts_roles_attendance.sql` implements the global role catalog, `restaurants.available_role_ids`, multi-role `accounts.role_ids`, reusable schedule blocks with account `schedule_ids`, required `assistance_id`, attendance objects/records, and permission checks used by workspaces and catalog stock. Roles are derived when needs or the separate-bar setting changes: Cocina → Cocinero; separate bar → Barista/Bartender and Barra; Salón → Mesero/Portero; CRM → Social Manager; Delivery → Repartidor; Cajero is included when any need other than Sistemas de Impresión is active. Administrador and Empleado are always available. Empleado receives the union of enabled non-admin role permissions and is exclusive. The admin can change needs in POS Configuración; removing a need immediately removes its roles from the available-role array without deleting operational data. The migration has been applied to production and confirmed in remote migration history on 2026-11-12. If account creation or role authorization fails, verify deployed `staff-admin` and Setter Edge Functions against this schema.

Migration `202611120002_account_locations_and_active_usernames.sql` was applied to production on 2026-11-12. It creates a **Sede principal** for existing restaurants that have no active site, requires a primary site when the restaurant-creation RPC receives a new request (with a backwards-compatible default), and changes username uniqueness to active accounts only. The staff and Setter account-creation functions archive the Auth email of prior inactive accounts so that the same username can be reused without deleting the historical account. Account deactivation is not reversible through the app.

Migration `202611120003_paid_orders_and_statistics.sql` creates tenant-scoped `orders`, `order_items`, `order_item_addons`, `order_correction_events` and `open_orders`, payment snapshots, correction RPCs and open-order RPCs. Migration `202611130001_required_special_products_and_payment_rules.sql` backfills and seeds one protected Ingreso and Egreso product per restaurant, ensures the variable-amount variant, forces cash as enabled/manual for every restaurant, and makes payment corrections reason-free while retaining the correction actor/time. The application UI lists only currently enabled manual payment methods. The owner confirmed the latest changes are deployed and working as of 2026-11-13; check the remote migration history before any follow-up SQL.

Attendance uses an append-only event model: `attendance_objects` group per-account records, and `attendance_records` stores effective and recorded timestamps, actor, location, method, and correction reason. Admin corrections are constrained to today/yesterday. Current account and attendance UI and server functions are implemented but still require owner-led functional testing.

**Product direction revised after this migration:** Setter will manage needs and restaurants only; it will not manage operational settings or a generic configuration catalog. Restaurant needs determine which settings the POS app shows to its administrator. Settings will persist in explicit restaurant columns or domain-specific tables (for example, payment methods), not a generic key/value catalog. The current `architectures`, `architecture_versions`, `architecture_needs`, `architecture_configurations`, `configuration_catalog`, and `restaurants.configuration` JSONB model is legacy for this target. A follow-up database redesign must map existing values before removing it.
