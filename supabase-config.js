// Public client settings. The publishable/anon key is safe for browser use; never put a secret key here.
// Get both values from the Supabase project Connect dialog or Settings > API Keys.
export const SUPABASE_URL = "https://yqrilxnldkzmbhxzagaz.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_CIUObRoqGCvXU13tLI-22w_01R_9gda";

// Gmail base for synthetic Auth identities. Supabase will see aliases such as
// srpopurr0000+k-nivex@gmail.com. All messages sent to these aliases go to this inbox.
// This value is public in the deployed frontend bundle; do not use it as a password or secret.
export const AUTH_EMAIL_BASE = "srpopurr0000@gmail.com";
