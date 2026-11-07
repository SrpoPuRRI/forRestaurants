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

The initial migration establishes shared identities, roles, restaurants, schedules, locations, RLS and the private logo bucket. Migration `202611070001_setter_architecture_catalog.sql` adds Setter-managed needs and typed configurations. `architectures` holds stable family IDs; every immutable row in `architecture_versions` is a concrete architecture with its own roles, supported needs and configuration defaults. Restaurants store the exact `architecture_version_id`. Creation offers the latest compatible version from each active family, while existing restaurants stay on their saved version until an operator manually changes it. The migration removes restaurant type/city and the old ambiguous architecture columns. The existing POS still has Kffe’to-derived operational queries and attendance/order RPCs. Those operational tables and RPCs must be migrated to `restaurant_id` and tenant-scoped policies before real restaurants can safely use all modules. The account creation path is wired to the new `accounts` table; this file does not silently convert existing production data.
